/**
 * Adaptador del JobQueuePort sobre el outbox SQLite (RF-01).
 *
 * Sondeo periodico de outbox_events: sirve como transporte de desarrollo
 * y como cola monoproceso sin infraestructura extra. NO es el broker
 * distribuido del ERS: el carril BullMQ/Redis queda como deuda de
 * infraestructura visible hasta que se provisione Redis en el VPS.
 *
 * El procesamiento dentro de un ciclo es secuencial: con un solo
 * operario el orden de los efectos importa mas que el paralelismo.
 *
 * Strict Policy: Zero Emojis.
 */
import { afirmarJobQueue } from '../../../ports/outbound/JobQueuePort.js';

export function crearSqliteOutboxQueue({
  outboxStore,
  intervaloMs = 200,
  limitePorCiclo = 4,
  expiracionMs = 60000,
  maxIntentos = 5,
  backoffMs = 1000
} = {}) {
  if (!outboxStore) throw new TypeError('crearSqliteOutboxQueue requiere outboxStore.');

  let temporizador = null;
  let manejador = null;
  let cicloEnCurso = null;
  let cerrado = false;

  async function ejecutarCiclo() {
    if (cerrado || !manejador) return;
    outboxStore.recuperarExpirados({ expiracionMs });
    const trabajos = outboxStore.reclamarPendientes({ limite: limitePorCiclo });
    for (const trabajo of trabajos) {
      if (cerrado) return;
      try {
        await manejador(trabajo);
        outboxStore.marcarCompletado(trabajo.id);
      } catch (err) {
        outboxStore.marcarFallido(trabajo.id, err, { maxIntentos, backoffMs });
      }
    }
  }

  function programarCiclo() {
    if (cerrado) return;
    cicloEnCurso = ejecutarCiclo()
      .catch(() => { /* el fallo de un ciclo no detiene la cola */ })
      .finally(() => {
        cicloEnCurso = null;
        if (!cerrado && manejador) {
          temporizador = setTimeout(programarCiclo, intervaloMs);
          if (typeof temporizador.unref === 'function') temporizador.unref();
        }
      });
  }

  const cola = Object.freeze({
    publicar(trabajo) {
      return outboxStore.publicar(trabajo);
    },
    consumir(fn) {
      if (typeof fn !== 'function') throw new TypeError('consumir requiere un manejador.');
      manejador = fn;
      if (!temporizador && !cicloEnCurso) programarCiclo();
    },
    async cerrar() {
      cerrado = true;
      if (temporizador) clearTimeout(temporizador);
      temporizador = null;
      if (cicloEnCurso) await cicloEnCurso.catch(() => {});
    }
  });
  return afirmarJobQueue(cola);
}
