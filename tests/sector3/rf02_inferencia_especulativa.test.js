/**
 * RF-02 (ERS): inferencia especulativa hibrida SLM local -> nube.
 * Pruebas aisladas con clientes y LLM falsos inyectados; ninguna llama a
 * Ollama, Groq ni a la red, y ninguna afirma SLA ni calidad del modelo:
 * eso queda para la medicion con el modelo real en el VPS.
 *
 * Strict Policy: Zero Emojis.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { assertNoEmojis } from '../harness/validators.js';
import { crearOllamaSlmAdapter } from '../../src/adapters/outbound/llm/ollamaSlmAdapter.js';
import {
  crearLocalSlmInferenceService,
  extraerPrimerJson,
  validarContraEsquema,
  UMBRAL_CONFIANZA_SLM
} from '../../src/services/localSlmInferenceService.js';
import { crearEnrutadorInferencia } from '../../src/core/inferenceRouter.js';
import { afirmarLLMProvider } from '../../src/ports/outbound/LLMProviderPort.js';

const ETIQUETAS = ['clima', 'transporte', 'notas', 'finanzas', 'conversacion'];

function clienteFalso(respuesta, { retardoMs = 0, colgar = false } = {}) {
  const estado = { llamadas: [], enVuelo: 0, maxEnVuelo: 0 };
  return {
    estado,
    async chat(args) {
      estado.llamadas.push(args);
      if (colgar) return new Promise(() => {});
      estado.enVuelo++;
      estado.maxEnVuelo = Math.max(estado.maxEnVuelo, estado.enVuelo);
      if (retardoMs) await new Promise((r) => setTimeout(r, retardoMs));
      estado.enVuelo--;
      return {
        message: { role: 'assistant', content: respuesta },
        prompt_eval_count: 12,
        eval_count: 7
      };
    }
  };
}

function providerFalso(contenido, { lanzar = null } = {}) {
  const estado = { llamadas: 0 };
  return {
    estado,
    nombre: 'slm-falso',
    async chatCompletion(peticion) {
      estado.llamadas++;
      if (lanzar) throw lanzar;
      return {
        message: { role: 'assistant', content: typeof contenido === 'function' ? contenido(peticion) : contenido },
        latenciaMs: 5,
        uso: { entrada: 10, salida: 5 }
      };
    }
  };
}

/* ------------------------------ adaptador ------------------------------ */

describe('RF-02: ollamaSlmAdapter', () => {
  test('sin modelo configurado devuelve null (SLM deshabilitado, fail-safe)', () => {
    const prev = process.env.DAVIS_SLM_MODEL;
    delete process.env.DAVIS_SLM_MODEL;
    try {
      assert.strictEqual(crearOllamaSlmAdapter({}), null);
    } finally {
      if (prev !== undefined) process.env.DAVIS_SLM_MODEL = prev;
    }
  });

  test('cumple LLMProviderPort y normaliza la respuesta al formato historico', async () => {
    const cliente = clienteFalso('{"intencion":"clima","confianza":0.9}');
    const adapter = crearOllamaSlmAdapter({ modelo: 'qwen2.5:3b', cliente });
    afirmarLLMProvider(adapter);
    const res = await adapter.chatCompletion({ messages: [{ role: 'user', content: 'hace frio?' }] });
    assert.strictEqual(res.message.role, 'assistant');
    assert.strictEqual(res.message.content, '{"intencion":"clima","confianza":0.9}');
    assert.strictEqual(res.modelo, 'qwen2.5:3b');
    assert.strictEqual(res.proveedor, 'ollama-local');
    assert.deepStrictEqual(res.uso, { entrada: 12, salida: 7 });
    assert.ok(Number.isFinite(res.latenciaMs));
    assertNoEmojis(res.message.content);
  });

  test('viaja keep_alive configurable y opciones del modelo', async () => {
    const cliente = clienteFalso('ok');
    const adapter = crearOllamaSlmAdapter({ modelo: 'qwen2.5:3b', cliente, keepAlive: '0' });
    await adapter.chatCompletion({ messages: [], options: { temperature: 0.2, num_predict: 42, num_ctx: 2048 } });
    const llamada = cliente.estado.llamadas[0];
    assert.strictEqual(llamada.keep_alive, '0');
    assert.strictEqual(llamada.options.temperature, 0.2);
    assert.strictEqual(llamada.options.num_predict, 42);
    assert.strictEqual(llamada.options.num_ctx, 2048);
  });

  test('agota el tiempo si la inferencia no responde (escalable a nube)', async () => {
    const cliente = clienteFalso('', { colgar: true });
    const adapter = crearOllamaSlmAdapter({ modelo: 'qwen2.5:3b', cliente, timeoutMs: 50 });
    await assert.rejects(() => adapter.chatCompletion({ messages: [] }), /agoto su tiempo/);
  });

  test('serializa inferencias: nunca dos en vuelo (admision CPU)', async () => {
    const cliente = clienteFalso('ok', { retardoMs: 30 });
    const adapter = crearOllamaSlmAdapter({ modelo: 'qwen2.5:3b', cliente });
    await Promise.all([
      adapter.chatCompletion({ messages: [{ role: 'user', content: 'a' }] }),
      adapter.chatCompletion({ messages: [{ role: 'user', content: 'b' }] }),
      adapter.chatCompletion({ messages: [{ role: 'user', content: 'c' }] })
    ]);
    assert.strictEqual(cliente.estado.llamadas.length, 3);
    assert.strictEqual(cliente.estado.maxEnVuelo, 1);
  });
});

