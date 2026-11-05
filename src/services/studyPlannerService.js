/**
 * studyPlannerService.js - Planificador de estudio (funcion nº 5 del roadmap)
 *
 * Dada una asignatura, una fecha de examen y una lista de temas, genera un
 * plan diario (reparto de temas + ultimo dia de repaso) y lo conecta con el
 * sistema de recordatorios existente. Persistencia en JSON con escritura
 * atomica. Todas las rutas y efectos son inyectables para pruebas.
 *
 * Strict Policy: Zero Emojis.
 */
import fs from 'node:fs';
import path from 'path';
import crypto from 'node:crypto';
import { DATA_DIR } from '../config/paths.js';
import { crearRecordatorio as crearRecordatorioReal } from './reminderService.js';

export const ARCHIVO_DEFECTO = path.join(DATA_DIR, 'study_plans.json');
export const HORA_ESTUDIO_DEFECTO = '18:00';

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

function hoyUTC(deps = {}) {
  const base = deps.hoy ? new Date(deps.hoy) : new Date();
  return new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate()));
}

function aFechaISO(d) {
  return d.toISOString().slice(0, 10);
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
    entradas.push({ offsetDia: dias - 1, tipo: 'repaso', temas: ['Repaso general de ' + 'todos los temas'] });
  }
  return entradas;
}

/**
 * Crea un plan de estudio y programa un recordatorio por sesion.
 * deps: { rutaArchivo, crearRecordatorio, hoy, horaEstudio }
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
  const hoy = hoyUTC(deps);
  const dias = Math.round((examen - hoy) / 86400000);
  if (dias < 0) {
    return { ok: false, error: 'La fecha del examen ya paso.' };
  }
  const diasPlan = Math.max(dias, 1);
  const temasLimpios = temas.map((t) => t.trim());
  const esquema = repartirTemario(temasLimpios, diasPlan);

  const ahora = deps.hoy ? new Date(deps.hoy) : new Date();
  const [hh, mm] = (horaEstudio || HORA_ESTUDIO_DEFECTO).split(':').map(Number);
  const entradas = esquema.map((e) => {
    const fecha = new Date(hoy.getTime() + e.offsetDia * 86400000);
    return { fecha: aFechaISO(fecha), tipo: e.tipo, temas: e.temas, completada: false };
  });

  const crear = typeof deps.crearRecordatorio === 'function' ? deps.crearRecordatorio : crearRecordatorioReal;
  let recordatorios = 0;
  const erroresRecordatorio = [];
  for (const entrada of entradas) {
    const objetivo = new Date(`${entrada.fecha}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00`);
    const minutos = Math.round((objetivo - ahora) / 60000);
    if (minutos <= 0) continue;
    const res = crear({
      mensaje: `Estudio de ${asignatura.trim()} (${entrada.tipo}): ${entrada.temas.join(', ')}. Examen: ${aFechaISO(examen)}.`,
      minutosEnElFuturo: minutos
    });
    if (res && res.ok === false) erroresRecordatorio.push(res.error || 'error desconocido');
    else recordatorios++;
  }

  const plan = {
    id: crypto.randomUUID().slice(0, 8),
    asignatura: asignatura.trim(),
    fechaExamen: aFechaISO(examen),
    horaEstudio: `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`,
    entradas,
    creadoEn: ahora.toISOString()
  };
  const planes = leerPlanes(deps);
  planes.push(plan);
  guardarPlanes(planes, deps);

  return {
    ok: true,
    plan,
    recordatorios,
    avisoRecordatorios: erroresRecordatorio.length ? `Fallaron ${erroresRecordatorio.length} recordatorios.` : null
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
  entrada.completadaEn = (deps.hoy ? new Date(deps.hoy) : new Date()).toISOString();
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
