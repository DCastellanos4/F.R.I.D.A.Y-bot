/**
 * asyncProgressFeedbackService.js - Feedback tactico de progreso desacoplado (RF-COG-06)
 *
 * Estima si una peticion superara el umbral configurado de latencia y, en caso
 * afirmativo, programa un unico acuse de progreso contextualizado mediante
 * callback desacoplado del canal. Respeta modo silencioso/nocturno, respuestas
 * de voz y pipeline asincrono.
 *
 * Strict Policy: Zero Emojis.
 */

export const UMBRAL_ACK_PROGRESO_MS = Number.parseInt(process.env.DAVIS_PROGRESS_ACK_MS || '', 10) || 4000;

const INTENCIONES_PESADAS = new Set([
  'navegacion',
  'noticias',
  'carrera',
  'cerebro',
  'github'
]);

const INTENCIONES_SIMPLES = new Set([
  'chitchat',
  'conversacion',
  'saludo',
  'clima'
]);

const HERRAMIENTAS_PESADAS = new Set([
  'navegar_y_leer_noticia',
  'resumir_enlace',
  'obtener_noticias_actuales',
  'iniciar_simulacro_entrevista',
  'analizar_cv_oferta',
  'resumir_apuntes',
  'buscar_recuerdo_semantico',
  'generar_digest_cerebro',
  'generar_wiki',
  'capturar_pagina',
  'preguntar_documentos',
  'crear_rama_trabajo',
  'crear_commit',
  'abrir_pull_request',
  'empujar_rama',
  'ejecutar_tarea_programacion'
]);

const MENSAJES_POR_INTENCION = Object.freeze({
  github: 'Revisando el repositorio y preparando la operacion en GitHub, dame un momento.',
  navegacion: 'Leyendo y extrayendo el contenido de la web, dame un momento.',
  noticias: 'Consultando y contrastando las noticias actuales, dame un momento.',
  carrera: 'Analizando la informacion academica y de carrera, sigo en ello.',
  cerebro: 'Buscando y cruzando referencias en tu Second Brain, un momento.',
  empleo: 'Revisando ofertas y candidaturas, sigo con ello.',
  devtools: 'Ejecutando las comprobaciones tecnicas, dame un momento.',
  ops: 'Ejecutando las comprobaciones de infraestructura, dame un momento.',
  viajes: 'Consultando rutas y tarifas en tiempo real, un momento.',
  compras: 'Consultando precios y disponibilidad, un momento.',
  estudio: 'Revisando tus planes y material de estudio, un momento.'
});

const PRIORIDAD_MENSAJE = [
  'github',
  'navegacion',
  'noticias',
  'carrera',
  'cerebro',
  'empleo',
  'devtools',
  'ops',
  'viajes',
  'compras',
  'estudio'
];

function normalizarIntenciones(intenciones) {
  if (!Array.isArray(intenciones)) return [];
  return intenciones
    .map((item) => String(item || '').trim().toLowerCase())
    .filter(Boolean);
}

function normalizarNombresHerramientas(herramientas) {
  if (!Array.isArray(herramientas)) return [];
  return herramientas
    .map((item) => {
      if (typeof item === 'string') return item.trim();
      return String(item?.function?.name || item?.name || '').trim();
    })
    .filter(Boolean);
}

function extraerNivelComplejidad(complejidad) {
  if (typeof complejidad === 'number' && Number.isFinite(complejidad)) {
    return complejidad;
  }
  if (complejidad && typeof complejidad === 'object') {
    if (typeof complejidad.nivel === 'number' && Number.isFinite(complejidad.nivel)) {
      return complejidad.nivel;
    }
    if (complejidad.categoria === 'razonamiento_profundo') return 2;
    if (complejidad.categoria === 'rapido_estructurado') return 1;
    if (complejidad.categoria === 'determinista') return 0;
  }
  return null;
}

/**
 * Estima la duracion esperada del turno en milisegundos segun intenciones,
 * herramientas candidatas, plan compuesto y nivel de complejidad cognitiva.
 *
 * @param {object} [params]
 * @returns {number}
 */
