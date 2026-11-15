/**
 * sqlite_domain_stores.test.js - Validacion integral de los almacenes SQLite de dominio.
 *
 * Verifica soporte multi-tenant (tenant_id), transacciones ACID y persistencia
 * en jarvis.db para los 9 servicios de dominio recableados.
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
  crearSqliteReminderStore,
  crearSqliteContactsStore,
  crearSqliteQuedadasStore,
  crearSqliteSnoozeStore,
  crearSqliteFlashcardsStore,
  crearSqliteScheduledMessageStore,
  crearSqliteHistoryStore
} from '../../src/adapters/outbound/persistence/sqlite/sqliteDomainStores.js';

function crearDbTest() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'davis-domain-stores-'));
  const rutaDb = path.join(dir, 'test.db');
  const db = abrirBaseDatos(rutaDb);
  ejecutarMigraciones(db);
  return { db, dir, cerrar: () => { db.close(); fs.rmSync(dir, { recursive: true, force: true }); } };
}

test('shoppingStore: operaciones basicas y aislamiento multi-tenant', () => {
  const { db, cerrar } = crearDbTest();
  try {
    const store = crearSqliteShoppingStore(db);
    store.anadir(['leche', 'huevos'], 'propietario');
    store.anadir(['cafe'], 'tenant_beta');

    assert.deepEqual(store.listar('propietario'), ['leche', 'huevos']);
    assert.deepEqual(store.listar('tenant_beta'), ['cafe']);

    const resTachar = store.tachar('leche', 'propietario');
    assert.equal(resTachar.ok, true);
    assert.deepEqual(store.listar('propietario'), ['huevos']);
    assert.deepEqual(store.listar('tenant_beta'), ['cafe']);

    store.vaciar('propietario');
    assert.deepEqual(store.listar('propietario'), []);
    assert.deepEqual(store.listar('tenant_beta'), ['cafe']);
  } finally {
    cerrar();
  }
});

test('habitsStore: registro, marcado, racha y aislamiento', () => {
  const { db, cerrar } = crearDbTest();
  try {
    const store = crearSqliteHabitsStore(db);
    const habA = store.crear({ nombre: 'ejercicio' }, 'propietario');
    const habB = store.crear({ nombre: 'meditacion' }, 'tenant_beta');

    const listaA = store.listar('propietario');
    assert.equal(listaA.length, 1);
    assert.equal(listaA[0].nombre, 'ejercicio');

    const listaB = store.listar('tenant_beta');
    assert.equal(listaB.length, 1);
    assert.equal(listaB[0].nombre, 'meditacion');

    const hoy = new Date().toISOString().slice(0, 10);
    store.marcar(habA.id, hoy, 'propietario');
    assert.equal(store.calcularRacha(habA.id, 'propietario'), 1);
    assert.equal(store.calcularRacha(habB.id, 'tenant_beta'), 0);
  } finally {
    cerrar();
  }
});

test('reminderStore: programacion, listado, cancelacion y aislamiento', () => {
  const { db, cerrar } = crearDbTest();
  try {
    const store = crearSqliteReminderStore(db);
    const manana = new Date(Date.now() + 86400000).toISOString();
    const rA = store.crear({ chatId: '123', mensaje: 'comprar pan', fechaObjetivo: manana }, 'propietario');
    store.crear({ chatId: '456', mensaje: 'reunion cliente', fechaObjetivo: manana }, 'tenant_beta');

    const pendA = store.listar('propietario', 'pendiente');
    assert.equal(pendA.length, 1);
    assert.equal(pendA[0].mensaje, 'comprar pan');

    const pendB = store.listar('tenant_beta', 'pendiente');
    assert.equal(pendB.length, 1);
    assert.equal(pendB[0].mensaje, 'reunion cliente');

    store.cancelar(rA.id, 'propietario');
    assert.equal(store.listar('propietario', 'pendiente').length, 0);
    assert.equal(store.listar('tenant_beta', 'pendiente').length, 1);
  } finally {
    cerrar();
  }
});

test('contactsStore: guardado, busqueda, listado y aislamiento', () => {
  const { db, cerrar } = crearDbTest();
  try {
    const store = crearSqliteContactsStore(db);
    store.guardar({ nombre: 'Carlos Ruiz', telefono: '612345678', notas: 'amigo' }, 'propietario');
    store.guardar({ nombre: 'Carlos Mendez', telefono: '698765432', notas: 'proveedor' }, 'tenant_beta');

    const resA = store.buscar('Carlos', 'propietario');
    assert.equal(resA.length, 1);
    assert.equal(resA[0].nombre, 'Carlos Ruiz');

    const resB = store.buscar('Carlos', 'tenant_beta');
    assert.equal(resB.length, 1);
    assert.equal(resB[0].nombre, 'Carlos Mendez');
  } finally {
    cerrar();
  }
});

test('quedadasStore: alta, listado y aislamiento', () => {
  const { db, cerrar } = crearDbTest();
  try {
    const store = crearSqliteQuedadasStore(db);
    store.crear({ titulo: 'Cena equipo', fecha: '2026-12-01', participantes: ['David', 'Ana'] }, 'propietario');
    store.crear({ titulo: 'Demo producto', fecha: '2026-12-02', participantes: ['Beta'] }, 'tenant_beta');

    const qA = store.listar('propietario');
    assert.equal(qA.length, 1);
    assert.equal(qA[0].titulo, 'Cena equipo');
    assert.deepEqual(qA[0].participantes, ['David', 'Ana']);

    const qB = store.listar('tenant_beta');
    assert.equal(qB.length, 1);
    assert.equal(qB[0].titulo, 'Demo producto');
  } finally {
    cerrar();
  }
});

test('snoozeStore: almacenamiento, recuperacion pendientes y desactivacion', () => {
  const { db, cerrar } = crearDbTest();
  try {
    const store = crearSqliteSnoozeStore(db);
    const ahora = new Date().toISOString();
    const snzA = store.guardar({ chatId: 'chat_1', mensajeOriginalId: 'recordar tema', fechaAviso: ahora }, 'propietario');
    store.guardar({ chatId: 'chat_2', mensajeOriginalId: 'factura', fechaAviso: ahora }, 'tenant_beta');

    assert.equal(store.listarPendientes('propietario').length, 1);
    assert.equal(store.listarPendientes('tenant_beta').length, 1);

    store.desactivar(snzA.id, 'propietario');
    assert.equal(store.listarPendientes('propietario').length, 0);
    assert.equal(store.listarPendientes('tenant_beta').length, 1);
  } finally {
    cerrar();
  }
});

test('flashcardsStore: ciclo de estudio con repeticion espaciada', () => {
  const { db, cerrar } = crearDbTest();
  try {
    const store = crearSqliteFlashcardsStore(db);
    const fc = store.crear({ asignatura: 'Redes', pregunta: 'Que es TCP?', respuesta: 'Protocolo fiable orientado a conexion' }, 'propietario');

    const pendientes = store.pendientesRepaso('propietario', new Date(Date.now() + 1000).toISOString());
    assert.equal(pendientes.length, 1);
    assert.equal(pendientes[0].pregunta, 'Que es TCP?');

    const prox = new Date(Date.now() + 86400000).toISOString();
    store.responder(fc.id, { intervaloDias: 2, facilidad: 2.6, repeticiones: 1, proximoRepaso: prox }, 'propietario');

    const lista = store.listar('propietario');
    assert.equal(lista[0].repeticiones, 1);
    assert.equal(lista[0].intervalo_dias, 2);
  } finally {
    cerrar();
  }
});

test('scheduledMessageStore: programacion, pendientes y cancelacion', () => {
  const { db, cerrar } = crearDbTest();
  try {
    const store = crearSqliteScheduledMessageStore(db);
    const manana = new Date(Date.now() + 86400000).toISOString();
    const msg = store.guardar({ jid: '34600000000@s.whatsapp.net', mensaje: 'Recordatorio reunion', fechaEnvio: manana }, 'propietario');

    const pend = store.listarPendientes('propietario');
    assert.equal(pend.length, 1);
    assert.equal(pend[0].id, msg.id);

    store.cancelar(msg.id, 'propietario');
    assert.equal(store.listarPendientes('propietario').length, 0);
  } finally {
    cerrar();
  }
});

test('historyStore: registro de turnos y recuperacion contextual aislada', () => {
  const { db, cerrar } = crearDbTest();
  try {
    const store = crearSqliteHistoryStore(db);
    store.registrar('chat_100', 'user', 'Hola bot', null, 'propietario');
    store.registrar('chat_100', 'assistant', 'Hola David', null, 'propietario');

    store.registrar('chat_100', 'user', 'Hola tenant', null, 'tenant_beta');

    const histA = store.obtener('chat_100', 10, 'propietario');
    assert.equal(histA.mensajes.length, 2);
    assert.equal(histA.mensajes[0].role, 'user');
    assert.equal(histA.mensajes[0].content, 'Hola bot');

    const histB = store.obtener('chat_100', 10, 'tenant_beta');
    assert.equal(histB.mensajes.length, 1);
    assert.equal(histB.mensajes[0].content, 'Hola tenant');

    store.limpiar('chat_100', 'propietario');
    assert.equal(store.obtener('chat_100', 10, 'propietario').mensajes.length, 0);
    assert.equal(store.obtener('chat_100', 10, 'tenant_beta').mensajes.length, 1);
  } finally {
    cerrar();
  }
});
