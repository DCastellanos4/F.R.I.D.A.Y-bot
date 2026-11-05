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
  pendientes.set(id, { chatId, criterio, total, creadoEn: ahora });
  return id;
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
  return { confirmado: true, criterio: registro.criterio, total: registro.total };
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
