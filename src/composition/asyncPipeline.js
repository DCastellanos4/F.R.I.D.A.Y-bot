/**
 * Pipeline asincrono completo del RF-01, cableado en local e INERTE por
 * defecto: recepcion con ack inmediato (escritura outbox atomica), cola
 * duradera, worker ReAct con checkpoints y entregador de respuestas.
 *
 * DAVIS_ASYNC_PIPELINE=1 elige el pipeline; DAVIS_QUEUE=redis elige
 * el puente de notificaciones ID-only con reclamos SQLite. Sin esos flags
 * no se activa. Desplegar/activar requiere una ventana separada revisada.
 *
 * Strict Policy: Zero Emojis.
 */
import { crearSqliteOutboxStore } from '../adapters/outbound/persistence/sqlite/sqliteOutboxStore.js';
import { crearSqliteOutboxQueue } from '../adapters/outbound/queue/sqliteOutboxQueueAdapter.js';
import { crearBullmqQueueAdapter } from '../adapters/outbound/queue/bullmqQueueAdapter.js';
import { crearOutboxBrokerBridge } from '../adapters/outbound/queue/outboxBrokerBridge.js';
import { crearSqliteClaimStore } from '../adapters/outbound/persistence/sqlite/sqliteClaimStore.js';
import { crearWorkerAgente } from '../workers/agentWorker.js';
import { crearEntregadorRespuestas } from '../workers/responseDeliverer.js';

// Seleccion cerrada. Redis usa el puente durable de IDs; nunca cae a SQLite
// como transporte silenciosamente si el broker falla.
export function validarSelectorCola(selector = process.env.DAVIS_QUEUE) {
  if (selector === undefined || selector === 'sqlite') return 'sqlite';
  if (selector === 'redis') return 'redis';
  throw new TypeError('RF01_QUEUE_SELECTOR_UNSUPPORTED');
}

export function crearPipelineAsincrono({ db, procesar, canales = {}, cola = null, auditoria = null, intervaloColaMs = 200, intervaloEntregaMs = 500, brokerIds = null, selectorCola = process.env.DAVIS_QUEUE, opcionesPuente = {} } = {}) {
  const selector = validarSelectorCola(selectorCola); // antes de SQL, workers o timers
  if (selector === 'redis' && cola) throw new Error('RF01_REDIS_REQUIRES_CLAIM_BRIDGE');
  if (!db) throw new TypeError('crearPipelineAsincrono requiere db.');
  if (typeof procesar !== 'function') throw new TypeError('crearPipelineAsincrono requiere procesar.');
  const outboxStore = crearSqliteOutboxStore(db);
  const claimStore = selector === 'redis' ? crearSqliteClaimStore(db, outboxStore) : null;
  const colaActiva = selector === 'redis'
    ? crearOutboxBrokerBridge({outboxStore,claimStore,broker:brokerIds || crearBullmqQueueAdapter(),intervaloMs:intervaloColaMs,...opcionesPuente})
    : (cola || crearSqliteOutboxQueue({ outboxStore, intervaloMs: intervaloColaMs }));
  const worker = crearWorkerAgente({ cola: colaActiva, procesar, outboxStore, auditoria,claimStore });
  const entregador = crearEntregadorRespuestas({ outboxStore, canales, intervaloMs: intervaloEntregaMs });

  return Object.freeze({
    outboxStore,
    estadoCola: () => ({selector,...(colaActiva.estado?.() || {})}),
    /**
     * Recepcion con ack inmediato: persiste el mensaje en el outbox en
     * una unica escritura y devuelve sin esperar al procesamiento. El
     * canal que la use puede ack en milisegundos; la medicion real del
     * presupuesto de 5 ms del ERS queda para la prueba con el canal vivo.
     */
    recibir(inbound, { tenantId = 'propietario' } = {}) {
      // Intake ACK never waits for Redis after the durable SQLite insert.
      return (selector === 'redis' ? colaActiva : outboxStore).publicar({
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
