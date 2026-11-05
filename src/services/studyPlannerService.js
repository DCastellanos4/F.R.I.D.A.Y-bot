/**
 * studyPlannerService.js - Planificador de estudio (funcion nº 5 del roadmap)
 *
 * Dada una asignatura, una fecha de examen y una lista de temas, genera un
 * plan diario (reparto de temas + ultimo dia de repaso) y, SOLO si David
 * indica la hora, conecta cada sesion con el sistema de recordatorios.
 * Fechas en calendario Europe/Madrid (convencion del repo), examen como
 * fecha sin hora. Persistencia atomica; rutas y efectos inyectables.
 *
 * Strict Policy: Zero Emojis.
 */
import fs from 'node:fs';
import path from 'path';
import crypto from 'node:crypto';
import { DATA_DIR } from '../config/paths.js';
import { crearRecordatorio as crearRecordatorioReal } from './reminderService.js';

export const ARCHIVO_DEFECTO = path.join(DATA_DIR, 'study_plans.json');
export const ZONA_DEFECTO = 'Europe/Madrid';

function ruta(deps = {}) {
  return deps.rutaArchivo || ARCHIVO_DEFECTO;
}

function leerPlanes(deps = {}) {
  try {
    return JSON.parse(fs.readFileSync(ruta(deps), 'utf-8'));
  } catch {
    return [];
  }
}

