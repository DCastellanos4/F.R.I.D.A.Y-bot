#!/usr/bin/env node
/**
 * tester_client.js - Cliente de Baileys para la cuenta personal de David.
 *
 * Permite vincular la cuenta personal de David mediante codigo QR y expone un
 * servidor HTTP de control local (puerto 3005) para que el asistente/agente
 * ejecute pruebas de caso de uso reales enviando y recibiendo mensajes de D.A.V.I.S.
 *
 * Politica estricta: Cero emojis.
 */

import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion
} from '@whiskeysockets/baileys';
import pino from 'pino';
import qrcode from 'qrcode-terminal';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

// Cargar variables de entorno
dotenv.config({ path: path.join(ROOT_DIR, '.env') });

const BOT_PHONE = (process.env.BOT_PHONE || '34711222006').replace(/\D/g, '');
const BOT_LID = (process.env.BOT_LID || '160409176813702').replace(/\D/g, '');
const BOT_JID = `${BOT_PHONE}@s.whatsapp.net`;
const TESTER_PORT = Number(process.env.TESTER_PORT || 3005);
const AUTH_DIR = path.join(ROOT_DIR, 'data', 'auth_david_tester');

if (!fs.existsSync(AUTH_DIR)) {
  fs.mkdirSync(AUTH_DIR, { recursive: true });
}

console.log('================================================================');
console.log('    D.A.V.I.S. - CLIENTE LOCAL DE PRUEBAS WHATSAPP (DAVID)     ');
console.log('================================================================');
console.log('Telefono de DAVIS (Destino):', `+${BOT_PHONE}`);
console.log('JID de DAVIS:', BOT_JID);
console.log('Directorio de sesion personal:', AUTH_DIR);
console.log('Puerto HTTP de control:', TESTER_PORT);
console.log('================================================================\n');

let sock = null;
let estaConectado = false;
let usuarioConectado = null;
const historialMensajes = [];
const escuchadoresRespuesta = [];

function extraerTexto(msg) {
  if (!msg || !msg.message) return '';
  return (
    msg.message.conversation ||
    msg.message.extendedTextMessage?.text ||
    msg.message.imageMessage?.caption ||
    msg.message.videoMessage?.caption ||
    ''
  );
}

async function iniciarClienteDavid() {
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  const { version } = await fetchLatestBaileysVersion().catch(() => ({ version: [2, 3000, 1043857760] }));

  sock = makeWASocket({
    version,
    auth: state,
    logger: pino({ level: 'silent' }),
    printQRInTerminal: false,
    generateHighQualityLinkPreview: false,
    syncFullHistory: false
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log('\n======================================================');
      console.log('ESCANEA ESTE CODIGO QR CON TU WHATSAPP PERSONAL:');
      console.log('WhatsApp > Ajustes > Dispositivos vinculados > Vincular un dispositivo');
      console.log('======================================================\n');
      qrcode.generate(qr, { small: true });
    }

    if (connection === 'close') {
      estaConectado = false;
      usuarioConectado = null;
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const razon = DisconnectReason[statusCode] || statusCode;
      console.log(`[Tester David] Conexion cerrada. Razon: ${razon} (${statusCode})`);

      if (statusCode !== DisconnectReason.loggedOut) {
        console.log('[Tester David] Reconectando en 5 segundos...');
        setTimeout(() => iniciarClienteDavid(), 5000);
      } else {
        console.log('[Tester David] Sesion cerrada por WhatsApp. Para revincular, elimina data/auth_david_tester.');
      }
    } else if (connection === 'open') {
      estaConectado = true;
      usuarioConectado = sock.user?.id || 'David';
      console.log('\n======================================================');
      console.log('[Tester David] CONECTADO CON EXITO A WHATSAPP');
      console.log('Usuario activo:', usuarioConectado);
      console.log('Listo para enviar mensajes de prueba a DAVIS (+34711222006)');
      console.log(`Control HTTP activo en: http://127.0.0.1:${TESTER_PORT}`);
      console.log('======================================================\n');
    }
  });

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;

    for (const msg of messages) {
      if (!msg.message) continue;
      const remoteJid = msg.key.remoteJid;
      const esDeDavis = remoteJid && (
        remoteJid.includes(BOT_PHONE) ||
        remoteJid.includes(BOT_LID) ||
        remoteJid === BOT_JID
      );
      const texto = extraerTexto(msg);
      if (remoteJid) {
        console.log(`[Tester Socket Msg] De: ${remoteJid} (esDeDavis: ${esDeDavis}, fromMe: ${Boolean(msg.key.fromMe)}) | "${texto}"`);
      }

      if (esDeDavis && !msg.key.fromMe) {
        const item = {
          origen: 'davis',
          remitente: remoteJid,
          texto,
          timestamp: Date.now()
        };
        historialMensajes.push(item);
        if (historialMensajes.length > 50) historialMensajes.shift();

        console.log(`[Respuesta Recibida de DAVIS]: "${texto}"`);

        // Notificar a escuchadores pendientes de respuesta
        for (let i = escuchadoresRespuesta.length - 1; i >= 0; i--) {
          const l = escuchadoresRespuesta[i];
          if (l.minTimestamp && item.timestamp < l.minTimestamp) continue;
          l.resolver({
            texto,
            raw: msg,
            timestamp: Date.now()
          });
          escuchadoresRespuesta.splice(i, 1);
        }
      }
    }
  });
}

