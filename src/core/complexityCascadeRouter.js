/**
 * complexityCascadeRouter.js - Enrutado dinamico por complejidad cognitiva (RF-COG-02)
 *
 * Clasifica cada turno en 3 niveles para optimizar latencia, presupuesto de tokens
 * y capacidad de razonamiento:
 *   - Nivel 0 (Determinista): 0 LLM (GTFS trenes, calendario hoy, comandos directos).
 *   - Nivel 1 (Rapido / Estructurado): intencion unica simple, charla, consultas cortas.
 *   - Nivel 2 (Razonamiento Profundo): codigo/depuracion, peticiones compuestas,
 *     analisis de documentos/CV, o escalada tras fallo de herramienta.
 *
 * Retrocompatibilidad estricta: si no hay DAVIS_MODELO_NIVEL1 / DAVIS_MODELO_NIVEL2
 * configurados, preserva intacto el modelo por defecto y failover de routerLLM.js.
 *
 * Strict Policy: Zero Emojis.
 */

import { desterrarQwen } from './routerLLM.js';

export const NIVEL_COMPLEJIDAD = Object.freeze({
  DETERMINISTA: 0,
  RAPIDO: 1,
  RAZONAMIENTO: 2
});

const INTENCIONES_RAZONAMIENTO = new Set([
  'devtools',
  'github',
  'carrera',
  'estudio',
  'ops'
]);

const RE_RAZONAMIENTO_PROFUNDO = /\b(analiz\w*|compar\w*|depur\w*|revis\w*|disen\w*|arquitect\w*|planific\w*|explic\w*|refactor\w*|cv\b|entrevista|pull request|\bpr\b|por que falla)\b/i;

export function resolverModeloNivel(nivel, env = process.env) {
  if (nivel === NIVEL_COMPLEJIDAD.RAPIDO) {
    const m1 = (env.DAVIS_MODELO_NIVEL1 || '').trim();
    return m1 ? desterrarQwen(m1) : null;
  }
  if (nivel === NIVEL_COMPLEJIDAD.RAZONAMIENTO) {
    const m2 = (env.DAVIS_MODELO_NIVEL2 || '').trim();
    return m2 ? desterrarQwen(m2) : null;
  }
  return null;
}

/**
 * Clasifica la complejidad cognitiva de un turno del agente.
 *
 * @param {object} params
 * @returns {{ nivel: 0|1|2, categoria: string, razon: string, modeloSugerido: string|null, numPredictSugerido: number|null }}
 */
export function clasificarComplejidadTurno({
  mensaje = '',
  intenciones = [],
  herramientas = [],
  especialista = 'general',
  ronda = 0,
  esRutaDeterminista = false,
  huboFalloPrevio = false,
  esPlanCompuesto = false,
  env = process.env
} = {}) {
  if (esRutaDeterminista) {
    return {
      nivel: NIVEL_COMPLEJIDAD.DETERMINISTA,
      categoria: 'determinista',
      razon: 'ruta_determinista_0_llm',
      modeloSugerido: null,
      numPredictSugerido: null
    };
  }

  const listaInt = Array.isArray(intenciones) ? intenciones : [];
  const texto = String(mensaje || '');

  let razonNivel2 = null;
  if (especialista === 'coder') {
    razonNivel2 = 'especialista_coder';
  } else if (esPlanCompuesto) {
    razonNivel2 = 'peticion_compuesta_multi_paso';
  } else if (huboFalloPrevio || ronda >= 2) {
    razonNivel2 = 'recuperacion_o_ronda_avanzada';
  } else if (listaInt.length >= 2) {
    razonNivel2 = 'multiples_intenciones';
  } else if (listaInt.some((i) => INTENCIONES_RAZONAMIENTO.has(i)) && RE_RAZONAMIENTO_PROFUNDO.test(texto)) {
    razonNivel2 = 'analisis_o_razonamiento_tecnico';
  } else if (texto.length > 220 && Array.isArray(herramientas) && herramientas.length > 0 && RE_RAZONAMIENTO_PROFUNDO.test(texto)) {
    razonNivel2 = 'consulta_extensa_compleja';
  }

  if (razonNivel2) {
    const np = Number.parseInt(env.DAVIS_NUM_PREDICT_NIVEL2 || '', 10);
    return {
      nivel: NIVEL_COMPLEJIDAD.RAZONAMIENTO,
      categoria: 'razonamiento_profundo',
      razon: razonNivel2,
      modeloSugerido: resolverModeloNivel(NIVEL_COMPLEJIDAD.RAZONAMIENTO, env),
      numPredictSugerido: Number.isFinite(np) && np > 0 ? np : null
    };
  }

  const razonNivel1 = Array.isArray(herramientas) && herramientas.length === 0
    ? 'conversacion_directa'
    : 'intencion_unica_simple';

  return {
    nivel: NIVEL_COMPLEJIDAD.RAPIDO,
    categoria: 'rapido_estructurado',
    razon: razonNivel1,
    modeloSugerido: resolverModeloNivel(NIVEL_COMPLEJIDAD.RAPIDO, env),
    numPredictSugerido: null
  };
}

/**
 * Aplica de forma no intrusiva la sugerencia de modelo/presupuesto sobre
 * una peticion LLM, respetando modelos explicitos ya fijados.
 */
export function aplicarSugerenciaCascada(peticion, decision) {
  if (!peticion || !decision) return peticion;
  const out = { ...peticion };
  if (decision.modeloSugerido && !out.model) {
    out.model = decision.modeloSugerido;
  }
  if (decision.numPredictSugerido && out.options) {
    out.options = { ...out.options };
    if (!out.options.num_predict || out.options.num_predict < decision.numPredictSugerido) {
      out.options.num_predict = decision.numPredictSugerido;
    }
  }
  return out;
}
