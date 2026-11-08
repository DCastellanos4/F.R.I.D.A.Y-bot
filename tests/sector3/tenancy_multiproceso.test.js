/**
 * Escritura concurrente desde VARIOS PROCESOS (dos pm2 reales) sobre la misma DB
 * WAL, con memoria y finanzas de propietario y dos tenants sinteticos. Exige: sin
 * errores, sin actualizacion perdida (ni en el mismo tenant con dos procesos),
 * y ninguna fila de un tenant en otro.
 *
 * Strict Policy: Zero Emojis.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import Database from 'better-sqlite3';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const U = (p) => JSON.stringify(pathToFileURL(path.join(RAIZ, p)).href);
const N = 25;

const HIJO = `
import { abrirBaseDatos } from ${U('src/adapters/outbound/persistence/sqlite/connection.js')};
import { crearSqliteMemoryStore } from ${U('src/adapters/outbound/persistence/sqlite/sqliteMemoryStore.js')};
import { crearSqliteFinanceStore } from ${U('src/adapters/outbound/persistence/sqlite/sqliteFinanceStore.js')};
import { guardarMemoria } from ${U('src/services/memoryService.js')};
import { registrarGasto } from ${U('src/services/financeService.js')};
const [ruta, t0, tenant, etiqueta] = [process.argv[1], Number(process.argv[2]), process.argv[3], process.argv[4]];
while (Date.now() < t0) { /* barrera */ }
try {
  const db = abrirBaseDatos(ruta);
  const opt = tenant === 'propietario' ? {} : { tenantId: tenant };
  const mem = crearSqliteMemoryStore(db, opt);
  const fin = crearSqliteFinanceStore(db, opt);
  for (let i = 0; i < ${N}; i++) {
    guardarMemoria({ sujeto: etiqueta + '-s' + i, dato: etiqueta + '-d' + i, store: mem });
    registrarGasto({ importe: 1 + i, comercio: etiqueta + '-c' + i, categoria: 'x', fecha: '2026-01-01' }, { store: fin });
  }
  db.close();
  console.log(JSON.stringify({ ok: true }));
} catch (e) { console.log(JSON.stringify({ ok: false, error: String(e && e.message) })); }
`;

function lanzar(ruta, t0, tenant, etiqueta) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, ['--input-type=module', '-e', HIJO, ruta, String(t0), tenant, etiqueta], { cwd: RAIZ, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = ''; let err = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { err += d; });
    p.on('close', (code) => {
      let r = null;
      try { r = JSON.parse(out.trim().split('\n').pop()); } catch { /* sin salida */ }
      resolve({ code, r, err: err.slice(0, 300) });
    });
  });
}

test('4 procesos (2 sobre el propietario, 1 por tenant) escriben a la vez: sin perdida y sin mezcla', async () => {
  const { abrirBaseDatos } = await import('../../src/adapters/outbound/persistence/sqlite/connection.js');
  const { ejecutarMigraciones } = await import('../../src/adapters/outbound/persistence/sqlite/migraciones.js');
  const { crearSqliteTenantRepository } = await import('../../src/adapters/outbound/persistence/sqlite/sqliteTenantRepository.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'davis-mp-w-'));
  const ruta = path.join(dir, 'jarvis.db');
  const db = abrirBaseDatos(ruta);
  ejecutarMigraciones(db);
  const repo = crearSqliteTenantRepository(db);
  repo.registrarTenant({ id: 'sint-a', nombre: 'A' });
  repo.registrarTenant({ id: 'sint-b', nombre: 'B' });
  db.close();

  const t0 = Date.now() + 700;
  const res = await Promise.all([
    lanzar(ruta, t0, 'propietario', 'o1'), lanzar(ruta, t0, 'propietario', 'o2'),
    lanzar(ruta, t0, 'sint-a', 'a'), lanzar(ruta, t0, 'sint-b', 'b')
  ]);
  for (const x of res) {
    assert.equal(x.code, 0, `proceso termino (${x.err})`);
    assert.ok(x.r && x.r.ok, `sin error (${x.r && x.r.error} ${x.err})`);
  }
  const v = new Database(ruta);
  const cuenta = (tabla, tenant, like) => v.prepare(`SELECT COUNT(*) n FROM ${tabla} WHERE tenant_id = ? AND ${tabla === 'memorias' ? 'dato' : 'comercio'} LIKE ?`).get(tenant, like).n;
  assert.equal(cuenta('memorias', 'propietario', 'o1-%'), N, 'sin perdida o1');
  assert.equal(cuenta('memorias', 'propietario', 'o2-%'), N, 'sin perdida o2 (mismo tenant, otro proceso)');
  assert.equal(cuenta('memorias', 'sint-a', 'a-%'), N);
  assert.equal(cuenta('memorias', 'sint-b', 'b-%'), N);
  assert.equal(cuenta('finanzas_gastos', 'propietario', 'o1-%'), N);
  assert.equal(cuenta('finanzas_gastos', 'propietario', 'o2-%'), N);
  assert.equal(cuenta('finanzas_gastos', 'sint-a', 'a-%'), N);
  assert.equal(cuenta('finanzas_gastos', 'sint-b', 'b-%'), N);
  // sin mezcla
  assert.equal(v.prepare("SELECT COUNT(*) n FROM memorias WHERE tenant_id = 'sint-a' AND dato NOT LIKE 'a-%'").get().n, 0);
  assert.equal(v.prepare("SELECT COUNT(*) n FROM memorias WHERE tenant_id = 'sint-b' AND dato NOT LIKE 'b-%'").get().n, 0);
  assert.equal(v.prepare("SELECT COUNT(*) n FROM finanzas_gastos WHERE tenant_id = 'propietario' AND comercio LIKE '%a-c%' AND comercio NOT LIKE 'o%'").get().n, 0);
  assert.equal(v.pragma('integrity_check', { simple: true }), 'ok');
  v.close();
});
