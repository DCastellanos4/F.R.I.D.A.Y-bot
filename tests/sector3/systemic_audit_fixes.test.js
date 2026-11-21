import test from 'node:test';
import assert from 'node:assert/strict';
import { analizarIntencion } from '../../src/core/jarvisAgent.js';
import { validarMensajeSalida, guardHallucinations } from '../../src/services/preSendGuardrailService.js';
import { programarMensaje, cancelarMensajeProgramado, listarMensajesProgramados } from '../../src/services/scheduledMessageService.js';
import { crearSqliteScheduledMessageStore } from '../../src/adapters/outbound/persistence/sqlite/sqliteDomainStores.js';
import Database from 'better-sqlite3';

test('analizarIntencion maneja saludos con intenciones reales sin degradar a chitchat', () => {
  const casos = [
    { txt: 'hola, dime los contactos que tengo', intencion: 'contactos' },
    { txt: 'buenas tardes, que gastos tengo?', intencion: 'finanzas' },
    { txt: 'hey, dime los procesos vigilados', intencion: 'procesos' },
    { txt: 'hola, que fechas senaladas tengo?', intencion: 'comunicacion' },
    { txt: 'buenas, que recordatorios tengo pendientes?', intencion: 'esRecordatorio' }
  ];

  for (const c of casos) {
    const res = analizarIntencion(c.txt);
    assert.strictEqual(res.esChitChat, false, `No debe ser chitchat: "${c.txt}"`);
    assert.ok(res.herramientas.length > 0, `Debe proveer herramientas para "${c.txt}"`);
  }
});

test('guardHallucinations no censura confirmaciones legitimas de guardado de contactos ni gastos', () => {
  const contexto = {
    traza: {
      llamadas: [
        { nombre: 'registrar_contacto', ok: true }
      ]
    }
  };

  const texto = 'Contacto guardado: Madre - +34 635605605.';
  const res = guardHallucinations(texto, contexto);
  assert.strictEqual(res.huboCorreccion, false);
  assert.ok(res.textoModificado.includes('Contacto guardado'));
});

test('guardHallucinations no censura confirmaciones legitimas de cancelacion de recordatorios o mensajes', () => {
  const contexto = {
    traza: {
      llamadas: [
        { nombre: 'cancelar_recordatorio', ok: true }
      ]
    }
  };

  const texto = 'He eliminado el recordatorio de llamar a mama con exito.';
  const res = guardHallucinations(texto, contexto);
  assert.strictEqual(res.huboCorreccion, false);
  assert.ok(res.textoModificado.includes('eliminado'));
});

test('cancelarMensajeProgramado actualiza estado en SQLite store correctamente', () => {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE IF NOT EXISTS mensajes_programados (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      jid TEXT NOT NULL,
      mensaje TEXT NOT NULL,
      fecha_envio TEXT NOT NULL,
      estado TEXT NOT NULL DEFAULT 'pendiente',
      whatsapp_id TEXT,
      creado_en TEXT NOT NULL
    );
  `);

  const store = crearSqliteScheduledMessageStore(db);
  const deps = { store, tenantId: 'propietario' };

  const prog = programarMensaje({
    numero: '34600111222',
    mensaje: 'Hola doctor, confirmo cita manana',
    minutosEnElFuturo: 60,
    tenantId: 'propietario'
  }, deps);

  assert.strictEqual(prog.ok, true);
  const id = prog.programado.id;

  const pendientesAntes = listarMensajesProgramados(true, deps);
  assert.strictEqual(pendientesAntes.length, 1);

  const cancel = cancelarMensajeProgramado(id, deps);
  assert.strictEqual(cancel.ok, true);

  const pendientesDespues = listarMensajesProgramados(true, deps);
  assert.strictEqual(pendientesDespues.length, 0);

  const fila = store.obtenerPorId(id);
  assert.strictEqual(fila.estado, 'cancelado');
});
