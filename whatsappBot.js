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
import { iniciarVigilanteProactivo } from './proactiveAlerts.js';
import { iniciarSniperWatchdog } from './sniperService.js';
import { programarEnvioMatutino } from './dailyBriefing.js';
import { normalizarTexto } from './memoryService.js';
import { transcribirAudioBuffer } from './voiceService.js';
import { capturarPantallaWeb } from './browserService.js';

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
 * Soporta tanto formato clásico (@s.whatsapp.net) como el nuevo formato LID (@lid) de WhatsApp Multi-Device
 */
function esMensajeDeDavid(jid) {
  if (!jid) return false;

  // 1. Coincidencia por número telefónico autorizado
  if (NUMERO_DAVID_AUTORIZADO && jid.includes(NUMERO_DAVID_AUTORIZADO)) return true;

  // 2. Coincidencia por LID conocido
  if (LID_DAVID_CONOCIDO && jid.includes(LID_DAVID_CONOCIDO)) return true;

  // 3. Comprobación dinámica en los archivos de mapeo LID de Baileys
  try {
    const rawId = jid.split('@')[0].split(':')[0];
    const archivoMapeo = path.join(CARPETA_AUTH, `lid-mapping-${rawId}_reverse.json`);
    if (fs.existsSync(archivoMapeo)) {
      const mapeado = JSON.parse(fs.readFileSync(archivoMapeo, 'utf-8'));
      if (typeof mapeado === 'string' && NUMERO_DAVID_AUTORIZADO && mapeado.includes(NUMERO_DAVID_AUTORIZADO)) {
        return true;
      }
    }
  } catch (err) {
    // ignorar error de lectura
  }

  return false;
}

/**
 * Extrae texto de forma exhaustiva desempaquetando mensajes estándar, efímeros y viewOnce
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
 * Detecta solicitudes de David para poner más tabaco a la cachimba (Easter Egg Tony Stark)
 */
export function esPeticionCachimba(texto) {
  if (!texto) return false;
  const t = normalizarTexto(texto);

  // No interceptar si es un recordatorio o alarma programada ("recuérdame comprar tabaco...")
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
    console.warn('⚠️ [WhatsApp] Intento de envío proactivo pero el cliente no está en línea.');
    return false;
  }
  const payload = typeof contenido === 'string' ? { text: contenido } : contenido;
  try {
    await sock.sendMessage(jidDavidActivo, payload);
    console.log(`📤 [WhatsApp Alerta Enviada a David] Destino: ${jidDavidActivo}`);
    return true;
  } catch (err) {
    console.warn(`⚠️ Error enviando alerta a ${jidDavidActivo}, probando canal @s.whatsapp.net:`, err.message);
    try {
      await sock.sendMessage(`${NUMERO_DAVID_AUTORIZADO}@s.whatsapp.net`, payload);
      return true;
    } catch (err2) {
      console.error(`❌ Error fatal enviando alerta proactiva a David:`, err2.message);
      return false;
    }
  }
}

/**
 * Registra los disparadores proactivos en segundo plano (vigilante, recordatorios, sniper y briefing)
 */
function inicializarServiciosProactivos() {
  if (serviciosIniciados) return;
  serviciosIniciados = true;

  console.log(`🚀 [Servicios Proactivos] Vinculando alertas proactivas al chat de David...`);

  // 1. Monitor del servidor Oracle y Minecraft (cada 5 minutos)
  iniciarVigilanteProactivo(async (alerta) => {
    await enviarMensajeADavid(`🚨 *ALERTA TÁCTICA F.R.I.D.A.Y.:*\n\n${alerta}`);
  }, 5 * 60 * 1000);

  // 2. Monitor de recordatorios programados (cada 30 segundos)
  iniciarMonitorRecordatorios(async (recordatorio) => {
    const textoAviso = `⏰ *RECORDATORIO TÁCTICO DE F.R.I.D.A.Y.:*\n\nDavid, tal como me programó: *"${recordatorio.mensaje}"*.\n\n_Tarea completada y archivada, señor._`;
    await enviarMensajeADavid(textoAviso);
  }, 30 * 1000);

  // 3. Sniper Watchdog de artículos y ofertas (cada 20 minutos)
  iniciarSniperWatchdog(async (alertaOferta) => {
    await enviarMensajeADavid(alertaOferta);
  }, 20 * 60 * 1000);

  // 4. Briefing matutino (07:00 AM hora peninsular de Madrid)
  programarEnvioMatutino(async (textoBriefing) => {
    await enviarMensajeADavid(textoBriefing);
  });

  console.log(`✅ [Servicios Proactivos] Todos los monitores conectados al WhatsApp de David (+${NUMERO_DAVID_AUTORIZADO}).`);
}

