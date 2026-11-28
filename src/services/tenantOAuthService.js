/**
 * tenantOAuthService.js - Flujo OAuth2 multi-tenant 1-clic para Google Calendar y Gmail.
 *
 * Permite que el propietario/plataforma configure una sola vez GOOGLE_CLIENT_ID y
 * GOOGLE_CLIENT_SECRET, y que cada comercio/tenant conecte su cuenta de Google en
 * 1 clic desde un enlace firmado HMAC enviado por WhatsApp.
 *
 * Seguridad:
 * - State firmado con HMAC-SHA256 + TTL (15 min) anti-CSRF ligado al tenant_id.
 * - Almacenamiento cifrado AES-256-GCM con MEMORY_ENCRYPTION_KEY (fail-closed).
 * - Aislamiento estricto por tenant_id.
 *
 * Politica estricta: cero emojis en codigo, comentarios y respuestas.
 */

import crypto from 'node:crypto';
import fs from '../security/tenantFileSystem.js';
import path from 'node:path';
import { DATA_DIR } from '../config/paths.js';
import { TENANT_PROPIETARIO, afirmarTenantId, esTenantIdValido, rutaDatosTenant } from '../core/tenancy.js';
import { fetchSeguro } from './safeFetch.js';

const FORMATO_CIFRADO = 'aes-256-gcm';
const OAUTH_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const TTL_STATE_MS = 15 * 60 * 1000;

export const SCOPES_GOOGLE = Object.freeze({
  calendar: ['https://www.googleapis.com/auth/calendar'],
  gmail: ['https://www.googleapis.com/auth/gmail.readonly', 'https://www.googleapis.com/auth/gmail.compose'],
  ambos: [
    'https://www.googleapis.com/auth/calendar',
    'https://www.googleapis.com/auth/gmail.readonly',
    'https://www.googleapis.com/auth/gmail.compose'
  ]
});

export const PROVIDERS_GOOGLE = Object.freeze({
  calendar: 'google_calendar',
  gmail: 'google_gmail'
});

let storeOAuthPorDefecto = null;

export function registrarStoreOAuthPorDefecto(store) {
  storeOAuthPorDefecto = store || null;
}

function obtenerClaveCifrado(deps = {}) {
  const clave = deps.encryptionKey !== undefined
    ? deps.encryptionKey
    : (process.env.MEMORY_ENCRYPTION_KEY || '');
  if (!clave || String(clave).trim().length < 16) {
    return null;
  }
  return crypto.createHash('sha256').update(String(clave)).digest();
}

function obtenerSecretoState(deps = {}) {
  const secreto = deps.stateSecret !== undefined
    ? deps.stateSecret
    : (process.env.DAVIS_OAUTH_STATE_SECRET || process.env.MEMORY_ENCRYPTION_KEY || '');
  if (!secreto || String(secreto).trim().length < 16) {
    return null;
  }
  return String(secreto);
}

