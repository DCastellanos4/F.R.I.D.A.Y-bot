/**
 * Puerto de entrada del hexagono: mensaje normalizado de cualquier canal.
 *
 * El core del agente (agente, memoria, router, reglas de negocio) solo
 * conoce esta forma. No sabe si el mensaje llego por WhatsApp (Baileys),
 * Telegram, un widget web o una CLI: cada canal traduce su formato nativo
 * a InboundMessage en su propio adaptador de entrada y el cerebro no se
 * toca.
 *
 * Contrato minimo pedido: { userId, text, channel }.
 * Strict Policy: Zero Emojis.
 */

/**
 * @typedef {Object} InboundMessage
 * @property {string} userId   Identificador estable del chat/usuario en el canal
 *                             (remoteJid en WhatsApp, chat_id en Telegram...).
 * @property {string} text     Texto del mensaje, ya extraido del formato nativo.
 * @property {string} channel  Canal de origen en minusculas: 'whatsapp',
 *                             'telegram', 'web', 'slack', 'cli'...
 * @property {string|null} messageId  Id del mensaje en el canal, si existe.
 * @property {Date} timestamp  Momento de recepcion.
 * @property {Object} metadata Datos extra del canal (pushName, fromMe, ...).
 */

/**
 * Construye un InboundMessage validado e inmutable.
 * Lanza TypeError si el contrato minimo no se cumple: un mensaje sin
 * userId, text o channel no puede entrar al core.
 */
export function crearInboundMessage({ userId, text, channel, messageId = null, timestamp = null, metadata = {} } = {}) {
  if (typeof userId !== 'string' || !userId.trim()) {
    throw new TypeError('InboundMessage: userId (string no vacio) es obligatorio.');
  }
  if (typeof text !== 'string') {
    throw new TypeError('InboundMessage: text debe ser un string (puede estar vacio).');
  }
  if (typeof channel !== 'string' || !channel.trim()) {
    throw new TypeError('InboundMessage: channel (string no vacio) es obligatorio.');
  }
  return Object.freeze({
    userId: userId.trim(),
    text,
    channel: channel.trim().toLowerCase(),
    messageId: messageId ?? null,
    timestamp: timestamp instanceof Date ? timestamp : new Date(),
    metadata: metadata && typeof metadata === 'object' ? { ...metadata } : {}
  });
}
