/**
 * taskPlannerService.js - Planificacion de tareas compuestas (Plan-and-Solve, RF-COG-04)
 *
 * Detecta peticiones multi-paso, las descompone de forma determinista (coste 0 LLM)
 * en sub-objetivos ordenados con dominio y herramienta sugerida, rastrea su progreso
 * durante el bucle ReAct y genera directivas concisas en espanol cuando quedan
 * pasos pendientes sin ejecutar.
 *
 * Strict Policy: Zero Emojis.
 */

const INTENCIONES_NO_ACCION = new Set(['conversacion', 'chitchat', 'saludo']);

const DOMINIOS_CONSULTA_SIMPLE = new Set(['clima', 'transporte']);

const CONECTORES_SECUENCIALES = [
  /\by\s+luego\b/i,
  /\by\s+despu[eé]s\b/i,
  /[.;,]\s*despu[eé]s\b(?!\s+de\s+(?:las?\s+\d|comer|cenar|desayunar|trabajar|clase)\b[^,.;]*$)/i,
  /\bdespu[eé]s\b(?=\s+(?:crea|creame|manda|mandale|mandame|envia|enviale|enviame|anade|anademe|agrega|busca|buscame|consulta|revisa|guarda|apunta|anota|programa|pon|ponme|haz|hazme|registra|recuerda|recuerdame|avisa|avisame|resume|resumeme|dime|dile|muestra|cancela|elimina|lista|mira|organiza|prepara)\b)/i,
  /\by\s+adem[aá]s\b/i,
  /[.;,]\s*adem[aá]s\b(?!\s+de\s+(?:lluvia|nieve|viento|sol|eso)\b[^,.;]*$)/i,
  /\badem[aá]s\b(?=\s+(?:crea|creame|manda|mandale|mandame|envia|enviale|enviame|anade|anademe|agrega|busca|buscame|consulta|revisa|guarda|apunta|anota|programa|pon|ponme|haz|hazme|registra|recuerda|recuerdame|avisa|avisame|resume|resumeme|dime|dile|muestra|cancela|elimina|lista|mira|organiza|prepara|quiero|necesito)\b)/i,
  /\by\s+(?:crea|cr[eé]ame|manda|m[aá]ndale|m[aá]ndame|env[ií]a|env[ií]ale|env[ií]ame|a[nñ]ade|a[nñ][aá]deme|agrega|agr[eé]game|busca|b[uú]scame|consulta|cons[uú]ltame|revisa|rev[ií]same|guarda|gu[aá]rdame|apunta|ap[uú]ntame|anota|an[oó]tame|programa|progr[aá]mame|ponme|hazme|registra|reg[ií]strame|recuerda|recu[eé]rdame|avisa|av[ií]same|resume|res[uú]meme|cancela|elimina|borra|lista|l[ií]stame|mu[eé]strame|dile|escr[ií]bele)\b/i,
  /\b(?:por\s+[uú]ltimo|finalmente|acto\s+seguido|a\s+continuaci[oó]n)\b/i
];

const VERBOS_ACCION = [
  'crea', 'creame', 'manda', 'mandale', 'mandame', 'envia', 'enviale', 'enviame',
  'anade', 'anademe', 'agrega', 'agregame', 'busca', 'buscame', 'consulta', 'consultame',
  'mira', 'mirame', 'revisa', 'revisame', 'guarda', 'guardame', 'apunta', 'apuntame',
  'anota', 'anotame', 'programa', 'programame', 'pon', 'ponme', 'haz', 'hazme',
  'registra', 'registrame', 'recuerda', 'recuerdame', 'avisa', 'avisame',
  'resume', 'resumeme', 'cancela', 'elimina', 'borra', 'lista', 'listame',
  'dime', 'dile', 'muestra', 'muestrame', 'calcula', 'analiza',
  'escribe', 'escribele', 'redacta', 'abre', 'ejecuta', 'verifica', 'comprueba', 'actualiza',
  'modifica', 'tacha', 'vacia', 'marca', 'planifica', 'repasa', 'vigila', 'audita',
  'organiza', 'organizame', 'prepara', 'preparame'
];

const RE_VERBO_ACCION = new RegExp(`\\b(?:${VERBOS_ACCION.join('|')})\\b`, 'i');
const RE_Y_VERBO_ACCION = new RegExp(`\\s+y\\s+(?=(?:${VERBOS_ACCION.join('|')})\\b)`, 'i');
const RE_CHITCHAT_PURO = /^(?:hola|buenas|buenos\s+dias|buenas\s+tardes|buenas\s+noches|que\s+tal|como\s+estas|ey|hey|gracias|muchas\s+gracias|vale|ok|perfecto|genial|jajaja+|adios|hasta\s+luego|luego\s+hablamos|bueno\s*,?\s*luego\s+hablamos)\b/i;

