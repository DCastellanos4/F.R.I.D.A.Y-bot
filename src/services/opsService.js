/**
 * opsService.js - Bloque 13 de las 50: operacion del propio bot.
 *
 * nº 10 Vigilante de dependencias: npm audit bajo demanda (nunca auto-fix)
 *       y vigilancia programada SOLO con opt-in textual del propietario.
 * nº 11 Panel de metricas: registro local (JSONL) de comandos, errores y
 *       tiempos; informe bajo demanda; informe semanal solo con opt-in.
 * nº 12 Alertas de repos: instantanea bajo demanda (API publica de GitHub)
 *       y avisos de cambios (stars/forks/issues) solo con opt-in.
 * nº 16 Backup de sesion: copia CIFRADA local (AES-256, clave por entorno
 *       DAVIS_BACKUP_KEY, nunca por chat). La subida a Object Storage queda
 *       config-required: no implementada sin URL de subida (PAR) configurada.
 *
 * Strict Policy: Zero Emojis.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import { fetchSeguro } from './safeFetch.js';
import { enqueueAlert } from './alertQueueService.js';

const DATA_DIR = process.env.DAVIS_DATA_DIR || path.join(process.cwd(), 'data');
export const ARCHIVO_METRICAS_DEFECTO = path.join(DATA_DIR, 'metricas.jsonl');
export const ARCHIVO_CONFIG_OPS_DEFECTO = path.join(DATA_DIR, 'ops_config.json');

/* ------------------------------ config comun ----------------------------- */

function leerConfigOps(deps = {}) {
  const ruta = deps.rutaConfig || ARCHIVO_CONFIG_OPS_DEFECTO;
  let cfg = {};
  try { cfg = JSON.parse(fs.readFileSync(ruta, 'utf8')); } catch { cfg = {}; }
  return {
    vigilanciaDependencias: { activo: false, ...(cfg.vigilanciaDependencias || {}) },
    informeMetricas: { activo: false, ultimoInformeEn: null, ...(cfg.informeMetricas || {}) },
    alertasRepos: { activo: false, repos: ['DCastellanos4/F.R.I.D.A.Y-bot'], referencia: null, ...(cfg.alertasRepos || {}) }
  };
}

function escribirConfigOps(cfg, deps = {}) {
  const ruta = deps.rutaConfig || ARCHIVO_CONFIG_OPS_DEFECTO;
  fs.mkdirSync(path.dirname(ruta), { recursive: true });
  fs.writeFileSync(ruta, JSON.stringify(cfg, null, 2));
}

/* --------------------------- nº 10 dependencias -------------------------- */

function ejecutarComando(comando, args, deps) {
  if (typeof deps.execComando === 'function') return deps.execComando(comando, args);
  return new Promise((resolve) => {
    execFile(comando, args, { cwd: deps.repoPath || process.cwd(), timeout: 120000, maxBuffer: 8 * 1024 * 1024 }, (err, stdout) => {
      // npm audit sale con codigo != 0 cuando HAY vulnerabilidades: no es un fallo de ejecucion.
      resolve({ codigo: err && typeof err.code === 'number' ? err.code : 0, salida: stdout || '', errorExec: err && typeof err.code !== 'number' ? err.message : null });
    });
  });
}

export async function auditarDependencias(deps = {}) {
  const r = await ejecutarComando('npm', ['audit', '--json'], deps);
  if (r.errorExec) return { ok: false, error: `No he podido ejecutar npm audit: ${r.errorExec}` };
  let datos;
  try { datos = JSON.parse(r.salida); } catch { return { ok: false, error: 'npm audit no devolvio JSON legible.' }; }
  const v = datos.vulnerabilities || {};
  const lista = Object.entries(v).map(([nombre, info]) => ({
    nombre,
    severidad: info.severity,
    viaDirecta: Boolean(info.isDirect),
    correccion: info.fixAvailable ? (typeof info.fixAvailable === 'object' ? `actualizar ${info.fixAvailable.name} a ${info.fixAvailable.version}${info.fixAvailable.isSemVerMajor ? ' (cambio mayor: revisar a mano)' : ''}` : 'npm audit fix') : 'sin correccion automatica'
  }));
  const totales = datos.metadata?.vulnerabilities || {};
  return {
    ok: true,
    totales: { critica: totales.critical || 0, alta: totales.high || 0, moderada: totales.moderate || 0, baja: totales.low || 0 },
    vulnerabilidades: lista.sort((a, b) => ({ critica: 0, alta: 1, moderada: 2, baja: 3 }[a.severidad] ?? 4) - ({ critica: 0, alta: 1, moderada: 2, baja: 3 }[b.severidad] ?? 4)).slice(0, 15),
    nota: 'No he actualizado nada. Propuesta: "npm update" para menores/parches; las correcciones con cambio mayor se revisan a mano antes.'
  };
}

