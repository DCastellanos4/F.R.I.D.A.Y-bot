/**
 * Adaptador de salida: MemoryRepositoryPort sobre los ficheros JSON
 * historicos del Second Brain (memoryService).
 *
 * Passthrough deliberado: conserva el comportamiento exacto actual. La
 * mejora de persistencia (SQLite/Postgres) se enchufa aqui implementando
 * el mismo puerto, sin tocar el core ni los tests de comportamiento.
 *
 * Strict Policy: Zero Emojis.
 */
import {
  guardarMemoria,
  buscarMemorias,
  listarMemorias,
  olvidarMemoria
} from '../../../services/memoryService.js';
import { afirmarMemoryRepository } from '../../../ports/outbound/MemoryRepositoryPort.js';

export function crearJsonMemoryRepository() {
  return afirmarMemoryRepository(Object.freeze({
    guardar: (memoria, opts = {}) => guardarMemoria(opts.rutaArchivo ? { ...memoria, rutaArchivo: opts.rutaArchivo } : memoria),
    buscar: (consulta, opts = {}) => buscarMemorias(consulta, opts),
    listar: (categoria = null, opts = {}) => listarMemorias(categoria, opts),
    olvidar: (criterio, opts = {}) => olvidarMemoria(criterio, opts)
    // buscar y listar ya aceptan opts con rutaArchivo; guardar y olvidar
    // lo propagan igual para que la ruta sea decision del repositorio.
  }));
}
