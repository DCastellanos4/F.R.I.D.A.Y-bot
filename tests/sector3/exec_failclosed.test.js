/**
 * exec_failclosed.test.js - Regresion del incidente del 8 nov 2026: la
 * puerta de tests del VPS ejecuto 'pm2 restart jarvis-api' REAL desde
 * integration.test.js y reinicio produccion. Ahora, con NODE_ENV=test y
 * sin runner/execFile inyectado ni opt-in por llamada, sysCommandRunner FALLA CERRADO y ningun
 * comando real alcanza el anfitrion. Sentinel: un comando de escritura
 * fuera del area de pruebas NO se ejecuta.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { runCommand } from '../../src/system/sysCommandRunner.js';

const SENTINEL = '/tmp/davis-sentinel-fuera-de-area-pruebas-NO-DEBE-EXISTIR';

test('FAIL-CLOSED: ejecucion real sin aislar bajo NODE_ENV=test lanza y NO ejecuta (sentinel)', async () => {
  fs.rmSync(SENTINEL, { force: true });
  await assert.rejects(
    runCommand(`touch ${SENTINEL}`, [], { shell: true }),
    (err) => {
      assert.equal(err.code, 'DAVIS_TEST_REAL_EXEC_BLOQUEADO');
      return true;
    }
  );
  assert.equal(fs.existsSync(SENTINEL), false, 'el comando NUNCA se ejecuto: el sentinel no existe');
});

test('FAIL-CLOSED: pm2 restart real tampoco pasa sin inyeccion', async () => {
  await assert.rejects(
    runCommand('pm2 restart jarvis-api', [], { shell: true }),
    (err) => err.code === 'DAVIS_TEST_REAL_EXEC_BLOQUEADO'
  );
});

test('runner inyectado SI funciona en test (aislamiento explicito)', async () => {
  const vistos = [];
  const res = await runCommand('pm2 restart jarvis-api', [], { shell: true }, {
    runner: async (cmd) => { vistos.push(cmd); return { exitCode: 0, stdout: 'fake', stderr: '' }; }
  });
  assert.equal(res.ok, true);
  assert.deepEqual(vistos, ['pm2 restart jarvis-api']);
});
