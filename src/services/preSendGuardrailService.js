/**
 * preSendGuardrailService.js - Pre-Send Guardrails and Self-Correction Service
 *
 * Intercepts, validates, and self-corrects outbound messages before WhatsApp dispatch.
 * 1. Zero Emoji Veto: Enforces strict zero emojis across all outbound text.
 * 2. Code Snippet Syntax Validation: Validates and auto-corrects JS and JSON markdown code blocks.
 * 3. Hallucination Detection: Verifies critical action execution claims against trace tool calls
 *    and validates phone numbers/JIDs against known context.
 * 4. Transparent Tool Retry: Transparently retries transient failures for idempotent tools.
 *
 * Strict Policy: Zero Emojis in code, comments, logs, and outputs.
 */

import vm from 'node:vm';

/**
 * Unicode regex detecting Extended Pictographic glyphs and emoji ranges.
 * Uses unicode escapes exclusively to maintain strict zero-emoji compliance in source files.
 */
export const PATRON_EMOJI_REGEX = /\p{Extended_Pictographic}/u;

/**
 * Comprehensive regex matching emoji sequences, modifiers, variation selectors, and ZWJ joins.
 */
export const EMOJI_DETECTION_FULL_REGEX = /(?:[\u{1F1E6}-\u{1F1FF}]{2}|[\u0023\u002A\u0030-\u0039]\uFE0F?\u20E3|(?:\p{Extended_Pictographic}|[\u{1F300}-\u{1F9FF}\u{2600}-\u{27BF}\u{1F1E6}-\u{1F1FF}\u{1F000}-\u{1F02F}\u{1FA70}-\u{1FAFF}\u{2300}-\u{23FF}\u{2B50}])(?:[\uFE0E\uFE0F]|\u{1F3FB}-\u{1F3FF}|(?:\u200D(?:\p{Extended_Pictographic}|[\u{1F300}-\u{1F9FF}\u{2600}-\u{27BF}\u{1F1E6}-\u{1F1FF}\u{1F000}-\u{1F02F}\u{1FA70}-\u{1FAFF}\u{2300}-\u{23FF}\u{2B50}])(?:[\uFE0E\uFE0F]|\u{1F3FB}-\u{1F3FF})*))*|[\uFE0E\uFE0F]|[\u{1F3FB}-\u{1F3FF}]|\u200D|\p{Extended_Pictographic})/gu;

/**
 * Set of inherently idempotent tools that can be safely retried on transient failures.
 */
export const HERRAMIENTAS_IDEMPOTENTES_SET = new Set([
  'consultar_clima',
  'obtener_noticias_actuales',
  'navegar_y_leer_noticia',
  'resumir_enlace',
  'consultar_salud_servidor',
  'consultar_estado_servidor',
  'comprobar_puerto_tcp',
  'buscar_memoria',
  'listar_memorias',
  'buscar_recuerdo_semantico',
  'listar_recordatorios',
  'listar_mensajes_programados',
  'listar_productos_vigilados',
  'listar_candidaturas',
  'resumen_candidaturas',
  'listar_planes_estudio',
  'resumen_plan_estudio',
  'listar_flashcards',
  'resumen_flashcards',
  'pendientes_de_repaso',
  'listar_gastos',
  'resumen_gastos_mes',
  'listar_suscripciones',
  'estado_presupuestos',
  'listar_procesos_vigilados',
  'buscar_en_historial',
  'listar_fechas_senaladas',
  'proximas_fechas',
  'estadisticas_chat',
  'listar_avisos_llegada',
  'proximas_llegadas_transporte',
  'buscar_contacto',
  'listar_contactos',
  'generar_digest_cerebro',
  'generar_wiki',
  'preguntar_documentos',
  'leer_diario',
  'listar_habitos',
  'ver_menu',
  'sugerir_menu',
  'listar_compra',
  'recomendar_serie_pelicula',
  'listar_quedadas',
  'resumen_deportivo',
  'revisar_pr',
  'informe_metricas',
  'actividad_repos',
  'auditar_dependencias',
  'listar_dispositivos_red',
  'estimar_factura_oracle',
  'buscar_producto',
  'verificar_oferta',
  'escanear_ofertas_empleo',
  'leer_config_radar',
  'get_infrastructure_status',
  'get_tunnel_status',
  'read_network_bytes',
  'check_certificate_expiry',
  'check_disk_usage',
  'inspect_containers',
  'explicar_recorrido'
]);

/**
 * Determines whether a given tool name is idempotent based on known tool registry
 * and standard naming prefixes for read-only actions.
 *
 * @param {string} nombreHerramienta
 * @returns {boolean}
 */
