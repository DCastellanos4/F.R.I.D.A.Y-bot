/**
 * generative_honesty_entry.test.js
 * Regresion de dos fallos observados EN VIVO (6 nov 2026, post-fix 400):
 * 1. "generame una imagen de amor tamaño normal" acabo enrutada a
 *    consultar_estado_servidor: el regex de servidor casaba "ram" DENTRO de
 *    "generame" (substring sin fronteras). Ahora los tokens cortos (mc, ram,
 *    cpu) exigen frontera de palabra y las peticiones de contenido generativo
 *    (imagen/video/audio, NO implementado) se reconocen como intencion propia
 *    sin herramientas + directiva de capacidad honesta, en lugar de caer al
 *    safety net y desviarse a cualquier herramienta.
 * 2. "dime que cosas nuevas puedes hacer" (conversacional, 0 herramientas)
 *    improviso un catalogo de capacidades que el bot NO tiene (Docker, cloud,
 *    correo, Slack...). Ahora el system prompt lleva siempre el bloque
 *    CAPACIDADES REALES Y LIMITE HONESTO con la prohibicion explicita.
 *
 * Strict Policy: Zero Emojis.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'path';
import os from 'os';

const dirEntorno = fs.mkdtempSync(path.join(os.tmpdir(), 'davis-generativo-'));
process.env.DAVIS_HISTORY_DIR = path.join(dirEntorno, 'history');
process.env.NODE_ENV = 'test';

const bot = await import('../../whatsappBot.js');
const { analizarIntencion } = await import('../../src/core/jarvisAgent.js');

const JID_DAVID = '149868706304033@lid';
let secuencia = 0;

function sockSimulado(enviados) {
  return {
    user: { id: '34600000000:55@s.whatsapp.net', name: 'DAVIS' }, readMessages: async () => {},
    sendPresenceUpdate: async () => {},
    sendMessage: async (jid, payload) => { enviados.push({ jid, payload }); return { key: { id: 'SIM-' + enviados.length } }; }
  };
}

function mensajeEntrante(texto) {
  secuencia += 1;
  return {
    key: { remoteJid: JID_DAVID, fromMe: false, id: 'GEN-' + secuencia },
    message: { conversation: texto },
    messageTimestamp: Math.floor(Date.now() / 1000)
  };
}

/**
 * Conduce un mensaje real capturando las llamadas al modelo (prompts y
 * herramientas ofrecidas) y lo enviado a David. El chat falso responde texto
 * plano (sin tool_calls) y algo no parseable si le toca clasificar.
 */
async function entradaCapturando(texto, respuestaModelo) {
  const enviados = [];
  const llamadas = [];
  const chatFalso = async ({ messages, tools }) => {
    llamadas.push({ sistema: messages[0]?.content || '', tools: tools || [] });
    return { message: { content: respuestaModelo } };
  };
  await bot.procesarMensajesEntrantes(sockSimulado(enviados), {
    type: 'notify',
    messages: [mensajeEntrante(texto)]
  }, { chatCompletion: chatFalso });
  const llamadaDavis = llamadas.find(l => l.sistema.includes('Eres D.A.V.I.S.'));
  return { enviados, llamadas, llamadaDavis };
}

// ---------- Nivel router (el mensaje exacto del fallo en vivo) ----------

test('el mensaje real del fallo ya no enruta a consultar_estado_servidor', () => {
  const r = analizarIntencion('generame una imagen de amor tamaño normal');
  assert.ok(r.intenciones.includes('generativo'), JSON.stringify(r.intenciones));
  assert.ok(!r.intenciones.includes('servidor'));
  assert.equal(r.safetyNet, false);
  assert.equal(r.herramientas.length, 0);
});

test('fronteras de palabra: "ram" suelta sigue enrutando al servidor', () => {
  const r = analizarIntencion('cuanta ram tiene el servidor');
  assert.ok(r.intenciones.includes('servidor'));
  assert.ok(r.herramientas.some(h => h.function.name === 'consultar_estado_servidor'));
});

test('"genera una contraseña" sigue siendo crypto, no generativo', () => {
  const r = analizarIntencion('genera una contraseña segura');
  assert.ok(!r.intenciones.includes('generativo'));
  assert.ok(r.herramientas.some(h => h.function.name === 'generate_crypto_credential'));
});

test('otras formas generativas se reconocen sin herramientas', () => {
  for (const m of ['hazme un dibujo de un gato', 'creame un logo', 'genera un video de broma']) {
    const r = analizarIntencion(m);
    assert.ok(r.intenciones.includes('generativo'), m);
    assert.equal(r.herramientas.length, 0, m);
  }
});

// ---------- Nivel entrada real ----------

test('peticion de imagen: 0 herramientas ofrecidas, directiva de capacidad y respuesta no vacia', async () => {
  const { enviados, llamadaDavis } = await entradaCapturando(
    'generame una imagen de amor tamaño normal',
    'No puedo generar imagenes, David: no tengo esa capacidad implementada.'
  );
  assert.ok(llamadaDavis, 'debe llegar al prompt de D.A.V.I.S.');
  assert.equal(llamadaDavis.tools.length, 0, 'no se ofrece ninguna herramienta');
  assert.ok(llamadaDavis.sistema.includes('DIRECTIVA DE CAPACIDAD'), 'lleva la directiva de no-generacion');
  assert.ok(llamadaDavis.sistema.includes('no esta implementada'));
  assert.equal(enviados.length, 1, 'responde (anti-silencio)');
  const texto = enviados[0].payload.text || '';
  assert.ok(texto.length > 0);
});

test('pregunta de capacidades: el prompt ancla las reales y prohibe inventar', async () => {
  const { enviados, llamadaDavis } = await entradaCapturando(
    'dime que cosas nuevas puedes hacer',
    'Puedo ayudarte con recordatorios, transporte de Madrid, compras, estudio y mas: te lo detallo solo con lo que tengo implementado.'
  );
  assert.ok(llamadaDavis, 'debe llegar al prompt de D.A.V.I.S.');
  assert.ok(llamadaDavis.sistema.includes('CAPACIDADES REALES Y LIMITE HONESTO'), 'lleva el ancla de capacidades');
  assert.ok(llamadaDavis.sistema.includes('PROHIBIDO atribuirte capacidades no implementadas'));
  assert.ok(llamadaDavis.sistema.includes('transporte publico de Madrid'));
  assert.equal(enviados.length, 1, 'responde (anti-silencio)');
});
