/**
 * calendarService.js - Sincronizacion bidireccional con Google Calendar y Tareas.
 * Permite a D.A.V.I.S. consultar disponibilidad, listar eventos, crear citas,
 * modificar eventos y cancelar citas con sincronizacion en Google Calendar y local.
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
  if (deps.apiKey !== undefined) return deps.apiKey;
  return process.env.GOOGLE_CALENDAR_API_KEY || null;
}

export function getCalendarId(deps = {}) {
  return deps.calendarId || process.env.GOOGLE_CALENDAR_ID || 'primary';
}

export function getGoogleAccessToken(deps = {}) {
  if (deps.accessToken !== undefined) return deps.accessToken;
  return process.env.GOOGLE_CALENDAR_ACCESS_TOKEN || process.env.GOOGLE_CALENDAR_TOKEN || null;
}

export function getGoogleOAuthConfig(deps = {}) {
  const clientId = deps.clientId !== undefined ? deps.clientId : (process.env.GOOGLE_CLIENT_ID || null);
  const clientSecret = deps.clientSecret !== undefined ? deps.clientSecret : (process.env.GOOGLE_CLIENT_SECRET || null);
  const refreshToken = deps.refreshToken !== undefined ? deps.refreshToken : (process.env.GOOGLE_REFRESH_TOKEN || null);
  return { clientId, clientSecret, refreshToken };
}

const MARGEN_EXPIRACION_MS = 60 * 1000;

let oauthTokenCache = {
  accessToken: null,
  expiresAt: 0,
  clientId: null,
  refreshToken: null
};

export function resetOAuthTokenCache() {
  oauthTokenCache = {
    accessToken: null,
    expiresAt: 0,
    clientId: null,
    refreshToken: null
  };
}

function obtenerAhoraMs(deps = {}) {
  if (typeof deps.now === 'number') return deps.now;
  if (deps.ahora !== undefined) return new Date(deps.ahora).getTime();
  return Date.now();
}

/**
 * Obtiene un access_token valido para Google Calendar:
 * 1) Si hay credenciales OAuth2 (clientId, clientSecret, refreshToken), usa cache en memoria
 *    (con margen de 60s antes de expirar) o renueva via https://oauth2.googleapis.com/token.
 * 2) Fallback a GOOGLE_CALENDAR_ACCESS_TOKEN directo.
 */
export async function obtenerAccessTokenValido(deps = {}) {
  const { clientId, clientSecret, refreshToken } = getGoogleOAuthConfig(deps);
  const now = obtenerAhoraMs(deps);

  if (clientId && clientSecret && refreshToken) {
    const cacheValido =
      oauthTokenCache.accessToken &&
      oauthTokenCache.clientId === clientId &&
      oauthTokenCache.refreshToken === refreshToken &&
      (now + MARGEN_EXPIRACION_MS) < oauthTokenCache.expiresAt;

    if (cacheValido) {
      return oauthTokenCache.accessToken;
    }

    const fetchFn = deps.fetchFn || fetchSeguro;
    try {
      const body = new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token'
      }).toString();

      const res = await fetchFn('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded'
        },
        body
      });

      if (res.ok) {
        const data = await res.json();
        if (data?.access_token) {
          const expiresInSec = Number(data.expires_in) > 0 ? Number(data.expires_in) : 3600;
          oauthTokenCache = {
            accessToken: data.access_token,
            expiresAt: now + expiresInSec * 1000,
            clientId,
            refreshToken
          };
          return oauthTokenCache.accessToken;
        }
      }
    } catch {
      // Fallback a token directo si la renovacion OAuth2 falla
    }
  }

  return getGoogleAccessToken(deps);
}

/**
 * Consulta eventos programados en un rango de fechas.
 */