export function esHerramientaIdempotente(nombreHerramienta) {
  if (!nombreHerramienta || typeof nombreHerramienta !== 'string') return false;
  if (HERRAMIENTAS_IDEMPOTENTES_SET.has(nombreHerramienta)) return true;

  // Prefix checks for queries, listings, readings, inspections
  const prefijosLectura = [
    'consultar_',
    'buscar_',
    'listar_',
    'obtener_',
    'ver_',
    'leer_',
    'comprobar_',
    'inspeccionar_',
    'get_',
    'read_',
    'check_',
    'inspect_',
    'resumen_',
    'explicar_',
    'auditar_',
    'estado_'
  ];

  const prefijosMutacion = [
    'crear_',
    'eliminar_',
    'borrar_',
    'modificar_',
    'actualizar_',
    'ejecutar_',
    'enviar_',
    'programar_',
    'trigger_',
    'start_',
    'stop_',
    'execute_',
    'anadir_',
    'registrar_',
    'tachar_',
    'vaciar_',
    'responder_'
  ];

  for (const prefijo of prefijosMutacion) {
    if (nombreHerramienta.startsWith(prefijo)) {
      return false;
    }
  }

  for (const prefijo of prefijosLectura) {
    if (nombreHerramienta.startsWith(prefijo)) {
      return true;
    }
  }

  return false;
}

/**
 * Guard 1: Zero Emoji Veto.
 * Strictly detects, removes, and normalizes any emoji characters matching
 * Unicode Extended Pictographic glyphs, skin-tone modifiers, and variation selectors.
 *
 * @param {string} texto
 * @returns {{ textoModificado: string, huboCorreccion: boolean, emojisDetectados: number }}
 */
