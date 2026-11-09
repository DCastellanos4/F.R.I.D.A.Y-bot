/**
 * hexagonal_ports.test.js - Contratos de la arquitectura hexagonal.
 *
 * Demuestran que:
 * 1. InboundMessage valida el contrato minimo { userId, text, channel }.
 * 2. El adaptador de WhatsApp traduce el formato Baileys al puerto.
 * 3. Un canal NUEVO (telegram, sin codigo de WhatsApp) llega al core con
 *    un solo adaptador: el procesador inyecta los puertos de salida.
 * 4. El core usa el MemoryRepositoryPort inyectado para las herramientas
 *    de memoria (guardar/buscar/listar/olvidar) sin tocar el JSON real.
 * 5. El contenedor por defecto cablea los adaptadores historicos.
 *
 * Strict Policy: Zero Emojis.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { crearInboundMessage } from '../../src/ports/inbound/InboundMessage.js';
import { afirmarLLMProvider } from '../../src/ports/outbound/LLMProviderPort.js';
import { afirmarMemoryRepository } from '../../src/ports/outbound/MemoryRepositoryPort.js';
import { afirmarMessageChannel } from '../../src/ports/outbound/MessageChannelPort.js';
import { crearInboundDesdeWhatsApp } from '../../src/adapters/inbound/whatsapp/whatsappInboundAdapter.js';
import { crearWhatsAppChannelAdapter } from '../../src/adapters/outbound/channels/whatsappChannelAdapter.js';
import { crearMessageProcessor } from '../../src/core/messageProcessor.js';
import { crearContenedor } from '../../src/composition/container.js';

test('InboundMessage exige userId, text y channel', () => {
  assert.throws(() => crearInboundMessage({ text: 'hola', channel: 'web' }), /userId/);
  assert.throws(() => crearInboundMessage({ userId: 'u1', channel: 'web' }), /text/);
  assert.throws(() => crearInboundMessage({ userId: 'u1', text: 'hola' }), /channel/);
  const msg = crearInboundMessage({ userId: ' u1 ', text: 'hola', channel: ' Web ' });
  assert.equal(msg.userId, 'u1');
  assert.equal(msg.channel, 'web');
  assert.ok(msg.timestamp instanceof Date);
  assert.ok(Object.isFrozen(msg));
});

test('el adaptador de WhatsApp traduce Baileys a InboundMessage', () => {
  const msgBaileys = {
    key: { id: 'ABCD1234', fromMe: false },
    messageTimestamp: 1762531200,
    pushName: 'David'
  };
  const inbound = crearInboundDesdeWhatsApp({ msg: msgBaileys, texto: 'que tengo hoy?', remoteJid: '34600000000@s.whatsapp.net' });
  assert.equal(inbound.channel, 'whatsapp');
  assert.equal(inbound.userId, '34600000000@s.whatsapp.net');
  assert.equal(inbound.text, 'que tengo hoy?');
  assert.equal(inbound.messageId, 'ABCD1234');
  assert.equal(inbound.metadata.pushName, 'David');
  assert.equal(inbound.metadata.isGroup, false);
  assert.equal(inbound.timestamp.getTime(), 1762531200 * 1000);
});

function crearProveedorFalso(script = []) {
  const llamadas = [];
  return {
    nombre: 'fake-llm',
    llamadas,
    async chatCompletion(peticion) {
      llamadas.push(peticion);
      const actual = script.length ? script.shift() : null;
      return actual ?? { message: { role: 'assistant', content: 'Respuesta del proveedor falso.' }, finishReason: 'stop' };
    }
  };
}

function crearRepoFalso() {
  const llamadas = { guardar: [], buscar: [], listar: [], olvidar: [] };
  return {
    llamadas,
    guardar: (m) => { llamadas.guardar.push(m); return { ok: true, memoria: { ...m, id: 'mem_fake', fechaLocal: 'hoy' } }; },
    buscar: (consulta, opts) => { llamadas.buscar.push([consulta, opts]); return []; },
    listar: (categoria, opts) => { llamadas.listar.push([categoria, opts]); return []; },
    olvidar: (criterio, opts) => { llamadas.olvidar.push([criterio, opts]); return { ok: true, mensaje: 'Olvidado (fake).', borradas: 1 }; }
  };
}

test('un canal nuevo (telegram) llega al core solo con un adaptador y puertos inyectados', async () => {
  const proveedor = crearProveedorFalso();
  const repo = crearRepoFalso();
  const processor = crearMessageProcessor({ llmProvider: proveedor, memoryRepository: repo });

  // Canal telegram: sin importar nada de WhatsApp, solo el puerto de entrada.
  const inbound = crearInboundMessage({ userId: 'tg-12345', text: 'hola, que sabes de mi?', channel: 'telegram' });
  const respuesta = await processor.procesarMensajeEntrante(inbound, { historial: [], opciones: { chatId: 'tg-12345' } });

  assert.equal(typeof respuesta, 'string');
  assert.ok(respuesta.length > 0);
  // El LLM usado fue el puerto inyectado, no el modulo historico.
  assert.ok(proveedor.llamadas.length >= 1, 'el proveedor inyectado debio recibir la llamada');
  // La busqueda proactiva de memoria paso por el repositorio inyectado.
  assert.equal(repo.llamadas.buscar.length, 1);
  assert.equal(repo.llamadas.buscar[0][0], 'hola, que sabes de mi?');
});

test('las herramientas de memoria del core hablan con el MemoryRepositoryPort inyectado', async () => {
  const repo = crearRepoFalso();
  const proveedor = crearProveedorFalso([
    {
      message: {
        role: 'assistant',
        content: null,
        tool_calls: [
          { id: 'call_1', type: 'function', function: { name: 'guardar_memoria', arguments: { sujeto: 'prueba', dato: 'valor de prueba', categoria: 'general' } } }
        ]
      }
    },
    { message: { role: 'assistant', content: 'Guardado.' }, finishReason: 'stop' }
  ]);
  const processor = crearMessageProcessor({ llmProvider: proveedor, memoryRepository: repo });
  const inbound = crearInboundMessage({ userId: 'cli-local', text: 'recuerda que prueba es valor de prueba', channel: 'cli' });
  const respuesta = await processor.procesarMensajeEntrante(inbound, { opciones: { chatId: 'cli-local' } });

  assert.equal(respuesta, 'Guardado.');
  assert.equal(repo.llamadas.guardar.length, 1);
  assert.equal(repo.llamadas.guardar[0].sujeto, 'prueba');
  assert.equal(repo.llamadas.guardar[0].dato, 'valor de prueba');
});

test('una opcion explicita de la llamada gana al puerto del contenedor', async () => {
  const proveedorContenedor = crearProveedorFalso();
  const proveedorDirecto = crearProveedorFalso();
  const processor = crearMessageProcessor({ llmProvider: proveedorContenedor, memoryRepository: crearRepoFalso() });
  const inbound = crearInboundMessage({ userId: 'u', text: 'hola', channel: 'web' });
  await processor.procesarMensajeEntrante(inbound, { opciones: { chatCompletion: proveedorDirecto.chatCompletion } });
  assert.equal(proveedorDirecto.llamadas.length >= 1, true);
  assert.equal(proveedorContenedor.llamadas.length, 0);
});

test('los puertos validan su contrato', () => {
  assert.throws(() => afirmarLLMProvider({}), /chatCompletion/);
  assert.throws(() => afirmarMemoryRepository({ guardar: () => {} }), /buscar/);
  assert.throws(() => afirmarMessageChannel({}), /enviarTexto/);
  assert.throws(() => crearWhatsAppChannelAdapter(null), /sendMessage/);
});

test('el adaptador de canal envia por el socket con la forma historica', async () => {
  const envios = [];
  // Sesion abierta simulada: Baileys puebla sock.user tras connection=open.
  const sock = { user: { id: '34600000000:55@s.whatsapp.net' }, sendMessage: async (jid, contenido, opciones) => { envios.push([jid, contenido, opciones]); } };
  const canal = crearWhatsAppChannelAdapter(sock);
  assert.equal(canal.canal, 'whatsapp');
  await canal.enviarTexto('jid-1', 'hola', { quoted: 'msg' });
  assert.deepEqual(envios, [['jid-1', { text: 'hola' }, { quoted: 'msg' }]]);
});

test('el adaptador de canal sin sesion abierta falla pre-envio verificado (nunca llega al socket)', async () => {
  let llamadas = 0;
  // Sin sock.user la sesion NO esta abierta (Baileys la puebla en connection=open):
  // el mensaje no puede salir, fallo pre-envio verificado.
  const sock = { sendMessage: async () => { llamadas += 1; } };
  const canal = crearWhatsAppChannelAdapter(sock);
  await assert.rejects(
    canal.enviarTexto('jid-1', 'hola'),
    (error) => error.esFalloPreEnvioVerificado === true && /sin sesion/.test(error.message)
  );
  assert.equal(llamadas, 0, 'pre-envio: sendMessage jamas invocado');
});

test('la ruta de persistencia es inyectable en guardar y buscar (base para SQLite)', async () => {
  const { crearJsonMemoryRepository } = await import('../../src/adapters/outbound/persistence/jsonMemoryRepository.js');
  const repo = crearJsonMemoryRepository();
  const rutaTmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'davis-repo-')), 'mem_test.json');
  const res = repo.guardar({ sujeto: 'inyeccion_ruta', dato: 'valor inyectado' }, { rutaArchivo: rutaTmp });
  assert.equal(res.ok, true);
  assert.ok(fs.existsSync(rutaTmp), 'guardar debio escribir en la ruta inyectada');
  const encontradas = repo.buscar('inyeccion_ruta', { rutaArchivo: rutaTmp });
  assert.equal(encontradas.length, 1);
  assert.equal(encontradas[0].dato, 'valor inyectado');
  const olvido = repo.olvidar('inyeccion_ruta', { rutaArchivo: rutaTmp });
  assert.equal(olvido.ok, true);
  assert.equal(repo.buscar('inyeccion_ruta', { rutaArchivo: rutaTmp }).length, 0);
});

test('el contenedor por defecto cablea los adaptadores historicos', () => {
  const contenedor = crearContenedor();
  assert.equal(typeof contenedor.procesarMensajeEntrante, 'function');
  assert.equal(typeof contenedor.llmProvider.chatCompletion, 'function');
  for (const metodo of ['guardar', 'buscar', 'listar', 'olvidar']) {
    assert.equal(typeof contenedor.memoryRepository[metodo], 'function');
  }
});
