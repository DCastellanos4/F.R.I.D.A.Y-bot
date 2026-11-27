/**
 * gmailService.js - Integracion real con Gmail API v1 (lectura y borradores).
 *
 * Reutiliza el mismo patron OAuth2 (GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET,
 * GOOGLE_REFRESH_TOKEN) de calendarService.js con cache en memoria y margen de
 * expiracion de 60s, o fallback a GOOGLE_GMAIL_ACCESS_TOKEN / GMAIL_ACCESS_TOKEN.
 *
 * Seguridad:
 * - Si no hay credenciales validas, devuelve { ok: false, configRequired: true }
 *   sin inventar correos.
 * - El envio nunca es directo: crearBorradorCorreo crea un borrador y
 *   enviarBorradorConfirmado envia unicamente un draftId ya confirmado.
 *
 * Strict Policy: Zero Emojis.
 */
import { fetchSeguro } from './safeFetch.js';

const GMAIL_API_BASE = 'https://gmail.googleapis.com/gmail/v1/users/me';
const OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token';
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

export function getGmailAccessToken(deps = {}) {
  if (deps.accessToken !== undefined) return deps.accessToken;
  return process.env.GOOGLE_GMAIL_ACCESS_TOKEN || process.env.GMAIL_ACCESS_TOKEN || null;
}

export function getGoogleOAuthConfig(deps = {}) {
  const clientId = deps.clientId !== undefined ? deps.clientId : (process.env.GOOGLE_CLIENT_ID || null);
  const clientSecret = deps.clientSecret !== undefined ? deps.clientSecret : (process.env.GOOGLE_CLIENT_SECRET || null);
  const refreshToken = deps.refreshToken !== undefined ? deps.refreshToken : (process.env.GOOGLE_REFRESH_TOKEN || null);
  return { clientId, clientSecret, refreshToken };
}

function obtenerAhoraMs(deps = {}) {
  if (typeof deps.now === 'number') return deps.now;
  if (deps.ahora !== undefined) return new Date(deps.ahora).getTime();
  return Date.now();
}

function respuestaConfigRequerida() {
  return {
    ok: false,
    configRequired: true,
    error: 'Gmail no configurado. Define GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET y GOOGLE_REFRESH_TOKEN (con scopes de Gmail) o GOOGLE_GMAIL_ACCESS_TOKEN.'
  };
}

/**
 * Obtiene un access_token valido para Gmail API v1:
 * 1) Si hay credenciales OAuth2 (clientId, clientSecret, refreshToken), usa cache en memoria
 *    (con margen de 60s antes de expirar) o renueva via https://oauth2.googleapis.com/token.
 * 2) Fallback a GOOGLE_GMAIL_ACCESS_TOKEN / GMAIL_ACCESS_TOKEN directo.
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

      const res = await fetchFn(OAUTH_TOKEN_URL, {
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

  return getGmailAccessToken(deps);
}

async function gmailFetch(endpoint, options = {}, deps = {}) {
  const token = await obtenerAccessTokenValido(deps);
  if (!token) {
    return respuestaConfigRequerida();
  }

  const fetchFn = deps.fetchFn || fetchSeguro;
  const url = `${GMAIL_API_BASE}${endpoint}`;

  try {
    const res = await fetchFn(url, {
      ...options,
      headers: {
        authorization: `Bearer ${token}`,
        ...(options.headers || {})
      }
    });

    if (!res.ok) {
      let detalle = `HTTP ${res.status}`;
      try {
        const errData = await res.json();
        if (errData?.error?.message) {
          detalle = errData.error.message;
        }
      } catch {
        // Ignorar cuerpo no JSON en errores HTTP
      }
      return {
        ok: false,
        status: res.status,
        error: `Error en Gmail API (${res.status}): ${detalle}`
      };
    }

    const data = await res.json();
    return { ok: true, data };
  } catch (err) {
    return {
      ok: false,
      error: `Error de conexion con Gmail API: ${err?.message || 'desconocido'}`
    };
  }
}

export function decodificarBase64Url(data) {
  if (!data || typeof data !== 'string') return '';
  const normalizado = data.replace(/-/g, '+').replace(/_/g, '/');
  const padding = normalizado.length % 4 === 0 ? '' : '='.repeat(4 - (normalizado.length % 4));
  return Buffer.from(normalizado + padding, 'base64').toString('utf8');
}

function limpiarHtmlATexto(html) {
  if (!html) return '';
  return String(html)
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]*\n[ \t]*/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function extraerCabeceras(headers = []) {
  const map = new Map();
  for (const h of headers) {
    if (h?.name) {
      map.set(String(h.name).toLowerCase(), String(h.value || ''));
    }
  }
  return {
    from: map.get('from') || '',
    to: map.get('to') || '',
    subject: map.get('subject') || '(Sin asunto)',
    date: map.get('date') || '',
    cc: map.get('cc') || '',
    replyTo: map.get('reply-to') || ''
  };
}

