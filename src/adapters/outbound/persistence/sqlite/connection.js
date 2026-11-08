/**
 * Conexion SQLite embebida (better-sqlite3, dependencia nativa con
 * prebuilds; rango fijado a 12.x por compatibilidad con Node 20 en el
 * VPS aarch64).
 *
 * - journal_mode WAL: lectores concurrentes con un unico escritor. Solo
 *   es WAL real con base de datos en archivo; ':memory:' no lo es.
 * - foreign_keys ON: integridad referencial efectiva en cada conexion
 *   (SQLite la desactiva por defecto).
 * - busy_timeout: un segundo escritor espera a que la transaccion en
 *   curso termine en vez de fallar con SQLITE_BUSY.
 *
 * Strict Policy: Zero Emojis.
 */
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

export function abrirBaseDatos(rutaDb) {
  if (!rutaDb || typeof rutaDb !== 'string') {
    throw new Error('abrirBaseDatos requiere una ruta de base de datos valida.');
  }
  if (rutaDb !== ':memory:') {
    fs.mkdirSync(path.dirname(rutaDb), { recursive: true });
  }
  const db = new Database(rutaDb);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  return db;
}
