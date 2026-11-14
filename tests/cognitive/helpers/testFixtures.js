/**
 * testFixtures.js
 * Shared test fixtures, mock factories, and validation helpers for the Cognitive Enhancements test suite.
 *
 * Strict Zero Emojis Policy enforced.
 */
import assert from 'node:assert/strict';
import { EMOJI_REGEX } from '../../harness/validators.js';

/**
 * Validates that any string, object, or array contains zero emojis.
 *
 * @param {*} target
 * @param {string} [contextMessage]
 */
export function assertNoEmojis(target, contextMessage = 'Target contains emoji violations') {
  if (typeof target === 'string') {
    const match = target.match(EMOJI_REGEX);
    assert.equal(
      match,
      null,
      `${contextMessage}: found emoji "${match?.[0]}" (code point: ${match?.[0]?.codePointAt(0)?.toString(16)})`
    );
    return;
  }

  if (Array.isArray(target)) {
    for (let i = 0; i < target.length; i++) {
      assertNoEmojis(target[i], `${contextMessage} at index [${i}]`);
    }
    return;
  }

  if (target && typeof target === 'object') {
    for (const [key, value] of Object.entries(target)) {
      assertNoEmojis(key, `${contextMessage} at key "${key}"`);
      assertNoEmojis(value, `${contextMessage} at value of "${key}"`);
    }
  }
}

/**
 * Creates a sequential mock chat completion function.
 *
 * @param {Array<object>} script - Array of response objects to return on successive calls.
 * @returns {Function} chatCompletion mock
 */
export function crearChatMock(script = []) {
  let callIndex = 0;
  const history = [];

  const chatFn = async (payload) => {
    history.push(payload);
    if (callIndex >= script.length) {
      // Default fallback when script exhausted
      return {
        message: {
          role: 'assistant',
          content: 'Peticion procesada correctamente sin mas acciones necesarias.'
        },
        finishReason: 'stop'
      };
    }
    const current = script[callIndex];
    callIndex++;

    if (current instanceof Error) {
      throw current;
    }

    if (typeof current === 'function') {
      return current(payload, callIndex - 1);
    }

    return current;
  };

  chatFn.getCallCount = () => callIndex;
  chatFn.getHistory = () => history;
  chatFn.reset = () => {
    callIndex = 0;
    history.length = 0;
  };

  return chatFn;
}

/**
 * Generates sample Second Brain memory records for RAG and semantic testing.
 *
 * @returns {Array<object>}
 */
export function generarMemoriasEjemplo() {
  return [
    {
      id: 'mem_vps_root_001',
      sujeto: 'Acceso Servidor VPS Oracle',
      dato: 'El servidor de produccion se encuentra en la IP 198.51.100.1 accesible mediante usuario ubuntu',
      categoria: 'ops',
      tags: ['vps', 'oracle', 'servidor', 'ssh', 'produccion'],
      fechaRegistro: '2026-11-01T10:00:00.000Z'
    },
    {
      id: 'mem_docker_deploy_002',
      sujeto: 'Despliegue Contenedores Docker',
      dato: 'Los servicios corren en contenedores con reinicio automatico mediante docker compose up -d',
      categoria: 'ops',
      tags: ['docker', 'deploy', 'compose', 'contenedores', 'auto-healing'],
      fechaRegistro: '2026-11-02T11:00:00.000Z'
    },
    {
      id: 'mem_git_workflow_003',
      sujeto: 'Flujo de Ramas Git y Pull Requests',
      dato: 'Para cada tarea se crea una rama de trabajo, se realiza commit firmado y se abre pull request en GitHub',
      categoria: 'coder',
      tags: ['git', 'github', 'ramas', 'commits', 'pull_request'],
      fechaRegistro: '2026-11-03T12:00:00.000Z'
    },
    {
      id: 'mem_calendario_marta_004',
      sujeto: 'Cumpleanos y Contacto de Marta',
      dato: 'Marta celebra su cumpleanos el 14 de marzo y prefiere libros de ciencia ficcion',
      categoria: 'personal',
      tags: ['contacto', 'cumpleanos', 'marta', 'regalos', 'agenda'],
      fechaRegistro: '2026-11-04T13:00:00.000Z'
    },
    {
      id: 'mem_habito_deporte_005',
      sujeto: 'Habito de Entrenamiento Diario',
      dato: 'David entrena calistenia 45 minutos al dia y registra rachas semanales en habits.json',
      categoria: 'personal',
      tags: ['habito', 'deporte', 'entrenamiento', 'racha', 'salud'],
      fechaRegistro: '2026-11-05T14:00:00.000Z'
    }
  ];
}

/**
 * Creates sample tool executor map with call tracking.
 *
 * @param {Record<string, Function>} [overrides]
 * @returns {{ ejecutores: Record<string, Function>, llamadas: Array<object> }}
 */
export function crearEjecutoresMock(overrides = {}) {
  const llamadas = [];

  const defaultHandler = (name) => async (args) => {
    llamadas.push({ name, args, timestamp: Date.now() });
    return {
      texto: `Ejecucion simulada de ${name} completada con exito.`
    };
  };

  const ejecutores = new Proxy(overrides, {
    get(target, prop) {
      if (typeof prop === 'string' && prop in target) {
        return async (...args) => {
          llamadas.push({ name: prop, args: args[0], timestamp: Date.now() });
          return target[prop](...args);
        };
      }
      if (typeof prop === 'string') {
        return defaultHandler(prop);
      }
      return Reflect.get(target, prop);
    }
  });

  return { ejecutores, llamadas };
}

/**
 * Dynamically loads semanticMemoryService.
 *
 * @returns {Promise<object>}
 */
export async function loadSemanticMemoryService() {
  try {
    return await import('../../../src/services/semanticMemoryService.js');
  } catch (err1) {
    try {
      return await import('../../../../semanticMemoryService.js');
    } catch {
      throw new Error(`semanticMemoryService not found: ${err1.message}`);
    }
  }
}

/**
 * Dynamically loads specialistRouterService.
 *
 * @returns {Promise<object>}
 */
export async function loadSpecialistRouterService() {
  try {
    return await import('../../../src/services/specialistRouterService.js');
  } catch (err) {
    throw new Error(`specialistRouterService not found: ${err.message}`);
  }
}

/**
 * Dynamically loads preSendGuardrailService.
 *
 * @returns {Promise<object>}
 */
export async function loadPreSendGuardrailService() {
  try {
    return await import('../../../src/services/preSendGuardrailService.js');
  } catch (err) {
    throw new Error(`preSendGuardrailService not found: ${err.message}`);
  }
}

/**
 * Dynamically loads jarvisAgent core.
 *
 * @returns {Promise<object>}
 */
export async function loadJarvisAgent() {
  try {
    return await import('../../../src/core/jarvisAgent.js');
  } catch (err) {
    throw new Error(`jarvisAgent not found: ${err.message}`);
  }
}


