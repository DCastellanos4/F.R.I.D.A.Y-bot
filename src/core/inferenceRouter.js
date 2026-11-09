/**
 * inferenceRouter.js - Enrutador de inferencia especulativa hibrida
 * (RF-02 del ERS): nivel 1 SLM local con escalada a la nube.
 *
 * Decision de via por peticion:
 *   - Sin servicio SLM (deshabilitado o sin modelo configurado): nube,
 *     motivo 'slm_deshabilitado'. Es el modo actual del sistema; el
 *     enrutador nunca empeora el comportamiento existente.
 *   - Tenant sin acceso a inferencia local: nube, motivo
 *     'tenant_sin_acceso_local'. La politica es fail-closed: solo el
 *     propietario por defecto; cada tenant adicional requiere alta
 *     explicita en tenantsLocalesPermitidos (la cuota TPM de Groq se
 *     reserva por tenant; el SLM comparte la CPU del VPS entre todos,
 *     por eso el acceso local se concede por tenant, no por defecto).
 *   - SLM disponible y permitido: se intenta local. Solo pasa con
 *     confianza >= umbral Y esquema valido (lo decide el servicio SLM);
 *     cualquier otro desenlace escala a nube con el motivo declarado.
 *
 * La via nube es SIEMPRE el chatCompletion inyectado por la raiz de
 * composicion (hoy llmService historico, Groq gpt-oss-120b/20b). Este
 * modulo NO elige modelo ni proveedor cloud: las alternativas que
 * menciona el ERS (llama-3.3-70b, OpenAI, Anthropic, Gemini) quedan
 * fuera por decision vigente de mantener el proveedor gratuito actual.
 *
 * Telemetria por inyeccion (telemetry.js no se toca en este bloque):
 * cada decision se comunica a deps.registrarDecision con metadatos sin
 * contenido de mensajes. El contrato de la metrica
 * tokens_saved_by_local_slm esta en docs/integracion-rf02.md; el ahorro
 * es una ESTIMACION (tokens de entrada de la llamada cloud evitada, por
 * bytes como groqBudget.estimarTokensPeticion), no una medicion de
 * coste.
 *
 * Strict Policy: Zero Emojis.
 */

/**
 * @param {Object} deps
 * @param {Object|null} deps.slm       Servicio localSlmInferenceService o null.
 * @param {Function} deps.chatCompletionNube  Via nube existente (obligatoria).
 * @param {Object} [deps.politica]
 * @param {Set<string>|Array<string>} [deps.politica.tenantsLocalesPermitidos]
 *        Tenants (ademas del propietario) con acceso a inferencia local.
 * @param {Function} [deps.registrarDecision] (decision) => void; no-op por
 *        defecto. decision = { via, motivo, tarea, intencion?, confianza?,
 *        latenciaLocalMs?, tokensAhorradosEstimados?, tenant }.
 * @param {Function} [deps.estimarTokensEntrada] (messages) => numero;
 *        por defecto bytes/3 como groqBudget.estimarTokensPeticion.
 */
