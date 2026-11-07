/**
 * error_sanitizer.test.js - Regresion del fallo observado en produccion
 * (7 nov 2026): un 429 del proveedor llegaba a WhatsApp con organization id
 * y detalle de cuota. El usuario recibe un resumen honesto y el tiempo de
 * reintento real cuando existe; el detalle queda en los logs.
 *
 * Strict Policy: Zero Emojis.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extraerEsperaReintento,
  esErrorDeLimite,
  mensajeErrorParaUsuario
} from '../../src/services/errorSanitizerService.js';

const ERROR_429_REAL = 'Rate limit reached for model `openai/gpt-oss-120b` in organization `org_01SECRETOID` on tokens per day (TPD): Limit 100000, Used 99500, Requested 1200. Please try again in 4m30.5s. Need more tokens? Visit https://console.groq.com/settings/billing';

test('un 429 no filtra organizacion, modelo, cuota ni URL al usuario', () => {
  const msg = mensajeErrorParaUsuario(new Error(ERROR_429_REAL));
  assert.ok(!msg.includes('org_'), 'sin organization id');
  assert.ok(!msg.includes('openai/gpt-oss'), 'sin nombre interno del modelo');
  assert.ok(!msg.includes('100000') && !msg.includes('99500'), 'sin cifras de cuota');
  assert.ok(!msg.includes('http'), 'sin URLs del proveedor');
  assert.ok(msg.includes('limite'), 'declara honestamente que es un limite');
});

test('el tiempo de reintento real del proveedor se conserva en lenguaje claro', () => {
  const msg = mensajeErrorParaUsuario(new Error(ERROR_429_REAL));
  assert.ok(msg.includes('4 minutos 31 segundos'), `espera legible en: "${msg}"`);
  const msg2 = mensajeErrorParaUsuario(new Error('429 too many requests, try again in 20s'));
  assert.ok(msg2.includes('20 segundos'));
});

test('un 429 sin tiempo de reintento da una espera generica honesta', () => {
  const msg = mensajeErrorParaUsuario(new Error('HTTP 429 rate limit exceeded'));
  assert.ok(msg.includes('limite'));
  assert.ok(!msg.includes('429'), 'sin codigos crudos');
  assert.ok(msg.includes('en unos minutos'));
});

test('un error generico no filtra su texto crudo', () => {
  const msg = mensajeErrorParaUsuario(new Error('connect ECONNREFUSED organization org_x key sk-123456'));
  assert.ok(msg.includes('anomalía'));
  assert.ok(!msg.includes('org_x') && !msg.includes('sk-123456') && !msg.includes('ECONNREFUSED'));
  assert.ok(msg.includes('registro'), 'apunta al diagnostico en logs');
});

test('contexto audio y despacho tambien van sanitizados', () => {
  const audio = mensajeErrorParaUsuario(new Error('ffmpeg failed org_y'), { contexto: 'audio' });
  assert.ok(audio.includes('nota de voz') && !audio.includes('org_y'));
  const desp = mensajeErrorParaUsuario(new Error('boom sk-zzz'), { contexto: 'despacho', numero: '34600111222' });
  assert.ok(desp.includes('+34600111222') && !desp.includes('sk-zzz'));
  const limiteDesp = mensajeErrorParaUsuario(new Error(ERROR_429_REAL), { contexto: 'despacho', numero: '34600111222' });
  assert.ok(limiteDesp.includes('limite') && !limiteDesp.includes('org_'));
});

test('extraerEsperaReintento solo acepta formatos reales', () => {
  assert.equal(extraerEsperaReintento('try again in 1h2m3s'), '1 hora 2 minutos 3 segundos');
  assert.equal(extraerEsperaReintento('try again in garbage'), null);
  assert.equal(extraerEsperaReintento(''), null);
  assert.equal(extraerEsperaReintento(null), null);
});

test('esErrorDeLimite distingue limites de fallos de red', () => {
  assert.equal(esErrorDeLimite(ERROR_429_REAL), true);
  assert.equal(esErrorDeLimite('Error: connect ECONNREFUSED 127.0.0.1'), false);
  assert.equal(esErrorDeLimite('socket hang up'), false);
});
