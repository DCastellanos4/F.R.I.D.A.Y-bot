import readline from 'readline';
// Canal CLI sobre el hexagono: mismo puerto de entrada que WhatsApp.
// config.js primero: carga el .env (DAVIS_PERSISTENCE, etc.) antes del contenedor.
import './src/config/config.js';
import { procesarMensajeEntrante } from './src/composition/container.js';
import { crearInboundMessage } from './src/ports/inbound/InboundMessage.js';
import { confirmAndExecute } from './src/system/bashConsoleService.js';

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

console.clear();
console.log('====================================================');
console.log('[D.A.V.I.S.] F.R.I.D.A.Y. - TERMINAL TÁCTICA INTERACTIVA');
console.log('====================================================');
console.log('Puedes pedirle recordatorios, clima, noticias, memoria o charlar.');
console.log('Escribe "salir" o pulsa Ctrl+C para terminar.\n');

const historial = [];

function promptUsuario() {
  rl.question('[David] David: ', async (entrada) => {
    const texto = entrada.trim();
    if (!texto) {
      promptUsuario();
      return;
    }

    if (texto.toLowerCase() === 'salir' || texto.toLowerCase() === 'exit') {
      console.log('\nHasta luego, jefe. Sistemas en reposo.');
      process.exit(0);
    }

    try {
      const mOtp = texto.match(/^confirma(?:r|me)?\s+(?:otp\s+|c[oó]digo\s+|codigo\s+)?[:#-]?\s*(\d{6})\s*$/i);
      if (mOtp) {
        const resOtp = await confirmAndExecute(mOtp[1]);
        console.log('\n[2FA]', resOtp.status === 'EXECUTED' ? `Comando "${resOtp.command}" ejecutado:` : `No confirmado: ${resOtp.error || resOtp.status}`);
        if (resOtp.status === 'EXECUTED') console.log(resOtp.stdout || resOtp.stderr || '(sin salida)');
        promptUsuario();
        return;
      }

      console.log('\n[D.A.V.I.S.] FRIDAY está evaluando...');
      const inicio = Date.now();
      const inbound = crearInboundMessage({ userId: 'cli-local', text: texto, channel: 'cli' });
      const respuesta = await procesarMensajeEntrante(inbound, {
        historial,
        opciones: {
        otpDelivery: async ({ otpCode, ttlSeconds, command }) => {
          console.log(`\n[2FA] Codigo OTP para "${command}": ${otpCode} (valido ${ttlSeconds}s). Escribe: confirmar otp ${otpCode}`);
        }
        }
      });
      const tiempo = ((Date.now() - inicio) / 1000).toFixed(1);

      console.log(`\n[Chat] FRIDAY (${tiempo}s):`);
      console.log(respuesta);
      console.log('\n----------------------------------------------------');

      // Mantener memoria de contexto en la conversación
      historial.push({ role: 'user', content: texto });
      historial.push({ role: 'assistant', content: respuesta });
      if (historial.length > 8) {
        historial.splice(0, 2);
      }
    } catch (err) {
      console.error('\n[Error] Error al consultar a FRIDAY:', err.message);
    }

    promptUsuario();
  });
}

promptUsuario();
