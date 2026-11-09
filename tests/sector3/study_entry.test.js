/**
 * study_entry.test.js
 * Prueba de cableado real del bloque estudio (planificador nº 5 y flashcards
 * nº 6) por la entrada real de WhatsApp (procesarMensajesEntrantes) con
 * socket y LLM simulados. Sin este test, los servicios podrian pasar sus
 * pruebas unitarias sin estar conectados al agente.
 *
 * Strict Policy: Zero Emojis.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'path';
import os from 'os';

const dirEntorno = fs.mkdtempSync(path.join(os.tmpdir(), 'davis-study-entry-'));
process.env.DAVIS_HISTORY_DIR = path.join(dirEntorno, 'history');
process.env.NODE_ENV = 'test';

const bot = await import('../../whatsappBot.js');

const JID_DAVID = '149868706304033@lid';

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

function crearChatFalso(toolName, toolArgs, captura = {}) {
  return async ({ messages, tools }) => {
    if (tools && tools.length > 0) captura.tools = tools.map((t) => t.function.name);
    const ultimo = messages[messages.length - 1];
    if (ultimo.role === 'tool') {
      captura.resultadoHerramienta = ultimo.content;
      return { message: { content: 'Hecho, David.' } };
    }
    return {
      message: {
        content: '',
        tool_calls: [{ id: 'call-1', function: { name: toolName, arguments: toolArgs } }]
      }
    };
  };
}

test('Entrada real: planificar_estudio persiste el plan y crea recordatorios via inyeccion', async () => {
  const enviados = [];
  const recordatorios = [];
  const captura = {};
  const rutaPlanes = path.join(dirEntorno, 'plans.json');

  await bot.procesarMensajesEntrantes(sockSimulado(enviados), {
    type: 'notify',
    messages: [mensajeEntrante('hazme un plan de estudio para el examen de redes', 'STUDY-1')]
  }, {
    chatCompletion: crearChatFalso('planificar_estudio', {
      asignatura: 'Redes',
      fechaExamen: '2026-11-20',
      temas: ['TCP', 'UDP', 'DNS'],
      horaEstudio: '17:30'
    }, captura),
    rutaPlanesEstudio: rutaPlanes,
    crearRecordatorioEstudio: (r) => { recordatorios.push(r); return { ok: true }; }
  });

  assert.ok(enviados.length > 0, 'el handler respondio');
  const planes = JSON.parse(fs.readFileSync(rutaPlanes, 'utf-8'));
  assert.equal(planes.length, 1, 'plan persistido');
  assert.equal(planes[0].asignatura, 'Redes');
  assert.equal(planes[0].fechaExamen, '2026-11-20');
  assert.ok(recordatorios.length >= 1, 'recordatorios creados por la via inyectada');
  assert.ok(captura.resultadoHerramienta.includes('Plan de estudio creado'), 'respuesta del ejecutor llega al LLM');
});

test('Entrada real: crear_flashcard persiste y responder_flashcard actualiza el repaso', async () => {
  const enviados = [];
  const captura = {};
  const rutaFlash = path.join(dirEntorno, 'flash.json');

  await bot.procesarMensajesEntrantes(sockSimulado(enviados), {
    type: 'notify',
    messages: [mensajeEntrante('crea una flashcard de redes', 'STUDY-2')]
  }, {
    chatCompletion: crearChatFalso('crear_flashcard', {
      asignatura: 'Redes',
      pregunta: 'Que es DNS?',
      respuesta: 'Sistema de resolucion de nombres'
    }, captura),
    rutaArchivoFlashcards: rutaFlash
  });

  assert.ok(enviados.length > 0);
  const tarjetas = JSON.parse(fs.readFileSync(rutaFlash, 'utf-8'));
  assert.equal(tarjetas.length, 1, 'tarjeta persistida');
  assert.equal(tarjetas[0].pregunta, 'Que es DNS?');

  // Responder la tarjeta por la misma via real
  const captura2 = {};
  await bot.procesarMensajesEntrantes(sockSimulado(enviados), {
    type: 'notify',
    messages: [mensajeEntrante('respuesta flashcard bien', 'STUDY-3')]
  }, {
    chatCompletion: crearChatFalso('responder_flashcard', { id: tarjetas[0].id, calidad: 4 }, captura2),
    rutaArchivoFlashcards: rutaFlash
  });
  const actualizada = JSON.parse(fs.readFileSync(rutaFlash, 'utf-8'));
  assert.equal(actualizada[0].repaso.aciertos, 1);
  assert.equal(actualizada[0].repaso.intervaloDias, 1, 'acierto espacia el repaso');
  assert.ok(captura2.resultadoHerramienta.includes('Anotado'), 'confirmacion del ejecutor');
});

test('Rondas de repaso: activacion solo por peticion explicita de David', async () => {
  const { consultarJarvisAislado: consultarJarvis } = await import('../helpers/jarvisAislado.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'davis-repaso-'));
  const depsFlash = {
    rutaArchivoFlashcards: path.join(dir, 'flash.json'),
    rutaConfigFlashcards: path.join(dir, 'flash_config.json')
  };
  const leerActivo = () => {
    try { return JSON.parse(fs.readFileSync(depsFlash.rutaConfigFlashcards, 'utf-8')).activo; }
    catch { return undefined; }
  };
  const chatCon = (id) => async ({ messages }) => {
    const ultimo = messages[messages.length - 1];
    if (ultimo.role === 'tool') return { message: { content: 'Cerrado.' } };
    return { message: { content: '', tool_calls: [{ id, function: { name: 'configurar_repaso_flashcards', arguments: { activo: true, cadenciaHoras: 6 } } }] } };
  };

  // El modelo pide activo:true sin que David lo pidiera: no se activa
  await consultarJarvis('configura el repaso con cadencia de 6 horas', [], { chatCompletion: chatCon('r1'), ...depsFlash });
  assert.notEqual(leerActivo(), true, 'sin peticion explicita no se activa el repaso proactivo');
  assert.equal(JSON.parse(fs.readFileSync(depsFlash.rutaConfigFlashcards, 'utf-8')).cadenciaHoras, 6, 'el resto de la config si se guarda');

  // David lo pide claramente: se activa
  await consultarJarvis('activa el repaso de flashcards', [], { chatCompletion: chatCon('r2'), ...depsFlash });
  assert.equal(leerActivo(), true);
});

test('Router: un mensaje de estudio selecciona el catalogo del bloque sin safety net', async () => {
  const { analizarIntencion } = await import('../../src/core/jarvisAgent.js');
  const ruta = analizarIntencion('hazme un plan de estudio para el examen');
  assert.equal(ruta.safetyNet, false, 'la intencion estudio existe, no cae en safety net');
  assert.ok(ruta.intenciones.includes('estudio'));
  const nombres = ruta.herramientas.map((t) => t.function.name);
  for (const nombre of ['planificar_estudio', 'listar_planes_estudio', 'registrar_avance_estudio', 'programar_recordatorios_estudio', 'crear_flashcard', 'repasar_flashcards', 'responder_flashcard', 'configurar_repaso_flashcards']) {
    assert.ok(nombres.includes(nombre), `falta ${nombre} en el catalogo del router`);
  }
});