function buscarPartePorMime(payload, mimeObjetivo) {
  if (!payload) return null;
  if (payload.mimeType === mimeObjetivo && payload.body?.data) {
    return decodificarBase64Url(payload.body.data);
  }
  if (Array.isArray(payload.parts)) {
    for (const part of payload.parts) {
      const encontrado = buscarPartePorMime(part, mimeObjetivo);
      if (encontrado) return encontrado;
    }
  }
  return null;
}

function extraerCuerpoTexto(payload) {
  if (!payload) return '';
  const textoPlano = buscarPartePorMime(payload, 'text/plain');
  if (textoPlano) return textoPlano.trim();

  const html = buscarPartePorMime(payload, 'text/html');
  if (html) return limpiarHtmlATexto(html);

  if (payload.body?.data) {
    return decodificarBase64Url(payload.body.data).trim();
  }
  return '';
}

function limpiarValorCabecera(valor) {
  return String(valor || '').replace(/[\r\n]+/g, ' ').trim();
}

function codificarAsuntoMime(asunto) {
  const limpio = limpiarValorCabecera(asunto);
  if (/^[\x20-\x7E]*$/.test(limpio)) return limpio;
  return `=?UTF-8?B?${Buffer.from(limpio, 'utf8').toString('base64')}?=`;
}

/**
 * Lista correos recientes aplicando filtros opcionales de busqueda y no leidos.
 */
export async function listarCorreosRecientes({ query, maxResults = 10, soloNoLeidos = false } = {}, deps = {}) {
  const limite = Math.min(Math.max(Number(maxResults) || 10, 1), 50);
  const partesQuery = [];
  if (soloNoLeidos) partesQuery.push('is:unread');
  if (query && String(query).trim()) partesQuery.push(String(query).trim());
  const q = partesQuery.join(' ');

  const params = new URLSearchParams({ maxResults: String(limite) });
  if (q) params.set('q', q);

  const listRes = await gmailFetch(`/messages?${params.toString()}`, { method: 'GET' }, deps);
  if (!listRes.ok) return listRes;

  const mensajes = Array.isArray(listRes.data?.messages) ? listRes.data.messages : [];
  if (mensajes.length === 0) {
    return { ok: true, correos: [], total: 0 };
  }

  const detalles = await Promise.all(
    mensajes.map(async (m) => {
      const detailRes = await gmailFetch(
        `/messages/${encodeURIComponent(m.id)}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`,
        { method: 'GET' },
        deps
      );
      if (!detailRes.ok) {
        return {
          id: m.id,
          threadId: m.threadId || null,
          from: '',
          subject: '(No disponible)',
          date: '',
          snippet: '',
          error: detailRes.error
        };
      }
      const msg = detailRes.data;
      const cab = extraerCabeceras(msg.payload?.headers);
      return {
        id: msg.id || m.id,
        threadId: msg.threadId || m.threadId || null,
        from: cab.from,
        subject: cab.subject,
        date: cab.date,
        snippet: msg.snippet || '',
        labelIds: msg.labelIds || [],
        unread: Array.isArray(msg.labelIds) ? msg.labelIds.includes('UNREAD') : undefined
      };
    })
  );

  return {
    ok: true,
    correos: detalles,
    total: detalles.length
  };
}

/**
 * Lee un correo completo por messageId decodificando su cuerpo en texto limpio.
 */
export async function leerCorreo(messageId, deps = {}) {
  const id = typeof messageId === 'object' && messageId !== null
    ? String(messageId.messageId || messageId.id || '').trim()
    : String(messageId || '').trim();

  if (!id) {
    return { ok: false, error: 'Especifica el ID del correo a leer.' };
  }

  const res = await gmailFetch(`/messages/${encodeURIComponent(id)}?format=full`, { method: 'GET' }, deps);
  if (!res.ok) return res;

  const msg = res.data;
  const cab = extraerCabeceras(msg.payload?.headers);
  const cuerpo = extraerCuerpoTexto(msg.payload);

  return {
    ok: true,
    correo: {
      id: msg.id || id,
      threadId: msg.threadId || null,
      from: cab.from,
      to: cab.to,
      subject: cab.subject,
      date: cab.date,
      cc: cab.cc,
      replyTo: cab.replyTo,
      snippet: msg.snippet || '',
      cuerpo,
      labelIds: msg.labelIds || []
    }
  };
}

