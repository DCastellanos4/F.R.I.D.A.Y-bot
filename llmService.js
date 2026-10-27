import { Ollama } from 'ollama';
import OpenAI from 'openai';
import { config } from './config.js';

let defaultOllamaInstance = null;
let defaultOpenAIInstance = null;
let defaultOpenAIConfig = null;

/**
 * Resets cached client singletons. Useful for testing or hot-reloading configurations.
 */
export function resetClients() {
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
      baseURL: cloudConfig.baseUrl
    });
    return { client: customClient, cloudConfig };
  }

  if (!defaultOpenAIInstance) {
    defaultOpenAIInstance = new OpenAI({
      apiKey: cloudConfig.apiKey,
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

/**
 * Unified Chat Completion API:
 * Executes chat completions across local Ollama and Cloud OpenAI-compatible endpoints with full tool calling support.
 */
export async function chatCompletion({
  messages = [],
  tools,
  options = {},
  provider: providerOverride,
  model: modelOverride,
  apiKey: apiKeyOverride,
  baseUrl: baseUrlOverride
}) {
  const activeProvider = (
    providerOverride ||
    config.llm?.provider ||
    (process.env.OPENAI_API_KEY || process.env.GROQ_API_KEY || process.env.OPENROUTER_API_KEY || process.env.DEEPSEEK_API_KEY ? 'openai' : 'ollama')
  ).toLowerCase();

  const isOllama = activeProvider === 'ollama';

  if (isOllama) {
    const ollama = getOllamaClient();
    const model = modelOverride || config.llm?.ollamaModel || config.ollamaModel || 'jarvis';
    const preparedMessages = prepareMessagesForProvider(messages, true);

    const payload = {
      model,
      messages: preparedMessages,
      keep_alive: -1,
      options: {
        num_ctx: options.num_ctx || 2048,
        temperature: options.temperature ?? 0.1,
        num_thread: options.num_thread || 4,
        ...(options.max_tokens ? { num_predict: options.max_tokens } : (options.num_predict ? { num_predict: options.num_predict } : {}))
      }
    };

    if (tools && tools.length > 0) {
      payload.tools = tools;
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
      model,
      raw: res
    };
  }

  // Cloud OpenAI-Compatible Provider
  const { client, cloudConfig } = getOpenAIClient({
    provider: activeProvider,
    model: modelOverride,
    apiKey: apiKeyOverride,
    baseUrl: baseUrlOverride
  });
  const model = modelOverride || cloudConfig.model;
  const preparedMessages = prepareMessagesForProvider(messages, false);

  const payload = {
    model,
    messages: preparedMessages,
    temperature: options.temperature ?? 0.1,
    ...(options.max_tokens ? { max_tokens: options.max_tokens } : (options.num_predict ? { max_tokens: options.num_predict } : {}))
  };

  if (tools && tools.length > 0) {
    payload.tools = tools;
  }

  const res = await client.chat.completions.create(payload);
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
    model,
    raw: res
  };
}
