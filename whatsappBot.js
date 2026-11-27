import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion
} from '@whiskeysockets/baileys';
import pino from 'pino';
import qrcode from 'qrcode-terminal';
import path from 'path';
import fs from 'fs';
import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';

import { config } from './src/config/config.js';
import { DATA_DIR } from './src/config/paths.js';
// El bot (capa de canal) ya no importa el cerebro: traduce cada mensaje de
// Baileys al puerto de entrada InboundMessage y lo entrega al procesador
// compuesto en la raiz de composicion, que inyecta los puertos de salida.
import { procesarMensajeEntrante, crearPuenteWhatsAppTenantsCompuesto, contenedorCompartido } from './src/composition/container.js';
import { chatCompletion as chatCompletionPorDefecto } from './src/core/llmService.js';
import { crearInboundDesdeWhatsApp } from './src/adapters/inbound/whatsapp/whatsappInboundAdapter.js';
import {
  resolverAvisoSaludClasificador as resolverAvisoSaludClasificadorCore,
  drenarColaAlertas as drenarColaAlertasCore,
  iniciarWatchdogDocker,
  ejecutarWatchdogsSector2,
  inicializarServiciosProactivos as inicializarServiciosProactivosCore
} from './src/adapters/inbound/whatsapp/proactiveMonitors.js';
import { procesarMediaEntrante } from './src/adapters/inbound/whatsapp/mediaProcessor.js';
import { crearWhatsAppChannelAdapter } from './src/adapters/outbound/channels/whatsappChannelAdapter.js';
import { normalizarMarkdownWhatsApp, limpiarTextoParaVoz } from './src/services/textFormatService.js';
import { procesarMensajeGrupo } from './src/services/groupInteractionService.js';
import { manejarRespuestaInteractiva, enviarConfirmacionInteractiva } from './src/services/interactiveActionHandler.js';
import { confirmAndExecute } from './src/system/bashConsoleService.js';
import { procesarActualizacionEntrega } from './src/services/scheduledMessageService.js';
import { obtenerHistorial, registrarIntercambio, programarCondensacionSiNecesario, limpiarHistorial } from './src/services/conversationHistoryService.js';
import { iniciarObservabilidad } from './src/observability/telemetry.js';
import { esAccionCriticaPorVoz, guardarPendienteVoz, resolverConfirmacionVoz } from './src/services/voiceConfirmationService.js';
import { resolverConfirmacionBorrado, resolverCancelacionBorrado, registrarBorradoConversacionPendiente, esPeticionBorradoConversacion } from './src/services/destructiveActionService.js';
import { resolverConfirmacionSkill } from './src/services/skillsService.js';
import { olvidarMemoria, normalizarTexto } from './src/services/memoryService.js';
import { registrarEventoMetrica } from './src/services/opsService.js';
import { borradorPendiente, confirmarBorrador, descartarBorrador, interpretarRespuestaBorrador } from './src/services/financeService.js';
import { estadoTraductor, desactivarTraductor, traducir } from './src/services/translatorModeService.js';
import { estadoEntrevista, responderEntrevista, terminarEntrevista } from './src/services/interviewService.js';
import { mensajeErrorParaUsuario } from './src/services/errorSanitizerService.js';
import { capturarPantallaWeb } from './src/services/browserService.js';

function handleOutreachLeadReply(remitenteLimpio, textoExterno) {
  const outreachDbPath = process.env.OUTREACH_DB_PATH || '/home/ubuntu/madrid-lead-outreach/data/outreach.db';
  if (!fs.existsSync(outreachDbPath)) return null;
  let odb;
  try {
    odb = new Database(outreachDbPath);
    const digits = String(remitenteLimpio || '').replace(/\D/g, '');
    const national = digits.startsWith('34') && digits.length === 11 ? digits.slice(2) : digits;
    const lead = odb.prepare(`
      SELECT id, name, city, status FROM leads
      WHERE phone_normalized = ? OR phone_normalized = ? OR REPLACE(REPLACE(COALESCE(phone, ''), ' ', ''), '+34', '') = ?
      LIMIT 1
    `).get(digits, '34' + national, national);
    if (!lead) return null;

    const norm = String(textoExterno || '').trim().toLowerCase();
    const isOptOut = /^\s*(no|no gracias|no me interesa|no nos interesa|baja|stop|dejad de escribir|no contactar)\b/i.test(norm) && norm.length < 80;
    const cols = odb.prepare('PRAGMA table_info(leads)').all().map(c => c.name);
    const hasReplyCols = cols.includes('reply_snippet') && cols.includes('opted_out_at');

    if (isOptOut) {
      if (hasReplyCols) {
        odb.prepare(`
          UPDATE leads SET status = 'opted_out', opted_out_at = CURRENT_TIMESTAMP, opt_out_reason = 'whatsapp_reply',
          reply_channel = 'whatsapp', reply_snippet = ?, replied_at = CURRENT_TIMESTAMP, next_followup_at = NULL WHERE id = ?
        `).run(String(textoExterno).slice(0, 300), lead.id);
      } else {
        odb.prepare("UPDATE leads SET status = 'opted_out' WHERE id = ?").run(lead.id);
      }
      return { matched: true, isOptOut: true, lead };
    }

    if (hasReplyCols) {
      odb.prepare(`
        UPDATE leads SET status = 'replied', reply_channel = 'whatsapp', reply_snippet = ?,
        replied_at = CURRENT_TIMESTAMP, next_followup_at = NULL WHERE id = ?
      `).run(String(textoExterno).slice(0, 300), lead.id);
    } else {
      odb.prepare("UPDATE leads SET status = 'replied' WHERE id = ?").run(lead.id);
    }
    return { matched: true, isOptOut: false, lead };
  } catch (err) {
    console.error('[Outreach] Error comprobando lead en whatsappBot:', err.message);
    return null;
  } finally {
    try { odb?.close(); } catch {}
  }
}

import { isVipModeActive, shouldFilterMessage } from './src/services/vipFilterService.js';
import { recordGroupMessage, generateGroupSummary, isDavidMentioned } from './src/services/groupSummarizerService.js';
import { isPersonalNote, savePersonalNote } from './src/services/notesService.js';
import { isMediaUrl, downloadMedia, sendMediaMessage } from './src/services/mediaDownloaderService.js';
import { synthesizeSpeech, sendVoiceNote } from './src/services/ttsService.js';
import { parseInteractiveResponse, parsePollVote } from './src/core/interactiveService.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// La sesion vive bajo DATA_DIR (respeta DAVIS_DATA_DIR en tests/CI/deploy;
// en produccion es el mismo <repo>/data enlazado al estado compartido).
const CARPETA_AUTH = path.join(DATA_DIR, 'auth_info_baileys');
const RUTA_IMAGEN_CACHIMBA = path.join(__dirname, 'assets', 'tony_cachimba.png');

if (!fs.existsSync(CARPETA_AUTH)) {
  fs.mkdirSync(CARPETA_AUTH, { recursive: true });
}

// Configuración de Identidades Telefónicas (desde .env):
const NUMERO_DAVID_AUTORIZADO = config.userPhone;
const NUMERO_BOT_SIMYO = config.botPhone;
const LID_DAVID_CONOCIDO = config.userLid;

