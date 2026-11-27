/**
 * gmail_service.test.js
 *
 * Pruebas unitarias de Gmail API v1 en src/services/gmailService.js:
 * - Renovacion OAuth2 via refresh_token, cache en memoria y margen de 60s
 * - Fallback a token directo (GOOGLE_GMAIL_ACCESS_TOKEN / GMAIL_ACCESS_TOKEN)
 * - Respuesta honesta configRequired: true sin credenciales (sin inventar correos)
 * - listarCorreosRecientes (query, soloNoLeidos, metadata)
 * - leerCorreo (decodificacion base64url multipart text/plain y fallback text/html)
 * - resumirCorreosUrgentes (clasificacion facturas/entrevistas/urgentes)
 * - crearBorradorCorreo (drafts.create sin envio directo)
 * - enviarBorradorConfirmado (drafts.send y bloqueo sin confirmacion)
 * - Politica CERO EMOJIS
 *
 * Strict Policy: Zero Emojis.
 */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import {
  obtenerAccessTokenValido,
  resetOAuthTokenCache,
  decodificarBase64Url,
  listarCorreosRecientes,
  leerCorreo,
  resumirCorreosUrgentes,
  crearBorradorCorreo,
  enviarBorradorConfirmado
} from '../../src/services/gmailService.js';

function encodeBase64Url(text) {
  return Buffer.from(text, 'utf8').toString('base64url');
}

beforeEach(() => {
  resetOAuthTokenCache();
});

test('1. OAuth2: renueva access_token con refresh_token, cachea y renueva al acercarse a 60s', async () => {
  const tokenCalls = [];
  let seq = 0;
  const mockFetch = async (url, opts = {}) => {
    assert.strictEqual(url, 'https://oauth2.googleapis.com/token');
    seq += 1;
    tokenCalls.push({ url, method: opts.method, headers: opts.headers, body: opts.body });
    return {
      ok: true,
      json: async () => ({ access_token: `ya29.gmail-tok-${seq}`, expires_in: 3600 })
    };
  };

  const t0 = 1_700_000_000_000;
  const baseDeps = {
    clientId: 'gmail-cid',
    clientSecret: 'gmail-csec',
    refreshToken: '1//gmail-rtok',
    fetchFn: mockFetch
  };

  const tok1 = await obtenerAccessTokenValido({ ...baseDeps, now: t0 });
  assert.strictEqual(tok1, 'ya29.gmail-tok-1');
  assert.strictEqual(tokenCalls.length, 1);
  assert.strictEqual(tokenCalls[0].method, 'POST');
  assert.strictEqual(tokenCalls[0].headers['content-type'], 'application/x-www-form-urlencoded');
  const params = new URLSearchParams(tokenCalls[0].body);
  assert.strictEqual(params.get('grant_type'), 'refresh_token');
  assert.strictEqual(params.get('refresh_token'), '1//gmail-rtok');

  // Reutiliza cache antes del margen de 60s
  const tok2 = await obtenerAccessTokenValido({ ...baseDeps, now: t0 + 3500 * 1000 });
  assert.strictEqual(tok2, 'ya29.gmail-tok-1');
  assert.strictEqual(tokenCalls.length, 1);

  // Renueva al entrar en el margen de 60s
  const tok3 = await obtenerAccessTokenValido({ ...baseDeps, now: t0 + 3540 * 1000 });
  assert.strictEqual(tok3, 'ya29.gmail-tok-2');
  assert.strictEqual(tokenCalls.length, 2);
});

