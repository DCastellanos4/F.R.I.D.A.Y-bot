/**
 * historySearchService.js - Buscador del historial de conversaciones (nº 31)
 *
 * Busca texto en el historial persistido del chat (el mismo que usa el bot
 * para dar contexto al modelo). Solo lectura: nunca modifica el historial.
 *
 * Strict Policy: Zero Emojis.
 */
import fs from 'node:fs';
import path from 'path';
import crypto from 'node:crypto';
import { DATA_DIR } from '../config/paths.js';

function carpeta(deps = {}) {
  if (deps.carpetaHistorial) return deps.carpetaHistorial;
  return process.env.DAVIS_HISTORY_DIR
    ? path.resolve(process.env.DAVIS_HISTORY_DIR)
    : path.join(DATA_DIR, 'historial');
}

function rutaChat(chatId, deps = {}) {
  const hash = crypto.createHash('sha256').update(String(chatId)).digest('hex').slice(0, 24);
  return path.join(carpeta(deps), `${hash}.json`);
}

/**
 * Busca un termino en los mensajes del chat (mas recientes primero).
 * Devuelve { ok, coincidencias: [{role, content}], total }.
 */
export function buscarEnHistorial({ chatId, termino, limite = 5 } = {}, deps = {}) {
  const t = String(termino || '').trim().toLowerCase();
  if (!chatId) return { ok: false, error: 'No se en que chat buscar.' };
  if (!t) return { ok: false, error: 'Dime que quieres que busque en el historial.' };
  let mensajes;
  try {
    const data = JSON.parse(fs.readFileSync(rutaChat(chatId, deps), 'utf-8'));
    mensajes = Array.isArray(data.mensajes) ? data.mensajes : [];
  } catch {
    return { ok: true, coincidencias: [], total: 0 };
  }
  const tope = Math.min(Math.max(Number(limite) || 5, 1), 10);
  const coincidencias = [];
  for (let i = mensajes.length - 1; i >= 0 && coincidencias.length < tope; i--) {
    const m = mensajes[i];
    if (typeof m.content === 'string' && m.content.toLowerCase().includes(t)) {
      coincidencias.push({ role: m.role === 'assistant' ? 'yo' : 'tu', content: m.content.slice(0, 300) });
    }
  }
  return { ok: true, coincidencias, total: coincidencias.length };
}