// JID dinámico activo de David (LID o número canónico)
let jidDavidActivo = `${LID_DAVID_CONOCIDO}@lid`;

/**
 * Valida si el mensaje entrante procede exclusivamente de David
 */
function esMensajeDeDavid(jid) {
  if (!jid) return false;

  if (NUMERO_DAVID_AUTORIZADO && jid.includes(NUMERO_DAVID_AUTORIZADO)) return true;
  if (LID_DAVID_CONOCIDO && jid.includes(LID_DAVID_CONOCIDO)) return true;

  try {
    const rawId = jid.split('@')[0].split(':')[0];
    const archivoMapeo = path.join(CARPETA_AUTH, `lid-mapping-${rawId}_reverse.json`);
    if (fs.existsSync(archivoMapeo)) {
      const mapeado = JSON.parse(fs.readFileSync(archivoMapeo, 'utf-8'));
      if (typeof mapeado === 'string' && NUMERO_DAVID_AUTORIZADO && mapeado.includes(NUMERO_DAVID_AUTORIZADO)) {
        return true;
      }
    }
  } catch (err) {}

  return false;
}

// Preparado pero inerte: el puente aplica ambos gates antes de resolver datos.
const puenteWhatsAppTenants = crearPuenteWhatsAppTenantsCompuesto({ esPropietario: esMensajeDeDavid });

/**
 * Extrae texto desempaquetando cualquier estructura de mensaje de Baileys
 */
function extraerTextoMensaje(msg) {
  let m = msg.message;
  if (!m) return null;

  if (m.ephemeralMessage) m = m.ephemeralMessage.message;
  if (m.viewOnceMessage) m = m.viewOnceMessage.message;
  if (m.viewOnceMessageV2) m = m.viewOnceMessageV2.message;
  if (m.documentWithCaptionMessage) m = m.documentWithCaptionMessage.message;

  if (m.conversation) return m.conversation.trim();
  if (m.extendedTextMessage?.text) return m.extendedTextMessage.text.trim();
  if (m.imageMessage?.caption) return m.imageMessage.caption.trim();
  if (m.videoMessage?.caption) return m.videoMessage.caption.trim();
  if (m.documentMessage?.caption) return m.documentMessage.caption.trim();
  return null;
}

/**
 * Detecta solicitudes de David para poner más tabaco a la cachimba (Easter Egg Iron Man)
 */
export function esPeticionCachimba(texto) {
  if (!texto) return false;
  const t = normalizarTexto(texto);

  if (/^(recuerda|recuerdame|acuerdate|avisame|pon un recordatorio)/.test(t)) {
    return false;
  }

  const patrones = [
    /(pon|ponle|echa|echale|mete|metele|anade|anadele|recarga|recargale|mas)\s+(mas\s+)?tabaco.*(cachimba|shisha|hookah|cazoleta)/,
    /(cachimba|shisha|hookah|cazoleta).*(pon|ponle|echa|echale|mete|metele|anade|anadele|mas)\s+tabaco/,
    /(pon|ponle|echa|echale)\s+mas\s+tabaco/,
    /mas\s+tabaco\s+(a\s+la|en\s+la)?\s*(cachimba|shisha|hookah|cazoleta)/,
    /tabaco\s+(a\s+la|en\s+la)\s*(cachimba|shisha|hookah|cazoleta)/,
    /cachimba.*tabaco/,
    /tabaco.*cachimba/
  ];

  return patrones.some(p => p.test(t));
}

let sock = null;
let estaConectado = false;

const activeTypingMap = new Map();

export function iniciarEscribiendo(socketInstancia, remoteJid, maxDuracionMs = 90000) {
  detenerEscribiendo(socketInstancia, remoteJid);
  const s = socketInstancia || sock;
  if (s && typeof s.sendPresenceUpdate === 'function') {
    s.sendPresenceUpdate('composing', remoteJid).catch(() => {});
    const interval = setInterval(() => {
      s.sendPresenceUpdate('composing', remoteJid).catch(() => {});
    }, 4000);
    const timeout = setTimeout(() => {
      detenerEscribiendo(s, remoteJid);
    }, maxDuracionMs);
    activeTypingMap.set(remoteJid, { interval, timeout });
  }
}

export function detenerEscribiendo(socketInstancia, remoteJid) {
  const activo = activeTypingMap.get(remoteJid);
  if (activo) {
    clearInterval(activo.interval);
    clearTimeout(activo.timeout);
    activeTypingMap.delete(remoteJid);
  }
  const s = socketInstancia || sock;
  if (s && typeof s.sendPresenceUpdate === 'function') {
    s.sendPresenceUpdate('paused', remoteJid).catch(() => {});
  }
}

/**
 * Resuelve el destino del aviso de salud del clasificador.
 */
export function resolverAvisoSaludClasificador(deps = {}, enviarFn = enviarMensajeADavid) {
  return resolverAvisoSaludClasificadorCore(deps, enviarFn);
}

export async function enviarMensajeADavid(contenido) {
  if (!sock || !estaConectado) {
    console.warn('[WhatsApp] Intento de envío proactivo pero el cliente no está en línea.');
    return false;
  }
  const payload = typeof contenido === 'string' ? { text: contenido } : contenido;
  try {
    await sock.sendMessage(jidDavidActivo, payload);
    console.log(`[WhatsApp Alerta Enviada a David] Destino: ${jidDavidActivo}`);
    return true;
  } catch (err) {
    console.warn(`Aviso: Error enviando alerta a ${jidDavidActivo}, probando canal alternativo:`, err.message);
    try {
      await sock.sendMessage(`${NUMERO_DAVID_AUTORIZADO}@s.whatsapp.net`, payload);
      return true;
    } catch (err2) {
      console.error(`Error fatal enviando alerta proactiva a David:`, err2.message);
      return false;
    }
  }
}

/**
 * Envía un mensaje de WhatsApp a cualquier destinatario (JID o número canónico internacional)
 */
export async function enviarMensajeWhatsApp(jidODestino, contenido) {
  if (!sock || !estaConectado) {
    console.warn('[WhatsApp] Intento de envío pero el cliente no está en línea.');
    // Cliente desconectado: nada se transmitio, reintentar es seguro.
    return { ok: false, id: null, incierto: false };
  }
  const payload = typeof contenido === 'string' ? { text: contenido } : contenido;
  const jid = jidODestino.includes('@') ? jidODestino : `${jidODestino}@s.whatsapp.net`;
  try {
    const enviado = await sock.sendMessage(jid, payload);
    console.log(`[WhatsApp Mensaje Enviado] Destino: ${jid}`);
    return { ok: true, id: enviado?.key?.id || null };
  } catch (err) {
    console.error(`Error enviando mensaje WhatsApp a ${jid}:`, err.message);
    // La excepcion llega tras iniciar la transmision: no se sabe si el
    // servidor lo acepto. Reintentar podria DUPLICAR el mensaje.
    return { ok: false, id: null, incierto: true };
  }
}

/**
 * Permite inyectar un socket simulado para pruebas automatizadas.
 */
export function setMockSocket(mockSock) {
  sock = mockSock;
  estaConectado = Boolean(mockSock);
}

