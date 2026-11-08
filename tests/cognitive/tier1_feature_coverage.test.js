/**
 * tier1_feature_coverage.test.js
 * Tier 1: Feature Contract Coverage for Advanced Cognition.
 * Covers R1 (ReAct loop), R2 (Local RAG Vector Memory), R3 (Specialist Router), and R4 (Pre-Send Guardrails).
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
  computeCosineSimilarity,
  tokenizarTexto,
  normalizarTexto,
  buildTfIdfIndex,
  indexarMemoriasVectoriales,
  buscarMemoriaSemantica,
  cargarIndiceVectorial
} from '../../src/services/semanticMemoryService.js';
import {
  clasificarEspecialista,
  obtenerConfiguracionEspecialista,
  enrutarYFiltrarHerramientas,
  LIMITE_HERRAMIENTAS_ESPECIALISTA
} from '../../src/services/specialistRouterService.js';
import {
  validarMensajeSalida,
  guardZeroEmojis,
  guardCodeSyntax,
  guardHallucinations,
  ejecutarHerramientaConReintentos
} from '../../src/services/preSendGuardrailService.js';

describe('Tier 1: Feature Contract Coverage', () => {

  // =========================================================================
  // R1: ReAct Multi-Step Loop Core
  // =========================================================================
  describe('R1: ReAct Loop Core (Think -> Act -> Observe -> Decide)', () => {

    it('1.1 should execute basic Think-Act-Observe-Decide cycle with tool execution', async () => {
      const mockChat = crearChatMock([
        {
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: 'call_clima_01',
                type: 'function',
                function: {
                  name: 'consultar_clima',
                  arguments: { ciudad: 'Madrid' }
                }
              }
            ]
          }
        },
        {
          message: {
            role: 'assistant',
            content: 'En Madrid hay cielo despejado con 18 grados.'
          },
          finishReason: 'stop'
        }
      ]);

      const { ejecutores, llamadas } = crearEjecutoresMock({
        consultar_clima: async (args) => ({
          texto: `Temperatura en ${args.ciudad}: 18C, despejado.`
        })
      });

      const respuesta = await consultarJarvis('Que tiempo hace en Madrid?', [], {
        chatCompletion: mockChat,
        ejecutores,
        maxRondasHerramientas: 5
      });

      assert.ok(typeof respuesta === 'string', 'Debe retornar respuesta de texto');
      assert.match(respuesta, /Madrid/i, 'Debe incluir la ciudad');
      assert.equal(llamadas.length, 1, 'Debe haber ejecutado una herramienta');
      assert.equal(llamadas[0].name, 'consultar_clima');
      assert.equal(mockChat.getCallCount(), 2, 'Debe requerir 2 turnos de chat (llamada + sintesis)');
      assertNoEmojis(respuesta, 'Respuesta final');
    });

    it('1.2 should chain multiple autonomous tool rounds before formulating answer', async () => {
      const mockChat = crearChatMock([
        // Round 1 tool call
        {
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: 'call_step1',
                type: 'function',
                function: { name: 'consultar_clima', arguments: { ciudad: 'Madrid' } }
              }
            ]
          }
        },
        // Round 2 tool call
        {
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: 'call_step2',
                type: 'function',
                function: { name: 'consultar_clima', arguments: { ciudad: 'Barcelona' } }
              }
            ]
          }
        },
        // Final Decision
        {
          message: {
            role: 'assistant',
            content: 'En Madrid hay 18C y en Barcelona hay 20C.'
          },
          finishReason: 'stop'
        }
      ]);

      const { ejecutores, llamadas } = crearEjecutoresMock({
        consultar_clima: async (args) => ({ texto: `Clima en ${args.ciudad}: 20C` })
      });

      const respuesta = await consultarJarvis('Que tiempo hace en Madrid y Barcelona?', [], {
        chatCompletion: mockChat,
        ejecutores,
        maxRondasHerramientas: 5
      });

      assert.equal(llamadas.length, 2, 'Debe encadenar 2 llamadas autonomamente');
      assert.equal(llamadas[0].name, 'consultar_clima');
      assert.equal(llamadas[1].name, 'consultar_clima');
      assert.match(respuesta, /Madrid/i);
      assertNoEmojis(respuesta);
    });


    it('1.3 should terminate immediately without tool execution when model answers directly', async () => {
      const mockChat = crearChatMock([
        {
          message: {
            role: 'assistant',
            content: 'Hola David, estoy listo para tus instrucciones operativas.'
          },
          finishReason: 'stop'
        }
      ]);

      const { ejecutores, llamadas } = crearEjecutoresMock();

      const respuesta = await consultarJarvis('Hola Jarvis', [], {
        chatCompletion: mockChat,
        ejecutores,
        maxRondasHerramientas: 5
      });

      assert.equal(llamadas.length, 0, 'No debe ejecutar herramientas si el modelo responde directo');
      assert.equal(mockChat.getCallCount(), 1, 'Solo debe invocar el modelo una vez');
      assert.match(respuesta, /David/i);
      assertNoEmojis(respuesta);
    });

    it('1.4 should enforce 5-round limit when tools are repeatedly called', async () => {
      // Create a mock that keeps requesting tools indefinitely
      let roundCounter = 0;
      const infiniteToolMock = async () => {
        roundCounter++;
        return {
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: `call_loop_${roundCounter}`,
                type: 'function',
                function: { name: 'consulta_reiterada', arguments: { iter: roundCounter } }
              }
            ]
          }
        };
      };

      const { ejecutores, llamadas } = crearEjecutoresMock({
        consulta_reiterada: async (args) => ({ texto: `Iteracion ${args.iter} procesada.` })
      });

      const respuesta = await consultarJarvis('Bucle infinito', [], {
        chatCompletion: infiniteToolMock,
        ejecutores,
        maxRondasHerramientas: 5
      });

      assert.ok(llamadas.length <= 5, `No debe exceder 5 rondas de herramientas (ejecuto: ${llamadas.length})`);
      assert.ok(typeof respuesta === 'string');
      assertNoEmojis(respuesta);
    });

    it('1.5 should handle multiple tool calls in a single round sequentially', async () => {
      const mockChat = crearChatMock([
        {
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: 'call_a',
                type: 'function',
                function: { name: 'herramienta_alfa', arguments: { p: 1 } }
              },
              {
                id: 'call_b',
                type: 'function',
                function: { name: 'herramienta_beta', arguments: { p: 2 } }
              }
            ]
          }
        },
        {
          message: {
            role: 'assistant',
            content: 'Ambas herramientas alfa y beta ejecutadas en la misma ronda.'
          },
          finishReason: 'stop'
        }
      ]);

      const { ejecutores, llamadas } = crearEjecutoresMock({
        herramienta_alfa: async () => ({ texto: 'Alfa OK' }),
        herramienta_beta: async () => ({ texto: 'Beta OK' })
      });

      const respuesta = await consultarJarvis('Ejecuta alfa y beta en paralelo', [], {
        chatCompletion: mockChat,
        ejecutores,
        maxRondasHerramientas: 5
      });

      assert.equal(llamadas.length, 2, 'Debe procesar ambas herramientas');
      assert.equal(llamadas[0].name, 'herramienta_alfa');
      assert.equal(llamadas[1].name, 'herramienta_beta');
      assert.match(respuesta, /alfa/i);
      assertNoEmojis(respuesta);
    });

    it('1.6 should record tool calls and outcomes in execution trace', async () => {
      const mockChat = crearChatMock([
        {
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: 'call_diag',
                type: 'function',
                function: { name: 'diagnostico_sistema', arguments: {} }
              }
            ]
          }
        },
        {
          message: {
            role: 'assistant',
            content: 'Diagnostico completado con estado nominal.'
          },
          finishReason: 'stop'
        }
      ]);

      const { ejecutores } = crearEjecutoresMock({
        diagnostico_sistema: async () => ({ texto: 'CPU: 12%, Mem: 45%' })
      });

      const trazaObservada = [];
      const respuesta = await consultarJarvis('Diagnostico', [], {
        chatCompletion: mockChat,
        ejecutores,
        observarInvocacion: (nombre) => trazaObservada.push(nombre),
        maxRondasHerramientas: 5
      });

      assert.equal(trazaObservada.length, 1);
      assert.equal(trazaObservada[0], 'diagnostico_sistema');
      assertNoEmojis(respuesta);
    });
  });

  // =========================================================================
  // R2: Local RAG Vector Memory
  // =========================================================================
  describe('R2: Local RAG Vector Memory (TF-IDF & Cosine Similarity)', () => {

    it('2.1 should compute accurate cosine similarity for dense numeric vectors', () => {
      const vIdentico = computeCosineSimilarity([1, 2, 3], [1, 2, 3]);
      assert.ok(Math.abs(vIdentico - 1.0) < 0.001, `Esperado ~1.0, recibido: ${vIdentico}`);

      const vOrtogonal = computeCosineSimilarity([1, 0, 0], [0, 1, 0]);
      assert.ok(Math.abs(vOrtogonal - 0.0) < 0.001, `Esperado ~0.0, recibido: ${vOrtogonal}`);

      const vOpuesto = computeCosineSimilarity([2, 4], [1, 2]);
      assert.ok(Math.abs(vOpuesto - 1.0) < 0.001, `Vectores colineales deben dar 1.0, recibido: ${vOpuesto}`);
    });

    it('2.2 should compute accurate cosine similarity for sparse dictionary objects', () => {
      const sparseA = { vps: 2, servidor: 1, ssh: 3 };
      const sparseB = { vps: 2, servidor: 1, ssh: 3 };
      const simIdentica = computeCosineSimilarity(sparseA, sparseB);
      assert.ok(simIdentica > 0.99, `Diccionarios identicos deben dar ~1.0, recibido: ${simIdentica}`);

      const sparseDisjuntoA = { docker: 1, contenedor: 2 };
      const sparseDisjuntoB = { calendario: 1, cumpleanos: 2 };
      const simDisjunta = computeCosineSimilarity(sparseDisjuntoA, sparseDisjuntoB);
      assert.equal(simDisjunta, 0.0, 'Diccionarios sin claves compartidas deben dar 0.0');

      const sparseParcialA = { node: 2, test: 1 };
      const sparseParcialB = { node: 2, deploy: 3 };
      const simParcial = computeCosineSimilarity(sparseParcialA, sparseParcialB);
      assert.ok(simParcial > 0 && simParcial < 1, `Debe estar entre 0 y 1, recibido: ${simParcial}`);
    });

    it('2.3 should tokenize text and filter Spanish and English stop words', () => {
      const tokens = tokenizarTexto('El servidor de produccion en el VPS tiene alta latencia and the memory is low');
      assert.ok(Array.isArray(tokens));
      // Stop words removed
      assert.ok(!tokens.includes('el'));
      assert.ok(!tokens.includes('de'));
      assert.ok(!tokens.includes('en'));
      assert.ok(!tokens.includes('and'));
      assert.ok(!tokens.includes('the'));
      assert.ok(!tokens.includes('is'));
      // Content words preserved
      assert.ok(tokens.includes('servidor'));
      assert.ok(tokens.includes('produccion'));
      assert.ok(tokens.includes('vps'));
      assert.ok(tokens.includes('latencia'));
      assert.ok(tokens.includes('memory'));
      assertNoEmojis(tokens);
    });

    it('2.4 should build TF-IDF index from documents with vocabulary and IDF map', () => {
      const docs = [
        { id: 'd1', text: 'despliegue de docker en el servidor' },
        { id: 'd2', text: 'gestion de git ramas y pull requests' },
        { id: 'd3', text: 'agenda personal cumpleanos y recordatorios' }
      ];

      const index = buildTfIdfIndex(docs);
      assert.ok(index, 'Debe retornar objeto indice');
      assert.ok(Array.isArray(index.vocabulary), 'Debe tener array de vocabulario');
      assert.ok(index.vocabulary.length >= 6, 'Debe contener los terminos clave');
      assert.ok(typeof index.idfMap === 'object', 'Debe tener mapa idfMap');
      assert.ok(Array.isArray(index.docVectors), 'Debe tener vectores de documentos');
      assert.equal(index.docVectors.length, 3, 'Debe contener un vector por documento');
      assertNoEmojis(index);
    });

    it('2.5 should serialize and rehydrate vector index in JSON file', async () => {
      const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'davis-rag-test-'));
      const storePath = path.join(tmpDir, 'test_brain.json');
      const vectorsPath = path.join(tmpDir, 'test_vectors.json');

      const memorias = generarMemoriasEjemplo();
      await fs.writeFile(storePath, JSON.stringify(memorias, null, 2), 'utf8');

      const indiceCreado = await indexarMemoriasVectoriales({ memorias, storePath, vectorsPath });
      assert.ok(indiceCreado, 'Debe retornar el indice creado');
      assert.equal(indiceCreado.ok, true);
      assert.equal(indiceCreado.total, memorias.length);

      // Verify file written to disk
      const rawVectors = await fs.readFile(vectorsPath, 'utf8');
      const parsedVectors = JSON.parse(rawVectors);
      assert.ok(parsedVectors.version);
      assert.equal(parsedVectors.totalDocumentos, memorias.length);

      // Rehydrate
      const indiceCargado = await cargarIndiceVectorial(vectorsPath);
      assert.ok(indiceCargado, 'Debe rehidratar el indice desde disco');
      assert.equal(indiceCargado.totalDocumentos, memorias.length);
      assertNoEmojis(parsedVectors);

      await fs.rm(tmpDir, { recursive: true, force: true });
    });

    it('2.6 should perform semantic search ranking results by cosine relevance', async () => {
      const memorias = generarMemoriasEjemplo();
      const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'davis-rag-search-'));
      const storePath = path.join(tmpDir, 'brain.json');
      const vectorsPath = path.join(tmpDir, 'vectors.json');

      await indexarMemoriasVectoriales({ memorias, storePath, vectorsPath });

      const resultados = await buscarMemoriaSemantica('servidor vps oracle ssh', {
        storePath,
        vectorsPath,
        memorias,
        topK: 2,
        minScore: 0.1
      });

      assert.ok(Array.isArray(resultados), 'Debe retornar array de resultados');
      assert.ok(resultados.length >= 1, 'Debe encontrar al menos una memoria relevante');
      assert.equal(resultados[0].id, 'mem_vps_root_001', 'El resultado superior debe ser el VPS');
      assert.ok(resultados[0].score > 0.2, 'El score de similitud debe superar 0.2');
      assertNoEmojis(resultados);

      await fs.rm(tmpDir, { recursive: true, force: true });
    });
  });

  // =========================================================================
  // R3: Specialist Multi-Agent Router
  // =========================================================================
  describe('R3: Specialist Multi-Agent Router', () => {

    it('3.1 should classify developer requests as coder with high confidence', () => {
      const resultado = clasificarEspecialista('Crea una nueva rama de trabajo y abre un pull request en GitHub');
      assert.equal(resultado.especialista, 'coder', 'Debe clasificar como coder');
      assert.ok(resultado.confianza >= 0.7, `Confianza debe ser >= 0.7, fue: ${resultado.confianza}`);
      assert.ok(typeof resultado.razon === 'string');
      assertNoEmojis(resultado);
    });

    it('3.2 should classify sysadmin requests as ops with high confidence', () => {
      const resultado = clasificarEspecialista('Verifica el estado del contenedor docker y revisa la memoria del VPS');
      assert.equal(resultado.especialista, 'ops', 'Debe clasificar como ops');
      assert.ok(resultado.confianza >= 0.7, `Confianza debe ser >= 0.7, fue: ${resultado.confianza}`);
      assertNoEmojis(resultado);
    });

    it('3.3 should classify lifestyle requests as personal with high confidence', () => {
      const resultado = clasificarEspecialista('Registra el gasto de 24 euros de la cena y comprueba mi racha de habitos');
      assert.equal(resultado.especialista, 'personal', 'Debe clasificar como personal');
      assert.ok(resultado.confianza >= 0.7, `Confianza debe ser >= 0.7, fue: ${resultado.confianza}`);
      assertNoEmojis(resultado);
    });

    it('3.4 should strictly scope tools catalog under 128 tools per specialist', () => {
      for (const esp of ['coder', 'ops', 'personal', 'general']) {
        const config = obtenerConfiguracionEspecialista(esp);
        assert.ok(config, `Configuracion para ${esp} debe existir`);
        assert.ok(Array.isArray(config.herramientasPermitidas), `Debe tener lista de herramientas`);
        assert.ok(
          config.herramientasPermitidas.length <= LIMITE_HERRAMIENTAS_ESPECIALISTA,
          `Especialista ${esp} supera el limite de ${LIMITE_HERRAMIENTAS_ESPECIALISTA} herramientas: tiene ${config.herramientasPermitidas.length}`
        );
        assertNoEmojis(config);
      }
    });

    it('3.5 should adapt specialist persona with domain-specific instructions', () => {
      const configCoder = obtenerConfiguracionEspecialista('coder');
      assert.match(configCoder.systemPromptMod, /codigo|git|software|desarrollo/i);

      const configOps = obtenerConfiguracionEspecialista('ops');
      assert.match(configOps.systemPromptMod, /sistemas|infraestructura|ops|docker/i);

      const configPersonal = obtenerConfiguracionEspecialista('personal');
      assert.match(configPersonal.systemPromptMod, /personal|agenda|habitos|asistente/i);

      assertNoEmojis(configCoder);
      assertNoEmojis(configOps);
      assertNoEmojis(configPersonal);
    });

    it('3.6 should combine routing and tool filtering in enrutarYFiltrarHerramientas', () => {
      const herramientas = [
        { type: 'function', function: { name: 'crear_commit' } },
        { type: 'function', function: { name: 'docker_status' } },
        { type: 'function', function: { name: 'consultar_agenda' } }
      ];

      const resCoder = enrutarYFiltrarHerramientas('haz commit de los cambios git', herramientas);
      assert.equal(resCoder.especialista, 'coder');
      const nombresFiltrados = resCoder.herramientasFiltradas.map((h) => h.function.name);
      assert.ok(nombresFiltrados.includes('crear_commit'));
      assert.ok(!nombresFiltrados.includes('consultar_agenda'), 'No debe incluir herramientas personales en coder');
      assertNoEmojis(resCoder);
    });
  });

  // =========================================================================
  // R4: Pre-Send Guardrails & Self-Correction
  // =========================================================================
  describe('R4: Pre-Send Guardrails & Self-Correction', () => {

    it('4.1 should strip emojis and record REMOVED_EMOJI in corrections', () => {
      // Create a string with an emoji character embedded
      const emojiChar = String.fromCodePoint(0x1F680); // rocket
      const textoConEmoji = `Despliegue completado con exito ${emojiChar} en produccion.`;

      const resultado = guardZeroEmojis(textoConEmoji);
      assert.equal(resultado.huboCorreccion, true);
      assert.ok(!resultado.textoModificado.includes(emojiChar), 'El texto sanitizado no debe contener el emoji');
      assert.match(resultado.textoModificado, /Despliegue completado con exito/);
      assertNoEmojis(resultado.textoModificado, 'Texto sanitizado por guardZeroEmojis');

      const validacionGlobal = validarMensajeSalida(textoConEmoji, {});
      assert.ok(validacionGlobal.correccionesAplicadas.includes('REMOVED_EMOJI'));
      assertNoEmojis(validacionGlobal.textoFinal, 'Resultado validarMensajeSalida');
    });

    it('4.2 should validate valid JavaScript syntax inside markdown blocks via node:vm', () => {
      const textoMarkdown = [
        'Aqui esta el script solicitado:',
        '```javascript',
        'const a = 10;',
        'const b = 20;',
        'const total = a + b;',
        '```',
        'Listo para ejecutar.'
      ].join('\n');

      const resultado = guardCodeSyntax(textoMarkdown);
      assert.equal(resultado.bloquesValidados, 1);
      assert.equal(resultado.bloquesCorregidos, 0);
      assert.equal(resultado.erroresNoCorregibles.length, 0);
      assertNoEmojis(resultado.textoModificado);
    });

    it('4.3 should validate valid JSON syntax inside markdown blocks', () => {
      const textoJson = [
        'Configuracion generada:',
        '```json',
        '{',
        '  "servicio": "auth",',
        '  "puerto": 8080,',
        '  "activo": true',
        '}',
        '```'
      ].join('\n');

      const resultado = guardCodeSyntax(textoJson);
      assert.equal(resultado.bloquesValidados, 1);
      assert.equal(resultado.erroresNoCorregibles.length, 0);
      assertNoEmojis(resultado.textoModificado);
    });

    it('4.4 should auto-correct minor syntax glitches in code blocks', () => {
      // JSON with trailing comma (valid JS but invalid strict JSON)
      const jsonConComa = [
        '```json',
        '{',
        '  "clave": "valor",',
        '}',
        '```'
      ].join('\n');

      const resultado = guardCodeSyntax(jsonConComa);
      assert.ok(resultado.bloquesCorregidos >= 1 || resultado.huboCorreccion);
      assertNoEmojis(resultado.textoModificado);
    });

    it('4.5 should detect ungrounded critical action claims in guardHallucinations', () => {
      const afirmacionFalsa = 'He borrado el archivo antiguo y reiniciado el contenedor.';
      const trazaVacia = { llamadas: [] };

      const resultado = guardHallucinations(afirmacionFalsa, trazaVacia);
      assert.equal(resultado.huboCorreccion, true);
      assert.ok(resultado.correcciones.length > 0);
      assert.match(resultado.textoModificado, /no se ha/i);
      assertNoEmojis(resultado.textoModificado);
    });


    it('4.6 should transparently retry transient failures for idempotent tools', async () => {
      let intentos = 0;
      const fnFalloTransitorio = async (args) => {
        intentos++;
        if (intentos < 2) {
          throw new Error('ETIMEDOUT: Connection reset by peer');
        }
        return `Exito en intento ${intentos}: datos de ${args.item}`;
      };

      const resultado = await ejecutarHerramientaConReintentos(
        fnFalloTransitorio,
        'consultar_estado',
        { item: 'vps' },
        { maxReintentos: 2, esperaBaseMs: 20 }
      );

      assert.equal(intentos, 2, 'Debe haber reintentado exactamente 1 vez (2 llamadas en total)');
      assert.match(resultado, /Exito en intento 2/);
      assertNoEmojis(resultado);
    });
  });
});
