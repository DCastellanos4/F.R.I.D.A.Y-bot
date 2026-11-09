/**
 * specialistRouterService.js - Servicio de Enrutamiento y Scoping Multi-Agente Especializado
 *
 * Clasifica peticiones de usuario hacia sub-agentes especialistas (Coder, Ops, Personal, General),
 * acota estrictamente el catalogo de herramientas bajo el limite de 128 del proveedor LLM
 * y provee adaptaciones contextuales del system prompt conservando la identidad D.A.V.I.S.
 *
 * Strict Policy: Zero Emojis en todo el codigo, comentarios, respuestas y logs.
 */

import { herramientasJarvis } from '../core/tools.js';

export const LIMITE_HERRAMIENTAS_ESPECIALISTA = 128;

export const ESPECIALISTAS = Object.freeze(['coder', 'ops', 'personal', 'general']);

// Solo herramientas presentes en el catalogo real (src/core/tools.js): los
// nombres ausentes se descartan en silencio al acotar y el modelo nunca las
// ve, pero prometerlos en listas, prompts o ejemplos induce llamadas
// imposibles. crear_rama_trabajo/crear_commit/abrir_pull_request/
// empujar_rama/ejecutar_tarea_programacion (githubAgentService) se retiraron
// de aqui por no existir en el catalogo; cablearlas es decision de producto.
export const HERRAMIENTAS_CODER = Object.freeze([
  'revisar_pr',
  'generar_changelog',
  'guiar_depuracion',
  'anotar_idea',
  'listar_ideas',
  'priorizar_ideas',
  'actividad_repos',
  'configurar_alertas_repos',
  'auditar_dependencias',
  'configurar_vigilancia_dependencias',
  'proponer_skill',
  'listar_skills',
  'ejecutar_skill',
  'explicar_recorrido'
]);

// Misma regla: sin alias ausentes del catalogo (docker_status,
// docker_restart, bash_console y disk_status no existen como herramientas;
// la consola y el estado llegan por execute_bash_command,
// consultar_estado_servidor y get_infrastructure_status).
export const HERRAMIENTAS_OPS = Object.freeze([
  'execute_bash_command',
  'get_infrastructure_status',
  'consultar_estado_servidor',
  'manage_tunnel',
  'trigger_encrypted_backup',
  'generate_crypto_credential',
  'vigilar_proceso',
  'listar_procesos_vigilados',
  'dejar_vigilar_proceso',
  'configurar_vigilante_procesos',
  'auditar_dependencias',
  'configurar_vigilancia_dependencias',
  'informe_metricas',
  'configurar_informe_metricas',
  'crear_backup_sesion',
  'verificar_backup_sesion',
  'encender_pc',
  'listar_dispositivos_red',
  'configurar_vigilancia_red',
  'estimar_factura_oracle',
  'estado_descargas',
  'configurar_aviso_descargas',
  'controlar_domotica',
  'explicar_recorrido'
]);

