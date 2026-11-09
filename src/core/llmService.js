import { Ollama } from 'ollama';
import OpenAI from 'openai';
import { config } from '../config/config.js';
import { limitarHerramientasParaProveedor } from './tools.js';
import { presupuestoGroqPara, reiniciarPresupuestosGroq } from './groqBudget.js';

// Ventana de contexto y limite de generacion configurables por entorno.
// Subirlos en un VPS ARM es una HIPOTESIS a medir (latencia y memoria suben
// con el contexto); no hay ganancia garantizada. Valores por defecto: 8192/1024.
export const NUM_CTX_DEFECTO = Number.parseInt(process.env.DAVIS_LLM_NUM_CTX || '8192', 10) || 8192;
export const NUM_PREDICT_DEFECTO = Number.parseInt(process.env.DAVIS_LLM_NUM_PREDICT || '1024', 10) || 1024;

let defaultOllamaInstance = null;
let defaultOpenAIInstance = null;
let defaultOpenAIConfig = null;

/**
 * Resets cached client singletons. Useful for testing or hot-reloading configurations.
 */
let defaultOllamaHost = null;

export function resetClients() {
  defaultOllamaHost = null;
  defaultOllamaInstance = null;
  defaultOpenAIInstance = null;
  defaultOpenAIConfig = null;
}

/**
 * Returns or initializes the local Ollama client singleton.
 */
export function getOllamaClient(overrides = {}) {
  const host = overrides.host || config.llm?.ollamaHost || config.ollamaHost || 'http://127.0.0.1:11434';
  if (overrides.host) {
    return new Ollama({ host });
  }
  if (!defaultOllamaInstance) {
    defaultOllamaInstance = new Ollama({ host });
    defaultOllamaHost = host;
  }
  return defaultOllamaInstance;
}

/**
 * Resolves cloud provider configurations, defaulting known endpoints and models.
 * Automatically resolves Groq, OpenRouter, DeepSeek, and OpenAI endpoints.
 */
export function resolveCloudConfig(options = {}) {
  let apiKey = options.apiKey || config.llm?.apiKey || process.env.OPENAI_API_KEY || '';
  let provider = (options.provider || config.llm?.provider || '').toLowerCase();

  // Multi-provider key fallback if standard OPENAI_API_KEY is not defined
  if (!apiKey) {
    if (process.env.GROQ_API_KEY) {
      apiKey = process.env.GROQ_API_KEY;
      if (!provider || provider === 'ollama') provider = 'groq';
    } else if (process.env.OPENROUTER_API_KEY) {
      apiKey = process.env.OPENROUTER_API_KEY;
      if (!provider || provider === 'ollama') provider = 'openrouter';
    } else if (process.env.DEEPSEEK_API_KEY) {
      apiKey = process.env.DEEPSEEK_API_KEY;
      if (!provider || provider === 'ollama') provider = 'deepseek';
    }
  }

  // Auto-detect provider from key prefix if provider is generic or ollama
  if (!provider || provider === 'ollama') {
    if (apiKey.startsWith('gsk_')) {
      provider = 'groq';
    } else if (apiKey.startsWith('sk-or-')) {
      provider = 'openrouter';
    } else {
      provider = 'openai';
    }
  }

  let baseUrl = options.baseUrl || config.llm?.baseUrl || process.env.OPENAI_BASE_URL || '';
  let model = options.model || config.llm?.model || process.env.OPENAI_MODEL || '';

  if (!baseUrl) {
    if (provider === 'groq' || apiKey.startsWith('gsk_')) {
      baseUrl = 'https://api.groq.com/openai/v1';
    } else if (provider === 'openrouter' || apiKey.startsWith('sk-or-')) {
      baseUrl = 'https://openrouter.ai/api/v1';
    } else if (provider === 'deepseek') {
      baseUrl = 'https://api.deepseek.com';
    } else {
      baseUrl = 'https://api.openai.com/v1';
    }
  }

  if (!model) {
    if (provider === 'groq' || baseUrl.includes('groq.com')) {
      model = 'openai/gpt-oss-120b';
    } else if (provider === 'deepseek' || baseUrl.includes('deepseek.com')) {
      model = 'deepseek-chat';
    } else if (provider === 'openrouter' || baseUrl.includes('openrouter.ai')) {
      model = 'openai/gpt-4o-mini';
    } else {
      model = 'gpt-4o-mini';
    }
  }

  return { provider, apiKey, baseUrl, model };
}

