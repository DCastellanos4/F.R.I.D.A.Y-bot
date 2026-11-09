/**
 * Entregador de respuestas del outbox (RF-01): mueve channel_responses
 * pendientes al adaptador del canal (MessageChannelPort) y las marca
 * entregadas SOLO si el envio resolvio.
 *
 * Entrega con estado incierto durable: la respuesta se marca 'enviando'
 * ANTES de llamar al canal; si el proceso muere con el envio resuelto y
 * sin marcar, la respuesta queda 'incierta' para reconciliacion y NUNCA
 * se reenvia automaticamente (misma politica que los envios programados
 * inciertos). Un fallo de envio confirmado si reintenta.
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
    // Cierre de inciertos ANTES de nuevos envios: un 'enviando' expirado
    // pudo haber llegado al destinatario; se declara, no se reenvia.
    outboxStore.recuperarEnviosIncertos({});
    const pendientes = outboxStore.respuestasPendientes({ limite: limitePorCiclo });
    for (const resp of pendientes) {
      if (cerrado) return;
      const canal = adaptadores.get(resp.canal);
      if (!canal) continue; // canal sin adaptador en este proceso: no se toca
      if (!outboxStore.marcarRespuestaEnviando(resp.id)) continue; // la tomo otro
      try {
        await canal.enviarTexto(resp.destinatario, resp.payload?.texto ?? '');
      } catch {
        // El canal NO confirmo el envio: vuelve a pendiente y reintenta.
        outboxStore.volverRespuestaAPendiente(resp.id);
        continue;
      }
      try {
        outboxStore.marcarRespuestaEntregada(resp.id);
      } catch {
        // Muerte parcial: el envio pudo resolverse. Queda 'enviando'; el
        // cierre de inciertos la saca de circulacion (nunca reenvio ciego).
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