/* --------------------------- utilidades SLM ---------------------------- */

describe('RF-02: parseo y validacion de esquema', () => {
  test('extraerPrimerJson tolera prosa y fences', () => {
    assert.deepStrictEqual(extraerPrimerJson('{"a":1}'), { a: 1 });
    assert.deepStrictEqual(extraerPrimerJson('Claro: ```json {"a": "x{y}"} ``` listo'), { a: 'x{y}' });
    assert.strictEqual(extraerPrimerJson('sin json'), null);
    assert.strictEqual(extraerPrimerJson('{"roto":'), null);
    assert.strictEqual(extraerPrimerJson(''), null);
  });

  test('validarContraEsquema: requeridos, tipos, enum y anidados', () => {
    const esquema = {
      type: 'object',
      required: ['importe', 'moneda'],
      properties: {
        importe: { type: 'number' },
        moneda: { type: 'string', enum: ['EUR', 'USD'] },
        detalle: { type: 'object', properties: { lineas: { type: 'integer' } } }
      }
    };
    assert.deepStrictEqual(validarContraEsquema({ importe: 3.5, moneda: 'EUR' }, esquema), []);
    assert.ok(validarContraEsquema({ moneda: 'EUR' }, esquema).some((v) => v.includes('importe')));
    assert.ok(validarContraEsquema({ importe: 3, moneda: 'JPY' }, esquema).some((v) => v.includes('enum')));
    assert.ok(validarContraEsquema({ importe: '3', moneda: 'EUR' }, esquema).some((v) => v.includes('number')));
    assert.ok(validarContraEsquema({ importe: 3, moneda: 'EUR', detalle: { lineas: 1.5 } }, esquema).some((v) => v.includes('detalle.lineas')));
  });
});

/* ------------------------------ servicio ------------------------------- */

