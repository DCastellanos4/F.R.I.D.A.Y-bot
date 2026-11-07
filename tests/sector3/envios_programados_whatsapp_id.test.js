/**
 * envios_programados_whatsapp_id.test.js - Regresion del hallazgo de auditoria
 * (7 nov 2026): los ~20 envios programados reales carecian de whatsappId y 4
 * acabaron "incierto" sin poder reconciliarse.
 *
 * Causa raiz: despacharMensajesPendientes() lee la lista de disco ANTES de
 * llamar al callback de envio; el callback (cableado de whatsappBot) registra
 * el whatsappId con registrarIdWhatsApp() (que escribe su propia pasada a
 * disco), y al final despachar vuelca su lista LOCAL antigua, machacando el
 * whatsappId recien guardado. Sin whatsappId, procesarActualizacionEntrega
 * nunca casa el acuse y el mensaje queda "enviado" hasta el timeout de
 * "incierto": aceptado/transmitido, pero entrega y lectura irreconciliables.
 *
 * Strict Policy: Zero Emojis.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  programarMensaje,
  leerMensajesProgramados,
  registrarIdWhatsApp,
  procesarActualizacionEntrega,
  despacharMensajesPendientes,
  iniciarMonitorMensajesProgramados,
  detenerMonitorMensajesProgramados,
  guardarMensajesProgramados,
  cancelarMensajeProgramado
} from '../../src/services/scheduledMessageService.js';

// Bajo la suite, DAVIS_DATA_DIR apunta a un directorio temporal aislado; el
// servicio usa rutas de modulo derivadas de ese DATA_DIR, asi que basta con
// dejar el estado limpio al terminar.
const estadoInicial = (() => {
  try { return JSON.stringify(leerMensajesProgramados()); } catch { return null; }
})();

test.after(() => {
  detenerMonitorMensajesProgramados();
  if (estadoInicial !== null) {
    try {
      guardarMensajesProgramados(JSON.parse(estadoInicial));
    } catch { /* restauracion best-effort */ }
  }
});

test('El whatsappId registrado por el callback sobrevive al guardado del despacho', async () => {
  // Cableado equivalente al de whatsappBot.inicializarServiciosProactivos:
  // el callback transmite y registra el id de WhatsApp del mensaje aceptado.
  iniciarMonitorMensajesProgramados(async (m) => {
    registrarIdWhatsApp(m.id, 'WAMID-TEST-001');
    return true;
  }, 60 * 60 * 1000);

  const creado = programarMensaje({ numero: '+34600999000', mensaje: 'prueba de regresion whatsappId', inmediato: false, minutosEnElFuturo: -1 });
  assert.equal(creado.ok, true);

  await despacharMensajesPendientes();

  const guardado = leerMensajesProgramados().find((x) => x.id === creado.programado.id);
  assert.ok(guardado, 'el mensaje debe seguir persistido');
  assert.equal(guardado.enviado, true);
  assert.equal(guardado.estado, 'enviado', 'transmitido y aceptado por el canal: estado enviado');
  assert.equal(guardado.whatsappId, 'WAMID-TEST-001', 'el whatsappId no puede perderse en el guardado final del despacho');

  // Y con el id persistido, el acuse de recibo si reconcilia.
  const transiciones = procesarActualizacionEntrega([
    { key: { id: 'WAMID-TEST-001' }, update: { status: 3 } }
  ]);
  assert.deepEqual(transiciones.map((t) => t.estado), ['entregado']);
  const reconciliado = leerMensajesProgramados().find((x) => x.id === creado.programado.id);
  assert.equal(reconciliado.estado, 'entregado');
});

test('Un mensaje programado DURANTE el despacho no se pierde al guardar', async () => {
  let idNuevo = null;
  iniciarMonitorMensajesProgramados(async () => {
    const creado = programarMensaje({ numero: '+34600999010', mensaje: 'programado durante el despacho', inmediato: false, minutosEnElFuturo: 60 });
    idNuevo = creado.programado.id;
    return true;
  }, 60 * 60 * 1000);

  programarMensaje({ numero: '+34600999011', mensaje: 'dispara el despacho', inmediato: false, minutosEnElFuturo: -1 });
  await despacharMensajesPendientes();

  const sigue = leerMensajesProgramados().find((x) => x.id === idNuevo);
  assert.ok(sigue, 'un mensaje programado durante el despacho no puede desaparecer');
  assert.equal(sigue.enviado, false, 'ademas no se envio (no le tocaba)');
});

