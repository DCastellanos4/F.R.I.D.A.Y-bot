/**
 * localSlmInferenceService.js - Nivel 1 de la inferencia especulativa
 * (RF-02 del ERS): tareas resolubles por un SLM local.
 *
 * Tres capacidades, todas con la misma disciplina de salida:
 *   1. Clasificacion de intenciones (etiqueta + confianza).
 *   2. Extraccion determinista de argumentos JSON para herramientas
 *      simples, validada contra el esquema declarado por el llamador.
 *   3. Respuestas conversacionales estandar.
 *
 * Criterio de exito local (ERS): confianza >= umbral (0.82 por defecto)
 * Y JSON valido contra el esquema. Cualquier otra salida es un fallo de
 * nivel 1 declarado con motivo, para que el enrutador escale a la nube;
 * este servicio nunca finge un exito.
 *
 * HONESTIDAD DE CALIBRACION: la confianza es la que el propio SLM
 * declara. No esta calibrada hasta medirla con la bateria dorada contra
 * el enrutador actual; el umbral de 0.82 es el objetivo del ERS, no una
 * garantia medida. Los SLA de latencia (< 80 ms, P95) tampoco se afirman
 * aqui: se mediran en el VPS con el modelo definitivo.
 *
 * Strict Policy: Zero Emojis.
 */

export const UMBRAL_CONFIANZA_SLM = 0.82;

/* ------------------------- utilidades de parseo ------------------------- */

/**
 * Extrae el primer objeto JSON equilibrado de un texto del modelo.
 * Tolera prosa antes/despues y bloques ```json ... ```.
 */
