import { config } from './config.js';

let vipModeEnabled = true;
const vipContacts = new Set();

/**
 * Normaliza un JID o numero telefonico a formato estandar
 */
function normalizeJid(jid) {
  if (!jid || typeof jid !== 'string') return '';
  return jid.trim().toLowerCase();
}

/**
 * Normaliza texto eliminando diacriticos y convirtiendo a minusculas
 */
function normalizeText(text) {
  if (!text || typeof text !== 'string') return '';
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

/**
 * Determina si un JID corresponde a David
 */
export function isDavid(jid) {
  if (!jid || typeof jid !== 'string') return false;
  const clean = normalizeJid(jid);

  const phone = (config && config.userPhone) ? String(config.userPhone).trim() : '34635605605';
  const lid = (config && config.userLid) ? String(config.userLid).trim() : '149868706304033';

  if (phone && clean.includes(phone)) return true;
  if (lid && clean.includes(lid)) return true;
  if (clean.startsWith('34635605605')) return true;
  if (clean.startsWith('149868706304033')) return true;

  return false;
}

/**
 * Lista de patrones de palabras y frases de emergencia
 */
const EMERGENCY_PATTERNS = [
  /\burgente(s|mente)?\b/i,
  /\burgencia(s)?\b/i,
  /\bemergencia(s)?\b/i,
  /\bcritico(s)?\b/i,
  /\bcritica(s)?\b/i,
  /\bsocorro\b/i,
  /\bauxilio\b/i,
  /\bpeligro(so)?\b/i,
  /\baccidente\b/i,
  /\bhospital\b/i,
  /\bambulancia\b/i,
  /\bincendio\b/i,
  /\bgravisimo(s)?\b/i,
  /\bs\.?o\.?s\.?\b/i,
  /\bfallo critico\b/i,
  /\bcaida critica\b/i
];

/**
 * Comprueba si un texto contiene palabras clave de emergencia
 */
export function isEmergencyMessage(text) {
  if (!text || typeof text !== 'string') return false;
  const normalized = normalizeText(text);
  if (!normalized) return false;

  return EMERGENCY_PATTERNS.some(pattern => pattern.test(normalized));
}

/**
 * Mensaje de autorrespuesta formal y sobrio
 */
const SOBER_AUTO_REPLY = 'David no se encuentra disponible en este momento y su canal de comunicacion esta restringido por el Modo Filtro VIP. Si se trata de un asunto critico o de extrema necesidad, responda incluyendo la palabra URGENTE o EMERGENCIA para evaluar la notificacion inmediata. De lo contrario, su mensaje sera atendido tan pronto como sea posible.';

/**
 * Devuelve el texto formal de autorrespuesta
 */
export function getAutoReplyText() {
  return SOBER_AUTO_REPLY;
}

/**
 * Configura el estado del Modo Filtro VIP / No Molestar
 */
export function setVipMode(enabled) {
  vipModeEnabled = Boolean(enabled);
  return vipModeEnabled;
}

/**
 * Consulta si el Modo Filtro VIP esta activo
 */
export function isVipModeActive() {
  return vipModeEnabled;
}

/**
 * Consulta si el Modo Filtro VIP esta activo (alias)
 */
export function isVipModeEnabled() {
  return vipModeEnabled;
}

/**
 * Alterna el estado del Modo Filtro VIP
 */
export function toggleVipMode() {
  vipModeEnabled = !vipModeEnabled;
  return vipModeEnabled;
}

/**
 * Anade un contacto a la lista blanca VIP
 */
export function addVipContact(jid) {
  if (!jid || typeof jid !== 'string') return false;
  vipContacts.add(normalizeJid(jid));
  const rawDigits = jid.replace(/\D/g, '');
  if (rawDigits.length >= 7) {
    vipContacts.add(rawDigits);
  }
  return true;
}

/**
 * Elimina un contacto de la lista blanca VIP
 */
export function removeVipContact(jid) {
  if (!jid || typeof jid !== 'string') return false;
  const norm = normalizeJid(jid);
  const deleted = vipContacts.delete(norm);
  const rawDigits = jid.replace(/\D/g, '');
  if (rawDigits) {
    vipContacts.delete(rawDigits);
  }
  return deleted;
}

/**
 * Obtiene la lista de contactos VIP autorizados
 */
export function getVipContacts() {
  return Array.from(vipContacts);
}

/**
 * Comprueba si un contacto esta en la lista blanca VIP
 */
export function isVipContact(jid) {
  if (!jid || typeof jid !== 'string') return false;
  const norm = normalizeJid(jid);
  if (vipContacts.has(norm)) return true;
  const rawDigits = jid.replace(/\D/g, '');
  if (rawDigits && vipContacts.has(rawDigits)) return true;
  return false;
}

/**
 * Restablece la configuracion del filtro VIP a su estado inicial
 */
export function resetVipFilter() {
  vipModeEnabled = true;
  vipContacts.clear();
}

/**
 * Evalua si un mensaje entrante debe ser filtrado o permitido
 *
 * @param {string} jid - JID del chat remoto
 * @param {string} [participantJid] - JID del participante en grupos (@g.us)
 * @param {string} [text] - Contenido textual del mensaje
 * @param {boolean} [isEmergencyWord] - Flag explicito de bypass de emergencia
 * @returns {{ allowed: boolean, autoReplyText: string | null, isEmergency?: boolean }}
 */
export function shouldFilterMessage(jid, participantJid, text, isEmergencyWord = false) {
  // Manejo de flexibilidad si los argumentos vienen desplazados (jid, text, isEmergencyWord)
  if (typeof participantJid === 'string' && text === undefined && !participantJid.includes('@') && !/^\d{7,16}$/.test(participantJid)) {
    text = participantJid;
    participantJid = undefined;
  }

  // 1. David siempre tiene acceso directo irrestricto sin autorrespuesta
  if (isDavid(jid) || (participantJid && isDavid(participantJid))) {
    return {
      allowed: true,
      autoReplyText: null
    };
  }

  // 2. Si el modo VIP / DND esta desactivado, permitir todo
  if (!vipModeEnabled) {
    return {
      allowed: true,
      autoReplyText: null
    };
  }

  // 3. Comprobar si el remitente esta en la lista blanca VIP autorizada
  const senderJid = (jid && jid.endsWith('@g.us') && participantJid) ? participantJid : jid;
  if (senderJid && isVipContact(senderJid)) {
    return {
      allowed: true,
      autoReplyText: null
    };
  }

  // 4. Comprobar si el mensaje contiene palabras clave de emergencia o flag activo
  const emergencyDetected = isEmergencyWord === true || isEmergencyMessage(text);
  if (emergencyDetected) {
    return {
      allowed: true,
      autoReplyText: null,
      isEmergency: true
    };
  }

  // 5. Mensaje bloqueado por Modo VIP
  // Si es un grupo (@g.us), se filtra sin enviar autorrespuesta para evitar saturar el canal grupal
  if (jid && jid.endsWith('@g.us')) {
    return {
      allowed: false,
      autoReplyText: null
    };
  }

  // En conversaciones individuales externas, emitir autorrespuesta formal y sobria
  return {
    allowed: false,
    autoReplyText: SOBER_AUTO_REPLY
  };
}

export default {
  shouldFilterMessage,
  setVipMode,
  isVipModeActive,
  isVipModeEnabled,
  toggleVipMode,
  addVipContact,
  removeVipContact,
  getVipContacts,
  isVipContact,
  isEmergencyMessage,
  getAutoReplyText,
  resetVipFilter,
  isDavid
};
