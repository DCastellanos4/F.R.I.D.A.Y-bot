/**
 * Fundamentos de tenancy (locales, aditivos). Tenants SINTETICOS de prueba:
 * no autorizan usuarios reales ni activan altas, canales, cuotas ni tiers.
 *
 * Cubre: migracion 002 conserva datos del propietario; aislamiento por tenant
 * en memorias y finanzas (lectura y guardado, sin borrar al otro tenant);
 * identidad propietario identica a la historica; desconocidos no crean tenants;
 * RBAC denegado por defecto; libro de tokens persistente (solo mide).
 *
 * Aislamiento probado SOLO para estos almacenes SQLite. Los ficheros JSON, la
 * memoria semantica/grafo y el historial siguen siendo globales (no migrados).
 *
 * Strict Policy: Zero Emojis.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { MIGRACIONES, ejecutarMigraciones } from '../../src/adapters/outbound/persistence/sqlite/migraciones.js';
import { crearSqliteMemoryStore } from '../../src/adapters/outbound/persistence/sqlite/sqliteMemoryStore.js';
import { crearSqliteFinanceStore } from '../../src/adapters/outbound/persistence/sqlite/sqliteFinanceStore.js';
import { crearSqliteTenantRepository } from '../../src/adapters/outbound/persistence/sqlite/sqliteTenantRepository.js';
import { crearSqliteUsageStore } from '../../src/adapters/outbound/persistence/sqlite/sqliteUsageStore.js';
import { TENANT_PROPIETARIO, AISLAMIENTO_COMPLETO, tenantsHabilitados, rutaDatosTenant, esPropietario, resolverTenant, afirmarTenantId } from '../../src/core/tenancy.js';
import { puedeEjecutarHerramienta } from '../../src/services/rbacService.js';
import { medirUso } from '../../src/services/usageLedgerService.js';

function dbNueva() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  return db;
}
const mem = (id, dato) => ({ id, sujeto: 's', dato, categoria: 'general', tags: [], fechaRegistro: '2026-01-01T00:00:00.000Z' });
const estadoFin = (gastoId, importe, cat) => ({
  gastos: [{ id: gastoId, importe, comercio: 'x', categoria: cat, fecha: '2026-01-01', origen: 'manual', creadoEn: '2026-01-01' }],
  suscripciones: [], presupuestos: { [cat]: importe * 10 }, borradores: [], config: { aviso: true }
});

test('migracion 002: conserva TODAS las filas del propietario (incluida la reconstruccion de PK)', () => {
  const db = dbNueva();
  // Solo la migracion 1 + datos sembrados como en produccion.
  const m1 = MIGRACIONES.find((m) => m.version === 1);
  db.exec('CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, nombre TEXT NOT NULL, aplicada_en TEXT NOT NULL)');
  db.exec(m1.sql);
  db.prepare('INSERT INTO schema_migrations VALUES (1, ?, ?)').run(m1.nombre, 'x');
  db.prepare("INSERT INTO memorias (id, sujeto, dato, categoria, tags, fecha_registro) VALUES ('m1','a','uno','general','[]','2026-01-01'),('m2','b','dos','general','[]','2026-01-02')").run();
  db.prepare("INSERT INTO finanzas_gastos (id, importe, comercio, categoria, fecha, origen, creado_en) VALUES ('g1', 5, 'c', 'cafe', '2026-01-01', 'manual', 'x')").run();
  db.prepare("INSERT INTO finanzas_presupuestos (categoria, limite) VALUES ('cafe', 50), ('ocio', 80)").run();
  db.prepare("INSERT INTO finanzas_config (clave, valor) VALUES ('a', '1'), ('b', '2')").run();
  const antes = {
    mem: db.prepare('SELECT id, dato FROM memorias ORDER BY rowid').all(),
    pres: db.prepare('SELECT categoria, limite FROM finanzas_presupuestos ORDER BY rowid').all(),
    conf: db.prepare('SELECT clave, valor FROM finanzas_config ORDER BY rowid').all()
  };
  const r = ejecutarMigraciones(db);
  assert.deepEqual(r.aplicadasAhora, [2, 3, 4, 5]);
  assert.deepEqual(db.prepare('SELECT id, dato FROM memorias ORDER BY rowid').all(), antes.mem);
  assert.deepEqual(db.prepare('SELECT categoria, limite FROM finanzas_presupuestos ORDER BY rowid').all(), antes.pres);
  assert.deepEqual(db.prepare('SELECT clave, valor FROM finanzas_config ORDER BY rowid').all(), antes.conf);
  assert.equal(db.prepare("SELECT count(*) c FROM memorias WHERE tenant_id = 'propietario'").get().c, 2);
  assert.equal(db.prepare("SELECT count(*) c FROM finanzas_presupuestos WHERE tenant_id = 'propietario'").get().c, 2);
  assert.equal(db.prepare('SELECT count(*) c FROM tenants').get().c, 1, 'solo existe el propietario');
  assert.equal(db.prepare('SELECT count(*) c FROM identidades').get().c, 0, 'ninguna identidad dada de alta');
  // Idempotente
  assert.deepEqual(ejecutarMigraciones(db).aplicadasAhora, []);
  db.close();
});

test('aislamiento de memorias: A y B no se ven; guardar de uno NO borra al otro', () => {
  const db = dbNueva(); ejecutarMigraciones(db);
  const repo = crearSqliteTenantRepository(db);
  repo.registrarTenant({ id: 'sint-a', nombre: 'Sintetico A' });
  repo.registrarTenant({ id: 'sint-b', nombre: 'Sintetico B' });
  const owner = crearSqliteMemoryStore(db);
  const a = crearSqliteMemoryStore(db, { tenantId: 'sint-a' });
  const b = crearSqliteMemoryStore(db, { tenantId: 'sint-b' });
  owner.guardar([mem('o1', 'dato-del-propietario')]);
  a.guardar([mem('a1', 'secreto-de-A')]);
  b.guardar([mem('b1', 'secreto-de-B')]);
  assert.deepEqual(a.leer().map((m) => m.dato), ['secreto-de-A']);
  assert.deepEqual(b.leer().map((m) => m.dato), ['secreto-de-B']);
  assert.deepEqual(owner.leer().map((m) => m.dato), ['dato-del-propietario']);
  // Re-guardar A (reemplazo total, como hace la API) no toca a B ni al propietario.
  a.guardar([mem('a2', 'nuevo-A')]);
  assert.deepEqual(b.leer().map((m) => m.dato), ['secreto-de-B']);
  assert.deepEqual(owner.leer().map((m) => m.dato), ['dato-del-propietario']);
  // B no puede pisar un id ajeno: falla y deja todo intacto.
  assert.throws(() => b.guardar([mem('a2', 'robo')]), /UNIQUE/);
  assert.deepEqual(a.leer().map((m) => m.dato), ['nuevo-A']);
  assert.deepEqual(b.leer().map((m) => m.dato), ['secreto-de-B']);
  db.close();
});

test('aislamiento de finanzas (gastos, presupuestos y config con misma clave en dos tenants)', () => {
  const db = dbNueva(); ejecutarMigraciones(db);
  const repo = crearSqliteTenantRepository(db);
  repo.registrarTenant({ id: 'sint-a', nombre: 'A' });
  repo.registrarTenant({ id: 'sint-b', nombre: 'B' });
  const o = crearSqliteFinanceStore(db);
  const a = crearSqliteFinanceStore(db, { tenantId: 'sint-a' });
  const b = crearSqliteFinanceStore(db, { tenantId: 'sint-b' });
  o.guardar(estadoFin('go', 1, 'cafe'));
  a.guardar(estadoFin('ga', 2, 'cafe'));
  b.guardar(estadoFin('gb', 3, 'cafe'));
  assert.deepEqual(o.leer().gastos.map((g) => g.id), ['go']);
  assert.deepEqual(a.leer().gastos.map((g) => g.id), ['ga']);
  assert.deepEqual(b.leer().gastos.map((g) => g.id), ['gb']);
  assert.deepEqual(a.leer().presupuestos, { cafe: 20 });
  assert.deepEqual(b.leer().presupuestos, { cafe: 30 });
  assert.deepEqual(o.leer().presupuestos, { cafe: 10 });
  a.guardar({ gastos: [], suscripciones: [], presupuestos: {}, borradores: [], config: {} });
  assert.equal(b.leer().gastos.length, 1, 'vaciar A no toca a B');
  assert.equal(o.leer().gastos.length, 1, 'vaciar A no toca al propietario');
  db.close();
});

test('tenantId obligatorio y validado en los almacenes', () => {
  const db = dbNueva(); ejecutarMigraciones(db);
  for (const malo of ['', 'A B', '../x', null, 5, 'X'.repeat(70)]) {
    assert.throws(() => crearSqliteMemoryStore(db, { tenantId: malo }), TypeError);
    assert.throws(() => crearSqliteFinanceStore(db, { tenantId: malo }), TypeError);
  }
  assert.equal(crearSqliteMemoryStore(db).tenantId, TENANT_PROPIETARIO, 'sin opcion = propietario (compatibilidad)');
  assert.throws(() => afirmarTenantId(undefined), TypeError);
  db.close();
});

test('identidad propietario: reproduce la resolucion historica y no acepta de mas', () => {
  const PHONE = '34635605605'; const LID = '149868706304033';
  const mapeo = { 'x999': `${PHONE}` };
  const deps = { phone: PHONE, lid: LID, leerMapeoInverso: (id) => mapeo[id] ?? null };
  // Referencia: logica original de whatsappBot (copia literal).
  const original = (jid) => {
    if (!jid) return false;
    if (PHONE && jid.includes(PHONE)) return true;
    if (LID && jid.includes(LID)) return true;
    const rawId = jid.split('@')[0].split(':')[0];
    const mapeado = mapeo[rawId] ?? null;
    return typeof mapeado === 'string' && !!PHONE && mapeado.includes(PHONE);
  };
  const casos = [
    `${PHONE}@s.whatsapp.net`, `${LID}@lid`, `${LID}:12@lid`, 'x999@lid', 'x998@lid',
    '256700000000@s.whatsapp.net', '120363000000@g.us', '', null, undefined,
    `99${PHONE}@s.whatsapp.net`, `${PHONE.slice(1)}@s.whatsapp.net`, 'abc@lid'
  ];
  for (const c of casos) assert.equal(esPropietario(c, deps), original(c), `caso ${c}`);
  assert.equal(esPropietario('256700000000@s.whatsapp.net', deps), false, 'tercero +256 no es propietario');
});

test('desconocidos no crean tenants; identidad exacta de tenant registrado resuelve; el resto null', () => {
  const db = dbNueva(); ejecutarMigraciones(db);
  const repo = crearSqliteTenantRepository(db);
  const cfg = { phone: '34635605605', lid: '149868706304033' };
  const antes = db.prepare('SELECT count(*) c FROM tenants').get().c;
  assert.equal(resolverTenant('256700000000@s.whatsapp.net', { propietario: cfg, repositorioIdentidades: repo }), null);
  assert.equal(resolverTenant('120363000000@g.us', { propietario: cfg, repositorioIdentidades: repo }), null);
  assert.equal(db.prepare('SELECT count(*) c FROM tenants').get().c, antes, 'resolver no crea tenants');
  assert.equal(db.prepare('SELECT count(*) c FROM identidades').get().c, 0);
  repo.registrarTenant({ id: 'sint-a', nombre: 'A' });
  repo.vincularIdentidad('sint-a', 'whatsapp', '111@s.whatsapp.net');
  assert.equal(resolverTenant('111@s.whatsapp.net', { propietario: cfg, repositorioIdentidades: repo }), 'sint-a');
  assert.equal(resolverTenant('1111@s.whatsapp.net', { propietario: cfg, repositorioIdentidades: repo }), null, 'exacto, no por subcadena');
  assert.equal(resolverTenant(`${cfg.phone}@s.whatsapp.net`, { propietario: cfg, repositorioIdentidades: repo }), TENANT_PROPIETARIO);
  // No se puede crear otro propietario ni vincular identidades al propietario.
  assert.throws(() => repo.registrarTenant({ id: 'propietario', nombre: 'x' }));
  assert.throws(() => repo.registrarTenant({ id: 'sint-z', nombre: 'z', rol: 'propietario' }));
  assert.throws(() => repo.vincularIdentidad('propietario', 'whatsapp', 'z'));
  assert.throws(() => repo.vincularIdentidad('no-existe', 'whatsapp', 'z'));
  db.close();
});

test('RBAC: propietario intacto; resto denegado por defecto; desconocidos denegados', () => {
  const catalogo = new Set(['obtener_noticias_actuales', 'execute_bash_command', 'manage_tunnel']);
  for (const h of catalogo) {
    assert.equal(puedeEjecutarHerramienta({ tenantId: undefined, herramienta: h, catalogo }).permitido, true);
    assert.equal(puedeEjecutarHerramienta({ tenantId: 'propietario', herramienta: h, catalogo }).permitido, true);
  }
  const rolDe = (t) => (t === 'sint-a' ? 'usuario' : null);
  for (const h of ['obtener_noticias_actuales', 'execute_bash_command', 'manage_tunnel', 'inventada']) {
    const r = puedeEjecutarHerramienta({ tenantId: 'sint-a', herramienta: h, catalogo, rolDe });
    assert.equal(r.permitido, false, `usuario sin lista blanca: ${h}`);
  }
  assert.equal(puedeEjecutarHerramienta({ tenantId: 'sint-a', herramienta: 'obtener_noticias_actuales', catalogo, rolDe, permitidasUsuario: ['obtener_noticias_actuales'] }).permitido, true);
  assert.equal(puedeEjecutarHerramienta({ tenantId: 'sint-a', herramienta: 'execute_bash_command', catalogo, rolDe, permitidasUsuario: ['obtener_noticias_actuales'] }).permitido, false);
  assert.equal(puedeEjecutarHerramienta({ tenantId: 'sint-a', herramienta: 'inventada', catalogo, rolDe, permitidasUsuario: ['inventada'] }).permitido, false, 'fuera de catalogo');
  assert.equal(puedeEjecutarHerramienta({ tenantId: 'fantasma', herramienta: 'obtener_noticias_actuales', catalogo, rolDe, permitidasUsuario: ['obtener_noticias_actuales'] }).permitido, false, 'tenant desconocido');
  assert.equal(puedeEjecutarHerramienta({ tenantId: 'MAL ID', herramienta: 'obtener_noticias_actuales', catalogo }).permitido, false);
});

test('libro de tokens: persistente, por tenant/dia/modelo, solo mide', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'davis-uso-'));
  const ruta = path.join(dir, 'u.db');
  let db = new Database(ruta); ejecutarMigraciones(db);
  const repo = crearSqliteTenantRepository(db);
  repo.registrarTenant({ id: 'sint-a', nombre: 'A' });
  let store = crearSqliteUsageStore(db);
  const ahora = new Date('2026-11-08T12:00:00Z');
  medirUso({ modelo: 'm1', usage: { prompt_tokens: 10, completion_tokens: 4 }, store, ahora });
  medirUso({ modelo: 'm1', usage: { prompt_tokens: 5, completion_tokens: 1 }, store, ahora });
  medirUso({ tenantId: 'sint-a', modelo: 'm2', usage: { prompt_tokens: 7, completion_tokens: 3 }, store, ahora });
  medirUso({ modelo: 'm1', usage: { prompt_tokens: 0, completion_tokens: 0 }, store, ahora });
  medirUso({ modelo: 'm1', usage: null, store, ahora });
  assert.deepEqual(store.diario('propietario', '2026-11-08'), [{ modelo: 'm1', entrada: 15, salida: 5, llamadas: 3 }]);
  assert.deepEqual(store.diario('sint-a', '2026-11-08'), [{ modelo: 'm2', entrada: 7, salida: 3, llamadas: 1 }]);
  // Sobrevive a un reinicio (reabrir el fichero).
  db.close();
  db = new Database(ruta); store = crearSqliteUsageStore(db);
  assert.deepEqual(store.rango('propietario', '2026-11-01', '2026-11-30'), { entrada: 15, salida: 5, llamadas: 3 });
  // Un fallo del libro nunca rompe: devuelve false.
  assert.equal(medirUso({ modelo: 'm', usage: { prompt_tokens: 1 }, store: { registrar() { throw new Error('boom'); } } }), false);
  // No hay columnas de coste/precio en el libro.
  const cols = db.prepare('PRAGMA table_info(uso_tokens)').all().map((c) => c.name);
  assert.ok(!cols.some((c) => /coste|precio|eur|usd|cost|price/i.test(c)), `sin coste en el libro (${cols})`);
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('agente: tenantId desconocido NO ejecuta herramientas; sin tenantId (historico) y propietario si; tokens medidos', async () => {
  const { consultarJarvis } = await import('../../src/core/jarvisAgent.js');
  const { registrarStoreUsoPorDefecto } = await import('../../src/services/usageLedgerService.js');
  const db = dbNueva(); ejecutarMigraciones(db);
  const uso = crearSqliteUsageStore(db);
  registrarStoreUsoPorDefecto(uso);
  try {
    const guion = () => {
      let n = 0;
      return async () => {
        n += 1;
        if (n === 1) return { message: { role: 'assistant', content: '', tool_calls: [{ id: 't1', type: 'function', function: { name: 'consultar_clima', arguments: {} } }] }, usage: { prompt_tokens: 11, completion_tokens: 7 }, model: 'm-test' };
        return { message: { role: 'assistant', content: 'Listo, senor.' }, usage: { prompt_tokens: 3, completion_tokens: 2 }, model: 'm-test' };
      };
    };
    let llamadas = 0;
    const ejecutores = { consultar_clima: async () => { llamadas += 1; return 'sol'; } };
    await consultarJarvis('tiempo', [], { chatId: 'c1', chatCompletion: guion(), ejecutores });
    assert.equal(llamadas, 1, 'historico (sin tenantId): se ejecuta como siempre');
    await consultarJarvis('tiempo', [], { chatId: 'c1', tenantId: 'propietario', chatCompletion: guion(), ejecutores });
    assert.equal(llamadas, 2, 'propietario: se ejecuta');
    await consultarJarvis('tiempo', [], { chatId: 'c2', tenantId: 'sint-fantasma', chatCompletion: guion(), ejecutores });
    assert.equal(llamadas, 2, 'tenant desconocido: la herramienta NO se ejecuta');
    let llamadasLlm = 0;
    const respuesta = await consultarJarvis('tiempo', [], { chatId: 'c2', tenantId: 'sint-fantasma', chatCompletion: async () => { llamadasLlm += 1; return { message: { role: 'assistant', content: 'x' } }; }, ejecutores });
    assert.equal(llamadasLlm, 0, 'tenant desconocido: ni siquiera se llama al LLM');
    assert.match(String(respuesta), /no disponible/);
    // Fail-closed: un tenant 'usuario' REGISTRADO tampoco entra al LLM/RAG mientras
    // el aislamiento no este completo (el prompt podria llevar datos del propietario).
    let llmUsuario = 0;
    const rUsuario = await consultarJarvis('tiempo', [], {
      chatId: 'c3', tenantId: 'sint-a', rolDeTenant: (t) => (t === 'sint-a' ? 'usuario' : null),
      chatCompletion: async () => { llmUsuario += 1; return { message: { role: 'assistant', content: 'x' } }; }, ejecutores
    });
    assert.equal(llmUsuario, 0, 'usuario registrado: 0 llamadas al LLM con aislamiento incompleto');
    assert.match(String(rUsuario), /no disponible/);
    assert.equal(llamadas, 2, 'ninguna herramienta ejecutada');
    // Incluso con el interruptor de runtime, la constante de codigo sigue cerrando.
    process.env.DAVIS_TENANTS_ENABLED = '1';
    try {
      const rForz = await consultarJarvis('tiempo', [], {
        chatId: 'c4', tenantId: 'sint-a', rolDeTenant: () => 'usuario',
        chatCompletion: async () => { llmUsuario += 1; return { message: { role: 'assistant', content: 'x' } }; }, ejecutores
      });
      assert.equal(llmUsuario, 0, 'DAVIS_TENANTS_ENABLED=1 no basta: AISLAMIENTO_COMPLETO es false en codigo');
      assert.match(String(rForz), /no disponible/);
    } finally {
      delete process.env.DAVIS_TENANTS_ENABLED;
    }
    const dia = uso.rango('propietario', '2000-01-01', '2999-12-31');
    assert.equal(dia.entrada, 2 * (11 + 3), 'tokens del propietario medidos (2 consultas x 2 llamadas)');
    assert.equal(uso.rango('sint-fantasma', '2000-01-01', '2999-12-31').llamadas, 0, 'tenant desconocido no consume ni escribe');
    assert.equal(uso.rango('sint-a', '2000-01-01', '2999-12-31').llamadas, 0, 'usuario registrado sin acceso: nada medido');
  } finally {
    registrarStoreUsoPorDefecto(null);
    db.close();
  }
});

test('compuerta fail-closed: constante de codigo en false; el entorno no la abre', () => {
  assert.equal(AISLAMIENTO_COMPLETO, false);
  assert.equal(tenantsHabilitados({ DAVIS_TENANTS_ENABLED: '1' }), false);
  assert.equal(tenantsHabilitados({}), false);
});

test('rutas por tenant: propietario conserva la ruta historica; traversal e ids hostiles rechazados', () => {
  const base = path.join(os.tmpdir(), 'davis-data-x');
  assert.equal(rutaDatosTenant(base, 'propietario', 'reminders.json'), path.join(base, 'reminders.json'));
  assert.equal(rutaDatosTenant(base, 'sint-a', 'reminders.json'), path.join(base, 'tenants', 'sint-a', 'reminders.json'));
  for (const id of ['../x', 'a/b', 'a\\b', '..', '.', '', 'A', 'a b', 'a\0b', '/etc']) {
    assert.throws(() => rutaDatosTenant(base, id, 'x.json'), TypeError, `id ${JSON.stringify(id)}`);
  }
  for (const n of ['../x.json', 'a/b.json', '..', '.x/../y', '/etc/passwd', '', 'a\\b', 'x..y', 'a'.repeat(200)]) {
    assert.throws(() => rutaDatosTenant(base, 'sint-a', n), TypeError, `nombre ${JSON.stringify(n)}`);
  }
  // Dos tenants distintos nunca comparten ruta.
  assert.notEqual(rutaDatosTenant(base, 'sint-a', 'f.json'), rutaDatosTenant(base, 'sint-b', 'f.json'));
});

test('migracion 002: fallo a mitad => ROLLBACK completo (datos, PK y version intactos); FK e indices correctos tras exito', () => {
  const m1 = MIGRACIONES.find((m) => m.version === 1);
  const preparar = () => {
    const db = dbNueva();
    db.exec('CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, nombre TEXT NOT NULL, aplicada_en TEXT NOT NULL)');
    db.exec(m1.sql);
    db.prepare('INSERT INTO schema_migrations VALUES (1, ?, ?)').run(m1.nombre, 'x');
    db.prepare("INSERT INTO finanzas_presupuestos (categoria, limite) VALUES ('cafe', 50)").run();
    db.prepare("INSERT INTO finanzas_config (clave, valor) VALUES ('a', '1')").run();
    db.prepare("INSERT INTO memorias (id, sujeto, dato, categoria, tags, fecha_registro) VALUES ('m1','a','uno','general','[]','2026-01-01')").run();
    return db;
  };
  // Fallo forzado en la ULTIMA sentencia de 002 (tabla uso_tokens ya existente).
  const roto = preparar();
  roto.exec('CREATE TABLE uso_tokens (x INTEGER)');
  assert.throws(() => ejecutarMigraciones(roto), /uso_tokens/);
  assert.deepEqual(roto.prepare('SELECT version FROM schema_migrations').all().map((v) => v.version), [1], 'version 2 NO registrada');
  assert.equal(roto.prepare("SELECT count(*) c FROM sqlite_master WHERE name = 'tenants'").get().c, 0, 'sin tabla tenants a medias');
  assert.equal(roto.prepare("SELECT count(*) c FROM pragma_table_info('memorias') WHERE name = 'tenant_id'").get().c, 0, 'sin columna tenant_id a medias');
  assert.equal(roto.prepare("SELECT count(*) c FROM pragma_table_info('finanzas_presupuestos') WHERE name = 'tenant_id'").get().c, 0, 'presupuestos sin reconstruir');
  assert.deepEqual(roto.prepare('SELECT categoria, limite FROM finanzas_presupuestos').all(), [{ categoria: 'cafe', limite: 50 }], 'datos intactos');
  assert.deepEqual(roto.prepare('SELECT clave, valor FROM finanzas_config').all(), [{ clave: 'a', valor: '1' }]);
  roto.close();
  // Camino feliz: integridad referencial, indices y sin tablas temporales huerfanas.
  const ok = preparar();
  ejecutarMigraciones(ok);
  assert.deepEqual(ok.prepare('PRAGMA foreign_key_check').all(), [], 'sin violaciones de FK');
  assert.equal(ok.pragma('integrity_check', { simple: true }), 'ok');
  const indices = new Set(ok.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all().map((r) => r.name));
  for (const i of ['idx_memorias_tenant', 'idx_gastos_tenant', 'idx_subs_tenant', 'idx_borr_tenant', 'idx_memorias_categoria', 'idx_memorias_sujeto', 'idx_gastos_fecha', 'idx_gastos_categoria']) {
    assert.ok(indices.has(i), `indice ${i}`);
  }
  const tablas = ok.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name);
  assert.ok(!tablas.some((t) => t.endsWith('_t')), `sin tablas temporales (${tablas})`);
  // FK real: una identidad de un tenant inexistente falla; borrador con gasto inexistente falla.
  assert.throws(() => ok.prepare("INSERT INTO identidades (tenant_id, canal, identificador, creada_en) VALUES ('nadie','w','x','y')").run(), /FOREIGN KEY/);
  ok.close();
});

test('idempotencia: hash del propietario intacto; otro tenant con mismos tool/args/chatId NO comparte entrada ni resultado', async () => {
  const { calcularHashIdempotencia, verificarYRegistrarIdempotencia, guardarResultadoIdempotencia } = await import('../../src/services/idempotencyService.js');
  const base = calcularHashIdempotencia('registrar_gasto', { importe: 5 }, 'c1');
  assert.equal(calcularHashIdempotencia('registrar_gasto', { importe: 5 }, 'c1', undefined), base, 'sin tenant = hash historico');
  assert.equal(calcularHashIdempotencia('registrar_gasto', { importe: 5 }, 'c1', 'propietario'), base, 'propietario = hash historico');
  assert.notEqual(calcularHashIdempotencia('registrar_gasto', { importe: 5 }, 'c1', 'sint-a'), base);
  assert.notEqual(calcularHashIdempotencia('registrar_gasto', { importe: 5 }, 'c1', 'sint-a'), calcularHashIdempotencia('registrar_gasto', { importe: 5 }, 'c1', 'sint-b'));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'davis-idem-'));
  const deps = { rutaArchivo: path.join(dir, 'c.json') };
  const a1 = verificarYRegistrarIdempotencia({ tool: 'registrar_gasto', args: { importe: 5 }, chatId: 'c1' }, deps);
  assert.equal(a1.duplicado, false);
  if (a1.clave) guardarResultadoIdempotencia(a1.clave, 'RESULTADO-PRIVADO-DEL-PROPIETARIO', deps);
  const b1 = verificarYRegistrarIdempotencia({ tool: 'registrar_gasto', args: { importe: 5 }, chatId: 'c1', tenantId: 'sint-a' }, deps);
  assert.equal(b1.duplicado, false, 'otro tenant no ve el registro del propietario');
  assert.ok(!JSON.stringify(b1).includes('PRIVADO'), 'ni su resultado');
  assert.equal(verificarYRegistrarIdempotencia({ tool: 'registrar_gasto', args: { importe: 5 }, chatId: 'c1' }, deps).duplicado, true, 'el propietario si detecta su duplicado');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('historial: claveChatTenant separa tenants con el mismo chatId; propietario intacto; el LLM no recibe historial ajeno', async () => {
  const { claveChatTenant } = await import('../../src/core/tenancy.js');
  const h = await import('../../src/services/conversationHistoryService.js');
  assert.equal(claveChatTenant(undefined, 'c9'), 'c9');
  assert.equal(claveChatTenant('propietario', 'c9'), 'c9');
  assert.notEqual(claveChatTenant('sint-a', 'c9'), claveChatTenant('sint-b', 'c9'));
  assert.throws(() => claveChatTenant('../x', 'c9'));
  const base = 'chat-aislamiento-' + Date.now();
  const kO = claveChatTenant(undefined, base), kA = claveChatTenant('sint-a', base);
  try {
    h.registrarIntercambio(kO, 'SECRETO-PROPIETARIO', 'respuesta-o');
    h.registrarIntercambio(kA, 'dato-de-a', 'respuesta-a');
    const vistoPorA = JSON.stringify(h.obtenerHistorial(kA));
    assert.ok(!vistoPorA.includes('SECRETO-PROPIETARIO'), 'A no ve el historial del propietario');
    assert.ok(vistoPorA.includes('dato-de-a'));
    assert.ok(!JSON.stringify(h.obtenerHistorial(kO)).includes('dato-de-a'), 'el propietario no ve el de A');
    h.limpiarHistorial(kA);
    assert.ok(JSON.stringify(h.obtenerHistorial(kO)).includes('SECRETO-PROPIETARIO'), 'borrar A no toca al propietario');
  } finally { h.limpiarHistorial(kO); h.limpiarHistorial(kA); }
});
