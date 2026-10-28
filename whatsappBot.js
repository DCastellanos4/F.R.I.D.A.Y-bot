import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  downloadMediaMessage
} from '@whiskeysockets/baileys';
import pino from 'pino';
import qrcode from 'qrcode-terminal';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

import { config } from './config.js';
import { consultarJarvis } from './jarvisAgent.js';
import { iniciarMonitorRecordatorios } from './reminderService.js';
import { iniciarMonitorMensajesProgramados } from './scheduledMessageService.js';
import { iniciarVigilanteProactivo } from './proactiveAlerts.js';
import { iniciarSniperWatchdog } from './sniperService.js';
import { programarEnvioMatutino } from './dailyBriefing.js';
import { normalizarTexto } from './memoryService.js';
import { transcribirAudioBuffer } from './voiceService.js';
import { capturarPantallaWeb } from './browserService.js';
import { isVipModeActive, shouldFilterMessage } from './vipFilterService.js';
import { recordGroupMessage, generateGroupSummary, isDavidMentioned } from './groupSummarizerService.js';
import { isPersonalNote, savePersonalNote } from './notesService.js';
import { isMediaUrl, downloadMedia, sendMediaMessage } from './mediaDownloaderService.js';
import { synthesizeSpeech, sendVoiceNote } from './ttsService.js';
import { classifyUrgency, getUrgencyPromptDirective } from './urgencyService.js';
import { parseInteractiveResponse, parsePollVote } from './interactiveService.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CARPETA_AUTH = path.join(__dirname, 'data', 'auth_info_baileys');
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
let serviciosIniciados = false;

/**
 * Envía un mensaje proactivo a David por WhatsApp (texto u objeto con imagen)
 */
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
    return false;
  }
  const payload = typeof contenido === 'string' ? { text: contenido } : contenido;
  const jid = jidODestino.includes('@') ? jidODestino : `${jidODestino}@s.whatsapp.net`;
  try {
    await sock.sendMessage(jid, payload);
    console.log(`[WhatsApp Mensaje Enviado] Destino: ${jid}`);
    return true;
  } catch (err) {
    console.error(`Error enviando mensaje WhatsApp a ${jid}:`, err.message);
    return false;
  }
}

/**
 * Registra los disparadores proactivos en segundo plano (vigilante, recordatorios, mensajes programados, sniper y briefing)
 */
function inicializarServiciosProactivos() {
  if (serviciosIniciados) return;
  serviciosIniciados = true;

  console.log(`[Servicios Proactivos] Vinculando alertas proactivas al chat de David...`);

  // 1. Monitor del servidor Oracle y Minecraft (cada 5 minutos)
  iniciarVigilanteProactivo(async (alerta) => {
    await enviarMensajeADavid(`[D.A.V.I.S. - ALERTA DEL SISTEMA]\n\n${alerta}`);
  }, 5 * 60 * 1000);

  // 2. Monitor de recordatorios programados (cada 30 segundos)
  iniciarMonitorRecordatorios(async (recordatorio, alertaTexto) => {
    const notaMensaje = (recordatorio && recordatorio.mensaje)
      ? recordatorio.mensaje
      : (typeof recordatorio === 'string' ? recordatorio : 'Recordatorio programado');
    const textoAviso = `[D.A.V.I.S. - RECORDATORIO]\n\nTal como me pediste, David: "${notaMensaje}".\n\nAsunto completado y archivado.`;
    await enviarMensajeADavid(textoAviso);
  }, 30 * 1000);

  // 3. Monitor de mensajes de WhatsApp programados a terceros (cada 15 segundos)
  iniciarMonitorMensajesProgramados(async (m) => {
    console.log(`[WhatsApp Programado] Despachando mensaje programado para +${m.numero}...`);
    try {
      const exito = await enviarMensajeWhatsApp(m.destinatarioJid, m.mensaje);
      if (exito) {
        await enviarMensajeADavid(`[D.A.V.I.S. - MENSAJE ENTREGADO]\n\nEl mensaje para el número +${m.numero} ha sido transmitido con éxito:\n"${m.mensaje}".`);
      } else {
        await enviarMensajeADavid(`[D.A.V.I.S. - AVISO DE DISPACHO]\n\nNo se ha podido entregar el mensaje programado al número +${m.numero}.`);
      }
    } catch (errEnvio) {
      console.error(`Error en despacho de mensaje programado a +${m.numero}:`, errEnvio.message);
      await enviarMensajeADavid(`[D.A.V.I.S. - AVISO DE DISPACHO]\n\nSe ha producido una anomalía al entregar el mensaje al número +${m.numero}: ${errEnvio.message}`);
    }
  }, 15 * 1000);

  // 4. Sniper Watchdog de artículos y ofertas (cada 20 minutos)
  iniciarSniperWatchdog(async (alertaOferta) => {
    await enviarMensajeADavid(`[D.A.V.I.S. - AVISO DE PRECIO]\n\n${alertaOferta}`);
  }, 20 * 60 * 1000);

  // 5. Briefing matutino (07:00 AM hora peninsular de Madrid)
  programarEnvioMatutino(async (textoBriefing) => {
    await enviarMensajeADavid(textoBriefing);
  });

  console.log(`[Servicios Proactivos] Todos los monitores conectados al WhatsApp de David (+${NUMERO_DAVID_AUTORIZADO}).`);
}