/**
 * Returns or initializes the OpenAI-compatible client singleton.
 * Isolated clients are created when custom overrides are provided,
 * preventing test or request-specific pollution of default singletons.
 */
export function getOpenAIClient(overrides = {}) {
  const cloudConfig = resolveCloudConfig(overrides);
  if (!cloudConfig.apiKey) {
    throw new Error('OPENAI_API_KEY (or provider-specific API key) is required when using cloud / OpenAI-compatible LLM provider.');
  }

  const hasOverrides = Boolean(overrides.apiKey || overrides.baseUrl || overrides.provider);
  if (hasOverrides) {
    const customClient = new OpenAI({
      apiKey: cloudConfig.apiKey,
      // El router controla los intentos y su trazabilidad; no duplicar retries ocultos del SDK.
      maxRetries: 0,
      baseURL: cloudConfig.baseUrl
    });
    return { client: customClient, cloudConfig };
  }

  if (!defaultOpenAIInstance) {
    defaultOpenAIInstance = new OpenAI({
      apiKey: cloudConfig.apiKey,
      // El router controla los intentos y su trazabilidad; no duplicar retries ocultos del SDK.
      maxRetries: 0,
      baseURL: cloudConfig.baseUrl
    });
    defaultOpenAIConfig = cloudConfig;
  }
  return { client: defaultOpenAIInstance, cloudConfig: defaultOpenAIConfig || cloudConfig };
}

/**
 * Returns active provider information for telemetry, diagnostics and logging.
 */
export function getLlmProviderInfo() {
  const provider = (config.llm?.provider || (process.env.OPENAI_API_KEY ? 'openai' : 'ollama')).toLowerCase();
  if (provider === 'ollama') {
    return {
      provider: 'ollama',
      host: config.llm?.ollamaHost || config.ollamaHost,
      model: config.llm?.ollamaModel || config.ollamaModel,
      isLocal: true
    };
  }

  const cloud = resolveCloudConfig();
  return {
    provider: cloud.provider,
    baseUrl: cloud.baseUrl,
    model: cloud.model,
    hasApiKey: Boolean(cloud.apiKey),
    isLocal: false
  };
}

/**
 * Normalizes message formats for each provider (Ollama vs OpenAI / Cloud).
 */
export function prepareMessagesForProvider(messages = [], isOllama = false) {
  return messages.map(msg => {
    const formatted = { ...msg };

    // Contenido multimodal estilo OpenAI (array de partes con image_url):
    // Ollama espera el texto plano y las imagenes base64 en el campo
    // "images" del mensaje (sin prefijo data:). En la ruta cloud el array
    // viaja tal cual, que es lo que esperan los proveedores OpenAI-compat.
    if (isOllama && Array.isArray(msg.content)) {
      const textos = [];
      const imagenes = [];
      for (const parte of msg.content) {
        if (parte?.type === 'text' && typeof parte.text === 'string') {
          textos.push(parte.text);
        } else if (parte?.type === 'image_url') {
          const url = typeof parte.image_url === 'string' ? parte.image_url : parte.image_url?.url;
          const m = String(url || '').match(/^data:[^;]+;base64,(.+)$/);
          if (m) imagenes.push(m[1]);
        }
      }
      formatted.content = textos.join('\n');
      if (imagenes.length > 0) formatted.images = imagenes;
    }

    if (msg.role === 'assistant' && msg.tool_calls) {
      formatted.tool_calls = msg.tool_calls.map((tc, idx) => {
        let args = tc.function?.arguments;
        if (isOllama) {
          if (typeof args === 'string') {
            try { args = JSON.parse(args); } catch {}
          }
        } else {
          if (typeof args === 'object' && args !== null) {
            args = JSON.stringify(args);
          }
        }

        return {
          id: tc.id || `call_${idx}_${Date.now()}`,
          type: 'function',
          function: {
            name: tc.function.name,
            arguments: args
          }
        };
      });

      if (isOllama) {
        formatted.content = formatted.content || '';
      } else {
        formatted.content = (formatted.content && String(formatted.content).trim().length > 0)
          ? formatted.content
          : null;
      }
    }

    if (msg.role === 'tool') {
      formatted.content = String(msg.content ?? '');
      formatted.tool_call_id = msg.tool_call_id || msg.toolCallId || 'call_default';
      delete formatted.toolCallId;
    }

    return formatted;
  });
}