export { iniciarWatchdogDocker, ejecutarWatchdogsSector2 };

/**
 * Drena y despacha las alertas pendientes de la cola entre procesos al chat de David.
 */
export async function drenarColaAlertas(deps = {}) {
  return drenarColaAlertasCore({ enviarMensajeADavid, ...deps });
}

/**
 * Inicia el cliente Baileys de WhatsApp
 */
export async function iniciarWhatsApp() {
  // Observabilidad (Mejora 3): OTel + Prometheus, apagada salvo
  // DAVIS_OTEL_ENABLED=true. No-op seguro si las deps faltan.
  iniciarObservabilidad({ servicio: 'jarvis-whatsapp', puertoMetricas: Number(process.env.DAVIS_METRICS_PUERTO_WS || 9464) })
    .catch((e) => console.error('[Observabilidad] init fallido:', e.message));
  const { state, saveCreds } = await useMultiFileAuthState(CARPETA_AUTH);
  const { version } = await fetchLatestBaileysVersion();

  console.log(`Conectando WhatsApp con Baileys (v${version.join('.')})...`);

  const tieneFlagPairing = process.argv.includes('--pairing') || process.argv.includes('--code');
  const argNumero = process.argv.find(arg => arg.startsWith('--numero=') || arg.startsWith('--phone='));

  let pairingNumber = null;
  if (tieneFlagPairing) {
    pairingNumber = NUMERO_BOT_SIMYO;
  } else if (argNumero) {
    pairingNumber = argNumero.split('=')[1].replace(/[^0-9]/g, '');
  }

  sock = makeWASocket({
    version,
    auth: state,
    printQRInTerminal: false,
    logger: pino({ level: 'silent' }),
    browser: ['DAVIS Linux', 'Chrome', '124.0.0']
  });


  if (pairingNumber && !sock.authState.creds.registered) {
    setTimeout(async () => {
      try {
        const code = await sock.requestPairingCode(pairingNumber);
        console.log('\n======================================================');
        console.log(`CODIGO DE VINCULACION PARA LA SIM (+${pairingNumber}):`);
        console.log(`>>  ${code}  <<`);
        console.log('Introduce este código en WhatsApp (Dispositivos vinculados > Vincular con el número de teléfono)');
        console.log('======================================================\n');
      } catch (err) {
        console.error('Error solicitando código de vinculación:', err.message);
      }
    }, 3000);
  }

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr && !pairingNumber) {
      console.log('\n======================================================');
      console.log('ESCANEA ESTE CODIGO QR CON EL WHATSAPP DEL BOT:');
      console.log('Abre WhatsApp > Ajustes > Dispositivos vinculados > Vincular un dispositivo');
      console.log('======================================================\n');
      qrcode.generate(qr, { small: true });
    }

    if (connection === 'close') {
      estaConectado = false;
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const razon = DisconnectReason[statusCode] || statusCode;
      console.log(`Conexión de WhatsApp cerrada. Razón: ${razon} (${statusCode})`);

      if (statusCode !== DisconnectReason.loggedOut) {
        console.log('Reconectando WhatsApp en 5 segundos...');
        setTimeout(() => iniciarWhatsApp(), 5000);
      } else {
        console.log('Sesión cerrada por WhatsApp. Para volver a vincular, elimina data/auth_info_baileys.');
      }
    } else if (connection === 'open') {
      estaConectado = true;
      if(process.env.DAVIS_ASYNC_PIPELINE==='1'){
        const {contenedorCompartido}=await import('./src/composition/container.js');
        const {crearCanalFinalWhatsapp}=await import('./src/adapters/outbound/channels/whatsappAsyncFinalAdapter.js');
        contenedorCompartido.registrarRuntimePipeline((inbound,ctx)=>crearOpcionesRuntimeWhatsapp(sock,inbound.userId,{},ctx.opciones?.urgencyDirective));
        contenedorCompartido.registrarCanalEntrega('whatsapp',crearCanalFinalWhatsapp({sock,normalizar:normalizarMarkdownWhatsApp,sintetizar:synthesizeSpeech,enviarVoz:sendVoiceNote,registrarIntercambio,condensar:(jid)=>programarCondensacionSiNecesario(jid,{chatCompletion:chatCompletionPorDefecto}),detenerEscribiendo:(dest)=>detenerEscribiendo(sock,dest)}));
      }
      console.log('\n======================================================');
      console.log('D.A.V.I.S. CONECTADO Y EN LINEA');
      console.log(`Copiloto táctico de David: +${NUMERO_BOT_SIMYO}`);
      console.log(`Usuario autorizado: David (+${NUMERO_DAVID_AUTORIZADO})`);
      console.log(`LID reconocido de David: ${LID_DAVID_CONOCIDO}@lid`);
      console.log('======================================================\n');

      inicializarServiciosProactivosCore({
        enviarMensajeADavid,
        enviarMensajeWhatsApp,
        numeroDavidAutorizado: NUMERO_DAVID_AUTORIZADO
      });
    }
  });

  sock.ev.on('creds.update', saveCreds);

  // Acuses de recibo (entregado / leido / error) de mensajes programados
  sock.ev.on('messages.update', (updates) => {
    try {
      procesarActualizacionEntrega(updates);
    } catch (errUpd) {
      console.error('[WhatsApp] Error procesando acuse de recibo:', errUpd.message);
    }
  });

  // Procesamiento de mensajes entrantes
  sock.ev.on('messages.upsert', (evento) => {
    procesarMensajesEntrantes(sock, evento).catch((err) => {
      console.error('[WhatsApp] Error no controlado en messages.upsert:', err?.message || err);
    });
  });
}

/**
 * Reparacion de los modos auxiliares (traductor/entrevista), OPT-IN con
 * DAVIS_AUX_CHAT_COMPLETION=1. Comportamiento por defecto INTACTO: sin el
 * env y sin deps.chatCompletion reciben undefined exactamente como antes
 * de este corte (el modo responde su error historico, nada nuevo se
 * activa al desplegar). Con el env, se inyecta el despachador central
 * (con PII pre-LLM si DAVIS_PII_PRELLM=1).
 */
export function resolverChatCompletionAux(deps = {}) {
  if (typeof deps.chatCompletion === 'function') return deps.chatCompletion;
  return process.env.DAVIS_AUX_CHAT_COMPLETION === '1' ? chatCompletionPorDefecto : undefined;
}

/**
 * Procesamiento de mensajes entrantes. Extraido de iniciarWhatsApp como
 * funcion exportada para probar el flujo completo de entrada con socket y
 * LLM simulados, sin conexion real. deps.chatCompletion permite inyectar el
 * LLM en pruebas; en produccion (sin deps) se usa el configurado.
 */
