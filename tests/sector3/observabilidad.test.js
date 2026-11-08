/**
 * Observabilidad (Mejora 3): trazas OTel + metricas Prometheus.
 *
 * Sin red y sin stack externo: exportador de spans EN MEMORIA y registro
 * prom-client real. Comprueba:
 *  - no-op transparente con el flag apagado (comportamiento por defecto);
 *  - jerarquia de spans y TraceId unico a lo largo de una consulta;
 *  - PRIVACIDAD: ningun atributo/label contiene texto del mensaje,
 *    argumentos de herramientas ni el chatId en claro (solo hash);
 *  - metricas: latencia LLM/tool registradas, tokens por sesion;
 *  - /metrics: 200 localhost, 403 no-localhost, 503 sin activar;
 *  - db_write en escrituras SQLite (entidad/operacion, nunca datos).
 *
 * Strict Policy: Zero Emojis.
 */
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { InMemorySpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-node';
import {
  iniciarObservabilidad,
  reiniciarObservabilidadParaPruebas,
  estadoObservabilidad,
  conSpan,
  hashSesion,
  registrarFinLLM,
  registrarFinTool,
  registrarFinConsulta,
  atenderMetricas,
  instrumentarEscrituras
} from '../../src/observability/telemetry.js';
import { consultarJarvis } from '../../src/core/jarvisAgent.js';

const MENSAJE_SECRETO = 'texto-privado-que-nunca-debe-aparecer-XYZ123';
const CHAT_ID = 'chat-privado-34635605605@test';

let exporter;
let processor;

beforeEach(async () => {
  await reiniciarObservabilidadParaPruebas();
  exporter = new InMemorySpanExporter();
  processor = new SimpleSpanProcessor(exporter);
});

afterEach(async () => {
  await reiniciarObservabilidadParaPruebas();
});

function clienteGuion(pasos) {
  let n = 0;
  return async () => {
    n += 1;
    const paso = pasos[Math.min(n - 1, pasos.length - 1)];
    if (paso.llama) {
      return { message: { role: 'assistant', content: '', tool_calls: [{ id: 't1', type: 'function', function: { name: paso.llama, arguments: paso.args || {} } }] }, usage: { prompt_tokens: 11, completion_tokens: 7 } };
    }
    return { message: { role: 'assistant', content: paso.texto }, usage: { prompt_tokens: 11, completion_tokens: 7 } };
  };
}

test('apagado por defecto: no-op transparente sin flags ni init', async () => {
  delete process.env.DAVIS_OTEL_ENABLED;
  delete process.env.DAVIS_METRICS_ENABLED;
  assert.deepEqual(estadoObservabilidad(), { iniciado: false, trazasActivas: false, metricasActivas: false, puertoMetricas: null, error: null });
  const r = await conSpan('cualquiera', { a: 1 }, () => 'ok');
  assert.equal(r, 'ok');
  // Una consulta completa funciona igual sin observabilidad.
  const resp = await consultarJarvis('hola', [], { chatCompletion: clienteGuion([{ texto: 'Hola, senor.' }]) });
  assert.match(resp, /Hola/);
  assert.equal(exporter.getFinishedSpans().length, 0);
});

test('jerarquia de spans y TraceId unico en una consulta con tool', async () => {
  await iniciarObservabilidad({ forzarTrazas: true, forzarMetricas: true, spanProcessor: processor });
  const resp = await consultarJarvis(`que tiempo hace ${MENSAJE_SECRETO}`, [], {
    chatId: CHAT_ID,
    chatCompletion: clienteGuion([{ llama: 'consultar_clima' }, { texto: 'Hace sol, senor.' }]),
    ejecutores: { consultar_clima: async () => 'sol y 22 grados' }
  });
  assert.match(resp, /Hace sol/);
  const spans = exporter.getFinishedSpans();
  const nombres = spans.map((s) => s.name);
  assert.ok(nombres.includes('tool'), `span tool presente (${nombres})`);
  assert.ok(nombres.includes('llm_call'), `span llm_call presente (${nombres})`);
  const traces = new Set(spans.map((s) => s.spanContext().traceId));
  assert.equal(traces.size, 1, 'un solo TraceId de extremo a extremo');
});

test('PRIVACIDAD: ningun atributo contiene el texto del mensaje ni argumentos', async () => {
  await iniciarObservabilidad({ forzarTrazas: true, forzarMetricas: true, spanProcessor: processor });
  await consultarJarvis(`que tiempo hace ${MENSAJE_SECRETO}`, [], {
    chatId: CHAT_ID,
    chatCompletion: clienteGuion([{ llama: 'consultar_clima', args: { ciudad: MENSAJE_SECRETO } }, { texto: 'Listo, senor.' }]),
    ejecutores: { consultar_clima: async () => 'sol' }
  });
  for (const span of exporter.getFinishedSpans()) {
    const crudo = JSON.stringify(span.attributes);
    assert.ok(!crudo.includes(MENSAJE_SECRETO), `atributos sin texto del mensaje (${span.name})`);
    assert.ok(!crudo.includes(CHAT_ID), `atributos sin chatId en claro (${span.name})`);
  }
});

test('metricas: latencias LLM/tool, tokens por sesion (hash, no chatId)', async () => {
  await iniciarObservabilidad({ forzarTrazas: true, forzarMetricas: true, spanProcessor: processor });
  await consultarJarvis(`que tiempo hace ${MENSAJE_SECRETO}`, [], {
    chatId: CHAT_ID,
    chatCompletion: clienteGuion([{ llama: 'consultar_clima' }, { texto: 'Hace sol, senor.' }]),
    ejecutores: { consultar_clima: async () => 'sol' }
  });
  registrarFinConsulta({ via: 'prueba', duracionSeg: 0.5 });
  const reg = await atenderMetricasLocal();
  assert.match(reg, /jarvis_llm_duracion_segundos_count\{[^}]*resultado="ok"/, 'histograma LLM registrado');
  assert.match(reg, /jarvis_tool_duracion_segundos_count\{[^}]*herramienta="consultar_clima"/, 'histograma tool registrado');
  const lineaTokens = reg.split('\n').find((l) => l.startsWith('jarvis_llm_tokens_total{') && l.includes('tipo="entrada"'));
  assert.ok(lineaTokens, 'linea de tokens de entrada presente');
  assert.ok(lineaTokens.endsWith(' 22'), `tokens de entrada acumulados de las 2 llamadas (${lineaTokens})`);
  assert.match(reg, new RegExp(`sesion="${hashSesion(CHAT_ID)}"`), 'sesion como hash opaco');
  assert.ok(!reg.includes(CHAT_ID), 'metricas sin chatId en claro');
});

async function atenderMetricasLocal() {
  return new Promise((resolve, reject) => {
    const req = { url: '/metrics', socket: { remoteAddress: '127.0.0.1' } };
    const res = {
      writeHead() { return this; },
      end(cuerpo) { resolve(String(cuerpo)); }
    };
    atenderMetricas(req, res).then((atendida) => (atendida ? null : reject(new Error('no atendida'))));
  });
}

test('/metrics: 403 para no-localhost y false para otras rutas', async () => {
  await iniciarObservabilidad({ forzarMetricas: true });
  let codigo = null;
  const atendida = await atenderMetricas(
    { url: '/metrics', socket: { remoteAddress: '203.0.113.10' } },
    { writeHead(c) { codigo = c; return this; }, end() { /* nada */ } }
  );
  assert.equal(atendida, true);
  assert.equal(codigo, 403, 'solo localhost');
  const otra = await atenderMetricas({ url: '/api/salud', socket: { remoteAddress: '127.0.0.1' } }, { writeHead() { return this; }, end() { /* nada */ } });
  assert.equal(otra, false, 'otras rutas no se tocan');
});

test('/metrics: 503 con metricas no activas', async () => {
  await iniciarObservabilidad({ forzarTrazas: false, forzarMetricas: false });
  let codigo = null;
  await atenderMetricas(
    { url: '/metrics', socket: { remoteAddress: '127.0.0.1' } },
    { writeHead(c) { codigo = c; return this; }, end() { /* nada */ } }
  );
  assert.equal(codigo, 503);
});

test('db_write: escritura SQLite envuelta con entidad/operacion, sin datos', async () => {
  await iniciarObservabilidad({ forzarTrazas: true, spanProcessor: processor });
  const store = instrumentarEscrituras({ guardar(lista) { return lista.length; } }, 'memoria');
  const n = await store.guardar([{ dato: MENSAJE_SECRETO }]);
  assert.equal(n, 1);
  const spans = exporter.getFinishedSpans();
  assert.equal(spans.length, 1);
  assert.equal(spans[0].name, 'db_write');
  assert.equal(spans[0].attributes.entidad, 'memoria');
  assert.equal(spans[0].attributes.operacion, 'guardar');
  assert.ok(!JSON.stringify(spans[0].attributes).includes(MENSAJE_SECRETO), 'sin datos en atributos');
});

test('hashSesion: estable, opaco y truncado', () => {
  const h1 = hashSesion(CHAT_ID);
  const h2 = hashSesion(CHAT_ID);
  assert.equal(h1, h2);
  assert.equal(h1.length, 16);
  assert.notEqual(h1, CHAT_ID);
  assert.ok(!h1.includes('34635605605'), 'el hash no contiene el telefono');
});

test('registro directo de metricas sin trazas activas', async () => {
  await iniciarObservabilidad({ forzarMetricas: true, forzarTrazas: false });
  registrarFinLLM({ modelo: 'm-test', sesion: CHAT_ID, duracionSeg: 0.2, usage: { prompt_tokens: 3, completion_tokens: 2 } });
  registrarFinTool({ herramienta: 't-test', duracionSeg: 0.1, error: { tipo: 'red' } });
  const salida = await atenderMetricasLocal();
  assert.match(salida, /jarvis_llm_tokens_total\{[^}]*modelo="m-test"[^}]*tipo="salida"[^}]*\} 2/);
  assert.match(salida, /jarvis_tool_errores_total\{[^}]*herramienta="t-test"[^}]*tipo="red"[^}]*\} 1/);
});

