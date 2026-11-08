/**
 * Limites de uso configurables: cuota diaria/mensual de tokens y ritmo por
 * minuto. Sin valores por defecto; el propietario nunca se limita.
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
import { abrirBaseDatos } from '../../src/adapters/outbound/persistence/sqlite/connection.js';
import { ejecutarMigraciones } from '../../src/adapters/outbound/persistence/sqlite/migraciones.js';
import { crearSqliteTenantRepository } from '../../src/adapters/outbound/persistence/sqlite/sqliteTenantRepository.js';
import { crearSqliteUsageStore } from '../../src/adapters/outbound/persistence/sqlite/sqliteUsageStore.js';
import { crearSqliteLimitesStore } from '../../src/adapters/outbound/persistence/sqlite/sqliteLimitesStore.js';
import { medirUso } from '../../src/services/usageLedgerService.js';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const ahora = new Date('2026-03-10T10:00:30');

function montar(ruta = ':memory:') {
  const db = ruta === ':memory:' ? new Database(':memory:') : abrirBaseDatos(ruta);
  db.pragma('foreign_keys = ON');
  ejecutarMigraciones(db);
  const repo = crearSqliteTenantRepository(db);
  for (const id of ['sint-a', 'sint-b']) { try { repo.registrarTenant({ id, nombre: id }); } catch { /* ya existe */ } }
  return { db, uso: crearSqliteUsageStore(db), lim: crearSqliteLimitesStore(db) };
}
const gasta = (uso, tenantId, tokens, cuando = ahora) => medirUso({ tenantId, modelo: 'm', usage: { prompt_tokens: tokens, completion_tokens: 0 }, store: uso, ahora: cuando });

test('sin configurar NO hay limites: ningun valor por defecto (ni tenants ni propietario)', () => {
  const { db, uso, lim } = montar();
  assert.equal(db.prepare('SELECT COUNT(*) n FROM tenant_limites').get().n, 0);
  gasta(uso, 'sint-a', 10_000_000);
  for (let i = 0; i < 500; i++) assert.equal(lim.autorizar({ tenantId: 'sint-a', ahora }).permitido, true);
  assert.equal(lim.autorizar({ tenantId: 'propietario', ahora }).motivo, 'propietario');
  assert.equal(lim.leer('sint-a'), null);
  db.close();
});

test('el propietario no admite limites y nunca se deniega, aunque gaste mucho', () => {
  const { db, uso, lim } = montar();
  assert.throws(() => lim.configurar('propietario', { tokensDia: 1 }), /propietario/);
  gasta(uso, 'propietario', 99_999_999);
  assert.equal(lim.autorizar({ ahora }).permitido, true);
  db.close();
});

test('cuota diaria: limite exacto (usado >= limite deniega), por tenant y por dia', () => {
  const { db, uso, lim } = montar();
  lim.configurar('sint-a', { tokensDia: 100 });
  gasta(uso, 'sint-a', 99);
  assert.equal(lim.autorizar({ tenantId: 'sint-a', ahora }).permitido, true, '99 < 100');
  gasta(uso, 'sint-a', 1);
  const d = lim.autorizar({ tenantId: 'sint-a', ahora });
  assert.equal(d.permitido, false); assert.equal(d.motivo, 'cuota_diaria'); assert.equal(d.usado, 100);
  assert.equal(lim.autorizar({ tenantId: 'sint-b', ahora }).permitido, true, 'otro tenant intacto');
  assert.equal(lim.autorizar({ tenantId: 'sint-a', ahora: new Date('2026-03-11T00:00:05') }).permitido, true, 'dia siguiente: cuota nueva');
  db.close();
});

test('cuota mensual: suma del mes, no del mes anterior ni del siguiente', () => {
  const { db, uso, lim } = montar();
  lim.configurar('sint-a', { tokensMes: 300 });
  gasta(uso, 'sint-a', 150, new Date('2026-03-02T09:00:00'));
  gasta(uso, 'sint-a', 149, new Date('2026-03-09T09:00:00'));
  gasta(uso, 'sint-a', 5000, new Date('2026-02-28T09:00:00'));
  assert.equal(lim.autorizar({ tenantId: 'sint-a', ahora }).permitido, true, '299 < 300 (febrero no cuenta)');
  gasta(uso, 'sint-a', 1, new Date('2026-03-10T08:00:00'));
  const d = lim.autorizar({ tenantId: 'sint-a', ahora });
  assert.equal(d.motivo, 'cuota_mensual');
  assert.equal(lim.autorizar({ tenantId: 'sint-a', ahora: new Date('2026-04-01T09:00:00') }).permitido, true, 'abril: cuota nueva');
  db.close();
});

