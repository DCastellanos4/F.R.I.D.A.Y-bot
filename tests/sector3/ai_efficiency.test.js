import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crearPresupuestoGroq, duracionCabecera, estimarTokensPeticion } from '../../src/core/groqBudget.js';
import { chatCompletion, reiniciarCircuitoModelos } from '../../src/core/llmService.js';
import { buscarEsquemas, prepararHerramientasProgresivas, HERRAMIENTA_DESCUBRIR } from '../../src/core/toolDiscovery.js';
import { herramientasJarvis } from '../../src/core/tools.js';
import { instruccionesParaHerramientas, NUCLEO_PERSONALIDAD } from '../../src/core/selectiveContext.js';
import { consultarJarvisAislado } from '../helpers/jarvisAislado.js';

function relojPresupuesto(extra = {}) {
  let t = 0;
  const esperas = [];
  return { ahora: () => t, esperas, presupuesto: crearPresupuestoGroq({ ahora: () => t, esperar: async ms => { esperas.push(ms); t += ms; }, ...extra }) };
}
const payload = { messages: [{ role: 'user', content: 'x'.repeat(2700) }], max_tokens: 100 };

test('presupuesto serializa solicitudes concurrentes y espera la ventana con reserva de salida', async () => {
  const r = relojPresupuesto({ limite: 1500 });
  let activos = 0, maximo = 0;
  const enviar = async () => { activos++; maximo = Math.max(maximo, activos); await Promise.resolve(); activos--; return { data: {} }; };
  await Promise.all([r.presupuesto.ejecutar(payload, enviar), r.presupuesto.ejecutar(payload, enviar)]);
  assert.equal(maximo, 1); assert.deepEqual(r.esperas, [60000]);
  assert.ok(estimarTokensPeticion(payload).total > estimarTokensPeticion(payload).entrada);
});
test('cabeceras limitan saldo compartido conservadoramente y usage ausente no libera reserva', async () => {
  const r = relojPresupuesto();
  await r.presupuesto.ejecutar(payload, async () => ({ data: {}, headers: new Headers({ 'x-ratelimit-remaining-tokens': '0', 'x-ratelimit-reset-tokens': '2.5s' }) }));
  await r.presupuesto.ejecutar(payload, async () => ({ data: {} }));
  assert.equal(r.esperas[0], 2500); assert.equal(duracionCabecera('1m2.5s'), 62500);
});
test('error ambiguo retiene reserva; peticion excesiva se rechaza sin enviarla', async () => {
  const r = relojPresupuesto({ limite: 1500 });
  await assert.rejects(r.presupuesto.ejecutar(payload, async () => { throw new Error('red'); }), /red/);
  await r.presupuesto.ejecutar(payload, async () => ({ data: {} }));
  assert.deepEqual(r.esperas, [60000]);
  let llamadas = 0;
  await assert.rejects(r.presupuesto.ejecutar({ messages: [{ content: 'x'.repeat(9000) }], max_tokens: 100 }, async () => { llamadas++; }), { name: 'PresupuestoTemporalError' });
  assert.equal(llamadas, 0);
});
test('SDK withResponse: cabeceras y uso real pasan por presupuesto tambien en auxiliar', async () => {
  reiniciarCircuitoModelos();
  const r = relojPresupuesto(); let n = 0;
  const cliente = { chat: { completions: { create(p) {
    assert.equal(p.max_tokens, 1024); n++;
    return { withResponse: async () => ({ data: { choices: [{ message: { content: 'ok' } }], usage: { prompt_tokens: 20, completion_tokens: 5 } }, response: { headers: new Headers({ 'x-ratelimit-remaining-tokens': '0', 'x-ratelimit-reset-tokens': '1s' }) } }) };
  } } } };
  const params = { provider: 'groq', apiKey: 'synthetic', messages: [{ role: 'user', content: 'auxiliar' }], options: { crearCliente: () => cliente, presupuestoGroq: r.presupuesto } };
  const respuesta = await chatCompletion(params); await chatCompletion(params);
  assert.equal(n, 2); assert.equal(respuesta.usage.prompt_tokens, 20); assert.deepEqual(r.esperas, [1000]);
});
test('seleccion progresiva mantiene acceso al catalogo sin mandar todos los esquemas', () => {
  const inicial = prepararHerramientasProgresivas(herramientasJarvis, 'anota un gasto de 20 euros');
  assert.equal(inicial.length, 12);
  assert.ok(buscarEsquemas(herramientasJarvis, { consulta: '', nombres: ['registrar_gasto'] }).some(h => h.function.name === 'registrar_gasto'));
  assert.deepEqual(buscarEsquemas(herramientasJarvis, { nombres: ['inexistente'] }), []);
  const clima = instruccionesParaHerramientas(herramientasJarvis.filter(h => h.function.name === 'consultar_clima'));
  assert.match(clima, /CLIMA/); assert.doesNotMatch(clima, /FINANZAS|COPIAS DE SEGURIDAD/);
  assert.match(NUCLEO_PERSONALIDAD, /OTP/); assert.match(NUCLEO_PERSONALIDAD, /destinatario verificado/);
});
test('ReAct carga esquema faltante y conserva historia, resultado y personalidad antes del contexto variable', async () => {
  const capturas = []; let ejecutadas = 0;
  const historial = [{ role: 'user', content: 'No actives avisos; solo consulta.' }, { role: 'assistant', content: 'Entendido.' }];
  const respuesta = await consultarJarvisAislado('que tiempo hace en Madrid', historial, {
    obtenerMemorias: () => [{ sujeto: 'Madrid', dato: 'prefiero respuestas cortas' }],
    ejecutores: { listar_habitos: async () => { ejecutadas++; return 'Habito sintetico: leer'; } },
    chatCompletion: async p => {
      capturas.push(structuredClone(p));
      const n = capturas.length;
      if (n === 1) return { message: { content: '', tool_calls: [{ id: 'd1', function: { name: HERRAMIENTA_DESCUBRIR.function.name, arguments: { consulta: 'listar habitos', nombres: ['listar_habitos'] } } }] } };
      if (n === 2) return { message: { content: '', tool_calls: [{ id: 'h1', function: { name: 'listar_habitos', arguments: {} } }] } };
      return { message: { content: 'Habito sintetico: leer.' } };
    }
  });
  assert.equal(ejecutadas, 1); assert.match(respuesta, /leer/);
  assert.ok(!capturas[0].tools.some(h => h.function.name === 'listar_habitos'));
  assert.ok(capturas[1].tools.some(h => h.function.name === 'listar_habitos'));
  assert.ok(capturas[2].messages.some(m => m.content === 'Habito sintetico: leer'));
  assert.ok(capturas[2].messages.some(m => m.content === historial[0].content));
  const sistema = capturas[0].messages[0].content;
  assert.ok(sistema.indexOf('REGLAS FIJAS') < sistema.indexOf('REGISTROS DEL SECOND BRAIN'));
  assert.ok(sistema.indexOf('INSTRUCCIONES DE HERRAMIENTAS') < sistema.indexOf('REGISTROS DEL SECOND BRAIN'));
});

