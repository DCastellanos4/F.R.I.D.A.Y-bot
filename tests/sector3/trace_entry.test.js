/**
 * trace_entry.test.js
 * Trazas del recorrido de mensajes: servicio (guardado, tope, redaccion),
 * herramienta explicar_recorrido y flujo real de entrada
 * ("como has llegado a esa respuesta?").
 *
 * Strict Policy: Zero Emojis.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const dirEntorno = fs.mkdtempSync(path.join(os.tmpdir(), 'davis-trazas-'));
process.env.NODE_ENV = 'test';
process.env.DAVIS_HISTORY_DIR = path.join(dirEntorno, 'history');

const { iniciarTraza, guardarTraza, ultimaTraza, explicarUltimoRecorrido } = await import('../../src/services/traceService.js');
const bot = await import('../../whatsappBot.js');

const JID_DAVID = '149868706304033@lid';
const carpetaTrazas = path.join(dirEntorno, 'trazas');

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

test('Traza: guardar y leer la ultima por chat, con mensaje recortado', () => {
  const traza = iniciarTraza('chat-unitario@test', 'que tiempo hace?');
  traza.via = 'regex';
  traza.intenciones = ['clima'];
  traza.herramientasOfrecidas = 1;
  traza.llamadas.push({ nombre: 'consultar_clima', ronda: 1, resultado: 'ok' });
  traza.rondas = 1;
  traza.duracionMs = 1234;
  assert.equal(guardarTraza(traza, { carpetaTrazas }), true);
  const leida = ultimaTraza('chat-unitario@test', { carpetaTrazas });
  assert.equal(leida.via, 'regex');
  assert.deepEqual(leida.llamadas.map((l) => l.nombre), ['consultar_clima']);
  // Otro chat no ve la traza ajena
  assert.equal(ultimaTraza('otro-chat@test', { carpetaTrazas }), null);
});

test('Traza: credenciales se redactan antes de guardar', () => {
  const traza = iniciarTraza('chat-redaccion@test', 'mi contrasena: secreta123 no la guardes');
  assert.ok(!traza.mensaje.includes('secreta123'), 'la credencial no debia quedar en la traza');
  assert.ok(traza.mensaje.includes('[redactado'), 'debio marcarse la redaccion');
});

test('Traza: guardia de tests sin carpeta inyectada no escribe en data/ real', () => {
  const traza = iniciarTraza('chat-guardia@test', 'hola');
  if (process.env.DAVIS_DATA_DIR) {
    // Con DAVIS_DATA_DIR aislada (suite/CI), la escritura va al temporal, no al repo.
    assert.equal(guardarTraza(traza), true);
    assert.ok(!fs.existsSync(path.join(process.cwd(), 'data', 'trazas', 'chat-guardia@test.jsonl')), 'no debe aparecer en el data/ del repo');
  } else {
    assert.equal(guardarTraza(traza), false);
  }
});

test('Traza: tope de 50 por chat conserva las mas recientes', () => {
  const chat = 'chat-tope@test';
  for (let i = 0; i < 65; i++) {
    const t = iniciarTraza(chat, `mensaje numero ${i}`);
    t.rondas = 0;
    t.duracionMs = 1;
    guardarTraza(t, { carpetaTrazas });
  }
  const ultima = ultimaTraza(chat, { carpetaTrazas });
  assert.equal(ultima.mensaje, 'mensaje numero 64');
});

test('explicarUltimoRecorrido: sin trazas lo dice honesto', () => {
  const texto = explicarUltimoRecorrido('chat-inexistente@test', { carpetaTrazas });
  assert.match(texto, /No tengo registrado ningun recorrido/);
});

test('explicarUltimoRecorrido: explica en llano una traza con herramienta', () => {
  const chat = 'chat-explica@test';
  const traza = iniciarTraza(chat, 'que tiempo hace?');
  traza.via = 'regex';
  traza.intenciones = ['clima'];
  traza.herramientasOfrecidas = 1;
  traza.llamadas.push({ nombre: 'consultar_clima', ronda: 1, resultado: 'ok' });
  traza.rondas = 1;
  traza.duracionMs = 1500;
  guardarTraza(traza, { carpetaTrazas });
  const texto = explicarUltimoRecorrido(chat, { carpetaTrazas });
  assert.match(texto, /Enrutado directo/);
  assert.match(texto, /consultar_clima/);
  assert.match(texto, /salio bien/);
  assert.match(texto, /1 ronda\(s\)/);
});

test('Entrada real: una consulta deja traza y "como has llegado a esa respuesta?" la explica', async () => {
  // 1. Peticion de clima con herramienta guionizada (ejecutor real tolera
  //    falta de red: la traza se guarda igualmente al final del flujo).
  const enviados1 = [];
  const chatClima = async ({ messages }) => {
    const ultimo = messages[messages.length - 1];
    if (ultimo.role === 'tool') return { message: { content: 'Soleado y 22 grados.' } };
    return { message: { content: '', tool_calls: [{ id: 'c1', function: { name: 'consultar_clima', arguments: { ubicacion: 'Madrid' } } }] } };
  };
  await bot.procesarMensajesEntrantes(sockSimulado(enviados1), {
    type: 'notify',
    messages: [mensajeEntrante('que tiempo hace en madrid?', 'TRZ-1')]
  }, { chatCompletion: chatClima, carpetaTrazas });

  // La traza del clima existe ya: enrutado directo y oferta de 1 herramienta.
  const trazaClima = ultimaTraza(JID_DAVID, { carpetaTrazas });
  assert.ok(trazaClima, 'la consulta de clima debio dejar traza');
  assert.equal(trazaClima.via, 'regex');
  assert.deepEqual(trazaClima.intenciones, ['clima']);

  // 2. Pregunta por el recorrido: enruta a devtools por regex y la
  //    herramienta real lee la traza anterior del mismo chat.
  const enviados2 = [];
  const chatRecorrido = async ({ messages }) => {
    const ultimo = messages[messages.length - 1];
    if (ultimo.role === 'tool') return { message: { content: ultimo.content } };
    return { message: { content: '', tool_calls: [{ id: 'c2', function: { name: 'explicar_recorrido', arguments: {} } }] } };
  };
  await bot.procesarMensajesEntrantes(sockSimulado(enviados2), {
    type: 'notify',
    messages: [mensajeEntrante('como has llegado a esa respuesta?', 'TRZ-2')]
  }, { chatCompletion: chatRecorrido, carpetaTrazas });

  const texto = enviados2[enviados2.length - 1].payload.text;
  assert.match(texto, /consultar_clima/, 'la explicacion debia nombrar la herramienta usada antes');
  assert.match(texto, /Enrutado directo/, 'la explicacion debia describir la via de enrutado');
});

test('Traza: archivo con permisos 600 y nombre sin el chatId en claro', () => {
  const chat = 'chat-privacidad-123456789@lid';
  const traza = iniciarTraza(chat, 'hola');
  traza.rondas = 0;
  traza.duracionMs = 1;
  guardarTraza(traza, { carpetaTrazas });
  const archivos = fs.readdirSync(carpetaTrazas);
  const propio = archivos.find((a) => ultimaTraza(chat, { carpetaTrazas }) && fs.existsSync(path.join(carpetaTrazas, a)) && fs.readFileSync(path.join(carpetaTrazas, a), 'utf8').includes('chat-privacidad-123456789@lid'));
  assert.ok(propio, 'debio existir el archivo de trazas del chat');
  assert.ok(!propio.includes('chat-privacidad-123456789'), 'el nombre de archivo no debe llevar el chatId en claro');
  assert.match(propio, /^[0-9a-f]{24}\.jsonl$/, 'nombre = hash de 24 hex');
  const modo = fs.statSync(path.join(carpetaTrazas, propio)).mode & 0o777;
  if (process.platform !== 'win32') {
    assert.equal(modo, 0o600, 'permisos 600');
  }
});

test('explicarUltimoRecorrido: introspeccion dos veces seguidas explica la ultima peticion real', () => {
  const chat = 'chat-introspeccion@test';
  // 1. Peticion real (clima)
  const t1 = iniciarTraza(chat, 'que tiempo hace?');
  t1.via = 'regex';
  t1.intenciones = ['clima'];
  t1.herramientasOfrecidas = 1;
  t1.llamadas.push({ nombre: 'consultar_clima', ronda: 1, resultado: 'ok' });
  t1.rondas = 1;
  t1.duracionMs = 900;
  guardarTraza(t1, { carpetaTrazas });
  // 2. Primera introspeccion (deja traza con explicar_recorrido)
  const t2 = iniciarTraza(chat, 'como has llegado a esa respuesta?');
  t2.via = 'regex';
  t2.intenciones = ['devtools'];
  t2.herramientasOfrecidas = 7;
  t2.llamadas.push({ nombre: 'explicar_recorrido', ronda: 1, resultado: 'ok' });
  t2.rondas = 1;
  t2.duracionMs = 300;
  guardarTraza(t2, { carpetaTrazas });
  // 3. Segunda introspeccion: debe explicar la del clima, no la suya propia
  const texto = explicarUltimoRecorrido(chat, { carpetaTrazas });
  assert.match(texto, /consultar_clima/, 'debio explicar la ultima peticion real (clima)');
  assert.ok(!texto.includes('Recorrido de "como has llegado'), 'no debio explicar la propia introspeccion');
});

test('limpiarHistorial borra las trazas aunque no haya historial guardado', async () => {
  const { limpiarHistorial } = await import('../../src/services/conversationHistoryService.js');
  const chat = 'chat-limpieza@test';
  const traza = iniciarTraza(chat, 'que tiempo hace?');
  traza.via = 'regex';
  traza.rondas = 0;
  traza.duracionMs = 5;
  guardarTraza(traza, { carpetaTrazas });
  assert.ok(ultimaTraza(chat, { carpetaTrazas }), 'la traza existia antes de limpiar');
  // Sin historial previo del chat: la limpieza debe borrar trazas igualmente.
  assert.equal(limpiarHistorial(chat, { carpetaTrazas }), true);
  assert.equal(ultimaTraza(chat, { carpetaTrazas }), null, 'las trazas debieron borrarse con el historial');
  assert.match(explicarUltimoRecorrido(chat, { carpetaTrazas }), /No tengo registrado ningun recorrido/);
});

test('Entrada real: borrado de conversacion pide confirmacion fuera del modelo y borra historial+trazas', async () => {
  const { registrarMensaje, contarMensajes } = await import('../../src/services/conversationHistoryService.js');
  const chat = JID_DAVID;
  // Semilla: historial y traza del chat
  registrarMensaje(chat, 'user', 'mensaje previo de prueba');
  const t = iniciarTraza(chat, 'que tiempo hace?');
  t.via = 'regex'; t.rondas = 0; t.duracionMs = 5;
  guardarTraza(t, { carpetaTrazas });
  assert.ok(contarMensajes(chat) > 0);
  assert.ok(ultimaTraza(chat, { carpetaTrazas }));

  // 1. Peticion: NO borra nada todavia; pide confirmacion con id y deja
  //    claro el alcance (Second Brain fuera).
  const enviados1 = [];
  await bot.procesarMensajesEntrantes(sockSimulado(enviados1), {
    type: 'notify',
    messages: [mensajeEntrante('borra el historial de esta conversacion', 'DEL-1')]
  }, { carpetaTrazas });
  const texto1 = enviados1[enviados1.length - 1].payload.text;
  const mId = texto1.match(/confirmar borrado (borr_[a-f0-9]{6})/);
  assert.ok(mId, `debio pedir confirmacion con id; texto: ${texto1}`);
  assert.match(texto1, /Second Brain\) NO se tocan/);
  assert.ok(ultimaTraza(chat, { carpetaTrazas }), 'sin confirmar no se borra nada');
  assert.ok(contarMensajes(chat) > 0, 'sin confirmar el historial sigue');

  // 2. Confirmacion exacta: borra historial y trazas; mensaje honesto.
  const enviados2 = [];
  await bot.procesarMensajesEntrantes(sockSimulado(enviados2), {
    type: 'notify',
    messages: [mensajeEntrante(`confirmar borrado ${mId[1]}`, 'DEL-2')]
  }, { carpetaTrazas });
  const texto2 = enviados2[enviados2.length - 1].payload.text;
  assert.match(texto2, /Historial de la conversacion, episodios y trazas borrados/);
  assert.match(texto2, /Second Brain siguen intactos/);
  assert.equal(ultimaTraza(chat, { carpetaTrazas }), null, 'trazas borradas');
  assert.equal(contarMensajes(chat), 0, 'historial borrado');

  // 3. El id es de un solo uso.
  const enviados3 = [];
  await bot.procesarMensajesEntrantes(sockSimulado(enviados3), {
    type: 'notify',
    messages: [mensajeEntrante(`confirmar borrado ${mId[1]}`, 'DEL-3')]
  }, { carpetaTrazas });
  assert.match(enviados3[enviados3.length - 1].payload.text, /No hay ningun borrado pendiente/);
});

test('Entrada real: "cancelar borrado" anula la peticion y no borra nada', async () => {
  const chat = JID_DAVID;
  const t = iniciarTraza(chat, 'otra peticion');
  t.via = 'regex'; t.rondas = 0; t.duracionMs = 5;
  guardarTraza(t, { carpetaTrazas });

  const enviados1 = [];
  await bot.procesarMensajesEntrantes(sockSimulado(enviados1), {
    type: 'notify',
    messages: [mensajeEntrante('olvida esta conversacion', 'DEL-10')]
  }, { carpetaTrazas });
  const texto1 = enviados1[enviados1.length - 1].payload.text;
  const mId = texto1.match(/confirmar borrado (borr_[a-f0-9]{6})/);
  assert.ok(mId, `debio pedir confirmacion; texto: ${texto1}`);

  const enviados2 = [];
  await bot.procesarMensajesEntrantes(sockSimulado(enviados2), {
    type: 'notify',
    messages: [mensajeEntrante('cancelar borrado', 'DEL-11')]
  }, { carpetaTrazas });
  assert.match(enviados2[enviados2.length - 1].payload.text, /Borrado cancelado/);
  assert.ok(ultimaTraza(chat, { carpetaTrazas }), 'la traza sigue tras cancelar');

  // El id cancelado ya no sirve.
  const enviados3 = [];
  await bot.procesarMensajesEntrantes(sockSimulado(enviados3), {
    type: 'notify',
    messages: [mensajeEntrante(`confirmar borrado ${mId[1]}`, 'DEL-12')]
  }, { carpetaTrazas });
  assert.match(enviados3[enviados3.length - 1].payload.text, /No hay ningun borrado pendiente/);
  assert.ok(ultimaTraza(chat, { carpetaTrazas }), 'la traza sigue tras id cancelado');
});

test('Borrado conversacion: aislamiento entre chats (un chat no confirma el borrado de otro)', async () => {
  const { registrarBorradoConversacionPendiente, resolverConfirmacionBorrado } = await import('../../src/services/destructiveActionService.js');
  const chatA = 'chat-a@test';
  const chatB = 'chat-b@test';
  const idA = registrarBorradoConversacionPendiente(chatA);
  // Desde otro chat: mismo mensaje de "No hay ningun borrado", sin consumir.
  const resB = resolverConfirmacionBorrado(chatB, `confirmar borrado ${idA}`);
  assert.equal(resB.confirmado, false);
  assert.match(resB.motivo, /No hay ningun borrado pendiente/);
  // El chat correcto si puede confirmar despues del intento cruzado.
  const resA = resolverConfirmacionBorrado(chatA, `confirmar borrado ${idA}`);
  assert.equal(resA.confirmado, true);
  assert.equal(resA.tipo, 'conversacion');
});
