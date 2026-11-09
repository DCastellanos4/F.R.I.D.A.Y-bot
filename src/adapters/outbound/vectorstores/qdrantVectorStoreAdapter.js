/**
 * Adaptador VectorStorePort: Qdrant via API REST (RF-03).
 *
 * Eleccion de motor sustentada (9 nov 2026, grounding del VPS):
 *  - El ERS permite "pgvector en PostgreSQL o Qdrant". El VPS es 4 vCPU
 *    CPU-only, 23.4 GiB RAM, 116 GiB libres, sin swap, con Docker
 *    funcional via sudo y los puertos 6333/6334 libres.
 *  - Qdrant es UN solo contenedor (~0.3-0.5 GiB en reposo a esta escala)
 *    con HNSW en disco SSD nativo y API REST: cero dependencias npm
 *    nuevas (fetch de Node 20+).
 *  - pgvector exigiria provisionar PostgreSQL entero (servicio, tuning,
 *    backups) mas el driver `pg` en package.json por solo una extension.
 *    Coste de CPU/RAM y operativo mayor para el mismo cumplimiento.
 *
 * Particion multi-tenant: UNA coleccion por tenant
 * (`<prefijo>_<tenantId>`), creada perezosamente. Qdrant exige ids de
 * punto enteros o UUID: el id de documento se deriva a un UUID
 * determinista por SHA-256 y el id original viaja en payload.doc_id.
 *
 * Seguridad (documentacion oficial Qdrant, 9 nov 2026): una instancia
 * self-hosted arranca SIN autenticacion, SIN TLS y escuchando en todas
 * las interfaces; cualquiera con acceso al puerto puede leer, escribir o
 * borrar todo. Obligatorio en el despliegue: publicar solo loopback
 * (`-p 127.0.0.1:6333:6333`) y fijar `QDRANT__SERVICE__API_KEY`; este
 * adaptador acepta la clave por opcion o por DAVIS_QDRANT_API_KEY y la
 * envia en la cabecera `api-key`. Version objetivo verificada:
 * qdrant/qdrant:v1.20.0 (22 oct 2026).
 *
 * Estado: codigo real contra la API REST, NO probado contra un servidor
 * Qdrant vivo (ninguno desplegado aun; entra en la ventana de infra).
 *
 * Strict Policy: Zero Emojis.
 */

import crypto from 'node:crypto';
import { afirmarTenantId } from '../../../core/tenancy.js';
import { afirmarVectorStore } from '../../../ports/outbound/VectorStorePort.js';

const PREFIJO_DEFECTO = 'davis_memorias';

/**
 * UUID determinista a partir del id de documento: 32 hex de SHA-256 con
 * formato 8-4-4-4-12. Mismo doc -> mismo punto (upsert idempotente).
 */