describe('RF-02: localSlmInferenceService', () => {
  test('exige provider con chatCompletion', () => {
    assert.throws(() => crearLocalSlmInferenceService({}), TypeError);
  });

  test('clasificacion exitosa con confianza >= umbral del ERS', async () => {
    const slm = crearLocalSlmInferenceService({ provider: providerFalso('{"intencion":"clima","confianza":0.91}') });
    const r = await slm.clasificarIntencion('que tiempo hace manana', ETIQUETAS);
    assert.strictEqual(r.exito, true);
    assert.strictEqual(r.intencion, 'clima');
    assert.ok(r.confianza >= UMBRAL_CONFIANZA_SLM);
    assert.strictEqual(r.via, 'local_slm');
  });

  test('confianza bajo el umbral declara baja_confianza, nunca exito', async () => {
    const slm = crearLocalSlmInferenceService({ provider: providerFalso('{"intencion":"clima","confianza":0.81}') });
    const r = await slm.clasificarIntencion('quizas llueva o quizas no', ETIQUETAS);
    assert.strictEqual(r.exito, false);
    assert.strictEqual(r.motivo, 'baja_confianza');
    assert.strictEqual(r.confianza, 0.81);
  });

  test('salida no parseable o etiqueta fuera de catalogo es slm_parse_fail', async () => {
    const slm = crearLocalSlmInferenceService({ provider: providerFalso('no lo se, creo que clima') });
    const r1 = await slm.clasificarIntencion('hola', ETIQUETAS);
    assert.strictEqual(r1.exito, false);
    assert.strictEqual(r1.motivo, 'slm_parse_fail');

    const slm2 = crearLocalSlmInferenceService({ provider: providerFalso('{"intencion":"magia","confianza":0.99}') });
    const r2 = await slm2.clasificarIntencion('hola', ETIQUETAS);
    assert.strictEqual(r2.exito, false);
    assert.strictEqual(r2.motivo, 'slm_parse_fail');
  });

  test('error del proveedor se declara slm_error y timeout slm_timeout', async () => {
    const slmErr = crearLocalSlmInferenceService({ provider: providerFalso(null, { lanzar: new Error('ECONNREFUSED') }) });
    assert.strictEqual((await slmErr.clasificarIntencion('hola', ETIQUETAS)).motivo, 'slm_error');

    const slmTo = crearLocalSlmInferenceService({ provider: providerFalso(null, { lanzar: new Error('La inferencia del SLM local agoto su tiempo (2000 ms)') }) });
    assert.strictEqual((await slmTo.clasificarIntencion('hola', ETIQUETAS)).motivo, 'slm_timeout');
  });

  test('extraccion de argumentos valida contra esquema antes de dar exito', async () => {
    const esquema = {
      type: 'object',
      required: ['importe', 'moneda'],
      properties: { importe: { type: 'number' }, moneda: { type: 'string', enum: ['EUR', 'USD'] } }
    };
    const slm = crearLocalSlmInferenceService({
      provider: providerFalso('{"confianza":0.9,"argumentos":{"importe":12.5,"moneda":"EUR"}}')
    });
    const r = await slm.extraerArgumentos('gaste 12,50 en el bar', 'registrar_gasto', esquema);
    assert.strictEqual(r.exito, true);
    assert.deepStrictEqual(r.argumentos, { importe: 12.5, moneda: 'EUR' });
  });

  test('extraccion con esquema violado declara esquema_invalido con violaciones', async () => {
    const esquema = {
      type: 'object',
      required: ['importe'],
      properties: { importe: { type: 'number' } }
    };
    const slm = crearLocalSlmInferenceService({
      provider: providerFalso('{"confianza":0.95,"argumentos":{"importe":"doce"}}')
    });
    const r = await slm.extraerArgumentos('gaste doce', 'registrar_gasto', esquema);
    assert.strictEqual(r.exito, false);
    assert.strictEqual(r.motivo, 'esquema_invalido');
    assert.ok(r.violaciones.length > 0);
  });

  test('respuesta conversacional: devuelve texto limpio sin el JSON de confianza', async () => {
    const slm = crearLocalSlmInferenceService({
      provider: providerFalso('De nada, para eso estoy.\n{"confianza":0.9}')
    });
    const r = await slm.responderConversacion('gracias');
    assert.strictEqual(r.exito, true);
    assert.strictEqual(r.respuesta, 'De nada, para eso estoy.');
    assertNoEmojis(r.respuesta);
  });

  test('respuesta conversacional sin confianza declarada es slm_parse_fail', async () => {
    const slm = crearLocalSlmInferenceService({ provider: providerFalso('Una respuesta sin mas') });
    const r = await slm.responderConversacion('hola');
    assert.strictEqual(r.exito, false);
    assert.strictEqual(r.motivo, 'slm_parse_fail');
  });
});

/* ------------------------------- router -------------------------------- */