const REGLAS_DOMINIO = [
  {
    dominio: 'clima',
    herramientas: ['consultar_clima'],
    patron: /\b(clima|tiempo|lluvia|llover|temperatura|pronostico|grados|calor|frio|tormenta|sol|nublado|meteorolog\w*)\b/i
  },
  {
    dominio: 'transporte',
    herramientas: ['proximas_llegadas_transporte', 'listar_paradas_favoritas', 'registrar_parada_favorita', 'eliminar_parada_favorita'],
    patron: /\b(tren|trenes|cercanias|renfe|bus|buses|autobus|emt|metro|parada|marquesina|estacion|llegadas|linea\s+\d+)\b/i,
    resolverHerramienta: (norm) => {
      if (/\b(guarda|anade|registra|marca)\b.*\bparada\b/i.test(norm)) return 'registrar_parada_favorita';
      if (/\b(elimina|borra|quita)\b.*\bparada\b/i.test(norm)) return 'eliminar_parada_favorita';
      if (/\b(lista|mis|ver|cuales)\b.*\bparadas\b/i.test(norm)) return 'listar_paradas_favoritas';
      return 'proximas_llegadas_transporte';
    }
  },
  {
    dominio: 'mensajeProgramado',
    herramientas: ['programar_mensaje_whatsapp', 'listar_mensajes_programados', 'cancelar_mensaje_programado'],
    patron: /\b(whatsapp|mensaje\s+programado|mensajes\s+programados|manda(?:le|me)?\s+(?:un\s+)?(?:whatsapp|mensaje)|envia(?:le|me)?\s+(?:un\s+)?(?:whatsapp|mensaje)|escribe(?:le)?\s+(?:a|un)|dile\s+a\s+\w+\s+por\s+whatsapp|programa(?:r)?\s+(?:un\s+)?mensaje)\b/i,
    resolverHerramienta: (norm) => {
      if (/\b(cancela|anula|elimina|borra)\b.*\bmensaje\b/i.test(norm)) return 'cancelar_mensaje_programado';
      if (/\b(lista|ver|pendientes|que)\b.*\bmensajes\s+programados\b/i.test(norm)) return 'listar_mensajes_programados';
      return 'programar_mensaje_whatsapp';
    }
  },
  {
    dominio: 'recordatorio',
    herramientas: ['crear_recordatorio', 'listar_recordatorios', 'cancelar_recordatorio'],
    patron: /\b(recordatorio|recordatorios|recuerdame|recuerda\s+(?:que|hacer|llamar|ir|pagar|comprar)|avisame|alarma)\b/i,
    resolverHerramienta: (norm) => {
      if (/\b(cancela|elimina|borra|quita)\b.*\brecordatorio\b/i.test(norm)) return 'cancelar_recordatorio';
      if (/\b(lista|ver|mis|que|cuales|pendientes)\b.*\brecordatorios?\b/i.test(norm)) return 'listar_recordatorios';
      return 'crear_recordatorio';
    }
  },
  {
    dominio: 'calendario',
    herramientas: ['crear_evento', 'modificar_evento', 'cancelar_evento'],
    patron: /\b(calendario|evento|eventos|reunion|reuniones|agenda|cita\s+en\s+(?:el\s+)?calendario)\b/i,
    resolverHerramienta: (norm) => {
      if (/\b(cancela|elimina|borra)\b.*\b(evento|cita|reunion)\b/i.test(norm)) return 'cancelar_evento';
      if (/\b(modifica|cambia|mueve|reprograma)\b.*\b(evento|cita|reunion)\b/i.test(norm)) return 'modificar_evento';
      return 'crear_evento';
    }
  },
  {
    dominio: 'bienestar',
    herramientas: [
      'anadir_compra', 'listar_compra', 'tachar_compra', 'vaciar_compra',
      'registrar_habito', 'marcar_habito', 'listar_habitos',
      'escribir_diario', 'leer_diario',
      'poner_menu', 'ver_menu', 'sugerir_menu',
      'crear_quedada', 'listar_quedadas', 'redactar_invitacion'
    ],
    patron: /\b(lista\s+de\s+(?:la\s+)?compra|a\s+la\s+compra|de\s+la\s+compra|comprar\s+en\s+el\s+super|supermercado|habito|habitos|diario|menu\s+semanal|menu\s+de\s+la\s+semana|quedada|quedadas|invitacion)\b/i,
    resolverHerramienta: (norm) => {
      if (/\b(compra|supermercado)\b/i.test(norm)) {
        if (/\b(vacia|limpia|borra\s+toda)\b/i.test(norm)) return 'vaciar_compra';
        if (/\b(tacha|quita|elimina)\b/i.test(norm)) return 'tachar_compra';
        if (/\b(lista|ver|que\s+hay|que\s+tengo|muestra)\b/i.test(norm) && !/\b(anade|agrega|apunta|pon|mete)\b/i.test(norm)) return 'listar_compra';
        return 'anadir_compra';
      }
      if (/\bhabito/i.test(norm)) {
        if (/\b(lista|ver|mis)\b/i.test(norm)) return 'listar_habitos';
        if (/\b(marca|cumpli|hecho|completa)\b/i.test(norm)) return 'marcar_habito';
        return 'registrar_habito';
      }
      if (/\bdiario\b/i.test(norm)) {
        return /\b(lee|ver|muestra|que\s+escribi)\b/i.test(norm) ? 'leer_diario' : 'escribir_diario';
      }
      if (/\bmenu\b/i.test(norm)) {
        if (/\bsugier/i.test(norm)) return 'sugerir_menu';
        if (/\b(ver|que|cual|muestra)\b/i.test(norm)) return 'ver_menu';
        return 'poner_menu';
      }
      if (/\bquedada/i.test(norm)) {
        return /\b(lista|ver|mis|pendientes)\b/i.test(norm) ? 'listar_quedadas' : 'crear_quedada';
      }
      return 'redactar_invitacion';
    }
  },
  {
    dominio: 'finanzas',
    herramientas: ['registrar_gasto', 'listar_gastos', 'resumen_gastos_mes', 'registrar_suscripcion', 'listar_suscripciones', 'estado_presupuestos'],
    patron: /\b(gasto|gastos|euro|euros|eur|presupuesto|suscripcion|suscripciones|factura|pagado|pague)\b/i,
    resolverHerramienta: (norm) => {
      if (/\bsuscripcion/i.test(norm)) {
        return /\b(lista|ver|mis|cuales)\b/i.test(norm) ? 'listar_suscripciones' : 'registrar_suscripcion';
      }
      if (/\bpresupuesto/i.test(norm)) return 'estado_presupuestos';
      if (/\b(resumen|cuanto\s+llevo|total)\b/i.test(norm)) return 'resumen_gastos_mes';
      if (/\b(lista|ver|mis|consulta|revisa|muestra)\b.*\bgastos?\b/i.test(norm)) return 'listar_gastos';
      return 'registrar_gasto';
    }
  },
  {
    dominio: 'notas',
    herramientas: ['guardar_nota_personal', 'listar_notas_recientes'],
    patron: /\b(nota|notas|apunta(?:me)?\s+(?:esto|una\s+nota)|anota(?:me)?\s+(?:esto|una\s+nota))\b/i,
    resolverHerramienta: (norm) => (/\b(lista|ver|mis|recientes|muestra)\b.*\bnotas?\b/i.test(norm) ? 'listar_notas_recientes' : 'guardar_nota_personal')
  },
  {
    dominio: 'noticias',
    herramientas: ['obtener_noticias_actuales', 'navegar_y_leer_noticia'],
    patron: /\b(noticia|noticias|titulares|actualidad|periodico)\b/i,
    resolverHerramienta: (norm) => (/\b(lee|abre|profundiza|navega)\b/i.test(norm) ? 'navegar_y_leer_noticia' : 'obtener_noticias_actuales')
  },
  {
    dominio: 'navegacion',
    herramientas: ['resumir_enlace', 'navegar_y_leer_noticia'],
    patron: /\b(enlace|link|url|https?:\/\/|pagina\s+web|articulo)\b/i,
    resolverHerramienta: (norm) => (/\b(resum|sintetiz)\w*\b/i.test(norm) ? 'resumir_enlace' : 'navegar_y_leer_noticia')
  },
  {
    dominio: 'compras',
    herramientas: ['buscar_producto', 'verificar_oferta'],
    patron: /\b(producto|ofertas?|chollo|amazon|precio\s+de|busca(?:me)?\s+(?:un|una|el|la|ofertas?)\b)\b/i,
    resolverHerramienta: (norm) => (/\boferta\b/i.test(norm) ? 'verificar_oferta' : 'buscar_producto')
  },
  {
    dominio: 'sniper',
    herramientas: ['vigilar_producto', 'listar_productos_vigilados', 'cancelar_vigilancia'],
    patron: /\b(vigila(?:r)?\s+(?:el\s+)?precio|productos\s+vigilados|sniper|alerta\s+de\s+precio)\b/i
  },
  {
    dominio: 'contactos',
    herramientas: ['buscar_contacto', 'listar_contactos', 'registrar_contacto'],
    patron: /\b(contacto|contactos|telefono\s+de|numero\s+de)\b/i,
    resolverHerramienta: (norm) => {
      if (/\b(registra|guarda|anade|crea)\b/i.test(norm)) return 'registrar_contacto';
      if (/\b(lista|todos|mis)\b.*\bcontactos\b/i.test(norm)) return 'listar_contactos';
      return 'buscar_contacto';
    }
  },
  {
    dominio: 'memoria',
    herramientas: ['buscar_memoria', 'guardar_memoria', 'listar_memorias', 'olvidar_memoria'],
    patron: /\b(memoria|memorias|recuerdo|recuerdos|acuerdate\s+de|olvida\s+que)\b/i,
    resolverHerramienta: (norm) => {
      if (/\b(olvida|borra|elimina)\b/i.test(norm)) return 'olvidar_memoria';
      if (/\b(guarda|memoriza|anota|acuerdate)\b/i.test(norm)) return 'guardar_memoria';
      if (/\b(lista|ver|todas)\b/i.test(norm)) return 'listar_memorias';
      return 'buscar_memoria';
    }
  },
  {
    dominio: 'estudio',
    herramientas: ['planificar_estudio', 'listar_planes_estudio', 'registrar_avance_estudio', 'crear_flashcard', 'repasar_flashcards'],
    patron: /\b(estudio|estudiar|examen|temario|asignatura|flashcard|flashcards)\b/i,
    resolverHerramienta: (norm) => {
      if (/\bflashcard/i.test(norm)) return /\b(crea|anade|nueva)\b/i.test(norm) ? 'crear_flashcard' : 'repasar_flashcards';
      if (/\b(lista|ver|mis)\b.*\bplanes?\b/i.test(norm)) return 'listar_planes_estudio';
      if (/\b(avance|complet|termine)\b/i.test(norm)) return 'registrar_avance_estudio';
      return 'planificar_estudio';
    }
  },
  {
    dominio: 'carrera',
    herramientas: ['registrar_entrega', 'listar_entregas', 'resumir_apuntes', 'analizar_cv_oferta', 'iniciar_simulacro_entrevista'],
    patron: /\b(entrega|entregas|apuntes|curriculum|\bcv\b|simulacro|entrevista)\b/i,
    resolverHerramienta: (norm) => {
      if (/\bapuntes\b/i.test(norm)) return 'resumir_apuntes';
      if (/\bcv|curriculum\b/i.test(norm)) return 'analizar_cv_oferta';
      if (/\bentrevista|simulacro\b/i.test(norm)) return 'iniciar_simulacro_entrevista';
      if (/\b(lista|ver|mis|pendientes)\b.*\bentregas?\b/i.test(norm)) return 'listar_entregas';
      return 'registrar_entrega';
    }
  },
  {
    dominio: 'empleo',
    herramientas: ['escanear_ofertas_empleo', 'registrar_candidatura', 'listar_candidaturas'],
    patron: /\b(empleo|ofertas\s+de\s+trabajo|candidatura|candidaturas)\b/i,
    resolverHerramienta: (norm) => {
      if (/\bcandidatura/i.test(norm)) return /\b(lista|ver|mis)\b/i.test(norm) ? 'listar_candidaturas' : 'registrar_candidatura';
      return 'escanear_ofertas_empleo';
    }
  },
  {
    dominio: 'viajes',
    herramientas: ['vigilar_ruta', 'listar_rutas_vigiladas', 'registrar_precio_ruta'],
    patron: /\b(vuelo|vuelos|viaje|viajes|ruta|rutas|billete\s+de\s+avion)\b/i
  },
  {
    dominio: 'github',
    herramientas: ['crear_rama_trabajo', 'crear_commit', 'abrir_pull_request', 'empujar_rama'],
    patron: /\b(github|rama|branch|commit|pull\s+request|\bpr\b|push)\b/i,
    resolverHerramienta: (norm) => {
      if (/\bpull\s+request|\bpr\b/i.test(norm)) return 'abrir_pull_request';
      if (/\bcommit\b/i.test(norm)) return 'crear_commit';
      if (/\bpush|empuja\b/i.test(norm)) return 'empujar_rama';
      return 'crear_rama_trabajo';
    }
  },
  {
    dominio: 'devtools',
    herramientas: ['anotar_idea', 'listar_ideas', 'revisar_pr', 'guiar_depuracion', 'generar_changelog', 'explicar_recorrido'],
    patron: /\b(idea\s+de\s+codigo|anota(?:r)?\s+idea|depura|debug|changelog|recorrido)\b/i
  },
  {
    dominio: 'servidor',
    herramientas: ['consultar_estado_servidor', 'get_infrastructure_status', 'estado_descargas'],
    patron: /\b(servidor|vps|cpu|ram|disco|docker|infraestructura|descargas)\b/i
  },
  {
    dominio: 'ops',
    herramientas: ['informe_metricas', 'auditar_dependencias', 'actividad_repos', 'crear_backup_sesion'],
    patron: /\b(metricas|dependencias|audita|backup)\b/i
  },
  {
    dominio: 'hogar',
    herramientas: ['controlar_domotica', 'encender_pc', 'listar_dispositivos_red'],
    patron: /\b(domotica|luces|encender\s+pc|dispositivos\s+de\s+red)\b/i
  },
  {
    dominio: 'cuota',
    herramientas: ['consultar_cuota_tenant', 'solicitar_upgrade_tenant'],
    patron: /\b(cuota|consumo\s+de\s+tokens|upgrade)\b/i
  }
];

