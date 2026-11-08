/**
 * Factoria de la persistencia SQLite: abre la base, aplica migraciones
 * pendientes, verifica que el estado es consistente y, si la base esta
 * vacia, importa los JSON historicos (sin borrarlos).
 *
 * Fallo cerrado: si la base tiene datos sin marca de origen (estado
 * inconsistente, p.ej. una importacion interrumpida), lanza error en
 * vez de servir datos dudosos o caer en silencio al JSON, que podria
 * estar obsoleto.
 *
 * Strict Policy: Zero Emojis.
 */
import crypto from 'node:crypto';
import { abrirBaseDatos } from './connection.js';
import { ejecutarMigraciones } from './migraciones.js';
import { crearSqliteMemoryStore } from './sqliteMemoryStore.js';
import { crearSqliteFinanceStore } from './sqliteFinanceStore.js';
import { crearSqliteUserRepository } from './sqliteUserRepository.js';
import { importarJsonASqlite, comprobarEstadoConsistente } from './importExport.js';

export function crearPersistenciaSqlite({ rutaDb, rutaMemoriasJson = null, rutaFinanzasJson = null, rutaUsuariosJson = null } = {}) {
  if (!rutaDb) throw new Error('crearPersistenciaSqlite requiere rutaDb.');
  const db = abrirBaseDatos(rutaDb);
  ejecutarMigraciones(db);

  const memoryStore = crearSqliteMemoryStore(db);
  const financeStore = crearSqliteFinanceStore(db);
  const userRepository = crearSqliteUserRepository(db);

  const problema = comprobarEstadoConsistente(db);
  if (problema) {
    db.close();
    throw new Error(`Persistencia SQLite en estado inconsistente; no se activa. ${problema}`);
  }

  let importacion = null;
  const vacia = db.prepare("SELECT valor FROM meta WHERE clave = 'origen'").get() === undefined;
  if (vacia) {
    importacion = importarJsonASqlite(db, {
      rutaMemorias: rutaMemoriasJson,
      rutaFinanzas: rutaFinanzasJson,
      rutaUsuarios: rutaUsuariosJson,
      memoryStore,
      financeStore
    });
    if (!importacion.ok) {
      db.close();
      throw new Error(`Persistencia SQLite en estado inconsistente; no se activa. ${importacion.error}`);
    }
  }

  // Fuente de memorias para el indice semantico (RAG): lectura y firma
  // desde la base, para que la frescura del indice siga funcionando sin
  // el fichero JSON. Devuelve los registros TAL CUAL estan almacenados
  // (los cifrados incluidos); el filtro de documentos sensibles del
  // servicio semantico los excluye como siempre.
  const fuenteSemantica = Object.freeze({
    leerMemorias: () => memoryStore.leer(),
    firma: () => {
      const filas = memoryStore.leer();
      return crypto.createHash('sha256').update(JSON.stringify(filas)).digest('hex');
    }
  });

  return Object.freeze({
    db,
    rutaDb,
    memoryStore,
    financeStore,
    userRepository,
    fuenteSemantica,
    importacion,
    cerrar: () => db.close()
  });
}