export async function consultarEventos({ desde, hasta } = {}, deps = {}) {
  const fDesde = desde ? new Date(desde).toISOString() : new Date().toISOString();
  const dHasta = hasta ? new Date(hasta) : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const fHasta = dHasta.toISOString();

  const apiKey = getGoogleApiKey(deps);
  const token = await obtenerAccessTokenValido(deps);
  const calId = encodeURIComponent(getCalendarId(deps));

  // Si hay credenciales OAuth2, access_token o API key configurada, consulta la API oficial
  if (token || apiKey) {
    const fetchFn = deps.fetchFn || fetchSeguro;
    const url = `https://www.googleapis.com/calendar/v3/calendars/${calId}/events?timeMin=${encodeURIComponent(fDesde)}&timeMax=${encodeURIComponent(fHasta)}&singleEvents=true&orderBy=startTime${apiKey ? `&key=${encodeURIComponent(apiKey)}` : ''}`;

    try {
      const res = await fetchFn(url, {
        headers: token ? { authorization: `Bearer ${token}` } : {}
      });
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

  const calId = encodeURIComponent(getCalendarId(deps));
  const apiKey = getGoogleApiKey(deps);
  const token = await obtenerAccessTokenValido(deps);
  let remoteId = null;
  let fuente = 'local';

  if (deps.fetchFn || token || apiKey) {
    const fetchFn = deps.fetchFn || fetchSeguro;
    const url = `https://www.googleapis.com/calendar/v3/calendars/${calId}/events${apiKey ? `?key=${encodeURIComponent(apiKey)}` : ''}`;
    try {
      const res = await fetchFn(url, {
        method: 'POST',
        headers: {
          ...(token ? { authorization: `Bearer ${token}` } : {}),
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          summary: t,
          description: descripcion ? String(descripcion).trim() : undefined,
          start: { dateTime: String(inicio).trim() },
          end: { dateTime: fin ? String(fin).trim() : String(inicio).trim() }
        })
      });
      if (res.ok) {
        const data = await res.json();
        if (data?.id) {
          remoteId = data.id;
          fuente = 'google';
        }
      }
    } catch {}
  }

  const evento = {
    id: remoteId || `cal-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    titulo: t,
    inicio: String(inicio).trim(),
    fin: fin ? String(fin).trim() : null,
    descripcion: descripcion ? String(descripcion).trim() : null,
    creadoEn: (deps.ahora ? new Date(deps.ahora) : new Date()).toISOString(),
    origen: fuente === 'google' ? 'google_calendar' : 'local'
  };

  const lista = leerEventosLocales(deps);
  lista.push(evento);
  escribirEventosLocales(lista, deps);

  return { ok: true, evento, nota: 'Evento registrado en la agenda de D.A.V.I.S.', fuente };
}

/**
 * Modifica un evento existente en el calendario.
 */
export async function modificarEvento({ id, criterio, titulo, inicio, fin, descripcion } = {}, deps = {}) {
  const c = String(id || criterio || titulo || '').trim().toLowerCase();
  if (!c) return { ok: false, error: 'Especifica el ID o titulo del evento a modificar.' };

  const calId = encodeURIComponent(getCalendarId(deps));
  const apiKey = getGoogleApiKey(deps);
  const token = await obtenerAccessTokenValido(deps);

  const lista = leerEventosLocales(deps);
  let evento = lista.find((e) => {
    if (id && e.id === id) return true;
    if (e.id.toLowerCase() === c) return true;
    if (e.titulo.toLowerCase().includes(c)) return true;
    return false;
  });

  if (!evento) {
    if (id && !String(id).startsWith('cal-') && (deps.fetchFn || token || apiKey)) {
      const fetchFn = deps.fetchFn || fetchSeguro;
      const url = `https://www.googleapis.com/calendar/v3/calendars/${calId}/events/${encodeURIComponent(id)}${apiKey ? `?key=${encodeURIComponent(apiKey)}` : ''}`;
      const patchBody = {};
      if (titulo !== undefined && String(titulo).trim()) patchBody.summary = String(titulo).trim();
      if (descripcion !== undefined) patchBody.description = descripcion ? String(descripcion).trim() : undefined;
      if (inicio !== undefined && String(inicio).trim()) patchBody.start = { dateTime: String(inicio).trim() };
      if (fin !== undefined && fin) patchBody.end = { dateTime: String(fin).trim() };

      try {
        const res = await fetchFn(url, {
          method: 'PATCH',
          headers: {
            ...(token ? { authorization: `Bearer ${token}` } : {}),
            'content-type': 'application/json'
          },
          body: JSON.stringify(patchBody)
        });
        if (res.ok) {
          const data = await res.json();
          evento = {
            id: data?.id || id,
            titulo: data?.summary || patchBody.summary || '(Sin titulo)',
            inicio: data?.start?.dateTime || data?.start?.date || (inicio ? String(inicio).trim() : null),
            fin: data?.end?.dateTime || data?.end?.date || (fin ? String(fin).trim() : null),
            descripcion: data?.description || (descripcion ? String(descripcion).trim() : null),
            actualizadoEn: (deps.ahora ? new Date(deps.ahora) : new Date()).toISOString(),
            origen: 'google_calendar'
          };
          return { ok: true, evento, nota: 'Evento modificado en la agenda de D.A.V.I.S.', fuente: 'google' };
        }
      } catch {}
    }
    return { ok: false, error: 'No se encontro ningun evento que coincida para modificar.' };
  }

  if (titulo !== undefined && String(titulo).trim()) {
    evento.titulo = String(titulo).trim();
  }
  if (inicio !== undefined && String(inicio).trim()) {
    evento.inicio = String(inicio).trim();
  }
  if (fin !== undefined) {
    evento.fin = fin ? String(fin).trim() : null;
  }
  if (descripcion !== undefined) {
    evento.descripcion = descripcion ? String(descripcion).trim() : null;
  }
  evento.actualizadoEn = (deps.ahora ? new Date(deps.ahora) : new Date()).toISOString();

  let fuente = 'local';

  if ((deps.fetchFn || token || apiKey) && evento.id && !evento.id.startsWith('cal-')) {
    const fetchFn = deps.fetchFn || fetchSeguro;
    const url = `https://www.googleapis.com/calendar/v3/calendars/${calId}/events/${encodeURIComponent(evento.id)}${apiKey ? `?key=${encodeURIComponent(apiKey)}` : ''}`;
    try {
      const res = await fetchFn(url, {
        method: 'PATCH',
        headers: {
          ...(token ? { authorization: `Bearer ${token}` } : {}),
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          summary: evento.titulo,
          description: evento.descripcion || undefined,
          start: { dateTime: evento.inicio },
          end: { dateTime: evento.fin || evento.inicio }
        })
      });
      if (res.ok) fuente = 'google';
    } catch {}
  }

  escribirEventosLocales(lista, deps);
  return { ok: true, evento, nota: 'Evento modificado en la agenda de D.A.V.I.S.', fuente };
}

