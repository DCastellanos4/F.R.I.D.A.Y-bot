#!/usr/bin/env node
/**
 * index.js - Micro-servidor MCP mcp-server-finance para D.A.V.I.S.
 *
 * Implementa el protocolo Model Context Protocol (MCP) sobre JSON-RPC 2.0 por stdio.
 * Proporciona herramientas de contabilidad, persistencia de gastos y extraccion OCR de tickets.
 *
 * Herramientas expuestas:
 *   - extraer_ticket_vision: OCR de tickets/facturas con formato estructurado (cif, base, iva, total)
 *   - registrar_gasto: persistencia contable en SQLite de gastos (monto, categoria, concepto, fecha)
 *   - exportar_resumen_trimestral: calculo de IVA e importes agrupados por trimestre
 *
 * Strict Policy: Zero Emojis.
 */
import readline from 'node:readline';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { crearFinanceDb } from './db.js';
import { extraerTicketVision } from './ocr.js';

export const TOOLS_SCHEMA = [
  {
    name: 'extraer_ticket_vision',
    description: 'OCR de tickets y facturas para extraer campos estructurados (cif, base, iva, total).',
    inputSchema: {
      type: 'object',
      properties: {
        imagen_base64: {
          type: 'string',
          description: 'Imagen del ticket en formato base64'
        },
        ruta_imagen: {
          type: 'string',
          description: 'Ruta local al archivo de imagen o ticket'
        },
        texto: {
          type: 'string',
          description: 'Texto transcrito o volcado OCR del ticket para parseo directo'
        }
      }
    }
  },
  {
    name: 'registrar_gasto',
    description: 'Persistencia contable en SQLite de gastos (monto, categoria, concepto, fecha).',
    inputSchema: {
      type: 'object',
      properties: {
        monto: {
          type: 'number',
          description: 'Importe total del gasto en euros'
        },
        importe: {
          type: 'number',
          description: 'Alias alternativo de monto'
        },
        categoria: {
          type: 'string',
          description: 'Categoria del gasto (ej: alimentacion, oficina, transporte)'
        },
        concepto: {
          type: 'string',
          description: 'Concepto o comercio donde se realizo el gasto'
        },
        comercio: {
          type: 'string',
          description: 'Alias alternativo de concepto'
        },
        fecha: {
          type: 'string',
          description: 'Fecha del gasto en formato YYYY-MM-DD (por defecto hoy)'
        },
        base: {
          type: 'number',
          description: 'Base imponible antes de impuestos (opcional)'
        },
        iva: {
          type: 'number',
          description: 'Cuota de IVA aplicada (opcional)'
        }
      },
      required: ['categoria']
    }
  },
  {
    name: 'exportar_resumen_trimestral',
    description: 'Calculo de IVA e importes agrupados por trimestre a partir de gastos en SQLite.',
    inputSchema: {
      type: 'object',
      properties: {
        anio: {
          type: 'number',
          description: 'Ano fiscal a consultar (ej: 2026)'
        },
        trimestre: {
          type: 'string',
          description: 'Trimestre opcional a consultar (1..4, T1..T4 o Q1..Q4)'
        }
      },
      required: ['anio']
    }
  }
];

export function crearManejadorRpc(financeDb, { ocrFn } = {}) {
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
            name: 'mcp-server-finance',
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
          case 'extraer_ticket_vision':
            datosResultado = await extraerTicketVision({
              imagen_base64: args.imagen_base64,
              ruta_imagen: args.ruta_imagen,
              texto: args.texto,
              ocrFn
            });
            break;

          case 'registrar_gasto':
            datosResultado = financeDb.registrarGasto({
              monto: args.monto,
              importe: args.importe,
              categoria: args.categoria,
              concepto: args.concepto,
              comercio: args.comercio,
              fecha: args.fecha,
              base: args.base,
              iva: args.iva
            });
            break;

          case 'exportar_resumen_trimestral':
            datosResultado = financeDb.exportarResumenTrimestral({
              anio: args.anio,
              trimestre: args.trimestre
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

export function iniciarServidor(dbInstancia = crearFinanceDb()) {
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