export function guardZeroEmojis(texto) {
  if (typeof texto !== 'string' || texto.length === 0) {
    return {
      textoModificado: typeof texto === 'string' ? texto : '',
      huboCorreccion: false,
      emojisDetectados: 0
    };
  }

  // Quick detection test
  const tieneEmojis = PATRON_EMOJI_REGEX.test(texto) ||
    /[\u{1F300}-\u{1F9FF}\u{2600}-\u{27BF}\u{1F1E6}-\u{1F1FF}\u{1F000}-\u{1F02F}\u{1FA70}-\u{1FAFF}\u{2300}-\u{23FF}\u{2B50}\u{FE0E}\u{FE0F}]/u.test(texto);

  if (!tieneEmojis) {
    return {
      textoModificado: texto,
      huboCorreccion: false,
      emojisDetectados: 0
    };
  }

  // Count matches
  const coincidencias = texto.match(EMOJI_DETECTION_FULL_REGEX);
  const emojisDetectados = coincidencias ? coincidencias.length : 0;

  // Split markdown code blocks so we do not distort code whitespace/indentation
  const segmentos = [];
  const regexCodeBlock = /(```[\s\S]*?```|`[^`\n]+`)/g;
  let ultimoIndice = 0;
  let match;

  while ((match = regexCodeBlock.exec(texto)) !== null) {
    if (match.index > ultimoIndice) {
      segmentos.push({ esCodigo: false, contenido: texto.slice(ultimoIndice, match.index) });
    }
    segmentos.push({ esCodigo: true, contenido: match[0] });
    ultimoIndice = regexCodeBlock.lastIndex;
  }
  if (ultimoIndice < texto.length) {
    segmentos.push({ esCodigo: false, contenido: texto.slice(ultimoIndice) });
  }

  // Strip emojis from each segment and normalize non-code segments
  const segmentosLimpios = segmentos.map((seg) => {
    let limpio = seg.contenido.replace(EMOJI_DETECTION_FULL_REGEX, '');
    if (!seg.esCodigo) {
      // Normalize orphan spaces before punctuation
      limpio = limpio
        .replace(/[^\S\r\n]+([,.;:!?])/g, '$1')
        .replace(/[^\S\r\n]{2,}/g, ' ');
    }
    return limpio;
  });

  const textoModificado = segmentosLimpios.join('').trim();

  return {
    textoModificado,
    huboCorreccion: emojisDetectados > 0,
    emojisDetectados
  };
}

/**
 * Attempts auto-correction of common JSON syntax errors.
 *
 * @param {string} codigo
 * @returns {{ corregido: boolean, codigoFinal: string, error?: string }}
 */
function intentarAutoCorregirJson(codigo) {
  const original = codigo.trim();

  // Test 1: Original validity
  try {
    JSON.parse(original);
    return { corregido: false, codigoFinal: original };
  } catch (errOriginal) {
    // Needs correction
  }

  let candidato = original;

  // Step 1: Replace Python literals
  candidato = candidato
    .replace(/\bTrue\b/g, 'true')
    .replace(/\bFalse\b/g, 'false')
    .replace(/\bNone\b/g, 'null');

  // Step 2: Strip single-line and multi-line comments
  candidato = candidato
    .replace(/\/\/.*$/gm, '')
    .replace(/\/\*[\s\S]*?\*\//g, '');

  // Step 3: Remove trailing commas before closing braces/brackets
  candidato = candidato.replace(/,\s*([}\]])/g, '$1');

  // Step 4: Quote unquoted object keys: { foo: "bar" } -> { "foo": "bar" }
  candidato = candidato.replace(/([{,]\s*)([a-zA-Z_$][a-zA-Z0-9_$]*)\s*:/g, '$1"$2":');

  // Step 5: Convert single quotes to double quotes for string values
  // Only where single quotes wrap values or keys
  candidato = candidato.replace(/'([^'\\]*(?:\\.[^'\\]*)*)'/g, (m, contenido) => {
    const escapado = contenido.replace(/"/g, '\\"');
    return `"${escapado}"`;
  });

  // Test after basic transformations
  try {
    JSON.parse(candidato);
    return { corregido: true, codigoFinal: candidato };
  } catch {
    // Continue with structural fixes
  }

  // Step 6: Balance unclosed braces and brackets
  const pila = [];
  let enString = false;
  let escape = false;

  for (let i = 0; i < candidato.length; i++) {
    const c = candidato[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (c === '\\') {
      escape = true;
      continue;
    }
    if (c === '"') {
      enString = !enString;
      continue;
    }
    if (!enString) {
      if (c === '{' || c === '[') {
        pila.push(c);
      } else if (c === '}') {
        if (pila.length > 0 && pila[pila.length - 1] === '{') {
          pila.pop();
        }
      } else if (c === ']') {
        if (pila.length > 0 && pila[pila.length - 1] === '[') {
          pila.pop();
        }
      }
    }
  }

  // If string was left open, close it
  if (enString) {
    candidato += '"';
  }

  // Remove any trailing comma before appending closing brackets
  candidato = candidato.replace(/,\s*$/, '');

  // Append matching closing braces/brackets in reverse order
  while (pila.length > 0) {
    const abierto = pila.pop();
    candidato += abierto === '{' ? '\n}' : '\n]';
  }

  try {
    JSON.parse(candidato);
    return { corregido: true, codigoFinal: candidato };
  } catch (errFinal) {
    return { corregido: false, codigoFinal: original, error: errFinal.message };
  }
}

/**
 * Validates JavaScript syntax using node:vm Script.
 * Supports both CommonJS and ES Module top-level syntax without throwing
 * 'Cannot use import statement outside a module'.
 *
 * @param {string} codigo
 * @returns {{ valido: boolean, error?: string }}
 */
function validarSintaxisJsConVm(codigo) {
  // If snippet contains ES module keywords, adapt to allow syntax evaluation
  let codigoParaVm = codigo;

  // Mask top-level import/export for syntax checking
  if (/^\s*(import\s|export\s)/m.test(codigo)) {
    codigoParaVm = codigo
      .replace(/^\s*import\s+[^;]+;?/gm, (m) => `/* ${m} */`)
      .replace(/^\s*export\s+default\s+/gm, 'const __default_export__ = ')
      .replace(/^\s*export\s+(const|let|var|function|class)\s+/gm, '$1 ')
      .replace(/^\s*export\s*\{[^}]*\};?/gm, (m) => `/* ${m} */`);
  }

  try {
    new vm.Script(codigoParaVm);
    return { valido: true };
  } catch (err) {
    if (/Illegal return statement|await is only valid in async function/i.test(err.message)) {
      try {
        new vm.Script('(async function() {\n' + codigoParaVm + '\n})');
        return { valido: true };
      } catch (errWrap) {
        return { valido: false, error: errWrap.message };
      }
    }
    return { valido: false, error: err.message };
  }
}

/**
 * Attempts auto-correction of common JavaScript syntax errors.
 *
 * @param {string} codigo
 * @returns {{ corregido: boolean, codigoFinal: string, error?: string }}
 */
function intentarAutoCorregirJs(codigo) {
  const original = codigo.trim();

  // Test 1: Original validity
  const checkInicial = validarSintaxisJsConVm(original);
  if (checkInicial.valido) {
    return { corregido: false, codigoFinal: original };
  }

  let candidato = original;

  // Step 1: Decode common HTML entities from LLM output
  candidato = candidato
    .replace(/&amp;&amp;/g, '&&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");

  if (validarSintaxisJsConVm(candidato).valido) {
    return { corregido: true, codigoFinal: candidato };
  }

  // Step 2: Balance unclosed braces, parentheses, and brackets
  const pila = [];
  let enStringSimple = false;
  let enStringDoble = false;
  let enTemplate = false;
  let enComentarioLinea = false;
  let enComentarioBloque = false;
  let escape = false;

  for (let i = 0; i < candidato.length; i++) {
    const c = candidato[i];
    const sig = candidato[i + 1];

    if (escape) {
      escape = false;
      continue;
    }
    if (c === '\\') {
      escape = true;
      continue;
    }

    if (enComentarioLinea) {
      if (c === '\n') enComentarioLinea = false;
      continue;
    }

    if (enComentarioBloque) {
      if (c === '*' && sig === '/') {
        enComentarioBloque = false;
        i++;
      }
      continue;
    }

    if (!enStringSimple && !enStringDoble && !enTemplate) {
      if (c === '/' && sig === '/') {
        enComentarioLinea = true;
        i++;
        continue;
      }
      if (c === '/' && sig === '*') {
        enComentarioBloque = true;
        i++;
        continue;
      }
    }

    if (c === "'" && !enStringDoble && !enTemplate) {
      enStringSimple = !enStringSimple;
      continue;
    }
    if (c === '"' && !enStringSimple && !enTemplate) {
      enStringDoble = !enStringDoble;
      continue;
    }
    if (c === '`' && !enStringSimple && !enStringDoble) {
      enTemplate = !enTemplate;
      continue;
    }

    if (!enStringSimple && !enStringDoble && !enTemplate) {
      if (c === '{' || c === '(' || c === '[') {
        pila.push(c);
      } else if (c === '}') {
        if (pila.length > 0 && pila[pila.length - 1] === '{') pila.pop();
      } else if (c === ')') {
        if (pila.length > 0 && pila[pila.length - 1] === '(') pila.pop();
      } else if (c === ']') {
        if (pila.length > 0 && pila[pila.length - 1] === '[') pila.pop();
      }
    }
  }

  // Close unclosed string literals
  if (enStringSimple) candidato += "'";
  if (enStringDoble) candidato += '"';
  if (enTemplate) candidato += '`';

  // Append matching closing delimiters
  while (pila.length > 0) {
    const abierto = pila.pop();
    if (abierto === '{') candidato += '\n}';
    else if (abierto === '(') candidato += ')';
    else if (abierto === '[') candidato += ']';
  }

  const checkFinal = validarSintaxisJsConVm(candidato);
  if (checkFinal.valido) {
    return { corregido: true, codigoFinal: candidato };
  }

  return { corregido: false, codigoFinal: original, error: checkFinal.error || checkInicial.error };
}

