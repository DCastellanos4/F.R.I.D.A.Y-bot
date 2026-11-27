/**
 * habitsService.js - Seguimiento de habitos (nº 44)
 *
 * Habitos con marcado diario y racha (dias seguidos hasta ayer/hoy,
 * calendario Europe/Madrid). Sin avisos proactivos: el seguimiento es bajo
 * demanda de David.
 *
 * Soporte dual: SQLite Store (ACID + multi-tenant) y fallback JSON.
 *
 * Strict Policy: Zero Emojis.
 */
import fs from '../security/tenantFileSystem.js';
import path from 'node:path';
import crypto from 'node:crypto';
import { DATA_DIR } from '../config/paths.js';

export const ARCHIVO_DEFECTO = path.join(DATA_DIR, 'habitos.json');

let storeHabitosPorDefecto = null;

export function registrarStoreHabitosPorDefecto(store) {
  storeHabitosPorDefecto = store || null;
}

function storeDe(deps = {}) {
  if (deps.store) return deps.store;
  if (deps.rutaArchivo) return null;
  return storeHabitosPorDefecto;
}

function rutaArchivo(deps = {}) {
  return deps.rutaArchivo || ARCHIVO_DEFECTO;
}

function leer(deps = {}) {
  try {
    const data = JSON.parse(fs.readFileSync(rutaArchivo(deps), 'utf-8'));
    return {
      habitos: Array.isArray(data.habitos) ? data.habitos : [],
      config: data.config && typeof data.config === 'object' ? data.config : {},
      ultimoCheckIn: typeof data.ultimoCheckIn === 'string' ? data.ultimoCheckIn : null
    };
  } catch {
    return { habitos: [], config: {}, ultimoCheckIn: null };
  }
}

