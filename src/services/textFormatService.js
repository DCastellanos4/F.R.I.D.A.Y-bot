/**
 * Formato de texto saliente para WhatsApp.
 * WhatsApp interpreta *negrita* con UN asterisco; el modelo suele emitir
 * **doble** (markdown), que el usuario veria literal. Se normaliza aqui.
 */
export function normalizarMarkdownWhatsApp(texto) {
  if (typeof texto !== 'string') return texto;
  return texto.replace(/\*\*([^*]+)\*\*/g, '*$1*');
}
