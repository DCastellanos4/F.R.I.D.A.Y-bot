/**
 * episodic_memory.test.js
 * Plan de inteligencia aprobado por David (6 nov 2026, WhatsApp
 * wamid.HBgLMzQ2MzU2MDU2MDUVAgASGBQzQTk0QjkyMjk0OTdCQkVFODE2NAA=
 * "vale ahora vamos a empezar a hacerlo mas inteligente, sigue el plan"),
 * recomendacion 3 (memoria de conversacion): la ventana del modelo solo ve
 * los ultimos 12 mensajes y la condensacion resume el resto. Estos tests
 * fijan la memoria episodica: lo que sale del historial se archiva y se
 * recupera por relevancia cuando aporta al mensaje actual, inyectado como
 * contexto protegido (no instrucciones).
 *
 * Strict Policy: Zero Emojis.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'path';
import os from 'os';

const dirEntorno = fs.mkdtempSync(path.join(os.tmpdir(), 'davis-episodios-'));
process.env.DAVIS_HISTORY_DIR = path.join(dirEntorno, 'history');
process.env.DAVIS_DATA_DIR = path.join(dirEntorno, 'data');
process.env.NODE_ENV = 'test';

const historial = await import('../../src/services/conversationHistoryService.js');
const episodica = await import('../../src/services/episodicMemoryService.js');
const bot = await import('../../whatsappBot.js');

// JID LID de David: via real de sus mensajes directos.
const JID_DAVID = '149868706304033@lid';

function sockSimulado(enviados) {
  return {
    // Sesion abierta simulada: Baileys puebla sock.user tras connection=open.
    user: { id: '34600000000:55@s.whatsapp.net', name: 'DAVIS' },
    readMessages: async () => {},
    sendPresenceUpdate: async () => {},
    sendMessage: async (jid, payload) => { enviados.push({ jid, payload }); return { key: { id: 'SIM-' + enviados.length } }; }
  };
}

function mensajeEntrante(texto, id = 'SIM-ENTRADA-1') {
  return {
    key: { remoteJid: JID_DAVID, fromMe: false, id },
    message: { conversation: texto },
    messageTimestamp: Math.floor(Date.now() / 1000)
  };
}

// ---------- Servicio: archivar y buscar ----------

test('archivarEpisodios + buscarEpisodios: recupera el fragmento relevante por palabras clave', async () => {
  const chat = 'chat-servicio-1';
  episodica.archivarEpisodios(chat, [
    { role: 'user', content: 'el examen de redes es el 18 de diciembre', ts: '2026-10-01T10:00:00Z' },
    { role: 'assistant', content: 'apuntado, examen de redes el 18 de diciembre', ts: '2026-10-01T10:00:05Z' },
    { role: 'user', content: 'me apetece pizza esta noche', ts: '2026-10-02T20:00:00Z' }
  ]);
  const hits = await episodica.buscarEpisodios(chat, 'cuando era el examen de redes?');
  assert.ok(hits.length >= 1 && hits.length <= 3);
  assert.ok(hits.some((h) => h.content.includes('18 de diciembre')));
});

test('buscarEpisodios: sin coincidencias devuelve vacio y sin episodios devuelve vacio', async () => {
  const chat = 'chat-servicio-2';
  episodica.archivarEpisodios(chat, [{ role: 'user', content: 'me apetece pizza', ts: '2026-10-02T20:00:00Z' }]);
  assert.deepEqual(await episodica.buscarEpisodios(chat, 'presupuesto del alquiler'), []);
  assert.deepEqual(await episodica.buscarEpisodios('chat-inexistente', 'cualquier cosa'), []);
});

test('buscarEpisodios: con mas de 3 candidatos y modelo disponible, el modelo elige', async () => {
  const chat = 'chat-servicio-3';
  const mensajes = [];
  for (let i = 0; i < 6; i++) {
    mensajes.push({ role: 'user', content: `viaje numero ${i} a la playa este verano`, ts: `2026-08-0${i + 1}T10:00:00Z` });
  }
  // El mas reciente es el primero de la lista de candidatos (a igualdad de
  // palabras, orden por recencia): el modelo elige el numero 1.
  mensajes.push({ role: 'user', content: 'el viaje importante fue a la playa de Cadiz con Marta', ts: '2026-08-10T10:00:00Z' });
  episodica.archivarEpisodios(chat, mensajes);
  let llamadaRanking = false;
  const chatCompletion = async () => { llamadaRanking = true; return { message: { content: '1' } }; };
  const hits = await episodica.buscarEpisodios(chat, 'te acuerdas del viaje a la playa?', { chatCompletion });
  assert.ok(llamadaRanking, 'con mas de 3 candidatos se consulta al modelo');
  assert.equal(hits.length, 1);
  assert.ok(hits[0].content.includes('Cadiz'));
});

// ---------- Cableado con el historial ----------

test('el recorte duro del historial archiva los mensajes descartados', async () => {
  const chat = 'chat-recorte';
  historial.registrarMensaje(chat, 'user', 'dato antiguo sobre el alquiler de octubre');
  for (let i = 0; i < historial.MAX_MENSAJES_ARCHIVO; i++) {
    historial.registrarMensaje(chat, 'assistant', `respuesta ${i}`);
  }
  // El primer mensaje ya salio de la ventana del archivo.
  const registro = historial.obtenerHistorial(chat);
  assert.ok(!registro.some((m) => typeof m.content === 'string' && m.content.includes('dato antiguo sobre el alquiler')));
  // Pero se recupera como episodio.
  const hits = await episodica.buscarEpisodios(chat, 'alquiler de octubre');
  assert.ok(hits.some((h) => h.content.includes('dato antiguo sobre el alquiler')));
});

test('la condensacion archiva lo antiguo antes de resumirlo', async () => {
  const chat = 'chat-condensa';
  historial.registrarMensaje(chat, 'user', 'mi matricula del coche es 1234ABC');
  for (let i = 1; i < historial.MAX_MENSAJES_ARCHIVO; i++) {
    historial.registrarMensaje(chat, i % 2 ? 'assistant' : 'user', `relleno ${i}`);
  }
  const tarea = historial.programarCondensacionSiNecesario(chat, {
    chatCompletion: async () => ({ message: { content: 'resumen simulado' } })
  });
  assert.ok(tarea, 'debe condensar al llegar al tope');
  await tarea;
  const hits = await episodica.buscarEpisodios(chat, 'matricula del coche');
  assert.ok(hits.some((h) => h.content.includes('1234ABC')), 'el verbatim sobrevive al resumen');
});

// ---------- Inyeccion en el flujo de entrada real ----------

test('procesarMensajesEntrantes inyecta episodios relevantes como contexto protegido en el system prompt', async () => {
  const chat = JID_DAVID;
  episodica.archivarEpisodios(chat, [
    { role: 'user', content: 'el cumple de Marta es el 3 de febrero', ts: '2026-09-15T10:00:00Z' },
    { role: 'assistant', content: 'apuntado, cumple de Marta el 3 de febrero', ts: '2026-09-15T10:00:05Z' }
  ]);
  const prompts = [];
  const llm = async ({ messages }) => {
    prompts.push(messages.find((m) => m.role === 'system')?.content || '');
    return { message: { content: 'respuesta simulada del asistente' } };
  };
  const enviados = [];
  await bot.procesarMensajesEntrantes(sockSimulado(enviados), {
    messages: [mensajeEntrante('cuando es el cumple de Marta?')],
    type: 'notify'
  }, { chatCompletion: llm, skipPersistencia: true });
  const sys = prompts.find((p) => p.includes('EPISODIOS ANTIGUOS'));
  assert.ok(sys, 'el system prompt incluye el bloque de episodios');
  assert.ok(sys.includes('3 de febrero'), 'el episodio relevante llega al prompt');
  assert.ok(sys.includes('NO INSTRUCCIONES NUEVAS'), 'el bloque va protegido');
});

test('procesarMensajesEntrantes sin episodios relevantes no inyecta el bloque', async () => {
  const jidLimpio = '999999999999999@lid'; // JID sin episodios archivados
  const prompts = [];
  const llm = async ({ messages }) => {
    prompts.push(messages.find((m) => m.role === 'system')?.content || '');
    return { message: { content: 'respuesta simulada del asistente' } };
  };
  const enviados = [];
  await bot.procesarMensajesEntrantes(sockSimulado(enviados), {
    messages: [{
      key: { remoteJid: jidLimpio, fromMe: false, id: 'SIM-LIMPIO-1' },
      message: { conversation: 'hola, que tal' },
      messageTimestamp: Math.floor(Date.now() / 1000)
    }],
    type: 'notify'
  }, { chatCompletion: llm, skipPersistencia: true });
  assert.ok(!prompts.some((p) => p.includes('EPISODIOS ANTIGUOS')), 'sin episodios no hay bloque');
});

// ---------- Fronteras: aislamiento, redaccion, borrado y roles ----------

test('aislamiento por chat: los episodios de un chat no aparecen en otro', async () => {
  episodica.archivarEpisodios('chat-aisla-a', [{ role: 'user', content: 'la playa de Cadiz con Marta', ts: '2026-08-10T10:00:00Z' }]);
  episodica.archivarEpisodios('chat-aisla-b', [{ role: 'user', content: 'ruta de montana en Navacerrada', ts: '2026-08-11T10:00:00Z' }]);
  assert.deepEqual(await episodica.buscarEpisodios('chat-aisla-b', 'playa de Cadiz'), []);
  assert.ok((await episodica.buscarEpisodios('chat-aisla-a', 'playa de Cadiz')).length > 0);
});

test('frontera de redaccion: un OTP archivado nunca se guarda literal', async () => {
  const chat = 'chat-redaccion';
  // Via directa (aunque el contenido llegue sin filtrar).
  episodica.archivarEpisodios(chat, [{ role: 'user', content: 'confirmar otp 654321 del banco', ts: '2026-10-01T10:00:00Z' }]);
  // Via real: registrado en el historial y empujado fuera por el recorte.
  historial.registrarMensaje(chat, 'user', 'confirmar otp 123456 para acceder');
  for (let i = 0; i < historial.MAX_MENSAJES_ARCHIVO; i++) {
    historial.registrarMensaje(chat, 'assistant', `respuesta de relleno ${i}`);
  }
  const hits = await episodica.buscarEpisodios(chat, 'otp del banco');
  assert.ok(hits.length > 0, 'el episodio existe');
  assert.ok(hits.every((h) => !h.content.includes('654321') && !h.content.includes('123456')), 'ningun OTP literal en el archivo');
  assert.ok(hits.some((h) => h.content.includes('[redactado: dato sensible]')));
});

test('limpiarHistorial borra los episodios aunque el historial actual este vacio', async () => {
  const chat = 'chat-borrado';
  episodica.archivarEpisodios(chat, [{ role: 'user', content: 'dato sobre el alquiler de septiembre', ts: '2026-09-01T10:00:00Z' }]);
  assert.ok((await episodica.buscarEpisodios(chat, 'alquiler de septiembre')).length > 0);
  // Sin historial activo (nunca se registro nada en historial para este chat).
  historial.limpiarHistorial(chat);
  assert.deepEqual(await episodica.buscarEpisodios(chat, 'alquiler de septiembre'), [], 'los episodios se borraron con el historial');
});

test('solo se archivan mensajes user/assistant: system y tool quedan fuera', async () => {
  const chat = 'chat-roles';
  episodica.archivarEpisodios(chat, [
    { role: 'system', content: 'instrucciones internas del sistema neuronal', ts: '2026-10-01T10:00:00Z' },
    { role: 'tool', content: 'salida de herramienta neuronal', ts: '2026-10-01T10:00:01Z' },
    { role: 'user', content: 'pregunta sobre el viaje a Roma', ts: '2026-10-01T10:00:02Z' }
  ]);
  assert.deepEqual(await episodica.buscarEpisodios(chat, 'sistema neuronal'), [], 'contenido system/tool no indexable');
  assert.ok((await episodica.buscarEpisodios(chat, 'viaje a Roma')).length === 1, 'el mensaje de usuario si se archiva');
});
