/**
 * Servidor MCP falso para pruebas automatizadas via stdio.
 *
 * Simula el protocolo Model Context Protocol (MCP) version JSON-RPC 2.0.
 * Strict Policy: Zero Emojis.
 */

import readline from 'node:readline';

const args = process.argv.slice(2);
const domainArg = args.find((a) => a.startsWith('--domain='));
const domain = domainArg ? domainArg.split('=')[1] : 'booking';
const ignoreSigterm = args.includes('--ignore-sigterm');

if (ignoreSigterm) {
  process.on('SIGTERM', () => {
    // Ignora SIGTERM intencionadamente para probar fallback SIGKILL
  });
}

const toolsByDomain = {
  booking: [
    {
      name: 'book_flight',
      description: 'Reserva un vuelo comercial',
      inputSchema: {
        type: 'object',
        properties: {
          origin: { type: 'string' },
          destination: { type: 'string' }
        },
        required: ['origin', 'destination']
      }
    },
    {
      name: 'cancel_flight',
      description: 'Cancela un vuelo existente',
      inputSchema: {
        type: 'object',
        properties: {
          bookingId: { type: 'string' }
        },
        required: ['bookingId']
      }
    }
  ],
  devops: [
    {
      name: 'deploy_service',
      description: 'Despliega un microservicio',
      inputSchema: {
        type: 'object',
        properties: {
          serviceName: { type: 'string' },
          version: { type: 'string' }
        },
        required: ['serviceName']
      }
    }
  ]
};

const rl = readline.createInterface({
  input: process.stdin,
  crlfDelay: Infinity
});

rl.on('line', (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;

  let msg;
  try {
    msg = JSON.parse(trimmed);
  } catch {
    return;
  }

  // Notificaciones no devuelven respuesta
  if (msg.method === 'notifications/initialized') {
    return;
  }

  if (msg.method === 'initialize') {
    const res = {
      jsonrpc: '2.0',
      id: msg.id,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: {
          tools: {}
        },
        serverInfo: {
          name: `fake-${domain}-server`,
          version: '1.0.0'
        }
      }
    };
    process.stdout.write(JSON.stringify(res) + '\n');
    return;
  }

  if (msg.method === 'tools/list') {
    const tools = toolsByDomain[domain] || toolsByDomain.booking;
    const res = {
      jsonrpc: '2.0',
      id: msg.id,
      result: {
        tools
      }
    };
    process.stdout.write(JSON.stringify(res) + '\n');
    return;
  }

  if (msg.method === 'tools/call') {
    const toolName = msg.params?.name;
    const toolArgs = msg.params?.arguments || {};

    if (toolName === 'slow_tool') {
      // No responde inmediatamente para forzar timeout
      const delayMs = typeof toolArgs.delayMs === 'number' ? toolArgs.delayMs : 10000;
      setTimeout(() => {
        const res = {
          jsonrpc: '2.0',
          id: msg.id,
          result: {
            content: [{ type: 'text', text: 'Respuesta lenta completada' }]
          }
        };
        process.stdout.write(JSON.stringify(res) + '\n');
      }, delayMs);
      return;
    }

    if (toolName === 'crash_tool') {
      // Simula fallo critico del proceso
      process.exit(2);
      return;
    }

    if (toolName === 'simulate_error') {
      const res = {
        jsonrpc: '2.0',
        id: msg.id,
        error: {
          code: -32000,
          message: 'Error simulado en la ejecucion de la herramienta'
        }
      };
      process.stdout.write(JSON.stringify(res) + '\n');
      return;
    }

    if (toolName === 'book_flight') {
      const res = {
        jsonrpc: '2.0',
        id: msg.id,
        result: {
          content: [
            {
              type: 'text',
              text: `Vuelo reservado de ${toolArgs.origin || 'MAD'} a ${toolArgs.destination || 'BCN'}`
            }
          ],
          isError: false
        }
      };
      process.stdout.write(JSON.stringify(res) + '\n');
      return;
    }

    if (toolName === 'deploy_service') {
      const res = {
        jsonrpc: '2.0',
        id: msg.id,
        result: {
          content: [
            {
              type: 'text',
              text: `Servicio ${toolArgs.serviceName} desplegado en version ${toolArgs.version || 'latest'}`
            }
          ],
          isError: false
        }
      };
      process.stdout.write(JSON.stringify(res) + '\n');
      return;
    }

    // Herramienta desconocida
    const res = {
      jsonrpc: '2.0',
      id: msg.id,
      error: {
        code: -32601,
        message: `Herramienta desconocida: ${toolName}`
      }
    };
    process.stdout.write(JSON.stringify(res) + '\n');
  }
});