/**
 * Robust Fallback Tool Parser:
 * If a small or local model emits a function call as plain text (e.g. `consultar_clima {"ubicacion": "Madrid"}`)
 * instead of populating `message.tool_calls`, this extracts and transforms it into a formal tool call.
 */
export function extractToolCallsFromText(content, toolsList = []) {
  if (!content || typeof content !== 'string') return null;

  const toolNames = toolsList.map(t => typeof t === 'string' ? t : (t.function?.name || t.name)).filter(Boolean);
  if (toolNames.length === 0) return null;

  // Pattern 1: tool_name { ...json... } or tool_name({ ...json... })
  for (const name of toolNames) {
    const pattern = new RegExp(`(?:^|[\\s\\n\`])${name}\\s*\\(?\\s*(\\{[\\s\\S]*?\\})\\s*\\)?`, 'i');
    const m = content.match(pattern);
    if (m) {
      try {
        const args = JSON.parse(m[1]);
        return [{
          id: `call_${Math.random().toString(36).slice(2, 10)}`,
          type: 'function',
          function: { name, arguments: args }
        }];
      } catch (e) {
        // Continue
      }
    }
  }

  // Pattern 2: JSON block with name and arguments / parameters
  try {
    const jsonMatch = content.match(/\{[\s\S]*"name"\s*:\s*"([a-zA-Z0-9_]+)"[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      if (toolNames.includes(parsed.name)) {
        return [{
          id: `call_${Math.random().toString(36).slice(2, 10)}`,
          type: 'function',
          function: {
            name: parsed.name,
            arguments: parsed.arguments || parsed.parameters || {}
          }
        }];
      }
    }
  } catch {}

  return null;
}

/** Solo conteos declarados por el proveedor, nunca estimaciones ni ceros por defecto. */
export function normalizarUsoProveedor(res, proveedor) {
  const entrada = proveedor === 'ollama' ? res?.prompt_eval_count : res?.usage?.prompt_tokens;
  const salida = proveedor === 'ollama' ? res?.eval_count : res?.usage?.completion_tokens;
  if (!Number.isSafeInteger(entrada) || entrada < 0 || !Number.isSafeInteger(salida) || salida < 0) return null;
  return { prompt_tokens: entrada, completion_tokens: salida };
}

/**
 * Unified Chat Completion API:
 * Executes chat completions across local Ollama and Cloud OpenAI-compatible endpoints with full tool calling support.
 */
// Proteccion central RNF-04: con DAVIS_PII_PRELLM=1 TODA llamada a
// chatCompletion (incluidos los imports directos anteriores a la
// construccion del contenedor) pasa por la envolvente PII; si la raiz de
// composicion aun no registro la suya, se construye una perezosa aqui:
// el arranque NUNCA queda fail-open por orden de inicializacion.
// Sin recursion: la envolvente envuelve SIEMPRE chatCompletionCrudo,
// nunca este despachador. Una sola anonimizacion por peticion: el
// failover interno entre proveedores ocurre dentro del crudo.
let envolventeCentral = null;
let envolventePerezosa = null;

export function registrarEnvolventeChatCompletion(fn) {
  envolventeCentral = typeof fn === 'function' ? fn : null;
}

export function limpiarEnvolventeChatCompletion() {
  envolventeCentral = null;
}

async function obtenerEnvolventeCentral() {
  if (envolventeCentral) return envolventeCentral;
  if (!envolventePerezosa) {
    const { crearAnonimizadorPreLlm } = await import('../adapters/outbound/llm/piiPreLlmAdapter.js');
    const permitir = (process.env.DAVIS_PII_PERMITIR || '').split(',').map((p) => p.trim()).filter(Boolean);
    const envoltorio = crearAnonimizadorPreLlm({
      inner: { nombre: 'llmService-crudo', chatCompletion: (p) => chatCompletionCrudo(p) },
      permitir
    });
    envolventePerezosa = (p) => envoltorio.chatCompletion(p);
  }
  return envolventePerezosa;
}

export async function chatCompletion(peticion) {
  if (process.env.DAVIS_PII_PRELLM === '1') {
    const envolvente = await obtenerEnvolventeCentral();
    return envolvente(peticion);
  }
  return chatCompletionCrudo(peticion);
}

// Misma resolucion para transporte y proteccion PII. Los hints baseUrl/host
// de la peticion NO se consumen en la rama Ollama. Si el singleton ya
// existe, su host sigue siendo el capturado al crearlo aunque cambie config.
export function resolverDestinoLlm(peticion = {}) {
  const provider = (
    peticion.provider || config.llm?.provider ||
    (process.env.OPENAI_API_KEY || process.env.GROQ_API_KEY || process.env.OPENROUTER_API_KEY || process.env.DEEPSEEK_API_KEY ? 'openai' : 'ollama')
  ).toLowerCase();
  return {
    provider,
    host: provider === 'ollama'
      ? (defaultOllamaHost || config.llm?.ollamaHost || config.ollamaHost || 'http://127.0.0.1:11434')
      : null
  };
}

export async function chatCompletionCrudo({
  messages = [],
  tools,
  options = {},
  provider: providerOverride,
  model: modelOverride,
  apiKey: apiKeyOverride,
  baseUrl: baseUrlOverride
}) {
  const activeProvider = resolverDestinoLlm({ provider: providerOverride }).provider;

  const isOllama = activeProvider === 'ollama';

  if (isOllama) {
    const ollama = getOllamaClient();
    const model = modelOverride || config.llm?.ollamaModel || config.ollamaModel || 'jarvis';
    const preparedMessages = prepareMessagesForProvider(messages, true);

    const payload = {
      model,
      messages: preparedMessages,
      // Por defecto el modelo queda cargado (-1). Una llamada puntual que no
      // debe dejar nada residente (p.ej. lectura de un ticket) pasa
      // options.keep_alive = 0 y Ollama descarga el modelo al terminar.
      keep_alive: options.keep_alive ?? -1,
      options: {
        num_ctx: options.num_ctx || NUM_CTX_DEFECTO,
        temperature: options.temperature !== undefined ? options.temperature : (tools && tools.length > 0 ? 0.0 : 0.7),
        ...((tools && tools.length > 0) ? { seed: options.seed ?? 42 } : {}),
        num_thread: options.num_thread || 4,
        ...(options.max_tokens ? { num_predict: options.max_tokens } : { num_predict: options.num_predict || NUM_PREDICT_DEFECTO })
      }
    };

    if (tools && tools.length > 0) {
      payload.tools = limitarHerramientasParaProveedor(tools, messages);
    }

    const res = await ollama.chat(payload);

    let rawContent = res.message?.content || '';
    let toolCalls = undefined;

    if (res.message?.tool_calls && res.message.tool_calls.length > 0) {
      toolCalls = res.message.tool_calls.map(tc => {
        let args = tc.function.arguments;
        if (typeof args === 'string') {
          try { args = JSON.parse(args); } catch { args = {}; }
        }
        return {
          id: tc.id || `call_${Math.random().toString(36).slice(2, 10)}`,
          type: 'function',
          function: {
            name: tc.function.name,
            arguments: args || {}
          }
        };
      });
    } else if (tools && tools.length > 0 && rawContent) {
      // Fallback: Si el modelo emitió la llamada a función como texto plano en el contenido
      const extracted = extractToolCallsFromText(rawContent, tools);
      if (extracted && extracted.length > 0) {
        toolCalls = extracted;
        rawContent = ''; // Limpiar para que no se filtre código al usuario
      }
    }

    return {
      message: {
        role: 'assistant',
        content: rawContent,
        tool_calls: toolCalls
      },
      provider: 'ollama',
      usage: normalizarUsoProveedor(res, 'ollama'),
      model,
      finishReason: res.done_reason || null,
      raw: res
    };
  }

  // Cloud OpenAI-Compatible Provider
  // options.crearCliente / options.esperar: inyeccion para pruebas (un cliente
  // guionizado y esperas instantaneas); en produccion no se pasan.
  const { client, cloudConfig } = typeof options.crearCliente === 'function'
    ? { client: options.crearCliente(), cloudConfig: resolveCloudConfig({ provider: activeProvider, model: modelOverride, apiKey: apiKeyOverride, baseUrl: baseUrlOverride }) }
    : getOpenAIClient({ provider: activeProvider, model: modelOverride, apiKey: apiKeyOverride, baseUrl: baseUrlOverride });
  const esperar = typeof options.esperar === 'function' ? options.esperar : (ms) => new Promise((r) => setTimeout(r, ms));
  const modeloPrincipal = modelOverride || cloudConfig.model;
  const cadena = [modeloPrincipal];
  if (cloudConfig.provider === 'groq' || (cloudConfig.baseUrl || '').includes('groq.com')) {
    for (const m of modelosRespaldoGroq()) {
      if (!cadena.includes(m)) cadena.push(m);
    }
  }
  const preparedMessages = prepareMessagesForProvider(messages, false);

  const payloadBase = {
    messages: preparedMessages,
    temperature: options.temperature !== undefined ? options.temperature : (tools && tools.length > 0 ? 0.0 : 0.7),
    ...((tools && tools.length > 0) ? { seed: options.seed ?? 42 } : {}),
    ...(options.max_tokens ? { max_tokens: options.max_tokens } : (options.num_predict ? { max_tokens: options.num_predict } : {}))
  };

  if (tools && tools.length > 0) {
    payloadBase.tools = limitarHerramientasParaProveedor(tools, messages);
  }

  const esGroq = cloudConfig.provider === 'groq' || (cloudConfig.baseUrl || '').includes('groq.com');
  const presupuesto = esGroq ? (options.presupuestoGroq || presupuestoGroqPara(cloudConfig)) : null;
  // Reservar salida explicitamente, tambien en primera llamada/auxiliares.
  if (presupuesto && !payloadBase.max_tokens) payloadBase.max_tokens = NUM_PREDICT_DEFECTO;
  let estadisticaPresupuesto = null;
  let res = null;
  let modeloUsado = null;
  let ultimoError = null;
  let intentosTotales = 0;
  let motivoSaltoPrincipal = null;
  const saltadosPorCircuito = [];
  for (const candidato of cadena) {
    const aparcado = circuitoModelos.get(candidato);
    if (aparcado && aparcado.hasta > Date.now()) {
      saltadosPorCircuito.push(candidato);
      if (candidato === modeloPrincipal) motivoSaltoPrincipal = aparcado.motivo;
      console.warn(`[RouterLLM] ${candidato} aparcado por circuito (${aparcado.motivo}) hasta ${new Date(aparcado.hasta).toISOString()}; se salta sin gastar llamada.`);
      continue;
    }
    let motivoFallo = 'temporal';
    for (let intento = 1; intento <= MAX_INTENTOS_POR_MODELO; intento++) {
      intentosTotales++;
      try {
        const payload = { ...payloadBase, model: candidato };
        const enviar = async () => {
          const solicitud = client.chat.completions.create(payload);
          // OpenAI SDK expone cabeceras sin guardar contenido en telemetria.
          if (typeof solicitud?.withResponse === 'function') return solicitud.withResponse().then(r => ({ data: r.data, headers: r.response?.headers }));
          return { data: await solicitud }; // cliente guionizado/compatible
        };
        if (presupuesto) {
          const medido = await presupuesto.ejecutar(payload, enviar);
          res = medido.data;
          estadisticaPresupuesto = medido.presupuesto;
        } else res = (await enviar()).data;
        modeloUsado = candidato;
        break;
      } catch (err) {
        ultimoError = err;
        if (!esErrorConmutable(err)) {
          // Metadato acotado para observabilidad: SOLO el nombre del modelo.
          try { err.modeloFallido = candidato; } catch { /* error congelado */ }
          throw err;
        }
        const esperaSugerida = segundosRetryAfter(err);
        const esperaMs = (esperaSugerida ?? 1) * 1000;
        if (esperaMs > ESPERA_MAX_REINTENTO_MS) {
          // Cuota agotada a horizonte largo (p.ej. TPD diario): aparcar el
          // modelo en el circuito y saltar al siguiente SIN esperar aqui.
          motivoFallo = 'cuota';
          circuitoModelos.set(candidato, { hasta: Date.now() + Math.min(esperaMs, 24 * 3600 * 1000), motivo: 'cuota' });
          console.warn(`[RouterLLM] ${candidato} sin cuota (retry-after ${esperaSugerida ?? 'desconocido'}s); aparcado y salto al siguiente modelo.`);
          break;
        }
        console.warn(`[RouterLLM] ${candidato} fallo temporal (intento ${intento}/${MAX_INTENTOS_POR_MODELO}); reintento en ${esperaMs} ms.`);
        if (intento < MAX_INTENTOS_POR_MODELO) await esperar(esperaMs);
      }
    }
    if (modeloUsado) break;
    if (candidato === modeloPrincipal) motivoSaltoPrincipal = motivoFallo;
  }
  if (!modeloUsado) {
    const detalle = ultimoError ? ` Ultimo error: ${String(ultimoError.message || ultimoError).slice(0, 200)}` : '';
    const err = new Error(`Todos los modelos configurados estan sin cuota o no disponibles ahora mismo (${cadena.join(' -> ')}).${detalle}`);
    err.name = 'CuotaAgotadaError';
    // Metadato acotado (nombres de modelo y contadores, sin mensajes ni claves).
    err.failover = { modeloPrincipal, cadena: [...cadena], saltadosPorCircuito: [...saltadosPorCircuito], intentos: intentosTotales };
    throw err;
  }
  if (modeloUsado !== modeloPrincipal) {
    console.warn(`[RouterLLM] Respuesta con modelo de respaldo: ${modeloUsado} (principal ${modeloPrincipal} no disponible).`);
  }
  const choice = res.choices?.[0]?.message;

  if (!choice) {
    throw new Error('Cloud LLM provider returned empty choices.');
  }

  let rawContent = choice.content || '';
  let toolCalls = undefined;

  if (choice.tool_calls && choice.tool_calls.length > 0) {
    toolCalls = choice.tool_calls.map(tc => {
      let args = tc.function.arguments;
      if (typeof args === 'string') {
        try { args = JSON.parse(args); } catch { args = {}; }
      }
      return {
        id: tc.id || `call_${Math.random().toString(36).slice(2, 10)}`,
        type: 'function',
        function: {
          name: tc.function.name,
          arguments: args || {}
        }
      };
    });
  } else if (tools && tools.length > 0 && rawContent) {
    // Fallback: Si el modelo cloud emitió la llamada en texto plano
    const extracted = extractToolCallsFromText(rawContent, tools);
    if (extracted && extracted.length > 0) {
      toolCalls = extracted;
      rawContent = '';
    }
  }

  return {
    message: {
      role: 'assistant',
      content: rawContent,
      tool_calls: toolCalls
    },
    provider: cloudConfig.provider,
    usage: normalizarUsoProveedor(res, cloudConfig.provider),
    usageIntentosNoReportado: intentosTotales > 1,
    presupuesto: estadisticaPresupuesto,
    model: modeloUsado,
    degradado: modeloUsado !== modeloPrincipal,
    failover: { modeloPrincipal, motivoPrincipal: modeloUsado !== modeloPrincipal ? (motivoSaltoPrincipal || 'temporal') : null, cadena, saltadosPorCircuito, intentos: intentosTotales },
    finishReason: res.choices?.[0]?.finish_reason || null,
    raw: res
  };
}

// --- Router de modelos con failover (aprobado por David, 8 nov 2026) ---
// Alcance: SOLO Groq (sin nuevos proveedores ni cuentas). Primario = modelo
// configurado; respaldo por defecto openai/gpt-oss-20b (GROQ_MODELOS_RESPALDO
// lo sobrescribe, lista separada por comas). Salta por 429 o fallo temporal
// (5xx/red), NUNCA por 400 (fallo de la peticion, reintentar no arregla).
// La conmutacion es por RONDA: se reenvia la MISMA peticion (mismos mensajes,
// mismas herramientas) al respaldo, asi las herramientas ya ejecutadas no se
// repiten y una sintesis bloqueada por 429 puede completarse sin reejecutar
// nada. Circuito en memoria: un 429 con retry-after largo aparca el modelo
// para no gastar llamadas inutiles. No hay proactividad por cabeceras: las
// ventanas RPM/TPM no dicen el saldo diario (sonda 8 nov 2026), la señal de
// TPD es el 429 model-scoped con su retry-after.
const circuitoModelos = new Map(); // modelo -> { hasta: epochMs, motivo: 'cuota' | 'temporal' }
const MAX_INTENTOS_POR_MODELO = 2;
const ESPERA_MAX_REINTENTO_MS = 10000;

/** Solo para pruebas: limpia el circuito de modelos aparcados. */
export function reiniciarCircuitoModelos() {
  circuitoModelos.clear();
  reiniciarPresupuestosGroq();
}

function modelosRespaldoGroq() {
  const crudo = process.env.GROQ_MODELOS_RESPALDO || 'openai/gpt-oss-20b';
  return crudo.split(',').map((m) => m.trim()).filter(Boolean);
}

function esErrorConmutable(err) {
  const status = err?.status ?? err?.statusCode ?? err?.response?.status;
  if (status === 429) return true;
  if (typeof status === 'number' && status >= 500 && status < 600) return true;
  if (status == null) {
    const texto = `${err?.name || ''} ${err?.code || ''} ${err?.message || ''}`;
    if (/timeout|connection|network|econn|eai_again|socket|fetch failed/i.test(texto)) return true;
  }
  return false;
}

function segundosRetryAfter(err) {
  const h = err?.headers;
  const bruto = typeof h?.get === 'function' ? h.get('retry-after') : (h?.['retry-after'] ?? h?.['Retry-After']);
  if (bruto == null) return null;
  const n = Number(bruto);
  if (Number.isFinite(n)) return Math.max(0, n);
  const fecha = Date.parse(bruto);
  return Number.isFinite(fecha) ? Math.max(0, Math.round((fecha - Date.now()) / 1000)) : null;
}

/**
 * Detecta respuestas cortadas por el limite de tokens: el proveedor marca
 * 'length' o el texto termina a media frase. En ese caso el llamador puede
 * pedir una continuacion en lugar de entregar una respuesta mutilada.
 */
export function esRespuestaTruncada(content, finishReason) {
  if (finishReason === 'length') return true;
  if (!content || typeof content !== 'string') return false;
  const limpio = content.trim();
  if (limpio.length < 200) return false;
  return !/[.!?"')\]|:]$/.test(limpio);
}
