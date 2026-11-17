/**
 * scripts/tester_client.js - Cliente Baileys local para pruebas reales de David contra DAVIS
 *
 * Utiliza auth_david_tester (ignorado en git).
 * Conecta como la cuenta de David y permite enviar mensajes a DAVIS (+34711222006)
 * y escuchar sus respuestas para testing E2E real.
 *
 * Strict Policy: Zero Emojis.
 */
import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion
} from '@whiskeysockets/baileys';
import pino from 'pino';
import qrcode from 'qrcode-terminal';
import path from 'node:path';
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const AUTH_DIR = path.resolve(__dirname, '../data/auth_david_tester');
const DAVIS_PHONE = '34711222006';
const DAVIS_JID = `${DAVIS_PHONE}@s.whatsapp.net`;

if (!fs.existsSync(AUTH_DIR)) {
  fs.mkdirSync(AUTH_DIR, { recursive: true });
}

let sock = null;
let conectado = false;
const listenersRespuesta = new Set();

export async function iniciarClienteTester({ onReady = null, onMensajeDavis = null } = {}) {
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  const { version } = await fetchLatestBaileysVersion();

  sock = makeWASocket({
    version,
    auth: state,
    logger: pino({ level: 'silent' }),
    printQRInTerminal: false
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log('\n======================================================');
      console.log('ESCANEA ESTE CODIGO QR CON TU WHATSAPP (DAVID)');
      console.log('Dispositivos vinculados > Vincular un dispositivo');
      console.log('======================================================\n');
      qrcode.generate(qr, { small: true });

      try {
        const brainDir = path.resolve('C:/Users/David/.gemini/antigravity/brain/12cc0def-ac13-431b-881c-30e41612b4b3');
        if (!fs.existsSync(brainDir)) fs.mkdirSync(brainDir, { recursive: true });
        const imgPath1 = path.join(brainDir, 'qr_whatsapp.png');
        const imgPath2 = path.join(AUTH_DIR, 'qr_whatsapp.png');
        const pyCode = `import qrcode; img = qrcode.make('''${qr}'''); img.save(r'${imgPath1}'); img.save(r'${imgPath2}')`;
        const tempPy = path.join(AUTH_DIR, 'gen_qr.py');
        fs.writeFileSync(tempPy, pyCode, 'utf-8');
        execSync(`python "${tempPy}"`, { stdio: 'inherit' });
        console.log('[QR Imagen PNG Generada en]:', imgPath1);
      } catch (errGen) {
        console.error('Error generando PNG de QR:', errGen.message);
      }
    }

    if (connection === 'close') {
      conectado = false;
      const codigo = lastDisconnect?.error?.output?.statusCode;
      const debeReconectar = codigo !== DisconnectReason.loggedOut;
      console.log(`Conexion cerrada. Codigo: ${codigo}. Reconectar: ${debeReconectar}`);
      if (debeReconectar) {
        setTimeout(() => iniciarClienteTester({ onReady, onMensajeDavis }), 3000);
      } else {
        console.log('Sesion cerrada (logged out). Elimina data/auth_david_tester para volver a empezar.');
      }
    } else if (connection === 'open') {
      conectado = true;
      const jidUsuario = sock.user?.id || '';
      console.log('\n======================================================');
      console.log('CLIENTE TESTER CONECTADO COMO DAVID');
      console.log(`JID propio: ${jidUsuario}`);
      console.log(`Objetivo DAVIS: ${DAVIS_JID}`);
      console.log('======================================================\n');
      if (typeof onReady === 'function') onReady(sock);
    }
  });

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    for (const m of messages) {
      if (!m.message) continue;
      const remitente = m.key.remoteJid || '';
      const participant = m.key.participant || '';
      const isFromMe = m.key.fromMe;
      const texto = m.message.conversation ||
                    m.message.extendedTextMessage?.text ||
                    '';

      // Log para diagnostico
      if (!isFromMe && texto) {
        console.log(`[Mensaje Entrante]: de=${remitente} part=${participant} type=${type} -> "${texto.slice(0, 80)}"`);
      }

      // Comprobar si proviene de DAVIS (por numero, LID o JID)
      const esDavis = remitente.includes(DAVIS_PHONE) ||
                      remitente === DAVIS_JID ||
                      participant.includes(DAVIS_PHONE) ||
                      participant === DAVIS_JID;

      // Si no es de mi mismo y no es de otro chat conocido (o si viene en el chat de DAVIS)
      if (!isFromMe && (esDavis || remitente.endsWith('@lid') || remitente.includes(DAVIS_PHONE))) {
        console.log(`\n[DAVIS Responde]: "${texto}"`);
        if (typeof onMensajeDavis === 'function') onMensajeDavis(texto, m);
        for (const listener of listenersRespuesta) {
          try { listener(texto, m); } catch {}
        }
      }
    }
  });

  return sock;
}

