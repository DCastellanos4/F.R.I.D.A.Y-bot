import http from 'http';
import assert from 'assert';
import {
  resolveCloudConfig,
  prepareMessagesForProvider,
  chatCompletion,
  getLlmProviderInfo,
  getOllamaClient
} from './llmService.js';
import { consultarJarvis, seleccionarHerramientasPorIntencion, esPeticionCachimba } from './jarvisAgent.js';

async function runTests() {
  console.log('🧪 ====================================================');
  console.log('🧪 RUNNING COMPREHENSIVE LLM PROVIDER & AGENT TEST SUITE');
  console.log('🧪 ====================================================\n');

  let passed = 0;
  let failed = 0;

  function test(name, fn) {
    try {
      fn();
      console.log(`✅ [PASS] ${name}`);
      passed++;
    } catch (err) {
      console.error(`❌ [FAIL] ${name}:`, err.message);
      failed++;
    }
  }

  async function asyncTest(name, fn) {
    try {
      await fn();
      console.log(`✅ [PASS] ${name}`);
      passed++;
    } catch (err) {
      console.error(`❌ [FAIL] ${name}:`, err.message);
      failed++;
    }
  }

  // ----------------------------------------------------
  // Test Suite 1: Cloud Provider Config Resolution
  // ----------------------------------------------------
  console.log('--- Suite 1: Cloud Provider Auto-Resolution ---');

  test('Resolves default OpenAI config', () => {
    const res = resolveCloudConfig({ provider: 'openai', apiKey: 'sk-test-key' });
    assert.strictEqual(res.baseUrl, 'https://api.openai.com/v1');
    assert.strictEqual(res.model, 'gpt-4o-mini');
  });

  test('Auto-resolves Groq endpoint from gsk_ key prefix', () => {
    const res = resolveCloudConfig({ apiKey: 'gsk_abcdef123456' });
    assert.strictEqual(res.baseUrl, 'https://api.groq.com/openai/v1');
    assert.strictEqual(res.model, 'llama-3.3-70b-versatile');
  });

  test('Auto-resolves OpenRouter endpoint from sk-or- key prefix', () => {
    const res = resolveCloudConfig({ apiKey: 'sk-or-v1-abcdef' });
    assert.strictEqual(res.baseUrl, 'https://openrouter.ai/api/v1');
    assert.strictEqual(res.model, 'openai/gpt-4o-mini');
  });

  test('Auto-resolves DeepSeek endpoint for deepseek provider', () => {
    const res = resolveCloudConfig({ provider: 'deepseek', apiKey: 'test' });
    assert.strictEqual(res.baseUrl, 'https://api.deepseek.com');
    assert.strictEqual(res.model, 'deepseek-chat');
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
  // Test Suite 2: Message Normalization Across Providers
  // ----------------------------------------------------
  console.log('\n--- Suite 2: Message Normalization ---');

  test('Normalizes assistant tool_calls with stringified args for OpenAI', () => {
    const rawMessages = [
      {
        role: 'assistant',
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
    assert.strictEqual(prepared[0].content, null);
    assert.strictEqual(prepared[1].tool_call_id, 'call_abc123');
  });

  test('Normalizes assistant tool_calls with object args for Ollama', () => {
    const rawMessages = [
      {
        role: 'assistant',
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
    assert.strictEqual(prepared[0].content, '');
    assert.strictEqual(prepared[1].tool_call_id, 'call_abc123');
  });

  // ----------------------------------------------------
  // Test Suite 3: Local Ollama Execution & Tool Calling
  // ----------------------------------------------------
  console.log('\n--- Suite 3: Local Ollama Live Execution ---');

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
  // Test Suite 4: High-Level Agent Integration (consultarJarvis)
  // ----------------------------------------------------
  console.log('\n--- Suite 4: Jarvis Agent Full Pipeline ---');

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

  await asyncTest('End-to-end consultarJarvis conversational turn', async () => {
    const reply = await consultarJarvis('Hola, preséntate brevemente en una frase.');
    assert(reply && reply.length > 5, 'Agent response should be non-empty');
  });

  await asyncTest('End-to-end consultarJarvis tool execution (clima)', async () => {
    const reply = await consultarJarvis('¿Qué tiempo hace en Madrid hoy?');
    assert(reply && reply.length > 10, 'Agent should execute weather tool and synthesize response');
    assert(/madrid|grado|temperatura|cielo|tiempo/i.test(reply), 'Response should mention weather facts');
  });

  // ----------------------------------------------------
  // Test Suite 5: OpenAI-Compatible Cloud Provider Path
  // ----------------------------------------------------
  console.log('\n--- Suite 5: Cloud Provider (OpenAI-Compatible) ---');

  await asyncTest('Cloud provider mock conversational and tool calling completion', async () => {
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

  console.log('\n====================================================');
  console.log(`🏁 TEST SUMMARY: ${passed} PASSED | ${failed} FAILED`);
  console.log('====================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
