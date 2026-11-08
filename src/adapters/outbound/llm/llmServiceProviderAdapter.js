/**
 * Adaptador de salida: LLMProviderPort sobre el llmService historico.
 *
 * Passthrough deliberado: el llmService existente sigue decidiendo el
 * proveedor real (Ollama local vs nube) por configuracion; este adaptador
 * solo lo presenta detras del puerto para que el core deje de importarlo
 * directamente. Cambiar de proveedor en el futuro = otro adaptador que
 * cumpla LLMProviderPort, sin tocar el dominio.
 *
 * Strict Policy: Zero Emojis.
 */
import { chatCompletion } from '../../../core/llmService.js';
import { afirmarLLMProvider } from '../../../ports/outbound/LLMProviderPort.js';

export function crearLLMServiceProviderAdapter() {
  return afirmarLLMProvider(Object.freeze({
    nombre: 'llmService-historico',
    chatCompletion: (peticion) => chatCompletion(peticion)
  }));
}
