import { enqueueAlert } from '../src/services/alertQueueService.js';
import { generarBriefingCompleto } from '../src/services/dailyBriefing.js';

const briefing = await generarBriefingCompleto('Madrid');
enqueueAlert({
  title: 'D.A.V.I.S. READY - COGNITIVE UPGRADE OPERATIVO',
  details: 'Bucle ReAct autonomo (5 rondas), RAG Vectorial Local, Router Multi-Agente y Guardarrailes pre-envio 100% operativos.\n\n' + briefing,
  priority: 'high'
});
console.log('ALERTA_ENCOLADA_EXITO');
