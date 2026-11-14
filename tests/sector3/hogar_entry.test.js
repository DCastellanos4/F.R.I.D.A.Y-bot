/**
 * hogar_entry.test.js
 * Pruebas de entrada del bloque 14 (hogar) por el flujo real de WhatsApp.
 * Sin acciones live: WoL sin MAC es config-required antes de cualquier
 * paquete; la vigilancia exige opt-in textual; el listado usa deps falsas.
 *
 * Strict Policy: Zero Emojis.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'os';

const dirEntorno = fs.mkdtempSync(path.join(os.tmpdir(), 'davis-hogar-entry-'));
process.env.DAVIS_HISTORY_DIR = path.join(dirEntorno, 'history');
process.env.NODE_ENV = 'test';

const bot = await import('../../whatsappBot.js');
const { analizarIntencion } = await import('../../src/core/jarvisAgent.js');

const JID_DAVID = '123456789012345@lid';
const rutaConfigHogar = path.join(dirEntorno, 'hogar_config.json');
const rutaMetricas = path.join(dirEntorno, 'metricas.jsonl');

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

function chatConHerramienta(nombre, argumentos = {}) {
  return async ({ messages }) => {
    const ultimo = messages[messages.length - 1];
    if (ultimo.role === 'tool') return { message: { content: ultimo.content } };
    return { message: { content: '', tool_calls: [{ id: 'c1', function: { name: nombre, arguments: argumentos } } ] } };
  };
}

test('Router: frases de hogar solo encajan en hogar y traen sus 7 herramientas', () => {
  const r = analizarIntencion('quien esta conectado a mi red');
  assert.deepEqual(r.intenciones, ['hogar']);
  const nombres = r.herramientas.map((h) => h.function.name);
  for (const h of ['listar_dispositivos_red', 'configurar_vigilancia_red']) {
    assert.ok(nombres.includes(h), `falta ${h}`);
  }
  const r2 = analizarIntencion('cuanto me cuesta el oracle este mes');
  assert.deepEqual(r2.intenciones, ['hogar']);
});

test('Entrada real: encender el PC sin MAC configurada es config-required (cero paquetes)', async () => {
  const macAntes = process.env.DAVIS_WOL_MAC;
  delete process.env.DAVIS_WOL_MAC;
  const enviados = [];
  try {
    await bot.procesarMensajesEntrantes(sockSimulado(enviados), {
      type: 'notify',
      messages: [mensajeEntrante('enciende el pc de casa', 'HOGAR-1')]
    }, { chatCompletion: chatConHerramienta('encender_pc', {}), rutaConfigHogar, rutaArchivoMetricas: rutaMetricas });
  } finally {
    if (macAntes !== undefined) process.env.DAVIS_WOL_MAC = macAntes;
  }
  const texto = enviados[enviados.length - 1].payload.text;
  assert.match(texto, /DAVIS_WOL_MAC/);
  assert.match(texto, /no por chat/);
});

test('Entrada real: vigilancia de red rechazada sin peticion textual, guardada con ella', async () => {
  const enviados1 = [];
  await bot.procesarMensajesEntrantes(sockSimulado(enviados1), {
    type: 'notify',
    messages: [mensajeEntrante('cuentame cosas de la vigilancia de mi red', 'HOGAR-2')]
  }, { chatCompletion: chatConHerramienta('configurar_vigilancia_red', { activo: true }), rutaConfigHogar, rutaArchivoMetricas: rutaMetricas });
  assert.match(enviados1[enviados1.length - 1].payload.text, /no lo pedia explicitamente/i);
  if (fs.existsSync(rutaConfigHogar)) {
    assert.equal(JSON.parse(fs.readFileSync(rutaConfigHogar, 'utf8')).vigilanciaRed?.activo ?? false, false, 'no se guardo activada');
  }

  const enviados2 = [];
  await bot.procesarMensajesEntrantes(sockSimulado(enviados2), {
    type: 'notify',
    messages: [mensajeEntrante('activa la vigilancia de mi red', 'HOGAR-3')]
  }, { chatCompletion: chatConHerramienta('configurar_vigilancia_red', { activo: true, conocidos: ['aa:aa:aa:aa:aa:aa'] }), rutaConfigHogar, rutaArchivoMetricas: rutaMetricas });
  assert.match(enviados2[enviados2.length - 1].payload.text, /ACTIVADA/);
  assert.equal(JSON.parse(fs.readFileSync(rutaConfigHogar, 'utf8')).vigilanciaRed.activo, true);
});

test('Entrada real: domotica sin Home Assistant configurado es config-required honesta', async () => {
  const urlAntes = process.env.DAVIS_HA_URL;
  const tokAntes = process.env.DAVIS_HA_TOKEN;
  delete process.env.DAVIS_HA_URL;
  delete process.env.DAVIS_HA_TOKEN;
  const enviados = [];
  try {
    await bot.procesarMensajesEntrantes(sockSimulado(enviados), {
      type: 'notify',
      messages: [mensajeEntrante('enciende la luz del salon con la domotica', 'HOGAR-4')]
    }, { chatCompletion: chatConHerramienta('controlar_domotica', { entidad: 'light.salon', accion: 'encender' }), rutaConfigHogar, rutaArchivoMetricas: rutaMetricas });
  } finally {
    if (urlAntes !== undefined) process.env.DAVIS_HA_URL = urlAntes;
    if (tokAntes !== undefined) process.env.DAVIS_HA_TOKEN = tokAntes;
  }
  const texto = enviados[enviados.length - 1].payload.text;
  assert.match(texto, /DAVIS_HA_URL/);
  assert.match(texto, /nunca por chat/);
});
