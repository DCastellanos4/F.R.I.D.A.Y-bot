/**
 * Suite de pruebas de integracion y aislamiento para el micro-servidor standalone mcp-server-devops.
 *
 * Verifica:
 * - Ciclo de vida JSON-RPC 2.0 (initialize, notifications/initialized, ping)
 * - Catalogo de herramientas (tools/list)
 * - Invocacion y politicas de ejecucion (tools/call)
 * - Timeouts y limites de seguridad
 * - Manejo de errores y tolerancia a fallos
 *
 * Politica de estilo: Cero emojis en codigo, comentarios, logs y salidas.
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import readline from 'node:readline';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  getBashExecutable,
  ejecutarComandoBash,
  consultarEstadoServidor,
  inspeccionarDocker,
  verificarAlmacenamiento,
  comprobarCertificadosSsl,
  getToolsList,
  executeTool
} from '../../mcp-servers/devops/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '../..');
const SERVER_PATH = path.resolve(REPO_ROOT, 'mcp-servers/devops/index.js');

describe('mcp-server-devops standalone micro-server', () => {
  let serverProcess = null;
  let requestCounter = 1;
  const pendingRequests = new Map();

  before(() => {
    serverProcess = spawn(process.execPath, [SERVER_PATH], {
      cwd: REPO_ROOT,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, NODE_ENV: 'test' }
    });

    const rl = readline.createInterface({
      input: serverProcess.stdout,
      terminal: false,
      crlfDelay: Infinity
    });

    rl.on('line', (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      try {
        const message = JSON.parse(trimmed);
        if (message.id !== undefined && message.id !== null && pendingRequests.has(message.id)) {
          const { resolve } = pendingRequests.get(message.id);
          pendingRequests.delete(message.id);
          resolve(message);
        }
      } catch {
        // Ignorar salidas no JSON
      }
    });

    serverProcess.stderr.on('data', () => {
      // Drenar stderr
    });
  });

  after(() => {
    if (serverProcess && !serverProcess.killed) {
      serverProcess.kill('SIGKILL');
    }
  });

  function sendRpcRequest(method, params = {}) {
    const id = requestCounter++;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        pendingRequests.delete(id);
        reject(new Error(`Timeout esperando respuesta JSON-RPC para metodo ${method} (id=${id})`));
      }, 15000);

      pendingRequests.set(id, {
        resolve: (val) => {
          clearTimeout(timeout);
          resolve(val);
        },
        reject: (err) => {
          clearTimeout(timeout);
          reject(err);
        }
      });

      const payload = JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n';
      serverProcess.stdin.write(payload);
    });
  }

  function sendRawLine(line) {
    return new Promise((resolve) => {
      const rlRaw = readline.createInterface({
        input: serverProcess.stdout,
        terminal: false,
        crlfDelay: Infinity
      });

      const onLine = (data) => {
        const trimmed = data.trim();
        if (!trimmed) return;
        try {
          const parsed = JSON.parse(trimmed);
          rlRaw.removeListener('line', onLine);
          resolve(parsed);
        } catch {
          // continuar escuchando
        }
      };

      rlRaw.on('line', onLine);
      serverProcess.stdin.write(line + '\n');
    });
  }

  test('handshake: initialize devuelve capacidades y metadatos del servidor', async () => {
    const res = await sendRpcRequest('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'test-harness', version: '1.0.0' }
    });

    assert.equal(res.jsonrpc, '2.0');
    assert.ok(res.result, 'Debe devolver un objeto result');
    assert.equal(res.result.protocolVersion, '2024-11-05');
    assert.equal(res.result.serverInfo.name, 'mcp-server-devops');
    assert.equal(res.result.serverInfo.version, '1.0.0');
    assert.ok(res.result.capabilities.tools, 'Debe anunciar capacidad de tools');
  });

  test('notificacion: notifications/initialized es procesada sin error', async () => {
    // Si se envia con id, debe retornar resultado vacio
    const res = await sendRpcRequest('notifications/initialized');
    assert.equal(res.jsonrpc, '2.0');
    assert.deepEqual(res.result, {});
  });

  test('ping: responde con exito', async () => {
    const res = await sendRpcRequest('ping');
    assert.equal(res.jsonrpc, '2.0');
    assert.deepEqual(res.result, {});
  });

  test('tools/list: devuelve el catalogo completo de 5 herramientas con sus esquemas', async () => {
    const res = await sendRpcRequest('tools/list');
    assert.equal(res.jsonrpc, '2.0');
    assert.ok(Array.isArray(res.result.tools), 'tools debe ser un array');
    assert.equal(res.result.tools.length, 5);

    const nombresEsperados = [
      'ejecutar_comando_bash',
      'consultar_estado_servidor',
      'inspeccionar_docker',
      'verificar_almacenamiento',
      'comprobar_certificados_ssl'
    ];

    const nombresObtenidos = res.result.tools.map((t) => t.name);
    for (const esperado of nombresEsperados) {
      assert.ok(
        nombresObtenidos.includes(esperado),
        `La herramienta ${esperado} debe estar presente en el catalogo`
      );
    }

    const bashTool = res.result.tools.find((t) => t.name === 'ejecutar_comando_bash');
    assert.equal(bashTool.inputSchema.type, 'object');
    assert.deepEqual(bashTool.inputSchema.required, ['comando']);
    assert.ok(bashTool.inputSchema.properties.comando);
    assert.ok(bashTool.inputSchema.properties.timeout_ms);
  });

  test('tools/call: consultar_estado_servidor retorna telemetria estructurada', async () => {
    const res = await sendRpcRequest('tools/call', {
      name: 'consultar_estado_servidor',
      arguments: {}
    });

    assert.equal(res.jsonrpc, '2.0');
    assert.equal(res.result.isError, false);
    assert.ok(Array.isArray(res.result.content));
    assert.equal(res.result.content[0].type, 'text');

    const data = JSON.parse(res.result.content[0].text);
    assert.ok(data.cpu, 'Debe contener metricas de CPU');
    assert.ok(data.cpu.nucleos > 0, 'Debe reportar al menos un nucleo de CPU');
    assert.ok(data.memoria, 'Debe contener metricas de memoria');
    assert.ok(data.memoria.totalGB > 0, 'Total de memoria debe ser positivo');
    assert.ok(data.memoria.porcentajeUso >= 0, 'Porcentaje de uso debe ser no negativo');
    assert.ok(data.servidor, 'Debe contener informacion del servidor');
    assert.ok(data.servidor.plataforma, 'Debe reportar plataforma del sistema');
    assert.ok(data.disco, 'Debe reportar estado del disco');
  });

  test('tools/call: ejecutar_comando_bash ejecuta comando simple y captura stdout', async () => {
    const res = await sendRpcRequest('tools/call', {
      name: 'ejecutar_comando_bash',
      arguments: {
        comando: 'echo "mcp_devops_ping_ok"'
      }
    });

    assert.equal(res.jsonrpc, '2.0');
    assert.equal(res.result.isError, false);
    const data = JSON.parse(res.result.content[0].text);
    assert.equal(data.ok, true);
    assert.equal(data.exitCode, 0);
    assert.equal(data.stdout, 'mcp_devops_ping_ok');
    assert.equal(data.timedOut, false);
    assert.ok(data.durationMs >= 0);
  });

  test('tools/call: ejecutar_comando_bash respeta timeout estricto y aborta', async () => {
    const res = await sendRpcRequest('tools/call', {
      name: 'ejecutar_comando_bash',
      arguments: {
        comando: 'sleep 4',
        timeout_ms: 350
      }
    });

    assert.equal(res.jsonrpc, '2.0');
    assert.equal(res.result.isError, false);
    const data = JSON.parse(res.result.content[0].text);
    assert.equal(data.ok, false);
    assert.equal(data.timedOut, true);
    assert.ok(data.stderr.includes('timeout'));
  });

  test('tools/call: verificar_almacenamiento calcula particion y umbral de alerta', async () => {
    const res = await sendRpcRequest('tools/call', {
      name: 'verificar_almacenamiento',
      arguments: {}
    });

    assert.equal(res.jsonrpc, '2.0');
    assert.equal(res.result.isError, false);
    const data = JSON.parse(res.result.content[0].text);
    assert.equal(data.ok, true);
    assert.ok(data.totalGB > 0);
    assert.ok(data.freeGB >= 0);
    assert.ok(data.porcentajeUso >= 0);
    assert.equal(typeof data.alertaUsoCritico, 'boolean');
    assert.equal(data.umbralAlerta, 85);

    // Verificacion con umbral disparado determinista (umbral = 0)
    const resAlerta = await sendRpcRequest('tools/call', {
      name: 'verificar_almacenamiento',
      arguments: { umbral_alerta: 0 }
    });
    const dataAlerta = JSON.parse(resAlerta.result.content[0].text);
    assert.equal(dataAlerta.alertaUsoCritico, true);
    assert.ok(dataAlerta.mensaje.includes('ALERTA'));

    // Verificacion con umbral alto no disparado (umbral = 99.9)
    const resNormal = await sendRpcRequest('tools/call', {
      name: 'verificar_almacenamiento',
      arguments: { umbral_alerta: 99.9 }
    });
    const dataNormal = JSON.parse(resNormal.result.content[0].text);
    assert.equal(dataNormal.alertaUsoCritico, false);
    assert.ok(dataNormal.mensaje.includes('normales'));
  });

  test('tools/call: inspeccionar_docker responde de forma segura sin excepciones', async () => {
    const res = await sendRpcRequest('tools/call', {
      name: 'inspeccionar_docker',
      arguments: {}
    });

    assert.equal(res.jsonrpc, '2.0');
    assert.equal(res.result.isError, false);
    const data = JSON.parse(res.result.content[0].text);
    assert.equal(typeof data.disponible, 'boolean');
    assert.ok(Array.isArray(data.contenedores));
  });

  test('tools/call: comprobar_certificados_ssl verifica dominio o maneja error de red', async () => {
    const res = await sendRpcRequest('tools/call', {
      name: 'comprobar_certificados_ssl',
      arguments: {
        dominio: 'google.com',
        puerto: 443,
        timeout_ms: 6000
      }
    });

    assert.equal(res.jsonrpc, '2.0');
    assert.equal(res.result.isError, false);
    const data = JSON.parse(res.result.content[0].text);
    assert.equal(data.host, 'google.com');
    assert.equal(data.puerto, 443);
    if (data.valido) {
      assert.ok(data.diasRestantes > 0);
      assert.ok(data.validoHasta);
      assert.ok(data.sujeto);
    } else {
      assert.ok(data.error);
    }
  });

  test('errores: invocacion de herramienta no reconocida retorna isError=true', async () => {
    const res = await sendRpcRequest('tools/call', {
      name: 'herramienta_no_existente',
      arguments: {}
    });

    assert.equal(res.jsonrpc, '2.0');
    assert.equal(res.result.isError, true);
    const data = JSON.parse(res.result.content[0].text);
    assert.ok(data.error.includes('no reconocida'));
  });

  test('errores: argumento obligatorio ausente retorna isError=true', async () => {
    const res = await sendRpcRequest('tools/call', {
      name: 'ejecutar_comando_bash',
      arguments: {}
    });

    assert.equal(res.jsonrpc, '2.0');
    assert.equal(res.result.isError, true);
    const data = JSON.parse(res.result.content[0].text);
    assert.ok(data.error.includes('comando'));
  });

  test('errores: metodo JSON-RPC desconocido retorna codigo -32601', async () => {
    const res = await sendRpcRequest('metodo_inexistente_mcp', {});
    assert.equal(res.jsonrpc, '2.0');
    assert.ok(res.error);
    assert.equal(res.error.code, -32601);
  });

  test('errores: JSON malformado sobre stdin retorna parse error -32700', async () => {
    const res = await sendRawLine('{ jsonrpc: "2.0", id: 999, invalid_syntax ');
    assert.equal(res.jsonrpc, '2.0');
    assert.ok(res.error);
    assert.equal(res.error.code, -32700);
  });

  test('errores: payload que no es objeto retorna invalid request -32600', async () => {
    const res = await sendRawLine('"una simple cadena"');
    assert.equal(res.jsonrpc, '2.0');
    assert.ok(res.error);
    assert.equal(res.error.code, -32600);
  });
});

describe('mcp-server-devops funciones exportadas (unit tests directos)', () => {
  test('getBashExecutable devuelve una ruta o nombre valido', () => {
    const bash = getBashExecutable();
    assert.equal(typeof bash, 'string');
    assert.ok(bash.length > 0);
  });

  test('getToolsList retorna catalogo coherente de 5 herramientas', () => {
    const tools = getToolsList();
    assert.equal(tools.length, 5);
    for (const tool of tools) {
      assert.ok(tool.name);
      assert.ok(tool.description);
      assert.ok(tool.inputSchema);
    }
  });

  test('ejecutarComandoBash valida tipo de comando', async () => {
    await assert.rejects(
      () => ejecutarComandoBash(null),
      /El parametro comando es obligatorio/
    );
  });

  test('consultarEstadoServidor retorna telemetria completa', async () => {
    const estado = await consultarEstadoServidor();
    assert.ok(estado.servidor);
    assert.ok(estado.cpu);
    assert.ok(estado.memoria);
    assert.ok(estado.disco);
  });

  test('verificarAlmacenamiento maneja ruta invalida con ok=false', async () => {
    const res = await verificarAlmacenamiento('/ruta/completamente/invalida/xyz123');
    assert.equal(res.ok, false);
    assert.ok(res.error);
  });

  test('comprobarCertificadosSsl rechaza dominio vacio', async () => {
    await assert.rejects(
      () => comprobarCertificadosSsl(''),
      /El parametro dominio es obligatorio/
    );
  });

  test('executeTool propaga excepcion en herramienta inexistente', async () => {
    await assert.rejects(
      () => executeTool('desconocida', {}),
      /Herramienta no reconocida/
    );
  });
});
