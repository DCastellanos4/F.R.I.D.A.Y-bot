/**
 * adversarial_stress_cognitive.mjs
 * Comprehensive Adversarial Stress Test Harness for Cognitive Enhancements:
 * 1. RAG Vector Memory Stress Testing
 * 2. Pre-Send Guardrails Stress Testing
 *
 * Strict Zero Emojis Policy: Unicode escapes (\u{...}) are used exclusively.
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');

// Import target modules directly from friday-repo/src/services
import {
  computeCosineSimilarity,
  calcularSimilitudCoseno,
  buildTfIdfIndex,
  vectorizeText,
  tokenizarTexto,
  normalizarTexto,
  cargarIndiceVectorial,
  guardarIndiceVectorial,
  indexarMemoriasVectoriales,
  buscarMemoriaSemantica
} from '../src/services/semanticMemoryService.js';

import {
  validarMensajeSalida,
  guardZeroEmojis,
  guardCodeSyntax,
  guardHallucinations,
  ejecutarHerramientaConReintentos,
  esHerramientaIdempotente,
  PATRON_EMOJI_REGEX,
  EMOJI_DETECTION_FULL_REGEX
} from '../src/services/preSendGuardrailService.js';

// Test runner state
const results = {
  total: 0,
  passed: 0,
  failed: 0,
  empiricalNotes: [],
  findings: []
};

function test(name, fn) {
  results.total++;
  try {
    fn();
    results.passed++;
    console.log(`  [PASS] ${name}`);
  } catch (err) {
    results.failed++;
    console.error(`  [FAIL] ${name}: ${err.message}`);
    results.findings.push({
      test: name,
      error: err.message,
      stack: err.stack
    });
  }
}

async function testAsync(name, fn) {
  results.total++;
  try {
    await fn();
    results.passed++;
    console.log(`  [PASS] ${name}`);
  } catch (err) {
    results.failed++;
    console.error(`  [FAIL] ${name}: ${err.message}`);
    results.findings.push({
      test: name,
      error: err.message,
      stack: err.stack
    });
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message || 'Assertion failed');
  }
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`${message || 'Assertion failed'} - expected: ${expected}, got: ${actual}`);
  }
}

function assertAlmostEqual(actual, expected, tolerance = 1e-4, message) {
  if (Math.abs(actual - expected) > tolerance) {
    throw new Error(`${message || 'Assertion failed'} - expected ~${expected}, got: ${actual} (diff: ${Math.abs(actual - expected)})`);
  }
}

function assertNoEmojisInString(str, context = '') {
  if (typeof str !== 'string') return;
  const match = str.match(PATRON_EMOJI_REGEX);
  if (match) {
    throw new Error(`Emoji violation in ${context}: found "${match[0]}" (code: ${match[0].codePointAt(0).toString(16)})`);
  }
}

async function runAdversarialHarness() {
  console.log('================================================================');
  console.log(' ADVERSARIAL STRESS TEST HARNESS: COGNITIVE ENHANCEMENTS');
  console.log(' Modules: semanticMemoryService.js & preSendGuardrailService.js');
  console.log(' Policy: Strict Zero Emojis');
  console.log('================================================================\n');

  // ============================================================================
  // PART 1: RAG VECTOR MEMORY STRESS TESTING
  // ============================================================================
  console.log('--- PART 1: RAG VECTOR MEMORY STRESS TESTING ---');

  // 1.1 High-dimensional sparse dictionary vectors with disjoint vocabularies
  test('1.1.1: 10,000 dimensions sparse vectors with 100% disjoint vocabularies', () => {
    const vecA = {};
    const vecB = {};
    for (let i = 0; i < 10000; i++) {
      vecA[`term_alpha_${i}`] = 1.0;
      vecB[`term_beta_${i}`] = 1.0;
    }

    const start = performance.now();
    const sim = computeCosineSimilarity(vecA, vecB);
    const elapsed = performance.now() - start;

    assertEqual(sim, 0.0, 'Disjoint sparse vectors must have exactly 0.0 cosine similarity');
    assert(elapsed < 200, `High-dimensional evaluation took too long: ${elapsed.toFixed(2)}ms`);
  });

  test('1.1.2: 10,000 dimensions sparse vectors with exactly 1 common key', () => {
    const vecA = {};
    const vecB = {};
    for (let i = 0; i < 10000; i++) {
      vecA[`shared_dim_${i}`] = 1.0;
      vecB[`diff_dim_${i}`] = 1.0;
    }
    vecB['shared_dim_0'] = 1.0;

    const expected = 1.0 / (Math.sqrt(10000) * Math.sqrt(10001));
    const sim = computeCosineSimilarity(vecA, vecB);

    assertAlmostEqual(sim, expected, 1e-6, 'Single overlapping dimension in 10,000 dims must match mathematical cosine formula');
  });

  test('1.1.3: Asymmetric high-dimensional sparse vectors (50,000 keys vs 10 keys)', () => {
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

    assert(sim > 0.0, 'Partial overlap must produce positive similarity');
    assert(elapsed < 150, `50k dimension comparison took ${elapsed.toFixed(2)}ms`);
  });

  test('1.1.4: Mixed sparse dictionary object vs dense numeric array with disjoint indices', () => {
    const sparseObj = { '10': 1.0, '20': 2.0, '30': 3.0 };
    const denseArr = [1.0, 2.0, 3.0, 4.0, 5.0];

    const sim1 = computeCosineSimilarity(sparseObj, denseArr);
    const sim2 = computeCosineSimilarity(denseArr, sparseObj);

    assertEqual(sim1, 0.0, 'Disjoint sparse-dense mixture must return 0.0');
    assertEqual(sim2, 0.0, 'Commutative mixed comparison must return 0.0');
  });

  test('1.1.5: Prototype pollution keys in sparse dictionary vectors', () => {
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
    assert(Number.isFinite(sim), 'Cosine similarity must not throw on prototype keys');
    assert(sim > 0.0, 'Valid own property match must produce positive similarity');
  });

  // 1.2 Zero-magnitude vectors, negative values, extreme floating point numbers
  test('1.2.1: Zero-magnitude dense arrays and sparse dictionaries', () => {
    assertEqual(computeCosineSimilarity([0, 0, 0], [0, 0, 0]), 0.0, 'Zero dense vectors must return 0.0');
    assertEqual(computeCosineSimilarity([0, 0, 0], [1, 2, 3]), 0.0, 'Zero vector vs non-zero must return 0.0');
    assertEqual(computeCosineSimilarity({ a: 0, b: 0 }, { a: 0, b: 0 }), 0.0, 'Zero sparse objects must return 0.0');
    assertEqual(computeCosineSimilarity({ a: 0 }, { a: 5 }), 0.0, 'Zero sparse vs non-zero must return 0.0');
    assertEqual(computeCosineSimilarity([], []), 0.0, 'Empty arrays must return 0.0');
    assertEqual(computeCosineSimilarity({}, {}), 0.0, 'Empty objects must return 0.0');
    assertEqual(computeCosineSimilarity(null, undefined), 0.0, 'Null/undefined must return 0.0');
  });

  test('1.2.2: Negative values and anti-parallel vectors (exact -1.0 cosine similarity)', () => {
    const densePos = [1.0, 2.0, 3.0];
    const denseNeg = [-1.0, -2.0, -3.0];
    const simDense = computeCosineSimilarity(densePos, denseNeg);
    assertAlmostEqual(simDense, -1.0, 1e-6, 'Anti-parallel dense vectors must yield -1.0');

    const sparsePos = { termX: 5.0, termY: 10.0 };
    const sparseNeg = { termX: -5.0, termY: -10.0 };
    const simSparse = computeCosineSimilarity(sparsePos, sparseNeg);
    assertAlmostEqual(simSparse, -1.0, 1e-6, 'Anti-parallel sparse vectors must yield -1.0');

    const orthA = [1.0, -1.0];
    const orthB = [1.0, 1.0];
    const simOrth = computeCosineSimilarity(orthA, orthB);
    assertAlmostEqual(simOrth, 0.0, 1e-6, 'Orthogonal vectors with negative values must yield 0.0');
  });

  test('1.2.3: Extreme floating point numbers (overflow to Infinity, underflow to 0)', () => {
    const hugeVecA = [1e200, 1e200];
    const hugeVecB = [1e200, 1e200];
    const simHuge = computeCosineSimilarity(hugeVecA, hugeVecB);
    assertEqual(simHuge, 0.0, 'Overflowing floating point numbers must return 0.0 gracefully without crashing');

    const safeHugeA = [1e150, 1e150];
    const safeHugeB = [1e150, 1e150];
    const simSafeHuge = computeCosineSimilarity(safeHugeA, safeHugeB);
    assertAlmostEqual(simSafeHuge, 1.0, 1e-4, 'Large finite float numbers must yield 1.0');

    const tinyVecA = [Number.MIN_VALUE, Number.MIN_VALUE];
    const tinyVecB = [Number.MIN_VALUE, Number.MIN_VALUE];
    const simTiny = computeCosineSimilarity(tinyVecA, tinyVecB);
    assertEqual(simTiny, 0.0, 'Subnormal floats must return 0.0 gracefully');
  });

  test('1.2.4: Corrupted and non-numeric vector values (NaN, null, undefined, strings)', () => {
    const corruptedA = [NaN, null, undefined, 'abc', false, Infinity, -Infinity];
    const corruptedB = [1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0];
    const sim = computeCosineSimilarity(corruptedA, corruptedB);
    assert(Number.isFinite(sim), 'Corrupted numeric values must not throw and must return finite number');
    assert(sim >= -1.0 && sim <= 1.0, 'Similarity must stay within [-1.0, 1.0]');
  });

  // 1.3 Corrupted knowledge_vectors.json
  await testAsync('1.3.1: Corrupted knowledge_vectors.json graceful fallback in cargarIndiceVectorial', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'davis-rag-test-'));
    const corruptedPath = path.join(tmpDir, 'corrupted_vectors.json');

    const testCases = [
      { name: 'Invalid syntax', content: '{"vocabulary": [invalid syntax' },
      { name: 'Truncated JSON', content: '{"version": "1.0", "vocabulary": ["madrid"' },
      { name: 'Empty file', content: '' },
      { name: 'Whitespace only', content: '    \n\t   ' },
      { name: 'Array root', content: '[1, 2, 3]' },
      { name: 'Non-array vocabulary', content: '{"vocabulary": "not_an_array", "vectors": []}' },
      { name: 'Non-array vectors', content: '{"vocabulary": ["madrid"], "vectors": null}' }
    ];

    for (const tc of testCases) {
      fs.writeFileSync(corruptedPath, tc.content, 'utf8');
      const loaded = cargarIndiceVectorial(corruptedPath);
      assertEqual(loaded, null, `cargarIndiceVectorial must return null safely for: ${tc.name}`);
    }

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  await testAsync('1.3.2: buscarMemoriaSemantica recovers from corrupted knowledge_vectors.json using storePath', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'davis-rag-test-2-'));
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
      },
      {
        id: 'mem_2',
        sujeto: 'Servidor VPS',
        dato: 'El servidor VPS de produccion corre en Oracle Cloud con Ubuntu 24.04',
        categoria: 'servidores',
        tags: ['infraestructura', 'vps']
      }
    ];
    fs.writeFileSync(storePath, JSON.stringify(memories, null, 2), 'utf8');

    const resultsMem = await buscarMemoriaSemantica('Node.js TypeScript', {
      storePath,
      vectorsPath: corruptedVectorsPath,
      minScore: 0.05
    });

    assert(Array.isArray(resultsMem), 'buscarMemoriaSemantica must return an array');
    assert(resultsMem.length > 0, 'buscarMemoriaSemantica must recover and find matching memory');
    assertEqual(resultsMem[0].id, 'mem_1', 'Must match mem_1 with high relevance');
    assert(resultsMem[0].score > 0.1, 'Score must be positive');

    const repairedContent = fs.readFileSync(corruptedVectorsPath, 'utf8');
    const repairedParsed = JSON.parse(repairedContent);
    assert(Array.isArray(repairedParsed.vocabulary), 'Repaired file must have vocabulary array');
    assert(Array.isArray(repairedParsed.vectors), 'Repaired file must have vectors array');

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  await testAsync('1.3.3: buscarMemoriaSemantica returns empty array when both vector cache and store are corrupted', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'davis-rag-test-3-'));
    const corruptedVectorsPath = path.join(tmpDir, 'knowledge_vectors.json');
    const corruptedStorePath = path.join(tmpDir, 'brain_memory.json');

    fs.writeFileSync(corruptedVectorsPath, '{ broken vectors', 'utf8');
    fs.writeFileSync(corruptedStorePath, '{ broken store', 'utf8');

    const res = await buscarMemoriaSemantica('consulta cualquiera', {
      storePath: corruptedStorePath,
      vectorsPath: corruptedVectorsPath
    });

    assert(Array.isArray(res), 'Must return an array');
    assertEqual(res.length, 0, 'Must return empty array without crashing');

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // 1.4 Query with only Spanish stop words
  test('1.4.1: Query with only Spanish stop words ("de la en el por")', () => {
    const stopWordsQuery = 'de la en el por';
    const tokens = tokenizarTexto(stopWordsQuery);
    assertEqual(tokens.length, 0, 'tokenizarTexto must filter out all Spanish stop words');

    const norm = normalizarTexto(stopWordsQuery);
    assertEqual(norm, 'de la en el por', 'normalizarTexto preserves tokens for tokenization');
  });

  test('1.4.2: Uppercase, accented, and punctuation-surrounded Spanish stop words', () => {
    const complexStopQuery = '¡DE! ¿LA? *EN* (EL) -POR- mas sobre esta cuando';
    const tokens = tokenizarTexto(complexStopQuery);
    assertEqual(tokens.length, 0, 'Accented and punctuated Spanish stop words must all be filtered');
  });

  await testAsync('1.4.3: buscarMemoriaSemantica with only Spanish stop words returns empty array immediately', async () => {
    const memories = [
      { id: 'm1', sujeto: 'Test', dato: 'Dato de prueba con palabras normales' }
    ];

    const res = await buscarMemoriaSemantica('de la en el por y a los del se las un para con no una su al lo', {
      memorias: memories
    });

    assert(Array.isArray(res), 'Must return array');
    assertEqual(res.length, 0, 'Must return empty array when query has zero informative terms');
  });


  // ============================================================================
  // PART 2: PRE-SEND GUARDRAILS STRESS TESTING
  // ============================================================================
  console.log('\n--- PART 2: PRE-SEND GUARDRAILS STRESS TESTING ---');

  // 2.1 Complex adversarial emoji sequences
  test('2.1.1: Complex Fitzpatrick skin tone modifiers (Types 1-2 through 6)', () => {
    const inputWithSkinTones = 'Operacion completada \u{1F44F}\u{1F3FB} con exito \u{1F44D}\u{1F3FC} para el usuario \u{1F468}\u{1F3FD} y admin \u{1F9D1}\u{1F3FE} finalizado \u{1F44A}\u{1F3FF}.';

    const res = guardZeroEmojis(inputWithSkinTones);
    assert(res.huboCorreccion, 'Must detect and correct emojis with skin tones');
    assertNoEmojisInString(res.textoModificado, 'Skin tones test');
    assert(!res.textoModificado.includes('\u{1F3FB}'), 'Skin tone modifier U+1F3FB must not survive');
    assert(!res.textoModificado.includes('\u{1F3FF}'), 'Skin tone modifier U+1F3FF must not survive');
    assertEqual(res.textoModificado, 'Operacion completada con exito para el usuario y admin finalizado.', 'Text must be cleanly formatted');
  });

  test('2.1.2: Complex Zero-Width Joiner (ZWJ) sequences', () => {
    const family = '\u{1F468}\u200D\u{1F469}\u200D\u{1F467}\u200D\u{1F466}';
    const rainbowFlag = '\u{1F3F3}\uFE0F\u200D\u{1F308}';
    const technologist = '\u{1F9D1}\u{1F3FD}\u200D\u{1F4BB}';
    const polarBear = '\u{1F43B}\u200D\u2744\uFE0F';

    const adversarialText = `Reporte ${family} de estado ${rainbowFlag}: dev ${technologist} en region artica ${polarBear} completado.`;

    const res = guardZeroEmojis(adversarialText);
    assert(res.huboCorreccion, 'Must detect ZWJ sequences');
    assertNoEmojisInString(res.textoModificado, 'ZWJ sequences test');
    assert(!res.textoModificado.includes('\u200D'), 'Zero-width joiners must not survive');
    assertEqual(res.textoModificado, 'Reporte de estado: dev en region artica completado.', 'ZWJ emojis must be cleanly removed');
  });

  test('2.1.3: Variation Selectors (VS15/VS16) and Keycaps', () => {
    const keycap1 = '1\uFE0F\u20E3';
    const keycapHash = '#\uFE0F\u20E3';
    const heartEmoji = '\u2764\uFE0F';
    const heartText = '\u2764\uFE0E';

    const text = `Paso ${keycap1} presionar ${keycapHash} con amor ${heartEmoji} o ${heartText}.`;
    const res = guardZeroEmojis(text);
    assert(res.huboCorreccion, 'Must detect keycaps and variation selectors');
    assertNoEmojisInString(res.textoModificado, 'Keycaps and variation selectors');
    assert(!res.textoModificado.includes('\u20E3'), 'Combining enclosing keycap must be stripped');
    assert(!res.textoModificado.includes('\uFE0F'), 'VS16 must be stripped');
    assert(!res.textoModificado.includes('\uFE0E'), 'VS15 must be stripped');
  });

  test('2.1.4: Regional Indicator Pairs (Country Flags)', () => {
    const flags = 'Servidores en Espa\u00f1a \u{1F1EA}\u{1F1F8}, EE.UU. \u{1F1FA}\u{1F1F8} y Japon \u{1F1EF}\u{1F1F5}.';
    const res = guardZeroEmojis(flags);
    assert(res.huboCorreccion, 'Must detect regional indicator flag pairs');
    assertNoEmojisInString(res.textoModificado, 'Flags test');
    assertEqual(res.textoModificado, 'Servidores en Espa\u00f1a, EE.UU. y Japon.', 'Country flags must be cleanly stripped');
  });

  test('2.1.5: Emojis inside code fences vs regular text (preserves indentation & code syntax)', () => {
    const codeBlock = [
      'A continuacion el script \u{1F680}:',
      '```javascript',
      '// Servidor express \u{1F4BB}',
      'function startServer() {',
      '  const port = 3000; // Puerto \u{2705}',
      '  console.log("Iniciando...");',
      '}',
      '```',
      'Listo para produccion \u{1F44D}.'
    ].join('\n');

    const res = guardZeroEmojis(codeBlock);
    assert(res.huboCorreccion, 'Must detect emojis inside code fences');
    assertNoEmojisInString(res.textoModificado, 'Code fence emoji test');

    assert(res.textoModificado.includes('```javascript'), 'Must preserve code block open fence');
    assert(res.textoModificado.includes('  const port = 3000; // Puerto'), 'Must preserve code line indentation');
    assert(res.textoModificado.includes('Listo para produccion.'), 'Must format external text cleanly');
  });

  test('2.1.6: Emojis inside identifiers within code blocks', () => {
    const snippet = [
      '```javascript',
      'const test\u{1F680}Variable = 42;',
      'function run\u{2705}Check() {',
      '  return test\u{1F680}Variable > 0;',
      '}',
      '```'
    ].join('\n');

    const sanitized = guardZeroEmojis(snippet);
    assertNoEmojisInString(sanitized.textoModificado, 'Emojis inside identifiers');
    assert(sanitized.textoModificado.includes('testVariable = 42;'), 'Identifier must be stripped cleanly to valid JS');
    assert(sanitized.textoModificado.includes('function runCheck()'), 'Function identifier must be stripped cleanly to valid JS');

    const syntaxRes = guardCodeSyntax(sanitized.textoModificado);
    assert(syntaxRes.erroresNoCorregibles.length === 0, 'Stripped identifiers must form valid JS syntax');
  });

  test('2.1.7: Multi-glyph barrage (200 consecutive emojis)', () => {
    let barrage = '';
    for (let i = 0; i < 50; i++) {
      barrage += '\u{1F600}\u{1F680}\u{1F44D}\u{1F3FB}\u{1F9D1}\u200D\u{1F4BB}';
    }

    const res = guardZeroEmojis(barrage);
    assert(res.huboCorreccion, 'Must detect emoji barrage');
    assertNoEmojisInString(res.textoModificado, 'Emoji barrage');
    assertEqual(res.textoModificado, '', 'Pure emoji barrage must reduce to empty string');
  });

  // 2.2 Malformed JavaScript code snippets
  test('2.2.1: JavaScript unclosed brackets and parentheses auto-correction', () => {
    const unclosedJs = [
      '```javascript',
      "function test() { console.log('hi'",
      '```'
    ].join('\n');

    const res = guardCodeSyntax(unclosedJs);
    assert(res.huboCorreccion, 'Must auto-correct unclosed brackets');
    assertEqual(res.erroresNoCorregibles.length, 0, 'Must have zero uncorrectable errors');
    assert(res.textoModificado.includes("console.log('hi')"), 'Must close parentheses and quotes');
    assert(res.textoModificado.includes('}'), 'Must close curly brace');
  });

  test('2.2.2: JavaScript HTML entity decoding and correction inside function', () => {
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
    assert(res.huboCorreccion, 'Must auto-correct HTML entities in JS');
    assertEqual(res.erroresNoCorregibles.length, 0, 'Must resolve entities to valid JS without errors');
    assert(res.textoModificado.includes('if (x < 10 && y > 5) {'), 'Must decode < and && and >');
    assert(res.textoModificado.includes("return 'ok';"), 'Must decode &#39; to single quote');
  });

  test('2.2.3: Empirical behavior: JavaScript top-level return in markdown snippet', () => {
    // Markdown snippets from LLMs often lack an outer function wrapper: `if (x < 10) return 'ok';`
    const snippetWithTopLevelReturn = [
      '```javascript',
      "if (x &lt; 10 &amp;&amp; y &gt; 5) {",
      "  return &#39;ok&#39;;",
      "}",
      '```'
    ].join('\n');

    const res = guardCodeSyntax(snippetWithTopLevelReturn);
    // In standard node:vm Script, top-level return triggers SyntaxError: Illegal return statement
    const hasTopLevelReturnError = res.erroresNoCorregibles.some(
      (e) => e.error && e.error.includes('return')
    );
    const hasSafeAnnotation = res.textoModificado.includes('AVISO_SINTAXIS: Fragmento JS con error de sintaxis:');

    results.empiricalNotes.push({
      topic: 'JS_TOP_LEVEL_RETURN',
      note: 'vm.Script treats top-level return as Illegal return statement, triggering safe AVISO_SINTAXIS fallback annotation',
      hasSafeAnnotation
    });

    assert(hasSafeAnnotation || !res.erroresNoCorregibles.length, 'Top-level return snippet must be handled safely without crashing');
  });

  test('2.2.4: JavaScript ES Module syntax (import / export) compatibility in vm validator', () => {
    const esmCode = [
      '```javascript',
      "import path from 'node:path';",
      "import { fileURLToPath } from 'node:url';",
      "export const config = { port: 3000 };",
      "export default function run() { return config.port; }",
      '```'
    ].join('\n');

    const res = guardCodeSyntax(esmCode);
    assertEqual(res.erroresNoCorregibles.length, 0, 'ES Module syntax must be accepted as valid by vm validator');
    assert(res.textoModificado.includes('import path from'), 'Original import statement must be preserved in output');
    assert(res.textoModificado.includes('export default function'), 'Original export default must be preserved');
  });

  test('2.2.5: JavaScript unrecoverable syntax glitch (safe annotation with AVISO_SINTAXIS)', () => {
    const brokenJs = [
      '```javascript',
      'const = = = ;;;; return ?????',
      '```'
    ].join('\n');

    const res = guardCodeSyntax(brokenJs);
    assert(res.huboCorreccion, 'Must annotate unrecoverable JS syntax');
    assert(res.textoModificado.includes('AVISO_SINTAXIS: Fragmento JS con error de sintaxis:'), 'Must annotate with AVISO_SINTAXIS');
    assert(res.textoModificado.includes('const = = = ;;;; return ?????'), 'Must retain original snippet for debugging');
  });

  // 2.3 Malformed JSON code snippets
  test('2.3.1: JSON trailing commas auto-correction', () => {
    const jsonWithTrailing = [
      '```json',
      '{',
      '  "status": "ok",',
      '  "items": [1, 2, 3,],',
      '  "nested": { "a": true, },',
      '}',
      '```'
    ].join('\n');

    const res = guardCodeSyntax(jsonWithTrailing);
    assert(res.huboCorreccion, 'Must correct trailing commas in JSON');
    assertEqual(res.erroresNoCorregibles.length, 0, 'Must produce valid JSON');

    const match = res.textoModificado.match(/```json\n([\s\S]*?)```/);
    assert(match, 'Must contain json code block');
    const parsed = JSON.parse(match[1]);
    assertEqual(parsed.status, 'ok', 'Parsed status must match');
    assertEqual(parsed.items.length, 3, 'Parsed items length must be 3');
  });

  test('2.3.2: JSON Python literals (True, False, None) auto-correction', () => {
    const pyJson = [
      '```json',
      '{',
      '  "active": True,',
      '  "archived": False,',
      '  "metadata": None',
      '}',
      '```'
    ].join('\n');

    const res = guardCodeSyntax(pyJson);
    assert(res.huboCorreccion, 'Must correct Python literals in JSON');
    assertEqual(res.erroresNoCorregibles.length, 0, 'Must produce valid JSON');

    const match = res.textoModificado.match(/```json\n([\s\S]*?)```/);
    const parsed = JSON.parse(match[1]);
    assertEqual(parsed.active, true, 'True -> true');
    assertEqual(parsed.archived, false, 'False -> false');
    assertEqual(parsed.metadata, null, 'None -> null');
  });

  test('2.3.3: JSON single quotes and unquoted keys auto-correction', () => {
    const messyJson = [
      '```json',
      '{',
      "  name: 'David',",
      "  role: 'admin',",
      '  count: 42',
      '}',
      '```'
    ].join('\n');

    const res = guardCodeSyntax(messyJson);
    assert(res.huboCorreccion, 'Must correct unquoted keys and single quotes in JSON');
    assertEqual(res.erroresNoCorregibles.length, 0, 'Must produce valid JSON');

    const match = res.textoModificado.match(/```json\n([\s\S]*?)```/);
    const parsed = JSON.parse(match[1]);
    assertEqual(parsed.name, 'David', 'Key name must be quoted and value parsed');
    assertEqual(parsed.count, 42, 'Number 42 must be parsed');
  });

  test('2.3.4: JSON unclosed braces/brackets auto-balancing', () => {
    const unclosedJson = [
      '```json',
      '{"users": [{"id": 1, "name": "alice"}, {"id": 2, "name": "bob"',
      '```'
    ].join('\n');

    const res = guardCodeSyntax(unclosedJson);
    assert(res.huboCorreccion, 'Must auto-close unclosed JSON structures');
    assertEqual(res.erroresNoCorregibles.length, 0, 'Must balance brackets and braces');

    const match = res.textoModificado.match(/```json\n([\s\S]*?)```/);
    const parsed = JSON.parse(match[1]);
    assertEqual(parsed.users.length, 2, 'Must balance to 2 users');
    assertEqual(parsed.users[1].name, 'bob', 'Must preserve bob');
  });

  test('2.3.5: JSON completely unrecoverable garbage (safe annotation)', () => {
    const garbageJson = [
      '```json',
      '{{{{ ::: not a json :::',
      '```'
    ].join('\n');

    const res = guardCodeSyntax(garbageJson);
    assert(res.huboCorreccion, 'Must annotate unrecoverable JSON');
    assert(res.textoModificado.includes('AVISO_SINTAXIS: JSON con error no corregible:'), 'Must annotate with AVISO_SINTAXIS');
  });

  // 2.4 Hallucination checks & Unverified phone numbers
  test('2.4.1: Positive action claims without tool execution: "he transferido 500 euros"', () => {
    const text = 'Operacion realizada: he transferido 500 euros a la cuenta indicada.';
    const contexto = {
      traza: { llamadas: [] }
    };

    const res = guardHallucinations(text, contexto);
    assert(res.huboCorreccion, 'Must detect ungrounded financial transfer claim');
    assert(res.correcciones.includes('UNGOUNDED_ACTION_CLAIM_TRANSFERENCIA_FONDOS'), 'Must record correction code');
    assert(!res.textoModificado.includes('he transferido'), 'Must not claim transfer occurred');
    assert(res.textoModificado.includes('no se ha realizado ninguna transferencia de fondos'), 'Must amend with truthful disclaimer');
  });

  test('2.4.2: Empirical vulnerability check: "he borrado la base de datos" vs "he borrado el archivo"', () => {
    // Sub-case A: "he borrado el archivo"
    const textA = 'Listo, he borrado el archivo confidencial.';
    const resA = guardHallucinations(textA, { traza: { llamadas: [] } });
    assert(resA.huboCorreccion, 'Must detect ungrounded file deletion claim');
    assert(!resA.textoModificado.includes('he borrado el archivo'), 'Must amend file deletion claim');

    // Sub-case B: "he borrado la base de datos" (Exact prompt query)
    const textB = 'Atencion: he borrado la base de datos de usuarios.';
    const resB = guardHallucinations(textB, { traza: { llamadas: [] } });
    const caughtDatabaseDeletion = resB.huboCorreccion && !resB.textoModificado.includes('he borrado la base de datos');

    results.empiricalNotes.push({
      topic: 'VULNERABILITY_UNCAUGHT_CLAIM_DATABASE_DELETION',
      claim: 'he borrado la base de datos',
      caught: caughtDatabaseDeletion,
      detail: 'reglasAccionesCriticas only patterns "el archivo" or "la memoria". "la base de datos" escapes detection uncorrected.'
    });

    console.log(`    [EMPIRICAL NOTE] Claim "he borrado la base de datos" caught by regex: ${caughtDatabaseDeletion}`);
  });

  test('2.4.3: Grounded action claim when tool WAS executed successfully in trace', () => {
    const text = 'Confirmado: he creado el commit en el repositorio.';
    const contexto = {
      traza: {
        llamadas: [
          {
            nombre: 'crear_commit',
            ok: true,
            resultado: 'ok'
          }
        ]
      }
    };

    const res = guardHallucinations(text, contexto);
    assert(!res.huboCorreccion, 'Grounded claim must NOT be modified');
    assertEqual(res.textoModificado, text, 'Text must remain intact when tool succeeded');
  });

  test('2.4.4: Ungrounded action claim when tool FAILED in trace', () => {
    const text = 'Confirmado: he creado el commit en el repositorio.';
    const contexto = {
      traza: {
        llamadas: [
          {
            nombre: 'crear_commit',
            ok: false,
            error: 'EACCES: permission denied'
          }
        ]
      }
    };

    const res = guardHallucinations(text, contexto);
    assert(res.huboCorreccion, 'Must neutralize claim when tool call failed');
    assert(!res.textoModificado.includes('he creado el commit'), 'Must remove positive claim');
  });

  test('2.4.5: Unverified international phone numbers with known context contacts', () => {
    const text = 'Contacta con soporte al +14155552671 o al +447911123456 para mas detalles.';
    const contexto = {
      destinatario: '+34600112233',
      contactosConocidos: [
        { nombre: 'David', telefono: '+34600112233' }
      ]
    };

    const res = guardHallucinations(text, contexto);
    assert(res.huboCorreccion, 'Must replace unverified phone numbers when known context exists');
    assert(!res.textoModificado.includes('+14155552671'), 'US phone number must be redacted');
    assert(!res.textoModificado.includes('+447911123456'), 'UK phone number must be redacted');
    assert(res.textoModificado.includes('[NUMERO_NO_VERIFICADO]'), 'Must replace with [NUMERO_NO_VERIFICADO]');
  });

  test('2.4.6: Verified phone numbers from tool trace arguments remain untouched', () => {
    const text = 'Mensaje enviado a +34655443322 con exito.';
    const contexto = {
      destinatario: '+34600112233',
      traza: {
        llamadas: [
          {
            nombre: 'enviar_mensaje',
            args: { numero: '+34655443322' },
            ok: true
          }
        ]
      }
    };

    const res = guardHallucinations(text, contexto);
    assert(!res.huboCorreccion, 'Verified phone number from tool arguments must not be flagged');
    assertEqual(res.textoModificado, text, 'Text must remain untouched');
  });

  test('2.4.7: Timestamps are not misidentified as phone numbers', () => {
    const text = 'Registro completado en timestamp 20261107123045 con ID de sesion.';
    const contexto = {
      destinatario: '+34600112233'
    };

    const res = guardHallucinations(text, contexto);
    assert(!res.huboCorreccion, 'ISO/numeric timestamps starting with 2026 must not be redacted');
    assert(res.textoModificado.includes('20261107123045'), 'Timestamp must be preserved');
  });

  // 2.5 End-to-end multi-vector pre-send guardrail validation
  test('2.5.1: Full pipeline validarMensajeSalida: multi-vector adversarial attack', () => {
    const attackPayload = [
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

    const res = validarMensajeSalida(attackPayload, contexto);

    assertEqual(res.bloqueado, false, 'Message should not be critically blocked if cleanly sanitized');
    assertEqual(res.valido, true, 'Message should be valid after auto-corrections');
    assertNoEmojisInString(res.textoFinal, 'Full pipeline output');

    assert(res.correccionesAplicadas.includes('REMOVED_EMOJI'), 'Must record REMOVED_EMOJI');
    assert(res.correccionesAplicadas.includes('CORRECTED_CODE_SYNTAX'), 'Must record CORRECTED_CODE_SYNTAX');
    assert(res.correccionesAplicadas.includes('CORRECTED_HALLUCINATION'), 'Must record CORRECTED_HALLUCINATION');

    assert(!res.textoFinal.includes('he transferido'), 'Transfer claim must be neutralized');
    assert(!res.textoFinal.includes('+19998887776'), 'Unverified phone must be neutralized');
    assert(res.textoFinal.includes('[NUMERO_NO_VERIFICADO]'), 'Must replace unverified number');
  });

  // Summary
  console.log('\n================================================================');
  console.log(` RESULTS SUMMARY: ${results.passed}/${results.total} passed (${results.failed} failed)`);
  console.log('================================================================');

  if (results.empiricalNotes.length > 0) {
    console.log('\nEMPIRICAL ADVERSARIAL NOTES:');
    for (const note of results.empiricalNotes) {
      console.log(`- [${note.topic}] ${note.note || note.detail}`);
    }
  }

  if (results.failed > 0) {
    console.error('\nFAILED TESTS DETAILS:');
    for (const f of results.findings) {
      console.error(`- ${f.test}: ${f.error}`);
    }
  }

  process.exit(results.failed > 0 ? 1 : 0);
}

runAdversarialHarness().catch((err) => {
  console.error('[FATAL] Harness crashed:', err);
  process.exit(1);
});