test('Una cancelacion DURANTE el despacho no resucita el mensaje cancelado', async () => {
  const victima = programarMensaje({ numero: '+34600999012', mensaje: 'pendiente que se cancela durante el despacho', inmediato: false, minutosEnElFuturo: 60 });

  iniciarMonitorMensajesProgramados(async () => {
    cancelarMensajeProgramado(victima.programado.id);
    return true;
  }, 60 * 60 * 1000);

  programarMensaje({ numero: '+34600999013', mensaje: 'dispara el despacho', inmediato: false, minutosEnElFuturo: -1 });
  await despacharMensajesPendientes();

  const resucitado = leerMensajesProgramados().find((x) => x.id === victima.programado.id);
  assert.equal(resucitado, undefined, 'un mensaje cancelado durante el despacho no puede volver (ni enviarse despues)');
});

test('Un acuse entregado/leido DURANTE el despacho no se pisa con el guardado final', async () => {
  // Mensaje ya enviado hace un minuto, con whatsappId registrado.
  const previo = programarMensaje({ numero: '+34600999014', mensaje: 'ya enviado, esperando acuse', inmediato: false, minutosEnElFuturo: -1 });
  iniciarMonitorMensajesProgramados(async (m) => {
    registrarIdWhatsApp(m.id, `WA-${m.id}`);
    return true;
  }, 60 * 60 * 1000);
  await despacharMensajesPendientes();
  const enviadoPrevio = leerMensajesProgramados().find((x) => x.id === previo.programado.id);
  assert.equal(enviadoPrevio.estado, 'enviado');

  // En el siguiente despacho, el acuse del mensaje previo llega DURANTE el envio.
  iniciarMonitorMensajesProgramados(async () => {
    procesarActualizacionEntrega([{ key: { id: enviadoPrevio.whatsappId }, update: { status: 4 } }]);
    return true;
  }, 60 * 60 * 1000);
  programarMensaje({ numero: '+34600999015', mensaje: 'segundo despacho', inmediato: false, minutosEnElFuturo: -1 });
  await despacharMensajesPendientes();

  const tras = leerMensajesProgramados().find((x) => x.id === previo.programado.id);
  assert.equal(tras.estado, 'leido', 'el acuse llegado durante el despacho manda sobre el snapshot antiguo');
});

test('Un acuse del PROPIO mensaje en vuelo no se degrada a enviado', async () => {
  iniciarMonitorMensajesProgramados(async (m) => {
    registrarIdWhatsApp(m.id, 'WA-VUELO-1');
    procesarActualizacionEntrega([{ key: { id: 'WA-VUELO-1' }, update: { status: 3 } }]);
    return true;
  }, 60 * 60 * 1000);

  const creado = programarMensaje({ numero: '+34600999016', mensaje: 'acuse instantaneo', inmediato: false, minutosEnElFuturo: -1 });
  await despacharMensajesPendientes();

  const guardado = leerMensajesProgramados().find((x) => x.id === creado.programado.id);
  assert.equal(guardado.whatsappId, 'WA-VUELO-1');
  assert.equal(guardado.estado, 'entregado', 'el acuse del propio mensaje no se degrada a enviado');
  assert.equal(guardado.enviado, true);
});

test('Un envio sin id devuelto por el canal queda enviado pero marcado para revision (no entregado)', async () => {
  iniciarMonitorMensajesProgramados(async () => true, 60 * 60 * 1000);

  const creado = programarMensaje({ numero: '+34600999001', mensaje: 'prueba sin id', inmediato: false, minutosEnElFuturo: -1 });
  assert.equal(creado.ok, true);

  await despacharMensajesPendientes();

  const guardado = leerMensajesProgramados().find((x) => x.id === creado.programado.id);
  assert.equal(guardado.estado, 'enviado');
  assert.equal(guardado.whatsappId, null, 'sin id del canal no se inventa ninguno');

  // Sin whatsappId el acuse no puede casar: el estado no avanza (honesto).
  const transiciones = procesarActualizacionEntrega([
    { key: { id: 'WAMID-DESCONOCIDO' }, update: { status: 3 } }
  ]);
  assert.deepEqual(transiciones, []);
});
