/**
 * tool_validation_400_unit.test.js
 *
 * Recuperacion ante 400 de validacion de tool-call del provider (R05 de la
 * evaluacion con modelo real: argumentos malformed categoria:null, el
 * provider rechazo la peticion y David se quedaba sin respuesta).
 *
 * Un 400 de validacion es previo a cualquier ejecucion: reintentar es
 * seguro. Se permite UN reintento con pista de esquema y, si persiste,
 * una respuesta degradada sin herramientas. Otros errores se propagan.
 *
 * Strict Policy: Zero Emojis.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'path';
import os from 'os';

const dirEntorno = fs.mkdtempSync(path.join(os.tmpdir(), 'davis-400-'));
process.env.DAVIS_DATA_DIR = path.join(dirEntorno, 'data');
process.env.DAVIS_HISTORY_DIR = path.join(dirEntorno, 'history');
process.env.NODE_ENV = 'test';

const { consultarJarvisAislado: consultarJarvis } = await import('../helpers/jarvisAislado.js');

const ERR_400 = '400 Tool call validation failed: tool call validation failed: parameters for tool obtener_noticias_actuales did not match schema: errors: [`/categoria`: expected string, but got null]';

test('400 de validacion: un reintento con pista de esquema recupera la respuesta', async () => {
  let llamadas = 0;
  let pistaVista = false;
  const chatFalso = async ({ messages }) => {
    llamadas++;
    if (llamadas === 1) throw new Error(ERR_400);
    if (messages.some((m) => m.role === 'system' && /argumentos invalidos/.test(m.content || ''))) pistaVista = true;
    return { message: { role: 'assistant', content: 'No tengo una primera noticia que resumir; quieres que busque titulares?' } };
  };
  const respuesta = await consultarJarvis('resume la primera noticia', [], { chatCompletion: chatFalso });
  assert.equal(llamadas, 2, 'exactamente un reintento');
  assert.ok(pistaVista, 'el reintento lleva la pista de esquema');
  assert.match(respuesta, /primera noticia/i, 'David recibe una respuesta, no silencio');
});

test('400 persistente: degradado sin herramientas, sin bucle de reintentos', async () => {
  let llamadas = 0;
  let herramientasEnUltima = 'n/a';
  const chatFalso = async ({ messages, tools }) => {
    llamadas++;
    if (llamadas <= 2) throw new Error(ERR_400);
    herramientasEnUltima = tools === undefined ? 'sin-herramientas' : 'con-herramientas';
    return { message: { role: 'assistant', content: 'Ahora mismo no puedo usar esa funcion; dime que necesitas y lo intento de otra forma.' } };
  };
  const respuesta = await consultarJarvis('resume la primera noticia', [], { chatCompletion: chatFalso });
  assert.equal(llamadas, 3, 'original + 1 reintento + 1 degradada; acotado');
  assert.equal(herramientasEnUltima, 'sin-herramientas', 'la degradada va sin tools para no repetir el 400');
  assert.ok(respuesta.length > 0, 'respuesta honesta en lugar de silencio');
});

test('Errores que no son 400 de validacion se propagan sin reintentar', async () => {
  let llamadas = 0;
  const chatFalso = async () => { llamadas++; throw new Error('500 Internal Server Error'); };
  await assert.rejects(() => consultarJarvis('resume la primera noticia', [], { chatCompletion: chatFalso }), /500/);
  assert.equal(llamadas, 1, 'sin reintento ciego de un error no acotado');
});

test('400 en la degradada (tool choice none): fallback fijo honesto, sin mas llamadas ni exito fingido', async () => {
  let llamadas = 0;
  const chatFalso = async () => {
    llamadas++;
    if (llamadas <= 2) throw new Error(ERR_400);
    throw new Error('400 Tool choice is none, but model called a tool');
  };
  const respuesta = await consultarJarvis('resume la primera noticia', [], { chatCompletion: chatFalso });
  assert.equal(llamadas, 3, 'original + reintento + degradada; no hay cuarta llamada');
  assert.match(respuesta, /NO se ha realizado ninguna accion/i, 'declara con exactitud que no hubo accion');
  assert.ok(!/completad[ao]|programad[ao]|enviad[ao]/i.test(respuesta.replace(/No he podido completar/, '')), 'no afirma exito');
});

test('Respuesta vacia tras agotar rondas: fallback honesto que declara si hubo efectos', async () => {
  let llamadas = 0;
  const chatFalso = async () => {
    llamadas++;
    if (llamadas <= 3) {
      return { message: { role: 'assistant', content: '', tool_calls: [{ id: 'c' + llamadas, function: { name: 'listar_recordatorios', arguments: {} } }] } };
    }
    return { message: { role: 'assistant', content: '' } };
  };
  const ejecutores = { listar_recordatorios: async () => 'No tienes recordatorios.' };
  const respuesta = await consultarJarvis('dime todos mis recordatorios', [], { chatCompletion: chatFalso, ejecutores });
  assert.ok(respuesta.length > 0, 'nunca se entrega silencio');
  assert.match(respuesta, /NO se ha realizado ninguna accion/i, 'solo lecturas: declara que no hubo acciones con efectos');
});
