/**
 * Regresion: calidad de respuesta (R21 config pendiente en prompt; markdown WhatsApp).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizarMarkdownWhatsApp } from '../../src/services/textFormatService.js';
import { consultarJarvis } from '../../src/core/jarvisAgent.js';

test('normalizarMarkdownWhatsApp convierte **doble** a *simple* y respeta el resto', () => {
  assert.equal(normalizarMarkdownWhatsApp('Claro: **esto** y **aquello**.'), 'Claro: *esto* y *aquello*.');
  assert.equal(normalizarMarkdownWhatsApp('sin formato'), 'sin formato');
  assert.equal(normalizarMarkdownWhatsApp('*ya simple*'), '*ya simple*');
  assert.equal(normalizarMarkdownWhatsApp(undefined), undefined);
});

test('el system prompt incluye CONFIGURACION PENDIENTE a nivel capacidad y sin nombres de variables de entorno', async () => {
  const backup = { ...process.env };
  delete process.env.DAVIS_EMT_CLIENT_ID;
  delete process.env.DAVIS_EMT_PASS_KEY;
  try {
    let sys = '';
    const chatFalso = async (peticion) => {
      const s = peticion.messages.find((m) => m.role === 'system');
      if (s) sys = s.content;
      return { message: { role: 'assistant', content: 'ok' } };
    };
    await consultarJarvis('dime que cosas me faltan por configurar', [], {
      chatId: 'test-config-prompt@local',
      chatCompletion: chatFalso,
      ejecutores: new Proxy({}, { get: () => async () => 'OK' })
    });
    assert.ok(sys.includes('CONFIGURACION PENDIENTE'), 'debe incluir la seccion');
    assert.ok(/Pendiente: .*EMT/.test(sys), 'debe listar la EMT como pendiente sin credenciales');
    assert.ok(!sys.includes('DAVIS_EMT_CLIENT_ID') && !sys.includes('PASS_KEY') && !sys.includes('DAVIS_QBIT'), 'no debe filtrar nombres de variables de entorno');
    assert.ok(!sys.includes('gratuita'), 'no debe afirmar gratuidad sin verificar');
  } finally {
    process.env = backup;
  }
});
