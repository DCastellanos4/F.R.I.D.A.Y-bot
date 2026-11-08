/**
 * Migraciones con VARIOS PROCESOS sobre la misma DB WAL (dos procesos pm2).
 * Procesos Node reales, arrancando a la vez (barrera por reloj), partiendo de
 * un esquema v1 con datos. Exige: todos arrancan sin error, la migracion 002 se
 * aplica exactamente UNA vez en total, no se pierde ningun dato y la DB queda integra.
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
import { MIGRACIONES } from '../../src/adapters/outbound/persistence/sqlite/migraciones.js';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const MIG = pathToFileURL(path.join(RAIZ, 'src/adapters/outbound/persistence/sqlite/migraciones.js')).href;
const CON = pathToFileURL(path.join(RAIZ, 'src/adapters/outbound/persistence/sqlite/connection.js')).href;

const HIJO = `
import { abrirBaseDatos } from ${JSON.stringify(CON)};
import { ejecutarMigraciones } from ${JSON.stringify(MIG)};
const [ruta, t0] = [process.argv[1], Number(process.argv[2])];
while (Date.now() < t0) { /* barrera: todos entran a la vez */ }
try {
  const db = abrirBaseDatos(ruta);
  const r = ejecutarMigraciones(db);
  db.close();
  console.log(JSON.stringify({ ok: true, aplicadasAhora: r.aplicadasAhora }));
} catch (e) {
  console.log(JSON.stringify({ ok: false, error: String(e && e.message) }));
}
`;

function crearDbV1(ruta) {
  const db = new Database(ruta);
  db.pragma('journal_mode = WAL');
  const m1 = MIGRACIONES.find((m) => m.version === 1);
  db.exec('CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, nombre TEXT NOT NULL, aplicada_en TEXT NOT NULL)');
  db.exec(m1.sql);
  db.prepare('INSERT INTO schema_migrations VALUES (1, ?, ?)').run(m1.nombre, 'x');
  const ins = db.prepare("INSERT INTO memorias (id, sujeto, dato, categoria, tags, fecha_registro) VALUES (?, 's', ?, 'general', '[]', '2026-01-01')");
  for (let i = 0; i < 300; i++) ins.run(`m${i}`, `dato-${i}`);
  db.prepare("INSERT INTO finanzas_presupuestos (categoria, limite) VALUES ('cafe', 50), ('ocio', 80)").run();
  db.prepare("INSERT INTO finanzas_config (clave, valor) VALUES ('a', '1'), ('b', '2')").run();
  db.close();
}

function lanzar(ruta, t0) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, ['--input-type=module', '-e', HIJO, ruta, String(t0)], { cwd: RAIZ, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = ''; let err = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { err += d; });
    p.on('close', (code) => {
      let r = null;
      try { r = JSON.parse(out.trim().split('\n').pop()); } catch { /* sin salida valida */ }
      resolve({ code, r, err: err.slice(0, 300) });
    });
  });
}

test('3 procesos arrancan a la vez sobre la misma DB WAL: 002 se aplica una sola vez, sin crash ni perdida', async () => {
  const RONDAS = 6;
  for (let ronda = 0; ronda < RONDAS; ronda++) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'davis-mig-mp-'));
    const ruta = path.join(dir, 'jarvis.db');
    crearDbV1(ruta);
    const t0 = Date.now() + 700;
    const res = await Promise.all([lanzar(ruta, t0), lanzar(ruta, t0), lanzar(ruta, t0)]);
    for (const x of res) {
      assert.equal(x.code, 0, `ronda ${ronda}: proceso termino (${x.err})`);
      assert.ok(x.r && x.r.ok, `ronda ${ronda}: sin error de migracion (${x.r && x.r.error})`);
    }
    const aplicadas = res.flatMap((x) => x.r.aplicadasAhora);
    assert.deepEqual(aplicadas, [2], `ronda ${ronda}: 002 aplicada exactamente una vez en total (${aplicadas})`);
    const db = new Database(ruta);
    assert.equal(db.prepare('SELECT count(*) c FROM memorias').get().c, 300, 'sin perdida de memorias');
    assert.equal(db.prepare("SELECT count(*) c FROM memorias WHERE tenant_id = 'propietario'").get().c, 300);
    assert.deepEqual(db.prepare('SELECT categoria, limite FROM finanzas_presupuestos ORDER BY categoria').all(), [{ categoria: 'cafe', limite: 50 }, { categoria: 'ocio', limite: 80 }]);
    assert.equal(db.prepare('SELECT count(*) c FROM finanzas_config').get().c, 2);
    assert.deepEqual(db.prepare('SELECT version FROM schema_migrations ORDER BY version').all().map((v) => v.version), [1, 2]);
    assert.equal(db.pragma('integrity_check', { simple: true }), 'ok');
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
