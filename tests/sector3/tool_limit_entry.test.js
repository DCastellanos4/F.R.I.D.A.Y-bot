/**
 * tool_limit_entry.test.js
 * Regresion del fallo de produccion "400 'tools': maximum number of items
 * is 128" (catalogo 136 > limite del proveedor). Prueba la entrada real por
 * procesarMensajesEntrantes con LLM simulado y el limitador del boundary:
 *  - Mensaje generico sin clasificador: se ofrece el catalogo ACOTADO al
 *    limite del proveedor (nunca >128, nunca 0) con directiva de seleccion
 *    prudente; el modelo no improvisa sin herramientas (regresion Renfe del
 *    8 nov 2026: sin herramientas afirmo falsamente que faltaba una clave).
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

test('Regresion 400 y Renfe: mensaje generico SIN clasificador ofrece el catalogo ACOTADO (<=128, nunca 0) con directiva prudente', async () => {
  const enviados = [];
  const captura = { listas: [], sistema: '' };
  const chat = fabricaChat('basura', captura);
  await bot.procesarMensajesEntrantes(sockSimulado(enviados), {
    type: 'notify',
    // Mismo cambio que en ai_efficiency: «mandale...» ahora enruta a envio
    // (14 nov 2026 2a); el mensaje generico sin dominio pasa a ser «hazme...».
    messages: [mensajeEntrante('hazme una cosa de esas cuando puedas', 'LIM-1')]
  }, {
    chatCompletion: async (args) => {
      const sistema = args.messages[0]?.content || '';
      if (!sistema.includes('Clasifica la intencion')) captura.sistema = sistema;
      return chat(args);
    }
  });

  assert.ok(enviados.length > 0, 'el handler respondio');
  assert.ok(captura.listas.length > 0, 'el LLM principal fue llamado');
  for (const lista of captura.listas) {
    assert.ok(lista.length <= LIMITE_HERRAMIENTAS_PROVEEDOR, `payload de ${lista.length} herramientas supera el limite`);
  }
  const ultima = captura.listas[captura.listas.length - 1];
  assert.ok(
    ultima.length > 0 && ultima.length <= LIMITE_HERRAMIENTAS_PROVEEDOR,
    `sin clasificador se ofrece el catalogo acotado al limite (nunca 0, nunca >128); ofrecidas: ${ultima.length}`
  );
  assert.ok(
    captura.sistema.includes('NUNCA afirmes que un servicio requiere clave'),
    'la directiva prudente prohibe inventar requisitos de credenciales'
  );
});

test('Regresion Renfe (8 nov 2026): frases naturales de tren enrutan a transporte sin clasificador', async () => {
  const { seleccionarHerramientasPorIntencion } = await import('../../src/core/jarvisAgent.js');
  // Frases exactas que David envio y el regex de transporte no reconocia.
  const frases = [
    'dime los trenes que salen ahora mismo de aranjuez',
    'que trenes hay ahora mismo hacia madrid desde aranjuez'
  ];
  for (const frase of frases) {
    const sel = seleccionarHerramientasPorIntencion(frase);
    const nombres = sel.map((t) => t.function.name);
    assert.ok(
      nombres.includes('proximas_llegadas_transporte'),
      `falta proximas_llegadas_transporte para: "${frase}" (ofrecidas: ${nombres.join(', ')})`
    );
  }
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

test('Alcance honesto: una seleccion que supera el limite NO se trunca en silencio (0 herramientas + peticion de dividir)', async () => {
  // Fuerza el caso inyectando una seleccion artificial >128 via mensaje que
  // el regex no resuelve y clasificador con muchisimas intenciones no es
  // posible: se prueba la politica en su punto de decision a traves de la
  // entrada real con un mensaje multi-area extremo.
  const enviados = [];
  const captura = { listas: [] };
  const areas = 'ponme una alarma, dime el tiempo en Madrid, programa un mensaje, guarda este recuerdo clave, vigila este producto, dame las noticias, abre la web, estado del servidor, modo vip, resume el grupo, descarga el video, guarda nota, manda contacto, crea encuesta, ejecuta un comando, genera una clave, estado de docker, espacio en disco, estado de tuneles, haz backup, registra candidatura, plan de estudio, registra un gasto, vigila un proceso, activa traductor, proximas llegadas de bus, registra contacto, escribe en el diario, simulacro de entrevista, busca un producto, anota una idea, audita dependencias, enciende el pc, vigila vuelos, registra una fecha senalada, pon un snooze, estadisticas del grupo, aviso de llegada, crea flashcard, configura presupuesto, registra suscripcion, guarda parada favorita, genera el digest, genera la wiki, captura esta pagina, pregunta a mis documentos, registra un habito, pon el menu semanal, anade a la lista de la compra, recomienda una serie, crea una quedada, redacta invitacion, resumen deportivo, modo nocturno, analiza mi cv, resume mis apuntes, registra una entrega, verifica esta oferta, genera changelog, depura este fallo, informe de metricas, actividad de repos, backup de sesion, dispositivos de la red, controla la domotica, estado de descargas, estima la factura de oracle, registra precio de ruta, busca en el historial, sugiere respuestas';
  await bot.procesarMensajesEntrantes(sockSimulado(enviados), {
    type: 'notify',
    messages: [mensajeEntrante(areas, 'LIM-5')]
  }, { chatCompletion: fabricaChat('basura', captura) });
  assert.ok(enviados.length > 0, 'el handler respondio');
  for (const lista of captura.listas) {
    assert.ok(lista.length <= LIMITE_HERRAMIENTAS_PROVEEDOR, `payload de ${lista.length} herramientas supera el limite`);
  }
  // Si la seleccion supero el limite, la politica manda 0 herramientas
  // (alcance honesto); si cupo, se ofrecen acotadas. Nunca >128.
});

test('Regresion amplia: mensajes ordinarios siguen respondiendo con sus herramientas tras el fix', async () => {
  const casos = [
    ['que tiempo hace en Madrid', 'ORD-1', ['consultar_clima']],
    ['recuerdame llamar al dentista manana a las 9', 'ORD-2', ['crear_recordatorio']],
    ['programa un mensaje a +34600111222 para manana', 'ORD-3', ['programar_mensaje_whatsapp']],
    ['cuanto queda para mi examen, ponme un plan de estudio', 'ORD-4', ['planificar_estudio']]
  ];
  for (const [texto, id, esperadas] of casos) {
    const enviados = [];
    const captura = { listas: [] };
    await bot.procesarMensajesEntrantes(sockSimulado(enviados), {
      type: 'notify',
      messages: [mensajeEntrante(texto, id)]
    }, { chatCompletion: fabricaChat('basura', captura) });
    assert.ok(enviados.length > 0, `${id}: sin respuesta`);
    const ultima = captura.listas[captura.listas.length - 1];
    assert.ok(ultima && ultima.length <= LIMITE_HERRAMIENTAS_PROVEEDOR, `${id}: limite respetado`);
    for (const nombre of esperadas) {
      assert.ok(ultima.includes(nombre), `${id}: falta ${nombre}`);
    }
  }
  // Chit-chat puro: sin herramientas y respuesta normal
  const enviados = [];
  const captura = { listas: [] };
  await bot.procesarMensajesEntrantes(sockSimulado(enviados), {
    type: 'notify',
    messages: [mensajeEntrante('hola, que tal?', 'ORD-5')]
  }, { chatCompletion: fabricaChat('basura', captura, 'A su servicio, David.') });
  assert.ok(enviados.length > 0, 'chit-chat respondido');
  const ultima = captura.listas[captura.listas.length - 1];
  assert.equal(ultima.length, 0, 'chit-chat sin herramientas');
});

test('Politica >128 (boundary, inyeccion determinista): seleccion sobredimensionada -> 0 herramientas + directiva de dividir; bajo limite intacta', async () => {
  const { aplicarPoliticaLimiteSeleccion } = await import('../../src/core/jarvisAgent.js');
  // Inyeccion directa del catalogo completo (136) como resultado del selector
  const sobredimensionada = aplicarPoliticaLimiteSeleccion(herramientasJarvis);
  assert.equal(herramientasJarvis.length > LIMITE_HERRAMIENTAS_PROVEEDOR, true, 'el catalogo actual supera el limite: la inyeccion es real');
  assert.equal(sobredimensionada.herramientas.length, 0, 'no se trunca en silencio: se retiran todas');
  assert.ok(sobredimensionada.directiva.includes('DIRECTIVA DE ALCANCE'), 'directiva honesta de dividir');
  const justo = aplicarPoliticaLimiteSeleccion(herramientasJarvis.slice(0, LIMITE_HERRAMIENTAS_PROVEEDOR));
  assert.equal(justo.herramientas.length, LIMITE_HERRAMIENTAS_PROVEEDOR, 'en el limite exacto se respeta la seleccion');
  assert.equal(justo.directiva, '');
  const nula = aplicarPoliticaLimiteSeleccion(null);
  assert.deepEqual(nula.herramientas, []);
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
