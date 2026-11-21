/**
 * Formato de texto saliente para WhatsApp.
 * WhatsApp interpreta *negrita* con UN asterisco; el modelo suele emitir
 * **doble** (markdown), que el usuario veria literal. Se normaliza aqui.
 */
export function normalizarMarkdownWhatsApp(texto) {
  if (typeof texto !== 'string') return texto;
  return texto.replace(/\*\*([^*]+)\*\*/g, '*$1*');
}

/**
 * Limpia el texto para sintesis de voz natural en Edge-TTS.
 * Elimina marcas markdown, bloques de codigo, tablas, asteriscos, corchetes, vinetas y URLs crudas.
 *
 * @param {string} texto
 * @returns {string}
 */
export function limpiarTextoParaVoz(texto) {
  if (typeof texto !== 'string') return '';
  return texto
    .replace(/```[\s\S]*?```/g, ' [bloque de codigo omitido] ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/_([^_]+)_/g, '$1')
    .replace(/~([^~]+)~/g, '$1')
    .replace(/^#+\s+/gm, '')
    .replace(/^[-*+]\s+/gm, '')
    .replace(/^\d+\.\s+/gm, '')
    .replace(/https?:\/\/\S+/gi, 'enlace web')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\|/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

