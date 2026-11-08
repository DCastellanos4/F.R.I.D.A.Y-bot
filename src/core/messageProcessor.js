/**
 * Nucleo del hexagono: punto de entrada unico para mensajes de cualquier
 * canal.
 *
 * Recibe un InboundMessage (puerto de entrada) y lo procesa con el agente
 * inyectando los puertos de salida (proveedor LLM, repositorio de memoria)
 * en las opciones del agente. El agente conserva sus opciones historicas:
 * una opcion explicita de la llamada siempre gana a la del contenedor
 * (asi las pruebas y el bot pueden seguir sobreescribiendo piezas).
 *
 * Strict Policy: Zero Emojis.
 */
import { consultarJarvis } from './jarvisAgent.js';
import { afirmarLLMProvider } from '../ports/outbound/LLMProviderPort.js';
import { afirmarMemoryRepository } from '../ports/outbound/MemoryRepositoryPort.js';

export function crearMessageProcessor({ llmProvider, memoryRepository } = {}) {
  if (llmProvider !== undefined) afirmarLLMProvider(llmProvider);
  if (memoryRepository !== undefined) afirmarMemoryRepository(memoryRepository);

  return Object.freeze({
    /**
     * @param {import('../ports/inbound/InboundMessage.js').InboundMessage} inbound
     * @param {Object} [ctx]
     * @param {Array} [ctx.historial]  Historial del chat en formato agente.
     * @param {Object} [ctx.opciones]  Opciones historicas de consultarJarvis;
     *                                 una clave explicita aqui tiene prioridad
     *                                 sobre los puertos del contenedor.
     * @returns {Promise<string>} Respuesta de texto del agente.
     */
    async procesarMensajeEntrante(inbound, { historial = [], opciones = {} } = {}) {
      const opcionesConPuertos = { ...opciones };

      if (llmProvider) {
        if (typeof opcionesConPuertos.chatCompletion !== 'function') {
          opcionesConPuertos.chatCompletion = (peticion) => llmProvider.chatCompletion(peticion);
        }
        if (!opcionesConPuertos.llmProvider) {
          opcionesConPuertos.llmProvider = llmProvider;
        }
      }
      if (memoryRepository && !opcionesConPuertos.memoryRepository) {
        opcionesConPuertos.memoryRepository = memoryRepository;
      }
      if (inbound.channel && !opcionesConPuertos.channel) {
        opcionesConPuertos.channel = inbound.channel;
      }

      return consultarJarvis(inbound.text, historial, opcionesConPuertos);
    }
  });
}
