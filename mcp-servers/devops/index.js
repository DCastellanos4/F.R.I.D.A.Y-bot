#!/usr/bin/env node

/**
 * mcp-server-devops
 * Servidor MCP autonomo para operaciones de infraestructura, diagnostico
 * del sistema, ejecucion aislada en bash, control de Docker y monitorizacion SSL.
 *
 * Protocolo: Model Context Protocol (MCP) sobre JSON-RPC 2.0 (stdio)
 * Politica de estilo: Cero emojis en codigo, comentarios, logs y salidas.
 */

import readline from 'node:readline';
import { execFile } from 'node:child_process';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import tls from 'node:tls';
import { fileURLToPath } from 'node:url';

const SERVER_NAME = 'mcp-server-devops';
const SERVER_VERSION = '1.0.0';
const PROTOCOL_VERSION = '2024-11-05';

/**
 * Localiza el binario ejecutable de bash en el sistema anfitrion.
 * En Windows busca en rutas comunes de Git Bash antes de recurrir al comando generico.
 *
 * @returns {string} Ruta o comando de bash
 */
export function getBashExecutable() {
  if (process.platform === 'win32') {
    const candidates = [
      'C:\\Program Files\\Git\\bin\\bash.exe',
      'C:\\Program Files\\Git\\usr\\bin\\bash.exe',
      'C:\\Program Files (x86)\\Git\\bin\\bash.exe',
      'C:\\Program Files (x86)\\Git\\usr\\bin\\bash.exe'
    ];
    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }
  }
  return 'bash';
}

export const TIMEOUT_BASH_DEFECTO_MS = 15000;
export const TIMEOUT_BASH_MAX_MS = 15000;

/**
 * Ejecuta un comando en shell bash de forma aislada con limite estricto de tiempo.
 *
 * @param {string} comando - Comando bash a ejecutar
 * @param {number} [timeoutMs=15000] - Tiempo maximo de ejecucion en ms
 * @returns {Promise<{ ok: boolean, exitCode: number, stdout: string, stderr: string, timedOut: boolean, durationMs: number }>}
 */
export async function ejecutarComandoBash(comando, timeoutMs = TIMEOUT_BASH_DEFECTO_MS) {
  if (!comando || typeof comando !== 'string') {
    throw new TypeError('El parametro comando es obligatorio y debe ser una cadena no vacia');
  }

  const timeoutNumerico = Number(timeoutMs) > 0 ? Number(timeoutMs) : TIMEOUT_BASH_DEFECTO_MS;
  const timeout = Math.min(timeoutNumerico, TIMEOUT_BASH_MAX_MS);
  const bashBinary = getBashExecutable();
  const startTime = Date.now();

  return new Promise((resolve) => {
    execFile(
      bashBinary,
      ['-c', comando],
      {
        timeout,
        maxBuffer: 10 * 1024 * 1024,
        windowsHide: true,
        env: {
          ...process.env,
          LC_ALL: 'C.UTF-8',
          LANG: 'C.UTF-8'
        }
      },
      (error, stdout, stderr) => {
        const durationMs = Date.now() - startTime;
        const stdoutStr = (stdout || '').toString().trim();
        const stderrStr = (stderr || '').toString().trim();

        if (error) {
          const timedOut = Boolean(error.killed && (error.signal === 'SIGTERM' || error.signal === 'SIGKILL')) ||
            error.code === 'ETIMEDOUT' ||
            durationMs >= timeout;

          resolve({
            ok: false,
            exitCode: typeof error.code === 'number' ? error.code : -1,
            stdout: stdoutStr,
            stderr: timedOut
              ? 'Ejecucion abortada por superar el tiempo limite de seguridad (timeout)'
              : (stderrStr || error.message),
            timedOut,
            durationMs
          });
          return;
        }

        resolve({
          ok: true,
          exitCode: 0,
          stdout: stdoutStr,
          stderr: stderrStr,
          timedOut: false,
          durationMs
        });
      }
    );
  });
}

/**
 * Consulta la telemetria integral del servidor: uso y carga de CPU,
 * consumo de memoria RAM, particion principal de disco y tiempos de actividad.
 *
 * @returns {Promise<object>} Estado del servidor
 */
