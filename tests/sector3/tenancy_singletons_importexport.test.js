// Singletons por defecto (memoria/finanzas/libro de uso) con alternancia de
// tenants y llamadas concurrentes, y estadoTablas acotado al propietario.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { ejecutarMigraciones } from '../../src/adapters/outbound/persistence/sqlite/migraciones.js';
import { crearSqliteMemoryStore } from '../../src/adapters/outbound/persistence/sqlite/sqliteMemoryStore.js';
import { crearSqliteFinanceStore } from '../../src/adapters/outbound/persistence/sqlite/sqliteFinanceStore.js';
import { crearSqliteTenantRepository } from '../../src/adapters/outbound/persistence/sqlite/sqliteTenantRepository.js';
import { crearSqliteUsageStore } from '../../src/adapters/outbound/persistence/sqlite/sqliteUsageStore.js';
import { importarJsonASqlite, comprobarEstadoConsistente } from '../../src/adapters/outbound/persistence/sqlite/importExport.js';
import { guardarMemoria, listarMemorias, registrarStoreMemoriasPorDefecto } from '../../src/services/memoryService.js';
import { registrarGasto, listarGastos, registrarStoreFinanzasPorDefecto } from '../../src/services/financeService.js';
import { medirUso, registrarStoreUsoPorDefecto } from '../../src/services/usageLedgerService.js';

function montar() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  ejecutarMigraciones(db);
  const repo = crearSqliteTenantRepository(db);
  repo.registrarTenant({ id: 'sint-a', nombre: 'A' });
  repo.registrarTenant({ id: 'sint-b', nombre: 'B' });
  return db;
}

test('singleton memoria: alternar propietario (defecto) y tenants con store explicito no mezcla', () => {
  const db = montar();
  const o = crearSqliteMemoryStore(db);
  const a = crearSqliteMemoryStore(db, { tenantId: 'sint-a' });
  const b = crearSqliteMemoryStore(db, { tenantId: 'sint-b' });
  registrarStoreMemoriasPorDefecto(o);
  try {
    for (let i = 0; i < 5; i++) {
      guardarMemoria({ sujeto: `o${i}`, dato: `dato-o-${i}` });
      guardarMemoria({ sujeto: `a${i}`, dato: `dato-a-${i}`, store: a });
      guardarMemoria({ sujeto: `b${i}`, dato: `dato-b-${i}`, store: b });
    }
    const datos = (lista) => lista.map((m) => String(m.dato)).join('|');
    assert.equal(/dato-[ab]-/.test(datos(listarMemorias(null))), false, 'defecto = propietario, sin datos de tenants');
    assert.equal(/dato-[ob]-/.test(datos(listarMemorias(null, { store: a }))), false);
    assert.equal(/dato-[oa]-/.test(datos(listarMemorias(null, { store: b }))), false);
    assert.equal(listarMemorias(null, { store: a }).length, 5);
  } finally {
    registrarStoreMemoriasPorDefecto(null);
    db.close();
  }
});

test('singleton finanzas: alternancia y concurrencia (microtareas intercaladas) sin mezcla', async () => {
  const db = montar();
  const o = crearSqliteFinanceStore(db);
  const a = crearSqliteFinanceStore(db, { tenantId: 'sint-a' });
  const b = crearSqliteFinanceStore(db, { tenantId: 'sint-b' });
  registrarStoreFinanzasPorDefecto(o);
  try {
    const g = (c) => ({ importe: 1, comercio: c, categoria: 'x', fecha: '2026-01-01' });
    await Promise.all([0, 1, 2, 3].flatMap((i) => [
      Promise.resolve().then(() => registrarGasto(g(`o${i}`))),
      Promise.resolve().then(() => registrarGasto(g(`a${i}`), { store: a })),
      Promise.resolve().then(() => registrarGasto(g(`b${i}`), { store: b }))
    ]));
    const com = (r) => (r.gastos || r).map((x) => x.comercio).join('|');
    const lo = com(listarGastos({})); const la = com(listarGastos({}, { store: a })); const lb = com(listarGastos({}, { store: b }));
    assert.equal(/[ab]\d/.test(lo), false);
    assert.equal(/[ob]\d/.test(la), false);
    assert.equal(/[oa]\d/.test(lb), false);
    assert.equal(la.split('|').length, 4);
  } finally {
    registrarStoreFinanzasPorDefecto(null);
    db.close();
  }
});

test('singleton libro de uso: cada tenant se mide en su fila; el defecto no absorbe tokens ajenos', () => {
  const db = montar();
  const store = crearSqliteUsageStore(db);
  registrarStoreUsoPorDefecto(store);
  try {
    const ahora = new Date('2026-03-01T10:00:00');
    for (let i = 0; i < 3; i++) {
      medirUso({ tenantId: 'sint-a', modelo: 'm', usage: { prompt_tokens: 10, completion_tokens: 1 }, ahora });
      medirUso({ tenantId: 'sint-b', modelo: 'm', usage: { prompt_tokens: 100, completion_tokens: 2 }, ahora });
      medirUso({ modelo: 'm', usage: { prompt_tokens: 1000, completion_tokens: 3 }, ahora });
    }
    assert.equal(medirUso({ tenantId: '../x', modelo: 'm', usage: { prompt_tokens: 5000, completion_tokens: 1 }, ahora }), false, 'tenant invalido: no se mide');
    const filas = db.prepare('SELECT tenant_id, SUM(entrada) e, SUM(salida) s FROM uso_tokens GROUP BY tenant_id ORDER BY tenant_id').all();
    const por = Object.fromEntries(filas.map((f) => [f.tenant_id, [f.e, f.s]]));
    assert.deepEqual(por['sint-a'], [30, 3]);
    assert.deepEqual(por['sint-b'], [300, 6]);
    assert.deepEqual(por['propietario'], [3000, 9]);
  } finally {
    registrarStoreUsoPorDefecto(null);
    db.close();
  }
});

test('importExport: filas de tenants no bloquean la importacion del propietario ni cuentan en su integridad', () => {
  const db = montar();
  // Un tenant ya tiene datos, la base no tiene marca de origen.
  crearSqliteMemoryStore(db, { tenantId: 'sint-a' }).guardar([{ id: 'm1', sujeto: 's', dato: 'd', categoria: 'general', tags: [], fechaRegistro: '2026-01-01T00:00:00.000Z' }]);
  assert.equal(comprobarEstadoConsistente(db), null, 'solo datos de tenant: no es proveniencia desconocida del propietario');
  const r = importarJsonASqlite(db, { memoryStore: crearSqliteMemoryStore(db), financeStore: crearSqliteFinanceStore(db) });
  assert.equal(r.ok, true);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM memorias WHERE tenant_id='sint-a'").get().n, 1, 'datos del tenant intactos');
  db.close();
});

test('importExport: datos del PROPIETARIO sin marca de origen siguen fallando cerrado', () => {
  const db = montar();
  crearSqliteMemoryStore(db).guardar([{ id: 'm1', sujeto: 's', dato: 'd', categoria: 'general', tags: [], fechaRegistro: '2026-01-01T00:00:00.000Z' }]);
  assert.match(String(comprobarEstadoConsistente(db)), /proveniencia desconocida/);
  const r = importarJsonASqlite(db, { memoryStore: crearSqliteMemoryStore(db), financeStore: crearSqliteFinanceStore(db) });
  assert.equal(r.ok, false);
  db.close();
});