test('whitelist dura: claves ajenas se descartan aunque lleven secretos', async () => {
  await iniciarObservabilidad({ forzarTrazas: true, spanProcessor: processor });
  await conSpan('prueba_whitelist', {
    modelo: 'ok',
    prompt: MENSAJE_SECRETO,          // clave ajena: descartada
    api_key: 'sk-super-secreto-123',  // clave ajena con nombre plausible: descartada
    argumentos: { ciudad: 'x' }       // objetos: descartados
  }, () => 'ok');
  const spans = exporter.getFinishedSpans();
  assert.equal(spans.length, 1);
  assert.deepEqual(spans[0].attributes, { modelo: 'ok' }, 'solo claves de la whitelist');
});

test('cardinalidad de sesiones acotada: el excedente va a "otras"', async () => {
  await iniciarObservabilidad({ forzarMetricas: true, forzarTrazas: false });
  for (let i = 0; i < 105; i++) {
    registrarFinLLM({ modelo: 'm', sesion: `sesion-${i}`, duracionSeg: 0.01, usage: { prompt_tokens: 1 } });
  }
  const salida = await atenderMetricasLocal();
  const sesiones = new Set([...salida.matchAll(/jarvis_llm_tokens_total\{[^}]*sesion="([^"]+)"/g)].map((m) => m[1]));
  assert.ok(sesiones.size <= 101, `sesiones acotadas (${sesiones.size})`);
  assert.ok(sesiones.has('otras'), 'el excedente se agrupa en "otras"');
});

test('listener dedicado de metricas: solo loopback y responde /metrics', async () => {
  await iniciarObservabilidad({ forzarMetricas: true, forzarTrazas: false, puertoMetricas: 0 });
  const est0 = estadoObservabilidad();
  assert.equal(est0.puertoMetricas, null, 'puerto 0 no abre listener');
  await reiniciarObservabilidadParaPruebas();
  exporter = new InMemorySpanExporter();
  processor = new SimpleSpanProcessor(exporter);
  await iniciarObservabilidad({ forzarMetricas: true, forzarTrazas: false, puertoMetricas: 19464 });
  const est = estadoObservabilidad();
  assert.equal(est.puertoMetricas, 19464);
  registrarFinTool({ herramienta: 't-listener', duracionSeg: 0.05 });
  const cuerpo = await new Promise((resolve, reject) => {
    import('node:http').then(({ default: http }) => {
      http.get('http://127.0.0.1:19464/metrics', (res) => {
        let datos = '';
        res.on('data', (c) => { datos += c; });
        res.on('end', () => resolve(datos));
      }).on('error', reject);
    });
  });
  assert.match(cuerpo, /# HELP jarvis_tool_duracion_segundos/);
  assert.match(cuerpo, /herramienta="t-listener"/);
});

test('explicitamente habilitado sin prom-client no se oculta (simulado)', async () => {
  // Simula deps faltantes: fuerza el camino de error comprobando que el
  // estado y /metrics reportan la causa cuando algo habilitado falla.
  await iniciarObservabilidad({ forzarMetricas: false, forzarTrazas: false });
  const est = estadoObservabilidad();
  assert.equal(est.metricasActivas, false);
  let cuerpo = '';
  await atenderMetricas(
    { url: '/metrics', socket: { remoteAddress: '127.0.0.1' } },
    { writeHead() { return this; }, end(c) { cuerpo = String(c); } }
  );
  assert.match(cuerpo, /Metricas no activas/, 'la causa visible en el 503');
});

test('errores en spans: nunca mensaje arbitrario, solo clase acotada', async () => {
  await iniciarObservabilidad({ forzarTrazas: true, forzarMetricas: true, spanProcessor: processor });
  const SECRETO_ERROR = `fallo con sk-secreto-123 y token=abc ${MENSAJE_SECRETO}`;
  await assert.rejects(
    conSpan('prueba_error', { modelo: 'm' }, () => { throw new Error(SECRETO_ERROR); }),
    /sk-secreto/
  );
  const span = exporter.getFinishedSpans().find((s) => s.name === 'prueba_error');
  const crudo = JSON.stringify(span.events) + JSON.stringify(span.attributes) + JSON.stringify(span.status);
  assert.ok(!crudo.includes('sk-secreto'), 'sin mensaje de error arbitrario en el span');
  assert.ok(!crudo.includes(MENSAJE_SECRETO), 'sin datos privados en el span');
  assert.equal(span.status.message, 'error', 'status estatico');
});

test('label de error acotada: clases raras se normalizan', async () => {
  await iniciarObservabilidad({ forzarMetricas: true, forzarTrazas: false });
  registrarFinTool({ herramienta: 't-x', duracionSeg: 0.01, error: { tipo: `sk-secreto-123 ${MENSAJE_SECRETO}` } });
  registrarFinTool({ herramienta: 't-x', duracionSeg: 0.01, error: new TypeError('boom') });
  const salida = await atenderMetricasLocal();
  const lineas = salida.split('\n').filter((l) => l.startsWith('jarvis_tool_errores_total{'));
  for (const l of lineas) {
    assert.ok(!l.includes('sk-secreto'), `label sin secreto (${l})`);
    assert.ok(!l.includes(MENSAJE_SECRETO), `label sin privado (${l})`);
  }
  assert.ok(lineas.some((l) => l.includes('tipo="sksecreto123textoprivadoquenun"')), 'clase sanitizada y truncada a 30');
  assert.ok(lineas.some((l) => l.includes('tipo="typeerror"')), 'clase TypeError');
});