export async function consultarEstadoServidor() {
  const cpus = os.cpus();
  const totalmem = os.totalmem();
  const freemem = os.freemem();
  const usedmem = totalmem - freemem;
  const loadAvg = os.loadavg();
  const rootPath = process.platform === 'win32'
    ? (process.env.SystemDrive || 'C:') + '\\'
    : '/';

  let disco = null;
  try {
    const stats = fs.statfsSync(rootPath);
    const bsize = BigInt(stats.bsize);
    const totalBytes = Number(bsize * BigInt(stats.blocks));
    const freeBytes = Number(bsize * BigInt(stats.bavail));
    const usedBytes = totalBytes >= freeBytes ? totalBytes - freeBytes : 0;
    const porcentajeUso = totalBytes > 0
      ? Number(((usedBytes / totalBytes) * 100).toFixed(2))
      : 0;

    disco = {
      ruta: rootPath,
      totalBytes,
      freeBytes,
      usedBytes,
      totalGB: Number((totalBytes / (1024 ** 3)).toFixed(2)),
      freeGB: Number((freeBytes / (1024 ** 3)).toFixed(2)),
      usedGB: Number((usedBytes / (1024 ** 3)).toFixed(2)),
      porcentajeUso
    };
  } catch (err) {
    disco = {
      ruta: rootPath,
      error: `No disponible: ${err.message}`
    };
  }

  return {
    servidor: {
      plataforma: process.platform,
      arquitectura: process.arch,
      versionNode: process.version,
      uptimeSistemaSegundos: Math.floor(os.uptime()),
      uptimeProcesoSegundos: Math.floor(process.uptime())
    },
    cpu: {
      nucleos: cpus.length,
      modelo: cpus[0]?.model || 'Desconocido',
      velocidadMhz: cpus[0]?.speed || 0,
      cargaMedia: {
        unMinuto: Number(loadAvg[0].toFixed(2)),
        cincoMinutos: Number(loadAvg[1].toFixed(2)),
        quinceMinutos: Number(loadAvg[2].toFixed(2))
      }
    },
    memoria: {
      totalBytes: totalmem,
      libreBytes: freemem,
      usadaBytes: usedmem,
      totalGB: Number((totalmem / (1024 ** 3)).toFixed(2)),
      libreGB: Number((freemem / (1024 ** 3)).toFixed(2)),
      usadaGB: Number((usedmem / (1024 ** 3)).toFixed(2)),
      porcentajeUso: Number(((usedmem / totalmem) * 100).toFixed(2))
    },
    disco
  };
}

/**
 * Inspecciona el estado de los contenedores Docker locales o de un contenedor especifico.
 *
 * @param {string} [contenedor] - Nombre o ID opcional del contenedor
 * @returns {Promise<object>} Estado de los contenedores
 */
