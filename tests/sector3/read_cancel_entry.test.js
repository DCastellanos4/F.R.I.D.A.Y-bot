/**
 * read_cancel_entry.test.js
 * Regresion directa por la entrada real (procesarMensajesEntrantes) para las
 * herramientas de CONSULTA y CANCELACION que solo compartian cobertura con
 * sus caminos de escritura: listar/cancelar recordatorios, listar/cancelar
 * mensajes programados, listar memorias, listar contactos, listar quedadas,
 * leer diario, tachar/vaciar compra, listar/eliminar paradas favoritas y
 * listar/cancelar snoozes. Fixtures aisladas en tmp: nunca tocan data/ del
 * repo ni cancelan nada real.
 *
 * Strict Policy: Zero Emojis.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'path';
import os from 'os';

const dirEntorno = fs.mkdtempSync(path.join(os.tmpdir(), 'davis-readcancel-'));
process.env.DAVIS_HISTORY_DIR = path.join(dirEntorno, 'history');
process.env.NODE_ENV = 'test';

const bot = await import('../../whatsappBot.js');

const JID_DAVID = '149868706304033@lid';
let secuencia = 0;

function sockSimulado(enviados) {
  return {
    readMessages: async () => {},
    sendPresenceUpdate: async () => {},
    sendMessage: async (jid, payload) => { enviados.push({ jid, payload }); return { key: { id: 'SIM-' + enviados.length } }; }
  };
}

function mensajeEntrante(texto) {
  secuencia += 1;
  return {
    key: { remoteJid: JID_DAVID, fromMe: false, id: 'RC-' + secuencia },
    message: { conversation: texto },
    messageTimestamp: Math.floor(Date.now() / 1000)
  };
}

function escribirJson(nombre, datos) {
  const ruta = path.join(dirEntorno, nombre);
  fs.writeFileSync(ruta, JSON.stringify(datos, null, 2), 'utf-8');
  return ruta;
}

/**
 * Conduce un mensaje real hasta la herramienta pedida y captura lo que el
 * modelo ve tras ejecutarla (mensaje role:tool) y la respuesta enviada.
 */
async function entradaConHerramienta(texto, herramienta, args, deps = {}) {
  const enviados = [];
  const mensajesTool = [];
  const chatFalso = async ({ messages }) => {
    const ultimo = messages[messages.length - 1];
    if (ultimo.role === 'tool') {
      mensajesTool.push(ultimo.content);
      return { message: { content: 'Hecho, David.' } };
    }
    return { message: { content: '', tool_calls: [{ id: 'c1', function: { name: herramienta, arguments: args } }] } };
  };
  await bot.procesarMensajesEntrantes(sockSimulado(enviados), {
    type: 'notify',
    messages: [mensajeEntrante(texto)]
  }, { chatCompletion: chatFalso, ...deps });
  return { enviados, mensajesTool };
}

// ---------- Recordatorios (fixture aislada via rutaArchivoRecordatorios) ----------

test('listar_recordatorios: por entrada real lista los pendientes de la fixture', async () => {
  const ruta = escribirJson('recordatorios.json', [
    { id: 'r1', mensaje: 'llamar a mama', fechaHoraLocal: '06/11/2026, 09:00:00', completado: false },
    { id: 'r2', mensaje: 'comprar pilas', fechaHoraLocal: '07/11/2026, 10:00:00', completado: true }
  ]);
  const { enviados, mensajesTool } = await entradaConHerramienta('que recordatorios tengo pendientes?', 'listar_recordatorios', {}, { rutaArchivoRecordatorios: ruta });
  assert.equal(mensajesTool.length, 1);
  assert.ok(mensajesTool[0].includes('llamar a mama'), 'debe listar el pendiente');
  assert.ok(!mensajesTool[0].includes('comprar pilas'), 'no debe listar el completado');
  assert.equal(enviados.length, 1);
});

test('cancelar_recordatorio: por entrada real cancela solo el que coincide en la fixture', async () => {
  const ruta = escribirJson('recordatorios2.json', [
    { id: 'r1', mensaje: 'llamar a mama', fechaHoraLocal: '06/11/2026, 09:00:00', completado: false },
    { id: 'r2', mensaje: 'comprar pilas', fechaHoraLocal: '07/11/2026, 10:00:00', completado: false }
  ]);
  const { mensajesTool } = await entradaConHerramienta('cancela el recordatorio de llamar a mama', 'cancelar_recordatorio', { criterio: 'mama' }, { rutaArchivoRecordatorios: ruta });
  assert.ok(mensajesTool[0].includes('cancelado'), mensajesTool[0]);
  const restantes = JSON.parse(fs.readFileSync(ruta, 'utf-8'));
  assert.equal(restantes.length, 1);
  assert.equal(restantes[0].mensaje, 'comprar pilas');
});

