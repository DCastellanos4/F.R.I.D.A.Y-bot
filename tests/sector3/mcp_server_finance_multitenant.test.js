import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { crearFinanceDb } from '../../mcp-servers/finance/db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const RUTA_SERVIDOR = path.resolve(__dirname, '../../mcp-servers/finance/index.js');

test('mcp-server-finance: aislamiento estricto multi-tenant en SQLite', async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'davis-finance-multitenant-'));
  const rutaDb = path.join(tmpDir, 'test_multitenant_finance.db');

  const financeDb = crearFinanceDb(rutaDb);

  try {
    // 1. Registrar gasto para Tenant A
    const resA = financeDb.registrarGasto({
      monto: 120.00,
      categoria: 'oficina',
      concepto: 'Material de papeleria A',
      fecha: '2026-03-10',
      tenant_id: 'tenant_clinica_a'
    });
    assert.equal(resA.ok, true);
    assert.equal(resA.gasto.tenant_id, 'tenant_clinica_a');
    assert.equal(resA.gasto.monto, 120.00);

    // 2. Registrar gasto para Tenant B
    const resB = financeDb.registrarGasto({
      monto: 45.50,
      categoria: 'transporte',
      concepto: 'Gasolina vehiculo B',
      fecha: '2026-03-12',
      tenant_id: 'tenant_taller_b'
    });
    assert.equal(resB.ok, true);
    assert.equal(resB.gasto.tenant_id, 'tenant_taller_b');
    assert.equal(resB.gasto.monto, 45.50);

    // 3. Registrar gasto para el Propietario (David)
    const resOwner = financeDb.registrarGasto({
      monto: 30.00,
      categoria: 'alimentacion',
      concepto: 'Almuerzo David',
      fecha: '2026-03-15',
      tenant_id: 'propietario'
    });
    assert.equal(resOwner.ok, true);
    assert.equal(resOwner.gasto.tenant_id, 'propietario');

    // 4. Verificar aislamiento en listarGastos
    const gastosA = financeDb.listarGastos({ tenant_id: 'tenant_clinica_a' });
    assert.equal(gastosA.length, 1);
    assert.equal(gastosA[0].concepto, 'Material de papeleria A');
    assert.equal(gastosA[0].monto, 120.00);

    const gastosB = financeDb.listarGastos({ tenant_id: 'tenant_taller_b' });
    assert.equal(gastosB.length, 1);
    assert.equal(gastosB[0].concepto, 'Gasolina vehiculo B');
    assert.equal(gastosB[0].monto, 45.50);

    const gastosOwner = financeDb.listarGastos({ tenant_id: 'propietario' });
    assert.equal(gastosOwner.length, 1);
    assert.equal(gastosOwner[0].concepto, 'Almuerzo David');

    // 5. Verificar aislamiento en resumenGastosMes
    const resumenA = financeDb.resumenGastosMes({ anio: 2026, mes: 3, tenant_id: 'tenant_clinica_a' });
    assert.equal(resumenA.ok, true);
    assert.equal(resumenA.total, 120.00);
    assert.equal(resumenA.num_gastos, 1);
    assert.equal(resumenA.por_categoria.oficina, 120.00);
    assert.equal(resumenA.por_categoria.transporte, undefined);

    const resumenB = financeDb.resumenGastosMes({ anio: 2026, mes: 3, tenant_id: 'tenant_taller_b' });
    assert.equal(resumenB.ok, true);
    assert.equal(resumenB.total, 45.50);
    assert.equal(resumenB.num_gastos, 1);
    assert.equal(resumenB.por_categoria.transporte, 45.50);
    assert.equal(resumenB.por_categoria.oficina, undefined);

    // 6. Verificar exportarResumenTrimestral
    const trimA = financeDb.exportarResumenTrimestral({ anio: 2026, trimestre: 'T1', tenant_id: 'tenant_clinica_a' });
    assert.equal(trimA.resumen_anual.total, 120.00);
    assert.equal(trimA.resumen_anual.num_gastos, 1);

    const trimB = financeDb.exportarResumenTrimestral({ anio: 2026, trimestre: 'T1', tenant_id: 'tenant_taller_b' });
    assert.equal(trimB.resumen_anual.total, 45.50);
    assert.equal(trimB.resumen_anual.num_gastos, 1);
  } finally {
    financeDb.cerrar();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('mcp-server-finance: protocolo stdio JSON-RPC 2.0 con tenant_id', async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'davis-finance-stdio-'));
  const rutaDb = path.join(tmpDir, 'test_finance_stdio.db');

  const proceso = spawn(process.execPath, [RUTA_SERVIDOR], {
    env: {
      ...process.env,
      FINANCE_DB_PATH: rutaDb
    },
    stdio: ['pipe', 'pipe', 'pipe']
  });

  const rl = readline.createInterface({ input: proceso.stdout });
  let resolverPeticionActual = null;

  rl.on('line', (linea) => {
    if (!linea.trim()) return;
    try {
      const obj = JSON.parse(linea);
      if (resolverPeticionActual) {
        const fn = resolverPeticionActual;
        resolverPeticionActual = null;
        fn(obj);
      }
    } catch (_) {}
  });

  function enviarPeticion(obj) {
    return new Promise((resolve, reject) => {
      resolverPeticionActual = resolve;
      try {
        proceso.stdin.write(JSON.stringify(obj) + '\n');
      } catch (err) {
        reject(err);
      }
    });
  }

  try {
    // 1. Handshake initialize
    await enviarPeticion({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'test-agent', version: '1.0.0' }
      }
    });

    // 2. tools/call registrar_gasto con tenant_id
    const resReg = await enviarPeticion({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: {
        name: 'registrar_gasto',
        arguments: {
          monto: 85.00,
          categoria: 'software',
          concepto: 'Licencia Cloud',
          fecha: '2026-03-20',
          tenant_id: 'tenant_saas_x'
        }
      }
    });

    assert.equal(resReg.id, 2);
    assert.equal(resReg.result.isError, false);
    const parsedReg = JSON.parse(resReg.result.content[0].text);
    assert.equal(parsedReg.ok, true);
    assert.equal(parsedReg.gasto.tenant_id, 'tenant_saas_x');
    assert.equal(parsedReg.gasto.monto, 85.00);

    // 3. tools/call resumen_gastos_mes con tenant_id
    const resMes = await enviarPeticion({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: {
        name: 'resumen_gastos_mes',
        arguments: {
          anio: 2026,
          mes: 3,
          tenant_id: 'tenant_saas_x'
        }
      }
    });

    assert.equal(resMes.id, 3);
    assert.equal(resMes.result.isError, false);
    const parsedMes = JSON.parse(resMes.result.content[0].text);
    assert.equal(parsedMes.ok, true);
    assert.equal(parsedMes.total, 85.00);
    assert.equal(parsedMes.num_gastos, 1);

    // 4. tools/call resumen_gastos_mes para otro tenant (debe devolver 0)
    const resMesOtro = await enviarPeticion({
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: {
        name: 'resumen_gastos_mes',
        arguments: {
          anio: 2026,
          mes: 3,
          tenant_id: 'tenant_otro'
        }
      }
    });

    assert.equal(resMesOtro.id, 4);
    const parsedMesOtro = JSON.parse(resMesOtro.result.content[0].text);
    assert.equal(parsedMesOtro.ok, true);
    assert.equal(parsedMesOtro.total, 0);
    assert.equal(parsedMesOtro.num_gastos, 0);
  } finally {
    rl.close();
    await new Promise((r) => {
      proceso.on('exit', r);
      proceso.kill();
      setTimeout(r, 200);
    });
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    } catch (_) {}
  }
});
