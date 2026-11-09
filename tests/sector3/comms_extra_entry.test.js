/**
 * comms_extra_entry.test.js
 * Pruebas del bloque 6 de comunicacion (nº 32 fechas senaladas, nº 34 snooze,
 * nº 35 estadisticas de grupos, nº 36 aviso de llegada) por la entrada real
 * de WhatsApp y a nivel de router/servicio.
 *
 * Strict Policy: Zero Emojis.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'path';
import os from 'os';

const dirEntorno = fs.mkdtempSync(path.join(os.tmpdir(), 'davis-comms-extra-'));
process.env.DAVIS_HISTORY_DIR = path.join(dirEntorno, 'history');
process.env.NODE_ENV = 'test';

const bot = await import('../../whatsappBot.js');
const { analizarIntencion } = await import('../../src/core/jarvisAgent.js');
const { lanzarRondaFechas, configurarAvisosFechas } = await import('../../src/services/specialDatesService.js');
const { lanzarRondaSnoozes } = await import('../../src/services/snoozeService.js');
const { estadisticasChat } = await import('../../src/services/groupStatsService.js');
const { registrarMensaje } = await import('../../src/services/conversationHistoryService.js');
const { procesarUbicacionEntrante, registrarAvisoLlegada } = await import('../../src/services/arrivalWatchService.js');

const JID_DAVID = '149868706304033@lid';

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

test('Router: "registra el cumple de Ana, 15 de marzo" ofrece las herramientas de fechas', () => {
  const r = analizarIntencion('registra el cumple de Ana, 15 de marzo');
  const nombres = r.herramientas.map((h) => h.function.name);
  assert.ok(nombres.includes('registrar_fecha_senalada'), 'falta registrar_fecha_senalada');
  assert.ok(nombres.includes('configurar_avisos_fechas'), 'falta configurar_avisos_fechas');
});

test('Entrada real: registrar un cumpleanos persiste la fecha y NO activa avisos', async () => {
  const enviados = [];
  const rutaFechas = path.join(dirEntorno, 'fechas1.json');
  const chatFalso = async ({ messages }) => {
    const ultimo = messages[messages.length - 1];
    if (ultimo.role === 'tool') return { message: { content: 'Apuntado, David.' } };
    return { message: { content: '', tool_calls: [{ id: 'c1', function: { name: 'registrar_fecha_senalada', arguments: { nombre: 'cumple de Ana', dia: 15, mes: 3 } } }] } };
  };
  await bot.procesarMensajesEntrantes(sockSimulado(enviados), {
    type: 'notify',
    messages: [mensajeEntrante('registra el cumple de Ana, 15 de marzo', 'FECH-1')]
  }, { chatCompletion: chatFalso, rutaArchivoFechas: rutaFechas });
  const estado = JSON.parse(fs.readFileSync(rutaFechas, 'utf-8'));
  assert.equal(estado.fechas.length, 1);
  assert.equal(estado.fechas[0].dia, 15);
  assert.equal(estado.fechas[0].mes, 3);
  assert.notEqual(estado.config.avisosFechas, true, 'registrar no implica opt-in a los avisos');
});

test('Guard de opt-in: el modelo no puede activar los avisos de fechas sin peticion textual de David', async () => {
  const enviados = [];
  const rutaFechas = path.join(dirEntorno, 'fechas2.json');
  fs.writeFileSync(rutaFechas, JSON.stringify({ fechas: [{ id: 'a1', nombre: 'cumple de Ana', dia: 15, mes: 3, ultimosAvisos: {} }], config: {} }));
  const chatFalso = async ({ messages }) => {
    const ultimo = messages[messages.length - 1];
    if (ultimo.role === 'tool') return { message: { content: 'Hecho.' } };
    return { message: { content: '', tool_calls: [{ id: 'c1', function: { name: 'configurar_avisos_fechas', arguments: { activo: true } } }] } };
  };
  // Mensaje SIN intencion de activar: el guard debe rechazar.
  await bot.procesarMensajesEntrantes(sockSimulado(enviados), {
    type: 'notify',
    messages: [mensajeEntrante('cuando es el cumple de Ana', 'FECH-2')]
  }, { chatCompletion: chatFalso, rutaArchivoFechas: rutaFechas });
  let estado = JSON.parse(fs.readFileSync(rutaFechas, 'utf-8'));
  assert.notEqual(estado.config.avisosFechas, true, 'sin peticion textual no hay opt-in');
  // Mensaje CON intencion explicita: se activa.
  await bot.procesarMensajesEntrantes(sockSimulado(enviados), {
    type: 'notify',
    messages: [mensajeEntrante('activa los avisos de fechas, porfa', 'FECH-3')]
  }, { chatCompletion: chatFalso, rutaArchivoFechas: rutaFechas });
  estado = JSON.parse(fs.readFileSync(rutaFechas, 'utf-8'));
  assert.equal(estado.config.avisosFechas, true, 'con peticion textual se activa');
});

test('Ronda de fechas: avisa el dia anterior una sola vez por anio', () => {
  const rutaFechas = path.join(dirEntorno, 'fechas3.json');
  fs.writeFileSync(rutaFechas, JSON.stringify({ fechas: [{ id: 'b1', nombre: 'cumple de Ana', dia: 15, mes: 3, ultimosAvisos: {} }], config: { avisosFechas: true } }));
  const encoladas = [];
  const deps = { rutaArchivo: rutaFechas, ahora: '2026-03-14T10:00:00+01:00', enqueue: (a) => encoladas.push(a) };
  const r1 = lanzarRondaFechas(deps);
  assert.equal(r1.avisadas, 1);
  assert.match(encoladas[0].title, /Manana/);
  const r2 = lanzarRondaFechas(deps);
  assert.equal(r2.avisadas, 0, 'segunda ronda no repite el aviso');
  // Desactivados: ningun aviso aunque toque.
  configurarAvisosFechas({ activo: false }, { rutaArchivo: rutaFechas });
  const r3 = lanzarRondaFechas({ rutaArchivo: rutaFechas, ahora: '2026-03-15T09:00:00+01:00', enqueue: (a) => encoladas.push(a) });
  assert.equal(r3.avisadas, 0, 'avisos desactivados no envian nada');
});

test('Snooze: programar por entrada real y disparo unico a la hora pedida', async () => {
  const enviados = [];
  const rutaSnoozes = path.join(dirEntorno, 'snoozes1.json');
  const chatFalso = async ({ messages }) => {
    const ultimo = messages[messages.length - 1];
    if (ultimo.role === 'tool') return { message: { content: 'Anotado, David.' } };
    return { message: { content: '', tool_calls: [{ id: 'c1', function: { name: 'programar_snooze', arguments: { minutos: 120, nota: 'lo del grupo de la uni' } } }] } };
  };
  await bot.procesarMensajesEntrantes(sockSimulado(enviados), {
    type: 'notify',
    messages: [mensajeEntrante('recuerdame este chat en 2 horas', 'SNZ-1')]
  }, { chatCompletion: chatFalso, rutaArchivoSnoozes: rutaSnoozes });
  const estado = JSON.parse(fs.readFileSync(rutaSnoozes, 'utf-8'));
  assert.equal(estado.snoozes.length, 1);
  assert.equal(estado.snoozes[0].estado, 'pendiente');
  assert.equal(estado.snoozes[0].chatId, JID_DAVID, 'el snooze queda ligado al chat actual');
  const encoladas = [];
  const futuro = new Date(Date.now() + 3 * 3600000).toISOString();
  const r = lanzarRondaSnoozes({ rutaArchivo: rutaSnoozes, ahora: futuro, enqueue: (a) => encoladas.push(a) });
  assert.equal(r.disparados, 1);
  assert.match(encoladas[0].details, /lo del grupo de la uni/);
  const r2 = lanzarRondaSnoozes({ rutaArchivo: rutaSnoozes, ahora: futuro, enqueue: (a) => encoladas.push(a) });
  assert.equal(r2.disparados, 0, 'un snooze dispara una sola vez');
});

test('Estadisticas de chat: cuenta solo lo visto por el bot y lo declara', () => {
  const chatId = '120363000999@g.us';
  registrarMensaje(chatId, 'user', 'hola grupo');
  registrarMensaje(chatId, 'assistant', 'hola, David');
  registrarMensaje(chatId, 'user', 'quedamos manana');
  const r = estadisticasChat({ chatId });
  assert.equal(r.ok, true);
  assert.equal(r.total, 3);
  assert.equal(r.tuyos, 2);
  assert.equal(r.mios, 1);
  const sinDatos = estadisticasChat({ chatId: '999999999999@g.us' });
  assert.equal(sinDatos.ok, false, 'chat sin historial: se declara la limitacion');
});

test('Entrada real: ubicacion dentro del radio dispara el aviso de llegada una sola vez', async () => {
  const enviados = [];
  const rutaLlegada = path.join(dirEntorno, 'llegada1.json');
  const rReg = registrarAvisoLlegada({ chatId: JID_DAVID, nombre: 'casa', latitud: 40.4168, longitud: -3.7038, radioMetros: 300 }, { rutaArchivo: rutaLlegada });
  assert.equal(rReg.ok, true);
  const msgUbicacion = {
    key: { remoteJid: JID_DAVID, fromMe: false, id: 'LLEG-1' },
    message: { locationMessage: { degreesLatitude: 40.4169, degreesLongitude: -3.7037 } },
    messageTimestamp: Math.floor(Date.now() / 1000)
  };
  await bot.procesarMensajesEntrantes(sockSimulado(enviados), { type: 'notify', messages: [msgUbicacion] }, { rutaArchivoLlegada: rutaLlegada });
  const estado = JSON.parse(fs.readFileSync(rutaLlegada, 'utf-8'));
  assert.equal(estado.avisos[0].estado, 'completado', 'el aviso se completa al entrar en radio');
  assert.ok(enviados.some((e) => /aviso de llegada/i.test(e.payload.text || '')), 'se notifica en el chat');
  // Segunda ubicacion: ya no hay aviso activo.
  const r2 = procesarUbicacionEntrante({ chatId: JID_DAVID, latitud: 40.4169, longitud: -3.7037 }, { rutaArchivo: rutaLlegada });
  assert.equal(r2.disparados, 0, 'el aviso es de un solo uso');
  // Fuera de radio: no dispara.
  registrarAvisoLlegada({ chatId: JID_DAVID, nombre: 'tajamar', latitud: 40.43, longitud: -3.68, radioMetros: 100 }, { rutaArchivo: rutaLlegada });
  const r3 = procesarUbicacionEntrante({ chatId: JID_DAVID, latitud: 40.4169, longitud: -3.7037 }, { rutaArchivo: rutaLlegada });
  assert.equal(r3.disparados, 0, 'fuera de radio no dispara');
});
