/**
 * Pipeline asincrono completo del RF-01, cableado en local e INERTE por
 * defecto: recepcion con ack inmediato (escritura outbox atomica), cola
 * duradera, worker ReAct con checkpoints y entregador de respuestas.
 *
 * La sustitucion del camino sincrono de whatsappBot es carril de
 * produccion y NO se hace aqui: este modulo solo compone las piezas para
 * pruebas y para la activacion coordinada (DAVIS_ASYNC_PIPELINE=1 en la
 * ventana correspondiente).
 *
 * Strict Policy: Zero Emojis.
 */
import { crearSqliteOutboxStore } from '../adapters/outbound/persistence/sqlite/sqliteOutboxStore.js';
import { crearSqliteOutboxQueue } from '../adapters/outbound/queue/sqliteOutboxQueueAdapter.js';
import { crearWorkerAgente } from '../workers/agentWorker.js';
import { crearEntregadorRespuestas } from '../workers/responseDeliverer.js';

export function crearPipelineAsincrono({ db, procesar, canales = {}, cola = null, auditoria = null, intervaloColaMs = 200, intervaloEntregaMs = 500 } = {}) {
  if (!db) throw new TypeError('crearPipelineAsincrono requiere db.');
  if (typeof procesar !== 'function') throw new TypeError('crearPipelineAsincrono requiere procesar.');
  const outboxStore = crearSqliteOutboxStore(db);
  const colaActiva = cola || crearSqliteOutboxQueue({ outboxStore, intervaloMs: intervaloColaMs });
  const worker = crearWorkerAgente({ cola: colaActiva, procesar, outboxStore, auditoria });
  const entregador = crearEntregadorRespuestas({ outboxStore, canales, intervaloMs: intervaloEntregaMs });

  return Object.freeze({
    outboxStore,
    /**
     * Recepcion con ack inmediato: persiste el mensaje en el outbox en
     * una unica escritura y devuelve sin esperar al procesamiento. El
     * canal que la use puede ack en milisegundos; la medicion real del
     * presupuesto de 5 ms del ERS queda para la prueba con el canal vivo.
     */
    recibir(inbound, { tenantId = 'propietario' } = {}) {
      return outboxStore.publicar({
        tenantId,
        canal: inbound.channel,
        tipo: 'mensaje_entrante',
        payload: {
          userId: inbound.userId,
          text: inbound.text,
          channel: inbound.channel,
          messageId: inbound.messageId ?? null,
          timestamp: inbound.timestamp instanceof Date ? inbound.timestamp.toISOString() : new Date().toISOString(),
          metadata: inbound.metadata || {}
        }
      });
    },
    iniciar() {
      worker.iniciar();
      entregador.iniciar();
    },
    /** Alta en caliente del adaptador de canal (cuando abre sesion). */
    registrarCanal(nombre, adaptador) {
      entregador.registrarCanal(nombre, adaptador);
    },
    async cerrar() {
      await worker.cerrar();
      await entregador.cerrar();
    }
  });
}
