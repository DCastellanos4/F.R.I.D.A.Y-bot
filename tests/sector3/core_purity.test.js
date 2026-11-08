/**
 * core_purity.test.js - Regresion de pureza del hexagono.
 *
 * Falla si el dominio (src/core) vuelve a acoplarse a un canal concreto
 * o si los puertos importan adaptadores (la dependencia solo puede
 * apuntar hacia dentro: adaptadores -> puertos -> core).
 *
 * Strict Policy: Zero Emojis.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { PROJECT_ROOT } from '../../src/config/paths.js';

const CORE_DIR = path.join(PROJECT_ROOT, 'src', 'core');
const PORTS_DIR = path.join(PROJECT_ROOT, 'src', 'ports');

function archivosJs(dir) {
  return fs.readdirSync(dir).filter(f => f.endsWith('.js')).map(f => path.join(dir, f));
}

test('src/core no importa Baileys ni el bot de WhatsApp', () => {
  for (const archivo of archivosJs(CORE_DIR)) {
    const contenido = fs.readFileSync(archivo, 'utf8');
    assert.ok(!contenido.includes('@whiskeysockets'), `${path.basename(archivo)} importa Baileys`);
    assert.ok(!/whatsappBot/.test(contenido), `${path.basename(archivo)} referencia whatsappBot`);
    assert.ok(!/sock\.sendMessage/.test(contenido), `${path.basename(archivo)} llama a sock.sendMessage`);
  }
});

test('los puertos no importan adaptadores ni servicios (dependencia hacia dentro)', () => {
  const importsProhibidos = /from\s+['"][^'"]*(adapters|services|whatsappBot)[^'"]*['"]/;
  for (const archivo of archivosJs(path.join(PORTS_DIR, 'inbound')).concat(archivosJs(path.join(PORTS_DIR, 'outbound')))) {
    const contenido = fs.readFileSync(archivo, 'utf8');
    assert.ok(!importsProhibidos.test(contenido), `${path.basename(archivo)} importa infraestructura`);
  }
});

test('el canal CLI funcional entra por el mismo puerto que WhatsApp', async () => {
  // chat.js (canal CLI real) ya no importa el cerebro directamente.
  const chatJs = fs.readFileSync(path.join(PROJECT_ROOT, 'chat.js'), 'utf8');
  assert.ok(!/from\s+['"]\.\/src\/core\/jarvisAgent\.js['"]/.test(chatJs), 'chat.js importa el agente directamente');
  assert.ok(chatJs.includes("channel: 'cli'"), 'chat.js no construye su InboundMessage cli');
});
