/**
 * processWatchdogService.js - Vigilante de procesos y recursos del VPS (nº 17)
 *
 * David registra los procesos a vigilar (por patron de comando) con limites
 * opcionales de CPU y memoria. El vigilante comprueba periodicamente:
 *   - si cada proceso sigue vivo (pgrep -f), avisando una vez por transicion;
 *   - cuanta CPU y memoria consume (ps, solo lectura), avisando al superar el
 *     limite configurado con un enfriamiento de 30 minutos por proceso.
 * La vigilancia proactiva solo arranca si el propietario la activa
 * explicitamente ("activa la vigilancia de procesos"); registrar procesos no
 * implica opt-in. Nunca reinicia ni mata procesos: solo mide y avisa.
 *
 * Strict Policy: Zero Emojis.
 */
import fs from 'node:fs';
import path from 'path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { DATA_DIR } from '../config/paths.js';
import { enqueueAlert } from './alertQueueService.js';

const execFileAsync = promisify(execFile);

export const ARCHIVO_DEFECTO = path.join(DATA_DIR, 'procesos_vigilados.json');
export const INTERVALO_DEFECTO_MS = Number(process.env.DAVIS_PROCESOS_INTERVALO_MS) || 5 * 60 * 1000;
export const ENFRIAMIENTO_ALERTA_MS = 30 * 60 * 1000;

function ruta(deps = {}) {
  return deps.rutaArchivo || ARCHIVO_DEFECTO;
}

function leerEstado(deps = {}) {
  try {
    const e = { procesos: [], config: { vigilanciaActiva: false }, ...JSON.parse(fs.readFileSync(ruta(deps), 'utf-8')) };
    if (typeof e.config !== 'object' || e.config === null) e.config = { vigilanciaActiva: false };
    return e;
  } catch {
    return { procesos: [], config: { vigilanciaActiva: false } };
  }
}

function guardarEstado(estado, deps = {}) {
  const destino = ruta(deps);
  fs.mkdirSync(path.dirname(destino), { recursive: true });
  const tmp = `${destino}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(estado, null, 2), 'utf-8');
  fs.renameSync(tmp, destino);
}

function patronValido(patron) {
  const p = String(patron || '').trim();
  if (!p || p.length > 80) return null;
  if (/[;&|`$()]/.test(p)) return null;
  return p;
}

function limiteValido(v) {
  if (v === undefined || v === null) return null;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 && n <= 100 ? n : undefined;
}

export function registrarProceso({ nombre, patron, cpuLimite, memLimite }, deps = {}) {
  const n = String(nombre || '').trim();
  if (!n) return { ok: false, error: 'El nombre del proceso es obligatorio.' };
  const p = patronValido(patron || n);
  if (!p) return { ok: false, error: 'Patron invalido: sin caracteres de shell y maximo 80 caracteres.' };
  const cpu = limiteValido(cpuLimite);
  const mem = limiteValido(memLimite);
  if (cpu === undefined || mem === undefined) return { ok: false, error: 'Los limites deben ser porcentajes entre 1 y 100.' };
  const estado = leerEstado(deps);
  const existente = estado.procesos.find((x) => x.nombre.toLowerCase() === n.toLowerCase());
  if (existente) return { ok: false, error: `Ya vigilo "${existente.nombre}". Si quieres cambiarlo, quitalo y registralo de nuevo.` };
  const proc = { nombre: n.slice(0, 40), patron: p, cpuLimite: cpu, memLimite: mem, estadoActual: 'DESCONOCIDO', registradoEn: new Date().toISOString() };
  estado.procesos.push(proc);
  guardarEstado(estado, deps);
  return { ok: true, proceso: proc };
}

export function dejarDeVigilar(criterio, deps = {}) {
  const estado = leerEstado(deps);
  const c = String(criterio || '').trim().toLowerCase();
  const idx = estado.procesos.findIndex((x) => x.nombre.toLowerCase() === c || x.patron.toLowerCase() === c);
  if (idx === -1) return { ok: false, error: `No vigilo ningun proceso "${criterio}".` };
  const [quitado] = estado.procesos.splice(idx, 1);
  guardarEstado(estado, deps);
  return { ok: true, proceso: quitado };
}

export function listarProcesos(deps = {}) {
  return [...leerEstado(deps).procesos];
}

export function configurarVigilancia({ activo } = {}, deps = {}) {
  const estado = leerEstado(deps);
  estado.config.vigilanciaActiva = activo === true;
  guardarEstado(estado, deps);
  if (estado.config.vigilanciaActiva) {
    iniciarMonitorProcesos(deps);
    return { ok: true, activo: true };
  }
  detenerMonitorProcesos();
  return { ok: true, activo: false };
}

/**
 * Mide CPU y memoria de los pids dados con ps (solo lectura).
 * deps.execFile permite inyectar un simulacro en pruebas.
 */