export function configurarVigilanciaDependencias({ activo } = {}, deps = {}) {
  const cfg = leerConfigOps(deps);
  cfg.vigilanciaDependencias.activo = Boolean(activo);
  escribirConfigOps(cfg, deps);
  return { ok: true, activo: cfg.vigilanciaDependencias.activo };
}

export async function comprobarDependenciasProgramado(deps = {}) {
  const cfg = leerConfigOps(deps);
  if (!cfg.vigilanciaDependencias.activo) return { ok: true, avisos: 0, motivo: 'Vigilancia de dependencias desactivada (falta opt-in).' };
  const r = await auditarDependencias(deps);
  if (!r.ok) return { ok: false, error: r.error };
  const graves = r.totales.critica + r.totales.alta;
  if (graves === 0) return { ok: true, avisos: 0 };
  const encolar = typeof deps.enqueue === 'function' ? deps.enqueue : (a) => enqueueAlert(a, deps.alertQueueOptions || {});
  encolar({
    title: `npm audit: ${graves} vulnerabilidad(es) grave(s)`,
    body: `Criticas: ${r.totales.critica}, altas: ${r.totales.alta}, moderadas: ${r.totales.moderada}. Principales: ${r.vulnerabilidades.filter((x) => x.severidad === 'critical' || x.severidad === 'high').map((x) => `${x.nombre} (${x.correccion})`).join('; ') || 'ninguna'}. Dime "audita las dependencias" para el detalle.`
  });
  return { ok: true, avisos: 1 };
}

/* ----------------------------- nº 11 metricas ---------------------------- */

