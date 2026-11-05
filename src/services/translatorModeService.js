/**
 * translatorModeService.js - Modo traductor de conversacion (nº 29)
 *
 * David activa el modo para un chat ("activa el traductor a ingles") y cada
 * mensaje suyo se traduce al idioma elegido; "desactiva el traductor" lo
 * apaga. La activacion requiere su peticion textual (guard en el executor).
 * La traduccion la hace el modelo ya configurado (chatCompletion inyectado);
 * el estado se guarda por chat.
 *
 * Strict Policy: Zero Emojis.
 */
import fs from 'node:fs';
import path from 'path';
import { DATA_DIR } from '../config/paths.js';

export const ARCHIVO_DEFECTO = path.join(DATA_DIR, 'traductor.json');
const IDIOMAS = /^[a-záéíóúñü -]{2,30}$/i;

function ruta(deps = {}) {
  return deps.rutaArchivo || ARCHIVO_DEFECTO;
}

function leerEstado(deps = {}) {
  try {
    return { chats: {}, ...JSON.parse(fs.readFileSync(ruta(deps), 'utf-8')) };
  } catch {
    return { chats: {} };
  }
}

function guardarEstado(estado, deps = {}) {
  const destino = ruta(deps);
  fs.mkdirSync(path.dirname(destino), { recursive: true });
  const tmp = `${destino}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(estado, null, 2), 'utf-8');
  fs.renameSync(tmp, destino);
}

export function activarTraductor({ idioma } = {}, deps = {}) {
  const i = String(idioma || '').trim().toLowerCase();
  if (!IDIOMAS.test(i)) return { ok: false, error: 'Dime el idioma en una palabra (ingles, frances, aleman...).' };
  const chatId = deps.chatId;
  if (!chatId) return { ok: false, error: 'No se en que chat activar el traductor.' };
  const estado = leerEstado(deps);
  estado.chats[chatId] = { idioma: i, activadoEn: new Date().toISOString() };
  guardarEstado(estado, deps);
  return { ok: true, idioma: i };
}

export function desactivarTraductor(deps = {}) {
  const estado = leerEstado(deps);
  if (!deps.chatId || !estado.chats[deps.chatId]) return { ok: false, error: 'El traductor no estaba activo en este chat.' };
  delete estado.chats[deps.chatId];
  guardarEstado(estado, deps);
  return { ok: true };
}

export function estadoTraductor(deps = {}) {
  const estado = leerEstado(deps);
  return (deps.chatId && estado.chats[deps.chatId]) || null;
}

/**
 * Traduce un texto con el modelo configurado. deps.chatCompletion permite
 * inyectar un simulacro en pruebas. Devuelve solo el texto traducido.
 */
export async function traducir(texto, idioma, deps = {}) {
  if (typeof deps.chatCompletion !== 'function') {
    return { ok: false, error: 'El traductor necesita el modelo de lenguaje configurado.' };
  }
  const respuesta = await deps.chatCompletion({
    messages: [
      { role: 'system', content: `Eres un traductor. Traduce el mensaje del usuario al ${idioma}. Devuelve SOLO la traduccion, sin comillas, sin explicaciones y conservando el tono del original.` },
      { role: 'user', content: String(texto).slice(0, 4000) }
    ]
  });
  const traduccion = (respuesta?.message?.content || respuesta?.content || '').trim();
  if (!traduccion) return { ok: false, error: 'No he podido traducir ese mensaje.' };
  return { ok: true, traduccion };
}
