/**
 * golden_battery.test.js
 *
 * Ejecuta la bateria dorada (golden_dataset.js) contra consultarJarvis con un
 * LLM guionizado y ejecutores simulados. Mide:
 *   1. Precision de enrutado: se invocan las herramientas esperadas.
 *   2. Contencion conversacional: la charla no invoca herramientas.
 *   3. Uso del clasificador de respaldo solo cuando toca.
 *   4. Seguridad de la orquestacion: reintentos idempotentes vs. acciones
 *      con efectos, limite de rondas y continuacion de respuestas truncadas.
 *
 * Estos resultados son deterministicos (guion fijo): demuestran el
 * comportamiento del orquestador, NO la calidad del modelo real ni la
 * entrega real por WhatsApp.
 *
 * Strict Policy: Zero Emojis.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { consultarJarvis } from '../../src/core/jarvisAgent.js';
import { herramientasJarvis } from '../../src/core/tools.js';
import { casosDorados } from './golden_dataset.js';

const MARCA_CLASIFICADOR = 'Clasifica la intencion principal';

function construirLlmGuionizado(caso, observaciones) {
  let indicePaso = 0;

  return async ({ messages, tools }) => {
    const ultimo = messages[messages.length - 1];
    const esLlamadaClasificador = messages.some(
      (m) => m.role === 'system' && typeof m.content === 'string' && m.content.startsWith(MARCA_CLASIFICADOR)
    );

    // Registrar mensajes tool visibles para el modelo
    for (const m of messages) {
      if (m.role === 'tool' && !observaciones.mensajesTool.includes(m.content)) {
        observaciones.mensajesTool.push(m.content);
      }
    }

    if (esLlamadaClasificador) {
      observaciones.llamadasClasificador += 1;
      let paso = caso.pasos[indicePaso];
      while (paso && !('clasifica' in paso) && indicePaso < caso.pasos.length) {
        indicePaso += 1;
        paso = caso.pasos[indicePaso];
      }
      if (paso && 'clasifica' in paso) {
        indicePaso += 1;
        if (paso.clasifica === 'ERROR') throw new Error('fallo simulado del clasificador');
        return { message: { role: 'assistant', content: JSON.stringify(paso.clasifica) } };
      }
      return { message: { role: 'assistant', content: 'no json' } };
    }

    // Registrar las herramientas ofrecidas en la llamada principal
    observaciones.herramientasOfrecidas.push(Array.isArray(tools) ? tools.length : 0);
    if (Array.isArray(messages)) {
      const sistema = messages.find((m) => m.role === 'system');
      if (sistema && sistema.content.includes('DIRECTIVA DE DESAMBIGUACION')) {
        observaciones.directivaVista = true;
      }
      if (observaciones.historialEsperado) {
        const presente = observaciones.historialEsperado.every((h) =>
          messages.some((m) => m.role === h.role && m.content === h.content)
        );
        if (presente) observaciones.historialVisto = true;
      }
    }

    observaciones.llamadasLlm += 1;

    // Saltar pasos de clasificacion no consumidos
    let paso = caso.pasos[indicePaso];
    while (paso && 'clasifica' in paso) {
      indicePaso += 1;
      paso = caso.pasos[indicePaso];
    }

    if (!paso) {
      return { message: { role: 'assistant', content: 'Fin del guion.' } };
    }

    if (paso.repite) {
      // No consume el paso: fuerza rondas infinitas para probar el tope
      return {
        message: {
          role: 'assistant',
          content: '',
          tool_calls: [{ id: `rep-${observaciones.llamadasLlm}`, type: 'function', function: { name: paso.llama, arguments: paso.args || {} } }]
        }
      };
    }

    indicePaso += 1;
    if (paso.llama) {
      return {
        message: {
          role: 'assistant',
          content: '',
          tool_calls: [{ id: `tc-${indicePaso}`, type: 'function', function: { name: paso.llama, arguments: paso.args || {} } }]
        }
      };
    }
    const respuesta = { message: { role: 'assistant', content: paso.texto } };
    if (paso.finish) respuesta.finishReason = paso.finish;
    return respuesta;
  };
}

async function ejecutarCaso(caso) {
  const observaciones = {
    invocadas: [],
    mensajesTool: [],
    herramientasOfrecidas: [],
    llamadasClasificador: 0,
    llamadasLlm: 0,
    directivaVista: false,
    historialEsperado: caso.historial || null,
    historialVisto: false
  };

  const reales = new Set(caso.usaEjecutorReal || []);
  const ejecutoresBase = new Proxy(caso.ejecutores || {}, {
    get(objetivo, prop) {
      if (reales.has(prop)) return undefined; // ejecutor real (p. ej. puerta de confirmacion)
      if (prop in objetivo) {
        return async (args) => {
          observaciones.invocadas.push(prop);
          return objetivo[prop](args);
        };
      }
      return async () => {
        observaciones.invocadas.push(prop);
        return `OK ${String(prop)}`;
      };
    }
  });

  const repeticiones = caso.repeticiones || 1;
  let respuesta = '';
  for (let i = 0; i < repeticiones; i++) {
    respuesta = await consultarJarvis(caso.entrada, caso.historial || [], {
      chatId: caso.chatId || 'chat-dorado@test',
      chatCompletion: construirLlmGuionizado(caso, observaciones),
      ejecutores: ejecutoresBase
    });
  }
  return { respuesta, obs: observaciones };
}

let metricas = { total: 0, enrutadoOk: 0, contencionOk: 0, clasificadorOk: 0 };

for (const caso of casosDorados) {
  test(`[Dorado] ${caso.id}`, async () => {
    metricas.total += 1;
    const { respuesta, obs } = await ejecutarCaso(caso);
    const esperado = caso.esperado;

    if (esperado.invoca) {
      for (const herramienta of esperado.invoca) {
        assert.ok(
          obs.invocadas.includes(herramienta),
          `${caso.id}: se esperaba invocar ${herramienta}; invocadas: ${obs.invocadas.join(', ') || 'ninguna'}`
        );
      }
      metricas.enrutadoOk += 1;
    }

    if (esperado.invocaVeces) {
      for (const [herramienta, veces] of Object.entries(esperado.invocaVeces)) {
        const reales = obs.invocadas.filter((h) => h === herramienta).length;
        assert.equal(reales, veces, `${caso.id}: ${herramienta} debia ejecutarse ${veces} vez/veces, se ejecuto ${reales}`);
      }
    }

    if (esperado.sinHerramientas) {
      assert.deepEqual(
        obs.invocadas,
        [],
        `${caso.id}: no debia invocar herramientas; invoco: ${obs.invocadas.join(', ')}`
      );
      metricas.contencionOk += 1;
    }

    if (esperado.clasificador === true) {
      assert.ok(obs.llamadasClasificador >= 1, `${caso.id}: debia consultar el clasificador de respaldo`);
      metricas.clasificadorOk += 1;
    }
    if (esperado.clasificador === false) {
      assert.equal(obs.llamadasClasificador, 0, `${caso.id}: no debia necesitar el clasificador de respaldo`);
    }
    if (esperado.llamadasClasificadorTotal) {
      assert.equal(
        obs.llamadasClasificador,
        esperado.llamadasClasificadorTotal,
        `${caso.id}: la cache del clasificador debia limitar las llamadas a ${esperado.llamadasClasificadorTotal}`
      );
    }

    if (esperado.directivaDesambiguacion) {
      assert.ok(obs.directivaVista, `${caso.id}: debia inyectarse la directiva de desambiguacion`);
    }
    if (esperado.ofrecidasCero) {
      const ofrecidasPrincipal = obs.herramientasOfrecidas[0];
      assert.equal(
        ofrecidasPrincipal,
        0,
        `${caso.id}: con clasificador caido no deben ofrecerse herramientas (politica de confianza baja); ofrecidas: ${ofrecidasPrincipal}`
      );
    }
    if (esperado.llamadasLlmTotal) {
      assert.equal(obs.llamadasLlm, esperado.llamadasLlmTotal, `${caso.id}: numero de llamadas LLM`);
    }
    if (esperado.mensajeToolContiene) {
      const conjunto = obs.mensajesTool.join('\n---\n');
      for (const fragmento of esperado.mensajeToolContiene) {
        assert.ok(conjunto.includes(fragmento), `${caso.id}: mensaje tool debia contener "${fragmento}"`);
      }
    }
    if (esperado.mensajeToolNoContiene) {
      const conjunto = obs.mensajesTool.join('\n---\n');
      for (const fragmento of esperado.mensajeToolNoContiene) {
        assert.ok(!conjunto.includes(fragmento), `${caso.id}: mensaje tool NO debia contener "${fragmento}"`);
      }
    }
    if (esperado.textoContiene) {
      for (const fragmento of esperado.textoContiene) {
        assert.ok(respuesta.includes(fragmento), `${caso.id}: respuesta debia contener "${fragmento}"; respuesta: "${respuesta}"`);
      }
    }
    if (esperado.responde) {
      assert.ok(
        typeof respuesta === 'string' && respuesta.trim().length > 0,
        `${caso.id}: debia producirse una respuesta honesta (no silencio); respuesta: "${respuesta}"`
      );
    }
    if (esperado.historialInyectado) {
      assert.ok(obs.historialVisto, `${caso.id}: el historial previo debia llegar al modelo`);
    }
  });
}

test('[Dorado] Resumen de metricas de la bateria', () => {
  const conInvocacion = casosDorados.filter((c) => c.esperado.invoca).length;
  const conversacionales = casosDorados.filter((c) => c.esperado.sinHerramientas).length;
  const conClasificador = casosDorados.filter((c) => c.esperado.clasificador === true).length;

  console.log('\n===== BATERIA DORADA - METRICAS =====');
  console.log(`Casos totales: ${metricas.total}`);
  console.log(`Precision de enrutado: ${metricas.enrutadoOk}/${conInvocacion}`);
  console.log(`Contencion conversacional: ${metricas.contencionOk}/${conversacionales}`);
  console.log(`Respaldo por modelo correcto: ${metricas.clasificadorOk}/${conClasificador}`);
  console.log('Nota: metricas deterministicas sobre LLM guionizado; no miden calidad del modelo real.');
  console.log('=====================================\n');

  assert.equal(metricas.enrutadoOk, conInvocacion, 'precision de enrutado por debajo del 100%');
  assert.equal(metricas.contencionOk, conversacionales, 'contencion conversacional por debajo del 100%');
});
