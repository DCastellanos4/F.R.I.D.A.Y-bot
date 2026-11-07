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

const consultarPromptConfig = async () => {
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
  return sys;
};

test('el system prompt incluye CONFIGURACION PENDIENTE completa, a nivel capacidad y sin nombres de variables de entorno', async () => {
  const backup = { ...process.env };
  delete process.env.DAVIS_EMT_CLIENT_ID;
  delete process.env.DAVIS_EMT_PASS_KEY;
  delete process.env.INFOJOBS_CLIENT_ID;
  delete process.env.INFOJOBS_CLIENT_SECRET;
  delete process.env.MEMORY_ENCRYPTION_KEY;
  try {
    const sys = await consultarPromptConfig();
    assert.ok(sys.includes('CONFIGURACION PENDIENTE'), 'debe incluir la seccion');
    assert.ok(/Pendiente: .*EMT/.test(sys), 'debe listar la EMT como pendiente sin credenciales');
    assert.ok(/Pendiente: .*InfoJobs/.test(sys), 'debe listar InfoJobs como pendiente sin credenciales (el radar es config-required sin ellas)');
    assert.ok(/Pendiente: .*Wake-on-LAN/.test(sys), 'debe listar WoL como pendiente sin MAC');
    assert.ok(/Pendiente: .*qBittorrent/.test(sys), 'debe listar qBittorrent como pendiente');
    assert.ok(/Opcional: .*eBay/.test(sys), 'debe listar eBay/Amazon como opcionales (la busqueda funciona sin alta)');
    assert.ok(/Opcional: .*cifradas/.test(sys), 'debe listar la clave de cifrado como opcional sin ella');
    assert.ok(!sys.includes('DAVIS_EMT_CLIENT_ID') && !sys.includes('PASS_KEY') && !sys.includes('DAVIS_QBIT') && !sys.includes('INFOJOBS_CLIENT') && !sys.includes('MEMORY_ENCRYPTION_KEY'), 'no debe filtrar nombres de variables de entorno');
    assert.ok(!sys.includes('gratuita'), 'no debe afirmar gratuidad sin verificar');
  } finally {
    process.env = backup;
  }
});

test('las pendientes desaparecen al configurar sus credenciales y las opcionales permanecen', async () => {
  const backup = { ...process.env };
  process.env.INFOJOBS_CLIENT_ID = 'x';
  process.env.INFOJOBS_CLIENT_SECRET = 'y';
  process.env.MEMORY_ENCRYPTION_KEY = 'z';
  delete process.env.DAVIS_EMT_CLIENT_ID;
  delete process.env.DAVIS_EMT_PASS_KEY;
  try {
    const sys = await consultarPromptConfig();
    assert.ok(!/Pendiente: .*InfoJobs/.test(sys), 'InfoJobs configurado no debe salir como pendiente');
    assert.ok(!/Opcional: .*cifradas/.test(sys), 'con clave de cifrado no debe salir como opcional pendiente');
    assert.ok(/Pendiente: .*EMT/.test(sys), 'la EMT sigue pendiente sin sus credenciales');
    assert.ok(/Opcional: .*eBay/.test(sys), 'eBay/Amazon permanecen como opcionales');
  } finally {
    process.env = backup;
  }
});