export function crearEnrutadorInferencia({
  slm = null,
  chatCompletionNube,
  politica = {},
  registrarDecision,
  estimarTokensEntrada
} = {}) {
  if (typeof chatCompletionNube !== 'function') {
    throw new TypeError('inferenceRouter: chatCompletionNube (funcion) es obligatorio.');
  }
  const registrar = typeof registrarDecision === 'function' ? registrarDecision : () => {};
  const estimar = typeof estimarTokensEntrada === 'function'
    ? estimarTokensEntrada
    : (messages) => Math.ceil(Buffer.byteLength(JSON.stringify(messages || []), 'utf8') / 3);
  const permitidos = new Set(politica.tenantsLocalesPermitidos || []);

  function accesoLocalPermitido(ctx = {}) {
    const tenant = ctx.tenantId || 'propietario';
    return tenant === 'propietario' || permitidos.has(tenant);
  }

  /**
   * Clasificacion de intencion con escalada. Salida compatible con el
   * consumidor actual (intentRouterService): { intencion, confianza,
   * via, origen } mas metadatos de la decision.
   */
  async function clasificarIntencion(mensaje, etiquetas, ctx = {}) {
    const tenant = ctx.tenantId || 'propietario';

    if (!slm) {
      const res = await chatCompletionNube(peticionClasificacionNube(mensaje, etiquetas));
      registrar({ via: 'cloud', motivo: 'slm_deshabilitado', tarea: 'clasificacion', tenant });
      return { ...leerClasificacionNube(res, etiquetas), via: 'cloud', motivo: 'slm_deshabilitado' };
    }
    if (!accesoLocalPermitido(ctx)) {
      const res = await chatCompletionNube(peticionClasificacionNube(mensaje, etiquetas));
      registrar({ via: 'cloud', motivo: 'tenant_sin_acceso_local', tarea: 'clasificacion', tenant });
      return { ...leerClasificacionNube(res, etiquetas), via: 'cloud', motivo: 'tenant_sin_acceso_local' };
    }

    const local = await slm.clasificarIntencion(mensaje, etiquetas);
    if (local.exito) {
      registrar({
        via: 'local_slm', motivo: 'ok', tarea: 'clasificacion', tenant,
        intencion: local.intencion, confianza: local.confianza,
        latenciaLocalMs: local.latenciaMs,
        tokensAhorradosEstimados: estimar(peticionClasificacionNube(mensaje, etiquetas).messages)
      });
      return { intencion: local.intencion, confianza: local.confianza, via: 'local_slm', origen: 'modelo' };
    }

    const res = await chatCompletionNube(peticionClasificacionNube(mensaje, etiquetas));
    registrar({
      via: 'cloud', motivo: local.motivo, tarea: 'clasificacion', tenant,
      confianza: local.confianza, latenciaLocalMs: local.latenciaMs
    });
    return { ...leerClasificacionNube(res, etiquetas), via: 'cloud', motivo: local.motivo };
  }

  /**
   * Extraccion de argumentos con escalada. La via nube devuelve la
   * respuesta cruda del LLM historico (que ya sabe extraer con sus
   * propios mecanismos); el llamador conserva su flujo actual.
   */
  async function extraerArgumentos(mensaje, nombreHerramienta, esquema, ctx = {}) {
    const tenant = ctx.tenantId || 'propietario';

    if (!slm || !accesoLocalPermitido(ctx)) {
      const motivo = !slm ? 'slm_deshabilitado' : 'tenant_sin_acceso_local';
      registrar({ via: 'cloud', motivo, tarea: 'extraccion', tenant });
      return { exito: false, via: 'cloud', motivo };
    }

    const local = await slm.extraerArgumentos(mensaje, nombreHerramienta, esquema);
    if (local.exito) {
      registrar({
        via: 'local_slm', motivo: 'ok', tarea: 'extraccion', tenant,
        confianza: local.confianza, latenciaLocalMs: local.latenciaMs,
        tokensAhorradosEstimados: estimar([{ role: 'user', content: mensaje }])
      });
      return local;
    }

    registrar({
      via: 'cloud', motivo: local.motivo, tarea: 'extraccion', tenant,
      confianza: local.confianza, latenciaLocalMs: local.latenciaMs
    });
    return { exito: false, via: 'cloud', motivo: local.motivo, violaciones: local.violaciones };
  }

  return Object.freeze({ clasificarIntencion, extraerArgumentos });
}

function peticionClasificacionNube(mensaje, etiquetas) {
  return {
    messages: [
      { role: 'system', content: [
          'Clasifica la intencion principal del mensaje del usuario en UNA de estas etiquetas:',
          (etiquetas || []).join(', ') + '.',
          'Responde SOLO con un JSON: {"intencion": "<etiqueta>", "confianza": <numero entre 0 y 1>}.',
          'Sin emojis, sin explicaciones.'
        ].join(' ') },
      { role: 'user', content: mensaje }
    ],
    options: { temperature: 0, num_predict: 60 }
  };
}

function leerClasificacionNube(res, etiquetas) {
  const contenido = res?.message?.content || '';
  const m = contenido.match(/\{[\s\S]*?\}/);
  if (m) {
    try {
      const datos = JSON.parse(m[0]);
      const intencion = String(datos.intencion || '').trim();
      const confianza = Number(datos.confianza);
      if ((etiquetas || []).includes(intencion) && isFinite(confianza) && confianza >= 0 && confianza <= 1) {
        return { intencion, confianza, origen: 'modelo' };
      }
    } catch { /* parse fallido: se declara abajo */ }
  }
  return { intencion: null, confianza: 0, origen: 'modelo' };
}