/**
 * Inicia el cliente Baileys de WhatsApp
 */
export async function iniciarWhatsApp() {
  const { state, saveCreds } = await useMultiFileAuthState(CARPETA_AUTH);
  const { version } = await fetchLatestBaileysVersion();

  console.log(`📡 Conectando WhatsApp con Baileys (v${version.join('.')})...`);

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
    browser: ['FRIDAY Linux', 'Chrome', '122.0.0']
  });

  if (pairingNumber && !sock.authState.creds.registered) {
    setTimeout(async () => {
      try {
        const code = await sock.requestPairingCode(pairingNumber);
        console.log('\n======================================================');
        console.log(`🔑 CÓDIGO DE VINCULACIÓN PARA LA SIM (+${pairingNumber}):`);
        console.log(`👉  ${code}  👈`);
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
      console.log('📱 ESCANEA ESTE CÓDIGO QR CON EL WHATSAPP DEL BOT:');
      console.log('Abre WhatsApp > Ajustes > Dispositivos vinculados > Vincular un dispositivo');
      console.log('======================================================\n');
      qrcode.generate(qr, { small: true });
    }

    if (connection === 'close') {
      estaConectado = false;
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const razon = DisconnectReason[statusCode] || statusCode;
      console.log(`⚠️ Conexión de WhatsApp cerrada. Razón: ${razon} (${statusCode})`);

      if (statusCode !== DisconnectReason.loggedOut) {
        console.log('🔄 Reconectando WhatsApp en 5 segundos...');
        setTimeout(() => iniciarWhatsApp(), 5000);
      } else {
        console.log('❌ Sesión cerrada por WhatsApp. Para volver a vincular, elimina data/auth_info_baileys.');
      }
    } else if (connection === 'open') {
      estaConectado = true;
      console.log('\n======================================================');
      console.log('🟢 ¡F.R.I.D.A.Y. CONECTADA Y EN LÍNEA!');
      console.log(`🤖 Asistente Táctica: +${NUMERO_BOT_SIMYO}`);
      console.log(`👤 Jefe / Usuario Autorizado: David (+${NUMERO_DAVID_AUTORIZADO})`);
      console.log(`🆔 LID Reconocido de David: ${LID_DAVID_CONOCIDO}@lid`);
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

      // Filtro de seguridad estricto: solo mensajes de David
      if (!esMensajeDeDavid(remoteJid)) {
        console.log(`🔒 [WhatsApp] Mensaje bloqueado de remitente no autorizado: ${remoteJid}`);
        continue;
      }

      // Actualizar el JID activo para futuras respuestas y alertas
      jidDavidActivo = remoteJid;

      let texto = null;
      let esAudio = false;

      // Manejo inteligente de notas de voz con Whisper
      if (msg.message.audioMessage) {
        console.log('🎤 [WhatsApp] Nota de voz recibida de David. Procesando audio con Whisper...');
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
            console.log(`🎤 [Audio Transcrito]: "${texto}"`);
          } else {
            console.warn('⚠️ Audio no pudo ser transcrito con claridad.');
            await sock.sendMessage(remoteJid, {
              text: '🎤 David, he recibido tu nota de voz pero no he podido transcribirla con claridad. ¿Podrías repetírmela o escribírmela?'
            }, { quoted: msg });
            continue;
          }
        } catch (errAudio) {
          console.error('❌ Error descargando/transcribiendo nota de voz:', errAudio);
          await sock.sendMessage(remoteJid, {
            text: `⚠️ David, ha ocurrido un error al procesar tu nota de voz: ${errAudio.message}`
          }, { quoted: msg });
          continue;
        }
      } else {
        texto = extraerTextoMensaje(msg);
      }

      if (!texto) continue;

      console.log(`\n📩 [WhatsApp de David${esAudio ? ' (Audio)' : ''}]: "${texto}"`);

      // Easter Egg: Solicitud de más tabaco para la cachimba
      if (esPeticionCachimba(texto) && fs.existsSync(RUTA_IMAGEN_CACHIMBA)) {
        console.log(`🎯 [Easter Egg Cachimba Activado] Solicitado por David: "${texto}"`);
        try {
          await sock.readMessages([msg.key]);
          await sock.sendPresenceUpdate('composing', remoteJid);

          const frasesFriday = [
            'A la orden, jefe. Calibrando cazoleta y aumentando la mezcla al 100%. Protocolo Stark activado.',
            'Entendido, David. Presurizando la cámara y añadiendo más tabaco a la cachimba. Disfrute de la sesión, señor.',
            'Sistemas térmicos al máximo, jefe. Más tabaco en la cazoleta y flujo de aire optimizado.',
            'A la orden, David. Cachimba repuesta con mezcla premium y carbones al máximo rendimiento.'
          ];
          const frase = frasesFriday[Math.floor(Math.random() * frasesFriday.length)];
          const bufferImagen = fs.readFileSync(RUTA_IMAGEN_CACHIMBA);

          const pieDeFoto = esAudio ? `🎤 _"${texto}"_\n\n${frase}` : frase;

          await sock.sendMessage(remoteJid, {
            image: bufferImagen,
            caption: pieDeFoto
          }, { quoted: msg });

          await sock.sendPresenceUpdate('paused', remoteJid);
          console.log(`📤 [FRIDAY a David]: [Imagen Cachimba enviada con éxito - "${frase}"]\n`);
          continue;
        } catch (errEaster) {
          console.error('❌ Error enviando imagen de cachimba:', errEaster);
        }
      }

      // Solicitud de captura de pantalla web con Playwright
      const tieneUrl = /(https?:\/\/[^\s]+)/i.test(texto);
      const pideCaptura = /(haz(me)?|saca(me)?|pasa(me)?|envia(me)?|toma(me)?)\s+(una\s+)?(captura|screenshot|foto)\s+(de\s+)?(la\s+)?(web|pagina|enlace|noticia)?/i.test(texto) ||
                          /(captura|screenshot)\s+(de\s+)?(la\s+)?(web|pagina|enlace|noticia)?/i.test(texto);

      if (tieneUrl && pideCaptura) {
        const urlCaptura = texto.match(/https?:\/\/[^\s]+/i)[0];
        console.log(`📸 [WhatsApp Captura Web] Solicitada por David: ${urlCaptura}`);
        try {
          await sock.readMessages([msg.key]);
          await sock.sendPresenceUpdate('composing', remoteJid);

          const resCap = await capturarPantallaWeb(urlCaptura);
          if (resCap.ok && resCap.buffer) {
            const pieCaptura = esAudio
              ? `🎤 _"${texto}"_\n\n📸 *Captura táctica realizada en vivo con Playwright Chromium:*\n🔗 ${urlCaptura}`
              : `📸 *Captura táctica realizada en vivo con Playwright Chromium:*\n🔗 ${urlCaptura}`;

            await sock.sendMessage(remoteJid, {
              image: resCap.buffer,
              caption: pieCaptura
            }, { quoted: msg });

            await sock.sendPresenceUpdate('paused', remoteJid);
            console.log(`📤 [FRIDAY a David]: [Captura de pantalla de ${urlCaptura} enviada con éxito]\n`);
            continue;
          } else {
            console.warn(`Aviso: Error capturando pantalla: ${resCap.error}`);
          }
        } catch (errCap) {
          console.error('❌ Error capturando pantalla web:', errCap);
        }
      }

      // Mantener el estado "escribiendo..." en WhatsApp mientras Ollama piensa
      const typingInterval = setInterval(() => {
        sock.sendPresenceUpdate('composing', remoteJid).catch(() => {});
      }, 4000);

      try {
        // 1. Confirmar lectura
        await sock.readMessages([msg.key]);

        // 2. Primer pulso de "escribiendo..."
        await sock.sendPresenceUpdate('composing', remoteJid);

        // 3. Procesar consulta con el agente
        const respuesta = await consultarJarvis(texto);

        // 4. Detener estado de escritura y enviar respuesta
        clearInterval(typingInterval);
        await sock.sendPresenceUpdate('paused', remoteJid);

        const respuestaFinal = esAudio
          ? `🎤 _"${texto}"_\n\n${respuesta}`
          : respuesta;

        await sock.sendMessage(remoteJid, { text: respuestaFinal }, { quoted: msg });

        console.log(`📤 [FRIDAY a David]: "${respuesta}"\n`);
      } catch (err) {
        clearInterval(typingInterval);
        console.error('❌ Error procesando mensaje de Jarvis:', err);
        await sock.sendPresenceUpdate('paused', remoteJid);
        await sock.sendMessage(remoteJid, {
          text: `⚠️ David, ha ocurrido un error al procesar tu solicitud: ${err.message}`
        }, { quoted: msg });
      }
    }
  });
}

// Iniciar automáticamente
iniciarWhatsApp().catch(err => {
  console.error('Error fatal iniciando el bot de WhatsApp:', err);
});
