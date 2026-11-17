import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  registrarContacto,
  listarContactos,
  buscarContacto,
  importarContactosDesdeJson,
  registrarStoreContactosPorDefecto
} from '../../src/services/contactsService.js';
import {
  crearRecordatorio,
  listarRecordatorios,
  despacharRecordatoriosPendientes,
  registrarStoreRecordatoriosPorDefecto
} from '../../src/services/reminderService.js';
import { crearSqliteContactsStore, crearSqliteReminderStore } from '../../src/adapters/outbound/persistence/sqlite/sqliteDomainStores.js';
import { abrirBaseDatos } from '../../src/adapters/outbound/persistence/sqlite/connection.js';
import { ejecutarMigraciones } from '../../src/adapters/outbound/persistence/sqlite/migraciones.js';

describe('Fixes: Contactos SQLite bootstrap y recordatorios con store', () => {
  let tmpDir;
  let db;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'davis_fix_test_'));
    const dbPath = path.join(tmpDir, 'test.db');
    db = abrirBaseDatos(dbPath);
    ejecutarMigraciones(db);
  });

  afterEach(() => {
    registrarStoreContactosPorDefecto(null);
    registrarStoreRecordatoriosPorDefecto(null);
    try { db.close(); } catch {}
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  });

  it('importarContactosDesdeJson migra contactos a SQLite sin duplicar', () => {
    const contactsStore = crearSqliteContactsStore(db);
    registrarStoreContactosPorDefecto(contactsStore);

    const rutaJson = path.join(tmpDir, 'contactos.json');
    fs.writeFileSync(rutaJson, JSON.stringify({
      contactos: [
        { id: '1', nombre: 'Paula', telefono: '+34690358664', relacion: 'contacto' },
        { id: '2', nombre: 'Madre', telefono: '676899520', relacion: 'familia' }
      ]
    }, null, 2), 'utf-8');

    const res1 = importarContactosDesdeJson(rutaJson);
    assert.equal(res1.ok, true);
    assert.equal(res1.importados, 2);

    const enSqlite = contactsStore.listar();
    assert.equal(enSqlite.length, 2);
    assert.equal(enSqlite.some((c) => c.nombre === 'Paula' && c.telefono === '+34690358664'), true);

    // Idempotencia: segunda pasada no duplica
    const res2 = importarContactosDesdeJson(rutaJson);
    assert.equal(res2.ok, true);
    assert.equal(res2.importados, 0);
    assert.equal(contactsStore.listar().length, 2);
  });

  it('despacharRecordatoriosPendientes procesa y completa recordatorios desde SQLite', async () => {
    const reminderStore = crearSqliteReminderStore(db);
    registrarStoreRecordatoriosPorDefecto(reminderStore);

    // Crear un recordatorio ya vencido en SQLite
    reminderStore.crear({
      id: 'rem_vencido_1',
      chatId: '12345@s.whatsapp.net',
      mensaje: 'Prueba de recordatorio vencido',
      fechaObjetivo: new Date(Date.now() - 60000).toISOString()
    });

    let notificado = null;
    const disparados = await despacharRecordatoriosPendientes({
      tenantId: 'propietario'
    });

    assert.equal(disparados.length, 1);
    assert.equal(disparados[0].id, 'rem_vencido_1');
    assert.equal(disparados[0].completado, true);

    // En SQLite ahora debe figurar como completado
    const pendientes = reminderStore.listar('propietario', 'pendiente');
    assert.equal(pendientes.length, 0);
  });
});
