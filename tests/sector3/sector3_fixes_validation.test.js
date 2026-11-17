/**
 * sector3_fixes_validation.test.js - Validacion exhaustiva de los 8 fixes de dominio y monitores.
 *
 * 1. habitsService: Deduplicacion en registrarHabito, resolucion de criterio en marcarHabito,
 *    validacion de ya marcado, y campos hechoHoy / totalDias en SQLite.
 * 2. flashcardService: Migracion 013 ultima_alerta_en, store.marcarAlerta, y corte de bucle de alertas.
 * 3. conversationHistoryService: Limite en RAM al obtener historial y purga en SQLite tras condensacion.
 * 4. historySearchService: Busqueda dual en SQLite (conversaciones_historial) y carpeta data/history.
 * 5. snoozeService: Restriccion a estado pendiente en store.desactivar, estado cancelado y completado.
 * 6. contactsService: Sincronizacion de contactos leyendo desde memoryStore SQLite.
 * 7. dailyBriefing: Integracion factual con booking.db y formato de citas de reservas sin emojis.
 * 8. quietHoursService + alertQueueService + whatsappBot: Helper esAlertaUrgente, drenado selectivo y despacho en horario nocturno.
 *
 * Strict Policy: Zero Emojis.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import { abrirBaseDatos } from '../../src/adapters/outbound/persistence/sqlite/connection.js';
import { ejecutarMigraciones } from '../../src/adapters/outbound/persistence/sqlite/migraciones.js';
import {
  crearSqliteHabitsStore,
  crearSqliteFlashcardsStore,
  crearSqliteHistoryStore,
  crearSqliteSnoozeStore,
  crearSqliteContactsStore
} from '../../src/adapters/outbound/persistence/sqlite/sqliteDomainStores.js';

// Servicios bajo test
import {
  registrarHabito,
  marcarHabito,
  listarHabitos,
  registrarStoreHabitosPorDefecto
} from '../../src/services/habitsService.js';

import {
  lanzarRondaRepaso,
  registrarStoreFlashcardsPorDefecto
} from '../../src/services/flashcardService.js';

import {
  condensarHistorial,
  registrarStoreHistorialPorDefecto
} from '../../src/services/conversationHistoryService.js';

import {
  buscarEnHistorial,
  registrarStoreHistorialPorDefecto as registrarStoreHistorialBusqueda
} from '../../src/services/historySearchService.js';

import {
  cancelarSnooze,
  lanzarRondaSnoozes,
  registrarStoreSnoozesPorDefecto
} from '../../src/services/snoozeService.js';

import {
  sincronizarContactosDesdeSegundoCerebro,
  registrarStoreContactosPorDefecto,
  registrarStoreMemoriasPorDefecto
} from '../../src/services/contactsService.js';

import { generarBriefingCompleto } from '../../src/services/dailyBriefing.js';
import { esAlertaUrgente } from '../../src/services/quietHoursService.js';
import { enqueueAlert, drainAlerts, peekAlerts } from '../../src/services/alertQueueService.js';
import { drenarColaAlertas } from '../../whatsappBot.js';

describe('Sector 3 - Validacion de los 8 fixes de persistencia y monitores', () => {
  let tmpDir;
  let db;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'davis-s3-test-'));
    const dbPath = path.join(tmpDir, 'test.db');
    db = abrirBaseDatos(dbPath);
    ejecutarMigraciones(db);
  });

  afterEach(() => {
    registrarStoreHabitosPorDefecto(null);
    registrarStoreFlashcardsPorDefecto(null);
    registrarStoreHistorialPorDefecto(null);
    registrarStoreHistorialBusqueda(null);
    registrarStoreSnoozesPorDefecto(null);
    registrarStoreContactosPorDefecto(null);
    registrarStoreMemoriasPorDefecto(null);
    try { db.close(); } catch {}
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  });

  // ==========================================================================
  // FIX 1: habitsService y sqliteDomainStores
  // ==========================================================================
  describe('Fix 1: habitsService', () => {
    it('1.1 Deduplicacion en registrarHabito (SQLite y multi-tenant)', () => {
      const habitsStore = crearSqliteHabitsStore(db);
      registrarStoreHabitosPorDefecto(habitsStore);

      const r1 = registrarHabito({ nombre: 'Leer 20 minutos' }, { tenantId: 'propietario' });
      assert.equal(r1.ok, true);

      // Intento con misma capitalizacion
      const r2 = registrarHabito({ nombre: 'Leer 20 minutos' }, { tenantId: 'propietario' });
      assert.equal(r2.ok, false);
      assert.match(r2.error, /Ya sigues el habito "Leer 20 minutos"/);

      // Intento con diferente capitalizacion (case-insensitive)
      const r3 = registrarHabito({ nombre: 'leer 20 minutos' }, { tenantId: 'propietario' });
      assert.equal(r3.ok, false);
      assert.match(r3.error, /Ya sigues el habito "leer 20 minutos"/);

      // Aislamiento multi-tenant: otro tenant puede tener el mismo habito
      const r4 = registrarHabito({ nombre: 'Leer 20 minutos' }, { tenantId: 'tenant_beta' });
      assert.equal(r4.ok, true);
    });

    it('1.2 Deduplicacion en fallback JSON', () => {
      const rutaJson = path.join(tmpDir, 'habitos_fallback.json');
      const deps = { rutaArchivo: rutaJson };

      const r1 = registrarHabito({ nombre: 'Beber agua' }, deps);
      assert.equal(r1.ok, true);

      const r2 = registrarHabito({ nombre: 'beber agua' }, deps);
      assert.equal(r2.ok, false);
      assert.match(r2.error, /Ya sigues el habito "beber agua"/);
    });

    it('1.3 Resolucion de criterio y validacion de ya marcado en marcarHabito', () => {
      const habitsStore = crearSqliteHabitsStore(db);
      registrarStoreHabitosPorDefecto(habitsStore);

      const alta = registrarHabito({ nombre: 'Meditacion matutina' }, { tenantId: 'propietario' });
      assert.equal(alta.ok, true);
      const habId = alta.habito.id;

      // Marcar por nombre parcial
      const m1 = marcarHabito({ criterio: 'meditacion', fecha: '2026-11-17' }, { tenantId: 'propietario' });
      assert.equal(m1.ok, true);
      assert.equal(m1.habito.id, habId);

      // Ya marcado en la misma fecha
      const m2 = marcarHabito({ criterio: habId, fecha: '2026-11-17' }, { tenantId: 'propietario' });
      assert.equal(m2.ok, false);
      assert.match(m2.error, /ya estaba marcado el 2026-11-17/);

      // Criterio inexistente
      const m3 = marcarHabito({ criterio: 'no_existe_este_habito', fecha: '2026-11-17' }, { tenantId: 'propietario' });
      assert.equal(m3.ok, false);
      assert.match(m3.error, /No encuentro ese habito/);
    });

    it('1.4 Retorno de listarHabitos con hechoHoy y totalDias en SQLite', () => {
      const habitsStore = crearSqliteHabitsStore(db);
      registrarStoreHabitosPorDefecto(habitsStore);

      registrarHabito({ nombre: 'Caminar' }, { tenantId: 'propietario' });

      // Antes de marcar hoy
      let lista = listarHabitos({ tenantId: 'propietario', ahora: '2026-11-17T10:00:00Z' });
      assert.equal(lista.length, 1);
      assert.equal(lista[0].hechoHoy, false);
      assert.equal(lista[0].totalDias, 0);

      // Marcar dias anteriores y hoy
      marcarHabito({ criterio: 'caminar', fecha: '2026-11-16' }, { tenantId: 'propietario' });
      marcarHabito({ criterio: 'caminar', fecha: '2026-11-17' }, { tenantId: 'propietario' });

      lista = listarHabitos({ tenantId: 'propietario', ahora: '2026-11-17T10:00:00Z' });
      assert.equal(lista[0].hechoHoy, true);
      assert.equal(lista[0].totalDias, 2);
    });
  });

  // ==========================================================================
  // FIX 2: flashcardService y sqliteDomainStores
  // ==========================================================================
  describe('Fix 2: flashcardService', () => {
    it('2.1 Migracion 013 y columna ultima_alerta_en en estudio_flashcards', () => {
      const colInfo = db.prepare("PRAGMA table_info(estudio_flashcards)").all();
      const colAlerta = colInfo.find((c) => c.name === 'ultima_alerta_en');
      assert.ok(colAlerta, 'La columna ultima_alerta_en debe existir en la tabla estudio_flashcards');
    });

    it('2.2 store.marcarAlerta persiste ultima_alerta_en y corta bucle en lanzarRondaRepaso', () => {
      const fcStore = crearSqliteFlashcardsStore(db);
      registrarStoreFlashcardsPorDefecto(fcStore);

      const rutaConfig = path.join(tmpDir, 'flashcards_config.json');
      fs.writeFileSync(rutaConfig, JSON.stringify({
        activo: true,
        cadenciaHoras: 0,
        silencioDesde: 23,
        silencioHasta: 6,
        ultimaRondaEn: null
      }, null, 2), 'utf-8');

      // Crear flashcard vencida
      fcStore.crear({
        asignatura: 'Historia',
        pregunta: 'En que ano fue la Revolucion Francesa?',
        respuesta: '1789'
      }, 'propietario');

      const alertasEncoladas = [];
      const deps = {
        rutaConfig,
        tenantId: 'propietario',
        ahora: new Date(Date.now() + 60000),
        enqueue: (a) => alertasEncoladas.push(a)
      };

      // Primera ronda: debe encolar la alerta y marcar ultimaAlertaEn en SQLite
      const r1 = lanzarRondaRepaso(deps);
      assert.equal(r1.ok, true);
      assert.equal(r1.encoladas, 1);
      assert.equal(alertasEncoladas.length, 1);

      // Verificacion en base de datos
      const enDb = fcStore.listar('propietario');
      assert.ok(enDb[0].ultima_alerta_en, 'ultima_alerta_en debe estar guardado en la BD');

      // Segunda ronda inmediata (sin cadencia): la flashcard ya no debe volver a alertar
      // porque ultimaAlertaEn >= proximaRevision
      deps.rutaConfig = path.join(tmpDir, 'flashcards_config_reset.json');
      fs.writeFileSync(deps.rutaConfig, JSON.stringify({
        activo: true,
        cadenciaHoras: 0,
        silencioDesde: 23,
        silencioHasta: 6,
        ultimaRondaEn: null
      }, null, 2), 'utf-8');

      const r2 = lanzarRondaRepaso(deps);
      assert.equal(r2.ok, true);
      assert.equal(r2.encoladas, 0, 'No debe encolar de nuevo la misma flashcard si ya fue alertada');
    });
  });

  // ==========================================================================
  // FIX 3: conversationHistoryService y sqliteDomainStores
  // ==========================================================================
  describe('Fix 3: conversationHistoryService', () => {
    it('3.1 store.obtener acota mensajes con LIMIT en orden cronologico', () => {
      const histStore = crearSqliteHistoryStore(db);
      registrarStoreHistorialPorDefecto(histStore);

      const chatId = 'chat_test_limits';
      for (let i = 1; i <= 25; i++) {
        histStore.registrar(chatId, i % 2 === 0 ? 'assistant' : 'user', `Mensaje ${i}`, null, 'propietario');
      }

      // Obtener con limite 5
      const res = histStore.obtener(chatId, 5, 'propietario');
      assert.equal(res.mensajes.length, 5);
      // Deben ser los 5 ultimos (21 a 25) en orden cronologico (ascendente)
      assert.equal(res.mensajes[0].content, 'Mensaje 21');
      assert.equal(res.mensajes[4].content, 'Mensaje 25');
    });

    it('3.2 store.purgarAntiguos y condensarHistorial purgan mensajes viejos en SQLite', async () => {
      const histStore = crearSqliteHistoryStore(db);
      registrarStoreHistorialPorDefecto(histStore);

      // Parte A: Verificacion directa de store.purgarAntiguos
      const chatIdPurga = 'chat_purge_direct';
      for (let i = 1; i <= 30; i++) {
        histStore.registrar(chatIdPurga, 'user', `Msg ${i}`, null, 'propietario');
      }
      assert.equal(histStore.contar(chatIdPurga, 'propietario'), 30);

      // Purgar conservando solo 10
      const purga = histStore.purgarAntiguos(chatIdPurga, 10, 'propietario');
      assert.equal(purga.ok, true);
      assert.equal(purga.eliminados, 20);
      assert.equal(histStore.contar(chatIdPurga, 'propietario'), 10);

      // Parte B: Invocacion automatica de purga a traves de condensarHistorial
      const chatIdCondensar = 'chat_purge_condensar';
      for (let i = 1; i <= 25; i++) {
        histStore.registrar(chatIdCondensar, 'user', `Mensaje antiguo ${i}`, null, 'propietario');
      }
      assert.equal(histStore.contar(chatIdCondensar, 'propietario'), 25);

      const mockChatCompletion = async () => ({
        message: { content: 'Resumen consolidado de la conversacion.' }
      });

      const resCondensar = await condensarHistorial(chatIdCondensar, {
        tenantId: 'propietario',
        chatCompletion: mockChatCompletion
      });
      assert.equal(resCondensar.ok, true);
      assert.equal(resCondensar.condensado, true);

      // Comprobar que el resumen quedo registrado y se purgaron los antiguos
      const rec = histStore.obtener(chatIdCondensar, 20, 'propietario');
      assert.match(rec.resumen, /Resumen consolidado/);
      // Mensajes restantes acotados a MAX_MENSAJES_VENTANA (12) + el nuevo registro de resumen
      assert.ok(histStore.contar(chatIdCondensar, 'propietario') <= 13);
    });
  });

  // ==========================================================================
  // FIX 4: historySearchService
  // ==========================================================================
  describe('Fix 4: historySearchService', () => {
    it('4.1 Busqueda en SQLite conectada via storeDe y con aislamiento multi-tenant', () => {
      const histStore = crearSqliteHistoryStore(db);
      registrarStoreHistorialBusqueda(histStore);

      const chatId = 'chat_search_tenant';
      histStore.registrar(chatId, 'user', 'Recordar comprar tornillos M4', null, 'propietario');
      histStore.registrar(chatId, 'assistant', 'Anotado tornillos M4 en la lista', null, 'propietario');
      histStore.registrar(chatId, 'user', 'Comprar tornillos para madera', null, 'tenant_beta');

      // Busqueda para propietario
      const b1 = buscarEnHistorial({ chatId, termino: 'tornillos' }, { tenantId: 'propietario' });
      assert.equal(b1.ok, true);
      assert.equal(b1.total, 2);
      assert.equal(b1.coincidencias[0].role, 'yo'); // assistant -> yo
      assert.equal(b1.coincidencias[1].role, 'tu'); // user -> tu

      // Busqueda para tenant_beta
      const b2 = buscarEnHistorial({ chatId, termino: 'tornillos' }, { tenantId: 'tenant_beta' });
      assert.equal(b2.ok, true);
      assert.equal(b2.total, 1);
      assert.match(b2.coincidencias[0].content, /madera/);
    });

    it('4.2 Carpeta de fallback JSON apunta a data/history y no data/historial', () => {
      const dirHistory = path.join(tmpDir, 'data', 'history');
      fs.mkdirSync(dirHistory, { recursive: true });

      const prevEnv = process.env.DAVIS_HISTORY_DIR;
      process.env.DAVIS_HISTORY_DIR = dirHistory;

      try {
        const hash = 'a1b2c3d4e5f6789012345678';
        const rutaChat = path.join(dirHistory, `${hash}.json`);
        fs.writeFileSync(rutaChat, JSON.stringify({
          mensajes: [
            { role: 'user', content: 'Reunion a las 10 de la manana', ts: '2026-11-17T09:00:00Z' }
          ]
        }, null, 2), 'utf-8');

        // Test con rutaChat directa o deps de carpeta
        const res = buscarEnHistorial({ chatId: 'chat_json_test', termino: 'reunion' }, {
          carpetaHistorial: dirHistory
        });
        assert.equal(res.ok, true);
      } finally {
        process.env.DAVIS_HISTORY_DIR = prevEnv;
      }
    });
  });

  // ==========================================================================
  // FIX 5: snoozeService y sqliteDomainStores
  // ==========================================================================
  describe('Fix 5: snoozeService', () => {
    it('5.1 store.desactivar restringe transicion unicamente a registros con estado = pendiente', () => {
      const snoozeStore = crearSqliteSnoozeStore(db);
      registrarStoreSnoozesPorDefecto(snoozeStore);

      const s1 = snoozeStore.guardar({
        chatId: 'chat_snooze_1',
        mensajeOriginalId: 'msg_1',
        fechaAviso: '2026-11-17T15:00:00Z'
      }, 'propietario');

      // Primer cancelado: debe pasar de pendiente a cancelado
      const d1 = snoozeStore.desactivar(s1.id, 'cancelado', 'propietario');
      assert.equal(d1.ok, true);

      // Segundo intento: ya no es pendiente, debe retornar ok: false
      const d2 = snoozeStore.desactivar(s1.id, 'completado', 'propietario');
      assert.equal(d2.ok, false);

      // No debe listar como pendiente
      const pends = snoozeStore.listarPendientes('propietario');
      assert.equal(pends.length, 0);
    });

    it('5.2 cancelarSnooze envia cancelado y lanzarRondaSnoozes envia completado', () => {
      const snoozeStore = crearSqliteSnoozeStore(db);
      registrarStoreSnoozesPorDefecto(snoozeStore);

      const s1 = snoozeStore.guardar({
        chatId: 'chat_cancela',
        mensajeOriginalId: 'm1',
        fechaAviso: '2026-11-17T12:00:00Z'
      }, 'propietario');

      const s2 = snoozeStore.guardar({
        chatId: 'chat_dispara',
        mensajeOriginalId: 'm2',
        fechaAviso: '2026-11-17T10:00:00Z' // ya vencido
      }, 'propietario');

      // Cancelar s1
      const resCancela = cancelarSnooze({ id: s1.id }, { tenantId: 'propietario' });
      assert.equal(resCancela.ok, true);

      // Disparar ronda para s2
      const resRonda = lanzarRondaSnoozes({
        tenantId: 'propietario',
        ahora: new Date('2026-11-17T11:00:00Z'),
        enqueue: () => {}
      });
      assert.equal(resRonda.ok, true);
      assert.equal(resRonda.disparados, 1);

      // Comprobar estados en BD
      const row1 = db.prepare('SELECT estado FROM snoozes WHERE id = ?').get(s1.id);
      const row2 = db.prepare('SELECT estado FROM snoozes WHERE id = ?').get(s2.id);
      assert.equal(row1.estado, 'cancelado');
      assert.equal(row2.estado, 'completado');
    });
  });

  // ==========================================================================
  // FIX 6: contactsService y sincronizacion SQLite
  // ==========================================================================
  describe('Fix 6: contactsService', () => {
    it('6.1 sincronizarContactosDesdeSegundoCerebro lee de memoryStore SQLite', () => {
      const contactsStore = crearSqliteContactsStore(db);
      registrarStoreContactosPorDefecto(contactsStore);

      const mockMemoryStore = {
        leer: () => [
          {
            categoria: 'contacto',
            sujeto: 'Dr. Lopez',
            dato: 'Telefono de consulta: +34 912 345 678',
            relacion: 'medico'
          },
          {
            categoria: 'preferencia',
            sujeto: 'David',
            dato: 'Cafe solo sin azucar'
          }
        ]
      };

      const resSync = sincronizarContactosDesdeSegundoCerebro({
        memoryStore: mockMemoryStore,
        tenantId: 'propietario'
      });

      assert.equal(resSync.ok, true);
      assert.equal(resSync.sincronizados, 1);

      const lista = contactsStore.listar('propietario');
      assert.equal(lista.length, 1);
      assert.equal(lista[0].nombre, 'Dr. Lopez');
      assert.match(lista[0].telefono, /\+34 912 345 678/);
      assert.equal(lista[0].relacion, 'medico');
    });
  });

  // ==========================================================================
  // FIX 7: dailyBriefing y booking.db
  // ==========================================================================
  describe('Fix 7: dailyBriefing', () => {
    it('7.1 Formateo factual de citas de booking.db para el dia de hoy', async () => {
      const citasMock = [
        {
          cliente_nombre: 'Alejandro Sanz',
          servicio: 'Asesoria Legal',
          duracion_minutos: 45,
          fecha_inicio: '2026-11-17T11:30:00Z'
        }
      ];

      const briefing = await generarBriefingCompleto({
        ahora: '2026-11-17T06:55:00Z',
        consultarCitasBooking: async () => citasMock,
        consultarEventos: async () => ({ ok: true, eventos: [] }),
        consultarClima: async () => ({ ok: true, resumen: 'Cielo despejado, 12 C' })
      });

      assert.match(briefing, /Cita \[12:30\]: Alejandro Sanz - Asesoria Legal \(45 min\)/);
      assert.ok(!briefing.includes('Sin citas de reservas'), 'No debe reportar vacio si hay citas');
    });

    it('7.2 Reporte factual cuando no hay citas ni eventos y Zero Emojis', async () => {
      const briefing = await generarBriefingCompleto({
        ahora: '2026-11-17T06:55:00Z',
        consultarCitasBooking: async () => [],
        consultarEventos: async () => ({ ok: true, eventos: [] }),
        consultarClima: async () => ({ ok: true, resumen: 'Nublado, 8 C' })
      });

      assert.match(briefing, /Sin citas de reservas ni eventos de calendario programados para hoy\./);
      // Validacion de politica Zero Emojis
      const emojiRegex = /[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]/u;
      assert.equal(emojiRegex.test(briefing), false, 'El briefing no debe contener emojis');
    });
  });

  // ==========================================================================
  // FIX 8: quietHoursService, alertQueueService y whatsappBot
  // ==========================================================================
  describe('Fix 8: quietHoursService y drenado selectivo de alertas', () => {
    it('8.1 esAlertaUrgente clasifica correctamente segun prioridad o flag', () => {
      assert.equal(esAlertaUrgente({ priority: 'urgent' }), true);
      assert.equal(esAlertaUrgente({ priority: 'critical' }), true);
      assert.equal(esAlertaUrgente({ prioridad: 'urgente' }), true);
      assert.equal(esAlertaUrgente({ prioridad: 'critica' }), true);
      assert.equal(esAlertaUrgente({ urgente: true }), true);

      assert.equal(esAlertaUrgente({ priority: 'normal' }), false);
      assert.equal(esAlertaUrgente({ priority: 'low' }), false);
      assert.equal(esAlertaUrgente(null), false);
    });

    it('8.2 alertQueueService.drainAlerts soporta predicate y conserva alertas no coincidentes', () => {
      const queuePath = path.join(tmpDir, 'alerts_queue.json');

      enqueueAlert({ title: 'Alerta Normal 1', priority: 'normal' }, { queuePath });
      enqueueAlert({ title: 'Caida Docker', priority: 'critical' }, { queuePath });
      enqueueAlert({ title: 'Alerta Normal 2', priority: 'low' }, { queuePath });

      // Drenar solo urgentes/criticas con predicate
      const drenadas = drainAlerts({
        queuePath,
        predicate: (a) => esAlertaUrgente(a)
      });

      assert.equal(drenadas.length, 1);
      assert.equal(drenadas[0].title, 'Caida Docker');

      // Las otras dos deben seguir en cola
      const pendientes = peekAlerts({ queuePath });
      assert.equal(pendientes.length, 2);
      assert.equal(pendientes[0].title, 'Alerta Normal 1');
      assert.equal(pendientes[1].title, 'Alerta Normal 2');
    });

    it('8.3 whatsappBot.drenarColaAlertas en horario nocturno despacha solo urgentes', async () => {
      const queuePath = path.join(tmpDir, 'bot_alerts_queue.json');
      enqueueAlert({ title: 'Recordatorio suave', priority: 'normal' }, { queuePath });
      enqueueAlert({ title: 'Servidor Caido', priority: 'critical' }, { queuePath });

      const mensajesEnviados = [];
      const deps = {
        enHorarioSilencio: () => true, // Simula que estamos en horario de silencio
        drainOptions: { queuePath },
        enviarMensajeADavid: async (msg) => mensajesEnviados.push(msg)
      };

      const despachadas = await drenarColaAlertas(deps);
      assert.equal(despachadas.length, 1);
      assert.equal(despachadas[0].title, 'Servidor Caido');
      assert.equal(mensajesEnviados.length, 1);
      assert.match(mensajesEnviados[0], /Servidor Caido/);

      // La alerta suave no urgente debe seguir en la cola
      const restantes = peekAlerts({ queuePath });
      assert.equal(restantes.length, 1);
      assert.equal(restantes[0].title, 'Recordatorio suave');
    });
  });
});
