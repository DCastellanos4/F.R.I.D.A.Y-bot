/**
 * Puerto de salida: proveedor de LLM.
 *
 * El core nunca importa Ollama, Groq ni ningun SDK: depende de esta
 * interfaz. Cualquier proveedor que la cumpla es intercambiable sin
 * tocar el dominio (el adaptador por defecto envuelve el llmService
 * historico, que sigue decidiendo ollama vs nube por config).
 *
 * Strict Policy: Zero Emojis.
 */

/**
 * @typedef {Object} PeticionChat
 * @property {Array<Object>} messages  Mensajes del chat (roles system/user/assistant/tool).
 * @property {Array<Object>} [tools]   Herramientas ofrecidas al modelo.
 * @property {Object} [options]        Opciones del modelo (temperature, num_ctx...).
 * @property {string} [provider]       Forzado de proveedor para esta llamada.
 * @property {string} [model]          Forzado de modelo.
 * @property {string} [apiKey]         Credencial alternativa.
 * @property {string} [baseUrl]        Endpoint alternativo.
 */

/**
 * @typedef {Object} LLMProviderPort
 * @property {string} nombre  Nombre legible del proveedor/adaptador.
 * @property {(peticion: PeticionChat) => Promise<Object>} chatCompletion
 *   Devuelve la respuesta del proveedor con la forma historica del proyecto:
 *   { message: { role, content, tool_calls? }, ... }.
 */

/**
 * Verifica que un objeto cumple el puerto; util al construir contenedores
 * y en pruebas de contrato. Lanza TypeError si falta algo.
 */
export function afirmarLLMProvider(provider) {
  if (!provider || typeof provider !== 'object') {
    throw new TypeError('LLMProviderPort: se esperaba un objeto proveedor.');
  }
  if (typeof provider.chatCompletion !== 'function') {
    throw new TypeError('LLMProviderPort: chatCompletion (funcion) es obligatorio.');
  }
  return provider;
}
