/**
 * Puerto de salida: cliente MCP (Model Context Protocol).
 *
 * Conecta el agente/orquestador con servidores de herramientas MCP externos
 * que corren en procesos independientes.
 *
 * Strict Policy: Zero Emojis.
 */

/**
 * @typedef {Object} McpToolDefinition
 * @property {'function'} type
 * @property {Object} function
 * @property {string} function.name
 * @property {string} function.description
 * @property {Object} function.parameters
 */

/**
 * @typedef {Object} McpClientPort
 * @property {() => Promise<Array<McpToolDefinition>>} toolsList Devuelve array de herramientas en formato OpenAI/Groq.
 * @property {(name: string, args?: Object, options?: Object) => Promise<any>} callTool Invoca una herramienta en el servidor MCP.
 * @property {() => Promise<void>} close Cierra la conexion y limpia el subproceso subyacente.
 */

/**
 * Valida que un objeto implementa el contrato de McpClientPort.
 * Lanza TypeError si no cumple la interfaz.
 *
 * @param {Object} cliente
 * @returns {Object}
 */
export function afirmarMcpClient(cliente) {
  if (!cliente || typeof cliente !== 'object') {
    throw new TypeError('McpClientPort: se esperaba un objeto cliente.');
  }
  const metodosRequeridos = ['toolsList', 'callTool', 'close'];
  for (const metodo of metodosRequeridos) {
    if (typeof cliente[metodo] !== 'function') {
      throw new TypeError(`McpClientPort: falta el metodo obligatorio "${metodo}".`);
    }
  }
  return cliente;
}

export const afirmarMcpClientPort = afirmarMcpClient;
export const assertMcpClientPort = afirmarMcpClient;
