/**
 * idempotencyService.js - Control de Idempotencia y Deduplicacion de Acciones
 *
 * Previene la ejecucion duplicada de operaciones con efectos secundarios
 * (gastos, eventos, compras, habitos, contactos) dentro de una ventana de tiempo
 * configurable (por defecto 10 minutos).
 *
 * Strict Policy: Zero Emojis en todo el codigo, logs y mensajes.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DATA_DIR } from '../config/paths.js';

export const IDEMPOTENCY_DEFAULT_WINDOW_MS = 10 * 60 * 1000; // 10 minutos

export const HERRAMIENTAS_CON_MUTACION = new Set([
  'registrar_gasto',
  'crear_evento',
  'anadir_compra',
  'registrar_habito',
  'marcar_habito',
  'crear_recordatorio',
  'registrar_contacto',
  'registrar_parada_favorita',
  'eliminar_parada_favorita',
  'escribir_diario'
]);

function rutaCache(deps = {}) {
  return deps.rutaArchivo || path.join(deps.dataDir || DATA_DIR, 'idempotency_cache.json');
}

/**
 * Normaliza y ordena de forma recursiva los argumentos para producir un hash consistente.
 */
export function normalizarArgumentos(args) {
  if (args === null || args === undefined) return '';
  if (typeof args !== 'object') return String(args).trim().toLowerCase();
  if (Array.isArray(args)) return args.map(normalizarArgumentos);
  const claves = Object.keys(args).sort();
  const obj = {};
  for (const k of claves) {
    obj[k] = normalizarArgumentos(args[k]);
  }
  return obj;
}

/**
 * Calcula un hash SHA256 determinista a partir de tool + args + chatId.
 */
export function calcularHashIdempotencia(tool, args = {}, chatId = 'default') {
  const normArgs = JSON.stringify(normalizarArgumentos(args));
  const fuente = `${String(tool).trim().toLowerCase()}|${String(chatId).trim()}|${normArgs}`;
  return crypto.createHash('sha256').update(fuente, 'utf-8').digest('hex');
}

/**
 * Lee el estado persistido de la cache de idempotencia.
 */
export function leerCacheIdempotencia(deps = {}) {
  const ruta = rutaCache(deps);
  try {
    if (!fs.existsSync(ruta)) return { registros: {} };
    const raw = fs.readFileSync(ruta, 'utf-8');
    const data = JSON.parse(raw);
    return { registros: data && typeof data.registros === 'object' ? data.registros : {} };
  } catch {
    return { registros: {} };
  }
}

/**
 * Guarda el estado persistido con escritura atomica.
 */
export function guardarCacheIdempotencia(cache, deps = {}) {
  const ruta = rutaCache(deps);
  fs.mkdirSync(path.dirname(ruta), { recursive: true });
  const tmp = `${ruta}.tmp.${process.pid}.${Date.now()}`;
  fs.writeFileSync(tmp, JSON.stringify(cache, null, 2), 'utf-8');
  fs.renameSync(tmp, ruta);
}

/**
 * Purga entradas expiradas segun la ventana maxima.
 */
export function purgarCacheExpirada(cache, ahora = Date.now(), maxEdadMs = IDEMPOTENCY_DEFAULT_WINDOW_MS) {
  const nuevos = {};
  for (const [clave, reg] of Object.entries(cache.registros || {})) {
    if (ahora - reg.timestamp < maxEdadMs) {
      nuevos[clave] = reg;
    }
  }
  cache.registros = nuevos;
  return cache;
}

/**
 * Verifica si una llamada de herramienta con mutacion es duplicada.
 * Si es nueva, la registra provisionalmente.
 */
export function verificarYRegistrarIdempotencia({
  tool,
  args = {},
  chatId = 'default',
  ahora = Date.now(),
  ventanaMs = IDEMPOTENCY_DEFAULT_WINDOW_MS
} = {}, deps = {}) {
  const nombreTool = String(tool || '').trim();
  if (!HERRAMIENTAS_CON_MUTACION.has(nombreTool)) {
    return { esMutante: false, duplicado: false };
  }

  const clave = calcularHashIdempotencia(nombreTool, args, chatId);
  const cache = leerCacheIdempotencia(deps);
  purgarCacheExpirada(cache, ahora, ventanaMs);

  const existente = cache.registros[clave];
  if (existente && (ahora - existente.timestamp) < ventanaMs) {
    const diffSeg = Math.round((ahora - existente.timestamp) / 1000);
    return {
      esMutante: true,
      duplicado: true,
      clave,
      transcurridoSegundos: diffSeg,
      resultadoPrevio: existente.resultado || null,
      mensaje: `La accion "${nombreTool}" ya fue ejecutada hace ${diffSeg} segundo(s) con estos mismos datos exactos. Se evita duplicar la operacion.`
    };
  }

  // Registrar nueva accion
  cache.registros[clave] = {
    tool: nombreTool,
    chatId: String(chatId),
    timestamp: ahora,
    resultado: null
  };
  guardarCacheIdempotencia(cache, deps);

  return {
    esMutante: true,
    duplicado: false,
    clave
  };
}

/**
 * Actualiza el resultado final asociado a la clave de idempotencia.
 */
export function guardarResultadoIdempotencia(clave, resultado, deps = {}) {
  if (!clave) return;
  const cache = leerCacheIdempotencia(deps);
  if (cache.registros[clave]) {
    cache.registros[clave].resultado = resultado;
    guardarCacheIdempotencia(cache, deps);
  }
}

/**
 * Limpia la cache de idempotencia (util para tests).
 */
export function limpiarCacheIdempotencia(deps = {}) {
  const ruta = rutaCache(deps);
  try {
    if (fs.existsSync(ruta)) fs.unlinkSync(ruta);
  } catch {
    // ignorar
  }
}
