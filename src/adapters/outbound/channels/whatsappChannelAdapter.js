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
  const falloPreEnvio = (mensaje) => {
    const error = new Error(mensaje);
    error.esFalloPreEnvioVerificado = true;
    return error;
  };
  const enviar = (destinatario, payload, opciones) => {
    // Verificacion previa: sin sesion de WhatsApp el mensaje NO puede salir,
    // asi que este fallo si permite reintento. Todo lo que ocurra despues
    // (timeout, corte de socket, rechazo de Baileys) es resultado incierto.
    if (!sock.user) {
      return Promise.reject(falloPreEnvio('whatsapp: sin sesion abierta, el mensaje no salio'));
    }
    return sock.sendMessage(destinatario, payload, opciones);
  };
  return afirmarMessageChannel(Object.freeze({
    canal: 'whatsapp',
    enviarTexto: (destinatario, texto, opciones = {}) => enviar(destinatario, { text: texto }, opciones),
    enviarInteractivo: (destinatario, payload, opciones = {}) => enviar(destinatario, payload, opciones)
  }));
}
