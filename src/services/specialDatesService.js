/**
 * specialDatesService.js - Cumpleanos y fechas senaladas (nº 32)
 *
 * Registra fechas senaladas (cumpleanos, aniversarios) y avisa de forma
 * proactiva SOLO si el propietario lo activa explicitamente
 * (configurar_avisos_fechas con guard de intencion en el ejecutor).
 * Registrar una fecha no implica opt-in a los avisos.
 *
 * Aviso por defecto: un dia antes y el mismo dia, una sola vez por fecha y
 * por anio. Zona horaria Europe/Madrid, convencion del repo.
 *
 * Strict Policy: Zero Emojis.
 */
import fs from '../security/tenantFileSystem.js';
import path from 'node:path';
import crypto from 'node:crypto';
import { DATA_DIR } from '../config/paths.js';
import { enqueueAlert } from './alertQueueService.js';

export const ARCHIVO_DEFECTO = path.join(DATA_DIR, 'fechas_senaladas.json');
export const INTERVALO_DEFECTO_MS = Number(process.env.DAVIS_FECHAS_INTERVALO_MS) || 12 * 60 * 60 * 1000;
export const DIAS_ANTELACION_DEFECTO = 1;

function rutaArchivo(deps = {}) {
  return deps.rutaArchivo || ARCHIVO_DEFECTO;
}

