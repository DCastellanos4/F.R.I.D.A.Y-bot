import { normalizarTexto } from '../services/memoryService.js';
import { herramientasParaIntenciones, MAPA_INTENCION_HERRAMIENTAS } from './tools.js';

/**
 * intentRouterService.js
 *
 * Clasificador de intenciones por modelo, respaldo del enrutador por regex.
 *
 * Cuando el enrutador por expresiones regulares no reconoce el mensaje (su
 * "safety net" volcaria las 32 herramientas en el contexto), este servicio
 * pide al modelo una clasificacion acotada: una etiqueta de intencion y una
 * confianza entre 0 y 1.
 *
 * - Confianza alta (>= UMBRAL_CONFIANZA): se inyectan solo las herramientas
 *   de esa intencion. Hipotesis a medir con la bateria dorada: menos tokens y
 *   menos herramientas equivocadas; no esta garantizado, hay que medirlo.
 * - Confianza baja: no se inyecta ninguna herramienta y el agente pide una
 *   aclaracion breve en lugar de actuar a ciegas.
 *
 * Las clasificaciones se cachean por mensaje normalizado para no repetir la
 * llamada al modelo en mensajes identicos.
 *
 * Strict Policy: Zero Emojis.
 */

export const UMBRAL_CONFIANZA = 0.6;
const MAX_CACHE = 100;
const cacheClasificaciones = new Map();

const ETIQUETAS = Object.keys(MAPA_INTENCION_HERRAMIENTAS);

function leerCache(clave) {
  if (!cacheClasificaciones.has(clave)) return null;
  const valor = cacheClasificaciones.get(clave);
  // refrescar LRU
  cacheClasificaciones.delete(clave);
  cacheClasificaciones.set(clave, valor);
  return valor;
}

function escribirCache(clave, valor) {
  cacheClasificaciones.set(clave, valor);
  if (cacheClasificaciones.size > MAX_CACHE) {
    const primera = cacheClasificaciones.keys().next().value;
    cacheClasificaciones.delete(primera);
  }
}

export function limpiarCacheClasificaciones() {
  cacheClasificaciones.clear();
}

/**
 * Extrae { intencion, confianza } de la respuesta del modelo con tolerancia
 * a formatos (JSON puro, JSON dentro de texto, "etiqueta 0.8").
 */
export function parsearClasificacion(texto) {
  if (!texto || typeof texto !== 'string') return null;

  let candidato = null;
  const matchJson = texto.match(/\{[\s\S]*?\}/);
  if (matchJson) {
    try {
      candidato = JSON.parse(matchJson[0]);
    } catch {
      candidato = null;
    }
  }

  if (!candidato) {
    const matchTexto = texto.match(/([a-zA-Z_]+)\s*[,:]?\s*(0(?:\.\d+)?|1(?:\.0+)?)/);
    if (matchTexto) {
      candidato = { intencion: matchTexto[1], confianza: parseFloat(matchTexto[2]) };
    }
  }

  if (!candidato) return null;

  const intencion = String(candidato.intencion || candidato.intent || '').trim();
  const confianza = Number(candidato.confianza ?? candidato.confidence);

  if (!ETIQUETAS.includes(intencion)) return null;
  if (!isFinite(confianza) || confianza < 0 || confianza > 1) return null;

  return { intencion, confianza };
}

/**
 * Clasifica la intencion del mensaje con el modelo.
 *
 * @param {string} mensaje
 * @param {object} [deps]
 * @param {Function} [deps.chatCompletion] - LLM inyectado (obligatorio en pruebas;
 *        en produccion se inyecta desde jarvisAgent para compartir configuracion)
 * @returns {Promise<{ intencion: string, confianza: number, herramientas: Array, origen: string } | null>}
 */
export async function clasificarIntencionConModelo(mensaje, deps = {}) {
  if (!mensaje || typeof mensaje !== 'string') return null;
  const chatCompletion = deps.chatCompletion;
  if (typeof chatCompletion !== 'function') return null;

  const clave = normalizarTexto(mensaje);
  const enCache = leerCache(clave);
  if (enCache) return { ...enCache, origen: 'cache' };

  const promptSistema = [
    'Clasifica la intencion principal del mensaje de David en UNA de estas etiquetas:',
    ETIQUETAS.join(', ') + '.',
    'Responde SOLO con un JSON: {"intencion": "<etiqueta>", "confianza": <numero entre 0 y 1>}.',
    'Usa "conversacion" si es charla sin accion. Si dudas entre varias, baja la confianza.',
    'Sin emojis, sin explicaciones.'
  ].join(' ');

  try {
    const res = await chatCompletion({
      messages: [
        { role: 'system', content: promptSistema },
        { role: 'user', content: mensaje }
      ],
      options: { temperature: 0, num_predict: 60, num_ctx: 8192 }
    });

    const clasificacion = parsearClasificacion(res?.message?.content || '');
    if (!clasificacion) return null;

    const resultado = {
      ...clasificacion,
      herramientas: clasificacion.confianza >= UMBRAL_CONFIANZA
        ? herramientasParaIntenciones([clasificacion.intencion])
        : [],
      origen: 'modelo'
    };

    escribirCache(clave, {
      intencion: resultado.intencion,
      confianza: resultado.confianza,
      herramientas: resultado.herramientas
    });

    return resultado;
  } catch (err) {
    console.error('[RouterModelo] Error clasificando intencion:', err.message);
    return null;
  }
}
