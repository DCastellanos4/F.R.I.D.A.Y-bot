/**
 * deploy_snapshot_harness.test.js - Ensayo del pipeline de despliegue con
 * pm2/npm/curl FALSOS y un bare repo local: nada toca produccion ni la red.
 *
 * Regresion del incidente del 8 nov 2026: tar sobre el estado EN VIVO salia
 * !=0 ("file changed as we read it"), el .dbk1 parcial quedaba en disco con
 * modo 644 como falso punto de restauracion y el bot NO se rearrancaba.
 *
 * A) tar falla en el snapshot -> deploy PARA antes del corte, el trap
 *    rearranca los procesos y NO queda .dbk1 ni temporal.
 * B) camino feliz -> .dbk1 DBK1 valido con modo 0600 desde su creacion,
 *    symlink cambiado y procesos online.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { PROJECT_ROOT } from '../../src/config/paths.js';

const HARNESS = path.join(PROJECT_ROOT, 'tests', 'harness', 'deploy_snapshot_harness.sh');

function correr(escenario) {
  try {
    const salida = execFileSync('bash', [HARNESS, escenario], { encoding: 'utf8', timeout: 120000 });
    return { rc: 0, salida };
  } catch (err) {
    return { rc: err.status ?? 1, salida: String(err.stdout || '') + String(err.stderr || '') };
  }
}

test('harness A: snapshot con tar fallido -> PARADA, procesos recuperados, sin punto de restauracion falso', { timeout: 120000 }, () => {
  const { rc, salida } = correr('A');
  assert.notEqual(rc, 0, 'el despliegue debe FALLAR (no maquillar el snapshot)');
  assert.match(salida, /pm2-final=online/, `el trap rearranco los writers tras el fallo:\n${salida}`);
  assert.match(salida, /backups: \(sin dbk1\)/, `ningun .dbk1/temporal residual:\n${salida}`);
  assert.match(salida, /symlink=\(no existe\)/, `sin corte: el symlink nunca se toco:\n${salida}`);
});

test('harness B: despliegue feliz -> dbk1 valido 0600, corte y procesos online', { timeout: 120000 }, () => {
  const { rc, salida } = correr('B');
  assert.equal(rc, 0, salida);
  assert.match(salida, /pm2-final=online/);
  assert.match(salida, /-rw------- .*\.dbk1/, `dbk1 con modo 0600:\n${salida}`);
  assert.match(salida, /symlink=.*releases\//, `corte realizado:\n${salida}`);
});

test('harness C: writer a medio parar (stopping) -> PARADA antes de copiar, sin tar ni corte', { timeout: 120000 }, () => {
  const { rc, salida } = correr('C');
  assert.notEqual(rc, 0);
  assert.match(salida, /writers no parados del todo/, salida);
  assert.match(salida, /backups: \(sin dbk1\)/, salida);
  assert.match(salida, /symlink=\(no existe\)/, salida);
});

test('harness D: writers ya parados a proposito + tar falla -> estado parado RESPETADO (no se arrancan)', { timeout: 120000 }, () => {
  const { rc, salida } = correr('D');
  assert.notEqual(rc, 0);
  assert.match(salida, /pm2-final=stopped/, `un fallo de snapshot NO debe arrancar lo que estaba parado deliberadamente:\n${salida}`);
  assert.match(salida, /se respeta ese estado parado/, salida);
  assert.match(salida, /backups: \(sin dbk1\)/, salida);
});

test('harness E: arranque de la nueva release falla TRAS el corte -> ESTADO PARCIAL explicito, sin auto-revert, restauracion manual segura', { timeout: 120000 }, () => {
  const { rc, salida } = correr('E');
  assert.notEqual(rc, 0);
  assert.match(salida, /ESTADO PARCIAL TRAS EL CORTE/, salida);
  assert.match(salida, /symlink=.*releases\//, `el corte ocurrio y se REPORTA, no se oculta ni se revierte solo:\n${salida}`);
  assert.match(salida, /-rw------- .*\.dbk1/, `existe punto de restauracion valido 0600 para la decision manual:\n${salida}`);
});
