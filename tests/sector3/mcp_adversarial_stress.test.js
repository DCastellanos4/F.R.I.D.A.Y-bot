/**
 * tests/sector3/mcp_adversarial_stress.test.js
 *
 * Suite de pruebas adversariales y de estres para la arquitectura MCP de D.A.V.I.S:
 * 1. Concurrency attack contra mcp-server-booking (20 reservas simultaneas sobre el mismo slot).
 * 2. Boundary & payload attack sobre mcp-server-booking (inyecciones SQL, duraciones invalidas/extremas, fuera de horario comercial, fechas malformadas).
 * 3. Security & resilience attack sobre mcp-server-devops (>1MB stdout, comando colgado de 30s con aborto fail-closed a los 15s, JSON-RPC malformado).
 * 4. Protocol attack sobre McpClientAdapter (rafagas secuenciales y concurrentes, SIGKILL a mitad de transaccion, deteccion de fugas).
 *
 * Politica estricta: Cero emojis en codigo, comentarios, logs y salidas.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

import { crearMcpClientAdapter } from '../../src/adapters/outbound/mcp/mcpClientAdapter.js';
import { crearBookingDb } from '../../mcp-servers/booking/db.js';
import { ejecutarComandoBash } from '../../mcp-servers/devops/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '../../');
const BOOKING_SERVER_PATH = path.resolve(REPO_ROOT, 'mcp-servers/booking/index.js');
const DEVOPS_SERVER_PATH = path.resolve(REPO_ROOT, 'mcp-servers/devops/index.js');

test('Ataque de concurrencia contra mcp-server-booking: 20 reservas simultaneas sobre el mismo slot', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-concurrency-'));
  const tempDbPath = path.join(tempDir, 'concurrency_booking.db');

  const client = crearMcpClientAdapter({
    command: process.execPath,
    args: [BOOKING_SERVER_PATH],
    cwd: REPO_ROOT,
    env: { BOOKING_DB_PATH: tempDbPath },
    name: 'booking-concurrency-test',
    timeoutMs: 15000
  });

  try {
    await client.toolsList();

    const slotObjetivo = '2026-12-01T10:00:00.000Z';
    const totalAtaques = 20;

    // Lanzamiento simultaneo de 20 intentos de reserva hacia exactamente el mismo intervalo
    const peticiones = Array.from({ length: totalAtaques }, (_, indice) =>
      client.callTool('reservar_cita', {
        cliente_nombre: `Atacante Concurrente ${indice + 1}`,
        cliente_telefono: `+346000000${String(indice).padStart(2, '0')}`,
        fecha_inicio: slotObjetivo,
        duracion_minutos: 30,
        servicio: 'Sesion de evaluacion adversarial'
      })
    );

    const resultados = await Promise.all(peticiones);

    let reservasExitosas = 0;
    let reservasFallidas = 0;

    for (const res of resultados) {
      assert.ok(Array.isArray(res.content), 'La respuesta debe incluir array de contenido');
      const payload = JSON.parse(res.content[0].text);

      if (res.isError === false && payload.ok === true) {
        reservasExitosas++;
        assert.ok(payload.cita.id, 'La cita exitosa debe contener id generado');
        assert.equal(payload.cita.estado, 'confirmada');
      } else {
        reservasFallidas++;
        assert.equal(res.isError, true);
        assert.equal(payload.ok, false);
        assert.match(payload.error, /Conflicto de horario/);
      }
    }

    assert.equal(
      reservasExitosas,
      1,
      `Exactamente 1 intento debe triunfar; se obtuvieron ${reservasExitosas}`
    );
    assert.equal(
      reservasFallidas,
      totalAtaques - 1,
      `Exactamente ${totalAtaques - 1} intentos deben fallar de forma segura; se obtuvieron ${reservasFallidas}`
    );

    // Verificacion de persistencia e integridad SQLite tras la contienda
    const verificadorDb = crearBookingDb(tempDbPath);
    try {
      const citasConfirmadas = verificadorDb.listarCitas({ fecha: '2026-12-01' });
      assert.equal(citasConfirmadas.total, 1, 'Debe persistir estrictamente 1 cita en la fecha');
      assert.equal(citasConfirmadas.citas[0].fecha_inicio, slotObjetivo);

      const checkIntegridad = verificadorDb.db.prepare('PRAGMA integrity_check').get();
      const estadoIntegridad = Object.values(checkIntegridad)[0];
      assert.equal(estadoIntegridad, 'ok', 'La base de datos SQLite debe permanecer integra sin corrupcion');
    } finally {
      verificadorDb.cerrar();
    }
  } finally {
    await client.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('Ataque de frontera y payloads contra mcp-server-booking: inyeccion SQL, duracion anormal, fuera de horario y fechas corruptas', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-boundary-'));
  const tempDbPath = path.join(tempDir, 'boundary_booking.db');

  const client = crearMcpClientAdapter({
    command: process.execPath,
    args: [BOOKING_SERVER_PATH],
    cwd: REPO_ROOT,
    env: { BOOKING_DB_PATH: tempDbPath },
    name: 'booking-boundary-test',
    timeoutMs: 15000
  });

  try {
    await client.toolsList();

    // 1. Inyeccion SQL en cliente_nombre y cliente_telefono
    const sqlInjections = [
      "' OR 1=1; DROP TABLE citas; --",
      "admin'--",
      "'; DELETE FROM citas; --",
      "1 UNION SELECT 1, 2, 3, 4, 5, 6, 7, 8--"
    ];

    for (let i = 0; i < sqlInjections.length; i++) {
      const payloadInyeccion = sqlInjections[i];
      const res = await client.callTool('reservar_cita', {
        cliente_nombre: payloadInyeccion,
        cliente_telefono: `+346111111${i}`,
        fecha_inicio: `2026-12-02T1${i}:00:00.000Z`,
        duracion_minutos: 30,
        servicio: 'Auditoria de inyeccion SQL'
      });

      assert.equal(res.isError, false, 'El parametro debe ser sanitizado y persistido como literal');
      const data = JSON.parse(res.content[0].text);
      assert.equal(data.ok, true);
      assert.equal(data.cita.cliente_nombre, payloadInyeccion.trim());
    }

    // Comprobar que la tabla citas sigue intacta y los registros existen
    const listado = await client.callTool('listar_citas', {
      cliente_telefono: '+3461111110'
    });
    const dataListado = JSON.parse(listado.content[0].text);
    assert.equal(dataListado.ok, true);
    assert.equal(dataListado.total, 1);
    assert.equal(dataListado.citas[0].cliente_nombre, sqlInjections[0].trim());

    // 2. Duracion negativa (-15)
    const resNegativo = await client.callTool('reservar_cita', {
      cliente_nombre: 'Prueba Negativa',
      cliente_telefono: '+34622222222',
      fecha_inicio: '2026-12-03T10:00:00.000Z',
      duracion_minutos: -15,
      servicio: 'Prueba Limites'
    });
    assert.equal(resNegativo.isError, true);
    assert.match(JSON.parse(resNegativo.content[0].text).error, /duracion_minutos debe ser un entero positivo/);

    // 3. Duracion cero (0)
    const resCero = await client.callTool('reservar_cita', {
      cliente_nombre: 'Prueba Cero',
      cliente_telefono: '+34622222222',
      fecha_inicio: '2026-12-03T10:00:00.000Z',
      duracion_minutos: 0,
      servicio: 'Prueba Limites'
    });
    assert.equal(resCero.isError, true);
    assert.match(JSON.parse(resCero.content[0].text).error, /duracion_minutos debe ser un entero positivo/);

    // 4. Duracion desproporcionadamente alta (99999)
    const resAbsurdo = await client.callTool('reservar_cita', {
      cliente_nombre: 'Prueba Gigante',
      cliente_telefono: '+34622222222',
      fecha_inicio: '2026-12-03T10:00:00.000Z',
      duracion_minutos: 99999,
      servicio: 'Prueba Limites'
    });
    assert.equal(resAbsurdo.isError, true);
    assert.match(
      JSON.parse(resAbsurdo.content[0].text).error,
      /(excede la duracion maxima permitida|fuera del horario comercial)/
    );

    // 5. Reserva fuera de horario comercial: Madrugada (03:00 AM)
    const resMadrugada = await client.callTool('reservar_cita', {
      cliente_nombre: 'Prueba Madrugada',
      cliente_telefono: '+34633333333',
      fecha_inicio: '2026-12-03T03:00:00.000Z',
      duracion_minutos: 30,
      servicio: 'Horario Nocturno'
    });
    assert.equal(resMadrugada.isError, true);
    assert.match(JSON.parse(resMadrugada.content[0].text).error, /fuera del horario comercial/);

    // 6. Reserva fuera de horario comercial: Noche tardia (23:30)
    const resTardia = await client.callTool('reservar_cita', {
      cliente_nombre: 'Prueba Noche',
      cliente_telefono: '+34633333333',
      fecha_inicio: '2026-12-03T23:30:00.000Z',
      duracion_minutos: 30,
      servicio: 'Horario Nocturno'
    });
    assert.equal(resTardia.isError, true);
    assert.match(JSON.parse(resTardia.content[0].text).error, /fuera del horario comercial/);

    // 7. Cita que cruza la hora de cierre (19:45 con 60 minutos de duracion, cierre a las 20:00)
    const resCruceCierre = await client.callTool('reservar_cita', {
      cliente_nombre: 'Prueba Cruce Cierre',
      cliente_telefono: '+34644444444',
      fecha_inicio: '2026-12-03T19:45:00.000Z',
      duracion_minutos: 60,
      servicio: 'Cierre Excedido'
    });
    assert.equal(resCruceCierre.isError, true);
    assert.match(JSON.parse(resCruceCierre.content[0].text).error, /fuera del horario comercial/);

    // 8. Cadenas de fecha ISO corruptas o malformadas
    const fechasMalformadas = [
      'cadena-totalmente-invalida',
      '2026-13-45T99:99:99Z',
      '9999999999',
      '2026-00-00',
      '--/--/----'
    ];

    for (const fechaInvalida of fechasMalformadas) {
      const resInvalida = await client.callTool('reservar_cita', {
        cliente_nombre: 'Prueba Fecha Invalida',
        cliente_telefono: '+34655555555',
        fecha_inicio: fechaInvalida,
        duracion_minutos: 30,
        servicio: 'Prueba Formato Fecha'
      });
      assert.equal(resInvalida.isError, true, `Debe rechazar fecha invalida: ${fechaInvalida}`);
      assert.match(JSON.parse(resInvalida.content[0].text).error, /(Fecha invalida|formato ISO)/);
    }
  } finally {
    await client.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('Ataque de seguridad y resiliencia contra mcp-server-devops: payload > 1MB en stdout', async () => {
  const client = crearMcpClientAdapter({
    command: process.execPath,
    args: [DEVOPS_SERVER_PATH],
    cwd: REPO_ROOT,
    name: 'devops-volume-test',
    timeoutMs: 15000
  });

  try {
    await client.toolsList();

    // Comando que emite mas de 1.2MB de texto en stdout
    const comandoGranVolumen = 'node -e "process.stdout.write(\'X\'.repeat(1258291))"';
    const res = await client.callTool('ejecutar_comando_bash', {
      comando: comandoGranVolumen
    });

    assert.equal(res.isError, false);
    const data = JSON.parse(res.content[0].text);
    assert.equal(data.ok, true);
    assert.equal(data.exitCode, 0);
    assert.ok(
      data.stdout.length >= 1258291,
      `El buffer stdout debe contener al menos 1.2MB; se recibieron ${data.stdout.length} bytes`
    );
    assert.equal(data.timedOut, false);
  } finally {
    await client.close();
  }
});

test('Ataque de seguridad y resiliencia contra mcp-server-devops: comando colgado con aborto fail-closed tras timeout de 15s', async () => {
  const inicioMs = Date.now();
  const resultado = await ejecutarComandoBash('sleep 30', 15000);
  const duracionMs = Date.now() - inicioMs;

  assert.equal(resultado.ok, false, 'La ejecucion de un comando de 30s debe ser abortada');
  assert.equal(resultado.timedOut, true, 'timedOut debe ser true tras expirar el temporizador');
  assert.match(
    resultado.stderr,
    /(timeout|tiempo limite de seguridad)/,
    'stderr debe indicar cancelacion por timeout'
  );
  assert.ok(
    duracionMs >= 14000 && duracionMs <= 18000,
    `La duracion real debe oscilar en torno a 15000ms; duracion registrada: ${duracionMs}ms`
  );
});

test('Ataque de payloads JSON-RPC malformados sobre mcp-server-devops (lineas parciales, metodos invalidos, IDs invalidos)', async () => {
  const serverProcess = spawn(process.execPath, [DEVOPS_SERVER_PATH], {
    cwd: REPO_ROOT,
    stdio: ['pipe', 'pipe', 'pipe']
  });

  const rl = readline.createInterface({
    input: serverProcess.stdout,
    crlfDelay: Infinity
  });

  function enviarLineaRaw(linea) {
    return new Promise((resolve) => {
      const onLine = (recibido) => {
        const limpia = recibido.trim();
        if (!limpia) return;
        try {
          const parsed = JSON.parse(limpia);
          rl.removeListener('line', onLine);
          resolve(parsed);
        } catch (_) {}
      };
      rl.on('line', onLine);
      serverProcess.stdin.write(linea + '\n');
    });
  }

  try {
    // 1. Linea parcial rota: JSON incompleto
    const respuestaParse = await enviarLineaRaw('{"jsonrpc": "2.0", "method": "tools/l');
    assert.equal(respuestaParse.jsonrpc, '2.0');
    assert.equal(respuestaParse.error.code, -32700);
    assert.match(respuestaParse.error.message, /Parse error/);

    // 2. Metodo inexistente
    const respuestaMetodoInexistente = await enviarLineaRaw(
      JSON.stringify({ jsonrpc: '2.0', id: 101, method: 'metodo_fantasma' })
    );
    assert.equal(respuestaMetodoInexistente.jsonrpc, '2.0');
    assert.equal(respuestaMetodoInexistente.id, 101);
    assert.equal(respuestaMetodoInexistente.error.code, -32601);
    assert.match(respuestaMetodoInexistente.error.message, /Metodo no encontrado/);

    // 3. Metodo de tipo no string
    const respuestaMetodoNoString = await enviarLineaRaw(
      JSON.stringify({ jsonrpc: '2.0', id: 102, method: 12345 })
    );
    assert.equal(respuestaMetodoNoString.jsonrpc, '2.0');
    assert.equal(respuestaMetodoNoString.id, 102);
    assert.equal(respuestaMetodoNoString.error.code, -32600);
    assert.match(respuestaMetodoNoString.error.message, /method invalido/);

    // 4. ID con tipo no permitido (objeto en lugar de string, number o null)
    const respuestaIdInvalido = await enviarLineaRaw(
      JSON.stringify({ jsonrpc: '2.0', id: { objeto: 'malicioso' }, method: 'ping' })
    );
    assert.equal(respuestaIdInvalido.jsonrpc, '2.0');
    assert.equal(respuestaIdInvalido.id, null);
    assert.equal(respuestaIdInvalido.error.code, -32600);
    assert.match(respuestaIdInvalido.error.message, /id invalido/);

    // 5. Comprobar que el servidor sigue vivo y operativo tras los ataques malformados
    const pingRecuperacion = await enviarLineaRaw(
      JSON.stringify({ jsonrpc: '2.0', id: 103, method: 'ping' })
    );
    assert.equal(pingRecuperacion.jsonrpc, '2.0');
    assert.equal(pingRecuperacion.id, 103);
    assert.deepEqual(pingRecuperacion.result, {});
  } finally {
    rl.close();
    serverProcess.kill('SIGTERM');
  }
});

test('Ataque de protocolo contra McpClientAdapter: rafagas rapidas secuenciales y concurrentes', async () => {
  const client = crearMcpClientAdapter({
    command: process.execPath,
    args: [DEVOPS_SERVER_PATH],
    cwd: REPO_ROOT,
    name: 'devops-rapidfire-test',
    timeoutMs: 15000
  });

  try {
    await client.toolsList();

    // 1. Rafaga secuencial de 25 peticiones
    const totalSecuenciales = 25;
    for (let i = 0; i < totalSecuenciales; i++) {
      const res = await client.callTool('ejecutar_comando_bash', {
        comando: `echo "secuencial_${i}"`
      });
      assert.equal(res.isError, false);
      const data = JSON.parse(res.content[0].text);
      assert.equal(data.stdout, `secuencial_${i}`);
    }
    assert.equal(client.pendingRequests.size, 0, 'No deben quedar peticiones pendientes tras rafaga secuencial');

    // 2. Rafaga concurrente de 30 peticiones simultaneas
    const totalConcurrentes = 30;
    const peticiones = Array.from({ length: totalConcurrentes }, (_, indice) =>
      client.callTool('ejecutar_comando_bash', {
        comando: `echo "concurrente_${indice}"`
      }).then((res) => {
        assert.equal(res.isError, false);
        const data = JSON.parse(res.content[0].text);
        assert.equal(data.stdout, `concurrente_${indice}`);
        return indice;
      })
    );

    const resultados = await Promise.all(peticiones);
    assert.equal(resultados.length, totalConcurrentes);
    assert.equal(client.pendingRequests.size, 0, 'No deben quedar peticiones en cola tras rafaga concurrente');
  } finally {
    await client.close();
  }
});

test('Ataque de protocolo contra McpClientAdapter: SIGKILL abrupto a mitad de transacciones y ausencia de fugas', async () => {
  const client = crearMcpClientAdapter({
    command: process.execPath,
    args: [DEVOPS_SERVER_PATH],
    cwd: REPO_ROOT,
    name: 'devops-sigkill-test',
    timeoutMs: 15000
  });

  await client.toolsList();

  // Se lanzan 5 comandos lentos en paralelo
  const llamadasEnVuelo = Array.from({ length: 5 }, (_, i) =>
    client.callTool('ejecutar_comando_bash', {
      comando: 'sleep 5'
    })
  );

  // Pequeña pausa para asegurar que los mensajes estan transmitidos y en curso
  await new Promise((r) => setTimeout(r, 80));
  assert.ok(client.pendingRequests.size >= 1, 'Debe haber transacciones en vuelo en el cliente');

  // Ejecucion del SIGKILL mientras las peticiones estan pendientes
  client.child.kill('SIGKILL');

  const resultados = await Promise.allSettled(llamadasEnVuelo);

  for (const r of resultados) {
    assert.equal(r.status, 'rejected', 'Todas las llamadas pendientes deben ser rechazadas');
    assert.equal(r.reason.code, 'MCP_PROCESS_EXITED', 'El codigo de error debe ser MCP_PROCESS_EXITED');
  }

  // Comprobacion de vaciado total y ausencia de fugas de memoria
  assert.equal(
    client.pendingRequests.size,
    0,
    'El mapa de peticiones pendientes debe quedar totalmente vacio tras la caida'
  );

  // Intentos posteriores deben fallar de inmediato sin bloquearse ni colgarse
  await assert.rejects(
    async () => {
      await client.callTool('consultar_estado_servidor');
    },
    (err) => {
      assert.ok(
        err.code === 'MCP_PROCESS_EXITED' || err.code === 'MCP_CLIENT_CLOSED',
        `Error esperado MCP_PROCESS_EXITED o MCP_CLIENT_CLOSED; recibido ${err.code}`
      );
      return true;
    }
  );

  await client.close();
});
