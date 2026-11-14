/**
 * devtools_entry.test.js
 * Pruebas de entrada del bloque 12 (devtools) por el flujo real del bot.
 *
 * Strict Policy: Zero Emojis.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'os';

const dirEntorno = fs.mkdtempSync(path.join(os.tmpdir(), 'davis-devtools-entry-'));
process.env.DAVIS_HISTORY_DIR = path.join(dirEntorno, 'history');
process.env.NODE_ENV = 'test';

const bot = await import('../../whatsappBot.js');
const { analizarIntencion } = await import('../../src/core/jarvisAgent.js');

const JID_DAVID = '123456789012345@lid';
const rutaIdeas = path.join(dirEntorno, 'ideas.json');

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

test('Router: "anota esta idea" solo encaja en devtools y trae las 6 herramientas', () => {
  const r = analizarIntencion('anota esta idea: modo lectura para notas');
  assert.deepEqual(r.intenciones, ['devtools']);
  const nombres = r.herramientas.map((h) => h.function.name);
  for (const h of ['anotar_idea', 'listar_ideas', 'priorizar_ideas', 'generar_changelog', 'guiar_depuracion', 'revisar_pr']) {
    assert.ok(nombres.includes(h), `falta ${h}`);
  }
});

test('Entrada real: anotar idea escribe el archivo y responde (no la captura de notas)', async () => {
  const enviados = [];
  const chatFalso = async ({ messages }) => {
    const ultimo = messages[messages.length - 1];
    if (ultimo.role === 'tool') return { message: { content: ultimo.content } };
    return { message: { content: '', tool_calls: [{ id: 'c1', function: { name: 'anotar_idea', arguments: { titulo: 'modo lectura para notas' } } }] } };
  };
  await bot.procesarMensajesEntrantes(sockSimulado(enviados), {
    type: 'notify',
    messages: [mensajeEntrante('anota esta idea: modo lectura para notas', 'DEV-1')]
  }, { chatCompletion: chatFalso, rutaArchivoIdeas: rutaIdeas });
  const texto = enviados[enviados.length - 1].payload.text;
  assert.match(texto, /Anotada, David/, 'confirmacion de JARVIS, no "Apuntado" de notas');
  const guardadas = JSON.parse(fs.readFileSync(rutaIdeas, 'utf8'));
  assert.equal(guardadas.length, 1);
  assert.equal(guardadas[0].titulo, 'modo lectura para notas');
  assert.equal(guardadas[0].prioridad, 'pendiente');
});

test('Entrada real: revisar PR lee via fetch inyectado y la resena llega por WhatsApp', async () => {
  const enviados = [];
  const urls = [];
  const fetchFalso = async (url, opts) => {
    urls.push(url);
    if (opts?.headers?.accept === 'application/vnd.github.v3.diff') return { ok: true, text: async () => 'diff --git a/x b/x\n+console.log(1);' };
    return { ok: true, text: async () => JSON.stringify({ number: 18, title: 'Compras', user: { login: 'David' }, state: 'open', changed_files: 9, additions: 500, deletions: 40, body: '', html_url: 'https://github.com/DCastellanos4/F.R.I.D.A.Y-bot/pull/18' }) };
  };
  const chatFalso = async ({ messages }) => {
    const ultimo = messages[messages.length - 1];
    if (ultimo.role === 'tool') return { message: { content: ultimo.content } };
    if (messages.some((m) => m.role === 'system' && /revisor de pull requests/i.test(m.content || ''))) return { message: { content: 'apto con comentarios: diff limpio.' } };
    return { message: { content: '', tool_calls: [{ id: 'c1', function: { name: 'revisar_pr', arguments: { numero: 18 } } }] } };
  };
  await bot.procesarMensajesEntrantes(sockSimulado(enviados), {
    type: 'notify',
    messages: [mensajeEntrante('revisa la PR 18', 'DEV-2')]
  }, { chatCompletion: chatFalso, fetchFnGitHub: fetchFalso });
  const texto = enviados[enviados.length - 1].payload.text;
  assert.match(texto, /Resena de PR #18/);
  assert.match(texto, /NO he publicado ningun comentario en GitHub/);
  assert.ok(urls.length >= 2 && urls.every((u) => u.includes('api.github.com')), 'lecturas a la API publica');
});
