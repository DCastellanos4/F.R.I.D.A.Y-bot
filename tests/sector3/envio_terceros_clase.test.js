import '../helpers/estadoTmp.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buscarEsquemasRelevantes } from '../../src/core/toolDiscovery.js';
import { herramientasJarvis } from '../../src/core/tools.js';
import { normalizarNumeroTelefono } from '../../src/services/scheduledMessageService.js';
import { consultarJarvisAislado } from '../helpers/jarvisAislado.js';

// Regresion de la falla del 14 nov 2026 (2a parte). Tras PR27, la frase
// «enviale la probabilidad de lluvia a paula» volvio a negar la capacidad
// de envio. Trazas reales (14/11 10:56-11:26 UTC): routing por regex no
// reconoce «verbо + le/se» sin la palabra «mensaje»/«whatsapp» (cae en el
// dominio del contenido: clima, navegacion...); descubrir_herramientas con
// contexto «capacidades» rechazaba las consultas naturales por morfologia
// («enviar» nunca casa con «envia») y palabras de contenido; la tool
// prometia «(o contacto)» pero un nombre sin digitos siempre quedaba
// bloqueado; y la llamada bloqueada se reintentaba 4 veces identicas.

test('enrutado: envio a terceros por verbo + pronombre, sin la palabra mensaje', async () => {
  const { analizarIntencion } = await import('../../src/core/jarvisAgent.js');
  const conEnvio = [
    'enviale la probabilidad de lluvia a paula',
    'revisa el clima y mandaselo a paula',
    'enviaselo en 2 minutos cuando lo tengas',
    'enviale un resumen de esto a paula'
  ];
  for (const frase of conEnvio) {
    const ruta = analizarIntencion(frase);
    assert.ok(ruta.intenciones.includes('mensajeProgramado'), `sin dominio de envio: ${frase} -> ${ruta.intenciones}`);
    assert.ok(ruta.herramientas.some(h => h.function.name === 'programar_mensaje_whatsapp'), `sin tool de envio: ${frase}`);
  }
  // Union con el dominio del contenido: el clima sigue ofrecido para redactar.
  const rutaClima = analizarIntencion('enviale la probabilidad de lluvia a paula');
  assert.ok(rutaClima.intenciones.includes('clima'), 'el contenido (clima) debe seguir disponible');
});

test('enrutado: -me/-te/-nos y lecturas no son envios a terceros', async () => {
  const { analizarIntencion } = await import('../../src/core/jarvisAgent.js');
  const sinEnvio = [
    'avisame cuando llegue el tren',
    'dime el clima en aranjuez',
    'cuentame un chiste',
    'mi madre calza 38',
    'que le respondo',
    'explicame el mensaje que me envio maria'
  ];
  for (const frase of sinEnvio) {
    const ruta = analizarIntencion(frase);
    assert.ok(!ruta.intenciones.includes('mensajeProgramado'), `desviado a envio: ${frase} -> ${ruta.intenciones}`);
  }
});

test('descubrir: consultas naturales de envio cargan la tool; la generica no', () => {
  const cargan = [
    'enviar la probabilidad de lluvia a paula por whatsapp',
    'enviar whatsapp a paula',
    'mandar la probabilidad de lluvia a paula',
    'funcion para enviar un mensaje',
    'enviar un mensaje'
  ];
  for (const consulta of cargan) {
    const r = buscarEsquemasRelevantes(herramientasJarvis, { consulta, contexto: 'capacidades' });
    assert.ok(r.some(h => h.function.name === 'programar_mensaje_whatsapp'), `no cargo la tool de envio: ${consulta}`);
  }
  const generica = buscarEsquemasRelevantes(herramientasJarvis, { consulta: 'que sabes hacer', contexto: 'capacidades' });
  assert.ok(!generica.some(h => h.function.name === 'programar_mensaje_whatsapp'), 'pregunta generica contamino con la tool de envio');
});

