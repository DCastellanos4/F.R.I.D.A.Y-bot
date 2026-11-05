/**
 * ticket_adapter.test.js
 * Pruebas del adaptador real de lectura de tickets (nº 24): construccion del
 * payload de vision del proveedor y parseo robusto de la respuesta, con
 * chatCompletion inyectado (sin llamada real a ningun proveedor). La
 * capacidad en vivo del proveedor configurado NO esta verificada: se declara
 * asi en el roadmap y en la PR.
 *
 * Strict Policy: Zero Emojis.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { crearAnalizadorTicket } = await import('../../src/services/ticketVisionAdapter.js');

test('sin modelo configurado el adaptador no se crea (funcion desactivada)', () => {
  const prev = process.env.DAVIS_TICKET_VISION_MODEL;
  delete process.env.DAVIS_TICKET_VISION_MODEL;
  assert.equal(crearAnalizadorTicket(), null);
  assert.equal(crearAnalizadorTicket({ modelo: undefined }), null);
  if (prev !== undefined) process.env.DAVIS_TICKET_VISION_MODEL = prev;
});

test('el payload enviado al proveedor es el de vision (texto + imagen base64)', async () => {
  let llamada = null;
  const chatFalso = async (args) => { llamada = args; return { message: { content: '{"importe": 12.5, "comercio": "Mercadona", "moneda": "EUR", "fecha": "2026-11-05", "camposDudosos": []}' } }; };
  const analizar = crearAnalizadorTicket({ modelo: 'gpt-4o-mini', chatCompletion: chatFalso });
  assert.equal(typeof analizar, 'function');
  const lectura = await analizar(Buffer.from('foto-falsa'));
  assert.equal(llamada.model, 'gpt-4o-mini', 'usa el modelo configurado');
  const partes = llamada.messages[0].content;
  assert.equal(partes[0].type, 'text');
  assert.equal(partes[1].type, 'image_url');
  assert.ok(partes[1].image_url.url.startsWith('data:image/jpeg;base64,'), 'imagen como data URL base64');
  assert.deepEqual(lectura, { importe: 12.5, comercio: 'Mercadona', moneda: 'EUR', fecha: '2026-11-05', camposDudosos: [] });
});

test('parseo robusto: JSON dentro de fences o con texto alrededor', async () => {
  const chatFalso = async () => ({ message: { content: 'Claro, aqui lo tienes:\n```json\n{"importe": 3.2, "camposDudosos": ["comercio", 5]}\n```' } });
  const analizar = crearAnalizadorTicket({ modelo: 'x', chatCompletion: chatFalso });
  const lectura = await analizar(Buffer.from('f'));
  assert.equal(lectura.importe, 3.2);
  assert.deepEqual(lectura.camposDudosos, ['comercio'], 'descarta dudas no texto');
});

test('respuesta sin JSON devuelve objeto vacio (el pipeline pedira el importe a David)', async () => {
  const chatFalso = async () => ({ message: { content: 'no veo ningun ticket' } });
  const analizar = crearAnalizadorTicket({ modelo: 'x', chatCompletion: chatFalso });
  assert.deepEqual(await analizar(Buffer.from('f')), {});
});
