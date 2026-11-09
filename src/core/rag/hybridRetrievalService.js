/**
 * Servicio de recuperacion hibrida (RF-03).
 *
 * Orquesta los cuatro componentes del motor RAG industrial:
 *   consulta -> canal denso (embeddings + almacen vectorial)
 *            -> canal disperso (BM25)
 *            -> fusion RRF (k=60)
 *            -> reranker cross-encoder
 *            -> Top-K con score en [0.0, 1.0]
 *
 * Dominio puro: recibe los puertos por inyeccion y no conoce Qdrant,
 * SQLite, Ollama ni HTTP. La raiz de composicion decide los adaptadores.
 *
 * Garantias:
 *  - tenantId OBLIGATORIO y validado en cada operacion publica: no existe
 *    recuperacion sin particion de tenant.
 *  - El predicado `esIndexable` (cableado en la integracion a la regla de
 *    credenciales del RAG historico) se aplica SIEMPRE al indexar: un
 *    documento sensible nunca entra en ninguno de los dos canales.
 *  - Cada resultado declara su procedencia: canales que lo recuperaron,
 *    si paso por reranker real y si el score esta calibrado. Un pipeline
 *    con almacen o reranker de desarrollo NUNCA presenta sus scores como
 *    calibrados ni certifica RF-03.
 *
 * Strict Policy: Zero Emojis.
 */

import { afirmarTenantId } from '../tenancy.js';
import { afirmarEmbeddingProvider } from '../../ports/outbound/EmbeddingProviderPort.js';
import { afirmarVectorStore } from '../../ports/outbound/VectorStorePort.js';
import { afirmarSparseIndex } from '../../ports/outbound/SparseIndexPort.js';
import { afirmarReranker } from '../../ports/outbound/RerankerPort.js';
import { fusionarRRF, RRF_K_DEFECTO } from './reciprocalRankFusion.js';

export const DEFAULTS_HIBRIDO = Object.freeze({
  topKDensa: 20,
  topKDispersa: 20,
  candidatosRerank: 40,
  kRrf: RRF_K_DEFECTO
});

/**
 * @param {object} deps
 * @param {import('../../ports/outbound/EmbeddingProviderPort.js').EmbeddingProviderPort} deps.embeddings
 * @param {import('../../ports/outbound/VectorStorePort.js').VectorStorePort} deps.vectorStore
 * @param {import('../../ports/outbound/SparseIndexPort.js').SparseIndexPort} deps.sparseIndex
 * @param {import('../../ports/outbound/RerankerPort.js').RerankerPort} [deps.reranker]  Opcional; sin el, el orden final es el de RRF y el score NO esta calibrado.
 * @param {(doc: object) => boolean} [deps.esIndexable]  Predicado de exclusion (credenciales). Por defecto todo es indexable; la integracion DEBE cablear la regla sensible.
 * @param {object} [deps.ajustes]  Overrides de DEFAULTS_HIBRIDO.
 */
