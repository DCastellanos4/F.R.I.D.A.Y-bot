/**
 * episodicMemoryService.js - Memoria episodica (plan de inteligencia, 6 nov)
 *
 * La ventana del modelo solo ve los ultimos 12 mensajes y la condensacion
 * resume el resto: los detalles verbatim se pierden. Este servicio archiva
 * los mensajes que salen del historial (recorte duro o condensacion) en un
 * JSONL por chat y ofrece busqueda por palabras clave con ranking opcional
 * por modelo (mismo patron que la busqueda semantica de notas), para
 * recuperar contexto antiguo relevante para el mensaje actual.
 *
 * El contenido archivado ya viene redactado (sin OTP ni credenciales) del
 * historial. Nunca se archiva contenido de otros chats.
 *
 * Strict Policy: Zero Emojis.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { normalizarTexto } from './memoryService.js';
import { redactarSensibles } from './redaccionService.js';

const DATA_DIR = process.env.DAVIS_DATA_DIR || path.join(process.cwd(), 'data');
const CARPETA_EPISODIOS_DEFECTO = path.join(DATA_DIR, 'episodios');
const MAX_EPISODIOS_ARCHIVO = 400;   // tope conservado por chat
const MAX_CANDIDATOS = 8;
const MAX_DEVUELTOS = 3;

function carpeta(deps = {}) {
  return deps.carpetaEpisodios || CARPETA_EPISODIOS_DEFECTO;
}

function rutaChat(chatId, deps = {}) {
  const hash = crypto.createHash('sha256').update(String(chatId)).digest('hex').slice(0, 24);
  return path.join(carpeta(deps), `${hash}.jsonl`);
}

/**
 * Archiva mensajes que salen del historial activo. Cada episodio:
 * { role: 'user'|'assistant', content, ts }.
 */
export function archivarEpisodios(chatId, mensajes, deps = {}) {
  if (!chatId || !Array.isArray(mensajes) || mensajes.length === 0) return false;
  // En tests nunca se escribe en el data/ real del repo: hace falta una
  // carpeta inyectada o un DAVIS_DATA_DIR temporal.
  if (process.env.NODE_ENV === 'test' && !deps.carpetaEpisodios && !process.env.DAVIS_DATA_DIR) return false;
  try {
    const ruta = rutaChat(chatId, deps);
    fs.mkdirSync(path.dirname(ruta), { recursive: true });
    const lineas = mensajes
      .filter((m) => m && typeof m.content === 'string' && (m.role === 'user' || m.role === 'assistant'))
      // Doble red de seguridad: el contenido del historial ya viene redactado,
      // pero el archivo nunca guarda sensibles aunque le lleguen sin filtrar.
      .map((m) => JSON.stringify({ role: m.role, content: redactarSensibles(m.content), ts: m.ts || new Date().toISOString() }));
    if (lineas.length === 0) return false;
    fs.appendFileSync(ruta, lineas.join('\n') + '\n', { encoding: 'utf-8', mode: 0o600 });
    // Tope por chat: conserva los mas recientes.
    const todas = fs.readFileSync(ruta, 'utf-8').split('\n').filter(Boolean);
    if (todas.length > MAX_EPISODIOS_ARCHIVO + 100) {
      fs.writeFileSync(ruta, todas.slice(-MAX_EPISODIOS_ARCHIVO).join('\n') + '\n', { encoding: 'utf-8', mode: 0o600 });
    }
    return true;
  } catch (err) {
    console.error('[MemoriaEpisodica] Error archivando:', err.message);
    return false;
  }
}

function leerEpisodios(chatId, deps) {
  try {
    const ruta = rutaChat(chatId, deps);
    if (!fs.existsSync(ruta)) return [];
    return fs.readFileSync(ruta, 'utf-8').split('\n').filter(Boolean)
      .map((l) => { try { return JSON.parse(l); } catch { return null; } })
      .filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Busca episodios antiguos relevantes para la consulta: candidatos por
 * palabras clave y, si hay varios y modelo disponible, ranking por modelo.
 * Devuelve hasta MAX_DEVUELTOS episodios [{ role, content, ts }].
 */
export async function buscarEpisodios(chatId, consulta, deps = {}) {
  if (!chatId || !consulta || typeof consulta !== 'string') return [];
  const episodios = leerEpisodios(chatId, deps);
  if (episodios.length === 0) return [];

  const palabras = normalizarTexto(consulta).split(' ').filter((w) => w.length > 2);
  if (palabras.length === 0) return [];

  const puntuados = episodios.map((e, idx) => {
    const texto = normalizarTexto(e.content);
    let puntos = 0;
    for (const w of palabras) if (texto.includes(w)) puntos++;
    return { e, idx, puntos };
  }).filter((p) => p.puntos > 0);

  if (puntuados.length === 0) return [];
  // Mas palabras coincidentes primero; a igualdad, el mas reciente.
  puntuados.sort((a, b) => b.puntos - a.puntos || b.idx - a.idx);
  const candidatos = puntuados.slice(0, MAX_CANDIDATOS).map((p) => p.e);

  if (candidatos.length <= MAX_DEVUELTOS || typeof deps.chatCompletion !== 'function') {
    return candidatos.slice(0, MAX_DEVUELTOS);
  }

  try {
    const lista = candidatos.map((c, i) => `${i + 1}. [${c.role === 'user' ? 'David' : 'Asistente'}] ${c.content.slice(0, 200)}`).join('\n');
    const resp = await deps.chatCompletion({
      messages: [
        { role: 'system', content: 'De la lista numerada de fragmentos antiguos de conversacion, elige los que de verdad aportan contexto a la consulta actual de David. Devuelve SOLO los numeros elegidos separados por comas (maximo 3), o "ninguno". Sin emojis.' },
        { role: 'user', content: `Consulta actual: ${consulta}\n\n${lista}` }
      ],
      options: { temperature: 0, num_predict: 30, num_ctx: 4096 }
    });
    const texto = (resp?.message?.content || '').trim();
    const indices = [...texto.matchAll(/\d+/g)].map((m) => Number(m[0]) - 1).filter((i) => i >= 0 && i < candidatos.length);
    const elegidos = [...new Set(indices)].slice(0, MAX_DEVUELTOS).map((i) => candidatos[i]);
    return elegidos;
  } catch (err) {
    console.error('[MemoriaEpisodica] Error en ranking por modelo:', err.message);
    return candidatos.slice(0, MAX_DEVUELTOS);
  }
}

/**
 * Borra el archivo de episodios del chat (peticion explicita de David).
 */
export function limpiarEpisodios(chatId, deps = {}) {
  try {
    const ruta = rutaChat(chatId, deps);
    if (fs.existsSync(ruta)) fs.unlinkSync(ruta);
    return true;
  } catch {
    return false;
  }
}
