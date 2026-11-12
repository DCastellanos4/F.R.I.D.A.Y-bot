/**
 * tests/sector3/mcp_agent_wiring.test.js
 *
 * Pruebas de cableado del registro MCP en el agente J.A.R.V.I.S. / D.A.V.I.S.:
 * 1. Turno completo del agente con telemetria del servidor delegando en mcp-server-devops via stdio.
 * 2. Turno completo de reserva de cita delegando en mcp-server-booking via stdio.
 * 3. Fallback transparente cuando MCP esta desactivado (DAVIS_MCP_ENABLED=0 o no configurado).
 *
 * Strict Policy: Zero Emojis.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import { crearContenedor } from '../../src/composition/container.js';
import { crearMcpClientAdapter } from '../../src/adapters/outbound/mcp/mcpClientAdapter.js';
import { crearMcpRegistry } from '../../src/adapters/outbound/mcp/mcpRegistry.js';
import { consultarJarvis } from '../../src/core/jarvisAgent.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '../../');

test('MCP Wiring 1: Turno completo de agente para telemetria delegando en mcp-server-devops', async () => {
  const devopsAdapter = crearMcpClientAdapter({
    name: 'mcp-server-devops',
    command: process.execPath,
    args: [path.resolve(REPO_ROOT, 'mcp-servers/devops/index.js')],
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      NODE_ENV: 'test'
    }
  });

  const registry = crearMcpRegistry();
  registry.registerServer('devops', devopsAdapter);

  let capturedToolCall = null;
  let capturedToolResult = null;
  let rounds = 0;

  const mockChatCompletion = async (payload) => {
    rounds++;
    if (rounds === 1) {
      // Verificar que las herramientas MCP estan disponibles para el modelo
      const toolNames = (payload.tools || []).map(t => t.function?.name);
      assert.ok(toolNames.includes('consultar_estado_servidor'), 'El catalogo incluye consultar_estado_servidor');

      return {
        message: {
          content: '',
          tool_calls: [
            {
              id: 'call_devops_test_1',
              function: {
                name: 'consultar_estado_servidor',
                arguments: '{}'
              }
            }
          ]
        }
      };
    }

    if (rounds === 2) {
      // Capturar la observacion recibida por el LLM en la ronda 2
      const toolMsg = payload.messages.find(m => m.role === 'tool' && m.tool_call_id === 'call_devops_test_1');
      assert.ok(toolMsg, 'El historial incluye el mensaje con rol tool');
      capturedToolResult = JSON.parse(toolMsg.content);

      return {
        message: {
          content: `Estado del servidor verificado. CPU con ${capturedToolResult.cpu?.nucleos} nucleos y memoria libre de ${capturedToolResult.memoria?.libreGB} GB.`
        }
      };
    }

    return {
      message: {
        content: 'Finalizado.'
      }
    };
  };

  try {
    const respuesta = await consultarJarvis('consulta el estado del servidor', [], {
      mcpRegistry: registry,
      chatCompletion: mockChatCompletion,
      chatId: 'test-mcp-devops-' + Date.now()
    });

    assert.ok(respuesta, 'El agente produce respuesta final');
    assert.match(respuesta, /Estado del servidor verificado/);
    assert.ok(capturedToolResult, 'Se capturo el resultado de la herramienta MCP');
    assert.ok(capturedToolResult.servidor, 'La respuesta contiene datos de servidor');
    assert.ok(capturedToolResult.cpu, 'La respuesta contiene telemetria de CPU');
    assert.ok(capturedToolResult.memoria, 'La respuesta contiene telemetria de memoria');
    assert.ok(typeof capturedToolResult.cpu.nucleos === 'number', 'Nucleos de CPU numericos');
  } finally {
    await registry.close();
  }
});

test('MCP Wiring 2: Turno completo de reserva delegando en mcp-server-booking via stdio', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-booking-test-'));
  const bookingDbPath = path.join(tempDir, 'test_booking.db');

  const bookingAdapter = crearMcpClientAdapter({
    name: 'mcp-server-booking',
    command: process.execPath,
    args: [path.resolve(REPO_ROOT, 'mcp-servers/booking/index.js')],
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      BOOKING_DB_PATH: bookingDbPath,
      NODE_ENV: 'test'
    }
  });

  const registry = crearMcpRegistry();
  registry.registerServer('booking', bookingAdapter);

  let capturedToolResult = null;
  let rounds = 0;

  const mockChatCompletion = async (payload) => {
    rounds++;
    if (rounds === 1) {
      // Verificar que el esquema de reservar_cita fue inyectado al LLM
      const toolNames = (payload.tools || []).map(t => t.function?.name);
      assert.ok(toolNames.includes('reservar_cita'), 'El catalogo incluye reservar_cita');

      return {
        message: {
          content: '',
          tool_calls: [
            {
              id: 'call_booking_test_1',
              function: {
                name: 'reservar_cita',
                arguments: JSON.stringify({
                  cliente_nombre: 'David',
                  cliente_telefono: '+34600000000',
                  fecha_inicio: '2026-12-10T11:00:00.000Z',
                  duracion_minutos: 30,
                  servicio: 'Consulta de asesoria'
                })
              }
            }
          ]
        }
      };
    }

    if (rounds === 2) {
      const toolMsg = payload.messages.find(m => m.role === 'tool' && m.tool_call_id === 'call_booking_test_1');
      assert.ok(toolMsg, 'Se recibio mensaje de retorno de herramienta de reserva');
      capturedToolResult = JSON.parse(toolMsg.content);

      return {
        message: {
          content: `Cita reservada correctamente con ID ${capturedToolResult.cita?.id} para ${capturedToolResult.cita?.cliente_nombre}.`
        }
      };
    }

    return {
      message: {
        content: 'Finalizado.'
      }
    };
  };

  try {
    const respuesta = await consultarJarvis('reserva cita el 2026-12-10 a las 11:00 para David', [], {
      mcpRegistry: registry,
      chatCompletion: mockChatCompletion,
      chatId: 'test-mcp-booking-' + Date.now()
    });

    assert.ok(respuesta, 'El agente responde al usuario');
    assert.match(respuesta, /Cita reservada correctamente/);
    assert.ok(capturedToolResult, 'Resultado de booking capturado');
    assert.equal(capturedToolResult.ok, true);
    assert.equal(capturedToolResult.cita.cliente_nombre, 'David');
    assert.equal(capturedToolResult.cita.estado, 'confirmada');
  } finally {
    await registry.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('MCP Wiring 3: Fallback transparente cuando MCP esta desactivado (DAVIS_MCP_ENABLED=0 o no configurado)', async () => {
  const envPrevio = process.env.DAVIS_MCP_ENABLED;
  delete process.env.DAVIS_MCP_ENABLED;

  try {
    const contenedor = crearContenedor({
      mcpRegistry: null
    });

    assert.equal(contenedor.mcpRegistry, null, 'mcpRegistry en el contenedor es null');

    let rounds = 0;
    let toolResultMonolito = null;

    const mockChatCompletion = async (payload) => {
      rounds++;
      if (rounds === 1) {
        return {
          message: {
            content: '',
            tool_calls: [
              {
                id: 'call_fallback_1',
                function: {
                  name: 'consultar_estado_servidor',
                  arguments: '{}'
                }
              }
            ]
          }
        };
      }

      if (rounds === 2) {
        const toolMsg = payload.messages.find(m => m.role === 'tool' && m.tool_call_id === 'call_fallback_1');
        assert.ok(toolMsg, 'Se recibio respuesta de herramienta');
        toolResultMonolito = toolMsg.content;

        return {
          message: {
            content: 'Servidor revisado por via monolitica.'
          }
        };
      }

      return { message: { content: 'Fin' } };
    };

    const respuesta = await contenedor.procesarMensajeEntrante(
      { userId: 'u_fallback', text: 'consulta el estado del servidor', channel: 'cli' },
      { opciones: { chatCompletion: mockChatCompletion, chatId: 'test-fallback-' + Date.now() } }
    );

    assert.ok(respuesta, 'Respuesta recibida');
    assert.match(respuesta, /Servidor revisado por via monolitica/);
    assert.ok(toolResultMonolito, 'El monolito devolvio resultado');
    assert.match(toolResultMonolito, /Salud del sistema/, 'El resultado proviene del monitor monolitico clasico');
  } finally {
    if (envPrevio !== undefined) {
      process.env.DAVIS_MCP_ENABLED = envPrevio;
    } else {
      delete process.env.DAVIS_MCP_ENABLED;
    }
  }
});

test('MCP Wiring 4: Integracion con contenedor cuando DAVIS_MCP_ENABLED=1 arranca micro-servidores reales', async () => {
  const envPrevio = process.env.DAVIS_MCP_ENABLED;
  const dbPrevio = process.env.BOOKING_DB_PATH;
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-cont-test-'));
  const bookingDbPath = path.join(tempDir, 'container_booking.db');

  process.env.DAVIS_MCP_ENABLED = '1';
  process.env.BOOKING_DB_PATH = bookingDbPath;

  let contenedor = null;
  try {
    contenedor = crearContenedor();
    assert.ok(contenedor.mcpRegistry, 'El contenedor instancio mcpRegistry');

    const servers = contenedor.mcpRegistry.listServers();
    assert.ok(servers.includes('booking'), 'Registrado micro-servidor booking');
    assert.ok(servers.includes('devops'), 'Registrado micro-servidor devops');

    // Invocacion directa via contenedor.mcpRegistry
    const resDisp = await contenedor.mcpRegistry.callTool('consultar_disponibilidad', {
      fecha: '2026-11-30',
      duracion_minutos: 30
    });
    assert.equal(resDisp.isError, false);
    const parsedDisp = JSON.parse(resDisp.content[0].text);
    assert.equal(parsedDisp.ok, true);
    assert.equal(parsedDisp.fecha, '2026-11-30');
  } finally {
    if (contenedor?.mcpRegistry) {
      await contenedor.mcpRegistry.close();
    }
    if (envPrevio !== undefined) {
      process.env.DAVIS_MCP_ENABLED = envPrevio;
    } else {
      delete process.env.DAVIS_MCP_ENABLED;
    }
    if (dbPrevio !== undefined) {
      process.env.BOOKING_DB_PATH = dbPrevio;
    } else {
      delete process.env.BOOKING_DB_PATH;
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
test('MCP Wiring 5: Error en llamada MCP es capturado por el sanitizador sin abortar el bucle ReAct', async () => {
  const mockRegistry = {
    hasTool: (name) => name === 'consultar_estado_servidor',
    callTool: async () => {
      const err = new Error('Conexion perdida con el proceso hijo stdio');
      err.code = 'MCP_COMMUNICATION_LOST';
      throw err;
    },
    toolsList: async () => [
      {
        type: 'function',
        function: {
          name: 'consultar_estado_servidor',
          description: 'Consulta estado de servidor.'
        }
      }
    ],
    close: async () => {}
  };

  let toolErrorReported = null;
  let rounds = 0;

  const mockChatCompletion = async (payload) => {
    rounds++;
    if (rounds === 1) {
      return {
        message: {
          content: '',
          tool_calls: [
            {
              id: 'call_failing_mcp_1',
              function: {
                name: 'consultar_estado_servidor',
                arguments: '{}'
              }
            }
          ]
        }
      };
    }

    if (rounds === 2) {
      const toolMsg = payload.messages.find(m => m.role === 'tool' && m.tool_call_id === 'call_failing_mcp_1');
      assert.ok(toolMsg, 'Mensaje tool presente en historial tras fallo');
      toolErrorReported = toolMsg.content;

      return {
        message: {
          content: 'No se pudo consultar el servidor debido a un fallo tecnico temporal.'
        }
      };
    }

    return { message: { content: 'Finalizado' } };
  };

  const respuesta = await consultarJarvis('consulta el estado del servidor', [], {
    mcpRegistry: mockRegistry,
    chatCompletion: mockChatCompletion,
    chatId: 'test-mcp-err-' + Date.now()
  });

  assert.ok(respuesta, 'El agente responde limpiamente');
  assert.match(respuesta, /fallo tecnico temporal/);
  assert.ok(toolErrorReported, 'El error fue reportado al modelo');
  assert.match(toolErrorReported, /Error temporal ejecutando la consulta/);
  assert.match(toolErrorReported, /Conexion perdida/);
});

test('MCP Wiring 6: Deduplicacion en la misma peticion preservada para herramientas mutantes MCP', async () => {
  let callCount = 0;
  const mockRegistry = {
    hasTool: (name) => name === 'reservar_cita',
    callTool: async () => {
      callCount++;
      return {
        content: [{ type: 'text', text: JSON.stringify({ ok: true, id: 'cita-1' }) }],
        isError: false
      };
    },
    toolsList: async () => [
      {
        type: 'function',
        function: {
          name: 'reservar_cita',
          description: 'Reserva cita.'
        }
      }
    ],
    close: async () => {}
  };

  let rounds = 0;
  const args = {
    cliente_nombre: 'David',
    cliente_telefono: '+34600000000',
    fecha_inicio: '2026-12-10T11:00:00.000Z',
    duracion_minutos: 30,
    servicio: 'Consulta'
  };

  const mockChatCompletion = async () => {
    rounds++;
    if (rounds === 1) {
      return {
        message: {
          content: '',
          tool_calls: [
            { id: 'c1', function: { name: 'reservar_cita', arguments: args } },
            { id: 'c2', function: { name: 'reservar_cita', arguments: args } }
          ]
        }
      };
    }
    return { message: { content: 'Proceso completado.' } };
  };

  const respuesta = await consultarJarvis('reserva cita el 2026-12-10 a las 11:00 para David', [], {
    mcpRegistry: mockRegistry,
    chatCompletion: mockChatCompletion,
    chatId: 'test-mcp-dedup-' + Date.now()
  });

  assert.ok(respuesta);
  assert.equal(callCount, 1, 'La segunda llamada mutante identica fue bloqueada por la guarda de dedup');
});