async function medirRecursos(pids, ejec) {
  const { stdout } = await ejec('ps', ['-o', '%cpu,%mem', '-p', pids.join(','), '--no-headers']);
  let cpu = 0;
  let mem = 0;
  for (const linea of stdout.split('\n')) {
    const partes = linea.trim().split(/\s+/).filter(Boolean);
    if (partes.length >= 2) {
      cpu += parseFloat(partes[0]) || 0;
      mem += parseFloat(partes[1]) || 0;
    }
  }
  return { cpu: Math.round(cpu * 10) / 10, mem: Math.round(mem * 10) / 10 };
}

/**
 * Ronda de vigilancia: transiciones vivo/caido (un aviso por cambio) y
 * limites de recursos (un aviso por proceso cada ENFRIAMIENTO_ALERTA_MS).
 */
export async function comprobarProcesos(deps = {}) {
  const estado = leerEstado(deps);
  if (estado.procesos.length === 0) return { ok: true, avisos: 0 };
  const ejec = deps.execFile || execFileAsync;
  const encolar = typeof deps.enqueue === 'function'
    ? deps.enqueue
    : (alerta) => enqueueAlert(alerta, deps.alertQueueOptions || {});
  const ahora = deps.ahora ? new Date(deps.ahora) : new Date();
  let avisos = 0;
  for (const proc of estado.procesos) {
    let pids;
    try {
      const { stdout } = await ejec('pgrep', ['-f', proc.patron]);
      pids = stdout.trim().split('\n').filter(Boolean);
    } catch (err) {
      if (err.code !== 1) continue;
      pids = [];
    }
    const vivo = pids.length > 0;
    const nuevo = vivo ? 'VIVO' : 'CAIDO';
    if (proc.estadoActual !== 'DESCONOCIDO' && proc.estadoActual !== nuevo) {
      encolar({
        title: vivo ? `Proceso recuperado: ${proc.nombre}` : `Proceso caido: ${proc.nombre}`,
        details: vivo
          ? `"${proc.nombre}" (patron "${proc.patron}") vuelve a estar en ejecucion.`
          : `"${proc.nombre}" (patron "${proc.patron}") ha dejado de aparecer en la lista de procesos del VPS. Revisalo cuando puedas.`,
        priority: vivo ? 'normal' : 'alta',
        source: 'vigilante-procesos'
      });
      avisos++;
    }
    proc.estadoActual = nuevo;
    proc.ultimaComprobacion = ahora.toISOString();
    if (vivo && (proc.cpuLimite !== null || proc.memLimite !== null)) {
      try {
        const uso = await medirRecursos(pids, ejec);
        proc.ultimoUso = { ...uso, ts: ahora.toISOString() };
        const excedeCpu = proc.cpuLimite !== null && uso.cpu > proc.cpuLimite;
        const excedeMem = proc.memLimite !== null && uso.mem > proc.memLimite;
        const ultimoAviso = proc.ultimoAvisoRecursos ? new Date(proc.ultimoAvisoRecursos).getTime() : 0;
        if ((excedeCpu || excedeMem) && ahora.getTime() - ultimoAviso > ENFRIAMIENTO_ALERTA_MS) {
          const causas = [];
          if (excedeCpu) causas.push(`CPU al ${uso.cpu}% (limite ${proc.cpuLimite}%)`);
          if (excedeMem) causas.push(`memoria al ${uso.mem}% (limite ${proc.memLimite}%)`);
          encolar({
            title: `Proceso pasado de recursos: ${proc.nombre}`,
            details: `"${proc.nombre}" lleva ${causas.join(' y ')}. Te aviso como maximo cada 30 minutos mientras siga asi.`,
            priority: 'alta',
            source: 'vigilante-procesos'
          });
          proc.ultimoAvisoRecursos = ahora.toISOString();
          avisos++;
        }
      } catch {
        // ps fallo: se reintenta en la siguiente ronda
      }
    }
  }
  guardarEstado(estado, deps);
  return { ok: true, avisos };
}

let temporizador = null;

export function iniciarMonitorProcesos(deps = {}) {
  if (temporizador) return { iniciado: true, mensaje: 'El vigilante de procesos ya estaba activo.' };
  const estado = leerEstado(deps);
  if (!estado.config.vigilanciaActiva) {
    return { iniciado: false, motivo: 'Vigilancia de procesos desactivada: el propietario la activa explicitamente (configurar_vigilante_procesos), no basta con registrar procesos.' };
  }
  if (estado.procesos.length === 0) {
    return { iniciado: false, motivo: 'Sin procesos registrados: el vigilante no arranca hasta que el propietario registre el primero.' };
  }
  temporizador = setInterval(() => {
    comprobarProcesos(deps).catch((err) => console.error('[Procesos] Error en ronda:', err.message));
  }, deps.intervaloMs || INTERVALO_DEFECTO_MS);
  if (typeof temporizador.unref === 'function') temporizador.unref();
  return { iniciado: true };
}

export function detenerMonitorProcesos() {
  if (temporizador) {
    clearInterval(temporizador);
    temporizador = null;
  }
  return { ok: true };
}
