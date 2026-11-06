/**
 * destructiveActionService.js
 *
 * Confirmacion FUERA DEL MODELO de acciones destructivas irreversibles
 * (por ahora: borrado masivo del Second Brain).
 *
 * Igual que el OTP de bash: el LLM puede SOLICITAR la accion, pero jamas
 * confirmarla. Cuando el agente invoca olvidar_memoria con comodin, el
 * servicio registra una peticion pendiente ligada al chat exacto, al
 * criterio exacto y a un id aleatorio, con TTL de 5 minutos y consumo de un
 * solo uso. Solo un mensaje real de David en ESE chat con el formato
 * "confirmar borrado <id>" ejecuta el borrado, y lo hace whatsappBot
 * directamente, sin pasar por el LLM.
 *
 * El parametro "confirmado" del esquema de la herramienta fue eliminado a
 * proposito: un booleano suministrado por el modelo NO es aprobacion humana.
 *
 * Strict Policy: Zero Emojis.
 */

import crypto from 'crypto';

export const TTL_BORRADO_MS = 5 * 60 * 1000;

// pendientes: confirmacionId -> { chatId, criterio, total, creadoEn }
const pendientes = new Map();

function generarId() {
  return `borr_${crypto.randomBytes(3).toString('hex')}`;
}

/**
 * Registra un borrado masivo pendiente de confirmacion para un chat.
 * Devuelve el id de confirmacion que solo David puede activar.
 */
export function registrarBorradoMasivoPendiente(chatId, criterio, total, deps = {}) {
  if (!chatId || !criterio) return null;
  const ahora = typeof deps.now === 'function' ? deps.now() : Date.now();
  const id = generarId();
  pendientes.set(id, { chatId, criterio, total, tipo: 'memoria', creadoEn: ahora });
  iniciarPurgaPendientes();
  return id;
}

/**
 * Registra un borrado pendiente de los registros de conversacion de un chat
 * (historial, episodios archivados y trazas del recorrido). NO toca los
 * recuerdos del Second Brain: ese borrado tiene su propio flujo
 * (olvidar_memoria con comodin). Misma mecanica de confirmacion.
 */
export function registrarBorradoConversacionPendiente(chatId, deps = {}) {
  if (!chatId) return null;
  const ahora = typeof deps.now === 'function' ? deps.now() : Date.now();
  const id = generarId();
  pendientes.set(id, { chatId, tipo: 'conversacion', creadoEn: ahora });
  iniciarPurgaPendientes();
  return id;
}

// Peticion de borrado de la conversacion: "borra el historial",
// "borra el historial de esta conversacion", "olvida esta conversacion".
const REGEX_BORRADO_CONVERSACION = /^(borra|limpia|elimina)\s+(el\s+)?historial(\s+de\s+(esta|la|nuestra)\s+conversacion)?\s*[.!?]?$/i;
const REGEX_OLVIDA_CONVERSACION = /^(olvida|borra|elimina)\s+(esta|nuestra|la)\s+conversacion\s*[.!?]?$/i;

export function esPeticionBorradoConversacion(texto) {
  if (!texto || typeof texto !== 'string') return false;
  const limpio = texto.trim();
  return REGEX_BORRADO_CONVERSACION.test(limpio) || REGEX_OLVIDA_CONVERSACION.test(limpio);
}

const REGEX_CANCELA_BORRADO = /^cancela(?:r|me)?\s+borrado(\s+(borr_[a-f0-9]{6}))?\s*[.!?]?$/i;

/**
 * Cancelacion fuera del modelo: "cancelar borrado" (opcionalmente con id).
 * Devuelve null si el mensaje no es una cancelacion; en caso contrario,
 * cuantos pendientes de ESTE chat se cancelaron (0 si no habia).
 */
export function resolverCancelacionBorrado(chatId, texto) {
  if (!texto || typeof texto !== 'string') return null;
  const m = texto.trim().match(REGEX_CANCELA_BORRADO);
  if (!m) return null;
  let cancelados = 0;
  for (const [id, registro] of pendientes) {
    if (registro.chatId !== chatId) continue;
    if (m[2] && id !== m[2].toLowerCase()) continue;
    pendientes.delete(id);
    cancelados++;
  }
  return { cancelados };
}

/**
 * Purga los pendientes ya caducados. No cambia la semantica: el TTL sigue
 * siendo el mismo y cada confirmacion sigue siendo de un solo uso; esto solo
 * libera la memoria de entradas que nunca se resolvieron (antes quedaban
 * hasta reiniciar el bot).
 */
export function purgarPendientesExpirados(ahora = Date.now()) {
  let purgados = 0;
  for (const [id, registro] of pendientes) {
    if (ahora - registro.creadoEn > TTL_BORRADO_MS) {
      pendientes.delete(id);
      purgados++;
    }
  }
  return purgados;
}

let intervaloPurga = null;
export function iniciarPurgaPendientes(intervaloMs = TTL_BORRADO_MS) {
  if (intervaloPurga) return;
  intervaloPurga = setInterval(() => purgarPendientesExpirados(), intervaloMs);
  // unref: el barrido nunca mantiene vivo el proceso (tests, CLI, apagado).
  if (typeof intervaloPurga.unref === 'function') intervaloPurga.unref();
}
export function detenerPurgaPendientes() {
  if (intervaloPurga) {
    clearInterval(intervaloPurga);
    intervaloPurga = null;
  }
}

const REGEX_CONFIRMA_BORRADO = /^confirma(?:r|me)?\s+borrado\s+(borr_[a-f0-9]{6})\s*$/i;

/**
 * Interpreta un mensaje entrante como posible confirmacion de borrado.
 * Devuelve:
 *  - { confirmado: true, criterio, total } si el id existe, pertenece a ESTE
 *    chat y no ha caducado (el registro se consume: un solo uso).
 *  - { confirmado: false, motivo } si el formato era de confirmacion pero el
 *    id no es valido, es de otro chat o caduco.
 *  - null si el mensaje no tiene formato de confirmacion de borrado.
 */
export function resolverConfirmacionBorrado(chatId, texto, deps = {}) {
  if (!texto || typeof texto !== 'string') return null;
  const m = texto.trim().match(REGEX_CONFIRMA_BORRADO);
  if (!m) return null;

  const id = m[1].toLowerCase();
  const registro = pendientes.get(id);
  if (!registro) {
    return { confirmado: false, motivo: 'No hay ningun borrado pendiente con ese identificador o ya fue consumido.' };
  }

  const ahora = typeof deps.now === 'function' ? deps.now() : Date.now();
  if (ahora - registro.creadoEn > TTL_BORRADO_MS) {
    pendientes.delete(id);
    return { confirmado: false, motivo: 'La peticion de borrado ha caducado. Vuelve a solicitarla.' };
  }

  if (registro.chatId !== chatId) {
    // No revelar a otros chats que el id existe
    return { confirmado: false, motivo: 'No hay ningun borrado pendiente con ese identificador o ya fue consumido.' };
  }

  // Consumo de un solo uso
  pendientes.delete(id);
  return { confirmado: true, criterio: registro.criterio, total: registro.total, tipo: registro.tipo || 'memoria' };
}

export function hayBorradoPendiente(chatId) {
  for (const reg of pendientes.values()) {
    if (reg.chatId === chatId) return true;
  }
  return false;
}

export function limpiarBorradosPendientes() {
  pendientes.clear();
}
