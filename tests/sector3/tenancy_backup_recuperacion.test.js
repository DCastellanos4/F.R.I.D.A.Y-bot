/**
 * Inventario REAL de lo que cubre el backup cifrado actual y recuperacion
 * sintetica aislada (directorios temporales, clave sintetica; no toca cifrado
 * ni politica productiva). Nada de esto es el backup de produccion.
 *
 * Strict Policy: Zero Emojis.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { createEncryptedBackup, restoreEncryptedBackup, verifyBackupContainer } from '../../src/system/backupService.js';
import { abrirBaseDatos } from '../../src/adapters/outbound/persistence/sqlite/connection.js';
import { ejecutarMigraciones } from '../../src/adapters/outbound/persistence/sqlite/migraciones.js';
import { crearSqliteTenantRepository } from '../../src/adapters/outbound/persistence/sqlite/sqliteTenantRepository.js';
import { crearSqliteMemoryStore } from '../../src/adapters/outbound/persistence/sqlite/sqliteMemoryStore.js';
import { crearSqliteFinanceStore } from '../../src/adapters/outbound/persistence/sqlite/sqliteFinanceStore.js';
import { crearSqliteUsageStore } from '../../src/adapters/outbound/persistence/sqlite/sqliteUsageStore.js';
import { crearSqliteLimitesStore } from '../../src/adapters/outbound/persistence/sqlite/sqliteLimitesStore.js';
import { exportarSqliteAJson, importarJsonASqlite } from '../../src/adapters/outbound/persistence/sqlite/importExport.js';

const PASS = 'clave-sintetica-solo-test';
const mem = (id, dato) => ({ id, sujeto: 's' + id, dato, categoria: 'general', tags: [], fechaRegistro: '2026-01-01T00:00:00.000Z' });

function montarDatos() {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'davis-bk-'));
  const dataDir = path.join(raiz, 'data');
  fs.mkdirSync(path.join(dataDir, 'tenants', 'sint-a'), { recursive: true });
  fs.writeFileSync(path.join(dataDir, 'tenants', 'sint-a', 'brain_memory.json'), JSON.stringify([mem('a1', 'DATO-TENANT-A')]));
  fs.writeFileSync(path.join(dataDir, 'brain_memory.json'), JSON.stringify([mem('o1', 'DATO-OWNER')]));
  const db = abrirBaseDatos(path.join(dataDir, 'jarvis.db'));
  ejecutarMigraciones(db);
  const repo = crearSqliteTenantRepository(db);
  repo.registrarTenant({ id: 'sint-a', nombre: 'A' });
  crearSqliteMemoryStore(db).guardar([mem('o1', 'DB-OWNER')]);
  crearSqliteMemoryStore(db, { tenantId: 'sint-a' }).guardar([mem('a1', 'DB-TENANT-A')]);
  crearSqliteFinanceStore(db, { tenantId: 'sint-a' }).guardar({ gastos: [{ id: 'g1', importe: 3, comercio: 'x', categoria: 'c', fecha: '2026-01-01', origen: 'manual', creadoEn: '2026-01-01' }], suscripciones: [], presupuestos: { c: 9 }, borradores: [], config: {} });
  crearSqliteUsageStore(db).registrar({ tenantId: 'sint-a', dia: '2026-03-10', modelo: 'm', entrada: 7, salida: 1 });
  crearSqliteLimitesStore(db).configurar('sint-a', { tokensDia: 100 });
  return { raiz, dataDir, db };
}

const conteos = (db) => Object.fromEntries(['memorias', 'finanzas_gastos', 'finanzas_presupuestos', 'uso_tokens', 'tenant_limites', 'tenants', 'identidades'].map((t) => [t, db.prepare(`SELECT COUNT(*) n FROM ${t}`).get().n]));

test('backup actual: incluye data/tenants/<id>/ y la base SQLite completa (tenants, uso, limites); restaura integra y aislada', async () => {
  const { raiz, dataDir, db } = montarDatos();
  const backupDir = path.join(raiz, 'bk');
  const antes = conteos(db);
  // La conexion sigue ABIERTA (WAL con paginas sin checkpoint): como un proceso vivo.
  const r = await createEncryptedBackup({ passphrase: PASS, rootDir: raiz, dataDir, backupDir, configFiles: [] });
  const v = await verifyBackupContainer(r.backupPath, PASS);
  const ficheros = v.files;
  assert.ok(ficheros.includes('data/tenants/sint-a/brain_memory.json'), 'datos de tenant incluidos (no se excluyen por defecto)');
  assert.ok(ficheros.includes('data/jarvis.db'), 'la base SQLite se incluye como fichero');

  const destino = path.join(raiz, 'restaurado');
  const res = await restoreEncryptedBackup(r.backupPath, PASS, destino);
  assert.equal(res.success, true);
  const tenantJson = JSON.parse(fs.readFileSync(path.join(destino, 'data', 'tenants', 'sint-a', 'brain_memory.json'), 'utf-8'));
  assert.equal(tenantJson[0].dato, 'DATO-TENANT-A');
  const rdb = new Database(path.join(destino, 'data', 'jarvis.db'));
  assert.equal(rdb.pragma('integrity_check', { simple: true }), 'ok');
  assert.deepEqual(conteos(rdb), antes, 'la base restaurada tiene TODO: propietario, tenants, uso y limites');
  assert.equal(rdb.prepare("SELECT dato FROM memorias WHERE tenant_id='sint-a'").get().dato, 'DB-TENANT-A');
  assert.equal(rdb.prepare("SELECT dato FROM memorias WHERE tenant_id='propietario'").get().dato, 'DB-OWNER');
  assert.notEqual(path.resolve(destino), path.resolve(raiz, 'data'), 'restauracion aislada: no pisa el original');
  rdb.close(); db.close();
});

test('exportacion JSON actual: solo PROPIETARIO (memorias, finanzas, usuarios); NO incluye tenants, uso ni limites, y no los mezcla', () => {
  const { raiz, db } = montarDatos();
  const dir = path.join(raiz, 'export');
  const r = exportarSqliteAJson(db, { dirDestino: dir, memoryStore: crearSqliteMemoryStore(db), financeStore: crearSqliteFinanceStore(db) });
  const todo = fs.readdirSync(dir).map((f) => fs.readFileSync(path.join(dir, f), 'utf-8')).join('\n');
  assert.ok(todo.includes('DB-OWNER'));
  assert.ok(!todo.includes('DB-TENANT-A'), 'nada de tenants en el JSON del propietario');
  assert.equal(r.manifiesto.conteos.memorias, 1);
  assert.ok(!('uso_tokens' in r.manifiesto.conteos) && !('tenant_limites' in r.manifiesto.conteos), 'uso y limites no estan en la exportacion JSON (solo en el snapshot de la base)');
  db.close();
});

test('importacion JSON del propietario sobre una base con tenants: fail-closed solo ante datos del propietario sin origen; los tenants se conservan', () => {
  const { raiz, db } = montarDatos();
  // La base ya tiene datos del propietario sin marca de origen: no se importa encima.
  const r = importarJsonASqlite(db, { rutaMemorias: path.join(raiz, 'data', 'brain_memory.json'), memoryStore: crearSqliteMemoryStore(db), financeStore: crearSqliteFinanceStore(db) });
  assert.equal(r.ok, false);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM memorias WHERE tenant_id='sint-a'").get().n, 1, 'tenant intacto');
  assert.equal(db.prepare("SELECT dato FROM memorias WHERE tenant_id='propietario'").get().dato, 'DB-OWNER', 'propietario intacto');
  db.close();
});
