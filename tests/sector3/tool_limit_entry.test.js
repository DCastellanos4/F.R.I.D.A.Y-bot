/**
 * tool_limit_entry.test.js
 * Regresion del fallo de produccion "400 'tools': maximum number of items
 * is 128" (catalogo 136 > limite del proveedor). Prueba la entrada real por
 * procesarMensajesEntrantes con LLM simulado y el limitador del boundary:
 *  - Mensaje generico sin clasificador: nunca se vuelca el catalogo; se pide
 *    una aclaracion sin herramientas.
 *  - Generico con clasificador disponible, multi-intencion, URL y un caso
 *    especial: siempre <=128 y con las herramientas correctas (incluidas las
 *    nuevas 50).
 *  - Multi-ronda: las herramientas no se sueltan entre rondas.
 *  - Limitador: conserva primero las herramientas ya usadas en la
 *    conversacion y devuelve objetos de esquema completo.
 *
 * Strict Policy: Zero Emojis.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'path';
import os from 'os';

const dirEntorno = fs.mkdtempSync(path.join(os.tmpdir(), 'davis-tool-limit-'));
process.env.DAVIS_HISTORY_DIR = path.join(dirEntorno, 'history');
process.env.NODE_ENV = 'test';

const bot = await import('../../whatsappBot.js');
const { herramientasJarvis, limitarHerramientasParaProveedor, LIMITE_HERRAMIENTAS_PROVEEDOR } = await import('../../src/core/tools.js');

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

// Clasificador simulable: 'basura' -> respuesta imparseable (null), 'finanzas'
// -> clasificacion valida de alta confianza. Captura TODAS las listas de
// herramientas que recibiria el proveedor.
// Registra TODAS las llamadas al LLM: listas = herramientas recibidas en la
// llamada principal (la que no es del clasificador), una entrada por ronda.
function fabricaChat(modoClasificador, captura, respuestaFinal = 'Aclarame que necesitas, David.') {
  return async ({ messages, tools }) => {
    const sistema = messages[0]?.content || '';
    if (sistema.includes('Clasifica la intencion')) {
      if (modoClasificador === 'basura') return { message: { content: 'no lo tengo claro del todo' } };
      return { message: { content: JSON.stringify({ intencion: modoClasificador, confianza: 0.93 }) } };
    }
    captura.listas.push(Array.isArray(tools) ? tools.map((t) => t.function.name) : []);
    return { message: { content: respuestaFinal } };
  };
}

test('Regresion 400: mensaje generico SIN clasificador no vuelca el catalogo (<=128, sin herramientas) y pide aclaracion', async () => {
  const enviados = [];
  const captura = { listas: [] };
  await bot.procesarMensajesEntrantes(sockSimulado(enviados), {
    type: 'notify',
    messages: [mensajeEntrante('mandale una cosa de esas cuando puedas', 'LIM-1')]
  }, { chatCompletion: fabricaChat('basura', captura) });

  assert.ok(enviados.length > 0, 'el handler respondio');
  assert.ok(captura.listas.length > 0, 'el LLM principal fue llamado');
  for (const lista of captura.listas) {
    assert.ok(lista.length <= LIMITE_HERRAMIENTAS_PROVEEDOR, `payload de ${lista.length} herramientas supera el limite`);
  }
  const ultima = captura.listas[captura.listas.length - 1];
  assert.equal(ultima.length, 0, 'sin clasificador no se ofrecen herramientas (fallback honesto)');
});

test('Regresion 400: mensaje generico CON clasificador recibe solo las herramientas de la intencion', async () => {
  const enviados = [];
  const captura = { listas: [] };
  await bot.procesarMensajesEntrantes(sockSimulado(enviados), {
    type: 'notify',
    messages: [mensajeEntrante('mandale una foto de amor a paula', 'LIM-2')]
  }, { chatCompletion: fabricaChat('mensajeProgramado', captura) });

  const ultima = captura.listas[captura.listas.length - 1];
  assert.ok(ultima.length <= LIMITE_HERRAMIENTAS_PROVEEDOR);
  assert.ok(ultima.includes('programar_mensaje_whatsapp'), 'incluye la herramienta de la intencion clasificada');
  assert.ok(ultima.length < 20, 'seleccion acotada, no el catalogo entero');
});

test('Multi-intencion, URL y caso especial: siempre <=128 y con las herramientas correctas', async () => {
  const casos = [
    ['ponme una alarma manana y dime que tiempo hace en Madrid', 'LIM-3A', ['crear_recordatorio', 'consultar_clima']],
    ['haz un backup cifrado ahora', 'LIM-3C', ['trigger_encrypted_backup']]
  ];
  for (const [texto, id, esperadas] of casos) {
    const enviados = [];
    const captura = { listas: [] };
    await bot.procesarMensajesEntrantes(sockSimulado(enviados), {
      type: 'notify',
      messages: [mensajeEntrante(texto, id)]
    }, { chatCompletion: fabricaChat('basura', captura) });
    const ultima = captura.listas[captura.listas.length - 1];
    assert.ok(ultima.length <= LIMITE_HERRAMIENTAS_PROVEEDOR, `${id}: ${ultima.length} herramientas superan el limite`);
    for (const nombre of esperadas) {
      assert.ok(ultima.includes(nombre), `${id}: falta ${nombre}`);
    }
  }
});

test('URL: el router selecciona navegacion/resumen y el consumo queda acotado a <=128', async () => {
  const { seleccionarHerramientasPorIntencion } = await import('../../src/core/jarvisAgent.js');
  const sel = seleccionarHerramientasPorIntencion('abre la pagina https://example.com/articulo y dime de que va');
  const nombres = sel.map((t) => t.function.name);
  assert.ok(nombres.includes('navegar_y_leer_noticia'), 'el router ofrece navegacion para una URL');
  assert.ok(limitarHerramientasParaProveedor(sel).length <= LIMITE_HERRAMIENTAS_PROVEEDOR);
});

test('Multi-ronda: la lista de herramientas es estable entre rondas de function calling', async () => {
  const enviados = [];
  const captura = { listas: [] };
  let ronda = 0;
  const chat = async ({ messages, tools }) => {
    captura.listas.push(Array.isArray(tools) ? tools.map((t) => t.function.name) : []);
    ronda++;
    if (ronda === 1) {
      return { message: { content: '', tool_calls: [{ id: 'c1', function: { name: 'consultar_clima', arguments: { ciudad: 'Madrid' } } }] } };
    }
    return { message: { content: 'Hoy en Madrid: despejado, 22 grados.' } };
  };
  await bot.procesarMensajesEntrantes(sockSimulado(enviados), {
    type: 'notify',
    messages: [mensajeEntrante('que tiempo hace en Madrid', 'LIM-4')]
  }, { chatCompletion: chat });
  assert.ok(captura.listas.length >= 2, 'hubo al menos dos rondas');
  assert.deepEqual(captura.listas[0], captura.listas[1], 'las herramientas no cambian entre rondas');
  assert.ok(captura.listas[0].includes('consultar_clima'));
});

test('Limitador: catalogo sobredimensionado preserva primero las herramientas en uso y el esquema completo', () => {
  const extra = herramientasJarvis[herramientasJarvis.length - 1];
  const historial = [{ role: 'assistant', tool_calls: [{ id: 'x', function: { name: extra.function.name, arguments: {} } }] }];
  const seleccion = limitarHerramientasParaProveedor(herramientasJarvis, historial, 100);
  assert.equal(seleccion.length, 100, 'acota exactamente al limite');
  assert.ok(seleccion.some((t) => t.function.name === extra.function.name), 'la herramienta en uso sobrevive al recorte');
  for (const t of seleccion) {
    assert.equal(t.type, 'function', 'objeto de herramienta completo');
    assert.ok(t.function?.name && t.function?.parameters, 'esquema valido');
  }
  assert.equal(limitarHerramientasParaProveedor(herramientasJarvis.slice(0, 10)).length, 10, 'bajo el limite se devuelve intacto');
  assert.deepEqual(limitarHerramientasParaProveedor(null), [], 'entrada invalida -> lista vacia');
});
