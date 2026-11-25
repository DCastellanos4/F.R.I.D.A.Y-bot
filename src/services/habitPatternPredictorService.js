/**
 * habitPatternPredictorService.js - Proactividad Predictiva Basada en Rutinas
 *
 * Registra estadisticas anonimizadas de interaccion por dia de la semana (0-6)
 * y franja horaria de 2 horas en Europe/Madrid (ej: '08-10'), aisladas por
 * tenant_id en SQLite o JSON. Nunca almacena contenido de mensajes.
 *
 * Strict Policy: Zero Emojis.
 */

import fs from '../security/tenantFileSystem.js';
import path from 'node:path';
import { DATA_DIR } from '../config/paths.js';
import { TENANT_PROPIETARIO, afirmarTenantId } from '../core/tenancy.js';

const ARCHIVO_DEFECTO = path.join(DATA_DIR, 'routines_activity.json');
const NOMBRES_DIAS = Object.freeze([
  'Domingo',
  'Lunes',
  'Martes',
  'Miercoles',
  'Jueves',
  'Viernes',
  'Sabado'
]);
const MAPA_DIAS_EN = Object.freeze({
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6
});

const FMT_HORA_MADRID = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Madrid',
  hour: '2-digit',
  hourCycle: 'h23'
});

const FMT_DIA_MADRID = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Europe/Madrid',
  weekday: 'short'
});

let storeRutinasPorDefecto = null;

export function registrarStoreRutinasPorDefecto(store) {
  storeRutinasPorDefecto = store || null;
}

function storeDe(deps = {}) {
  if (deps?.store || deps?.routineStore) return deps.store || deps.routineStore;
  if (deps?.rutaArchivo) return null;
  return storeRutinasPorDefecto;
}

function rutaArchivoDe(deps = {}) {
  if (deps?.rutaArchivo) return deps.rutaArchivo;
  if (process.env.DAVIS_DATA_DIR) {
    return path.join(process.env.DAVIS_DATA_DIR, 'routines_activity.json');
  }
  return ARCHIVO_DEFECTO;
}

function tenantDe(deps = {}) {
  const tid = deps?.tenantId === undefined || deps?.tenantId === null
    ? TENANT_PROPIETARIO
    : deps.tenantId;
  return afirmarTenantId(tid);
}

function puedeTocarDiscoEnTest(deps = {}) {
  if (process.env.NODE_ENV !== 'test') return true;
  return Boolean(deps?.rutaArchivo || process.env.DAVIS_DATA_DIR);
}

function normalizarFecha(fecha = new Date()) {
  const d = fecha instanceof Date ? fecha : new Date(fecha);
  return Number.isNaN(d.getTime()) ? new Date() : d;
}

/**
 * Calcula la franja horaria de 2 horas en Europe/Madrid (ej. '08-10').
 */
export function franjaHorariaDe(fecha = new Date()) {
  const d = normalizarFecha(fecha);
  const horaStr = FMT_HORA_MADRID.format(d);
  const hora = Number.parseInt(horaStr, 10);
  const inicio = Math.floor((Number.isFinite(hora) ? hora : 0) / 2) * 2;
  const fin = inicio + 2;
  return `${String(inicio).padStart(2, '0')}-${String(fin).padStart(2, '0')}`;
}

/**
 * Calcula el dia de la semana (0 = Domingo .. 6 = Sabado) en Europe/Madrid.
 */
export function diaSemanaDe(fecha = new Date()) {
  const d = normalizarFecha(fecha);
  const abbr = FMT_DIA_MADRID.format(d);
  return Object.prototype.hasOwnProperty.call(MAPA_DIAS_EN, abbr)
    ? MAPA_DIAS_EN[abbr]
    : d.getDay();
}

function leerJson(deps = {}) {
  if (!puedeTocarDiscoEnTest(deps)) return [];
  const ruta = rutaArchivoDe(deps);
  try {
    if (!fs.existsSync(ruta)) return [];
    const data = JSON.parse(fs.readFileSync(ruta, 'utf-8'));
    if (Array.isArray(data)) return data;
    return Array.isArray(data?.registros) ? data.registros : [];
  } catch {
    return [];
  }
}

