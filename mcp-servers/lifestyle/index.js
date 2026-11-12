#!/usr/bin/env node
/**
 * index.js - Micro-servidor MCP mcp-server-lifestyle para D.A.V.I.S.
 *
 * Implementa el protocolo Model Context Protocol (MCP) sobre JSON-RPC 2.0 por stdio.
 * Proporciona herramientas de habitos personales, lista de compra, consulta de trenes Renfe
 * y radar de precios de vuelos.
 *
 * Herramientas expuestas:
 *   - gestionar_habitos: registrar, marcar y listar habitos/rachas
 *   - gestionar_lista_compra: anadir, listar y tachar items de la compra
 *   - consultar_trenes_renfe: consulta determinista de horarios Renfe (fuente GTFS/estaciones)
 *   - consultar_radar_vuelos: busqueda de precios/rutas de vuelos
 *
 * Strict Policy: Zero Emojis.
 */
import readline from 'node:readline';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { crearLifestyleDb } from './db.js';
import { consultarTrenesRenfe, consultarRadarVuelos } from './transport.js';

export const TOOLS_SCHEMA = [
  {
    name: 'gestionar_habitos',
    description: 'Gestiona habitos: registrar nuevo habito, marcar cumplimiento diario y listar habitos con calculo de rachas.',
    inputSchema: {
      type: 'object',
      properties: {
        accion: {
          type: 'string',
          enum: ['registrar', 'marcar', 'listar'],
          description: 'Accion a realizar: registrar, marcar o listar'
        },
        nombre: {
          type: 'string',
          description: 'Nombre del habito (para accion registrar)'
        },
        criterio: {
          type: 'string',
          description: 'ID o fragmento del nombre del habito a marcar'
        },
        fecha: {
          type: 'string',
          description: 'Fecha en formato YYYY-MM-DD para marcar (por defecto hoy)'
        }
      },
      required: ['accion']
    }
  },
  {
    name: 'gestionar_lista_compra',
    description: 'Gestiona la lista de la compra: anadir items, listar items pendientes, tachar items comprados o vaciar lista.',
    inputSchema: {
      type: 'object',
      properties: {
        accion: {
          type: 'string',
          enum: ['anadir', 'listar', 'tachar', 'vaciar'],
          description: 'Accion a realizar: anadir, listar, tachar o vaciar'
        },
        item: {
          type: 'string',
          description: 'Nombre del item a anadir'
        },
        items: {
          type: 'array',
          items: { type: 'string' },
          description: 'Lista de items a anadir en lote'
        },
        criterio: {
          type: 'string',
          description: 'ID o texto del item a tachar de la lista'
        }
      },
      required: ['accion']
    }
  },
  {
    name: 'consultar_trenes_renfe',
    description: 'Consulta determinista de horarios y rutas de trenes Renfe (Cercanias y Media/Larga Distancia) a partir de fuentes GTFS y estaciones oficiales.',
    inputSchema: {
      type: 'object',
      properties: {
        origen: {
          type: 'string',
          description: 'Estacion de origen (ej: Madrid-Atocha, Chamartin, Aranjuez)'
        },
        destino: {
          type: 'string',
          description: 'Estacion de destino (ej: Barcelona-Sants, Valencia, Sevilla)'
        },
        fecha: {
          type: 'string',
          description: 'Fecha del viaje en formato YYYY-MM-DD (opcional)'
        },
        hora_minima: {
          type: 'string',
          description: 'Hora minima de salida en formato HH:MM (opcional)'
        },
        tipo: {
          type: 'string',
          description: 'Filtro por tipo de tren (AVE, Cercanias, Alvia o todos)'
        }
      },
      required: ['origen', 'destino']
    }
  },
  {
    name: 'consultar_radar_vuelos',
    description: 'Busqueda y monitorizacion de rutas y precios de vuelos entre aeropuertos y ciudades.',
    inputSchema: {
      type: 'object',
      properties: {
        origen: {
          type: 'string',
          description: 'Aeropuerto o ciudad de origen (ej: MAD, Madrid)'
        },
        destino: {
          type: 'string',
          description: 'Aeropuerto o ciudad de destino (ej: LIS, Lisboa, BCN)'
        },
        fecha: {
          type: 'string',
          description: 'Fecha del vuelo en formato YYYY-MM-DD'
        },
        precio_maximo: {
          type: 'number',
          description: 'Filtro de precio maximo en euros (opcional)'
        },
        aerolinea: {
          type: 'string',
          description: 'Filtro por nombre o codigo de aerolinea (opcional)'
        },
        solo_directos: {
          type: 'boolean',
          description: 'Filtrar solo vuelos sin escalas (opcional)'
        }
      },
      required: ['origen', 'destino', 'fecha']
    }
  }
];

export function crearManejadorRpc(lifestyleDb) {
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

    // Notificaciones
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
            name: 'mcp-server-lifestyle',
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
          case 'gestionar_habitos': {
            const accion = args.accion || (args.nombre ? 'registrar' : (args.criterio ? 'marcar' : 'listar'));
            if (accion === 'registrar') {
              datosResultado = lifestyleDb.registrarHabito({ nombre: args.nombre });
            } else if (accion === 'marcar') {
              datosResultado = lifestyleDb.marcarHabito({
                criterio: args.criterio,
                fecha: args.fecha,
                hoy: args.hoy
              });
            } else if (accion === 'listar') {
              datosResultado = lifestyleDb.listarHabitos({ hoy: args.hoy });
            } else {
              throw new Error(`Accion no valida para gestionar_habitos: ${accion}`);
            }
            break;
          }

          case 'gestionar_lista_compra': {
            const accion = args.accion || (args.item || args.items ? 'anadir' : (args.criterio ? 'tachar' : 'listar'));
            if (accion === 'anadir') {
              datosResultado = lifestyleDb.anadirCompra({ item: args.item, items: args.items });
            } else if (accion === 'listar') {
              datosResultado = lifestyleDb.listarCompra();
            } else if (accion === 'tachar') {
              datosResultado = lifestyleDb.tacharCompra({ criterio: args.criterio });
            } else if (accion === 'vaciar') {
              datosResultado = lifestyleDb.vaciarCompra();
            } else {
              throw new Error(`Accion no valida para gestionar_lista_compra: ${accion}`);
            }
            break;
          }

          case 'consultar_trenes_renfe':
            datosResultado = consultarTrenesRenfe({
              origen: args.origen,
              destino: args.destino,
              fecha: args.fecha,
              hora_minima: args.hora_minima,
              tipo: args.tipo
            });
            break;

          case 'consultar_radar_vuelos':
            datosResultado = consultarRadarVuelos({
              origen: args.origen,
              destino: args.destino,
              fecha: args.fecha,
              precio_maximo: args.precio_maximo,
              aerolinea: args.aerolinea,
              solo_directos: args.solo_directos
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

export function iniciarServidor(dbInstancia = crearLifestyleDb()) {
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

// Auto-arranque al ejecutar como script independiente
const esEjecucionDirecta = Boolean(
  process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
);

if (esEjecucionDirecta && process.env.TEST_IMPORT_ONLY !== 'true') {
  iniciarServidor();
}