test('ritmo por minuto: exactamente N por ventana, las denegadas no consumen, la ventana siguiente reabre', () => {
  const { db, lim } = montar();
  lim.configurar('sint-a', { peticionesMinuto: 3 });
  const r = [1, 2, 3, 4, 5].map(() => lim.autorizar({ tenantId: 'sint-a', ahora }));
  assert.deepEqual(r.map((x) => x.permitido), [true, true, true, false, false]);
  assert.equal(r[3].motivo, 'limite_peticiones');
  assert.equal(r[3].reintentarEnMs, 30_000);
  assert.equal(db.prepare("SELECT n FROM tenant_peticiones WHERE tenant_id='sint-a'").get().n, 3);
  assert.equal(lim.autorizar({ tenantId: 'sint-a', ahora: new Date('2026-03-10T10:01:00') }).permitido, true);
  db.close();
});

test('una peticion denegada por cuota no consume ritmo', () => {
  const { db, uso, lim } = montar();
  lim.configurar('sint-a', { tokensDia: 10, peticionesMinuto: 5 });
  gasta(uso, 'sint-a', 10);
  for (let i = 0; i < 10; i++) assert.equal(lim.autorizar({ tenantId: 'sint-a', ahora }).motivo, 'cuota_diaria');
  assert.equal(db.prepare("SELECT COUNT(*) n FROM tenant_peticiones").get().n, 0);
  db.close();
});

test('validacion: solo enteros positivos o null; null quita el limite', () => {
  const { db, lim } = montar();
  for (const malo of [0, -1, 1.5, '5', NaN]) assert.throws(() => lim.configurar('sint-a', { tokensDia: malo }), /invalido/);
  assert.throws(() => lim.configurar('../x', { tokensDia: 1 }));
  lim.configurar('sint-a', { tokensDia: 5 });
  lim.configurar('sint-a', { tokensDia: null });
  assert.equal(lim.autorizar({ tenantId: 'sint-a', ahora }).motivo, 'sin_limites');
  db.close();
});

test('persistencia: configuracion, uso y ventana sobreviven a cerrar y reabrir la base', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'davis-lim-'));
  const ruta = path.join(dir, 'jarvis.db');
  let m = montar(ruta);
  m.lim.configurar('sint-a', { tokensDia: 50, peticionesMinuto: 2 });
  gasta(m.uso, 'sint-a', 50);
  m.db.close();
  m = montar(ruta);
  assert.deepEqual(m.lim.leer('sint-a'), { tokensDia: 50, tokensMes: null, peticionesMinuto: 2 });
  assert.equal(m.lim.autorizar({ tenantId: 'sint-a', ahora }).motivo, 'cuota_diaria');
  m.lim.configurar('sint-a', { peticionesMinuto: 2 });
  assert.equal(m.lim.autorizar({ tenantId: 'sint-a', ahora }).permitido, true);
  assert.equal(m.lim.autorizar({ tenantId: 'sint-a', ahora }).permitido, true);
  m.db.close();
  m = montar(ruta);
  assert.equal(m.lim.autorizar({ tenantId: 'sint-a', ahora }).motivo, 'limite_peticiones', 'la ventana persiste');
  m.db.close();
});

const U = (p) => JSON.stringify(pathToFileURL(path.join(RAIZ, p)).href);
const HIJO = `
import { abrirBaseDatos } from ${U('src/adapters/outbound/persistence/sqlite/connection.js')};
import { crearSqliteLimitesStore } from ${U('src/adapters/outbound/persistence/sqlite/sqliteLimitesStore.js')};
const [ruta, t0] = [process.argv[1], Number(process.argv[2])];
while (Date.now() < t0) {}
try {
  const db = abrirBaseDatos(ruta);
  const lim = crearSqliteLimitesStore(db);
  let ok = 0;
  for (let i = 0; i < 20; i++) if (lim.autorizar({ tenantId: 'sint-a', ahora: new Date('2026-03-10T10:00:30') }).permitido) ok++;
  db.close();
  console.log(JSON.stringify({ ok: true, permitidas: ok }));
} catch (e) { console.log(JSON.stringify({ ok: false, error: String(e && e.message) })); }
`;
function lanzar(ruta, t0) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, ['--input-type=module', '-e', HIJO, ruta, String(t0)], { cwd: RAIZ, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = ''; let err = '';
    p.stdout.on('data', (d) => { out += d; }); p.stderr.on('data', (d) => { err += d; });
    p.on('close', (code) => { let r = null; try { r = JSON.parse(out.trim().split('\n').pop()); } catch { /* */ } resolve({ code, r, err: err.slice(0, 300) }); });
  });
}

