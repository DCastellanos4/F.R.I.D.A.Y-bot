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

// ---------------- Salud del clasificador (metrica + aviso acotado) ----------------
// El clasificador estuvo caido en produccion sin que nadie lo supiera hasta
// que el catalogo crecio y el volcado rompio todo con el 400. Cada intento
// de clasificacion queda registrado en un JSONL local; si la tasa de fallo
// reciente es alta se avisa a David UNA vez cada 24 h como maximo.

const VENTANA_SALUD = 10;        // clasificaciones recientes evaluadas
const UMBRAL_TASA_FALLO = 0.8;   // >=80% de fallos = no saludable
const COOLDOWN_AVISO_MS = 24 * 60 * 60 * 1000;

// Puerto de salida: la persistencia de metricas vive en un adaptador
// (jsonlClassifierMetricsStore) inyectado por la raiz de composicion.
// Sin inyeccion, almacen sin-op: el core nunca toca fs.
const STORE_NOOP = Object.freeze({ registrar() {}, leerEventos() { return []; } });

function almacenMetricas(deps = {}) {
  const store = deps.metricasClasificador;
  if (store && typeof store.registrar === 'function' && typeof store.leerEventos === 'function') {
    return store;
  }
  return STORE_NOOP;
}

/**
 * Salud reciente del clasificador: sobre las ultimas VENTANA_SALUD
 * clasificaciones reales (sin cache), no saludable si la tasa de
 * parse_fail|error llega al umbral.
 */
export function evaluarSaludClasificador(deps = {}) {
  const reales = almacenMetricas(deps).leerEventos().filter((e) => e.tipo === 'clasificacion' && e.resultado !== 'cache');
  const ventana = reales.slice(-VENTANA_SALUD);
  if (ventana.length < VENTANA_SALUD) return { saludable: true, muestras: ventana.length, tasaFallo: 0 };
  const fallos = ventana.filter((e) => e.resultado === 'parse_fail' || e.resultado === 'error').length;
  const tasaFallo = fallos / ventana.length;
  return { saludable: tasaFallo < UMBRAL_TASA_FALLO, muestras: ventana.length, tasaFallo };
}

/**
 * Avisa a David a traves de deps.avisarSaludClasificador si el clasificador
 * no esta saludable y no se aviso en las ultimas 24 h. Devuelve true si aviso.
 */
export async function comprobarYAvisarSalud(deps = {}) {
  if (typeof deps.avisarSaludClasificador !== 'function') return false;
  const salud = evaluarSaludClasificador(deps);
  if (salud.saludable) return false;
  const ultimosAvisos = almacenMetricas(deps).leerEventos().filter((e) => e.tipo === 'aviso_salud');
  const ultimo = ultimosAvisos[ultimosAvisos.length - 1];
  if (ultimo && Date.now() - new Date(ultimo.ts).getTime() < COOLDOWN_AVISO_MS) return false;
  const pct = Math.round(salud.tasaFallo * 100);
  await deps.avisarSaludClasificador(
    `[D.A.V.I.S. - SALUD DEL CLASIFICADOR]\n\nEl clasificador de intenciones falla en el ${pct}% de sus ultimas ${salud.muestras} clasificaciones. Mientras tanto respondo en modo degradado (sin seleccion de herramientas por modelo); conviene revisar el proveedor del clasificador.`
  );
  almacenMetricas(deps).registrar({ tipo: 'aviso_salud', tasaFallo: salud.tasaFallo });
  return true;
}

/**
 * Segundo nivel del enrutador: cuando la seleccion por regex supera el
 * limite del proveedor (mensaje multi-area), el modelo elige las areas
 * dominantes ENTRE las ya detectadas y se ofrecen solo sus herramientas.
 * Devuelve [] si el modelo no responde algo aprovechable.
 */
export async function seleccionarDominiosConModelo(mensaje, dominios, deps = {}) {
  if (!Array.isArray(dominios) || dominios.length === 0) return [];
  const chatCompletion = deps.chatCompletion;
  if (typeof chatCompletion !== 'function') return [];
  try {
    const res = await chatCompletion({
      messages: [
        { role: 'system', content: `El mensaje de David toca estas areas de su asistente: ${dominios.join(', ')}. Elige como mucho DOS areas dominantes para responder bien su mensaje. Responde SOLO con las etiquetas separadas por comas, sin explicaciones ni emojis.` },
        { role: 'user', content: mensaje }
      ],
      options: { temperature: 0, num_predict: 40, num_ctx: 4096 }
    });
    const texto = (res?.message?.content || '').toLowerCase();
    const elegidos = dominios.filter((d) => new RegExp(`\\b${d.toLowerCase()}\\b`).test(texto));
    return elegidos.slice(0, 2);
  } catch (err) {
    console.error('[RouterDosNiveles] Error seleccionando dominios:', err.message);
    return [];
  }
}

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
    if (!clasificacion) {
      almacenMetricas(deps).registrar({ tipo: 'clasificacion', resultado: 'parse_fail' });
      return null;
    }

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

    almacenMetricas(deps).registrar({
      tipo: 'clasificacion',
      resultado: clasificacion.confianza >= UMBRAL_CONFIANZA ? 'ok' : 'baja_confianza',
      intencion: clasificacion.intencion,
      confianza: clasificacion.confianza
    });

    return resultado;
  } catch (err) {
    console.error('[RouterModelo] Error clasificando intencion:', err.message);
    almacenMetricas(deps).registrar({ tipo: 'clasificacion', resultado: 'error', detalle: String(err.message || err).slice(0, 200) });
    return null;
  }
}
