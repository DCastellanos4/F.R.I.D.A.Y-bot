/**
 * wellness_entry.test.js
 * Pruebas del bloque bienestar (nº 43 diario, 44 habitos, 45 menus,
 * 46 lista de la compra, 47 recomendador series/pelis, 48 quedadas,
 * 49 resumen deportivo, 50 modo desconexion nocturno) por la entrada real
 * de WhatsApp y a nivel de router/servicio.
 *
 * Strict Policy: Zero Emojis.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'path';
import os from 'os';

const dirEntorno = fs.mkdtempSync(path.join(os.tmpdir(), 'davis-bienestar-'));
process.env.DAVIS_HISTORY_DIR = path.join(dirEntorno, 'history');
process.env.NODE_ENV = 'test';

const bot = await import('../../whatsappBot.js');
const { analizarIntencion } = await import('../../src/core/jarvisAgent.js');
const { registrarHabito, marcarHabito, listarHabitos } = await import('../../src/services/habitsService.js');
const { ponerMenu, verMenu, sugerirMenu } = await import('../../src/services/menuService.js');
const { configurarModoNocturno, enHorarioSilencio } = await import('../../src/services/quietHoursService.js');
const { resumenDeportivo } = await import('../../src/services/sportsService.js');
const { crearQuedada, redactarInvitacion } = await import('../../src/services/quedadasService.js');
const { recomendarSeriePelicula } = await import('../../src/services/recommenderService.js');
const { RAMAS_CURADAS } = await import('../../src/services/newsService.js');

const JID_DAVID = '123456789012345@lid';

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

// ---------- Router ----------

test('Router: "quiero seguir el habito de leer 20 minutos" solo encaja en bienestar', () => {
  const r = analizarIntencion('quiero seguir el habito de leer 20 minutos');
  assert.ok(r.intenciones.includes('bienestar'));
  const nombres = r.herramientas.map((h) => h.function.name);
  assert.ok(nombres.includes('registrar_habito'), 'falta registrar_habito');
});

test('Router: diario, compra, recomendacion, quedada, deporte y modo nocturno ofrecen sus herramientas', () => {
  const casos = [
    ['apunta en el diario que hoy aprobe el examen de estadistica', 'escribir_diario'],
    ['añade leche y huevos a la lista de la compra', 'anadir_compra'],
    ['recomiendame una pelicula de suspense', 'recomendar_serie_pelicula'],
    ['organiza una quedada: cena con la uni el viernes', 'crear_quedada'],
    ['resumen deportivo de hoy', 'resumen_deportivo'],
    ['activa el modo nocturno de 23:30 a 7:00', 'configurar_modo_nocturno']
  ];
  for (const [frase, herramienta] of casos) {
    const r = analizarIntencion(frase);
    const nombres = r.herramientas.map((h) => h.function.name);
    assert.ok(nombres.includes(herramienta), `"${frase}" no ofrece ${herramienta}`);
  }
});

// ---------- Servicios ----------

test('Habitos: registrar, marcar hoy y ayer da racha de 2', () => {
  const ruta = path.join(dirEntorno, 'habitos1.json');
  const ahora = '2026-11-05T18:00:00+01:00';
  assert.equal(registrarHabito({ nombre: 'leer 20 minutos' }, { rutaArchivo: ruta, ahora }).ok, true);
  assert.equal(marcarHabito({ criterio: 'leer' }, { rutaArchivo: ruta, ahora }).racha, 1);
  assert.equal(marcarHabito({ criterio: 'leer', fecha: '2026-11-04' }, { rutaArchivo: ruta, ahora }).racha, 2);
  const lista = listarHabitos({ rutaArchivo: ruta, ahora });
  assert.equal(lista[0].hechoHoy, true);
  assert.equal(lista[0].racha, 2);
});

test('Menus: poner y ver; sugerir sin modelo no inventa', async () => {
  const ruta = path.join(dirEntorno, 'menus1.json');
  assert.equal(ponerMenu({ dia: 'lunes', comida: 'lentejas', cena: 'tortilla' }, { rutaArchivo: ruta, ahora: '2026-11-05T18:00:00+01:00' }).ok, true);
  const v = verMenu({}, { rutaArchivo: ruta, ahora: '2026-11-05T18:00:00+01:00' });
  assert.match(v.lineas.join('\n'), /lunes: lentejas \/ tortilla/);
  const s = await sugerirMenu({}, { rutaArchivo: ruta });
  assert.equal(s.ok, false, 'sin modelo no propone menu');
});

test('Modo nocturno: la franja que cruza medianoche silencia de noche y no de dia', () => {
  const ruta = path.join(dirEntorno, 'nocturno1.json');
  configurarModoNocturno({ activo: true, desde: '23:00', hasta: '08:00' }, { rutaArchivo: ruta });
  assert.equal(enHorarioSilencio({ rutaArchivo: ruta, ahora: '2026-11-05T23:30:00+01:00' }), true);
  assert.equal(enHorarioSilencio({ rutaArchivo: ruta, ahora: '2026-11-06T03:00:00+01:00' }), true);
  assert.equal(enHorarioSilencio({ rutaArchivo: ruta, ahora: '2026-11-05T12:00:00+01:00' }), false);
  configurarModoNocturno({ activo: false }, { rutaArchivo: ruta });
  assert.equal(enHorarioSilencio({ rutaArchivo: ruta, ahora: '2026-11-05T23:30:00+01:00' }), false, 'desactivado nunca silencia');
});

test('Modo nocturno: drenarColaAlertas retiene la cola dentro de la franja', async () => {
  const ruta = path.join(dirEntorno, 'nocturno2.json');
  configurarModoNocturno({ activo: true, desde: '23:00', hasta: '08:00' }, { rutaArchivo: ruta });
  let drenadas = 0;
  const quietDeps = { rutaArchivo: ruta, ahora: '2026-11-06T02:00:00+01:00' };
  const r1 = await bot.drenarColaAlertas({ quietDeps, drenar: () => { drenadas++; return []; } });
  assert.deepEqual(r1, []);
  assert.equal(drenadas, 0, 'dentro de la franja la cola NO se drena');
  const quietDepsDia = { rutaArchivo: ruta, ahora: '2026-11-06T12:00:00+01:00' };
  await bot.drenarColaAlertas({ quietDeps: quietDepsDia, drenar: () => { drenadas++; return []; } });
  assert.equal(drenadas, 1, 'fuera de la franja la cola se drena');
});

test('Deporte: usa la rama deportes de fuentes reales y no inventa sin noticias', async () => {
  assert.ok(RAMAS_CURADAS.deportes && RAMAS_CURADAS.deportes.fuentes.length > 0, 'newsService debe tener fuentes RSS deportivas');
  const noticiasFalsas = [{ titulo: 'El Madrid gana 2-0 con gol de Bellingham', enlace: 'https://ejemplo.invalid/1' }, { titulo: 'Alcaraz pasa a semifinales', enlace: 'https://ejemplo.invalid/2' }];
  const chatFalso = async ({ messages }) => {
    assert.match(messages[1].content, /Bellingham/);
    return { message: { content: 'Resumen: victoria del Madrid y Alcaraz en semis.' } };
  };
  const r = await resumenDeportivo({}, { obtenerNoticias: async () => noticiasFalsas, chatCompletion: chatFalso });
  assert.equal(r.ok, true);
  assert.match(r.resumen, /Alcaraz/);
  const r2 = await resumenDeportivo({}, { obtenerNoticias: async () => [] });
  assert.equal(r2.ok, false, 'sin titulares reales no inventa');
});

test('Recomendador: no repite titulos ya recomendados y persiste el historial', async () => {
  const ruta = path.join(dirEntorno, 'recomendador1.json');
  const chatFalso = async ({ messages }) => ({ message: { content: '- Dune (2021): epica de ciencia ficcion\n- Interstellar (2014): viaje espacial\n- Arrival (2016): primer contacto' } });
  const r1 = await recomendarSeriePelicula({ genero: 'ciencia ficcion' }, { rutaArchivo: ruta, chatCompletion: chatFalso });
  assert.equal(r1.ok, true);
  const estado = JSON.parse(fs.readFileSync(ruta, 'utf-8'));
  assert.deepEqual(estado.recomendadas, ['Dune', 'Interstellar', 'Arrival']);
  let promptVisto = '';
  const chatFalso2 = async ({ messages }) => { promptVisto = messages[0].content; return { message: { content: '- Tenet (2020): inversion temporal' } }; };
  await recomendarSeriePelicula({ genero: 'ciencia ficcion' }, { rutaArchivo: ruta, chatCompletion: chatFalso2 });
  assert.match(promptVisto, /Dune/, 'la segunda llamada declara lo ya recomendado');
});

test('Quedadas: la invitacion es solo borrador y el servicio no envia nada', async () => {
  const ruta = path.join(dirEntorno, 'quedadas1.json');
  const c = crearQuedada({ titulo: 'cena con la uni', fecha: '2026-11-07', hora: '21:00', lugar: 'La Surena', participantes: ['Ana', 'Pablo'] }, { rutaArchivo: ruta });
  assert.equal(c.ok, true);
  const r = await redactarInvitacion({ criterio: 'cena' }, { rutaArchivo: ruta, chatCompletion: async () => ({ message: { content: 'El viernes cena en La Surena a las 21:00, os apuntais?' } }) });
  assert.equal(r.ok, true);
  assert.match(r.nota, /no lo mando/i, 'se declara que el bot no lo envia');
  assert.ok(!Object.keys(r).includes('enviado'), 'el servicio no expone ningun envio');
});

// ---------- Entrada real de WhatsApp ----------

test('Entrada real: escribir en el diario persiste la entrada del dia', async () => {
  const enviados = [];
  const carpetaDiario = path.join(dirEntorno, 'diario1');
  const chatFalso = async ({ messages }) => {
    const ultimo = messages[messages.length - 1];
    if (ultimo.role === 'tool') return { message: { content: 'Apuntado en tu diario, David.' } };
    return { message: { content: '', tool_calls: [{ id: 'c1', function: { name: 'escribir_diario', arguments: { texto: 'Hoy aprobe estadistica y sali a correr.' } } }] } };
  };
  await bot.procesarMensajesEntrantes(sockSimulado(enviados), {
    type: 'notify',
    messages: [mensajeEntrante('apunta en el diario que hoy aprobe estadistica y sali a correr', 'BIE-1')]
  }, { chatCompletion: chatFalso, carpetaDiario });
  const hoy = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Madrid' });
  const contenido = fs.readFileSync(path.join(carpetaDiario, `${hoy}.md`), 'utf-8');
  assert.match(contenido, /aprobe estadistica/);
  assert.ok(enviados.length >= 1, 'responde por WhatsApp');
});

test('Entrada real: anadir a la compra persiste y se lista despues', async () => {
  const enviados = [];
  const rutaCompra = path.join(dirEntorno, 'compra1.json');
  const chatFalso = async ({ messages }) => {
    const ultimo = messages[messages.length - 1];
    if (ultimo.role === 'tool') return { message: { content: 'Anadido, David.' } };
    return { message: { content: '', tool_calls: [{ id: 'c1', function: { name: 'anadir_compra', arguments: { items: ['leche', 'huevos'] } } }] } };
  };
  await bot.procesarMensajesEntrantes(sockSimulado(enviados), {
    type: 'notify',
    messages: [mensajeEntrante('añade leche y huevos a la lista de la compra', 'BIE-2')]
  }, { chatCompletion: chatFalso, rutaArchivoCompra: rutaCompra });
  const estado = JSON.parse(fs.readFileSync(rutaCompra, 'utf-8'));
  assert.deepEqual(estado.items, ['leche', 'huevos']);
});

test('Entrada real: activar el modo nocturno persiste la config', async () => {
  const enviados = [];
  const rutaNocturno = path.join(dirEntorno, 'nocturno3.json');
  const chatFalso = async ({ messages }) => {
    const ultimo = messages[messages.length - 1];
    if (ultimo.role === 'tool') return { message: { content: 'Modo nocturno activado, David.' } };
    return { message: { content: '', tool_calls: [{ id: 'c1', function: { name: 'configurar_modo_nocturno', arguments: { activo: true, desde: '23:30', hasta: '07:00' } } }] } };
  };
  await bot.procesarMensajesEntrantes(sockSimulado(enviados), {
    type: 'notify',
    messages: [mensajeEntrante('activa el modo nocturno de 23:30 a 7:00', 'BIE-3')]
  }, { chatCompletion: chatFalso, rutaArchivoNocturno: rutaNocturno });
  const cfg = JSON.parse(fs.readFileSync(rutaNocturno, 'utf-8'));
  assert.equal(cfg.activo, true);
  assert.equal(cfg.desde, '23:30');
  assert.equal(cfg.hasta, '07:00');
});
