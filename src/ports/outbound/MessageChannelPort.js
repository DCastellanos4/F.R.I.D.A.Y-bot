/**
 * Puerto de salida: canal de mensajeria hacia el usuario.
 *
 * El flujo del bot envia las respuestas a traves de esta interfaz; el
 * formato de cada canal (markdown de WhatsApp con un asterisco, HTML de
 * Telegram...) lo normaliza el adaptador de ese canal, no el core.
 *
 * Clases de fallo de envio (RF-01, entrega al menos una vez):
 *  - Fallo PRE-ENVIO VERIFICADO: el adaptador garantiza que el mensaje no
 *    salio hacia el proveedor (sesion inexistente, validacion local, socket
 *    cerrado antes de escribir). El error DEBE llevar
 *    `error.esFalloPreEnvioVerificado === true` y solo ese fallo permite
 *    reintento automatico.
 *  - Cualquier otro rechazo (timeout, desconexion a mitad de escritura,
 *    rechazo del SDK tras intentar el envio) NO prueba que el proveedor no
 *    lo recibiera: el resultado es INCIERTO y no se reintenta a ciegas.
 *
 * Strict Policy: Zero Emojis.
 */

/**
 * @typedef {Object} MessageChannelPort
 * @property {string} canal  Nombre del canal en minusculas ('whatsapp', ...).
 * @property {(destinatario: string, texto: string, opciones?: Object) => Promise<any>}
 *   enviarTexto  Envia un mensaje de texto ya normalizado para el canal.
 * @property {(destinatario: string, payload: Object, opciones?: Object) => Promise<any>}
 *   [enviarInteractivo]  Opcional: envia un payload rico nativo del canal
 *   (botones, listas, encuestas, tarjetas). Solo lo implementan canales
 *   que soportan mensajes interactivos.
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