/**
 * Guard 2: Code Snippet Syntax Validation.
 * Scans markdown blocks for javascript and json snippets.
 * Validates JS syntax using node:vm Script and JSON using JSON.parse.
 * Transparently auto-corrects syntax errors, or safely wraps with a warning.
 *
 * @param {string} texto
 * @returns {{
 *   textoModificado: string,
 *   huboCorreccion: boolean,
 *   bloquesValidados: number,
 *   bloquesCorregidos: number,
 *   erroresNoCorregibles: Array<{ lenguaje: string, error: string }>
 * }}
 */
export function guardCodeSyntax(texto) {
  if (typeof texto !== 'string' || texto.length === 0) {
    return {
      textoModificado: typeof texto === 'string' ? texto : '',
      huboCorreccion: false,
      bloquesValidados: 0,
      bloquesCorregidos: 0,
      erroresNoCorregibles: []
    };
  }

  let textoModificado = texto;
  let huboCorreccion = false;
  let bloquesValidados = 0;
  let bloquesCorregidos = 0;
  const erroresNoCorregibles = [];

  // Check for unclosed code block fence at the end of the text
  const fences = textoModificado.match(/```/g);
  if (fences && fences.length % 2 !== 0) {
    textoModificado += '\n```';
    huboCorreccion = true;
  }

  const regexCodeBlock = /```([a-zA-Z0-9_+#.-]*)\r?\n([\s\S]*?)```/g;

  textoModificado = textoModificado.replace(regexCodeBlock, (bloqueCompleto, langRaw, codigoRaw) => {
    const lang = (langRaw || '').toLowerCase().trim();

    if (lang === 'json' || lang === 'jsonc') {
      bloquesValidados++;
      const resultadoJson = intentarAutoCorregirJson(codigoRaw);
      if (resultadoJson.corregido) {
        bloquesCorregidos++;
        huboCorreccion = true;
        return `\`\`\`${langRaw}\n${resultadoJson.codigoFinal}\n\`\`\``;
      }
      if (resultadoJson.error) {
        erroresNoCorregibles.push({ lenguaje: lang, error: resultadoJson.error });
        // Safely annotate invalid snippet with warning comment so user is informed without crash
        const snippetConAviso = `// AVISO_SINTAXIS: JSON con error no corregible: ${resultadoJson.error}\n${codigoRaw.trim()}`;
        huboCorreccion = true;
        return `\`\`\`${langRaw}\n${snippetConAviso}\n\`\`\``;
      }
      return bloqueCompleto;
    }

    if (lang === 'javascript' || lang === 'js' || lang === 'mjs' || lang === 'cjs' || lang === 'node') {
      bloquesValidados++;
      const resultadoJs = intentarAutoCorregirJs(codigoRaw);
      if (resultadoJs.corregido) {
        bloquesCorregidos++;
        huboCorreccion = true;
        return `\`\`\`${langRaw}\n${resultadoJs.codigoFinal}\n\`\`\``;
      }
      if (resultadoJs.error) {
        erroresNoCorregibles.push({ lenguaje: lang, error: resultadoJs.error });
        // Safely annotate invalid snippet with warning comment
        const snippetConAviso = `// AVISO_SINTAXIS: Fragmento JS con error de sintaxis: ${resultadoJs.error}\n${codigoRaw.trim()}`;
        huboCorreccion = true;
        return `\`\`\`${langRaw}\n${snippetConAviso}\n\`\`\``;
      }
      return bloqueCompleto;
    }

    return bloqueCompleto;
  });

  return {
    textoModificado,
    huboCorreccion,
    bloquesValidados,
    bloquesCorregidos,
    erroresNoCorregibles
  };
}

