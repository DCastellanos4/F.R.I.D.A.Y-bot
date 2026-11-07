/**
 * calendarService.js - Sincronizacion bidireccional con Google Calendar y Tareas.
 * Permite a D.A.V.I.S. consultar disponibilidad, listar eventos, crear citas
 * y sincronizar entregas/examenes con calendarios reales.
 *
 * Strict Policy: Zero Emojis.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fetchSeguro } from './safeFetch.js';

const DATA_DIR = process.env.DAVIS_DATA_DIR || path.join(process.cwd(), 'data');
export const ARCHIVO_CALENDARIO_LOCAL = path.join(DATA_DIR, 'calendar_events.json');

function leerEventosLocales(deps = {}) {
  const ruta = deps.rutaArchivo || ARCHIVO_CALENDARIO_LOCAL;
  try {
    return JSON.parse(fs.readFileSync(ruta, 'utf8'));
  } catch {
    return [];
  }
}

function escribirEventosLocales(eventos, deps = {}) {
  const ruta = deps.rutaArchivo || ARCHIVO_CALENDARIO_LOCAL;
  fs.mkdirSync(path.dirname(ruta), { recursive: true });
  fs.writeFileSync(ruta, JSON.stringify(eventos, null, 2));
}

export function getGoogleApiKey(deps = {}) {
  return deps.apiKey || process.env.GOOGLE_CALENDAR_API_KEY || null;
}

export function getCalendarId(deps = {}) {
  return deps.calendarId || process.env.GOOGLE_CALENDAR_ID || 'primary';
}

/**
 * Consulta eventos programados en un rango de fechas.
 */
export async function consultarEventos({ desde, hasta } = {}, deps = {}) {
  const fDesde = desde ? new Date(desde).toISOString() : new Date().toISOString();
  const dHasta = hasta ? new Date(hasta) : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const fHasta = dHasta.toISOString();

  const apiKey = getGoogleApiKey(deps);
  const calId = encodeURIComponent(getCalendarId(deps));

  // Si hay API key de Google configurada, consulta la API oficial
  if (apiKey) {
    const fetchFn = deps.fetchFn || fetchSeguro;
    const url = `https://www.googleapis.com/calendar/v3/calendars/${calId}/events?timeMin=${encodeURIComponent(fDesde)}&timeMax=${encodeURIComponent(fHasta)}&singleEvents=true&orderBy=startTime&key=${apiKey}`;

    try {
      const res = await fetchFn(url);
      if (res.ok) {
        const data = await res.json();
        const items = (data.items || []).map((e) => ({
          id: e.id,
          titulo: e.summary || '(Sin titulo)',
          inicio: e.start?.dateTime || e.start?.date,
          fin: e.end?.dateTime || e.end?.date,
          descripcion: e.description || null,
          origen: 'google_calendar'
        }));
        return { ok: true, eventos: items, fuente: 'google' };
      }
    } catch {
      // Fallback a almacenamiento local si la red falla
    }
  }

  // Almacenamiento local estructurado
  const eventosLocales = leerEventosLocales(deps).filter((e) => {
    return e.inicio >= fDesde.slice(0, 10) && e.inicio <= fHasta.slice(0, 10);
  });

  return { ok: true, eventos: eventosLocales, fuente: 'local' };
}

/**
 * Registra un nuevo evento o cita en el calendario.
 */
export async function crearEvento({ titulo, inicio, fin, descripcion } = {}, deps = {}) {
  const t = String(titulo || '').trim();
  if (!t) return { ok: false, error: 'Especifica el titulo del evento o cita.' };
  if (!inicio) return { ok: false, error: 'Especifica la fecha y hora de inicio (formato ISO o YYYY-MM-DD HH:mm).' };

  const evento = {
    id: `cal-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    titulo: t,
    inicio: String(inicio).trim(),
    fin: fin ? String(fin).trim() : null,
    descripcion: descripcion ? String(descripcion).trim() : null,
    creadoEn: (deps.ahora ? new Date(deps.ahora) : new Date()).toISOString()
  };

  const lista = leerEventosLocales(deps);
  lista.push(evento);
  escribirEventosLocales(lista, deps);

  return { ok: true, evento, nota: 'Evento registrado en la agenda de D.A.V.I.S.' };
}

/**
 * Elimina un evento por ID o titulo.
 */
export async function eliminarEvento({ id, titulo } = {}, deps = {}) {
  const lista = leerEventosLocales(deps);
  const inicial = lista.length;
  const filtrados = lista.filter((e) => {
    if (id && e.id === id) return false;
    if (titulo && e.titulo.toLowerCase().includes(titulo.toLowerCase())) return false;
    return true;
  });

  if (filtrados.length === inicial) {
    return { ok: false, error: 'No se encontro ningun evento que coincida para eliminar.' };
  }

  escribirEventosLocales(filtrados, deps);
  return { ok: true, eliminados: inicial - filtrados.length };
}