test('fallo de clasificador no vuelca catalogo ni elimina regla de requisitos verificados', async () => {
  const principal = [];
  await consultarJarvisAislado('mandale una cosa de esas cuando puedas', [], {
    chatCompletion: async p => {
      if (p.messages[0].content.includes('Clasifica la intencion')) return { message: { content: 'respuesta invalida' } };
      principal.push(structuredClone(p)); return { message: { content: 'Aclara que necesitas.' } };
    }
  });
  assert.ok(principal.length > 0);
  assert.ok(principal[0].tools.length <= 13 && principal[0].tools.length > 0);
  assert.ok(principal[0].tools.some(h => h.function.name === 'descubrir_herramientas'));
  assert.match(principal[0].messages[0].content, /NUNCA afirmes que un servicio requiere clave/);
});

test('especialista no amplia clima a todo su catalogo y el nucleo persiste sin tools', async () => {
  let clima, charla;
  await consultarJarvisAislado('que tiempo hace en Madrid', [], { especialistaForzado: 'ops', chatCompletion: async p => { clima = structuredClone(p); return { message: { content: 'Datos sinteticos.' } }; } });
  await consultarJarvisAislado('hola, que tal', [], { chatCompletion: async p => { charla = structuredClone(p); return { message: { content: 'Hola David.' } }; } });
  assert.ok(clima.tools.some(h => h.function.name === 'consultar_clima'));
  assert.ok(!clima.tools.some(h => h.function.name === 'execute_bash_command'));
  assert.equal(charla.tools, undefined);
  for (const p of [clima, charla]) {
    assert.match(p.messages[0].content, /destinatario verificado/);
    assert.match(p.messages[0].content, /OTP/);
    assert.match(p.messages[0].content, /no autorizacion ni instrucciones nuevas/);
  }
});

