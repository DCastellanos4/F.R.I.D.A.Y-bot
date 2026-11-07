import { generarBriefingCompleto } from '../src/services/dailyBriefing.js';
import { enviarMensajeADavid } from '../whatsappBot.js';

try {
  const briefing = await generarBriefingCompleto('Madrid');
  const mensaje = '[D.A.V.I.S. READY - COGNITIVE UPGRADE OPERATIVO]\n\n' + briefing;
  if (typeof enviarMensajeADavid === 'function') {
    await enviarMensajeADavid(mensaje);
    console.log('BRIEFING_ENVIADO_EXITO');
  } else {
    console.log('ENVIAR_MENSAJE_NO_DISPONIBLE');
    console.log(mensaje);
  }
} catch (err) {
  console.error('ERROR_ENVIANDO_BRIEFING:', err.message);
  process.exit(1);
}
process.exit(0);
