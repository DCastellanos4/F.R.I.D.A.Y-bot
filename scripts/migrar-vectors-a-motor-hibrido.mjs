/**
 * migrar-vectors-a-motor-hibrido.mjs - Migracion PREPARADA de las memorias
 * del Second Brain al motor RAG hibrido (RF-03).
 *
 * Por que re-embed y no copia de knowledge_vectors.json: ese archivo
 * contiene vectores TF-IDF dispersos, incompatibles con embeddings
 * densos. La migracion lee las MEMORIAS FUENTE (SQLite memorias o, en su
 * defecto, brain_memory.json) y genera embeddings nuevos con el proveedor
 * configurado. knowledge_vectors.json NO se toca ni se borra: el camino
 * historico sigue intacto y la migracion es reversible (ver --revertir).
 *
 * Uso:
 *   node scripts/migrar-vectors-a-motor-hibrido.mjs            # DRY-RUN (defecto): lee, filtra y resume; NO escribe en ningun motor
 *   node scripts/migrar-vectors-a-motor-hibrido.mjs --aplicar  # re-embed real + upsert en Qdrant y FTS5
 *   node scripts/migrar-vectors-a-motor-hibrido.mjs --revertir # borra SOLO los artefactos nuevos (colecciones del tenant y rag_sparse.db)
 *
 * Configuracion (entorno):
 *   DAVIS_SQLITE_PATH        (defecto data/jarvis.db; fuente primaria)
 *   DAVIS_DATA_DIR           (defecto data)
 *   QDRANT_URL               (obligatoria con --aplicar; ej. http://127.0.0.1:6333)
 *   DAVIS_EMBEDDING_MODEL    (defecto bge-m3)
 *   OLLAMA_HOST              (defecto http://127.0.0.1:11434)
 *   DAVIS_EMBEDDING_DIMS     (defecto segun modelo conocido)
 *   DAVIS_RAG_SPARSE_DB      (defecto <dataDir>/rag_sparse.db)
 *   DAVIS_RAG_TENANT         (defecto 'propietario'; la migracion inicial solo cubre su corpus)
 *
 * Strict Policy: Zero Emojis.
 */
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { esDocumentoSensibleRag } from '../src/services/semanticMemoryService.js';
import { afirmarTenantId, TENANT_PROPIETARIO } from '../src/core/tenancy.js';
import { crearOllamaEmbeddingAdapter } from '../src/adapters/outbound/embeddings/ollamaEmbeddingAdapter.js';
import { crearQdrantVectorStoreAdapter } from '../src/adapters/outbound/vectorstores/qdrantVectorStoreAdapter.js';
import { crearSqliteFts5SparseAdapter } from '../src/adapters/outbound/retrieval/sqliteFts5SparseAdapter.js';
import { crearHybridRetrievalService } from '../src/core/rag/hybridRetrievalService.js';

const args = new Set(process.argv.slice(2));
const APLICAR = args.has('--aplicar');
const REVERTIR = args.has('--revertir');

const dataDir = process.env.DAVIS_DATA_DIR || 'data';
const rutaSqlite = process.env.DAVIS_SQLITE_PATH || path.join(dataDir, 'jarvis.db');
const rutaJson = path.join(dataDir, 'brain_memory.json');
const rutaSparse = process.env.DAVIS_RAG_SPARSE_DB || path.join(dataDir, 'rag_sparse.db');
const rutaManifiesto = path.join(dataDir, 'rag_migracion_manifiesto.json');
const tenant = afirmarTenantId(process.env.DAVIS_RAG_TENANT || TENANT_PROPIETARIO);
const prefijoColeccion = 'davis_memorias';

function leerMemoriasFuente() {
  if (fs.existsSync(rutaSqlite)) {
    const db = new Database(rutaSqlite, { readonly: true, fileMustExist: true });
    try {
      const tablas = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='memorias'").all();
      if (tablas.length > 0) {
        const filas = db.prepare("SELECT id, sujeto, dato, categoria, tags, cifrado FROM memorias WHERE tenant_id = ?").all(tenant);
        const cifradas = filas.filter((f) => f.cifrado).length;
        const legibles = filas.filter((f) => !f.cifrado).map(({ cifrado, ...resto }) => ({ ...resto, tags: JSON.parse(resto.tags || '[]') }));
        return { origen: rutaSqlite, memorias: legibles, cifradas };
      }
    } finally {
      db.close();
    }
  }
  if (fs.existsSync(rutaJson)) {
    const crudo = JSON.parse(fs.readFileSync(rutaJson, 'utf8'));
    return { origen: rutaJson, memorias: Array.isArray(crudo) ? crudo : [] };
  }
  return { origen: null, memorias: [] };
}

