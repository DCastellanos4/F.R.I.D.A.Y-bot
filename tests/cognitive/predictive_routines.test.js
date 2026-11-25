/**
 * predictive_routines.test.js - Pruebas de Proactividad Predictiva Basada en Rutinas
 *
 * Valida franjas Europe/Madrid, aislamiento por tenant en SQLite y JSON,
 * politica de privacidad (solo metadatos, ignora 'conversacion'), prediccion
 * por umbral y confianza, integracion en dailyBriefing y cableado de herramientas.
 *
 * Strict Policy: Zero Emojis.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';

import { ejecutarMigraciones } from '../../src/adapters/outbound/persistence/sqlite/migraciones.js';
import { crearSqliteRoutineStore } from '../../src/adapters/outbound/persistence/sqlite/sqliteDomainStores.js';
import {
  registrarStoreRutinasPorDefecto,
  franjaHorariaDe,
  diaSemanaDe,
  registrarActividadRutina,
  predecirNecesidades,
  formatearRutinasAprendidas
} from '../../src/services/habitPatternPredictorService.js';
import { generarBriefingCompleto, eliminarEmojis } from '../../src/services/dailyBriefing.js';
import { NOMBRES_HERRAMIENTAS_JARVIS, MAPA_INTENCION_HERRAMIENTAS } from '../../src/core/tools.js';
import { CLASIFICACION_HERRAMIENTAS } from '../../src/services/rbacService.js';
import { HERRAMIENTAS_PERSONAL } from '../../src/services/specialistRouterService.js';
import { HERRAMIENTAS_IDEMPOTENTES_SET } from '../../src/services/preSendGuardrailService.js';
import { consultarJarvis, analizarIntencion } from '../../src/core/jarvisAgent.js';

function crearDbTemporal() {
  const db = new Database(':memory:');
  ejecutarMigraciones(db);
  return db;
}

test('franjaHorariaDe y diaSemanaDe calculan bloques de 2h y dia 0-6 en Europe/Madrid', () => {
  // 2026-11-23 es lunes (CET = UTC+1)
  const lunes0830Madrid = new Date('2026-11-23T07:30:00Z');
  assert.equal(franjaHorariaDe(lunes0830Madrid), '08-10');
  assert.equal(diaSemanaDe(lunes0830Madrid), 1);

  // Medianoche en Madrid (23:15Z domingo en invierno -> 00:15 lunes Madrid)
  const medianocheMadrid = new Date('2026-11-22T23:15:00Z');
  assert.equal(franjaHorariaDe(medianocheMadrid), '00-02');
  assert.equal(diaSemanaDe(medianocheMadrid), 1);

  // Franja nocturna 22-24
  const nocheMadrid = new Date('2026-11-23T21:45:00Z'); // 22:45 CET
  assert.equal(franjaHorariaDe(nocheMadrid), '22-24');
});

test('registrarActividadRutina ignora conversacion, valida tenantId y no almacena texto', () => {
  const db = crearDbTemporal();
  const store = crearSqliteRoutineStore(db);

  try {
    const ign = registrarActividadRutina(
      { intencion: 'conversacion', herramienta: '', fecha: new Date('2026-11-23T07:30:00Z') },
      { store, tenantId: 'propietario' }
    );
    assert.equal(ign.registrada, false);
    assert.equal(store.listarTodas('propietario').length, 0);

    assert.throws(
      () => registrarActividadRutina({ intencion: 'clima' }, { store, tenantId: '../evil' }),
      TypeError
    );
    assert.throws(
      () => registrarActividadRutina({ intencion: 'clima' }, { store, tenantId: '' }),
      TypeError
    );

    const ok = registrarActividadRutina(
      { intencion: 'transporte', herramienta: 'proximas_llegadas_transporte', fecha: new Date('2026-11-23T07:30:00Z') },
      { store, tenantId: 'propietario' }
    );
    assert.equal(ok.registrada, true);
    const filas = store.listarTodas('propietario');
    assert.equal(filas.length, 1);
    assert.deepEqual(
      Object.keys(filas[0]).sort(),
      ['conteo', 'dia_semana', 'franja_horaria', 'herramienta', 'intencion', 'tenant_id', 'ultima_vez']
    );
  } finally {
    db.close();
  }
});

test('SQLite routineStore aisla por tenant y predecirNecesidades aplica umbral y confianza', () => {
  const db = crearDbTemporal();
  const store = crearSqliteRoutineStore(db);
  const lunes0830 = new Date('2026-11-23T07:30:00Z'); // 08-10 Madrid, lunes (1)
  const lunes1830 = new Date('2026-11-23T17:30:00Z'); // 18-20 Madrid, lunes (1)

  try {
    for (let i = 0; i < 4; i++) {
      registrarActividadRutina(
        { intencion: 'transporte', herramienta: 'proximas_llegadas_transporte', fecha: lunes0830 },
        { store, tenantId: 'propietario' }
      );
    }
    for (let i = 0; i < 2; i++) {
      registrarActividadRutina(
        { intencion: 'clima', herramienta: 'consultar_clima', fecha: lunes1830 },
        { store, tenantId: 'propietario' }
      );
    }
    for (let i = 0; i < 5; i++) {
      registrarActividadRutina(
        { intencion: 'finanzas', herramienta: 'resumen_gastos_mes', fecha: lunes0830 },
        { store, tenantId: 'cliente_alpha' }
      );
    }

    const predProp = predecirNecesidades({ fecha: lunes0830, umbralMinimo: 3 }, { store, tenantId: 'propietario' });
    assert.equal(predProp.length, 1);
    assert.equal(predProp[0].intencion, 'transporte');
    assert.equal(predProp[0].franjaHoraria, '08-10');
    assert.equal(predProp[0].conteo, 4);
    assert.ok(predProp[0].confianza >= 0.5 && predProp[0].confianza < 1);

    const predFranjaVacia = predecirNecesidades(
      { fecha: lunes0830, umbralMinimo: 3, franja: '18-20' },
      { store, tenantId: 'propietario' }
    );
    assert.equal(predFranjaVacia.length, 0);

    const predTenant = predecirNecesidades({ fecha: lunes0830, umbralMinimo: 3 }, { store, tenantId: 'cliente_alpha' });
    assert.equal(predTenant.length, 1);
    assert.equal(predTenant[0].intencion, 'finanzas');
    assert.equal(predTenant[0].tenantId, 'cliente_alpha');
  } finally {
    db.close();
  }
});

test('fallback JSON en deps.rutaArchivo aisla tenants y respeta NODE_ENV=test sin escribir en data/', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'davis-routines-json-'));
  const rutaArchivo = path.join(dir, 'routines_activity.json');
  const martes0900 = new Date('2026-11-24T08:00:00Z'); // 09:00 Madrid (08-10)

  try {
    for (let i = 0; i < 3; i++) {
      registrarActividadRutina(
        { intencion: 'recordatorio', herramienta: 'listar_recordatorios', fecha: martes0900 },
        { rutaArchivo, tenantId: 'propietario' }
      );
    }
    registrarActividadRutina(
      { intencion: 'empleo', herramienta: 'listar_candidaturas', fecha: martes0900 },
      { rutaArchivo, tenantId: 'tenant_beta' }
    );

    const predProp = predecirNecesidades({ fecha: martes0900, umbralMinimo: 3 }, { rutaArchivo, tenantId: 'propietario' });
    assert.equal(predProp.length, 1);
    assert.equal(predProp[0].intencion, 'recordatorio');

    const predBeta = predecirNecesidades({ fecha: martes0900, umbralMinimo: 3 }, { rutaArchivo, tenantId: 'tenant_beta' });
    assert.equal(predBeta.length, 0);

    const texto = formatearRutinasAprendidas({ rutaArchivo, tenantId: 'propietario' });
    assert.match(texto, /Martes \[08-10\]/);
    assert.match(texto, /listar_recordatorios/);
    assert.equal(texto, eliminarEmojis(texto));

    // Verificar aislamiento en NODE_ENV=test cuando no se pasa rutaArchivo ni DAVIS_DATA_DIR
    const prevNodeEnv = process.env.NODE_ENV;
    const prevDataDir = process.env.DAVIS_DATA_DIR;
    try {
      process.env.NODE_ENV = 'test';
      delete process.env.DAVIS_DATA_DIR;
      const resAislado = registrarActividadRutina(
        { intencion: 'clima', herramienta: 'consultar_clima', fecha: martes0900 },
        { tenantId: 'propietario' }
      );
      assert.equal(resAislado.registrada, false);
      assert.equal(resAislado.motivo, 'aislamiento_test');
    } finally {
      if (prevNodeEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = prevNodeEnv;
      if (prevDataDir === undefined) delete process.env.DAVIS_DATA_DIR; else process.env.DAVIS_DATA_DIR = prevDataDir;
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('registrarStoreRutinasPorDefecto conecta el store por defecto sin deps explicitas', () => {
  const db = crearDbTemporal();
  const store = crearSqliteRoutineStore(db);
  const miercoles = new Date('2026-11-25T07:15:00Z');

  try {
    registrarStoreRutinasPorDefecto(store);
    for (let i = 0; i < 3; i++) {
      registrarActividadRutina({ intencion: 'cerebro', herramienta: 'buscar_recuerdo_semantico', fecha: miercoles });
    }
    const preds = predecirNecesidades({ fecha: miercoles, umbralMinimo: 3 });
    assert.equal(preds.length, 1);
    assert.equal(preds[0].intencion, 'cerebro');
  } finally {
    registrarStoreRutinasPorDefecto(null);
    db.close();
  }
});

test('dailyBriefing incluye [SUGERENCIAS PREDICTIVAS DE RUTINA] solo cuando existen predicciones y sin emojis', async () => {
  const db = crearDbTemporal();
  const store = crearSqliteRoutineStore(db);
  const jueves = new Date('2026-11-26T05:55:00Z'); // 06:55 Madrid

  try {
    const briefingSinRutinas = await generarBriefingCompleto({
      ahora: jueves.toISOString(),
      consultarCitasBooking: async () => [],
      consultarEventos: async () => ({ ok: true, eventos: [] }),
      routineStore: store
    });
    assert.equal(briefingSinRutinas.includes('[SUGERENCIAS PREDICTIVAS DE RUTINA]'), false);

    for (let i = 0; i < 3; i++) {
      registrarActividadRutina(
        { intencion: 'transporte', herramienta: 'proximas_llegadas_transporte', fecha: new Date('2026-11-26T07:30:00Z') },
        { store, tenantId: 'propietario' }
      );
    }

    const briefingConRutinas = await generarBriefingCompleto({
      ahora: jueves.toISOString(),
      consultarCitasBooking: async () => [],
      consultarEventos: async () => ({ ok: true, eventos: [] }),
      routineStore: store
    });
    assert.match(briefingConRutinas, /\[SUGERENCIAS PREDICTIVAS DE RUTINA\]/);
    assert.match(briefingConRutinas, /transporte/);
    assert.equal(briefingConRutinas, eliminarEmojis(briefingConRutinas));
  } finally {
    db.close();
  }
});

test('cableado de consultar_rutinas_aprendidas en tools, rbac, specialistRouter y guardrails', () => {
  assert.ok(NOMBRES_HERRAMIENTAS_JARVIS.has('consultar_rutinas_aprendidas'));
  assert.deepEqual(MAPA_INTENCION_HERRAMIENTAS.rutinas, ['consultar_rutinas_aprendidas']);
  assert.ok(CLASIFICACION_HERRAMIENTAS.datos_tenant.includes('consultar_rutinas_aprendidas'));
  assert.ok(HERRAMIENTAS_PERSONAL.includes('consultar_rutinas_aprendidas'));
  assert.ok(HERRAMIENTAS_IDEMPOTENTES_SET.has('consultar_rutinas_aprendidas'));
});

test('integracion consultarJarvis registra actividad post-turno, ignora chitchat y ejecuta consultar_rutinas_aprendidas', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'davis-routines-int-'));
  const db = crearDbTemporal();
  const store = crearSqliteRoutineStore(db);

  try {
    const analisis = analizarIntencion('que rutinas has aprendido de mi');
    assert.ok(analisis.intenciones.includes('rutinas'));
    assert.ok(analisis.herramientas.some((h) => h.function.name === 'consultar_rutinas_aprendidas'));

    // 1) Turno real de clima -> registra actividad en routineStore
    let turnoClima = 0;
    const resClima = await consultarJarvis('que tiempo hace en Madrid', [], {
      chatId: 'routines-int-chat',
      carpetaTrazas: dir,
      rutaArchivoIdempotencia: path.join(dir, 'idemp.json'),
      retornarTraza: true,
      topKMemorias: 0,
      routineStore: store,
      ejecutores: {
        consultar_clima: async () => 'Madrid: 20C despejado'
      },
      chatCompletion: async () => {
        turnoClima++;
        if (turnoClima === 1) {
          return {
            message: {
              role: 'assistant',
              content: '',
              tool_calls: [{ id: 'c1', function: { name: 'consultar_clima', arguments: { ubicacion: 'Madrid' } } }]
            }
          };
        }
        return { message: { role: 'assistant', content: 'En Madrid hace 20C.' } };
      }
    });
    assert.equal(resClima.traza.rutinaRegistrada, true);

    // 2) Chit-chat -> no registra actividad
    const resChat = await consultarJarvis('hola, buenos dias', [], {
      chatId: 'routines-int-chat',
      carpetaTrazas: dir,
      rutaArchivoIdempotencia: path.join(dir, 'idemp.json'),
      retornarTraza: true,
      topKMemorias: 0,
      routineStore: store,
      chatCompletion: async () => ({ message: { role: 'assistant', content: 'Buenos dias.' } })
    });
    assert.equal(resChat.traza.rutinaRegistrada, undefined);

    const filas = store.listarTodas('propietario');
    assert.equal(filas.length, 1);
    assert.equal(filas[0].intencion, 'clima');
    assert.equal(filas[0].herramienta, 'consultar_clima');

    // 3) Consulta directa mediante handler consultar_rutinas_aprendidas en jarvisAgent
    let turnoRutinas = 0;
    let payloadToolRutinas = '';
    const resConsulta = await consultarJarvis('dime mis rutinas aprendidas', [], {
      chatId: 'routines-int-chat',
      carpetaTrazas: dir,
      rutaArchivoIdempotencia: path.join(dir, 'idemp.json'),
      retornarTraza: true,
      topKMemorias: 0,
      routineStore: store,
      chatCompletion: async (peticion) => {
        turnoRutinas++;
        if (turnoRutinas === 1) {
          return {
            message: {
              role: 'assistant',
              content: '',
              tool_calls: [{ id: 'r1', function: { name: 'consultar_rutinas_aprendidas', arguments: {} } }]
            }
          };
        }
        const msgTool = peticion.messages.find((m) => m.role === 'tool');
        payloadToolRutinas = msgTool?.content || '';
        return { message: { role: 'assistant', content: payloadToolRutinas } };
      }
    });

    assert.match(payloadToolRutinas, /Rutinas de actividad aprendidas/);
    assert.match(payloadToolRutinas, /clima/);
    assert.match(payloadToolRutinas, /consultar_clima/);
    assert.equal(resConsulta.respuesta, eliminarEmojis(resConsulta.respuesta));
  } finally {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
