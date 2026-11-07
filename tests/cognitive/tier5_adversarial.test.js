/**
 * tier5_adversarial.test.js
 * Tier 5: Adversarial Hardening for Cognitive Enhancements.
 * Exercises adversarial stress cases against:
 * 1. Local RAG Vector Memory (semanticMemoryService.js)
 * 2. Pre-Send Guardrails & Self-Correction (preSendGuardrailService.js)
 *
 * Strict Policy: Zero Emojis (unicode escapes used exclusively).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

import { assertNoEmojis } from './helpers/testFixtures.js';

import {
  computeCosineSimilarity,
  tokenizarTexto,
  normalizarTexto,
  cargarIndiceVectorial,
  indexarMemoriasVectoriales,
  buscarMemoriaSemantica
} from '../../src/services/semanticMemoryService.js';

import {
  validarMensajeSalida,
  guardZeroEmojis,
  guardCodeSyntax,
  guardHallucinations,
  PATRON_EMOJI_REGEX
} from '../../src/services/preSendGuardrailService.js';

describe('Tier 5: Adversarial Stress Testing', () => {

  // =========================================================================
  // Suite 1: Local RAG Vector Memory Adversarial Stress
  // =========================================================================
  describe('Suite 1: Local RAG Vector Memory Adversarial Stress', () => {

    it('5.1.1 should evaluate 10,000-dimensional sparse vectors with disjoint vocabularies in < 200ms', () => {
      const vecA = {};
      const vecB = {};
      for (let i = 0; i < 10000; i++) {
        vecA[`term_alpha_${i}`] = 1.0;
        vecB[`term_beta_${i}`] = 1.0;
      }

      const start = performance.now();
      const sim = computeCosineSimilarity(vecA, vecB);
      const elapsed = performance.now() - start;

      assert.equal(sim, 0.0, 'Disjoint sparse vectors must have exactly 0.0 cosine similarity');
      assert.ok(elapsed < 200, `High-dimensional evaluation took too long: ${elapsed.toFixed(2)}ms`);
    });

    it('5.1.2 should compute accurate similarity for single overlapping dimension in 10,000 dimensions', () => {
      const vecA = {};
      const vecB = {};
      for (let i = 0; i < 10000; i++) {
        vecA[`shared_dim_${i}`] = 1.0;
        vecB[`diff_dim_${i}`] = 1.0;
      }
      vecB['shared_dim_0'] = 1.0;

      const expected = 1.0 / (Math.sqrt(10000) * Math.sqrt(10001));
      const sim = computeCosineSimilarity(vecA, vecB);

      assert.ok(Math.abs(sim - expected) < 1e-6, `Expected ~${expected}, got ${sim}`);
    });

    it('5.1.3 should handle asymmetric high-dimensional sparse vectors (50,000 keys vs 10 keys)', () => {
      const bigVec = {};
      for (let i = 0; i < 50000; i++) {
        bigVec[`large_${i}`] = 1.0;
      }
      const smallVec = {
        large_100: 2.0,
        large_200: 3.0,
        unrelated_1: 5.0
      };

      const start = performance.now();
      const sim = computeCosineSimilarity(bigVec, smallVec);
      const elapsed = performance.now() - start;

      assert.ok(sim > 0.0, 'Partial overlap must produce positive similarity');
      assert.ok(elapsed < 150, `50k dimension comparison took ${elapsed.toFixed(2)}ms`);
    });

    it('5.1.4 should safely handle prototype pollution keys in sparse dictionary vectors', () => {
      const maliciousVecA = {
        __proto__: { polluted: 999 },
        constructor: 1.0,
        toString: 2.0,
        valueOf: 3.0,
        validTerm: 4.0
      };
      const maliciousVecB = {
        validTerm: 4.0,
        polluted: 100.0
      };

      const sim = computeCosineSimilarity(maliciousVecA, maliciousVecB);
      assert.ok(Number.isFinite(sim), 'Cosine similarity must not throw on prototype keys');
      assert.ok(sim > 0.0, 'Valid own property match must produce positive similarity');
    });

    it('5.1.5 should return 0.0 for zero-magnitude dense and sparse vectors and empty representations', () => {
      assert.equal(computeCosineSimilarity([0, 0, 0], [0, 0, 0]), 0.0);
      assert.equal(computeCosineSimilarity([0, 0, 0], [1, 2, 3]), 0.0);
      assert.equal(computeCosineSimilarity({ a: 0, b: 0 }, { a: 0, b: 0 }), 0.0);
      assert.equal(computeCosineSimilarity({ a: 0 }, { a: 5 }), 0.0);
      assert.equal(computeCosineSimilarity([], []), 0.0);
      assert.equal(computeCosineSimilarity({}, {}), 0.0);
      assert.equal(computeCosineSimilarity(null, undefined), 0.0);
    });

    it('5.1.6 should compute exact -1.0 cosine similarity for anti-parallel vectors with negative values', () => {
      const densePos = [1.0, 2.0, 3.0];
      const denseNeg = [-1.0, -2.0, -3.0];
      assert.ok(Math.abs(computeCosineSimilarity(densePos, denseNeg) - (-1.0)) < 1e-6);

      const sparsePos = { termX: 5.0, termY: 10.0 };
      const sparseNeg = { termX: -5.0, termY: -10.0 };
      assert.ok(Math.abs(computeCosineSimilarity(sparsePos, sparseNeg) - (-1.0)) < 1e-6);

      const orthA = [1.0, -1.0];
      const orthB = [1.0, 1.0];
      assert.ok(Math.abs(computeCosineSimilarity(orthA, orthB) - 0.0) < 1e-6);
    });

    it('5.1.7 should handle extreme floating point numbers without throwing', () => {
      const hugeVecA = [1e200, 1e200];
      const hugeVecB = [1e200, 1e200];
      assert.equal(computeCosineSimilarity(hugeVecA, hugeVecB), 0.0);

      const safeHugeA = [1e150, 1e150];
      const safeHugeB = [1e150, 1e150];
      assert.ok(Math.abs(computeCosineSimilarity(safeHugeA, safeHugeB) - 1.0) < 1e-4);

      const tinyVecA = [Number.MIN_VALUE, Number.MIN_VALUE];
      const tinyVecB = [Number.MIN_VALUE, Number.MIN_VALUE];
      assert.equal(computeCosineSimilarity(tinyVecA, tinyVecB), 0.0);
    });

    it('5.1.8 should gracefully return null on corrupted knowledge_vectors.json files', () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'davis-rag-corrupt-'));
      const corruptedPath = path.join(tmpDir, 'corrupted_vectors.json');

      const testCases = [
        '{"vocabulary": [invalid syntax',
        '{"version": "1.0", "vocabulary": ["madrid"',
        '',
        '    \n\t   ',
        '[1, 2, 3]',
        '{"vocabulary": "not_an_array", "vectors": []}',
        '{"vocabulary": ["madrid"], "vectors": null}'
      ];

      for (const content of testCases) {
        fs.writeFileSync(corruptedPath, content, 'utf8');
        const loaded = cargarIndiceVectorial(corruptedPath);
        assert.equal(loaded, null);
      }

      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('5.1.9 should recover from corrupted vector cache and rebuild index from storePath', async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'davis-rag-recover-'));
      const corruptedVectorsPath = path.join(tmpDir, 'knowledge_vectors.json');
      const storePath = path.join(tmpDir, 'brain_memory.json');

      fs.writeFileSync(corruptedVectorsPath, 'CORRUPTED_JSON_DATA_###', 'utf8');

      const memories = [
        {
          id: 'mem_1',
          sujeto: 'David',
          dato: 'David prefiere programar en Node.js y TypeScript con Clean Architecture',
          categoria: 'preferencias',
          tags: ['programacion', 'nodejs']
        }
      ];
      fs.writeFileSync(storePath, JSON.stringify(memories, null, 2), 'utf8');

      const results = await buscarMemoriaSemantica('Node.js TypeScript', {
        storePath,
        vectorsPath: corruptedVectorsPath,
        minScore: 0.05
      });

      assert.ok(Array.isArray(results));
      assert.ok(results.length > 0);
      assert.equal(results[0].id, 'mem_1');

      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('5.1.10 should return empty array when query consists solely of Spanish stop words', async () => {
      const stopWordsQuery = 'de la en el por';
      const tokens = tokenizarTexto(stopWordsQuery);
      assert.equal(tokens.length, 0);

      const complexStop = '¡DE! ¿LA? *EN* (EL) -POR- mas sobre esta cuando';
      assert.equal(tokenizarTexto(complexStop).length, 0);

      const res = await buscarMemoriaSemantica(stopWordsQuery, {
        memorias: [{ id: 'm1', dato: 'texto de prueba' }]
      });
      assert.deepEqual(res, []);
    });
  });

  // =========================================================================
  // Suite 2: Pre-Send Guardrails Adversarial Stress
  // =========================================================================
  describe('Suite 2: Pre-Send Guardrails Adversarial Stress', () => {

    it('5.2.1 should strip complex Fitzpatrick skin tone modifiers and ZWJ sequences', () => {
      const input = 'Operacion completada \u{1F44F}\u{1F3FB} con exito \u{1F44D}\u{1F3FC} dev \u{1F9D1}\u{1F3FE}\u200D\u{1F4BB} finalizado \u{1F44A}\u{1F3FF}.';
      const res = guardZeroEmojis(input);

      assert.ok(res.huboCorreccion);
      assertNoEmojis(res.textoModificado);
      assert.ok(!res.textoModificado.includes('\u{1F3FB}'));
      assert.ok(!res.textoModificado.includes('\u{1F3FF}'));
      assert.ok(!res.textoModificado.includes('\u200D'));
      assert.equal(res.textoModificado, 'Operacion completada con exito dev finalizado.');
    });

    it('5.2.2 should strip country flag sequences and variation selectors', () => {
      const input = 'Servidores en Espa\u00f1a \u{1F1EA}\u{1F1F8} y USA \u{1F1FA}\u{1F1F8} con amor \u2764\uFE0F y paso 1\uFE0F\u20E3.';
      const res = guardZeroEmojis(input);

      assert.ok(res.huboCorreccion);
      assertNoEmojis(res.textoModificado);
      assert.ok(!res.textoModificado.includes('\u20E3'));
      assert.ok(!res.textoModificado.includes('\uFE0F'));
      assert.equal(res.textoModificado, 'Servidores en Espa\u00f1a y USA con amor y paso.');
      // Verify regular digits without keycaps are never stripped
      const regularDigits = guardZeroEmojis('Servidor 1 con puerto 8080');
      assert.equal(regularDigits.textoModificado, 'Servidor 1 con puerto 8080');
    });

    it('5.2.3 should strip emojis inside code fences while preserving code indentation', () => {
      const codeBlock = [
        'Script de inicio \u{1F680}:',
        '```javascript',
        '// Servidor express \u{1F4BB}',
        'function startServer() {',
        '  const port = 3000; // Puerto \u{2705}',
        '  console.log("Iniciando...");',
        '}',
        '```',
        'Listo \u{1F44D}.'
      ].join('\n');

      const res = guardZeroEmojis(codeBlock);
      assert.ok(res.huboCorreccion);
      assertNoEmojis(res.textoModificado);
      assert.ok(res.textoModificado.includes('```javascript'));
      assert.ok(res.textoModificado.includes('  const port = 3000; // Puerto'));
      assert.ok(res.textoModificado.includes('Listo.'));
    });

    it('5.2.4 should strip emojis inside identifiers within code snippets', () => {
      const snippet = [
        '```javascript',
        'const test\u{1F680}Variable = 42;',
        'function run\u{2705}Check() {',
        '  return test\u{1F680}Variable > 0;',
        '}',
        '```'
      ].join('\n');

      const sanitized = guardZeroEmojis(snippet);
      assertNoEmojis(sanitized.textoModificado);
      assert.ok(sanitized.textoModificado.includes('testVariable = 42;'));
      assert.ok(sanitized.textoModificado.includes('function runCheck()'));

      const syntaxRes = guardCodeSyntax(sanitized.textoModificado);
      assert.equal(syntaxRes.erroresNoCorregibles.length, 0);
    });

    it('5.2.5 should auto-correct unclosed JavaScript brackets, parens and quotes', () => {
      const unclosedJs = [
        '```javascript',
        "function test() { console.log('hi'",
        '```'
      ].join('\n');

      const res = guardCodeSyntax(unclosedJs);
      assert.ok(res.huboCorreccion);
      assert.equal(res.erroresNoCorregibles.length, 0);
      assert.ok(res.textoModificado.includes("console.log('hi')"));
      assert.ok(res.textoModificado.includes('}'));
    });

    it('5.2.6 should decode HTML entities in JavaScript function blocks', () => {
      const corruptedJs = [
        '```javascript',
        "function calcular(x, y) {",
        "  if (x &lt; 10 &amp;&amp; y &gt; 5) {",
        "    return &#39;ok&#39;;",
        "  }",
        "}",
        '```'
      ].join('\n');

      const res = guardCodeSyntax(corruptedJs);
      assert.ok(res.huboCorreccion);
      assert.equal(res.erroresNoCorregibles.length, 0);
      assert.ok(res.textoModificado.includes('if (x < 10 && y > 5) {'));
      assert.ok(res.textoModificado.includes("return 'ok';"));
    });

    it('5.2.7 should safely annotate unrecoverable JavaScript syntax without crashing', () => {
      const brokenJs = [
        '```javascript',
        'const = = = ;;;; return ?????',
        '```'
      ].join('\n');

      const res = guardCodeSyntax(brokenJs);
      assert.ok(res.huboCorreccion);
      assert.ok(res.textoModificado.includes('AVISO_SINTAXIS: Fragmento JS con error de sintaxis:'));
    });

    it('5.2.8 should auto-correct JSON trailing commas, Python literals, and single quotes', () => {
      const messyJson = [
        '```json',
        '{',
        '  status: "ok",',
        "  'is_admin': True,",
        "  'archived': False,",
        "  'metadata': None,",
        '  items: [1, 2, 3,],',
        '}',
        '```'
      ].join('\n');

      const res = guardCodeSyntax(messyJson);
      assert.ok(res.huboCorreccion);
      assert.equal(res.erroresNoCorregibles.length, 0);

      const match = res.textoModificado.match(/```json\n([\s\S]*?)```/);
      assert.ok(match);
      const parsed = JSON.parse(match[1]);
      assert.equal(parsed.status, 'ok');
      assert.equal(parsed.is_admin, true);
      assert.equal(parsed.archived, false);
      assert.equal(parsed.metadata, null);
      assert.equal(parsed.items.length, 3);
    });

    it('5.2.9 should neutralize ungrounded critical financial and file deletion claims', () => {
      const transferClaim = 'Confirmacion: he transferido 500 euros a la cuenta.';
      const resTransfer = guardHallucinations(transferClaim, { traza: { llamadas: [] } });
      assert.ok(resTransfer.huboCorreccion);
      assert.ok(!resTransfer.textoModificado.includes('he transferido'));
      assert.ok(resTransfer.textoModificado.includes('no se ha realizado ninguna transferencia de fondos'));

      const fileClaim = 'Listo, he borrado el archivo sensible del servidor.';
      const resFile = guardHallucinations(fileClaim, { traza: { llamadas: [] } });
      assert.ok(resFile.huboCorreccion);
      assert.ok(!resFile.textoModificado.includes('he borrado el archivo'));
    });

    it('5.2.10 should replace unverified international phone numbers with [NUMERO_NO_VERIFICADO]', () => {
      const text = 'Soporte al +14155552671 o +447911123456 con timestamp 20261107140000.';
      const contexto = {
        destinatario: '+34600112233',
        contactosConocidos: [{ telefono: '+34600112233' }]
      };

      const res = guardHallucinations(text, contexto);
      assert.ok(res.huboCorreccion);
      assert.ok(!res.textoModificado.includes('+14155552671'));
      assert.ok(!res.textoModificado.includes('+447911123456'));
      assert.ok(res.textoModificado.includes('[NUMERO_NO_VERIFICADO]'));
      assert.ok(res.textoModificado.includes('20261107140000'));
    });

    it('5.2.11 should validate full multi-vector attack through validarMensajeSalida', () => {
      const attack = [
        'Hola \u{1F44B}\u{1F3FB}, he transferido 1000 euros a la cuenta.',
        'Aqui esta el codigo \u{1F680}:',
        '```javascript',
        'function test() { console.log(&quot;ok&quot;',
        '```',
        'Llama a +19998887776 para confirmar \u{1F44D}.'
      ].join('\n');

      const contexto = {
        destinatario: '+34612345678',
        traza: { llamadas: [] }
      };

      const res = validarMensajeSalida(attack, contexto);
      assert.equal(res.bloqueado, false);
      assert.equal(res.valido, true);
      assertNoEmojis(res.textoFinal);
      assert.ok(!res.textoFinal.includes('he transferido'));
      assert.ok(!res.textoFinal.includes('+19998887776'));
      assert.ok(res.textoFinal.includes('[NUMERO_NO_VERIFICADO]'));
    });
  });
});