// ---------- Mensajes programados (fixture aislada via rutaArchivoProgramados) ----------

test('listar_mensajes_programados: por entrada real lista los pendientes de la fixture', async () => {
  const ruta = escribirJson('programados.json', [
    { id: 'm1', numero: '34600000000', mensaje: 'acuerdate del medico', fechaHoraLocal: '06/11/2026, 10:00:00', enviado: false },
    { id: 'm2', numero: '34600000001', mensaje: 'ya enviado', fechaHoraLocal: '05/11/2026, 10:00:00', enviado: true }
  ]);
  const { mensajesTool } = await entradaConHerramienta('que mensajes programados tengo?', 'listar_mensajes_programados', {}, { rutaArchivoProgramados: ruta });
  assert.ok(mensajesTool[0].includes('acuerdate del medico'));
  assert.ok(!mensajesTool[0].includes('ya enviado'));
});

test('cancelar_mensaje_programado: por entrada real elimina el envio de la fixture', async () => {
  const ruta = escribirJson('programados2.json', [
    { id: 'm1', numero: '34600000000', mensaje: 'acuerdate del medico', fechaHoraLocal: '06/11/2026, 10:00:00', enviado: false }
  ]);
  const { mensajesTool } = await entradaConHerramienta('cancela el mensaje programado del medico', 'cancelar_mensaje_programado', { criterio: 'm1' }, { rutaArchivoProgramados: ruta });
  assert.ok(mensajesTool[0].includes('cancelado'), mensajesTool[0]);
  assert.equal(JSON.parse(fs.readFileSync(ruta, 'utf-8')).length, 0);
});

// ---------- Segundo cerebro (fixture aislada via rutaArchivoMemorias) ----------

test('listar_memorias: por entrada real lista las memorias de la fixture', async () => {
  const ruta = escribirJson('memorias.json', [
    { sujeto: 'tajamar', dato: 'el examen de redes es en diciembre', categoria: 'estudio' }
  ]);
  const { mensajesTool } = await entradaConHerramienta('que memorias tengo guardadas?', 'listar_memorias', {}, { rutaArchivoMemorias: ruta });
  assert.ok(mensajesTool[0].includes('TAJAMAR'));
  assert.ok(mensajesTool[0].includes('examen de redes'));
});

// ---------- Contactos / quedadas / diario ----------

test('listar_contactos: por entrada real lista los contactos de la fixture', async () => {
  const ruta = escribirJson('contactos.json', {
    contactos: [{ id: 'c1', nombre: 'Ana', telefono: '+34611111111', creadoEn: '2026-11-01T00:00:00.000Z' }]
  });
  const { mensajesTool } = await entradaConHerramienta('que contactos tengo?', 'listar_contactos', {}, { rutaArchivoContactos: ruta });
  assert.ok(mensajesTool[0].includes('Ana'), mensajesTool[0]);
});

test('listar_quedadas: por entrada real lista las quedadas de la fixture', async () => {
  const ruta = escribirJson('quedadas.json', {
    quedadas: [{ id: 'q1', titulo: 'cena con la uni', fecha: '2026-11-08', hora: '21:00', lugar: null, participantes: [], creadaEn: '2026-11-01T00:00:00.000Z' }]
  });
  const { mensajesTool } = await entradaConHerramienta('que quedadas tengo?', 'listar_quedadas', {}, { rutaArchivoQuedadas: ruta });
  assert.ok(mensajesTool[0].includes('cena con la uni'), mensajesTool[0]);
});

test('leer_diario: por entrada real lee la entrada pedida de la fixture', async () => {
  const carpeta = path.join(dirEntorno, 'diario');
  fs.mkdirSync(carpeta, { recursive: true });
  fs.writeFileSync(path.join(carpeta, '2026-11-05.md'), 'Hoy desplegue el CI/CD y corregi el error 400.\n', 'utf-8');
  const { mensajesTool } = await entradaConHerramienta('leeme el diario de hoy', 'leer_diario', { fecha: '2026-11-05' }, { carpetaDiario: carpeta });
  assert.ok(mensajesTool[0].includes('CI/CD'), mensajesTool[0]);
});

// ---------- Lista de la compra ----------

