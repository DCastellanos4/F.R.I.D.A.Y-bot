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
import { crearMessageProcessor } from '../core/messageProcessor.js';

export function crearContenedor(overrides = {}) {
  const llmProvider = overrides.llmProvider ?? crearLLMServiceProviderAdapter();
  const memoryRepository = overrides.memoryRepository ?? crearJsonMemoryRepository();
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
  const processor = crearMessageProcessor({
    llmProvider,
    memoryRepository,
    metricasClasificador,
    crearStoreMetricas: crearJsonlClassifierMetricsStore,
    rutaArchivoIdempotenciaDefecto: overrides.rutaArchivoIdempotenciaDefecto ?? rutaIdempTest
  });
  return Object.freeze({
    llmProvider,
    memoryRepository,
    metricasClasificador,
    procesarMensajeEntrante: processor.procesarMensajeEntrante
  });
}

const contenedorPorDefecto = crearContenedor();

/** Punto de entrada listo para los canales en produccion. */
export const procesarMensajeEntrante = contenedorPorDefecto.procesarMensajeEntrante;
