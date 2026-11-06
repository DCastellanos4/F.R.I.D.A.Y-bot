/**
 * history_index.test.js
 * Adaptacion Hermes n.2 aprobada por David (6 nov 2026): indice full-text
 * de la memoria episodica para no rescanear el JSONL en cada busqueda.
 * Fija: el indice se deriva del contenido ya redactado, se actualiza al
 * archivar, se reconstruye si queda desincronizado, y desaparece con el
 * borrado (nunca retiene lo que el historial no retiene).
 *
 * Strict Policy: Zero Emojis.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'path';
import os from 'os';
import crypto from 'node:crypto';

const dirEntorno = fs.mkdtempSync(path.join(os.tmpdir(), 'davis-histidx-'));
process.env.DAVIS_DATA_DIR = path.join(dirEntorno, 'data');
process.env.DAVIS_HISTORY_DIR = path.join(dirEntorno, 'history');
process.env.NODE_ENV = 'test';

const episodica = await import('../../src/services/episodicMemoryService.js');

const carpetaEpisodios = path.join(dirEntorno, 'data', 'episodios');
const deps = { carpetaEpisodios };
const rutaIdx = (chat) => path.join(carpetaEpisodios, 'indices', `${crypto.createHash('sha256').update(String(chat)).digest('hex').slice(0, 24)}.json`);

test('archivar crea el indice y la busqueda lo usa para encontrar el fragmento', async () => {
  const chat = 'chat-idx-1';
  episodica.archivarEpisodios(chat, [
    { role: 'user', content: 'el examen de estadistica es el 22 de enero', ts: '2026-10-01T10:00:00Z' },
    { role: 'user', content: 'me apetece sushi el viernes', ts: '2026-10-02T10:00:00Z' }
  ], deps);
  assert.ok(fs.existsSync(rutaIdx(chat)), 'existe el archivo de indice');
  const hits = await episodica.buscarEpisodios(chat, 'examen de estadistica', deps);
  assert.ok(hits.some((h) => h.content.includes('22 de enero')));
});

test('el indice se actualiza incrementalmente al archivar mas episodios', async () => {
  const chat = 'chat-idx-2';
  episodica.archivarEpisodios(chat, [{ role: 'user', content: 'primera nota sobre gatos', ts: '2026-10-01T10:00:00Z' }], deps);
  episodica.archivarEpisodios(chat, [{ role: 'user', content: 'segunda nota sobre perros', ts: '2026-10-02T10:00:00Z' }], deps);
  const indice = JSON.parse(fs.readFileSync(rutaIdx(chat), 'utf-8'));
  assert.equal(indice.totalLineas, 2);
  assert.ok(indice.tokens['gatos'] && indice.tokens['perros']);
  const hits = await episodica.buscarEpisodios(chat, 'perros', deps);
  assert.ok(hits.some((h) => h.content.includes('segunda nota sobre perros')));
});

test('un indice desincronizado se reconstruye y la busqueda sigue funcionando', async () => {
  const chat = 'chat-idx-3';
  episodica.archivarEpisodios(chat, [{ role: 'user', content: 'cita con el dentista el jueves', ts: '2026-10-01T10:00:00Z' }], deps);
  // Corrompe el contador del indice.
  fs.writeFileSync(rutaIdx(chat), JSON.stringify({ totalLineas: 999, tokens: {} }), 'utf-8');
  const hits = await episodica.buscarEpisodios(chat, 'dentista', deps);
  assert.ok(hits.some((h) => h.content.includes('dentista')), 'barrido de respaldo funciona');
  const reconstruido = JSON.parse(fs.readFileSync(rutaIdx(chat), 'utf-8'));
  assert.equal(reconstruido.totalLineas, 1, 'indice reconstruido');
});

test('limpiarEpisodios borra tambien el indice (retencion alineada)', async () => {
  const chat = 'chat-idx-4';
  episodica.archivarEpisodios(chat, [{ role: 'user', content: 'dato temporal', ts: '2026-10-01T10:00:00Z' }], deps);
  assert.ok(fs.existsSync(rutaIdx(chat)));
  episodica.limpiarEpisodios(chat, deps);
  assert.ok(!fs.existsSync(rutaIdx(chat)), 'el indice desaparece con los episodios');
  assert.deepEqual(await episodica.buscarEpisodios(chat, 'dato temporal', deps), []);
});
