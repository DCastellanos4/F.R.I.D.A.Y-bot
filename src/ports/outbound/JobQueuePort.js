/**
 * Puerto de salida del hexagono: cola duradera de trabajos del agente
 * (RF-01 del ERS de proximo nivel).
 *
 * El core publica trabajos y registra manejadores sin saber si detras hay
 * un sondeo sobre el outbox SQLite (desarrollo, monoproceso) o una cola
 * BullMQ sobre Redis (produccion distribuida). La eleccion vive en la
 * raiz de composicion, como el resto de adaptadores.
 *
 * Contrato:
 *   publicar(trabajo) -> Promise<string>|string
 *     trabajo: { tipo, tenantId, canal, payload } con payload serializable
 *     a JSON. Devuelve el id del trabajo encolado.
 *   consumir(manejador, opciones) -> void
 *     El manejador recibe { id, tipo, tenantId, canal, payload, intentos }.
 *     Si lanza, la cola aplica su politica de reintento; el manejador no
 *     reintenta por su cuenta.
 *   cerrar() -> Promise<void>|void
 *     Detiene el consumo y espera a los trabajos en curso.
 *
 * Strict Policy: Zero Emojis.
 */

export function afirmarJobQueue(cola) {
  if (!cola || typeof cola !== 'object') {
    throw new TypeError('JobQueuePort: la cola debe ser un objeto.');
  }
  for (const metodo of ['publicar', 'consumir', 'cerrar']) {
    if (typeof cola[metodo] !== 'function') {
      throw new TypeError(`JobQueuePort: falta el metodo obligatorio "${metodo}".`);
    }
  }
  return cola;
}