function guardar(estado, deps = {}) {
  const ruta = rutaArchivo(deps);
  fs.mkdirSync(path.dirname(ruta), { recursive: true });
  const tmp = `${ruta}.tmp.${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(estado, null, 2), 'utf-8');
  fs.renameSync(tmp, ruta);
}

function hoy(deps = {}) {
  const ref = deps.ahora ? new Date(deps.ahora) : new Date();
  return ref.toLocaleDateString('sv-SE', { timeZone: 'Europe/Madrid' });
}

function racha(marcas, hoyStr) {
  let r = 0;
  const dia = new Date(hoyStr + 'T12:00:00Z');
  if (!marcas.includes(hoyStr)) dia.setUTCDate(dia.getUTCDate() - 1);
  for (;;) {
    const clave = dia.toISOString().slice(0, 10);
    if (!marcas.includes(clave)) break;
    r++;
    dia.setUTCDate(dia.getUTCDate() - 1);
  }
  return r;
}

export function registrarHabito({ nombre } = {}, deps = {}) {
  const n = String(nombre || '').trim();
  if (!n) return { ok: false, error: 'Dime que habito quieres seguir (por ejemplo: "leer 20 minutos").' };
  if (n.length > 80) return { ok: false, error: 'Nombre demasiado largo.' };

  const store = storeDe(deps);
  if (store) {
    try {
      const habito = store.crear({ nombre: n }, deps.tenantId);
      if (habito && habito.ok === false) return habito;
      return { ok: true, habito };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  const estado = leer(deps);
  if (estado.habitos.some((h) => h.nombre.toLowerCase() === n.toLowerCase())) {
    return { ok: false, error: `Ya sigues el habito "${n}".` };
  }
  const habito = { id: crypto.randomBytes(4).toString('hex'), nombre: n, marcas: [], creadoEn: new Date().toISOString() };
  estado.habitos.push(habito);
  guardar(estado, deps);
  return { ok: true, habito };
}

export function marcarHabito({ criterio, fecha } = {}, deps = {}) {
  const store = storeDe(deps);
  if (store) {
    const f = /^\d{4}-\d{2}-\d{2}$/.test(String(fecha || '')) ? fecha : hoy(deps);
    return store.marcar(criterio, f, deps.tenantId);
  }

  const c = String(criterio || '').trim().toLowerCase();
  const estado = leer(deps);
  const habito = estado.habitos.find((h) => h.id === criterio || (c && h.nombre.toLowerCase().includes(c)));
  if (!habito) return { ok: false, error: 'No encuentro ese habito. Lista los tuyos con "mis habitos".' };
  const f = /^\d{4}-\d{2}-\d{2}$/.test(String(fecha || '')) ? fecha : hoy(deps);
  if (habito.marcas.includes(f)) return { ok: false, error: `"${habito.nombre}" ya estaba marcado el ${f}.` };
  habito.marcas.push(f);
  habito.marcas.sort();
  guardar(estado, deps);
  return { ok: true, habito, racha: racha(habito.marcas, hoy(deps)) };
}

export function listarHabitos(deps = {}) {
  const store = storeDe(deps);
  if (store) {
    return store.listar(deps.tenantId, hoy(deps));
  }

  const hoyStr = hoy(deps);
  return leer(deps).habitos.map((h) => ({
    nombre: h.nombre,
    hechoHoy: h.marcas.includes(hoyStr),
    racha: racha(h.marcas, hoyStr),
    totalDias: h.marcas.length
  }));
}

function horaMadridDe(fecha) {
  const str = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Madrid',
    hour: '2-digit',
    hourCycle: 'h23'
  }).format(fecha);
  const h = Number.parseInt(str, 10);
  return Number.isFinite(h) ? h : 0;
}

export function configurarCheckInNocturno({ activo, horaDesde } = {}, deps = {}) {
  const estado = leer(deps);
  estado.config = {
    ...(estado.config || {}),
    checkInNocturno: Boolean(activo),
    ...(typeof horaDesde === 'number' ? { horaDesde } : {})
  };
  guardar(estado, deps);
  return { ok: true, config: estado.config };
}

/**
 * Evalua si corresponde lanzar el check-in nocturno opt-in de habitos pendientes.
 * Solo avisa si esta activado en configuracion, esta dentro del horario nocturno
 * (por defecto >= 20:00 Europe/Madrid), no se ha notificado hoy y hay pendientes.
 */
export function evaluarCheckInHabitosPendientes(ahora = new Date(), deps = {}) {
  let refAhora = ahora;
  let opciones = deps;
  if (ahora && typeof ahora === 'object' && !(ahora instanceof Date)) {
    opciones = ahora;
    refAhora = opciones.ahora ? new Date(opciones.ahora) : new Date();
  } else {
    refAhora = ahora ? new Date(ahora) : new Date();
  }

  const hoyStr = hoy({ ...opciones, ahora: refAhora });
  const estado = leer(opciones);
  const cfg = estado.config || {};
  const activo = Boolean(
    opciones.checkInNocturno ??
    opciones.config?.checkInNocturno ??
    opciones.config?.activo ??
    cfg.checkInNocturno ??
    (process.env.DAVIS_HABITS_CHECKIN_NOCTURNO === 'true')
  );

  if (!activo) {
    return { ok: true, avisar: false, motivo: 'desactivado', fecha: hoyStr, pendientes: [], mensaje: null };
  }

  const horaMadrid = horaMadridDe(refAhora);
  const horaDesde = opciones.horaDesde ?? opciones.config?.horaDesde ?? cfg.horaDesde ?? 20;
  if (!opciones.ignorarHorario && typeof horaDesde === 'number' && horaMadrid < horaDesde) {
    return { ok: true, avisar: false, motivo: 'fuera_de_horario', fecha: hoyStr, horaMadrid, pendientes: [], mensaje: null };
  }

  if (!opciones.forzar && estado.ultimoCheckIn === hoyStr) {
    return { ok: true, avisar: false, motivo: 'ya_notificado_hoy', fecha: hoyStr, pendientes: [], mensaje: null };
  }

  const lista = listarHabitos({ ...opciones, ahora: refAhora });
  const pendientes = lista.filter((h) => !h.hechoHoy);
  if (pendientes.length === 0) {
    return { ok: true, avisar: false, motivo: 'sin_pendientes', fecha: hoyStr, pendientes: [], mensaje: null };
  }

  if (!storeDe(opciones)) {
    estado.ultimoCheckIn = hoyStr;
    guardar(estado, opciones);
  }

  const nombres = pendientes.map((p) => p.nombre).join(', ');
  const mensaje = `Check-in nocturno de habitos (${hoyStr}): tienes ${pendientes.length} pendiente(s) hoy: ${nombres}.`;
  return {
    ok: true,
    avisar: true,
    motivo: 'pendientes',
    fecha: hoyStr,
    pendientes,
    mensaje
  };
}