/**
 * Normalizes tool execution records from context trace.
 *
 * @param {object} contexto
 * @returns {Array<{ nombre: string, ok: boolean }>}
 */
function extraerLlamadasExitosas(contexto) {
  const traza = contexto?.traza;
  const llamadas = Array.isArray(traza?.llamadas) ? traza.llamadas : [];

  return llamadas.map((item) => {
    const nombre = item.nombre || item.name || item.herramienta || item.funcion || '';
    const resultado = item.resultado !== undefined ? item.resultado : item.result;
    const ok = item.ok === true || item.exito === true || resultado === 'ok' || resultado === 'success';
    return { nombre, ok };
  });
}

/**
 * Checks if a specific tool or action family succeeded in the trace.
 *
 * @param {Array<{ nombre: string, ok: boolean }>} llamadas
 * @param {string[]} herramientasEsperadas
 * @returns {boolean}
 */
function accionFueEjecutadaConExito(llamadas, herramientasEsperadas) {
  return llamadas.some((llamada) =>
    herramientasEsperadas.includes(llamada.nombre) && llamada.ok
  );
}

/**
 * Collects known authorized phone numbers and JIDs from context.
 *
 * @param {object} contexto
 * @returns {Set<string>}
 */
function recopilarDestinatariosAutorizados(contexto = {}) {
  const autorizados = new Set();

  function registrar(valor) {
    if (!valor || typeof valor !== 'string') return;
    const limpio = valor.replace(/\D/g, '');
    if (limpio.length >= 6) {
      autorizados.add(limpio);
    }
    autorizados.add(valor.toLowerCase().trim());
  }

  // Direct recipient
  if (contexto.destinatario) registrar(contexto.destinatario);
  if (contexto.chatId) registrar(contexto.chatId);

  // Known contacts in context
  if (Array.isArray(contexto.contactosConocidos)) {
    for (const c of contexto.contactosConocidos) {
      if (typeof c === 'string') registrar(c);
      else if (c && typeof c === 'object') {
        registrar(c.numero);
        registrar(c.telefono);
        registrar(c.jid);
      }
    }
  }

  // Prompt message / trace message
  if (contexto.traza?.mensaje) {
    const numsPrompt = contexto.traza.mensaje.match(/\+?\d{8,15}/g);
    if (numsPrompt) {
      numsPrompt.forEach(registrar);
    }
  }

  // Tool calls arguments / results
  if (Array.isArray(contexto.traza?.llamadas)) {
    for (const call of contexto.traza.llamadas) {
      const args = call.args || call.arguments || call.parametros;
      if (args && typeof args === 'object') {
        if (args.numero) registrar(args.numero);
        if (args.telefono) registrar(args.telefono);
        if (args.jid) registrar(args.jid);
        if (args.destinatario) registrar(args.destinatario);
      }
    }
  }

  // Numeros que aparecen en RESULTADOS de herramientas (traza ReAct): un
  // telefono, pedido o referencia que devolvio una herramienta es dato
  // verificado, no una alucinacion del modelo, y no debe censurarse.
  if (Array.isArray(contexto.traza?.reactSteps)) {
    for (const paso of contexto.traza.reactSteps) {
      if (!Array.isArray(paso?.toolResults)) continue;
      for (const res of paso.toolResults) {
        const texto = typeof res?.result === 'string' ? res.result : '';
        if (!texto) continue;
        const encontrados = texto.match(/\+?\d{8,15}/g);
        if (encontrados) {
          encontrados.forEach(registrar);
        }
      }
    }
  }

  return autorizados;
}

