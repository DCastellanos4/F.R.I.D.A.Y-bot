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
import { crearLLMServiceProviderAdapter } from '../adapters/outbound/llm/llmServiceProviderAdapter.js';
import { crearJsonMemoryRepository } from '../adapters/outbound/persistence/jsonMemoryRepository.js';
import { crearMessageProcessor } from '../core/messageProcessor.js';

export function crearContenedor(overrides = {}) {
  const llmProvider = overrides.llmProvider ?? crearLLMServiceProviderAdapter();
  const memoryRepository = overrides.memoryRepository ?? crearJsonMemoryRepository();
  const processor = crearMessageProcessor({ llmProvider, memoryRepository });
  return Object.freeze({
    llmProvider,
    memoryRepository,
    procesarMensajeEntrante: processor.procesarMensajeEntrante
  });
}

const contenedorPorDefecto = crearContenedor();

/** Punto de entrada listo para los canales en produccion. */
export const procesarMensajeEntrante = contenedorPorDefecto.procesarMensajeEntrante;
