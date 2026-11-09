/**
 * viajes_entry.test.js
 * Pruebas de entrada del bloque 15 (viajes) por el flujo real de WhatsApp.
 *
 * Strict Policy: Zero Emojis.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'os';

const dirEntorno = fs.mkdtempSync(path.join(os.tmpdir(), 'davis-viajes-entry-'));
process.env.DAVIS_HISTORY_DIR = path.join(dirEntorno, 'history');
process.env.NODE_ENV = 'test';

const bot = await import('../../whatsappBot.js');
const { analizarIntencion } = await import('../../src/core/jarvisAgent.js');

const JID_DAVID = '149868706304033@lid';
const rutaArchivoViajes = path.join(dirEntorno, 'viajes.json');
const rutaMetricas = path.join(dirEntorno, 'metricas.jsonl');

function sockSimulado(enviados) {
  return {
    user: { id: '34600000000:55@s.whatsapp.net', name: 'DAVIS' }, readMessages: async () => {},
    sendPresenceUpdate: async () => {},
    sendMessage: async (jid, payload) => { enviados.push({ jid, payload }); return { key: { id: 'SIM-' + enviados.length } }; }
  };
}

function mensajeEntrante(texto, id) {
  return {
    key: { remoteJid: JID_DAVID, fromMe: false, id },
    message: { conversation: texto },
    messageTimestamp: Math.floor(Date.now() / 1000)
  };
}

function chatConHerramienta(nombre, argumentos = {}) {
  return async ({ messages }) => {
    const ultimo = messages[messages.length - 1];
    if (ultimo.role === 'tool') return { message: { content: ultimo.content } };
    return { message: { content: '', tool_calls: [{ id: 'c1', function: { name: nombre, arguments: argumentos } } ] } };
  };
}

test('Router: frases de viajes solo encajan en viajes y traen sus 4 herramientas', () => {
  const r = analizarIntencion('ruta de tren a sevilla');
  assert.deepEqual(r.intenciones, ['viajes']);
  const nombres = r.herramientas.map((h) => h.function.name);
  for (const h of ['vigilar_ruta', 'listar_rutas_vigiladas', 'cancelar_vigilancia_ruta', 'registrar_precio_ruta']) {
    assert.ok(nombres.includes(h), `falta ${h}`);
  }
  const r2 = analizarIntencion('billetes de renfe para mi escapada');
  assert.deepEqual(r2.intenciones, ['viajes']);
});

test('Entrada real: vigilar ruta la registra y declara la fuente en vivo config-required', async () => {
  const enviados = [];
  await bot.procesarMensajesEntrantes(sockSimulado(enviados), {
    type: 'notify',
    messages: [mensajeEntrante('vigila el vuelo Madrid-Lisboa del 2026-12-12, avisame si baja de 50', 'VIAJES-1')]
  }, { chatCompletion: chatConHerramienta('vigilar_ruta', { tipo: 'vuelo', origen: 'Madrid', destino: 'Lisboa', fecha: '2026-12-12', precioObjetivo: 50 }), rutaArchivoViajes, rutaArchivoMetricas: rutaMetricas });
  const texto = enviados[enviados.length - 1].payload.text;
  assert.match(texto, /Vigilando tu vuelo madrid -> lisboa/);
  assert.match(texto, /objetivo: 50 EUR/);
  assert.match(texto, /no tengo proveedor de precios en vivo/i, 'declara config-required de la fuente');
  const rutas = JSON.parse(fs.readFileSync(rutaArchivoViajes, 'utf8'));
  assert.equal(rutas.length, 1);
  assert.equal(rutas[0].activo, true);
});

test('Entrada real: precio manual por debajo del objetivo lo senala', async () => {
  const enviados = [];
  await bot.procesarMensajesEntrantes(sockSimulado(enviados), {
    type: 'notify',
    messages: [mensajeEntrante('el precio del vuelo a lisboa esta a 45 euros', 'VIAJES-2')]
  }, { chatCompletion: chatConHerramienta('registrar_precio_ruta', { criterio: 'lisboa', precio: 45 }), rutaArchivoViajes, rutaArchivoMetricas: rutaMetricas });
  const texto = enviados[enviados.length - 1].payload.text;
  assert.match(texto, /45\.00 EUR/);
  assert.match(texto, /POR DEBAJO de tu objetivo/);
});