test('numero: prefijo +34 duplicado y formatos con espacios se normalizan', () => {
  for (const raw of ['+34 690 35 86 64', '+34 +34 690 35 86 64', '690 35 86 64', '34690358664']) {
    const r = normalizarNumeroTelefono(raw);
    assert.ok(r.ok, `rechazado: ${raw} -> ${r.error}`);
    assert.equal(r.numero, '34690358664', `normalizacion incorrecta: ${raw} -> ${r.numero}`);
  }
});

function tmpEstado(conContactos) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'davis-envio-clase-'));
  const contactos = path.join(dir, 'contactos.json');
  fs.writeFileSync(contactos, JSON.stringify({ contactos: conContactos }));
  return { contactos, programados: path.join(dir, 'scheduled_messages.json') };
}

test('envio por nombre de contacto: se resuelve contra la agenda y pasa la guarda', async () => {
  const { contactos, programados } = tmpEstado([
    { id: 'c1', nombre: 'Paula', telefono: '34690358664', relacion: 'amiga' }
  ]);
  let n = 0;
  let resultadoTool = '';
  const { respuesta, traza } = await consultarJarvisAislado('enviale un resumen del clima a paula', [], {
    retornarTraza: true,
    rutaArchivoContactos: contactos,
    rutaArchivoProgramados: programados,
    chatCompletion: async p => {
      n++;
      if (n === 1) return { message: { content: '', tool_calls: [{ id: 's1', function: { name: 'programar_mensaje_whatsapp', arguments: { numero: 'paula', mensaje: 'Probabilidad de lluvia hoy: 70%', minutosEnElFuturo: 5 } } }] } };
      const ultimoTool = [...p.messages].reverse().find(m => m.role === 'tool');
      if (ultimoTool) resultadoTool = ultimoTool.content;
      return { message: { content: 'Programado, senor.' } };
    }
  });
  const llamada = traza.llamadas.find(l => l.nombre === 'programar_mensaje_whatsapp');
  assert.ok(llamada, 'el modelo no llamo a la tool de envio');
  assert.notEqual(llamada.resultado, 'destinatario_no_verificado', 'contacto registrado no debio quedar bloqueado');
  assert.match(respuesta, /Programado/);
  assert.match(resultadoTool, /Mensaje programado con éxito/, 'la programacion no se confirmo');
  assert.match(resultadoTool, /\+34690358664/, 'el nombre debio resolverse al telefono del contacto');
});

test('envio por nombre con agenda vacia: numero aportado en el chat junto al nombre verifica', async () => {
  const { contactos, programados } = tmpEstado([]);
  const historial = [{ role: 'user', content: '+34 612 34 56 78 este es el numero de paula' }];
  let n = 0;
  let resultadoTool = '';
  const { traza } = await consultarJarvisAislado('enviale la probabilidad de lluvia a paula', historial, {
    retornarTraza: true,
    rutaArchivoContactos: contactos,
    rutaArchivoProgramados: programados,
    chatCompletion: async p => {
      n++;
      if (n === 1) return { message: { content: '', tool_calls: [{ id: 'c1', function: { name: 'programar_mensaje_whatsapp', arguments: { numero: 'Paula', mensaje: 'Lluvia: 70%', minutosEnElFuturo: 5 } } }] } };
      const ultimoTool = [...p.messages].reverse().find(m => m.role === 'tool');
      if (ultimoTool) resultadoTool = ultimoTool.content;
      return { message: { content: 'Programado, senor.' } };
    }
  });
  const llamada = traza.llamadas.find(l => l.nombre === 'programar_mensaje_whatsapp');
  assert.ok(llamada, 'el modelo no llamo a la tool de envio');
  assert.notEqual(llamada.resultado, 'destinatario_no_verificado', 'numero dado en el chat no debio quedar bloqueado');
  assert.match(resultadoTool, /\+34612345678/, 'el nombre debio resolverse al numero aportado en el chat');
});