export function crearOpcionesRuntimeWhatsapp(sock, remoteJid, deps = {}, urgencyDirective = '') {
 const chatCompletionEfectivo=typeof deps.chatCompletion==='function'?deps.chatCompletion:chatCompletionPorDefecto;
 return {
          chatId: remoteJid,
          urgencyDirective,
          chatCompletion: chatCompletionEfectivo,
          carpetaTrazas: deps.carpetaTrazas,
          avisarSaludClasificador: resolverAvisoSaludClasificador(deps).fn,
          rutaArchivoMetricasClasificador: deps.rutaArchivoMetricasClasificador,
          rutaArchivoCandidaturas: deps.rutaArchivoCandidaturas,
          radarDeps: deps.radarDeps,
          rutaPlanesEstudio: deps.rutaPlanesEstudio,
          crearRecordatorioEstudio: deps.crearRecordatorioEstudio,
          rutaArchivoFlashcards: deps.rutaArchivoFlashcards,
          rutaArchivoFinanzas: deps.rutaArchivoFinanzas,
          rutaArchivoProcesos: deps.rutaArchivoProcesos,
          rutaArchivoTraductor: deps.rutaArchivoTraductor,
          rutaArchivoFechas: deps.rutaArchivoFechas,
          rutaArchivoSnoozes: deps.rutaArchivoSnoozes,
          rutaArchivoLlegada: deps.rutaArchivoLlegada,
          rutaArchivoTransporte: deps.rutaArchivoTransporte,
          fetchFnEmt: deps.fetchFnEmt,
          fetchFnCercanias: deps.fetchFnCercanias,
          clientIdEmt: deps.clientIdEmt,
          passKeyEmt: deps.passKeyEmt,
          rutaArchivoContactos: deps.rutaArchivoContactos,
          rutaArchivoDigest: deps.rutaArchivoDigest,
          carpetaNotas: deps.carpetaNotas,
          extraerArticulo: deps.extraerArticulo,
          carpetaDiario: deps.carpetaDiario,
          rutaArchivoHabitos: deps.rutaArchivoHabitos,
          rutaArchivoMenus: deps.rutaArchivoMenus,
          rutaArchivoCompra: deps.rutaArchivoCompra,
          rutaArchivoRecomendador: deps.rutaArchivoRecomendador,
          rutaArchivoQuedadas: deps.rutaArchivoQuedadas,
          rutaArchivoRecordatorios: deps.rutaArchivoRecordatorios,
          rutaArchivoProgramados: deps.rutaArchivoProgramados,
          rutaArchivoMemorias: deps.rutaArchivoMemorias,
          rutaArchivoNocturno: deps.rutaArchivoNocturno,
          obtenerNoticiasDeportes: deps.obtenerNoticiasDeportes,
          obtenerMemorias: deps.obtenerMemorias,
          rutaArchivoEntrevistas: deps.rutaArchivoEntrevistas,
          rutaArchivoEntregas: deps.rutaArchivoEntregas,
          buscarEnFuenteCompras: deps.buscarEnFuenteCompras,
          fetchFnCompras: deps.fetchFnCompras,
          rutaArchivoIdeas: deps.rutaArchivoIdeas,
          fetchFnGitHub: deps.fetchFnGitHub,
          rutaArchivoMetricas: deps.rutaArchivoMetricas,
          rutaConfigOps: deps.rutaConfigOps,
          rutaConfigHogar: deps.rutaConfigHogar,
          rutaArchivoViajes: deps.rutaArchivoViajes,
          otpDelivery: async ({ otpCode, ttlSeconds, reason, command }) => {
            await sock.sendMessage(remoteJid, {
              text: `Codigo de autorizacion 2FA para el comando critico "${command}" (${reason}):\n\n${otpCode}\n\nValidez: ${ttlSeconds} segundos. Responde "confirmar otp ${otpCode}" para autorizar la ejecucion. Este codigo solo lo ves tu.`
            });
          }
 };
}

// Cola/mutex por remoteJid para serializar el procesamiento de mensajes del mismo
// chat entre eventos messages.upsert concurrentes, sin bloquear chats distintos.
const colasPorJid = new Map();

export async function ejecutarEnColaPorJid(remoteJid, tarea) {
  if (!remoteJid) return await tarea();

  const colaAnterior = colasPorJid.get(remoteJid) || Promise.resolve();
  let liberarTurno;
  const turnoActual = new Promise((resolve) => {
    liberarTurno = resolve;
  });

  // Encadenar el turno antes de cualquier await garantiza orden FIFO estricto.
  const promesaCadena = colaAnterior.catch(() => {}).then(() => turnoActual);
  colasPorJid.set(remoteJid, promesaCadena);

  await colaAnterior.catch(() => {});
  try {
    return await tarea();
  } finally {
    liberarTurno();
    if (colasPorJid.get(remoteJid) === promesaCadena) {
      colasPorJid.delete(remoteJid);
    }
  }
}

