/**
 * history_condensation.test.js
 * Hallazgo revision 3, punto 1: la condensacion del historial estaba
 * implementada pero nunca se activaba; estos tests fijan el cableado
 * (programarCondensacionSiNecesario) con LLM simulado: comportamiento
 * determinista del orquestador, no calidad del modelo real.
 *
 * Strict Policy: Zero Emojis.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'path';
import os from 'os';

const dirHistorial = fs.mkdtempSync(path.join(os.tmpdir(), 'davis-cond-'));
process.env.DAVIS_HISTORY_DIR = dirHistorial;

const historial = await import('../../src/services/conversationHistoryService.js');

const fakeResumen = (texto) => async ({ messages }) => ({
  message: { content: texto ?? 'resumen simulado de la conversacion' }
});

function sembrar(chatId, n) {
  for (let i = 0; i < n; i++) {
    historial.registrarMensaje(chatId, i % 2 === 0 ? 'user' : 'assistant', `mensaje ${i} de ${chatId}`);
  }
}

test('bajo el umbral no programa condensacion', () => {
  sembrar('chat-bajo', 10);
  assert.equal(historial.programarCondensacionSiNecesario('chat-bajo', { chatCompletion: fakeResumen() }), null);
  assert.equal(historial.contarMensajes('chat-bajo'), 10);
});

test('al llegar al tope condensa: resumen fusionado y ventana reciente', async () => {
  sembrar('chat-tope', historial.MAX_MENSAJES_ARCHIVO);
  let mensajesRecibidos = null;
  const tarea = historial.programarCondensacionSiNecesario('chat-tope', {
    chatCompletion: async ({ messages }) => { mensajesRecibidos = messages; return { message: { content: 'RESUMEN FUSIONADO' } }; }
  });
  assert.ok(tarea, 'debe lanzar la condensacion al llegar al tope');
  const res = await tarea;
  assert.equal(res.condensado, true);
  assert.ok(mensajesRecibidos, 'el LLM simulado recibio el transcript');
  assert.equal(historial.contarMensajes('chat-tope'), historial.MAX_MENSAJES_VENTANA);
  const ctx = historial.obtenerHistorial('chat-tope');
  assert.equal(ctx[0].role, 'system');
  assert.ok(ctx[0].content.includes('RESUMEN FUSIONADO'));
});

test('una condensacion en curso no se duplica', async () => {
  sembrar('chat-dedup', historial.MAX_MENSAJES_ARCHIVO);
  let liberar;
  const bloqueo = new Promise(r => { liberar = r; });
  const lenta = async () => { await bloqueo; return { message: { content: 'resumen lento' } }; };
  const t1 = historial.programarCondensacionSiNecesario('chat-dedup', { chatCompletion: lenta });
  const t2 = historial.programarCondensacionSiNecesario('chat-dedup', { chatCompletion: lenta });
  assert.equal(t1, t2, 'la segunda llamada reutiliza la condensacion en curso');
  liberar();
  await t1;
  assert.equal(historial.contarMensajes('chat-dedup'), historial.MAX_MENSAJES_VENTANA);
});

test('los mensajes registrados durante la condensacion no se pierden', async () => {
  sembrar('chat-carrera', historial.MAX_MENSAJES_ARCHIVO);
  let liberar;
  const bloqueo = new Promise(r => { liberar = r; });
  const lenta = async () => { await bloqueo; return { message: { content: 'resumen carrera' } }; };
  const tarea = historial.programarCondensacionSiNecesario('chat-carrera', { chatCompletion: lenta });
  await new Promise(r => setTimeout(r, 20));
  historial.registrarMensaje('chat-carrera', 'user', 'MENSAJE DURANTE CONDENSACION');
  liberar();
  await tarea;
  const ctx = historial.obtenerHistorial('chat-carrera', 50);
  const contenidos = ctx.map(m => m.content);
  assert.ok(contenidos.some(c => c === 'MENSAJE DURANTE CONDENSACION'), 'el mensaje nuevo sobrevive a la condensacion');
});

test('si el historial se borra durante la condensacion, no resucita', async () => {
  sembrar('chat-borrado', historial.MAX_MENSAJES_ARCHIVO);
  let liberar;
  const bloqueo = new Promise(r => { liberar = r; });
  const lenta = async () => { await bloqueo; return { message: { content: 'resumen borrado' } }; };
  const tarea = historial.programarCondensacionSiNecesario('chat-borrado', { chatCompletion: lenta });
  await new Promise(r => setTimeout(r, 20));
  historial.limpiarHistorial('chat-borrado');
  liberar();
  const res = await tarea;
  assert.equal(res.condensado, false);
  assert.equal(historial.contarMensajes('chat-borrado'), 0, 'el historial borrado no vuelve a aparecer');
});

test('si el LLM falla, igualmente recorta y conserva el resumen previo', async () => {
  sembrar('chat-fallo', historial.MAX_MENSAJES_ARCHIVO);
  const res = await historial.programarCondensacionSiNecesario('chat-fallo', {
    chatCompletion: async () => { throw new Error('LLM simulado caido'); }
  });
  assert.equal(res.condensado, true);
  assert.equal(historial.contarMensajes('chat-fallo'), historial.MAX_MENSAJES_VENTANA);
  const ctx = historial.obtenerHistorial('chat-fallo');
  assert.ok(!ctx.some(m => m.role === 'system'), 'sin resumen nuevo no se inyecta nada');
});