test('envio por nombre con numeros distintos en el chat: no se adivina la asociacion', async () => {
  const { contactos, programados } = tmpEstado([]);
  const historial = [
    { role: 'user', content: 'el numero de paula es 612345678' },
    { role: 'user', content: 'apunta tambien el de paula por si acaso: 698765432' }
  ];
  let n = 0;
  const { traza } = await consultarJarvisAislado('enviale un mensaje a paula en 5 minutos', historial, {
    retornarTraza: true,
    rutaArchivoContactos: contactos,
    rutaArchivoProgramados: programados,
    chatCompletion: async () => {
      n++;
      if (n === 1) return { message: { content: '', tool_calls: [{ id: 'a1', function: { name: 'programar_mensaje_whatsapp', arguments: { numero: 'paula', mensaje: 'prueba', minutosEnElFuturo: 5 } } }] } };
      return { message: { content: 'Necesito que me confirmes el numero.' } };
    }
  });
  const llamada = traza.llamadas.find(l => l.nombre === 'programar_mensaje_whatsapp');
  assert.ok(llamada, 'el modelo no llamo a la tool de envio');
  assert.equal(llamada.resultado, 'destinatario_no_verificado', 'con dos numeros distintos la guarda debe seguir bloqueando');
});

test('descubrir: el inventario de contexto no se repite entero en la misma consulta', async () => {
  const { contactos, programados } = tmpEstado([]);
  let n = 0;
  let todosLosToolMsgs = [];
  await consultarJarvisAislado('si crealo', [], {
    retornarTraza: true,
    rutaArchivoContactos: contactos,
    rutaArchivoProgramados: programados,
    chatCompletion: async p => {
      // La primera llamada es el clasificador del safety net: se deja fallar.
      if ((p.messages[0]?.content || '').includes('Clasifica la intencion')) return { message: { content: 'respuesta invalida' } };
      n++;
      if (n <= 2) return { message: { content: '', tool_calls: [{ id: `d${n}`, function: { name: 'descubrir_herramientas', arguments: { consulta: 'registrar contacto de paula', contexto: 'capacidades' } } }] } };
      todosLosToolMsgs = p.messages.filter(m => m.role === 'tool').map(m => m.content);
      return { message: { content: 'Hecho.' } };
    }
  });
  assert.equal(todosLosToolMsgs.length, 2, 'debieron ejecutarse las dos llamadas de descubrimiento');
  assert.match(todosLosToolMsgs[0], /CAPACIDADES REALES/, 'la primera entrega no trajo el inventario completo');
  assert.match(todosLosToolMsgs[1], /ya entregado en esta consulta/, 'la segunda llamada no recibio el apunte de deduplicacion');
  assert.doesNotMatch(todosLosToolMsgs[1], /CAPACIDADES REALES/, 'el inventario completo se repitio');
  // Los esquemas ya cargados en la primera llamada no se repiten; el apunte
  // remite a ellos (cargar de nuevo seria duplicar tokens).
  assert.match(todosLosToolMsgs[1], /esquemas ya cargados/, 'el apunte no remite a los esquemas ya cargados');
});

test('envio bloqueado: reintentos identicos se suprimen en la misma consulta', async () => {
  const { contactos, programados } = tmpEstado([]);
  let n = 0;
  const capturas = [];
  const { traza } = await consultarJarvisAislado('enviale un mensaje a paula en 5 minutos', [], {
    retornarTraza: true,
    rutaArchivoContactos: contactos,
    rutaArchivoProgramados: programados,
    chatCompletion: async p => {
      n++;
      capturas.push(p);
      if (n <= 2) return { message: { content: '', tool_calls: [{ id: `b${n}`, function: { name: 'programar_mensaje_whatsapp', arguments: { numero: '690358664', mensaje: 'prueba', minutosEnElFuturo: 5 } } }] } };
      return { message: { content: 'Necesito el numero de Paula.' } };
    }
  });
  const llamadas = traza.llamadas.filter(l => l.nombre === 'programar_mensaje_whatsapp');
  assert.equal(llamadas.length, 2, 'se registraron ambas llamadas');
  assert.equal(llamadas[0].resultado, 'destinatario_no_verificado');
  assert.equal(llamadas[1].resultado, 'destinatario_no_verificado_reintento', 'el reintento identico no fue marcado');
  const ultimoTool = [...capturas[2].messages].reverse().find(m => m.role === 'tool');
  assert.match(ultimoTool.content, /ya fue bloqueada/, 'el reintento no recibio el aviso de no repetir');
});
