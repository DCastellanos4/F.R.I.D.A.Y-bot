#!/usr/bin/env node
/**
 * Recuperacion SQLite -> JSON: vuelca el estado ACTUAL de la base
 * (incluidas las escrituras posteriores a la migracion) a un directorio
 * nuevo con manifiesto de integridad (conteos + sha256).
 *
 * Procedimiento de vuelta a JSON:
 *   1. Para el bot (pm2 stop).
 *   2. Ejecuta este script.
 *   3. Verifica el manifiesto (conteos razonables, hashes presentes) y
 *      revisa los JSON exportados.
 *   4. Copia los JSON verificados sobre los activos (data/brain_memory.json
 *      y data/finanzas.json), conservando copia de los anteriores.
 *   5. DAVIS_PERSISTENCE=json y arranca el bot.
 *
 * Uso:
 *   DAVIS_SQLITE_PATH=/ruta/jarvis.db node scripts/exportar-sqlite-a-json.js [dirDestino]
 */
import path from 'node:path';
import { DATA_DIR } from '../src/config/paths.js';
import { abrirBaseDatos } from '../src/adapters/outbound/persistence/sqlite/connection.js';
import { ejecutarMigraciones } from '../src/adapters/outbound/persistence/sqlite/migraciones.js';
import { crearSqliteMemoryStore } from '../src/adapters/outbound/persistence/sqlite/sqliteMemoryStore.js';
import { crearSqliteFinanceStore } from '../src/adapters/outbound/persistence/sqlite/sqliteFinanceStore.js';
import { exportarSqliteAJson } from '../src/adapters/outbound/persistence/sqlite/importExport.js';

const rutaDb = process.env.DAVIS_SQLITE_PATH || path.join(DATA_DIR, 'jarvis.db');
const marca = new Date().toISOString().replace(/[:.]/g, '-');
const dirDestino = process.argv[2] || path.join(DATA_DIR, 'export-recuperacion', marca);

const db = abrirBaseDatos(rutaDb);
ejecutarMigraciones(db);
const memoryStore = crearSqliteMemoryStore(db);
const financeStore = crearSqliteFinanceStore(db);

const resultado = exportarSqliteAJson(db, { dirDestino, memoryStore, financeStore });
console.log('[exportacion]', JSON.stringify(resultado, null, 2));
db.close();
