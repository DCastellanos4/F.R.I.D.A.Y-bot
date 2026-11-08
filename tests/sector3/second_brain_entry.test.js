/**
 * second_brain_entry.test.js
 * Pruebas del bloque segundo cerebro (nº 37 contactos, 38 busqueda semantica,
 * 39 digest semanal, 40 wiki, 41 captura web, 42 preguntas a documentos)
 * por la entrada real de WhatsApp y a nivel de router/servicio.
 *
 * Strict Policy: Zero Emojis.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'path';
import os from 'os';

const dirEntorno = fs.mkdtempSync(path.join(os.tmpdir(), 'davis-cerebro-'));
process.env.DAVIS_DATA_DIR = path.join(dirEntorno, 'data');
process.env.DAVIS_HISTORY_DIR = path.join(dirEntorno, 'history');
process.env.NODE_ENV = 'test';

const bot = await import('../../whatsappBot.js');
const { analizarIntencion } = await import('../../src/core/jarvisAgent.js');
const { buscarSemantico } = await import('../../src/services/brainSearchService.js');
const { generarDigest, lanzarDigestSemanal, configurarDigestSemanal } = await import('../../src/services/brainDigestService.js');
const { generarWiki } = await import('../../src/services/wikiService.js');
const { preguntarDocumentos } = await import('../../src/services/preguntasDocumentosService.js');
const { capturarPagina } = await import('../../src/services/capturaService.js');

const JID_DAVID = '149868706304033@lid';
const carpetaNotas = path.join(dirEntorno, 'notas');

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

function sembrarNota(dia, fichero, contenido) {
  const dir = path.join(carpetaNotas, dia);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, fichero), contenido);
}

const hoy = new Date().toISOString().slice(0, 10);
sembrarNota(hoy, 'tcp.md', '# Apuntes de redes\nCategoria: estudio\nTags: redes, tcp\n\nTCP es orientado a conexion y garantiza el orden de los segmentos. El three-way handshake es SYN, SYN-ACK, ACK.');
sembrarNota(hoy, 'receta.md', '# Receta de pasta\nCategoria: ocio\nTags: cocina\n\nHervir la pasta 8 minutos.');

test('Router: "que se tiene apuntado sobre Ana" ofrece herramientas de contactos', () => {
  const r = analizarIntencion('guarda el contacto de Ana, 600123123, amiga de la uni');
  const nombres = r.herramientas.map((h) => h.function.name);
  assert.ok(nombres.includes('registrar_contacto'), 'falta registrar_contacto');
});

test('Entrada real: registrar contacto lo persiste y lo busca', async () => {
  const enviados = [];
  const rutaContactos = path.join(dirEntorno, 'contactos1.json');
  const chatFalso = async ({ messages }) => {
    const ultimo = messages[messages.length - 1];
    if (ultimo.role === 'tool') return { message: { content: 'Ficha guardada, David.' } };
    return { message: { content: '', tool_calls: [{ id: 'c1', function: { name: 'registrar_contacto', arguments: { nombre: 'Ana', telefono: '600123123', relacion: 'amiga de la uni' } } }] } };
  };
  await bot.procesarMensajesEntrantes(sockSimulado(enviados), {
    type: 'notify',
    messages: [mensajeEntrante('guarda el contacto de Ana, 600123123, amiga de la uni', 'CER-1')]
  }, { chatCompletion: chatFalso, rutaArchivoContactos: rutaContactos });
  const estado = JSON.parse(fs.readFileSync(rutaContactos, 'utf-8'));
  assert.equal(estado.contactos.length, 1);
  assert.equal(estado.contactos[0].telefono, '600123123');
});

test('Busqueda semantica: el modelo elige por significado y se declara el modo', async () => {
  const chatFalso = async ({ messages }) => {
    assert.match(messages[1].content, /handshake/);
    const linea = messages[1].content.split('\n').find((l) => /handshake/.test(l));
    const numero = linea.match(/^(\d+)\./)[1];
    return { message: { content: numero } }; // seleccion por contenido, nunca por el orden accidental
  };
  const r = await buscarSemantico('como se establece una conexion fiable en redes', { carpetaNotas, chatCompletion: chatFalso });
  assert.equal(r.ok, true);
  assert.equal(r.semantica, true);
  assert.ok(r.resultados.length >= 1);
  const r2 = await buscarSemantico('conexion fiable', { carpetaNotas });
  assert.equal(r2.semantica, false, 'sin modelo se declara busqueda por palabras');
});

test('Digest: bajo demanda resume las notas recientes; semanal solo con opt-in y una vez por semana', async () => {
  const chatFalso = async () => ({ message: { content: 'Esta semana: redes (TCP) y una receta.' } });
  const r = await generarDigest({ dias: 7 }, { carpetaNotas, chatCompletion: chatFalso });
  assert.equal(r.ok, true);
  assert.match(r.texto, /redes/i);
  const rutaDigest = path.join(dirEntorno, 'digest.json');
  const encoladas = [];
  // Sin opt-in: no envia aunque sea lunes.
  const lunes = '2026-11-02T09:00:00+01:00';
  const r1 = await lanzarDigestSemanal({ rutaArchivo: rutaDigest, carpetaNotas, ahora: lunes, enqueue: (a) => encoladas.push(a) });
  assert.equal(r1.enviado, false, 'sin opt-in no hay digest proactivo');
  configurarDigestSemanal({ activo: true }, { rutaArchivo: rutaDigest });
  const r2 = await lanzarDigestSemanal({ rutaArchivo: rutaDigest, carpetaNotas, ahora: lunes, enqueue: (a) => encoladas.push(a), chatCompletion: chatFalso });
  assert.equal(r2.enviado, true);
  const r3 = await lanzarDigestSemanal({ rutaArchivo: rutaDigest, carpetaNotas, ahora: lunes, enqueue: (a) => encoladas.push(a), chatCompletion: chatFalso });
  assert.equal(r3.enviado, false, 'una sola vez por semana');
});

test('Wiki: indice navegable por categorias con enlaces relativos', () => {
  const r = generarWiki({ carpetaNotas });
  assert.equal(r.ok, true);
  const indice = fs.readFileSync(r.rutaIndice, 'utf-8');
  assert.match(indice, /## estudio/);
  assert.match(indice, /\[Apuntes de redes\]\(\.\.\/notas\//);
  assert.match(indice, /#redes/);
});

test('Preguntas a documentos: responde citando fuentes; sin tema lo dice', async () => {
  const chatFalso = async ({ messages }) => {
    assert.match(messages[1].content, /TCP es orientado a conexion/);
    return { message: { content: 'TCP garantiza orden y conexion. Fuentes: [1] Apuntes de redes' } };
  };
  const r = await preguntarDocumentos({ pregunta: 'que dicen mis apuntes de redes sobre TCP' }, { carpetaNotas, chatCompletion: chatFalso });
  assert.equal(r.ok, true);
  assert.match(r.respuesta, /Fuentes/);
  const r2 = await preguntarDocumentos({ pregunta: 'que se de astrofisica cuantica' }, { carpetaNotas, chatCompletion: chatFalso });
  assert.match(r2.respuesta, /No encuentro nada/);
});

test('Captura web: extrae con navegador inyectado y archiva con fuente; rechaza esquemas raros', async () => {
  const extraerFalso = async (url) => ({ titulo: 'Articulo de ejemplo', contenido: 'Contenido largo del articulo capturado para la prueba, suficiente para pasar el minimo.' });
  const r = await capturarPagina({ url: 'https://example.com/articulo' }, { extraerArticulo: extraerFalso });
  // savePersonalNote escribe en la carpeta real del repo (data/notes); comprobamos el resultado, no la ruta.
  assert.equal(r.ok, true);
  assert.match(r.titulo, /Articulo de ejemplo/);
  const r2 = await capturarPagina({ url: 'file:///etc/passwd' }, { extraerArticulo: extraerFalso });
  assert.equal(r2.ok, false, 'esquema no web rechazado');
});

test('Guard de opt-in del digest semanal: sin peticion textual no se activa', async () => {
  const enviados = [];
  const rutaDigest = path.join(dirEntorno, 'digest2.json');
  const chatFalso = async ({ messages }) => {
    const ultimo = messages[messages.length - 1];
    if (ultimo.role === 'tool') return { message: { content: 'Hecho.' } };
    return { message: { content: '', tool_calls: [{ id: 'c1', function: { name: 'configurar_digest_semanal', arguments: { activo: true } } }] } };
  };
  await bot.procesarMensajesEntrantes(sockSimulado(enviados), {
    type: 'notify',
    messages: [mensajeEntrante('como va mi segundo cerebro', 'CER-2')]
  }, { chatCompletion: chatFalso, rutaArchivoDigest: rutaDigest, carpetaNotas });
  assert.equal(fs.existsSync(rutaDigest), false, 'rechazado por el guard: el servicio nunca se ejecuta, no se persiste nada');
});
