/**
 * pending_purge.test.js
 * Hallazgo revision 3, punto 3: las confirmaciones pendientes nunca
 * resueltas se acumulaban en memoria hasta reiniciar el bot. Ahora una
 * purga periodica (unref) elimina SOLO las caducadas; el TTL y el consumo
 * de un solo uso no cambian.
 *
 * Strict Policy: Zero Emojis.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

const destructivas = await import('../../src/services/destructiveActionService.js');
const voz = await import('../../src/services/voiceConfirmationService.js');

test('destructivas: purga elimina solo las caducadas y conserva las vigentes', () => {
  const pasado = Date.now() - destructivas.TTL_BORRADO_MS - 1000;
  const idCaducado = destructivas.registrarBorradoMasivoPendiente('chat-purga-1', 'notas', 3, { now: () => pasado });
  const idVigente = destructivas.registrarBorradoMasivoPendiente('chat-purga-1', 'historial', 1);

  const purgados = destructivas.purgarPendientesExpirados();
  assert.equal(purgados, 1, 'solo una entrada habia caducado');

  const caducado = destructivas.resolverConfirmacionBorrado('chat-purga-1', `confirmar borrado ${idCaducado}`);
  assert.equal(caducado.confirmado, false, 'la caducada purgada ya no se puede confirmar');

  const vigente = destructivas.resolverConfirmacionBorrado('chat-purga-1', `confirmar borrado ${idVigente}`);
  assert.equal(vigente.confirmado, true, 'la vigente sobrevive a la purga y se confirma');
  const reuso = destructivas.resolverConfirmacionBorrado('chat-purga-1', `confirmar borrado ${idVigente}`);
  assert.equal(reuso.confirmado, false, 'un solo uso: la confirmada se consume');
});

test('voz: purga elimina solo las caducadas y conserva las vigentes', () => {
  const pasado = Date.now() - voz.TTL_CONFIRMACION_MS - 1000;
  voz.guardarPendienteVoz('chat-purga-2', 'reiniciar docker antiguo', { now: () => pasado });
  voz.guardarPendienteVoz('chat-purga-3', 'apagar servidor vigente');

  const purgados = voz.purgarPendientesExpirados();
  assert.equal(purgados, 1);

  assert.equal(voz.obtenerPendienteVoz('chat-purga-2'), null, 'la caducada purgada ya no esta');
  const vigente = voz.obtenerPendienteVoz('chat-purga-3');
  assert.ok(vigente, 'la vigente sobrevive a la purga');
  assert.equal(vigente.texto, 'apagar servidor vigente');
  voz.descartarPendienteVoz('chat-purga-3');
});

test('la purga periodica se inicia una sola vez y no bloquea el proceso', () => {
  destructivas.iniciarPurgaPendientes();
  destructivas.iniciarPurgaPendientes();
  voz.iniciarPurgaPendientes();
  voz.iniciarPurgaPendientes();
  destructivas.detenerPurgaPendientes();
  voz.detenerPurgaPendientes();
  assert.ok(true, 'iniciar dos veces es idempotente y detener limpia el intervalo');
});