// Servidor de Control HTTP para el Agente
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  function responderJson(codigo, data) {
    res.writeHead(codigo, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
  }

  if (req.method === 'GET' && url.pathname === '/status') {
    return responderJson(200, {
      conectado: estaConectado,
      usuario: usuarioConectado,
      botJid: BOT_JID,
      botPhone: BOT_PHONE
    });
  }

  if (req.method === 'POST' && url.pathname === '/drain') {
    historialMensajes.length = 0;
    while (escuchadoresRespuesta.length > 0) {
      const l = escuchadoresRespuesta.pop();
      try { if (l.reject) l.reject(new Error('Drenado')); } catch {}
    }
    return responderJson(200, { ok: true, drenado: true });
  }

  if (req.method === 'GET' && url.pathname === '/history') {
    return responderJson(200, {
      total: historialMensajes.length,
      mensajes: historialMensajes
    });
  }

  if (req.method === 'POST' && (url.pathname === '/send' || url.pathname === '/ask')) {
    let bodyStr = '';
    req.on('data', (c) => (bodyStr += c));
    req.on('end', async () => {
      try {
        const payload = JSON.parse(bodyStr || '{}');
        const mensaje = payload.mensaje || payload.message || payload.prompt;

        if (!mensaje || typeof mensaje !== 'string') {
          return responderJson(400, { error: 'Falta campo mensaje (string) en el cuerpo' });
        }

        if (!estaConectado || !sock) {
          return responderJson(503, { error: 'Cliente de WhatsApp de David no conectado todavia' });
        }

        const tInicio = Date.now();
        console.log(`\n[Tester David -> DAVIS]: "${mensaje}"`);

        // Si es /send, solo enviamos y retornamos inmediatamente
        if (url.pathname === '/send') {
          await sock.sendMessage(BOT_JID, { text: mensaje });
          historialMensajes.push({
            origen: 'david',
            destinatario: BOT_JID,
            texto: mensaje,
            timestamp: tInicio
          });
          return responderJson(200, {
            enviado: true,
            mensaje,
            destinatario: BOT_JID,
            timestamp: tInicio
          });
        }

        // Si es /ask, enviamos y esperamos la respuesta de DAVIS
        const timeoutMs = Number(payload.timeoutMs || 25000);
        const respuestaPromesa = new Promise((resolve, reject) => {
          const timeout = setTimeout(() => {
            const idx = escuchadoresRespuesta.findIndex((e) => e.id === listenerId);
            if (idx !== -1) escuchadoresRespuesta.splice(idx, 1);
            reject(new Error(`Timeout de ${timeoutMs}ms esperando respuesta de DAVIS`));
          }, timeoutMs);

          const listenerId = Math.random().toString(36).substring(7);
          escuchadoresRespuesta.push({
            id: listenerId,
            minTimestamp: tInicio,
            reject: (err) => { clearTimeout(timeout); reject(err); },
            resolver: (resp) => {
              clearTimeout(timeout);
              resolve(resp);
            }
          });
        });

        await sock.sendMessage(BOT_JID, { text: mensaje });
        historialMensajes.push({
          origen: 'david',
          destinatario: BOT_JID,
          texto: mensaje,
          timestamp: tInicio
        });

        const respuesta = await respuestaPromesa;
        const latenciaMs = Date.now() - tInicio;

        return responderJson(200, {
          exito: true,
          mensajeEnviado: mensaje,
          respuestaDavis: respuesta.texto,
          latenciaMs,
          timestampEnvio: tInicio,
          timestampRespuesta: respuesta.timestamp
        });
      } catch (err) {
        return responderJson(500, {
          error: err.message,
          enlace: 'Error procesando solicitud de prueba'
        });
      }
    });
    return;
  }

  return responderJson(404, { error: 'Ruta no encontrada' });
});

server.listen(TESTER_PORT, '127.0.0.1', () => {
  iniciarClienteDavid().catch((err) => {
    console.error('[Error Critico al iniciar cliente de David]', err);
  });
});
