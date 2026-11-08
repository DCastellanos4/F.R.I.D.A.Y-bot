/**
 * Puerto de salida: repositorio de memoria del Second Brain.
 *
 * El core guarda, busca, lista y olvida memorias SOLO a traves de esta
 * interfaz; no sabe si detras hay JSON plano (adaptador actual) o una
 * base de datos (mejora futura: SQLite/Postgres con Repository Pattern,
 * que se enchufa aqui sin tocar el dominio).
 *
 * Las firmas reflejan el comportamiento historico para que el adaptador
 * JSON sea un passthrough sin cambio funcional.
 *
 * Strict Policy: Zero Emojis.
 */

/**
 * @typedef {Object} MemoryRepositoryPort
 * @property {(memoria: {sujeto: string, dato: string, categoria?: string, tags?: string[]}) => Object}
 *   guardar  Persiste un recuerdo. Devuelve { ok, memoria } o { ok: false, error }.
 * @property {(consulta: string, opts?: Object) => Array<Object>}
 *   buscar   Busqueda exacta por texto. Devuelve [] si no hay coincidencias.
 * @property {(categoria?: string|null, opts?: Object) => Array<Object>}
 *   listar   Lista memorias, opcionalmente filtradas por categoria.
 * @property {(criterio: string, opts?: Object) => Object}
 *   olvidar  Borra por criterio. Puede devolver { requiereConfirmacion: true, total, mensaje }
 *   para borrados masivos (la confirmacion humana es fuera de banda y NO
 *   forma parte de este puerto).
 */

/**
 * Verifica que un objeto cumple el puerto. Lanza TypeError si falta algo.
 */
export function afirmarMemoryRepository(repo) {
  if (!repo || typeof repo !== 'object') {
    throw new TypeError('MemoryRepositoryPort: se esperaba un objeto repositorio.');
  }
  for (const metodo of ['guardar', 'buscar', 'listar', 'olvidar']) {
    if (typeof repo[metodo] !== 'function') {
      throw new TypeError(`MemoryRepositoryPort: ${metodo} (funcion) es obligatorio.`);
    }
  }
  return repo;
}
