/**
 * Raiz de composicion del hexagono.
 *
 * Aqui (y solo aqui) se decide que adaptadores concretos cumplen cada
 * puerto en produccion: hoy, llmService historico para el LLM y JSON
 * plano para la memoria. Las pruebas y los futuros canales construyen
 * su propio contenedor con overrides sin tocar esta decision.
 *
 * Strict Policy: Zero Emojis.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { crearLLMServiceProviderAdapter } from '../adapters/outbound/llm/llmServiceProviderAdapter.js';
import { crearJsonMemoryRepository } from '../adapters/outbound/persistence/jsonMemoryRepository.js';
import { crearJsonlClassifierMetricsStore } from '../adapters/outbound/persistence/jsonlClassifierMetricsStore.js';
import { crearPuenteWhatsAppTenants } from './whatsappTenantBridge.js';
import { crearMessageProcessor } from '../core/messageProcessor.js';
import { DATA_DIR } from '../config/paths.js';
import { registrarStoreMemoriasPorDefecto } from '../services/memoryService.js';
import { registrarStoreUsoPorDefecto } from '../services/usageLedgerService.js';
import { registrarStoreFinanzasPorDefecto } from '../services/financeService.js';
import { registrarFuenteMemoriasPorDefecto } from '../services/semanticMemoryService.js';
import { crearPersistenciaSqlite } from '../adapters/outbound/persistence/sqlite/persistenciaSqlite.js';
import { crearSqliteMemoryRepository } from '../adapters/outbound/persistence/sqlite/sqliteMemoryRepository.js';
import { crearSqliteMemoryStore } from '../adapters/outbound/persistence/sqlite/sqliteMemoryStore.js';
import { abrirBaseDatos } from '../adapters/outbound/persistence/sqlite/connection.js';
import { ejecutarMigraciones } from '../adapters/outbound/persistence/sqlite/migraciones.js';
import { crearOllamaSlmAdapter } from '../adapters/outbound/llm/ollamaSlmAdapter.js';
import { crearLocalSlmInferenceService } from '../services/localSlmInferenceService.js';
import { crearEnrutadorInferencia } from '../core/inferenceRouter.js';
import { registrarDecisionInferencia } from '../observability/telemetry.js';
import { crearHybridRetrievalService } from '../core/rag/hybridRetrievalService.js';
import { crearOllamaEmbeddingAdapter } from '../adapters/outbound/embeddings/ollamaEmbeddingAdapter.js';
import { crearQdrantVectorStoreAdapter } from '../adapters/outbound/vectorstores/qdrantVectorStoreAdapter.js';
import { crearSqliteFts5SparseAdapter } from '../adapters/outbound/retrieval/sqliteFts5SparseAdapter.js';
import { crearHttpCrossEncoderReranker } from '../adapters/outbound/rerankers/httpCrossEncoderRerankerAdapter.js';
import { esDocumentoSensibleRag } from '../services/semanticMemoryService.js';

/**
 * Persistencia activa: DAVIS_PERSISTENCE=json (por defecto, comportamiento
 * historico) o sqlite (base embebida WAL con migraciones versionadas e
 * importacion automatica de los JSON existentes, que NO se borran).
 * Con sqlite, un estado inconsistente (datos sin marca de origen) es un
 * fallo cerrado: la factoria lanza y el arranque se detiene con el error
 * claro; nunca se cae en silencio al JSON, que podria estar obsoleto.
 */
function crearPersistenciaActiva(overrides) {
  if (overrides.memoryRepository) return { modo: 'inyectado', memoryRepository: overrides.memoryRepository };
  const modo = (process.env.DAVIS_PERSISTENCE || 'json').toLowerCase();
  if (modo === 'json') return { modo, memoryRepository: crearJsonMemoryRepository() };
  if (modo !== 'sqlite') {
    throw new Error(`DAVIS_PERSISTENCE desconocido: "${modo}". Valores validos: json, sqlite.`);
  }
  const rutaDb = process.env.DAVIS_SQLITE_PATH || path.join(DATA_DIR, 'jarvis.db');
  const persistencia = crearPersistenciaSqlite({
    rutaDb,
    rutaMemoriasJson: path.join(DATA_DIR, 'brain_memory.json'),
    rutaFinanzasJson: path.join(DATA_DIR, 'finanzas.json')
  });
  // Costuras por defecto: todo consumidor historico sin deps explicitas
  // (digest, busqueda, cripto, monitor de finanzas, whatsappBot) pasa a
  // leer y escribir en SQLite. Una rutaArchivo explicita sigue yendo a
  // JSON (aislamiento de pruebas).
  registrarStoreMemoriasPorDefecto(persistencia.memoryStore);
  registrarStoreUsoPorDefecto(persistencia.usageStore);
  registrarStoreFinanzasPorDefecto(persistencia.financeStore);
  registrarFuenteMemoriasPorDefecto(persistencia.fuenteSemantica);
  const memoryRepository = crearSqliteMemoryRepository({
    memoryStore: persistencia.memoryStore,
    crearStoreParaRuta: (ruta) => {
      const db = abrirBaseDatos(ruta);
      ejecutarMigraciones(db);
      return crearSqliteMemoryStore(db);
    }
  });
  return { modo, memoryRepository, persistencia };
}

