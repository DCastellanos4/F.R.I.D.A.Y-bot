/**
 * process_entry.test.js
 * Prueba de cableado real del vigilante de procesos (nº 17) por la entrada
 * real de WhatsApp: herramientas por intencion, registro persistente y
 * opt-in explicito de la vigilancia proactiva.
 *
 * Strict Policy: Zero Emojis.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'path';
import os from 'os';

const dirEntorno = fs.mkdtempSync(path.join(os.tmpdir(), 'davis-proc-entry-'));
process.env.DAVIS_HISTORY_DIR = path.join(dirEntorno, 'history');
process.env.NODE_ENV = 'test';

const bot = await import('../../whatsappBot.js');

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

test('Entrada real: vigilar_proceso persiste y el router ofrece las herramientas', async () => {
  const enviados = [];
  const captura = {};
  const rutaProcesos = path.join(dirEntorno, 'proc-entry-1.json');
  const chatFalso = async ({ messages, tools }) => {
    if (tools && tools.length > 0) captura.tools = tools.map((t) => t.function.name);
    const ultimo = messages[messages.length - 1];
    if (ultimo.role === 'tool') return { message: { content: 'Hecho, David.' } };
    return { message: { content: '', tool_calls: [{ id: 'c1', function: { name: 'vigilar_proceso', arguments: { nombre: 'node', cpuLimite: 80 } } }] } };
  };

  await bot.procesarMensajesEntrantes(sockSimulado(enviados), {
    type: 'notify',
    messages: [mensajeEntrante('vigila el proceso node del vps', 'PROC-1')]
  }, { chatCompletion: chatFalso, rutaArchivoProcesos: rutaProcesos });

  assert.ok(enviados.length > 0, 'el handler respondio');
  assert.ok(captura.tools.includes('vigilar_proceso'), 'el router empuja las herramientas de procesos');
  const estado = JSON.parse(fs.readFileSync(rutaProcesos, 'utf-8'));
  assert.equal(estado.procesos.length, 1);
  assert.equal(estado.procesos[0].nombre, 'node');
  assert.equal(estado.config.vigilanciaActiva, false, 'registrar no activa la vigilancia');
});

test('Entrada real: la vigilancia solo se activa si David lo pide textualmente', async () => {
  const enviados = [];
  const capturas = [];
  const rutaProcesos = path.join(dirEntorno, 'proc-entry-2.json');
  const chatFalso = async ({ messages }) => {
    const ultimo = messages[messages.length - 1];
    if (ultimo.role === 'tool') {
      capturas.push(ultimo.content);
      return { message: { content: 'Hecho, David.' } };
    }
    return { message: { content: '', tool_calls: [{ id: 'c2', function: { name: 'configurar_vigilante_procesos', arguments: { activo: true } } }] } };
  };
  const deps = { chatCompletion: chatFalso, rutaArchivoProcesos: rutaProcesos };

  await bot.procesarMensajesEntrantes(sockSimulado(enviados), {
    type: 'notify',
    messages: [mensajeEntrante('como va el proceso caido del servidor', 'PROC-2')]
  }, deps);
  assert.match(capturas[0], /necesito que me lo pidas tu directamente/, 'el modelo no puede autoactivar la vigilancia');
  assert.equal(fs.existsSync(rutaProcesos), false, 'no se escribe nada sin la peticion de David');

  await bot.procesarMensajesEntrantes(sockSimulado(enviados), {
    type: 'notify',
    messages: [mensajeEntrante('activa la vigilancia de procesos', 'PROC-3')]
  }, deps);
  const estado = JSON.parse(fs.readFileSync(rutaProcesos, 'utf-8'));
  assert.equal(estado.config.vigilanciaActiva, true, 'la peticion textual de David la activa');
});

test('Router: un mensaje de procesos selecciona el catalogo del bloque sin safety net', async () => {
  const { analizarIntencion } = await import('../../src/core/jarvisAgent.js');
  const ruta = analizarIntencion('hay un proceso caido en el servidor');
  assert.equal(ruta.safetyNet, false);
  assert.ok(ruta.intenciones.includes('procesos'));
  const nombres = ruta.herramientas.map((t) => t.function.name);
  for (const nombre of ['vigilar_proceso', 'listar_procesos_vigilados', 'dejar_vigilar_proceso', 'configurar_vigilante_procesos']) {
    assert.ok(nombres.includes(nombre), `falta ${nombre}`);
  }
});