/**
 * Guard 3: Hallucination Detection.
 * Verifies that positive assertions of critical action execution are grounded
 * in successful tool calls in contexto.traza.llamadas.
 * Also validates phone numbers/JIDs against known contacts or recipient patterns.
 *
 * @param {string} texto
 * @param {object} [contexto={}]
 * @returns {{
 *   textoModificado: string,
 *   huboCorreccion: boolean,
 *   correcciones: string[],
 *   bloqueadoCritico: boolean,
 *   motivoBloqueo?: string
 * }}
 */
export function guardHallucinations(texto, contexto = {}) {
  if (typeof texto !== 'string' || texto.length === 0) {
    return {
      textoModificado: typeof texto === 'string' ? texto : '',
      huboCorreccion: false,
      correcciones: [],
      bloqueadoCritico: false
    };
  }

  let textoModificado = texto;
  let huboCorreccion = false;
  const correcciones = [];

  const llamadas = extraerLlamadasExitosas(contexto);

  // 1. Critical action claim validations
  const reglasAccionesCriticas = [
    {
      nombre: 'commit_git',
      patron: /(?:he\s+(?:creado|hecho|realizado)\s+el\s+commit|commit\s+(?:creado|realizado|efectuado)\s+con\s+[eé]xito)/i,
      herramientas: ['crear_commit', 'ejecutar_tarea_programacion', 'git_commit'],
      enmienda: 'no se ha realizado ningun commit en el repositorio ya que ninguna herramienta de commit fue ejecutada con exito'
    },
    {
      nombre: 'pull_request_git',
      patron: /(?:he\s+(?:creado|abierto)\s+el\s+(?:pull request|pr)|(?:pull request|pr)\s+(?:creado|abierto)\s+con\s+[eé]xito)/i,
      herramientas: ['abrir_pull_request', 'crear_pull_request'],
      enmienda: 'no se ha abierto ningun pull request ya que no consta ejecucion exitosa de la herramienta correspondiente'
    },
    {
      nombre: 'reinicio_docker',
      patron: /(?:he\s+reiniciado\s+el\s+contenedor|contenedor\s+reiniciado\s+con\s+[eé]xito)/i,
      herramientas: ['reiniciar_contenedor', 'gestionar_contenedor', 'docker_restart', 'checkAndHealContainers'],
      enmienda: 'no se ha reiniciado el contenedor dado que no consta intervencion exitosa en los servicios del sistema'
    },
    {
      nombre: 'borrado_elementos',
      patron: /(?:(?<!no\s+)he\s+(?:borrado|eliminado)\s+(?:el\s+archivo|la\s+memoria|la\s+base\s+de\s+datos|los\s+datos|el\s+directorio|la\s+tabla|el\s+registro)|(?:archivo|base\s+de\s+datos|memoria|registro)\s+(?:eliminado|borrado|eliminada|borrada)\s+con\s+[eé]xito)/i,
      herramientas: ['olvidar_memoria', 'eliminar_archivo', 'borrar_conversacion', 'limpiar_historial'],
      enmienda: 'no se ha eliminado ningun elemento dado que no consta ejecucion confirmada de borrado'
    },
    {
      nombre: 'transferencia_fondos',
      patron: /(?:he\s+transferido|transferencia\s+(?:realizada|enviada)|he\s+pagado|pago\s+efectuado)/i,
      herramientas: [], // DAVI.S. does not support autonomous financial transfers
      enmienda: 'no se ha realizado ninguna transferencia de fondos dado que el sistema carece de herramientas de emision financiera'
    },
    {
      // Confirmacion de guardado en el Second Brain sin guardar_memoria
      // exitoso: con modelo real se observo "Guardado..." sin que se
      // ofreciera ni ejecutara ninguna herramienta. Consume la frase entera
      // para no dejar restos rotos y respeta las negaciones
      // ("no he guardado nada"). Otras herramientas de guardado legitimas
      // (contacto, nota, idea) tambien sirven de respaldo.
      nombre: 'guardado_memoria',
      patron: /(^|(?<=[.!?])\s+)(?:(?:guardado|anotado|apuntado|memorizado)\b(?:\s+en\s+(?:tu\s+)?(?:memoria|el\s+second\s+brain|tu\s+segundo\s+cerebro))?[^\n.!?:;]*|[^\n.!?]*?(?:(?<!no\s)(?<!no lo\s)(?<!no la\s)\bhe\s+(?:guardado|anotado|apuntado|memorizado)\b[^\n.!?]*?\ben\s+(?:tu\s+|la\s+)?(?:memoria|second\s+brain|segundo\s+cerebro)\b|(?<!no\s)\bqueda(?:do)?\s+guardado\s+en\s+(?:tu\s+)?(?:memoria|second\s+brain|segundo\s+cerebro)\b|(?<!no\s)\blo\s+recordar[eé]\b|\bme\s+lo\s+apunto\b)[^\n.!?]*)(?:[.!?]|$)/gi,
      herramientas: ['guardar_memoria', 'guardar_nota_personal'],
      enmienda: (m, sep) => /recordar[eé]|apunto/i.test(m)
        ? sep // promesa futura falsa ("lo recordare"): se elimina la frase
        : `${sep}No he podido guardarlo en el Second Brain: la herramienta de guardado no se ejecuto con exito.`
    },
    {
      nombre: 'backup_cifrado',
      patron: /(?:he\s+creado\s+el\s+backup\s+cifrado|backup\s+cifrado\s+completado\s+con\s+[eé]xito|copia\s+de\s+seguridad\s+cifrada\s+creada)/i,
      herramientas: ['trigger_encrypted_backup', 'crear_backup_sesion', 'createEncryptedBackup'],
      enmienda: 'no se ha generado ninguna copia de seguridad cifrada ya que no consta llamada exitosa a la herramienta de backup'
    }
  ];

  for (const regla of reglasAccionesCriticas) {
    if (regla.patron.test(textoModificado)) {
      const grounded = regla.herramientas.length > 0 && accionFueEjecutadaConExito(llamadas, regla.herramientas);
      if (!grounded) {
        textoModificado = textoModificado.replace(regla.patron, regla.enmienda);
        huboCorreccion = true;
        correcciones.push(`UNGOUNDED_ACTION_CLAIM_${regla.nombre.toUpperCase()}`);
      }
    }
  }

  // 2. Validate phone numbers / JIDs
  const autorizados = recopilarDestinatariosAutorizados(contexto);
  // Match candidate phone numbers (9 to 15 digits, optional + prefix, optional @s.whatsapp.net)
  const regexTelefonos = /(?:\+?[1-9]\d{8,14}(?:@s\.whatsapp\.net)?|\b[1-9]\d{12,20}@lid\b)/g;

  textoModificado = textoModificado.replace(regexTelefonos, (coincidencia) => {
    const rawDigitos = coincidencia.replace(/\D/g, '');

    // Allow timestamps (e.g. 20261107...) or standard numbers if matched
    if (coincidencia.startsWith('2026') || coincidencia.startsWith('2025') || coincidencia.startsWith('2024')) {
      return coincidencia;
    }

    if (autorizados.has(coincidencia.toLowerCase()) || autorizados.has(rawDigitos)) {
      return coincidencia;
    }

    // If context did not specify any contacts, permit standard text unless strictly hallucinated
    if (autorizados.size === 0) {
      return coincidencia;
    }

    huboCorreccion = true;
    correcciones.push('HALLUCINATED_PHONE_NUMBER');
    return '[NUMERO_NO_VERIFICADO]';
  });

  return {
    textoModificado,
    huboCorreccion,
    correcciones,
    bloqueadoCritico: false
  };
}

