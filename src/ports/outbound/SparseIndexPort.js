/**
 * Puerto de salida: indice disperso BM25 con particion por tenant (RF-03).
 *
 * Canal complementario del almacen denso: recuperacion por terminos
 * exactos (IDs, codigos, IPs, nombres propios) con ranking BM25 real.
 *
 * Reglas:
 *  - TODA operacion exige tenantId valido: no existe consulta sin tenant.
 *  - `buscar` devuelve candidatos ordenados por relevancia BM25 (mejor
 *    primero). La puntuacion absoluta depende del motor y SOLO se usa
 *    para ordenar dentro del canal; la fusion la hace RRF por rangos.
 *  - `esIndustrial` indica si el motor es un ranking BM25 real (no una
 *    coincidencia de subcadena). SQLite FTS5 bm25() SI es BM25 real.
 *
 * Strict Policy: Zero Emojis.
 */

/**
 * @typedef {Object} SparseIndexPort
 * @property {string} motor  Etiqueta del motor ('sqlite-fts5', ...).
 * @property {boolean} esIndustrial  true si el ranking es BM25 real.
 * @property {(tenantId: string, docs: Array<{id: string, texto: string}>) => Promise<{ok: boolean, total: number}>}
 *   indexar  Inserta o sustituye documentos (upsert por id dentro del tenant).
 * @property {(tenantId: string, consulta: string, topK: number) => Promise<Array<{id: string, scoreBm25: number}>>}
 *   buscar  Hasta topK candidatos ordenados por BM25 (mejor primero).
 * @property {(tenantId: string, ids: string[]) => Promise<{ok: boolean, total: number}>}
 *   borrar  Elimina documentos del tenant; ids inexistentes no son error.
 * @property {(tenantId: string) => Promise<number>}
 *   contar  Numero de documentos indexados del tenant.
 */

/**
 * Verifica que un objeto cumple el puerto. Lanza TypeError si falta algo.
 */
export function afirmarSparseIndex(indice) {
  if (!indice || typeof indice !== 'object') {
    throw new TypeError('SparseIndexPort: se esperaba un objeto indice.');
  }
  if (typeof indice.motor !== 'string' || !indice.motor) {
    throw new TypeError('SparseIndexPort: motor (string) es obligatorio.');
  }
  if (typeof indice.esIndustrial !== 'boolean') {
    throw new TypeError('SparseIndexPort: esIndustrial (boolean) es obligatorio.');
  }
  for (const metodo of ['indexar', 'buscar', 'borrar', 'contar']) {
    if (typeof indice[metodo] !== 'function') {
      throw new TypeError(`SparseIndexPort: ${metodo} (funcion) es obligatorio.`);
    }
  }
  return indice;
}
