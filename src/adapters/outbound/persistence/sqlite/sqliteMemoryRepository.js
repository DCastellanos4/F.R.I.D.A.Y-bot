/**
 * Adaptador de salida: MemoryRepositoryPort sobre SQLite.
 *
 * Reutiliza la logica de dominio de memoryService (dedup de hechos,
 * expansion de tags, cifrado fail-closed, confirmacion de borrado
 * masivo) pasandole el store SQLite por la costura de deps: el
 * comportamiento observable es el del almacen JSON y la persistencia
 * es transaccional. opts.rutaArchivo se reinterpreta como ruta de base
 * de datos para aislamiento de pruebas (una por ruta, cacheada).
 *
 * Strict Policy: Zero Emojis.
 */
import {
  guardarMemoria,
  buscarMemorias,
  listarMemorias,
  olvidarMemoria
} from '../../../../services/memoryService.js';
import { afirmarMemoryRepository } from '../../../../ports/outbound/MemoryRepositoryPort.js';

export function crearSqliteMemoryRepository({ memoryStore, crearStoreParaRuta = null } = {}) {
  if (!memoryStore) throw new Error('crearSqliteMemoryRepository requiere memoryStore.');
  const cachePorRuta = new Map();
  const storePara = (opts = {}) => {
    if (!opts.rutaArchivo || typeof crearStoreParaRuta !== 'function') return memoryStore;
    if (!cachePorRuta.has(opts.rutaArchivo)) {
      cachePorRuta.set(opts.rutaArchivo, crearStoreParaRuta(opts.rutaArchivo));
    }
    return cachePorRuta.get(opts.rutaArchivo);
  };

  return afirmarMemoryRepository(Object.freeze({
    guardar: (memoria, opts = {}) =>
      guardarMemoria({ ...memoria, store: storePara(opts) }),
    buscar: (consulta, opts = {}) =>
      buscarMemorias(consulta, { ...opts, store: storePara(opts) }),
    listar: (categoria = null, opts = {}) =>
      listarMemorias(categoria, { ...opts, store: storePara(opts) }),
    olvidar: (criterio, opts = {}) =>
      olvidarMemoria(criterio, { ...opts, store: storePara(opts) })
  }));
}
