/**
 * interactiveActionHandler.js - Gestor de Acciones y Botones Interactivos de WhatsApp
 *
 * Envia y procesa componentes interactivos nativos (botones de confirmacion,
 * listas de seleccion y votos) para sustituir respuestas de texto rigido ("si", "confirmo").
 *
 * Strict Policy: Zero Emojis.
 */

import { sendButtons, sendList } from '../core/interactiveService.js';
import { normalizarMarkdownWhatsApp } from './textFormatService.js';
import { confirmAndExecute } from '../system/bashConsoleService.js';
import { resolverConfirmacionBorrado, resolverCancelacionBorrado } from './destructiveActionService.js';
import { limpiarHistorial } from './conversationHistoryService.js';
import { confirmarBorrador, descartarBorrador } from './financeService.js';
import { procesarUpgradePlan } from './tenantSelfService.js';

/**
 * Envia un mensaje con dos botones de confirmacion interactivos.
 *
 * @param {object} canal - Socket Baileys o puerto de canal
 * @param {string} remoteJid - JID destinatario
 * @param {string} texto - Texto explicativo
 * @param {object} opciones
 * @returns {Promise<object>}
 */
export async function enviarConfirmacionInteractiva(canal, remoteJid, texto, {
  idConfirmar = 'btn_confirmar_generico',
  idCancelar = 'btn_cancelar_generico',
  textoConfirmar = 'Confirmar',
  textoCancelar = 'Cancelar',
  footer = 'D.A.V.I.S. Seguridad'
} = {}) {
  try {
    return await sendButtons(canal, remoteJid, {
      text: normalizarMarkdownWhatsApp(texto),
      footer,
      buttons: [
        { id: idConfirmar, text: textoConfirmar },
        { id: idCancelar, text: textoCancelar }
      ]
    });
  } catch (err) {
    console.warn('[InteractiveActionHandler] Fallo enviando botones interactivos, recurriendo a texto:', err.message);
    if (canal && typeof canal.sendMessage === 'function') {
      return await canal.sendMessage(remoteJid, {
        text: `${normalizarMarkdownWhatsApp(texto)}\n\n[Responde "${textoConfirmar}" o "${textoCancelar}"]`
      });
    }
  }
}

/**
 * Procesa la pulsacion de un boton o seleccion de lista interactiva.
 *
 * @param {object} sock - Socket Baileys
 * @param {string} remoteJid - JID del chat
 * @param {object} interactive - Objeto devuelto por parseInteractiveResponse
 * @param {object} deps
 * @returns {Promise<{ gestionado: boolean, respuesta?: string }>}
 */