test('concurrencia multiproceso: 4 procesos x 20 intentos con limite 30 => EXACTAMENTE 30 permitidas', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'davis-lim-mp-'));
  const ruta = path.join(dir, 'jarvis.db');
  const m = montar(ruta);
  m.lim.configurar('sint-a', { peticionesMinuto: 30 });
  m.db.close();
  const t0 = Date.now() + 700;
  const res = await Promise.all([lanzar(ruta, t0), lanzar(ruta, t0), lanzar(ruta, t0), lanzar(ruta, t0)]);
  for (const x of res) { assert.equal(x.code, 0, x.err); assert.ok(x.r && x.r.ok, `${x.r && x.r.error} ${x.err}`); }
  assert.equal(res.reduce((a, x) => a + x.r.permitidas, 0), 30);
  const v = new Database(ruta);
  assert.equal(v.prepare("SELECT n FROM tenant_peticiones WHERE tenant_id='sint-a'").get().n, 30);
  v.close();
});

test('agente: controlUso inyectado deniega a un tenant ANTES del LLM; el propietario no se consulta; sin controlador no cambia nada; error del controlador = denegado', async () => {
  const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'davis-lim-ag-'));
  process.env.DAVIS_DATA_DIR = DIR;
  const { consultarJarvisEnAmbito } = await import('../../src/core/jarvisAgent.js');
  let llamadasLlm = 0;
  const chatCompletion = async () => { llamadasLlm++; return { model: 'stub', message: { role: 'assistant', content: 'ok' } }; };
  const r1 = await consultarJarvisEnAmbito('hola', [], { tenantId: 'sint-a', chatId: 'c', chatCompletion, controlUso: { autorizar: () => ({ permitido: false, motivo: 'cuota_diaria' }) } });
  assert.match(String(r1), /Limite de uso/); assert.equal(llamadasLlm, 0);
  const r2 = await consultarJarvisEnAmbito('hola', [], { tenantId: 'sint-a', chatId: 'c', chatCompletion, controlUso: { autorizar: () => { throw new Error('x'); } } });
  assert.match(String(r2), /Limite de uso/); assert.equal(llamadasLlm, 0, 'fail-closed ante error');
  let consultas = 0;
  await consultarJarvisEnAmbito('hola', [], { chatId: 'c', chatCompletion, controlUso: { autorizar: () => { consultas++; return { permitido: false }; } } });
  assert.equal(consultas, 0, 'el propietario no pasa por el controlador'); assert.ok(llamadasLlm >= 1);
  const antes = llamadasLlm;
  await consultarJarvisEnAmbito('hola', [], { tenantId: 'sint-a', chatId: 'c', chatCompletion, controlUso: { autorizar: () => ({ permitido: true }) } });
  assert.ok(llamadasLlm > antes, 'permitido: llega al LLM');
});

test('E2E agente + controlador SQLite + libro real: usage del modelo agota cuota, siguiente peticion no llama al LLM', async () => {
  const { consultarJarvisEnAmbito } = await import('../../src/core/jarvisAgent.js');
  const { registrarStoreUsoPorDefecto } = await import('../../src/services/usageLedgerService.js');
  const { db, uso, lim } = montar();
  lim.configurar('sint-a', { tokensDia: 10 });
  registrarStoreUsoPorDefecto(uso);
  let llamadas = 0;
  const chatCompletion = async () => { llamadas++; return { model: 'stub', usage: { prompt_tokens: 10, completion_tokens: 1 }, message: { role: 'assistant', content: 'ok' } }; };
  try {
    const opts = { tenantId: 'sint-a', chatId: 'quota-e2e', chatCompletion, controlUso: lim };
    await consultarJarvisEnAmbito('hola', [], opts);
    assert.ok(llamadas >= 1);
    const antes = llamadas;
    assert.ok(uso.rango('sint-a', '2000-01-01', '2100-12-31').entrada >= 10);
    const r = await consultarJarvisEnAmbito('hola otra vez', [], opts);
    assert.match(String(r), /Limite de uso/);
    assert.equal(llamadas, antes);
  } finally { registrarStoreUsoPorDefecto(null); db.close(); }
});