export async function enviarMensajeADavis(texto, timeoutMs = 60000) {
  if (!sock || !conectado) throw new Error('Cliente no conectado a WhatsApp.');
  console.log(`\n[David envia a DAVIS]: "${texto}"`);

  return new Promise(async (resolve, reject) => {
    const timer = setTimeout(() => {
      listenersRespuesta.delete(handler);
      reject(new Error(`Timeout (${timeoutMs / 1000}s) esperando respuesta de DAVIS.`));
    }, timeoutMs);

    const handler = (textoDavis) => {
      clearTimeout(timer);
      listenersRespuesta.delete(handler);
      resolve(textoDavis);
    };

    listenersRespuesta.add(handler);
    try {
      await sock.sendMessage(DAVIS_JID, { text: texto });
    } catch (err) {
      clearTimeout(timer);
      listenersRespuesta.delete(handler);
      reject(err);
    }
  });
}

// Ejecucion directa por linea de comandos
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const modoTest = process.argv.includes('--test');

  iniciarClienteTester({
    onReady: async () => {
      if (!modoTest) {
        console.log('Sesion vinculada y activa. Para ejecutar tests automaticos usa:');
        console.log('node scripts/tester_client.js --test\n');
        return;
      }

      console.log('Iniciando bateria de pruebas E2E contra DAVIS en 3 segundos...');
      await new Promise((r) => setTimeout(r, 3000));

      const pruebas = [
        {
          nombre: 'Prueba 1: Saludo y estado general',
          mensaje: 'hola davis que tal?',
          validar: (r) => r.length > 0
        },
        {
          nombre: 'Prueba 2: Consulta de habitos (SQLite)',
          mensaje: 'mis habitos',
          validar: (r) => r.toLowerCase().includes('habito') || r.toLowerCase().includes('racha') || r.toLowerCase().includes('sigues')
        },
        {
          nombre: 'Prueba 3: Envio de mensaje a Paula sin pedir numero',
          mensaje: 'escribele un mensaje a paula diciendo hola desde el test e2e',
          validar: (r) => !r.toLowerCase().includes('necesito el número') && !r.toLowerCase().includes('bloqueado')
        }
      ];

      for (const p of pruebas) {
        console.log(`\n------------------------------------------------------`);
        console.log(`EJECUTANDO: ${p.nombre}`);
        console.log(`------------------------------------------------------`);
        try {
          const inicio = Date.now();
          const resp = await enviarMensajeADavis(p.mensaje);
          const duracion = ((Date.now() - inicio) / 1000).toFixed(2);
          const ok = p.validar(resp);
          console.log(`Resultado: ${ok ? 'PASO' : 'FALLO'} (${duracion}s)`);
          if (!ok) console.warn(`Validacion insatisfecha con respuesta: ${resp}`);
        } catch (err) {
          console.error(`ERROR en ${p.nombre}:`, err.message);
        }
        await new Promise((r) => setTimeout(r, 4000));
      }

      console.log('\nBateria de pruebas E2E completada.');
      process.exit(0);
    }
  });
}