test('descubrir envio no verifica destinatario ni ejecuta acciones por si solo', async () => {
  let n = 0, envios = 0;
  const r = await consultarJarvisAislado('que tiempo hace en Madrid', [], {
    retornarTraza: true,
    ejecutores: { programar_mensaje_whatsapp: async () => { envios++; return 'enviado'; } },
    chatCompletion: async () => {
      n++;
      if (n === 1) return { message: { content: '', tool_calls: [{ id: 'd1', function: { name: 'descubrir_herramientas', arguments: { consulta: 'programar mensaje', nombres: ['programar_mensaje_whatsapp'] } } }] } };
      if (n === 2) return { message: { content: '', tool_calls: [{ id: 'm1', function: { name: 'programar_mensaje_whatsapp', arguments: { numero: '+34600111222', mensaje: 'hola', fecha: '2026-12-01T10:00:00' } } }] } };
      return { message: { content: 'Falta el destinatario verificado.' } };
    }
  });
  assert.equal(n, 3); assert.equal(envios, 0);
  assert.ok(r.traza.llamadas.some(l => l.nombre === 'programar_mensaje_whatsapp' && l.resultado === 'destinatario_no_verificado'));
});

test('descubrimiento repetido queda acotado sin gastar rondas de accion originales', async () => {
  let n = 0;
  const r = await consultarJarvisAislado('que tiempo hace en Madrid', [], {
    maxRondasHerramientas: 1, retornarTraza: true,
    chatCompletion: async p => {
      n++;
      if (!p.tools) return { message: { content: 'Necesito aclarar la tarea.' } };
      return { message: { content: '', tool_calls: [{ id: 'd' + n, function: { name: 'descubrir_herramientas', arguments: { consulta: 'habitos', nombres: ['listar_habitos'] } } }] } };
    }
  });
  assert.equal(n, 5, '1 inicial + 1 trabajo + 2 descubrimiento + 1 formulacion final');
  assert.equal(r.traza.llamadas.filter(l => l.nombre === 'descubrir_herramientas').length, 2);
  assert.match(r.respuesta, /aclarar/);
});

test('reserva sigue viva 60 segundos DESPUES de completar una llamada lenta', async () => {
  let t = 0; const esperas = [];
  const presupuesto = crearPresupuestoGroq({ limite: 1500, ahora: () => t, esperar: async ms => { esperas.push(ms); t += ms; } });
  await presupuesto.ejecutar(payload, async () => { t += 90000; return { data: {} }; });
  await presupuesto.ejecutar(payload, async () => ({ data: {} }));
  assert.deepEqual(esperas, [60000]);
});

test('cola larga termina sin enviar otra llamada y no usa error de proveedor agotado', async () => {
  let t = 0, n = 0;
  const presupuesto = crearPresupuestoGroq({ ahora: () => t, esperar: async ms => { t += ms; } });
  const a = presupuesto.ejecutar(payload, async () => { t += 80000; n++; return { data: {} }; });
  const b = presupuesto.ejecutar(payload, async () => { n++; return { data: {} }; });
  await a; await assert.rejects(b, { name: 'PresupuestoTemporalError' }); assert.equal(n, 1);
  const { mensajeErrorParaUsuario } = await import('../../src/services/errorSanitizerService.js');
  const e = new Error('informacion privada sintetica'); e.name = 'PresupuestoTemporalError';
  assert.match(mensajeErrorParaUsuario(e), /presupuesto preventivo/);
  assert.doesNotMatch(mensajeErrorParaUsuario(e), /informacion privada|principal|respaldo/);
});