export async function procesarMensajesEntrantes(sock, { messages, type }, deps = {}) {
    if (type !== 'notify') return;

    // Proveedor LLM efectivo: la prueba inyecta; en produccion se usa el
    // configurado (despachador central: con DAVIS_PII_PRELLM=1 incluye la
    // anonimizacion pre-LLM tambien en condensacion y en el agente).
    const chatCompletionEfectivo = typeof deps.chatCompletion === 'function' ? deps.chatCompletion : chatCompletionPorDefecto;
    const chatCompletionAux = resolverChatCompletionAux(deps);

    await Promise.all(messages.map(async (msg) => {
      if (!msg.message || msg.key.fromMe) return;

      const remoteJid = msg.key.remoteJid;
      if (!remoteJid) return;

      await ejecutarEnColaPorJid(remoteJid, async () => {
        do {

      // 1. Mensajes de grupos (@g.us): interaccion avanzada con menciones y resumen
      if (remoteJid.endsWith('@g.us')) {
        const fnProcesarGrupo = deps.procesarMensajeGrupo || procesarMensajeGrupo;
        const textoGrupo = extraerTextoMensaje(msg);
        const resGrupo = await fnProcesarGrupo(sock, msg, textoGrupo, {
          botJid: sock?.user?.id,
          esMensajeDeDavid: (jid) => esMensajeDeDavid(jid),
          procesarMensajeAgente: async (textoAgente, meta = {}) => {
            const inbound = crearInboundDesdeWhatsApp({ msg, texto: textoAgente, remoteJid });
            return await procesarMensajeEntrante(inbound, {
              historial: obtenerHistorial(remoteJid),
              opciones: {
                ...crearOpcionesRuntimeWhatsapp(sock, remoteJid, deps),
                esGrupo: true,
                remitenteJid: meta.remitenteJid
              }
            });
          },
          ...deps
        });
        if (resGrupo && (resGrupo.gestionado || resGrupo.ignorado)) {
          continue;
        }
        continue;
      }

      // 2. Filtro de seguridad con Buzon VIP y Respuestas de Terceros
      if (!esMensajeDeDavid(remoteJid)) {

        // Solo el carril tenant registrado/habilitado puede consumir aqui el
        // mensaje. Gate cerrado/desconocidos conservan el buzon/VIP historico.
        const puente = deps.puenteWhatsAppTenants || puenteWhatsAppTenants;
        if (puente && (await puente.procesar(sock,msg)).gestionado === true) continue;

        const remitenteLimpio = remoteJid.split('@')[0].replace(/\D/g, '');
        console.log(`[WhatsApp Mensaje Externo] Recibido de +${remitenteLimpio}: ${remoteJid}`);
        const textoExterno = extraerTextoMensaje(msg);

        // Flujo de Autoservicio / Onboarding Multi-Tenant (Tarea 2.5)
        if (textoExterno && /^\/(registro|alta|crearcuenta)\b/i.test(textoExterno.trim()) && tenantsHabilitados()) {
          const match = textoExterno.trim().match(/^\/(?:registro|alta|crearcuenta)\s+(.+)$/i);
          const nombreOrg = match ? match[1].trim() : `Negocio ${remitenteLimpio}`;
          const slugBase = 'tenant_' + nombreOrg.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 25);
          const slug = (slugBase + '_' + remitenteLimpio.slice(-4)).replace(/^_+|_+$/g, '');

          try {
            const p = contenedorCompartido.persistencia;
            const prov = await provisionarTenant({
              id: slug,
              nombre: nombreOrg,
              plan: 'demo',
              canal: 'whatsapp',
              identificador: remoteJid
            }, {
              tenantRepository: p?.tenantRepository,
              quotaService: contenedorCompartido.quotaService,
              qdrantSecondBrain: contenedorCompartido.qdrantSecondBrain
            });

            const mensajeBienvenida = `Bienvenido a D.A.V.I.S., ${nombreOrg}.

Tu cuenta y Second Brain privado han sido activados con exito.
- Identificador de cuenta: ${slug}
- Plan: Demo (${prov.cuotaDiaria} tokens/dia)
- Almacenamiento: Directorio y memoria vectorial aislados

Ya puedes gestionar tus citas, notas y recordatorios en este chat de forma completamente privada.
Prueba a decirme:
- "Guarda una nota sobre mi primera reunion"
- "Que citas tengo"
- "Apunta un gasto de 25 euros en transporte"`;

            await sock.sendMessage(remoteJid, { text: mensajeBienvenida }, { quoted: msg });
            console.log(`[WhatsApp Onboarding] Tenant "${slug}" (${nombreOrg}) registrado exitosamente para +${remitenteLimpio}.`);
            continue;
          } catch (errProv) {
            console.error(`[WhatsApp Onboarding] Error registrando tenant para +${remitenteLimpio}:`, errProv.message);
            await sock.sendMessage(remoteJid, { text: 'No se pudo completar el registro en este momento. Intentalo de nuevo mas tarde.' }, { quoted: msg });
            continue;
          }
        }
        if (textoExterno) {
          const outreachRes = handleOutreachLeadReply(remitenteLimpio, textoExterno);
          if (outreachRes?.matched) {
            if (outreachRes.isOptOut) {
              console.log(`[Outreach WA] Opt-out de ${outreachRes.lead.name} (+${remitenteLimpio})`);
              await sock.sendMessage(remoteJid, { text: 'Entendido, disculpa las molestias. No volveremos a escribirte.' }, { quoted: msg });
              await enviarMensajeADavid(`[OUTREACH OPT-OUT] ${outreachRes.lead.name} (${outreachRes.lead.city}, +${remitenteLimpio}) pidió no recibir más mensajes:\n"${textoExterno}"`);
            } else {
              console.log(`[Outreach WA] Respuesta de ${outreachRes.lead.name} (+${remitenteLimpio})`);
              await sock.sendMessage(remoteJid, { text: 'Recibido. Aviso ahora mismo a David para que te escriba desde su WhatsApp personal (+34 635 60 56 05) con los detalles.' }, { quoted: msg });
              await enviarMensajeADavid(`[OUTREACH RESPUESTA WA] ${outreachRes.lead.name} (${outreachRes.lead.city}) respondió:\n"${textoExterno}"\n\nEscribirle: https://wa.me/${remitenteLimpio}`);
            }
            continue;
          }
          const filter = shouldFilterMessage(remoteJid, msg.key?.participant, textoExterno);
          if (!filter.allowed) {
            console.log(`[WhatsApp Filtro VIP] Mensaje bloqueado de +${remitenteLimpio}. Enviando autorrespuesta sobria.`);
            await sock.sendMessage(remoteJid, { text: filter.autoReplyText }, { quoted: msg });
          } else if (filter.isEmergency) {
            console.log(`[WhatsApp Alerta VIP / Emergencia] Reenviando a David de +${remitenteLimpio}`);
            await enviarMensajeADavid(`[D.A.V.I.S. - ALERTA VIP / EMERGENCIA]\n\nAtencion David: el contacto +${remitenteLimpio} ha enviado un mensaje urgente:\n"${textoExterno}".`);
          } else {
            console.log(`[WhatsApp Buzon] Retransmitiendo a David respuesta de +${remitenteLimpio}: "${textoExterno}"`);
            await enviarMensajeADavid(`[D.A.V.I.S. - RESPUESTA EXTERNA]\n\nDavid, el contacto +${remitenteLimpio} acaba de responder:\n"${textoExterno}".`);
          }
        }
        continue;
      }

      // Actualizar el JID activo para futuras respuestas y alertas
      jidDavidActivo = remoteJid;

      let texto = null;
      let esAudio = false;
      let urgencyDirective = '';

      // 3. Procesamiento de componentes interactivos (encuestas, botones, listas)
      const interactive = parseInteractiveResponse(msg);
      if (interactive) {
        if (interactive.type === 'poll_vote') {
          console.log(`[WhatsApp Interactivo] Voto en encuesta registrado (${interactive.pollId}) de ${interactive.voterJid}.`);
          continue;
        }
        const fnManejarInteractiva = deps.manejarRespuestaInteractiva || manejarRespuestaInteractiva;
        const resInteractiva = await fnManejarInteractiva(sock, remoteJid, interactive, deps);
        if (resInteractiva && resInteractiva.gestionado) {
          continue;
        }
        if (interactive.type === 'button' || interactive.type === 'list') {
          texto = interactive.id || interactive.text || interactive.title;
          console.log(`[WhatsApp Interactivo] Seleccion de usuario recibida: "${texto}"`);
        }
      }

      // 4. Manejo de medios entrantes (audio, texto reenviado, imagen, documento y ubicacion)
      const resMedia = await procesarMediaEntrante({
        sock,
        msg,
        remoteJid,
        texto,
        esAudio,
        urgencyDirective,
        deps,
        extraerTextoMensaje
      });
      if (resMedia.handled) continue;
      texto = resMedia.texto;
      esAudio = resMedia.esAudio;
      urgencyDirective = resMedia.urgencyDirective;

      if (!texto) continue;

      // 4c. Confirmacion de borrador de ticket: respuesta determinista, sin LLM,
      // aislada por chat y de un solo uso (la gestiona financeService).
      const respuestaBorrador = interpretarRespuestaBorrador(texto);
      if (respuestaBorrador) {
        const depsFin = { rutaArchivo: deps.rutaArchivoFinanzas, chatId: remoteJid };
        if (borradorPendiente(depsFin)) {
          let textoConfirmacion;
          if (respuestaBorrador.accion === 'descartar') {
            const r = descartarBorrador({}, depsFin);
            textoConfirmacion = r.ok ? 'Descartado, David: no he registrado nada de ese ticket.' : r.error;
          } else {
            const r = confirmarBorrador({ correcciones: respuestaBorrador.correcciones }, depsFin);
            textoConfirmacion = r.ok
              ? `Registrado, David: ${r.gasto.importe.toFixed(2)} EUR en ${r.gasto.comercio} (${r.gasto.fecha}).${r.aviso ? ' ' + r.aviso : ''}`
              : r.error;
          }
          await sock.sendMessage(remoteJid, { text: textoConfirmacion }, { quoted: msg });
          continue;
        }
      }


      console.log(`\n[WhatsApp de David${esAudio ? ' (Audio)' : ''}]: "${texto}"`);

      // 4d. Modo traductor: si esta activo en este chat, traduce el mensaje y
      // no sigue el flujo normal. La activacion es siempre peticion textual de
      // David (herramienta activar_traductor).
      const estadoTrad = estadoTraductor({ rutaArchivo: deps.rutaArchivoTraductor, chatId: remoteJid });
      if (estadoTrad && /desactiva(r)?\s+(el\s+)?traductor/i.test(texto)) {
        const rOff = desactivarTraductor({ rutaArchivo: deps.rutaArchivoTraductor, chatId: remoteJid });
        await sock.sendMessage(remoteJid, { text: rOff.ok ? 'Traductor desactivado, David.' : rOff.error }, { quoted: msg });
        continue;
      }
      if (estadoTrad) {
        const rTrad = await traducir(texto, estadoTrad.idioma, { chatCompletion: chatCompletionAux });
        await sock.sendMessage(remoteJid, {
          text: rTrad.ok ? rTrad.traduccion : `No he podido traducirlo, David: ${rTrad.error}`
        }, { quoted: msg });
        continue;
      }

      // 4f. Simulacro de entrevista activo en este chat (nº 3): cada mensaje
      // se evalua como respuesta. La salida es determinista y anterior al modo.
      const sesionEntrevista = estadoEntrevista({ rutaArchivo: deps.rutaArchivoEntrevistas, chatId: remoteJid });
      if (sesionEntrevista && /termina(r)?\s+(la\s+|el\s+|este\s+)?(entrevista|simulacro)/i.test(texto)) {
        terminarEntrevista({ rutaArchivo: deps.rutaArchivoEntrevistas, chatId: remoteJid });
        await sock.sendMessage(remoteJid, { text: 'Simulacro cerrado, David. Cuando quieras, abrimos otro.' }, { quoted: msg });
        continue;
      }
      if (sesionEntrevista) {
        const rEnt = await responderEntrevista(texto, { rutaArchivo: deps.rutaArchivoEntrevistas, chatId: remoteJid, chatCompletion: chatCompletionAux });
        await sock.sendMessage(remoteJid, {
          text: rEnt.ok
            ? (rEnt.fin ? `${rEnt.evaluacion}\n\nSimulacro terminado: ${rEnt.resultado.aciertos}/${rEnt.resultado.total} respuestas acertadas.` : rEnt.evaluacion)
            : rEnt.error
        }, { quoted: msg });
        continue;
      }

      // 5. Captura y persistencia automatica de Notas Personales
      // Las entradas de diario (nº 43) van al diario via JARVIS, no a las
      // notas del Second Brain.
      const esSelfChat = remoteJid.includes(NUMERO_DAVID_AUTORIZADO);
      const esEntradaDiario = /\bdiario\b/i.test(texto);
      // Igual para el registro de entregas/examenes (nº 8): va a JARVIS.
      const esRegistroEntrega = /^(apunta|anota|registra)\s+(un|una|el|la|este|esta)?\s*(examen|ex[aá]men|entrega)\b/i.test(texto);
      // Igual para las ideas/propuestas (nº 15): van a JARVIS, no a notas.
      const esRegistroIdea = /^(apunta|anota|registra)\s+(un|una|el|la|este|esta)?\s*idea\b/i.test(texto);
      if (!esEntradaDiario && !esRegistroEntrega && !esRegistroIdea && isPersonalNote(texto, esSelfChat)) {
        console.log(`[WhatsApp Nota Personal] Detectada: "${texto}"`);
        const resNota = await savePersonalNote(texto, {
          source: esAudio ? 'audio' : 'text',
          sender: remoteJid
        });
        if (resNota.ok) {
          const confirmacion = `Nota archivada en el Second Brain (${resNota.category}):\n"${texto.slice(0, 90)}${texto.length > 90 ? '...' : ''}"\nArchivo: ${resNota.filename}`;
          await sock.sendMessage(remoteJid, { text: confirmacion }, { quoted: msg });
          continue;
        }
      }

      // 6. Extractor y Descargador Multimedia Directo (YouTube / Reels / TikTok)
      if (isMediaUrl(texto)) {
        console.log(`[WhatsApp Multimedia] URL detectada: "${texto}"`);
        await sock.sendPresenceUpdate('composing', remoteJid);
        await sock.sendMessage(remoteJid, { text: 'Iniciando descarga y procesamiento de contenido multimedia...' }, { quoted: msg });
        const mediaRes = await downloadMedia(texto, {
          audioOnly: /solo audio|mp3|extrae audio/i.test(texto)
        });
        if (mediaRes.ok && mediaRes.filePath) {
          await sendMediaMessage(sock, remoteJid, mediaRes, msg);
          console.log(`[WhatsApp Multimedia] Contenido enviado con éxito: ${mediaRes.filePath}`);
          continue;
        } else {
          await sock.sendMessage(remoteJid, { text: `Error en la descarga multimedia: ${mediaRes.error || 'Fallo desconocido'}` }, { quoted: msg });
          continue;
        }
      }

      // Easter Egg: Solicitud de más tabaco para la cachimba
      if (esPeticionCachimba(texto) && fs.existsSync(RUTA_IMAGEN_CACHIMBA)) {
        console.log(`[Easter Egg Cachimba Activado] Solicitado por David: "${texto}"`);
        try {
          await sock.readMessages([msg.key]);
          await sock.sendPresenceUpdate('composing', remoteJid);

          const frasesDavis = [
            'Cazoleta ajustada y mezcla al punto. Si la quemas ya no es culpa del sistema.',
            'Tabaco suministrado y camara presurizada. Ya puedes seguir con tu descanso.',
            'Parametros termicos estabilizados y mezcla renovada. A disfrutar del humo.',
            'Cachimba lista con carbones encendidos. No me hagas limpiarla luego.'
          ];
          const frase = frasesDavis[Math.floor(Math.random() * frasesDavis.length)];
          const bufferImagen = fs.readFileSync(RUTA_IMAGEN_CACHIMBA);

          const pieDeFoto = esAudio ? `[Nota de voz]: "${texto}"\n\n${frase}` : frase;

          await sock.sendMessage(remoteJid, {
            image: bufferImagen,
            caption: pieDeFoto
          }, { quoted: msg });

          await sock.sendPresenceUpdate('paused', remoteJid);
          console.log(`[D.A.V.I.S. a David]: [Imagen Cachimba enviada - "${frase}"]\n`);
          continue;
        } catch (errEaster) {
          console.error('Error enviando imagen de cachimba:', errEaster);
        }
      }

      // Solicitud de captura de pantalla web con Playwright
      const tieneUrl = /(https?:\/\/[^\s]+)/i.test(texto);
      const pideCaptura = /(haz(me)?|saca(me)?|pasa(me)?|envia(me)?|toma(me)?)\s+(una\s+)?(captura|screenshot|foto)\s+(de\s+)?(la\s+)?(web|pagina|enlace|noticia)?/i.test(texto) ||
                          /(captura|screenshot)\s+(de\s+)?(la\s+)?(web|pagina|enlace|noticia)?/i.test(texto);

      if (tieneUrl && pideCaptura) {
        const urlCaptura = texto.match(/https?:\/\/[^\s]+/i)[0];
        console.log(`[WhatsApp Captura Web] Solicitada por David: ${urlCaptura}`);
        try {
          await sock.readMessages([msg.key]);
          await sock.sendPresenceUpdate('composing', remoteJid);

          const resCap = await capturarPantallaWeb(urlCaptura);
          if (resCap.ok && resCap.buffer) {
            const pieCaptura = esAudio
              ? `[Nota de voz]: "${texto}"\n\nCaptura de pantalla realizada en vivo con Playwright Chromium:\n${urlCaptura}`
              : `Captura de pantalla realizada en vivo con Playwright Chromium:\n${urlCaptura}`;

            await sock.sendMessage(remoteJid, {
              image: resCap.buffer,
              caption: pieCaptura
            }, { quoted: msg });

            await sock.sendPresenceUpdate('paused', remoteJid);
            console.log(`[J.A.R.V.I.S. a David]: [Captura de pantalla de ${urlCaptura} enviada con éxito]\n`);
            continue;
          } else {
            console.warn(`Aviso: Error capturando pantalla: ${resCap.error}`);
          }
        } catch (errCap) {
          console.error('Error capturando pantalla web:', errCap);
        }
      }

      // Confirmacion humana de comandos criticos (2FA): nunca pasa por el LLM
      const mOtp = texto.match(/^confirma(?:r|me)?\s+(?:otp\s+|c[oó]digo\s+|codigo\s+)?[:#-]?\s*(\d{6})\s*$/i);
      if (mOtp) {
        console.log('[WhatsApp 2FA] Confirmacion OTP recibida directamente de David, sin pasar por el LLM.');
        const resOtp = await confirmAndExecute(mOtp[1]);
        let textoOtp;
        if (resOtp.status === 'EXECUTED') {
          textoOtp = `Autorizacion 2FA confirmada. Comando "${resOtp.command}" ejecutado:\n${resOtp.stdout || resOtp.stderr || 'Comando completado sin salida'}`;
        } else if (resOtp.status === 'INVALID_OTP') {
          textoOtp = `Codigo OTP invalido: ${resOtp.error}`;
        } else if (resOtp.status === 'EXPIRED') {
          textoOtp = 'El codigo OTP ha expirado. Vuelve a solicitar el comando.';
        } else {
          textoOtp = `No se pudo confirmar el OTP: ${resOtp.error || resOtp.status}`;
        }
        await sock.sendMessage(remoteJid, { text: textoOtp }, { quoted: msg });
        continue;
      }

      // Cancelacion de un borrado pendiente (memoria o conversacion): fuera
      // del modelo, misma mecanica que la confirmacion.
      const resCancelaBorrado = resolverCancelacionBorrado(remoteJid, texto);
      if (resCancelaBorrado) {
        await sock.sendMessage(remoteJid, {
          text: resCancelaBorrado.cancelados > 0
            ? 'Borrado cancelado; no se ha eliminado nada.'
            : 'No habia ningun borrado pendiente en este chat.'
        }, { quoted: msg });
        continue;
      }

      // Borrado de la conversacion (historial, episodios archivados y trazas
      // del recorrido de ESTE chat): peticion con confirmacion fuera del
      // modelo. Los recuerdos del Second Brain NO se tocan: tienen su propio
      // flujo (olvidar_memoria con comodin).
      if (esPeticionBorradoConversacion(texto)) {
        const idBorradoConv = registrarBorradoConversacionPendiente(remoteJid);
        const avisoBorrado = `Entendido. Esto borrara el historial de esta conversacion, sus episodios archivados y las trazas del recorrido. Tus recuerdos guardados (Second Brain) NO se tocan. Para ejecutarlo, responde: "confirmar borrado ${idBorradoConv}". Para cancelarlo: "cancelar borrado".`;
        const fnEnviarConfirmacion = deps.enviarConfirmacionInteractiva || enviarConfirmacionInteractiva;
        await fnEnviarConfirmacion(sock, remoteJid, avisoBorrado, {
          idConfirmar: `btn_borrado_confirm_${idBorradoConv}`,
          idCancelar: `btn_borrado_cancel_${idBorradoConv}`,
          textoConfirmar: 'Confirmar borrado',
          textoCancelar: 'Cancelar',
          footer: 'D.A.V.I.S. Seguridad'
        });
        continue;
      }

      // Confirmacion de borrado (memoria o conversacion): fuera de banda,
      // ligada al chat, al id exacto, con TTL y de un solo uso. Nunca pasa
      // por el LLM.
      const resBorrado = resolverConfirmacionBorrado(remoteJid, texto);
      if (resBorrado) {
        let textoBorrado;
        if (resBorrado.confirmado && resBorrado.tipo === 'conversacion') {
          console.log('[Conversacion 2FA] Borrado de conversacion confirmado por David directamente, sin pasar por el LLM.');
          limpiarHistorial(remoteJid, deps);
          textoBorrado = 'Historial de la conversacion, episodios y trazas borrados. Tus recuerdos del Second Brain siguen intactos.';
        } else if (resBorrado.confirmado) {
          console.log('[Memoria 2FA] Borrado masivo confirmado por David directamente, sin pasar por el LLM.');
          const resVaciado = olvidarMemoria(resBorrado.criterio, { confirmado: true });
          textoBorrado = resVaciado.mensaje || resVaciado.error || 'Borrado completado.';
        } else {
          textoBorrado = resBorrado.motivo;
        }
        await sock.sendMessage(remoteJid, { text: textoBorrado }, { quoted: msg });
        continue;
      }


      // Confirmacion de acciones criticas dictadas por voz: la transcripcion
      // puede equivocarse, asi que envios a terceros, borrados y comandos
      // exigen un "si" explicito de David. Tampoco pasa por el LLM.
      const resVoz = resolverConfirmacionVoz(remoteJid, texto);
      if (resVoz && resVoz.resultado === 'cancelado') {
        await sock.sendMessage(remoteJid, {
          text: 'Entendido. Accion cancelada; no se ha realizado ningun cambio.'
        }, { quoted: msg });
        continue;
      }
      if (resVoz && resVoz.resultado === 'confirmado') {
        console.log('[WhatsApp Voz] Accion critica confirmada por David; se procesa la peticion original.');
        texto = resVoz.textoOriginal;
      } else if ((!resVoz || resVoz.resultado === 'nuevo') && esAudio && esAccionCriticaPorVoz(texto)) {
        // 'nuevo' descarta la peticion pendiente anterior, pero si la nueva
        // tambien es critica debe pedir su propia confirmacion: sin esto,
        // repetir una accion critica por voz la ejecutaba sin confirmar.
        guardarPendienteVoz(remoteJid, texto);
        await sock.sendMessage(remoteJid, {
          text: `Antes de actuar. He entendido: "${texto}". Es una accion con efectos externos o destructivos; confirme respondiendo "si" o "confirmo", o bien "no" para cancelarla.`
        }, { quoted: msg });
        continue;
      }
      // resVoz === 'nuevo': la peticion pendiente queda descartada y se
      // procesa el mensaje actual con normalidad.

      // Aprobacion/rechazo de skills (procedimientos reutilizables): fuera
      // de banda, ligada al chat, TTL y un solo uso. Nunca pasa por el LLM.
      // Va DESPUES de la confirmacion de voz: una aprobacion dictada por
      // audio exige antes el "si" explicito (accion critica por voz).
      const resSkill = resolverConfirmacionSkill(remoteJid, texto);
      if (resSkill) {
        console.log(`[Skills 2FA] ${resSkill.confirmado ? 'Confirmada' : 'Rechazada o invalida'} por David directamente, sin pasar por el LLM.`);
        await sock.sendMessage(remoteJid, { text: resSkill.motivo }, { quoted: msg });
        continue;
      }

      // Iniciar estado "escribiendo..." en WhatsApp mientras se procesa la consulta
      iniciarEscribiendo(sock, remoteJid);

      try {
        // 1. Confirmar lectura
        await sock.readMessages([msg.key]);

        // Canal de salida via puerto: los envios de respuesta pasan por el
        // adaptador de canal, no por llamadas sueltas al socket.
        const canalWhatsapp = crearWhatsAppChannelAdapter(sock);

        // 3. Procesar consulta con el agente (con memoria de conversacion aislada por chat)
        const historialPrevio = obtenerHistorial(remoteJid);
        const inicioJarvis = Date.now();
        let respuesta;
        try {
          const inbound = crearInboundDesdeWhatsApp({ msg, texto, remoteJid });
          respuesta = await procesarMensajeEntrante(inbound, {
            historial: historialPrevio,
            opciones: {...crearOpcionesRuntimeWhatsapp(sock,remoteJid,deps,urgencyDirective),respuestaVoz:esAudio || /responde(me)?\s+(en|con)?\s*(audio|nota de voz|voz)/i.test(texto)}
          });
          registrarEventoMetrica({ tipo: 'comando', nombre: 'consulta_jarvis', duracionMs: Date.now() - inicioJarvis }, { rutaArchivo: deps.rutaArchivoMetricas });
        } catch (errJarvis) {
          detenerEscribiendo(sock, remoteJid);
          registrarEventoMetrica({ tipo: 'error', nombre: 'consulta_jarvis', duracionMs: Date.now() - inicioJarvis, detalle: errJarvis && errJarvis.message }, { rutaArchivo: deps.rutaArchivoMetricas });
          throw errJarvis;
        }

        if (process.env.DAVIS_ASYNC_PIPELINE === '1') {
          // En pipeline asincrono NO enviamos el texto preliminar "Recibido, lo estoy procesando.".
          // WhatsApp mantiene el estado "escribiendo..." (composing) de forma reactiva hasta que el
          // worker en segundo plano entregue la respuesta final coherente por canalFinalWhatsapp.
          continue;
        }

        // 4. Detener estado de escritura en camino sincrono antes de enviar respuesta
        detenerEscribiendo(sock, remoteJid);

        // WhatsApp solo interpreta *negrita* con un asterisco: el modelo suele
        // emitir **doble** (markdown), que se veria literal. Se normaliza aqui,
        // unico punto de envio de la respuesta del agente.
        respuesta = normalizarMarkdownWhatsApp(respuesta);

        // 7. Respuesta en Nota de Voz Nativa PTT (si David envió audio o solicitó voz)
        if (esAudio || /responde(me)?\s+(en|con)?\s*(audio|nota de voz|voz)/i.test(texto)) {
          console.log('[WhatsApp Voz PTT] Sintetizando respuesta de voz con Edge-TTS en OGG Opus...');
          try {
            const sintetizar = deps.sintetizarVoz || synthesizeSpeech;
            const fnLimpiarVoz = deps.limpiarTextoParaVoz || limpiarTextoParaVoz;
            const textoVoz = fnLimpiarVoz(respuesta);
            const oggBuffer = await sintetizar(textoVoz, { voice: 'es-ES-AlvaroNeural' });
            await sendVoiceNote(sock, remoteJid, oggBuffer, msg);
            console.log(`[J.A.R.V.I.S. a David]: [Nota de voz PTT enviada con exito]\n`);
          } catch (errTts) {
            console.error('Error generando nota de voz PTT, recurriendo a texto:', errTts.message);
            await canalWhatsapp.enviarTexto(remoteJid, respuesta, { quoted: msg });
          }
        } else {
          await canalWhatsapp.enviarTexto(remoteJid, respuesta, { quoted: msg });
          console.log(`[J.A.R.V.I.S. a David]: "${respuesta}"\n`);
        }

        // 8. Persistir el intercambio en el historial del chat
        try {
          registrarIntercambio(remoteJid, texto, respuesta);
          // Condensacion en segundo plano cuando el chat supera el tope:
          // fire-and-forget (errores capturados dentro), nunca bloquea la respuesta.
          programarCondensacionSiNecesario(remoteJid, { chatCompletion: chatCompletionEfectivo });
        } catch (errHist) {
          console.error('[Historial] No se pudo registrar el intercambio:', errHist.message);
        }
      } catch (err) {
        detenerEscribiendo(sock, remoteJid);
        console.error('Error procesando mensaje:', err);
        await sock.sendMessage(remoteJid, {
          // Sanitizado: un 429 del proveedor llegaba con organization id y
          // detalle de cuota (fallo observado en produccion, 7 nov 2026).
          text: mensajeErrorParaUsuario(err)
        }, { quoted: msg });
      }
        } while (false);
      });
    }));
}

export function registrarApagadoLimpio(deps = {}) {
  const persistencia = deps.persistencia || contenedorCompartido?.persistencia;
  const cerrar = () => {
    try {
      if (persistencia && typeof persistencia.cerrar === 'function') {
        persistencia.cerrar();
        console.log('[WhatsAppBot] Base de datos SQLite cerrada limpiamente.');
      }
    } catch (err) {
      console.error('[WhatsAppBot] Error al cerrar SQLite:', err?.message || err);
    }
  };

  const handler = (senal) => {
    console.log(`[WhatsAppBot] Recibida senal ${senal}. Cierre limpio de SQLite...`);
    cerrar();
    if (deps.salir !== false && process.env.NODE_ENV !== 'test') {
      process.exit(0);
    }
  };

  process.once('SIGINT', () => handler('SIGINT'));
  process.once('SIGTERM', () => handler('SIGTERM'));

  return { cerrar, handler };
}

registrarApagadoLimpio();

// Iniciar automáticamente
const isTest = process.env.NODE_ENV === 'test' ||
  process.argv.some(a => a.includes('--test') || a.includes('run_all'));

const isDirectRun = Boolean(
  process.argv[1] &&
  (path.resolve(process.argv[1]) === fileURLToPath(import.meta.url) ||
   process.argv[1].endsWith('whatsappBot.js'))
);

const isPm2 = typeof process.env.pm_id !== 'undefined';

if (!isTest && (isDirectRun || isPm2 || process.env.RUN_WHATSAPP_BOT === 'true')) {
  iniciarWhatsApp().catch(err => {
    console.error('Error fatal iniciando el cliente de WhatsApp:', err);
  });
}
