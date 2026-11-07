/**
 * memoria_ruta_natural.test.js - Regresiones del fallo observado con modelo
 * real (7 nov 2026): "guarda en memoria que el color del prototipo Zeta es
 * verde botella" no ofrecia NINGUNA herramienta al modelo (el regex no
 * conocia esa formulacion), el modelo fingia "Guardado..." y la consulta
 * siguiente no recuperaba nada.
 *
 * Cubre, por el camino real del agente (consultarJarvis con modelo simulado):
 * 1. El router reconoce formulaciones naturales variadas de guardado y de
 *    consulta, y sigue sin robar recordatorios temporales.
 * 2. Guardar -> recuperar -> actualizar -> olvidar funcionan al momento.
 * 3. Sin memoria guardada, la respuesta honesta pasa tal cual.
 * 4. Una confirmacion de guardado NO respaldada por guardar_memoria se
 *    corrige antes de salir; una negacion ("no he guardado nada") no se toca.
 *
 * Strict Policy: Zero Emojis.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { analizarIntencion, consultarJarvis } from '../../src/core/jarvisAgent.js';
import { guardHallucinations } from '../../src/services/preSendGuardrailService.js';
import {
  buscarMemoriaSemantica,
  getDefaultStorePath,
  getDefaultVectorsPath,
  invalidarIndiceSemantico
} from '../../src/services/semanticMemoryService.js';

const STORE = getDefaultStorePath();
const VECTORS = getDefaultVectorsPath();

// La suite comparte un DAVIS_DATA_DIR temporal: snapshot/restauracion para
// no pisar a los archivos de tests que corren despues.
const respaldo = new Map();
for (const p of [STORE, VECTORS]) {
  try { respaldo.set(p, fs.readFileSync(p)); } catch { respaldo.set(p, null); }
}
test.after(() => {
  invalidarIndiceSemantico();
  for (const [p, contenido] of respaldo) {
    try {
      if (contenido === null) fs.rmSync(p, { force: true });
      else fs.writeFileSync(p, contenido);
    } catch { /* restauracion best-effort */ }
  }
});

function limpiar() {
  invalidarIndiceSemantico();
  for (const p of [STORE, VECTORS]) {
    try { fs.rmSync(p, { force: true }); } catch { /* aislado */ }
  }
  fs.mkdirSync(path.dirname(STORE), { recursive: true });
  fs.writeFileSync(STORE, '[]', 'utf8');
}

function nombresHerramientas(mensaje) {
  return analizarIntencion(mensaje).herramientas.map((h) => h.function.name);
}

// ---------------------------------------------------------------------------
// 1. Router: formulaciones naturales de guardado y consulta
// ---------------------------------------------------------------------------

test('Router: formulaciones naturales de guardado ofrecen las herramientas de memoria', () => {
  const formulaciones = [
    'guarda en memoria que el color del prototipo Zeta es verde botella',
    'guarda esto en tu memoria: el codigo del garaje es 4421',
    'memoriza que la wifi de casa es CasaWifi23',
    'anota en memoria que la talla de Ana es la 38',
    'apunta en tu segundo cerebro que el coche es un Seat Leon rojo',
    'graba en la memoria que el pasaporte caduca en 2031',
    'recuerda que mi talla de zapatillas es la 44'
  ];
  for (const frase of formulaciones) {
    const nombres = nombresHerramientas(frase);
    assert.ok(nombres.includes('guardar_memoria'), `falta guardar_memoria para: "${frase}"`);
  }
});

test('Router: formulaciones naturales de consulta ofrecen las herramientas de memoria', () => {
  const formulaciones = [
    'que sabes de la tia Pili',
    'te acuerdas de la talla de Ana',
    'busca en tu memoria lo del dentista',
    'consulta tu memoria sobre el prototipo Zeta',
    'que tienes guardado sobre el coche'
  ];
  for (const frase of formulaciones) {
    const nombres = nombresHerramientas(frase);
    assert.ok(
      nombres.includes('buscar_memoria') || nombres.includes('listar_memorias'),
      `faltan herramientas de consulta para: "${frase}"`
    );
  }
});

