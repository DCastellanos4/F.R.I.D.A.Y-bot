/**
 * env_boot_contract.test.js - Contrato de arranque de variables de entorno.
 *
 * Fallo observado en produccion (7 nov 2026): las variables nuevas del
 * lector de tickets se persistieron en el .env del estado compartido
 * (jarvis-estado) pero un reinicio de pm2 no las recogia sin export manual,
 * porque el bot solo leia <repo>/.env.
 *
 * El contrato: se leen DAVIS_ENV_FILE, <DATA_DIR>/.env y <repo>/.env (el
 * primero que define cada variable gana; nada del entorno del proceso se
 * pisa). Se prueba en subprocesos reales para ver el arranque tal cual.
 *
 * Strict Policy: Zero Emojis.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { PROJECT_ROOT } from '../../src/config/paths.js';

const CONFIG_URL = pathToFileURL(path.join(PROJECT_ROOT, 'src', 'config', 'config.js')).href;

function arranqueConEnv(envExtra) {
  const script = `await import(${JSON.stringify(CONFIG_URL)}); process.stdout.write(String(process.env.DAVIS_PRUEBA_CONTRATO || 'AUSENTE') + '|' + String(process.env.DAVIS_PRUEBA_PRIORIDAD || 'AUSENTE'));`;
  return execFileSync(process.execPath, ['--input-type=module', '-e', script], {
    // El contrato que se prueba es el de arranque NORMAL (produccion): el
    // subproceso sale explicitamente del modo test (que ahora aísla .env).
    env: { ...process.env, NODE_ENV: 'production', ...envExtra },
    encoding: 'utf8'
  });
}

test('una variable persistida en <DATA_DIR>/.env entra en el arranque sin exports', () => {
  const estado = fs.mkdtempSync(path.join(os.tmpdir(), 'davis-estado-'));
  fs.writeFileSync(path.join(estado, '.env'), 'DAVIS_PRUEBA_CONTRATO=desde-estado\n', 'utf8');
  const salida = arranqueConEnv({ DAVIS_DATA_DIR: estado });
  assert.equal(salida.split('|')[0], 'desde-estado');
});

test('DAVIS_ENV_FILE tiene prioridad sobre <DATA_DIR>/.env', () => {
  const estado = fs.mkdtempSync(path.join(os.tmpdir(), 'davis-estado-'));
  fs.writeFileSync(path.join(estado, '.env'), 'DAVIS_PRUEBA_PRIORIDAD=estado\n', 'utf8');
  const explicito = path.join(estado, 'custom.env');
  fs.writeFileSync(explicito, 'DAVIS_PRUEBA_PRIORIDAD=explicito\n', 'utf8');
  const salida = arranqueConEnv({ DAVIS_DATA_DIR: estado, DAVIS_ENV_FILE: explicito });
  assert.equal(salida.split('|')[1], 'explicito');
});

test('una variable ya presente en el entorno del proceso NUNCA se pisa', () => {
  const estado = fs.mkdtempSync(path.join(os.tmpdir(), 'davis-estado-'));
  fs.writeFileSync(path.join(estado, '.env'), 'DAVIS_PRUEBA_CONTRATO=del-fichero\n', 'utf8');
  const salida = arranqueConEnv({ DAVIS_DATA_DIR: estado, DAVIS_PRUEBA_CONTRATO: 'del-proceso' });
  assert.equal(salida.split('|')[0], 'del-proceso');
});

test('AISLAMIENTO: con NODE_ENV=test no se carga NINGUN .env de estado/repo (sentinel)', () => {
  const estado = fs.mkdtempSync(path.join(os.tmpdir(), 'davis-estado-'));
  fs.writeFileSync(path.join(estado, '.env'), 'DAVIS_PRUEBA_CONTRATO=sentinel-produccion-no-heredar\n', 'utf8');
  const script = `await import(${JSON.stringify(CONFIG_URL)}); process.stdout.write(String(process.env.DAVIS_PRUEBA_CONTRATO || 'AUSENTE'));`;
  const salida = execFileSync(process.execPath, ['--input-type=module', '-e', script], {
    env: { ...process.env, NODE_ENV: 'test', DAVIS_DATA_DIR: estado, DAVIS_ENV_FILE: '' },
    encoding: 'utf8'
  });
  assert.equal(salida, 'AUSENTE', 'el sentinel del .env de produccion NO entra en procesos de test');
});
