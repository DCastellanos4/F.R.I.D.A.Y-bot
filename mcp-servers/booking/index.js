#!/usr/bin/env node
/**
 * index.js - Micro-servidor MCP mcp-server-booking para D.A.V.I.S.
 *
 * Implementa el protocolo Model Context Protocol (MCP) sobre JSON-RPC 2.0 por stdio.
 * Proporciona herramientas de gestion de citas y huecos de disponibilidad.
 *
 * Herramientas expuestas:
 *   - consultar_disponibilidad: (fecha: string YYYY-MM-DD, duracion_minutos?: number)
 *   - reservar_cita: (cliente_nombre, cliente_telefono, fecha_inicio ISO, duracion_minutos, servicio)
 *   - cancelar_cita: (cita_id o telefono + fecha)
 *   - listar_citas: (fecha?: string, cliente_telefono?: string)
 *
 * Strict Policy: Zero Emojis.
 */
import readline from 'node:readline';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { crearBookingDb } from './db.js';

export const TOOLS_SCHEMA = [
  {
    name: 'consultar_disponibilidad',
    description: 'Consulta huecos disponibles para citas en una fecha segun horario comercial (09:00 - 20:00).',
    inputSchema: {
      type: 'object',
      properties: {
        fecha: {
          type: 'string',
          description: 'Fecha a consultar en formato YYYY-MM-DD'
        },
        duracion_minutos: {
          type: ['number', 'null'],
          description: 'Duracion estimada de la cita en minutos (opcional, por defecto 30)'
        }
      },
      required: ['fecha']
    }
  },
  {
    name: 'reservar_cita',
    description: 'Reserva una nueva cita verificando ausencia de colisiones y persistiendo en base de datos SQLite.',
    inputSchema: {
      type: 'object',
      properties: {
        cliente_nombre: {
          type: 'string',
          description: 'Nombre completo del cliente'
        },
        cliente_telefono: {
          type: 'string',
          description: 'Numero de telefono del cliente'
        },
        fecha_inicio: {
          type: 'string',
          description: 'Fecha y hora de inicio en formato ISO 8601'
        },
        duracion_minutos: {
          type: 'number',
          description: 'Duracion de la cita en minutos'
        },
        servicio: {
          type: 'string',
          description: 'Descripcion del servicio solicitado'
        }
      },
      required: ['cliente_nombre', 'cliente_telefono', 'fecha_inicio', 'duracion_minutos', 'servicio']
    }
  },
  {
    name: 'cancelar_cita',
    description: 'Cancela o libera una cita/reserva activa por ID, por nombre del cliente, o por combinacion de telefono y fecha.',
    inputSchema: {
      type: 'object',
      properties: {
        cita_id: {
          type: ['string', 'null'],
          description: 'Identificador unico de la cita'
        },
        cliente_nombre: {
          type: ['string', 'null'],
          description: 'Nombre del cliente para localizar y cancelar/liberar la cita'
        },
        cliente_telefono: {
          type: ['string', 'null'],
          description: 'Telefono del cliente para localizar la cita'
        },
        telefono: {
          type: ['string', 'null'],
          description: 'Alias alternativo de cliente_telefono'
        },
        fecha: {
          type: ['string', 'null'],
          description: 'Fecha de la cita (YYYY-MM-DD o ISO) para localizarla con el telefono o nombre'
        }
      }
    }
  },
  {
    name: 'listar_citas',
    description: 'Consulta y lista las citas de la agenda registradas en el sistema. Usar cuando el usuario pregunte por sus citas ("que citas tengo", "ver agenda", "citas de hoy", "citas de manana", etc.). Permite filtros opcionales de fecha (YYYY-MM-DD), telefono o nombre del cliente. Si no se especifican filtros, devuelve todas las citas activas.',
    inputSchema: {
      type: 'object',
      properties: {
        fecha: {
          type: ['string', 'null'],
          description: 'Filtrar citas por fecha YYYY-MM-DD (opcional)'
        },
        cliente_telefono: {
          type: ['string', 'null'],
          description: 'Filtrar citas por telefono del cliente (opcional)'
        },
        cliente_nombre: {
          type: ['string', 'null'],
          description: 'Filtrar citas por nombre del cliente (opcional)'
        },
        estado: {
          type: ['string', 'null'],
          description: 'Filtrar por estado: "confirmada", "cancelada" o "todas" (por defecto "confirmada")'
        }
      }
    }
  }
];

