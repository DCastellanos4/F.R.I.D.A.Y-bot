/**
 * Nucleo del hexagono: punto de entrada unico para mensajes de cualquier
 * canal.
 *
 * Recibe un InboundMessage (puerto de entrada) y lo procesa con el agente
 * inyectando los puertos de salida (proveedor LLM, repositorio de memoria)
 * en las opciones del agente. El agente conserva sus opciones historicas:
 * una opcion explicita de la llamada siempre gana a la del contenedor
 * (asi las pruebas y el bot pueden seguir sobreescribiendo piezas).
 *
 * Strict Policy: Zero Emojis.
 */
import { consultarJarvis, consultarJarvisEnAmbito } from './jarvisAgent.js';
import { afirmarLLMProvider } from '../ports/outbound/LLMProviderPort.js';
import { afirmarMemoryRepository } from '../ports/outbound/MemoryRepositoryPort.js';
import { conSpan, hashSesion } from '../observability/telemetry.js';
import { clasificarIntencionConModelo } from './intentRouterService.js';

// Confirmaciones desnudas: mismo vocabulario que la guardia historica
// (specialistRouterService); estos mensajes SIEMPRE llegan al agente.
const CONFIRMACIONES_DESNUDAS = new Set([
  'si', 'ok', 'vale', 'hazlo', 'procede', 'adelante', 'continua', 'dale',
  'confirmo', 'correcto', 'exacto', 'eso', 'yes', 'no'
]);

function esConfirmacionDesnuda(texto) {
  const limpio = String(texto || '').trim().toLowerCase().replace(/[.!,?¿¡]+/g, '').trim();
  return CONFIRMACIONES_DESNUDAS.has(limpio);
}

// Filtro de salida del bypass conversacional (mismas reglas de superficie
// que una respuesta del agente). Devuelve el texto listo para entregar o
// null si NO debe entregarse (cae al agente):
//  - emojis eliminados (politica estricta zero-emoji del canal);
//  - afirmar una accion ya ejecutada ('he enviado...', 'ya lo borre...')
//    o prometer una futura ('te aviso', 'queda programado') es
//    representacion falsa de ejecucion: el nivel 1 no ejecuta nada.
const EMOJI_REGEX = /\p{Extended_Pictographic}/gu;
const RE_ACCION_EJECUTADA = /\b(he|ya|acabo de)\s+(enviado|mandado|borrado|eliminado|creado|guardado|agendado|programado|apagado|encendido|comprado|pagado|reservado|publicado|recordado|avisado)\b/i;
const RE_PROMESA_FUTURA = /\b(te\s+(aviso|avisare|mando|enviare|recuerdo)|queda(n)?\s+(programado|agendado|hecho|listo)|lo\s+(hare|hago\s+(luego|despues|mas tarde)))\b/i;

function prepararRespuestaConversacion(respuesta, exito) {
  if (exito !== true || typeof respuesta !== 'string') return null;
  const limpia = respuesta.replace(EMOJI_REGEX, '').replace(/[ \t]{2,}/g, ' ').trim();
  if (!limpia) return null;
  if (RE_ACCION_EJECUTADA.test(limpia) || RE_PROMESA_FUTURA.test(limpia)) return null;
  return limpia;
}

function ultimoTurnoPideConfirmacion(historial) {
  if (!Array.isArray(historial)) return false;
  for (let i = historial.length - 1; i >= 0; i--) {
    const turno = historial[i];
    const rol = turno && (turno.role || turno.rol);
    if (rol !== 'assistant') continue;
    const contenido = String((turno && (turno.content ?? turno.contenido)) || '').toLowerCase();
    return /responde "si"|hasta que confirmes|confirmacion|confirmar|lo registro hasta/.test(contenido);
  }
  return false;
}

