/**
 * tests/sector3/mcp_server_lifestyle.test.js
 *
 * Pruebas unitarias e integracion para el micro-servidor MCP mcp-server-lifestyle.
 * Pruebas directas de db.js y transport.js, y ejecucion de subproceso stdio JSON-RPC 2.0.
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
  crearLifestyleDb,
  calcularRacha,
  fechaHoy
} from '../../mcp-servers/lifestyle/db.js';
import {
  consultarTrenesRenfe,
  consultarRadarVuelos,
  normalizarEstacion,
  normalizarAeropuerto
} from '../../mcp-servers/lifestyle/transport.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '../../');
const LIFESTYLE_SERVER_PATH = path.resolve(REPO_ROOT, 'mcp-servers/lifestyle/index.js');

test('mcp-server-lifestyle: pruebas unitarias directas de db.js', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-lifestyle-unit-'));
  const tempDbPath = path.join(tempDir, 'lifestyle_unit.db');
  const lDb = crearLifestyleDb(tempDbPath);

  try {
    // 1. Calculo de racha
    assert.equal(calcularRacha([], '2026-11-12'), 0);
    assert.equal(calcularRacha(['2026-11-12'], '2026-11-12'), 1);
    assert.equal(calcularRacha(['2026-11-11', '2026-11-12'], '2026-11-12'), 2);
    assert.equal(calcularRacha(['2026-11-10', '2026-11-12'], '2026-11-12'), 1);
    assert.equal(calcularRacha(['2026-11-11'], '2026-11-12'), 1); // marcado ayer cuenta como racha activa

    // 2. Registro de habitos
    const reg1 = lDb.registrarHabito({ nombre: 'Meditar 10 minutos' });
    assert.equal(reg1.ok, true);
    assert.equal(reg1.habito.nombre, 'Meditar 10 minutos');
    assert.ok(reg1.habito.id);

    // 3. Rechazo de duplicados y nombres vacios
    assert.throws(() => lDb.registrarHabito({ nombre: 'meditar 10 minutos' }), /Ya existe un habito/);
    assert.throws(() => lDb.registrarHabito({ nombre: '' }), /nombre es obligatorio/);

    // 4. Marcar habito
    const fHoy = '2026-11-12';
    const fAyer = '2026-11-11';
    const marc1 = lDb.marcarHabito({ criterio: 'meditar', fecha: fAyer, hoy: fHoy });
    assert.equal(marc1.ok, true);
    assert.equal(marc1.racha, 1);

    const marc2 = lDb.marcarHabito({ criterio: 'meditar', fecha: fHoy, hoy: fHoy });
    assert.equal(marc2.ok, true);
    assert.equal(marc2.racha, 2);

    // Rechazo de doble marca
    assert.throws(() => {
      lDb.marcarHabito({ criterio: 'meditar', fecha: fHoy, hoy: fHoy });
    }, /ya estaba marcado/);

    // 5. Listar habitos
    const listaHab = lDb.listarHabitos({ hoy: fHoy });
    assert.equal(listaHab.ok, true);
    assert.equal(listaHab.total, 1);
    assert.equal(listaHab.habitos[0].hecho_hoy, true);
    assert.equal(listaHab.habitos[0].racha, 2);

    // 6. Lista de la compra: anadir items
    const anad1 = lDb.anadirCompra({ item: 'Leche de avena' });
    assert.equal(anad1.ok, true);
    assert.equal(anad1.anadidos.length, 1);

    const anadMulti = lDb.anadirCompra({ items: ['Manzanas', 'Pan integral', 'leche de avena'] });
    assert.equal(anadMulti.ok, true);
    assert.equal(anadMulti.anadidos.length, 2); // 'leche de avena' duplicada es ignorada

    // 7. Lista de la compra: listar
    const listaCmp = lDb.listarCompra();
    assert.equal(listaCmp.ok, true);
    assert.equal(listaCmp.total, 3);
    assert.ok(listaCmp.items.includes('Leche de avena'));
    assert.ok(listaCmp.items.includes('Manzanas'));

    // 8. Lista de la compra: tachar item
    const tach = lDb.tacharCompra({ criterio: 'manzanas' });
    assert.equal(tach.ok, true);
    assert.equal(tach.tachado, 'Manzanas');
    assert.equal(tach.total_pendientes, 2);

    // Rechazo al tachar item inexistente
    assert.throws(() => lDb.tacharCompra({ criterio: 'caviar' }), /No se encontro ningun item/);

    // 9. Lista de la compra: vaciar
    const vac = lDb.vaciarCompra();
    assert.equal(vac.ok, true);
    assert.equal(vac.eliminados, 2);
    assert.equal(lDb.listarCompra().total, 0);
  } finally {
    lDb.cerrar();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('mcp-server-lifestyle: pruebas unitarias directas de transport.js', () => {
  // 1. Normalizacion de nombres
  assert.equal(normalizarEstacion('atocha'), 'Madrid-Atocha');
  assert.equal(normalizarEstacion('sants'), 'Barcelona-Sants');
  assert.equal(normalizarAeropuerto('madrid'), 'MAD');
  assert.equal(normalizarAeropuerto('lisboa'), 'LIS');

  // 2. Consulta de trenes Renfe
  const trenes = consultarTrenesRenfe({
    origen: 'Madrid-Atocha',
    destino: 'Barcelona-Sants',
    fecha: '2026-11-20',
    hora_minima: '08:00'
  });
  assert.equal(trenes.ok, true);
  assert.equal(trenes.origen, 'Madrid-Atocha');
  assert.equal(trenes.destino, 'Barcelona-Sants');
  assert.ok(trenes.total_trenes > 0);
  assert.ok(trenes.trenes.every((t) => t.salida >= '08:00'));

  // Filtro por tipo de tren
  const soloAvlo = consultarTrenesRenfe({
    origen: 'Madrid-Atocha',
    destino: 'Barcelona-Sants',
    tipo: 'Avlo'
  });
  assert.equal(soloAvlo.ok, true);
  assert.ok(soloAvlo.trenes.every((t) => t.tipo.toLowerCase().includes('avlo')));

  // Rechazo por mismo origen y destino
  assert.throws(() => {
    consultarTrenesRenfe({ origen: 'Atocha', destino: 'Madrid-Atocha' });
  }, /no pueden ser la misma estacion/);

  // 3. Radar de vuelos
  const vuelos = consultarRadarVuelos({
    origen: 'MAD',
    destino: 'LIS',
    fecha: '2026-11-25',
    precio_maximo: 150
  });
  assert.equal(vuelos.ok, true);
  assert.equal(vuelos.origen, 'MAD');
  assert.equal(vuelos.destino, 'LIS');
  assert.ok(vuelos.total > 0);
  assert.ok(vuelos.vuelos.every((v) => v.precio <= 150));
  assert.ok(vuelos.mas_barato);
  assert.equal(vuelos.mas_barato.precio, vuelos.vuelos[0].precio);

  // Filtro por aerolinea
  const vuelosIberia = consultarRadarVuelos({
    origen: 'MAD',
    destino: 'LIS',
    fecha: '2026-11-25',
    aerolinea: 'Iberia'
  });
  assert.equal(vuelosIberia.ok, true);
  assert.ok(vuelosIberia.vuelos.every((v) => v.aerolinea.includes('Iberia')));
});

test('mcp-server-lifestyle: ejecucion stdio JSON-RPC 2.0 via subproceso', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-lifestyle-stdio-'));
  const tempDbPath = path.join(tempDir, 'lifestyle_stdio.db');

  const child = spawn(process.execPath, [LIFESTYLE_SERVER_PATH], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      LIFESTYLE_DB_PATH: tempDbPath
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
    assert.equal(initRes.result.serverInfo.name, 'mcp-server-lifestyle');
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
    assert.ok(toolNames.includes('gestionar_habitos'));
    assert.ok(toolNames.includes('gestionar_lista_compra'));
    assert.ok(toolNames.includes('consultar_trenes_renfe'));
    assert.ok(toolNames.includes('consultar_radar_vuelos'));
    assert.equal(toolNames.length, 4);

    // 5. tools/call: gestionar_habitos (registrar)
    const regHabRes = await enviarPeticion({
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: {
        name: 'gestionar_habitos',
        arguments: {
          accion: 'registrar',
          nombre: 'Hacer 30 flexiones'
        }
      }
    });
    assert.equal(regHabRes.id, 4);
    assert.equal(regHabRes.result.isError, false);
    const dataHab = JSON.parse(regHabRes.result.content[0].text);
    assert.equal(dataHab.ok, true);
    assert.equal(dataHab.habito.nombre, 'Hacer 30 flexiones');

    // 6. tools/call: gestionar_habitos (marcar)
    const marcHabRes = await enviarPeticion({
      jsonrpc: '2.0',
      id: 5,
      method: 'tools/call',
      params: {
        name: 'gestionar_habitos',
        arguments: {
          accion: 'marcar',
          criterio: 'flexiones',
          fecha: new Date().toISOString().slice(0, 10)
        }
      }
    });
    assert.equal(marcHabRes.id, 5);
    assert.equal(marcHabRes.result.isError, false);
    const dataMarc = JSON.parse(marcHabRes.result.content[0].text);
    assert.equal(dataMarc.ok, true);
    assert.equal(dataMarc.racha, 1);

    // 7. tools/call: gestionar_lista_compra (anadir y listar)
    const addCmpRes = await enviarPeticion({
      jsonrpc: '2.0',
      id: 6,
      method: 'tools/call',
      params: {
        name: 'gestionar_lista_compra',
        arguments: {
          accion: 'anadir',
          items: ['Aceite de oliva virgen extra', 'Cafe en grano']
        }
      }
    });
    assert.equal(addCmpRes.id, 6);
    assert.equal(addCmpRes.result.isError, false);
    const dataAddCmp = JSON.parse(addCmpRes.result.content[0].text);
    assert.equal(dataAddCmp.ok, true);
    assert.equal(dataAddCmp.total_pendientes, 2);

    const listCmpRes = await enviarPeticion({
      jsonrpc: '2.0',
      id: 7,
      method: 'tools/call',
      params: {
        name: 'gestionar_lista_compra',
        arguments: { accion: 'listar' }
      }
    });
    assert.equal(listCmpRes.id, 7);
    const dataListCmp = JSON.parse(listCmpRes.result.content[0].text);
    assert.equal(dataListCmp.total, 2);

    // 8. tools/call: consultar_trenes_renfe
    const renfeRes = await enviarPeticion({
      jsonrpc: '2.0',
      id: 8,
      method: 'tools/call',
      params: {
        name: 'consultar_trenes_renfe',
        arguments: {
          origen: 'Madrid-Atocha',
          destino: 'Barcelona-Sants',
          fecha: '2026-11-20'
        }
      }
    });
    assert.equal(renfeRes.id, 8);
    assert.equal(renfeRes.result.isError, false);
    const dataRenfe = JSON.parse(renfeRes.result.content[0].text);
    assert.equal(dataRenfe.ok, true);
    assert.ok(dataRenfe.total_trenes > 0);

    // 9. tools/call: consultar_radar_vuelos
    const radarRes = await enviarPeticion({
      jsonrpc: '2.0',
      id: 9,
      method: 'tools/call',
      params: {
        name: 'consultar_radar_vuelos',
        arguments: {
          origen: 'MAD',
          destino: 'LIS',
          fecha: '2026-11-25'
        }
      }
    });
    assert.equal(radarRes.id, 9);
    assert.equal(radarRes.result.isError, false);
    const dataRadar = JSON.parse(radarRes.result.content[0].text);
    assert.equal(dataRadar.ok, true);
    assert.ok(dataRadar.total > 0);
  } finally {
    rl.close();
    child.kill('SIGTERM');
    await new Promise((r) => setTimeout(r, 100));
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
