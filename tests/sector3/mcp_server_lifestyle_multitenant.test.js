import test from 'node:test';
import assert from 'node:assert/strict';
import { crearLifestyleDb } from '../../mcp-servers/lifestyle/db.js';

test('Multi-tenant lifestyle: aislamiento estricto de habitos y lista de compra por tenant', () => {
  const db = crearLifestyleDb(':memory:');

  const hoy = '2026-11-20';

  // 1. Registro de habitos independientes con el mismo nombre para distintos tenants
  const habA = db.registrarHabito({ nombre: 'Leer 20 paginas', tenant_id: 'tenant_alfa' });
  assert.equal(habA.ok, true);
  assert.equal(habA.habito.tenant_id, 'tenant_alfa');
  assert.equal(habA.habito.nombre, 'Leer 20 paginas');

  const habB = db.registrarHabito({ nombre: 'Leer 20 paginas', tenant_id: 'tenant_beta' });
  assert.equal(habB.ok, true);
  assert.equal(habB.habito.tenant_id, 'tenant_beta');
  assert.equal(habB.habito.nombre, 'Leer 20 paginas');

  // Duplicado dentro del mismo tenant falla
  assert.throws(() => {
    db.registrarHabito({ nombre: 'Leer 20 paginas', tenant_id: 'tenant_alfa' });
  }, /Ya existe un habito/);

  // 2. Listar habitos aislado por tenant
  const listaA = db.listarHabitos({ hoy, tenant_id: 'tenant_alfa' });
  assert.equal(listaA.total, 1);
  assert.equal(listaA.habitos[0].id, habA.habito.id);

  const listaB = db.listarHabitos({ hoy, tenant_id: 'tenant_beta' });
  assert.equal(listaB.total, 1);
  assert.equal(listaB.habitos[0].id, habB.habito.id);

  // 3. Marcar habito en Tenant Alfa no afecta a Tenant Beta
  const marcA = db.marcarHabito({ criterio: 'leer', fecha: hoy, hoy, tenant_id: 'tenant_alfa' });
  assert.equal(marcA.ok, true);
  assert.equal(marcA.racha, 1);

  const listaBTrasMarca = db.listarHabitos({ hoy, tenant_id: 'tenant_beta' });
  assert.equal(listaBTrasMarca.habitos[0].hecho_hoy, false);
  assert.equal(listaBTrasMarca.habitos[0].racha, 0);

  // 4. Intentar marcar el id del habito de Tenant B desde Tenant Alfa debe fallar
  assert.throws(() => {
    db.marcarHabito({ criterio: habB.habito.id, fecha: hoy, hoy, tenant_id: 'tenant_alfa' });
  }, /No se encontro ningun habito/);

  // 5. Lista de compra aislada por tenant
  const addA = db.anadirCompra({ items: ['Manzanas', 'Peras'], tenant_id: 'tenant_alfa' });
  assert.equal(addA.ok, true);
  assert.equal(addA.total_pendientes, 2);

  const addB = db.anadirCompra({ items: ['Manzanas', 'Platanos'], tenant_id: 'tenant_beta' });
  assert.equal(addB.ok, true);
  assert.equal(addB.total_pendientes, 2);

  const listCmpA = db.listarCompra({ tenant_id: 'tenant_alfa' });
  assert.equal(listCmpA.total, 2);
  assert.deepEqual(listCmpA.items, ['Manzanas', 'Peras']);

  const listCmpB = db.listarCompra({ tenant_id: 'tenant_beta' });
  assert.equal(listCmpB.total, 2);
  assert.deepEqual(listCmpB.items, ['Manzanas', 'Platanos']);

  // 6. Tachar item en Tenant Alfa no afecta a Tenant Beta
  const tachA = db.tacharCompra({ criterio: 'manzanas', tenant_id: 'tenant_alfa' });
  assert.equal(tachA.ok, true);
  assert.equal(tachA.total_pendientes, 1);

  const listCmpB2 = db.listarCompra({ tenant_id: 'tenant_beta' });
  assert.equal(listCmpB2.total, 2);
  assert.ok(listCmpB2.items.includes('Manzanas'));

  // 7. Vaciar lista de compra en Tenant Alfa no borra items de Tenant Beta
  const vaciarA = db.vaciarCompra({ tenant_id: 'tenant_alfa' });
  assert.equal(vaciarA.ok, true);
  assert.equal(vaciarA.eliminados, 1);

  const listCmpA2 = db.listarCompra({ tenant_id: 'tenant_alfa' });
  assert.equal(listCmpA2.total, 0);

  const listCmpB3 = db.listarCompra({ tenant_id: 'tenant_beta' });
  assert.equal(listCmpB3.total, 2);

  db.cerrar();
});