export async function manejarRespuestaInteractiva(sock, remoteJid, interactive, deps = {}) {
  if (!interactive || typeof interactive !== 'object') {
    return { gestionado: false };
  }

  const btnId = interactive.id || interactive.selectedButtonId || interactive.selectedRowId || '';
  if (!btnId) {
    return { gestionado: false };
  }

  console.log(`[InteractiveActionHandler] Boton pulsado en ${remoteJid}: ID=${btnId}`);

  // 1. Confirmacion de OTP para consola Bash
  if (btnId.startsWith('btn_otp_confirm_')) {
    const otp = btnId.replace('btn_otp_confirm_', '').trim();
    const confirmFn = deps.confirmAndExecute || confirmAndExecute;
    try {
      const res = await confirmFn(otp);
      const salida = res.ok
        ? `Comando ejecutado con exito:\n\n${res.stdout || '(sin salida)'}`
        : `Fallo al ejecutar comando: ${res.error || res.stderr}`;
      await sock.sendMessage(remoteJid, { text: normalizarMarkdownWhatsApp(salida) });
      return { gestionado: true, respuesta: salida };
    } catch (errOtp) {
      const msgError = `Error verificando OTP: ${errOtp.message}`;
      await sock.sendMessage(remoteJid, { text: msgError });
      return { gestionado: true, respuesta: msgError };
    }
  }

  if (btnId === 'btn_otp_cancel') {
    const cancelMsg = 'Ejecucion de comando cancelada por el usuario.';
    await sock.sendMessage(remoteJid, { text: cancelMsg });
    return { gestionado: true, respuesta: cancelMsg };
  }

  // 2. Confirmacion de borrado destructivo de historial
  if (btnId.startsWith('btn_borrado_confirm')) {
    const borradoId = btnId.replace('btn_borrado_confirm_', '').trim();
    const textoComando = (borradoId && borradoId !== 'btn_borrado_confirm')
      ? `confirmar borrado ${borradoId}`
      : 'confirmar borrado';
    const borradoFn = deps.resolverConfirmacionBorrado || resolverConfirmacionBorrado;
    const res = borradoFn(remoteJid, textoComando);
    let textoRes;
    if (res?.confirmado) {
      if (res.tipo === 'conversacion') {
        const fnLimpiar = deps.limpiarHistorial || limpiarHistorial;
        if (typeof fnLimpiar === 'function') fnLimpiar(remoteJid, deps);
        textoRes = 'Historial de la conversacion, episodios y trazas borrados. Tus recuerdos del Second Brain siguen intactos.';
      } else {
        textoRes = res.mensaje || 'Borrado completado.';
      }
    } else {
      textoRes = res?.motivo || 'No se pudo confirmar el borrado.';
    }
    await sock.sendMessage(remoteJid, { text: normalizarMarkdownWhatsApp(textoRes) });
    return { gestionado: true, respuesta: textoRes };
  }

  if (btnId === 'btn_borrado_cancel' || btnId.startsWith('btn_borrado_cancel_')) {
    const cancelFn = deps.resolverCancelacionBorrado || resolverCancelacionBorrado;
    const res = cancelFn(remoteJid, 'cancelar borrado');
    const textoCancel = (res && res.cancelados > 0)
      ? 'Borrado cancelado; no se ha eliminado nada.'
      : 'No habia ningun borrado pendiente en este chat.';
    await sock.sendMessage(remoteJid, { text: normalizarMarkdownWhatsApp(textoCancel) });
    return { gestionado: true, respuesta: textoCancel };
  }

  // 3. Confirmacion de borrador de finanzas / ticket
  if (btnId === 'btn_gasto_confirmar') {
    const confGastoFn = deps.confirmarBorrador || confirmarBorrador;
    try {
      const res = await confGastoFn(remoteJid);
      const texto = res?.ok ? `Gasto confirmado y registrado en finanzas: ${res.gasto?.concepto} (${res.gasto?.importe} EUR)` : 'No habia ningun borrador de gasto pendiente de confirmar.';
      await sock.sendMessage(remoteJid, { text: normalizarMarkdownWhatsApp(texto) });
      return { gestionado: true, respuesta: texto };
    } catch (errG) {
      await sock.sendMessage(remoteJid, { text: `Error confirmando gasto: ${errG.message}` });
      return { gestionado: true };
    }
  }

  if (btnId === 'btn_gasto_descartar') {
    const descGastoFn = deps.descartarBorrador || descartarBorrador;
    const res = descGastoFn(remoteJid);
    const texto = res ? 'Borrador de ticket descartado.' : 'No habia borrador pendiente.';
    await sock.sendMessage(remoteJid, { text: texto });
    return { gestionado: true, respuesta: texto };
  }

  // 4. Upgrade de plan para tenants
  if (btnId.startsWith('btn_upgrade_')) {
    const plan = btnId.replace('btn_upgrade_', '').trim();
    const upgradeFn = deps.procesarUpgradePlan || procesarUpgradePlan;
    const res = upgradeFn(deps.tenantId || remoteJid, plan, deps);
    await sock.sendMessage(remoteJid, { text: normalizarMarkdownWhatsApp(res) });
    return { gestionado: true, respuesta: res };
  }

  return { gestionado: false };
}
