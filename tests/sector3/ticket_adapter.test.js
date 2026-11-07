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
const { prepareMessagesForProvider } = await import('../../src/core/llmService.js');

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

// ---------------------------------------------------------------------------
// Ciclo de vida local (aprobado por David, 7 nov 2026): la vision arranca
// solo cuando llega un ticket y no deja nada residente al terminar.
// ---------------------------------------------------------------------------

test('la llamada pide keep_alive 0 y respeta proveedor/baseUrl opcionales', async () => {
  let llamada = null;
  const chatFalso = async (args) => { llamada = args; return { message: { content: '{}' } }; };
  const analizar = crearAnalizadorTicket({ modelo: 'llama3.2-vision:11b', provider: 'ollama', baseUrl: 'http://127.0.0.1:11434', chatCompletion: chatFalso });
  await analizar(Buffer.from('foto'));
  assert.equal(llamada.provider, 'ollama');
  assert.equal(llamada.baseUrl, 'http://127.0.0.1:11434');
  assert.equal(llamada.options.keep_alive, 0, 'keep_alive 0: el modelo local se descarga al terminar');
});

test('las lecturas se serializan: nunca hay dos inferencias en vuelo', async () => {
  const orden = [];
  let liberar;
  const primera = new Promise((resolve) => { liberar = resolve; });
  let llamadas = 0;
  const chatFalso = async () => {
    llamadas++;
    orden.push(`inicio${llamadas}`);
    if (llamadas === 1) await primera;
    orden.push(`fin${llamadas}`);
    return { message: { content: '{}' } };
  };
  const analizar = crearAnalizadorTicket({ modelo: 'x', chatCompletion: chatFalso });
  const p1 = analizar(Buffer.from('a'));
  const p2 = analizar(Buffer.from('b'));
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(llamadas, 1, 'la segunda lectura espera a la primera');
  liberar();
  await Promise.all([p1, p2]);
  assert.deepEqual(orden, ['inicio1', 'fin1', 'inicio2', 'fin2']);
});

test('timeout del cliente: aviso honesto, pero la cola espera al FIN REAL de la inferencia', async () => {
  // Si la foto A agota el timeout del cliente pero la inferencia sigue
  // viva en el servidor, la foto B NO arranca hasta que A termina de
  // verdad: nunca hay dos inferencias en vuelo.
  let liberarColgada;
  const colgada = new Promise((resolve) => { liberarColgada = resolve; });
  let llamadas = 0;
  const chatFalso = async () => {
    llamadas++;
    if (llamadas === 1) return colgada; // inferencia lenta/colgada
    return { message: { content: '{"importe": 5, "camposDudosos": []}' } };
  };
  const analizar = crearAnalizadorTicket({ modelo: 'x', timeoutMs: 40, chatCompletion: chatFalso });
  const pA = analizar(Buffer.from('a')).catch((e) => e);
  const pB = analizar(Buffer.from('b')).catch((e) => e);
  const [rA, rB] = await Promise.all([pA, pB]);
  assert.match(rA.message, /agoto su tiempo/, 'A recibe aviso honesto');
  assert.match(rB.message, /agoto su tiempo/, 'B tambien: su espera cuenta desde que llego');
  assert.equal(llamadas, 1, 'B nunca arranco: la inferencia de A seguia viva');
  liberarColgada({ message: { content: '{}' } });
  const lectura = await analizar(Buffer.from('c'));
  assert.equal(lectura.importe, 5, 'cuando A termina de verdad, la cola vuelve a fluir');
});

test('un error del proveedor se propaga (el bot avisa honesto) y la cola sigue viva', async () => {
  let llamadas = 0;
  const chatFalso = async () => {
    llamadas++;
    if (llamadas === 1) throw new Error('modelo no encontrado');
    return { message: { content: '{"importe": 1, "camposDudosos": []}' } };
  };
  const analizar = crearAnalizadorTicket({ modelo: 'x', chatCompletion: chatFalso });
  await assert.rejects(analizar(Buffer.from('a')), /modelo no encontrado/);
  assert.equal((await analizar(Buffer.from('b'))).importe, 1);
});

// ---------------------------------------------------------------------------
// Conversion de imagenes para la ruta local de llmService (image_url -> images)
// ---------------------------------------------------------------------------

test('prepareMessagesForProvider convierte image_url al array images de Ollama', () => {
  const b64 = Buffer.from('foto').toString('base64');
  const [prep] = prepareMessagesForProvider([{
    role: 'user',
    content: [
      { type: 'text', text: 'lee este ticket' },
      { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${b64}` } }
    ]
  }], true);
  assert.equal(prep.content, 'lee este ticket');
  assert.deepEqual(prep.images, [b64], 'base64 sin prefijo data:');
});

test('prepareMessagesForProvider NO toca el formato OpenAI en la ruta cloud', () => {
  const contenido = [
    { type: 'text', text: 'lee' },
    { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,AAAA' } }
  ];
  const [prep] = prepareMessagesForProvider([{ role: 'user', content: contenido }], false);
  assert.deepEqual(prep.content, contenido, 'la ruta cloud conserva las partes tal cual');
  assert.equal(prep.images, undefined);
});
