/**
 * Politica del watchdog de Docker: distingue ausente, denegado persistente,
 * transitorio y desconocido. Sin privilegios nuevos ni autocuracion ajena.
 * Todo inyectado: no hay Docker ni timers reales.
 * Strict Policy: Zero Emojis.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
const { clasificarFalloDocker } = await import('../../src/monitors/dockerMonitorService.js');
const { iniciarWatchdogDocker } = await import('../../whatsappBot.js');

const PERM = 'Fallo al inspeccionar contenedores Docker (exit code 1): permission denied while trying to connect to the Docker daemon socket at unix:///var/run/docker.sock';
const DAEMON = 'Cannot connect to the Docker daemon at unix:///var/run/docker.sock. Is the docker daemon running?';

function mk(inspect, heal = async () => ({})) {
  const logs = []; const errs = []; const ticks = { fns: [], cleared: 0 };
  return {
    logs, errs, ticks,
    deps: {
      inspect, heal,
      log: (...a) => logs.push(a.join(' ')),
      logErr: (...a) => errs.push(a.join(' ')),
      every: (fn) => { ticks.fns.push(fn); return ticks.fns.length; },
      clear: () => { ticks.cleared += 1; },
      sleep: async () => {},
    },
  };
}

test('clasificacion: denegado gana sobre daemon, ausente, transitorio, desconocido', () => {
  assert.equal(clasificarFalloDocker(PERM), 'denegado');
  assert.equal(clasificarFalloDocker('permission denied ... Cannot connect to the Docker daemon'), 'denegado');
  assert.equal(clasificarFalloDocker('spawn docker ENOENT'), 'ausente');
  assert.equal(clasificarFalloDocker(DAEMON), 'transitorio');
  assert.equal(clasificarFalloDocker('algo raro'), 'desconocido');
  assert.equal(clasificarFalloDocker(undefined), 'desconocido');
});

test('ausente: un aviso y sin intervalo', async () => {
  const t = mk(async () => { throw new Error('spawn docker ENOENT'); });
  const r = await iniciarWatchdogDocker(t.deps);
  assert.equal(r.estado, 'ausente');
  assert.equal(t.ticks.fns.length, 0);
  assert.equal(t.logs.length, 1);
});

test('denegado persistente (2 sondeos): un aviso, sin intervalo, sin errores repetidos', async () => {
  let n = 0;
  const t = mk(async () => { n += 1; throw new Error(PERM); });
  const r = await iniciarWatchdogDocker(t.deps);
  assert.equal(r.estado, 'denegado');
  assert.equal(n, 2);
  assert.equal(t.ticks.fns.length, 0);
  assert.equal(t.logs.length, 1);
  assert.equal(t.errs.length, 0);
});

test('denegado solo la primera vez: se recupera y arranca el intervalo', async () => {
  let n = 0;
  const t = mk(async () => { n += 1; if (n === 1) throw new Error(PERM); return []; });
  const r = await iniciarWatchdogDocker(t.deps);
  assert.equal(r.estado, 'activo');
  assert.equal(t.ticks.fns.length, 1);
});

test('transitorio (daemon caido): el intervalo arranca para poder recuperar; solo se registra el primer fallo', async () => {
  let vivo = false;
  const t = mk(async () => { throw new Error(DAEMON); }, async () => { if (!vivo) throw new Error(DAEMON); return {}; });
  const r = await iniciarWatchdogDocker(t.deps);
  assert.equal(r.estado, 'activo');
  assert.equal(t.errs.length, 1, 'un aviso del sondeo');
  const tick = t.ticks.fns[0];
  await tick(); await tick(); await tick();
  assert.equal(t.errs.length, 2, 'un unico aviso del bucle, no uno por minuto');
  vivo = true;
  await tick();
  assert.ok(t.logs.some((l) => /vuelve a responder/.test(l)));
  assert.equal(t.ticks.cleared, 0);
});

test('desconocido: no se desactiva', async () => {
  const t = mk(async () => { throw new Error('algo raro'); });
  const r = await iniciarWatchdogDocker(t.deps);
  assert.equal(r.estado, 'activo');
});

test('acceso perdido en marcha: 3 pasadas denegadas seguidas detienen el intervalo; una suelta no', async () => {
  let modo = 'perm';
  const t = mk(async () => [], async () => { if (modo === 'perm') throw new Error(PERM); return {}; });
  await iniciarWatchdogDocker(t.deps);
  const tick = t.ticks.fns[0];
  await tick(); await tick();
  assert.equal(t.ticks.cleared, 0);
  modo = 'ok'; await tick();
  modo = 'perm'; await tick(); await tick();
  assert.equal(t.ticks.cleared, 0, 'la racha se reinicia tras un exito');
  await tick();
  assert.equal(t.ticks.cleared, 1);
  assert.ok(t.logs.some((l) => /perdido de forma sostenida/.test(l)));
});
