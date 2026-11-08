/**
 * llm_failover.test.js
 * Router de modelos con failover (aprobado por David, 8 nov 2026): primario
 * Groq + respaldo gpt-oss-20b, SOLO Groq. Prueba con clientes guionizados,
 * sin red ni cuota real:
 *  - 429 tras herramientas ejecutadas: el respaldo recibe la MISMA peticion
 *    (mismos mensajes, mismas herramientas) y completa la sintesis sin
 *    reejecutar nada (la conmutacion es por ronda).
 *  - 400 de validacion: NO conmuta (fallo de la peticion, no de cuota).
 *  - 429 en todos: CuotaAgotadaError honesto, intentos acotados.
 *  - Circuito: un 429 con retry-after largo aparca el modelo; la siguiente
 *    consulta salta al respaldo sin gastar otra llamada en el primario.
 *  - 429 transitorio (retry-after corto): reintenta el mismo modelo.
 *  - Degradacion honesta: la respuesta de JARVIS declara el respaldo.
 *
 * Strict Policy: Zero Emojis.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
delete process.env.GROQ_MODELOS_RESPALDO;

const { chatCompletion, reiniciarCircuitoModelos } = await import('../../src/core/llmService.js');
const { mensajeErrorParaUsuario } = await import('../../src/services/errorSanitizerService.js');
const { consultarJarvisAislado: consultarJarvis } = await import('../helpers/jarvisAislado.js');

const PRIMARIO = 'openai/gpt-oss-120b';
const RESPALDO = 'openai/gpt-oss-20b';

function error429(retryAfterSegundos) {
  const err = new Error('429 rate limit reached (tokens per day)');
  err.status = 429;
  if (retryAfterSegundos != null) err.headers = { 'retry-after': String(retryAfterSegundos) };
  return err;
}

function error400() {
  const err = new Error('400 tool call validation failed');
  err.status = 400;
  return err;
}

function errorRed() {
  const err = new Error('fetch failed: socket hang up');
  err.code = 'ECONNRESET';
  return err;
}

function clienteGuionizado(guion, registro) {
  // guion: { modelo: [pasos] }, paso = Error (se lanza) o string (contenido ok)
  const contadores = new Map();
  return {
    chat: {
      completions: {
        create: async (payload) => {
          registro.push(payload);
          const pasos = guion[payload.model] || ['ok'];
          const i = Math.min(contadores.get(payload.model) || 0, pasos.length - 1);
          contadores.set(payload.model, (contadores.get(payload.model) || 0) + 1);
          const paso = pasos[i];
          if (paso instanceof Error) throw paso;
          return { choices: [{ message: { role: 'assistant', content: paso }, finish_reason: 'stop' }] };
        }
      }
    }
  };
}

function paramsBasicos(cliente, extra = {}) {
  return {
    messages: [{ role: 'user', content: 'prueba' }],
    provider: 'groq',
    apiKey: 'gsk_test',
    options: { crearCliente: () => cliente, esperar: async () => {}, ...extra }
  };
}

test('429 con retry-after largo: salta al respaldo con la MISMA peticion y declara degradacion', async () => {
  reiniciarCircuitoModelos();
  const registro = [];
  const cliente = clienteGuionizado({ [PRIMARIO]: [error429(3600)], [RESPALDO]: ['Sintesis completada por el respaldo.'] }, registro);
  // Simula la ronda de sintesis: los mensajes YA llevan resultados de
  // herramientas ejecutadas; el respaldo debe recibir EXACTAMENTE eso.
  const params = paramsBasicos(cliente);
  params.messages = [
    { role: 'user', content: 'que trenes hay?' },
    { role: 'assistant', content: '', tool_calls: [{ id: 'c1', type: 'function', function: { name: 'proximas_llegadas_transporte', arguments: {} } }] },
    { role: 'tool', content: 'C3 a las 16:00 a Madrid-Chamartin', tool_call_id: 'c1' }
  ];
  const r = await chatCompletion(params);
  assert.equal(r.message.content, 'Sintesis completada por el respaldo.');
  assert.equal(r.model, RESPALDO);
  assert.equal(r.degradado, true, 'declara degradacion');
  assert.equal(registro.length, 2, 'una llamada por modelo, sin reintentos inutiles');
  assert.equal(registro[0].model, PRIMARIO);
  assert.equal(registro[1].model, RESPALDO);
  assert.deepEqual(registro[1].messages, registro[0].messages, 'misma peticion: no se reejecuta ni reescribe nada');
});

test('400 de validacion: NO conmuta al respaldo', async () => {
  reiniciarCircuitoModelos();
  const registro = [];
  const cliente = clienteGuionizado({ [PRIMARIO]: [error400()], [RESPALDO]: ['ok'] }, registro);
  await assert.rejects(() => chatCompletion(paramsBasicos(cliente)), /400/);
  assert.equal(registro.length, 1, 'el respaldo no se llama con un 400');
});

test('429 en todos los modelos: CuotaAgotadaError honesto con intentos acotados', async () => {
  reiniciarCircuitoModelos();
  const registro = [];
  const cliente = clienteGuionizado({ [PRIMARIO]: [error429(3600)], [RESPALDO]: [error429(3600)] }, registro);
  await assert.rejects(
    () => chatCompletion(paramsBasicos(cliente)),
    (err) => {
      assert.equal(err.name, 'CuotaAgotadaError');
      assert.match(err.message, /Todos los modelos/);
      return true;
    }
  );
  assert.equal(registro.length, 2, 'una llamada por modelo aparcado; sin bucles');
});

test('Circuito: tras aparcar el primario, la siguiente consulta salta directo al respaldo', async () => {
  reiniciarCircuitoModelos();
  const registro = [];
  const cliente = clienteGuionizado({ [PRIMARIO]: [error429(3600)], [RESPALDO]: ['respaldo'] }, registro);
  await chatCompletion(paramsBasicos(cliente));
  assert.equal(registro.length, 2);
  const r2 = await chatCompletion(paramsBasicos(cliente));
  assert.equal(r2.model, RESPALDO);
  assert.equal(registro.length, 3, 'el primario aparcado no recibe otra llamada');
  assert.deepEqual(r2.failover.saltadosPorCircuito, [PRIMARIO]);
});

test('429 transitorio (retry-after corto): reintenta el MISMO modelo antes de saltar', async () => {
  reiniciarCircuitoModelos();
  const registro = [];
  const cliente = clienteGuionizado({ [PRIMARIO]: [error429(1), 'ok tras reintento'], [RESPALDO]: ['respaldo'] }, registro);
  const r = await chatCompletion(paramsBasicos(cliente));
  assert.equal(r.model, PRIMARIO, 'se recupera en el primario');
  assert.equal(r.degradado, false);
  assert.equal(registro.length, 2, 'dos intentos en el primario, respaldo intacto');
});

test('Fallo de red sin status: conmutable al respaldo', async () => {
  reiniciarCircuitoModelos();
  const registro = [];
  const cliente = clienteGuionizado({ [PRIMARIO]: [errorRed(), errorRed()], [RESPALDO]: ['respaldo'] }, registro);
  const r = await chatCompletion(paramsBasicos(cliente));
  assert.equal(r.model, RESPALDO);
  assert.equal(r.degradado, true);
});

test('Mensaje a David cuando TODOS los modelos estan sin cuota: honesto y sin texto crudo', () => {
  const err = new Error('Todos los modelos configurados estan sin cuota o no disponibles ahora mismo (openai/gpt-oss-120b -> openai/gpt-oss-20b).');
  err.name = 'CuotaAgotadaError';
  const texto = mensajeErrorParaUsuario(err);
  assert.match(texto, /principal como el de respaldo/);
  assert.doesNotMatch(texto, /gpt-oss|429|organization/i, 'sin detalle tecnico ni de cuota');
});

test('Degradacion honesta en la respuesta de JARVIS: declara el respaldo y la no-duplicacion', async () => {
  const r = await consultarJarvis('que tiempo hace en Madrid?', [], {
    chatCompletion: async () => ({
      message: { role: 'assistant', content: 'Soleado, 22 grados, senor.' },
      model: RESPALDO,
      degradado: true,
      failover: { modeloPrincipal: PRIMARIO, cadena: [PRIMARIO, RESPALDO], saltadosPorCircuito: [], intentos: 2 }
    })
  });
  assert.match(r, /modelo de respaldo/, 'declara que respondio el respaldo');
  assert.match(r, /se ha ejecutado dos veces/, 'declara la no-duplicacion');
});

test('Sin failover la respuesta no lleva nota de degradacion', async () => {
  const r = await consultarJarvis('que tiempo hace en Madrid?', [], {
    chatCompletion: async () => ({ message: { role: 'assistant', content: 'Soleado, 22 grados, senor.' } })
  });
  assert.doesNotMatch(r, /modelo de respaldo/);
});
