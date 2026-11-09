/**
 * Entregador de respuestas del outbox (RF-01): mueve channel_responses
 * pendientes al adaptador del canal (MessageChannelPort) y las marca
 * entregadas SOLO si el envio resolvio.
 *
 * Entrega al-menos-una-vez declarada: si el envio sale pero el proceso
 * muere antes de marcar, la respuesta se reenvia al volver. La
 * deduplicacion fina depende del canal (WhatsApp no ofrece ids de
 * idempotencia de envio): la ventana es estrecha y queda declarada, no
 * oculta.
 *
 * Strict Policy: Zero Emojis.
 */
import { afirmarMessageChannel } from '../ports/outbound/MessageChannelPort.js';

export function crearEntregadorRespuestas({ outboxStore, canales = {}, intervaloMs = 500, limitePorCiclo = 20 } = {}) {
  if (!outboxStore) throw new TypeError('crearEntregadorRespuestas requiere outboxStore.');
  const adaptadores = new Map();
  for (const [nombre, canal] of Object.entries(canales)) {
    adaptadores.set(String(nombre).toLowerCase(), afirmarMessageChannel(canal));
  }

  let temporizador = null;
  let cicloEnCurso = null;
  let cerrado = false;

  async function ciclo() {
    const pendientes = outboxStore.respuestasPendientes({ limite: limitePorCiclo });
    for (const resp of pendientes) {
      if (cerrado) return;
      const canal = adaptadores.get(resp.canal);
      if (!canal) continue; // canal sin adaptador en este proceso: no se toca
      try {
        await canal.enviarTexto(resp.destinatario, resp.payload?.texto ?? '');
        outboxStore.marcarRespuestaEntregada(resp.id);
      } catch {
        // Queda pendiente para el siguiente ciclo (al-menos-una-vez).
      }
    }
  }

  function programar() {
    if (cerrado) return;
    cicloEnCurso = ciclo()
      .catch(() => {})
      .finally(() => {
        cicloEnCurso = null;
        if (!cerrado) {
          temporizador = setTimeout(programar, intervaloMs);
          if (typeof temporizador.unref === 'function') temporizador.unref();
        }
      });
  }

  return Object.freeze({
    iniciar() { programar(); },
    async cerrar() {
      cerrado = true;
      if (temporizador) clearTimeout(temporizador);
      temporizador = null;
      if (cicloEnCurso) await cicloEnCurso.catch(() => {});
    }
  });
}
