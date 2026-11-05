/**
 * finance_unit.test.js
 * Pruebas unitarias del bloque de finanzas (nº 24-27 del roadmap):
 * gastos (texto y foto->borrador->confirmacion), resumen mensual,
 * suscripciones con aviso previo y presupuestos con alerta al 80%.
 *
 * Strict Policy: Zero Emojis.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'path';
import os from 'os';

const dirEntorno = fs.mkdtempSync(path.join(os.tmpdir(), 'davis-finance-unit-'));
process.env.NODE_ENV = 'test';

const F = await import('../../src/services/financeService.js');

function deps(extra = {}) {
  return {
    rutaArchivo: path.join(dirEntorno, `fin-${Math.random().toString(36).slice(2)}.json`),
    ahora: '2026-11-05T12:00:00Z',
    chatId: '149868706304033@lid',
    enqueue: extra.enqueue || (() => {}),
    ...extra
  };
}

test('registrarGasto valida importe y comercio, y avisa de duplicado del mismo dia', () => {
  const d = deps();
  assert.equal(F.registrarGasto({ importe: -5, comercio: 'Bar' }, d).ok, false);
  assert.equal(F.registrarGasto({ importe: 5 }, d).ok, false);
  const r1 = F.registrarGasto({ importe: 5, comercio: 'Bar', categoria: 'Comida' }, d);
  assert.equal(r1.ok, true);
  assert.equal(r1.gasto.categoria, 'comida');
  assert.equal(r1.gasto.fecha, '2026-11-05');
  assert.equal(r1.gasto.origen, 'manual');
  const r2 = F.registrarGasto({ importe: 5, comercio: 'bar' }, d);
  assert.equal(r2.ok, true);
  assert.ok(r2.aviso, 'avisa del posible duplicado');
});

test('resumenMensual compara con el mes anterior por categoria', () => {
  const d = deps();
  F.registrarGasto({ importe: 100, comercio: 'Super', categoria: 'comida', fecha: '2026-11-03' }, d);
  F.registrarGasto({ importe: 50, comercio: 'Super', categoria: 'comida', fecha: '2026-10-03' }, d);
  const r = F.resumenMensual({ mes: '2026-11' }, d);
  assert.equal(r.totalActual, 100);
  assert.equal(r.totalAnterior, 50);
  assert.equal(r.comparativa[0].variacion, 100);
});

test('suscripciones: ronda avisa 3 dias antes, una sola vez por renovacion', () => {
  const encoladas = [];
  const d = deps({ enqueue: (a) => encoladas.push(a) });
  assert.equal(F.registrarSuscripcion({ nombre: 'Netflix', importe: 12.99, diaRenovacion: 8 }, d).ok, true);
  assert.equal(F.registrarSuscripcion({ nombre: 'Lejos', importe: 5, diaRenovacion: 28 }, d).ok, true);
  const r1 = F.lanzarRondaSuscripciones(d);
  assert.equal(r1.avisadas, 1, 'solo avisa la que renueva en 3 dias');
  assert.match(encoladas[0].title, /Netflix/);
  const r2 = F.lanzarRondaSuscripciones(d);
  assert.equal(r2.avisadas, 0, 'no repite el aviso de la misma renovacion');
});

test('avisos de suscripciones: opt-in explicito del propietario, no basta registrar suscripciones', () => {
  const d = deps();
  F.registrarSuscripcion({ nombre: 'Netflix', importe: 12.99, diaRenovacion: 8 }, d);
  const r0 = F.iniciarMonitorFinanzas(d);
  assert.equal(r0.iniciado, false, 'sin activacion explicita no arranca aunque haya suscripciones');
  assert.match(r0.motivo, /desactivados/i);
  const act = F.configurarAvisosSuscripciones({ activo: true }, d);
  assert.equal(act.ok, true);
  assert.equal(act.activo, true);
  const r1 = F.iniciarMonitorFinanzas(d);
  assert.equal(r1.iniciado, true);
  const des = F.configurarAvisosSuscripciones({ activo: false }, d);
  assert.equal(des.activo, false);
  const r2 = F.iniciarMonitorFinanzas(d);
  assert.equal(r2.iniciado, false);
  F.detenerMonitorFinanzas();
});

test('sin suscripciones registradas el monitor no arranca aunque el aviso este activado', () => {
  const d = deps();
  F.configurarAvisosSuscripciones({ activo: true }, d);
  const r = F.iniciarMonitorFinanzas(d);
  assert.equal(r.iniciado, false);
  assert.match(r.motivo, /Sin suscripciones/);
  F.detenerMonitorFinanzas();
});

test('presupuestos: alerta al superar el 80% del limite', () => {
  const d = deps();
  F.configurarPresupuesto({ categoria: 'ocio', limite: 100 }, d);
  F.registrarGasto({ importe: 85, comercio: 'Cine', categoria: 'ocio', fecha: '2026-11-04' }, d);
  const filas = F.estadoPresupuestos({ mes: '2026-11' }, d);
  assert.equal(filas.length, 1);
  assert.equal(filas[0].porcentaje, 85);
  assert.equal(filas[0].alerta, true);
});

test('borrador de ticket: nada se registra sin confirmacion y declara dudas', () => {
  const d = deps();
  const c = F.crearBorradorDesdeTicket({ importe: 12.5, comercio: 'Mercadona' }, d);
  assert.equal(c.ok, true);
  assert.ok(c.borrador.dudas.includes('moneda'), 'declara la duda de moneda');
  assert.equal(F.listarGastos({}, d).length, 0, 'sin gasto autoritativo todavia');
  assert.match(c.resumen, /No lo registro hasta que confirmes/);
});

test('borrador sin importe legible se rechaza y pide el dato', () => {
  const d = deps();
  const c = F.crearBorradorDesdeTicket({ comercio: 'Bar' }, d);
  assert.equal(c.ok, false);
  assert.match(c.error, /importe/);
  assert.equal(F.borradorPendiente(d), null);
});

test('borrador: aislamiento por chat, caducidad (TTL) y un solo uso', () => {
  const d = deps();
  const otroChat = { ...d, chatId: 'otro@lid' };
  F.crearBorradorDesdeTicket({ importe: 9, comercio: 'Bar' }, d);
  assert.equal(F.borradorPendiente(otroChat), null, 'otro chat no ve el borrador');
  assert.equal(F.confirmarBorrador({}, otroChat).ok, false, 'otro chat no puede confirmarlo');
  const tarde = { ...d, ahora: '2026-11-05T12:31:00Z' };
  assert.equal(F.borradorPendiente(tarde), null, 'caduca pasado el TTL');
  assert.equal(F.confirmarBorrador({}, tarde).ok, false);
  const r = F.confirmarBorrador({}, d);
  assert.equal(r.ok, true);
  assert.equal(r.gasto.origen, 'foto');
  assert.equal(F.confirmarBorrador({}, d).ok, false, 'no se puede confirmar dos veces');
});

test('confirmarBorrador aplica correcciones validadas y mantiene el borrador si fallan', () => {
  const d = deps();
  F.crearBorradorDesdeTicket({ importe: 12.5, comercio: 'Mercadona' }, d);
  assert.equal(F.confirmarBorrador({ correcciones: { importe: -3 } }, d).ok, false);
  assert.ok(F.borradorPendiente(d), 'el borrador sigue pendiente tras correccion invalida');
  const r = F.confirmarBorrador({ correcciones: { importe: 13.2, comercio: 'Lidl', categoria: 'Comida' } }, d);
  assert.equal(r.ok, true);
  assert.equal(r.gasto.importe, 13.2);
  assert.equal(r.gasto.comercio, 'Lidl');
  assert.equal(r.gasto.categoria, 'comida');
});

test('confirmarBorrador exige comercio aunque el parser no lo leyera', () => {
  const d = deps();
  F.crearBorradorDesdeTicket({ importe: 5 }, d);
  const r = F.confirmarBorrador({}, d);
  assert.equal(r.ok, false);
  assert.match(r.error, /comercio/i);
});

test('interpretarRespuestaBorrador: si/no/correcciones y no intercepta texto ajeno', () => {
  assert.deepEqual(F.interpretarRespuestaBorrador('si'), { accion: 'confirmar', correcciones: undefined });
  assert.equal(F.interpretarRespuestaBorrador('no, olvidalo').accion, 'descartar');
  const c = F.interpretarRespuestaBorrador('vale pero importe 13,20 y comercio Lidl');
  assert.equal(c.accion, 'confirmar');
  assert.equal(c.correcciones.importe, 13.2);
  assert.equal(c.correcciones.comercio, 'Lidl');
  assert.equal(F.interpretarRespuestaBorrador('cuentame algo'), null);
});
