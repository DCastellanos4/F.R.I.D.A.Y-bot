/**
 * deploy_aislamiento.test.js
 *
 * Prueba de la INVOCACION REAL de despliegue (subproceso), no solo
 * aserciones de rutas: replica como deploy.sh lanza la bateria (DAVIS_DATA_DIR
 * y DAVIS_HISTORY_DIR temporales exportados antes de arrancar node), ejecuta
 * escrituras reales a traves de los servicios con estado en disco y verifica:
 *   1) las escrituras caen en el directorio temporal efimero;
 *   2) el data/ del repo (que en el servidor es un enlace simbolico al estado
 *      EN VIVO) queda byte a byte igual (lista de ficheros, tallas y mtimes).
 *
 * Strict Policy: Zero Emojis.
 */
import './setup_aislamiento.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const REPO_DATA = path.join(REPO_ROOT, 'data');

function snapshot(dir) {
  const out = {};
  if (!fs.existsSync(dir)) return out;
  const walk = (d, prefix) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      const rel = prefix ? path.join(prefix, e.name) : e.name;
      if (e.isDirectory()) walk(p, rel);
      else if (e.isFile()) {
        const st = fs.lstatSync(p);
        out[rel] = `${st.size}:${Math.floor(st.mtimeMs)}`;
      }
    }
  };
  walk(dir, '');
  return out;
}

test('invocacion tipo despliegue: escrituras de servicios caen en el efimero y el data/ del repo queda intacto', () => {
  const antes = snapshot(REPO_DATA);
  const tmpData = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'davis-depliso-')), 'data');
  const tmpHist = fs.mkdtempSync(path.join(os.tmpdir(), 'davis-depliso-hist-'));
  fs.mkdirSync(tmpData, { recursive: true });

  const urlMem = pathToFileURL(path.join(REPO_ROOT, 'src/services/memoryService.js')).href;
  const urlAlert = pathToFileURL(path.join(REPO_ROOT, 'src/services/alertQueueService.js')).href;
  const child = [
    `const mem = await import(${JSON.stringify(urlMem)});`,
    `const aq = await import(${JSON.stringify(urlAlert)});`,
    `mem.guardarMemoria({ sujeto: '__aislamiento_despliegue__', dato: 'valor de prueba', categoria: 'general', tags: ['test-aislamiento'] });`,
    `aq.enqueueAlert({ title: '__aislamiento_despliegue__', details: 'prueba de aislamiento' });`,
    `console.log('ESCRITURAS_OK');`
  ].join('\n');

  const r = spawnSync(process.execPath, ['--input-type=module', '-e', child], {
    env: { ...process.env, DAVIS_DATA_DIR: tmpData, DAVIS_HISTORY_DIR: tmpHist, NODE_ENV: 'test' },
    encoding: 'utf-8'
  });
  assert.equal(r.status, 0, `el subproceso fallo: ${r.stderr}`);

  // 1) Las escrituras reales cayeron en el directorio efimero.
  const memoria = JSON.parse(fs.readFileSync(path.join(tmpData, 'brain_memory.json'), 'utf-8'));
  assert.ok(memoria.some((m) => m.sujeto === '__aislamiento_despliegue__'), 'la memoria de prueba debe estar en el efimero');
  const cola = JSON.parse(fs.readFileSync(path.join(tmpData, 'alerts_queue.json'), 'utf-8'));
  assert.ok(cola.some((a) => a.title === '__aislamiento_despliegue__'), 'la alerta de prueba debe estar en el efimero');

  // 2) El data/ del repo (en el servidor: el estado EN VIVO via enlace) no cambio.
  assert.deepEqual(snapshot(REPO_DATA), antes, 'el data/ del repo cambio durante la invocacion tipo despliegue');
});

test('la guardia aborta si DAVIS_DATA_DIR apunta al data/ del repo (falla cerrada)', () => {
  const urlSetup = pathToFileURL(path.join(REPO_ROOT, 'tests/sector2/setup_aislamiento.mjs')).href;
  const child = `await import(${JSON.stringify(urlSetup)});`;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', child], {
    env: { ...process.env, DAVIS_DATA_DIR: REPO_DATA, NODE_ENV: 'test' },
    encoding: 'utf-8'
  });
  assert.notEqual(r.status, 0, 'la guardia debio abortar con el data/ del repo');
  assert.match(r.stderr, /PARADA: DAVIS_DATA_DIR/);
});