test('2. Config required: sin credenciales devuelve ok:false, configRequired:true en todas las operaciones', async () => {
  const prevEnv = {
    GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
    GOOGLE_REFRESH_TOKEN: process.env.GOOGLE_REFRESH_TOKEN,
    GOOGLE_GMAIL_ACCESS_TOKEN: process.env.GOOGLE_GMAIL_ACCESS_TOKEN,
    GMAIL_ACCESS_TOKEN: process.env.GMAIL_ACCESS_TOKEN
  };

  delete process.env.GOOGLE_CLIENT_ID;
  delete process.env.GOOGLE_CLIENT_SECRET;
  delete process.env.GOOGLE_REFRESH_TOKEN;
  delete process.env.GOOGLE_GMAIL_ACCESS_TOKEN;
  delete process.env.GMAIL_ACCESS_TOKEN;

  try {
    const deps = {
      clientId: null,
      clientSecret: null,
      refreshToken: null,
      accessToken: null,
      fetchFn: async () => {
        throw new Error('No debe llamar a fetch sin credenciales');
      }
    };

    const rListar = await listarCorreosRecientes({}, deps);
    assert.strictEqual(rListar.ok, false);
    assert.strictEqual(rListar.configRequired, true);
    assert.strictEqual(rListar.correos, undefined);

    const rLeer = await leerCorreo('msg-1', deps);
    assert.strictEqual(rLeer.ok, false);
    assert.strictEqual(rLeer.configRequired, true);

    const rResumir = await resumirCorreosUrgentes(deps);
    assert.strictEqual(rResumir.ok, false);
    assert.strictEqual(rResumir.configRequired, true);

    const rBorrador = await crearBorradorCorreo({
      para: 'alguien@ejemplo.com',
      asunto: 'Prueba',
      cuerpo: 'Hola'
    }, deps);
    assert.strictEqual(rBorrador.ok, false);
    assert.strictEqual(rBorrador.configRequired, true);

    const rEnviar = await enviarBorradorConfirmado('draft-1', deps);
    assert.strictEqual(rEnviar.ok, false);
    assert.strictEqual(rEnviar.configRequired, true);
  } finally {
    for (const [k, v] of Object.entries(prevEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
});

test('3. listarCorreosRecientes: consulta mensajes y extrae id, threadId, from, subject, date y snippet', async () => {
  const calls = [];
  const mockFetch = async (url, opts = {}) => {
    calls.push({ url, method: opts.method || 'GET', headers: opts.headers || {} });

    if (url.startsWith('https://gmail.googleapis.com/gmail/v1/users/me/messages?')) {
      return {
        ok: true,
        json: async () => ({
          messages: [
            { id: 'm-101', threadId: 't-101' },
            { id: 'm-102', threadId: 't-102' }
          ]
        })
      };
    }

    if (url.includes('/messages/m-101?format=metadata')) {
      return {
        ok: true,
        json: async () => ({
          id: 'm-101',
          threadId: 't-101',
          labelIds: ['INBOX', 'UNREAD'],
          snippet: 'Tu factura de luz esta disponible.',
          payload: {
            headers: [
              { name: 'From', value: 'facturacion@energia.es' },
              { name: 'Subject', value: 'Factura mensual Octubre' },
              { name: 'Date', value: 'Thu, 26 Nov 2026 09:00:00 +0100' }
            ]
          }
        })
      };
    }

    if (url.includes('/messages/m-102?format=metadata')) {
      return {
        ok: true,
        json: async () => ({
          id: 'm-102',
          threadId: 't-102',
          labelIds: ['INBOX', 'UNREAD'],
          snippet: 'Confirmamos tu entrevista tecnica.',
          payload: {
            headers: [
              { name: 'From', value: 'rrhh@techcorp.io' },
              { name: 'Subject', value: 'Entrevista Backend Senior' },
              { name: 'Date', value: 'Thu, 26 Nov 2026 11:30:00 +0100' }
            ]
          }
        })
      };
    }

    throw new Error(`Unexpected URL: ${url}`);
  };

  const res = await listarCorreosRecientes(
    { query: 'from:energia.es OR entrevista', maxResults: 5, soloNoLeidos: true },
    { accessToken: 'ya29.direct-gmail', fetchFn: mockFetch }
  );

  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.total, 2);
  assert.strictEqual(res.correos.length, 2);
  assert.strictEqual(res.correos[0].id, 'm-101');
  assert.strictEqual(res.correos[0].threadId, 't-101');
  assert.strictEqual(res.correos[0].from, 'facturacion@energia.es');
  assert.strictEqual(res.correos[0].subject, 'Factura mensual Octubre');
  assert.strictEqual(res.correos[0].snippet, 'Tu factura de luz esta disponible.');
  assert.strictEqual(res.correos[0].unread, true);

  const listUrl = new URL(calls[0].url);
  assert.strictEqual(listUrl.searchParams.get('maxResults'), '5');
  assert.strictEqual(listUrl.searchParams.get('q'), 'is:unread from:energia.es OR entrevista');
  assert.strictEqual(calls[0].headers.authorization, 'Bearer ya29.direct-gmail');
});

test('4. leerCorreo: decodifica base64url en multipart text/plain y fallback text/html', async () => {
  const textoEsperado = 'Hola David,\n\nAdjunto los detalles de la reunion de mañana a las 10:00.\nSaludos.';
  const htmlFallback = '<div><p>Aviso <strong>importante</strong></p><p>Revisa el portal.</p></div>';

  const mockFetch = async (url) => {
    if (url.endsWith('/messages/msg-plain?format=full')) {
      return {
        ok: true,
        json: async () => ({
          id: 'msg-plain',
          threadId: 'thr-1',
          snippet: 'Hola David, Adjunto los detalles...',
          labelIds: ['INBOX'],
          payload: {
            mimeType: 'multipart/alternative',
            headers: [
              { name: 'From', value: 'ana@empresa.com' },
              { name: 'To', value: 'david@ejemplo.com' },
              { name: 'Subject', value: 'Detalles reunion' },
              { name: 'Date', value: 'Thu, 26 Nov 2026 12:00:00 +0100' }
            ],
            parts: [
              {
                mimeType: 'text/plain',
                body: { data: encodeBase64Url(textoEsperado) }
              },
              {
                mimeType: 'text/html',
                body: { data: encodeBase64Url('<p>Version HTML</p>') }
              }
            ]
          }
        })
      };
    }

    if (url.endsWith('/messages/msg-html?format=full')) {
      return {
        ok: true,
        json: async () => ({
          id: 'msg-html',
          threadId: 'thr-2',
          snippet: 'Aviso importante',
          payload: {
            mimeType: 'text/html',
            headers: [
              { name: 'From', value: 'no-reply@banco.es' },
              { name: 'Subject', value: 'Aviso de seguridad' }
            ],
            body: { data: encodeBase64Url(htmlFallback) }
          }
        })
      };
    }

    throw new Error(`Unexpected URL: ${url}`);
  };

  const rPlain = await leerCorreo('msg-plain', { accessToken: 'ya29.tok', fetchFn: mockFetch });
  assert.strictEqual(rPlain.ok, true);
  assert.strictEqual(rPlain.correo.from, 'ana@empresa.com');
  assert.strictEqual(rPlain.correo.subject, 'Detalles reunion');
  assert.strictEqual(rPlain.correo.cuerpo, textoEsperado);

  const rHtml = await leerCorreo('msg-html', { accessToken: 'ya29.tok', fetchFn: mockFetch });
  assert.strictEqual(rHtml.ok, true);
  assert.match(rHtml.correo.cuerpo, /Aviso important/i);
  assert.ok(!rHtml.correo.cuerpo.includes('<strong>'));
});

test('5. resumirCorreosUrgentes: filtra y clasifica facturas, entrevistas y urgentes', async () => {
  const mockFetch = async (url) => {
    if (url.includes('/messages?')) {
      return {
        ok: true,
        json: async () => ({
          messages: [
            { id: 'u-1', threadId: 'tu-1' },
            { id: 'u-2', threadId: 'tu-2' },
            { id: 'u-3', threadId: 'tu-3' }
          ]
        })
      };
    }
    const items = {
      'u-1': { subject: 'Factura vencida #402', from: 'billing@cloud.com', snippet: 'Vencimiento inmediato' },
      'u-2': { subject: 'Entrevista tecnica jueves', from: 'talent@startup.io', snippet: 'Link de videollamada' },
      'u-3': { subject: 'URGENTE: Accion requerida', from: 'ops@infra.net', snippet: 'Certificado por expirar' }
    };
    const id = url.match(/\/messages\/([^?]+)/)[1];
    const info = items[id];
    return {
      ok: true,
      json: async () => ({
        id,
        threadId: `t-${id}`,
        snippet: info.snippet,
        payload: {
          headers: [
            { name: 'From', value: info.from },
            { name: 'Subject', value: info.subject },
            { name: 'Date', value: 'Thu, 26 Nov 2026 15:00:00 +0100' }
          ]
        }
      })
    };
  };

  const res = await resumirCorreosUrgentes({ accessToken: 'ya29.tok', fetchFn: mockFetch });
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.total, 3);
  assert.strictEqual(res.correos[0].categoria, 'factura');
  assert.strictEqual(res.correos[1].categoria, 'entrevista');
  assert.strictEqual(res.correos[2].categoria, 'urgente');
  assert.match(res.resumen, /\[FACTURA\]/);
  assert.match(res.resumen, /\[ENTREVISTA\]/);
  assert.match(res.resumen, /\[URGENTE\]/);
});

test('6. crearBorradorCorreo y enviarBorradorConfirmado: crea borrador sin enviar y envia solo tras confirmacion', async () => {
  const calls = [];
  const mockFetch = async (url, opts = {}) => {
    let parsedBody = null;
    if (opts.body && opts.headers?.['content-type'] === 'application/json') {
      parsedBody = JSON.parse(opts.body);
    }
    calls.push({ url, method: opts.method, body: parsedBody });

    if (url === 'https://oauth2.googleapis.com/token') {
      return {
        ok: true,
        json: async () => ({ access_token: 'ya29.draft-tok', expires_in: 3600 })
      };
    }

    if (url === 'https://gmail.googleapis.com/gmail/v1/users/me/drafts' && opts.method === 'POST') {
      return {
        ok: true,
        json: async () => ({
          id: 'draft-999',
          message: { id: 'msg-999', threadId: 'thr-999' }
        })
      };
    }

    if (url === 'https://gmail.googleapis.com/gmail/v1/users/me/drafts/send' && opts.method === 'POST') {
      return {
        ok: true,
        json: async () => ({
          id: 'msg-sent-999',
          threadId: 'thr-999',
          labelIds: ['SENT']
        })
      };
    }

    throw new Error(`Unexpected call: ${opts.method} ${url}`);
  };

  const deps = {
    clientId: 'cid',
    clientSecret: 'csec',
    refreshToken: 'rtok',
    fetchFn: mockFetch,
    now: 1_700_000_000_000
  };

  // Paso 1: crear borrador (no llama a /messages/send ni /drafts/send)
  const rDraft = await crearBorradorCorreo({
    para: 'cliente@empresa.es',
    asunto: 'Confirmacion de reunion',
    cuerpo: 'Hola, confirmamos la reunion para mañana.'
  }, deps);

  assert.strictEqual(rDraft.ok, true);
  assert.strictEqual(rDraft.draftId, 'draft-999');
  assert.strictEqual(rDraft.estado, 'borrador');
  assert.strictEqual(rDraft.requiereConfirmacion, true);

  const draftCall = calls.find((c) => c.url.endsWith('/drafts'));
  assert.ok(draftCall);
  const decodedRaw = decodificarBase64Url(draftCall.body.message.raw);
  assert.match(decodedRaw, /To: cliente@empresa\.es/);
  assert.match(decodedRaw, /Hola, confirmamos la reunion para mañana\./);
  assert.ok(!calls.some((c) => c.url.includes('/send')));

  // Paso 2: si confirmado === false, bloquea el envio
  const rBloqueado = await enviarBorradorConfirmado('draft-999', { ...deps, confirmado: false });
  assert.strictEqual(rBloqueado.ok, false);
  assert.strictEqual(rBloqueado.requiereConfirmacion, true);

  // Paso 3: enviar borrador confirmado
  const rEnviado = await enviarBorradorConfirmado('draft-999', deps);
  assert.strictEqual(rEnviado.ok, true);
  assert.strictEqual(rEnviado.draftId, 'draft-999');
  assert.strictEqual(rEnviado.id, 'msg-sent-999');
  assert.strictEqual(rEnviado.estado, 'enviado');

  const sendCall = calls.find((c) => c.url.endsWith('/drafts/send'));
  assert.ok(sendCall);
  assert.strictEqual(sendCall.body.id, 'draft-999');
});

test('7. Politica CERO EMOJIS en gmailService.js', () => {
  const srcPath = path.join(process.cwd(), 'src', 'services', 'gmailService.js');
  const contenido = fs.readFileSync(srcPath, 'utf8');
  const emojiRegex = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/u;
  assert.strictEqual(emojiRegex.test(contenido), false, 'gmailService.js no debe contener emojis');
});
