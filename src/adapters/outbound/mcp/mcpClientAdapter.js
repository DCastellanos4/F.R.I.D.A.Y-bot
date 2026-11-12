/**
 * Adaptador de salida: McpClientAdapter.
 *
 * Implementa el protocolo Model Context Protocol (MCP) version JSON-RPC 2.0
 * sobre stdio con un proceso hijo.
 *
 * Contrato:
 *  - toolsList() -> Promise<Array<ToolDefinition>> en formato OpenAI/Groq
 *  - callTool(name, args, options) -> Promise<any>
 *  - close() -> Promise<void>
 *
 * Strict Policy: Zero Emojis.
 */

import { spawn } from 'node:child_process';
import readline from 'node:readline';
import { afirmarMcpClient } from '../../../ports/outbound/McpClientPort.js';

const TIMEOUT_DEFAULT_MS = 15000;
const CLOSE_TIMEOUT_DEFAULT_MS = 2000;

export class McpClientAdapter {
  /**
   * @param {Object} config
   * @param {string} [config.command] - Comando o binario a ejecutar (default: process.execPath).
   * @param {string[]} [config.args] - Argumentos para el comando.
   * @param {string} [config.cwd] - Directorio de trabajo.
   * @param {Object} [config.env] - Variables de entorno adicionales.
   * @param {number} [config.timeoutMs=15000] - Tiempo maximo por peticion antes de fail-closed.
   * @param {number} [config.closeTimeoutMs=2000] - Tiempo para SIGKILL tras SIGTERM.
   * @param {string} [config.name] - Nombre identificativo del servidor MCP.
   * @param {Function} [config.spawnFn] - Inyeccion de spawn para pruebas.
   */
  constructor(config = {}) {
    this.command = config.command || process.execPath;
    this.args = Array.isArray(config.args) ? config.args : [];
    this.cwd = config.cwd;
    this.env = config.env || {};
    this.timeoutMs = typeof config.timeoutMs === 'number' && config.timeoutMs > 0
      ? config.timeoutMs
      : TIMEOUT_DEFAULT_MS;
    this.closeTimeoutMs = typeof config.closeTimeoutMs === 'number' && config.closeTimeoutMs > 0
      ? config.closeTimeoutMs
      : CLOSE_TIMEOUT_DEFAULT_MS;
    this.name = config.name || 'mcp-server';
    this.spawnFn = config.spawnFn || spawn;

    this.child = null;
    this.rl = null;
    this.nextId = 1;
    this.pendingRequests = new Map();
    this.isClosed = false;
    this.isInitialized = false;
    this.initPromise = null;
    this.exitPromise = null;
    this.exitError = null;
    this.stderrOutput = [];
  }

  /**
   * Arranca el proceso hijo si todavia no esta activo.
   */
  ensureStarted() {
    if (this.isClosed) {
      const err = new Error(`MCP client [${this.name}] is closed`);
      err.code = 'MCP_CLIENT_CLOSED';
      throw err;
    }

    if (this.exitError) {
      throw this.exitError;
    }

    if (this.child) {
      return;
    }

    this.child = this.spawnFn(this.command, this.args, {
      cwd: this.cwd,
      env: { ...process.env, ...this.env },
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: false
    });

    this.exitPromise = new Promise((resolve) => {
      this.child.once('exit', (code, signal) => {
        const exitErr = new Error(`MCP process [${this.name}] exited with code ${code}, signal ${signal}`);
        exitErr.code = 'MCP_PROCESS_EXITED';
        exitErr.exitCode = code;
        exitErr.signal = signal;
        this.exitError = exitErr;
        this.rejectAllPending(exitErr);
        if (this.rl) {
          try {
            this.rl.close();
          } catch {
            // Ignora error al cerrar readline
          }
          this.rl = null;
        }
        resolve({ code, signal });
      });
    });

    this.child.on('error', (err) => {
      const procErr = new Error(`MCP process [${this.name}] error: ${err.message}`);
      procErr.code = 'MCP_PROCESS_ERROR';
      procErr.cause = err;
      this.exitError = procErr;
      this.rejectAllPending(procErr);
    });

    if (this.child.stdin) {
      this.child.stdin.on('error', () => {
        // Ignora EPIPE o stream cerrado si el subproceso finalizo abruptamente
      });
    }

    if (this.child.stderr) {
      this.child.stderr.on('data', (chunk) => {
        this.stderrOutput.push(chunk.toString());
        if (this.stderrOutput.length > 50) {
          this.stderrOutput.shift();
        }
      });
    }

    if (this.child.stdout) {
      this.rl = readline.createInterface({
        input: this.child.stdout,
        crlfDelay: Infinity
      });

      this.rl.on('line', (line) => {
        const trimmed = line.trim();
        if (!trimmed) return;
        let message;
        try {
          message = JSON.parse(trimmed);
        } catch {
          // Linea no es JSON valido, se ignora del flujo JSON-RPC
          return;
        }
        this.handleMessage(message);
      });
    }
  }