export function cifrarToken(textoPlano, deps = {}) {
  const key = obtenerClaveCifrado(deps);
  if (!key) {
    return { ok: false, error: 'Falta MEMORY_ENCRYPTION_KEY (minimo 16 caracteres) para cifrar tokens OAuth.' };
  }
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(FORMATO_CIFRADO, key, iv);
  const enc = Buffer.concat([cipher.update(String(textoPlano), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    ok: true,
    valor: `v1:${iv.toString('base64')}:${tag.toString('base64')}:${enc.toString('base64')}`
  };
}

export function descifrarToken(valorCifrado, deps = {}) {
  const key = obtenerClaveCifrado(deps);
  if (!key) return null;
  try {
    const partes = String(valorCifrado || '').split(':');
    if (partes.length !== 4 || partes[0] !== 'v1') return null;
    const iv = Buffer.from(partes[1], 'base64');
    const tag = Buffer.from(partes[2], 'base64');
    const data = Buffer.from(partes[3], 'base64');
    const decipher = crypto.createDecipheriv(FORMATO_CIFRADO, key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

export function crearSqliteOAuthTokenStore(db) {
  return {
    guardar(tenantId, provider, refreshTokenEnc, scopes = '') {
      const ahora = new Date().toISOString();
      db.prepare(`
        INSERT INTO tenant_oauth_tokens (tenant_id, provider, refresh_token_enc, scopes, creado_en, actualizado_en)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(tenant_id, provider) DO UPDATE SET
          refresh_token_enc = excluded.refresh_token_enc,
          scopes = excluded.scopes,
          actualizado_en = excluded.actualizado_en
      `).run(tenantId, provider, refreshTokenEnc, scopes, ahora, ahora);
    },
    obtener(tenantId, provider) {
      const row = db.prepare(
        'SELECT tenant_id, provider, refresh_token_enc, scopes, actualizado_en FROM tenant_oauth_tokens WHERE tenant_id = ? AND provider = ?'
      ).get(tenantId, provider);
      return row || null;
    },
    listar(tenantId) {
      return db.prepare(
        'SELECT tenant_id, provider, scopes, actualizado_en FROM tenant_oauth_tokens WHERE tenant_id = ?'
      ).all(tenantId);
    },
    borrar(tenantId, provider) {
      const r = db.prepare('DELETE FROM tenant_oauth_tokens WHERE tenant_id = ? AND provider = ?').run(tenantId, provider);
      return r.changes > 0;
    }
  };
}

function rutaJsonTenant(tenantId, deps = {}) {
  if (deps.rutaArchivo) return deps.rutaArchivo;
  const baseDir = deps.dataDir || DATA_DIR;
  if (tenantId === TENANT_PROPIETARIO) {
    return path.join(baseDir, 'oauth_tokens.enc.json');
  }
  return path.join(rutaDatosTenant(baseDir, tenantId), 'oauth_tokens.enc.json');
}

function leerJsonTokens(tenantId, deps = {}) {
  const ruta = rutaJsonTenant(tenantId, deps);
  try {
    if (!fs.existsSync(ruta)) return {};
    const parsed = JSON.parse(fs.readFileSync(ruta, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function guardarJsonTokens(tenantId, datos, deps = {}) {
  const ruta = rutaJsonTenant(tenantId, deps);
  fs.mkdirSync(path.dirname(ruta), { recursive: true });
  const tmp = `${ruta}.tmp.${process.pid}.${Date.now()}`;
  fs.writeFileSync(tmp, JSON.stringify(datos, null, 2), 'utf8');
  fs.renameSync(tmp, ruta);
}

function storeDe(deps = {}) {
  if (deps.store || deps.oauthTokenStore) return deps.store || deps.oauthTokenStore;
  if (deps.rutaArchivo || deps.dataDir) return null;
  return storeOAuthPorDefecto;
}

export function firmarEstadoOAuth({ tenantId = TENANT_PROPIETARIO, servicio = 'calendar', now = Date.now() } = {}, deps = {}) {
  const tid = tenantId || TENANT_PROPIETARIO;
  afirmarTenantId(tid);
  const secreto = obtenerSecretoState(deps);
  if (!secreto) {
    return { ok: false, error: 'Falta DAVIS_OAUTH_STATE_SECRET o MEMORY_ENCRYPTION_KEY (minimo 16 caracteres) para firmar el enlace OAuth.' };
  }
  const serv = SCOPES_GOOGLE[servicio] ? servicio : 'calendar';
  const payload = Buffer.from(JSON.stringify({
    tid,
    srv: serv,
    iat: now,
    exp: now + TTL_STATE_MS,
    nonce: crypto.randomBytes(8).toString('hex')
  })).toString('base64url');
  const firma = crypto.createHmac('sha256', secreto).update(payload).digest('base64url');
  return { ok: true, state: `${payload}.${firma}` };
}

export function verificarEstadoOAuth(state, deps = {}) {
  const secreto = obtenerSecretoState(deps);
  if (!secreto) return { ok: false, error: 'Secreto OAuth no configurado.' };
  const partes = String(state || '').split('.');
  if (partes.length !== 2) return { ok: false, error: 'Estado OAuth invalido.' };
  const [payload, firma] = partes;
  const esperada = crypto.createHmac('sha256', secreto).update(payload).digest('base64url');
  const bufA = Buffer.from(firma);
  const bufB = Buffer.from(esperada);
  if (bufA.length !== bufB.length || !crypto.timingSafeEqual(bufA, bufB)) {
    return { ok: false, error: 'Firma de estado OAuth invalida.' };
  }
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    const ahora = typeof deps.now === 'number' ? deps.now : Date.now();
    if (!data.exp || ahora > data.exp) {
      return { ok: false, error: 'Enlace OAuth caducado. Solicita uno nuevo.' };
    }
    if (!esTenantIdValido(data.tid)) {
      return { ok: false, error: 'Tenant invalido en estado OAuth.' };
    }
    return { ok: true, tenantId: data.tid, servicio: SCOPES_GOOGLE[data.srv] ? data.srv : 'calendar' };
  } catch {
    return { ok: false, error: 'Payload OAuth corrupto.' };
  }
}

export function generarEnlaceGoogleOAuth({ tenantId = TENANT_PROPIETARIO, servicio = 'calendar', baseUrl, redirectUri } = {}, deps = {}) {
  const clientId = deps.clientId !== undefined ? deps.clientId : (process.env.GOOGLE_CLIENT_ID || '');
  if (!clientId) {
    return {
      ok: false,
      configRequired: true,
      error: 'Falta GOOGLE_CLIENT_ID en la configuracion del servidor.'
    };
  }
  const serv = SCOPES_GOOGLE[servicio] ? servicio : 'calendar';
  const firmaRes = firmarEstadoOAuth({ tenantId, servicio: serv, now: deps.now }, deps);
  if (!firmaRes.ok) {
    return { ok: false, configRequired: true, error: firmaRes.error };
  }
  const base = (baseUrl || process.env.DAVIS_PUBLIC_URL || 'http://127.0.0.1:3000').replace(/\/+$/, '');
  const redir = redirectUri || `${base}/oauth/google/callback`;
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redir,
    response_type: 'code',
    scope: SCOPES_GOOGLE[serv].join(' '),
    access_type: 'offline',
    prompt: 'consent',
    state: firmaRes.state
  });
  return {
    ok: true,
    url: `${OAUTH_AUTH_URL}?${params.toString()}`,
    redirectUri: redir,
    servicio: serv,
    tenantId
  };
}

export function guardarRefreshTokenTenant({ tenantId = TENANT_PROPIETARIO, provider, refreshToken, scopes = '' } = {}, deps = {}) {
  const tid = tenantId || TENANT_PROPIETARIO;
  afirmarTenantId(tid);
  if (!provider || !refreshToken) {
    return { ok: false, error: 'Faltan provider o refreshToken.' };
  }
  const cifrado = cifrarToken(refreshToken, deps);
  if (!cifrado.ok) return cifrado;

  const store = storeDe(deps);
  if (store) {
    store.guardar(tid, provider, cifrado.valor, scopes);
    return { ok: true, tenantId: tid, provider };
  }

  const actual = leerJsonTokens(tid, deps);
  const ahora = new Date().toISOString();
  actual[provider] = {
    refreshTokenEnc: cifrado.valor,
    scopes,
    actualizadoEn: ahora,
    creadoEn: actual[provider]?.creadoEn || ahora
  };
  guardarJsonTokens(tid, actual, deps);
  return { ok: true, tenantId: tid, provider };
}

export function obtenerRefreshTokenTenant({ tenantId = TENANT_PROPIETARIO, provider } = {}, deps = {}) {
  const tid = tenantId || TENANT_PROPIETARIO;
  if (!esTenantIdValido(tid) || !provider) return null;

  const store = storeDe(deps);
  let enc = null;
  if (store) {
    const row = store.obtener(tid, provider);
    enc = row?.refresh_token_enc || null;
  } else {
    const datos = leerJsonTokens(tid, deps);
    enc = datos[provider]?.refreshTokenEnc || null;
  }
  if (!enc) return null;
  return descifrarToken(enc, deps);
}

export function estadoConexionGoogleTenant({ tenantId = TENANT_PROPIETARIO } = {}, deps = {}) {
  const tid = tenantId || TENANT_PROPIETARIO;
  if (!esTenantIdValido(tid)) return { calendar: false, gmail: false };
  const cal = Boolean(obtenerRefreshTokenTenant({ tenantId: tid, provider: PROVIDERS_GOOGLE.calendar }, deps));
  const gmail = Boolean(obtenerRefreshTokenTenant({ tenantId: tid, provider: PROVIDERS_GOOGLE.gmail }, deps));
  return { calendar: cal, gmail };
}

export function revocarConexionGoogleTenant({ tenantId = TENANT_PROPIETARIO, provider } = {}, deps = {}) {
  const tid = tenantId || TENANT_PROPIETARIO;
  afirmarTenantId(tid);
  const store = storeDe(deps);
  if (store) {
    const ok = store.borrar(tid, provider);
    return { ok };
  }
  const datos = leerJsonTokens(tid, deps);
  if (datos[provider]) {
    delete datos[provider];
    guardarJsonTokens(tid, datos, deps);
    return { ok: true };
  }
  return { ok: false };
}

export async function procesarCallbackGoogleOAuth({ code, state, baseUrl, redirectUri } = {}, deps = {}) {
  if (!code || !state) {
    return { ok: false, error: 'Faltan parametros code o state en el callback OAuth.' };
  }
  const verif = verificarEstadoOAuth(state, deps);
  if (!verif.ok) return verif;

  const clientId = deps.clientId !== undefined ? deps.clientId : (process.env.GOOGLE_CLIENT_ID || '');
  const clientSecret = deps.clientSecret !== undefined ? deps.clientSecret : (process.env.GOOGLE_CLIENT_SECRET || '');
  if (!clientId || !clientSecret) {
    return { ok: false, configRequired: true, error: 'Faltan GOOGLE_CLIENT_ID o GOOGLE_CLIENT_SECRET en el servidor.' };
  }

  const base = (baseUrl || process.env.DAVIS_PUBLIC_URL || 'http://127.0.0.1:3000').replace(/\/+$/, '');
  const redir = redirectUri || `${base}/oauth/google/callback`;
  const fetcher = deps.fetchFn || fetchSeguro;

  const body = new URLSearchParams({
    code: String(code),
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redir,
    grant_type: 'authorization_code'
  });

  const resp = await fetcher(OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString()
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok || !data.refresh_token) {
    return {
      ok: false,
      error: data.error_description || data.error || (!resp.ok ? `Error HTTP ${resp.status} al intercambiar token con Google.` : 'Google no devolvio refresh_token (asegura prompt=consent).')
    };
  }

  const scopeStr = String(data.scope || SCOPES_GOOGLE[verif.servicio].join(' '));
  const guardados = [];

  if (verif.servicio === 'calendar' || verif.servicio === 'ambos' || scopeStr.includes('calendar')) {
    const rCal = guardarRefreshTokenTenant({
      tenantId: verif.tenantId,
      provider: PROVIDERS_GOOGLE.calendar,
      refreshToken: data.refresh_token,
      scopes: scopeStr
    }, deps);
    if (!rCal.ok) return rCal;
    guardados.push('calendar');
  }

  if (verif.servicio === 'gmail' || verif.servicio === 'ambos' || scopeStr.includes('gmail')) {
    const rGm = guardarRefreshTokenTenant({
      tenantId: verif.tenantId,
      provider: PROVIDERS_GOOGLE.gmail,
      refreshToken: data.refresh_token,
      scopes: scopeStr
    }, deps);
    if (!rGm.ok) return rGm;
    guardados.push('gmail');
  }

  return {
    ok: true,
    tenantId: verif.tenantId,
    servicios: guardados
  };
}
