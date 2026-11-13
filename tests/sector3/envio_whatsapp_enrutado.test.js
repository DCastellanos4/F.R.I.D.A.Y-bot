import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buscarEsquemasRelevantes } from '../../src/core/toolDiscovery.js';
import { herramientasJarvis } from '../../src/core/tools.js';
import { consultarJarvisAislado } from '../helpers/jarvisAislado.js';

// Regresion de la falla del 14 nov 2026: «explicale a mi madre en un
// mensaje...» cayo en el dominio memoria (por «mi madre») y el modelo, sin
// la herramienta de envio, respondio «No dispongo de una funcion directa
// para enviar un mensaje de WhatsApp». Dos fallos en cadena: el regex de
// enrutado no cubria esos verbos y descubrir_herramientas con contexto
// «capacidades» devolvia el inventario fijo sin cargar esquemas.

test('enrutado: variantes de envio por whatsapp llegan al dominio de envio', async () => {
  const { analizarIntencion } = await import('../../src/core/jarvisAgent.js');
  const conEnvio = [
    'explicale a mi madre en un mensaje, la computacion cuantica basica y como puede cambiar el mundo',
    'manda un whatsapp a mi madre',
    'envia un whatsapp a 34612345678',
    'cuentale a lucia por whatsapp que llego tarde',
    'explicale a mi padre en un mensaje que el domingo no voy'
  ];
  for (const frase of conEnvio) {
    const ruta = analizarIntencion(frase);
    assert.ok(ruta.intenciones.includes('mensajeProgramado'), `sin dominio de envio: ${frase}`);
    assert.ok(ruta.herramientas.some(h => h.function.name === 'programar_mensaje_whatsapp'), `sin tool de envio: ${frase}`);
  }
});

test('enrutado: no desvia recordatorios ni lecturas hacia el dominio de envio', async () => {
  const { analizarIntencion } = await import('../../src/core/jarvisAgent.js');
  const recordatorio = analizarIntencion('avisame por whatsapp cuando llegue el tren');
  assert.ok(!recordatorio.intenciones.includes('mensajeProgramado'));
  assert.ok(recordatorio.intenciones.includes('recordatorio'));
  const lectura = analizarIntencion('explicame el mensaje que me envio maria');
  assert.ok(!lectura.intenciones.includes('mensajeProgramado'));
});

test('descubrir con contexto capacidades y consulta concreta carga los esquemas que encajan', async () => {
  const capturas = [];
  let resultadoDescubrimiento = '';
  await consultarJarvisAislado('guarda en memoria que mi madre cumple anos en mayo', [], {
    chatCompletion: async p => {
      capturas.push(structuredClone(p));
      const n = capturas.length;
      if (n === 1) return { message: { content: '', tool_calls: [{ id: 'd1', function: { name: 'descubrir_herramientas', arguments: { consulta: 'enviar mensaje whatsapp a contacto', contexto: 'capacidades' } } }] } };
      const ultimoTool = [...p.messages].reverse().find(m => m.role === 'tool');
      if (ultimoTool && !resultadoDescubrimiento) resultadoDescubrimiento = ultimoTool.content;
      return { message: { content: 'Anotado, senor.' } };
    }
  });
  assert.match(resultadoDescubrimiento, /CAPACIDADES REALES/);
  assert.match(resultadoDescubrimiento, /Esquemas cargados.*programar_mensaje_whatsapp/);
  assert.ok(capturas[1].tools.some(h => h.function.name === 'programar_mensaje_whatsapp'), 'la tool de envio no se ofrecio tras el descubrimiento');
});

test('descubrir con contexto capacidades y pregunta generica no carga esquemas de relleno', async () => {
  let resultadoDescubrimiento = '';
  let n = 0;
  await consultarJarvisAislado('guarda en memoria que el wifi es de la comunidad', [], {
    chatCompletion: async p => {
      n++;
      if (n === 1) {
        return { message: { content: '', tool_calls: [{ id: 'd1', function: { name: 'descubrir_herramientas', arguments: { consulta: 'hazme un recorrido por lo que llevas dentro', contexto: 'capacidades' } } }] } };
      }
      const ultimoTool = [...p.messages].reverse().find(m => m.role === 'tool');
      if (ultimoTool) resultadoDescubrimiento = ultimoTool.content;
      return { message: { content: 'Funciones implementadas: memoria y mas.' } };
    }
  });
  assert.match(resultadoDescubrimiento, /CAPACIDADES REALES/);
  assert.doesNotMatch(resultadoDescubrimiento, /Esquemas cargados/);
});

test('buscarEsquemasRelevantes exige encaje minimo y respeta nombres exactos', () => {
  const envio = buscarEsquemasRelevantes(herramientasJarvis, { consulta: 'enviar mensaje whatsapp a contacto' });
  assert.ok(envio.some(h => h.function.name === 'programar_mensaje_whatsapp'));
  const generica = buscarEsquemasRelevantes(herramientasJarvis, { consulta: 'hazme un recorrido por lo que llevas dentro' });
  assert.equal(generica.length, 0);
  const porNombre = buscarEsquemasRelevantes(herramientasJarvis, { consulta: '', nombres: ['registrar_gasto'] });
  assert.ok(porNombre.some(h => h.function.name === 'registrar_gasto'));
});
