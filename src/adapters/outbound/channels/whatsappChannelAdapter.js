/**
 * Adaptador de salida: MessageChannelPort sobre el socket de Baileys.
 *
 * Envuelve sock.sendMessage para que el envio de respuestas pase por el
 * puerto de canal. La normalizacion de formato propia de WhatsApp
 * (negritas de un asterisco, etc.) se queda en la capa de canal, no en
 * el core.
 *
 * Strict Policy: Zero Emojis.
 */
import { afirmarMessageChannel } from '../../../ports/outbound/MessageChannelPort.js';

export function crearWhatsAppChannelAdapter(sock) {
  if (!sock || typeof sock.sendMessage !== 'function') {
    throw new TypeError('whatsappChannelAdapter: se necesita un sock con sendMessage.');
  }
  return afirmarMessageChannel(Object.freeze({
    canal: 'whatsapp',
    enviarTexto: (destinatario, texto, opciones = {}) =>
      sock.sendMessage(destinatario, { text: texto }, opciones)
  }));
}