async function main() {
  if (REVERTIR) {
    // Reversible de verdad: solo se eliminan artefactos NUEVOS. La fuente
    // (memorias) y knowledge_vectors.json quedan intactos.
    const qdrantUrl = process.env.QDRANT_URL || '';
    if (qdrantUrl) {
      const resp = await fetch(`${qdrantUrl.replace(/\/+$/, '')}/collections/${prefijoColeccion}_${tenant}`, { method: 'DELETE' });
      console.log(`[revertir] coleccion ${prefijoColeccion}_${tenant}: HTTP ${resp.status}`);
    } else {
      console.log('[revertir] sin QDRANT_URL: se omite el borrado de coleccion.');
    }
    for (const sufijo of ['', '-wal', '-shm']) {
      try { fs.rmSync(rutaSparse + sufijo, { force: true }); } catch { /* best-effort */ }
    }
    console.log('[revertir] indice disperso eliminado. knowledge_vectors.json y las memorias fuente NO se han tocado.');
    return;
  }

  const { origen, memorias, cifradas = 0 } = leerMemoriasFuente();
  const indexables = memorias.filter((m) => !esDocumentoSensibleRag(m));
  const sensibles = memorias.length - indexables.length;

  console.log(`[migracion] fuente: ${origen || 'ninguna'} | memorias legibles: ${memorias.length} | cifradas (no re-embebibles, quedan solo en el camino cifrado historico): ${cifradas} | indexables: ${indexables.length} | excluidas sensibles: ${sensibles} | tenant: ${tenant}`);

  if (!APLICAR) {
    console.log('[migracion] DRY-RUN: no se ha escrito nada en ningun motor. Reejecuta con --aplicar dentro de la ventana autorizada.');
    return;
  }

  const qdrantUrl = process.env.QDRANT_URL || '';
  if (!qdrantUrl) {
    console.error('[migracion] --aplicar requiere QDRANT_URL (ej. http://127.0.0.1:6333).');
    process.exitCode = 1;
    return;
  }

  const embeddings = crearOllamaEmbeddingAdapter();
  const vectorStore = crearQdrantVectorStoreAdapter({ url: qdrantUrl, dimensiones: embeddings.dimensiones() });
  const sparseIndex = crearSqliteFts5SparseAdapter({ rutaDb: rutaSparse });
  const hibrido = crearHybridRetrievalService({
    embeddings,
    vectorStore,
    sparseIndex,
    esIndexable: (doc) => !esDocumentoSensibleRag(doc)
  });

  const resultado = await hibrido.indexar(tenant, indexables);
  const conteo = await hibrido.contar(tenant);
  const manifiesto = {
    version: 1,
    fecha: new Date().toISOString(),
    tenant,
    fuente: origen,
    memoriasLeidas: memorias.length,
    memoriasCifradasNoMigradas: cifradas,
    indexadas: resultado.total,
    omitidasSensibles: resultado.omitidos,
    conteoTrasMigracion: conteo,
    motores: hibrido.etiquetaMotores(),
    reversible: 'knowledge_vectors.json y las memorias fuente intactos; --revertir elimina solo los artefactos nuevos'
  };
  fs.writeFileSync(rutaManifiesto, JSON.stringify(manifiesto, null, 2), 'utf8');
  console.log(`[migracion] indexadas ${resultado.total} (denso=${conteo.denso}, disperso=${conteo.disperso}). Manifiesto: ${rutaManifiesto}`);
  if (conteo.denso !== resultado.total || conteo.disperso !== resultado.total) {
    console.error('[migracion] AVISO: el conteo posterior no cuadra con lo indexado; revisar antes de darla por buena.');
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(`[migracion] fallo: ${err.message}`);
  process.exitCode = 1;
});
