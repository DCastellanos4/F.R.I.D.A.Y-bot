/**
 * groupInteractionService.js - Gestion avanzada de grupos de WhatsApp (@g.us)
 *
 * Responsabilidades:
 * - Deteccion precisa de menciones a D.A.V.I.S. (nativas via contextInfo o textuales).
 * - Generacion y envio de resumenes de conversacion bajo demanda dentro del grupo.
 * - Enrutamiento seguro de consultas al agente respondiendo dentro del hilo del grupo.
 * - Politica fail-closed: silencio estricto si el bot no es llamado expresamente.
 *
 * Strict Policy: Zero Emojis.
 */

import { recordGroupMessage, generateGroupSummary } from './groupSummarizerService.js';
import { normalizarMarkdownWhatsApp } from './textFormatService.js';

export const PATRON_MENCION_TEXTO = /@davis\b|^davis[,:\s]+/i;
export const PATRON_RESUMEN_GRUPO = /^(?:davis\s+)?(?:resume(me)?|resumen|que\s+ha\s+pasado|que\s+paso|pasa\s+un\s+resumen)(?:\s+(?:del?|en\s+el)\s+grupo)?/i;

/**
 * Determina si un mensaje entrante en un grupo va dirigido expresamente a D.A.V.I.S.
 *
 * @param {object} msg - Objeto mensaje Baileys
 * @param {string} texto - Texto extraido del mensaje
 * @param {object} [opciones]
 * @returns {boolean}
 */
export function esMensajeParaDavisEnGrupo(msg, texto = '', opciones = {}) {
  const remoteJid = msg?.key?.remoteJid;
  if (!remoteJid || !remoteJid.endsWith('@g.us')) return false;

  const t = String(texto || '').trim();
  if (!t) return false;

  // 1. Deteccion por mencion explicita textual
  if (PATRON_MENCION_TEXTO.test(t) || PATRON_RESUMEN_GRUPO.test(t)) {
    return true;
  }

  // 2. Deteccion por mencion nativa de WhatsApp (contextInfo.mentionedJid)
  const contextInfo = msg?.message?.extendedTextMessage?.contextInfo;
  const mentionedJid = Array.isArray(contextInfo?.mentionedJid) ? contextInfo.mentionedJid : [];

  const botJid = opciones.botJid || opciones.botId || '';
  if (botJid && mentionedJid.some((jid) => jid && jid.includes(botJid.split('@')[0]))) {
    return true;
  }

  // Si se menciona el nombre clave davis en cualquier parte del texto entre signos
  if (/\b@?davis\b/i.test(t)) {
    return true;
  }

  return false;
}

/**
 * Limpia el prefijo de invocacion para entregar el comando puro al agente.
 *
 * @param {string} texto
 * @returns {string}
 */
export function limpiarMencionGrupo(texto = '') {
  return String(texto || '')
    .replace(/^@davis\b[,:\s]*/i, '')
    .replace(/^davis\b[,:\s]*/i, '')
    .replace(/@davis\b/gi, '')
    .trim();
}

/**
 * Procesa un mensaje de grupo.
 *
 * @param {object} sock - Socket de Baileys
 * @param {object} msg - Mensaje Baileys
 * @param {string} texto - Texto extraido
 * @param {object} deps
 * @returns {Promise<{ gestionado: boolean, tipo?: string }>}
 */
export async function procesarMensajeGrupo(sock, msg, texto, deps = {}) {
  const remoteJid = msg?.key?.remoteJid;
  if (!remoteJid || !remoteJid.endsWith('@g.us')) {
    return { gestionado: false };
  }

  // Siempre registrar en el buffer historico para resumenes inteligentes
  try {
    const recordFn = deps.recordGroupMessage || recordGroupMessage;
    await recordFn(msg);
  } catch (errRecord) {
    console.warn('[GroupInteraction] Error registrando mensaje en buffer:', errRecord.message);
  }

  // Comprobar si va dirigido a DAVIS
  if (!esMensajeParaDavisEnGrupo(msg, texto, deps)) {
    return { gestionado: false, ignorado: true };
  }

  const remitenteJid = msg.key?.participant || remoteJid;
  const esDavid = typeof deps.esMensajeDeDavid === 'function' ? deps.esMensajeDeDavid(remitenteJid) : false;

  console.log(`[WhatsApp Grupo] Mensaje dirigido a DAVIS en ${remoteJid} de ${remitenteJid} (David: ${esDavid})`);

  // Caso: Peticion de resumen del grupo
  if (PATRON_RESUMEN_GRUPO.test(texto.trim())) {
    try {
      const summaryFn = deps.generateGroupSummary || generateGroupSummary;
      const resumen = await summaryFn(remoteJid);
      const textoFinal = resumen || 'No hay suficientes mensajes recientes registrados para generar un resumen del grupo.';
      await sock.sendMessage(remoteJid, { text: normalizarMarkdownWhatsApp(textoFinal) }, { quoted: msg });
      return { gestionado: true, tipo: 'resumen' };
    } catch (errSumm) {
      console.error('[GroupInteraction] Error generando resumen de grupo:', errSumm.message);
      await sock.sendMessage(remoteJid, { text: 'No se pudo generar el resumen del grupo en este momento.' }, { quoted: msg });
      return { gestionado: true, tipo: 'error_resumen' };
    }
  }

  // Caso: Consulta o instruccion al agente
  const textoLimpio = limpiarMencionGrupo(texto);
  if (!textoLimpio) {
    await sock.sendMessage(remoteJid, { text: 'Dime, aqui estoy. En que puedo ayudarte?' }, { quoted: msg });
    return { gestionado: true, tipo: 'saludo' };
  }

  if (typeof deps.procesarMensajeAgente === 'function') {
    try {
      const respuesta = await deps.procesarMensajeAgente(textoLimpio, {
        remoteJid,
        remitenteJid,
        esGrupo: true,
        esDavid
      });
      if (respuesta && typeof respuesta === 'string') {
        await sock.sendMessage(remoteJid, { text: normalizarMarkdownWhatsApp(respuesta) }, { quoted: msg });
        return { gestionado: true, tipo: 'agente' };
      }
    } catch (errAgente) {
      console.error('[GroupInteraction] Error procesando mensaje de grupo con agente:', errAgente.message);
      await sock.sendMessage(remoteJid, { text: 'Ha ocurrido un problema al procesar la peticion en el grupo.' }, { quoted: msg });
      return { gestionado: true, tipo: 'error_agente' };
    }
  }

  return { gestionado: false };
}
