/**
 * career_entry.test.js
 * Prueba de cableado real (entrada por procesarMensajesEntrantes) del bloque
 * empleo: sin este test, los servicios de candidaturas y radar podrian
 * existir y pasar sus pruebas unitarias sin estar conectados al agente.
 * Verifica:
 *   1. El mensaje alcanza a Jarvis y dispara la herramienta (via LLM simulado).
 *   2. El efecto de estado ocurre en el almacenamiento inyectado (temporal).
 *   3. Las respuestas salen por el socket.
 *   4. El radar usa los deps inyectados (sin red real).
 *
 * Strict Policy: Zero Emojis.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'path';
import os from 'os';

const dirEntorno = fs.mkdtempSync(path.join(os.tmpdir(), 'davis-career-entry-'));
process.env.DAVIS_HISTORY_DIR = path.join(dirEntorno, 'history');
process.env.NODE_ENV = 'test';

const bot = await import('../../whatsappBot.js');

// JID LID de David: via real de sus mensajes directos (esMensajeDeDavid lo
// acepta y no cae en la captura de notas del self-chat)
const JID_DAVID = '149868706304033@lid';

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

/** LLM falso: el clasificador de intenciones recibe la misma funcion y cae
 *  en la red de seguridad por regex al no devolver JSON; el chat principal
 *  emite la tool_call pedida y responde texto al cerrar la ronda. */
function crearChatFalso(toolName, toolArgs, llamadas) {
  return async ({ messages, tools }) => {
    llamadas.push({ tools: tools ? tools.length : 0, roles: messages.map((m) => m.role) });
    const ultimo = messages[messages.length - 1];
    if (ultimo.role === 'tool') {
      return { message: { content: 'Hecho, senor.' } };
    }
    return {
      message: {
        content: '',
        tool_calls: [{ id: 'call-1', function: { name: toolName, arguments: toolArgs } }]
      }
    };
  };
}

test('Entrada real: registrar_candidatura persiste en almacenamiento inyectado y responde', async () => {
  const rutaArchivo = path.join(dirEntorno, 'applications.json');
  const enviados = [];
  const llamadas = [];

  await bot.procesarMensajesEntrantes(sockSimulado(enviados), {
    type: 'notify',
    messages: [mensajeEntrante('registra candidatura: full stack en Acme', 'CAREER-1')]
  }, {
    chatCompletion: crearChatFalso('registrar_candidatura', { empresa: 'Acme', puesto: 'Full Stack' }, llamadas),
    rutaArchivoCandidaturas: rutaArchivo
  });

  assert.ok(enviados.length > 0, 'el handler respondio al mensaje entrante');
  assert.equal(enviados[enviados.length - 1].payload.text, 'Hecho, senor.');

  const guardadas = JSON.parse(fs.readFileSync(rutaArchivo, 'utf-8'));
  assert.equal(guardadas.length, 1, 'la candidatura quedo persistida');
  assert.equal(guardadas[0].empresa, 'Acme');
  assert.equal(guardadas[0].puesto, 'Full Stack');

  assert.ok(llamadas.some((l) => l.tools > 0), 'Jarvis recibio el catalogo de herramientas');
  assert.ok(llamadas.some((l) => l.roles.includes('tool')), 'el resultado de la herramienta volvio al LLM');
});

test('Entrada real: escanear_ofertas_empleo usa deps del radar inyectados (sin red)', async () => {
  const enviados = [];
  const llamadas = [];
  const alertas = [];

  const rutaConfig = path.join(dirEntorno, 'radar.json');
  fs.writeFileSync(rutaConfig, JSON.stringify({
    activo: true,
    palabrasClave: ['full stack'],
    fuentes: [{
      id: 'portal-pruebas',
      tipo: 'html-generico',
      enabled: true,
      url: 'https://portal.example/jobs',
      selectores: { item: '.oferta', titulo: '.tit', enlace: '.lnk', empresa: '.emp' }
    }]
  }), 'utf-8');

  const radarDeps = {
    rutaConfig,
    rutaVistos: path.join(dirEntorno, 'radar_seen.json'),
    fetchHtml: async () => `<div class="oferta"><h2 class="tit">Junior DevOps</h2><a class="lnk" href="https://portal.example/jobs/55">Ver</a><span class="emp">Initech</span></div>`,
    enqueue: (a) => alertas.push(a)
  };

  await bot.procesarMensajesEntrantes(sockSimulado(enviados), {
    type: 'notify',
    messages: [mensajeEntrante('busca ofertas de empleo nuevas', 'CAREER-2')]
  }, {
    chatCompletion: crearChatFalso('escanear_ofertas_empleo', {}, llamadas),
    radarDeps
  });

  assert.ok(enviados.length > 0);
  assert.equal(alertas.length, 1, 'la oferta nueva se encolo como alerta');
  assert.match(alertas[0].title, /Junior DevOps/);
  assert.match(alertas[0].details, /Initech/);
});

test('Seleccion de herramientas: un mensaje de empleo ofrece el catalogo del bloque al LLM', async () => {
  const { consultarJarvis } = await import('../../src/core/jarvisAgent.js');
  let toolsOfrecidas = [];
  const chatFalso = async ({ tools }) => {
    if (tools && tools.length > 0) toolsOfrecidas = tools.map((t) => t.function.name);
    return { message: { content: 'Sin herramientas necesarias.' } };
  };
  await consultarJarvis('busca ofertas de empleo nuevas', [], { chatCompletion: chatFalso });
  for (const nombre of ['registrar_candidatura', 'listar_candidaturas', 'actualizar_candidatura', 'escanear_ofertas_empleo', 'configurar_radar_ofertas']) {
    assert.ok(toolsOfrecidas.includes(nombre), `falta ${nombre} en el catalogo ofrecido`);
  }
});