function guardarJson(registros, deps = {}) {
  if (!puedeTocarDiscoEnTest(deps)) return;
  const ruta = rutaArchivoDe(deps);
  fs.mkdirSync(path.dirname(ruta), { recursive: true });
  const tmp = `${ruta}.tmp.${process.pid}.${Date.now()}`;
  fs.writeFileSync(tmp, JSON.stringify({ registros }, null, 2), 'utf-8');
  fs.renameSync(tmp, ruta);
}

function calcularConfianza(conteo, umbralMinimo, ultimaVez, refFecha) {
  const c = Math.max(1, Number(conteo) || 1);
  const u = Math.max(1, Number(umbralMinimo) || 3);
  const factorFrecuencia = Math.min(1, 0.5 + ((c - u) / Math.max(u, 3)) * 0.45);

  let factorRecencia = 1;
  if (ultimaVez) {
    const ultimaMs = new Date(ultimaVez).getTime();
    const refMs = normalizarFecha(refFecha).getTime();
    if (Number.isFinite(ultimaMs) && Number.isFinite(refMs)) {
      const dias = Math.max(0, (refMs - ultimaMs) / (24 * 60 * 60 * 1000));
      factorRecencia = Math.exp(-dias / 30);
    }
  }

  const raw = factorFrecuencia * (0.7 + 0.3 * factorRecencia);
  return Number(Math.min(0.99, Math.max(0.1, raw)).toFixed(2));
}

function construirSugerencia({ franjaHoraria, intencion, herramienta, conteo, confianza }) {
  const pct = Math.round(confianza * 100);
  const detalleHerr = herramienta ? ` (herramienta: ${herramienta})` : '';
  return `[${franjaHoraria}] Patron frecuente de ${intencion}${detalleHerr}: ${conteo} veces (confianza ${pct}%)`;
}

/**
 * Registra metadatos estadisticos de una interaccion para deteccion de rutinas.
 * Ignora intencion 'conversacion' y nunca persiste texto del mensaje.
 */
export function registrarActividadRutina({ intencion, herramienta = '', fecha = new Date() } = {}, deps = {}) {
  const tenantId = tenantDe(deps);
  const intencionNorm = String(intencion || '').trim().toLowerCase().slice(0, 60);

  if (!intencionNorm || intencionNorm === 'conversacion') {
    return { ok: true, registrada: false, motivo: 'intencion_ignorada' };
  }

  const d = normalizarFecha(fecha);
  const diaSemana = diaSemanaDe(d);
  const franjaHoraria = franjaHorariaDe(d);
  const herramientaNorm = String(herramienta || '').trim().slice(0, 80);
  const store = storeDe(deps);

  if (store) {
    store.registrar({
      diaSemana,
      franjaHoraria,
      intencion: intencionNorm,
      herramienta: herramientaNorm
    }, tenantId);
    return {
      ok: true,
      registrada: true,
      tenantId,
      diaSemana,
      franjaHoraria,
      intencion: intencionNorm,
      herramienta: herramientaNorm
    };
  }

  if (!puedeTocarDiscoEnTest(deps)) {
    return { ok: true, registrada: false, motivo: 'aislamiento_test' };
  }

  const ahoraIso = d.toISOString();
  const registros = leerJson(deps);
  const existente = registros.find((r) =>
    (r.tenant_id || TENANT_PROPIETARIO) === tenantId &&
    Number(r.dia_semana) === diaSemana &&
    r.franja_horaria === franjaHoraria &&
    r.intencion === intencionNorm &&
    (r.herramienta || '') === herramientaNorm
  );

  if (existente) {
    existente.conteo = (Number(existente.conteo) || 0) + 1;
    existente.ultima_vez = ahoraIso;
  } else {
    registros.push({
      tenant_id: tenantId,
      dia_semana: diaSemana,
      franja_horaria: franjaHoraria,
      intencion: intencionNorm,
      herramienta: herramientaNorm,
      conteo: 1,
      ultima_vez: ahoraIso
    });
  }

  guardarJson(registros, deps);
  return {
    ok: true,
    registrada: true,
    tenantId,
    diaSemana,
    franjaHoraria,
    intencion: intencionNorm,
    herramienta: herramientaNorm
  };
}

