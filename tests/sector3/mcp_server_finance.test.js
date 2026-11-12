/**
 * tests/sector3/mcp_server_finance.test.js
 *
 * Pruebas unitarias e integracion para el micro-servidor MCP mcp-server-finance.
 * Ejecuta pruebas directas sobre db.js y ocr.js, y pruebas sobre subproceso
 * stdio JSON-RPC 2.0.
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

import {
  crearFinanceDb,
  normalizarMonto,
  normalizarFecha,
  normalizarTrimestre
} from '../../mcp-servers/finance/db.js';
import {
  extraerCamposDeTexto,
  extraerTicketVision
} from '../../mcp-servers/finance/ocr.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '../../');
const FINANCE_SERVER_PATH = path.resolve(REPO_ROOT, 'mcp-servers/finance/index.js');

test('mcp-server-finance: pruebas unitarias directas de db.js', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-finance-unit-'));
  const tempDbPath = path.join(tempDir, 'finance_unit.db');
  const fDb = crearFinanceDb(tempDbPath);

  try {
    // 1. Validaciones de normalizacion de importes
    assert.equal(normalizarMonto(15.5), 15.5);
    assert.equal(normalizarMonto('49.99'), 49.99);
    assert.throws(() => normalizarMonto(-5), /monto debe ser un numero positivo/);
    assert.throws(() => normalizarMonto('abc'), /monto debe ser un numero positivo/);

    // 2. Validaciones de normalizacion de fechas
    assert.equal(normalizarFecha('2026-11-12'), '2026-11-12');
    assert.match(normalizarFecha(), /^\d{4}-\d{2}-\d{2}$/);
    assert.throws(() => normalizarFecha('12/11/2026'), /Fecha invalida/);

    // 3. Validaciones de normalizacion de trimestres
    assert.equal(normalizarTrimestre('1'), 'T1');
    assert.equal(normalizarTrimestre('q2'), 'T2');
    assert.equal(normalizarTrimestre('T3'), 'T3');
    assert.equal(normalizarTrimestre('4'), 'T4');
    assert.equal(normalizarTrimestre(null), null);
    assert.throws(() => normalizarTrimestre('5'), /Trimestre invalido/);

    // 4. Registro de gastos contables
    const g1 = fDb.registrarGasto({
      monto: 121.00,
      categoria: 'oficina',
      concepto: 'Material papeleria',
      fecha: '2026-02-15'
    });
    assert.equal(g1.ok, true);
    assert.equal(g1.gasto.monto, 121.00);
    assert.equal(g1.gasto.base, 100.00);
    assert.equal(g1.gasto.iva, 21.00);
    assert.equal(g1.gasto.categoria, 'oficina');

    const g2 = fDb.registrarGasto({
      monto: 50.00,
      categoria: 'transporte',
      concepto: 'Gasolina viaje',
      fecha: '2026-05-10',
      base: 41.32,
      iva: 8.68
    });
    assert.equal(g2.ok, true);
    assert.equal(g2.gasto.base, 41.32);
    assert.equal(g2.gasto.iva, 8.68);

    const g3 = fDb.registrarGasto({
      monto: 242.00,
      categoria: 'oficina',
      concepto: 'Licencia software',
      fecha: '2026-11-01'
    });
    assert.equal(g3.ok, true);

    // 5. Validacion de rechazo con campos obligatorios ausentes
    assert.throws(() => {
      fDb.registrarGasto({ monto: 20 });
    }, /categoria es obligatoria/);

    assert.throws(() => {
      fDb.registrarGasto({ monto: 20, categoria: 'comida' });
    }, /concepto es obligatorio/);

    // 6. Listado de gastos
    const todos = fDb.listarGastos({ anio: 2026 });
    assert.equal(todos.length, 3);

    const soloOficina = fDb.listarGastos({ categoria: 'oficina' });
    assert.equal(soloOficina.length, 2);

    // 7. Resumen trimestral
    const resumen = fDb.exportarResumenTrimestral({ anio: 2026 });
    assert.equal(resumen.ok, true);
    assert.equal(resumen.anio, 2026);
    assert.equal(resumen.trimestres.T1.num_gastos, 1);
    assert.equal(resumen.trimestres.T1.total, 121.00);
    assert.equal(resumen.trimestres.T1.base, 100.00);
    assert.equal(resumen.trimestres.T1.iva, 21.00);
    assert.equal(resumen.trimestres.T1.por_categoria.oficina, 121.00);

    assert.equal(resumen.trimestres.T2.num_gastos, 1);
    assert.equal(resumen.trimestres.T2.total, 50.00);

    assert.equal(resumen.trimestres.T3.num_gastos, 0);

    assert.equal(resumen.trimestres.T4.num_gastos, 1);
    assert.equal(resumen.trimestres.T4.total, 242.00);

    assert.equal(resumen.resumen_anual.num_gastos, 3);
    assert.equal(resumen.resumen_anual.total, 413.00);

    // 8. Resumen con filtro de trimestre especifico
    const resumenT1 = fDb.exportarResumenTrimestral({ anio: 2026, trimestre: '1' });
    assert.equal(resumenT1.trimestre_solicitado, 'T1');
    assert.equal(resumenT1.detalle_trimestre.total, 121.00);
  } finally {
    fDb.cerrar();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('mcp-server-finance: pruebas unitarias directas de ocr.js', async () => {
  // 1. Parseo de ticket completo
  const textoTicket = `
    RESTAURANTE EL ASADOR SL
    CIF: B87654321
    FECHA: 2026-11-10
    MESA: 4
    2x Menu del dia: 30.00
    1x Botella vino: 15.50
    BASE IMPONIBLE: 37.60
    IVA (21%): 7.90
    TOTAL FACTURA: 45.50 EUR
    GRACIAS POR SU VISITA
  `;

  const campos = extraerCamposDeTexto(textoTicket);
  assert.equal(campos.cif, 'B87654321');
  assert.equal(campos.base, 37.60);
  assert.equal(campos.iva, 7.90);
  assert.equal(campos.total, 45.50);
  assert.equal(campos.fecha, '2026-11-10');
  assert.match(campos.comercio, /RESTAURANTE EL ASADOR/);

  // 2. Inferencia matematica cuando solo viene el total
  const textoMinimo = `
    NIF: 12345678Z
    FECHA: 15/10/2026
    TOTAL: 121.00
  `;
  const resMinimo = await extraerTicketVision({ texto: textoMinimo });
  assert.equal(resMinimo.ok, true);
  assert.equal(resMinimo.cif, '12345678Z');
  assert.equal(resMinimo.total, 121.00);
  assert.equal(resMinimo.base, 100.00);
  assert.equal(resMinimo.iva, 21.00);
  assert.equal(resMinimo.fecha, '2026-10-15');

  // 3. Extraccion a partir de base64
  const b64 = Buffer.from('CIF: A11223344 TOTAL: 50.00 FECHA: 2026-09-01').toString('base64');
  const resB64 = await extraerTicketVision({ imagen_base64: b64 });
  assert.equal(resB64.ok, true);
  assert.equal(resB64.cif, 'A11223344');
  assert.equal(resB64.total, 50.00);

  // 4. Rechazo con argumentos invalidos
  await assert.rejects(
    async () => extraerTicketVision({}),
    /Debe proporcionar al menos uno/
  );
});

test('mcp-server-finance: ejecucion stdio JSON-RPC 2.0 via subproceso', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-finance-stdio-'));
  const tempDbPath = path.join(tempDir, 'finance_stdio.db');

  const child = spawn(process.execPath, [FINANCE_SERVER_PATH], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      FINANCE_DB_PATH: tempDbPath
    },
    stdio: ['pipe', 'pipe', 'pipe']
  });

  const rl = readline.createInterface({
    input: child.stdout,
    terminal: false
  });

  const respuestas = [];
  rl.on('line', (line) => {
    if (!line.trim()) return;
    try {
      respuestas.push(JSON.parse(line));
    } catch (_) {}
  });

  async function enviarPeticion(payload) {
    const idEsperado = payload.id;
    const posInicial = respuestas.length;
    child.stdin.write(JSON.stringify(payload) + '\n');

    const inicio = Date.now();
    while (Date.now() - inicio < 4000) {
      for (let i = posInicial; i < respuestas.length; i++) {
        if (respuestas[i].id === idEsperado) {
          return respuestas[i];
        }
      }
      await new Promise((r) => setTimeout(r, 20));
    }
    throw new Error(`Timeout esperando respuesta para id: ${idEsperado}`);
  }

  try {
    // 1. Handshake initialize
    const initRes = await enviarPeticion({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2024-11-05' }
    });
    assert.equal(initRes.id, 1);
    assert.equal(initRes.result.serverInfo.name, 'mcp-server-finance');
    assert.ok(initRes.result.capabilities.tools);

    // 2. Notificacion initialized
    child.stdin.write(JSON.stringify({
      jsonrpc: '2.0',
      method: 'notifications/initialized'
    }) + '\n');

    // 3. Ping
    const pingRes = await enviarPeticion({
      jsonrpc: '2.0',
      id: 2,
      method: 'ping'
    });
    assert.equal(pingRes.id, 2);
    assert.deepEqual(pingRes.result, {});

    // 4. tools/list
    const listRes = await enviarPeticion({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/list'
    });
    assert.equal(listRes.id, 3);
    const toolNames = listRes.result.tools.map((t) => t.name);
    assert.ok(toolNames.includes('extraer_ticket_vision'));
    assert.ok(toolNames.includes('registrar_gasto'));
    assert.ok(toolNames.includes('exportar_resumen_trimestral'));
    assert.equal(toolNames.length, 3);

    // 5. tools/call: registrar_gasto
    const callGastoRes = await enviarPeticion({
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: {
        name: 'registrar_gasto',
        arguments: {
          monto: 60.50,
          categoria: 'alimentacion',
          concepto: 'Supermercado Central',
          fecha: '2026-03-14'
        }
      }
    });
    assert.equal(callGastoRes.id, 4);
    assert.equal(callGastoRes.result.isError, false);
    const dataGasto = JSON.parse(callGastoRes.result.content[0].text);
    assert.equal(dataGasto.ok, true);
    assert.equal(dataGasto.gasto.monto, 60.50);
    assert.equal(dataGasto.gasto.categoria, 'alimentacion');

    // 6. tools/call: exportar_resumen_trimestral
    const callResumenRes = await enviarPeticion({
      jsonrpc: '2.0',
      id: 5,
      method: 'tools/call',
      params: {
        name: 'exportar_resumen_trimestral',
        arguments: {
          anio: 2026,
          trimestre: 'T1'
        }
      }
    });
    assert.equal(callResumenRes.id, 5);
    assert.equal(callResumenRes.result.isError, false);
    const dataResumen = JSON.parse(callResumenRes.result.content[0].text);
    assert.equal(dataResumen.ok, true);
    assert.equal(dataResumen.trimestres.T1.num_gastos, 1);
    assert.equal(dataResumen.trimestres.T1.total, 60.50);

    // 7. tools/call: extraer_ticket_vision
    const callVisionRes = await enviarPeticion({
      jsonrpc: '2.0',
      id: 6,
      method: 'tools/call',
      params: {
        name: 'extraer_ticket_vision',
        arguments: {
          texto: 'RESTAURANTE SOL\nCIF: B12349999\nTOTAL: 80.00\nFECHA: 2026-03-20'
        }
      }
    });
    assert.equal(callVisionRes.id, 6);
    assert.equal(callVisionRes.result.isError, false);
    const dataVision = JSON.parse(callVisionRes.result.content[0].text);
    assert.equal(dataVision.ok, true);
    assert.equal(dataVision.cif, 'B12349999');
    assert.equal(dataVision.total, 80.00);

    // 8. Error: herramienta no existente
    const errToolRes = await enviarPeticion({
      jsonrpc: '2.0',
      id: 7,
      method: 'tools/call',
      params: {
        name: 'herramienta_inexistente',
        arguments: {}
      }
    });
    assert.equal(errToolRes.id, 7);
    assert.equal(errToolRes.result.isError, true);

    // 9. Error: metodo desconocido
    const errMethodRes = await enviarPeticion({
      jsonrpc: '2.0',
      id: 8,
      method: 'metodo_fantasma'
    });
    assert.equal(errMethodRes.id, 8);
    assert.equal(errMethodRes.error.code, -32601);
  } finally {
    rl.close();
    child.kill('SIGTERM');
    await new Promise((r) => setTimeout(r, 100));
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