function leerEstado(deps = {}) {
  try {
    const data = JSON.parse(fs.readFileSync(rutaArchivo(deps), 'utf-8'));
    return {
      fechas: Array.isArray(data.fechas) ? data.fechas : [],
      config: typeof data.config === 'object' && data.config !== null ? data.config : {}
    };
  } catch {
    return { fechas: [], config: {} };
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

function proximaOcurrencia(f, referencia) {
  // Primera ocurrencia (mes, dia) igual o posterior a la referencia (Europe/Madrid).
  for (let anio = referencia.anio; anio <= referencia.anio + 1; anio++) {
    if (f.mes === 2 && f.dia === 29 && !esBisiesto(anio)) continue;
    if (anio > referencia.anio || f.mes > referencia.mes || (f.mes === referencia.mes && f.dia >= referencia.dia)) {
      return { anio, mes: f.mes, dia: f.dia };
    }
  }
  return null;
}

function esBisiesto(anio) {
  return (anio % 4 === 0 && anio % 100 !== 0) || anio % 400 === 0;
}

function diasEntre(ref, oc) {
  const a = Date.UTC(ref.anio, ref.mes - 1, ref.dia);
  const b = Date.UTC(oc.anio, oc.mes - 1, oc.dia);
  return Math.round((b - a) / 86400000);
}

function normalizarDiaMes(dia, mes) {
  const d = Number(dia);
  const m = Number(mes);
  if (!Number.isInteger(d) || !Number.isInteger(m) || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const maxDia = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
  if (d > maxDia) return null;
  return { dia: d, mes: m };
}

export function registrarFechaSenalada({ nombre, dia, mes, anio, descripcion } = {}, deps = {}) {
  const n = String(nombre || '').trim();
  if (!n) return { ok: false, error: 'Dime de quien o de que es la fecha (por ejemplo: "cumple de Ana").' };
  if (n.length > 80) return { ok: false, error: 'Nombre demasiado largo.' };
  const dm = normalizarDiaMes(dia, mes);
  if (!dm) return { ok: false, error: 'Fecha invalida: dime dia y mes (por ejemplo: 15 de marzo).' };
  let a = null;
  if (anio !== undefined && anio !== null && anio !== '') {
    a = Number(anio);
    if (!Number.isInteger(a) || a < 1900 || a > 2100) return { ok: false, error: 'Anio invalido.' };
    if (dm.mes === 2 && dm.dia === 29 && !esBisiesto(a)) return { ok: false, error: 'Ese anio no tiene 29 de febrero.' };
  }
  const estado = leerEstado(deps);
  const duplicada = estado.fechas.find((f) => f.nombre.toLowerCase() === n.toLowerCase() && f.dia === dm.dia && f.mes === dm.mes);
  if (duplicada) return { ok: false, error: `Ya tengo apuntada esa fecha para ${duplicada.nombre} (${dm.dia}/${dm.mes}).` };
  const fecha = {
    id: crypto.randomBytes(4).toString('hex'),
    nombre: n,
    dia: dm.dia,
    mes: dm.mes,
    anio: a,
    descripcion: String(descripcion || '').slice(0, 200) || null,
    creadaEn: new Date().toISOString(),
    ultimosAvisos: {}
  };
  estado.fechas.push(fecha);
  guardarEstado(estado, deps);
  return { ok: true, fecha };
}

export function listarFechasSenaladas(deps = {}) {
  return leerEstado(deps).fechas
    .slice()
    .sort((a, b) => (a.mes - b.mes) || (a.dia - b.dia));
}

export function eliminarFechaSenalada(criterio, deps = {}) {
  const estado = leerEstado(deps);
  const c = String(criterio || '').trim().toLowerCase();
  if (!c) return { ok: false, error: 'Dime que fecha quieres borrar.' };
  const idx = estado.fechas.findIndex((f) => f.id === criterio || f.nombre.toLowerCase().includes(c));
  if (idx === -1) return { ok: false, error: `No encuentro ninguna fecha que encaje con "${criterio}".` };
  const [borrada] = estado.fechas.splice(idx, 1);
  guardarEstado(estado, deps);
  return { ok: true, fecha: borrada };
}

export function proximasFechas({ dias = 30 } = {}, deps = {}) {
  const ref = fechaMadrid(ahora(deps));
  const tope = Math.min(Math.max(Number(dias) || 30, 1), 366);
  return leerEstado(deps).fechas
    .map((f) => {
      const oc = proximaOcurrencia(f, ref);
      return oc ? { ...f, proxima: oc, diasQueFaltan: diasEntre(ref, oc) } : null;
    })
    .filter(Boolean)
    .filter((f) => f.diasQueFaltan <= tope)
    .sort((a, b) => a.diasQueFaltan - b.diasQueFaltan);
}

// ---------- Avisos proactivos (opt-in explicito) ----------

export function configurarAvisosFechas({ activo } = {}, deps = {}) {
  const estado = leerEstado(deps);
  estado.config.avisosFechas = activo === true;
  guardarEstado(estado, deps);
  if (estado.config.avisosFechas) {
    iniciarMonitorFechas(deps);
    return { ok: true, activo: true };
  }
  detenerMonitorFechas();
  return { ok: true, activo: false };
}

export function lanzarRondaFechas(deps = {}) {
  const estado = leerEstado(deps);
  if (estado.fechas.length === 0) return { ok: true, avisadas: 0 };
  if (!estado.config || estado.config.avisosFechas !== true) return { ok: true, avisadas: 0 };
  const ref = fechaMadrid(ahora(deps));
  const antelacion = Number.isInteger(estado.config.diasAntelacion) ? estado.config.diasAntelacion : DIAS_ANTELACION_DEFECTO;
  const encolar = typeof deps.enqueue === 'function'
    ? deps.enqueue
    : (alerta) => enqueueAlert(alerta, deps.alertQueueOptions || {});
  let avisadas = 0;
  for (const f of estado.fechas) {
    const oc = proximaOcurrencia(f, ref);
    if (!oc) continue;
    const faltan = diasEntre(ref, oc);
    // Aviso el dia de la fecha y, si procede, con la antelacion configurada.
    const toca = faltan === 0 || (antelacion > 0 && faltan === antelacion);
    if (!toca) continue;
    const clave = `${oc.anio}-${faltan}`;
    if (f.ultimosAvisos && f.ultimosAvisos[clave]) continue;
    const edad = f.anio ? ` (cumple ${oc.anio - f.anio})` : '';
    encolar({
      title: faltan === 0 ? `Hoy: ${f.nombre}` : `Manana: ${f.nombre}`,
      details: faltan === 0
        ? `Hoy es ${f.nombre} (${oc.dia}/${oc.mes})${edad}.${f.descripcion ? ' ' + f.descripcion : ''}`
        : `Manana ${oc.dia}/${oc.mes} es ${f.nombre}${edad}. Vas con un dia de margen por si quieres preparar algo.`,
      priority: 'normal',
      source: 'fechas-senaladas'
    });
    if (!f.ultimosAvisos) f.ultimosAvisos = {};
    f.ultimosAvisos[clave] = new Date().toISOString();
    // Limpieza: conservar solo claves del anio en curso y el anterior.
    for (const k of Object.keys(f.ultimosAvisos)) {
      const anioClave = Number(k.split('-')[0]);
      if (anioClave < ref.anio - 1) delete f.ultimosAvisos[k];
    }
    avisadas++;
  }
  guardarEstado(estado, deps);
  return { ok: true, avisadas };
}

let temporizador = null;

export function iniciarMonitorFechas(deps = {}) {
  if (temporizador) return { iniciado: true, mensaje: 'El monitor de fechas senaladas ya estaba activo.' };
  const estado = leerEstado(deps);
  if (!estado.config || estado.config.avisosFechas !== true) {
    return { iniciado: false, motivo: 'Avisos de fechas desactivados: el propietario los activa explicitamente (configurar_avisos_fechas), no basta con registrar fechas.' };
  }
  if (estado.fechas.length === 0) {
    return { iniciado: false, motivo: 'Sin fechas registradas: el vigilante no arranca hasta que el propietario registre la primera.' };
  }
  temporizador = setInterval(() => {
    try {
      lanzarRondaFechas(deps);
    } catch (err) {
      console.error('[Fechas] Error en ronda de fechas senaladas:', err.message);
    }
  }, deps.intervaloMs || INTERVALO_DEFECTO_MS);
  if (typeof temporizador.unref === 'function') temporizador.unref();
  return { iniciado: true };
}

export function detenerMonitorFechas() {
  if (temporizador) {
    clearInterval(temporizador);
    temporizador = null;
  }
  return { ok: true };
}
