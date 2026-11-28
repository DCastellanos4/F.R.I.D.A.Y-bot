/**
 * tenant_oauth_1click.test.js
 * Pruebas del flujo OAuth2 multi-tenant 1-clic (Calendar y Gmail separados o combinados),
 * cifrado AES-256-GCM por tenant en SQLite, endpoints HTTP en api.js y despacho por tenant.
 *
 * Politica estricta: cero emojis.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { Readable } from 'node:stream';
import Database from 'better-sqlite3';

import { ejecutarMigraciones } from '../../src/adapters/outbound/persistence/sqlite/migraciones.js';
import {
  crearSqliteOAuthTokenStore,
  cifrarToken,
  descifrarToken,
  firmarEstadoOAuth,
  verificarEstadoOAuth,
  generarEnlaceGoogleOAuth,
  procesarCallbackGoogleOAuth,
  obtenerRefreshTokenTenant,
  estadoConexionGoogleTenant,
  revocarConexionGoogleTenant,
  PROVIDERS_GOOGLE
} from '../../src/services/tenantOAuthService.js';
import { despacharHerramienta } from '../../src/core/toolDispatcher.js';
import { resetOAuthTokenCache as resetCalCache } from '../../src/services/calendarService.js';
import { resetOAuthTokenCache as resetGmailCache } from '../../src/services/gmailService.js';
import { handleApiRequest } from '../../api.js';

const KEY_TEST = 'clave-maestra-test-1234567890';

test('Cifrado AES-256-GCM: fail-closed sin MEMORY_ENCRYPTION_KEY y roundtrip valido con clave', () => {
  const sinClave = cifrarToken('1//refresh-secreto', { encryptionKey: '' });
  assert.equal(sinClave.ok, false);

  const enc = cifrarToken('1//refresh-secreto', { encryptionKey: KEY_TEST });
  assert.equal(enc.ok, true);
  assert.ok(!enc.valor.includes('refresh-secreto'));
  assert.equal(descifrarToken(enc.valor, { encryptionKey: KEY_TEST }), '1//refresh-secreto');
  assert.equal(descifrarToken(enc.valor, { encryptionKey: 'otra-clave-distinta-1234' }), null);
});

test('State HMAC-SHA256: firma, verificacion, anti-manipulacion y caducidad', () => {
  const t0 = 1_700_000_000_000;
  const firmado = firmarEstadoOAuth({ tenantId: 'peluqueria-sol', servicio: 'calendar', now: t0 }, { stateSecret: KEY_TEST });
  assert.equal(firmado.ok, true);

  const ok = verificarEstadoOAuth(firmado.state, { stateSecret: KEY_TEST, now: t0 + 5000 });
  assert.equal(ok.ok, true);
  assert.equal(ok.tenantId, 'peluqueria-sol');
  assert.equal(ok.servicio, 'calendar');

  const manipulado = verificarEstadoOAuth(firmado.state + 'x', { stateSecret: KEY_TEST, now: t0 + 5000 });
  assert.equal(manipulado.ok, false);

  const caducado = verificarEstadoOAuth(firmado.state, { stateSecret: KEY_TEST, now: t0 + 20 * 60 * 1000 });
  assert.equal(caducado.ok, false);
});

test('generarEnlaceGoogleOAuth separa scopes de calendar, gmail y ambos', () => {
  const cal = generarEnlaceGoogleOAuth(
    { tenantId: 'comercio-a', servicio: 'calendar', baseUrl: 'https://bot.midominio.com' },
    { clientId: 'cid-global', stateSecret: KEY_TEST }
  );
  assert.equal(cal.ok, true);
  const urlCal = new URL(cal.url);
  assert.equal(urlCal.searchParams.get('client_id'), 'cid-global');
  assert.equal(urlCal.searchParams.get('redirect_uri'), 'https://bot.midominio.com/oauth/google/callback');
  assert.equal(urlCal.searchParams.get('scope'), 'https://www.googleapis.com/auth/calendar');
  assert.equal(urlCal.searchParams.get('access_type'), 'offline');

  const gm = generarEnlaceGoogleOAuth(
    { tenantId: 'comercio-a', servicio: 'gmail', baseUrl: 'https://bot.midominio.com' },
    { clientId: 'cid-global', stateSecret: KEY_TEST }
  );
  assert.equal(gm.ok, true);
  assert.match(new URL(gm.url).searchParams.get('scope'), /gmail\.readonly/);
  assert.doesNotMatch(new URL(gm.url).searchParams.get('scope'), /\/auth\/calendar/);
});

test('Callback OAuth2 guarda refresh_token cifrado en SQLite por tenant con aislamiento estricto', async () => {
  const db = new Database(':memory:');
  ejecutarMigraciones(db);
  const store = crearSqliteOAuthTokenStore(db);

  const enlaceA = generarEnlaceGoogleOAuth(
    { tenantId: 'tenant-a', servicio: 'calendar', baseUrl: 'https://bot.test' },
    { clientId: 'cid', stateSecret: KEY_TEST }
  );
  const stateA = new URL(enlaceA.url).searchParams.get('state');

  const fetchMock = async (url, init) => {
    assert.equal(url, 'https://oauth2.googleapis.com/token');
    assert.match(init.body, /code=auth-code-a/);
    return new Response(JSON.stringify({
      access_token: 'ya29.temp',
      refresh_token: '1//refresh-tenant-a',
      scope: 'https://www.googleapis.com/auth/calendar'
    }), { status: 200 });
  };

  const cb = await procesarCallbackGoogleOAuth(
    { code: 'auth-code-a', state: stateA, baseUrl: 'https://bot.test' },
    { clientId: 'cid', clientSecret: 'csec', stateSecret: KEY_TEST, encryptionKey: KEY_TEST, store, fetchFn: fetchMock }
  );
  assert.equal(cb.ok, true);
  assert.equal(cb.tenantId, 'tenant-a');
  assert.deepEqual(cb.servicios, ['calendar']);

  // En SQLite se guarda cifrado, nunca en claro
  const filaRaw = db.prepare('SELECT refresh_token_enc FROM tenant_oauth_tokens WHERE tenant_id = ?').get('tenant-a');
  assert.ok(filaRaw.refresh_token_enc.startsWith('v1:'));
  assert.ok(!filaRaw.refresh_token_enc.includes('refresh-tenant-a'));

  // Tenant A tiene calendar; Tenant B no ve nada
  assert.equal(obtenerRefreshTokenTenant({ tenantId: 'tenant-a', provider: PROVIDERS_GOOGLE.calendar }, { store, encryptionKey: KEY_TEST }), '1//refresh-tenant-a');
  assert.equal(obtenerRefreshTokenTenant({ tenantId: 'tenant-b', provider: PROVIDERS_GOOGLE.calendar }, { store, encryptionKey: KEY_TEST }), null);
  assert.deepEqual(estadoConexionGoogleTenant({ tenantId: 'tenant-a' }, { store, encryptionKey: KEY_TEST }), { calendar: true, gmail: false });
  assert.deepEqual(estadoConexionGoogleTenant({ tenantId: 'tenant-b' }, { store, encryptionKey: KEY_TEST }), { calendar: false, gmail: false });

  // Revocacion limpia solo tenant-a
  assert.equal(revocarConexionGoogleTenant({ tenantId: 'tenant-a', provider: PROVIDERS_GOOGLE.calendar }, { store }).ok, true);
  assert.equal(obtenerRefreshTokenTenant({ tenantId: 'tenant-a', provider: PROVIDERS_GOOGLE.calendar }, { store, encryptionKey: KEY_TEST }), null);
  db.close();
});

test('Dispatcher usa refresh_token del tenant activo para Calendar y Gmail y conectar_google devuelve enlace 1-clic', async () => {
  resetCalCache();
  resetGmailCache();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oauth-dispatch-'));
  const db = new Database(path.join(dir, 'test.db'));
  ejecutarMigraciones(db);
  const store = crearSqliteOAuthTokenStore(db);

  // Guardamos tokens distintos para comercio-uno (calendar + gmail)
  const enlace = generarEnlaceGoogleOAuth(
    { tenantId: 'comercio-uno', servicio: 'ambos', baseUrl: 'https://bot.test' },
    { clientId: 'cid', stateSecret: KEY_TEST }
  );
  const state = new URL(enlace.url).searchParams.get('state');
  await procesarCallbackGoogleOAuth(
    { code: 'c1', state, baseUrl: 'https://bot.test' },
    {
      clientId: 'cid',
      clientSecret: 'csec',
      stateSecret: KEY_TEST,
      encryptionKey: KEY_TEST,
      store,
      fetchFn: async () => new Response(JSON.stringify({
        access_token: 'a1',
        refresh_token: '1//token-comercio-uno',
        scope: 'https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/gmail.readonly'
      }), { status: 200 })
    }
  );

  // 1) conectar_google genera enlace firmado para el tenant
  const resEnlace = await despacharHerramienta('conectar_google', { servicio: 'calendar' }, {
    tenantId: 'comercio-uno',
    oauthTokenStore: store,
    oauthEncryptionKey: KEY_TEST,
    oauthStateSecret: KEY_TEST,
    googleClientId: 'cid',
    publicUrlOAuth: 'https://bot.test'
  });
  assert.match(resEnlace.texto, /https:\/\/accounts\.google\.com\/o\/oauth2\/v2\/auth/);

  // 2) crear_evento toma automaticamente el refreshToken de comercio-uno
  const prevCid = process.env.GOOGLE_CLIENT_ID;
  const prevCsec = process.env.GOOGLE_CLIENT_SECRET;
  process.env.GOOGLE_CLIENT_ID = 'cid';
  process.env.GOOGLE_CLIENT_SECRET = 'csec';
  try {
    let vioRefreshComercio = false;
    const resEv = await despacharHerramienta('crear_evento', {
      titulo: 'Corte de pelo Ana',
      inicio: '2026-12-01 10:00'
    }, {
      tenantId: 'comercio-uno',
      rutaArchivoCalendario: path.join(dir, 'cal.json'),
      oauthTokenStore: store,
      oauthEncryptionKey: KEY_TEST,
      fetchFnCalendar: async (url, init) => {
        if (String(url).includes('oauth2.googleapis.com/token')) {
          if (new URLSearchParams(String(init.body)).get('refresh_token') === '1//token-comercio-uno') vioRefreshComercio = true;
          return new Response(JSON.stringify({ access_token: 'ya29.cal-uno', expires_in: 3600 }), { status: 200 });
        }
        assert.equal(init.headers.authorization || init.headers.Authorization, 'Bearer ya29.cal-uno');
        return new Response(JSON.stringify({ id: 'ev-1', summary: 'Corte de pelo Ana', start: { dateTime: '2026-12-01T10:00:00Z' } }), { status: 200 });
      }
    });
    assert.equal(vioRefreshComercio, true);
    assert.match(resEv.texto, /Evento registrado: "Corte de pelo Ana"/);

    // 3) listar_correos toma automaticamente el refreshToken de comercio-uno
    const resMail = await despacharHerramienta('listar_correos', { maxResults: 5 }, {
      tenantId: 'comercio-uno',
      oauthTokenStore: store,
      oauthEncryptionKey: KEY_TEST,
      fetchFnGmail: async (url, init) => {
        if (String(url).includes('oauth2.googleapis.com/token')) {
          return new Response(JSON.stringify({ access_token: 'ya29.gm-uno', expires_in: 3600 }), { status: 200 });
        }
        assert.equal(init.headers.authorization || init.headers.Authorization, 'Bearer ya29.gm-uno');
        return new Response(JSON.stringify({ messages: [] }), { status: 200 });
      }
    });
    assert.match(resMail.texto, /No hay correos/);
  } finally {
    if (prevCid === undefined) delete process.env.GOOGLE_CLIENT_ID; else process.env.GOOGLE_CLIENT_ID = prevCid;
    if (prevCsec === undefined) delete process.env.GOOGLE_CLIENT_SECRET; else process.env.GOOGLE_CLIENT_SECRET = prevCsec;
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('api.js: GET /oauth/google/start devuelve 302 hacia Google OAuth con state firmado', async () => {
  const prevCid = process.env.GOOGLE_CLIENT_ID;
  const prevKey = process.env.MEMORY_ENCRYPTION_KEY;
  process.env.GOOGLE_CLIENT_ID = 'cid-api-test';
  process.env.MEMORY_ENCRYPTION_KEY = KEY_TEST;
  try {
    const req = new Readable({ read() { this.push(null); } });
    req.method = 'GET';
    req.url = '/oauth/google/start?tenantId=tienda-centro&servicio=calendar';
    req.headers = { host: '127.0.0.1:3000' };

    let statusCode = 0;
    let headers = {};
    let body = '';
    const res = {
      setHeader() {},
      writeHead(code, hdrs) { statusCode = code; headers = hdrs || {}; },
      end(chunk) { if (chunk) body += chunk; }
    };

    await handleApiRequest(req, res);
    assert.equal(statusCode, 302);
    assert.ok(String(headers.Location || '').startsWith('https://accounts.google.com/o/oauth2/v2/auth'));
    assert.equal(body, '');
  } finally {
    if (prevCid === undefined) delete process.env.GOOGLE_CLIENT_ID; else process.env.GOOGLE_CLIENT_ID = prevCid;
    if (prevKey === undefined) delete process.env.MEMORY_ENCRYPTION_KEY; else process.env.MEMORY_ENCRYPTION_KEY = prevKey;
  }
});
