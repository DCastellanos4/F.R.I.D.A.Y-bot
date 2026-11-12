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
import { registrarEnvolventeChatCompletion, limpiarEnvolventeChatCompletion } from '../core/llmService.js';
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
import { esDocumentoSensibleRag, registrarBuscadorHibridoPorDefecto } from '../services/semanticMemoryService.js';
import { crearPipelineAsincrono, validarSelectorCola } from './asyncPipeline.js';
import { crearAuditLogService } from '../security/auditLogService.js';
import { crearAnonimizadorPreLlm } from '../adapters/outbound/llm/piiPreLlmAdapter.js';

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

/**
 * RF-01/B1: pipeline asincrono (outbox + worker + entregador). INERTE por
 * defecto: solo con DAVIS_ASYNC_PIPELINE=1 (o overrides.pipelineAsincrono
 * en pruebas) se instancia y arranca el pool. La sustitucion del camino
 * sincrono de produccion es carril coordinado; aqui queda el wiring local
 * completo: recepcion con ACK inmediato, worker con checkpoints y
 * auditoria RNF-04, y alta en caliente del canal de entrega.
 */
const ACK_PIPELINE = 'Recibido, lo estoy procesando.';

function crearPipelineDesdeEntorno({ procesar, overrides }) {
  if (overrides.pipelineAsincrono !== undefined) return overrides.pipelineAsincrono;
  if (process.env.DAVIS_ASYNC_PIPELINE !== '1') return null;
  const rutaDb = process.env.DAVIS_ERS_PIPELINE_DB
    || process.env.DAVIS_SQLITE_PATH
    || path.join(DATA_DIR, 'ers_pipeline.db');
  const db = abrirBaseDatos(rutaDb);
  ejecutarMigraciones(db);
  const pipeline = crearPipelineAsincrono({
    db,
    procesar,
    auditoria: crearAuditLogService(db)
  });
  // Production WhatsApp consumption starts only after the authenticated socket
  // and its runtime callbacks have been registered. API remains synchronous.
  return pipeline;
}

export function crearContenedor(overrides = {}) {
  validarSelectorCola(); // antes de proveedores, persistencia, migraciones o workers
  let llmProvider = overrides.llmProvider ?? crearLLMServiceProviderAdapter();
  // RNF-04 PII PRE-LLM: con DAVIS_PII_PRELLM=1 todo texto hacia el LLM
  // cloud sale anonimizado y la respuesta se restaura en local (mapa por
  // peticion, nunca enviado). Lista blanca acotada por
  // DAVIS_PII_PERMITIR (csv): NO es un permiso general, solo evita
  // enmascarar identificadores ya autorizados (p. ej. el propio numero).
  if (overrides.piiPreLlm === true || (overrides.piiPreLlm === undefined && process.env.DAVIS_PII_PRELLM === '1')) {
    const permitir = (process.env.DAVIS_PII_PERMITIR || '').split(',').map((p) => p.trim()).filter(Boolean);
    llmProvider = crearAnonimizadorPreLlm({ inner: llmProvider, permitir });
    // Proteccion central: los imports directos de llmService (historial,
    // summarizer, ticketVision...) tambien quedan cubiertos. La
    // envolvente registrada envuelve el crudo: sin recursion ni doble
    // tokenizacion (el camino por puerto ya envuelto no re-anonimiza).
    registrarEnvolventeChatCompletion((p) => llmProvider.chatCompletion(p));
  } else {
    limpiarEnvolventeChatCompletion();
  }
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
  // RF-03 consumo: el buscador hibrido queda registrado como fuente de
  // busqueda semantica por defecto (solo existe con QDRANT_URL; sin el,
  // null y el camino historico TF-IDF no se toca). La costura de consumo
  // vive en semanticMemoryService.buscarMemoriaSemantica.
  if (buscadorHibrido && overrides.registrarBuscadorPorDefecto !== false) {
    registrarBuscadorHibridoPorDefecto(buscadorHibrido);
  }
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
  let resolverRuntime = null;let pipelineIniciado = false;
  const pipeline = crearPipelineDesdeEntorno({ procesar: (inbound,ctx)=>{
    if(!resolverRuntime)throw new Error('RF01_RUNTIME_NOT_READY');
    const runtime=resolverRuntime(inbound,ctx)||{};
    return procesarBase(inbound,{...ctx,opciones:{...runtime,...ctx.opciones}});
  }, overrides });
  return Object.freeze({
    llmProvider,
    memoryRepository,
    metricasClasificador,
    enrutadorInferencia,
    buscadorHibrido,
    pipelineAsincrono: pipeline,
    persistencia: persistenciaActiva.persistencia || null,
    /** Alta en caliente del adaptador de entrega (canal con sesion abierta). */
    registrarRuntimePipeline(resolver) {if(typeof resolver!=='function')throw new TypeError('RF01_RUNTIME_REQUIRED');resolverRuntime=resolver;},
    registrarCanalEntrega(nombre, adaptador) {
      if (!pipeline) throw new Error('Pipeline asincrono inactivo: DAVIS_ASYNC_PIPELINE!=1.');
      pipeline.registrarCanal(nombre, adaptador);
      if(!pipelineIniciado&&resolverRuntime){pipelineIniciado=true;pipeline.iniciar();}
    },
    async procesarMensajeEntrante(inbound, ctx) {
      // B1: con pipeline activo la recepcion es ACK inmediato (escritura
      // outbox atomica); la respuesta real la entrega el pool por el canal.
      if (pipeline && inbound.channel==='whatsapp') {
        if(!pipelineIniciado)throw new Error('RF01_CHANNEL_NOT_READY');
        pipeline.recibir(inbound,ctx);
        return ACK_PIPELINE;
      }
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

/** Instancia compartida (puertos, pipeline y alta de canales de entrega). */
export const contenedorCompartido = contenedorPorDefecto;

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
