/**
 * tests/sector3/mcp_server_booking.test.js
 *
 * Pruebas unitarias e integracion para el micro-servidor MCP mcp-server-booking.
 * Spawns 'node mcp-servers/booking/index.js' como subproceso.
 * Envia mensajes JSON-RPC 2.0 por stdio para:
 *   - initialize
 *   - notifications/initialized
 *   - tools/list
 *   - consultar_disponibilidad
 *   - reservar_cita
 *   - cancelar_cita
 *   - listar_citas
 * Comprueba respuestas validas, gestion de errores y consistencia transaccional SQLite.
 *
 * Strict Policy: Zero Emojis.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import readline from 'node:readline';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { crearBookingDb, normalizarFechaIso, horaAMinutos, DatabaseDriver } from '../../mcp-servers/booking/db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '../../');
const SCRIPT_PATH = path.resolve(REPO_ROOT, 'mcp-servers/booking/index.js');

test('mcp-server-booking: verificaciones directas del modulo db.js', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-booking-unit-'));
  const tempDbPath = path.join(tempDir, 'unit_test.db');
  const bDb = crearBookingDb(tempDbPath);

  try {
    // 1. Validacion de normalizacion de fechas
    assert.equal(normalizarFechaIso('2026-11-15T10:00:00.000Z'), '2026-11-15T10:00:00.000Z');
    assert.equal(normalizarFechaIso('2026-11-15T10:00:00'), '2026-11-15T10:00:00.000Z');
    assert.throws(() => normalizarFechaIso('invalida'), /Fecha invalida/);

    // 2. Validacion de conversion de horas a minutos
    assert.equal(horaAMinutos('09:00'), 540);
    assert.equal(horaAMinutos('20:00'), 1200);
    assert.throws(() => horaAMinutos('25:00'), /Valores de hora fuera de rango/);

    // 3. Consulta inicial de disponibilidad (dia vacio: 09:00 a 20:00 con duracion 30 min = 22 huecos)
    const dispInicial = bDb.consultarDisponibilidad({ fecha: '2026-11-20', duracion_minutos: 30 });
    assert.equal(dispInicial.ok, true);
    assert.equal(dispInicial.total_disponibles, 22);
    assert.equal(dispInicial.huecos_disponibles[0].hora_inicio, '09:00');
    assert.equal(dispInicial.huecos_disponibles[21].hora_inicio, '19:30');

    // 4. Reserva de cita
    const res = bDb.reservarCita({
      cliente_nombre: 'Maria Directa',
      cliente_telefono: '+34611223344',
      fecha_inicio: '2026-11-20T10:00:00.000Z',
      duracion_minutos: 30,
      servicio: 'Fisioterapia'
    });
    assert.equal(res.ok, true);
    assert.ok(res.cita.id);
    assert.equal(res.cita.estado, 'confirmada');

    // 5. Verificacion de que el hueco ya no esta disponible
    const dispTrasReserva = bDb.consultarDisponibilidad({ fecha: '2026-11-20', duracion_minutos: 30 });
    assert.equal(dispTrasReserva.total_disponibles, 21);
    const contiene10 = dispTrasReserva.huecos_disponibles.some((h) => h.hora_inicio === '10:00');
    assert.equal(contiene10, false);

    // 6. Rechazo de colision directa
    assert.throws(() => {
      bDb.reservarCita({
        cliente_nombre: 'Otro Cliente',
        cliente_telefono: '+34699999999',
        fecha_inicio: '2026-11-20T10:00:00.000Z',
        duracion_minutos: 30,
        servicio: 'Masaje'
      });
    }, /Conflicto de horario/);

    // 7. Rechazo fuera de horario
    assert.throws(() => {
      bDb.reservarCita({
        cliente_nombre: 'Fuera de Hora',
        cliente_telefono: '+34699999999',
        fecha_inicio: '2026-11-20T08:00:00.000Z',
        duracion_minutos: 30,
        servicio: 'Revision'
      });
    }, /fuera del horario comercial/);

    // 8. Cancelacion y reapertura del hueco
    const cancelRes = bDb.cancelarCita({ cita_id: res.cita.id });
    assert.equal(cancelRes.ok, true);
    assert.equal(cancelRes.cita.estado, 'cancelada');

    const dispTrasCancel = bDb.consultarDisponibilidad({ fecha: '2026-11-20', duracion_minutos: 30 });
    assert.equal(dispTrasCancel.total_disponibles, 22);
    const recuperado10 = dispTrasCancel.huecos_disponibles.some((h) => h.hora_inicio === '10:00');
    assert.equal(recuperado10, true);
  } finally {
    bDb.cerrar();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('mcp-server-booking: ejecucion stdio JSON-RPC 2.0 via subproceso', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-booking-stdio-'));
  const tempDbPath = path.join(tempDir, 'booking_stdio.db');

  const child = spawn(process.execPath, [SCRIPT_PATH], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      BOOKING_DB_PATH: tempDbPath,
      NODE_ENV: 'test'
    },
    stdio: ['pipe', 'pipe', 'pipe']
  });

  const pendingRequests = new Map();
  let nextId = 1;

  const rl = readline.createInterface({
    input: child.stdout,
    terminal: false
  });

  rl.on('line', (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && parsed.id !== undefined && pendingRequests.has(parsed.id)) {
        const { resolve } = pendingRequests.get(parsed.id);
        pendingRequests.delete(parsed.id);
        resolve(parsed);
      }
    } catch (_) {}
  });

  function callRpc(method, params = {}) {
    const id = nextId++;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        pendingRequests.delete(id);
        reject(new Error(`Timeout en llamada RPC metodo=${method} id=${id}`));
      }, 5000);

      pendingRequests.set(id, {
        resolve: (resp) => {
          clearTimeout(timeout);
          resolve(resp);
        }
      });

      const msg = { jsonrpc: '2.0', id, method, params };
      child.stdin.write(JSON.stringify(msg) + '\n');
    });
  }

  function notifyRpc(method, params = {}) {
    const msg = { jsonrpc: '2.0', method, params };
    child.stdin.write(JSON.stringify(msg) + '\n');
  }

  try {
    // 1. initialize: comprueba capacidades e info del servidor
    const initRes = await callRpc('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'test-harness', version: '1.0.0' }
    });

    assert.equal(initRes.jsonrpc, '2.0');
    assert.ok(initRes.result);
    assert.equal(initRes.result.serverInfo.name, 'mcp-server-booking');
    assert.equal(initRes.result.serverInfo.version, '1.0.0');
    assert.ok(initRes.result.capabilities.tools);

    // 2. notifications/initialized: notificacion reconocida sin fallo
    notifyRpc('notifications/initialized', {});
    // Pequena comprobacion de vida enviando ping
    const pingRes = await callRpc('ping');
    assert.equal(pingRes.jsonrpc, '2.0');

    // 3. tools/list: devuelve las 4 herramientas con sus esquemas
    const listRes = await callRpc('tools/list');
    assert.ok(listRes.result);
    assert.ok(Array.isArray(listRes.result.tools));
    const toolNames = listRes.result.tools.map((t) => t.name);
    assert.ok(toolNames.includes('consultar_disponibilidad'));
    assert.ok(toolNames.includes('reservar_cita'));
    assert.ok(toolNames.includes('cancelar_cita'));
    assert.ok(toolNames.includes('listar_citas'));

    // 4. tools/call: consultar_disponibilidad en fecha sin citas
    const fechaTest = '2026-12-15';
    const dispCall = await callRpc('tools/call', {
      name: 'consultar_disponibilidad',
      arguments: {
        fecha: fechaTest,
        duracion_minutos: 30
      }
    });

    assert.equal(dispCall.jsonrpc, '2.0');
    assert.equal(dispCall.result.isError, false);
    const dispData = JSON.parse(dispCall.result.content[0].text);
    assert.equal(dispData.ok, true);
    assert.equal(dispData.fecha, fechaTest);
    assert.equal(dispData.total_disponibles, 22);

    // 5. tools/call: reservar_cita con exito
    const reservaCall = await callRpc('tools/call', {
      name: 'reservar_cita',
      arguments: {
        cliente_nombre: 'Elena Garcia',
        cliente_telefono: '+34600123456',
        fecha_inicio: `${fechaTest}T10:00:00.000Z`,
        duracion_minutos: 30,
        servicio: 'Odontologia'
      }
    });

    assert.equal(reservaCall.jsonrpc, '2.0');
    assert.equal(reservaCall.result.isError, false);
    const reservaData = JSON.parse(reservaCall.result.content[0].text);
    assert.equal(reservaData.ok, true);
    assert.ok(reservaData.cita.id);
    assert.equal(reservaData.cita.cliente_nombre, 'Elena Garcia');
    assert.equal(reservaData.cita.estado, 'confirmada');
    const cita1Id = reservaData.cita.id;

    // 6. tools/call: consultar_disponibilidad tras reserva -> 10:00 no debe estar
    const dispTrasRes = await callRpc('tools/call', {
      name: 'consultar_disponibilidad',
      arguments: {
        fecha: fechaTest,
        duracion_minutos: 30
      }
    });
    const dispData2 = JSON.parse(dispTrasRes.result.content[0].text);
    assert.equal(dispData2.total_disponibles, 21);
    const existe10 = dispData2.huecos_disponibles.some((h) => h.hora_inicio === '10:00');
    assert.equal(existe10, false);

    // 7. tools/call: reservar_cita con colision horaria exacta -> error
    const colisionCall = await callRpc('tools/call', {
      name: 'reservar_cita',
      arguments: {
        cliente_nombre: 'Pedro Martinez',
        cliente_telefono: '+34600999888',
        fecha_inicio: `${fechaTest}T10:00:00.000Z`,
        duracion_minutos: 30,
        servicio: 'Limpieza'
      }
    });
    assert.equal(colisionCall.result.isError, true);
    const colisionData = JSON.parse(colisionCall.result.content[0].text);
    assert.equal(colisionData.ok, false);
    assert.match(colisionData.error, /Conflicto de horario/);

    // 8. tools/call: reservar_cita con solapamiento parcial -> error
    const colisionParcialCall = await callRpc('tools/call', {
      name: 'reservar_cita',
      arguments: {
        cliente_nombre: 'Lucas Solapado',
        cliente_telefono: '+34600999888',
        fecha_inicio: `${fechaTest}T10:15:00.000Z`,
        duracion_minutos: 30,
        servicio: 'Consulta'
      }
    });
    assert.equal(colisionParcialCall.result.isError, true);
    const colisionParcialData = JSON.parse(colisionParcialCall.result.content[0].text);
    assert.equal(colisionParcialData.ok, false);
    assert.match(colisionParcialData.error, /Conflicto de horario/);

    // 9. tools/call: listar_citas filtrado por fecha
    const listCitasCall = await callRpc('tools/call', {
      name: 'listar_citas',
      arguments: {
        fecha: fechaTest
      }
    });
    const listCitasData = JSON.parse(listCitasCall.result.content[0].text);
    assert.equal(listCitasData.ok, true);
    assert.equal(listCitasData.total, 1);
    assert.equal(listCitasData.citas[0].id, cita1Id);

    // 10. Reserva de segunda cita para probar cancelacion por telefono y fecha
    const reserva2Call = await callRpc('tools/call', {
      name: 'reservar_cita',
      arguments: {
        cliente_nombre: 'Sofia Lopez',
        cliente_telefono: '+34611555666',
        fecha_inicio: `${fechaTest}T12:00:00.000Z`,
        duracion_minutos: 60,
        servicio: 'Tratamiento facial'
      }
    });
    const reserva2Data = JSON.parse(reserva2Call.result.content[0].text);
    assert.equal(reserva2Data.ok, true);

    // 11. Cancelar cita 2 por combinacion de cliente_telefono y fecha
    const cancel2Call = await callRpc('tools/call', {
      name: 'cancelar_cita',
      arguments: {
        cliente_telefono: '+34611555666',
        fecha: fechaTest
      }
    });
    assert.equal(cancel2Call.result.isError, false);
    const cancel2Data = JSON.parse(cancel2Call.result.content[0].text);
    assert.equal(cancel2Data.ok, true);
    assert.ok(cancel2Data.citas_canceladas.length > 0);
    assert.equal(cancel2Data.citas_canceladas[0].estado, 'cancelada');

    // 12. Cancelar cita 1 por cita_id
    const cancel1Call = await callRpc('tools/call', {
      name: 'cancelar_cita',
      arguments: {
        cita_id: cita1Id
      }
    });
    assert.equal(cancel1Call.result.isError, false);
    const cancel1Data = JSON.parse(cancel1Call.result.content[0].text);
    assert.equal(cancel1Data.ok, true);
    assert.equal(cancel1Data.cita.estado, 'cancelada');

    // 13. Reabrir disponibilidad completa tras cancelaciones
    const dispFinal = await callRpc('tools/call', {
      name: 'consultar_disponibilidad',
      arguments: {
        fecha: fechaTest,
        duracion_minutos: 30
      }
    });
    const dispFinalData = JSON.parse(dispFinal.result.content[0].text);
    assert.equal(dispFinalData.total_disponibles, 22);

    // 14. Error handling: metodo inexistente
    const errMetodo = await callRpc('metodo_fantasma', {});
    assert.ok(errMetodo.error);
    assert.equal(errMetodo.error.code, -32601);

    // 15. Error handling: herramienta desconocida en tools/call
    const errTool = await callRpc('tools/call', {
      name: 'herramienta_inexistente',
      arguments: {}
    });
    assert.equal(errTool.result.isError, true);

    // 16. Error handling: parametros faltantes en reservar_cita
    const errParams = await callRpc('tools/call', {
      name: 'reservar_cita',
      arguments: {
        cliente_nombre: 'Incompleto'
      }
    });
    assert.equal(errParams.result.isError, true);
    const errParamsData = JSON.parse(errParams.result.content[0].text);
    assert.equal(errParamsData.ok, false);

    // 17. Error handling: fuera de horario comercial
    const errHorario = await callRpc('tools/call', {
      name: 'reservar_cita',
      arguments: {
        cliente_nombre: 'Nocturno',
        cliente_telefono: '+34600000000',
        fecha_inicio: `${fechaTest}T22:00:00.000Z`,
        duracion_minutos: 30,
        servicio: 'Urgencia'
      }
    });
    assert.equal(errHorario.result.isError, true);
    const errHorarioData = JSON.parse(errHorario.result.content[0].text);
    assert.match(errHorarioData.error, /fuera del horario comercial/);

    // 18. Error handling: envio de linea JSON malformada por stdin
    const parseErrorPromise = new Promise((resolve) => {
      const listener = (line) => {
        try {
          const parsed = JSON.parse(line.trim());
          if (parsed && parsed.error && parsed.error.code === -32700) {
            rl.off('line', listener);
            resolve(parsed);
          }
        } catch (_) {}
      };
      rl.on('line', listener);
    });
    child.stdin.write('ESTO NO ES UN JSON VALIDO\n');
    const parseErrorMsg = await parseErrorPromise;
    assert.equal(parseErrorMsg.jsonrpc, '2.0');
    assert.equal(parseErrorMsg.error.code, -32700);

    // Comprobacion de que el subproceso sigue vivo y responde tras el error de parseo
    const pingPostError = await callRpc('ping');
    assert.equal(pingPostError.jsonrpc, '2.0');

    // 19. Verificacion directa de persistencia y esquema SQLite
    const rawDb = new DatabaseDriver(tempDbPath);
    try {
      const columnas = rawDb.prepare("PRAGMA table_info('citas')").all();
      const nombresColumnas = columnas.map((c) => c.name);
      const requeridas = [
        'id',
        'cliente_nombre',
        'cliente_telefono',
        'fecha_inicio',
        'duracion_minutos',
        'servicio',
        'estado',
        'creado_en'
      ];
      for (const col of requeridas) {
        assert.ok(nombresColumnas.includes(col), `Falta columna requerida: ${col}`);
      }

      // Verificacion de que las 2 citas guardadas persisten con estado 'cancelada'
      const filas = rawDb.prepare('SELECT * FROM citas ORDER BY fecha_inicio ASC').all();
      assert.equal(filas.length, 2);
      assert.equal(filas[0].estado, 'cancelada');
      assert.equal(filas[1].estado, 'cancelada');
    } finally {
      rawDb.close();
    }
  } finally {
    rl.close();
    child.stdin.end();
    await new Promise((resolve) => {
      child.on('exit', resolve);
      setTimeout(() => {
        try {
          child.kill('SIGKILL');
        } catch (_) {}
        resolve();
      }, 2000);
    });
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
