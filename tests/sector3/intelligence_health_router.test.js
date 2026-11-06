/**
 * intelligence_health_router.test.js
 * Plan de inteligencia aprobado por David (6 nov 2026, WhatsApp
 * wamid.HBgLMzQ2MzU2MDU2MDUVAgASGBQzQTk0QjkyMjk0OTdCQkVFODE2NAA=
 * "vale ahora vamos a empezar a hacerlo mas inteligente, sigue el plan"):
 * 1. Enrutador en dos niveles: una seleccion que supera el limite del
 *    proveedor ya no se rinde con 0 herramientas; el modelo elige las areas
 *    dominantes entre las detectadas y se ofrecen solo las suyas.
 * 2. Salud del clasificador: cada clasificacion queda registrada; tasa de
 *    fallo >=80% en las ultimas 10 = aviso a David como mucho 1 vez/24h.
 * 3. Recuperacion de errores de herramienta: el error de solo lectura lista
 *    los parametros aceptados para corregir el reintento.
 *
 * Strict Policy: Zero Emojis.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'path';
import os from 'os';

const dirEntorno = fs.mkdtempSync(path.join(os.tmpdir(), 'davis-intel-'));
process.env.DAVIS_HISTORY_DIR = path.join(dirEntorno, 'history');
process.env.NODE_ENV = 'test';

const router = await import('../../src/core/intentRouterService.js');
const agente = await import('../../src/core/jarvisAgent.js');
const { herramientasJarvis } = await import('../../src/core/tools.js');

function rutaMetricas(nombre) {
  return path.join(dirEntorno, nombre);
}

function chatCon(respuesta) {
  return async () => ({ message: { content: respuesta } });
}

// ---------- 1. Enrutador en dos niveles ----------

test('dos niveles: seleccion >128 se reduce a las areas dominantes elegidas por el modelo', async () => {
  const r = await agente.resolverSeleccionConDosNiveles({
    seleccion: herramientasJarvis, // 136 > 128
    intenciones: ['estudio', 'finanzas', 'clima'],
    mensaje: 'organiza mi semana de estudio y apunta lo que gaste en libros',
    deps: { chatCompletion: chatCon('estudio, finanzas') }
  });
  const nombres = r.herramientas.map((h) => h.function.name);
  assert.equal(r.directiva, '');
  assert.ok(nombres.includes('planificar_estudio'), 'incluye estudio');
  assert.ok(nombres.includes('registrar_gasto'), 'incluye finanzas');
  assert.ok(!nombres.includes('consultar_clima'), 'excluye el area no elegida');
  assert.ok(nombres.length < 30, 'seleccion acotada');
});

test('dos niveles: si el modelo no responde algo aprovechable, politica honesta (0 herramientas + directiva)', async () => {
  const r = await agente.resolverSeleccionConDosNiveles({
    seleccion: herramientasJarvis,
    intenciones: ['estudio', 'finanzas'],
    mensaje: 'liada gorda con todo a la vez',
    deps: { chatCompletion: chatCon('no sabria decirte') }
  });
  assert.equal(r.herramientas.length, 0);
  assert.ok(r.directiva.includes('DIRECTIVA DE ALCANCE'));
});

test('dos niveles: seleccion que cabe pasa sin llamar al modelo', async () => {
  let llamadas = 0;
  const tres = herramientasJarvis.slice(0, 3);
  const r = await agente.resolverSeleccionConDosNiveles({
    seleccion: tres,
    intenciones: ['clima'],
    mensaje: 'que tiempo hace',
    deps: { chatCompletion: async () => { llamadas++; return { message: { content: 'clima' } }; } }
  });
  assert.equal(r.herramientas.length, 3);
  assert.equal(r.directiva, '');
  assert.equal(llamadas, 0, 'sin llamada extra al modelo');
});

test('seleccionarDominiosConModelo filtra etiquetas inventadas y limita a dos', async () => {
  const elegidos = await router.seleccionarDominiosConModelo('mensaje', ['estudio', 'finanzas', 'clima'], {
    chatCompletion: chatCon('estudio, cocina, finanzas, clima')
  });
  assert.deepEqual(elegidos, ['estudio', 'finanzas']);
});

// ---------- 2. Salud del clasificador ----------

test('clasificarIntencionConModelo registra ok, baja_confianza, parse_fail y error', async () => {
  const ruta = rutaMetricas('metricas1.jsonl');
  const deps = { rutaArchivoMetricasClasificador: ruta };
  await router.clasificarIntencionConModelo('dime el tiempo', { ...deps, chatCompletion: chatCon('{"intencion":"clima","confianza":0.9}') });
  await router.clasificarIntencionConModelo('dime el tiempito', { ...deps, chatCompletion: chatCon('{"intencion":"clima","confianza":0.2}') });
  await router.clasificarIntencionConModelo('dime el tiempazo', { ...deps, chatCompletion: chatCon('ni idea, la verdad') });
  await router.clasificarIntencionConModelo('dime el tiempin', { ...deps, chatCompletion: async () => { throw new Error('proveedor caido'); } });
  const eventos = fs.readFileSync(ruta, 'utf-8').trim().split('\n').map(JSON.parse);
  const resultados = eventos.map((e) => e.resultado);
  assert.deepEqual(resultados, ['ok', 'baja_confianza', 'parse_fail', 'error']);
});

test('salud no saludable con >=80% de fallos en las ultimas 10 y avisa una sola vez en 24h', async () => {
  const ruta = rutaMetricas('metricas2.jsonl');
  const deps = { rutaArchivoMetricasClasificador: ruta };
  // 10 clasificaciones reales: 9 fallos, 1 ok
  for (let i = 0; i < 9; i++) {
    await router.clasificarIntencionConModelo(`mensaje fallo ${i}`, { ...deps, chatCompletion: chatCon('...') });
  }
  await router.clasificarIntencionConModelo('mensaje bueno', { ...deps, chatCompletion: chatCon('{"intencion":"clima","confianza":0.95}') });
  const salud = router.evaluarSaludClasificador(deps);
  assert.equal(salud.saludable, false);
  assert.equal(salud.muestras, 10);
  const avisos = [];
  const depsAviso = { ...deps, avisarSaludClasificador: async (t) => avisos.push(t) };
  assert.equal(await router.comprobarYAvisarSalud(depsAviso), true);
  assert.equal(await router.comprobarYAvisarSalud(depsAviso), false, 'cooldown 24h: no repite');
  assert.equal(avisos.length, 1);
  assert.ok(avisos[0].includes('90%'));
});

test('salud saludable con pocos fallos o pocas muestras: no avisa', async () => {
  const ruta = rutaMetricas('metricas3.jsonl');
  const deps = { rutaArchivoMetricasClasificador: ruta };
  for (let i = 0; i < 9; i++) {
    await router.clasificarIntencionConModelo(`bien ${i}`, { ...deps, chatCompletion: chatCon('{"intencion":"clima","confianza":0.9}') });
  }
  await router.clasificarIntencionConModelo('un fallo', { ...deps, chatCompletion: chatCon('???') });
  assert.equal(router.evaluarSaludClasificador(deps).saludable, true);
  const avisos = [];
  assert.equal(await router.comprobarYAvisarSalud({ ...deps, avisarSaludClasificador: async (t) => avisos.push(t) }), false);
  assert.equal(avisos.length, 0);
});

// ---------- 3. Recuperacion de errores de herramienta ----------

test('error de consulta: invita a reintentar y lista los parametros aceptados', () => {
  const texto = agente.describirErrorHerramienta('buscar_memoria', new Error('timeout'), true);
  assert.ok(texto.includes('reintentala con argumentos corregidos'));
  assert.ok(texto.includes('Parametros aceptados:'));
  assert.ok(texto.includes('consulta'), texto);
});

test('error de accion con efectos: prohibido reintentar a ciegas', () => {
  const texto = agente.describirErrorHerramienta('crear_recordatorio', new Error('fallo io'), false);
  assert.ok(texto.includes('NO la reintentes automaticamente'));
  assert.ok(texto.includes('verifica primero el efecto real'));
});
