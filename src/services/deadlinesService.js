/**
 * deadlinesService.js - Calendario de entregas y examenes (nº 8)
 *
 * Registro de entregas y examenes con fecha y dias restantes (Europe/Madrid).
 * Los avisos puntuales los cubre el sistema de recordatorios (nº 2) cuando
 * David los pide; aqui no hay monitor proactivo propio.
 *
 * Strict Policy: Zero Emojis.
 */
import fs from '../security/tenantFileSystem.js';
import path from 'node:path';
import crypto from 'node:crypto';
import { DATA_DIR } from '../config/paths.js';

export const ARCHIVO_DEFECTO = path.join(DATA_DIR, 'entregas.json');
const TIPOS = ['entrega', 'examen'];

function rutaArchivo(deps = {}) {
  return deps.rutaArchivo || ARCHIVO_DEFECTO;
}

function leer(deps = {}) {
  try {
    const data = JSON.parse(fs.readFileSync(rutaArchivo(deps), 'utf-8'));
    return {
      entregas: Array.isArray(data.entregas) ? data.entregas : [],
      config: data.config && typeof data.config === 'object' ? data.config : {}
    };
  } catch {
    return { entregas: [], config: {} };
  }
}

function guardar(estado, deps = {}) {
  const ruta = rutaArchivo(deps);
  fs.mkdirSync(path.dirname(ruta), { recursive: true });
  const tmp = `${ruta}.tmp.${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(estado, null, 2), 'utf-8');
  fs.renameSync(tmp, ruta);
}

function hoyMadrid(deps = {}) {
  const ref = deps.ahora ? new Date(deps.ahora) : new Date();
  return ref.toLocaleDateString('sv-SE', { timeZone: 'Europe/Madrid' });
}

export function registrarEntrega({ titulo, fecha, tipo } = {}, deps = {}) {
  const t = String(titulo || '').trim().slice(0, 80);
  if (!t) return { ok: false, error: 'Dime que se entrega o que examen es.' };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(fecha || ''))) return { ok: false, error: 'Necesito la fecha en AAAA-MM-DD.' };
  const tipoOk = TIPOS.includes(String(tipo || '').toLowerCase()) ? String(tipo).toLowerCase() : 'entrega';
  const estado = leer(deps);
  if (estado.entregas.some((e) => e.titulo.toLowerCase() === t.toLowerCase() && e.fecha === fecha)) {
    return { ok: false, error: `Ya tienes "${t}" apuntado para el ${fecha}.` };
  }
  const entrega = { id: crypto.randomBytes(4).toString('hex'), titulo: t, fecha, tipo: tipoOk, creadaEn: new Date().toISOString() };
  estado.entregas.push(entrega);
  guardar(estado, deps);
  return { ok: true, entrega };
}

export function listarEntregas(deps = {}) {
  const hoy = hoyMadrid(deps);
  return leer(deps).entregas
    .map((e) => ({ ...e, dias: Math.round((new Date(e.fecha + 'T12:00:00Z') - new Date(hoy + 'T12:00:00Z')) / 86400000) }))
    .sort((a, b) => a.fecha.localeCompare(b.fecha));
}

export function eliminarEntrega(criterio, deps = {}) {
  const c = String(criterio || '').trim().toLowerCase();
  const estado = leer(deps);
  const idx = estado.entregas.findIndex((e) => e.id === criterio || (c && e.titulo.toLowerCase().includes(c)));
  if (!c || idx === -1) return { ok: false, error: 'No encuentro esa entrega o examen.' };
  const [borrada] = estado.entregas.splice(idx, 1);
  guardar(estado, deps);
  return { ok: true, borrada };
}

export function configurarAlertasEntregas({ activo } = {}, deps = {}) {
  const estado = leer(deps);
  estado.config = {
    ...(estado.config || {}),
    alertasProactivas: Boolean(activo)
  };
  guardar(estado, deps);
  return { ok: true, config: estado.config };
}

/**
 * Evalua entregas y examenes proximos (<=48h / <=24h) aun no notificados.
 * Opt-in: solo genera alertas si esta activado en configuracion o deps.
 */
export function evaluarAlertasEntregas(ahora = new Date(), deps = {}) {
  let refAhora = ahora;
  let opciones = deps;
  if (ahora && typeof ahora === 'object' && !(ahora instanceof Date)) {
    opciones = ahora;
    refAhora = opciones.ahora ? new Date(opciones.ahora) : new Date();
  } else {
    refAhora = ahora ? new Date(ahora) : new Date();
  }

  const hoy = hoyMadrid({ ...opciones, ahora: refAhora });
  const estado = leer(opciones);
  const cfg = estado.config || {};
  const activo = Boolean(
    opciones.alertasProactivas ??
    opciones.activo ??
    opciones.config?.alertasProactivas ??
    opciones.config?.activo ??
    cfg.alertasProactivas ??
    (process.env.DAVIS_DEADLINES_ALERTAS === 'true')
  );

  if (!activo) {
    return { ok: true, avisar: false, motivo: 'desactivado', fecha: hoy, alertas: [], mensaje: null };
  }

  const alertas = [];
  let huboCambios = false;

  for (const e of estado.entregas) {
    const dias = Math.round((new Date(e.fecha + 'T12:00:00Z') - new Date(hoy + 'T12:00:00Z')) / 86400000);
    if (dias < 0 || dias > 2) continue;

    const umbral = dias <= 1 ? '24h' : '48h';
    const yaNotificadas = Array.isArray(e.alertasNotificadas) ? e.alertasNotificadas : [];
    if (yaNotificadas.includes(umbral)) continue;

    e.alertasNotificadas = [...yaNotificadas, umbral];
    huboCambios = true;
    alertas.push({
      id: e.id,
      titulo: e.titulo,
      tipo: e.tipo,
      fecha: e.fecha,
      dias,
      umbral
    });
  }

  if (huboCambios) {
    guardar(estado, opciones);
  }

  if (alertas.length === 0) {
    return { ok: true, avisar: false, motivo: 'sin_alertas', fecha: hoy, alertas: [], mensaje: null };
  }

  const lineas = alertas.map((a) => `- ${a.titulo} (${a.tipo}) el ${a.fecha} (ventana <=${a.umbral})`);
  const mensaje = `Alertas de entregas proximas:\n${lineas.join('\n')}`;
  return {
    ok: true,
    avisar: true,
    motivo: 'entregas_proximas',
    fecha: hoy,
    alertas,
    mensaje
  };
}
