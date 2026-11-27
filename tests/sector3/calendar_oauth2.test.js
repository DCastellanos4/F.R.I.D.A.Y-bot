/**
 * calendar_oauth2.test.js
 *
 * Pruebas unitarias de OAuth2 completo para Google Calendar en calendarService.js:
 * - Renovacion automatica de access_token via refresh_token y cache en memoria
 * - Expiracion con margen de seguridad de 60s
 * - Operaciones consultarEventos, crearEvento, modificarEvento y cancelarEvento con Bearer token
 * - Fallback a GOOGLE_CALENDAR_ACCESS_TOKEN directo
 * - Fallback local a calendar_events.json cuando no hay credenciales OAuth2 ni token
 *
 * Strict Policy: Zero Emojis.
 */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import {
  obtenerAccessTokenValido,
  resetOAuthTokenCache,
  consultarEventos,
  crearEvento,
  modificarEvento,
  cancelarEvento
} from '../../src/services/calendarService.js';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'davis-gcal-oauth2-'));

beforeEach(() => {
  resetOAuthTokenCache();
});

test('1. OAuth2: renueva access_token con refresh_token y lo cachea en memoria', async () => {
  const tokenCalls = [];
  const mockFetch = async (url, opts = {}) => {
    if (url === 'https://oauth2.googleapis.com/token') {
      tokenCalls.push({ url, method: opts.method, headers: opts.headers, body: opts.body });
      return {
        ok: true,
        json: async () => ({ access_token: 'ya29.oauth2-token-1', expires_in: 3600 })
      };
    }
    throw new Error(`Unexpected URL: ${url}`);
  };

  const t0 = 1_700_000_000_000;
  const deps = {
    clientId: 'client-id-123',
    clientSecret: 'client-secret-456',
    refreshToken: '1//refresh-token-abc',
    fetchFn: mockFetch,
    now: t0
  };

  const token1 = await obtenerAccessTokenValido(deps);
  assert.strictEqual(token1, 'ya29.oauth2-token-1');
  assert.strictEqual(tokenCalls.length, 1);
  assert.strictEqual(tokenCalls[0].method, 'POST');
  assert.strictEqual(tokenCalls[0].headers['content-type'], 'application/x-www-form-urlencoded');
  const params = new URLSearchParams(tokenCalls[0].body);
  assert.strictEqual(params.get('client_id'), 'client-id-123');
  assert.strictEqual(params.get('client_secret'), 'client-secret-456');
  assert.strictEqual(params.get('refresh_token'), '1//refresh-token-abc');
  assert.strictEqual(params.get('grant_type'), 'refresh_token');

  // Dentro de la ventana valida (3500s < 3540s): debe reutilizar cache sin llamar a fetch
  const token2 = await obtenerAccessTokenValido({ ...deps, now: t0 + 3500 * 1000 });
  assert.strictEqual(token2, 'ya29.oauth2-token-1');
  assert.strictEqual(tokenCalls.length, 1);
});

test('2. OAuth2: renueva automaticamente cuando faltan menos de 60s para expirar', async () => {
  let count = 0;
  const mockFetch = async (url) => {
    assert.strictEqual(url, 'https://oauth2.googleapis.com/token');
    count += 1;
    return {
      ok: true,
      json: async () => ({ access_token: `ya29.token-${count}`, expires_in: 3600 })
    };
  };

  const t0 = 1_700_000_000_000;
  const baseDeps = {
    clientId: 'cid',
    clientSecret: 'csec',
    refreshToken: 'rtok',
    fetchFn: mockFetch
  };

  const t1 = await obtenerAccessTokenValido({ ...baseDeps, now: t0 });
  assert.strictEqual(t1, 'ya29.token-1');
  assert.strictEqual(count, 1);

  // Justo a los 3540s (quedan exactamente 60s): now + 60s == expiresAt -> renueva
  const t2 = await obtenerAccessTokenValido({ ...baseDeps, now: t0 + 3540 * 1000 });
  assert.strictEqual(t2, 'ya29.token-2');
  assert.strictEqual(count, 2);
});

