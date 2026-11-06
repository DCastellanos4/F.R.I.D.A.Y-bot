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

// ---- Indice full-text por chat (recomendacion Hermes n.2, aprobada por
// David el 6 nov 2026): indice invertido token -> lineas del JSONL para no
// rescanear todo el archivo en cada busqueda. Se deriva SIEMPRE del
// contenido ya redactado, se borra con el (limpiarEpisodios) y se reconstruye
// si queda desincronizado: no retiene nada que el archivo no retenga.
function rutaIndice(chatId, deps = {}) {
  const hash = crypto.createHash('sha256').update(String(chatId)).digest('hex').slice(0, 24);
  const base = deps.carpetaIndices || path.join(carpeta(deps), 'indices');
  return path.join(base, `${hash}.json`);
}

function tokenizar(texto) {
  return [...new Set(normalizarTexto(texto).split(' ').filter((w) => w.length > 2))];
}

function construirIndice(episodios) {
  const tokens = {};
  episodios.forEach((e, i) => {
    for (const t of tokenizar(e.content || '')) {
      (tokens[t] || (tokens[t] = [])).push(i);
    }
  });
  return { totalLineas: episodios.length, tokens };
}

function leerIndice(chatId, deps = {}) {
  try {
    const data = JSON.parse(fs.readFileSync(rutaIndice(chatId, deps), 'utf-8'));
    if (data && typeof data.totalLineas === 'number' && data.tokens) return data;
  } catch { /* sin indice o corrupto: se reconstruye */ }
  return null;
}

function escribirIndice(chatId, indice, deps = {}) {
  if (process.env.NODE_ENV === 'test' && !deps.carpetaEpisodios && !process.env.DAVIS_DATA_DIR) return;
  try {
    const ruta = rutaIndice(chatId, deps);
    fs.mkdirSync(path.dirname(ruta), { recursive: true });
    fs.writeFileSync(ruta, JSON.stringify(indice), { encoding: 'utf-8', mode: 0o600 });
  } catch (err) {
    console.error('[MemoriaEpisodica] Error escribiendo indice:', err.message);
  }
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
    let todas = fs.readFileSync(ruta, 'utf-8').split('\n').filter(Boolean);
    let truncado = false;
    if (todas.length > MAX_EPISODIOS_ARCHIVO + 100) {
      todas = todas.slice(-MAX_EPISODIOS_ARCHIVO);
      fs.writeFileSync(ruta, todas.join('\n') + '\n', { encoding: 'utf-8', mode: 0o600 });
      truncado = true;
    }
    // Indice full-text: incremental si esta sincronizado; reconstruccion
    // completa si hubo truncado o desfase de lineas.
    const episodiosActuales = todas.map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
    const indicePrevio = leerIndice(chatId, deps);
    if (!truncado && indicePrevio && indicePrevio.totalLineas === episodiosActuales.length - lineas.length) {
      episodiosActuales.slice(indicePrevio.totalLineas).forEach((e, k) => {
        const i = indicePrevio.totalLineas + k;
        for (const t of tokenizar(e.content || '')) {
          (indicePrevio.tokens[t] || (indicePrevio.tokens[t] = [])).push(i);
        }
      });
      indicePrevio.totalLineas = episodiosActuales.length;
      escribirIndice(chatId, indicePrevio, deps);
    } else {
      escribirIndice(chatId, construirIndice(episodiosActuales), deps);
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

  // Candidatos via indice full-text si esta sincronizado con el archivo;
  // si no, barrido clasico y se reconstruye el indice para la proxima.
  let base = episodios.map((e, idx) => ({ e, idx }));
  const indice = leerIndice(chatId, deps);
  if (indice && indice.totalLineas === episodios.length) {
    const vistos = new Map();
    for (const w of palabras) {
      for (const i of indice.tokens[w] || []) vistos.set(i, (vistos.get(i) || 0) + 1);
    }
    base = [...vistos.entries()].map(([idx, puntos]) => ({ e: episodios[idx], idx, puntosIndex: puntos }));
  } else if (episodios.length > 0) {
    escribirIndice(chatId, construirIndice(episodios), deps);
  }

  const puntuados = base.map(({ e, idx }) => {
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
    const rutaIdx = rutaIndice(chatId, deps);
    if (fs.existsSync(rutaIdx)) fs.unlinkSync(rutaIdx);
    return true;
  } catch {
    return false;
  }
}
