/**
 * finance_entry.test.js
 * Prueba de cableado real del bloque de finanzas (nº 24-27) por la entrada
 * real de WhatsApp (procesarMensajesEntrantes) con socket y LLM simulados:
 * herramientas por intencion, foto de ticket -> borrador -> confirmacion
 * determinista, y comportamiento sin adaptador de lectura configurado.
 *
 * Strict Policy: Zero Emojis.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'path';
import os from 'os';

const dirEntorno = fs.mkdtempSync(path.join(os.tmpdir(), 'davis-finance-entry-'));
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

function fotoTicket(caption, id) {
  return {
    key: { remoteJid: JID_DAVID, fromMe: false, id },
    message: { imageMessage: { caption, mimetype: 'image/jpeg' } },
    messageTimestamp: Math.floor(Date.now() / 1000)
  };
}

test('Entrada real: registrar_gasto persiste y el router ofrece las herramientas de finanzas', async () => {
  const enviados = [];
  const captura = {};
  const rutaFinanzas = path.join(dirEntorno, 'fin-entry-1.json');
  const chatFalso = async ({ messages, tools }) => {
    if (tools && tools.length > 0) captura.tools = tools.map((t) => t.function.name);
    const ultimo = messages[messages.length - 1];
    if (ultimo.role === 'tool') return { message: { content: 'Hecho, David.' } };
    return {
      message: {
        content: '',
        tool_calls: [{ id: 'call-1', function: { name: 'registrar_gasto', arguments: { importe: 12.5, comercio: 'Mercadona', categoria: 'comida' } } }]
      }
    };
  };

  await bot.procesarMensajesEntrantes(sockSimulado(enviados), {
    type: 'notify',
    messages: [mensajeEntrante('registra un gasto de 12,50 en Mercadona', 'FIN-1')]
  }, { chatCompletion: chatFalso, rutaArchivoFinanzas: rutaFinanzas });

  assert.ok(enviados.length > 0, 'el handler respondio');
  assert.ok(captura.tools.includes('registrar_gasto'), 'el router empuja las herramientas de finanzas');
  const estado = JSON.parse(fs.readFileSync(rutaFinanzas, 'utf-8'));
  assert.equal(estado.gastos.length, 1, 'gasto persistido');
  assert.equal(estado.gastos[0].comercio, 'Mercadona');
});

test('Entrada real: foto de ticket crea borrador y "si" lo confirma sin pasar por el LLM', async () => {
  const enviados = [];
  const rutaFinanzas = path.join(dirEntorno, 'fin-entry-2.json');
  let llamadasLlm = 0;
  const chatFalso = async () => { llamadasLlm++; return { message: { content: 'Respuesta generica.' } }; };
  const analizarTicket = async (buffer, ctx) => {
    assert.ok(ctx.chatId, 'el adaptador recibe el chat');
    return { importe: 12.5, comercio: 'Mercadona', moneda: 'EUR', fecha: '2026-11-05' };
  };
  const deps = { chatCompletion: chatFalso, rutaArchivoFinanzas: rutaFinanzas, analizarTicket, descargarMedia: async () => Buffer.from('foto-falsa') };

  await bot.procesarMensajesEntrantes(sockSimulado(enviados), {
    type: 'notify',
    messages: [fotoTicket('ticket de la compra', 'FIN-2')]
  }, deps);

  const ultimo1 = enviados[enviados.length - 1].payload.text;
  assert.match(ultimo1, /Del ticket he leido/, 'resume lo leido');
  assert.match(ultimo1, /No lo registro hasta que confirmes/, 'pide confirmacion');
  let estado = JSON.parse(fs.readFileSync(rutaFinanzas, 'utf-8'));
  assert.equal(estado.gastos.length, 0, 'sin confirmacion no hay gasto autoritativo');
  assert.equal(estado.borradores.length, 1);
  assert.equal(estado.borradores[0].estado, 'pendiente');

  await bot.procesarMensajesEntrantes(sockSimulado(enviados), {
    type: 'notify',
    messages: [mensajeEntrante('si', 'FIN-3')]
  }, deps);

  const ultimo2 = enviados[enviados.length - 1].payload.text;
  assert.match(ultimo2, /Registrado, David: 12.50 EUR en Mercadona/, 'confirma el registro');
  assert.equal(llamadasLlm, 0, 'la confirmacion es determinista, no pasa por el LLM');
  estado = JSON.parse(fs.readFileSync(rutaFinanzas, 'utf-8'));
  assert.equal(estado.gastos.length, 1);
  assert.equal(estado.gastos[0].origen, 'foto');
  assert.equal(estado.borradores[0].estado, 'confirmado');

  await bot.procesarMensajesEntrantes(sockSimulado(enviados), {
    type: 'notify',
    messages: [mensajeEntrante('si', 'FIN-4')]
  }, deps);
  assert.ok(llamadasLlm >= 1, 'un "si" sin borrador pendiente ya no se intercepta (llega al LLM)');
  estado = JSON.parse(fs.readFileSync(rutaFinanzas, 'utf-8'));
  assert.equal(estado.gastos.length, 1, 'un solo uso: no duplica el gasto');
});

test('Entrada real: foto de ticket sin adaptador configurado lo dice claramente y no guarda nada', async () => {
  const enviados = [];
  const rutaFinanzas = path.join(dirEntorno, 'fin-entry-3.json');
  const chatFalso = async () => { throw new Error('no debe llamarse al LLM para el ticket'); };

  await bot.procesarMensajesEntrantes(sockSimulado(enviados), {
    type: 'notify',
    messages: [fotoTicket('ticket', 'FIN-5')]
  }, { chatCompletion: chatFalso, rutaArchivoFinanzas: rutaFinanzas });

  const ultimo = enviados[enviados.length - 1].payload.text;
  assert.match(ultimo, /lector de fotos aun no esta configurado/, 'declara la funcion no configurada');
  assert.equal(fs.existsSync(rutaFinanzas), false, 'no persiste nada');
});

test('Entrada real: foto sin pinta de ticket no activa el pipeline', async () => {
  const enviados = [];
  const chatFalso = async () => ({ message: { content: 'Foto recibida.' } });
  await bot.procesarMensajesEntrantes(sockSimulado(enviados), {
    type: 'notify',
    messages: [fotoTicket('mira que paisaje', 'FIN-6')]
  }, { chatCompletion: chatFalso, rutaArchivoFinanzas: path.join(dirEntorno, 'fin-entry-4.json') });
  const ultimo = enviados[enviados.length - 1].payload.text;
  assert.equal(ultimo, 'Foto recibida.', 'sigue el flujo normal');
});

test('Router: un mensaje de finanzas selecciona el catalogo del bloque sin safety net', async () => {
  const { analizarIntencion } = await import('../../src/core/jarvisAgent.js');
  const ruta = analizarIntencion('registra un gasto de 12,50 en Mercadona');
  assert.equal(ruta.safetyNet, false, 'la intencion finanzas existe, no cae en safety net');
  assert.ok(ruta.intenciones.includes('finanzas'));
  const nombres = ruta.herramientas.map((t) => t.function.name);
  for (const nombre of ['registrar_gasto', 'listar_gastos', 'resumen_gastos_mes', 'registrar_suscripcion', 'listar_suscripciones', 'configurar_presupuesto', 'estado_presupuestos']) {
    assert.ok(nombres.includes(nombre), `falta ${nombre} en el catalogo del router`);
  }
});

test('Entrada real: los avisos de suscripciones solo se activan si David lo pide textualmente', async () => {
  const enviados = [];
  const rutaFinanzas = path.join(dirEntorno, 'fin-entry-5.json');
  const capturas = [];
  const chatFalso = async ({ messages, tools }) => {
    const ultimo = messages[messages.length - 1];
    if (ultimo.role === 'tool') {
      capturas.push(ultimo.content);
      return { message: { content: 'Hecho, David.' } };
    }
    return { message: { content: '', tool_calls: [{ id: 'call-x', function: { name: 'configurar_avisos_suscripciones', arguments: { activo: true } } }] } };
  };

  await bot.procesarMensajesEntrantes(sockSimulado(enviados), {
    type: 'notify',
    messages: [mensajeEntrante('cuanto llevo gastado este mes', 'FIN-7')]
  }, { chatCompletion: chatFalso, rutaArchivoFinanzas: rutaFinanzas });
  assert.match(capturas[0], /necesito que me lo pidas tu directamente/, 'el modelo no puede autoactivar los avisos');
  assert.equal(fs.existsSync(rutaFinanzas), false, 'no se escribe nada sin la peticion de David');

  await bot.procesarMensajesEntrantes(sockSimulado(enviados), {
    type: 'notify',
    messages: [mensajeEntrante('activa los avisos de suscripciones', 'FIN-8')]
  }, { chatCompletion: chatFalso, rutaArchivoFinanzas: rutaFinanzas });
  const estado = JSON.parse(fs.readFileSync(rutaFinanzas, 'utf-8'));
  assert.equal(estado.config.avisosSuscripciones, true, 'la peticion textual de David los activa');
});
