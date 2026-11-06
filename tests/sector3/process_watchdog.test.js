/**
 * process_watchdog.test.js
 * Pruebas unitarias del vigilante de procesos y recursos (nº 17): registro
 * con limites, opt-in explicito de la vigilancia proactiva, transiciones
 * vivo/caido (un aviso por cambio) y alertas de recursos con enfriamiento,
 * con ejecucion de procesos inyectada (sin tocar el sistema real).
 *
 * Strict Policy: Zero Emojis.
 */
import '../sector2/setup_aislamiento.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'path';
import os from 'os';

const dirEntorno = fs.mkdtempSync(path.join(os.tmpdir(), 'davis-proc-unit-'));
process.env.NODE_ENV = 'test';

const W = await import('../../src/services/processWatchdogService.js');

function deps(extra = {}) {
  return {
    rutaArchivo: path.join(dirEntorno, `proc-${Math.random().toString(36).slice(2)}.json`),
    ahora: '2026-11-05T12:00:00Z',
    enqueue: extra.enqueue || (() => {}),
    execFile: extra.execFile,
    ...extra
  };
}

function execSimulado(estado) {
  return async (cmd, args) => {
    if (cmd === 'pgrep') {
      const patron = args[1];
      if (estado.vivos.includes(patron)) return { stdout: '101\n102\n' };
      const err = new Error('sin coincidencias');
      err.code = 1;
      throw err;
    }
    if (cmd === 'ps') return { stdout: estado.uso || ' 2.5  1.2\n' };
    throw new Error('comando inesperado');
  };
}

test('registro valida nombre, patron y limites', () => {
  const d = deps();
  assert.equal(W.registrarProceso({}, d).ok, false);
  assert.equal(W.registrarProceso({ nombre: 'x', patron: 'node; rm -rf /' }, d).ok, false);
  assert.equal(W.registrarProceso({ nombre: 'x', cpuLimite: 150 }, d).ok, false);
  const ok = W.registrarProceso({ nombre: 'node', cpuLimite: 80, memLimite: 70 }, d);
  assert.equal(ok.ok, true);
  assert.equal(ok.proceso.patron, 'node');
  assert.equal(W.registrarProceso({ nombre: 'NODE' }, d).ok, false, 'sin duplicados');
});

test('opt-in explicito: registrar procesos no activa la vigilancia', () => {
  const d = deps();
  W.registrarProceso({ nombre: 'node' }, d);
  const r0 = W.iniciarMonitorProcesos(d);
  assert.equal(r0.iniciado, false);
  assert.match(r0.motivo, /activa/i);
  assert.equal(W.configurarVigilancia({ activo: true }, d).activo, true);
  assert.equal(W.iniciarMonitorProcesos(d).iniciado, true);
  W.configurarVigilancia({ activo: false }, d);
  assert.equal(W.iniciarMonitorProcesos(d).iniciado, false);
  W.detenerMonitorProcesos();
});

test('sin procesos registrados el vigilante no arranca aunque este activado', () => {
  const d = deps();
  W.configurarVigilancia({ activo: true }, d);
  assert.equal(W.iniciarMonitorProcesos(d).iniciado, false);
  W.detenerMonitorProcesos();
});

test('transicion vivo->caido avisa una sola vez por cambio', async () => {
  const encoladas = [];
  const estado = { vivos: ['node'] };
  const d = deps({ enqueue: (a) => encoladas.push(a), execFile: execSimulado(estado) });
  W.registrarProceso({ nombre: 'node' }, d);
  await W.comprobarProcesos(d);
  assert.equal(encoladas.length, 0, 'primera ronda solo fija el estado');
  estado.vivos = [];
  await W.comprobarProcesos(d);
  assert.equal(encoladas.length, 1);
  assert.match(encoladas[0].title, /caido/i);
  await W.comprobarProcesos(d);
  assert.equal(encoladas.length, 1, 'no repite mientras siga caido');
  estado.vivos = ['node'];
  await W.comprobarProcesos(d);
  assert.equal(encoladas.length, 2);
  assert.match(encoladas[1].title, /recuperado/i);
});

test('alerta de recursos al superar el limite, con enfriamiento de 30 minutos', async () => {
  const encoladas = [];
  const estado = { vivos: ['java'], uso: ' 95.0  10.0\n' };
  const d = deps({ enqueue: (a) => encoladas.push(a), execFile: execSimulado(estado) });
  W.registrarProceso({ nombre: 'java', cpuLimite: 80 }, d);
  await W.comprobarProcesos(d);
  assert.equal(encoladas.length, 1);
  assert.match(encoladas[0].title, /pasado de recursos/);
  assert.match(encoladas[0].details, /CPU al 95/);
  await W.comprobarProcesos(d);
  assert.equal(encoladas.length, 1, 'enfriamiento: no repite en la siguiente ronda');
  const tarde = deps({ ...d, ahora: '2026-11-05T12:31:00Z' });
  await W.comprobarProcesos(tarde);
  assert.equal(encoladas.length, 2, 'vuelve a avisar pasado el enfriamiento');
});

test('dejarDeVigilar quita el proceso', () => {
  const d = deps();
  W.registrarProceso({ nombre: 'node' }, d);
  assert.equal(W.dejarDeVigilar('node', d).ok, true);
  assert.equal(W.listarProcesos(d).length, 0);
  assert.equal(W.dejarDeVigilar('node', d).ok, false);
});
