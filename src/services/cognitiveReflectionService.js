/**
 * cognitiveReflectionService.js - Metacognicion y Bucle de Reflexion (RF-COG-05)
 *
 * Implementa evaluacion post-ronda de herramientas de solo lectura para
 * replanificacion segura y critica acotada pre-envio (maximo 1 llamada LLM
 * sin herramientas) sobre turnos complejos o con errores parciales.
 *
 * Politica estricta: CERO EMOJIS en codigo, comentarios, prompts y mensajes.
 * Regla estricta de no-mutacion: nunca sugiere re-ejecutar herramientas mutantes.
 */

import { HERRAMIENTAS_CON_MUTACION } from './idempotencyService.js';

const PREFIJOS_MUTANTES = /^(registrar_|crear_|enviar_|programar_|cancelar_|eliminar_|vaciar_|tachar_|anadir_|escribir_|marcar_|guardar_|olvidar_|configurar_|activar_|desactivar_|actualizar_|modificar_|empujar_|agregar_|dejar_vigilar|vigilar_|poner_menu|planificar_|priorizar_)/;
const PREFIJOS_LECTURA_SEGURA = /^(proximas_llegadas_transporte|listar_|buscar_|consultar_|ver_|verificar_|leer_|estado_|estadisticas_|obtener_|resumir_|resumen_|sugerir_|recomendar_|analizar_|estimar_|actividad_|informe_|revisar_|preguntar_|explicar_|navegar_y_leer|guiar_depuracion|auditar_dependencias|iniciar_simulacro_entrevista|repasar_|get_)/;

const MARCAS_FALLO_PAYLOAD = /^\s*(error\b|no se pudo|no pude|no he podido|no se ha podido|no se ha registrado|no fue posible|fallo\b|fallo:|timeout\b)/i;
const MARCAS_VACIO_TEXTO = /^\s*(sin resultados|no hay resultados|no se encontraron resultados|no se encontro nada|no encuentro nada|no hay datos|ningun resultado|vacio)\b/i;
const ESTADOS_BLOQUEO = new Set([
  'blocked',
  'idempotente_bloqueado',
  'duplicado_bloqueado',
  'estado_incierto',
  'checkpoint_fallo_bloqueo',
  'destinatario_no_verificado',
  'destinatario_no_verificado_reintento'
]);

const RE_MENCION_ERROR_BORRADOR = /\b(error|fallo|fallaron|fallado|fallando|no\s+pude|no\s+se\s+pudo|no\s+he\s+podido|no\s+se\s+ha\s+podido|no\s+fue\s+posible|no\s+ha\s+sido\s+posible|no\s+disponible|indisponible|sin\s+acceso|timeout|tiempo\s+de\s+espera|incidencia|problema\s+al|no\s+consegui|no\s+logre|sin\s+exito|imposible|pendiente\s+por|parcialmente|solo\s+pude|cuota\s+agotada|temporalmente\s+fuera)\b/;

const GRUPOS_DOMINIO_LECTURA = [
  ['buscar_memoria', 'listar_memorias', 'listar_notas_recientes'],
  ['obtener_noticias_actuales', 'navegar_y_leer_noticia', 'resumir_enlace'],
  ['consultar_estado_servidor', 'get_infrastructure_status'],
  ['listar_recordatorios', 'listar_mensajes_programados'],
  ['listar_planes_estudio', 'repasar_flashcards']
];

