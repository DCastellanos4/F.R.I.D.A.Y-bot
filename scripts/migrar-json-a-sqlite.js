#!/usr/bin/env node
/**
 * Migracion explicita JSON -> SQLite (idempotente, todo-o-nada).
 * No borra ni modifica los JSON de origen.
 *
 * Uso:
 *   DAVIS_SQLITE_PATH=/ruta/jarvis.db node scripts/migrar-json-a-sqlite.js [rutaMemoriasJson] [rutaFinanzasJson]
 */
import path from 'node:path';
import { DATA_DIR } from '../src/config/paths.js';
import { crearPersistenciaSqlite } from '../src/adapters/outbound/persistence/sqlite/persistenciaSqlite.js';
import { importarJsonASqlite } from '../src/adapters/outbound/persistence/sqlite/importExport.js';

const rutaDb = process.env.DAVIS_SQLITE_PATH || path.join(DATA_DIR, 'jarvis.db');
const rutaMemorias = process.argv[2] || path.join(DATA_DIR, 'brain_memory.json');
const rutaFinanzas = process.argv[3] || path.join(DATA_DIR, 'finanzas.json');

const persistencia = crearPersistenciaSqlite({ rutaDb, rutaMemoriasJson: rutaMemorias, rutaFinanzasJson: rutaFinanzas });

if (persistencia.importacion) {
  // La factoria ya importo al crear la base vacia.
  console.log('[migracion] Base creada e importada:', JSON.stringify(persistencia.importacion));
} else {
  const resultado = importarJsonASqlite(persistencia.db, {
    rutaMemorias,
    rutaFinanzas,
    memoryStore: persistencia.memoryStore,
    financeStore: persistencia.financeStore
  });
  console.log('[migracion]', JSON.stringify(resultado));
}
persistencia.cerrar();
