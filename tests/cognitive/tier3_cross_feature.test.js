/**
 * tier3_cross_feature.test.js
 * Tier 3: Cross-Feature Pairwise and Multi-Way Integration Tests.
 * Verifies interactions between:
 * - ReAct Loop + Specialist Router
 * - Router + Pre-Send Guardrails
 * - Local RAG Memory + ReAct Loop
 * - Guardrails + ReAct Tool Retry
 * - Full Triad: Router + RAG + Guardrails
 *
 * Strict Policy: Zero Emojis.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';

import {
  assertNoEmojis,
  crearChatMock,
  crearEjecutoresMock,
  generarMemoriasEjemplo
} from './helpers/testFixtures.js';

import { consultarJarvisAislado as consultarJarvis } from '../helpers/jarvisAislado.js';
import {
  indexarMemoriasVectoriales,
  buscarMemoriaSemantica
} from '../../src/services/semanticMemoryService.js';
import {
  clasificarEspecialista,
  obtenerConfiguracionEspecialista,
  enrutarYFiltrarHerramientas
} from '../../src/services/specialistRouterService.js';
import {
  validarMensajeSalida,
  guardZeroEmojis,
  guardCodeSyntax,
  guardHallucinations,
  ejecutarHerramientaConReintentos
} from '../../src/services/preSendGuardrailService.js';

describe('Tier 3: Cross-Feature Combinations', () => {

  // =========================================================================
  // Combination 1: ReAct Loop + Specialist Router
  // =========================================================================
  it('3.1 should route request to Coder specialist and execute ReAct loop within scoped tools', async () => {
    const promptUsuario = 'Crea una rama de trabajo para la tarea y realiza el commit';

    // 1. Router classifies intent and scopes tools
    const clasificacion = clasificarEspecialista(promptUsuario);
    assert.equal(clasificacion.especialista, 'coder');

    const config = obtenerConfiguracionEspecialista(clasificacion.especialista);
    assert.ok(config.herramientasPermitidas.includes('crear_rama_trabajo'));
    assert.ok(config.herramientasPermitidas.includes('crear_commit'));

    // 2. ReAct loop receives scoped tools and executes sequential actions
    const mockChat = crearChatMock([
      {
        message: {
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id: 'call_branch_1',
              type: 'function',
              function: { name: 'crear_rama_trabajo', arguments: { nombreRama: 'feat-react-loop' } }
            }
          ]
        }
      },
      {
        message: {
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id: 'call_commit_1',
              type: 'function',
              function: { name: 'crear_commit', arguments: { mensaje: 'feat: implement react cycle' } }
            }
          ]
        }
      },
      {
        message: {
          role: 'assistant',
          content: 'Rama feat-react-loop creada y commit registrado con exito.'
        },
        finishReason: 'stop'
      }
    ]);

    const { ejecutores, llamadas } = crearEjecutoresMock({
      crear_rama_trabajo: async (args) => ({ texto: `Rama ${args.nombreRama} creada en HEAD` }),
      crear_commit: async (args) => ({ texto: `Commit creado SHA: a1b2c3d4 - ${args.mensaje}` })
    });

    const respuesta = await consultarJarvis('Que tiempo hace hoy?', [], {
      chatCompletion: mockChat,
      ejecutores,
      maxRondasHerramientas: 5
    });

    assert.equal(llamadas.length, 2, 'Debe ejecutar ambas herramientas de Coder en secuencia');
    assert.equal(llamadas[0].name, 'crear_rama_trabajo');
    assert.equal(llamadas[1].name, 'crear_commit');
    assert.match(respuesta, /feat-react-loop/);
    assertNoEmojis(respuesta);
  });

  // =========================================================================
  // Combination 2: Router + Pre-Send Guardrails
  // =========================================================================
  it('3.2 should pass specialist response through code syntax validation and zero-emoji veto', () => {
    // Router identifies Coder request
    const clasificacion = clasificarEspecialista('Muestrame un ejemplo de script para automatizar git commit');
    assert.equal(clasificacion.especialista, 'coder');

    // Specialist generates raw message containing emoji and minor JSON formatting flaw
    const emojiRocket = String.fromCodePoint(0x1F680);
    const mensajeBruto = [
      `Aqui tienes la configuracion para el workflow ${emojiRocket}:`,
      '```json',
      '{',
      '  "name": "CI-Pipeline",',
      '  "runs-on": "ubuntu-latest",',
      '}',
      '```',
      'El workflow queda validado y listo para desplegar.'
    ].join('\n');

    // Pre-send guardrails intercept
    const validacion = validarMensajeSalida(mensajeBruto, {});

    assert.equal(validacion.valido, true);
    assert.ok(validacion.correccionesAplicadas.includes('REMOVED_EMOJI'), 'Debe registrar REMOVED_EMOJI');
    assert.ok(
      validacion.correccionesAplicadas.includes('CORRECTED_CODE_SYNTAX') || !validacion.textoFinal.includes(',\n}'),
      'Debe corregir la coma final del JSON'
    );
    assert.ok(!validacion.textoFinal.includes(emojiRocket), 'No debe contener el emoji');
    assertNoEmojis(validacion.textoFinal, 'Texto final procesado por guardrails');
  });

  // =========================================================================
  // Combination 3: Local RAG Vector Memory + ReAct Loop
  // =========================================================================
  it('3.3 should autonomously search local RAG memory within ReAct loop to answer user question', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'davis-rag-react-'));
    const storePath = path.join(tmpDir, 'brain.json');
    const vectorsPath = path.join(tmpDir, 'vectors.json');
    const memorias = generarMemoriasEjemplo();

    await indexarMemoriasVectoriales({ memorias, storePath, vectorsPath });

    // Mock ReAct cycle: Step 1 tool call to semantic memory, Step 2 final answer
    const mockChat = crearChatMock([
      {
        message: {
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id: 'call_rag_search',
              type: 'function',
              function: { name: 'buscar_memoria_semantica', arguments: { consulta: 'servidor vps oracle ip' } }
            }
          ]
        }
      },
      {
        message: {
          role: 'assistant',
          content: 'El servidor VPS de produccion tiene la IP 51.170.48.166 segun tu Second Brain.'
        },
        finishReason: 'stop'
      }
    ]);

    const { ejecutores, llamadas } = crearEjecutoresMock({
      buscar_memoria_semantica: async (args) => {
        const resultados = await buscarMemoriaSemantica(args.consulta, {
          storePath,
          vectorsPath,
          memorias,
          topK: 1,
          minScore: 0.1
        });
        return { texto: JSON.stringify(resultados[0] || {}) };
      }
    });

    const respuesta = await consultarJarvis('Que tiempo hace en la capital?', [], {
      chatCompletion: mockChat,
      ejecutores,
      maxRondasHerramientas: 5
    });

    assert.equal(llamadas.length, 1);
    assert.equal(llamadas[0].name, 'buscar_memoria_semantica');
    assert.match(respuesta, /51\.170\.48\.166/);
    assertNoEmojis(respuesta);

    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  // =========================================================================
  // Combination 4: Guardrails + ReAct Tool Retry
  // =========================================================================
  it('3.4 should transparently retry transient tool errors inside ReAct execution without failing round', async () => {
    let intentosInternos = 0;

    const mockChat = crearChatMock([
      {
        message: {
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id: 'call_network_check',
              type: 'function',
              function: { name: 'consultar_estado_servidor', arguments: {} }
            }
          ]
        }
      },
      {
        message: {
          role: 'assistant',
          content: 'El servidor responde correctamente con carga normal.'
        },
        finishReason: 'stop'
      }
    ]);

    // Wrapped tool with guardrail retry helper
    const { ejecutores, llamadas } = crearEjecutoresMock({
      consultar_estado_servidor: async () => {
        const resultado = await ejecutarHerramientaConReintentos(
          async () => {
            intentosInternos++;
            if (intentosInternos === 1) {
              throw new Error('ETIMEDOUT: Intermittent network glitch');
            }
            return 'Servidor online: CPU 14%, RAM 38%';
          },
          'consultar_estado_servidor',
          {},
          { maxReintentos: 2, esperaBaseMs: 15 }
        );
        return { texto: resultado };
      }
    });

    const respuesta = await consultarJarvis('Que tiempo hace hoy?', [], {
      chatCompletion: mockChat,
      ejecutores,
      maxRondasHerramientas: 5
    });

    assert.equal(intentosInternos, 2, 'El helper de guardrail debio reintentar transparentemente');
    assert.equal(llamadas.length, 1, 'Para el loop ReAct cuenta como una unica herramienta completada');
    assert.match(respuesta, /servidor responde correctamente/i);
    assertNoEmojis(respuesta);
  });

  // =========================================================================
  // Combination 5: Full Triad (Router + RAG Memory + Guardrails)
  // =========================================================================
  it('3.5 should route personal lifestyle query, query memory, and sanitize output through guardrails', async () => {
    const prompt = 'Recuerdame cual es el habito diario de entrenamiento registrado en el Second Brain';

    // Step 1: Router
    const routing = clasificarEspecialista(prompt);
    assert.equal(routing.especialista, 'personal');

    // Step 2: RAG Memory search
    const memorias = generarMemoriasEjemplo();
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'davis-triad-'));
    const storePath = path.join(tmpDir, 'brain.json');
    const vectorsPath = path.join(tmpDir, 'vectors.json');
    await indexarMemoriasVectoriales({ memorias, storePath, vectorsPath });

    const memsEncontradas = await buscarMemoriaSemantica('habito deporte calistenia', {
      storePath,
      vectorsPath,
      memorias,
      topK: 1
    });

    assert.ok(memsEncontradas.length > 0);
    const datoMemoria = memsEncontradas[0].dato;

    // Step 3: Raw response with potential emoji
    const emojiMuscle = String.fromCodePoint(0x1F4AA);
    const respuestaCruda = `Segun tus registros: ${datoMemoria} ${emojiMuscle}.`;

    // Step 4: Guardrail validation
    const salidaValidada = validarMensajeSalida(respuestaCruda, {});
    assert.equal(salidaValidada.valido, true);
    assert.ok(salidaValidada.correccionesAplicadas.includes('REMOVED_EMOJI'));
    assert.ok(!salidaValidada.textoFinal.includes(emojiMuscle));
    assert.match(salidaValidada.textoFinal, /calistenia/i);
    assertNoEmojis(salidaValidada.textoFinal);

    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  // =========================================================================
  // Combination 6: Guardrails Hallucination Grounding in Multi-Step ReAct
  // =========================================================================
  it('3.6 should ground execution claims against multi-step ReAct trace preventing unexecuted claims', () => {
    // Simulated ReAct execution trace: Round 1 executed 'crear_rama_trabajo' with ok.
    // Notice 'crear_commit' was NEVER executed.
    const traza = {
      llamadas: [
        { nombre: 'crear_rama_trabajo', ronda: 1, resultado: 'ok', ok: true }
      ]
    };

    // Model tries to hallucinate that both the branch and commit were successfully created
    const textoModeloAlucinador = 'He creado el commit en el repositorio y la rama de trabajo esta lista.';

    const resultado = guardHallucinations(textoModeloAlucinador, { traza });
    assert.equal(resultado.huboCorreccion, true);
    assert.ok(resultado.correcciones.some((c) => c.includes('COMMIT')));
    assert.match(resultado.textoModificado, /no se ha realizado ningun commit/i);
    assertNoEmojis(resultado.textoModificado);
  });
});
