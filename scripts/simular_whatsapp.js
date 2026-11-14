/**
 * simular_whatsapp.js - Simulador directo de mensajes entrantes de WhatsApp para pruebas y auditoria.
 *
 * Permite a David y a agentes automatizados enviar mensajes simulados con la identidad
 * del propietario y recibir la respuesta exacta de D.A.V.I.S. a traves del contenedor hexagonal,
 * sin necesidad de levantar socket Baileys ni enviar datos a servidores externos.
 *
 * Uso:
 *   node scripts/simular_whatsapp.js "hola Davis, que tengo hoy en la agenda?"
 *   node scripts/simular_whatsapp.js  (modo interactivo REPL)
 *
 * Strict Policy: Zero Emojis.
 */

import readline from 'node:readline';
import { procesarMensajeEntrante } from '../src/composition/container.js';
import { crearInboundMessage } from '../src/ports/inbound/InboundMessage.js';
import { config } from '../src/config/config.js';

const PHONE_PROPIETARIO = process.env.AUTHORIZED_USER_PHONE || config.userPhone || '34600000000';
const CHAT_ID = `${PHONE_PROPIETARIO}@s.whatsapp.net`;

async function ejecutarConsulta(texto) {
  const t0 = Date.now();
  console.log(`\n==================================================`);
  console.log(`[WhatsApp Simulador] Inbound: "${texto}"`);
  console.log(`[WhatsApp Simulador] Remitente: ${PHONE_PROPIETARIO} (propietario)`);
  console.log(`==================================================`);

  try {
    const inbound = crearInboundMessage({
      userId: PHONE_PROPIETARIO,
      sender: CHAT_ID,
      text: texto,
      channel: 'whatsapp',
      esPropietario: true
    });

    const respuesta = await procesarMensajeEntrante(inbound);
    const duracion = ((Date.now() - t0) / 1000).toFixed(2);

    console.log(`\n[D.A.V.I.S. Responde (${duracion}s)]:`);
    console.log(typeof respuesta === 'string' ? respuesta : JSON.stringify(respuesta, null, 2));
    console.log(`==================================================\n`);
  } catch (err) {
    console.error(`[WhatsApp Simulador] Error ejecutando mensaje:`, err.message);
  }
}

async function main() {
  const args = process.argv.slice(2).join(' ').trim();
  if (args) {
    await ejecutarConsulta(args);
    process.exit(0);
  }

  console.log('==================================================');
  console.log(' SIMULADOR INTERACTIVO WHATSAPP - D.A.V.I.S.');
  console.log(' Escribe cualquier consulta o "salir" para terminar.');
  console.log('==================================================');

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: 'WhatsApp > '
  });

  rl.prompt();

  rl.on('line', async (line) => {
    const clean = line.trim();
    if (!clean) {
      rl.prompt();
      return;
    }
    if (clean.toLowerCase() === 'salir' || clean.toLowerCase() === 'exit') {
      rl.close();
      return;
    }

    await ejecutarConsulta(clean);
    rl.prompt();
  }).on('close', () => {
    console.log('[Simulador] Sesion finalizada.');
    process.exit(0);
  });
}

main();
