/**
 * ops_unit.test.js
 * Pruebas unitarias del bloque 13 (nº 10 dependencias, nº 11 metricas,
 * nº 12 repos, nº 16 backup). Todo con deps inyectadas: nada de npm, red
 * ni openssl reales.
 *
 * Strict Policy: Zero Emojis.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'os';
import {
  auditarDependencias, configurarVigilanciaDependencias, comprobarDependenciasProgramado,
  registrarEventoMetrica, informeMetricas, configurarInformeMetricas, comprobarInformeSemanal,
  actividadRepos, configurarAlertasRepos, comprobarActividadRepos,
  crearBackupSesion, verificarBackupSesion, ARCHIVO_CONFIG_OPS_DEFECTO
} from '../../src/services/opsService.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'davis-ops-'));
const rutaConfig = path.join(tmp, 'ops_config.json');
const rutaMetricas = path.join(tmp, 'metricas.jsonl');

const AUDIT_JSON = JSON.stringify({
  vulnerabilities: {
    'paquete-malo': { severity: 'critical', isDirect: true, fixAvailable: { name: 'paquete-malo', version: '2.0.0', isSemVerMajor: true } },
    'otro-paq': { severity: 'moderate', isDirect: false, fixAvailable: true }
  },
  metadata: { vulnerabilities: { critical: 1, high: 0, moderate: 1, low: 0 } }
});

test('nº10 npm audit: resume por severidad, propone sin actualizar, codigo 1 no es fallo', async () => {
  const execComando = async (cmd, args) => {
    assert.equal(cmd, 'npm');
    assert.deepEqual(args, ['audit', '--json']);
    return { codigo: 1, salida: AUDIT_JSON }; // npm audit devuelve 1 cuando HAY vulnerabilidades
  };
  const r = await auditarDependencias({ execComando });
  assert.equal(r.ok, true);
  assert.equal(r.totales.critica, 1);
  assert.equal(r.totales.moderada, 1);
  assert.equal(r.vulnerabilidades[0].nombre, 'paquete-malo', 'la critica primero');
  assert.match(r.vulnerabilidades[0].correccion, /cambio mayor/);
  assert.match(r.nota, /No he actualizado nada/);
  const sinVuln = await auditarDependencias({ execComando: async () => ({ codigo: 0, salida: '{"vulnerabilities":{},"metadata":{"vulnerabilities":{}}}' }) });
  assert.equal(sinVuln.ok, true);
  assert.equal(sinVuln.vulnerabilidades.length, 0);
});

test('nº10 vigilancia programada: sin opt-in no hace nada; con opt-in avisa solo si hay graves', async () => {
  const execGrave = async () => ({ codigo: 1, salida: AUDIT_JSON });
  const apagada = await comprobarDependenciasProgramado({ rutaConfig: rutaConfig, execComando: execGrave });
  assert.equal(apagada.avisos, 0, 'sin opt-in no audita ni avisa');
  assert.match(apagada.motivo, /opt-in/);
  configurarVigilanciaDependencias({ activo: true }, { rutaConfig: rutaConfig });
  const encoladas = [];
  const encendida = await comprobarDependenciasProgramado({ rutaConfig: rutaConfig, execComando: execGrave, enqueue: (a) => encoladas.push(a) });
  assert.equal(encendida.avisos, 1);
  assert.match(encoladas[0].title, /1 vulnerabilidad\(es\) grave/);
  const execLimpio = async () => ({ codigo: 0, salida: '{"vulnerabilities":{},"metadata":{"vulnerabilities":{}}}' });
  const limpia = await comprobarDependenciasProgramado({ rutaConfig: rutaConfig, execComando: execLimpio, enqueue: (a) => encoladas.push(a) });
  assert.equal(limpia.avisos, 0, 'sin graves no avisa');
});

test('nº11 metricas: registra, agrega ranking/tiempos/errores; informe semanal solo opt-in y semanal', async () => {
  const ahora = '2026-11-05T16:00:00+01:00';
  registrarEventoMetrica({ tipo: 'comando', nombre: 'consulta_jarvis', duracionMs: 1200 }, { rutaArchivo: rutaMetricas, ahora });
  registrarEventoMetrica({ tipo: 'comando', nombre: 'consulta_jarvis', duracionMs: 800 }, { rutaArchivo: rutaMetricas, ahora });
  registrarEventoMetrica({ tipo: 'comando', nombre: 'sniper', duracionMs: 300 }, { rutaArchivo: rutaMetricas, ahora });
  registrarEventoMetrica({ tipo: 'error', nombre: 'consulta_jarvis', detalle: 'timeout LLM' }, { rutaArchivo: rutaMetricas, ahora });
  const r = informeMetricas({ dias: 7 }, { rutaArchivo: rutaMetricas, ahora });
  assert.equal(r.totalComandos, 3);
  assert.equal(r.totalErrores, 1);
  assert.equal(r.comandosMasUsados[0].nombre, 'consulta_jarvis');
  assert.equal(r.comandosMasUsados[0].usos, 2);
  assert.equal(r.comandosMasUsados[0].mediaMs, 1000);
  assert.match(r.erroresRecientes[0], /timeout LLM/);

  const cfg = path.join(tmp, 'ops_config2.json');
  const apagado = await comprobarInformeSemanal({ rutaConfig: cfg, rutaArchivo: rutaMetricas, ahora });
  assert.equal(apagado.avisos, 0);
  configurarInformeMetricas({ activo: true }, { rutaConfig: cfg });
  const encoladas = [];
  const primero = await comprobarInformeSemanal({ rutaConfig: cfg, rutaArchivo: rutaMetricas, ahora, enqueue: (a) => encoladas.push(a) });
  assert.equal(primero.avisos, 1);
  assert.match(encoladas[0].body, /Comandos: 3/);
  const segundo = await comprobarInformeSemanal({ rutaConfig: cfg, rutaArchivo: rutaMetricas, ahora, enqueue: (a) => encoladas.push(a) });
  assert.equal(segundo.avisos, 0, 'cadencia semanal: no repite el mismo dia');
});

test('nº12 repos: instantanea publica; alertas solo opt-in, referencia inicial y aviso de cambios', async () => {
  const stats = { 'DCastellanos4/F.R.I.D.A.Y-bot': { s: 5, f: 1, i: 2 } };
  const fetchFalso = async (url) => {
    const repo = url.split('/repos/')[1];
    const st = stats[repo];
    return { ok: true, text: async () => JSON.stringify({ stargazers_count: st.s, forks_count: st.f, open_issues_count: st.i }) };
  };
  const cfg = path.join(tmp, 'ops_config3.json');
  const snap = await actividadRepos({}, { fetchFn: fetchFalso, rutaConfig: cfg });
  assert.equal(snap.ok, true);
  assert.equal(snap.repos[0].estrellas, 5);

  const apagadas = await comprobarActividadRepos({ rutaConfig: cfg, fetchFn: fetchFalso });
  assert.equal(apagadas.avisos, 0);
  configurarAlertasRepos({ activo: true }, { rutaConfig: cfg });
  const primera = await comprobarActividadRepos({ rutaConfig: cfg, fetchFn: fetchFalso });
  assert.equal(primera.avisos, 0, 'primera lectura: solo referencia');
  stats['DCastellanos4/F.R.I.D.A.Y-bot'].s = 7;
  stats['DCastellanos4/F.R.I.D.A.Y-bot'].i = 3;
  const encoladas = [];
  const segunda = await comprobarActividadRepos({ rutaConfig: cfg, fetchFn: fetchFalso, enqueue: (a) => encoladas.push(a) });
  assert.equal(segunda.avisos, 1);
  assert.match(encoladas[0].body, /estrellas 5 -> 7/);
  assert.match(encoladas[0].body, /issues 2 -> 3/);
  const tercera = await comprobarActividadRepos({ rutaConfig: cfg, fetchFn: fetchFalso, enqueue: (a) => encoladas.push(a) });
  assert.equal(tercera.avisos, 0, 'sin cambios no repite');
});

test('nº16 backup: sin clave config-required; clave corta rechazada; roundtrip GCM autenticado sin claro en disco', async () => {
  const sinClave = await crearBackupSesion({ claveBackup: null, carpetaSesion: tmp });
  assert.equal(sinClave.ok, false);
  assert.equal(sinClave.configRequired, true);
  assert.match(sinClave.error, /nunca por chat/);

  const corta = await crearBackupSesion({ claveBackup: 'corta', carpetaSesion: tmp });
  assert.equal(corta.ok, false);
  assert.equal(corta.configRequired, true);
  assert.match(corta.error, /minimo 16 caracteres/, 'validacion de clave');

  const sesionFalsa = path.join(tmp, 'auth_info_baileys');
  fs.mkdirSync(sesionFalsa, { recursive: true });
  fs.writeFileSync(path.join(sesionFalsa, 'creds.json'), '{"secreto":"MARCA-CLARO-123"}');
  const destino = path.join(tmp, 'backups');
  const clave = 'clave-de-entorno-larga-y-fuerte';
  // tar.gz falso pero valido a nivel de magic gzip; el tar real lo pone el servidor
  const tarFalso = Buffer.concat([Buffer.from([0x1f, 0x8b]), Buffer.from('MARCA-CLARO-123 comprimido')]);
  const execTar = async (carpeta) => {
    assert.equal(carpeta, sesionFalsa);
    return tarFalso;
  };
  const r = await crearBackupSesion({ claveBackup: clave, carpetaSesion: sesionFalsa, carpetaDestino: destino, execTar, ahora: '2026-11-05T16:00:00+01:00' });
  assert.equal(r.ok, true);
  assert.match(r.archivo, /sesion-2026-11-05.*\.dbk1$/);
  assert.ok(r.bytes > 0);
  assert.match(r.nota, /Object Storage queda config-required/, 'la subida externa no se simula');

  // Sin claro en disco: ni el contenido ni la clave aparecen en el fichero
  const contenido = fs.readFileSync(r.archivo);
  assert.equal(contenido.includes('MARCA-CLARO-123'), false, 'sin plaintext filtrado');
  assert.equal(contenido.includes(clave), false, 'sin clave filtrada');
  assert.equal((fs.statSync(r.archivo).mode & 0o777), 0o600, 'permisos 600');

  // Roundtrip de recuperabilidad
  const v = await verificarBackupSesion({ archivo: r.archivo }, { claveBackup: clave });
  assert.equal(v.ok, true);
  assert.match(v.nota, /recuperable/);

  // Cifrado autenticado: un byte alterado rompe la verificacion
  const manipulado = Buffer.from(contenido);
  manipulado[manipulado.length - 1] ^= 0xff;
  const rutaManip = path.join(tmp, 'manipulado.dbk1');
  fs.writeFileSync(rutaManip, manipulado);
  const vm = await verificarBackupSesion({ archivo: rutaManip }, { claveBackup: clave });
  assert.equal(vm.ok, false);
  assert.match(vm.error, /manipulado o clave distinta/);

  // Clave incorrecta: no descifra
  const vc = await verificarBackupSesion({ archivo: r.archivo }, { claveBackup: 'otra-clave-distinta-de-16+' });
  assert.equal(vc.ok, false);

  // Contenido no recuperable: no se guarda un backup inservible
  const malo = await crearBackupSesion({ claveBackup: clave, carpetaSesion: sesionFalsa, carpetaDestino: destino, execTar: async () => Buffer.from('esto no es gzip'), ahora: '2026-11-05T17:00:00+01:00' });
  assert.equal(malo.ok, false);
  assert.match(malo.error, /recuperabilidad/);
  assert.equal(fs.existsSync(path.join(destino, 'sesion-2026-11-05-17-00.dbk1')), false, 'no escribe backups inservibles');
});
