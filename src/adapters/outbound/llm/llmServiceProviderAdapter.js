/**
 * Adaptador de salida: LLMProviderPort sobre el llmService historico.
 *
 * Passthrough deliberado sobre el CRUDO: nunca el despachador PII,
 * para que una envolvente registrada no se invoque a si misma. El llmService sigue decidiendo el
 * proveedor real (Ollama local vs nube) por configuracion; este adaptador
 * solo lo presenta detras del puerto para que el core deje de importarlo
 * directamente. Cambiar de proveedor en el futuro = otro adaptador que
 * cumpla LLMProviderPort, sin tocar el dominio.
 *
 * Strict Policy: Zero Emojis.
 */
import { chatCompletionCrudo } from '../../../core/llmService.js';
import { afirmarLLMProvider } from '../../../ports/outbound/LLMProviderPort.js';

export function crearLLMServiceProviderAdapter() {
  return afirmarLLMProvider(Object.freeze({
    nombre: 'llmService-historico',
    chatCompletion: (peticion) => chatCompletionCrudo(peticion)
  }));
}
