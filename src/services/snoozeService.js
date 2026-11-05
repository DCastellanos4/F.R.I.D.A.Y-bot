/**
 * snoozeService.js - Snooze de conversaciones (nº 34)
 *
 * David pide volver a un chat mas tarde: "recuerdame este chat a las 18:00"
 * o "recuerdame lo de este grupo en 2 horas". Cada snooze es una peticion
 * explicita y puntual del propietario (no hay monitor permanente de terceros):
 * al llegar la hora se encola UN aviso y el snooze queda completado.
 *
 * Zona horaria Europe/Madrid para horas fijas, convencion del repo.
 *
 * Strict Policy: Zero Emojis.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DATA_DIR } from '../config/paths.js';
import { enqueueAlert } from './alertQueueService.js';

export const ARCHIVO_DEFECTO = path.join(DATA_DIR, 'snoozes.json');
export const INTERVALO_DEFECTO_MS = Number(process.env.DAVIS_SNOOZE_INTERVALO_MS) || 60 * 1000;

function rutaArchivo(deps = {}) {
  return deps.rutaArchivo || ARCHIVO_DEFECTO;
}

function leerEstado(deps = {}) {
  try {
    const data = JSON.parse(fs.readFileSync(rutaArchivo(deps), 'utf-8'));
    return { snoozes: Array.isArray(data.snoozes) ? data.snoozes : [] };
  } catch {
    return { snoozes: [] };
  }
}

function guardarEstado(estado, deps = {}) {
  const ruta = rutaArchivo(deps);
  fs.mkdirSync(path.dirname(ruta), { recursive: true });
  const tmp = `${ruta}.tmp.${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(estado, null, 2), 'utf-8');
  fs.renameSync(tmp, ruta);
}

function ahora(deps = {}) {
  return deps.ahora ? new Date(deps.ahora) : new Date();
}

function fechaMadrid(fecha = new Date()) {
  const partes = new Intl.DateTimeFormat('es-ES', {
    timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(fecha);
  const m = {};
  for (const p of partes) m[p.type] = p.value;
  return { anio: Number(m.year), mes: Number(m.month), dia: Number(m.day) };
}

// Convierte "hoy/manana a las HH:MM" (pared, Europe/Madrid) a Date en UTC.
function fechaDesdeHoraMadrid(hora, minuto, referencia = new Date()) {
  const hoy = fechaMadrid(referencia);
  const pad = (n) => String(n).padStart(2, '0');
  const textoLocal = `${hoy.anio}-${pad(hoy.mes)}-${pad(hoy.dia)}T${pad(hora)}:${pad(minuto)}:00`;
  // Dos pasadas: estimar con offset aproximado y corregir con Intl.
  const estimado = new Date(`${textoLocal}+01:00`);
  const partes = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
  }).formatToParts(estimado);
  const m = {};
  for (const p of partes) m[p.type] = p.value;
  const reconstruido = Date.UTC(Number(m.year), Number(m.month) - 1, Number(m.day), Number(m.hour) === 24 ? 0 : Number(m.hour), Number(m.minute), Number(m.second));
  const desfase = reconstruido - estimado.getTime();
  let objetivo = new Date(estimado.getTime() - desfase);
  if (objetivo <= referencia) objetivo = new Date(objetivo.getTime() + 86400000);
  return objetivo;
}

export function programarSnooze({ chatId, minutos, hora, nota } = {}, deps = {}) {
  if (!chatId) return { ok: false, error: 'No se de que chat quieres que te recuerde.' };
  const ref = ahora(deps);
  let activarEn = null;
  if (typeof minutos === 'number' && Number.isFinite(minutos) && minutos >= 1 && minutos <= 10080) {
    activarEn = new Date(ref.getTime() + Math.round(minutos) * 60000);
  } else if (typeof hora === 'string' && hora.trim()) {
    const m = hora.trim().match(/^(\d{1,2})(?::(\d{2}))?$/);
    if (!m) return { ok: false, error: 'Hora invalida: usa formato HH:MM (por ejemplo 18:30) o "en 2 horas".' };
    const h = Number(m[1]);
    const mi = m[2] ? Number(m[2]) : 0;
    if (h > 23 || mi > 59) return { ok: false, error: 'Hora invalida: usa formato HH:MM (por ejemplo 18:30) o "en 2 horas".' };
    activarEn = fechaDesdeHoraMadrid(h, mi, ref);
  } else {
    return { ok: false, error: 'Dime cuando: "en 2 horas" o una hora concreta ("a las 18:00").' };
  }
  const estado = leerEstado(deps);
  const duplicado = estado.snoozes.find((s) => s.estado === 'pendiente' && s.chatId === chatId);
  if (duplicado) {
    return { ok: false, error: `Ya tienes un recordatorio pendiente de ese chat para ${new Date(duplicado.activarEn).toLocaleString('es-ES', { timeZone: 'Europe/Madrid' })}. Cancelalo primero si quieres cambiarlo.` };
  }
  const snooze = {
    id: crypto.randomBytes(4).toString('hex'),
    chatId: String(chatId),
    nota: String(nota || '').slice(0, 200) || null,
    activarEn: activarEn.toISOString(),
    creadoEn: ref.toISOString(),
    estado: 'pendiente'
  };
  estado.snoozes.push(snooze);
  // Limpieza: conservar solo pendientes y los completados del ultimo dia.
  const corte = ref.getTime() - 86400000;
  estado.snoozes = estado.snoozes.filter((s) => s.estado === 'pendiente' || new Date(s.activarEn).getTime() >= corte);
  guardarEstado(estado, deps);
  iniciarMonitorSnoozes(deps);
  return { ok: true, snooze };
}

export function listarSnoozes(deps = {}) {
  return leerEstado(deps).snoozes.filter((s) => s.estado === 'pendiente');
}

export function cancelarSnooze({ chatId, id } = {}, deps = {}) {
  const estado = leerEstado(deps);
  const idx = estado.snoozes.findIndex((s) => s.estado === 'pendiente' && (s.id === id || (chatId && s.chatId === chatId)));
  if (idx === -1) return { ok: false, error: 'No encuentro ningun recordatorio pendiente de ese chat.' };
  estado.snoozes[idx].estado = 'cancelado';
  guardarEstado(estado, deps);
  return { ok: true };
}

export function lanzarRondaSnoozes(deps = {}) {
  const estado = leerEstado(deps);
  const ref = ahora(deps);
  const encolar = typeof deps.enqueue === 'function'
    ? deps.enqueue
    : (alerta) => enqueueAlert(alerta, deps.alertQueueOptions || {});
  let disparados = 0;
  for (const s of estado.snoozes) {
    if (s.estado !== 'pendiente') continue;
    if (new Date(s.activarEn) > ref) continue;
    encolar({
      title: 'Volver a un chat',
      details: `Me pediste que te recordara volver al chat ${s.chatId}.${s.nota ? ' Nota tuya: ' + s.nota : ''}`,
      priority: 'normal',
      source: 'snooze'
    });
    s.estado = 'completado';
    s.completadoEn = ref.toISOString();
    disparados++;
  }
  if (disparados > 0) guardarEstado(estado, deps);
  return { ok: true, disparados };
}

let temporizador = null;

export function iniciarMonitorSnoozes(deps = {}) {
  if (temporizador) return { iniciado: true, mensaje: 'El monitor de snoozes ya estaba activo.' };
  if (listarSnoozes(deps).length === 0) {
    return { iniciado: false, motivo: 'Sin snoozes pendientes: el monitor solo corre cuando hay alguno.' };
  }
  temporizador = setInterval(() => {
    try {
      lanzarRondaSnoozes(deps);
      if (listarSnoozes(deps).length === 0) detenerMonitorSnoozes();
    } catch (err) {
      console.error('[Snooze] Error en ronda de snoozes:', err.message);
    }
  }, deps.intervaloMs || INTERVALO_DEFECTO_MS);
  if (typeof temporizador.unref === 'function') temporizador.unref();
  return { iniciado: true };
}

export function detenerMonitorSnoozes() {
  if (temporizador) {
    clearInterval(temporizador);
    temporizador = null;
  }
  return { ok: true };
}
