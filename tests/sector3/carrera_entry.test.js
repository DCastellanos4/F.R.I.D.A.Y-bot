/**
 * carrera_entry.test.js
 * Pruebas del bloque carrera/estudio (nº 3 simulacro de entrevista,
 * 4 CV contra oferta, 7 resumidor de apuntes, 8 calendario de entregas)
 * por la entrada real de WhatsApp y a nivel de router/servicio.
 *
 * Strict Policy: Zero Emojis.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'path';
import os from 'os';

const dirEntorno = fs.mkdtempSync(path.join(os.tmpdir(), 'davis-carrera-'));
process.env.DAVIS_HISTORY_DIR = path.join(dirEntorno, 'history');
process.env.NODE_ENV = 'test';

const bot = await import('../../whatsappBot.js');
const { analizarIntencion } = await import('../../src/core/jarvisAgent.js');
const { registrarEntrega, listarEntregas, eliminarEntrega } = await import('../../src/services/deadlinesService.js');
const { analizarCvContraOferta } = await import('../../src/services/cvAnalyzerService.js');
const { resumirApuntes } = await import('../../src/services/notesSummarizerService.js');
const { estadoEntrevista } = await import('../../src/services/interviewService.js');

const JID_DAVID = '149868706304033@lid';

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

// ---------- Router ----------

test('Router: "apunta una entrega de interfaces" solo encaja en carrera', () => {
  const r = analizarIntencion('apunta una entrega de interfaces para el 2026-11-20');
  assert.deepEqual(r.intenciones, ['carrera']);
  const nombres = r.herramientas.map((h) => h.function.name);
  assert.ok(nombres.includes('registrar_entrega'), 'falta registrar_entrega');
});

test('Router: simulacro, CV y apuntes ofrecen sus herramientas', () => {
  const casos = [
    ['quiero hacer un simulacro de entrevista de backend junior', 'iniciar_simulacro_entrevista'],
    ['analiza mi cv contra esta oferta de datos', 'analizar_cv_oferta'],
    ['resume mis apuntes de redes', 'resumir_apuntes'],
    ['que entregas y examenes tengo', 'listar_entregas']
  ];
  for (const [frase, herramienta] of casos) {
    const nombres = analizarIntencion(frase).herramientas.map((h) => h.function.name);
    assert.ok(nombres.includes(herramienta), `"${frase}" no ofrece ${herramienta}`);
  }
});

// ---------- Calendario de entregas ----------

test('Entregas: registrar, dias restantes, duplicado y eliminar', () => {
  const ruta = path.join(dirEntorno, 'entregas1.json');
  const ahora = '2026-11-05T18:00:00+01:00';
  assert.equal(registrarEntrega({ titulo: 'examen de estadistica', fecha: '2026-12-15', tipo: 'examen' }, { rutaArchivo: ruta, ahora }).ok, true);
  assert.equal(registrarEntrega({ titulo: 'examen de estadistica', fecha: '2026-12-15' }, { rutaArchivo: ruta, ahora }).ok, false, 'dedupe por titulo+fecha');
  assert.equal(registrarEntrega({ titulo: 'sin fecha' }, { rutaArchivo: ruta, ahora }).ok, false, 'fecha obligatoria');
  const lista = listarEntregas({ rutaArchivo: ruta, ahora });
  assert.equal(lista.length, 1);
  assert.equal(lista[0].dias, 40);
  assert.equal(eliminarEntrega('estadistica', { rutaArchivo: ruta, ahora }).ok, true);
  assert.equal(listarEntregas({ rutaArchivo: ruta, ahora }).length, 0);
});

// ---------- CV contra oferta ----------

test('CV: sin CV lo dice; con texto analiza; desde notas declara la fuente', async () => {
  const chatFalso = async () => ({ message: { content: 'ENCAJE: medio\nPUNTOS FUERTES: node\nLAGUNAS: kubernetes\nCONSEJO: aprende k8s' } });
  const sin = await analizarCvContraOferta({ oferta: 'Backend Node, piden Kubernetes' }, { carpetaNotas: path.join(dirEntorno, 'notas-vacias'), chatCompletion: chatFalso });
  assert.equal(sin.ok, false, 'sin CV no inventa encaje');
  const con = await analizarCvContraOferta({ oferta: 'Backend Node, piden Kubernetes', cvTexto: 'David, 3 anos con Node.js y Express.' }, { chatCompletion: chatFalso });
  assert.equal(con.ok, true);
  assert.equal(con.fuenteCv, 'texto pegado');
  const carpetaNotas = path.join(dirEntorno, 'notas-cv');
  fs.mkdirSync(path.join(carpetaNotas, '2026-11-05'), { recursive: true });
  fs.writeFileSync(path.join(carpetaNotas, '2026-11-05', 'cv.md'), '# Mi CV\nCategoria: personal\nTags: cv\n\nNode.js, bases de datos.');
  const desde = await analizarCvContraOferta({ oferta: 'Backend Node' }, { carpetaNotas, chatCompletion: chatFalso });
  assert.equal(desde.ok, true);
  assert.match(desde.fuenteCv, /Mi CV/);
});

// ---------- Resumidor de apuntes ----------

test('Apuntes: resume las notas que encajan y las cita; sin modelo no inventa', async () => {
  const carpetaNotas = path.join(dirEntorno, 'notas-apuntes');
  fs.mkdirSync(path.join(carpetaNotas, '2026-11-05'), { recursive: true });
  fs.writeFileSync(path.join(carpetaNotas, '2026-11-05', 'redes.md'), '# Redes TCP\nCategoria: estudio\nTags: redes\n\nTCP es orientado a conexion.');
  fs.writeFileSync(path.join(carpetaNotas, '2026-11-05', 'cocina.md'), '# Receta\nCategoria: ocio\nTags: cocina\n\nHervir pasta.');
  const chatFalso = async ({ messages }) => {
    assert.match(messages[1].content, /TCP/);
    assert.doesNotMatch(messages[1].content, /pasta/i, 'no mezcla apuntes que no encajan');
    return { message: { content: '- TCP orientado a conexion' } };
  };
  const r = await resumirApuntes({ criterio: 'redes' }, { carpetaNotas, chatCompletion: chatFalso });
  assert.equal(r.ok, true);
  assert.deepEqual(r.fuentes, ['Redes TCP']);
  const sinModelo = await resumirApuntes({ criterio: 'redes' }, { carpetaNotas });
  assert.equal(sinModelo.ok, false);
  const sinCoincidencia = await resumirApuntes({ criterio: 'cuantica' }, { carpetaNotas, chatCompletion: chatFalso });
  assert.equal(sinCoincidencia.ok, false);
});

// ---------- Entrada real: calendario ----------

test('Entrada real: apuntar examen persiste por el camino de WhatsApp', async () => {
  const enviados = [];
  const rutaEntregas = path.join(dirEntorno, 'entregas2.json');
  const chatFalso = async ({ messages }) => {
    const ultimo = messages[messages.length - 1];
    if (ultimo.role === 'tool') return { message: { content: 'Apuntado, David.' } };
    return { message: { content: '', tool_calls: [{ id: 'c1', function: { name: 'registrar_entrega', arguments: { titulo: 'examen de estadistica', fecha: '2026-12-15', tipo: 'examen' } } }] } };
  };
  await bot.procesarMensajesEntrantes(sockSimulado(enviados), {
    type: 'notify',
    messages: [mensajeEntrante('apunta un examen de estadistica el 2026-12-15', 'CAR-1')]
  }, { chatCompletion: chatFalso, rutaArchivoEntregas: rutaEntregas });
  const estado = JSON.parse(fs.readFileSync(rutaEntregas, 'utf-8'));
  assert.equal(estado.entregas.length, 1);
  assert.equal(estado.entregas[0].tipo, 'examen');
});

// ---------- Entrada real: simulacro de entrevista ----------

test('Entrada real: simulacro se abre por JARVIS, las respuestas se evaluan por el interceptor y se sale con la frase', async () => {
  const enviados = [];
  const rutaEntrevistas = path.join(dirEntorno, 'entrevistas1.json');
  let llamada = 0;
  const chatFalso = async ({ messages }) => {
    llamada++;
    const ultimo = messages[messages.length - 1];
    if (ultimo.role === 'tool') return { message: { content: 'Simulacro abierto, David.' } };
    if (llamada === 1) {
      return { message: { content: '', tool_calls: [{ id: 'c1', function: { name: 'iniciar_simulacro_entrevista', arguments: { rol: 'backend junior' } } }] } };
    }
    if (llamada === 2) return { message: { content: 'Pregunta 1: que es una API REST?' } };
    return { message: { content: 'VEREDICTO: acierto\nCOMENTARIO: bien.\nSIGUIENTE: que es un middleware?' } };
  };
  const deps = { chatCompletion: chatFalso, rutaArchivoEntrevistas: rutaEntrevistas };
  const sock = sockSimulado(enviados);
  await bot.procesarMensajesEntrantes(sock, { type: 'notify', messages: [mensajeEntrante('quiero hacer un simulacro de entrevista de backend junior', 'ENT-1')] }, deps);
  assert.ok(estadoEntrevista({ rutaArchivo: rutaEntrevistas, chatId: JID_DAVID }), 'el simulacro queda activo en el chat');
  await bot.procesarMensajesEntrantes(sock, { type: 'notify', messages: [mensajeEntrante('una API REST expone recursos por HTTP', 'ENT-2')] }, deps);
  const ultimaRespuesta = enviados[enviados.length - 1].payload.text;
  assert.match(ultimaRespuesta, /VEREDICTO: acierto/, 'la respuesta se evalua por el interceptor, no por el flujo normal');
  const sesion = estadoEntrevista({ rutaArchivo: rutaEntrevistas, chatId: JID_DAVID });
  assert.equal(sesion.aciertos, 1);
  assert.equal(sesion.pregunta, 2);
  await bot.procesarMensajesEntrantes(sock, { type: 'notify', messages: [mensajeEntrante('terminar entrevista', 'ENT-3')] }, deps);
  assert.equal(estadoEntrevista({ rutaArchivo: rutaEntrevistas, chatId: JID_DAVID }), null, 'la salida es determinista');
  assert.match(enviados[enviados.length - 1].payload.text, /Simulacro cerrado/);
});
