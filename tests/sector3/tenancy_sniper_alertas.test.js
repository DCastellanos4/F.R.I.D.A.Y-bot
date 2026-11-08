/**
 * Sniper (tracked_items.json) y cola de alertas (alerts_queue.json) con dueño:
 * un tenant no ve ni cancela lo ajeno (ni con '*'), la ronda de precios no
 * procesa articulos ajenos, y el canal que drena alertas (propietario) nunca
 * recibe ni borra alertas de otro tenant.
 * Strict Policy: Zero Emojis.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'davis-snip-'));
process.env.DAVIS_DATA_DIR = DIR;
const SN = await import('../../src/monitors/sniperService.js');
const AQ = await import('../../src/services/alertQueueService.js');

test('sniper: aislado por dueño en listar, cancelar (incl. todo) y actualizar por nombre', async () => {
  const ruta = path.join(DIR, 'tracked_items.json');
  const item = (id, nombre, extra = {}) => ({ id, nombre, url: `https://x.test/${id}`, precioObjetivo: 10, precioActual: 20, precioInicial: 20, disponible: true, activo: true, alertaDisparada: false, ...extra });
  fs.writeFileSync(ruta, JSON.stringify([item('o1', 'Auriculares Owner'), item('a1', 'Zapatillas Tenant A', { tenantId: 'sint-a' })]));
  assert.deepEqual(SN.listarProductosVigilados().map((i) => i.id), ['o1']);
  assert.deepEqual(SN.listarProductosVigilados({ tenantId: 'sint-a' }).map((i) => i.id), ['a1']);
  assert.equal(SN.cancelarVigilancia('Auriculares', { tenantId: 'sint-a' }).ok, false);
  assert.equal(SN.cancelarVigilancia('o1', { tenantId: 'sint-a' }).ok, false);
  SN.cancelarVigilancia('*', { tenantId: 'sint-a' });
  assert.deepEqual(SN.listarProductosVigilados().map((i) => i.id), ['o1'], 'el propietario sigue intacto');
  assert.deepEqual(SN.listarProductosVigilados({ tenantId: 'sint-a' }), []);
  // actualizar precio por nombre desde otro tenant no toca al propietario
  const r = await SN.vigilarProducto({ nombre: 'Auriculares Owner', precioObjetivo: 1 }, { tenantId: 'sint-b' });
  assert.equal(r.ok, false);
  assert.equal(JSON.parse(fs.readFileSync(ruta, 'utf-8')).find((i) => i.id === 'o1').precioObjetivo, 10);
  // el propietario cancelando todo no borra los de un tenant
  fs.writeFileSync(ruta, JSON.stringify([item('o1', 'Owner'), item('b1', 'B', { tenantId: 'sint-b' })]));
  SN.cancelarVigilancia('*');
  assert.deepEqual(SN.listarProductosVigilados({ tenantId: 'sint-b' }).map((i) => i.id), ['b1']);
  assert.deepEqual(SN.listarProductosVigilados(), []);
});

test('ronda sniper: no procesa articulos de otro tenant', async () => {
  const ruta = path.join(DIR, 'tracked_items.json');
  fs.writeFileSync(ruta, JSON.stringify([{ id: 'x1', nombre: 'Ajeno', url: 'http://127.0.0.1:9/nada', precioObjetivo: 10, precioActual: 20, activo: true, alertaDisparada: false, tenantId: 'sint-b' }]));
  const alertas = [];
  const r = await SN.ejecutarRondaSniper((a) => alertas.push(a));
  assert.deepEqual(r, []);
  assert.deepEqual(alertas, []);
  assert.equal(JSON.parse(fs.readFileSync(ruta, 'utf-8'))[0].ultimaComprobacion, undefined, 'ni siquiera se toco');
});

test('cola de alertas: el drenaje del propietario no entrega ni borra alertas de tenants', () => {
  const queuePath = path.join(DIR, 'q.json');
  AQ.enqueueAlert({ title: 'del-propietario' }, { queuePath });
  AQ.enqueueAlert({ title: 'del-tenant-a' }, { queuePath, tenantId: 'sint-a' });
  assert.equal(AQ.getQueueLength({ queuePath }), 1);
  assert.deepEqual(AQ.peekAlerts({ queuePath }).map((a) => a.title), ['del-propietario']);
  assert.deepEqual(AQ.drainAlerts({ queuePath }).map((a) => a.title), ['del-propietario']);
  assert.deepEqual(AQ.drainAlerts({ queuePath }), [], 'la del tenant no sale por el canal del propietario');
  AQ.clearQueue({ queuePath });
  const crudo = JSON.parse(fs.readFileSync(queuePath, 'utf-8'));
  assert.deepEqual(crudo.map((a) => a.title), ['del-tenant-a'], 'sigue guardada, intacta');
});