/**
 * Devuelve predicciones de rutinas para la fecha (y franja opcional) con
 * conteo >= umbralMinimo y puntuacion de confianza.
 */
export function predecirNecesidades({ fecha = new Date(), umbralMinimo = 3, franja = null, tenantId: tenantOpt = undefined } = {}, deps = {}) {
  const tenantId = tenantDe({ ...deps, tenantId: tenantOpt !== undefined ? tenantOpt : deps?.tenantId });
  const ref = normalizarFecha(fecha);
  const diaSemana = diaSemanaDe(ref);
  const umbral = Math.max(1, Number(umbralMinimo) || 3);
  const franjaFiltro = franja === true
    ? franjaHorariaDe(ref)
    : (typeof franja === 'string' && franja.trim() ? franja.trim() : null);

  const store = storeDe(deps);
  const filas = store
    ? store.listarPorDia(diaSemana, tenantId)
    : leerJson(deps).filter((r) =>
      (r.tenant_id || TENANT_PROPIETARIO) === tenantId &&
      Number(r.dia_semana) === diaSemana
    );

  return (filas || [])
    .filter((r) => Number(r.conteo) >= umbral && (!franjaFiltro || r.franja_horaria === franjaFiltro))
    .map((r) => {
      const conteo = Number(r.conteo);
      const franjaHoraria = r.franja_horaria;
      const intencion = r.intencion;
      const herramienta = r.herramienta || '';
      const confianza = calcularConfianza(conteo, umbral, r.ultima_vez, ref);
      return {
        tenantId: r.tenant_id || tenantId,
        diaSemana: Number(r.dia_semana),
        franjaHoraria,
        intencion,
        herramienta,
        conteo,
        ultimaVez: r.ultima_vez || null,
        confianza,
        sugerencia: construirSugerencia({ franjaHoraria, intencion, herramienta, conteo, confianza })
      };
    })
    .sort((a, b) => (b.confianza - a.confianza) || (b.conteo - a.conteo));
}

/**
 * Formatea todas las rutinas aprendidas del tenant activo en texto legible sin emojis.
 */
export function formatearRutinasAprendidas(deps = {}) {
  const tenantId = tenantDe(deps);
  const umbral = Math.max(1, Number(deps?.umbralMinimo) || 1);
  const limite = Math.max(1, Number(deps?.limite) || 25);
  const store = storeDe(deps);

  const filas = store
    ? store.listarTodas(tenantId)
    : leerJson(deps).filter((r) => (r.tenant_id || TENANT_PROPIETARIO) === tenantId);

  const filtradas = (filas || [])
    .filter((r) => Number(r.conteo) >= umbral)
    .sort((a, b) => (Number(b.conteo) - Number(a.conteo)) || String(b.ultima_vez || '').localeCompare(String(a.ultima_vez || '')))
    .slice(0, limite);

  if (filtradas.length === 0) {
    return 'No hay rutinas de actividad aprendidas todavia para este usuario.';
  }

  const lineas = [`Rutinas de actividad aprendidas (${filtradas.length} patrones):`];
  filtradas.forEach((r, idx) => {
    const diaNombre = NOMBRES_DIAS[Number(r.dia_semana)] || `Dia ${r.dia_semana}`;
    const herr = r.herramienta ? ` | herramienta: ${r.herramienta}` : '';
    const estado = Number(r.conteo) >= 3 ? 'consolidada' : 'en observacion';
    lineas.push(`${idx + 1}. ${diaNombre} [${r.franja_horaria}] - intencion: ${r.intencion}${herr} | frecuencia: ${r.conteo} (${estado})`);
  });

  return lineas.join('\n');
}
