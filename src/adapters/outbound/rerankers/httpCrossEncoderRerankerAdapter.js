/**
 * Adaptador RerankerPort: cross-encoder local via HTTP compatible con
 * Hugging Face Text Embeddings Inference (endpoint POST /rerank).
 *
 * Modelo objetivo del ERS: BAAI/bge-reranker-base servido por un
 * contenedor TEI cpu en el propio VPS (sin salida a terceros, sin coste
 * por peticion). El contenedor y el modelo NO estan desplegados aun:
 * entran en la ventana de infraestructura autorizada.
 *
 * Contrato TEI (verificado en la documentacion oficial, 9 nov 2026):
 * POST {url}/rerank con { query, texts, raw_scores, truncate } devuelve
 * [ { index, score } ]. Con raw_scores=false (defecto del servidor) TEI ya
 * aplica la sigmoide y el score viene en [0.0, 1.0]: este adaptador pide
 * raw_scores=false de forma EXPLICITA y no vuelve a aplicar la sigmoide.
 * truncate=true evita rechazos por textos que superan el limite del modelo
 * (512 tokens en bge-reranker-base): se truncan en su lugar.
 *
 * Sin url configurada la factoria devuelve null (patron
 * ticketVisionAdapter): la funcionalidad queda desactivada y el pipeline
 * lo declara (rerankeado=false, calibrado=false), nunca lo simula.
 *
 * Estado: codigo real contra la API, NO probado contra un servidor vivo.
 *
 * Strict Policy: Zero Emojis.
 */

import { afirmarReranker } from '../../../ports/outbound/RerankerPort.js';

function sigmoide(x) {
  return 1 / (1 + Math.exp(-x));
}

/**
 * @param {object} [opciones]
 * @param {string} [opciones.url]  Base URL del servidor TEI (o DAVIS_RERANKER_URL). Vacia -> null (desactivado).
 * @param {number} [opciones.timeoutMs]  Techo por lote (defecto DAVIS_RERANKER_TIMEOUT_MS o 10000).
 * @param {boolean} [opciones.aplicarSigmoide]  Solo para servidores configurados con raw_scores=true (logits crudos). Defecto false: TEI con raw_scores=false ya devuelve probabilidades.
 * @param {typeof fetch} [opciones.fetchImpl]  fetch inyectable (pruebas).
 */
export function crearHttpCrossEncoderReranker(opciones = {}) {
  const url = (opciones.url ?? process.env.DAVIS_RERANKER_URL ?? '').replace(/\/+$/, '');
  if (!url) return null;
  const timeoutMs = Number.isFinite(opciones.timeoutMs) && opciones.timeoutMs > 0
    ? opciones.timeoutMs
    : (Number.parseInt(process.env.DAVIS_RERANKER_TIMEOUT_MS || '', 10) || 10000);
  const aplicarSigmoide = opciones.aplicarSigmoide === true;
  const fetchImpl = opciones.fetchImpl || globalThis.fetch;

  async function reordenar(consulta, documentos) {
    const lista = Array.isArray(documentos) ? documentos : [];
    if (lista.length === 0) return [];
    const controlador = new AbortController();
    const temporizador = setTimeout(() => controlador.abort(), timeoutMs);
    try {
      const respuesta = await fetchImpl(`${url}/rerank`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query: consulta, texts: lista.map((d) => d.texto), raw_scores: aplicarSigmoide, truncate: true }),
        signal: controlador.signal
      });
      if (!respuesta.ok) {
        throw new Error(`RerankerHTTP: HTTP ${respuesta.status} en /rerank.`);
      }
      const crudo = await respuesta.json();
      const filas = Array.isArray(crudo) ? crudo : (Array.isArray(crudo?.results) ? crudo.results : null);
      if (!filas) {
        throw new Error('RerankerHTTP: respuesta sin lista de resultados.');
      }
      const porIndice = new Map();
      for (const fila of filas) {
        if (fila && Number.isInteger(fila.index) && Number.isFinite(fila.score)) {
          porIndice.set(fila.index, fila.score);
        }
      }
      return lista.map((doc, i) => {
        const bruto = porIndice.has(i) ? porIndice.get(i) : -Infinity;
        const score = aplicarSigmoide ? sigmoide(bruto) : Math.max(0, Math.min(1, bruto));
        return { id: doc.id, score };
      });
    } finally {
      clearTimeout(temporizador);
    }
  }

  return afirmarReranker({
    id: 'tei-cross-encoder',
    esReal: true,
    reordenar
  });
}

/**
 * Reranker de DESARROLLO: devuelve los documentos en el orden recibido
 * con score neutro. NO es un cross-encoder: esReal=false y el servicio
 * marca los resultados como NO calibrados. Sirve para probar el cableado
 * del pipeline sin modelo.
 */
export function crearRerankerPassthrough() {
  return afirmarReranker({
    id: 'passthrough-dev',
    esReal: false,
    reordenar: async (consulta, documentos) =>
      (Array.isArray(documentos) ? documentos : []).map((d) => ({ id: d.id, score: 0.5 }))
  });
}
