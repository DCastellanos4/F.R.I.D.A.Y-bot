/**
 * Worker del pool de ejecucion ReAct (RF-01 del ERS de proximo nivel).
 *
 * Consume trabajos "mensaje_entrante" de la cola duradera, reconstruye el
 * InboundMessage del puerto de entrada y ejecuta el procesador del core.
 * Despues de cada ronda de herramientas persiste un checkpoint (cuando el
 * agente invoca el hook onCheckpointRonda); si el worker muere a mitad,
 * el trabajo vuelve a pendiente al expirar su reclamo y la reanudacion
 * parte del ultimo checkpoint sin repetir herramientas con efectos ya
 * ejecutados (costura con el bucle ReAct del agente: el core recibe
 * opciones.checkpointInicial y opciones.onCheckpointRonda).
 *
 * La respuesta se encola en channel_responses con id determinista por
 * trabajo: una reejecucion tras caida nunca duplica la entrega al canal.
 * SIN garantia exactly-once para efectos EXTERNOS de herramientas: la
 * reejecucion tras una caida a mitad se apoya en la ventana de
 * idempotencia persistente del core; el checkpoint registra lo ya
 * completado y NUNCA reemite envios por su cuenta.
 *
 * Strict Policy: Zero Emojis.
 */
import { crearInboundMessage } from '../ports/inbound/InboundMessage.js';
import { afirmarJobQueue } from '../ports/outbound/JobQueuePort.js';

export function crearWorkerAgente({ cola, procesar, outboxStore } = {}) {
  afirmarJobQueue(cola);
  if (typeof procesar !== 'function') throw new TypeError('crearWorkerAgente requiere procesar.');
  if (!outboxStore) throw new TypeError('crearWorkerAgente requiere outboxStore.');

  async function manejar(trabajo) {
    if (trabajo.tipo !== 'mensaje_entrante') {
      throw new Error(`Tipo de trabajo desconocido: ${String(trabajo.tipo)}`);
    }
    const p = trabajo.payload || {};
    const inbound = crearInboundMessage({
      userId: p.userId,
      text: p.text,
      channel: p.channel || trabajo.canal,
      messageId: p.messageId ?? null,
      timestamp: p.timestamp ? new Date(p.timestamp) : new Date(),
      metadata: p.metadata && typeof p.metadata === 'object' ? p.metadata : {}
    });

    const ultimo = outboxStore.ultimoCheckpoint(trabajo.id);
    // Durabilidad visible: si guardar un checkpoint falla, el bucle sigue
    // (nunca se rompe la respuesta al usuario) pero el trabajo se entrega
    // declarando la degradacion, no simulando durabilidad.
    const fallosCheckpoint = [];
    const opciones = {
      ...(p.opciones && typeof p.opciones === 'object' ? p.opciones : {}),
      checkpointInicial: ultimo ? ultimo.estado : null,
      onCheckpointRonda: (ronda, estado) => {
        try {
          outboxStore.guardarCheckpoint(trabajo.id, ronda, estado);
        } catch (err) {
          fallosCheckpoint.push(String((err && err.message) || err).slice(0, 200));
        }
      }
    };

    const respuesta = await procesar(inbound, { historial: p.historial || [], opciones });
    outboxStore.encolarRespuesta({
      jobId: trabajo.id,
      canal: trabajo.canal,
      destinatario: inbound.userId,
      payload: {
        texto: typeof respuesta === 'string' ? respuesta : String(respuesta ?? ''),
        ...(fallosCheckpoint.length > 0
          ? { durabilidadCheckpoints: 'degradada', fallosCheckpoint: fallosCheckpoint.length }
          : {})
      }
    });
  }

  return Object.freeze({
    iniciar() {
      cola.consumir(manejar);
    },
    cerrar() {
      return cola.cerrar();
    }
  });
}