test('3. OAuth2 CRUD completo: crear, consultar, modificar y cancelar con Bearer renovado', async () => {
  const rutaArchivo = path.join(tmpDir, 'crud_oauth2.json');
  const calls = [];
  let tokenNum = 0;

  const mockFetch = async (url, opts = {}) => {
    calls.push({ url, method: opts.method || 'GET', headers: opts.headers || {}, body: opts.body });

    if (url === 'https://oauth2.googleapis.com/token') {
      tokenNum += 1;
      return {
        ok: true,
        json: async () => ({ access_token: `ya29.crud-${tokenNum}`, expires_in: 3600 })
      };
    }

    if (url.includes('/calendars/primary/events') && opts.method === 'POST') {
      return {
        ok: true,
        json: async () => ({ id: 'gcal-ev-100', summary: 'Reunion Arquitectura' })
      };
    }

    if (url.includes('/calendars/primary/events?') && (!opts.method || opts.method === 'GET')) {
      return {
        ok: true,
        json: async () => ({
          items: [
            {
              id: 'gcal-ev-100',
              summary: 'Reunion Arquitectura',
              start: { dateTime: '2026-12-10T10:00:00Z' },
              end: { dateTime: '2026-12-10T11:00:00Z' },
              description: 'Sala Norte'
            }
          ]
        })
      };
    }

    if (url.includes('/calendars/primary/events/gcal-ev-100') && opts.method === 'PATCH') {
      return {
        ok: true,
        json: async () => ({ id: 'gcal-ev-100', summary: 'Reunion Arquitectura v2' })
      };
    }

    if (url.includes('/calendars/primary/events/gcal-ev-100') && opts.method === 'DELETE') {
      return { ok: true, json: async () => ({}) };
    }

    throw new Error(`Unhandled fetch: ${opts.method || 'GET'} ${url}`);
  };

  const deps = {
    rutaArchivo,
    clientId: 'cid-crud',
    clientSecret: 'csec-crud',
    refreshToken: 'rtok-crud',
    calendarId: 'primary',
    apiKey: null,
    fetchFn: mockFetch,
    now: 1_700_000_000_000
  };

  // Crear
  const rCrear = await crearEvento({
    titulo: 'Reunion Arquitectura',
    inicio: '2026-12-10T10:00:00Z',
    fin: '2026-12-10T11:00:00Z',
    descripcion: 'Sala Norte'
  }, deps);
  assert.strictEqual(rCrear.ok, true);
  assert.strictEqual(rCrear.fuente, 'google');
  assert.strictEqual(rCrear.evento.id, 'gcal-ev-100');

  // Consultar
  const rCons = await consultarEventos({
    desde: '2026-12-01T00:00:00Z',
    hasta: '2026-12-31T23:59:59Z'
  }, deps);
  assert.strictEqual(rCons.ok, true);
  assert.strictEqual(rCons.fuente, 'google');
  assert.strictEqual(rCons.eventos.length, 1);
  assert.strictEqual(rCons.eventos[0].titulo, 'Reunion Arquitectura');

  // Modificar
  const rMod = await modificarEvento({
    id: 'gcal-ev-100',
    titulo: 'Reunion Arquitectura v2'
  }, deps);
  assert.strictEqual(rMod.ok, true);
  assert.strictEqual(rMod.fuente, 'google');
  assert.strictEqual(rMod.evento.titulo, 'Reunion Arquitectura v2');

  // Cancelar
  const rCanc = await cancelarEvento({ id: 'gcal-ev-100' }, deps);
  assert.strictEqual(rCanc.ok, true);
  assert.strictEqual(rCanc.cancelados, 1);

  // Solo 1 llamada a /token para las 4 operaciones (cache en memoria)
  const tokenReqs = calls.filter((c) => c.url === 'https://oauth2.googleapis.com/token');
  assert.strictEqual(tokenReqs.length, 1);

  const gcalReqs = calls.filter((c) => c.url.startsWith('https://www.googleapis.com/calendar/v3/'));
  assert.strictEqual(gcalReqs.length, 4);
  for (const req of gcalReqs) {
    assert.strictEqual(req.headers.authorization, 'Bearer ya29.crud-1');
  }
});

