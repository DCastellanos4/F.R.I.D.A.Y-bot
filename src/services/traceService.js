/**
 * traceService.js - Trazas del recorrido de mensajes (6 nov 2026)
 *
 * Por cada mensaje que procesa consultarJarvis registra, por chat, una
 * linea JSONL con el recorrido: via de enrutado (reglas directas,
 * clasificador por modelo o desambiguacion), areas detectadas, numero de
 * herramientas ofrecidas, llamadas a herramientas con su ronda y
 * resultado, rondas del bucle y duracion total.
 *
 * Privacidad: el mensaje se guarda pasado por redactarSensibles y
 * recortado; los argumentos de las herramientas nunca se guardan (pueden
 * contener datos personales), solo el nombre de la herramienta y si
 * salio bien o mal.
 *
 * Lo usa la herramienta explicar_recorrido para responder a David en
 * llano ("como has llegado a esa respuesta?") y sirve de base para
 * diagnosticar desvios de enrutado con datos reales.
 *
 * Strict Policy: Zero Emojis.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { redactarSensibles } from './redaccionService.js';

const DATA_DIR = process.env.DAVIS_DATA_DIR || path.join(process.cwd(), 'data');
const CARPETA_TRAZAS_DEFECTO = path.join(DATA_DIR, 'trazas');
const MAX_TRAZAS_CHAT = 50;    // tope conservado por chat
const MAX_MENSAJE = 160;       // recorte del mensaje guardado

function carpeta(deps = {}) {
  return deps.carpetaTrazas || CARPETA_TRAZAS_DEFECTO;
}

function rutaChat(chatId, deps = {}) {
  const hash = crypto.createHash('sha256').update(String(chatId)).digest('hex').slice(0, 24);
  return path.join(carpeta(deps), `${hash}.jsonl`);
}

/**
 * Crea la traza en memoria al empezar a procesar un mensaje.
 */
export function iniciarTraza(chatId, mensaje) {
  return {
    chatId: String(chatId || 'desconocido'),
    inicio: Date.now(),
    ts: new Date().toISOString(),
    mensaje: redactarSensibles(String(mensaje || '')).slice(0, MAX_MENSAJE),
    via: null,
    intenciones: [],
    herramientasOfrecidas: 0,
    llamadas: [],
    rondas: 0,
    duracionMs: null
  };
}

/**
 * Persiste la traza como linea JSONL del chat (tope MAX_TRAZAS_CHAT).
 * En tests nunca se escribe en el data/ real del repo: hace falta una
 * carpeta inyectada o un DAVIS_DATA_DIR temporal.
 */
export function guardarTraza(traza, deps = {}) {
  if (!traza || !traza.chatId) return false;
  if (process.env.NODE_ENV === 'test' && !deps.carpetaTrazas && !process.env.DAVIS_DATA_DIR) return false;
  try {
    const ruta = rutaChat(traza.chatId, deps);
    fs.mkdirSync(path.dirname(ruta), { recursive: true });
    fs.appendFileSync(ruta, JSON.stringify(traza) + '\n', { encoding: 'utf-8', mode: 0o600 });
    const todas = fs.readFileSync(ruta, 'utf-8').split('\n').filter(Boolean);
    if (todas.length > MAX_TRAZAS_CHAT + 10) {
      fs.writeFileSync(ruta, todas.slice(-MAX_TRAZAS_CHAT).join('\n') + '\n', { encoding: 'utf-8', mode: 0o600 });
    }
    return true;
  } catch (err) {
    console.error('[Trazas] Error guardando traza:', err.message);
    return false;
  }
}

