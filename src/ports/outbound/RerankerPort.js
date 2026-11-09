/**
 * Puerto de salida: re-clasificador cross-encoder (RF-03).
 *
 * Segunda etapa de ranking: puntua pares (consulta, documento) sobre los
 * candidatos fusionados por RRF antes de inyectarlos en el contexto.
 *
 * Reglas:
 *  - `esReal` distingue un cross-encoder verdadero (bge-reranker-base o
 *    similar) de un passthrough de desarrollo. Con esReal=false el score
 *    NO esta calibrado y el servicio lo declara.
 *  - `reordenar` devuelve los mismos documentos recibidos (ni mas ni
 *    menos), cada uno con score en [0.0, 1.0] cuando esReal=true.
 *
 * Strict Policy: Zero Emojis.
 */

/**
 * @typedef {Object} RerankerPort
 * @property {string} id  Etiqueta estable del reranker (telemetria).
 * @property {boolean} esReal  true solo en cross-encoders verdaderos.
 * @property {(consulta: string, documentos: Array<{id: string, texto: string}>) => Promise<Array<{id: string, score: number}>>}
 *   reordenar  Puntua cada documento contra la consulta.
 */

/**
 * Verifica que un objeto cumple el puerto. Lanza TypeError si falta algo.
 */
export function afirmarReranker(reranker) {
  if (!reranker || typeof reranker !== 'object') {
    throw new TypeError('RerankerPort: se esperaba un objeto reranker.');
  }
  if (typeof reranker.id !== 'string' || !reranker.id) {
    throw new TypeError('RerankerPort: id (string) es obligatorio.');
  }
  if (typeof reranker.esReal !== 'boolean') {
    throw new TypeError('RerankerPort: esReal (boolean) es obligatorio.');
  }
  if (typeof reranker.reordenar !== 'function') {
    throw new TypeError('RerankerPort: reordenar (funcion) es obligatorio.');
  }
  return reranker;
}