  /**
   * Procesa un mensaje JSON-RPC entrante desde stdout.
   *
   * @param {Object} message
   */
  handleMessage(message) {
    if (!message || typeof message !== 'object') return;

    if (message.id !== undefined && message.id !== null) {
      const key = String(message.id);
      const pending = this.pendingRequests.get(key);
      if (pending) {
        clearTimeout(pending.timer);
        this.pendingRequests.delete(key);

        if (message.error) {
          const err = new Error(message.error.message || `MCP Error code ${message.error.code}`);
          err.code = message.error.code;
          err.data = message.error.data;
          pending.reject(err);
        } else {
          pending.resolve(message.result);
        }
      }
    }
  }

  /**
   * Rechaza todas las peticiones pendientes por caida de proceso o cierre.
   *
   * @param {Error} reason
   */
  rejectAllPending(reason) {
    for (const [, pending] of this.pendingRequests) {
      clearTimeout(pending.timer);
      pending.reject(reason);
    }
    this.pendingRequests.clear();
  }

  /**
   * Envia una peticion JSON-RPC 2.0 y espera respuesta con timeout estricto.
   *
   * @param {string} method
   * @param {Object} [params={}]
   * @param {number} [customTimeoutMs]
   * @returns {Promise<any>}
   */
  sendRequest(method, params = {}, customTimeoutMs) {
    try {
      this.ensureStarted();
    } catch (err) {
      return Promise.reject(err);
    }

    if (this.isClosed) {
      const err = new Error(`MCP client [${this.name}] is closed`);
      err.code = 'MCP_CLIENT_CLOSED';
      return Promise.reject(err);
    }

    if (this.exitError) {
      return Promise.reject(this.exitError);
    }

    const id = this.nextId++;
    const key = String(id);
    const effectiveTimeout = typeof customTimeoutMs === 'number' && customTimeoutMs > 0
      ? customTimeoutMs
      : this.timeoutMs;

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(key);
        const timeoutErr = new Error(`MCP request "${method}" timed out after ${effectiveTimeout}ms`);
        timeoutErr.code = 'MCP_TIMEOUT_EXPIRED';
        reject(timeoutErr);
      }, effectiveTimeout);

      if (typeof timer.unref === 'function') {
        timer.unref();
      }

      this.pendingRequests.set(key, { resolve, reject, timer, method });

      const payload = {
        jsonrpc: '2.0',
        id,
        method,
        params
      };

      try {
        this.child.stdin.write(JSON.stringify(payload) + '\n');
      } catch (err) {
        clearTimeout(timer);
        this.pendingRequests.delete(key);
        reject(err);
      }
    });
  }

  /**
   * Envia una notificacion JSON-RPC 2.0 (sin id, sin esperar respuesta).
   *
   * @param {string} method
   * @param {Object} [params]
   */
  sendNotification(method, params) {
    this.ensureStarted();
    if (this.isClosed) return;

    const payload = {
      jsonrpc: '2.0',
      method
    };
    if (params !== undefined) {
      payload.params = params;
    }

    try {
      this.child.stdin.write(JSON.stringify(payload) + '\n');
    } catch {
      // Ignora error de escritura en notificacion si el socket ya no acepta
    }
  }

  /**
   * Realiza el handshake de inicializacion MCP:
   * 1. initialize request
   * 2. notifications/initialized notification
   */
  async init() {
    if (this.isInitialized) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = (async () => {
      this.ensureStarted();
      const initResult = await this.sendRequest('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: {
          name: 'friday-mcp-client',
          version: '1.0.0'
        }
      });
      this.sendNotification('notifications/initialized');
      this.isInitialized = true;
      return initResult;
    })();

    return this.initPromise;
  }

  /**
   * Solicita el catalogo de herramientas al servidor MCP y las mapea al formato OpenAI/Groq:
   * { type: 'function', function: { name, description, parameters } }
   *
   * @param {Object} [options]
   * @param {number} [options.timeoutMs]
   * @returns {Promise<Array<Object>>}
   */
  async toolsList(options = {}) {
    await this.init();
    const response = await this.sendRequest('tools/list', {}, options?.timeoutMs);
    const rawTools = Array.isArray(response?.tools) ? response.tools : [];

    return rawTools.map((tool) => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description || '',
        parameters: tool.inputSchema || tool.parameters || {
          type: 'object',
          properties: {}
        }
      }
    }));
  }

  /**
   * Ejecuta una herramienta en el servidor MCP remoto via tools/call.
   *
   * @param {string} name
   * @param {Object} [args={}]
   * @param {Object} [options={}]
   * @param {number} [options.timeoutMs]
   * @returns {Promise<any>}
   */
  async callTool(name, args = {}, options = {}) {
    await this.init();
    return this.sendRequest('tools/call', {
      name,
      arguments: args || {}
    }, options?.timeoutMs);
  }

  /**
   * Cierra la conexion, rechaza llamadas pendientes y liquida el proceso hijo
   * con SIGTERM y fallback a SIGKILL.
   *
   * @returns {Promise<void>}
   */
  async close() {
    if (this.isClosed) return;
    this.isClosed = true;

    const closeErr = new Error(`MCP client [${this.name}] closed`);
    closeErr.code = 'MCP_CLIENT_CLOSED';
    this.rejectAllPending(closeErr);

    if (this.rl) {
      try {
        this.rl.close();
      } catch {
        // Ignora error al cerrar readline
      }
      this.rl = null;
    }

    if (!this.child) {
      return;
    }

    if (this.child.stdin && !this.child.stdin.destroyed) {
      try {
        this.child.stdin.end();
      } catch {
        // Ignora si stdin ya fue cerrado
      }
    }

    if (this.child.killed || this.child.exitCode !== null) {
      return;
    }

    return new Promise((resolve) => {
      let sigkillTimer = null;

      const finish = () => {
        if (sigkillTimer) {
          clearTimeout(sigkillTimer);
          sigkillTimer = null;
        }
        resolve();
      };

      if (this.exitPromise) {
        this.exitPromise.then(finish, finish);
      } else {
        this.child.once('exit', finish);
      }

      try {
        this.child.kill('SIGTERM');
      } catch {
        // El proceso pudo haber terminado justo antes
      }

      sigkillTimer = setTimeout(() => {
        if (this.child && !this.child.killed && this.child.exitCode === null) {
          try {
            this.child.kill('SIGKILL');
          } catch {
            // Ignora fallo en SIGKILL
          }
        }
        finish();
      }, this.closeTimeoutMs);

      if (typeof sigkillTimer.unref === 'function') {
        sigkillTimer.unref();
      }
    });
  }
}

/**
 * Fabrica de cliente MCP que asegura el cumplimiento del puerto McpClientPort.
 *
 * @param {Object} config
 * @returns {McpClientAdapter}
 */
export function crearMcpClientAdapter(config = {}) {
  const adapter = new McpClientAdapter(config);
  return afirmarMcpClient(adapter);
}

export const createMcpClientAdapter = crearMcpClientAdapter;
