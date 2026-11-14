/**
 * shopping_entry.test.js
 * Pruebas de entrada del buscador de productos bajo demanda (extra aprobado
 * por David, 5 nov 2026: sin compras, sin vigilancia automatica).
 *
 * Strict Policy: Zero Emojis.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'path';
import os from 'os';

const dirEntorno = fs.mkdtempSync(path.join(os.tmpdir(), 'davis-compras-'));
process.env.DAVIS_HISTORY_DIR = path.join(dirEntorno, 'history');
process.env.NODE_ENV = 'test';

const bot = await import('../../whatsappBot.js');
const { analizarIntencion } = await import('../../src/core/jarvisAgent.js');

const JID_DAVID = '123456789012345@lid';

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

test('Router: "donde la compro mas barata" solo encaja en compras', () => {
  const r = analizarIntencion('donde la compro mas barata');
  assert.deepEqual(r.intenciones, ['compras']);
  const nombres = r.herramientas.map((h) => h.function.name);
  assert.ok(nombres.includes('buscar_producto'), 'falta buscar_producto');
  // Una URL o "oferta" tambien atrae sniper/navegacion (regex preexistentes); la union incluye verificar_oferta.
  const r2 = analizarIntencion('verifica esta oferta https://tienda.example/p/1');
  assert.ok(r2.herramientas.map((h) => h.function.name).includes('verificar_oferta'));
});

test('Entrada real: verificar una oferta lee la pagina (fetch inyectado) y declara la hora', async () => {
  const enviados = [];
  let urlPedida = null;
  const fetchFalso = async (url) => {
    urlPedida = url;
    return { ok: true, text: async () => '<script type="application/ld+json">{"@type":"Product","name":"Bolsa Y","offers":{"price":"79.00","priceCurrency":"EUR","availability":"https://schema.org/InStock"}}</script>' };
  };
  const chatFalso = async ({ messages }) => {
    const ultimo = messages[messages.length - 1];
    if (ultimo.role === 'tool') return { message: { content: 'Verificado, David: 79 EUR en stock.' } };
    return { message: { content: '', tool_calls: [{ id: 'c1', function: { name: 'verificar_oferta', arguments: { url: 'https://tienda.example/p/1' } } }] } };
  };
  await bot.procesarMensajesEntrantes(sockSimulado(enviados), {
    type: 'notify',
    messages: [mensajeEntrante('verifica esta oferta https://tienda.example/p/1', 'COM-1')]
  }, { chatCompletion: chatFalso, fetchFnCompras: fetchFalso });
  assert.equal(urlPedida, 'https://tienda.example/p/1', 'el fetch llega por deps al adaptador');
  assert.ok(enviados.length >= 1);
});

test('Entrada real: buscar usa la fuente integrada (fetch inyectado) y devuelve candidatos reales', async () => {
  const enviados = [];
  const fetchFalso = async (url) => {
    assert.match(url, /priceradars\.com\/api\/v1\/search/, 'la fuente por defecto es el comparador');
    return { ok: true, text: async () => JSON.stringify({ products: [{ id: 'a1', slug: 'a1--bolsa-stussy', name: 'Bolsa Stussy Tri Harness', brand: 'Stussy', lowestPrice: 5995, currency: 'EUR', inStock: true, condition: 'NEW', offerCount: 1, merchantName: 'TiendaEjemplo', deeplink: 'https://tienda.example/ficha/9' }], totalCount: 1 }) };
  };
  const chatFalso = async ({ messages }) => {
    const ultimo = messages[messages.length - 1];
    if (ultimo.role === 'tool') return { message: { content: ultimo.content } };
    return { message: { content: '', tool_calls: [{ id: 'c1', function: { name: 'buscar_producto', arguments: { consulta: 'bolsa stussy tri harness' } } }] } };
  };
  await bot.procesarMensajesEntrantes(sockSimulado(enviados), {
    type: 'notify',
    messages: [mensajeEntrante('busca una bolsa stussy tri harness', 'COM-2')]
  }, { chatCompletion: chatFalso, fetchFnCompras: fetchFalso });
  const texto = enviados[enviados.length - 1].payload.text;
  assert.match(texto, /Bolsa Stussy Tri Harness/, 'el candidato llega a la respuesta');
  assert.match(texto, /59\.95 EUR/, 'precio convertido de centimos a EUR');
  assert.match(texto, /PriceRadars/, 'la fuente viaja con el resultado');
  assert.match(texto, /tienda\.example\/ficha\/9/, 'enlace del comercio incluido');
});

test('Entrada real: busqueda sin resultados lo dice sin inventar candidatos', async () => {
  const enviados = [];
  const fetchFalso = async () => ({ ok: true, text: async () => '{"products":[],"totalCount":0}' });
  const chatFalso = async ({ messages }) => {
    const ultimo = messages[messages.length - 1];
    if (ultimo.role === 'tool') return { message: { content: ultimo.content } };
    return { message: { content: '', tool_calls: [{ id: 'c1', function: { name: 'buscar_producto', arguments: { consulta: 'producto inexistente xyz' } } }] } };
  };
  await bot.procesarMensajesEntrantes(sockSimulado(enviados), {
    type: 'notify',
    messages: [mensajeEntrante('busca producto inexistente xyz', 'COM-3')]
  }, { chatCompletion: chatFalso, fetchFnCompras: fetchFalso });
  const texto = enviados[enviados.length - 1].payload.text;
  assert.match(texto, /No he encontrado ofertas/, 'cero candidatos declarado, nada inventado');
});
