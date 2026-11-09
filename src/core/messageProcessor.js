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

export function crearMessageProcessor({ llmProvider, memoryRepository, metricasClasificador, crearStoreMetricas, rutaArchivoIdempotenciaDefecto, accesoTenants = null, enrutadorInferencia = null } = {}) {
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
      return conSpan('mensaje_entrante', {
        canal: String(inbound.channel || 'desconocido').slice(0, 30),
        sesion: hashSesion(inbound.userId)
      }, () => (enAmbito ? consultarJarvisEnAmbito : consultarJarvis)(inbound.text, historial, opcionesConPuertos));
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