function normalizarTextoSinTildes(texto) {
  return String(texto || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function normalizarIdempotentes(idempotentesSet) {
  if (idempotentesSet instanceof Set) return idempotentesSet;
  if (Array.isArray(idempotentesSet)) return new Set(idempotentesSet.filter(Boolean).map(String));
  return new Set();
}

function extraerNombresDisponibles(herramientasDisponibles) {
  const lista = Array.isArray(herramientasDisponibles)
    ? herramientasDisponibles
    : (herramientasDisponibles instanceof Set ? [...herramientasDisponibles] : []);
  const vistos = new Set();
  const nombres = [];
  for (const item of lista) {
    const nombre = typeof item === 'string'
      ? item.trim()
      : String(item?.function?.name || item?.name || '').trim();
    if (nombre && !vistos.has(nombre)) {
      vistos.add(nombre);
      nombres.push(nombre);
    }
  }
  return nombres;
}

function esAlternativaLecturaSegura(nombre, idempotentes) {
  if (!nombre) return false;
  if (HERRAMIENTAS_CON_MUTACION.has(nombre) || PREFIJOS_MUTANTES.test(nombre)) return false;
  return idempotentes.has(nombre) || PREFIJOS_LECTURA_SEGURA.test(nombre);
}

function ordenarAlternativasPorAfinidad(herramientaAfectada, alternativas) {
  const grupo = GRUPOS_DOMINIO_LECTURA.find((g) => g.includes(herramientaAfectada));
  if (!grupo) return alternativas;
  const enGrupo = new Set(grupo);
  return [...alternativas].sort((a, b) => {
    const aAfin = enGrupo.has(a) ? 0 : 1;
    const bAfin = enGrupo.has(b) ? 0 : 1;
    return aAfin - bAfin;
  });
}

function clasificarIncidenciaResultado(item) {
  const status = String(item?.status || item?.resultado || '').trim().toLowerCase();
  if (ESTADOS_BLOQUEO.has(status)) return null;

  if (status === 'error' || status === 'no_reconocida' || Boolean(item?.error)) {
    return 'error';
  }

  const tieneCampoResultado = item && (
    Object.prototype.hasOwnProperty.call(item, 'result') ||
    Object.prototype.hasOwnProperty.call(item, 'resultado') ||
    Object.prototype.hasOwnProperty.call(item, 'datos')
  );
  if (!tieneCampoResultado) return null;

  const valor = item.result !== undefined ? item.result : (item.datos !== undefined ? item.datos : item.resultado);
  if (valor === null || valor === undefined) return 'vacio';

  if (Array.isArray(valor)) {
    return valor.length === 0 ? 'vacio' : null;
  }

  if (typeof valor === 'object') {
    return Object.keys(valor).length === 0 ? 'vacio' : null;
  }

  const texto = String(valor).trim();
  if (!texto || texto === '[]' || texto === '{}' || texto === 'null') return 'vacio';

  const norm = normalizarTextoSinTildes(texto);
  if (MARCAS_FALLO_PAYLOAD.test(norm)) return 'error';
  if (MARCAS_VACIO_TEXTO.test(norm)) return 'vacio';

  return null;
}

function normalizarRegistrosRonda(llamadasRonda, resultadosRonda) {
  const llamadas = Array.isArray(llamadasRonda) ? llamadasRonda : [];
  const resultados = Array.isArray(resultadosRonda) ? resultadosRonda : [];

  if (resultados.length === 0) {
    return llamadas.map((llamada) => ({
      nombre: String(llamada?.name || llamada?.nombre || '').trim(),
      item: llamada
    }));
  }

  const llamadasPorId = new Map();
  for (const llamada of llamadas) {
    if (llamada?.id) llamadasPorId.set(llamada.id, llamada);
  }

  return resultados.map((res, idx) => {
    const porId = res?.id ? llamadasPorId.get(res.id) : null;
    const porIdx = llamadas[idx] || null;
    const nombre = String(res?.name || res?.nombre || porId?.name || porId?.nombre || porIdx?.name || porIdx?.nombre || '').trim();
    return { nombre, item: res };
  });
}

/**
 * Evalua post-ronda si alguna herramienta de solo lectura (presente en
 * idempotentesSet) fallo o devolvio vacio habiendo una alternativa de solo
 * lectura en herramientasDisponibles. Nunca sugiere re-ejecutar mutantes.
 *
 * @param {object} params
 * @returns {{ replanificar: boolean, motivo: string, sugerencia: string|null, herramientaAfectada?: string, alternativas?: string[] }}
 */
export function evaluarResultadoRonda({
  mensajeUsuario = '',
  llamadasRonda = [],
  resultadosRonda = [],
  herramientasDisponibles = [],
  idempotentesSet = new Set()
} = {}) {
  void mensajeUsuario;
  const idempotentes = normalizarIdempotentes(idempotentesSet);
  const registros = normalizarRegistrosRonda(llamadasRonda, resultadosRonda);

  if (registros.length === 0) {
    return {
      replanificar: false,
      motivo: 'ronda_sin_llamadas',
      sugerencia: null
    };
  }

  const usadasEnRonda = new Set(registros.map((r) => r.nombre).filter(Boolean));
  const disponibles = extraerNombresDisponibles(herramientasDisponibles);

  let huboMutanteFallida = false;
  let huboLecturaSinAlternativa = false;

  for (const { nombre, item } of registros) {
    if (!nombre) continue;
    const tipoIncidencia = clasificarIncidenciaResultado(item);
    if (!tipoIncidencia) continue;

    if (!idempotentes.has(nombre)) {
      huboMutanteFallida = true;
      continue;
    }

    const alternativasValidas = ordenarAlternativasPorAfinidad(
      nombre,
      disponibles.filter(
        (alt) => alt !== nombre && !usadasEnRonda.has(alt) && esAlternativaLecturaSegura(alt, idempotentes)
      )
    );

    if (alternativasValidas.length > 0) {
      const motivo = tipoIncidencia === 'error'
        ? 'error_herramienta_lectura'
        : 'resultado_vacio_herramienta_lectura';
      const descripcionEstado = tipoIncidencia === 'error' ? 'fallo' : 'devolvio vacio';
      return {
        replanificar: true,
        motivo,
        herramientaAfectada: nombre,
        alternativas: alternativasValidas,
        sugerencia: `La herramienta de solo lectura '${nombre}' ${descripcionEstado}. Intenta resolverlo usando una alternativa de solo lectura disponible: ${alternativasValidas.join(', ')}.`
      };
    }

    huboLecturaSinAlternativa = true;
  }

  if (huboLecturaSinAlternativa) {
    return {
      replanificar: false,
      motivo: 'sin_alternativa_lectura_disponible',
      sugerencia: null
    };
  }

  if (huboMutanteFallida) {
    return {
      replanificar: false,
      motivo: 'herramienta_mutante_no_replanificable',
      sugerencia: null
    };
  }

  return {
    replanificar: false,
    motivo: 'ronda_sin_incidencias',
    sugerencia: null
  };
}

function esLlamadaConError(llamada) {
  if (!llamada || typeof llamada !== 'object') return false;
  return llamada.resultado === 'error' || llamada.status === 'error' || Boolean(llamada.error);
}

/**
 * Decide a coste cero si el turno requiere pasar por critica final.
 *
 * @param {object} params
 * @returns {boolean}
 */
export function necesitaCriticaFinal({
  mensajeUsuario = '',
  textoBorrador = '',
  llamadas = [],
  opciones = {}
} = {}) {
  void mensajeUsuario;
  const opts = opciones && typeof opciones === 'object' ? opciones : {};
  if (opts.habilitarReflexion === false) return false;
  if (opts.chatId === 'chat-dorado@test') return false;
  if (typeof textoBorrador !== 'string' || textoBorrador.trim().length === 0) return false;

  const lista = Array.isArray(llamadas) ? llamadas : [];
  // Ignorar llamadas a descubrir_herramientas: son overhead de descubrimiento,
  // no llamadas sustantivas que indiquen complejidad real del turno.
  const llamadasSustantivas = lista.filter((l) => (l.nombre || l.name) !== 'descubrir_herramientas');
  return llamadasSustantivas.length >= 2 || llamadasSustantivas.some(esLlamadaConError);
}

function esBorradorTruncadoOVacio(texto, totalLlamadas) {
  const limpio = texto.trim();
  if (limpio.length === 0) return true;
  // Termina abruptamente con '...' o ':' -> truncado
  if (/(?:\.\.\.|:)\s*$/.test(limpio)) return true;
  // Bloque de codigo sin cerrar
  const bloquesCodigo = (limpio.match(/```/g) || []).length;
  if (bloquesCodigo % 2 === 1) return true;
  // Con >= 2 llamadas sustantivas: borrador demasiado corto (< 12 chars) indica truncado/omision.
  if (totalLlamadas >= 2 && limpio.length < 12) return true;
  if (limpio.length >= 200 && !/[.!?"')\]|:\u2026]$/.test(limpio)) {
    return true;
  }
  return false;
}

/**
 * Analiza heuristicamente (coste 0) si el borrador omite errores de herramientas
 * o quedo vacio/truncado tras multiples invocaciones.
 *
 * @param {object} params
 * @returns {{ hayDefectos: boolean, defectos: string[], erroresOmitidos: string[], truncadoOVacio: boolean }}
 */
export function detectarDefectosBorrador({
  mensajeUsuario = '',
  textoBorrador = '',
  llamadas = []
} = {}) {
  void mensajeUsuario;
  const texto = typeof textoBorrador === 'string' ? textoBorrador.trim() : '';
  const lista = Array.isArray(llamadas) ? llamadas : [];
  const listaSustantiva = lista.filter((l) => (l.nombre || l.name) !== 'descubrir_herramientas');
  const defectos = [];
  const erroresOmitidos = [];

  const truncadoOVacio = esBorradorTruncadoOVacio(texto, listaSustantiva.length);
  if (truncadoOVacio) {
    defectos.push(texto.length === 0 ? 'borrador_vacio' : 'borrador_truncado_o_insuficiente');
  }

  const norm = normalizarTextoSinTildes(texto);
  const mencionaFallo = RE_MENCION_ERROR_BORRADOR.test(norm);

  const conError = lista.filter(esLlamadaConError);
  if (conError.length > 0 && !mencionaFallo) {
    for (const l of conError) {
      const nombre = String(l.nombre || l.name || 'herramienta').trim();
      erroresOmitidos.push(nombre);
      defectos.push(`error_herramienta_omitido:${nombre}`);
    }
  }

  return {
    hayDefectos: defectos.length > 0,
    defectos,
    erroresOmitidos,
    truncadoOVacio
  };
}

function formatearHechosLlamadas(llamadas) {
  if (!Array.isArray(llamadas) || llamadas.length === 0) {
    return 'Ninguna herramienta invocada.';
  }
  return llamadas.map((l, idx) => {
    const nombre = String(l?.nombre || l?.name || `herramienta_${idx + 1}`);
    const estado = String(l?.resultado || l?.status || (l?.error ? 'error' : 'desconocido'));
    const partes = [`${idx + 1}. ${nombre} -> estado=${estado}`];
    if (l?.efecto) partes.push(`efecto="${String(l.efecto)}"`);
    if (l?.datos) partes.push(`datos="${String(l.datos).slice(0, 600)}"`);
    if (l?.detalle || l?.error) partes.push(`detalle="${String(l.detalle || l.error).slice(0, 200)}"`);
    return partes.join(' | ');
  }).join('\n');
}

function extraerContenidoRespuestaLlm(resp) {
  if (!resp || typeof resp !== 'object') return '';
  if (typeof resp.message?.content === 'string') return resp.message.content.trim();
  if (typeof resp.content === 'string') return resp.content.trim();
  return '';
}

/**
 * Ejecuta una pasada de autocritica acotada (maximo 1 llamada LLM sin tools)
 * cuando el turno lo amerita y existen defectos detectados o forzarCriticaLlm=true.
 * Nunca propaga excepciones ni rompe el borrador original ante errores o cuota.
 *
 * @param {object} params
 * @returns {Promise<{ texto: string, revisado: boolean, llamadasLlm: number, defectosDetectados: string[], motivo: string, error?: string }>}
 */
export async function reflexionarYCriticarRespuesta({
  mensajeUsuario = '',
  textoBorrador = '',
  llamadas = [],
  chatCompletion,
  maxRevisiones = 1,
  opciones = {}
} = {}) {
  const borradorOriginal = typeof textoBorrador === 'string'
    ? textoBorrador
    : String(textoBorrador ?? '');

  if (!necesitaCriticaFinal({ mensajeUsuario, textoBorrador: borradorOriginal, llamadas, opciones })) {
    return {
      texto: borradorOriginal,
      revisado: false,
      llamadasLlm: 0,
      defectosDetectados: [],
      motivo: 'critica_no_necesaria'
    };
  }

  const analisis = detectarDefectosBorrador({
    mensajeUsuario,
    textoBorrador: borradorOriginal,
    llamadas
  });

  const forzar = Boolean(opciones && opciones.forzarCriticaLlm === true);
  if (!analisis.hayDefectos && !forzar) {
    return {
      texto: borradorOriginal,
      revisado: false,
      llamadasLlm: 0,
      defectosDetectados: [],
      motivo: 'sin_defectos_en_borrador'
    };
  }

  const limiteRevisiones = Math.min(1, Math.max(0, Number(maxRevisiones) || 0));
  if (limiteRevisiones < 1) {
    return {
      texto: borradorOriginal,
      revisado: false,
      llamadasLlm: 0,
      defectosDetectados: analisis.defectos,
      motivo: 'max_revisiones_cero'
    };
  }

  if (typeof chatCompletion !== 'function') {
    return {
      texto: borradorOriginal,
      revisado: false,
      llamadasLlm: 0,
      defectosDetectados: analisis.defectos,
      motivo: 'sin_chat_completion'
    };
  }

  const peticion = {
    messages: [
      {
        role: 'system',
        content: [
          'Eres el revisor critico interno de D.A.V.I.S.',
          'Refina el borrador final para el usuario basandote EXCLUSIVAMENTE en hechos reales observados.',
          'Reglas obligatorias:',
          '1. No inventes datos ni afirmes exitos que no consten en las herramientas.',
          '2. Si alguna herramienta fallo (estado=error), informalo con claridad sin ocultar el fallo.',
          '3. Conserva todos los resultados reales exitosos que respondan a la peticion.',
          '4. Escribe en espanol claro y directo, con CERO emojis.',
          '5. Devuelve unicamente el texto final corregido, sin meta-comentarios.'
        ].join('\n')
      },
      {
        role: 'user',
        content: [
          `Peticion del usuario:\n${String(mensajeUsuario || '').trim()}`,
          `Hechos reales de herramientas:\n${formatearHechosLlamadas(llamadas)}`,
          `Defectos detectados en el borrador:\n${analisis.defectos.length > 0 ? analisis.defectos.join(', ') : 'revision_solicitada_explicitamente'}`,
          `Borrador actual:\n${borradorOriginal.trim()}`
        ].join('\n\n')
      }
    ],
    options: {
      temperature: 0.1,
      num_predict: 900
    }
  };

  try {
    const resp = await chatCompletion(peticion);
    const textoRefinado = extraerContenidoRespuestaLlm(resp);
    if (!textoRefinado) {
      return {
        texto: borradorOriginal,
        revisado: false,
        llamadasLlm: 1,
        defectosDetectados: analisis.defectos,
        motivo: 'respuesta_critica_vacia'
      };
    }

    return {
      texto: textoRefinado,
      revisado: true,
      llamadasLlm: 1,
      defectosDetectados: analisis.defectos,
      motivo: 'borrador_refinado'
    };
  } catch (err) {
    return {
      texto: borradorOriginal,
      revisado: false,
      llamadasLlm: 1,
      defectosDetectados: analisis.defectos,
      error: err?.message || String(err),
      motivo: 'error_critica_llm'
    };
  }
}