function guardarPlanes(planes, deps = {}) {
  const destino = ruta(deps);
  fs.mkdirSync(path.dirname(destino), { recursive: true });
  const tmp = `${destino}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(planes, null, 2), 'utf-8');
  fs.renameSync(tmp, destino);
}

function fechaADate(fechaExamen) {
  if (typeof fechaExamen !== 'string') return null;
  const m = fechaExamen.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return Number.isNaN(d.getTime()) ? null : d;
}

function ahoraMs(deps = {}) {
  return deps.hoy ? new Date(deps.hoy).getTime() : Date.now();
}

/** Fecha de calendario (AAAA-MM-DD) en la zona configurada. */
export function hoyEnZona(deps = {}) {
  const zona = deps.zonaHoraria || ZONA_DEFECTO;
  const partes = new Intl.DateTimeFormat('en-CA', { timeZone: zona, year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date(ahoraMs(deps)));
  const get = (t) => partes.find((p) => p.type === t).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** Milisegundos UTC de una hora de pared (fecha + HH:MM) en la zona. */
export function msParedAZulu(fecha, hora, zona = ZONA_DEFECTO) {
  const objetivo = Date.parse(`${fecha}T${hora}:00Z`);
  let guess = objetivo;
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: zona, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
  });
  for (let i = 0; i < 3; i++) {
    const partes = fmt.formatToParts(new Date(guess));
    const get = (t) => partes.find((p) => p.type === t).value;
    const pared = Date.UTC(+get('year'), +get('month') - 1, +get('day'), +get('hour'), +get('minute'), +get('second'));
    guess += objetivo - pared;
  }
  return guess;
}

function validarHora(hora) {
  return typeof hora === 'string' && /^([01]?\d|2[0-3]):[0-5]\d$/.test(hora.trim());
}

/**
 * Reparte los temas entre los dias disponibles. El ultimo dia se reserva
 * para repaso general cuando hay al menos dos dias.
 */
export function repartirTemario(temas, dias) {
  const diasEstudio = Math.max(dias - 1, 1);
  const entradas = [];
  const porDia = Math.ceil(temas.length / diasEstudio);
  let cursor = 0;
  for (let i = 0; i < diasEstudio && cursor < temas.length; i++) {
    entradas.push({ offsetDia: i, tipo: 'estudio', temas: temas.slice(cursor, cursor + porDia) });
    cursor += porDia;
  }
  if (dias >= 2) {
    entradas.push({ offsetDia: dias - 1, tipo: 'repaso', temas: ['Repaso general de todos los temas'] });
  }
  return entradas;
}

function programarSesiones(plan, hora, deps, crear) {
  const zona = deps.zonaHoraria || ZONA_DEFECTO;
  const ahora = ahoraMs(deps);
  let recordatorios = 0;
  const errores = [];
  for (const entrada of plan.entradas) {
    if (entrada.completada) continue;
    const objetivoMs = msParedAZulu(entrada.fecha, hora, zona);
    const minutos = Math.round((objetivoMs - ahora) / 60000);
    if (minutos <= 0) continue;
    const res = crear({
      mensaje: `Estudio de ${plan.asignatura} (${entrada.tipo}): ${entrada.temas.join(', ')}. Examen: ${plan.fechaExamen}.`,
      minutosEnElFuturo: minutos
    });
    if (res && res.ok === false) errores.push(res.error || 'error desconocido');
    else recordatorios++;
  }
  return { recordatorios, errores };
}

/**
 * Crea un plan de estudio. Sin horaEstudio NO se programan recordatorios:
 * la hora la elige el propietario, no se inventa. Plan duplicado (misma
 * asignatura y fecha de examen) devuelve error con el existente, sin
 * crear recordatorios duplicados.
 */
export function crearPlanEstudio({ asignatura, fechaExamen, temas, horaEstudio }, deps = {}) {
  if (typeof asignatura !== 'string' || !asignatura.trim()) {
    return { ok: false, error: 'La asignatura es obligatoria.' };
  }
  if (!Array.isArray(temas) || temas.length === 0 || temas.some((t) => typeof t !== 'string' || !t.trim())) {
    return { ok: false, error: 'La lista de temas no puede estar vacia.' };
  }
  const examen = fechaADate(fechaExamen);
  if (!examen) {
    return { ok: false, error: 'Fecha de examen invalida. Usa formato AAAA-MM-DD.' };
  }
  const hoyISO = hoyEnZona(deps);
  const hoy = fechaADate(hoyISO);
  const dias = Math.round((examen - hoy) / 86400000);
  if (dias < 0) {
    return { ok: false, error: 'La fecha del examen ya paso.' };
  }
  if (horaEstudio !== undefined && horaEstudio !== null && !validarHora(horaEstudio)) {
    return { ok: false, error: 'Hora invalida. Usa formato HH:MM, por ejemplo 17:30.' };
  }

  const planes = leerPlanes(deps);
  const existente = planes.find((p) =>
    p.asignatura.toLowerCase() === asignatura.trim().toLowerCase() && p.fechaExamen === fechaExamen);
  if (existente) {
    return { ok: false, error: `Ya existe un plan de ${existente.asignatura} para el ${existente.fechaExamen} (ID: ${existente.id}). No se duplica.`, existente };
  }

  const diasPlan = Math.max(dias, 1);
  const temasLimpios = temas.map((t) => t.trim());
  const esquema = repartirTemario(temasLimpios, diasPlan);
  const entradas = esquema.map((e) => {
    const fecha = new Date(hoy.getTime() + e.offsetDia * 86400000);
    return { fecha: fecha.toISOString().slice(0, 10), tipo: e.tipo, temas: e.temas, completada: false };
  });

  const plan = {
    id: crypto.randomUUID().slice(0, 8),
    asignatura: asignatura.trim(),
    fechaExamen,
    horaEstudio: horaEstudio ? horaEstudio.trim() : null,
    entradas,
    recordatoriosProgramados: false,
    creadoEn: new Date(ahoraMs(deps)).toISOString()
  };

  let recordatorios = 0;
  let aviso = 'Sin hora no programo recordatorios: dime a que hora quieres estudiar (por ejemplo, 17:30) y los creo.';
  if (plan.horaEstudio) {
    const crear = typeof deps.crearRecordatorio === 'function' ? deps.crearRecordatorio : crearRecordatorioReal;
    const resultado = programarSesiones(plan, plan.horaEstudio, deps, crear);
    recordatorios = resultado.recordatorios;
    plan.recordatoriosProgramados = true;
    aviso = resultado.errores.length ? `Fallaron ${resultado.errores.length} recordatorios.` : null;
  }

  planes.push(plan);
  guardarPlanes(planes, deps);
  return { ok: true, plan, recordatorios, aviso };
}

/**
 * Programa (una sola vez) los recordatorios de un plan ya creado, a la hora
 * elegida por el propietario.
 */
export function programarRecordatoriosPlan(criterio, hora, deps = {}) {
  if (!validarHora(hora)) {
    return { ok: false, error: 'Hora invalida. Usa formato HH:MM, por ejemplo 17:30.' };
  }
  const planes = leerPlanes(deps);
  const { plan, error, coincidencias } = buscarPlan(planes, criterio);
  if (error) return { ok: false, error, coincidencias };
  if (plan.recordatoriosProgramados) {
    return { ok: false, error: `El plan de ${plan.asignatura} ya tiene recordatorios programados (hora ${plan.horaEstudio}). No se duplican.` };
  }
  const crear = typeof deps.crearRecordatorio === 'function' ? deps.crearRecordatorio : crearRecordatorioReal;
  const resultado = programarSesiones(plan, hora.trim(), deps, crear);
  plan.horaEstudio = hora.trim();
  plan.recordatoriosProgramados = true;
  guardarPlanes(planes, deps);
  return {
    ok: true,
    plan,
    recordatorios: resultado.recordatorios,
    aviso: resultado.errores.length ? `Fallaron ${resultado.errores.length} recordatorios.` : null
  };
}

export function listarPlanes(deps = {}) {
  return leerPlanes(deps)
    .map((p) => ({ ...p, pendientes: p.entradas.filter((e) => !e.completada).length }))
    .sort((a, b) => a.fechaExamen.localeCompare(b.fechaExamen));
}

function buscarPlan(planes, criterio) {
  if (typeof criterio !== 'string' || !criterio.trim()) {
    return { error: 'Indica la asignatura o el ID del plan.' };
  }
  const q = criterio.trim().toLowerCase();
  const porId = planes.filter((p) => p.id === q);
  const coincidencias = porId.length ? porId : planes.filter((p) => p.asignatura.toLowerCase().includes(q));
  if (coincidencias.length === 0) return { error: `No hay ningun plan que coincida con "${criterio}".` };
  if (coincidencias.length > 1) {
    return { error: `Varios planes coinciden con "${criterio}". Se mas especifico o usa el ID.`, coincidencias: coincidencias.map((p) => ({ id: p.id, asignatura: p.asignatura, fechaExamen: p.fechaExamen })) };
  }
  return { plan: coincidencias[0] };
}

/**
 * Marca como completada la sesion de una fecha (por defecto, la primera
 * pendiente). deps como en crearPlanEstudio.
 */
export function registrarAvance(criterio, { fecha } = {}, deps = {}) {
  const planes = leerPlanes(deps);
  const { plan, error, coincidencias } = buscarPlan(planes, criterio);
  if (error) return { ok: false, error, coincidencias };
  const pendientes = plan.entradas.filter((e) => !e.completada);
  if (pendientes.length === 0) {
    return { ok: false, error: `El plan de ${plan.asignatura} ya esta completado.` };
  }
  let entrada;
  if (fecha) {
    entrada = pendientes.find((e) => e.fecha === fecha);
    if (!entrada) {
      return { ok: false, error: `No hay sesion pendiente el ${fecha} en el plan de ${plan.asignatura}.` };
    }
  } else {
    entrada = pendientes.sort((a, b) => a.fecha.localeCompare(b.fecha))[0];
  }
  entrada.completada = true;
  entrada.completadaEn = new Date(ahoraMs(deps)).toISOString();
  guardarPlanes(planes, deps);
  return { ok: true, plan, entrada };
}

export function resumenPlan(criterio, deps = {}) {
  const planes = leerPlanes(deps);
  const { plan, error, coincidencias } = buscarPlan(planes, criterio);
  if (error) return { ok: false, error, coincidencias };
  const hechas = plan.entradas.filter((e) => e.completada).length;
  return {
    ok: true,
    plan,
    completadas: hechas,
    total: plan.entradas.length,
    proxima: plan.entradas.filter((e) => !e.completada).sort((a, b) => a.fecha.localeCompare(b.fecha))[0] || null
  };
}
