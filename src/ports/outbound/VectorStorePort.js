/**
 * Puerto de salida: almacen vectorial denso con particion por tenant (RF-03).
 *
 * El nucleo RAG indexa y consulta vectores densos SOLO a traves de esta
 * interfaz; no sabe si detras hay Qdrant, pgvector o un almacen de
 * desarrollo en memoria.
 *
 * Reglas:
 *  - TODA operacion exige tenantId valido: no existe consulta sin tenant.
 *    La particion fisica (coleccion, tabla, espacio de nombres) es
 *    decision del adaptador, pero el aislamiento es obligatorio.
 *  - `esIndustrial` distingue motores que cumplen RF-03 (pgvector/Qdrant
 *    con persistencia en disco) de almacenes de desarrollo. Un almacen
 *    con esIndustrial=false NUNCA certifica el requisito; sirve para
 *    desarrollar y probar sin infraestructura.
 *  - Los ids de documento son cadenas opacas del llamante; el adaptador
 *    resuelve cualquier restriccion interna de clave.
 *
 * Strict Policy: Zero Emojis.
 */

/**
 * @typedef {Object} VectorStorePort
 * @property {string} motor  Etiqueta del motor ('qdrant', 'dev-local', ...).
 * @property {boolean} esIndustrial  true solo si el motor cumple RF-03 (pgvector/Qdrant persistente).
 * @property {(tenantId: string, docs: Array<{id: string, texto: string, vector: number[], payload?: Object}>) => Promise<{ok: boolean, total: number}>}
 *   indexar  Inserta o sustituye documentos (upsert por id dentro del tenant).
 * @property {(tenantId: string, vector: number[], topK: number) => Promise<Array<{id: string, score: number, texto: string, payload: Object}>>}
 *   buscarDenso  Devuelve hasta topK candidatos ordenados por similitud (mejor primero).
 * @property {(tenantId: string, ids: string[]) => Promise<{ok: boolean, total: number}>}
 *   borrar  Elimina documentos del tenant; ids inexistentes no son error.
 * @property {(tenantId: string) => Promise<number>}
 *   contar  Numero de documentos indexados del tenant.
 */

/**
 * Verifica que un objeto cumple el puerto. Lanza TypeError si falta algo.
 */
export function afirmarVectorStore(almacen) {
  if (!almacen || typeof almacen !== 'object') {
    throw new TypeError('VectorStorePort: se esperaba un objeto almacen.');
  }
  if (typeof almacen.motor !== 'string' || !almacen.motor) {
    throw new TypeError('VectorStorePort: motor (string) es obligatorio.');
  }
  if (typeof almacen.esIndustrial !== 'boolean') {
    throw new TypeError('VectorStorePort: esIndustrial (boolean) es obligatorio.');
  }
  for (const metodo of ['indexar', 'buscarDenso', 'borrar', 'contar']) {
    if (typeof almacen[metodo] !== 'function') {
      throw new TypeError(`VectorStorePort: ${metodo} (funcion) es obligatorio.`);
    }
  }
  return almacen;
}