/**
 * Inicia el cliente Baileys de WhatsApp
 */
export async function iniciarWhatsApp() {
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
      console.log('\n======================================================');
      console.log('D.A.V.I.S. CONECTADO Y EN LINEA');
      console.log(`Copiloto táctico de David: +${NUMERO_BOT_SIMYO}`);
      console.log(`Usuario autorizado: David (+${NUMERO_DAVID_AUTORIZADO})`);
      console.log(`LID reconocido de David: ${LID_DAVID_CONOCIDO}@lid`);
      console.log('======================================================\n');

      inicializarServiciosProactivos();
    }
  });

  sock.ev.on('creds.update', saveCreds);

  // Procesamiento de mensajes entrantes
  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;

    for (const msg of messages) {
      if (!msg.message || msg.key.fromMe) continue;

      const remoteJid = msg.key.remoteJid;
      if (!remoteJid) continue;

      // 1. Buffer de mensajes de grupo para el Resumidor Inteligente
      if (remoteJid.endsWith('@g.us')) {
        recordGroupMessage(msg);
      }

      // 2. Filtro de seguridad con Buzon VIP y Respuestas de Terceros
      if (!esMensajeDeDavid(remoteJid)) {
        if (remoteJid.endsWith('@g.us')) continue;

        const remitenteLimpio = remoteJid.split('@')[0].replace(/\D/g, '');
        console.log(`[WhatsApp Mensaje Externo] Recibido de +${remitenteLimpio}: ${remoteJid}`);
        const textoExterno = extraerTextoMensaje(msg);
        if (textoExterno) {
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
        if (interactive.type === 'button' || interactive.type === 'list') {
          texto = interactive.id || interactive.text || interactive.title;
          console.log(`[WhatsApp Interactivo] Seleccion de usuario recibida: "${texto}"`);
        }
      }

      // 4. Manejo de notas de voz con Whisper y Clasificador de Urgencia
      if (msg.message.audioMessage) {
        console.log('[WhatsApp] Nota de voz recibida de David. Procesando audio con Whisper...');
        try {
          await sock.sendPresenceUpdate('recording', remoteJid);

          const audioBuffer = await downloadMediaMessage(
            msg,
            'buffer',
            {},
            { logger: pino({ level: 'silent' }), reuploadRequest: sock.updateMediaMessage }
          );

          const resVoz = await transcribirAudioBuffer(audioBuffer);

          if (resVoz.ok && resVoz.texto && resVoz.texto.length > 1) {
            texto = resVoz.texto;
            esAudio = true;
            console.log(`[Audio Transcrito]: "${texto}"`);

            const duracionSeg = msg.message.audioMessage?.seconds || 0;
            const urg = classifyUrgency(texto, duracionSeg);
            if (urg.isUrgent) {
              console.log(`[WhatsApp Urgencia Audio] Nivel: ${urg.level} (${urg.reason})`);
            }
            urgencyDirective = getUrgencyPromptDirective(urg);
          } else {
            console.warn('Aviso: Audio no pudo ser transcrito con claridad.');
            await sock.sendMessage(remoteJid, {
              text: 'Señor, he recibido su nota de voz pero no he podido transcribirla con claridad. ¿Podría repetírmela, por favor?'
            }, { quoted: msg });
            continue;
          }
        } catch (errAudio) {
          console.error('Error procesando nota de voz:', errAudio);
          await sock.sendMessage(remoteJid, {
            text: `Ha ocurrido una anomalía al procesar su nota de voz, señor: ${errAudio.message}`
          }, { quoted: msg });
          continue;
        }
      } else if (!texto) {
        texto = extraerTextoMensaje(msg);
      }

      if (!texto) continue;

      console.log(`\n[WhatsApp de David${esAudio ? ' (Audio)' : ''}]: "${texto}"`);

      // 5. Captura y persistencia automatica de Notas Personales
      const esSelfChat = remoteJid.includes(NUMERO_DAVID_AUTORIZADO);
      if (isPersonalNote(texto, esSelfChat)) {
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

          const frasesJarvis = [
            'A su servicio, señor. Ajustando la cazoleta y optimizando la mezcla al máximo rendimiento para su sesión.',
            'Por supuesto, señor. Presurizando la cámara y suministrando tabaco a la cachimba. Disfrute de su descanso.',
            'Parámetros térmicos estabilizados y mezcla renovada, señor. Disfrute de la sesión.',
            'A la orden, señor. Cachimba repuesta con mezcla premium y carbones a temperatura óptima.'
          ];
          const frase = frasesJarvis[Math.floor(Math.random() * frasesJarvis.length)];
          const bufferImagen = fs.readFileSync(RUTA_IMAGEN_CACHIMBA);

          const pieDeFoto = esAudio ? `[Nota de voz]: "${texto}"\n\n${frase}` : frase;

          await sock.sendMessage(remoteJid, {
            image: bufferImagen,
            caption: pieDeFoto
          }, { quoted: msg });

          await sock.sendPresenceUpdate('paused', remoteJid);
          console.log(`[J.A.R.V.I.S. a David]: [Imagen Cachimba enviada - "${frase}"]\n`);
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

      // Mantener el estado "escribiendo..." en WhatsApp mientras el LLM piensa
      const typingInterval = setInterval(() => {
        sock.sendPresenceUpdate('composing', remoteJid).catch(() => {});
      }, 4000);

      try {
        // 1. Confirmar lectura
        await sock.readMessages([msg.key]);

        // 2. Primer pulso de "escribiendo..."
        await sock.sendPresenceUpdate('composing', remoteJid);

        // 3. Procesar consulta con el agente
        const respuesta = await consultarJarvis(texto, [], { urgencyDirective });

        // 4. Detener estado de escritura y enviar respuesta
        clearInterval(typingInterval);
        await sock.sendPresenceUpdate('paused', remoteJid);

        // 7. Respuesta en Nota de Voz Nativa PTT (si David envió audio o solicitó voz)
        if (esAudio || /responde(me)?\s+(en|con)?\s*(audio|nota de voz|voz)/i.test(texto)) {
          console.log('[WhatsApp Voz PTT] Sintetizando respuesta de voz con Edge-TTS en OGG Opus...');
          try {
            const oggBuffer = await synthesizeSpeech(respuesta, { voice: 'es-ES-AlvaroNeural' });
            await sendVoiceNote(sock, remoteJid, oggBuffer, msg);
            console.log(`[J.A.R.V.I.S. a David]: [Nota de voz PTT enviada con éxito]\n`);
          } catch (errTts) {
            console.error('Error generando nota de voz PTT, recurriendo a texto:', errTts.message);
            await sock.sendMessage(remoteJid, { text: respuesta }, { quoted: msg });
          }
        } else {
          await sock.sendMessage(remoteJid, { text: respuesta }, { quoted: msg });
          console.log(`[J.A.R.V.I.S. a David]: "${respuesta}"\n`);
        }
      } catch (err) {
        clearInterval(typingInterval);
        console.error('Error procesando mensaje:', err);
        await sock.sendPresenceUpdate('paused', remoteJid);
        await sock.sendMessage(remoteJid, {
          text: `Señor, se ha producido una anomalía al procesar su solicitud: ${err.message}`
        }, { quoted: msg });
      }
    }
  });
}

// Iniciar automáticamente
iniciarWhatsApp().catch(err => {
  console.error('Error fatal iniciando el cliente de WhatsApp:', err);
});
