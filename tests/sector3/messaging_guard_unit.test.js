/**
 * messaging_guard_unit.test.js
 *
 * Guard de destinatario verificado para herramientas de envio a terceros
 * (R09 de la evaluacion con modelo real: el modelo invento un numero y
 * programo un WhatsApp). El numero debe constar en un mensaje de David de
 * este chat o en una ficha de contacto; la memoria libre NO es fuente
 * confiable porque la puede escribir el propio modelo.
 *
 * LLM guionizado y ejecutores espia: determinista, sin llamadas reales.
 *
 * Strict Policy: Zero Emojis.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'path';
import os from 'os';
import util from 'node:util';

const dirEntorno = fs.mkdtempSync(path.join(os.tmpdir(), 'davis-msg-guard-'));
process.env.DAVIS_DATA_DIR = path.join(dirEntorno, 'data');
process.env.DAVIS_HISTORY_DIR = path.join(dirEntorno, 'history');
process.env.NODE_ENV = 'test';

const { consultarJarvisAislado: consultarJarvis } = await import('../helpers/jarvisAislado.js');
const { registrarContacto } = await import('../../src/services/contactsService.js');
const { guardarMemoria } = await import('../../src/services/memoryService.js');

const NUMERO_INVENTADO = '676899520';

function llmQuePropone(envio, observaciones) {
  let fase = 0;
  return async ({ messages }) => {
    for (const m of messages) {
      if (m.role === 'tool' && !observaciones.mensajesTool.includes(m.content)) {
        observaciones.mensajesTool.push(m.content);
      }
    }
    if (fase === 0) {
      fase = 1;
      return { message: { role: 'assistant', content: '', tool_calls: [{ id: 'c1', function: { name: 'programar_mensaje_whatsapp', arguments: envio } }] } };
    }
    const bloqueado = observaciones.mensajesTool.some((t) => t.includes('Bloqueado por seguridad'));
    return { message: { role: 'assistant', content: bloqueado ? 'David, necesito el numero de telefono del destinatario para programar el mensaje.' : 'Mensaje programado.' } };
  };
}

function espiaEjecutores(observaciones) {
  return {
    programar_mensaje_whatsapp: async (args) => {
      observaciones.ejecuciones.push(args);
      return 'OK simulado';
    }
  };
}

function opciones(observaciones, extra = {}) {
  return {
    chatCompletion: llmQuePropone({ numero: NUMERO_INVENTADO, mensaje: 'Ya he salido', minutosEnElFuturo: 15, inmediato: false }, observaciones),
    ejecutores: espiaEjecutores(observaciones),
    ...extra
  };
}

test('Guard: numero inventado por el modelo NO se ejecuta y se pide el numero', async () => {
  const obs = { ejecuciones: [], mensajesTool: [] };
  const respuesta = await consultarJarvis('dile a mi madre en 15 minutos que ya he salido', [], opciones(obs));
  assert.equal(obs.ejecuciones.length, 0, 'el ejecutor no debe ser invocado con un numero sin fuente confiable');
  assert.ok(obs.mensajesTool.some((t) => t.includes('Bloqueado por seguridad')), 'el resultado de herramienta registra el bloqueo');
  assert.match(respuesta, /numero de telefono/i, 'la respuesta pide el numero en lugar de afirmar el envio');
  assert.ok(!respuesta.includes('programado para'), 'no afirma un envio que no ocurrio');
});

test('Guard: numero presente en el mensaje de David si se ejecuta', async () => {
  const obs = { ejecuciones: [], mensajesTool: [] };
  await consultarJarvis(`dile a mi madre en 15 minutos que ya he salido, su numero es ${NUMERO_INVENTADO}`, [], opciones(obs));
  assert.equal(obs.ejecuciones.length, 1, 'numero aportado por David en el mensaje: permitido');
  assert.equal(String(obs.ejecuciones[0].numero), NUMERO_INVENTADO);
});

test('Guard: numero que consta en una ficha de contacto si se ejecuta', async () => {
  const rutaContactos = path.join(dirEntorno, 'contactos.json');
  const res = registrarContacto({ nombre: 'Madre', telefono: `+34 ${NUMERO_INVENTADO}`, relacion: 'familia' }, { rutaArchivo: rutaContactos });
  assert.ok(res.ok, res.error);
  const obs = { ejecuciones: [], mensajesTool: [] };
  await consultarJarvis('dile a mi madre en 15 minutos que ya he salido', [], opciones(obs, { rutaArchivoContactos: rutaContactos }));
  assert.equal(obs.ejecuciones.length, 1, 'numero verificado por ficha de contacto: permitido');
});

test('Guard: un numero en la memoria libre NO autoriza (envenenamiento de memoria)', async () => {
  const resMem = guardarMemoria({ sujeto: 'madre', dato: `su telefono es ${NUMERO_INVENTADO}` });
  assert.ok(resMem.ok, resMem.error);
  const obs = { ejecuciones: [], mensajesTool: [] };
  const respuesta = await consultarJarvis('dile a mi madre en 15 minutos que ya he salido', [], opciones(obs));
  assert.equal(obs.ejecuciones.length, 0, 'la memoria escribible por el modelo no es fuente confiable');
  assert.match(respuesta, /numero de telefono/i);
});

test('Guard: un numero sin relacion en el mensaje no autoriza otro distinto', async () => {
  const obs = { ejecuciones: [], mensajesTool: [] };
  await consultarJarvis('mi numero es 600111222. dile a mi madre en 15 minutos que ya he salido', [], opciones(obs));
  assert.equal(obs.ejecuciones.length, 0, 'el numero de David no autoriza el inventado para su madre');
});

test('Guard: numero aportado por David antes en el mismo chat si se ejecuta', async () => {
  const obs = { ejecuciones: [], mensajesTool: [] };
  const historial = [
    { role: 'user', content: `apunta: el movil de mi madre es ${NUMERO_INVENTADO}` },
    { role: 'assistant', content: 'Anotado.' }
  ];
  await consultarJarvis('dile a mi madre en 15 minutos que ya he salido', historial, opciones(obs));
  assert.equal(obs.ejecuciones.length, 1, 'numero aportado por David antes en el chat: permitido');
});

test('Privacidad: los logs no muestran telefonos ni contenidos de mensajes', async () => {
  const obs = { ejecuciones: [], mensajesTool: [] };
  const salida = [];
  const logOriginal = console.log;
  const warnOriginal = console.warn;
  console.log = (...a) => { salida.push(a.map((v) => (typeof v === 'object' && v !== null ? util.inspect(v) : String(v))).join(' ')); };
  console.warn = (...a) => { salida.push(a.map((v) => (typeof v === 'object' && v !== null ? util.inspect(v) : String(v))).join(' ')); };
  const rutaContactos = path.join(dirEntorno, 'contactos-log.json');
  registrarContacto({ nombre: 'Madre', telefono: NUMERO_INVENTADO }, { rutaArchivo: rutaContactos });
  try {
    // El numero SOLO consta en la ficha: si aparece en los logs, la fuga
    // viene de los argumentos de la herramienta, no del texto de David.
    await consultarJarvis('dile a mi madre en 15 minutos que ya he salido', [], opciones(obs, { rutaArchivoContactos: rutaContactos }));
  } finally {
    console.log = logOriginal;
    console.warn = warnOriginal;
  }
  const textoLog = salida.join('\n');
  assert.ok(!textoLog.includes(NUMERO_INVENTADO), 'el numero no aparece en los logs');
  assert.ok(!textoLog.includes('Ya he salido'), 'el contenido del mensaje no aparece en los logs');
  assert.ok(/redactado/.test(textoLog), 'la redaccion queda marcada');
});