const HERRAMIENTA_A_DOMINIO = new Map();
for (const regla of REGLAS_DOMINIO) {
  for (const h of regla.herramientas) {
    if (!HERRAMIENTA_A_DOMINIO.has(h)) {
      HERRAMIENTA_A_DOMINIO.set(h, regla.dominio);
    }
  }
}

const INTENCION_HERRAMIENTA_DEFECTO = Object.freeze({
  clima: 'consultar_clima',
  transporte: 'proximas_llegadas_transporte',
  mensajeProgramado: 'programar_mensaje_whatsapp',
  recordatorio: 'crear_recordatorio',
  calendario: 'crear_evento',
  notas: 'guardar_nota_personal',
  memoria: 'buscar_memoria',
  procedural: 'guardar_regla_procedural',
  bienestar: 'anadir_compra',
  compras: 'buscar_producto',
  sniper: 'vigilar_producto',
  finanzas: 'registrar_gasto',
  noticias: 'obtener_noticias_actuales',
  navegacion: 'resumir_enlace',
  contactos: 'buscar_contacto',
  estudio: 'planificar_estudio',
  carrera: 'listar_entregas',
  empleo: 'escanear_ofertas_empleo',
  viajes: 'vigilar_ruta',
  devtools: 'guiar_depuracion',
  github: 'crear_rama_trabajo',
  servidor: 'consultar_estado_servidor',
  infraestructura: 'get_infrastructure_status',
  ops: 'informe_metricas',
  hogar: 'controlar_domotica',
  cuota: 'consultar_cuota_tenant'
});