/**
 * Validates and self-corrects outbound text messages before transmission.
 *
 * @param {string} texto - Outbound message text.
 * @param {object} [contexto={}] - Context metadata: { traza, destinatario, canal, contactosConocidos }.
 * @returns {{
 *   valido: boolean,
 *   textoFinal: string,
 *   correccionesAplicadas: string[],
 *   bloqueado: boolean,
 *   motivoBloqueo?: string
 * }}
 */
export function validarMensajeSalida(texto, contexto = {}) {
  let textoFinal = typeof texto === 'string' ? texto : '';
  const correccionesAplicadas = [];
  let bloqueado = false;
  let motivoBloqueo;

  // 1. Guard 1: Zero Emoji Veto
  const resEmoji = guardZeroEmojis(textoFinal);
  if (resEmoji.huboCorreccion) {
    textoFinal = resEmoji.textoModificado;
    correccionesAplicadas.push('REMOVED_EMOJI');
  }

  // Verify zero emojis invariant
  if (PATRON_EMOJI_REGEX.test(textoFinal)) {
    bloqueado = true;
    motivoBloqueo = 'Violacion estricta de Cero Emojis no corregible en mensaje de salida';
    return {
      valido: false,
      textoFinal,
      correccionesAplicadas,
      bloqueado: true,
      motivoBloqueo
    };
  }

  // 2. Guard 2: Code Snippet Syntax Validation
  const resSyntax = guardCodeSyntax(textoFinal);
  if (resSyntax.huboCorreccion) {
    textoFinal = resSyntax.textoModificado;
    correccionesAplicadas.push('CORRECTED_CODE_SYNTAX');
  }

  // 3. Guard 3: Hallucination Detection
  const resHallucination = guardHallucinations(textoFinal, contexto);
  if (resHallucination.huboCorreccion) {
    textoFinal = resHallucination.textoModificado;
    correccionesAplicadas.push('CORRECTED_HALLUCINATION');
  }

  if (resHallucination.bloqueadoCritico) {
    bloqueado = true;
    motivoBloqueo = resHallucination.motivoBloqueo || 'Bloqueado por deteccion de alucinacion critica';
  }

  return {
    valido: !bloqueado,
    textoFinal,
    correccionesAplicadas,
    bloqueado,
    ...(motivoBloqueo ? { motivoBloqueo } : {})
  };
}

