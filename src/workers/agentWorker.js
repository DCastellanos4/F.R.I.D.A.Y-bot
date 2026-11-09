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

export function crearWorkerAgente({ cola, procesar, outboxStore, auditoria = null } = {}) {
  afirmarJobQueue(cola);
  if (typeof procesar !== 'function') throw new TypeError('crearWorkerAgente requiere procesar.');
  if (!outboxStore) throw new TypeError('crearWorkerAgente requiere outboxStore.');

  // RNF-04: una clave de accion es `nombre:JSON.stringify(args)` con args
  // tal y como llegan del LLM (a veces cadena JSON sin parsear). Se
  // interpreta a la defensiva; lo que no se entiende se audita como texto.
  function interpretarClaveAccion(clave) {
    const texto = String(clave || '');
    const corte = texto.indexOf(':');
    const nombre = (corte >= 0 ? texto.slice(0, corte) : texto).trim() || 'desconocida';
    let args = corte >= 0 ? texto.slice(corte + 1) : '';
    for (let i = 0; i < 2 && typeof args === 'string'; i++) {
      try { args = JSON.parse(args); } catch { break; }
    }
    return { nombre, args: (args && typeof args === 'object') ? args : { crudo: args } };
  }

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
    // RNF-04: cada accion con efectos se audita UNA vez por trabajo, en el
    // momento de su marca durable (antes de ejecutarse). La respuesta de
    // la herramienta no es visible en esta costura: queda declarado como
    // limite (args solamente) en docs/ers-integracion-estado.md.
    const accionesAuditadas = new Set();
    const opciones = {
      ...(p.opciones && typeof p.opciones === 'object' ? p.opciones : {}),
      checkpointInicial: ultimo ? ultimo.estado : null,
      onCheckpointRonda: (ronda, estado) => {
        try {
          outboxStore.guardarCheckpoint(trabajo.id, ronda, estado);
        } catch (err) {
          fallosCheckpoint.push(String((err && err.message) || err).slice(0, 200));
          throw err; // el agente bloquea el efecto si no hay marca durable
        }
        if (auditoria && Array.isArray(estado?.accionesPlanificadas)) {
          for (const clave of estado.accionesPlanificadas) {
            const claveTxt = String(clave);
            if (accionesAuditadas.has(claveTxt)) continue;
            accionesAuditadas.add(claveTxt);
            const { nombre, args } = interpretarClaveAccion(claveTxt);
            try {
              auditoria.registrar({ tenantId: trabajo.tenantId || 'propietario', herramienta: nombre, args });
            } catch (err) {
              // La auditoria NO rompe el procesamiento; se declara.
              fallosCheckpoint.push(`auditoria:${String((err && err.message) || err).slice(0, 160)}`);
            }
          }
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