test('4. Fallback a GOOGLE_CALENDAR_ACCESS_TOKEN directo si no hay OAuth2 o falla refresh', async () => {
  const rutaArchivo = path.join(tmpDir, 'fallback_direct_token.json');
  const calls = [];

  const mockFetch = async (url, opts = {}) => {
    calls.push({ url, method: opts.method || 'GET', headers: opts.headers || {} });
    if (url === 'https://oauth2.googleapis.com/token') {
      return { ok: false, status: 401, json: async () => ({ error: 'invalid_grant' }) };
    }
    return {
      ok: true,
      json: async () => ({
        items: [{ id: 'ev-direct-1', summary: 'Evento Directo', start: { dateTime: '2026-12-15T09:00:00Z' } }]
      })
    };
  };

  // Caso A: sin credenciales OAuth2, con accessToken directo
  const rDirecto = await consultarEventos(
    { desde: '2026-12-01T00:00:00Z', hasta: '2026-12-31T23:59:59Z' },
    {
      rutaArchivo,
      clientId: null,
      clientSecret: null,
      refreshToken: null,
      accessToken: 'ya29.direct-token',
      apiKey: null,
      fetchFn: mockFetch
    }
  );
  assert.strictEqual(rDirecto.ok, true);
  assert.strictEqual(rDirecto.fuente, 'google');
  assert.strictEqual(calls[0].headers.authorization, 'Bearer ya29.direct-token');

  // Caso B: OAuth2 falla y cae al accessToken directo
  const rFallback = await consultarEventos(
    { desde: '2026-12-01T00:00:00Z', hasta: '2026-12-31T23:59:59Z' },
    {
      rutaArchivo,
      clientId: 'cid',
      clientSecret: 'csec',
      refreshToken: 'bad-rtok',
      accessToken: 'ya29.fallback-direct',
      apiKey: null,
      fetchFn: mockFetch
    }
  );
  assert.strictEqual(rFallback.ok, true);
  assert.strictEqual(rFallback.fuente, 'google');
  assert.strictEqual(calls[2].headers.authorization, 'Bearer ya29.fallback-direct');
});

test('5. Fallback local a calendar_events.json solo cuando no hay credenciales OAuth2 ni token', async () => {
  const rutaArchivo = path.join(tmpDir, 'local_only.json');
  const deps = {
    rutaArchivo,
    clientId: null,
    clientSecret: null,
    refreshToken: null,
    accessToken: null,
    apiKey: null
  };

  const rCrear = await crearEvento({
    titulo: 'Evento Local Sin Red',
    inicio: '2026-12-20 12:00',
    fin: '2026-12-20 13:00'
  }, deps);
  assert.strictEqual(rCrear.ok, true);
  assert.strictEqual(rCrear.fuente, 'local');
  assert.ok(rCrear.evento.id.startsWith('cal-'));

  const rCons = await consultarEventos({
    desde: '2026-12-01',
    hasta: '2026-12-31'
  }, deps);
  assert.strictEqual(rCons.ok, true);
  assert.strictEqual(rCons.fuente, 'local');
  assert.strictEqual(rCons.eventos.length, 1);

  const rMod = await modificarEvento({
    id: rCrear.evento.id,
    titulo: 'Evento Local Editado'
  }, deps);
  assert.strictEqual(rMod.ok, true);
  assert.strictEqual(rMod.fuente, 'local');

  const rCanc = await cancelarEvento({ id: rCrear.evento.id }, deps);
  assert.strictEqual(rCanc.ok, true);
  assert.strictEqual(rCanc.cancelados, 1);
  assert.strictEqual(fs.existsSync(rutaArchivo), true);
});
