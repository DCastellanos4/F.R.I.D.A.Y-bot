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