export function crearManejadorRpc(bookingDb) {
  return async function procesarPeticion(solicitud) {
    if (!solicitud || typeof solicitud !== 'object') {
      return {
        jsonrpc: '2.0',
        id: null,
        error: { code: -32600, message: 'Invalid Request: se esperaba un objeto JSON' }
      };
    }

    const { id, method, params } = solicitud;

    const idValido = id === undefined || id === null || typeof id === 'string' || typeof id === 'number';
    if (!idValido) {
      return {
        jsonrpc: '2.0',
        id: null,
        error: { code: -32600, message: 'Invalid Request: id invalido' }
      };
    }

    if (typeof method !== 'string' || !method) {
      if (id !== undefined) {
        return {
          jsonrpc: '2.0',
          id: id ?? null,
          error: { code: -32600, message: 'Invalid Request: method invalido' }
        };
      }
      return null;
    }

    // Notificaciones: no devuelven respuesta a menos que se haya proporcionado un id
    if (method === 'notifications/initialized' || method === 'initialized') {
      if (id !== undefined && id !== null) {
        return {
          jsonrpc: '2.0',
          id,
          result: { acknowledged: true }
        };
      }
      return null;
    }

    if (method === 'initialize') {
      return {
        jsonrpc: '2.0',
        id: id ?? null,
        result: {
          protocolVersion: params?.protocolVersion || '2024-11-05',
          capabilities: {
            tools: {}
          },
          serverInfo: {
            name: 'mcp-server-booking',
            version: '1.0.0'
          }
        }
      };
    }

    if (method === 'tools/list') {
      return {
        jsonrpc: '2.0',
        id: id ?? null,
        result: {
          tools: TOOLS_SCHEMA
        }
      };
    }

    if (method === 'tools/call') {
      const nombreHerramienta = params?.name;
      const args = params?.arguments || {};

      try {
        let datosResultado;
        switch (nombreHerramienta) {
          case 'consultar_disponibilidad':
            datosResultado = bookingDb.consultarDisponibilidad({
              fecha: args.fecha,
              duracion_minutos: args.duracion_minutos,
              hora_apertura: args.hora_apertura,
              hora_cierre: args.hora_cierre,
              paso_minutos: args.paso_minutos
            });
            break;

          case 'reservar_cita':
            datosResultado = bookingDb.reservarCita({
              cliente_nombre: args.cliente_nombre,
              cliente_telefono: args.cliente_telefono || args.telefono,
              fecha_inicio: args.fecha_inicio,
              duracion_minutos: args.duracion_minutos,
              servicio: args.servicio
            });
            break;

          case 'cancelar_cita':
            datosResultado = bookingDb.cancelarCita({
              cita_id: args.cita_id || args.id,
              cliente_telefono: args.cliente_telefono || args.telefono,
              fecha: args.fecha || args.fecha_inicio
            });
            break;

          case 'listar_citas':
            datosResultado = bookingDb.listarCitas({
              fecha: args.fecha,
              cliente_telefono: args.cliente_telefono || args.telefono,
              cliente_nombre: args.cliente_nombre,
              estado: args.estado
            });
            break;

          default:
            return {
              jsonrpc: '2.0',
              id: id ?? null,
              result: {
                content: [
                  {
                    type: 'text',
                    text: JSON.stringify({ ok: false, error: `Herramienta no encontrada: ${nombreHerramienta}` })
                  }
                ],
                isError: true
              }
            };
        }

        const fallido = datosResultado?.ok === false;
        return {
          jsonrpc: '2.0',
          id: id ?? null,
          result: {
            content: [
              {
                type: 'text',
                text: JSON.stringify(datosResultado)
              }
            ],
            isError: fallido
          }
        };
      } catch (err) {
        return {
          jsonrpc: '2.0',
          id: id ?? null,
          result: {
            content: [
              {
                type: 'text',
                text: JSON.stringify({ ok: false, error: err.message })
              }
            ],
            isError: true
          }
        };
      }
    }

    if (method === 'ping') {
      return {
        jsonrpc: '2.0',
        id: id ?? null,
        result: {}
      };
    }

    return {
      jsonrpc: '2.0',
      id: id ?? null,
      error: {
        code: -32601,
        message: `Metodo no encontrado: ${method}`
      }
    };
  };
}

export function iniciarServidor(dbInstancia = crearBookingDb()) {
  const procesar = crearManejadorRpc(dbInstancia);

  const rl = readline.createInterface({
    input: process.stdin,
    terminal: false
  });

  rl.on('line', async (linea) => {
    const limpia = linea.trim();
    if (!limpia) return;
    try {
      const parsed = JSON.parse(limpia);
      const respuesta = await procesar(parsed);
      if (respuesta !== null && respuesta !== undefined) {
        process.stdout.write(JSON.stringify(respuesta) + '\n');
      }
    } catch (err) {
      const errorParse = {
        jsonrpc: '2.0',
        id: null,
        error: {
          code: -32700,
          message: `Parse error: ${err.message}`
        }
      };
      process.stdout.write(JSON.stringify(errorParse) + '\n');
    }
  });

  function cerrarRecursos() {
    try {
      dbInstancia.cerrar();
    } catch (_) {}
  }

  rl.on('close', () => {
    cerrarRecursos();
    process.exit(0);
  });

  process.on('SIGINT', () => {
    cerrarRecursos();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    cerrarRecursos();
    process.exit(0);
  });

  return { rl, dbInstancia, procesar };
}

// Auto-arranque cuando se ejecuta como script ejecutable directo
const esEjecucionDirecta = Boolean(
  process.argv[1] &&
  (() => {
    try {
      return fs.realpathSync(path.resolve(process.argv[1])) === fs.realpathSync(fileURLToPath(import.meta.url));
    } catch {
      return pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
    }
  })()
);

if (esEjecucionDirecta && process.env.TEST_IMPORT_ONLY !== 'true') {
  iniciarServidor();
}