const ESTADOS_FALLO = new Set([
  'error',
  'fallido',
  'failed',
  'no_reconocida',
  'blocked',
  'checkpoint_failed_blocked',
  'uncertain_blocked'
]);

const ESTADOS_OK = new Set([
  'ok',
  'completado',
  'success'
]);

function normalizar(texto) {
  return String(texto || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function filtrarIntencionesActivas(intenciones) {
  if (!Array.isArray(intenciones)) return [];
  const vistas = new Set();
  const out = [];
  for (const raw of intenciones) {
    if (typeof raw !== 'string') continue;
    const limpia = raw.trim();
    if (!limpia) continue;
    if (INTENCIONES_NO_ACCION.has(limpia.toLowerCase())) continue;
    if (!vistas.has(limpia)) {
      vistas.add(limpia);
      out.push(limpia);
    }
  }
  return out;
}

function extraerEnumeraciones(texto) {
  const limpio = String(texto || '').trim();
  if (!limpio) return null;

  // Patron 1) ... 2) ... o 1. ... 2. ... o 1.- ... 2.- ...
  const rxItem = /(?:^|[\s;\n])([1-9]\d?)[.)](?:-)?\s+/g;
  const coincidencias = [];
  let m;
  while ((m = rxItem.exec(limpio)) !== null) {
    const num = Number.parseInt(m[1], 10);
    const inicioMarker = m.index + (m[0].startsWith(' ') || m[0].startsWith('\n') || m[0].startsWith('\t') || m[0].startsWith(';') ? 1 : 0);
    const inicioContenido = rxItem.lastIndex;
    coincidencias.push({ num, inicioMarker, inicioContenido });
  }

  if (coincidencias.length >= 2 && coincidencias[0].num === 1 && coincidencias.some((c) => c.num === 2)) {
    const partes = [];
    for (let i = 0; i < coincidencias.length; i++) {
      const inicio = coincidencias[i].inicioContenido;
      const fin = i + 1 < coincidencias.length ? coincidencias[i + 1].inicioMarker : limpio.length;
      const trozo = limpio.slice(inicio, fin).replace(/^[\s,;:-]+|[\s,;]+$/g, '').trim();
      if (trozo.length >= 3) partes.push(trozo);
    }
    if (partes.length >= 2) return partes;
  }

  // Vinetas multilinea (- ... \n - ...)
  const lineas = limpio.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const vinetas = lineas.filter((l) => /^[-*]\s+\S+/.test(l));
  if (vinetas.length >= 2 && vinetas.length === lineas.length) {
    return vinetas.map((l) => l.replace(/^[-*]\s+/, '').trim());
  }

  // Marcadores ordinales: "primero ... segundo ..."
  const norm = normalizar(limpio);
  if (/\bprimero\b/.test(norm) && /\bsegundo\b/.test(norm)) {
    const partesOrd = limpio
      .split(/\b(?:en\s+primer\s+lugar|en\s+segundo\s+lugar|en\s+tercer\s+lugar|primero|segundo|tercero)\b[:,]?\s*/i)
      .map((s) => s.replace(/^[\s,;:.]+|[\s,;]+$/g, '').trim())
      .filter((s) => s.length >= 3);
    if (partesOrd.length >= 2) return partesOrd;
  }

  return null;
}

function limpiarClausula(texto) {
  return String(texto || '')
    .replace(/^(?:y\s+luego|y\s+despu[eé]s|y\s+adem[aá]s|y\s+tambi[eé]n|luego|despu[eé]s(?!\s+de\b)|adem[aá]s(?!\s+de\b)|tambi[eé]n|por\s+[uú]ltimo|finalmente|acto\s+seguido|a\s+continuaci[oó]n|y)\b[\s,:-]*/i, '')
    .replace(/^[\s,;:.]+|[\s,;]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function detectarDominioRapido(texto) {
  const norm = normalizar(texto);
  for (const regla of REGLAS_DOMINIO) {
    if (regla.patron.test(norm)) return regla.dominio;
  }
  return 'general';
}

function dividirSiDominiosDivergentesPorY(clausula) {
  const m = /\s+y\s+/i.exec(clausula);
  if (!m) return [clausula];
  const izq = clausula.slice(0, m.index).trim();
  const der = clausula.slice(m.index + m[0].length).trim();
  if (izq.length < 4 || der.length < 4) return [clausula];
  const domIzq = detectarDominioRapido(izq);
  const domDer = detectarDominioRapido(der);
  if (domIzq !== 'general' && domDer !== 'general' && domIzq !== domDer) {
    return [izq, ...dividirSiDominiosDivergentesPorY(der)];
  }
  return [clausula];
}

function dividirClausulaPorConectores(clausula) {
  const trozos = [];
  const base = String(clausula || '').trim();
  if (!base) return trozos;

  // Primero saltos de linea y punto y seguido / punto y coma
  const bloques = base.split(/(?:\r?\n|;|\.\s+(?=[A-ZÁÉÍÓÚÑa-záéíóúñ]))/);

  for (const bloque of bloques) {
    // Conectores secuenciales explicitos (evitando cortar "despues de las 5" o "despues de comer")
    const subBloques = bloque.split(
      /(?:,\s*|\s+)(?:y\s+luego|y\s+despu[eé]s|y\s+adem[aá]s|y\s+tambi[eé]n|luego(?=\s*,|\s+[a-záéíóúñ])|por\s+[uú]ltimo|finalmente|acto\s+seguido|a\s+continuaci[oó]n)\b[\s,:-]*/i
    );

    for (const sub of subBloques) {
      // Corte adicional para "despues" / "ademas" cuando abren nueva accion
      const subDespues = sub.split(
        /(?:,\s*|\s+)(?:despu[eé]s|adem[aá]s)\b(?=\s*,|\s+(?:crea|cr[eé]ame|manda|m[aá]ndale|m[aá]ndame|env[ií]a|env[ií]ale|env[ií]ame|a[nñ]ade|a[nñ][aá]deme|agrega|busca|b[uú]scame|consulta|revisa|guarda|apunta|anota|programa|pon|ponme|haz|hazme|registra|recuerda|recu[eé]rdame|avisa|av[ií]same|resume|res[uú]meme|dime|dile|muestra|cancela|elimina|lista|mira|organiza|prepara|quiero|necesito)\b)/i
      );

      for (const sd of subDespues) {
        // Corte en " y <verbo_accion>" (no corta "pan y leche" ni "Madrid y Sevilla")
        const partesY = sd.split(RE_Y_VERBO_ACCION);
        for (const py of partesY) {
          // Corte en ", <verbo_accion>"
          const partesComa = py.split(new RegExp(`,\\s+(?=(?:${VERBOS_ACCION.join('|')})\\b)`, 'i'));
          for (const pc of partesComa) {
            for (const pd of dividirSiDominiosDivergentesPorY(pc)) {
              const limpia = limpiarClausula(pd);
              if (limpia.length >= 3) trozos.push(limpia);
            }
          }
        }
      }
    }
  }

  return trozos;
}

/**
 * Divide un mensaje compuesto en clausulas limpias y ordenadas (coste 0 LLM).
 */
export function dividirEnClausulas(mensaje) {
  if (!mensaje || typeof mensaje !== 'string') return [];
  const enumeradas = extraerEnumeraciones(mensaje);
  const origen = enumeradas || [mensaje];
  const resultado = [];
  for (const parte of origen) {
    const sub = dividirClausulaPorConectores(parte);
    for (const s of sub) {
      if (s.length >= 3) resultado.push(s);
    }
  }
  return resultado;
}

function normalizarCatalogoHerramientas(herramientas = []) {
  if (!Array.isArray(herramientas)) return [];
  return herramientas
    .map((h) => {
      if (typeof h === 'string') return { name: h, description: '' };
      if (h?.function?.name) return { name: h.function.name, description: h.function.description || '' };
      if (h?.name) return { name: h.name, description: h.description || '' };
      return null;
    })
    .filter((h) => h && h.name);
}

function inferirDominioYHerramienta(clausula, { catalogo = [], intenciones = [] } = {}) {
  const norm = normalizar(clausula);
  const nombresDisponibles = new Set(catalogo.map((h) => h.name));

  for (const regla of REGLAS_DOMINIO) {
    if (regla.patron.test(norm)) {
      const preferida = regla.resolverHerramienta ? regla.resolverHerramienta(norm) : regla.herramientas[0];
      let herramientaSugerida = preferida || regla.herramientas[0] || null;
      if (nombresDisponibles.size > 0 && !nombresDisponibles.has(herramientaSugerida)) {
        const alternativa = regla.herramientas.find((h) => nombresDisponibles.has(h));
        if (alternativa) herramientaSugerida = alternativa;
      }
      return { dominio: regla.dominio, herramientaSugerida };
    }
  }

  // Coincidencia por tokens contra herramientas proporcionadas
  if (catalogo.length > 0) {
    const tokens = norm.split(/[^a-z0-9]+/).filter((t) => t.length >= 4);
    let mejor = null;
    let mejorPuntos = 0;
    for (const tool of catalogo) {
      const textoTool = normalizar(`${tool.name.replace(/_/g, ' ')} ${tool.description}`);
      let puntos = 0;
      for (const tok of tokens) {
        if (textoTool.includes(tok)) puntos++;
      }
      if (puntos > mejorPuntos) {
        mejorPuntos = puntos;
        mejor = tool;
      }
    }
    if (mejor && mejorPuntos > 0) {
      return {
        dominio: HERRAMIENTA_A_DOMINIO.get(mejor.name) || 'general',
        herramientaSugerida: mejor.name
      };
    }
  }

  // Fallback suave usando intenciones activas si solo hay una clara
  const ints = filtrarIntencionesActivas(intenciones);
  if (ints.length === 1) {
    const dom = ints[0];
    return {
      dominio: dom,
      herramientaSugerida: INTENCION_HERRAMIENTA_DEFECTO[dom] || null
    };
  }

  return { dominio: 'general', herramientaSugerida: null };
}

function esConsultaSimpleClimaOTrenes(mensaje, intenciones = []) {
  const ints = filtrarIntencionesActivas(intenciones);
  if (ints.length >= 2) return false;
  if (extraerEnumeraciones(mensaje)) return false;

  const norm = normalizar(mensaje);
  const clausulas = dividirEnClausulas(mensaje);
  const dominios = new Set();

  for (const c of clausulas) {
    const inf = inferirDominioYHerramienta(c, { intenciones: ints });
    if (inf.dominio !== 'general') dominios.add(inf.dominio);
  }

  if (dominios.size > 1) return false;
  if (dominios.size === 1) {
    const [unico] = [...dominios];
    if (!DOMINIOS_CONSULTA_SIMPLE.has(unico)) return false;
    if (clausulas.length <= 1) return true;
    // Varias clausulas del mismo dominio simple sin segundo verbo de accion distinto
    const conVerbo = clausulas.filter((c) => RE_VERBO_ACCION.test(normalizar(c)));
    if (conVerbo.length <= 1 && !CONECTORES_SECUENCIALES.some((rx) => rx.test(norm))) {
      return true;
    }
  }

  if (ints.length === 1 && DOMINIOS_CONSULTA_SIMPLE.has(ints[0]) && clausulas.length <= 1) {
    return true;
  }

  return false;
}

/**
 * Determina si un mensaje constituye una peticion compuesta multi-paso que
 * requiere planificacion y seguimiento en el bucle ReAct.
 *
 * @param {string} mensaje
 * @param {string[]} [intenciones=[]]
 * @returns {boolean}
 */
export function detectarPeticionCompuesta(mensaje, intenciones = []) {
  if (!mensaje || typeof mensaje !== 'string') return false;
  const limpio = mensaje.trim();
  if (limpio.length < 5) return false;

  const norm = normalizar(limpio);
  const intsActivas = filtrarIntencionesActivas(intenciones);
  const tieneEnumeracion = Boolean(extraerEnumeraciones(limpio));

  // Proteccion contra chitchat puro
  const soloIntencionChitchat = Array.isArray(intenciones) && intenciones.length > 0 && intsActivas.length === 0;
  if (soloIntencionChitchat && !tieneEnumeracion) {
    const clausulasChat = dividirEnClausulas(limpio);
    const conAccion = clausulasChat.filter((c) => {
      const inf = inferirDominioYHerramienta(c);
      return inf.dominio !== 'general' || RE_VERBO_ACCION.test(normalizar(c));
    });
    if (conAccion.length < 2) return false;
  }

  if (RE_CHITCHAT_PURO.test(norm) && intsActivas.length === 0 && !tieneEnumeracion) {
    const clausulasChat = dividirEnClausulas(limpio);
    const conDominio = clausulasChat.filter((c) => inferirDominioYHerramienta(c).dominio !== 'general');
    if (conDominio.length < 2) return false;
  }

  // Proteccion contra consultas simples de clima o trenes
  if (esConsultaSimpleClimaOTrenes(limpio, intenciones)) {
    return false;
  }

  // 1. Multiples intenciones activas distintas
  if (intsActivas.length >= 2) {
    return true;
  }

  // 2. Enumeraciones explicitas (1)... 2)..., vinetas, primero/segundo)
  if (tieneEnumeracion) {
    return true;
  }

  // 3. Conectores secuenciales o de accion encadenada
  if (CONECTORES_SECUENCIALES.some((rx) => rx.test(limpio))) {
    return true;
  }

  // 4. Multiples clausulas con acciones o dominios distintos
  const clausulas = dividirEnClausulas(limpio);
  if (clausulas.length >= 2) {
    const dominios = new Set();
    let accionesConcretas = 0;
    for (const c of clausulas) {
      const cn = normalizar(c);
      const inf = inferirDominioYHerramienta(c);
      if (inf.dominio !== 'general') dominios.add(inf.dominio);
      if (RE_VERBO_ACCION.test(cn) || inf.dominio !== 'general') accionesConcretas++;
    }
    if (dominios.size >= 2 || accionesConcretas >= 2) {
      return true;
    }
  }

  return false;
}

/**
 * Descompone una peticion en sub-objetivos ordenados de forma determinista (coste 0).
 *
 * @param {string} mensaje
 * @param {object} [opciones]
 * @param {string[]} [opciones.intenciones=[]]
 * @param {Array} [opciones.herramientas=[]]
 * @param {Function|null} [opciones.chatCompletion=null] - Reservado para compatibilidad; coste 0 determinista.
 * @returns {Array<{ id: number, descripcion: string, dominio: string, herramientaSugerida: string|null, estado: 'pendiente' }>}
 */
export function generarPlanEstructurado(mensaje, { intenciones = [], herramientas = [], chatCompletion = null } = {}) {
  void chatCompletion; // Planificacion determinista de coste 0 LLM
  if (!mensaje || typeof mensaje !== 'string' || !mensaje.trim()) {
    return [];
  }

  const catalogo = normalizarCatalogoHerramientas(herramientas);
  const intsActivas = filtrarIntencionesActivas(intenciones);
  let clausulas = dividirEnClausulas(mensaje);

  if (clausulas.length === 0) {
    clausulas = [mensaje.trim()];
  }

  // Si solo salio 1 clausula pero hay >=2 intenciones explicitas, desglosar por intencion
  if (clausulas.length === 1 && intsActivas.length >= 2) {
    const baseDesc = clausulas[0];
    return intsActivas.map((dom, idx) => {
      const sugDefecto = INTENCION_HERRAMIENTA_DEFECTO[dom] || null;
      const disponible = catalogo.length > 0 && sugDefecto && !catalogo.some((h) => h.name === sugDefecto)
        ? null
        : sugDefecto;
      return {
        id: idx + 1,
        descripcion: `${baseDesc} (${dom})`,
        dominio: dom,
        herramientaSugerida: disponible,
        estado: 'pendiente'
      };
    });
  }

  return clausulas.map((clausula, idx) => {
    const { dominio, herramientaSugerida } = inferirDominioYHerramienta(clausula, {
      catalogo,
      intenciones: intsActivas
    });
    return {
      id: idx + 1,
      descripcion: clausula,
      dominio,
      herramientaSugerida,
      estado: 'pendiente'
    };
  });
}

function extraerNombreHerramienta(item) {
  if (!item || typeof item !== 'object') return '';
  return String(item.name || item.nombre || item.tool || item.function?.name || '').trim();
}

function determinarEstadoEjecucion(llamada, resultado) {
  const fuente = resultado || llamada || {};
  const status = String(fuente.status || fuente.resultado || '').toLowerCase().trim();
  if (fuente.ok === false || Boolean(fuente.error) || ESTADOS_FALLO.has(status)) {
    return 'fallido';
  }
  if (fuente.ok === true || ESTADOS_OK.has(status) || !status) {
    return 'completado';
  }
  return 'fallido';
}

function normalizarEventosRonda(llamadasRonda = [], resultadosRonda = []) {
  const llamadas = Array.isArray(llamadasRonda) ? llamadasRonda : [];
  const resultados = Array.isArray(resultadosRonda) ? resultadosRonda : [];
  const eventos = [];

  if (resultados.length > 0) {
    const llamadasPorId = new Map();
    for (const ll of llamadas) {
      if (ll && ll.id !== undefined && ll.id !== null) llamadasPorId.set(ll.id, ll);
    }

    resultados.forEach((res, idx) => {
      const ll = (res?.id !== undefined && res?.id !== null && llamadasPorId.get(res.id)) || llamadas[idx] || null;
      const nombre = extraerNombreHerramienta(res) || extraerNombreHerramienta(ll);
      if (!nombre) return;
      eventos.push({
        nombre,
        estado: determinarEstadoEjecucion(ll, res)
      });
    });
    return eventos;
  }

  for (const ll of llamadas) {
    const nombre = extraerNombreHerramienta(ll);
    if (!nombre) continue;
    eventos.push({
      nombre,
      estado: determinarEstadoEjecucion(ll, null)
    });
  }
  return eventos;
}

/**
 * Actualiza el estado de los pasos del plan segun las llamadas y resultados de una ronda ReAct.
 *
 * @param {Array} plan
 * @param {Array} [llamadasRonda=[]]
 * @param {Array} [resultadosRonda=[]]
 * @returns {Array}
 */
export function actualizarProgresoPlan(plan, llamadasRonda = [], resultadosRonda = []) {
  if (!Array.isArray(plan)) return [];
  const copia = plan.map((paso) => ({ ...paso }));
  const eventos = normalizarEventosRonda(llamadasRonda, resultadosRonda);
  if (eventos.length === 0) return copia;

  const consumidos = new Set();

  for (const ev of eventos) {
    // 1. Coincidencia exacta por herramientaSugerida (priorizando pasos pendientes, luego fallidos en reintento)
    let idxPaso = copia.findIndex(
      (p, i) => !consumidos.has(i) && p.estado === 'pendiente' && p.herramientaSugerida === ev.nombre
    );
    if (idxPaso === -1) {
      idxPaso = copia.findIndex(
        (p, i) => !consumidos.has(i) && p.estado === 'fallido' && p.herramientaSugerida === ev.nombre
      );
    }

    // 2. Coincidencia por dominio si la herramienta ejecutada pertenece al dominio del paso
    if (idxPaso === -1) {
      const domEvento = HERRAMIENTA_A_DOMINIO.get(ev.nombre);
      if (domEvento) {
        idxPaso = copia.findIndex(
          (p, i) => !consumidos.has(i) && p.estado === 'pendiente' && p.dominio === domEvento
        );
        if (idxPaso === -1) {
          idxPaso = copia.findIndex(
            (p, i) => !consumidos.has(i) && p.estado === 'fallido' && p.dominio === domEvento
          );
        }
      }
    }

    if (idxPaso !== -1) {
      copia[idxPaso].estado = ev.estado;
      copia[idxPaso].herramientaEjecutada = ev.nombre;
      consumidos.add(idxPaso);
    }
  }

  return copia;
}

/**
 * Devuelve los sub-objetivos del plan que aun estan pendientes de ejecucion.
 *
 * @param {Array} plan
 * @returns {Array}
 */
export function pendientesDelPlan(plan) {
  if (!Array.isArray(plan)) return [];
  return plan.filter((paso) => !paso?.estado || paso.estado === 'pendiente');
}

/**
 * Formatea una directiva concisa en espanol para guiar al agente en el bucle ReAct
 * cuando intenta responder dejando sub-objetivos pendientes.
 *
 * @param {Array} plan
 * @returns {string}
 */
export function formatearDirectivaPendientes(plan) {
  const pendientes = pendientesDelPlan(plan);
  if (pendientes.length === 0) return '';

  const lineas = pendientes.map((p) => {
    const sufijoTool = p.herramientaSugerida ? ` (herramienta sugerida: ${p.herramientaSugerida})` : '';
    return `- Paso ${p.id} [${p.dominio || 'general'}]: ${p.descripcion}${sufijoTool}`;
  });

  return [
    '[PLAN PENDIENTE] Aun quedan sub-objetivos sin ejecutar antes de cerrar la respuesta:',
    ...lineas,
    'Ejecuta las herramientas necesarias para completar los pasos pendientes.'
  ].join('\n');
}
