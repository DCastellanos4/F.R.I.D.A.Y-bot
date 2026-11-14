/**
 * ops_entry.test.js
 * Pruebas de entrada del bloque 13 (ops del bot) por el flujo real.
 *
 * Strict Policy: Zero Emojis.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'os';

const dirEntorno = fs.mkdtempSync(path.join(os.tmpdir(), 'davis-ops-entry-'));
process.env.DAVIS_HISTORY_DIR = path.join(dirEntorno, 'history');
process.env.NODE_ENV = 'test';

const bot = await import('../../whatsappBot.js');
const { analizarIntencion } = await import('../../src/core/jarvisAgent.js');

const JID_DAVID = '123456789012345@lid';
const rutaConfigOps = path.join(dirEntorno, 'ops_config.json');
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

test('Router: "audita las dependencias" solo encaja en ops y trae las 7 herramientas', () => {
  const r = analizarIntencion('audita las dependencias');
  assert.deepEqual(r.intenciones, ['ops']);
  const nombres = r.herramientas.map((h) => h.function.name);
  for (const h of ['auditar_dependencias', 'configurar_vigilancia_dependencias', 'informe_metricas', 'configurar_informe_metricas', 'actividad_repos', 'configurar_alertas_repos', 'crear_backup_sesion']) {
    assert.ok(nombres.includes(h), `falta ${h}`);
  }
});

test('Entrada real: activar vigilancia SIN peticion textual se rechaza, CON ella se guarda', async () => {
  const enviados1 = [];
  await bot.procesarMensajesEntrantes(sockSimulado(enviados1), {
    type: 'notify',
    messages: [mensajeEntrante('ponme al dia de las vulnerabilidades de dependencias', 'OPS-1')]
  }, { chatCompletion: chatConHerramienta('configurar_vigilancia_dependencias', { activo: true }), rutaConfigOps, rutaArchivoMetricas: rutaMetricas });
  assert.match(enviados1[enviados1.length - 1].payload.text, /NO he activado|no lo pedia explicitamente/i, 'guard: el LLM no puede activarla por su cuenta');
  if (fs.existsSync(rutaConfigOps)) { assert.equal(JSON.parse(fs.readFileSync(rutaConfigOps, 'utf8')).vigilanciaDependencias?.activo ?? false, false, 'no se guardo activada'); }

  const enviados2 = [];
  await bot.procesarMensajesEntrantes(sockSimulado(enviados2), {
    type: 'notify',
    messages: [mensajeEntrante('activa la vigilancia de dependencias', 'OPS-2')]
  }, { chatCompletion: chatConHerramienta('configurar_vigilancia_dependencias', { activo: true }), rutaConfigOps, rutaArchivoMetricas: rutaMetricas });
  assert.match(enviados2[enviados2.length - 1].payload.text, /ACTIVADA/);
  assert.equal(JSON.parse(fs.readFileSync(rutaConfigOps, 'utf8')).vigilanciaDependencias.activo, true);
});

test('Entrada real: backup sin clave es config-required honesto, y las metricas registran la consulta', async () => {
  const enviados = [];
  const claveAntes = process.env.DAVIS_BACKUP_KEY;
  delete process.env.DAVIS_BACKUP_KEY;
  try {
    await bot.procesarMensajesEntrantes(sockSimulado(enviados), {
      type: 'notify',
      messages: [mensajeEntrante('haz backup de la sesion', 'OPS-3')]
    }, { chatCompletion: chatConHerramienta('crear_backup_sesion', {}), rutaConfigOps, rutaArchivoMetricas: rutaMetricas });
  } finally {
    if (claveAntes !== undefined) process.env.DAVIS_BACKUP_KEY = claveAntes;
  }
  const texto = enviados[enviados.length - 1].payload.text;
  assert.match(texto, /DAVIS_BACKUP_KEY/, 'declara la config requerida');
  assert.match(texto, /nunca por chat/);
  const metricas = fs.readFileSync(rutaMetricas, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.ok(metricas.some((m) => m.tipo === 'comando' && m.nombre === 'consulta_jarvis' && m.duracionMs >= 0), 'la consulta quedo medida');
});
