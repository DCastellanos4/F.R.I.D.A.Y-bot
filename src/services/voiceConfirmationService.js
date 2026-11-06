/**
 * voiceConfirmationService.js
 *
 * Confirmacion de acciones criticas dictadas por voz.
 *
 * La transcripcion automatica puede equivocarse, asi que cuando una nota de
 * voz pide una accion con efectos externos o destructivos (enviar mensajes a
 * terceros, borrar memoria, cancelaciones masivas o comandos de terminal), el
 * bot no actua directamente: repite lo que ha entendido y espera un "si"
 * explicito de David antes de ejecutarla. La confirmacion caduca a los 5
 * minutos. Estado aislado por chat.
 *
 * Strict Policy: Zero Emojis.
 */

export const TTL_CONFIRMACION_MS = 5 * 60 * 1000;

const pendientes = new Map(); // chatId -> { texto, creadoEn }

/**
 * Detecta si un texto transcrito de voz pide una accion critica que requiere
 * confirmacion previa.
 */
export function esAccionCriticaPorVoz(texto) {
  if (!texto || typeof texto !== 'string') return false;
  const t = texto.toLowerCase();

  const envioMensajes = /(envia|manda|escribe|programa|mandale|enviale|escribele)\b[\s\S]{0,40}\b(mensaje|whatsapp|correo|sms)\b/.test(t) ||
    /\b(mensaje|whatsapp)\b[\s\S]{0,40}\b(a|para)\s+(\+?\d{6,}|[a-záéíóú]+)/i.test(texto);
  const borradoMemoria = /\b(olvida|olvidar|borra|borrar|elimina|eliminar)\b[\s\S]{0,40}\b(memoria|recuerdo|recuerdos|todo|todos|todas|clave|contrasena|password|pin)\b/.test(t);
  const cancelacionMasiva = /\bcancela(r)?\b[\s\S]{0,30}\b(todo|todos|todas)\b/.test(t);
  const comandosTerminal = /\b(ejecuta|ejecutar|lanza|lanzar|corre)\b[\s\S]{0,30}\b(comando|bash|terminal|consola|shell|script)\b/.test(t);
  // Aprobar o rechazar una skill activa/descarta un procedimiento: por voz
  // exige confirmacion como cualquier otra accion critica.
  const aprobacionSkill = /\b(aprobar|aprueba|rechazar|rechaza|confirmar)\b[\s\S]{0,20}\bskill\b/.test(t);

  return envioMensajes || borradoMemoria || cancelacionMasiva || comandosTerminal || aprobacionSkill;
}

/**
 * Registra una accion pendiente de confirmacion para un chat.
 */
export function guardarPendienteVoz(chatId, texto, deps = {}) {
  if (!chatId || !texto) return false;
  const ahora = typeof deps.now === 'function' ? deps.now() : Date.now();
  pendientes.set(chatId, { texto, creadoEn: ahora });
  iniciarPurgaPendientes();
  return true;
}

/**
 * Purga los pendientes ya caducados. No cambia la semantica: el TTL sigue
 * siendo el mismo y cada confirmacion sigue siendo de un solo uso; esto solo
 * libera la memoria de entradas que nunca se resolvieron (antes quedaban
 * hasta reiniciar el bot).
 */
export function purgarPendientesExpirados(ahora = Date.now()) {
  let purgados = 0;
  for (const [chatId, registro] of pendientes) {
    if (ahora - registro.creadoEn > TTL_CONFIRMACION_MS) {
      pendientes.delete(chatId);
      purgados++;
    }
  }
  return purgados;
}

let intervaloPurga = null;
export function iniciarPurgaPendientes(intervaloMs = TTL_CONFIRMACION_MS) {
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

/**
 * Devuelve la accion pendiente del chat si sigue vigente (y la descarta si
 * caduco).
 */
export function obtenerPendienteVoz(chatId, deps = {}) {
  const registro = pendientes.get(chatId);
  if (!registro) return null;
  const ahora = typeof deps.now === 'function' ? deps.now() : Date.now();
  if (ahora - registro.creadoEn > TTL_CONFIRMACION_MS) {
    pendientes.delete(chatId);
    return null;
  }
  return registro;
}

export function descartarPendienteVoz(chatId) {
  return pendientes.delete(chatId);
}

const REGEX_CONFIRMA = /^(si|sí|vale|confirmo|confirmar|adelante|dale|ejecuta|hazlo|correcto|afirmativo)[.!\s]*$/i;
const REGEX_CANCELA = /^(no|cancela|cancelar|negativo|olvidalo|olvídalo|para|dejalo|déjalo)[.!\s]*$/i;

/**
 * Interpreta la respuesta de David ante una accion pendiente:
 * 'confirmado' | 'cancelado' | 'nuevo' (otro mensaje: descarta lo pendiente)
 * | null (no habia nada pendiente).
 */
export function resolverConfirmacionVoz(chatId, texto, deps = {}) {
  const pendiente = obtenerPendienteVoz(chatId, deps);
  if (!pendiente) return null;

  if (REGEX_CONFIRMA.test(texto.trim())) {
    pendientes.delete(chatId);
    return { resultado: 'confirmado', textoOriginal: pendiente.texto };
  }
  if (REGEX_CANCELA.test(texto.trim())) {
    pendientes.delete(chatId);
    return { resultado: 'cancelado', textoOriginal: pendiente.texto };
  }

  // Cualquier otro mensaje sustituye a la peticion pendiente.
  pendientes.delete(chatId);
  return { resultado: 'nuevo', textoOriginal: pendiente.texto };
}

/**
 * Limpia todo el estado (pruebas).
 */
export function limpiarPendientesVoz() {
  pendientes.clear();
}