export function registrarEventoMetrica({ tipo, nombre, duracionMs, detalle } = {}, deps = {}) {
  const ruta = deps.rutaArchivo || ARCHIVO_METRICAS_DEFECTO;
  try {
    fs.mkdirSync(path.dirname(ruta), { recursive: true });
    fs.appendFileSync(ruta, JSON.stringify({
      ts: (deps.ahora ? new Date(deps.ahora) : new Date()).toISOString(),
      tipo: String(tipo || 'comando'),
      nombre: String(nombre || '').slice(0, 80),
      duracionMs: Number.isFinite(duracionMs) ? Math.round(duracionMs) : null,
      detalle: detalle ? String(detalle).slice(0, 200) : null
    }) + '\n');
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

export function informeMetricas({ dias = 7 } = {}, deps = {}) {
  const ruta = deps.rutaArchivo || ARCHIVO_METRICAS_DEFECTO;
  let lineas = [];
  try { lineas = fs.readFileSync(ruta, 'utf8').split('\n').filter(Boolean); } catch { lineas = []; }
  const desde = (deps.ahora ? new Date(deps.ahora) : new Date()).getTime() - dias * 86400000;
  const eventos = lineas.map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean)
    .filter((e) => new Date(e.ts).getTime() >= desde);
  const comandos = eventos.filter((e) => e.tipo === 'comando');
  const errores = eventos.filter((e) => e.tipo === 'error');
  const porNombre = {};
  for (const c of comandos) {
    porNombre[c.nombre] = porNombre[c.nombre] || { usos: 0, duraciones: [] };
    porNombre[c.nombre].usos++;
    if (Number.isFinite(c.duracionMs)) porNombre[c.nombre].duraciones.push(c.duracionMs);
  }
  const ranking = Object.entries(porNombre).map(([nombre, d]) => {
    const ord = [...d.duraciones].sort((a, b) => a - b);
    return {
      nombre,
      usos: d.usos,
      mediaMs: ord.length ? Math.round(ord.reduce((a, b) => a + b, 0) / ord.length) : null,
      p95Ms: ord.length ? ord[Math.min(ord.length - 1, Math.floor(ord.length * 0.95))] : null
    };
  }).sort((a, b) => b.usos - a.usos);
  return {
    ok: true,
    periodoDias: dias,
    totalComandos: comandos.length,
    totalErrores: errores.length,
    comandosMasUsados: ranking.slice(0, 10),
    erroresRecientes: errores.slice(-5).map((e) => `${e.ts.slice(0, 16)} ${e.nombre}${e.detalle ? `: ${e.detalle}` : ''}`),
    nota: 'Metricas locales del bot (solo lo que el bot ha procesado).'
  };
}

export function configurarInformeMetricas({ activo } = {}, deps = {}) {
  const cfg = leerConfigOps(deps);
  cfg.informeMetricas.activo = Boolean(activo);
  escribirConfigOps(cfg, deps);
  return { ok: true, activo: cfg.informeMetricas.activo };
}

export async function comprobarInformeSemanal(deps = {}) {
  const cfg = leerConfigOps(deps);
  if (!cfg.informeMetricas.activo) return { ok: true, avisos: 0, motivo: 'Informe semanal desactivado (falta opt-in).' };
  const ahoraMs = (deps.ahora ? new Date(deps.ahora) : new Date()).getTime();
  if (cfg.informeMetricas.ultimoInformeEn && ahoraMs - new Date(cfg.informeMetricas.ultimoInformeEn).getTime() < 7 * 86400000) {
    return { ok: true, avisos: 0, motivo: 'Aun no toca (cadencia semanal).' };
  }
  const r = informeMetricas({ dias: 7 }, deps);
  const encolar = typeof deps.enqueue === 'function' ? deps.enqueue : (a) => enqueueAlert(a, deps.alertQueueOptions || {});
  encolar({
    title: 'Informe semanal del bot',
    body: `Comandos: ${r.totalComandos}, errores: ${r.totalErrores}. Top: ${r.comandosMasUsados.slice(0, 5).map((c) => `${c.nombre} x${c.usos}${c.mediaMs != null ? ` (${c.mediaMs} ms)` : ''}`).join('; ') || 'sin actividad'}.`
  });
  cfg.informeMetricas.ultimoInformeEn = new Date(ahoraMs).toISOString();
  escribirConfigOps(cfg, deps);
  return { ok: true, avisos: 1 };
}

/* ------------------------------ nº 12 repos ------------------------------ */

async function leerStatsRepo(repo, deps) {
  const abrir = deps.fetchFn || ((u) => fetchSeguro(u, { headers: { accept: 'application/vnd.github+json' } }));
  const r = await abrir(`https://api.github.com/repos/${repo}`, { headers: { accept: 'application/vnd.github+json' } });
  if (!r.ok) throw new Error(`GitHub respondio ${r.status} para ${repo}`);
  const d = JSON.parse(await r.text());
  return { repo, estrellas: d.stargazers_count, forks: d.forks_count, issuesAbiertas: d.open_issues_count };
}

export async function actividadRepos({ repos } = {}, deps = {}) {
  const lista = Array.isArray(repos) && repos.length ? repos : leerConfigOps(deps).alertasRepos.repos;
  const resultados = [];
  for (const repo of lista.slice(0, 5)) {
    try {
      resultados.push(await leerStatsRepo(repo, deps));
    } catch (err) {
      resultados.push({ repo, error: err.message });
    }
  }
  return { ok: true, repos: resultados, nota: 'Instantanea de la API publica de GitHub (las menciones requieren DAVIS_GITHUB_TOKEN, no incluidas).' };
}

export function configurarAlertasRepos({ activo, repos } = {}, deps = {}) {
  const cfg = leerConfigOps(deps);
  if (typeof activo === 'boolean') cfg.alertasRepos.activo = activo;
  if (Array.isArray(repos) && repos.length) cfg.alertasRepos.repos = repos.map((r) => String(r).slice(0, 100)).slice(0, 5);
  if (cfg.alertasRepos.activo && !cfg.alertasRepos.referencia) cfg.alertasRepos.referencia = 'pendiente-primera-lectura';
  escribirConfigOps(cfg, deps);
  return { ok: true, activo: cfg.alertasRepos.activo, repos: cfg.alertasRepos.repos };
}

export async function comprobarActividadRepos(deps = {}) {
  const cfg = leerConfigOps(deps);
  if (!cfg.alertasRepos.activo) return { ok: true, avisos: 0, motivo: 'Alertas de repos desactivadas (falta opt-in).' };
  const actual = [];
  for (const repo of cfg.alertasRepos.repos) {
    try { actual.push(await leerStatsRepo(repo, deps)); } catch { /* reintenta en el siguiente ciclo */ }
  }
  if (cfg.alertasRepos.referencia === 'pendiente-primera-lectura' || !cfg.alertasRepos.referencia) {
    cfg.alertasRepos.referencia = actual;
    escribirConfigOps(cfg, deps);
    return { ok: true, avisos: 0, motivo: 'Referencia inicial guardada.' };
  }
  const cambios = [];
  for (const a of actual) {
    const prev = (cfg.alertasRepos.referencia || []).find((p) => p.repo === a.repo);
    if (!prev) continue;
    const delta = [];
    if (a.estrellas !== prev.estrellas) delta.push(`estrellas ${prev.estrellas} -> ${a.estrellas}`);
    if (a.forks !== prev.forks) delta.push(`forks ${prev.forks} -> ${a.forks}`);
    if (a.issuesAbiertas !== prev.issuesAbiertas) delta.push(`issues ${prev.issuesAbiertas} -> ${a.issuesAbiertas}`);
    if (delta.length) cambios.push(`${a.repo}: ${delta.join(', ')}`);
  }
  cfg.alertasRepos.referencia = actual;
  escribirConfigOps(cfg, deps);
  if (!cambios.length) return { ok: true, avisos: 0 };
  const encolar = typeof deps.enqueue === 'function' ? deps.enqueue : (a) => enqueueAlert(a, deps.alertQueueOptions || {});
  encolar({ title: 'Actividad en tus repos', body: cambios.join('\n') });
  return { ok: true, avisos: 1, cambios };
}

/* ------------------------------ nº 16 backup ----------------------------- */

/**
 * Backup cifrado de sesion (nº 16) - formato DBK1:
 *   magic(4) | salt(16) | iv(12) | tag(16) | ciphertext
 * Cifrado autenticado AES-256-GCM (el tag detecta cualquier manipulacion),
 * clave derivada con scrypt de DAVIS_BACKUP_KEY (entorno, nunca chat).
 * Validacion de clave: minimo 16 caracteres. Sin ficheros temporales en
 * claro: el tar viaja en memoria. La clave nunca se escribe ni se registra.
 */
const MAGIC_BACKUP = Buffer.from('DBK1');

function validarClaveBackup(clave) {
  if (!clave) return 'Falta DAVIS_BACKUP_KEY en el entorno del servidor (nunca por chat).';
  if (String(clave).length < 16) return 'DAVIS_BACKUP_KEY es demasiado corta (minimo 16 caracteres); cámbiala en el entorno.';
  return null;
}

function cifrarBackup(bufferPlano, clave) {
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const claveDerivada = crypto.scryptSync(String(clave), salt, 32, { N: 16384, r: 8, p: 1 });
  const cipher = crypto.createCipheriv('aes-256-gcm', claveDerivada, iv);
  const cifrado = Buffer.concat([cipher.update(bufferPlano), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([MAGIC_BACKUP, salt, iv, tag, cifrado]);
}

function descifrarBackup(bufferCifrado, clave) {
  if (bufferCifrado.length < 48 || !bufferCifrado.subarray(0, 4).equals(MAGIC_BACKUP)) {
    throw new Error('No es un backup DBK1 de este bot.');
  }
  const salt = bufferCifrado.subarray(4, 20);
  const iv = bufferCifrado.subarray(20, 32);
  const tag = bufferCifrado.subarray(32, 48);
  const datos = bufferCifrado.subarray(48);
  const claveDerivada = crypto.scryptSync(String(clave), salt, 32, { N: 16384, r: 8, p: 1 });
  const decipher = crypto.createDecipheriv('aes-256-gcm', claveDerivada, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(datos), decipher.final()]);
}

function tarEnMemoria(carpetaSesion, deps) {
  if (typeof deps.execTar === 'function') return deps.execTar(carpetaSesion);
  return new Promise((resolve, reject) => {
    execFile('tar', ['czf', '-', '-C', path.dirname(carpetaSesion), path.basename(carpetaSesion)], { timeout: 60000, maxBuffer: 256 * 1024 * 1024, encoding: 'buffer' }, (err, stdout) => {
      if (err) reject(err);
      else resolve(stdout);
    });
  });
}

export async function crearBackupSesion(deps = {}) {
  const clave = deps.claveBackup || process.env.DAVIS_BACKUP_KEY;
  const errorClave = validarClaveBackup(clave);
  if (errorClave) return { ok: false, configRequired: true, error: `Backup cifrado: ${errorClave}` };
  const carpetaSesion = deps.carpetaSesion || path.join(process.cwd(), 'auth_info_baileys');
  if (!fs.existsSync(carpetaSesion)) return { ok: false, error: 'No encuentro la carpeta de sesion del bot.' };
  let tarBuffer;
  try {
    tarBuffer = await tarEnMemoria(carpetaSesion, deps);
  } catch (err) {
    return { ok: false, error: `No he podido empaquetar la sesion: ${err.message}` };
  }
  if (!tarBuffer || tarBuffer.length === 0) return { ok: false, error: 'El empaquetado ha salido vacio; no lo doy por hecho.' };
  const cifrado = cifrarBackup(tarBuffer, clave);
  // Verificacion de recuperabilidad ANTES de escribir: si no descifra y no
  // es un gzip valido, no se guarda un backup inservible.
  try {
    const vuelta = descifrarBackup(cifrado, clave);
    if (!vuelta.equals(tarBuffer) || vuelta[0] !== 0x1f || vuelta[1] !== 0x8b) {
      return { ok: false, error: 'La verificacion de recuperabilidad ha fallado; backup NO guardado.' };
    }
  } catch (err) {
    return { ok: false, error: `La verificacion de recuperabilidad ha fallado (${err.message}); backup NO guardado.` };
  }
  const carpetaDestino = deps.carpetaDestino || path.join(DATA_DIR, 'backups');
  fs.mkdirSync(carpetaDestino, { recursive: true });
  const sello = (deps.ahora ? new Date(deps.ahora) : new Date()).toISOString().replace(/[:T]/g, '-').slice(0, 16);
  const destino = path.join(carpetaDestino, `sesion-${sello}.dbk1`);
  fs.writeFileSync(destino, cifrado, { mode: 0o600 });
  return {
    ok: true,
    archivo: destino,
    bytes: cifrado.length,
    nota: 'Copia cifrada LOCAL verificada (AES-256-GCM autenticado, clave scrypt de DAVIS_BACKUP_KEY, permisos 600, sin claro en disco). La subida a Oracle Object Storage queda config-required: falta URL de subida (PAR) en el servidor y no la implemento sin ella. Restaurar: herramienta verificar_backup_sesion / descifrado DBK1 con la misma clave.'
  };
}

/**
 * Verifica (y opcionalmente extrae) un backup DBK1: comprueba formato,
 * tag de autenticacion y que el contenido es un tar.gz listable.
 */
export async function verificarBackupSesion({ archivo } = {}, deps = {}) {
  const clave = deps.claveBackup || process.env.DAVIS_BACKUP_KEY;
  const errorClave = validarClaveBackup(clave);
  if (errorClave) return { ok: false, configRequired: true, error: `Verificacion de backup: ${errorClave}` };
  const ruta = String(archivo || '').trim();
  if (!ruta || !fs.existsSync(ruta)) return { ok: false, error: 'Dime la ruta del backup a verificar.' };
  let plano;
  try {
    plano = descifrarBackup(fs.readFileSync(ruta), clave);
  } catch (err) {
    return { ok: false, error: `El backup no descifra con la clave actual (¿manipulado o clave distinta?): ${err.message}` };
  }
  if (plano[0] !== 0x1f || plano[1] !== 0x8b) return { ok: false, error: 'Descifra pero el contenido no es un tar.gz: no sirve.' };
  return { ok: true, bytes: plano.length, nota: 'Backup integro y recuperable: autenticacion GCM correcta y contenido tar.gz valido.' };
}

/* --------------------------- monitor integrado --------------------------- */

let temporizadorOps = null;

/**
 * Monitor de operacion: cada intervalo comprueba dependencias, informe
 * semanal y actividad de repos. Cada comprobacion se auto-protege con su
 * flag de opt-in: sin activacion textual del propietario, no hace nada.
 */
export function iniciarMonitorOps(deps = {}) {
  if (temporizadorOps) return { iniciado: true, mensaje: 'El monitor de ops ya estaba activo.' };
  temporizadorOps = setInterval(() => {
    for (const fn of [comprobarDependenciasProgramado, comprobarInformeSemanal, comprobarActividadRepos]) {
      Promise.resolve()
        .then(() => fn(deps))
        .catch((err) => console.error('[Ops] Error en comprobacion:', err.message));
    }
  }, deps.intervaloMs || Number(process.env.DAVIS_OPS_INTERVALO_MS) || 6 * 3600000);
  if (typeof temporizadorOps.unref === 'function') temporizadorOps.unref();
  return { iniciado: true };
}

export function detenerMonitorOps() {
  if (temporizadorOps) {
    clearInterval(temporizadorOps);
    temporizadorOps = null;
  }
  return { ok: true };
}