function clasificarCorreoUrgente(correo) {
  const texto = `${correo.subject || ''} ${correo.snippet || ''}`.toLowerCase();
  if (/(factura|invoice|recibo|cobro|pago|vencimiento)/.test(texto)) return 'factura';
  if (/(entrevista|interview|seleccion|rrhh|hr|candidatura)/.test(texto)) return 'entrevista';
  if (/(urgente|urgent|importante|inmediato|alerta|critico)/.test(texto)) return 'urgente';
  return 'relevante';
}

/**
 * Filtra y resume correos recientes urgentes, de facturas o entrevistas.
 */
export async function resumirCorreosUrgentes(deps = {}) {
  const query = deps.query || 'newer_than:7d (urgente OR urgent OR factura OR invoice OR recibo OR entrevista OR interview OR importante OR vencimiento)';
  const maxResults = deps.maxResults || 10;

  const res = await listarCorreosRecientes(
    {
      query,
      maxResults,
      soloNoLeidos: Boolean(deps.soloNoLeidos)
    },
    deps
  );
  if (!res.ok) return res;

  const clasificados = res.correos.map((c) => ({
    ...c,
    categoria: clasificarCorreoUrgente(c)
  }));

  const resumen = clasificados.length === 0
    ? 'No hay correos urgentes, facturas ni entrevistas recientes.'
    : clasificados
      .map((c, idx) => `${idx + 1}. [${c.categoria.toUpperCase()}] ${c.subject} - ${c.from || 'Remitente desconocido'}`)
      .join('\n');

  return {
    ok: true,
    correos: clasificados,
    total: clasificados.length,
    resumen
  };
}

/**
 * Crea un borrador en Gmail (drafts.create) sin enviar el correo directamente.
 * El envio posterior requiere confirmacion interactiva explicita via enviarBorradorConfirmado.
 */
export async function crearBorradorCorreo({ para, asunto, cuerpo, cc, bcc, threadId } = {}, deps = {}) {
  const destinatario = limpiarValorCabecera(para);
  const subject = limpiarValorCabecera(asunto);
  const bodyText = String(cuerpo || '').trim();

  if (!destinatario || !destinatario.includes('@')) {
    return { ok: false, error: 'Especifica un destinatario valido (para).' };
  }
  if (!subject) {
    return { ok: false, error: 'Especifica el asunto del borrador.' };
  }
  if (!bodyText) {
    return { ok: false, error: 'Especifica el cuerpo del borrador.' };
  }

  const cabeceras = [
    `To: ${destinatario}`,
    ...(cc ? [`Cc: ${limpiarValorCabecera(cc)}`] : []),
    ...(bcc ? [`Bcc: ${limpiarValorCabecera(bcc)}`] : []),
    `Subject: ${codificarAsuntoMime(subject)}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset="UTF-8"'
  ];

  const rawMime = `${cabeceras.join('\r\n')}\r\n\r\n${bodyText}`;
  const rawBase64Url = Buffer.from(rawMime, 'utf8').toString('base64url');

  const payload = {
    message: {
      raw: rawBase64Url,
      ...(threadId ? { threadId: String(threadId).trim() } : {})
    }
  };

  const res = await gmailFetch('/drafts', {
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify(payload)
  }, deps);

  if (!res.ok) return res;

  return {
    ok: true,
    draftId: res.data?.id || null,
    messageId: res.data?.message?.id || null,
    threadId: res.data?.message?.threadId || threadId || null,
    para: destinatario,
    asunto: subject,
    estado: 'borrador',
    requiereConfirmacion: true,
    nota: 'Borrador creado en Gmail. Requiere confirmacion explicita antes de enviarse.'
  };
}

/**
 * Envia un borrador ya confirmado por el usuario (drafts.send).
 */
export async function enviarBorradorConfirmado(draftId, deps = {}) {
  const id = typeof draftId === 'object' && draftId !== null
    ? String(draftId.draftId || draftId.id || '').trim()
    : String(draftId || '').trim();

  const rechazado = (typeof draftId === 'object' && draftId !== null && draftId.confirmado === false) ||
    deps.confirmado === false;

  if (rechazado) {
    return {
      ok: false,
      requiereConfirmacion: true,
      error: 'El envio requiere confirmacion interactiva explicita.'
    };
  }

  if (!id) {
    return { ok: false, error: 'Especifica el draftId del borrador confirmado.' };
  }

  const res = await gmailFetch('/drafts/send', {
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify({ id })
  }, deps);

  if (!res.ok) return res;

  return {
    ok: true,
    draftId: id,
    id: res.data?.id || null,
    threadId: res.data?.threadId || null,
    labelIds: res.data?.labelIds || [],
    estado: 'enviado',
    nota: 'Borrador confirmado enviado correctamente.'
  };
}
