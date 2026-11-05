/**
 * whatsapp_condensation_entry.test.js
 * Regresion de integracion del hallazgo 1 de la revision 3: el defecto
 * original era que los tests de servicio pasaban mientras el cableado de
 * entrada no existia. Este test dispara un mensaje entrante SIMULADO a
 * traves del handler real de WhatsApp (procesarMensajesEntrantes) con
 * socket y LLM simulados, y exige que la condensacion del historial se
 * active desde ese flujo. Sin conexiones ni efectos externos.
 *
 * Strict Policy: Zero Emojis.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'path';
import os from 'os';

const dirHistorial = fs.mkdtempSync(path.join(os.tmpdir(), 'davis-entry-'));
process.env.DAVIS_HISTORY_DIR = dirHistorial;
process.env.NODE_ENV = 'test';

const historial = await import('../../src/services/conversationHistoryService.js');
const bot = await import('../../whatsappBot.js');

// JID LID de David: es la via real por la que llegan sus mensajes directos
// (esMensajeDeDavid lo acepta y no cae en la captura de notas del self-chat)
const JID_DAVID = '149868706304033@lid';

function sockSimulado(enviados) {
  return {
    readMessages: async () => {},
    sendPresenceUpdate: async () => {},
    sendMessage: async (jid, payload) => { enviados.push({ jid, payload }); return { key: { id: 'SIM-' + enviados.length } }; }
  };
}

function mensajeEntrante(texto) {
  return {
    key: { remoteJid: JID_DAVID, fromMe: false, id: 'SIM-ENTRADA-1' },
    message: { conversation: texto },
    messageTimestamp: Math.floor(Date.now() / 1000)
  };
}

// La llamada de condensacion se distingue por su system prompt de resumen;
// cualquier otra llamada es la respuesta conversacional del asistente.
// Se registran las llamadas para atribuir el disparo al flujo de entrada.
const llamadasLlm = [];
const llmSimulado = async ({ messages }) => {
  const esCondensacion = messages.some(m => m.role === 'system' && typeof m.content === 'string' && m.content.startsWith('Resume en espanol'));
  llamadasLlm.push(esCondensacion ? 'condensacion' : 'chat');
  return { message: { content: esCondensacion ? 'resumen simulado de entrada' : 'respuesta simulada del asistente' } };
};

// Espera a que la condensacion disparada en segundo plano por el handler
// termine. El test no puede invocar el servicio el mismo: si el cableado de
// entrada falta, nadie condensa y este bucle agota sus vueltas, haciendo
// fallar las aserciones siguientes (es la conducta del defecto original).
async function esperarCondensacionDisparadaPorEntrada(jid) {
  for (let i = 0; i < 200 && historial.contarMensajes(jid) > historial.MAX_MENSAJES_VENTANA; i++) {
    await new Promise(resolve => setImmediate(resolve));
  }
}

test('un mensaje entrante dispara la condensacion del historial al llegar al tope', async () => {
  for (let i = 0; i < historial.MAX_MENSAJES_ARCHIVO; i++) {
    historial.registrarMensaje(JID_DAVID, i % 2 === 0 ? 'user' : 'assistant', `historial previo ${i}`);
  }
  assert.equal(historial.contarMensajes(JID_DAVID), historial.MAX_MENSAJES_ARCHIVO);

  const enviados = [];
  await bot.procesarMensajesEntrantes(sockSimulado(enviados), {
    messages: [mensajeEntrante('hola, prueba de condensacion desde la entrada')],
    type: 'notify'
  }, { chatCompletion: llmSimulado });

  // El flujo de entrada respondio por el socket simulado
  assert.ok(enviados.length > 0, 'el handler respondio al mensaje entrante');
  assert.ok(
    enviados.some(e => typeof e.payload.text === 'string' && e.payload.text.includes('respuesta simulada')),
    'la respuesta del LLM simulado llego al socket'
  );

  // La condensacion debe haberla disparado el propio handler de entrada,
  // en segundo plano. Se espera su fin sin invocar el servicio desde el test.
  await esperarCondensacionDisparadaPorEntrada(JID_DAVID);

  assert.ok(
    llamadasLlm.includes('condensacion'),
    'el flujo de entrada disparo la condensacion (llamada LLM de resumen observada)'
  );
  assert.equal(
    historial.contarMensajes(JID_DAVID),
    historial.MAX_MENSAJES_VENTANA,
    'la condensacion recorto el historial a la ventana reciente'
  );
  const ctx = historial.obtenerHistorial(JID_DAVID);
  assert.equal(ctx[0].role, 'system', 'el contexto incluye el resumen condensado');
  assert.ok(ctx[0].content.includes('resumen simulado de entrada'), 'el resumen proviene del LLM del flujo de entrada');
});

test('bajo el tope, un mensaje entrante no condensa', async () => {
  const jid2 = JID_DAVID;
  historial.limpiarHistorial(jid2);
  const enviados = [];
  await bot.procesarMensajesEntrantes(sockSimulado(enviados), {
    messages: [mensajeEntrante('mensaje sin historial previo')],
    type: 'notify'
  }, { chatCompletion: llmSimulado });
  assert.ok(enviados.length > 0);
  assert.equal(historial.contarMensajes(jid2), 2, 'solo el intercambio registrado, sin condensacion');
  const ctx = historial.obtenerHistorial(jid2);
  assert.ok(!ctx.some(m => m.role === 'system'), 'sin resumen porque no llego al tope');
});
