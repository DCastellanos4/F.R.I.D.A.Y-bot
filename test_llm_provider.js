import http from 'http';
import assert from 'assert';
import {
  resolveCloudConfig,
  prepareMessagesForProvider,
  chatCompletion,
  getLlmProviderInfo,
  getOllamaClient,
  getOpenAIClient,
  resetClients
} from './llmService.js';
import {
  consultarJarvis,
  seleccionarHerramientasPorIntencion,
  esPeticionCachimba
} from './jarvisAgent.js';
import { config } from './config.js';

async function runTests() {
  console.log('====================================================');
  console.log('RUNNING COMPREHENSIVE LLM PROVIDER & AGENT TEST SUITE');
  console.log('====================================================\n');

  let passed = 0;
  let failed = 0;

  function test(name, fn) {
    try {
      fn();
      console.log(`[PASS] ${name}`);
      passed++;
    } catch (err) {
      console.error(`[FAIL] ${name}:`, err.message);
      failed++;
    }
  }

  async function asyncTest(name, fn) {
    try {
      await fn();
      console.log(`[PASS] ${name}`);
      passed++;
    } catch (err) {
      console.error(`[FAIL] ${name}:`, err.message);
      failed++;
    }
  }

  // ----------------------------------------------------
  // Test Suite 1: Cloud Provider Config Auto-Resolution
  // ----------------------------------------------------
  console.log('--- Suite 1: Cloud Provider Auto-Resolution ---');

  test('Resolves default OpenAI config', () => {
    const res = resolveCloudConfig({ provider: 'openai', apiKey: 'sk-test-key' });
    assert.strictEqual(res.baseUrl, 'https://api.openai.com/v1');
    assert.strictEqual(res.model, 'gpt-4o-mini');
  });

  test('Auto-resolves Groq endpoint from gsk_ key prefix', () => {
    const res = resolveCloudConfig({ apiKey: 'gsk_abcdef123456' });
    assert.strictEqual(res.provider, 'groq');
    assert.strictEqual(res.baseUrl, 'https://api.groq.com/openai/v1');
    assert.strictEqual(res.model, 'llama-3.3-70b-versatile');
  });

  test('Auto-resolves Groq from GROQ_API_KEY environment variable', () => {
    const oldKey = process.env.GROQ_API_KEY;
    try {
      process.env.GROQ_API_KEY = 'gsk_env_auto_key';
      const res = resolveCloudConfig();
      assert.strictEqual(res.provider, 'groq');
      assert.strictEqual(res.baseUrl, 'https://api.groq.com/openai/v1');
      assert.strictEqual(res.apiKey, 'gsk_env_auto_key');
    } finally {
      if (oldKey) process.env.GROQ_API_KEY = oldKey;
      else delete process.env.GROQ_API_KEY;
    }
  });

  test('Auto-resolves OpenRouter endpoint from sk-or- key prefix', () => {
    const res = resolveCloudConfig({ apiKey: 'sk-or-v1-abcdef' });
    assert.strictEqual(res.provider, 'openrouter');
    assert.strictEqual(res.baseUrl, 'https://openrouter.ai/api/v1');
    assert.strictEqual(res.model, 'openai/gpt-4o-mini');
  });

  test('Auto-resolves OpenRouter from OPENROUTER_API_KEY environment variable', () => {
    const oldKey = process.env.OPENROUTER_API_KEY;
    try {
      process.env.OPENROUTER_API_KEY = 'sk-or-env-auto-key';
      const res = resolveCloudConfig();
      assert.strictEqual(res.provider, 'openrouter');
      assert.strictEqual(res.baseUrl, 'https://openrouter.ai/api/v1');
      assert.strictEqual(res.apiKey, 'sk-or-env-auto-key');
    } finally {
      if (oldKey) process.env.OPENROUTER_API_KEY = oldKey;
      else delete process.env.OPENROUTER_API_KEY;
    }
  });

  test('Auto-resolves DeepSeek endpoint for deepseek provider', () => {
    const res = resolveCloudConfig({ provider: 'deepseek', apiKey: 'test' });
    assert.strictEqual(res.baseUrl, 'https://api.deepseek.com');
    assert.strictEqual(res.model, 'deepseek-chat');
  });

  test('Auto-resolves DeepSeek from DEEPSEEK_API_KEY environment variable', () => {
    const oldKey = process.env.DEEPSEEK_API_KEY;
    try {
      process.env.DEEPSEEK_API_KEY = 'deepseek-env-key';
      const res = resolveCloudConfig();
      assert.strictEqual(res.provider, 'deepseek');
      assert.strictEqual(res.baseUrl, 'https://api.deepseek.com');
    } finally {
      if (oldKey) process.env.DEEPSEEK_API_KEY = oldKey;
      else delete process.env.DEEPSEEK_API_KEY;
    }
  });

  test('Preserves explicit custom baseURL and model overrides', () => {
    const res = resolveCloudConfig({
      baseUrl: 'http://my-vllm.local:8000/v1',
      model: 'meta-llama/Llama-3-8B-Instruct',
      apiKey: 'test'
    });
    assert.strictEqual(res.baseUrl, 'http://my-vllm.local:8000/v1');
    assert.strictEqual(res.model, 'meta-llama/Llama-3-8B-Instruct');
  });

  // ----------------------------------------------------
  // Test Suite 2: Client Lifecycle & Singleton Isolation
  // ----------------------------------------------------
  console.log('\n--- Suite 2: Client Lifecycle & Singleton Isolation ---');

  test('Custom overrides do not mutate default OpenAI client singleton', () => {
    resetClients();
    const oldEnvKey = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = 'sk-default-isolated-key';

    try {
      // 1. Initialize default client
      const defaultClient1 = getOpenAIClient();
      assert.strictEqual(defaultClient1.client.apiKey, 'sk-default-isolated-key');
      assert.strictEqual(defaultClient1.client.baseURL, 'https://api.openai.com/v1');

      // 2. Call with temporary one-off override (e.g. mock server)
      const overrideClient = getOpenAIClient({
        apiKey: 'sk-override-test-key',
        baseUrl: 'http://127.0.0.1:9999/v1'
      });
      assert.strictEqual(overrideClient.client.apiKey, 'sk-override-test-key');
      assert.strictEqual(overrideClient.client.baseURL, 'http://127.0.0.1:9999/v1');

      // 3. Request default client again: must NOT be contaminated by the override
      const defaultClient2 = getOpenAIClient();
      assert.strictEqual(defaultClient2.client.apiKey, 'sk-default-isolated-key');
      assert.strictEqual(defaultClient2.client.baseURL, 'https://api.openai.com/v1');
    } finally {
      if (oldEnvKey) process.env.OPENAI_API_KEY = oldEnvKey;
      else delete process.env.OPENAI_API_KEY;
      resetClients();
    }
  });

  // ----------------------------------------------------
  // Test Suite 3: Message Normalization Across Providers
  // ----------------------------------------------------
  console.log('\n--- Suite 3: Message Normalization Across Providers ---');

  test('Normalizes assistant tool_calls with stringified args and null content for OpenAI', () => {
    const rawMessages = [
      {
        role: 'assistant',
        content: '',
        tool_calls: [
          {
            id: 'call_abc123',
            function: {
              name: 'consultar_clima',
              arguments: { ubicacion: 'Valencia', momento: 'hoy' }
            }
          }
        ]
      },
      {
        role: 'tool',
        toolCallId: 'call_abc123',
        content: '22 grados'
      }
    ];

    const prepared = prepareMessagesForProvider(rawMessages, false);
    assert.strictEqual(typeof prepared[0].tool_calls[0].function.arguments, 'string');
    assert.strictEqual(prepared[0].content, null, 'Empty assistant content must normalize to null for OpenAI');
    assert.strictEqual(prepared[1].tool_call_id, 'call_abc123');
  });

  test('Preserves non-empty assistant reasoning content when tool_calls are present', () => {
    const rawMessages = [
      {
        role: 'assistant',
        content: 'Checking current weather in Valencia...',
        tool_calls: [
          {
            id: 'call_abc123',
            function: {
              name: 'consultar_clima',
              arguments: { ubicacion: 'Valencia' }
            }
          }
        ]
      }
    ];

    const prepared = prepareMessagesForProvider(rawMessages, false);
    assert.strictEqual(prepared[0].content, 'Checking current weather in Valencia...');
  });

  test('Normalizes assistant tool_calls with object args and empty string content for Ollama', () => {
    const rawMessages = [
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: 'call_abc123',
            function: {
              name: 'consultar_clima',
              arguments: '{"ubicacion":"Valencia","momento":"hoy"}'
            }
          }
        ]
      },
      {
        role: 'tool',
        tool_call_id: 'call_abc123',
        content: '22 grados'
      }
    ];

    const prepared = prepareMessagesForProvider(rawMessages, true);
    assert.strictEqual(typeof prepared[0].tool_calls[0].function.arguments, 'object');
    assert.strictEqual(prepared[0].tool_calls[0].function.arguments.ubicacion, 'Valencia');
    assert.strictEqual(prepared[0].content, '', 'Ollama assistant content must normalize to empty string');
    assert.strictEqual(prepared[1].tool_call_id, 'call_abc123');
  });

  // ----------------------------------------------------
  // Test Suite 4: Local Ollama Live Execution
  // ----------------------------------------------------
  console.log('\n--- Suite 4: Local Ollama Live Execution ---');

  await asyncTest('Local Ollama basic completion', async () => {
    const res = await chatCompletion({
      messages: [
        { role: 'user', content: 'Di únicamente la palabra "LISTO" sin puntuación.' }
      ],
      provider: 'ollama',
      options: { max_tokens: 10, temperature: 0 }
    });

    assert(res.message.content.length > 0, 'Response should not be empty');
    assert.strictEqual(res.provider, 'ollama');
  });

  await asyncTest('Local Ollama tool calling execution (consultar_clima)', async () => {
    const tools = [
      {
        type: 'function',
        function: {
          name: 'consultar_clima',
          description: 'Consulta el clima de una ciudad',
          parameters: {
            type: 'object',
            properties: {
              ubicacion: { type: 'string' }
            },
            required: ['ubicacion']
          }
        }
      }
    ];

    const res = await chatCompletion({
      messages: [
        { role: 'user', content: '¿Qué tiempo hace hoy en Barcelona?' }
      ],
      tools,
      provider: 'ollama'
    });

    assert(res.message.tool_calls && res.message.tool_calls.length > 0, 'Ollama should produce tool_calls');
    const call = res.message.tool_calls[0];
    assert.strictEqual(call.function.name, 'consultar_clima');
    assert(typeof call.function.arguments === 'object', 'Arguments should be parsed object');
    assert(call.function.arguments.ubicacion, 'Ubicacion argument should exist');
  });

  // ----------------------------------------------------
  // Test Suite 5: Jarvis Agent Core Logic & Ollama Pipeline
  // ----------------------------------------------------
  console.log('\n--- Suite 5: Jarvis Agent Pipeline (Ollama) ---');

  test('Stark Easter Egg triggers correctly', () => {
    assert.strictEqual(esPeticionCachimba('ponle más tabaco a la cachimba'), true);
    assert.strictEqual(esPeticionCachimba('recuerda poner tabaco a las 20:00'), false);
  });

  test('Dynamic Tool Pruning selects proper tools', () => {
    const toolsClima = seleccionarHerramientasPorIntencion('¿Va a llover hoy en Sevilla?');
    assert(toolsClima.some(t => t.function.name === 'consultar_clima'));

    const toolsMemoria = seleccionarHerramientasPorIntencion('Recuerda que mi clave wifi es Secreta123');
    assert(toolsMemoria.some(t => t.function.name === 'guardar_memoria'));

    const toolsChitchat = seleccionarHerramientasPorIntencion('Hola qué tal estás');
    assert.strictEqual(toolsChitchat.length, 0, 'Pure chitchat should prune all tools');
  });

  await asyncTest('End-to-end consultarJarvis conversational turn (Ollama)', async () => {
    const reply = await consultarJarvis('Hola, preséntate brevemente en una frase.');
    assert(reply && reply.length > 5, 'Agent response should be non-empty');
  });

  await asyncTest('End-to-end consultarJarvis tool execution (clima - Ollama)', async () => {
    const reply = await consultarJarvis('¿Qué tiempo hace en Madrid hoy?');
    assert(reply && reply.length > 10, 'Agent should execute weather tool and synthesize response');
    assert(/madrid|grado|temperatura|cielo|tiempo/i.test(reply), 'Response should mention weather facts');
  });

  // ----------------------------------------------------
  // Test Suite 6: Cloud Provider & End-to-End Mock Pipeline
  // ----------------------------------------------------
  console.log('\n--- Suite 6: Cloud Provider Mock & End-to-End Pipeline ---');

  await asyncTest('Cloud provider mock direct completion and tool calling', async () => {
    let receivedRequest = null;
    const server = http.createServer((req, res) => {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        receivedRequest = {
          url: req.url,
          body: JSON.parse(body)
        };
        const isToolCall = receivedRequest.body.tools && receivedRequest.body.tools.length > 0;
        const mockRes = {
          id: 'chatcmpl-mock',
          object: 'chat.completion',
          created: Date.now(),
          model: receivedRequest.body.model,
          choices: [
            {
              index: 0,
              message: isToolCall
                ? {
                    role: 'assistant',
                    content: null,
                    tool_calls: [
                      {
                        id: 'call_mock_123',
                        type: 'function',
                        function: {
                          name: 'consultar_clima',
                          arguments: JSON.stringify({ ubicacion: 'Tokyo', momento: 'hoy' })
                        }
                      }
                    ]
                  }
                : {
                    role: 'assistant',
                    content: 'Cloud response OK.'
                  },
              finish_reason: isToolCall ? 'tool_calls' : 'stop'
            }
          ]
        };
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(mockRes));
      });
    });

    await new Promise(resolve => server.listen(3457, '127.0.0.1', resolve));

    try {
      const conv = await chatCompletion({
        messages: [{ role: 'user', content: 'Hi' }],
        provider: 'openai',
        apiKey: 'sk-test-mock-key',
        baseUrl: 'http://127.0.0.1:3457/v1'
      });
      assert.strictEqual(conv.message.content, 'Cloud response OK.');

      const toolRes = await chatCompletion({
        messages: [{ role: 'user', content: 'Weather in Tokyo' }],
        tools: [{ type: 'function', function: { name: 'consultar_clima' } }],
        provider: 'openai',
        apiKey: 'sk-test-mock-key',
        baseUrl: 'http://127.0.0.1:3457/v1'
      });
      assert(toolRes.message.tool_calls && toolRes.message.tool_calls.length === 1);
      assert.strictEqual(toolRes.message.tool_calls[0].function.arguments.ubicacion, 'Tokyo');
    } finally {
      server.close();
    }
  });

  await asyncTest('End-to-end consultarJarvis multi-turn execution with Cloud Provider Mock', async () => {
    let callCount = 0;
    let turn2Payload = null;

    const mockCloudServer = http.createServer((req, res) => {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        callCount++;
        const parsed = JSON.parse(body);

        if (callCount === 1) {
          // Turn 1: Model decides to call consultar_clima
          const mockRes = {
            id: 'chatcmpl-turn1',
            object: 'chat.completion',
            created: Date.now(),
            model: parsed.model,
            choices: [
              {
                index: 0,
                message: {
                  role: 'assistant',
                  content: null,
                  tool_calls: [
                    {
                      id: 'call_e2e_cloud_789',
                      type: 'function',
                      function: {
                        name: 'consultar_clima',
                        arguments: JSON.stringify({ ubicacion: 'Valencia', momento: 'hoy' })
                      }
                    }
                  ]
                },
                finish_reason: 'tool_calls'
              }
            ]
          };
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(mockRes));
        } else {
          // Turn 2: Final synthesis pass
          turn2Payload = parsed;
          const mockRes = {
            id: 'chatcmpl-turn2',
            object: 'chat.completion',
            created: Date.now(),
            model: parsed.model,
            choices: [
              {
                index: 0,
                message: {
                  role: 'assistant',
                  content: 'En Valencia tenemos 21°C con cielos despejados, jefe.'
                },
                finish_reason: 'stop'
              }
            ]
          };
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(mockRes));
        }
      });
    });

    await new Promise(resolve => mockCloudServer.listen(3458, '127.0.0.1', resolve));

    // Temporarily configure config.llm for the mock cloud provider
    const originalProvider = config.llm.provider;
    const originalBaseUrl = config.llm.baseUrl;
    const originalApiKey = config.llm.apiKey;

    config.llm.provider = 'openai';
    config.llm.baseUrl = 'http://127.0.0.1:3458/v1';
    config.llm.apiKey = 'sk-mock-cloud-e2e';
    resetClients();

    try {
      const response = await consultarJarvis('¿Qué tiempo hace en Valencia hoy?');
      assert.strictEqual(callCount, 2, 'Pipeline must trigger 2 LLM passes (tool call + final synthesis)');
      assert(response.includes('Valencia'), 'Final response must contain synthesized weather info');

      // Verify that Turn 2 payload received normalized messages according to OpenAI specs
      assert(turn2Payload, 'Turn 2 payload must be captured');
      const messages = turn2Payload.messages;

      // Find assistant message and tool message in Turn 2
      const assistantMsg = messages.find(m => m.role === 'assistant');
      const toolMsg = messages.find(m => m.role === 'tool');

      assert(assistantMsg, 'Turn 2 must include assistant message');
      assert.strictEqual(assistantMsg.content, null, 'OpenAI assistant message with tool_calls must have content: null');
      assert.strictEqual(typeof assistantMsg.tool_calls[0].function.arguments, 'string', 'Tool arguments must be stringified for OpenAI');

      assert(toolMsg, 'Turn 2 must include tool message');
      assert.strictEqual(toolMsg.tool_call_id, 'call_e2e_cloud_789', 'Tool message must match tool_call_id');
      assert(toolMsg.content.length > 5, 'Tool message content must contain real weather result');
    } finally {
      mockCloudServer.close();
      config.llm.provider = originalProvider;
      config.llm.baseUrl = originalBaseUrl;
      config.llm.apiKey = originalApiKey;
      resetClients();
    }
  });

  console.log('\n====================================================');
  console.log(`TEST SUMMARY: ${passed} PASSED | ${failed} FAILED`);
  console.log('====================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