test('Router: parafrasis de recuerdo van a memoria, no a comunicacion', () => {
  // Fallo observado en vivo con modelo real (7 nov 2026): "cual era el tono
  // que te dije para el prototipo Zeta?" caia en comunicacion por "que te
  // dije" y el modelo recibia 15 herramientas irrelevantes y ninguna de
  // memoria (~5.4k tokens de prompt desperdiciados).
  const formulaciones = [
    'cual era el tono que te dije para el prototipo Zeta?',
    'que te dije del prototipo Zeta?',
    'lo que te pedi que apuntaras del dentista',
    'cual es la clave que te conte del garaje?'
  ];
  for (const frase of formulaciones) {
    const r = analizarIntencion(frase);
    const nombres = r.herramientas.map((h) => h.function.name);
    assert.ok(
      nombres.includes('buscar_memoria') || nombres.includes('listar_memorias'),
      `faltan herramientas de memoria para: "${frase}"`
    );
    assert.ok(!r.intenciones.includes('comunicacion'), `comunicacion no debe capturar: "${frase}"`);
    assert.ok(nombres.length <= 8, `demasiadas herramientas (${nombres.length}) para: "${frase}"`);
  }
});

test('Router: "que te dije" con referencia temporal sigue yendo al historial', () => {
  const r = analizarIntencion('que te dije ayer despues de comer?');
  const nombres = r.herramientas.map((h) => h.function.name);
  assert.ok(nombres.includes('buscar_en_historial'), 'el historial conserva su ruta');
  assert.ok(!r.intenciones.includes('memoria'), 'una consulta de historial no es memoria');
});

test('Router: los recordatorios temporales NO caen en memoria', () => {
  const r1 = analizarIntencion('recuerdame llamar a Ana a las 5');
  const n1 = r1.herramientas.map((h) => h.function.name);
  assert.ok(!n1.includes('guardar_memoria'), 'un recordatorio a hora fija no debe guardarse como memoria');
  assert.ok(n1.some((n) => n.includes('recordatorio')), 'el recordatorio debe ofrecer su herramienta');

  const r2 = analizarIntencion('avisame manana a las 9 de lo del medico');
  assert.ok(!r2.herramientas.map((h) => h.function.name).includes('guardar_memoria'));
});

// ---------------------------------------------------------------------------
// 2. Camino real con modelo simulado: guardar, recuperar, actualizar, olvidar
// ---------------------------------------------------------------------------

function chatDeGuardado(capturadas) {
  let ronda = 0;
  return async (peticion) => {
    ronda++;
    capturadas.push(peticion);
    if (ronda === 1) {
      return { message: { role: 'assistant', content: null, tool_calls: [
        { id: 'c1', type: 'function', function: { name: 'guardar_memoria', arguments: { sujeto: 'Color del prototipo Zeta', dato: 'El color del prototipo Zeta es verde botella.', categoria: 'persona' } } }
      ] } };
    }
    return { message: { role: 'assistant', content: 'Guardado en el Second Brain, senor.' } };
  };
}

test('Camino real: "guarda en memoria que..." ofrece la herramienta, guarda y confirma con respaldo', async () => {
  limpiar();
  const capturadas = [];
  const respuesta = await consultarJarvis('guarda en memoria que el color del prototipo Zeta es verde botella', [], {
    chatCompletion: chatDeGuardado(capturadas)
  });

  const ofrecidas = (capturadas[0].tools || []).map((h) => h.function.name);
  assert.ok(ofrecidas.includes('guardar_memoria'), 'la primera llamada al modelo debe ofrecer guardar_memoria');

  const memoria = JSON.parse(fs.readFileSync(STORE, 'utf8'));
  assert.equal(memoria.length, 1, 'la memoria debe quedar persistida');
  assert.match(memoria[0].dato, /verde botella/);

  // La confirmacion esta respaldada por la herramienta: NO se corrige.
  assert.match(respuesta, /Guardado/);
});

test('Camino real: la consulta siguiente recupera el dato por RAG y lo inyecta al prompt', async () => {
  limpiar();
  const capturadasGuardado = [];
  await consultarJarvis('guarda en memoria que el color del prototipo Zeta es verde botella', [], {
    chatCompletion: chatDeGuardado(capturadasGuardado)
  });

  // Recuperacion semantica directa
  const hits = await buscarMemoriaSemantica('de que color es el prototipo Zeta', {});
  assert.ok(hits.length > 0, 'el RAG debe encontrar el color recien guardado');
  assert.match(hits[0].dato, /verde botella/);

  // Y la pregunta en lenguaje natural lo lleva inyectado al prompt del modelo
  const capturadasConsulta = [];
  const respuesta = await consultarJarvis('de que color es el prototipo Zeta?', [], {
    chatCompletion: async (peticion) => {
      capturadasConsulta.push(JSON.stringify(peticion.messages));
      return { message: { role: 'assistant', content: 'El prototipo Zeta es verde botella, senor.' } };
    }
  });
  assert.match(respuesta, /verde botella/);
  assert.ok(capturadasConsulta.some((m) => /verde botella/.test(m)), 'la memoria debe llegar inyectada al prompt');
});

