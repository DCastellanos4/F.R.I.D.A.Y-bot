/**
 * voice_entry.test.js
 * Flujo de entrada de notas de voz: audioMessage -> transcripcion ->
 * pipeline normal, con transcripcion y descarga inyectadas (sin tocar la
 * red de WhatsApp ni Whisper). Cubre: exito, transcripcion fallida,
 * transcripcion vacia y guardia de acciones criticas dictadas por voz.
 * La verificacion de la transcripcion REAL con Whisper va aparte
 * (servidor, audio real); esto prueba el cableado del bot.
 *
 * Strict Policy: Zero Emojis.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const dirEntorno = fs.mkdtempSync(path.join(os.tmpdir(), 'davis-voz-'));
process.env.NODE_ENV = 'test';
process.env.DAVIS_HISTORY_DIR = path.join(dirEntorno, 'history');

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

function notaVoz(id, segundos = 3) {
  return {
    key: { remoteJid: JID_DAVID, fromMe: false, id },
    message: { audioMessage: { seconds: segundos, mimetype: 'audio/ogg; codecs=opus' } },
    messageTimestamp: Math.floor(Date.now() / 1000)
  };
}

const descargarMediaSimulada = async () => Buffer.from('audio-simulado');

test('Entrada voz: nota transcrita se procesa como peticion normal', async () => {
  const enviados = [];
  let llamadasLlm = 0;
  const chatSimulado = async ({ messages }) => {
    llamadasLlm++;
    const ultimo = messages[messages.length - 1];
    if (ultimo.role === 'tool') return { message: { content: 'Soleado y 22 grados.' } };
    return { message: { content: '', tool_calls: [{ id: 'v1', function: { name: 'consultar_clima', arguments: { ubicacion: 'Madrid' } } }] } };
  };
  let audioRecibido = null;
  await bot.procesarMensajesEntrantes(sockSimulado(enviados), {
    type: 'notify',
    messages: [notaVoz('VOZ-1')]
  }, {
    chatCompletion: chatSimulado,
    carpetaTrazas,
    descargarMedia: descargarMediaSimulada,
    transcribirAudio: async (buf) => { audioRecibido = buf; return { ok: true, texto: 'que tiempo hace en madrid?' }; },
    // TTS fuera del alcance (depende de edge-tts/red del host): se fuerza el
    // fallback a texto para que el cableado del pipeline sea determinista.
    sintetizarVoz: async () => { throw new Error('TTS deshabilitado en test'); }
  });
  assert.ok(audioRecibido?.equals(Buffer.from('audio-simulado')), 'el buffer descargado llego al transcriptor');
  assert.ok(llamadasLlm >= 1, 'la transcripcion llego al agente');
  const texto = enviados[enviados.length - 1].payload.text;
  assert.match(texto, /Soleado/, 'respuesta del pipeline normal');
});

test('Entrada voz: transcripcion fallida responde honesto sin llamar al modelo', async () => {
  const enviados = [];
  let llamadasLlm = 0;
  await bot.procesarMensajesEntrantes(sockSimulado(enviados), {
    type: 'notify',
    messages: [notaVoz('VOZ-2')]
  }, {
    chatCompletion: async () => { llamadasLlm++; return { message: { content: 'no debia llamarse' } }; },
    carpetaTrazas,
    descargarMedia: descargarMediaSimulada,
    transcribirAudio: async () => ({ ok: false, error: 'whisper no disponible' })
  });
  assert.equal(llamadasLlm, 0, 'sin transcripcion no se consulta al modelo');
  const texto = enviados[enviados.length - 1].payload.text;
  assert.match(texto, /no he podido transcribirla/i);
});

test('Entrada voz: transcripcion vacia o de un caracter se trata como ilegible', async () => {
  const enviados = [];
  let llamadasLlm = 0;
  await bot.procesarMensajesEntrantes(sockSimulado(enviados), {
    type: 'notify',
    messages: [notaVoz('VOZ-3')]
  }, {
    chatCompletion: async () => { llamadasLlm++; return { message: { content: 'no debia llamarse' } }; },
    carpetaTrazas,
    descargarMedia: descargarMediaSimulada,
    transcribirAudio: async () => ({ ok: true, texto: 'a' })
  });
  assert.equal(llamadasLlm, 0);
  assert.match(enviados[enviados.length - 1].payload.text, /no he podido transcribirla/i);
});

test('Entrada voz: accion critica dictada por voz exige confirmacion previa', async () => {
  const enviados = [];
  let llamadasLlm = 0;
  await bot.procesarMensajesEntrantes(sockSimulado(enviados), {
    type: 'notify',
    messages: [notaVoz('VOZ-4')]
  }, {
    chatCompletion: async () => { llamadasLlm++; return { message: { content: 'no debia llamarse' } }; },
    carpetaTrazas,
    descargarMedia: descargarMediaSimulada,
    transcribirAudio: async () => ({ ok: true, texto: 'enviale un mensaje a marta diciendo que llego tarde' })
  });
  assert.equal(llamadasLlm, 0, 'accion critica por voz no llega al modelo sin confirmar');
  const texto = enviados[enviados.length - 1].payload.text;
  assert.match(texto, /confirme respondiendo/i);
});

test('Entrada voz: "si" tras la guardia procesa la peticion original confirmada', async () => {
  const enviados = [];
  let llamadasLlm = 0;
  const chatSimulado = async ({ messages }) => {
    llamadasLlm++;
    const ultimo = messages[messages.length - 1];
    if (ultimo.role === 'tool') return { message: { content: 'Mensaje programado para Marta.' } };
    return { message: { content: '', tool_calls: [{ id: 'v5', function: { name: 'programar_mensaje_whatsapp', arguments: { contacto: 'marta' } } }] } };
  };
  const transcribir = async () => ({ ok: true, texto: 'enviale un mensaje a marta diciendo que llego tarde' });
  await bot.procesarMensajesEntrantes(sockSimulado(enviados), {
    type: 'notify',
    messages: [notaVoz('VOZ-5')]
  }, { chatCompletion: chatSimulado, carpetaTrazas, descargarMedia: descargarMediaSimulada, transcribirAudio: transcribir });
  assert.match(enviados[enviados.length - 1].payload.text, /confirme respondiendo/i);
  assert.equal(llamadasLlm, 0);

  await bot.procesarMensajesEntrantes(sockSimulado(enviados), {
    type: 'notify',
    messages: [{
      key: { remoteJid: JID_DAVID, fromMe: false, id: 'VOZ-6' },
      message: { conversation: 'si' },
      messageTimestamp: Math.floor(Date.now() / 1000)
    }]
  }, { chatCompletion: chatSimulado, carpetaTrazas, descargarMedia: descargarMediaSimulada, transcribirAudio: transcribir });
  assert.ok(llamadasLlm >= 1, 'tras confirmar, la peticion original se procesa');
  assert.match(enviados[enviados.length - 1].payload.text, /Marta/);
});

test('Entrada voz: una accion critica tras otra critica NO se salta la confirmacion (regresion)', async () => {
  const enviados = [];
  let llamadasLlm = 0;
  const chatSimulado = async () => { llamadasLlm++; return { message: { content: 'no debia ejecutarse sin confirmar' } }; };
  const deps = {
    chatCompletion: chatSimulado,
    carpetaTrazas,
    descargarMedia: descargarMediaSimulada
  };
  // Primera accion critica: queda pendiente de confirmacion.
  await bot.procesarMensajesEntrantes(sockSimulado(enviados), {
    type: 'notify',
    messages: [notaVoz('VOZ-10')]
  }, { ...deps, transcribirAudio: async () => ({ ok: true, texto: 'enviale un mensaje a marta diciendo que llego tarde' }) });
  assert.match(enviados[enviados.length - 1].payload.text, /confirme respondiendo/i);
  // Segunda accion critica distinta: antes se ejecutaba SIN confirmar
  // (resolverConfirmacionVoz devolvia 'nuevo' y se procesaba directamente).
  await bot.procesarMensajesEntrantes(sockSimulado(enviados), {
    type: 'notify',
    messages: [notaVoz('VOZ-11')]
  }, { ...deps, transcribirAudio: async () => ({ ok: true, texto: 'borra de la memoria la clave del garaje' }) });
  assert.match(enviados[enviados.length - 1].payload.text, /confirme respondiendo/i);
  assert.equal(llamadasLlm, 0, 'ninguna de las dos acciones criticas llego al modelo sin confirmar');
});
