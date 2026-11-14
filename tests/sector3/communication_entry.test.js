/**
 * communication_entry.test.js
 * Pruebas del bloque de comunicacion (nº 29 traductor, nº 30 respuestas
 * sugeridas, nº 31 buscador del historial) por la entrada real de WhatsApp
 * y a nivel de router/servicio.
 *
 * Strict Policy: Zero Emojis.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'path';
import os from 'os';
import crypto from 'node:crypto';

const dirEntorno = fs.mkdtempSync(path.join(os.tmpdir(), 'davis-comm-entry-'));
process.env.DAVIS_HISTORY_DIR = path.join(dirEntorno, 'history');
process.env.NODE_ENV = 'test';

const bot = await import('../../whatsappBot.js');
const { buscarEnHistorial } = await import('../../src/services/historySearchService.js');

const JID_DAVID = '123456789012345@lid';

function sockSimulado(enviados) {
  return {
    // Sesion abierta simulada: Baileys puebla sock.user tras connection=open.
    user: { id: '34600000000:55@s.whatsapp.net', name: 'DAVIS' },
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

test('Entrada real: activar el traductor traduce los mensajes siguientes sin pasar por el flujo normal', async () => {
  const enviados = [];
  const rutaTraductor = path.join(dirEntorno, 'traductor.json');
  const chatFalso = async ({ messages }) => {
    const ultimo = messages[messages.length - 1];
    if (ultimo.role === 'tool') return { message: { content: 'Hecho, David.' } };
    if (messages[0].role === 'system' && /^Eres un traductor/.test(messages[0].content || '')) {
      return { message: { content: 'hello my friend' } };
    }
    return { message: { content: '', tool_calls: [{ id: 'c1', function: { name: 'activar_traductor', arguments: { idioma: 'ingles' } } }] } };
  };
  const deps = { chatCompletion: chatFalso, rutaArchivoTraductor: rutaTraductor };

  await bot.procesarMensajesEntrantes(sockSimulado(enviados), {
    type: 'notify',
    messages: [mensajeEntrante('activa el traductor a ingles', 'COMM-1')]
  }, deps);
  let estado = JSON.parse(fs.readFileSync(rutaTraductor, 'utf-8'));
  assert.ok(estado.chats[JID_DAVID], 'traductor activado para el chat');
  assert.equal(estado.chats[JID_DAVID].idioma, 'ingles');

  await bot.procesarMensajesEntrantes(sockSimulado(enviados), {
    type: 'notify',
    messages: [mensajeEntrante('hola amigo', 'COMM-2')]
  }, deps);
  const ultimo = enviados[enviados.length - 1].payload.text;
  assert.equal(ultimo, 'hello my friend', 'el mensaje sale traducido');
});

test('Entrada real: desactivar el traductor devuelve el flujo normal', async () => {
  const enviados = [];
  const rutaTraductor = path.join(dirEntorno, 'traductor2.json');
  fs.writeFileSync(rutaTraductor, JSON.stringify({ chats: { [JID_DAVID]: { idioma: 'ingles', activadoEn: new Date().toISOString() } } }));
  let llamadasLlm = 0;
  const chatFalso = async () => { llamadasLlm++; return { message: { content: 'no debe llegar' } }; };
  await bot.procesarMensajesEntrantes(sockSimulado(enviados), {
    type: 'notify',
    messages: [mensajeEntrante('desactiva el traductor', 'COMM-3')]
  }, { chatCompletion: chatFalso, rutaArchivoTraductor: rutaTraductor });
  const estado = JSON.parse(fs.readFileSync(rutaTraductor, 'utf-8'));
  assert.equal(estado.chats[JID_DAVID], undefined, 'traductor desactivado');
  assert.equal(llamadasLlm, 0, 'la desactivacion es determinista, no pasa por el LLM ni se traduce');
  assert.match(enviados[enviados.length - 1].payload.text, /Traductor desactivado/);
});

test('Entrada real: buscar_en_historial encuentra mensajes previos del chat', async () => {
  const enviados = [];
  const hash = crypto.createHash('sha256').update(JID_DAVID).digest('hex').slice(0, 24);
  fs.mkdirSync(process.env.DAVIS_HISTORY_DIR, { recursive: true });
  fs.writeFileSync(path.join(process.env.DAVIS_HISTORY_DIR, `${hash}.json`), JSON.stringify({
    mensajes: [
      { role: 'user', content: 'recuerda que el examen de redes es el dia 20' },
      { role: 'assistant', content: 'Anotado, David.' }
    ]
  }));
  const capturas = [];
  const chatFalso = async ({ messages }) => {
    const ultimo = messages[messages.length - 1];
    if (ultimo.role === 'tool') {
      capturas.push(ultimo.content);
      return { message: { content: 'Hecho, David.' } };
    }
    return { message: { content: '', tool_calls: [{ id: 'c3', function: { name: 'buscar_en_historial', arguments: { termino: 'examen' } } }] } };
  };
  await bot.procesarMensajesEntrantes(sockSimulado(enviados), {
    type: 'notify',
    messages: [mensajeEntrante('busca en el historial lo del examen', 'COMM-4')]
  }, { chatCompletion: chatFalso });
  assert.match(capturas[0], /examen de redes/, 'encuentra el mensaje del historial');
});

test('Servicio: buscarEnHistorial sin historial devuelve cero coincidencias y valida entrada', () => {
  const d = { carpetaHistorial: path.join(dirEntorno, 'vacio') };
  assert.deepEqual(buscarEnHistorial({ chatId: 'x@lid', termino: 'nada' }, d), { ok: true, coincidencias: [], total: 0 });
  assert.equal(buscarEnHistorial({ chatId: 'x@lid', termino: '' }, d).ok, false);
});

test('Router: mensajes de comunicacion seleccionan el catalogo sin safety net', async () => {
  const { analizarIntencion } = await import('../../src/core/jarvisAgent.js');
  for (const frase of ['activa el traductor a ingles', 'que le respondo a este mensaje', 'busca en el historial lo del examen']) {
    const ruta = analizarIntencion(frase);
    assert.equal(ruta.safetyNet, false, `sin safety net: ${frase}`);
    assert.ok(ruta.intenciones.includes('comunicacion'), `intencion comunicacion: ${frase}`);
    const nombres = ruta.herramientas.map((t) => t.function.name);
    for (const nombre of ['activar_traductor', 'desactivar_traductor', 'sugerir_respuestas', 'buscar_en_historial']) {
      assert.ok(nombres.includes(nombre), `falta ${nombre}`);
    }
  }
});
