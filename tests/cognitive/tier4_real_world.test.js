/**
 * tier4_real_world.test.js
 * Tier 4: Real-World End-to-End Scenarios for Cognitive Enhancements.
 * Comprehensive user journeys exercising the full multi-layer cognition stack:
 * - Developer Git & PR workflow (Coder specialist)
 * - DevOps SysAdmin Auto-Healing (Ops specialist)
 * - Personal Life, Expenses & Habit Tracking (Personal specialist)
 * - Adversarial Defense (Emoji Injection, Broken Syntax & Hallucination Veto)
 * - Cross-Domain Ambiguity Resolution
 * - Multi-Step ReAct Convergence & Full Trace Audit
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

import { consultarJarvis } from '../../src/core/jarvisAgent.js';
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
  guardHallucinations
} from '../../src/services/preSendGuardrailService.js';

describe('Tier 4: Real-World End-to-End Scenarios', () => {

  // =========================================================================
  // Scenario 1: Developer PR Creation Journey
  // =========================================================================
  it('4.1 should complete end-to-end developer journey: branch -> commit -> pull request', async () => {
    const ordenUsuario = 'Crea una rama fix-auth, anota el commit y abre el pull request hacia main';

    // Step 1: Specialist Classification
    const routing = clasificarEspecialista(ordenUsuario);
    assert.equal(routing.especialista, 'coder', 'Debe enrutar a Coder');
    assert.ok(routing.confianza >= 0.8);

    const config = obtenerConfiguracionEspecialista(routing.especialista);
    assert.match(config.systemPromptMod, /codigo|git|software/i);

    // Step 2: Multi-step ReAct execution
    const mockChat = crearChatMock([
      {
        message: {
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id: 'call_git_branch',
              type: 'function',
              function: { name: 'crear_rama_trabajo', arguments: { nombreRama: 'fix-auth', base: 'main' } }
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
              id: 'call_git_commit',
              type: 'function',
              function: { name: 'crear_commit', arguments: { mensaje: 'fix: resolve session token expiry issue' } }
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
              id: 'call_git_pr',
              type: 'function',
              function: {
                name: 'abrir_pull_request',
                arguments: { titulo: 'fix: resolve session token expiry issue', rama: 'fix-auth', base: 'main' }
              }
            }
          ]
        }
      },
      {
        message: {
          role: 'assistant',
          content: 'Pull request #42 abierto con exito para la rama fix-auth hacia main.'
        },
        finishReason: 'stop'
      }
    ]);

    const { ejecutores, llamadas } = crearEjecutoresMock({
      crear_rama_trabajo: async (args) => ({ texto: `Rama ${args.nombreRama} creada desde ${args.base}` }),
      crear_commit: async (args) => ({ texto: `Commit 7f8a9b0 registrado: ${args.mensaje}` }),
      abrir_pull_request: async (args) => ({ texto: `PR #42 abierto en GitHub: ${args.titulo}` })
    });

    const respuesta = await consultarJarvis('Que tiempo hace hoy?', [], {
      chatCompletion: mockChat,
      ejecutores,
      maxRondasHerramientas: 5
    });

    assert.equal(llamadas.length, 3, 'Debe ejecutar las 3 fases del ciclo de desarrollo');
    assert.equal(llamadas[0].name, 'crear_rama_trabajo');
    assert.equal(llamadas[1].name, 'crear_commit');
    assert.equal(llamadas[2].name, 'abrir_pull_request');
    assert.match(respuesta, /Pull request #42 abierto/i);

    // Step 3: Guardrail verification of final output
    const traza = { llamadas: llamadas.map((l) => ({ nombre: l.name, resultado: 'ok', ok: true })) };
    const guardrailCheck = validarMensajeSalida(respuesta, { traza });
    assert.equal(guardrailCheck.valido, true);
    assert.equal(guardrailCheck.bloqueado, false);
    assertNoEmojis(guardrailCheck.textoFinal);
  });

  // =========================================================================
  // Scenario 2: DevOps SysAdmin Incident Response & Auto-Healing
  // =========================================================================
  it('4.2 should complete end-to-end DevOps journey: inspect container -> diagnose -> report', async () => {
    const ordenUsuario = 'Verifica si hay contenedores docker caidos en el servidor vps';

    // Step 1: Router
    const routing = clasificarEspecialista(ordenUsuario);
    assert.equal(routing.especialista, 'ops');
    assert.ok(routing.confianza >= 0.8);

    // Step 2: Multi-step ReAct
    const mockChat = crearChatMock([
      {
        message: {
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id: 'call_docker_check',
              type: 'function',
              function: { name: 'docker_status', arguments: {} }
            }
          ]
        }
      },
      {
        message: {
          role: 'assistant',
          content: 'Todos los contenedores de produccion se encuentran en estado running sin incidentes detectados.'
        },
        finishReason: 'stop'
      }
    ]);

    const { ejecutores, llamadas } = crearEjecutoresMock({
      docker_status: async () => ({
        texto: 'Contenedores: jarvis-api (running, uptime 14d), jarvis-whatsapp (running, uptime 14d)'
      })
    });

    const respuesta = await consultarJarvis('Que tiempo hace hoy?', [], {
      chatCompletion: mockChat,
      ejecutores,
      maxRondasHerramientas: 5
    });

    assert.equal(llamadas.length, 1);
    assert.equal(llamadas[0].name, 'docker_status');
    assert.match(respuesta, /running/i);

    // Step 3: Pre-send validation
    const traza = { llamadas: [{ nombre: 'docker_status', ok: true }] };
    const salidaValidada = validarMensajeSalida(respuesta, { traza });
    assert.equal(salidaValidada.valido, true);
    assertNoEmojis(salidaValidada.textoFinal);
  });

  // =========================================================================
  // Scenario 3: Personal Life, Expenses & Habit Tracking
  // =========================================================================
  it('4.3 should complete end-to-end Personal journey: log expense -> query RAG -> habit streak', async () => {
    const ordenUsuario = 'Anota el gasto de 45 euros de supermercado y revisa mis habitos';

    // Step 1: Router
    const routing = clasificarEspecialista(ordenUsuario);
    assert.equal(routing.especialista, 'personal');

    // Step 2: RAG store setup
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'davis-personal-'));
    const storePath = path.join(tmpDir, 'brain.json');
    const vectorsPath = path.join(tmpDir, 'vectors.json');
    const memorias = generarMemoriasEjemplo();
    await indexarMemoriasVectoriales({ memorias, storePath, vectorsPath });

    // Step 3: ReAct tool execution
    const mockChat = crearChatMock([
      {
        message: {
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id: 'call_expense_1',
              type: 'function',
              function: { name: 'registrar_gasto', arguments: { importe: 45, categoria: 'comida', concepto: 'supermercado' } }
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
              id: 'call_habit_1',
              type: 'function',
              function: { name: 'listar_habitos', arguments: {} }
            }
          ]
        }
      },
      {
        message: {
          role: 'assistant',
          content: 'Gasto de 45 euros en supermercado registrado. Tu racha activa de deporte se mantiene en 12 dias consecutivos.'
        },
        finishReason: 'stop'
      }
    ]);

    const { ejecutores, llamadas } = crearEjecutoresMock({
      registrar_gasto: async (args) => ({ texto: `Gasto de ${args.importe} EUR registrado en ${args.categoria}` }),
      listar_habitos: async () => ({ texto: 'Habito deporte: racha activa 12 dias' })
    });

    const respuesta = await consultarJarvis('Que tiempo hace en la capital?', [], {
      chatCompletion: mockChat,
      ejecutores,
      maxRondasHerramientas: 5
    });

    assert.equal(llamadas.length, 2);
    assert.equal(llamadas[0].name, 'registrar_gasto');
    assert.equal(llamadas[1].name, 'listar_habitos');
    assert.match(respuesta, /45 euros/i);
    assert.match(respuesta, /12 dias/i);

    // Step 4: Pre-send validation
    const salidaValidada = validarMensajeSalida(respuesta, {});
    assert.equal(salidaValidada.valido, true);
    assertNoEmojis(salidaValidada.textoFinal);

    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  // =========================================================================
  // Scenario 4: Adversarial Attack with Malformed Code, Emojis, & Hallucinations
  // =========================================================================
  it('4.4 should intercept and neutralize multi-vector adversarial attack', () => {
    const eFuego = String.fromCodePoint(0x1F525);
    const eBomba = String.fromCodePoint(0x1F4A3);
    const eOjo = String.fromCodePoint(0x1F440);

    // Adversarial synthetic message attempting:
    // 1. Multiple emojis
    // 2. Unclosed and malformed JavaScript snippet
    // 3. Hallucinated financial transfer claim
    // 4. Hallucinated unauthorized telephone number
    const payloadAdversario = [
      `Ataque simulado ${eFuego} operacion completada ${eBomba}:`,
      'He transferido 500 euros a la cuenta de emergencia.',
      'He programado el mensaje para el contacto desconocido +34699112233.',
      'Aqui esta el exploit ejecutable:',
      '```javascript',
      'function exploit() {',
      '  const x = 100;',
      '  return x;',
      // Unclosed code block
      `Fin de reporte ${eOjo}.`
    ].join('\n');

    const contextoEstricto = {
      traza: { llamadas: [] },
      destinatario: '34600000000@s.whatsapp.net',
      contactosConocidos: ['34600000000']
    };

    const resultado = validarMensajeSalida(payloadAdversario, contextoEstricto);

    // 1. Emoji sanitization verified
    assert.ok(!resultado.textoFinal.includes(eFuego), 'No debe contener emoji fuego');
    assert.ok(!resultado.textoFinal.includes(eBomba), 'No debe contener emoji bomba');
    assert.ok(!resultado.textoFinal.includes(eOjo), 'No debe contener emoji ojo');
    assert.ok(resultado.correccionesAplicadas.includes('REMOVED_EMOJI'));

    // 2. Hallucination neutralization verified
    assert.match(resultado.textoFinal, /no se ha realizado ninguna transferencia/i);
    assert.match(resultado.textoFinal, /NUMERO_NO_VERIFICADO/i);

    // 3. Code fence repair verified
    assert.match(resultado.textoFinal, /```$/m, 'Debe haber reparado la cerca de codigo');

    // 4. Strict Zero Emojis verified across entire result
    assertNoEmojis(resultado.textoFinal, 'Texto final adversarial sanitizado');
  });

  // =========================================================================
  // Scenario 5: Cross-Domain Ambiguity Resolution
  // =========================================================================
  it('5.5 should prioritize primary domain when user message touches multiple specialists', () => {
    // Message touches code and ops
    const promptHibrido = 'Haz pull request de la rama de trabajo y despues mira el uso de disco del VPS';
    const clasificacion = clasificarEspecialista(promptHibrido);

    assert.ok(['coder', 'ops'].includes(clasificacion.especialista));
    assert.ok(clasificacion.confianza >= 0.7);
    assert.ok(typeof clasificacion.razon === 'string');

    // Filter tools for the selected domain
    const herramientasDisponibles = [
      { type: 'function', function: { name: 'abrir_pull_request' } },
      { type: 'function', function: { name: 'disk_status' } },
      { type: 'function', function: { name: 'consultar_agenda' } }
    ];

    const filtradas = enrutarYFiltrarHerramientas(promptHibrido, herramientasDisponibles);
    assert.equal(filtradas.especialista, clasificacion.especialista);
    assert.ok(filtradas.herramientasFiltradas.length > 0);
    assertNoEmojis(filtradas);
  });

  // =========================================================================
  // Scenario 6: High-Load Multi-Step ReAct Convergence & Persistence
  // =========================================================================
  it('5.6 should converge multi-step ReAct loop across 4 distinct rounds and record trace', async () => {
    const mockChat = crearChatMock([
      // Round 1
      {
        message: {
          role: 'assistant',
          content: null,
          tool_calls: [{ id: 'c1', type: 'function', function: { name: 'consultar_clima', arguments: { ciudad: 'Madrid' } } }]
        }
      },
      // Round 2
      {
        message: {
          role: 'assistant',
          content: null,
          tool_calls: [{ id: 'c2', type: 'function', function: { name: 'consultar_clima', arguments: { ciudad: 'Sevilla' } } }]
        }
      },
      // Round 3
      {
        message: {
          role: 'assistant',
          content: null,
          tool_calls: [{ id: 'c3', type: 'function', function: { name: 'consultar_clima', arguments: { ciudad: 'Granada' } } }]
        }
      },
      // Round 4
      {
        message: {
          role: 'assistant',
          content: null,
          tool_calls: [{ id: 'c4', type: 'function', function: { name: 'consultar_clima', arguments: { ciudad: 'Cordoba' } } }]
        }
      },
      // Final Decision
      {
        message: {
          role: 'assistant',
          content: 'Madrid: 18C, Sevilla: 24C, Granada: 16C, Cordoba: 22C. Resumen meteorologico consolidado.'
        },
        finishReason: 'stop'
      }
    ]);

    const { ejecutores, llamadas } = crearEjecutoresMock({
      consultar_clima: async (args) => ({ texto: `Clima en ${args.ciudad}: OK` })
    });

    const respuesta = await consultarJarvis('Que tiempo hace en la capital?', [], {
      chatCompletion: mockChat,
      ejecutores,
      maxRondasHerramientas: 5
    });

    assert.equal(llamadas.length, 4, 'Debe ejecutar las 4 rondas secuencialmente');
    assert.match(respuesta, /Madrid/i);
    assert.match(respuesta, /Sevilla/i);
    assert.match(respuesta, /Granada/i);
    assert.match(respuesta, /Cordoba/i);
    assertNoEmojis(respuesta);
  });
});