export function idAUuid(docId) {
  const hex = crypto.createHash('sha256').update(String(docId)).digest('hex').slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

/**
 * @param {object} opciones
 * @param {string} opciones.url  Base URL de Qdrant (ej. http://127.0.0.1:6333).
 * @param {number} opciones.dimensiones  Dimensionalidad de los vectores (debe coincidir con el proveedor de embeddings).
 * @param {string} [opciones.prefijoColeccion]
 * @param {string} [opciones.apiKey]  Clave admin (o DAVIS_QDRANT_API_KEY). Se envia en la cabecera `api-key`.
 * @param {typeof fetch} [opciones.fetchImpl]  fetch inyectable (pruebas).
 */
export function crearQdrantVectorStoreAdapter(opciones = {}) {
  const url = typeof opciones.url === 'string' ? opciones.url.replace(/\/+$/, '') : '';
  if (!url) {
    throw new TypeError('QdrantVectorStore: url es obligatoria (ej. http://127.0.0.1:6333).');
  }
  const dimensiones = Number.isInteger(opciones.dimensiones) && opciones.dimensiones > 0 ? opciones.dimensiones : 0;
  if (!dimensiones) {
    throw new TypeError('QdrantVectorStore: dimensiones (entero positivo) es obligatorio y debe coincidir con el proveedor de embeddings.');
  }
  const prefijo = opciones.prefijoColeccion || PREFIJO_DEFECTO;
  const apiKey = opciones.apiKey || process.env.DAVIS_QDRANT_API_KEY || '';
  const fetchImpl = opciones.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    throw new TypeError('QdrantVectorStore: no hay fetch disponible (Node >= 20).');
  }

  const coleccionesVerificadas = new Set();

  function coleccionDe(tenantId) {
    afirmarTenantId(tenantId);
    return `${prefijo}_${tenantId}`;
  }

  async function peticion(metodo, ruta, cuerpo) {
    const cabeceras = { 'content-type': 'application/json' };
    if (apiKey) cabeceras['api-key'] = apiKey;
    const respuesta = await fetchImpl(`${url}${ruta}`, {
      method: metodo,
      headers: cabeceras,
      body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo)
    });
    if (!respuesta || typeof respuesta.status !== 'number') {
      throw new Error('QdrantVectorStore: fetch no devolvio una respuesta HTTP.');
    }
    if (respuesta.status === 404) return { noEncontrado: true };
    if (!respuesta.ok) {
      let detalle = '';
      try { detalle = String(await respuesta.text()).slice(0, 300); } catch { /* sin cuerpo legible */ }
      throw new Error(`QdrantVectorStore: HTTP ${respuesta.status} en ${metodo} ${ruta}: ${detalle}`);
    }
    try {
      return await respuesta.json();
    } catch {
      return {};
    }
  }

  async function asegurarColeccion(tenantId) {
    const coleccion = coleccionDe(tenantId);
    if (coleccionesVerificadas.has(coleccion)) return coleccion;
    const estado = await peticion('GET', `/collections/${coleccion}`);
    if (estado.noEncontrado) {
      await peticion('PUT', `/collections/${coleccion}`, {
        vectors: { size: dimensiones, distance: 'Cosine', on_disk: true },
        optimizers_config: { memmap_threshold: 20000 }
      });
    } else {
      // Defensa: una coleccion existente con otra dimensionalidad romperia
      // silenciosamente el canal denso.
      const sizeReal = estado?.result?.config?.params?.vectors?.size;
      if (Number.isInteger(sizeReal) && sizeReal !== dimensiones) {
        throw new Error(`QdrantVectorStore: la coleccion ${coleccion} tiene ${sizeReal} dimensiones y el proveedor emite ${dimensiones}. Reindexa o corrige el modelo.`);
      }
    }
    coleccionesVerificadas.add(coleccion);
    return coleccion;
  }

  async function indexar(tenantId, docs) {
    const lista = Array.isArray(docs) ? docs : [];
    if (lista.length === 0) return { ok: true, total: 0 };
    const coleccion = await asegurarColeccion(tenantId);
    const puntos = lista.map((d) => ({
      id: idAUuid(d.id),
      vector: d.vector,
      payload: { doc_id: d.id, texto: d.texto, ...(d.payload || {}) }
    }));
    await peticion('PUT', `/collections/${coleccion}/points?wait=true`, { points: puntos });
    return { ok: true, total: puntos.length };
  }

  async function buscarDenso(tenantId, vector, topK) {
    const coleccion = await asegurarColeccion(tenantId);
    const limite = Number.isInteger(topK) && topK > 0 ? topK : 20;
    const respuesta = await peticion('POST', `/collections/${coleccion}/points/search`, {
      vector,
      limit: limite,
      with_payload: true,
      with_vector: false
    });
    const resultados = respuesta && Array.isArray(respuesta.result) ? respuesta.result : [];
    return resultados.map((r) => ({
      id: r.payload && typeof r.payload.doc_id === 'string' ? r.payload.doc_id : String(r.id),
      score: typeof r.score === 'number' ? r.score : 0,
      texto: r.payload && typeof r.payload.texto === 'string' ? r.payload.texto : '',
      payload: r.payload || {}
    }));
  }

  async function borrar(tenantId, ids) {
    const lista = Array.isArray(ids) ? ids : [];
    if (lista.length === 0) return { ok: true, total: 0 };
    const coleccion = await asegurarColeccion(tenantId);
    await peticion('POST', `/collections/${coleccion}/points/delete?wait=true`, {
      points: lista.map(idAUuid)
    });
    return { ok: true, total: lista.length };
  }

  async function contar(tenantId) {
    const coleccion = await asegurarColeccion(tenantId);
    const respuesta = await peticion('POST', `/collections/${coleccion}/points/count`, { exact: true });
    return respuesta && respuesta.result && Number.isInteger(respuesta.result.count) ? respuesta.result.count : 0;
  }

  return afirmarVectorStore({
    motor: 'qdrant',
    esIndustrial: true,
    indexar,
    buscarDenso,
    borrar,
    contar
  });
}