/**
 * Cancela o elimina un evento por ID o titulo.
 */
export async function cancelarEvento({ id, criterio, titulo } = {}, deps = {}) {
  const c = String(id || criterio || titulo || '').trim().toLowerCase();
  if (!c) return { ok: false, error: 'Especifica el ID o titulo del evento a cancelar.' };

  const calId = encodeURIComponent(getCalendarId(deps));
  const apiKey = getGoogleApiKey(deps);
  const token = await obtenerAccessTokenValido(deps);

  const lista = leerEventosLocales(deps);
  const inicial = lista.length;
  const aEliminar = [];
  const filtrados = lista.filter((e) => {
    const coincide = (id && e.id === id) ||
                     (e.id.toLowerCase() === c) ||
                     (e.titulo.toLowerCase().includes(c));
    if (coincide) {
      aEliminar.push(e);
      return false;
    }
    return true;
  });

  if (filtrados.length === inicial) {
    if (id && !String(id).startsWith('cal-') && (deps.fetchFn || token || apiKey)) {
      const fetchFn = deps.fetchFn || fetchSeguro;
      const url = `https://www.googleapis.com/calendar/v3/calendars/${calId}/events/${encodeURIComponent(id)}${apiKey ? `?key=${encodeURIComponent(apiKey)}` : ''}`;
      try {
        const res = await fetchFn(url, {
          method: 'DELETE',
          headers: token ? { authorization: `Bearer ${token}` } : {}
        });
        if (res.ok) {
          return { ok: true, eliminados: 1, cancelados: 1, nota: 'Evento cancelado de la agenda.', fuente: 'google' };
        }
      } catch {}
    }
    return { ok: false, error: 'No se encontro ningun evento que coincida para cancelar.' };
  }

  if (deps.fetchFn || token || apiKey) {
    const fetchFn = deps.fetchFn || fetchSeguro;
    for (const ev of aEliminar) {
      if (ev.id && !ev.id.startsWith('cal-')) {
        try {
          const url = `https://www.googleapis.com/calendar/v3/calendars/${calId}/events/${encodeURIComponent(ev.id)}${apiKey ? `?key=${encodeURIComponent(apiKey)}` : ''}`;
          await fetchFn(url, {
            method: 'DELETE',
            headers: token ? { authorization: `Bearer ${token}` } : {}
          });
        } catch {}
      }
    }
  }

  escribirEventosLocales(filtrados, deps);
  const eliminados = inicial - filtrados.length;
  return { ok: true, eliminados, cancelados: eliminados, nota: 'Evento cancelado de la agenda.' };
}

export const eliminarEvento = cancelarEvento;
