/**
 * tier2_boundary_corner.test.js
 * Tier 2: Boundary, Edge and Corner Cases for Advanced Cognition.
 * Tests extreme inputs, 0-norms, fallbacks, malformed code, and limit enforcement.
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
  crearEjecutoresMock
} from './helpers/testFixtures.js';

import { consultarJarvisAislado as consultarJarvis } from '../helpers/jarvisAislado.js';
import {
  computeCosineSimilarity,
  tokenizarTexto,
  normalizarTexto,
  buildTfIdfIndex,
  buscarMemoriaSemantica,
  cargarIndiceVectorial
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
  ejecutarHerramientaConReintentos,
  esHerramientaIdempotente
} from '../../src/services/preSendGuardrailService.js';

describe('Tier 2: Boundary & Corner Cases', () => {

  // =========================================================================
  // R1 Boundaries
  // =========================================================================
  describe('R1: ReAct Loop Boundaries', () => {

    it('2.1.1 should stop at exactly 5 rounds when tool requests continue indefinitely', async () => {
      let turns = 0;
      const infiniteToolMock = async () => {
        turns++;
        return {
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: `call_${turns}`,
                type: 'function',
                function: { name: 'consultar_clima', arguments: { ciudad: 'Valencia' } }
              }
            ]
          }
        };
      };

      const { ejecutores, llamadas } = crearEjecutoresMock({
        consultar_clima: async () => ({ texto: 'Valencia: 22C' })
      });

      const respuesta = await consultarJarvis('Que tiempo hace en Valencia?', [], {
        chatCompletion: infiniteToolMock,
        ejecutores,
        maxRondasHerramientas: 5
      });

      assert.equal(llamadas.length, 5, 'Debe detenerse exactamente en 5 rondas');
      assert.ok(typeof respuesta === 'string');
      assert.ok(respuesta.length > 0, 'No debe entregar silencio');
      assertNoEmojis(respuesta);
    });

    it('2.1.2 should stop immediately when maxRondasHerramientas is set to 0', async () => {
      const mockChat = crearChatMock([
        {
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: 'call_zero',
                type: 'function',
                function: { name: 'consultar_clima', arguments: { ciudad: 'Sevilla' } }
              }
            ]
          }
        },
        {
          message: {
            role: 'assistant',
            content: 'Sevilla sin herramientas.'
          },
          finishReason: 'stop'
        }
      ]);

      const { ejecutores, llamadas } = crearEjecutoresMock({
        consultar_clima: async () => ({ texto: 'Sevilla: 30C' })
      });

      const respuesta = await consultarJarvis('Que tiempo hace en Sevilla?', [], {
        chatCompletion: mockChat,
        ejecutores,
        maxRondasHerramientas: 0
      });

      assert.equal(llamadas.length, 0, 'Con maxRondas = 0 no debe ejecutar ninguna herramienta');
      assert.ok(typeof respuesta === 'string');
      assertNoEmojis(respuesta);
    });

    it('2.1.3 should handle empty or whitespace-only user prompt without crashing', async () => {
      const mockChat = crearChatMock([
        {
          message: {
            role: 'assistant',
            content: 'No he recibido ninguna instruccion concreta, senor.'
          },
          finishReason: 'stop'
        }
      ]);

      const { ejecutores, llamadas } = crearEjecutoresMock();

      const respuesta = await consultarJarvis('   ', [], {
        chatCompletion: mockChat,
        ejecutores,
        maxRondasHerramientas: 5
      });

      assert.equal(llamadas.length, 0);
      assert.ok(typeof respuesta === 'string');
      assertNoEmojis(respuesta);
    });

    it('2.1.4 should handle unknown/unregistered tool calls gracefully via error description', async () => {
      const mockChat = crearChatMock([
        {
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: 'call_fantasma',
                type: 'function',
                function: { name: 'herramienta_inexistente_xyz', arguments: { foo: 'bar' } }
              }
            ]
          }
        },
        {
          message: {
            role: 'assistant',
            content: 'La herramienta solicitada no se encuentra disponible en mi catalogo actual.'
          },
          finishReason: 'stop'
        }
      ]);

      // Tool executor map without herramienta_inexistente_xyz
      const { ejecutores } = crearEjecutoresMock({
        herramienta_inexistente_xyz: async () => {
          throw new Error('Herramienta no registrada en el catalogo');
        }
      });

      const respuesta = await consultarJarvis('Que tiempo hace hoy?', [], {
        chatCompletion: mockChat,
        ejecutores,
        maxRondasHerramientas: 5
      });

      assert.ok(typeof respuesta === 'string');
      assertNoEmojis(respuesta);
    });

    it('2.1.5 should prevent repeat execution of non-idempotent actions with identical arguments', async () => {
      let invocacionesReales = 0;
      const mockChat = crearChatMock([
        // Turn 1: call mutation
        {
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: 'call_escribe_1',
                type: 'function',
                function: { name: 'crear_recordatorio', arguments: { texto: 'Comprar pan', fecha: '2026-12-01' } }
              }
            ]
          }
        },
        // Turn 2: repeat same mutation with identical args
        {
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: 'call_escribe_2',
                type: 'function',
                function: { name: 'crear_recordatorio', arguments: { texto: 'Comprar pan', fecha: '2026-12-01' } }
              }
            ]
          }
        },
        // Turn 3: final answer
        {
          message: {
            role: 'assistant',
            content: 'Recordatorio programado sin duplicados.'
          },
          finishReason: 'stop'
        }
      ]);

      const { ejecutores } = crearEjecutoresMock({
        crear_recordatorio: async () => {
          invocacionesReales++;
          return { texto: 'Recordatorio creado ID 101' };
        }
      });

      const respuesta = await consultarJarvis('Recuerdame comprar pan manana', [], {
        chatCompletion: mockChat,
        ejecutores,
        maxRondasHerramientas: 5
      });

      assert.equal(invocacionesReales, 1, 'No debe duplicar la ejecucion de una mutacion identica');
      assertNoEmojis(respuesta);
    });

    it('2.1.6 should catch tool errors throwing non-Error primitives safely', async () => {
      const mockChat = crearChatMock([
        {
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: 'call_string_throw',
                type: 'function',
                function: { name: 'consultar_clima', arguments: { ciudad: 'Bilbao' } }
              }
            ]
          }
        },
        {
          message: {
            role: 'assistant',
            content: 'Se produjo una anomalia temporal al consultar el clima.'
          },
          finishReason: 'stop'
        }
      ]);

      const { ejecutores } = crearEjecutoresMock({
        consultar_clima: async () => {
          // Throw non-Error primitive
          throw 'Fallo no instanciado como objeto Error';
        }
      });

      const respuesta = await consultarJarvis('Que tiempo hace en Bilbao?', [], {
        chatCompletion: mockChat,
        ejecutores,
        maxRondasHerramientas: 5
      });

      assert.ok(typeof respuesta === 'string');
      assertNoEmojis(respuesta);
    });
  });

  // =========================================================================
  // R2 Boundaries
  // =========================================================================
  describe('R2: Local RAG Vector Memory Boundaries', () => {

    it('2.2.1 should handle empty document arrays in buildTfIdfIndex safely', () => {
      const indiceVacio = buildTfIdfIndex([]);
      assert.ok(indiceVacio);
      assert.deepEqual(indiceVacio.vocabulary, []);
      assert.deepEqual(indiceVacio.idfMap, {});
      assert.deepEqual(indiceVacio.docVectors, []);
      assertNoEmojis(indiceVacio);
    });

    it('2.2.2 should return 0.0 for zero-norm or empty vectors in computeCosineSimilarity', () => {
      // Dense zero vectors
      assert.strictEqual(computeCosineSimilarity([0, 0, 0], [0, 0, 0]), 0.0);
      assert.strictEqual(computeCosineSimilarity([0, 0, 0], [1, 2, 3]), 0.0);
      assert.strictEqual(computeCosineSimilarity([], []), 0.0);

      // Sparse zero/empty dictionaries
      assert.strictEqual(computeCosineSimilarity({}, {}), 0.0);
      assert.strictEqual(computeCosineSimilarity({ a: 0, b: 0 }, { a: 0, b: 0 }), 0.0);
      assert.strictEqual(computeCosineSimilarity({ x: 0 }, { x: 1 }), 0.0);

      // Invalid inputs
      assert.strictEqual(computeCosineSimilarity(null, undefined), 0.0);
      assert.strictEqual(computeCosineSimilarity('vector', 123), 0.0);
    });

    it('2.2.3 should compute similarity for high-dimensional sparse vectors with large disjoint sets', () => {
      const vecAltoA = {};
      const vecAltoB = {};

      for (let i = 0; i < 300; i++) {
        vecAltoA[`term_${i}`] = 1.0;
        vecAltoB[`term_${i + 200}`] = 1.0;
      }
      // Overlap is terms 200 to 299 (100 shared terms out of 300 each)
      const sim = computeCosineSimilarity(vecAltoA, vecAltoB);
      assert.ok(sim > 0.3 && sim < 0.4, `Similitud esperada ~0.333, recibida: ${sim}`);
    });

    it('2.2.4 should normalize special characters, accents and punctuation to ASCII', () => {
      const entrada = '¡Atención! Servidor en producción: ¿está caído? Código 500 & #error.';
      const normalizado = normalizarTexto(entrada);
      assert.ok(!/[áéíóúÁÉÍÓÚ¿¡#&]/.test(normalizado), 'No debe contener acentos ni signos especiales');
      assert.match(normalizado, /atencion servidor en produccion esta caido codigo 500 error/);
      assertNoEmojis(normalizado);
    });

    it('2.2.5 should handle queries composed exclusively of stop words', async () => {
      const tokens = tokenizarTexto('de la que el en y a los del se');
      assert.deepEqual(tokens, [], 'Todos los stop words deben ser filtrados');

      const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'davis-rag-stopwords-'));
      const storePath = path.join(tmpDir, 'store.json');
      const vectorsPath = path.join(tmpDir, 'vectors.json');
      await fs.writeFile(storePath, JSON.stringify([{ id: '1', dato: 'texto' }]), 'utf8');

      const resultados = await buscarMemoriaSemantica('de la que el', {
        storePath,
        vectorsPath,
        memorias: [{ id: '1', dato: 'texto' }]
      });

      assert.ok(Array.isArray(resultados));
      assert.equal(resultados.length, 0, 'Consulta de solo stop words no debe retornar resultados espurios');

      await fs.rm(tmpDir, { recursive: true, force: true });
    });

    it('2.2.6 should return null safely when vector index file is corrupted', async () => {
      const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'davis-rag-corrupt-'));
      const vectorsCorruptos = path.join(tmpDir, 'corrupt_vectors.json');
      await fs.writeFile(vectorsCorruptos, '{ version: 1, vocabulary: [broken json', 'utf8');

      const indiceCargado = cargarIndiceVectorial(vectorsCorruptos);
      assert.strictEqual(indiceCargado, null, 'JSON corrupto debe retornar null sin lanzar uncaught exception');

      await fs.rm(tmpDir, { recursive: true, force: true });
    });
  });

  // =========================================================================
  // R3 Boundaries
  // =========================================================================
  describe('R3: Specialist Router Boundaries', () => {

    it('2.3.1 should fall back to general specialist with low confidence for ambiguous queries', () => {
      const resultado = clasificarEspecialista('xyz sin sentido alguno 12345');
      assert.equal(resultado.especialista, 'general');
      assert.ok(resultado.confianza <= 0.6, `Confianza debe ser baja para texto sin sentido: ${resultado.confianza}`);
      assertNoEmojis(resultado);
    });

    it('2.3.2 should handle empty tools array passed to enrutarYFiltrarHerramientas', () => {
      const res = enrutarYFiltrarHerramientas('revisa el contenedor docker', []);
      assert.equal(res.especialista, 'ops');
      assert.deepEqual(res.herramientasFiltradas, []);
      assertNoEmojis(res);
    });

    it('2.3.3 should handle null, undefined, and non-string inputs safely', () => {
      const resNull = clasificarEspecialista(null);
      assert.equal(resNull.especialista, 'general');
      assert.ok(typeof resNull.confianza === 'number');

      const resUndef = clasificarEspecialista(undefined);
      assert.equal(resUndef.especialista, 'general');

      const resNum = clasificarEspecialista(12345);
      assert.equal(resNum.especialista, 'general');

      assertNoEmojis(resNull);
      assertNoEmojis(resUndef);
      assertNoEmojis(resNum);
    });

    it('2.3.4 should handle extreme input query length of 10000 characters without crashing', () => {
      const textoLargo = 'docker status '.repeat(700);
      const resultado = clasificarEspecialista(textoLargo);
      assert.equal(resultado.especialista, 'ops');
      assert.ok(resultado.confianza >= 0.7);
      assertNoEmojis(resultado);
    });

    it('2.3.5 should fall back safely when unknown specialist name is requested', () => {
      const config = obtenerConfiguracionEspecialista('especialista_inexistente');
      assert.ok(config, 'Debe retornar configuracion general como fallback');
      assert.match(config.nombre, /general/i);
      assert.ok(Array.isArray(config.herramientasPermitidas));
      assertNoEmojis(config);
    });


    it('2.3.6 should provide numeric confidence in [0, 1] range and explicit reason for mixed query', () => {
      const queryMixta = 'haz commit de git y luego revisa el contenedor docker del servidor';
      const res = clasificarEspecialista(queryMixta);
      assert.ok(['coder', 'ops'].includes(res.especialista), 'Debe elegir entre los dominios presentes');
      assert.ok(res.confianza >= 0 && res.confianza <= 1.0, 'Confianza en rango 0..1');
      assert.ok(typeof res.razon === 'string' && res.razon.length > 5);
      assertNoEmojis(res);
    });
  });

  // =========================================================================
  // R4 Boundaries
  // =========================================================================
  describe('R4: Pre-Send Guardrails Boundaries', () => {

    it('2.4.1 should repair malformed markdown code blocks with unclosed backtick fences', () => {
      const textoConBloqueSinCerrar = [
        'Aqui esta el codigo:',
        '```javascript',
        'const activo = true;',
        'const valor = 42;'
        // Notice: missing closing ```
      ].join('\n');

      const res = guardCodeSyntax(textoConBloqueSinCerrar);
      assert.equal(res.huboCorreccion, true);
      assert.match(res.textoModificado, /```$/m, 'Debe haber anadido el cierre de bloque');
      assertNoEmojis(res.textoModificado);
    });

    it('2.4.2 should strip emojis placed at start, middle, end, and multi-codepoint sequences', () => {
      const eInicio = String.fromCodePoint(0x1F525); // fire
      const eMedio = String.fromCodePoint(0x1F4BB);  // computer
      const eFin = String.fromCodePoint(0x2705);     // check mark

      const textoExtremo = `${eInicio} Servidor iniciado ${eMedio} en puerto 3000 con estado ok ${eFin}`;
      const res = guardZeroEmojis(textoExtremo);

      assert.equal(res.huboCorreccion, true);
      assert.ok(res.emojisDetectados >= 3);
      assert.ok(!res.textoModificado.includes(eInicio));
      assert.ok(!res.textoModificado.includes(eMedio));
      assert.ok(!res.textoModificado.includes(eFin));
      assert.match(res.textoModificado, /^Servidor iniciado en puerto 3000 con estado ok$/);
      assertNoEmojis(res.textoModificado);
    });

    it('2.4.3 should flag ungrounded telephone numbers not present in context or prompt', () => {
      const afirmacionConTelefonoInventado = 'He programado el mensaje para el numero +34699887766 como solicitaste.';
      const contextoConDestinatarioDistinto = {
        traza: { llamadas: [] },
        destinatario: '34600112233@s.whatsapp.net',
        contactosConocidos: ['34600112233']
      };

      const res = guardHallucinations(afirmacionConTelefonoInventado, contextoConDestinatarioDistinto);
      assert.equal(res.huboCorreccion, true);
      assert.ok(res.correcciones.includes('HALLUCINATED_PHONE_NUMBER'));
      assert.match(res.textoModificado, /NUMERO_NO_VERIFICADO/);
      assertNoEmojis(res.textoModificado);
    });


    it('2.4.4 should exhaust retries and throw error when idempotent tool continually fails', async () => {
      let intentos = 0;
      const fnFalloContinuo = async () => {
        intentos++;
        throw new Error('ECONNREFUSED: Server not reachable');
      };

      await assert.rejects(
        () => ejecutarHerramientaConReintentos(
          fnFalloContinuo,
          'consultar_estado_servidor',
          {},
          { maxReintentos: 2, esperaBaseMs: 10 }
        ),
        /ECONNREFUSED/
      );

      // Initial call + 2 retries = 3 calls total
      assert.equal(intentos, 3, 'Debe haber ejecutado llamada inicial y 2 reintentos');
    });

    it('2.4.5 should identify idempotent vs non-idempotent tool operations accurately', () => {
      // Idempotent (safe to read multiple times)
      assert.equal(esHerramientaIdempotente('consultar_clima'), true);
      assert.equal(esHerramientaIdempotente('obtener_recordatorios'), true);
      assert.equal(esHerramientaIdempotente('get_infrastructure_status'), true);

      // Non-idempotent (writes, mutations, deletions)
      assert.equal(esHerramientaIdempotente('crear_commit'), false);
      assert.equal(esHerramientaIdempotente('borrar_archivo'), false);
      assert.equal(esHerramientaIdempotente('enviar_mensaje_whatsapp'), false);
      assert.equal(esHerramientaIdempotente('docker_restart'), false);
    });

    it('2.4.6 should report unfixable severe JavaScript syntax errors in erroresNoCorregibles', () => {
      const jsTotalmenteRoto = [
        '```javascript',
        'const const = = == ??:; !!!;',
        '```'
      ].join('\n');

      const res = guardCodeSyntax(jsTotalmenteRoto);
      assert.ok(res.erroresNoCorregibles.length >= 1, 'Debe registrar el error no corregible');
      assert.equal(res.erroresNoCorregibles[0].lenguaje, 'javascript');
      assertNoEmojis(res.textoModificado);
    });
  });
});
