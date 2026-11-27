/**
 * whatsapp_jid_queue.test.js
 * Verifica la serializacion por remoteJid en procesarMensajesEntrantes y
 * ejecutarEnColaPorJid: mensajes concurrentes al mismo chat se ejecutan en
 * orden secuencial estricto, chats distintos corren en paralelo, y los errores
 * liberan siempre el lock.
 *
 * Strict Policy: Zero Emojis.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const dirHistorial = fs.mkdtempSync(path.join(os.tmpdir(), 'davis-jid-queue-'));
process.env.DAVIS_HISTORY_DIR = dirHistorial;
process.env.NODE_ENV = 'test';

const historial = await import('../../src/services/conversationHistoryService.js');
const bot = await import('../../whatsappBot.js');

const JID_DAVID = '123456789012345@lid';
const JID_GRUPO = '120363000000000000@g.us';

function crearDiferido() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function sockSimulado(enviados) {
  return {
    user: { id: '34600000000:55@s.whatsapp.net', name: 'DAVIS' },
    readMessages: async () => {},
    sendPresenceUpdate: async () => {},
    sendMessage: async (jid, payload) => {
      enviados.push({ jid, payload });
      return { key: { id: 'SIM-' + enviados.length } };
    }
  };
}

function mensajeTexto(remoteJid, id, texto) {
  return {
    key: { remoteJid, fromMe: false, id },
    message: { conversation: texto },
    messageTimestamp: Math.floor(Date.now() / 1000)
  };
}

test('mensajes concurrentes al mismo remoteJid se ejecutan en orden secuencial estricto', async () => {
  historial.limpiarHistorial(JID_DAVID);
  const enviados = [];
  const sock = sockSimulado(enviados);
  const traza = [];
  const diferido1 = crearDiferido();
  const diferido2 = crearDiferido();
  let llamada = 0;

  const llmSimulado = async ({ messages }) => {
    llamada += 1;
    const turno = llamada;
    const ultimoUsuario = [...messages].reverse().find(m => m.role === 'user')?.content || '';
    traza.push(`start:${turno}:${ultimoUsuario}`);

    if (turno === 1) {
      await diferido1.promise;
      traza.push(`end:${turno}:${ultimoUsuario}`);
      return { message: { content: 'respuesta-1' } };
    }

    await diferido2.promise;
    traza.push(`end:${turno}:${ultimoUsuario}`);
    return { message: { content: 'respuesta-2' } };
  };

  const p1 = bot.procesarMensajesEntrantes(sock, {
    messages: [mensajeTexto(JID_DAVID, 'MSG-1', 'hola primer mensaje')],
    type: 'notify'
  }, { chatCompletion: llmSimulado });

  // Esperar microtasks para asegurar que el turno 1 ya entro en el LLM
  await new Promise((r) => setTimeout(r, 30));

  const p2 = bot.procesarMensajesEntrantes(sock, {
    messages: [mensajeTexto(JID_DAVID, 'MSG-2', 'hola segundo mensaje')],
    type: 'notify'
  }, { chatCompletion: llmSimulado });

  // Dar tiempo para verificar que el turno 2 NO arranca mientras el 1 sigue bloqueado
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(llamada, 1, 'el segundo mensaje del mismo JID no debe iniciar antes de terminar el primero');
  assert.deepEqual(traza, ['start:1:hola primer mensaje']);

  diferido1.resolve();
  await new Promise((r) => setTimeout(r, 30));

  // Ahora el turno 2 debe haber iniciado tras finalizar el turno 1
  assert.equal(llamada, 2, 'el segundo mensaje debe iniciar despues de liberar el turno 1');
  diferido2.resolve();

  await Promise.all([p1, p2]);

  assert.deepEqual(traza, [
    'start:1:hola primer mensaje',
    'end:1:hola primer mensaje',
    'start:2:hola segundo mensaje',
    'end:2:hola segundo mensaje'
  ]);

  const textosEnviados = enviados.map(e => e.payload.text);
  assert.deepEqual(textosEnviados, ['respuesta-1', 'respuesta-2']);

  const ctx = historial.obtenerHistorial(JID_DAVID);
  assert.equal(ctx.length, 4, 'ambos intercambios quedan registrados en orden sin pisarse');
  assert.equal(ctx[0].content, 'hola primer mensaje');
  assert.equal(ctx[1].content, 'respuesta-1');
  assert.equal(ctx[2].content, 'hola segundo mensaje');
  assert.equal(ctx[3].content, 'respuesta-2');
});

test('chats con distintos remoteJid corren en paralelo sin bloquearse entre si', async () => {
  historial.limpiarHistorial(JID_DAVID);
  const enviados = [];
  const sock = sockSimulado(enviados);
  const diferidoDavid = crearDiferido();
  const eventos = [];

  const llmDavid = async () => {
    eventos.push('david:start');
    await diferidoDavid.promise;
    eventos.push('david:end');
    return { message: { content: 'ok-david' } };
  };

  const procesarGrupo = async () => {
    eventos.push('grupo:start');
    await new Promise((r) => setTimeout(r, 10));
    eventos.push('grupo:end');
    return { gestionado: true };
  };

  const pDavid = bot.procesarMensajesEntrantes(sock, {
    messages: [mensajeTexto(JID_DAVID, 'MSG-D1', 'hola david')],
    type: 'notify'
  }, { chatCompletion: llmDavid });

  await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(eventos, ['david:start']);

  const pGrupo = bot.procesarMensajesEntrantes(sock, {
    messages: [mensajeTexto(JID_GRUPO, 'MSG-G1', 'hola grupo')],
    type: 'notify'
  }, { procesarMensajeGrupo: procesarGrupo });

  // El chat de grupo debe completarse mientras David sigue bloqueado
  await pGrupo;
  assert.deepEqual(eventos, ['david:start', 'grupo:start', 'grupo:end']);

  diferidoDavid.resolve();
  await pDavid;
  assert.deepEqual(eventos, ['david:start', 'grupo:start', 'grupo:end', 'david:end']);
});

test('un error dentro de un turno libera siempre el lock para los siguientes mensajes del mismo JID', async () => {
  historial.limpiarHistorial(JID_DAVID);
  const enviados = [];
  const sock = sockSimulado(enviados);
  let intento = 0;

  const llmConFallo = async () => {
    intento += 1;
    if (intento === 1) {
      throw new Error('fallo simulado del proveedor');
    }
    return { message: { content: 'recuperado-ok' } };
  };

  const p1 = bot.procesarMensajesEntrantes(sock, {
    messages: [mensajeTexto(JID_DAVID, 'MSG-ERR-1', 'hola mensaje que falla')],
    type: 'notify'
  }, { chatCompletion: llmConFallo });

  const p2 = bot.procesarMensajesEntrantes(sock, {
    messages: [mensajeTexto(JID_DAVID, 'MSG-ERR-2', 'hola mensaje siguiente')],
    type: 'notify'
  }, { chatCompletion: llmConFallo });

  await Promise.all([p1, p2]);

  assert.equal(intento, 2);
  assert.equal(enviados.length, 2);
  assert.equal(enviados[1].payload.text, 'recuperado-ok');

  // Verificar tambien la primitiva ejecutarEnColaPorJid ante excepcion no capturada
  await assert.rejects(
    bot.ejecutarEnColaPorJid('test-jid-error@s.whatsapp.net', async () => {
      throw new Error('error directo');
    }),
    /error directo/
  );

  const siguiente = await bot.ejecutarEnColaPorJid('test-jid-error@s.whatsapp.net', async () => 'desbloqueado');
  assert.equal(siguiente, 'desbloqueado');
});
