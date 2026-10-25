import { Ollama } from 'ollama';
import OpenAI from 'openai';
import { config } from './config.js';

let ollamaInstance = null;
let openaiInstance = null;

/**
 * Returns or initializes the local Ollama client singleton.
 */
export function getOllamaClient() {
  if (!ollamaInstance) {
    const host = config.llm?.ollamaHost || config.ollamaHost || 'http://127.0.0.1:11434';
    ollamaInstance = new Ollama({ host });
  }
  return ollamaInstance;
}

/**
 * Resolves cloud provider configurations, defaulting known endpoints and models.
 */
export function resolveCloudConfig(options = {}) {
  const provider = (options.provider || config.llm?.provider || 'openai').toLowerCase();
  const apiKey = options.apiKey || config.llm?.apiKey || process.env.OPENAI_API_KEY || '';

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
      model = 'llama-3.3-70b-versatile';
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
 */
export function getOpenAIClient(overrides = {}) {
  const cloudConfig = resolveCloudConfig(overrides);
  if (!cloudConfig.apiKey) {
    throw new Error('OPENAI_API_KEY is required when using cloud / OpenAI-compatible LLM provider.');
  }

  if (!openaiInstance || overrides.apiKey || overrides.baseUrl) {
    openaiInstance = new OpenAI({
      apiKey: cloudConfig.apiKey,
      baseURL: cloudConfig.baseUrl
    });
  }
  return { client: openaiInstance, cloudConfig };
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
 * Normalizes message formats for each provider (tool calls, stringified arguments, role tags).
 */
export function prepareMessagesForProvider(messages, isOllama) {
  return messages.map(msg => {
    const formatted = { ...msg };

    if (msg.role === 'assistant' && msg.tool_calls && Array.isArray(msg.tool_calls)) {
      formatted.tool_calls = msg.tool_calls.map(tc => {
        let args = tc.function.arguments;
        if (isOllama) {
          if (typeof args === 'string') {
            try { args = JSON.parse(args); } catch { args = {}; }
          }
        } else {
          if (typeof args !== 'string') {
            try { args = JSON.stringify(args || {}); } catch { args = '{}'; }
          }
        }
        return {
          id: tc.id || `call_${Math.random().toString(36).slice(2, 10)}`,
          type: 'function',
          function: {
            name: tc.function.name,
            arguments: args
          }
        };
      });
      if (formatted.content === undefined) {
        formatted.content = isOllama ? '' : null;
      }
    }

    if (msg.role === 'tool') {
      formatted.content = String(msg.content ?? '');
      if (!formatted.tool_call_id && msg.toolCallId) {
        formatted.tool_call_id = msg.toolCallId;
      }
      if (!formatted.tool_call_id) {
        formatted.tool_call_id = 'call_default';
      }
    }

    return formatted;
  });
}

/**
 * Unified Chat Completion API:
 * Executes chat completions across local Ollama and Cloud OpenAI-compatible endpoints with full tool calling support.
 *
 * @param {Object} params
 * @param {Array} params.messages - Array of chat messages
 * @param {Array} [params.tools] - Optional tool definitions
 * @param {Object} [params.options] - Hyperparameters (temperature, max_tokens, num_ctx, num_thread)
 * @param {string} [params.provider] - Optional provider override ('ollama' | 'openai')
 * @param {string} [params.model] - Optional model override
 * @returns {Promise<{ message: { role: string, content: string, tool_calls?: Array }, provider: string, model: string }>}
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
  const activeProvider = (providerOverride || config.llm?.provider || (process.env.OPENAI_API_KEY ? 'openai' : 'ollama')).toLowerCase();
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
    }

    return {
      message: {
        role: 'assistant',
        content: res.message?.content || '',
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
  }

  return {
    message: {
      role: 'assistant',
      content: choice.content || '',
      tool_calls: toolCalls
    },
    provider: cloudConfig.provider,
    model,
    raw: res
  };
}