export async function inspeccionarDocker(contenedor = '') {
  return new Promise((resolve) => {
    const args = ['ps', '-a', '--format', '{{json .}}'];
    const target = typeof contenedor === 'string' ? contenedor.trim() : '';
    if (target) {
      args.push('--filter', `name=${target}`);
    }

    execFile('docker', args, { timeout: 10000, windowsHide: true }, (err, stdout, stderr) => {
      if (err) {
        resolve({
          disponible: false,
          error: err.code === 'ENOENT'
            ? 'Docker CLI no se encuentra instalado en el sistema'
            : (stderr || err.message).trim(),
          contenedores: []
        });
        return;
      }

      const lines = stdout.split('\n').map((l) => l.trim()).filter(Boolean);
      const contenedores = [];

      for (const line of lines) {
        try {
          const parsed = JSON.parse(line);
          contenedores.push({
            id: parsed.ID || parsed.Id || '',
            nombre: (parsed.Names || parsed.Name || '').replace(/^\//, ''),
            imagen: parsed.Image || '',
            estado: parsed.State || parsed.Status || '',
            creado: parsed.CreatedAt || parsed.RunningFor || '',
            puertos: parsed.Ports || ''
          });
        } catch {
          // Ignorar lineas corruptas
        }
      }

      if (target && contenedores.length === 0) {
        resolve({
          disponible: true,
          total: 0,
          mensaje: `Contenedor no encontrado: ${target}`,
          contenedores: []
        });
        return;
      }

      resolve({
        disponible: true,
        total: contenedores.length,
        contenedores
      });
    });
  });
}

/**
 * Comprueba el espacio libre y ocupado en una particion de disco y activa alerta si supera el umbral (por defecto 85%).
 *
 * @param {string} [rutaDeseada] - Ruta de montaje o particion
 * @param {number} [umbralAlerta=85] - Porcentaje umbral para alerta
 * @returns {Promise<object>} Metricas de almacenamiento y estado de alerta
 */
export async function verificarAlmacenamiento(rutaDeseada = '', umbralAlerta = 85) {
  let ruta = typeof rutaDeseada === 'string' && rutaDeseada.trim() ? rutaDeseada.trim() : '';
  if (!ruta) {
    ruta = process.platform === 'win32'
      ? (process.env.SystemDrive || 'C:') + '\\'
      : '/';
  }

  const threshold = typeof umbralAlerta === 'number' && !Number.isNaN(umbralAlerta) ? umbralAlerta : 85;

  try {
    const stats = fs.statfsSync(ruta);
    const bsize = BigInt(stats.bsize);
    const totalBytes = Number(bsize * BigInt(stats.blocks));
    const freeBytes = Number(bsize * BigInt(stats.bavail));
    const usedBytes = totalBytes >= freeBytes ? totalBytes - freeBytes : 0;
    const porcentajeUso = totalBytes > 0
      ? Number(((usedBytes / totalBytes) * 100).toFixed(2))
      : 0;
    const alertaUsoCritico = porcentajeUso > threshold;

    return {
      ok: true,
      ruta,
      totalBytes,
      freeBytes,
      usedBytes,
      totalGB: Number((totalBytes / (1024 ** 3)).toFixed(2)),
      freeGB: Number((freeBytes / (1024 ** 3)).toFixed(2)),
      usedGB: Number((usedBytes / (1024 ** 3)).toFixed(2)),
      porcentajeUso,
      umbralAlerta: threshold,
      alertaUsoCritico,
      mensaje: alertaUsoCritico
        ? `ALERTA: El uso de almacenamiento en ${ruta} supera el umbral del ${threshold}% (actual: ${porcentajeUso}%)`
        : `Almacenamiento en ${ruta} dentro de parametros normales (actual: ${porcentajeUso}%)`
    };
  } catch (err) {
    return {
      ok: false,
      ruta,
      error: `Error al consultar almacenamiento en ${ruta}: ${err.message}`
    };
  }
}

/**
 * Comprueba la fecha de caducidad y estado de validez de certificados SSL/TLS para el dominio especificado.
 *
 * @param {string} dominio - Dominio o hostname
 * @param {number} [puerto=443] - Puerto TLS
 * @param {number} [timeoutMs=10000] - Tiempo de espera maximo en ms
 * @returns {Promise<object>} Informacion de validez y caducidad del certificado
 */
export async function comprobarCertificadosSsl(dominio, puerto = 443, timeoutMs = 10000) {
  if (!dominio || typeof dominio !== 'string' || !dominio.trim()) {
    throw new TypeError('El parametro dominio es obligatorio y debe ser una cadena no vacia');
  }

  const host = dominio.trim().replace(/^https?:\/\//i, '').split('/')[0].split(':')[0];
  const port = Number(puerto) > 0 ? Number(puerto) : 443;
  const timeout = Number(timeoutMs) > 0 ? Number(timeoutMs) : 10000;

  return new Promise((resolve) => {
    let resolved = false;
    let timer = null;

    const finalize = (result) => {
      if (resolved) return;
      resolved = true;
      if (timer) clearTimeout(timer);
      try {
        if (socket && !socket.destroyed) {
          socket.destroy();
        }
      } catch {
        // Ignorar excepciones al cerrar el socket
      }
      resolve(result);
    };

    timer = setTimeout(() => {
      finalize({
        valido: false,
        host,
        puerto: port,
        error: 'Timeout al conectar con el servidor TLS'
      });
    }, timeout);

    const socket = tls.connect(
      {
        host,
        port,
        servername: host,
        rejectUnauthorized: false
      },
      () => {
        try {
          const cert = socket.getPeerCertificate();
          if (!cert || !cert.valid_to) {
            finalize({
              valido: false,
              host,
              puerto: port,
              error: 'No se pudo obtener el certificado del servidor remoto'
            });
            return;
          }

          const validFrom = new Date(cert.valid_from).toISOString();
          const validTo = new Date(cert.valid_to).toISOString();
          const validToMs = new Date(cert.valid_to).getTime();
          const nowMs = Date.now();
          const diasRestantes = Math.floor((validToMs - nowMs) / (1000 * 60 * 60 * 24));
          const caducado = diasRestantes <= 0;
          const proximoACaducar = diasRestantes <= 15;

          finalize({
            valido: !caducado,
            host,
            puerto: port,
            diasRestantes,
            caducado,
            proximoACaducar,
            validoDesde: validFrom,
            validoHasta: validTo,
            sujeto: cert.subject?.CN || host,
            emisor: cert.issuer?.O || cert.issuer?.CN || 'Desconocido',
            huellaDigital: cert.fingerprint256 || cert.fingerprint || ''
          });
        } catch (err) {
          finalize({
            valido: false,
            host,
            puerto: port,
            error: err.message
          });
        }
      }
    );

    socket.on('error', (err) => {
      finalize({
        valido: false,
        host,
        puerto: port,
        error: err.message
      });
    });
  });
}

/**
 * Catalogo de herramientas expuestas por mcp-server-devops segun especificacion MCP.
 *
 * @returns {Array<object>} Lista de esquemas de herramientas
 */
export function getToolsList() {
  return [
    {
      name: 'ejecutar_comando_bash',
      description: 'Ejecuta un comando en shell bash de forma aislada con limite estricto de tiempo de ejecucion.',
      inputSchema: {
        type: 'object',
        properties: {
          comando: {
            type: 'string',
            description: 'Comando bash a ejecutar.'
          },
          timeout_ms: {
            type: 'number',
            description: 'Tiempo maximo en milisegundos antes de abortar la ejecucion (por defecto 10000ms).'
          }
        },
        required: ['comando']
      }
    },
    {
      name: 'consultar_estado_servidor',
      description: 'Obtiene la telemetria actual del servidor: uso y carga de CPU, consumo de memoria RAM, uso de disco y tiempo de actividad (uptime).',
      inputSchema: {
        type: 'object',
        properties: {}
      }
    },
    {
      name: 'inspeccionar_docker',
      description: 'Inspecciona el estado de los contenedores Docker locales o de un contenedor especifico.',
      inputSchema: {
        type: 'object',
        properties: {
          contenedor: {
            type: 'string',
            description: 'Nombre o ID opcional del contenedor Docker a inspeccionar. Si se omite, inspecciona todos los contenedores.'
          }
        }
      }
    },
    {
      name: 'verificar_almacenamiento',
      description: 'Comprueba el espacio libre y ocupado en las particiones de almacenamiento del servidor, emitiendo una alerta si la ocupacion supera el 85%.',
      inputSchema: {
        type: 'object',
        properties: {
          ruta: {
            type: 'string',
            description: 'Ruta opcional del punto de montaje o particion a verificar.'
          },
          umbral_alerta: {
            type: 'number',
            description: 'Porcentaje umbral para disparar la alerta (por defecto 85%).'
          }
        }
      }
    },
    {
      name: 'comprobar_certificados_ssl',
      description: 'Verifica la fecha de caducidad y estado de validez de certificados SSL/TLS para el dominio especificado.',
      inputSchema: {
        type: 'object',
        properties: {
          dominio: {
            type: 'string',
            description: 'Nombre de dominio o host a comprobar (por ejemplo, davidcastellanos.es o google.com).'
          },
          puerto: {
            type: 'number',
            description: 'Puerto SSL/TLS opcional (por defecto 443).'
          },
          timeout_ms: {
            type: 'number',
            description: 'Tiempo maximo de espera en ms (por defecto 10000).'
          }
        },
        required: ['dominio']
      }
    }
  ];
}

/**
 * Ejecuta una herramienta del catalogo devops por su nombre y argumentos.
 *
 * @param {string} name - Nombre de la herramienta
 * @param {object} args - Argumentos de la invocacion
 * @returns {Promise<any>} Resultado de la ejecucion
 */
export async function executeTool(name, args = {}) {
  switch (name) {
    case 'ejecutar_comando_bash': {
      const { comando, timeout_ms } = args;
      return await ejecutarComandoBash(comando, timeout_ms);
    }
    case 'consultar_estado_servidor': {
      return await consultarEstadoServidor();
    }
    case 'inspeccionar_docker': {
      const { contenedor } = args;
      return await inspeccionarDocker(contenedor);
    }
    case 'verificar_almacenamiento': {
      const { ruta, umbral_alerta } = args;
      return await verificarAlmacenamiento(ruta, umbral_alerta);
    }
    case 'comprobar_certificados_ssl': {
      const { dominio, puerto, timeout_ms } = args;
      return await comprobarCertificadosSsl(dominio, puerto, timeout_ms);
    }
    default:
      throw new Error(`Herramienta no reconocida: ${name}`);
  }
}

/**
 * Envia un mensaje JSON-RPC 2.0 formateado a stdout.
 *
 * @param {object} payload - Mensaje a emitir
 */
export function sendResponse(payload) {
  process.stdout.write(JSON.stringify(payload) + '\n');
}

/**
 * Procesa un mensaje JSON-RPC entrante y genera la respuesta correspondiente.
 *
 * @param {object} msg - Mensaje JSON-RPC recibido
 */
export async function handleMessage(msg) {
  if (!msg || typeof msg !== 'object') {
    sendResponse({
      jsonrpc: '2.0',
      id: null,
      error: { code: -32600, message: 'Invalid Request' }
    });
    return;
  }

  const { id, method, params } = msg;

  const idValido = id === undefined || id === null || typeof id === 'string' || typeof id === 'number';
  if (!idValido) {
    sendResponse({
      jsonrpc: '2.0',
      id: null,
      error: { code: -32600, message: 'Invalid Request: id invalido' }
    });
    return;
  }

  if (typeof method !== 'string' || !method) {
    if (id !== undefined) {
      sendResponse({
        jsonrpc: '2.0',
        id: id ?? null,
        error: { code: -32600, message: 'Invalid Request: method invalido' }
      });
    }
    return;
  }

  if (method === 'initialize') {
    sendResponse({
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {
          tools: {}
        },
        serverInfo: {
          name: SERVER_NAME,
          version: SERVER_VERSION
        }
      }
    });
    return;
  }

  if (method === 'notifications/initialized') {
    if (id !== undefined && id !== null) {
      sendResponse({
        jsonrpc: '2.0',
        id,
        result: {}
      });
    }
    return;
  }

  if (method === 'ping') {
    sendResponse({
      jsonrpc: '2.0',
      id,
      result: {}
    });
    return;
  }

  if (method === 'tools/list') {
    sendResponse({
      jsonrpc: '2.0',
      id,
      result: {
        tools: getToolsList()
      }
    });
    return;
  }

  if (method === 'tools/call') {
    const toolName = params?.name;
    const toolArgs = params?.arguments || {};

    try {
      const result = await executeTool(toolName, toolArgs);
      sendResponse({
        jsonrpc: '2.0',
        id,
        result: {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result)
            }
          ],
          isError: false
        }
      });
    } catch (err) {
      sendResponse({
        jsonrpc: '2.0',
        id,
        result: {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ error: err.message || String(err) })
            }
          ],
          isError: true
        }
      });
    }
    return;
  }

  if (id !== undefined) {
    sendResponse({
      jsonrpc: '2.0',
      id: id ?? null,
      error: {
        code: -32601,
        message: `Metodo no encontrado: ${method}`
      }
    });
  }
}

/**
 * Inicia el bucle de escucha JSON-RPC 2.0 sobre stdin.
 */
export function startServer() {
  const rl = readline.createInterface({
    input: process.stdin,
    terminal: false,
    crlfDelay: Infinity
  });

  rl.on('line', async (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;

    let parsed;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      sendResponse({
        jsonrpc: '2.0',
        id: null,
        error: { code: -32700, message: 'Parse error' }
      });
      return;
    }

    try {
      await handleMessage(parsed);
    } catch (err) {
      sendResponse({
        jsonrpc: '2.0',
        id: parsed?.id ?? null,
        error: { code: -32603, message: `Internal error: ${err.message}` }
      });
    }
  });

  process.on('SIGINT', () => process.exit(0));
  process.on('SIGTERM', () => process.exit(0));
}

// Comprobacion de ejecucion directa como script CLI
const currentFilePath = fileURLToPath(import.meta.url);
const executedFilePath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (executedFilePath && currentFilePath === executedFilePath) {
  startServer();
}