// Sin marcadores genericos ausentes del catalogo (calendar, expenses,
// habits, notes); la cobertura real son las herramientas granulares de abajo.
export const HERRAMIENTAS_PERSONAL = Object.freeze([
  'crear_recordatorio',
  'listar_recordatorios',
  'cancelar_recordatorio',
  'programar_mensaje_whatsapp',
  'listar_mensajes_programados',
  'cancelar_mensaje_programado',
  'guardar_nota_personal',
  'listar_notas_recientes',
  'registrar_gasto',
  'listar_gastos',
  'resumen_gastos_mes',
  'registrar_suscripcion',
  'listar_suscripciones',
  'configurar_presupuesto',
  'configurar_avisos_suscripciones',
  'estado_presupuestos',
  'escribir_diario',
  'leer_diario',
  'registrar_habito',
  'marcar_habito',
  'listar_habitos',
  'crear_flashcard',
  'repasar_flashcards',
  'configurar_repaso_flashcards',
  'responder_flashcard',
  'planificar_estudio',
  'listar_planes_estudio',
  'registrar_avance_estudio',
  'programar_recordatorios_estudio',
  'resumir_apuntes',
  'registrar_entrega',
  'listar_entregas',
  'eliminar_entrega',
  'registrar_contacto',
  'buscar_contacto',
  'listar_contactos',
  'enviar_contacto_vcard',
  'crear_encuesta_whatsapp',
  'registrar_fecha_senalada',
  'listar_fechas_senaladas',
  'eliminar_fecha_senalada',
  'configurar_avisos_fechas',
  'programar_snooze',
  'listar_snoozes',
  'cancelar_snooze',
  'poner_menu',
  'ver_menu',
  'sugerir_menu',
  'anadir_compra',
  'listar_compra',
  'tachar_compra',
  'vaciar_compra',
  'recomendar_serie_pelicula',
  'crear_quedada',
  'listar_quedadas',
  'redactar_invitacion',
  'configurar_modo_nocturno',
  'resumen_deportivo',
  'vigilar_ruta',
  'listar_rutas_vigiladas',
  'cancelar_vigilancia_ruta',
  'registrar_precio_ruta',
  'guardar_memoria',
  'buscar_memoria',
  'listar_memorias',
  'olvidar_memoria',
  'buscar_recuerdo_semantico',
  'generar_digest_cerebro',
  'configurar_digest_semanal',
  'explicar_recorrido'
]);

export const HERRAMIENTAS_GENERAL = Object.freeze([
  'consultar_clima',
  'obtener_noticias_actuales',
  'navegar_y_leer_noticia',
  'resumir_enlace',
  'guardar_memoria',
  'buscar_memoria',
  'listar_memorias',
  'olvidar_memoria',
  'buscar_recuerdo_semantico',
  'activar_modo_vip',
  'estado_modo_vip',
  'agregar_contacto_vip',
  'resumir_grupo',
  'descargar_multimedia',
  'activar_traductor',
  'desactivar_traductor',
  'sugerir_respuestas',
  'buscar_en_historial',
  'estadisticas_grupo',
  'capturar_pagina',
  'preguntar_documentos',
  'generar_wiki',
  'proponer_skill',
  'listar_skills',
  'ejecutar_skill',
  'explicar_recorrido'
]);

export const HERRAMIENTAS_POR_ESPECIALISTA = Object.freeze({
  coder: HERRAMIENTAS_CODER,
  ops: HERRAMIENTAS_OPS,
  personal: HERRAMIENTAS_PERSONAL,
  general: HERRAMIENTAS_GENERAL
});

export const CONFIGURACIONES_ESPECIALISTAS = Object.freeze({
  coder: {
    nombre: 'Especialista Coder',
    herramientasPermitidas: HERRAMIENTAS_CODER,
    systemPromptMod: '[MODO ESPECIALISTA: CODER]\nActuas como el especialista en desarrollo, programacion y control de versiones de D.A.V.I.S. Tu foco es el analisis riguroso de codigo, la revision de Pull Requests (la resena llega aqui, nunca se publica en GitHub), la redaccion de entradas de changelog desde el historial git, la auditoria de dependencias y la depuracion guiada paso a paso. No puedes crear ramas, commits ni Pull Requests: si David pide una de esas acciones, dilo claramente y ofrece la alternativa disponible. Responde con precision tecnica, sintaxis exacta, explicaciones estructuradas y estrictamente sin emojis.'
  },
  ops: {
    nombre: 'Especialista Ops',
    herramientasPermitidas: HERRAMIENTAS_OPS,
    systemPromptMod: '[MODO ESPECIALISTA: OPS / SYSADMIN]\nActuas como el especialista en operaciones de sistemas e infraestructura de D.A.V.I.S. Tu foco es la administracion del VPS, contenedores Docker, procesos PM2, monitorizacion de disco y memoria, seguridad de red (Fail2ban, SSL, cortafuegos), consola bash segura con verificacion y backups cifrados. Prioriza la estabilidad, la prudencia ante comandos de riesgo y reportes concisos de telemetria sin emojis.'
  },
  personal: {
    nombre: 'Especialista Personal',
    herramientasPermitidas: HERRAMIENTAS_PERSONAL,
    systemPromptMod: '[MODO ESPECIALISTA: PERSONAL & SECOND BRAIN]\nActuas como el copiloto personal y gestor del Second Brain de David. Tu foco es la organizacion de la agenda, recordatorios puntuales, control presupuestario y de gastos, seguimiento de habitos y rachas, diario nocturno reflexivo, flashcards de estudio SM-2 y preservacion estructurada de notas y relaciones. Manten un tono sobrio, util y proactivo sin emojis.'
  },
  general: {
    nombre: 'Especialista General',
    herramientasPermitidas: HERRAMIENTAS_GENERAL,
    systemPromptMod: '[MODO ESPECIALISTA: GENERAL]\nActuas en el modo general de D.A.V.I.S., atendiendo consultas cotidianas, sintesis informativa, clima, navegacion web y coordinacion general con sobriedad y eficacia ejecutiva sin emojis.'
  }
});

