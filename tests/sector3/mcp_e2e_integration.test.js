/**
 * tests/sector3/mcp_e2e_integration.test.js
 *
 * Prueba E2E de integracion:
 * Conecta McpRegistry con los micro-servidores reales mcp-server-booking y mcp-server-devops
 * mediante McpClientAdapter sobre stdio JSON-RPC 2.0.
 *
 * Strict Policy: Zero Emojis.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import { crearMcpClientAdapter } from '../../src/adapters/outbound/mcp/mcpClientAdapter.js';
import { crearMcpRegistry } from '../../src/adapters/outbound/mcp/mcpRegistry.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '../../');

test('E2E: McpRegistry agrega mcp-server-booking y mcp-server-devops reales y ejecuta herramientas', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-e2e-'));
  const bookingDbPath = path.join(tempDir, 'e2e_booking.db');

  const registry = crearMcpRegistry();

  const bookingAdapter = crearMcpClientAdapter({
    command: process.execPath,
    args: [path.resolve(REPO_ROOT, 'mcp-servers/booking/index.js')],
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      BOOKING_DB_PATH: bookingDbPath,
      NODE_ENV: 'test'
    }
  });

  const devopsAdapter = crearMcpClientAdapter({
    command: process.execPath,
    args: [path.resolve(REPO_ROOT, 'mcp-servers/devops/index.js')],
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      NODE_ENV: 'test'
    }
  });

  registry.registerServer('booking', bookingAdapter);
  registry.registerServer('devops', devopsAdapter);

  try {
    // 1. Obtencion agregada de herramientas de ambos servidores
    const tools = await registry.toolsList();
    const toolNames = tools.map((t) => t.function?.name || t.name);

    // Debe contener las herramientas de booking
    assert.ok(toolNames.includes('consultar_disponibilidad'), 'incluye consultar_disponibilidad');
    assert.ok(toolNames.includes('reservar_cita'), 'incluye reservar_cita');
    assert.ok(toolNames.includes('cancelar_cita'), 'incluye cancelar_cita');
    assert.ok(toolNames.includes('listar_citas'), 'incluye listar_citas');

    // Debe contener las herramientas de devops
    assert.ok(toolNames.includes('consultar_estado_servidor'), 'incluye consultar_estado_servidor');
    assert.ok(toolNames.includes('ejecutar_comando_bash'), 'incluye ejecutar_comando_bash');
    assert.ok(toolNames.includes('verificar_almacenamiento'), 'incluye verificar_almacenamiento');

    // Total de herramientas registradas: 4 booking + 5 devops = 9 herramientas
    assert.equal(tools.length, 9);

    // 2. Invocacion E2E a herramienta de booking a traves del registry
    const resDisp = await registry.callTool('consultar_disponibilidad', {
      fecha: '2026-11-25',
      duracion_minutos: 60
    });
    assert.equal(resDisp.isError, false);
    const dataDisp = JSON.parse(resDisp.content[0].text);
    assert.equal(dataDisp.ok, true);
    assert.equal(dataDisp.fecha, '2026-11-25');
    assert.ok(dataDisp.total_disponibles > 0);

    // 3. Invocacion E2E a herramienta de devops a traves del registry
    const resEstado = await registry.callTool('consultar_estado_servidor', {});
    assert.equal(resEstado.isError, false);
    const dataEstado = JSON.parse(resEstado.content[0].text);
    assert.ok(dataEstado.servidor);
    assert.ok(dataEstado.cpu);
    assert.ok(dataEstado.memoria);

    // 4. Invocacion de herramienta inexistente da error fail-closed
    await assert.rejects(
      async () => registry.callTool('herramienta_fantasma', {}),
      /not found in any registered server/
    );
  } finally {
    await registry.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
