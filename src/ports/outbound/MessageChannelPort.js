/**
 * Puerto de salida: canal de mensajeria hacia el usuario.
 *
 * El flujo del bot envia las respuestas a traves de esta interfaz; el
 * formato de cada canal (markdown de WhatsApp con un asterisco, HTML de
 * Telegram...) lo normaliza el adaptador de ese canal, no el core.
 *
 * Strict Policy: Zero Emojis.
 */

/**
 * @typedef {Object} MessageChannelPort
 * @property {string} canal  Nombre del canal en minusculas ('whatsapp', ...).
 * @property {(destinatario: string, texto: string, opciones?: Object) => Promise<any>}
 *   enviarTexto  Envia un mensaje de texto ya normalizado para el canal.
 */

/**
 * Verifica que un objeto cumple el puerto. Lanza TypeError si falta algo.
 */
export function afirmarMessageChannel(canal) {
  if (!canal || typeof canal !== 'object') {
    throw new TypeError('MessageChannelPort: se esperaba un objeto canal.');
  }
  if (typeof canal.enviarTexto !== 'function') {
    throw new TypeError('MessageChannelPort: enviarTexto (funcion) es obligatorio.');
  }
  return canal;
}