/**
 * Normaliza un texto de entrada para comparaciones de intencion y palabras clave:
 * Convierte a minusculas, retira tildes y diacriticos, y unifica espacios.
 */
function normalizarTexto(texto) {
  if (!texto || typeof texto !== 'string') return '';
  return texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Diccionario de patrones y pesos semanticos para cada dominio especialista.
 */
const PATRONES_ESPECIALISTAS = {
  coder: {
    frases: [
      'pull request', 'pull requests', 'abrir pr', 'crear pr', 'revisar pr', 'hacer pr', 'nueva pr',
      'crear rama', 'abrir rama', 'nueva rama', 'cambiar de rama', 'checkout rama', 'hacer checkout',
      'hacer commit', 'crear commit', 'nuevo commit', 'realizar commit',
      'empujar rama', 'git push', 'git commit', 'git branch', 'git status', 'git checkout',
      'git diff', 'git log', 'git merge', 'git rebase', 'git fetch',
      'code review', 'revision de codigo', 'revisar codigo', 'inspeccionar codigo',
      'pair programming', 'guiar depuracion', 'generar changelog', 'entrada changelog',
      'github agent', 'github agentservice', 'githubagent', 'githubagentservice',
      'github actions', 'github action', 'github workflow',
      'test unitario', 'tests unitarios', 'pruebas unitarias', 'suite de pruebas',
      'crear_rama_trabajo', 'crear_commit', 'abrir_pull_request', 'empujar_rama'
    ],
    palabrasClave: [
      'git', 'github', 'githubagentservice', 'githubagent', 'commit', 'commits', 'commitear',
      'rama', 'ramas', 'branch', 'branches',
      'pr', 'prs', 'merge', 'rebase', 'repo', 'repos', 'repositorio', 'repositorios',
      'refactor', 'refactorizar', 'refactorizacion', 'depurar', 'depuracion', 'debugging',
      'pullrequest', 'pullrequests'
    ],
    apoyo: [
      'codigo', 'programar', 'programacion', 'typescript', 'javascript', 'python', 'linter', 'eslint',
      'funcion', 'clase', 'metodo', 'variable', 'algoritmo'
    ],
    verbosAccion: [
      'commitea', 'pushea', 'mergea', 'refactoriza', 'programa', 'compila', 'testea'
    ]
  },
  ops: {
    frases: [
      'docker status', 'docker restart', 'docker ps', 'docker logs', 'docker compose', 'docker container', 'docker containers',
      'estado de docker', 'reiniciar docker', 'reinicia el contenedor', 'parar contenedor', 'iniciar contenedor',
      'bash console', 'consola bash', 'consola remota', 'terminal bash', 'ejecutar comando', 'linea de comandos',
      'espacio en disco', 'disco lleno', 'purga de disco', 'limpiar disco', 'almacenamiento en disco', 'df -h',
      'fail2ban', 'ip bloqueada', 'bloqueo de ip', 'fuerza bruta', 'intento de intruso', 'auth log',
      'certificado ssl', 'certificados ssl', 'caducidad ssl', 'expiracion ssl', 'renovar ssl', 'socket tls',
      'cloudflare tunnel', 'tailscale tunnel', 'gestor de tuneles', 'levantar tunel', 'cerrar tunel',
      'copia de seguridad', 'backup cifrado', 'backup de sesion', 'restaurar backup', 'hacer backup',
      'system monitor', 'monitor de sistema', 'uso de cpu', 'uso de memoria', 'consumo de ram', 'carga del servidor',
      'oracle cloud', 'instancia vps', 'servidor vps', 'factura oracle',
      'wake on lan', 'dispositivos de red', 'vigilancia de red', 'escaner de red',
      'pm2 status', 'pm2 restart', 'pm2 logs', 'reiniciar servicio',
      'docker_status', 'docker_restart', 'bash_console', 'disk_status', 'execute_bash_command'
    ],
    palabrasClave: [
      'docker', 'contenedor', 'contenedores', 'container', 'containers',
      'vps', 'sysadmin', 'pm2', 'systemd', 'servidor', 'daemon',
      'ssh', 'bash', 'otp', '2fa',
      'disco', 'fail2ban', 'firewall', 'iptables',
      'ssl', 'tls', 'x509',
      'tunel', 'tuneles', 'tailscale', 'cloudflared',
      'backup', 'backups',
      'uptime', 'ram', 'cpu'
    ],
    apoyo: [
      'infraestructura', 'red', 'puertos', 'ancho de banda', 'trafico', 'descargas', 'qbittorrent', 'domotica'
    ],
    verbosAccion: [
      'reinicia', 'apaga', 'enciende', 'monitorea', 'purga', 'despliega', 'bloquea'
    ]
  },
  personal: {
    frases: [
      'nota personal', 'notas personales', 'guardar nota', 'crear nota', 'leer nota', 'mis notas',
      'segundo cerebro', 'second brain', 'memoria personal', 'recuerdo personal',
      'diario nocturno', 'escribir en el diario', 'hitos del dia', 'bitacora diaria', 'reflexion del dia',
      'tracker de habitos', 'racha de habitos', 'marcar habito', 'registrar habito', 'habito diario',
      'repaso espaciado', 'flashcard', 'flashcards', 'tarjetas de repaso', 'mazo anki', 'algoritmo sm-2',
      'plan de estudio', 'sesion de estudio', 'fecha de examen', 'organizar estudio', 'repasar apuntes',
      'registro de gasto', 'apuntar gasto', 'gasto de', 'gastado en', 'ticket de compra', 'factura de compra', 'resumen de gastos',
      'estado de presupuestos', 'limite de presupuesto', 'control presupuestario', 'aviso de suscripcion',
      'crear recordatorio', 'ponme un recordatorio', 'recuerdame a las', 'avisame manana', 'programar alarma',
      'programar mensaje', 'mensaje programado', 'contacto vcard', 'enviar vcard',
      'lista de la compra', 'menu semanal', 'recomendar pelicula', 'recomendar serie',
      'organizar quedada', 'crear quedada', 'quedada con amigos',
      'fecha senalada', 'cumpleanos de', 'aniversario de'
    ],
    palabrasClave: [
      'agenda', 'calendario', 'recordatorio', 'recordatorios', 'recuerdame', 'avisame',
      'gasto', 'gastos', 'gaste', 'factura', 'facturas', 'ticket', 'tickets', 'presupuesto', 'presupuestos', 'suscripcion', 'suscripciones',
      'habito', 'habitos', 'racha', 'rachas', 'diario', 'flashcard', 'flashcards', 'apuntes', 'examen',
      'quedada', 'quedadas'
    ],
    apoyo: [
      'cita', 'citas', 'reunion', 'reuniones', 'evento', 'eventos', 'cumpleanos', 'alarma', 'snooze',
      'compra', 'compras', 'menu', 'rutina', 'pelicula', 'serie', 'receta', 'deporte', 'amigos', 'familia'
    ],
    verbosAccion: [
      'recuerda', 'apunta', 'anota', 'agenda', 'revisa', 'felicita'
    ]
  }
};

const PATRONES_GENERAL = {
  frases: [
    'hola', 'buenos dias', 'buenas tardes', 'buenas noches', 'que tal', 'como estas',
    'quien eres', 'que puedes hacer', 'ayuda general', 'gracias', 'muchas gracias', 'adios', 'hasta luego',
    'tiempo', 'clima', 'temperatura', 'va a llover', 'pronostico del tiempo',
    'noticias de hoy', 'titulares', 'que pasa en el mundo'
  ],
  palabrasClave: [
    'hola', 'saludos', 'clima', 'tiempo', 'noticias', 'resumen', 'conversacion'
  ]
};

/**
 * Clasifica de forma inteligente la peticion de usuario hacia uno de los especialistas:
 * 'coder', 'ops', 'personal' o 'general'.
 *
 * @param {string|object} mensajeUsuario - Texto del usuario o payload con propiedad mensaje/texto.
 * @param {object} [contexto={}] - Opciones de contexto (historial, especialistaPrevio, especialistaForzado, etc.).
 * @returns {{ especialista: string, confianza: number, razon: string }}
 */
export function clasificarEspecialista(mensajeUsuario, contexto = {}) {
  const ctx = (contexto && typeof contexto === 'object') ? contexto : {};

  // 1. Validacion de especialista forzado explicitamente por contexto
  if (ctx.especialistaForzado && typeof ctx.especialistaForzado === 'string') {
    const forzado = ctx.especialistaForzado.toLowerCase().trim();
    if (CONFIGURACIONES_ESPECIALISTAS[forzado]) {
      return {
        especialista: forzado,
        confianza: 1.0,
        razon: `Especialista ${forzado} forzado explicitamente por contexto`
      };
    }
  }

  // 2. Extraer y normalizar texto
  const textoEntrada = typeof mensajeUsuario === 'string'
    ? mensajeUsuario
    : (mensajeUsuario?.texto || mensajeUsuario?.mensaje || mensajeUsuario?.content || String(mensajeUsuario || ''));
  const textoOriginal = textoEntrada.trim();

  if (!textoOriginal) {
    return {
      especialista: 'general',
      confianza: 1.0,
      razon: 'Mensaje vacio o no especificado, asignado a especialista general'
    };
  }

  const textoNorm = normalizarTexto(textoOriginal);

  // 3. Continuacion de conversacion previa si el mensaje es breve de confirmacion
  if (ctx.especialistaPrevio && typeof ctx.especialistaPrevio === 'string') {
    const previo = ctx.especialistaPrevio.toLowerCase().trim();
    if (CONFIGURACIONES_ESPECIALISTAS[previo]) {
      const palabras = textoNorm.split(/\s+/).filter(Boolean);
      if (palabras.length <= 4) {
        const vocabularioConfirmacion = new Set([
          'si', 'ok', 'vale', 'hazlo', 'procede', 'adelante', 'continua', 'dale',
          'ejecuta', 'ejecutalo', 'perfecto', 'correcto', 'muestra', 'mas', 'siguiente',
          'por', 'favor', 'confirmo', 'avanza', 'sigue', 'claro'
        ]);
        const todasConfirmaciones = palabras.every(p => vocabularioConfirmacion.has(p));
        if (todasConfirmaciones) {
          return {
            especialista: previo,
            confianza: 0.88,
            razon: `Continuacion de conversacion previa con especialista ${previo}`
          };
        }
      }
    }
  }

  // 4. Calculo de puntuacion semantica por especialista
  const puntuaciones = {
    coder: { score: 0, coincidencias: [] },
    ops: { score: 0, coincidencias: [] },
    personal: { score: 0, coincidencias: [] }
  };

  for (const [esp, patrones] of Object.entries(PATRONES_ESPECIALISTAS)) {
    // 4.1 Frases compuestas de alta especificidad (peso 4.5)
    for (const frase of patrones.frases) {
      if (textoNorm.includes(frase)) {
        puntuaciones[esp].score += 4.5;
        puntuaciones[esp].coincidencias.push(frase);
      }
    }

    // 4.2 Palabras clave delimitadas (peso 2.5)
    for (const palabra of patrones.palabrasClave) {
      const regex = new RegExp(`\\b${palabra}\\b`, 'i');
      if (regex.test(textoNorm)) {
        puntuaciones[esp].score += 2.5;
        puntuaciones[esp].coincidencias.push(palabra);
      }
    }

    // 4.3 Terminos de apoyo contextual (peso 1.0)
    for (const apoyo of patrones.apoyo) {
      const regex = new RegExp(`\\b${apoyo}\\b`, 'i');
      if (regex.test(textoNorm)) {
        puntuaciones[esp].score += 1.0;
        puntuaciones[esp].coincidencias.push(apoyo);
      }
    }

    // 4.4 Verbos de accion especificos del dominio (peso 1.5)
    for (const verbo of patrones.verbosAccion) {
      const regex = new RegExp(`\\b${verbo}\\b`, 'i');
      if (regex.test(textoNorm)) {
        puntuaciones[esp].score += 1.5;
        puntuaciones[esp].coincidencias.push(verbo);
      }
    }
  }

  // 4.5 Supresion de contexto negativo (negative context suppression)
  if (/(?:no\s+(?:hagas\s+nada\s+de|uses?|toques?|quiero)?|nada\s+de|olvida|sin)\s+(?:docker|vps|servidor|infraestructura)/i.test(textoNorm)) {
    puntuaciones.ops.score = 0;
    puntuaciones.ops.coincidencias = [];
  }
  if (/(?:no\s+(?:hagas\s+nada\s+de|uses?|toques?|quiero)?|nada\s+de|olvida|sin)\s+(?:git|commit|pull request|pr)/i.test(textoNorm)) {
    puntuaciones.coder.score = 0;
    puntuaciones.coder.coincidencias = [];
  }

  // 5. Determinar el ganador
  const ordenados = Object.entries(puntuaciones)
    .map(([esp, datos]) => ({ especialista: esp, score: datos.score, coincidencias: datos.coincidencias }))
    .sort((a, b) => b.score - a.score);

  const mejor = ordenados[0];
  const segundo = ordenados[1];

  // 6. Caso sin coincidencias especializadas -> Evaluar intenciones generales o fallback
  if (mejor.score === 0) {
    let generalCoincidencias = [];
    for (const frase of PATRONES_GENERAL.frases) {
      if (textoNorm.includes(frase)) {
        generalCoincidencias.push(frase);
      }
    }
    for (const palabra of PATRONES_GENERAL.palabrasClave) {
      const regex = new RegExp(`\\b${palabra}\\b`, 'i');
      if (regex.test(textoNorm)) {
        generalCoincidencias.push(palabra);
      }
    }

    if (generalCoincidencias.length > 0) {
      return {
        especialista: 'general',
        confianza: 0.92,
        razon: `Detectada consulta general o conversacional (coincidencias: ${generalCoincidencias.slice(0, 3).join(', ')})`
      };
    }

    return {
      especialista: 'general',
      confianza: 0.50,
      razon: 'Sin intenciones especificas detectadas para Coder, Ops o Personal, aplicando enrutamiento general'
    };
  }

  // 7. Calculo calibrado de confianza
  let confianza = 0.70;
  if (mejor.score >= 4.0) {
    confianza = Math.min(0.98, 0.88 + (mejor.score - 4.0) * 0.02);
    if (mejor.score - segundo.score >= 2.0) {
      confianza = Math.max(confianza, 0.93);
    }
  } else if (mejor.score >= 2.0) {
    confianza = 0.75 + (mejor.score - 2.0) * 0.06;
  } else {
    confianza = 0.60 + mejor.score * 0.06;
  }

  confianza = Math.min(0.99, Math.max(0.50, Number(confianza.toFixed(2))));

  // 8. Generar descripcion explicita de razon
  const descriptores = {
    coder: 'desarrollo, programacion y control de versiones git',
    ops: 'operaciones de sistemas, VPS e infraestructura',
    personal: 'organizacion personal, finanzas y habitos'
  };

  const muestrasCoincidencias = Array.from(new Set(mejor.coincidencias)).slice(0, 4).join(', ');
  const razon = `Detectada intencion de ${descriptores[mejor.especialista] || mejor.especialista} (coincidencias: ${muestrasCoincidencias})`;

  return {
    especialista: mejor.especialista,
    confianza,
    razon
  };
}

/**
 * Devuelve la configuracion de un especialista con su nombre, system prompt modificado
 * y catalogo acotado de herramientas estrictamente bajo el limite de 128 items.
 *
 * @param {string} especialista - Identificador ('coder', 'ops', 'personal', 'general').
 * @returns {{ nombre: string, herramientasPermitidas: string[], systemPromptMod: string }}
 */

/**
 * Genera ejemplos contextuales Few-Shot dinamicos para afinar el determinismo
 * y la precision de parametros en las herramientas del especialista.
 *
 * @param {string} especialista - Identificador del especialista.
 * @param {string|object} [query=''] - Mensaje o consulta de usuario.
 * @returns {string}
 */
export function obtenerEjemplosFewShot(especialista, query = '') {
  const q = String(typeof query === 'string' ? query : (query?.texto || query?.mensaje || '')).toLowerCase();
  const ejemplos = [];

  // Los ejemplos deben usar herramientas que existen en el catalogo real:
  // un ejemplo con una herramienta ausente ensenia al modelo a llamarla y
  // la llamada siempre falla.
  if (especialista === 'coder' || q.includes('pr') || q.includes('git') || q.includes('commit') || q.includes('rama')) {
    ejemplos.push(
      '- Usuario: "Revisa la PR 42" -> revisar_pr({ numero: 42 })',
      '- Usuario: "Redacta el changelog desde v1.2.0" -> generar_changelog({ desde: "v1.2.0" })'
    );
  }
  if (especialista === 'personal' || q.includes('gasto') || q.includes('compra') || q.includes('habito')) {
    ejemplos.push(
      '- Usuario: "Apunta 15 euros de comida" -> registrar_gasto({ cantidad: 15, concepto: "comida", categoria: "alimentacion" })',
      '- Usuario: "Anade leche a la lista" -> anadir_compra({ articulo: "leche" })'
    );
  }
  if (q.includes('tren') || q.includes('renfe') || q.includes('cercanias') || q.includes('atocha') || q.includes('chamartin')) {
    ejemplos.push(
      '- Usuario: "Proximos trenes de Chamartin" -> proximas_llegadas_transporte({ parada: "chamartin", tipo: "cercanias" })'
    );
  }

  if (ejemplos.length === 0) return '';
  return '\n\nEJEMPLOS IN-CONTEXT DE LLAMADAS A HERRAMIENTAS (REPETIBILIDAD TOTAL):\n' + ejemplos.join('\n');
}

export function obtenerConfiguracionEspecialista(especialista) {
  const clave = String(especialista || '').toLowerCase().trim();
  const config = CONFIGURACIONES_ESPECIALISTAS[clave] || CONFIGURACIONES_ESPECIALISTAS.general;

  return {
    nombre: config.nombre,
    herramientasPermitidas: [...config.herramientasPermitidas],
    systemPromptMod: config.systemPromptMod
  };
}

/**
 * Enruta la peticion del usuario, clasifica el especialista adecuado y filtra
 * el catalogo de herramientas disponibles para acotarlo de forma segura bajo el limite de 128.
 *
 * @param {string|object} mensajeUsuario - Mensaje o peticion del usuario.
 * @param {Array} [herramientasDisponibles] - Catalogo de herramientas (objetos o cadenas). Si es omitido o nulo, usa herramientasJarvis.
 * @param {object} [opciones={}] - Opciones adicionales (contexto, especialistaForzado, maxHerramientas, etc.).
 * @returns {{ especialista: string, confianza: number, razon: string, configuracion: object, herramientas: Array, herramientasFiltradas: Array }}
 */
export function enrutarYFiltrarHerramientas(mensajeUsuario, herramientasDisponibles, opciones = {}) {
  const opts = (opciones && typeof opciones === 'object') ? opciones : {};
  const contexto = opts.contexto || (opts.especialistaForzado || opts.especialistaPrevio ? opts : {});

  // 1. Clasificacion inteligente
  const clasificacion = clasificarEspecialista(mensajeUsuario, contexto);
  const especialista = opts.especialistaForzado || clasificacion.especialista;

  // 2. Obtencion de configuracion y catalogo permitido
  const configuracion = obtenerConfiguracionEspecialista(especialista);
  const fewShot = obtenerEjemplosFewShot(especialista, mensajeUsuario);
  if (fewShot) configuracion.systemPromptMod += fewShot;
  const permitidas = new Set(configuracion.herramientasPermitidas);

  // 3. Seleccion del catalogo base
  const catalogo = (herramientasDisponibles !== undefined && herramientasDisponibles !== null)
    ? herramientasDisponibles
    : herramientasJarvis;

  const listaHerramientas = Array.isArray(catalogo) ? catalogo : [];

  // 4. Filtrado y deduplicacion de herramientas
  const mapaDeduplicado = new Map();
  const presentes = new Set();
  for (const herramienta of listaHerramientas) {
    const nombre = typeof herramienta === 'string'
      ? herramienta
      : (herramienta?.function?.name || herramienta?.name);
    if (nombre) presentes.add(nombre);
    if (nombre && permitidas.has(nombre) && !mapaDeduplicado.has(nombre)) {
      mapaDeduplicado.set(nombre, herramienta);
    }
  }

  // Visibilidad: nombres configurados para el especialista que no existen en
  // el catalogo ESTATICO completo (herramientas aun no conectadas o
  // renombradas). `catalogo` suele ser solo la preseleccion de esta peticion,
  // asi que ausente de ahi NO significa inexistente: el aviso anterior
  // acusaba "no existen en el catalogo" a decenas de herramientas reales que
  // simplemente no venian preseleccionadas (ruido observado en vivo).
  const nombresCatalogoCompleto = new Set(
    herramientasJarvis.map((h) => (typeof h === 'string' ? h : (h?.function?.name || h?.name))).filter(Boolean)
  );
  const inexistentes = [...permitidas].filter((n) => !nombresCatalogoCompleto.has(n));
  if (inexistentes.length > 0) {
    console.warn(`[RouterEspecialista] ${inexistentes.length} herramientas permitidas para ${especialista} no existen en el catalogo completo y se ignoran: ${inexistentes.join(', ')}`);
  }

  let filtradas = Array.from(mapaDeduplicado.values());

  // 5. Garantia estricta del limite del proveedor (estrictamente menor que 128)
  const limiteMax = Math.min(typeof opts.maxHerramientas === 'number' && opts.maxHerramientas > 0 ? opts.maxHerramientas : 127, 127);

  if (filtradas.length > limiteMax) {
    filtradas = filtradas.slice(0, limiteMax);
  }

  return {
    especialista,
    confianza: clasificacion.confianza,
    razon: clasificacion.razon,
    configuracion,
    herramientas: filtradas,
    herramientasFiltradas: filtradas
  };
}
