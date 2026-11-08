/**
 * Adaptador de entrada: WhatsApp (Baileys) -> InboundMessage.
 *
 * Unico sitio donde el formato nativo de Baileys se traduce al contrato
 * del core. Conectar otro canal (Telegram, widget web...) es anadir un
 * archivo como este, sin tocar el cerebro del bot.
 *
 * Strict Policy: Zero Emojis.
 */
import { crearInboundMessage } from '../../../ports/inbound/InboundMessage.js';

/**
 * @param {Object} params
 * @param {Object} [params.msg]       Mensaje nativo de Baileys (para id y fecha).
 * @param {string} params.texto       Texto ya extraido por la capa de canal
 *                                    (incluye transcripciones de audio si aplica).
 * @param {string} params.remoteJid   Chat de origen (usuario o grupo).
 */
export function crearInboundDesdeWhatsApp({ msg = null, texto, remoteJid } = {}) {
  const segundos = Number(msg?.messageTimestamp);
  return crearInboundMessage({
    userId: remoteJid,
    text: texto,
    channel: 'whatsapp',
    messageId: msg?.key?.id ?? null,
    timestamp: Number.isFinite(segundos) && segundos > 0 ? new Date(segundos * 1000) : new Date(),
    metadata: {
      fromMe: Boolean(msg?.key?.fromMe),
      pushName: msg?.pushName ?? null,
      isGroup: typeof remoteJid === 'string' ? remoteJid.endsWith('@g.us') : false
    }
  });
}