test('tachar_compra: por entrada real tacha solo el articulo pedido', async () => {
  const ruta = escribirJson('compra.json', { items: ['leche', 'huevos'] });
  const { mensajesTool } = await entradaConHerramienta('tacha la leche de la compra', 'tachar_compra', { criterio: 'leche' }, { rutaArchivoCompra: ruta });
  assert.ok(mensajesTool[0].includes('leche'));
  assert.deepEqual(JSON.parse(fs.readFileSync(ruta, 'utf-8')).items, ['huevos']);
});

test('vaciar_compra: exige peticion textual del usuario y entonces vacia', async () => {
  const ruta = escribirJson('compra2.json', { items: ['leche'] });
  const { mensajesTool } = await entradaConHerramienta('vacia la lista de la compra', 'vaciar_compra', {}, { rutaArchivoCompra: ruta });
  assert.ok(mensajesTool[0].includes('vaciada'), mensajesTool[0]);
  assert.deepEqual(JSON.parse(fs.readFileSync(ruta, 'utf-8')).items, []);
});

test('vaciar_compra: sin peticion textual el modelo no puede vaciarla', async () => {
  const ruta = escribirJson('compra3.json', { items: ['leche'] });
  const { mensajesTool } = await entradaConHerramienta('que me recomiendas cenar?', 'vaciar_compra', {}, { rutaArchivoCompra: ruta });
  assert.ok(mensajesTool[0].includes('necesito que me lo pidas'), mensajesTool[0]);
  assert.deepEqual(JSON.parse(fs.readFileSync(ruta, 'utf-8')).items, ['leche']);
});

// ---------- Transporte: paradas favoritas ----------

test('listar_paradas_favoritas: por entrada real lista las paradas de la fixture', async () => {
  const ruta = escribirJson('transporte.json', {
    paradas: [{ id: 'p1', nombre: 'casa', tipo: 'emt', codigo: '1234', creadaEn: '2026-11-01T00:00:00.000Z' }]
  });
  const { mensajesTool } = await entradaConHerramienta('cuales son mis paradas favoritas?', 'listar_paradas_favoritas', {}, { rutaArchivoTransporte: ruta });
  assert.ok(mensajesTool[0].includes('casa'), mensajesTool[0]);
});

test('eliminar_parada_favorita: por entrada real elimina solo la parada pedida', async () => {
  const ruta = escribirJson('transporte2.json', {
    paradas: [
      { id: 'p1', nombre: 'casa', tipo: 'emt', codigo: '1234', creadaEn: '2026-11-01T00:00:00.000Z' },
      { id: 'p2', nombre: 'tajamar', tipo: 'cercanias', codigo: '18001', creadaEn: '2026-11-01T00:00:00.000Z' }
    ]
  });
  const { mensajesTool } = await entradaConHerramienta('borra la parada casa', 'eliminar_parada_favorita', { criterio: 'casa' }, { rutaArchivoTransporte: ruta });
  assert.ok(mensajesTool[0].includes('casa'));
  const restantes = JSON.parse(fs.readFileSync(ruta, 'utf-8')).paradas;
  assert.equal(restantes.length, 1);
  assert.equal(restantes[0].nombre, 'tajamar');
});

// ---------- Snoozes ----------

test('listar_snoozes: por entrada real lista los snoozes pendientes', async () => {
  const ruta = escribirJson('snoozes.json', {
    snoozes: [{ id: 's1', chatId: JID_DAVID, activarEn: '2026-11-06T08:00:00.000Z', nota: 'responder a Carlos', estado: 'pendiente' }]
  });
  const { mensajesTool } = await entradaConHerramienta('que snoozes tengo?', 'listar_snoozes', {}, { rutaArchivoSnoozes: ruta });
  assert.ok(mensajesTool[0].includes('responder a Carlos'), mensajesTool[0]);
});

test('cancelar_snooze: por entrada real marca el snooze como cancelado', async () => {
  const ruta = escribirJson('snoozes2.json', {
    snoozes: [{ id: 's1', chatId: JID_DAVID, activarEn: '2026-11-06T08:00:00.000Z', nota: 'responder a Carlos', estado: 'pendiente' }]
  });
  const { mensajesTool } = await entradaConHerramienta('cancela el snooze de Carlos', 'cancelar_snooze', { id: 's1' }, { rutaArchivoSnoozes: ruta });
  assert.ok(mensajesTool[0].includes('Cancelado'), mensajesTool[0]);
  assert.equal(JSON.parse(fs.readFileSync(ruta, 'utf-8')).snoozes[0].estado, 'cancelado');
});