test('Camino real: actualizar el mismo hecho devuelve el dato nuevo y olvidar lo borra', async () => {
  limpiar();
  const guardar = (dato) => {
    let ronda = 0;
    return async () => {
      ronda++;
      if (ronda === 1) {
        return { message: { role: 'assistant', content: null, tool_calls: [
          { id: 'c1', type: 'function', function: { name: 'guardar_memoria', arguments: { sujeto: 'Color del prototipo Zeta', dato, categoria: 'persona' } } }
        ] } };
      }
      return { message: { role: 'assistant', content: 'Guardado.' } };
    };
  };

  await consultarJarvis('guarda en memoria que el color del prototipo Zeta es verde botella', [], { chatCompletion: guardar('El color del prototipo Zeta es verde botella.') });
  await consultarJarvis('guarda en memoria que el color del prototipo Zeta ahora es azul oscuro', [], { chatCompletion: guardar('El color del prototipo Zeta es azul oscuro.') });

  const trasActualizar = await buscarMemoriaSemantica('color prototipo Zeta', {});
  assert.ok(trasActualizar.length > 0);
  assert.match(trasActualizar[0].dato, /azul oscuro/, 'la busqueda debe reflejar la actualizacion');
  assert.doesNotMatch(trasActualizar[0].dato, /verde botella/);

  // Olvidar por el camino real
  let rondaOlvido = 0;
  const respuesta = await consultarJarvis('olvida que te dije del prototipo Zeta', [], {
    chatCompletion: async () => {
      rondaOlvido++;
      if (rondaOlvido === 1) {
        return { message: { role: 'assistant', content: null, tool_calls: [
          { id: 'c1', type: 'function', function: { name: 'olvidar_memoria', arguments: { criterio: 'prototipo Zeta' } } }
        ] } };
      }
      return { message: { role: 'assistant', content: 'He borrado la memoria del prototipo Zeta.' } };
    }
  });
  assert.ok(rondaOlvido >= 1);
  const trasOlvidar = await buscarMemoriaSemantica('color prototipo Zeta', {});
  assert.equal(trasOlvidar.length, 0, 'una memoria olvidada no puede seguir saliendo');
  assert.match(respuesta, /borrado|eliminado|olvidado/i);
});

// ---------------------------------------------------------------------------
// 3. Honestidad sin memoria y correccion de confirmaciones falsas
// ---------------------------------------------------------------------------

test('Sin memoria guardada, la respuesta honesta del modelo pasa sin correccion', async () => {
  limpiar();
  const respuesta = await consultarJarvis('de que color es el prototipo Zeta?', [], {
    chatCompletion: async () => ({ message: { role: 'assistant', content: 'No tengo nada guardado sobre el prototipo Zeta, senor; si me lo dices, lo guardo.' } })
  });
  assert.match(respuesta, /No tengo nada guardado/);
});

test('Guardarrail: una confirmacion de guardado SIN herramienta se corrige antes de salir', async () => {
  limpiar();
  const respuesta = await consultarJarvis('guarda en memoria que el color del prototipo Zeta es verde botella', [], {
    chatCompletion: async () => ({ message: { role: 'assistant', content: 'Guardado en tu memoria, David. Lo recordare.' } })
  });
  assert.match(respuesta, /No he podido guardarlo/, 'la confirmacion falsa debe sustituirse por una declaracion honesta');
  assert.doesNotMatch(respuesta, /Lo recordare/);
  assert.doesNotMatch(respuesta, /dimelo de nuevo/, 'la correccion no debe prometer un guardado futuro que no esta garantizado');
  const memoria = JSON.parse(fs.readFileSync(STORE, 'utf8'));
  assert.equal(memoria.length, 0, 'no debe haberse guardado nada');
});

test('Guardarrail: una negacion ("no he guardado nada") NO se corrige', () => {
  const r = guardHallucinations('Todavia no he guardado nada en memoria, senor.', { traza: { llamadas: [] } });
  assert.equal(r.huboCorreccion, false);
  assert.match(r.textoModificado, /no he guardado nada/);
});

test('Guardarrail: una confirmacion respaldada por guardar_memoria exitoso NO se corrige', () => {
  const r = guardHallucinations('Guardado en el Second Brain, senor.', {
    traza: { llamadas: [{ nombre: 'guardar_memoria', resultado: 'ok' }] }
  });
  assert.equal(r.huboCorreccion, false);
  assert.match(r.textoModificado, /Guardado/);
});