function leerTrazas(chatId, deps = {}) {
  try {
    const ruta = rutaChat(chatId, deps);
    if (!fs.existsSync(ruta)) return [];
    return fs.readFileSync(ruta, 'utf-8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  } catch (err) {
    console.error('[Trazas] Error leyendo trazas:', err.message);
    return [];
  }
}

/**
 * Devuelve la ultima traza registrada del chat, o null si no hay.
 */
export function ultimaTraza(chatId, deps = {}) {
  const trazas = leerTrazas(chatId, deps);
  return trazas.length > 0 ? trazas[trazas.length - 1] : null;
}

/**
 * Elimina las trazas de un chat (peticion explicita de David, p. ej. al
 * limpiar el historial). Misma guardia de tests que la escritura.
 */
export function borrarTrazas(chatId, deps = {}) {
  if (!chatId) return false;
  if (process.env.NODE_ENV === 'test' && !deps.carpetaTrazas && !process.env.DAVIS_DATA_DIR) return false;
  try {
    const ruta = rutaChat(chatId, deps);
    if (fs.existsSync(ruta)) fs.unlinkSync(ruta);
    return true;
  } catch (err) {
    console.error('[Trazas] Error borrando trazas:', err.message);
    return false;
  }
}

/**
 * La ultima traza explicable: las peticiones de introspeccion ("como has
 * llegado a esa respuesta?") tambien dejan traza; si David lo pregunta dos
 * veces seguidas, la respuesta debe seguir refiriendose a la ultima
 * peticion REAL, no a la propia introspeccion.
 */
function ultimaTrazaExplicable(chatId, deps = {}) {
  const trazas = leerTrazas(chatId, deps);
  for (let i = trazas.length - 1; i >= 0; i--) {
    const llamadas = Array.isArray(trazas[i].llamadas) ? trazas[i].llamadas : [];
    if (!llamadas.some((l) => l.nombre === 'explicar_recorrido')) return trazas[i];
  }
  return null;
}

const VIA_LLANO = {
  regex: 'Enrutado directo: reconoci la intencion con mis reglas, sin necesidad de consultar al clasificador',
  clasificador: 'Enrutado por clasificador: las reglas no la reconocieron y un pase extra del modelo decidio el area',
  desambiguacion: 'Enrutado incierto: ni las reglas ni el clasificador tuvieron confianza suficiente, asi que preferi pedir aclaracion',
  conversacion: 'Enrutado conversacional: no hacia falta ninguna herramienta'
};

/**
 * Explica en llano la ultima traza del chat. Texto pensado para que el
 * modelo lo entregue tal cual o lo resuma sin perder los hechos.
 */
export function explicarUltimoRecorrido(chatId, deps = {}) {
  const traza = ultimaTrazaExplicable(chatId, deps);
  if (!traza) {
    return 'No tengo registrado ningun recorrido anterior en este chat. El registro de recorridos empezo el 6 de noviembre de 2026; preguntame despues de cualquier otra peticion.';
  }
  const segundos = typeof traza.duracionMs === 'number' ? (traza.duracionMs / 1000).toFixed(1) : null;
  const partes = [];
  partes.push(`Recorrido de "${traza.mensaje}":`);
  partes.push(`- ${VIA_LLANO[traza.via] || `Enrutado: ${traza.via || 'desconocido'}`}.`);
  if (Array.isArray(traza.intenciones) && traza.intenciones.length > 0) {
    partes.push(`- Areas detectadas: ${traza.intenciones.join(', ')}.`);
  }
  partes.push(`- Herramientas candidatas ofrecidas al modelo: ${traza.herramientasOfrecidas}.`);
  if (!Array.isArray(traza.llamadas) || traza.llamadas.length === 0) {
    partes.push('- No use ninguna herramienta; respondi directamente.');
  } else {
    for (const llamada of traza.llamadas) {
      if (llamada.resultado === 'ok') {
        partes.push(`- Ronda ${llamada.ronda}: use ${llamada.nombre} y salio bien.`);
      } else if (llamada.resultado === 'duplicado_bloqueado') {
        partes.push(`- Ronda ${llamada.ronda}: bloquee un duplicado de ${llamada.nombre} para no repetir la accion.`);
      } else {
        partes.push(`- Ronda ${llamada.ronda}: intente ${llamada.nombre} y fallo (${llamada.detalle || 'sin detalle'}).`);
      }
    }
  }
  partes.push(`- Total: ${traza.rondas} ronda(s) de herramientas${segundos ? ` en ${segundos} segundos` : ''}.`);
  return partes.join('\n');
}