describe('RF-02: inferenceRouter (escalada y registro de decisiones)', () => {
  function nubeFalsa(contenido = '{"intencion":"clima","confianza":0.97}') {
    const estado = { llamadas: 0 };
    return {
      estado,
      fn: async () => {
        estado.llamadas++;
        return { message: { role: 'assistant', content: contenido } };
      }
    };
  }

  test('exige chatCompletionNube', () => {
    assert.throws(() => crearEnrutadorInferencia({}), TypeError);
  });

  test('sin SLM: todo a la nube con motivo slm_deshabilitado', async () => {
    const nube = nubeFalsa();
    const decisiones = [];
    const router = crearEnrutadorInferencia({
      slm: null,
      chatCompletionNube: nube.fn,
      registrarDecision: (d) => decisiones.push(d)
    });
    const r = await router.clasificarIntencion('hace frio?', ETIQUETAS);
    assert.strictEqual(nube.estado.llamadas, 1);
    assert.strictEqual(r.via, 'cloud');
    assert.strictEqual(r.motivo, 'slm_deshabilitado');
    assert.strictEqual(r.intencion, 'clima');
    assert.deepStrictEqual(decisiones.map((d) => d.motivo), ['slm_deshabilitado']);
  });

  test('tenant no habilitado: nube con tenant_sin_acceso_local (fail-closed)', async () => {
    const nube = nubeFalsa();
    const slmFalso = { clasificarIntencion: async () => { throw new Error('no deberia llamarse'); } };
    const decisiones = [];
    const router = crearEnrutadorInferencia({
      slm: slmFalso,
      chatCompletionNube: nube.fn,
      registrarDecision: (d) => decisiones.push(d)
    });
    const r = await router.clasificarIntencion('hola', ETIQUETAS, { tenantId: 'tenant-x' });
    assert.strictEqual(r.via, 'cloud');
    assert.strictEqual(r.motivo, 'tenant_sin_acceso_local');
    assert.strictEqual(decisiones[0].tenant, 'tenant-x');
  });

  test('exito local: no llama a la nube y registra ahorro estimado > 0', async () => {
    const nube = nubeFalsa();
    const decisiones = [];
    const router = crearEnrutadorInferencia({
      slm: { clasificarIntencion: async () => ({ exito: true, intencion: 'clima', confianza: 0.9, latenciaMs: 40 }) },
      chatCompletionNube: nube.fn,
      registrarDecision: (d) => decisiones.push(d)
    });
    const r = await router.clasificarIntencion('hace frio en madrid?', ETIQUETAS);
    assert.strictEqual(nube.estado.llamadas, 0);
    assert.strictEqual(r.via, 'local_slm');
    assert.strictEqual(r.intencion, 'clima');
    assert.strictEqual(decisiones[0].via, 'local_slm');
    assert.ok(decisiones[0].tokensAhorradosEstimados > 0);
  });

  test('baja confianza local escala a nube conservando el motivo', async () => {
    const nube = nubeFalsa();
    const decisiones = [];
    const router = crearEnrutadorInferencia({
      slm: { clasificarIntencion: async () => ({ exito: false, motivo: 'baja_confianza', confianza: 0.5, latenciaMs: 30 }) },
      chatCompletionNube: nube.fn,
      registrarDecision: (d) => decisiones.push(d)
    });
    const r = await router.clasificarIntencion('mensaje ambiguo', ETIQUETAS);
    assert.strictEqual(nube.estado.llamadas, 1);
    assert.strictEqual(r.via, 'cloud');
    assert.strictEqual(r.motivo, 'baja_confianza');
  });

  test('error del SLM escala a nube y la nube parsea su propia respuesta', async () => {
    const nube = nubeFalsa('{"intencion":"notas","confianza":0.88}');
    const router = crearEnrutadorInferencia({
      slm: { clasificarIntencion: async () => ({ exito: false, motivo: 'slm_error' }) },
      chatCompletionNube: nube.fn
    });
    const r = await router.clasificarIntencion('guarda esto', ETIQUETAS);
    assert.strictEqual(r.intencion, 'notas');
    assert.strictEqual(r.confianza, 0.88);
    assert.strictEqual(r.motivo, 'slm_error');
  });

  test('respuesta nube basura devuelve intencion null declarada', async () => {
    const nube = nubeFalsa('no tengo ni idea');
    const router = crearEnrutadorInferencia({ slm: null, chatCompletionNube: nube.fn });
    const r = await router.clasificarIntencion('algo', ETIQUETAS);
    assert.strictEqual(r.intencion, null);
    assert.strictEqual(r.confianza, 0);
  });

  test('extraccion: exito local pasa intacto; fallo local devuelve via cloud con motivo', async () => {
    const argumentos = { ciudad: 'Madrid' };
    const router = crearEnrutadorInferencia({
      slm: {
        extraerArgumentos: async () => ({ exito: true, via: 'local_slm', argumentos, confianza: 0.9, latenciaMs: 20 })
      },
      chatCompletionNube: nubeFalsa().fn
    });
    const ok = await router.extraerArgumentos('clima en madrid', 'clima', { type: 'object' });
    assert.strictEqual(ok.exito, true);
    assert.deepStrictEqual(ok.argumentos, argumentos);

    const router2 = crearEnrutadorInferencia({
      slm: {
        extraerArgumentos: async () => ({ exito: false, motivo: 'esquema_invalido', violaciones: ['x'], confianza: 0.9 })
      },
      chatCompletionNube: nubeFalsa().fn
    });
    const ko = await router2.extraerArgumentos('clima', 'clima', { type: 'object' });
    assert.strictEqual(ko.exito, false);
    assert.strictEqual(ko.via, 'cloud');
    assert.strictEqual(ko.motivo, 'esquema_invalido');
    assert.deepStrictEqual(ko.violaciones, ['x']);
  });
});
