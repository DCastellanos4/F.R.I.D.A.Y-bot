/**
 * Pruebas unitarias y de integracion para la infraestructura de cliente MCP.
 *
 * Valida:
 * 1. McpClientPort: verificacion de contrato e interfaz requerida.
 * 2. McpClientAdapter:
 *    - Spawn de servidor MCP via stdio.
 *    - Protocolo JSON-RPC 2.0 (initialize + notifications/initialized).
 *    - toolsList con mapeo a formato OpenAI/Groq { type: 'function', function: ... }.
 *    - callTool con ejecucion de herramientas y manejo de errores.
 *    - Timeout estricto de 15s (o configurable) con error fail-closed MCP_TIMEOUT_EXPIRED.
 *    - Cierre ordenado via SIGTERM con fallback a SIGKILL.
 *    - Resiliencia ante caida inesperada del subproceso.
 * 3. McpRegistry:
 *    - Registro de servidores por dominio (ej: booking, devops).
 *    - Agregacion unificada de herramientas.
 *    - Enrutamiento correcto de callTool al servidor correspondiente.
 *    - Error fail-closed MCP_TOOL_NOT_FOUND para herramientas desconocidas.
 *    - Cierre en cascada de todos los servidores registrados.
 *
 * Strict Policy: Zero Emojis.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

import {
  afirmarMcpClient,
  afirmarMcpClientPort,
  assertMcpClientPort
} from '../../src/ports/outbound/McpClientPort.js';
import {
  McpClientAdapter,
  crearMcpClientAdapter
} from '../../src/adapters/outbound/mcp/mcpClientAdapter.js';
import {
  McpRegistry,
  crearMcpRegistry
} from '../../src/adapters/outbound/mcp/mcpRegistry.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FAKE_SERVER_PATH = path.join(__dirname, 'fixtures', 'fake_mcp_server.js');

// ---------------------------------------------------------------------------
// 1. Pruebas de contrato McpClientPort
// ---------------------------------------------------------------------------

test('McpClientPort: rechaza objetos nulos, primitivos o incompletos', () => {
  assert.throws(() => afirmarMcpClient(null), /se esperaba un objeto cliente/);
  assert.throws(() => afirmarMcpClient(undefined), /se esperaba un objeto cliente/);
  assert.throws(() => afirmarMcpClient('no-un-objeto'), /se esperaba un objeto cliente/);

  assert.throws(
    () => afirmarMcpClient({ callTool: () => {}, close: () => {} }),
    /falta el metodo obligatorio "toolsList"/
  );
  assert.throws(
    () => afirmarMcpClient({ toolsList: () => {}, close: () => {} }),
    /falta el metodo obligatorio "callTool"/
  );
  assert.throws(
    () => afirmarMcpClient({ toolsList: () => {}, callTool: () => {} }),
    /falta el metodo obligatorio "close"/
  );
});

test('McpClientPort: acepta objetos validos y provee alias compatibles', () => {
  const dummyClient = {
    toolsList: async () => [],
    callTool: async () => {},
    close: async () => {}
  };

  assert.equal(afirmarMcpClient(dummyClient), dummyClient);
  assert.equal(afirmarMcpClientPort(dummyClient), dummyClient);
  assert.equal(assertMcpClientPort(dummyClient), dummyClient);
});

// ---------------------------------------------------------------------------
// 2. Pruebas de McpClientAdapter con servidor MCP falso via stdio
// ---------------------------------------------------------------------------

test('McpClientAdapter: handshake initialize, tools/list con mapeo OpenAI y callTool', async () => {
  const client = crearMcpClientAdapter({
    command: process.execPath,
    args: [FAKE_SERVER_PATH, '--domain=booking'],
    name: 'booking-test'
  });

  try {
    // 1. Consulta herramientas (debe disparar initialize + notifications/initialized + tools/list)
    const tools = await client.toolsList();
    assert.ok(Array.isArray(tools));
    assert.equal(tools.length, 2);

    const bookFlightTool = tools.find((t) => t.function?.name === 'book_flight');
    assert.ok(bookFlightTool, 'debe existir la herramienta book_flight');
    assert.equal(bookFlightTool.type, 'function');
    assert.equal(bookFlightTool.function.description, 'Reserva un vuelo comercial');
    assert.deepEqual(bookFlightTool.function.parameters.required, ['origin', 'destination']);

    // 2. Invocar herramienta existente
    const result = await client.callTool('book_flight', { origin: 'MAD', destination: 'BCN' });
    assert.ok(result);
    assert.equal(result.isError, false);
    assert.equal(result.content[0].type, 'text');
    assert.match(result.content[0].text, /Vuelo reservado de MAD a BCN/);
  } finally {
    await client.close();
  }
});

test('McpClientAdapter: gestion de errores reportados por el servidor MCP', async () => {
  const client = crearMcpClientAdapter({
    command: process.execPath,
    args: [FAKE_SERVER_PATH, '--domain=booking'],
    name: 'error-test'
  });

  try {
    await assert.rejects(
      async () => {
        await client.callTool('simulate_error');
      },
      (err) => {
        assert.equal(err.code, -32000);
        assert.match(err.message, /Error simulado en la ejecucion/);
        return true;
      }
    );
  } finally {
    await client.close();
  }
});

test('McpClientAdapter: timeout estricto con error fail-closed MCP_TIMEOUT_EXPIRED', async () => {
  const client = crearMcpClientAdapter({
    command: process.execPath,
    args: [FAKE_SERVER_PATH, '--domain=booking'],
    name: 'timeout-test',
    timeoutMs: 80 // Timeout ultra-corto para verificar fail-closed rapido
  });

  try {
    await assert.rejects(
      async () => {
        await client.callTool('slow_tool', { delayMs: 2000 });
      },
      (err) => {
        assert.equal(err.code, 'MCP_TIMEOUT_EXPIRED');
        assert.match(err.message, /timed out after/);
        return true;
      }
    );
  } finally {
    await client.close();
  }
});

test('McpClientAdapter: caida imprevista del proceso rechaza peticiones con MCP_PROCESS_EXITED', async () => {
  const client = crearMcpClientAdapter({
    command: process.execPath,
    args: [FAKE_SERVER_PATH, '--domain=booking'],
    name: 'crash-test'
  });

  try {
    await assert.rejects(
      async () => {
        await client.callTool('crash_tool');
      },
      (err) => {
        assert.equal(err.code, 'MCP_PROCESS_EXITED');
        return true;
      }
    );
  } finally {
    await client.close();
  }
});

test('McpClientAdapter: close() termina el subproceso e invalida llamadas posteriores', async () => {
  const client = crearMcpClientAdapter({
    command: process.execPath,
    args: [FAKE_SERVER_PATH, '--domain=booking'],
    name: 'close-test'
  });

  await client.toolsList();
  assert.equal(client.isClosed, false);

  await client.close();
  assert.equal(client.isClosed, true);

  // Cierre idempotente no falla
  await client.close();

  // Llamadas posteriores deben fallar cerrado inmediatamente
  await assert.rejects(
    async () => {
      await client.toolsList();
    },
    (err) => {
      assert.equal(err.code, 'MCP_CLIENT_CLOSED');
      return true;
    }
  );
});

test('McpClientAdapter: fallback a SIGKILL cuando el proceso ignora SIGTERM', async () => {
  const client = crearMcpClientAdapter({
    command: process.execPath,
    args: [FAKE_SERVER_PATH, '--ignore-sigterm'],
    name: 'sigkill-test',
    closeTimeoutMs: 100 // Cierre rapido para disparar SIGKILL en pruebas
  });

  await client.toolsList();
  assert.ok(client.child);

  await client.close();
  assert.equal(client.isClosed, true);
});

test('McpClientAdapter: resiliencia ante error de arranque del proceso hijo', async () => {
  const fakeSpawn = () => {
    const emitter = new EventEmitter();
    emitter.stdout = new PassThrough();
    emitter.stderr = new PassThrough();
    emitter.stdin = new PassThrough();
    emitter.killed = false;
    emitter.exitCode = null;
    emitter.kill = () => {
      emitter.killed = true;
      emitter.exitCode = 1;
      emitter.emit('exit', 1, null);
      return true;
    };

    process.nextTick(() => {
      emitter.emit('error', new Error('spawn ENOENT no-such-binary'));
      emitter.exitCode = -1;
      emitter.emit('exit', -1, null);
    });
    return emitter;
  };

  const client = new McpClientAdapter({
    command: 'no-such-binary-12345',
    spawnFn: fakeSpawn,
    closeTimeoutMs: 50
  });

  await assert.rejects(
    async () => {
      await client.toolsList();
    },
    (err) => {
      assert.equal(err.code, 'MCP_PROCESS_ERROR');
      assert.match(err.message, /spawn ENOENT/);
      return true;
    }
  );

  await client.close();
});

// ---------------------------------------------------------------------------
// 3. Pruebas de McpRegistry
// ---------------------------------------------------------------------------

test('McpRegistry: cumple el puerto McpClientPort', () => {
  const registry = crearMcpRegistry();
  assert.equal(afirmarMcpClient(registry), registry);
});

test('McpRegistry: agrega herramientas de multiples dominios y enruta callTool', async () => {
  const registry = crearMcpRegistry();

  const bookingServer = crearMcpClientAdapter({
    command: process.execPath,
    args: [FAKE_SERVER_PATH, '--domain=booking'],
    name: 'booking-domain'
  });

  const devopsServer = crearMcpClientAdapter({
    command: process.execPath,
    args: [FAKE_SERVER_PATH, '--domain=devops'],
    name: 'devops-domain'
  });

  registry.registerServer('booking', bookingServer);
  registry.registerServer('devops', devopsServer);

  try {
    assert.deepEqual(registry.listServers(), ['booking', 'devops']);
    assert.equal(registry.getServer('booking'), bookingServer);

    // Consulta agregada
    const allTools = await registry.toolsList();
    const toolNames = allTools.map((t) => t.function.name).sort();
    assert.deepEqual(toolNames, ['book_flight', 'cancel_flight', 'deploy_service']);

    // Enrutamiento a booking
    const bookingRes = await registry.callTool('book_flight', { origin: 'VLC', destination: 'MAD' });
    assert.equal(bookingRes.isError, false);
    assert.match(bookingRes.content[0].text, /Vuelo reservado de VLC a MAD/);

    // Enrutamiento a devops
    const devopsRes = await registry.callTool('deploy_service', { serviceName: 'auth-service', version: '2.1.0' });
    assert.equal(devopsRes.isError, false);
    assert.match(devopsRes.content[0].text, /Servicio auth-service desplegado en version 2.1.0/);

    // Herramienta desconocida
    await assert.rejects(
      async () => {
        await registry.callTool('herramienta_fantasma');
      },
      (err) => {
        assert.equal(err.code, 'MCP_TOOL_NOT_FOUND');
        assert.match(err.message, /not found in any registered server/);
        return true;
      }
    );

    // Desregistrar dominio
    const desregistrado = registry.unregisterServer('booking');
    assert.equal(desregistrado, true);
    assert.deepEqual(registry.listServers(), ['devops']);

    // book_flight ya no debe resolverse
    await assert.rejects(
      async () => {
        await registry.callTool('book_flight', { origin: 'VLC', destination: 'MAD' });
      },
      (err) => {
        assert.equal(err.code, 'MCP_TOOL_NOT_FOUND');
        return true;
      }
    );
  } finally {
    await bookingServer.close().catch(() => {});
    await registry.close();
  }
});