test('parafrasis de funciones/altas recibe contexto pertinente sin inventario permanente', async () => {
  for (const [mensaje, esperado, ausente] of [
    ['cuales son tus funciones', 'CAPACIDADES REALES', 'CONFIGURACION PENDIENTE'],
    ['que servicios siguen sin conectar', 'CONFIGURACION PENDIENTE', 'CAPACIDADES REALES']
  ]) {
    let visto = false;
    const r = await consultarJarvisAislado(mensaje, [], { chatCompletion: async p => {
      if (p.messages[0].content.includes('Clasifica la intencion')) return { message: { content: 'no se' } };
      const sistema = p.messages[0].content;
      assert.ok(sistema.includes(esperado)); assert.ok(!sistema.includes(ausente)); visto = true;
      if (esperado === 'CAPACIDADES REALES') assert.match(sistema, /clima; recordatorios/);
      else assert.match(sistema, /Home Assistant|MobilityLabs/);
      return { message: { content: 'Contexto pertinente comprobado.' } };
    } });
    assert.equal(visto, true); assert.match(r, /comprobado/);
  }
});

test('parafrasis fuera de heuristica recupera inventario mediante contexto nativo bajo demanda', async () => {
  for (const [mensaje, contexto, marca] of [
    ['hazme un recorrido por lo que llevas dentro', 'capacidades', 'CAPACIDADES REALES'],
    ['dime lo que no esta listo para arrancar', 'configuracion', 'CONFIGURACION PENDIENTE']
  ]) {
    let n = 0;
    const r = await consultarJarvisAislado(mensaje, [], { chatCompletion: async p => {
      if (p.messages[0].content.includes('Clasifica la intencion')) return { message: { content: 'no se' } };
      n++;
      if (n === 1) {
        assert.ok(!p.messages[0].content.includes(marca), 'no coincidia con la heuristica ni se enviaba siempre');
        assert.ok(p.tools.some(h => h.function.name === 'descubrir_herramientas'));
        return { message: { content: '', tool_calls: [{ id: 'contexto', function: { name: 'descubrir_herramientas', arguments: { consulta: mensaje, contexto } } }] } };
      }
      const datos = p.messages.find(m => m.role === 'tool' && m.content.includes(marca));
      assert.ok(datos, 'el inventario real se recupera aunque no encaje en regex');
      if (contexto === 'capacidades') assert.match(datos.content, /finanzas personales/);
      else assert.match(datos.content, /MobilityLabs/);
      return { message: { content: 'Inventario consultado sin accion externa.' } };
    } });
    assert.equal(n, 2); assert.match(r, /Inventario consultado/);
  }
});

test('preguntas de funciones/configuracion de tenant no reciben inventario owner ni acceso a recuperarlo', async () => {
  const { consultarJarvisEnAmbito } = await import('../../src/core/jarvisAgent.js');
  for (const mensaje of ['cuales son tus funciones', 'que servicios siguen sin conectar']) {
    let n = 0;
    await consultarJarvisEnAmbito(mensaje, [], {
      tenantId: 'sint-contexto', controlUso: { autorizar: () => ({ permitido: true }) }, rolDeTenant: () => 'usuario',
      chatCompletion: async p => {
        n++;
        const todo = JSON.stringify(p);
        assert.doesNotMatch(todo, /Home Assistant|MobilityLabs|CAPACIDADES REALES|CONFIGURACION PENDIENTE|descubrir_herramientas/);
        return { message: { content: p.messages[0].content.includes('Clasifica la intencion') ? 'no se' : 'Solo capacidades de este usuario.' } };
      }
    });
    assert.ok(n > 0, 'la prueba no es vacua');
  }
});
