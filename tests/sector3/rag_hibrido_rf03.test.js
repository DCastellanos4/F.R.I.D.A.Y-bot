/**
 * rag_hibrido_rf03.test.js - Pruebas aisladas del bloque RF-03 (RAG hibrido).
 *
 * Cobertura:
 *  1. RRF k=60: matematica exacta, empates deterministas, duplicados.
 *  2. Pipeline hibrido extremo a extremo con almacen dev + FTS5 real +
 *     embeddings falsos + reranker stub: fusion de canales, procedencia,
 *     scores en [0,1], exclusion de credenciales, aislamiento por tenant.
 *  3. Adaptador FTS5: ranking BM25 real, diacriticos, aislamiento tenant.
 *  4. Adaptador Qdrant: formas de peticion REST con fetch stub (coleccion
 *     por tenant, UUID determinista, defensa de dimensionalidad). SIN
 *     servidor real: esto NO certifica el motor industrial.
 *  5. Adaptador Ollama embeddings con cliente stub (sin Ollama real).
 *  6. Honestidad de etiquetas: dev/passthrough nunca se declara calibrado
 *     ni cumpleRf03.
 *
 * Todo es aislado: directorios temporales propios, cero red, cero
 * generaciones reales, cero datos de produccion.
 *
 * Strict Policy: Zero Emojis.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';

import { fusionarRRF } from '../../src/core/rag/reciprocalRankFusion.js';
import { crearHybridRetrievalService } from '../../src/core/rag/hybridRetrievalService.js';
import { crearDevLocalVectorStoreAdapter } from '../../src/adapters/outbound/vectorstores/devLocalVectorStoreAdapter.js';
import { crearSqliteFts5SparseAdapter } from '../../src/adapters/outbound/retrieval/sqliteFts5SparseAdapter.js';
import { crearQdrantVectorStoreAdapter, idAUuid } from '../../src/adapters/outbound/vectorstores/qdrantVectorStoreAdapter.js';
import { crearOllamaEmbeddingAdapter } from '../../src/adapters/outbound/embeddings/ollamaEmbeddingAdapter.js';
import { crearRerankerPassthrough } from '../../src/adapters/outbound/rerankers/httpCrossEncoderRerankerAdapter.js';
import { esDocumentoSensibleRag } from '../../src/services/semanticMemoryService.js';

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'davis-rf03-'));
}

// Proveedor de embeddings deterministico de pruebas: 3 dimensiones,
// vectores base por termino. NO es un modelo: solo da geometria estable.
function crearEmbeddingsFalsos() {
  const vectorDe = (texto) => {
    const t = String(texto).toLowerCase();
    if (t.includes('gato')) return [1, 0, 0];
    if (t.includes('renfe') || t.includes('tren')) return [0, 1, 0];
    return [0.1, 0.1, 0.9];
  };
  return {
    id: 'fake-test',
    esReal: false,
    dimensiones: () => 3,
    embeber: async (textos) => textos.map(vectorDe)
  };
}

function crearHibridoPrueba({ reranker, esIndexable } = {}) {
  const dir = tmpDir();
  return {
    dir,
    hibrido: crearHybridRetrievalService({
      embeddings: crearEmbeddingsFalsos(),
      vectorStore: crearDevLocalVectorStoreAdapter({ carpetaPersistencia: dir }),
      sparseIndex: crearSqliteFts5SparseAdapter({ db: new Database(':memory:') }),
      reranker,
      esIndexable
    })
  };
}

// ---------- 1. RRF ----------

test('RRF k=60: valores exactos y orden por rangos', () => {
  const fusion = fusionarRRF([
    { canal: 'denso', resultados: [{ id: 'a' }, { id: 'b' }] },
    { canal: 'disperso', resultados: [{ id: 'b' }, { id: 'c' }] }
  ]);
  assert.equal(fusion.length, 3);
  assert.equal(fusion[0].id, 'b'); // unico presente en ambos canales
  const esperadoB = Math.round((1 / 62 + 1 / 61) * 1e9) / 1e9;
  assert.equal(fusion[0].scoreRrf, esperadoB);
  assert.deepEqual(fusion[0].canales.sort(), ['denso', 'disperso']);
  assert.deepEqual(fusion[0].rangos, { denso: 2, disperso: 1 });
});

test('RRF: duplicados dentro de una lista no puntuan dos veces y empates son deterministas', () => {
  const fusion = fusionarRRF([
    { canal: 'x', resultados: [{ id: 'a' }, { id: 'a' }, { id: 'b' }] }
  ]);
  assert.equal(fusion.find((f) => f.id === 'a').rangos.x, 1);
  assert.equal(fusion.find((f) => f.id === 'b').rangos.x, 2);
  const fusion2 = fusionarRRF([{ canal: 'x', resultados: [{ id: 'b' }, { id: 'a' }] }]);
  // mismas posiciones invertidas -> mismo orden de salida que la inversa: b antes que a
  assert.equal(fusion2[0].id, 'b');
});

// ---------- 2. Pipeline hibrido ----------

const CORPUS = [
  { id: 'm1', sujeto: 'mascota', dato: 'al gato le gusta dormir en el sofa', categoria: 'personal', tags: [] },
  { id: 'm2', sujeto: 'compra', dato: 'comprar pienso y arena el sabado', categoria: 'tareas', tags: [] },
  { id: 'm3', sujeto: 'tren', dato: 'el renfe de las ocho llega a atocha', categoria: 'transporte', tags: [] }
];

test('hibrido: fusiona canal denso y disperso con procedencia declarada', async () => {
  const reranker = {
    id: 'stub-real',
    esReal: true,
    reordenar: async (consulta, docs) => docs.map((d) => ({ id: d.id, score: d.texto.includes('pienso') ? 0.91 : 0.2 }))
  };
  const { hibrido } = crearHibridoPrueba({ reranker });
  const r = await hibrido.indexar('propietario', CORPUS);
  assert.deepEqual(r, { ok: true, total: 3, omitidos: 0 });

  // "gato" solo lo capta el denso (parrafo sin termino exacto de la consulta
  // distinto); "pienso" es termino exacto: lo capta el disperso.
  const resultados = await hibrido.buscar('propietario', 'gato pienso', { topK: 3 });
  assert.ok(resultados.length >= 2);
  const porId = new Map(resultados.map((x) => [x.id, x]));
  assert.ok(porId.get('m1').canales.includes('denso'), 'm1 vino del canal denso');
  assert.ok(porId.get('m2').canales.includes('disperso'), 'm2 vino del canal disperso');
  assert.equal(porId.get('m2').rerankeado, true);
  assert.equal(porId.get('m2').calibrado, true);
  for (const x of resultados) {
    assert.ok(x.score >= 0 && x.score <= 1, `score en [0,1]: ${x.score}`);
  }
  assert.equal(resultados[0].id, 'm2'); // el reranker lo sube al frente
});

test('hibrido: las credenciales (categoria clave) nunca entran en ningun canal', async () => {
  const { hibrido } = crearHibridoPrueba({ esIndexable: (doc) => !esDocumentoSensibleRag(doc) });
  const r = await hibrido.indexar('propietario', [
    ...CORPUS,
    { id: 'sec1', sujeto: 'banco', dato: 'la clave del banco gato pienso', categoria: 'clave', tags: [] }
  ]);
  assert.equal(r.total, 3);
  assert.equal(r.omitidos, 1);
  const resultados = await hibrido.buscar('propietario', 'clave banco gato pienso', { topK: 10 });
  assert.ok(!resultados.some((x) => x.id === 'sec1'), 'la credencial no sale por el camino hibrido');
  const conteo = await hibrido.contar('propietario');
  assert.deepEqual(conteo, { denso: 3, disperso: 3 });
});

test('hibrido: aislamiento por tenant en ambos canales', async () => {
  const { hibrido } = crearHibridoPrueba();
  await hibrido.indexar('propietario', CORPUS);
  await hibrido.indexar('tenant_a', [{ id: 'x1', sujeto: 'gato', dato: 'el gato del tenant a', categoria: 'personal', tags: [] }]);

  const delTenantA = await hibrido.buscar('tenant_a', 'gato sofa pienso', { topK: 10 });
  assert.ok(delTenantA.every((x) => x.id === 'x1'), 'tenant_a no ve memorias del propietario');
  const delPropietario = await hibrido.buscar('propietario', 'gato', { topK: 10 });
  assert.ok(!delPropietario.some((x) => x.id === 'x1'), 'el propietario no ve memorias de tenant_a');
  assert.deepEqual(await hibrido.contar('tenant_a'), { denso: 1, disperso: 1 });

  await assert.rejects(() => hibrido.contar('TENANT MALO'), TypeError);
  await assert.rejects(() => hibrido.buscar('', 'gato'), TypeError);
});

test('hibrido: sin reranker el orden es RRF y calibrado=false; passthrough tampoco calibra', async () => {
  const { hibrido: sinReranker } = crearHibridoPrueba();
  await sinReranker.indexar('propietario', CORPUS);
  const r1 = await sinReranker.buscar('propietario', 'gato', { topK: 3 });
  assert.ok(r1.length > 0);
  assert.ok(r1.every((x) => x.calibrado === false && x.rerankeado === false));

  const { hibrido: conPassthrough } = crearHibridoPrueba({ reranker: crearRerankerPassthrough() });
  await conPassthrough.indexar('propietario', CORPUS);
  const r2 = await conPassthrough.buscar('propietario', 'gato', { topK: 3 });
  assert.ok(r2.every((x) => x.calibrado === false), 'passthrough jamas declara calibrado');
});

test('hibrido: consulta vacia y corpus vacio devuelven [] sin explotar', async () => {
  const { hibrido } = crearHibridoPrueba();
  assert.deepEqual(await hibrido.buscar('propietario', 'gato'), []);
  await hibrido.indexar('propietario', CORPUS);
  assert.deepEqual(await hibrido.buscar('propietario', '   '), []);
  assert.deepEqual(await hibrido.buscar('propietario', ''), []);
});

test('hibrido: borrar elimina de ambos canales', async () => {
  const { hibrido } = crearHibridoPrueba();
  await hibrido.indexar('propietario', CORPUS);
  await hibrido.borrar('propietario', ['m1']);
  assert.deepEqual(await hibrido.contar('propietario'), { denso: 2, disperso: 2 });
  const r = await hibrido.buscar('propietario', 'gato sofa', { topK: 10 });
  assert.ok(!r.some((x) => x.id === 'm1'));
});

test('hibrido: etiquetaMotores declara dev/passthrough no listo y certificacion siempre no-evaluada', async () => {
  const { hibrido } = crearHibridoPrueba({ reranker: crearRerankerPassthrough() });
  const etiquetas = hibrido.etiquetaMotores();
  assert.equal(etiquetas.vector.esIndustrial, false);
  assert.equal(etiquetas.disperso.esIndustrial, true);
  assert.equal(etiquetas.reranker.esReal, false);
  assert.equal(etiquetas.embeddings.esReal, false);
  assert.equal(etiquetas.motoresListosParaCertificacion, false);
  assert.equal(etiquetas.certificacionRf03, 'no-evaluada');
  assert.ok(!('cumpleRf03' in etiquetas), 'la bandera cumpleRf03 ya no existe: el servicio no se auto-certifica');
});

test('hibrido: rechaza un proveedor de embeddings con dimensionalidad inconsistente', async () => {
  const dir = tmpDir();
  const hibrido = crearHybridRetrievalService({
    embeddings: {
      id: 'roto',
      esReal: false,
      dimensiones: () => 4,
      embeber: async (textos) => textos.map(() => [1, 0, 0]) // 3 en vez de 4
    },
    vectorStore: crearDevLocalVectorStoreAdapter({ carpetaPersistencia: dir }),
    sparseIndex: crearSqliteFts5SparseAdapter({ db: new Database(':memory:') })
  });
  await assert.rejects(() => hibrido.indexar('propietario', CORPUS), /dimensiones/);
});

// ---------- 3. FTS5 / BM25 ----------

test('fts5: ranking BM25 real, diacriticos y aislamiento por tenant', async () => {
  const sparse = crearSqliteFts5SparseAdapter({ db: new Database(':memory:') });
  await sparse.indexar('propietario', [
    { id: 'a', texto: 'el camion de reparto llega el martes' },
    { id: 'b', texto: 'camion camion camion' },
    { id: 'c', texto: 'nada que ver con vehiculos' }
  ]);
  const r = await sparse.buscar('propietario', 'camión', 10); // con tilde
  assert.ok(r.length >= 2, 'el diacritico no rompe la consulta');
  assert.ok(r.every((x) => x.id !== 'c'));
  assert.ok(r[0].scoreBm25 <= r[1].scoreBm25, 'bm25 ordenado de mejor a peor');

  await sparse.indexar('tenant_b', [{ id: 'a', texto: 'el camion del tenant b' }]);
  const soloB = await sparse.buscar('tenant_b', 'camion', 10);
  assert.deepEqual(soloB.map((x) => x.id), ['a']);
  assert.equal(await sparse.contar('tenant_b'), 1);
  assert.equal(await sparse.contar('propietario'), 3);

  await sparse.borrar('propietario', ['a']);
  assert.equal(await sparse.contar('propietario'), 2);
  assert.deepEqual(await sparse.buscar('propietario', '!!!', 10), []);
});

test('fts5: upsert sustituye sin duplicar', async () => {
  const sparse = crearSqliteFts5SparseAdapter({ db: new Database(':memory:') });
  await sparse.indexar('propietario', [{ id: 'a', texto: 'version uno del dato' }]);
  await sparse.indexar('propietario', [{ id: 'a', texto: 'version dos del dato' }]);
  assert.equal(await sparse.contar('propietario'), 1);
  const r = await sparse.buscar('propietario', 'version dos', 10);
  assert.equal(r.length, 1);
});

// ---------- 4. Qdrant (fetch stub, sin servidor) ----------

function crearFetchStubQdrant() {
  const llamadas = [];
  const colecciones = new Set();
  const fetchStub = async (url, init = {}) => {
    const metodo = init.method || 'GET';
    llamadas.push({ metodo, url, cuerpo: init.body ? JSON.parse(init.body) : undefined });
    const u = new URL(url);
    const mColeccion = u.pathname.match(/^\/collections\/([^/]+)$/);
    const ok = (payload) => ({ ok: true, status: 200, json: async () => payload, text: async () => JSON.stringify(payload) });
    if (metodo === 'GET' && mColeccion && !colecciones.has(mColeccion[1])) {
      return { ok: false, status: 404, json: async () => ({}), text: async () => 'not found' };
    }
    if (metodo === 'PUT' && mColeccion) {
      colecciones.add(mColeccion[1]);
      return ok({ result: true });
    }
    if (metodo === 'PUT' && u.pathname.endsWith('/points')) return ok({ result: { status: 'completed' } });
    if (metodo === 'POST' && u.pathname.endsWith('/points/search')) {
      return ok({ result: [{ id: 'uuid-x', score: 0.88, payload: { doc_id: 'm1', texto: 'texto m1' } }] });
    }
    if (metodo === 'POST' && u.pathname.endsWith('/points/count')) return ok({ result: { count: 2 } });
    if (metodo === 'POST' && u.pathname.endsWith('/points/delete')) return ok({ result: { status: 'completed' } });
    throw new Error(`fetch stub: ruta no prevista ${metodo} ${u.pathname}`);
  };
  return { llamadas, fetchStub };
}

test('qdrant: coleccion por tenant, upsert con UUID determinista y defensa de dimensionalidad', async () => {
  const { llamadas, fetchStub } = crearFetchStubQdrant();
  const store = crearQdrantVectorStoreAdapter({ url: 'http://127.0.0.1:6333', dimensiones: 3, fetchImpl: fetchStub });

  const uuid1 = idAUuid('m1');
  assert.match(uuid1, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  assert.equal(uuid1, idAUuid('m1'));
  assert.notEqual(uuid1, idAUuid('m2'));

  await store.indexar('propietario', [{ id: 'm1', texto: 'hola', vector: [1, 0, 0] }]);
  await store.indexar('tenant_a', [{ id: 'm1', texto: 'hola', vector: [1, 0, 0] }]);

  const putsColeccion = llamadas.filter((l) => l.metodo === 'PUT' && /\/collections\/[^/]+$/.test(new URL(l.url).pathname));
  assert.deepEqual(
    putsColeccion.map((l) => new URL(l.url).pathname).sort(),
    ['/collections/davis_memorias_propietario', '/collections/davis_memorias_tenant_a']
  );
  assert.equal(putsColeccion[0].cuerpo.vectors.size, 3);
  assert.equal(putsColeccion[0].cuerpo.vectors.distance, 'Cosine');

  const upsert = llamadas.find((l) => l.metodo === 'PUT' && l.url.includes('/points'));
  assert.equal(upsert.cuerpo.points[0].id, uuid1);
  assert.equal(upsert.cuerpo.points[0].payload.doc_id, 'm1');

  const encontrados = await store.buscarDenso('propietario', [1, 0, 0], 5);
  assert.equal(encontrados[0].id, 'm1');
  assert.equal(encontrados[0].texto, 'texto m1');
  assert.equal(encontrados[0].score, 0.88);

  assert.equal(await store.contar('propietario'), 2);
  await store.borrar('propietario', ['m1']);
  const borrado = llamadas.find((l) => l.url.includes('/points/delete'));
  assert.equal(borrado.cuerpo.points[0], uuid1);

  assert.equal(store.motor, 'qdrant');
  assert.equal(store.esIndustrial, true);
});

test('qdrant: envia la cabecera api-key cuando esta configurada', async () => {
  const llamadasCapturadas = [];
  const fetchStub = async (url, init = {}) => {
    llamadasCapturadas.push({ url, init });
    return { ok: true, status: 200, json: async () => ({ result: { count: 0 } }), text: async () => '{}' };
  };
  const store = crearQdrantVectorStoreAdapter({ url: 'http://127.0.0.1:6333', dimensiones: 3, apiKey: 'clave-prueba', fetchImpl: fetchStub });
  // La coleccion no existe (el stub no devuelve 404, asi que asegurarColeccion
  // lee estado sin size y sigue); lo que importa es la cabecera.
  await store.contar('tenant_a');
  assert.ok(llamadasCapturadas.length >= 1);
  for (const l of llamadasCapturadas) {
    assert.equal(l.init.headers['api-key'], 'clave-prueba');
  }
});

test('qdrant: url o dimensiones ausentes son error en claro', () => {
  assert.throws(() => crearQdrantVectorStoreAdapter({ dimensiones: 3 }), TypeError);
  assert.throws(() => crearQdrantVectorStoreAdapter({ url: 'http://x:6333' }), TypeError);
});

// ---------- 5. Ollama embeddings (cliente stub) ----------

test('ollama embeddings: orden preservado y defensa de dimensionalidad', async () => {
  const cliente = {
    embed: async ({ model, input }) => {
      assert.equal(model, 'bge-m3');
      return { embeddings: input.map((_, i) => Array.from({ length: 1024 }, (v, j) => (j === 0 ? i : 0))) };
    }
  };
  const adapter = crearOllamaEmbeddingAdapter({ modelo: 'bge-m3', cliente });
  const vectores = await adapter.embeber(['uno', 'dos']);
  assert.equal(vectores.length, 2);
  assert.equal(vectores[1][0], 1); // mismo orden que la entrada
  assert.equal(adapter.dimensiones(), 1024); // conocido de bge-m3
  assert.equal(adapter.id, 'ollama:bge-m3');
  assert.equal(adapter.esReal, true);
  assert.deepEqual(await adapter.embeber([]), []);

  const clienteRoto = { embed: async ({ input }) => ({ embeddings: input.map(() => [1, 2]) }) };
  const adapterRoto = crearOllamaEmbeddingAdapter({ modelo: 'bge-m3', cliente: clienteRoto });
  await assert.rejects(() => adapterRoto.embeber(['x']), /dimensiones/);
});

// ---------- 5b. Reranker HTTP (fetch stub, contrato TEI) ----------

test('reranker http: pide raw_scores=false y truncate=true, y no re-aplica sigmoide por defecto', async () => {
  const { crearHttpCrossEncoderReranker } = await import('../../src/adapters/outbound/rerankers/httpCrossEncoderRerankerAdapter.js');
  let cuerpoVisto = null;
  const fetchStub = async (url, init = {}) => {
    cuerpoVisto = JSON.parse(init.body);
    return { ok: true, status: 200, json: async () => ([{ index: 1, score: 0.83 }, { index: 0, score: 0.12 }]), text: async () => '' };
  };
  const reranker = crearHttpCrossEncoderReranker({ url: 'http://127.0.0.1:8080', fetchImpl: fetchStub });
  assert.equal(reranker.esReal, true);
  const r = await reranker.reordenar('consulta', [{ id: 'a', texto: 't0' }, { id: 'b', texto: 't1' }]);
  assert.equal(cuerpoVisto.raw_scores, false);
  assert.equal(cuerpoVisto.truncate, true);
  assert.deepEqual(cuerpoVisto.texts, ['t0', 't1']);
  // El score de TEI ya es probabilidad: pasa tal cual, sin doble sigmoide.
  assert.equal(r.find((x) => x.id === 'b').score, 0.83);
  assert.equal(r.find((x) => x.id === 'a').score, 0.12);
});

test('reranker http: con aplicarSigmoide pide logits crudos y los convierte', async () => {
  const { crearHttpCrossEncoderReranker } = await import('../../src/adapters/outbound/rerankers/httpCrossEncoderRerankerAdapter.js');
  let cuerpoVisto = null;
  const fetchStub = async (url, init = {}) => {
    cuerpoVisto = JSON.parse(init.body);
    return { ok: true, status: 200, json: async () => ([{ index: 0, score: 0 }]), text: async () => '' };
  };
  const reranker = crearHttpCrossEncoderReranker({ url: 'http://127.0.0.1:8080', aplicarSigmoide: true, fetchImpl: fetchStub });
  const r = await reranker.reordenar('consulta', [{ id: 'a', texto: 't0' }]);
  assert.equal(cuerpoVisto.raw_scores, true);
  assert.equal(r[0].score, 0.5); // sigmoide(0)
});

test('reranker http: sin url devuelve null (desactivado declarado)', async () => {
  const { crearHttpCrossEncoderReranker } = await import('../../src/adapters/outbound/rerankers/httpCrossEncoderRerankerAdapter.js');
  assert.equal(crearHttpCrossEncoderReranker({ url: '' }), null);
});

// ---------- 6. Contratos de puertos ----------

test('puertos: las factorias rechazan objetos incompletos', async () => {
  const { afirmarEmbeddingProvider } = await import('../../src/ports/outbound/EmbeddingProviderPort.js');
  const { afirmarVectorStore } = await import('../../src/ports/outbound/VectorStorePort.js');
  const { afirmarSparseIndex } = await import('../../src/ports/outbound/SparseIndexPort.js');
  const { afirmarReranker } = await import('../../src/ports/outbound/RerankerPort.js');
  assert.throws(() => afirmarEmbeddingProvider({ id: 'x' }), TypeError);
  assert.throws(() => afirmarVectorStore({ motor: 'x', esIndustrial: true }), TypeError);
  assert.throws(() => afirmarSparseIndex({ motor: 'x', esIndustrial: true }), TypeError);
  assert.throws(() => afirmarReranker({ id: 'x', esReal: true }), TypeError);
});