export function extraerPrimerJson(texto) {
  if (!texto || typeof texto !== 'string') return null;
  const limpio = texto.replace(/```(?:json)?/gi, ' ');
  const inicio = limpio.indexOf('{');
  if (inicio === -1) return null;
  let profundidad = 0;
  let enCadena = false;
  let escapado = false;
  for (let i = inicio; i < limpio.length; i++) {
    const c = limpio[i];
    if (escapado) { escapado = false; continue; }
    if (c === '\\' && enCadena) { escapado = true; continue; }
    if (c === '"') { enCadena = !enCadena; continue; }
    if (enCadena) continue;
    if (c === '{') profundidad++;
    if (c === '}') {
      profundidad--;
      if (profundidad === 0) {
        try {
          return JSON.parse(limpio.slice(inicio, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

/**
 * Validador minimo de esquemas JSON (subconjunto: object, properties,
 * required, enum, tipos string/number/integer/boolean/array). Sin
 * dependencias nuevas: el catalogo de herramientas simples solo necesita
 * esto. Devuelve lista de violaciones; vacia = valido.
 */
export function validarContraEsquema(valor, esquema, ruta = '') {
  const violaciones = [];
  if (!esquema || typeof esquema !== 'object') return violaciones;

  const tipo = esquema.type;
  if (tipo) {
    const tipos = Array.isArray(tipo) ? tipo : [tipo];
    const cumple = tipos.some((t) => {
      if (t === 'array') return Array.isArray(valor);
      if (t === 'integer') return typeof valor === 'number' && Number.isInteger(valor);
      if (t === 'number') return typeof valor === 'number' && Number.isFinite(valor);
      if (t === 'object') return valor !== null && typeof valor === 'object' && !Array.isArray(valor);
      return typeof valor === t;
    });
    if (!cumple) {
      violaciones.push(`${ruta || 'raiz'}: se esperaba tipo ${tipos.join('|')}`);
      return violaciones;
    }
  }

  if (esquema.enum && !esquema.enum.includes(valor)) {
    violaciones.push(`${ruta || 'raiz'}: valor fuera del enum permitido`);
  }

  if (tipo === 'object' || esquema.properties) {
    const requeridos = esquema.required || [];
    for (const clave of requeridos) {
      if (valor == null || valor[clave] === undefined) {
        violaciones.push(`${ruta || 'raiz'}.${clave}: falta campo requerido`);
      }
    }
    if (valor && typeof valor === 'object' && esquema.properties) {
      for (const [clave, sub] of Object.entries(esquema.properties)) {
        if (valor[clave] !== undefined) {
          violaciones.push(...validarContraEsquema(valor[clave], sub, ruta ? `${ruta}.${clave}` : clave));
        }
      }
    }
  }

  return violaciones;
}

function confianzaSana(v) {
  const n = Number(v);
  return isFinite(n) && n >= 0 && n <= 1 ? n : null;
}

/* ------------------------------ servicio -------------------------------- */

/**
 * @param {Object} deps
 * @param {Object} deps.provider  Adaptador LLMProviderPort del SLM local
 *        (obligatorio; quien no tenga SLM no crea este servicio).
 * @param {number} [deps.umbral]  Umbral de confianza (def: 0.82 del ERS).
 */
export function crearLocalSlmInferenceService({ provider, umbral = UMBRAL_CONFIANZA_SLM } = {}) {
  if (!provider || typeof provider.chatCompletion !== 'function') {
    throw new TypeError('localSlmInferenceService: provider con chatCompletion es obligatorio.');
  }

  function resultado(base) {
    return { exito: false, via: 'local_slm', ...base };
  }

  /**
   * Clasifica el mensaje en una de las etiquetas dadas.
   * Devuelve { exito, intencion?, confianza?, motivo?, latenciaMs, uso }.
   */
  async function clasificarIntencion(mensaje, etiquetas) {
    if (!mensaje || typeof mensaje !== 'string' || !Array.isArray(etiquetas) || etiquetas.length === 0) {
      return resultado({ motivo: 'entrada_invalida' });
    }
    let res;
    try {
      res = await provider.chatCompletion({
        messages: [
          { role: 'system', content: [
              'Clasifica la intencion principal del mensaje del usuario en UNA de estas etiquetas:',
              etiquetas.join(', ') + '.',
              'Responde SOLO con un JSON: {"intencion": "<etiqueta>", "confianza": <numero entre 0 y 1>}.',
              'Usa "conversacion" si es charla sin accion. Si dudas entre varias, baja la confianza.',
              'Sin emojis, sin explicaciones.'
            ].join(' ') },
          { role: 'user', content: mensaje }
        ],
        options: { temperature: 0, num_predict: 60 }
      });
    } catch (err) {
      return resultado({ motivo: /agoto su tiempo/.test(err?.message || '') ? 'slm_timeout' : 'slm_error', detalle: String(err?.message || err).slice(0, 200) });
    }

    const datos = extraerPrimerJson(res?.message?.content || '');
    if (!datos) return resultado({ motivo: 'slm_parse_fail', latenciaMs: res?.latenciaMs });

    const intencion = String(datos.intencion || '').trim();
    const confianza = confianzaSana(datos.confianza);
    if (!etiquetas.includes(intencion) || confianza === null) {
      return resultado({ motivo: 'slm_parse_fail', latenciaMs: res?.latenciaMs });
    }
    if (confianza < umbral) {
      return resultado({ motivo: 'baja_confianza', intencion, confianza, latenciaMs: res?.latenciaMs, uso: res?.uso });
    }
    return { exito: true, via: 'local_slm', intencion, confianza, latenciaMs: res?.latenciaMs, uso: res?.uso };
  }

  /**
   * Extrae argumentos para una herramienta simple y los valida contra el
   * esquema declarado por el llamador. Solo un JSON valido con confianza
   * suficiente pasa; nunca se ejecuta nada aqui.
   * Devuelve { exito, argumentos?, confianza?, motivo?, violaciones? }.
   */
  async function extraerArgumentos(mensaje, nombreHerramienta, esquema) {
    if (!mensaje || typeof mensaje !== 'string' || !nombreHerramienta || !esquema) {
      return resultado({ motivo: 'entrada_invalida' });
    }
    let res;
    try {
      res = await provider.chatCompletion({
        messages: [
          { role: 'system', content: [
              `Extrae los argumentos de la herramienta "${nombreHerramienta}" a partir del mensaje del usuario.`,
              'Responde SOLO con un JSON: {"confianza": <0-1>, "argumentos": {...}}.',
              `El objeto "argumentos" debe cumplir este esquema JSON: ${JSON.stringify(esquema)}.`,
              'Transcribe UNICAMENTE datos presentes en el mensaje; si un campo requerido no esta, baja la confianza por debajo de 0.5. Nunca inventes valores.',
              'Sin emojis, sin explicaciones.'
            ].join(' ') },
          { role: 'user', content: mensaje }
        ],
        options: { temperature: 0, num_predict: 300 }
      });
    } catch (err) {
      return resultado({ motivo: /agoto su tiempo/.test(err?.message || '') ? 'slm_timeout' : 'slm_error', detalle: String(err?.message || err).slice(0, 200) });
    }

    const datos = extraerPrimerJson(res?.message?.content || '');
    if (!datos || typeof datos.argumentos !== 'object' || datos.argumentos === null) {
      return resultado({ motivo: 'slm_parse_fail', latenciaMs: res?.latenciaMs });
    }
    const confianza = confianzaSana(datos.confianza);
    if (confianza === null) {
      return resultado({ motivo: 'slm_parse_fail', latenciaMs: res?.latenciaMs });
    }
    const violaciones = validarContraEsquema(datos.argumentos, esquema);
    if (violaciones.length > 0) {
      return resultado({ motivo: 'esquema_invalido', violaciones, confianza, latenciaMs: res?.latenciaMs });
    }
    if (confianza < umbral) {
      return resultado({ motivo: 'baja_confianza', confianza, latenciaMs: res?.latenciaMs, uso: res?.uso });
    }
    return { exito: true, via: 'local_slm', argumentos: datos.argumentos, confianza, latenciaMs: res?.latenciaMs, uso: res?.uso };
  }

  /**
   * Respuesta conversacional estandar (sin herramientas). El SLM declara
   * su confianza; por debajo del umbral se declara fallo de nivel 1.
   * Devuelve { exito, respuesta?, confianza?, motivo? }.
   */
  async function responderConversacion(mensaje, instruccionSistema) {
    if (!mensaje || typeof mensaje !== 'string') {
      return resultado({ motivo: 'entrada_invalida' });
    }
    let res;
    try {
      res = await provider.chatCompletion({
        messages: [
          { role: 'system', content: [
              instruccionSistema || 'Eres un asistente personal. Responde de forma breve y directa, en espanol de Espana, sin emojis.',
              'Tras tu respuesta, en la ultima linea, escribe SOLO un JSON: {"confianza": <0-1>} indicando si la respuesta es suficiente para el usuario.',
              'Si el mensaje pide acciones, datos externos o algo que no puedes saber, baja la confianza por debajo de 0.5.'
            ].join(' ') },
          { role: 'user', content: mensaje }
        ],
        options: { temperature: 0.3, num_predict: 300 }
      });
    } catch (err) {
      return resultado({ motivo: /agoto su tiempo/.test(err?.message || '') ? 'slm_timeout' : 'slm_error', detalle: String(err?.message || err).slice(0, 200) });
    }

    const contenido = res?.message?.content || '';
    const datos = extraerPrimerJson(contenido);
    const confianza = confianzaSana(datos?.confianza);
    if (confianza === null) {
      return resultado({ motivo: 'slm_parse_fail', latenciaMs: res?.latenciaMs });
    }
    const respuesta = contenido.replace(/\{[\s\S]*?"confianza"[\s\S]*?\}/, '').replace(/```(?:json)?/gi, '').trim();
    if (!respuesta) {
      return resultado({ motivo: 'slm_parse_fail', latenciaMs: res?.latenciaMs });
    }
    if (confianza < umbral) {
      return resultado({ motivo: 'baja_confianza', confianza, latenciaMs: res?.latenciaMs, uso: res?.uso });
    }
    return { exito: true, via: 'local_slm', respuesta, confianza, latenciaMs: res?.latenciaMs, uso: res?.uso };
  }

  return Object.freeze({ clasificarIntencion, extraerArgumentos, responderConversacion, umbral });
}