/**
 * Executes a tool with transparent retry handling for transient errors on idempotent operations.
 * Non-idempotent tools are never retried blindly to avoid side effects.
 *
 * @param {Function} fnEjecutar - Function executing the tool: (args) => Promise<any>
 * @param {string} nombreHerramienta - Name of the tool.
 * @param {object} [args={}] - Arguments passed to fnEjecutar.
 * @param {object} [opciones={}] - Configuration options:
 *   - maxReintentos: number (default 2)
 *   - demorasMs: number[] (default [200, 400])
 *   - esIdempotente: boolean (optional override)
 *   - logger: Function (default console.log)
 *   - esperarFn: Function (default (ms) => new Promise(r => setTimeout(r, ms)))
 * @returns {Promise<any>}
 */
export async function ejecutarHerramientaConReintentos(fnEjecutar, nombreHerramienta, args = {}, opciones = {}) {
  const maxReintentos = typeof opciones.maxReintentos === 'number' ? opciones.maxReintentos : 2;
  const demorasMs = Array.isArray(opciones.demorasMs) ? opciones.demorasMs : [200, 400];
  const logger = typeof opciones.logger === 'function' ? opciones.logger : console.log;
  const esperar = typeof opciones.esperarFn === 'function'
    ? opciones.esperarFn
    : (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  const esIdempotente = typeof opciones.esIdempotente === 'boolean'
    ? opciones.esIdempotente
    : esHerramientaIdempotente(nombreHerramienta);

  let intentosRealizados = 0;

  while (true) {
    try {
      return await fnEjecutar(args);
    } catch (error) {
      intentosRealizados++;
      const errorMsg = (error && typeof error === 'object' && error.message) ? error.message : String(error ?? 'Error desconocido');

      // If tool is not idempotent or retries exhausted, fail immediately
      if (!esIdempotente || intentosRealizados > maxReintentos) {
        if (!esIdempotente) {
          logger(`[ToolNoRetry] ${nombreHerramienta} es una operacion no-idempotente. No se reintenta tras fallo: ${errorMsg}`);
        } else {
          logger(`[ToolRetryExhausted] ${nombreHerramienta} agoto los ${maxReintentos} reintentos disponibles. Ultimo error: ${errorMsg}`);
        }
        if (error instanceof Error) {
          throw error;
        }
        return { texto: `Error en ${nombreHerramienta}: ${errorMsg}`, error: errorMsg, ok: false };
      }

      const demora = demorasMs[intentosRealizados - 1] ?? (200 * intentosRealizados);
      logger(`[ToolRetry] Reintentando ${nombreHerramienta} (intento ${intentosRealizados}/${maxReintentos}) tras error transitorio: ${errorMsg}. Espera: ${demora}ms.`);

      if (demora > 0) {
        await esperar(demora);
      }
    }
  }
}