export function crearMessageProcessor({ llmProvider, memoryRepository, metricasClasificador, crearStoreMetricas, rutaArchivoIdempotenciaDefecto, accesoTenants = null, enrutadorInferencia = null, buscadorHibrido = null } = {}) {
  if (llmProvider !== undefined) afirmarLLMProvider(llmProvider);
  if (memoryRepository !== undefined) afirmarMemoryRepository(memoryRepository);

  async function procesar(inbound, { historial = [], opciones = {} } = {}, enAmbito = false) {
      let acceso = null;
      if (accesoTenants) {
        try { acceso = await accesoTenants.resolver(inbound); } catch { return 'Acceso no disponible para este usuario.'; }
        if (!acceso) return 'Acceso no disponible para este usuario.';
      }
      // Si se instala acceso autenticado, sus parametros de seguridad ganan
      // SIEMPRE a las opciones del llamador. Ningun texto/metadata elige tenant.
      const opcionesConPuertos = { ...opciones, ...(acceso || {}) };

      if (llmProvider) {
        if (typeof opcionesConPuertos.chatCompletion !== 'function') {
          opcionesConPuertos.chatCompletion = (peticion) => llmProvider.chatCompletion(peticion);
        }
        if (!opcionesConPuertos.llmProvider) {
          opcionesConPuertos.llmProvider = llmProvider;
        }
      }
      if (memoryRepository && !opcionesConPuertos.memoryRepository) {
        opcionesConPuertos.memoryRepository = memoryRepository;
      }
      // RF-02: enrutador especulativo inyectado por la raiz de composicion
      // (null salvo DAVIS_SLM_MODEL); una opcion explicita del llamador gana.
      if (enrutadorInferencia && !opcionesConPuertos.enrutadorInferencia) {
        opcionesConPuertos.enrutadorInferencia = enrutadorInferencia;
      }
      // RF-03: buscador hibrido inyectado por la raiz de composicion
      // (null sin QDRANT_URL); una opcion explicita del llamador gana y
      // sin el la busqueda sigue el camino historico.
      if (buscadorHibrido && !opcionesConPuertos.buscadorHibrido) {
        opcionesConPuertos.buscadorHibrido = buscadorHibrido;
      }
      // Metricas del clasificador: puerto inyectado; una ruta historica
      // suelta se traduce a store aqui (la raiz conoce adaptadores, el
      // core no).
      if (!opcionesConPuertos.metricasClasificador) {
        if (opcionesConPuertos.rutaArchivoMetricasClasificador && typeof crearStoreMetricas === 'function') {
          opcionesConPuertos.metricasClasificador = crearStoreMetricas({ rutaArchivo: opcionesConPuertos.rutaArchivoMetricasClasificador });
        } else if (metricasClasificador) {
          opcionesConPuertos.metricasClasificador = metricasClasificador;
        }
      }
      if (inbound.channel && !opcionesConPuertos.channel) {
        opcionesConPuertos.channel = inbound.channel;
      }
      // Estado de pruebas aislado: la raiz de composicion decide la ruta
      // por defecto (tmp por proceso bajo NODE_ENV=test); el core no toca fs.
      if (!opcionesConPuertos.rutaArchivoIdempotencia && rutaArchivoIdempotenciaDefecto) {
        opcionesConPuertos.rutaArchivoIdempotencia = rutaArchivoIdempotenciaDefecto;
      }

      // Span raiz de la peticion: el TraceId de este mensaje atraviesa
      // clasificacion, llamadas LLM, herramientas y escrituras de BD.
      // Atributos: solo metadatos (canal y hash opaco de sesion), NUNCA
      // el texto del mensaje (privacidad, regla dura de telemetria).
      // El bypass conversacional vive DENTRO del span: las trazas no se
      // pierden cuando el nivel 1 responde sin agente.
      return conSpan('mensaje_entrante', {
        canal: String(inbound.channel || 'desconocido').slice(0, 30),
        sesion: hashSesion(inbound.userId)
      }, async () => {
        // RF-02 consumo (conversacion): con enrutador especulativo activo,
        // un mensaje clasificado como charla pura con respuesta local de
        // confianza suficiente se responde en el nivel 1 sin invocar al
        // agente. Cualquier otro desenlace sigue el camino historico
        // EXACTO. La clasificacion se cachea por mensaje normalizado, asi
        // que cuando el agente clasifica despues reutiliza la misma.
        // GUARDIAS (la confianza autodeclarada del SLM NO es seguridad):
        //  - mensajes de confirmacion desnuda ('si', 'vale', 'hazlo'...)
        //    NUNCA se interceptan: pueden confirmar una accion pendiente.
        //  - si el ultimo turno del asistente pide confirmacion, tampoco.
        //  - aqui no se ejecuta ninguna herramienta: solo se devuelve texto.
        //  - la respuesta del nivel 1 pasa las MISMAS guardias de salida
        //    que la del agente: sin emojis, y si declara una accion
        //    ejecutada o promete una futura (fingir envio/borrado/
        //    programacion) NO se entrega: cae al agente, que es el unico
        //    que puede ejecutar y representar ejecuciones. Heuristica de
        //    defensa en profundidad, NO certifica seguridad por si sola.
        if (enrutadorInferencia && typeof enrutadorInferencia.responderConversacion === 'function'
            && !esConfirmacionDesnuda(inbound.text) && !ultimoTurnoPideConfirmacion(historial)) {
          try {
            const clas = await clasificarIntencionConModelo(inbound.text, opcionesConPuertos);
            if (clas && clas.intencion === 'conversacion' && clas.confianza >= 0.6) {
              const local = await enrutadorInferencia.responderConversacion(inbound.text, undefined, { tenantId: opcionesConPuertos.tenantId });
              const saneada = prepararRespuestaConversacion(local && local.respuesta, local && local.exito);
              if (saneada) return saneada;
            }
          } catch (errConv) {
            console.warn('[RF-02] Conversacion nivel 1 no disponible; camino historico:', errConv && errConv.message);
          }
        }
        return (enAmbito ? consultarJarvisEnAmbito : consultarJarvis)(inbound.text, historial, opcionesConPuertos);
      });
  }
  return Object.freeze({
    procesarMensajeEntrante: (inbound, ctx) => procesar(inbound, ctx, false),
    // Ruta interna de ensayo: mismo acceso autenticado, omite solo gate publico.
    // No se instala ni expone en ningun canal productivo.
    procesarMensajeEnAmbito: (inbound, ctx) => {
      if (!accesoTenants) throw new Error('Ensayo tenant requiere acceso autenticado.');
      return procesar(inbound, ctx, true);
    }
  });
}
