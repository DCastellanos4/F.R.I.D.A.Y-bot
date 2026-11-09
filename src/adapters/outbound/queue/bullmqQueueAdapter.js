/**
 * Adaptador del JobQueuePort sobre BullMQ/Redis (RF-01, carril de
 * produccion distribuida del ERS).
 *
 * PENDIENTE DE INFRAESTRUCTURA: bullmq/ioredis no son dependencias
 * instaladas y Redis no esta provisionado en el VPS. Este adaptador se
 * carga de forma perezosa: mientras falte la dependencia o el broker,
 * cualquier uso lanza un error claro en el arranque (fallo cerrado),
 * nunca una caida silenciosa al sondeo SQLite, que ocultaria la deuda.
 *
 * La raiz de composicion solo elige este adaptador con DAVIS_QUEUE=redis.
 *
 * Strict Policy: Zero Emojis.
 */
import { afirmarJobQueue } from '../../../ports/outbound/JobQueuePort.js';

export function crearBullmqQueueAdapter({
  url = process.env.DAVIS_REDIS_URL || 'redis://127.0.0.1:6379',
  nombreCola = 'davis-agente',
  maxIntentos = 5,
  backoffMs = 1000
} = {}) {
  let queue = null;
  let worker = null;

  async function cargar() {
    if (queue) return;
    let mod;
    try {
      mod = await import('bullmq');
    } catch {
      throw new Error(
        'BullMQ/Redis no disponible: falta "npm install bullmq ioredis" y un broker Redis ' +
        'provisionado (deuda de infraestructura del RF-01). Mientras tanto usa DAVIS_QUEUE=sqlite.'
      );
    }
    const conexion = { url };
    queue = new mod.Queue(nombreCola, { connection: conexion });
    worker = null;
  }

  const cola = Object.freeze({
    async publicar(trabajo) {
      await cargar();
      const job = await queue.add(trabajo.tipo, trabajo, {
        attempts: maxIntentos,
        backoff: { type: 'linear', delay: backoffMs }
      });
      return String(job.id);
    },
    consumir(manejador) {
      if (typeof manejador !== 'function') throw new TypeError('consumir requiere un manejador.');
      cargar()
        .then(async () => {
          const mod = await import('bullmq');
          worker = new mod.Worker(
            nombreCola,
            async (job) => {
              const d = job.data || {};
              await manejador({
                id: String(job.id),
                tipo: d.tipo || job.name,
                tenantId: d.tenantId,
                canal: d.canal,
                payload: d.payload ?? {},
                intentos: job.attemptsMade || 0
              });
            },
            { connection: { url } }
          );
        })
        .catch((err) => {
          // Fallo cerrado: sin broker no se consume nada y el error queda
          // visible en el arranque del worker.
          console.error('[BullMQ] No se pudo iniciar el consumo:', err.message);
          throw err;
        });
    },
    async cerrar() {
      if (worker) await worker.close();
      if (queue) await queue.close();
      worker = null;
      queue = null;
    }
  });
  return afirmarJobQueue(cola);
}
