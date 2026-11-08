/**
 * daily_briefing_canal.test.js - Entrega del briefing matutino por puerto.
 *
 * Valida en aislamiento la rama de puerto de canal de dailyBriefing: sin
 * disparar cron y sin enviar mensajes reales. El puerto es un fake que
 * registra llamadas.
 *
 * Strict Policy: Zero Emojis.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { entregarBriefing } from '../../src/services/dailyBriefing.js';
import { afirmarMessageChannel } from '../../src/ports/outbound/MessageChannelPort.js';

test('entrega por puerto de canal: enviarTexto con el JID y el texto', async () => {
  const envios = [];
  const puertoFalso = afirmarMessageChannel({
    canal: 'whatsapp',
    enviarTexto: async (destinatario, texto) => { envios.push([destinatario, texto]); }
  });
  const modo = await entregarBriefing(puertoFalso, '34600000000@s.whatsapp.net', 'Texto del briefing.');
  assert.equal(modo, 'puerto');
  assert.deepEqual(envios, [['34600000000@s.whatsapp.net', 'Texto del briefing.']]);
});

test('entrega por callback inyectado: conserva el modo historico', async () => {
  const recibidos = [];
  const modo = await entregarBriefing(async (texto) => { recibidos.push(texto); }, null, 'Texto callback.');
  assert.equal(modo, 'callback');
  assert.deepEqual(recibidos, ['Texto callback.']);
});

test('sin objetivo valido: modo local, no lanza ni envia', async () => {
  const modo = await entregarBriefing(null, null, 'Texto local.');
  assert.equal(modo, 'local');
});

test('un objeto que no cumple el puerto no se usa como canal', async () => {
  // Un socket crudo (sendMessage) ya NO es un objetivo valido: cae a local.
  const sockCrudo = { sendMessage: async () => { throw new Error('no debe llamarse'); } };
  const modo = await entregarBriefing(sockCrudo, 'jid', 'Texto.');
  assert.equal(modo, 'local');
});
