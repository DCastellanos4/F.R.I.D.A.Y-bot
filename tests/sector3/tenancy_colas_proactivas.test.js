/**
 * Cola de mensajes programados por dueño (BOLA): un tenant no ve ni cancela lo
 * ajeno (ni con '*'), el despachador nunca envia por el canal del propietario
 * un registro de otro tenant, y el formato del propietario no cambia.
 * Strict Policy: Zero Emojis.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'davis-colas-'));
process.env.DAVIS_DATA_DIR = DIR;
const S = await import('../../src/services/scheduledMessageService.js');

test('programar con tenant marca dueño; propietario conserva formato (sin campo tenantId)', () => {
  const o = S.programarMensaje({ numero: '+34600111222', mensaje: 'msg-propietario', minutosEnElFuturo: 600 });
  const t = S.programarMensaje({ numero: '+34600333444', mensaje: 'msg-sint-a', minutosEnElFuturo: 600, tenantId: 'sint-a' });
  assert.ok(o.ok && t.ok);
  assert.equal('tenantId' in o.programado, false, 'registro del propietario sin campo nuevo');
  assert.equal(t.programado.tenantId, 'sint-a');
});

test('listar y cancelar: aislados por dueño, incluido cancelar todo', () => {
  const vistoA = S.listarMensajesProgramados(true, { tenantId: 'sint-a' }).map((m) => m.mensaje);
  assert.deepEqual(vistoA, ['msg-sint-a']);
  const vistoO = S.listarMensajesProgramados(true).map((m) => m.mensaje);
  assert.deepEqual(vistoO, ['msg-propietario']);
  // A intenta cancelar el del propietario por texto, por telefono y con '*'
  assert.equal(S.cancelarMensajeProgramado('msg-propietario', { tenantId: 'sint-a' }).ok, false);
  assert.equal(S.cancelarMensajeProgramado('600111222', { tenantId: 'sint-a' }).ok, false);
  S.cancelarMensajeProgramado('*', { tenantId: 'sint-a' });
  assert.deepEqual(S.listarMensajesProgramados(true).map((m) => m.mensaje), ['msg-propietario'], 'el propietario sigue intacto');
  assert.deepEqual(S.listarMensajesProgramados(true, { tenantId: 'sint-a' }), []);
  // y al reves: el propietario cancelando todo no borra los de un tenant
  S.programarMensaje({ numero: '+34600333444', mensaje: 'msg-sint-b', minutosEnElFuturo: 600, tenantId: 'sint-b' });
  S.cancelarMensajeProgramado('*');
  assert.deepEqual(S.listarMensajesProgramados(true, { tenantId: 'sint-b' }).map((m) => m.mensaje), ['msg-sint-b']);
});

test('despachador: nunca envia por el canal del propietario un registro de otro tenant', async () => {
  const enviados = [];
  const ruta = path.join(DIR, 'scheduled_messages.json');
  const pasado = Date.now() - 1000;
  fs.writeFileSync(ruta, JSON.stringify([
    { id: 'x1', numero: '600', destinatarioJid: '600@s.whatsapp.net', mensaje: 'AJENO', timestamp: pasado, enviado: false, estado: 'programado', intentos: 0, tenantId: 'sint-b' }
  ]));
  S.iniciarMonitorMensajesProgramados(async (m) => { enviados.push(m.mensaje); return { ok: true }; }, 3600000);
  await S.despacharMensajesPendientes();
  S.detenerMonitorMensajesProgramados();
  assert.deepEqual(enviados, [], 'registro ajeno no despachado');
  assert.equal(JSON.parse(fs.readFileSync(ruta, 'utf-8'))[0].enviado, false, 'sigue pendiente, intacto');
});
