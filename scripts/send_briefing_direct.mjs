// Envia el briefing matutino a David a traves de la cola de alertas.
//
// ANTES importaba whatsappBot.js para llamar a enviarMensajeADavid: bajo pm2
// ese import arranca un SEGUNDO cliente de WhatsApp con la misma sesion
// (conflicto 409 con el bot en marcha) y, sin pm2, nunca conectaba y solo
// imprimia el texto. La via segura es encolar: el proceso jarvis-whatsapp ya
// en ejecucion vacia la cola y entrega el mensaje con su sesion viva.
import { enqueueAlert } from '../src/services/alertQueueService.js';
import { generarBriefingCompleto } from '../src/services/dailyBriefing.js';

try {
  const briefing = await generarBriefingCompleto('Madrid');
  enqueueAlert({
    title: 'D.A.V.I.S. - BRIEFING MATUTINO',
    details: briefing,
    priority: 'high'
  });
  console.log('BRIEFING_ENCOLADO: el bot en ejecucion lo entregara a David.');
} catch (err) {
  console.error('ERROR_ENCOLANDO_BRIEFING:', err.message);
  process.exit(1);
}
process.exit(0);
