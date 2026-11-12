/**
 * Registro y enrutador de servidores MCP: McpRegistry.
 *
 * Mantiene un mapa de servidores MCP por dominio (ej: 'booking', 'devops')
 * y enruta las llamadas a herramientas (callTool) al servidor adecuado,
 * agregando las herramientas en toolsList().
 *
 * Implementa McpClientPort para poder usarse de forma transparente como
 * un cliente MCP agregado.
 *
 * Strict Policy: Zero Emojis.
 */

import { afirmarMcpClient } from '../../../ports/outbound/McpClientPort.js';

export class McpRegistry {
  constructor() {
    /** @type {Map<string, Object>} */
    this.domainServers = new Map();
    /** @type {Map<string, string>} */
    this.toolToDomain = new Map();
  }

  /**
   * Registra un cliente/adaptador MCP para un dominio especifico.
   *
   * @param {string} domain - Nombre del dominio (ej: 'booking', 'devops').
   * @param {Object} adapter - Adaptador que cumple McpClientPort.
   * @returns {McpRegistry}
   */
  registerServer(domain, adapter) {
    if (!domain || typeof domain !== 'string') {
      throw new TypeError('McpRegistry: el dominio debe ser una cadena no vacia.');
    }
    afirmarMcpClient(adapter);

    this.domainServers.set(domain, adapter);

    const herramientasConocidas = {
      booking: ['consultar_disponibilidad', 'reservar_cita', 'cancelar_cita', 'listar_citas'],
      devops: ['ejecutar_comando_bash', 'consultar_estado_servidor', 'inspeccionar_docker', 'verificar_almacenamiento', 'comprobar_certificados_ssl']
    };
    if (herramientasConocidas[domain]) {
      for (const toolName of herramientasConocidas[domain]) {
        this.toolToDomain.set(toolName, domain);
      }
    }

    return this;
  }

  /**
   * Comprueba si una herramienta esta registrada en alguno de los servidores.
   *
   * @param {string} name - Nombre de la herramienta.
   * @returns {boolean}
   */
  hasTool(name) {
    if (!name || typeof name !== 'string') return false;
    if (this.toolToDomain.has(name)) return true;

    const herramientasConocidas = {
      booking: ['consultar_disponibilidad', 'reservar_cita', 'cancelar_cita', 'listar_citas'],
      devops: ['ejecutar_comando_bash', 'consultar_estado_servidor', 'inspeccionar_docker', 'verificar_almacenamiento', 'comprobar_certificados_ssl']
    };
    for (const domain of this.domainServers.keys()) {
      if (herramientasConocidas[domain]?.includes(name)) {
        this.toolToDomain.set(name, domain);
        return true;
      }
    }
    return false;
  }

  /**
   * Desregistra un dominio y limpia las referencias a sus herramientas.
   *
   * @param {string} domain
   * @returns {boolean}
   */
  unregisterServer(domain) {
    if (!this.domainServers.has(domain)) {
      return false;
    }
    this.domainServers.delete(domain);

    for (const [toolName, mappedDomain] of this.toolToDomain.entries()) {
      if (mappedDomain === domain) {
        this.toolToDomain.delete(toolName);
      }
    }
    return true;
  }

  /**
   * Obtiene el adaptador registrado para un dominio.
   *
   * @param {string} domain
   * @returns {Object|undefined}
   */
  getServer(domain) {
    return this.domainServers.get(domain);
  }

  /**
   * Devuelve la lista de dominios registrados.
   *
   * @returns {string[]}
   */
  listServers() {
    return Array.from(this.domainServers.keys());
  }

  /**
   * Consulta las herramientas de todos los servidores registrados y las agrega
   * en una lista unica con formato OpenAI/Groq. Actualiza el mapa de enrutamiento.
   *
   * @param {Object} [options]
   * @param {boolean} [options.lenient=false] - Si es true, ignora servidores que fallen.
   * @returns {Promise<Array<Object>>}
   */
  async toolsList(options = {}) {
    const aggregated = [];

    if (options.lenient) {
      const settled = await Promise.allSettled(
        Array.from(this.domainServers.entries()).map(async ([domain, adapter]) => {
          const list = await adapter.toolsList(options);
          return { domain, list };
        })
      );

      for (const res of settled) {
        if (res.status === 'fulfilled') {
          const { domain, list } = res.value;
          for (const tool of list) {
            const toolName = tool.function?.name;
            if (toolName) {
              this.toolToDomain.set(toolName, domain);
            }
            aggregated.push(tool);
          }
        }
      }
    } else {
      const results = await Promise.all(
        Array.from(this.domainServers.entries()).map(async ([domain, adapter]) => {
          const list = await adapter.toolsList(options);
          return { domain, list };
        })
      );

      for (const { domain, list } of results) {
        for (const tool of list) {
          const toolName = tool.function?.name;
          if (toolName) {
            this.toolToDomain.set(toolName, domain);
          }
          aggregated.push(tool);
        }
      }
    }

    return aggregated;
  }

  /**
   * Enruta la ejecucion de la herramienta al servidor correspondiente.
   *
   * @param {string} name - Nombre de la herramienta.
   * @param {Object} [args={}] - Argumentos de la herramienta.
   * @param {Object} [options={}] - Opciones de ejecucion.
   * @returns {Promise<any>}
   */
  async callTool(name, args = {}, options = {}) {
    if (!name || typeof name !== 'string') {
      const err = new Error('McpRegistry: se requiere el nombre de la herramienta');
      err.code = 'MCP_INVALID_TOOL_NAME';
      throw err;
    }

    let domain = this.toolToDomain.get(name);

    // Si la herramienta no esta en el mapa de enrutamiento, refresca el catalogo
    if (!domain) {
      await this.toolsList(options);
      domain = this.toolToDomain.get(name);
    }

    if (!domain) {
      const err = new Error(`MCP tool "${name}" not found in any registered server`);
      err.code = 'MCP_TOOL_NOT_FOUND';
      throw err;
    }

    const adapter = this.domainServers.get(domain);
    if (!adapter) {
      const err = new Error(`MCP server for domain "${domain}" is not available`);
      err.code = 'MCP_SERVER_UNAVAILABLE';
      throw err;
    }

    return adapter.callTool(name, args, options);
  }

  /**
   * Cierra todos los servidores MCP registrados.
   *
   * @returns {Promise<void>}
   */
  async close() {
    const adapters = Array.from(this.domainServers.values());
    this.domainServers.clear();
    this.toolToDomain.clear();

    const closePromises = adapters.map(async (adapter) => {
      try {
        await adapter.close();
      } catch {
        // Ignora errores individuales al cerrar
      }
    });

    await Promise.all(closePromises);
  }
}

/**
 * Fabrica de registro MCP con asercion de McpClientPort.
 *
 * @returns {McpRegistry}
 */
export function crearMcpRegistry() {
  const registry = new McpRegistry();
  return afirmarMcpClient(registry);
}

export const createMcpRegistry = crearMcpRegistry;
