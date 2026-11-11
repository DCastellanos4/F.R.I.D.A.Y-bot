/**
 * CLI de administracion de tenants (scripts/tenants-admin.mjs): altas,
 * suspension, permisos (solo clases aptas), cuotas, desvinculacion y
 * conciliacion de medicion pendiente. Todo sobre DB sintetica en
 * directorio temporal; el CLI se ejecuta como proceso hijo real.
 * No abre compuertas ni crea altas reales.
 *
 * Cobertura de hallazgos de revision:
 *  - parseo estricto de enteros (flag sin valor, "", " ", "1e3", "0x10" rechazados);
 *  - conciliacion: lectura del marcador + comparacion de ticket + incremento +
 *    confirmacion + registro de evidencia en UN BEGIN IMMEDIATE (doble
 *    conciliacion concurrente no duplica);
 *  - evidencia persistida en tenant_medicion_conciliada (migracion 009);
 *  - cuotas-establecer conserva las cuotas no mencionadas;
 *  - guardas de propietario en todos los comandos mutantes;
 *  - ningun comando migra la base por defecto (--migrar deliberado) y la
 *    base debe existir.
 *
 * Strict Policy: Zero Emojis.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { abrirBaseDatos } from '../../src/adapters/outbound/persistence/sqlite/connection.js';
import { ejecutarMigraciones } from '../../src/adapters/outbound/persistence/sqlite/migraciones.js';
import { crearSqliteTenantRepository } from '../../src/adapters/outbound/persistence/sqlite/sqliteTenantRepository.js';
import { crearSqliteLimitesStore } from '../../src/adapters/outbound/persistence/sqlite/sqliteLimitesStore.js';
import { crearSqliteUsageStore } from '../../src/adapters/outbound/persistence/sqlite/sqliteUsageStore.js';
import { medirUso, diaLocal } from '../../src/services/usageLedgerService.js';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CLI = path.join(RAIZ, 'scripts', 'tenants-admin.mjs');
const JID_A = '34600000001@s.whatsapp.net';

function dirTemporal() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'tenancy-admin-'));
}

function baseCon(rutaDb, semilla) {
  const db = abrirBaseDatos(rutaDb);
  ejecutarMigraciones(db);
  const ctx = { db, repo: crearSqliteTenantRepository(db), lim: crearSqliteLimitesStore(db), uso: crearSqliteUsageStore(db) };
  if (semilla) semilla(ctx);
  db.close();
}

function cli(rutaDb, args) {
  const r = spawnSync(process.execPath, [CLI, ...args], {
    cwd: RAIZ,
    env: { ...process.env, DAVIS_SQLITE_PATH: rutaDb },
    encoding: 'utf8'
  });
  return { code: r.status, out: (r.stdout || '').trim(), err: (r.error ? String(r.error) : (r.stderr || '').trim()) };
}

function cliAsync(rutaDb, args) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [CLI, ...args], {
      cwd: RAIZ,
      env: { ...process.env, DAVIS_SQLITE_PATH: rutaDb }
    });
    let out = ''; let err = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { err += d; });
    p.on('close', (code) => resolve({ code, out: out.trim(), err: err.trim() }));
  });
}

function leer(rutaDb, fn) {
  const db = abrirBaseDatos(rutaDb);
  ejecutarMigraciones(db);
  try {
    return fn({ db, repo: crearSqliteTenantRepository(db), lim: crearSqliteLimitesStore(db), uso: crearSqliteUsageStore(db) });
  } finally {
    db.close();
  }
}

test('alta: registra tenant + identidad en una transaccion; estado lo muestra; realta falla sin duplicar', () => {
  const dir = dirTemporal();
  const rutaDb = path.join(dir, 't.db');
  baseCon(rutaDb);
  const alta = cli(rutaDb, ['alta', '--id', 'sint-a', '--nombre', 'Prueba A', '--jid', JID_A]);
  assert.equal(alta.code, 0, alta.err);
  assert.match(alta.out, /NO activa/);
  const est = cli(rutaDb, ['estado', 'sint-a']);
  assert.equal(est.code, 0, est.err);
  assert.match(est.out, /rol=usuario estado=activo/);
  assert.match(est.out, /whatsapp:34600000001@s\.whatsapp\.net/);
  assert.match(est.out, /whitelist vacia/);
  assert.match(est.out, /medicion pendiente: ninguna/);
  const realta = cli(rutaDb, ['alta', '--id', 'sint-a', '--nombre', 'Otra', '--jid', '34600000002@s.whatsapp.net']);
  assert.notEqual(realta.code, 0);
  const n = leer(rutaDb, ({ db }) => db.prepare('SELECT COUNT(*) n FROM tenants').get().n);
  assert.equal(n, 2, 'solo propietario + sint-a: la realta no duplica ni deja identidad huerfana');
  const ids = leer(rutaDb, ({ db }) => db.prepare('SELECT COUNT(*) n FROM identidades').get().n);
  assert.equal(ids, 1, 'la transaccion fallida no deja la segunda identidad');
});

test('alta rechaza JID con formato no exacto e identidad ya vinculada', () => {
  const dir = dirTemporal();
  const rutaDb = path.join(dir, 't.db');
  baseCon(rutaDb, ({ repo }) => { repo.registrarTenant({ id: 'sint-a', nombre: 'A' }); repo.vincularIdentidad('sint-a', 'whatsapp', JID_A); });
  for (const jid of ['+34600000001', '34600000001', '34600000001@c.us', 'abc@s.whatsapp.net', '34600000001@g.us']) {
    const r = cli(rutaDb, ['alta', '--id', 'sint-b', '--nombre', 'B', '--jid', jid]);
    assert.notEqual(r.code, 0, `debia rechazar ${jid}`);
  }
  const dup = cli(rutaDb, ['alta', '--id', 'sint-b', '--nombre', 'B', '--jid', JID_A]);
  assert.notEqual(dup.code, 0);
  assert.match(dup.err, /ya esta vinculada/);
});

test('permisos: solo clases aptas; desconocida u host se rechazan; listar refleja el cambio', () => {
  const dir = dirTemporal();
  const rutaDb = path.join(dir, 't.db');
  baseCon(rutaDb, ({ repo }) => repo.registrarTenant({ id: 'sint-a', nombre: 'A' }));
  const host = cli(rutaDb, ['permisos-establecer', 'sint-a', '--herramientas', 'guardar_memoria,execute_bash_command']);
  assert.notEqual(host.code, 0, 'herramienta de clase host no apta');
  const desc = cli(rutaDb, ['permisos-establecer', 'sint-a', '--herramientas', 'guardar_memoria,herramienta_inventada']);
  assert.notEqual(desc.code, 0, 'herramienta sin clasificar falla cerrado');
  const ok = cli(rutaDb, ['permisos-establecer', 'sint-a', '--herramientas', 'guardar_memoria,listar_memorias,buscar_producto']);
  assert.equal(ok.code, 0, ok.err);
  const lista = cli(rutaDb, ['permisos-listar', 'sint-a']);
  assert.deepEqual(lista.out.split('\n').sort(), ['buscar_producto', 'guardar_memoria', 'listar_memorias'].sort());
});

test('cuotas: establecer/ver/quitar; 0 es invalido; ninguna flag no escribe', () => {
  const dir = dirTemporal();
  const rutaDb = path.join(dir, 't.db');
  baseCon(rutaDb, ({ repo }) => repo.registrarTenant({ id: 'sint-a', nombre: 'A' }));
  const cero = cli(rutaDb, ['cuotas-establecer', 'sint-a', '--tokens-dia', '0']);
  assert.notEqual(cero.code, 0, '0 no es un limite valido (entero positivo o ausente)');
  const vacio = cli(rutaDb, ['cuotas-establecer', 'sint-a']);
  assert.notEqual(vacio.code, 0, 'sin flags no se escribe fila vacia');
  const ok = cli(rutaDb, ['cuotas-establecer', 'sint-a', '--tokens-dia', '1000', '--peticiones-minuto', '5']);
  assert.equal(ok.code, 0, ok.err);
  const ver = cli(rutaDb, ['cuotas-ver', 'sint-a']);
  assert.match(ver.out, /tokensDia=1000/);
  assert.match(ver.out, /peticionesMinuto=5/);
  const quitar = cli(rutaDb, ['cuotas-quitar', 'sint-a']);
  assert.equal(quitar.code, 0, quitar.err);
  const ver2 = cli(rutaDb, ['cuotas-ver', 'sint-a']);
  assert.match(ver2.out, /sin limite/);
});

test('cuotas-establecer conserva las cuotas no mencionadas', () => {
  const dir = dirTemporal();
  const rutaDb = path.join(dir, 't.db');
  baseCon(rutaDb, ({ repo }) => repo.registrarTenant({ id: 'sint-a', nombre: 'A' }));
  assert.equal(cli(rutaDb, ['cuotas-establecer', 'sint-a', '--tokens-dia', '1000', '--peticiones-minuto', '5']).code, 0);
  assert.equal(cli(rutaDb, ['cuotas-establecer', 'sint-a', '--tokens-mes', '20000']).code, 0);
  const ver = cli(rutaDb, ['cuotas-ver', 'sint-a']);
  assert.match(ver.out, /tokensDia=1000/);
  assert.match(ver.out, /tokensMes=20000/);
  assert.match(ver.out, /peticionesMinuto=5/);
});

test('guardas de propietario: ningun comando mutante actua sobre el', () => {
  const dir = dirTemporal();
  const rutaDb = path.join(dir, 't.db');
  baseCon(rutaDb);
  const casos = [
    ['suspender', 'propietario'],
    ['reactivar', 'propietario'],
    ['permisos-establecer', 'propietario', '--herramientas', 'guardar_memoria'],
    ['cuotas-establecer', 'propietario', '--tokens-dia', '100'],
    ['cuotas-quitar', 'propietario'],
    ['conciliar-medicion', '--tenant', 'propietario', '--ticket', 'x', '--dia', '2026-03-10', '--modelo', 'm', '--entrada', '1', '--salida', '1', '--evidencia', 'ref'],
    ['alta', '--id', 'propietario', '--nombre', 'X', '--jid', JID_A]
  ];
  for (const args of casos) {
    const r = cli(rutaDb, args);
    assert.notEqual(r.code, 0, `debia rechazar: ${args[0]}`);
  }
  assert.equal(leer(rutaDb, ({ db }) => db.prepare("SELECT estado FROM tenants WHERE id = 'propietario'").get().estado), 'activo', 'propietario intacto');
});

test('parseo estricto de enteros: flag sin valor, vacio, espacio, notacion cientifica y hex rechazados', () => {
  const dir = dirTemporal();
  const rutaDb = path.join(dir, 't.db');
  let ticket;
  baseCon(rutaDb, ({ repo, lim }) => {
    repo.registrarTenant({ id: 'sint-a', nombre: 'A' });
    lim.configurar('sint-a', { tokensDia: 100 });
    ticket = lim.iniciarMedicion('sint-a');
  });
  const dia = diaLocal(new Date());
  const base = ['conciliar-medicion', '--tenant', 'sint-a', '--ticket', ticket, '--dia', dia, '--modelo', 'm', '--evidencia', 'ref'];
  // --entrada sin valor (la siguiente flag no se consume): true quedaria como 1 con Number()
  const sinValor = cli(rutaDb, [...base, '--entrada', '--salida', '5']);
  assert.notEqual(sinValor.code, 0, 'flag sin valor no se convierte en 1');
  for (const v of ['', ' ', '1e3', '0x10', '1.5', '-3', '+5']) {
    const r = cli(rutaDb, [...base, '--entrada', v, '--salida', '5']);
    assert.notEqual(r.code, 0, `debia rechazar entrada=${JSON.stringify(v)}`);
  }
  const cuotaSinValor = cli(rutaDb, ['cuotas-establecer', 'sint-a', '--tokens-dia']);
  assert.notEqual(cuotaSinValor.code, 0, 'cuota sin valor no queda en 1');
  // El marcador sigue pendiente tras todos los rechazos y la conciliacion buena funciona
  const ok = cli(rutaDb, [...base, '--entrada', '10', '--salida', '5']);
  assert.equal(ok.code, 0, ok.err);
  const usoDia = leer(rutaDb, ({ uso }) => uso.rango('sint-a', dia, dia));
  assert.deepEqual({ e: usoDia.entrada, s: usoDia.salida }, { e: 10, s: 5 }, 'ningun rechazo escribio tokens inventados');
});

test('suspender corta la resolucion de identidad y reactivar la devuelve; desvincular exige confirmacion', () => {
  const dir = dirTemporal();
  const rutaDb = path.join(dir, 't.db');
  baseCon(rutaDb, ({ repo }) => { repo.registrarTenant({ id: 'sint-a', nombre: 'A' }); repo.vincularIdentidad('sint-a', 'whatsapp', JID_A); });
  assert.equal(leer(rutaDb, ({ repo }) => repo.buscar('whatsapp', JID_A)), 'sint-a');
  const susp = cli(rutaDb, ['suspender', 'sint-a']);
  assert.equal(susp.code, 0, susp.err);
  assert.equal(leer(rutaDb, ({ repo }) => repo.buscar('whatsapp', JID_A)), null, 'suspendido no resuelve');
  const react = cli(rutaDb, ['reactivar', 'sint-a']);
  assert.equal(react.code, 0, react.err);
  assert.equal(leer(rutaDb, ({ repo }) => repo.buscar('whatsapp', JID_A)), 'sint-a');
  const sinConfirmar = cli(rutaDb, ['desvincular', '--jid', JID_A]);
  assert.notEqual(sinConfirmar.code, 0);
  assert.equal(leer(rutaDb, ({ repo }) => repo.buscar('whatsapp', JID_A)), 'sint-a', 'sin confirmacion no se desvincula');
  const ok = cli(rutaDb, ['desvincular', '--jid', JID_A, '--confirmar', 'DESVINCULAR']);
  assert.equal(ok.code, 0, ok.err);
  assert.equal(leer(rutaDb, ({ repo }) => repo.buscar('whatsapp', JID_A)), null);
  assert.ok(leer(rutaDb, ({ repo }) => repo.obtener('sint-a')), 'el tenant conserva su fila');
});

test('conciliar-medicion: ticket exacto y evidencia; registro durable; cuota agotada sigue bloqueando', () => {
  const dir = dirTemporal();
  const rutaDb = path.join(dir, 't.db');
  let ticket;
  baseCon(rutaDb, ({ repo, lim }) => {
    repo.registrarTenant({ id: 'sint-a', nombre: 'A' });
    lim.configurar('sint-a', { tokensDia: 100 });
    ticket = lim.iniciarMedicion('sint-a');
  });
  assert.ok(ticket);
  const sinPendiente = cli(rutaDb, ['conciliar-medicion', '--tenant', 'sint-b', '--ticket', 'x', '--dia', '2026-03-10', '--modelo', 'm', '--entrada', '1', '--salida', '1', '--evidencia', 'ref']);
  assert.notEqual(sinPendiente.code, 0);
  const ticketMal = cli(rutaDb, ['conciliar-medicion', '--tenant', 'sint-a', '--ticket', 'no-es', '--dia', '2026-03-10', '--modelo', 'm', '--entrada', '10', '--salida', '5', '--evidencia', 'panel proveedor 10/5']);
  assert.notEqual(ticketMal.code, 0);
  assert.match(ticketMal.err, /ticket no coincide/);
  assert.ok(leer(rutaDb, ({ db }) => db.prepare('SELECT ticket FROM tenant_medicion_pendiente WHERE tenant_id = ?').get('sint-a')), 'el marcador sobrevive a intentos fallidos');
  const ceroSinFlag = cli(rutaDb, ['conciliar-medicion', '--tenant', 'sint-a', '--ticket', ticket, '--dia', '2026-03-10', '--modelo', 'm', '--entrada', '0', '--salida', '0', '--evidencia', 'error HTTP del proveedor']);
  assert.notEqual(ceroSinFlag.code, 0, 'un error HTTP no demuestra consumo cero');
  const dia = diaLocal(new Date());
  const ok = cli(rutaDb, ['conciliar-medicion', '--tenant', 'sint-a', '--ticket', ticket, '--dia', dia, '--modelo', 'm', '--entrada', '95', '--salida', '10', '--evidencia', 'panel proveedor req-123']);
  assert.equal(ok.code, 0, ok.err);
  assert.match(ok.out, /DENEGADO \(cuota_diaria\)/, '95+10 >= 100: conciliar no resetea la cuota');
  assert.equal(leer(rutaDb, ({ db }) => db.prepare('SELECT COUNT(*) n FROM tenant_medicion_pendiente').get().n), 0, 'marcador confirmado');
  const registro = leer(rutaDb, ({ db }) => db.prepare('SELECT * FROM tenant_medicion_conciliada WHERE tenant_id = ?').get('sint-a'));
  assert.ok(registro, 'la conciliacion queda registrada de forma durable');
  assert.equal(registro.ticket, ticket);
  assert.equal(registro.evidencia, 'panel proveedor req-123');
  assert.deepEqual([registro.entrada, registro.salida], [95, 10]);
  const usoDia = leer(rutaDb, ({ uso }) => uso.rango('sint-a', dia, dia));
  assert.deepEqual({ e: usoDia.entrada, s: usoDia.salida }, { e: 95, s: 10 });
});

test('dos conciliaciones concurrentes del mismo ticket: exactamente una escribe', async () => {
  const dir = dirTemporal();
  const rutaDb = path.join(dir, 't.db');
  let ticket;
  baseCon(rutaDb, ({ repo, lim }) => {
    repo.registrarTenant({ id: 'sint-a', nombre: 'A' });
    lim.configurar('sint-a', { tokensDia: 10000 });
    ticket = lim.iniciarMedicion('sint-a');
  });
  const dia = diaLocal(new Date());
  const args = ['conciliar-medicion', '--tenant', 'sint-a', '--ticket', ticket, '--dia', dia, '--modelo', 'm', '--entrada', '30', '--salida', '20', '--evidencia', 'panel proveedor req-77'];
  const [r1, r2] = await Promise.all([cliAsync(rutaDb, args), cliAsync(rutaDb, args)]);
  const codigos = [r1.code, r2.code].sort();
  assert.deepEqual(codigos, [0, 1], `una conciliacion gana y la otra falla cerrada: ${r1.err} ${r2.err}`);
  const usoDia = leer(rutaDb, ({ uso }) => uso.rango('sint-a', dia, dia));
  assert.deepEqual({ e: usoDia.entrada, s: usoDia.salida }, { e: 30, s: 20 }, 'el incremento se escribio exactamente una vez');
  assert.equal(leer(rutaDb, ({ db }) => db.prepare('SELECT COUNT(*) n FROM tenant_medicion_pendiente').get().n), 0);
  assert.equal(leer(rutaDb, ({ db }) => db.prepare('SELECT COUNT(*) n FROM tenant_medicion_conciliada').get().n), 1, 'un solo registro de conciliacion');
});

test('conciliar con cuota no agotada deja al tenant permitido y medido', () => {
  const dir = dirTemporal();
  const rutaDb = path.join(dir, 't.db');
  let ticket;
  baseCon(rutaDb, ({ repo, lim }) => {
    repo.registrarTenant({ id: 'sint-a', nombre: 'A' });
    lim.configurar('sint-a', { tokensDia: 1000 });
    ticket = lim.iniciarMedicion('sint-a');
  });
  const dia = diaLocal(new Date());
  const ok = cli(rutaDb, ['conciliar-medicion', '--tenant', 'sint-a', '--ticket', ticket, '--dia', dia, '--modelo', 'm', '--entrada', '40', '--salida', '10', '--evidencia', 'panel proveedor req-9']);
  assert.equal(ok.code, 0, ok.err);
  assert.match(ok.out, /Autorizacion ahora: permitido/);
  const decision = leer(rutaDb, ({ lim }) => lim.autorizar({ tenantId: 'sint-a', consumirPeticion: false }));
  assert.equal(decision.permitido, true, 'sin marcador y bajo cuota: permitido');
});

test('uso medido por el runtime convive con la conciliacion: se suma, no se sobrescribe', () => {
  const dir = dirTemporal();
  const rutaDb = path.join(dir, 't.db');
  const dia = diaLocal(new Date());
  let ticket;
  baseCon(rutaDb, ({ repo, lim, uso }) => {
    repo.registrarTenant({ id: 'sint-a', nombre: 'A' });
    lim.configurar('sint-a', { tokensDia: 10000 });
    medirUso({ tenantId: 'sint-a', modelo: 'm', usage: { prompt_tokens: 7, completion_tokens: 3 }, store: uso });
    ticket = lim.iniciarMedicion('sint-a');
  });
  const ok = cli(rutaDb, ['conciliar-medicion', '--tenant', 'sint-a', '--ticket', ticket, '--dia', dia, '--modelo', 'm', '--entrada', '11', '--salida', '13', '--evidencia', 'panel proveedor req-10']);
  assert.equal(ok.code, 0, ok.err);
  assert.match(ok.out, /ya habia 7\/3 registrados/);
  const usoDia = leer(rutaDb, ({ uso }) => uso.rango('sint-a', dia, dia));
  assert.deepEqual({ e: usoDia.entrada, s: usoDia.salida }, { e: 18, s: 16 });
});

test('ningun comando migra por defecto: base sin migrar falla; --migrar es deliberado; la base debe existir', () => {
  const dir = dirTemporal();
  const rutaDb = path.join(dir, 'sin-migrar.db');
  // Base creada SIN migraciones (fichero real, esquema vacio)
  new Database(rutaDb).close();
  const est = cli(rutaDb, ['estado', 'propietario']);
  assert.notEqual(est.code, 0, 'sin esquema no hay lectura');
  const sinTablaMigraciones = new Database(rutaDb, { readonly: true })
    .prepare("SELECT COUNT(*) n FROM sqlite_master WHERE name = 'schema_migrations'").get().n;
  assert.equal(sinTablaMigraciones, 0, 'el comando no creo ni schema_migrations: nada de escrituras implicitas');
  const alta = cli(rutaDb, ['alta', '--id', 'sint-a', '--nombre', 'A', '--jid', JID_A]);
  assert.notEqual(alta.code, 0, 'los comandos de escritura tampoco migran por defecto');
  const migrar = cli(rutaDb, ['--migrar', 'estado', 'propietario']);
  assert.equal(migrar.code, 0, migrar.err);
  const inexistente = cli(path.join(dir, 'no-existe.db'), ['estado', 'propietario']);
  assert.notEqual(inexistente.code, 0, 'base inexistente: no se crea por accidente');
  assert.equal(fs.existsSync(path.join(dir, 'no-existe.db')), false, 'no queda fichero nuevo');
});

test('flags de texto sin valor se rechazan (no valen como booleano true)', () => {
  const dir = dirTemporal();
  const rutaDb = path.join(dir, 't.db');
  let ticket;
  baseCon(rutaDb, ({ repo, lim }) => {
    repo.registrarTenant({ id: 'sint-a', nombre: 'A' });
    lim.configurar('sint-a', { tokensDia: 100 });
    ticket = lim.iniciarMedicion('sint-a');
  });
  const dia = diaLocal(new Date());
  const casos = [
    ['alta', '--id', '--nombre', 'B', '--jid', '34600000002@s.whatsapp.net'],
    ['alta', '--id', 'sint-b', '--nombre', '--jid', '34600000002@s.whatsapp.net'],
    ['conciliar-medicion', '--tenant', 'sint-a', '--ticket', '--dia', dia, '--modelo', 'm', '--entrada', '1', '--salida', '1', '--evidencia', 'ref'],
    ['conciliar-medicion', '--tenant', 'sint-a', '--ticket', ticket, '--dia', dia, '--modelo', '--entrada', '1', '--salida', '1', '--evidencia', 'ref'],
    ['conciliar-medicion', '--tenant', '--ticket', ticket, '--dia', dia, '--modelo', 'm', '--entrada', '1', '--salida', '1', '--evidencia', 'ref'],
    ['conciliar-medicion', '--tenant', 'sint-a', '--ticket', ticket, '--dia', dia, '--modelo', 'm', '--entrada', '1', '--salida', '1', '--evidencia']
  ];
  for (const args of casos) {
    const r = cli(rutaDb, args);
    assert.notEqual(r.code, 0, `debia rechazar: ${args.join(' ')}`);
  }
  assert.ok(leer(rutaDb, ({ db }) => db.prepare('SELECT ticket FROM tenant_medicion_pendiente WHERE tenant_id = ?').get('sint-a')), 'nada se escribio');
  assert.equal(leer(rutaDb, ({ db }) => db.prepare('SELECT COUNT(*) n FROM tenants').get().n), 2, 'sin altas parciales');
});

test('lectura real: estado/permisos-listar/cuotas-ver no mutan la base ni crean journal', () => {
  const dir = dirTemporal();
  const rutaDb = path.join(dir, 't.db');
  baseCon(rutaDb, ({ repo, lim }) => {
    repo.registrarTenant({ id: 'sint-a', nombre: 'A' });
    lim.configurar('sint-a', { tokensDia: 100 });
  });
  const hashAntes = fs.readFileSync(rutaDb);
  for (const args of [['estado', 'sint-a'], ['permisos-listar', 'sint-a'], ['cuotas-ver', 'sint-a']]) {
    const r = cli(rutaDb, args);
    assert.equal(r.code, 0, `${args[0]}: ${r.err}`);
  }
  // La base no se muta: mismo contenido byte a byte y sin -journal.
  // (SQLite puede recrear -shm/-wal vacios de bookkeeping en una base WAL
  // cerrada limpia; eso no es mutacion de datos y queda documentado.)
  assert.ok(fs.readFileSync(rutaDb).equals(hashAntes), 'el fichero de la base no cambio');
  assert.equal(fs.existsSync(`${rutaDb}-journal`), false, 'sin journal rollback');
  const filas = leer(rutaDb, ({ db }) => db.prepare('SELECT COUNT(*) n FROM tenants').get().n);
  assert.equal(filas, 2, 'datos intactos');
});

test('cuotas concurrentes: dos administradores no pierden actualizaciones', async () => {
  const dir = dirTemporal();
  const rutaDb = path.join(dir, 't.db');
  baseCon(rutaDb, ({ repo }) => repo.registrarTenant({ id: 'sint-a', nombre: 'A' }));
  const [r1, r2] = await Promise.all([
    cliAsync(rutaDb, ['cuotas-establecer', 'sint-a', '--tokens-dia', '500']),
    cliAsync(rutaDb, ['cuotas-establecer', 'sint-a', '--peticiones-minuto', '7'])
  ]);
  assert.equal(r1.code, 0, r1.err);
  assert.equal(r2.code, 0, r2.err);
  const c = leer(rutaDb, ({ lim }) => lim.leer('sint-a'));
  assert.equal(c.tokensDia, 500, 'la escritura de tokens-dia no se perdio');
  assert.equal(c.peticionesMinuto, 7, 'la escritura de peticiones-minuto no se perdio');
});

test('sin comando o comando desconocido: uso por pantalla y sin escrituras', () => {
  const dir = dirTemporal();
  const rutaDb = path.join(dir, 't.db');
  baseCon(rutaDb);
  const vacio = cli(rutaDb, []);
  assert.notEqual(vacio.code, 0);
  const raro = cli(rutaDb, ['borrar-todo', '--si']);
  assert.notEqual(raro.code, 0);
  const conteos = leer(rutaDb, ({ db }) => ({
    tenants: db.prepare('SELECT COUNT(*) n FROM tenants').get().n,
    identidades: db.prepare('SELECT COUNT(*) n FROM identidades').get().n,
    limites: db.prepare('SELECT COUNT(*) n FROM tenant_limites').get().n
  }));
  assert.deepEqual(conteos, { tenants: 1, identidades: 0, limites: 0 }, 'solo queda el propietario sembrado por la migracion');
});
