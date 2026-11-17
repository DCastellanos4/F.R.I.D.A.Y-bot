/**
 * tests/sector3/phase1_fixes.test.js - Validacion tecnica de correcciones de Fase 1.
 *
 * 1. Bypass SQLite corregido (compra, finanzas, habitos usan sqliteDomainStores).
 * 2. Migracion 014: columna whatsapp_id y acuses de entrega en scheduledMessageService con SQLite.
 * 3. dailyBriefing lee cpu y ram sin retornar undefined.
 * 4. mcpRegistry.hasTool('gestionar_habitos') y hasTool('sintetizar_voz') devuelven true.
 * 5. finance/db.js lista gastos correctamente con mes numerico (ej. '03' o 3) y formato 'YYYY-MM'.
 * 6. Validar que la suite existente pase sin regresiones.
 *
 * Strict Policy: Zero Emojis.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import { abrirBaseDatos } from '../../src/adapters/outbound/persistence/sqlite/connection.js';
import { ejecutarMigraciones } from '../../src/adapters/outbound/persistence/sqlite/migraciones.js';
import {
  crearSqliteShoppingStore,
  crearSqliteHabitsStore,
  crearSqliteScheduledMessageStore
} from '../../src/adapters/outbound/persistence/sqlite/sqliteDomainStores.js';
import { ejecutarHerramienta } from '../../src/core/jarvisAgent.js';
import {
  registrarStoreCompraPorDefecto,
  listarCompra
} from '../../src/services/shoppingService.js';
import {
  registrarStoreHabitosPorDefecto,
  listarHabitos
} from '../../src/services/habitsService.js';
import {
  registrarStoreFinanzasPorDefecto,
  listarGastos as listarGastosServicio
} from '../../src/services/financeService.js';
import {
  programarMensaje,
  leerMensajesProgramados,
  registrarIdWhatsApp,
  procesarActualizacionEntrega,
  registrarStoreMensajesProgramadosPorDefecto
} from '../../src/services/scheduledMessageService.js';
import { generarBriefingCompleto } from '../../src/services/dailyBriefing.js';
import { consultarSaludServidor } from '../../src/monitors/proactiveAlerts.js';
import { McpRegistry } from '../../src/adapters/outbound/mcp/mcpRegistry.js';
import { crearFinanceDb } from '../../mcp-servers/finance/db.js';
import { registrarApagadoLimpio } from '../../whatsappBot.js';

function crearDbTest(prefijo = 'davis-phase1-') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefijo));
  const rutaDb = path.join(dir, 'test.db');
  const db = abrirBaseDatos(rutaDb);
  ejecutarMigraciones(db);
  return {
    db,
    dir,
    cerrar: () => {
      try { db.close(); } catch {}
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
    }
  };
}

// ---------------------------------------------------------------------------
// 1. Bypass SQLite corregido (compra, finanzas, habitos usan sqliteDomainStores)
// ---------------------------------------------------------------------------

test('Fase 1 - Bypass SQLite: anadir_compra y listar_compra persisten en SQLite store', async () => {
  const { db, cerrar } = crearDbTest('davis-shopping-');
  try {
    const store = crearSqliteShoppingStore(db);
    registrarStoreCompraPorDefecto(store);

    // Invocacion mediante ejecutarHerramienta sin rutaArchivo forzada
    const res = await ejecutarHerramienta('anadir_compra', { items: ['cafe tostado', 'leche entera'] }, {
      tenantId: 'propietario',
      storeCompra: store
    });
    assert.ok(res && typeof res.texto === 'string');
    assert.match(res.texto, /Anadido a la compra/i);

    const itemsEnStore = store.listar('propietario');
    assert.ok(itemsEnStore.includes('cafe tostado'));
    assert.ok(itemsEnStore.includes('leche entera'));

    const itemsServicio = listarCompra({ store, tenantId: 'propietario' });
    assert.equal(itemsServicio.length, 2);

    const resTachar = await ejecutarHerramienta('tachar_compra', { criterio: 'cafe tostado' }, {
      tenantId: 'propietario',
      storeCompra: store
    });
    assert.ok(resTachar && typeof resTachar.texto === 'string');
    assert.match(resTachar.texto, /Tachado de la compra/i);
    assert.deepEqual(store.listar('propietario'), ['leche entera']);
  } finally {
    registrarStoreCompraPorDefecto(null);
    cerrar();
  }
});

test('Fase 1 - Bypass SQLite: registrar_habito y listar_habitos persisten en SQLite store', async () => {
  const { db, cerrar } = crearDbTest('davis-habits-');
  try {
    const store = crearSqliteHabitsStore(db);
    registrarStoreHabitosPorDefecto(store);

    const res = await ejecutarHerramienta('registrar_habito', { nombre: 'meditacion matutina' }, {
      tenantId: 'propietario',
      storeHabitos: store
    });
    assert.ok(res && typeof res.texto === 'string');
    assert.match(res.texto, /Habito registrado/i);

    const habitos = store.listar('propietario');
    assert.equal(habitos.length, 1);
    assert.equal(habitos[0].nombre, 'meditacion matutina');

    const resMarcar = await ejecutarHerramienta('marcar_habito', { criterio: 'meditacion matutina' }, {
      tenantId: 'propietario',
      storeHabitos: store
    });
    assert.ok(resMarcar && typeof resMarcar.texto === 'string');
    assert.match(resMarcar.texto, /Marcado/i);

    const habitosActualizados = store.listar('propietario');
    assert.equal(habitosActualizados[0].racha, 1);
  } finally {
    registrarStoreHabitosPorDefecto(null);
    cerrar();
  }
});

test('Fase 1 - Robustez jarvisAgent: tipo_tunel nulo no arroja excepcion', async () => {
  const resTunel = await ejecutarHerramienta('manage_tunnel', {}, { tenantId: 'propietario' });
  assert.ok(resTunel && typeof resTunel.texto === 'string');
  assert.match(resTunel.texto, /Debes indicar el tipo de tunel/i);
});

// ---------------------------------------------------------------------------
// 2. Migracion 014: whatsapp_id y acuses de entrega en scheduledMessageService con SQLite
// ---------------------------------------------------------------------------

test('Fase 1 - Migracion 014: columna whatsapp_id existe en tabla mensajes_programados', () => {
  const { db, cerrar } = crearDbTest('davis-migracion014-');
  try {
    const infoColumnas = db.prepare('PRAGMA table_info(mensajes_programados)').all();
    const nombres = infoColumnas.map((col) => col.name);
    assert.ok(nombres.includes('whatsapp_id'), 'La columna whatsapp_id debe existir tras migracion 014');

    const indices = db.prepare('PRAGMA index_list(mensajes_programados)').all();
    const nombresIndices = indices.map((idx) => idx.name);
    assert.ok(nombresIndices.includes('idx_mensajes_prog_whatsapp_id'), 'El indice idx_mensajes_prog_whatsapp_id debe existir');
  } finally {
    cerrar();
  }
});

test('Fase 1 - sqliteDomainStores: crearSqliteScheduledMessageStore soporta whatsapp_id y acuses', () => {
  const { db, cerrar } = crearDbTest('davis-sched-store-');
  try {
    const store = crearSqliteScheduledMessageStore(db);

    const guardado = store.guardar({
      id: 'msg_test_01',
      jid: '34600111222@s.whatsapp.net',
      mensaje: 'Prueba de envio programado',
      fechaEnvio: '2026-11-20T10:00:00.000Z',
      estado: 'pendiente',
      whatsappId: 'WAMID-TEST-001'
    }, 'propietario');

    assert.equal(guardado.id, 'msg_test_01');

    const encontrado = store.buscarPorWhatsappId('WAMID-TEST-001');
    assert.ok(encontrado, 'Debe encontrar el mensaje por whatsapp_id');
    assert.equal(encontrado.id, 'msg_test_01');
    assert.equal(encontrado.whatsapp_id, 'WAMID-TEST-001');

    // Actualizacion de whatsapp_id
    const okActualizarWa = store.actualizarWhatsappId('msg_test_01', 'WAMID-TEST-002');
    assert.equal(okActualizarWa, true);
    assert.equal(store.buscarPorWhatsappId('WAMID-TEST-001'), null);
    assert.ok(store.buscarPorWhatsappId('WAMID-TEST-002'));

    // Actualizacion de estado por whatsapp_id (acuse de entrega)
    const resEstado = store.actualizarEstadoPorWhatsappId('WAMID-TEST-002', 'entregado');
    assert.equal(resEstado.ok, true);

    const filaActualizada = store.buscarPorWhatsappId('WAMID-TEST-002');
    assert.equal(filaActualizada.estado, 'entregado');
  } finally {
    cerrar();
  }
});

test('Fase 1 - scheduledMessageService: integracion completa con store SQLite para acuses', () => {
  const { db, cerrar } = crearDbTest('davis-sched-service-');
  try {
    const store = crearSqliteScheduledMessageStore(db);
    registrarStoreMensajesProgramadosPorDefecto(store);

    const prog = programarMensaje({
      numero: '+34600333444',
      mensaje: 'Prueba reconciliacion SQLite',
      minutosEnElFuturo: 10
    }, { store });

    assert.equal(prog.ok, true);
    const idProg = prog.programado.id;

    // Registrar ID de WhatsApp devuelto por canal
    const idWa = 'BAILEYS-KEY-XYZ-999';
    const okReg = registrarIdWhatsApp(idProg, idWa, { store });
    assert.equal(okReg, true);

    // Verificar lectura reflejada
    const listaInicial = leerMensajesProgramados({ store });
    const encontrado = listaInicial.find((m) => m.id === idProg);
    assert.ok(encontrado);
    assert.equal(encontrado.whatsappId, idWa);

    // Procesar acuse de recibo de entrega (status 3 = entregado)
    const transEntrega = procesarActualizacionEntrega([
      { key: { id: idWa }, update: { status: 3 } }
    ], { store });

    assert.equal(transEntrega.length, 1);
    assert.equal(transEntrega[0].estado, 'entregado');

    const msgEntregado = store.buscarPorWhatsappId(idWa);
    assert.equal(msgEntregado.estado, 'entregado');

    // Procesar acuse de recibo de lectura (status 4 = leido)
    const transLectura = procesarActualizacionEntrega([
      { key: { id: idWa }, update: { status: 4 } }
    ], { store });

    assert.equal(transLectura.length, 1);
    assert.equal(transLectura[0].estado, 'leido');

    const msgLeido = store.buscarPorWhatsappId(idWa);
    assert.equal(msgLeido.estado, 'leido');
  } finally {
    registrarStoreMensajesProgramadosPorDefecto(null);
    cerrar();
  }
});

// ---------------------------------------------------------------------------
// 3. dailyBriefing lee cpu y ram sin retornar undefined
// ---------------------------------------------------------------------------

test('Fase 1 - dailyBriefing: consultarSaludServidor provee cpuUsage y memoryUsage sin undefined', () => {
  const salud = consultarSaludServidor();
  assert.ok(salud !== null && typeof salud === 'object');
  assert.notEqual(salud.cpuUsage, undefined);
  assert.notEqual(salud.memoryUsage, undefined);
  assert.notEqual(salud.totalRamGB, undefined);
  assert.notEqual(salud.libreRamGB, undefined);
});

test('Fase 1 - dailyBriefing: generarBriefingCompleto formatea CPU y Memoria sin undefined', async () => {
  const briefing = await generarBriefingCompleto('Madrid', {
    climaFn: async () => ({ tempMax: 20, tempMin: 10, descripcion: 'Despejado', lluviaProb: 0 }),
    cercaniasFn: async () => [],
    emtFn: async () => []
  });

  assert.ok(typeof briefing === 'string');
  assert.match(briefing, /Estado del host: CPU \S+ \| Memoria \S+ \| Operativo/);
  assert.equal(briefing.includes('undefined'), false, 'El briefing no debe contener literales undefined');
});

// ---------------------------------------------------------------------------
// 4. mcpRegistry.hasTool('gestionar_habitos') y hasTool('sintetizar_voz') devuelven true
// ---------------------------------------------------------------------------

test('Fase 1 - mcpRegistry: hasTool reconoce herramientas de lifestyle y media sin latencia stdio', () => {
  const registry = new McpRegistry();

  const dummyClient = {
    domain: 'test',
    toolsList: async () => [],
    callTool: async () => ({ content: [] }),
    close: async () => {}
  };

  registry.registerServer('lifestyle', dummyClient);
  registry.registerServer('media', dummyClient);

  assert.equal(registry.hasTool('gestionar_habitos'), true);
  assert.equal(registry.hasTool('gestionar_lista_compra'), true);
  assert.equal(registry.hasTool('sintetizar_voz'), true);
  assert.equal(registry.hasTool('transcribir_audio'), true);
  assert.equal(registry.hasTool('descargar_multimedia'), true);

  // Comprobar que dominios previos se mantienen
  registry.registerServer('finance', dummyClient);
  assert.equal(registry.hasTool('registrar_gasto'), true);
  assert.equal(registry.hasTool('listar_gastos'), true);

  // Herramienta inexistente retorna false
  assert.equal(registry.hasTool('herramienta_totalmente_inexistente'), false);
});

// ---------------------------------------------------------------------------
// 5. finance/db.js lista gastos correctamente con mes numerico y formato YYYY-MM
// ---------------------------------------------------------------------------

test('Fase 1 - finance/db.js: listarGastos filtra correctamente con mes numerico, pad y YYYY-MM', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'davis-finance-db-'));
  const rutaDb = path.join(dir, 'finance.db');

  try {
    const fdb = crearFinanceDb(rutaDb);

    fdb.registrarGasto({
      monto: 15.50,
      concepto: 'Supermercado Marzo',
      categoria: 'alimentacion',
      fecha: '2026-03-10',
      tenant_id: 'propietario'
    });

    fdb.registrarGasto({
      monto: 42.00,
      concepto: 'Farmacia Marzo',
      categoria: 'salud',
      fecha: '2026-03-25',
      tenant_id: 'propietario'
    });

    fdb.registrarGasto({
      monto: 80.00,
      concepto: 'Restaurante Abril',
      categoria: 'ocio',
      fecha: '2026-04-05',
      tenant_id: 'propietario'
    });

    // 1. Filtro mes numerico entero 3
    const gastosMes3 = fdb.listarGastos({ mes: 3, tenant_id: 'propietario' });
    assert.equal(gastosMes3.length, 2);
    assert.ok(gastosMes3.every((g) => g.fecha.startsWith('2026-03')));

    // 2. Filtro mes con string '03'
    const gastosMes03 = fdb.listarGastos({ mes: '03', tenant_id: 'propietario' });
    assert.equal(gastosMes03.length, 2);

    // 3. Filtro mes en formato 'YYYY-MM'
    const gastosMesYyyyMm = fdb.listarGastos({ mes: '2026-03', tenant_id: 'propietario' });
    assert.equal(gastosMesYyyyMm.length, 2);

    // 4. Filtro mes 4 / '04'
    const gastosMes4 = fdb.listarGastos({ mes: 4, tenant_id: 'propietario' });
    assert.equal(gastosMes4.length, 1);
    assert.equal(gastosMes4[0].concepto, 'Restaurante Abril');

    // 5. Mes sin gastos
    const gastosMes5 = fdb.listarGastos({ mes: '05', tenant_id: 'propietario' });
    assert.equal(gastosMes5.length, 0);

    // 6. Resumen mensual
    const resumen = fdb.resumenGastosMes({ anio: 2026, mes: 3, tenant_id: 'propietario' });
    assert.equal(resumen.total, 57.50);

    fdb.cerrar();
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  }
});

test('Fase 1 - finance/db.js: validacion de campos requeridos en registrarGasto', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'davis-finance-cat-'));
  const rutaDb = path.join(dir, 'finance.db');

  try {
    const fdb = crearFinanceDb(rutaDb);

    assert.throws(() => {
      fdb.registrarGasto({ monto: 20 });
    }, /categoria es obligatoria/);

    assert.throws(() => {
      fdb.registrarGasto({ monto: 20, categoria: 'comida' });
    }, /concepto es obligatorio/);

    const res = fdb.registrarGasto({
      monto: 25.00,
      categoria: 'general',
      concepto: 'Compra de material'
    });

    assert.equal(res.ok, true);
    assert.equal(res.gasto.categoria, 'general');
    fdb.cerrar();
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  }
});

// ---------------------------------------------------------------------------
// 6. whatsappBot graceful shutdown
// ---------------------------------------------------------------------------

test('Fase 1 - whatsappBot: registrarApagadoLimpio expone funcion de cierre limpio', () => {
  let cerrado = false;
  const mockPersistencia = {
    cerrar: () => { cerrado = true; }
  };

  const { cerrar } = registrarApagadoLimpio({
    persistencia: mockPersistencia,
    salir: false
  });

  cerrar();
  assert.equal(cerrado, true, 'persistencia.cerrar debe invocarse durante el apagado limpio');
});
