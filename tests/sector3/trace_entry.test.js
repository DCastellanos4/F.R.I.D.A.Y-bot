/**
 * trace_entry.test.js
 * Trazas del recorrido de mensajes: servicio (guardado, tope, redaccion),
 * herramienta explicar_recorrido y flujo real de entrada
 * ("como has llegado a esa respuesta?").
 *
 * Strict Policy: Zero Emojis.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const dirEntorno = fs.mkdtempSync(path.join(os.tmpdir(), 'davis-trazas-'));
process.env.NODE_ENV = 'test';

const { iniciarTraza, guardarTraza, ultimaTraza, explicarUltimoRecorrido } = await import('../../src/services/traceService.js');
const bot = await import('../../whatsappBot.js');

const JID_DAVID = '149868706304033@lid';
const carpetaTrazas = path.join(dirEntorno, 'trazas');

function sockSimulado(enviados) {
  return {
    readMessages: async () => {},
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

test('Traza: guardar y leer la ultima por chat, con mensaje recortado', () => {
  const traza = iniciarTraza('chat-unitario@test', 'que tiempo hace?');
  traza.via = 'regex';
  traza.intenciones = ['clima'];
  traza.herramientasOfrecidas = 1;
  traza.llamadas.push({ nombre: 'consultar_clima', ronda: 1, resultado: 'ok' });
  traza.rondas = 1;
  traza.duracionMs = 1234;
  assert.equal(guardarTraza(traza, { carpetaTrazas }), true);
  const leida = ultimaTraza('chat-unitario@test', { carpetaTrazas });
  assert.equal(leida.via, 'regex');
  assert.deepEqual(leida.llamadas.map((l) => l.nombre), ['consultar_clima']);
  // Otro chat no ve la traza ajena
  assert.equal(ultimaTraza('otro-chat@test', { carpetaTrazas }), null);
});

test('Traza: credenciales se redactan antes de guardar', () => {
  const traza = iniciarTraza('chat-redaccion@test', 'mi contrasena: secreta123 no la guardes');
  assert.ok(!traza.mensaje.includes('secreta123'), 'la credencial no debia quedar en la traza');
  assert.ok(traza.mensaje.includes('[redactado'), 'debio marcarse la redaccion');
});

test('Traza: guardia de tests sin carpeta inyectada no escribe en data/ real', () => {
  const traza = iniciarTraza('chat-guardia@test', 'hola');
  assert.equal(guardarTraza(traza), false);
});

test('Traza: tope de 50 por chat conserva las mas recientes', () => {
  const chat = 'chat-tope@test';
  for (let i = 0; i < 65; i++) {
    const t = iniciarTraza(chat, `mensaje numero ${i}`);
    t.rondas = 0;
    t.duracionMs = 1;
    guardarTraza(t, { carpetaTrazas });
  }
  const ultima = ultimaTraza(chat, { carpetaTrazas });
  assert.equal(ultima.mensaje, 'mensaje numero 64');
});

test('explicarUltimoRecorrido: sin trazas lo dice honesto', () => {
  const texto = explicarUltimoRecorrido('chat-inexistente@test', { carpetaTrazas });
  assert.match(texto, /No tengo registrado ningun recorrido/);
});

test('explicarUltimoRecorrido: explica en llano una traza con herramienta', () => {
  const chat = 'chat-explica@test';
  const traza = iniciarTraza(chat, 'que tiempo hace?');
  traza.via = 'regex';
  traza.intenciones = ['clima'];
  traza.herramientasOfrecidas = 1;
  traza.llamadas.push({ nombre: 'consultar_clima', ronda: 1, resultado: 'ok' });
  traza.rondas = 1;
  traza.duracionMs = 1500;
  guardarTraza(traza, { carpetaTrazas });
  const texto = explicarUltimoRecorrido(chat, { carpetaTrazas });
  assert.match(texto, /Enrutado directo/);
  assert.match(texto, /consultar_clima/);
  assert.match(texto, /salio bien/);
  assert.match(texto, /1 ronda\(s\)/);
});

test('Entrada real: una consulta deja traza y "como has llegado a esa respuesta?" la explica', async () => {
  // 1. Peticion de clima con herramienta guionizada (ejecutor real tolera
  //    falta de red: la traza se guarda igualmente al final del flujo).
  const enviados1 = [];
  const chatClima = async ({ messages }) => {
    const ultimo = messages[messages.length - 1];
    if (ultimo.role === 'tool') return { message: { content: 'Soleado y 22 grados.' } };
    return { message: { content: '', tool_calls: [{ id: 'c1', function: { name: 'consultar_clima', arguments: { ubicacion: 'Madrid' } } }] } };
  };
  await bot.procesarMensajesEntrantes(sockSimulado(enviados1), {
    type: 'notify',
    messages: [mensajeEntrante('que tiempo hace en madrid?', 'TRZ-1')]
  }, { chatCompletion: chatClima, carpetaTrazas });

  // La traza del clima existe ya: enrutado directo y oferta de 1 herramienta.
  const trazaClima = ultimaTraza(JID_DAVID, { carpetaTrazas });
  assert.ok(trazaClima, 'la consulta de clima debio dejar traza');
  assert.equal(trazaClima.via, 'regex');
  assert.deepEqual(trazaClima.intenciones, ['clima']);

  // 2. Pregunta por el recorrido: enruta a devtools por regex y la
  //    herramienta real lee la traza anterior del mismo chat.
  const enviados2 = [];
  const chatRecorrido = async ({ messages }) => {
    const ultimo = messages[messages.length - 1];
    if (ultimo.role === 'tool') return { message: { content: ultimo.content } };
    return { message: { content: '', tool_calls: [{ id: 'c2', function: { name: 'explicar_recorrido', arguments: {} } }] } };
  };
  await bot.procesarMensajesEntrantes(sockSimulado(enviados2), {
    type: 'notify',
    messages: [mensajeEntrante('como has llegado a esa respuesta?', 'TRZ-2')]
  }, { chatCompletion: chatRecorrido, carpetaTrazas });

  const texto = enviados2[enviados2.length - 1].payload.text;
  assert.match(texto, /consultar_clima/, 'la explicacion debia nombrar la herramienta usada antes');
  assert.match(texto, /Enrutado directo/, 'la explicacion debia describir la via de enrutado');
});