export function estimarDuracionMs({
  intenciones = [],
  herramientas = [],
  esPlanCompuesto = false,
  complejidad = null
} = {}) {
  const listaIntenciones = normalizarIntenciones(intenciones);
  const listaHerramientas = normalizarNombresHerramientas(herramientas);
  const nivel = extraerNivelComplejidad(complejidad);

  if (esPlanCompuesto === true) {
    return 6500;
  }

  if (nivel !== null && nivel >= 2) {
    return 5500;
  }

  if (listaIntenciones.includes('navegacion') || listaIntenciones.includes('github')) {
    return 5500;
  }
  if (listaIntenciones.includes('carrera')) {
    return 5200;
  }
  if (listaIntenciones.includes('noticias')) {
    return 5000;
  }
  if (listaIntenciones.includes('cerebro')) {
    return 4800;
  }

  if (listaIntenciones.length >= 2 || listaHerramientas.some((h) => HERRAMIENTAS_PESADAS.has(h))) {
    return 4800;
  }

  if (nivel === 0 && !listaIntenciones.some((i) => INTENCIONES_PESADAS.has(i))) {
    return 400;
  }

  if (listaIntenciones.length === 0 && listaHerramientas.length === 0) {
    return 800;
  }

  const soloSimples = listaIntenciones.every((i) => INTENCIONES_SIMPLES.has(i));
  if (soloSimples && listaHerramientas.length <= 1) {
    return listaIntenciones.includes('clima') ? 1200 : 800;
  }

  return 2200;
}

/**
 * Genera un mensaje tactico breve en espanol y sin emojis acorde al contexto.
 *
 * @param {object} [params]
 * @returns {string}
 */
export function generarMensajeProgreso({
  intenciones = [],
  complejidad = null
} = {}) {
  const listaIntenciones = normalizarIntenciones(intenciones);
  for (const clave of PRIORIDAD_MENSAJE) {
    if (listaIntenciones.includes(clave)) {
      return MENSAJES_POR_INTENCION[clave];
    }
  }

  const nivel = extraerNivelComplejidad(complejidad);
  if ((nivel !== null && nivel >= 2) || listaIntenciones.length >= 2) {
    return 'Procesando tu peticion en varios pasos, dame un momento.';
  }

  return 'Estoy en ello, terminando de recopilar los datos.';
}

/**
 * Crea un monitor de acuse tactico unico para ejecuciones largas.
 * Programa un unico timer con `.unref?.()` solo cuando supera el umbral y
 * el canal no esta silenciado, en voz o en pipeline asincrono.
 *
 * @param {object} [params]
 * @returns {{ cancelar: () => void, seEmitio: () => boolean }}
 */
export function crearMonitorProgresoTactico({
  estimacionMs,
  umbralMs = UMBRAL_ACK_PROGRESO_MS,
  onProgreso,
  intenciones = [],
  complejidad = null,
  silencioso = false,
  respuestaVoz = false,
  asyncPipeline = false
} = {}) {
  let timer = null;
  let cancelado = false;
  let emitido = false;

  const umbralEfectivo = typeof umbralMs === 'number' && Number.isFinite(umbralMs) && umbralMs >= 0
    ? umbralMs
    : UMBRAL_ACK_PROGRESO_MS;
  const estimacionValida = typeof estimacionMs === 'number' && Number.isFinite(estimacionMs);

  const debeProgramar = estimacionValida
    && estimacionMs >= umbralEfectivo
    && !silencioso
    && !respuestaVoz
    && !asyncPipeline
    && typeof onProgreso === 'function';

  if (debeProgramar) {
    timer = setTimeout(() => {
      timer = null;
      if (cancelado || emitido) return;
      emitido = true;
      const mensaje = generarMensajeProgreso({ intenciones, complejidad });
      try {
        const res = onProgreso(mensaje);
        if (res && typeof res.catch === 'function') {
          res.catch(() => {});
        }
      } catch {
        // Captura errores del callback para no afectar la ejecucion principal.
      }
    }, umbralEfectivo);
    timer.unref?.();
  }

  return {
    cancelar() {
      cancelado = true;
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
    },
    seEmitio() {
      return emitido;
    }
  };
}