/**
 * RF-03: buscador hibrido industrial. INERTE por defecto: sin QDRANT_URL
 * no se construye nada y la busqueda sigue el camino historico (TF-IDF),
 * rollback intacto. El reranker solo entra con DAVIS_RERANKER_URL; sin el
 * el pipeline queda declarado como NO certificado (nunca cuenta RF-03).
 * Los documentos sensibles quedan fuera via esIndexable, como en el RAG
 * historico.
 */
function crearBuscadorHibridoDesdeEntorno() {
  const url = (process.env.QDRANT_URL || '').trim();
  if (!url) return null;
  const dimensiones = Number.parseInt(process.env.DAVIS_EMBEDDING_DIMS || '', 10) || 1024;
  return crearHybridRetrievalService({
    embeddings: crearOllamaEmbeddingAdapter(),
    vectorStore: crearQdrantVectorStoreAdapter({ url, dimensiones }),
    sparseIndex: crearSqliteFts5SparseAdapter(),
    reranker: crearHttpCrossEncoderReranker(),
    esIndexable: (doc) => !esDocumentoSensibleRag(doc)
  });
}

export function crearContenedor(overrides = {}) {
  const llmProvider = overrides.llmProvider ?? crearLLMServiceProviderAdapter();
  // RF-02: enrutador de inferencia especulativa. INERTE por defecto: sin
  // DAVIS_SLM_MODEL el adaptador es null, no se construye router y toda la
  // clasificacion sigue la via cloud historica. La via nube del router es
  // siempre el proveedor actual (Groq); el router no elige modelo cloud.
  const slmAdapter = overrides.slmAdapter !== undefined ? overrides.slmAdapter : crearOllamaSlmAdapter();
  const enrutadorInferencia = overrides.enrutadorInferencia ?? (slmAdapter
    ? crearEnrutadorInferencia({
        slm: crearLocalSlmInferenceService({ provider: slmAdapter }),
        chatCompletionNube: (p) => llmProvider.chatCompletion(p),
        registrarDecision: registrarDecisionInferencia
      })
    : null);
  const persistenciaActiva = crearPersistenciaActiva(overrides);
  const memoryRepository = persistenciaActiva.memoryRepository;
  const metricasClasificador = overrides.metricasClasificador ?? crearJsonlClassifierMetricsStore();
  // Aislamiento del estado de pruebas: bajo NODE_ENV=test la cache de
  // idempotencia por defecto vive en un tmp por proceso; el estado
  // compartido (data/) nunca se toca salvo ruta explicita. Dos
  // ejecuciones de la suite en menos de 10 min colisionaban en la cache
  // compartida (fallo observado el 8 nov 2026: 13 pruebas en rojo).
  // Produccion intacta.
  let rutaIdempTest = null;
  if (process.env.NODE_ENV === 'test' && !overrides.rutaArchivoIdempotenciaDefecto) {
    rutaIdempTest = path.join(
      fs.mkdtempSync(path.join(os.tmpdir(), 'davis-suite-idemp-')),
      'idempotency_cache.json'
    );
  }
  const buscadorHibrido = overrides.buscadorHibrido !== undefined
    ? overrides.buscadorHibrido
    : crearBuscadorHibridoDesdeEntorno();
  const processor = crearMessageProcessor({
    llmProvider,
    memoryRepository,
    metricasClasificador,
    crearStoreMetricas: crearJsonlClassifierMetricsStore,
    accesoTenants: overrides.accesoTenants || null,
    enrutadorInferencia,
    buscadorHibrido,
    rutaArchivoIdempotenciaDefecto: overrides.rutaArchivoIdempotenciaDefecto ?? rutaIdempTest
  });
  const procesarBase = processor.procesarMensajeEntrante;
  const userRepository = persistenciaActiva.persistencia?.userRepository || overrides.userRepository || null;
  return Object.freeze({
    llmProvider,
    memoryRepository,
    metricasClasificador,
    enrutadorInferencia,
    buscadorHibrido,
    persistencia: persistenciaActiva.persistencia || null,
    async procesarMensajeEntrante(inbound, ctx) {
      const respuesta = await procesarBase(inbound, ctx);
      // Registro de contacto YA autenticado (la lista blanca decide el
      // acceso antes de llegar aqui; el repositorio nunca autoriza).
      if (userRepository) {
        try {
          userRepository.registrarContacto(inbound.userId);
        } catch (err) {
          console.error('[Contenedor] Error registrando contacto de usuario:', err.message);
        }
      }
      return respuesta;
    }
  });
}

const contenedorPorDefecto = crearContenedor();

/** Punto de entrada listo para los canales en produccion. */
export const procesarMensajeEntrante = contenedorPorDefecto.procesarMensajeEntrante;

/** Fabrica para el listener Baileys. No abre gates ni registra identidades. */
export function crearPuenteWhatsAppTenantsCompuesto({ esPropietario } = {}) {
  const p = contenedorPorDefecto.persistencia;
  if (!p?.tenantRepository || !p?.limitesStore) return null;
  return crearPuenteWhatsAppTenants({
    tenantRepository: p.tenantRepository, limitesStore: p.limitesStore,
    llmProvider: contenedorPorDefecto.llmProvider, esPropietario
  });
}