export function crearHybridRetrievalService(deps = {}) {
  const embeddings = afirmarEmbeddingProvider(deps.embeddings);
  const vectorStore = afirmarVectorStore(deps.vectorStore);
  const sparseIndex = afirmarSparseIndex(deps.sparseIndex);
  const reranker = deps.reranker ? afirmarReranker(deps.reranker) : null;
  const esIndexable = typeof deps.esIndexable === 'function' ? deps.esIndexable : () => true;
  const ajustes = { ...DEFAULTS_HIBRIDO, ...(deps.ajustes || {}) };

  function extraerTexto(doc) {
    if (!doc || typeof doc !== 'object') return '';
    const partes = [];
    if (doc.sujeto) partes.push(doc.sujeto);
    if (doc.dato) partes.push(doc.dato);
    if (doc.texto) partes.push(doc.texto);
    if (doc.text) partes.push(doc.text);
    if (doc.categoria) partes.push(doc.categoria);
    if (Array.isArray(doc.tags)) partes.push(doc.tags.join(' '));
    return partes.join(' ').trim();
  }

  /**
   * Indexa (upsert) documentos de un tenant en ambos canales.
   * Devuelve { ok, total, omitidos } donde omitidos son los excluidos por
   * el predicado o por no tener texto indexable.
   */
  async function indexar(tenantId, docs) {
    afirmarTenantId(tenantId);
    const lista = Array.isArray(docs) ? docs : [];
    const indexables = [];
    let omitidos = 0;
    for (let i = 0; i < lista.length; i++) {
      const doc = lista[i];
      if (!esIndexable(doc)) {
        omitidos += 1;
        continue;
      }
      const texto = extraerTexto(doc);
      if (!texto) {
        omitidos += 1;
        continue;
      }
      indexables.push({
        id: (doc && typeof doc.id === 'string' && doc.id) ? doc.id : `doc_${i}`,
        texto,
        doc
      });
    }
    if (indexables.length === 0) {
      return { ok: true, total: 0, omitidos };
    }
    const vectores = await embeddings.embeber(indexables.map((d) => d.texto));
    if (!Array.isArray(vectores) || vectores.length !== indexables.length) {
      throw new Error(`HybridRetrieval: el proveedor de embeddings devolvio ${Array.isArray(vectores) ? vectores.length : 'algo no iterable'} vectores para ${indexables.length} textos.`);
    }
    const dimsEsperadas = embeddings.dimensiones();
    for (const vector of vectores) {
      if (!Array.isArray(vector) || vector.length !== dimsEsperadas) {
        throw new Error(`HybridRetrieval: vector de ${Array.isArray(vector) ? vector.length : '?'} dimensiones; se esperaban ${dimsEsperadas} (modelo ${embeddings.id}). Mezclar dimensionalidades rompe el indice.`);
      }
    }
    await vectorStore.indexar(tenantId, indexables.map((d, i) => ({
      id: d.id,
      texto: d.texto,
      vector: vectores[i],
      payload: { doc: d.doc }
    })));
    await sparseIndex.indexar(tenantId, indexables.map((d) => ({ id: d.id, texto: d.texto })));
    return { ok: true, total: indexables.length, omitidos };
  }

  /**
   * Recupera los mejores fragmentos del tenant para una consulta.
   *
   * @returns {Promise<Array<{id: string, score: number, calibrado: boolean,
   *   canales: string[], rangos: Record<string, number>, rerankeado: boolean,
   *   texto: string, item: object|null}>>}
   *   `score` esta en [0.0, 1.0]; `calibrado` solo es true cuando un
   *   reranker cross-encoder real produjo la puntuacion.
   */
  async function buscar(tenantId, consulta, opciones = {}) {
    afirmarTenantId(tenantId);
    if (!consulta || typeof consulta !== 'string' || !consulta.trim()) {
      return [];
    }
    const topK = Number.isInteger(opciones.topK) && opciones.topK > 0 ? opciones.topK : 5;

    const [vectorConsulta] = await embeddings.embeber([consulta]);
    const [denso, disperso] = await Promise.all([
      vectorStore.buscarDenso(tenantId, vectorConsulta, ajustes.topKDensa),
      sparseIndex.buscar(tenantId, consulta, ajustes.topKDispersa)
    ]);

    const fusion = fusionarRRF([
      { canal: 'denso', resultados: denso },
      { canal: 'disperso', resultados: disperso }
    ], { k: ajustes.kRrf });

    if (fusion.length === 0) {
      return [];
    }

    // Texto y documento original de cada candidato: el almacen denso es la
    // fuente (indexar guarda siempre el texto); un candidato solo disperso
    // sin entrada densa no deberia ocurrir (se indexan a la vez), pero si
    // ocurre se recupera con una consulta densa minima... mejor: se omite
    // con honestidad, no se inventa texto.
    const textoPorId = new Map();
    for (const c of denso) {
      if (c && typeof c.id === 'string') textoPorId.set(c.id, { texto: c.texto || '', item: c.payload && c.payload.doc ? c.payload.doc : null });
    }

    const candidatos = [];
    for (const f of fusion.slice(0, ajustes.candidatosRerank)) {
      const datos = textoPorId.get(f.id);
      if (!datos || !datos.texto) continue;
      candidatos.push({ ...f, texto: datos.texto, item: datos.item });
    }
    if (candidatos.length === 0) {
      return [];
    }

    let ordenFinal;
    let calibrado = false;
    if (reranker) {
      const puntuados = await reranker.reordenar(consulta, candidatos.map((c) => ({ id: c.id, texto: c.texto })));
      const scorePorId = new Map();
      for (const p of Array.isArray(puntuados) ? puntuados : []) {
        if (p && typeof p.id === 'string' && Number.isFinite(p.score)) {
          scorePorId.set(p.id, Math.max(0, Math.min(1, p.score)));
        }
      }
      ordenFinal = candidatos
        .filter((c) => scorePorId.has(c.id))
        .map((c) => ({ ...c, score: scorePorId.get(c.id), rerankeado: true }))
        .sort((a, b) => (b.score - a.score) || (a.scoreRrf - b.scoreRrf));
      calibrado = reranker.esReal === true;
    } else {
      // Sin reranker: el orden es el de RRF y el score es el RRF
      // normalizado por el maximo de la tanda. NO es una probabilidad
      // calibrada: se declara calibrado=false.
      const maxRrf = candidatos[0].scoreRrf > 0 ? candidatos[0].scoreRrf : 1;
      ordenFinal = candidatos.map((c) => ({
        ...c,
        score: Math.round((c.scoreRrf / maxRrf) * 10000) / 10000,
        rerankeado: false
      }));
    }

    return ordenFinal.slice(0, topK).map((c) => ({
      id: c.id,
      score: c.score,
      calibrado,
      canales: c.canales,
      rangos: c.rangos,
      rerankeado: c.rerankeado,
      texto: c.texto,
      item: c.item
    }));
  }

  async function borrar(tenantId, ids) {
    afirmarTenantId(tenantId);
    const lista = Array.isArray(ids) ? ids.filter((id) => typeof id === 'string') : [];
    if (lista.length === 0) return { ok: true, total: 0 };
    await vectorStore.borrar(tenantId, lista);
    await sparseIndex.borrar(tenantId, lista);
    return { ok: true, total: lista.length };
  }

  async function contar(tenantId) {
    afirmarTenantId(tenantId);
    const [denso, disperso] = await Promise.all([vectorStore.contar(tenantId), sparseIndex.contar(tenantId)]);
    return { denso, disperso };
  }

  /**
   * Etiquetas honestas de los motores enchufados.
   *
   * `motoresListosParaCertificacion` solo afirma que los CUATRO componentes
   * son reales/industriales. NO es el cumplimiento de RF-03: la
   * certificacion exige evidencia EXTERNA a este servicio que ninguna
   * etiqueta puede sustituir:
   *   - recall medido frente al motor historico sobre consultas reales;
   *   - latencia P95 medida (RNF-02) con los modelos en CPU del VPS;
   *   - aislamiento multi-tenant verificado sobre el motor real desplegado;
   *   - frescura verificada tras la integracion (escritura -> reindexado).
   * Por eso `certificacionRf03` es siempre la cadena 'no-evaluada': el
   * servicio no puede auto-certificarse y ningun informe debe presentar
   * estas etiquetas como requisito cumplido.
   */
  function etiquetaMotores() {
    return {
      embeddings: { id: embeddings.id, esReal: embeddings.esReal },
      vector: { motor: vectorStore.motor, esIndustrial: vectorStore.esIndustrial },
      disperso: { motor: sparseIndex.motor, esIndustrial: sparseIndex.esIndustrial },
      reranker: reranker ? { id: reranker.id, esReal: reranker.esReal } : null,
      motoresListosParaCertificacion:
        embeddings.esReal && vectorStore.esIndustrial && sparseIndex.esIndustrial && !!reranker && reranker.esReal,
      certificacionRf03: 'no-evaluada'
    };
  }

  return Object.freeze({ indexar, buscar, borrar, contar, etiquetaMotores });
}
