// RNF-04 PII PRE-LLM: todo texto hacia el LLM cloud sale anonimizado, la
// respuesta se restaura en local, el mapa es por peticion y nunca sale,
// la estructura (roles, tool_call ids, esquemas) se conserva y la
// restauracion nunca crea datos nuevos. Guardias del bypass conversacional.
//
// Strict Policy: Zero Emojis.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crearAnonimizadorPreLlm } from '../../src/adapters/outbound/llm/piiPreLlmAdapter.js';
import { crearMessageProcessor } from '../../src/core/messageProcessor.js';

function innerGrabador(respuesta) {
  const recibidas = [];
  return {
    recibidas,
    nombre: 'faux',
    chatCompletion: async (peticion) => {
      recibidas.push(JSON.parse(JSON.stringify(peticion)));
      return typeof respuesta === 'function' ? respuesta() : respuesta;
    }
  };
}

test('pre-LLM: el proveedor recibe PII enmascarada, nunca el valor real ni el mapa', async () => {
  const inner = innerGrabador({ message: { role: 'assistant', content: 'ok' } });
  const llm = crearAnonimizadorPreLlm({ inner });
  const peticion = {
    messages: [
      { role: 'system', content: 'Eres DAVIS.' },
      { role: 'user', content: 'Mi telefono es +34611222333 y mi email es david@example.com' }
    ],
    options: { temperature: 0 }
  };
  await llm.chatCompletion(peticion);
  const enviada = inner.recibidas[0];
  const textoUsuario = enviada.messages[1].content;
  assert.equal(textoUsuario.includes('+34611222333'), false, 'el telefono NO sale');
  assert.equal(textoUsuario.includes('david@example.com'), false, 'el email NO sale');
  assert.match(textoUsuario, /\[PII_TELEFONO_1\]/);
  assert.match(textoUsuario, /\[PII_EMAIL_1\]/);
  assert.equal(enviada.messages[0].role, 'system', 'estructura de roles intacta');
  assert.equal(enviada.messages[0].content, 'Eres DAVIS.', 'mensaje sin PII intacto');
  assert.equal('mapa' in enviada, false, 'el mapa NUNCA viaja');
  assert.equal('mapa' in enviada.messages[1], false);
});

test('pre-LLM: mismo valor mismo token entre mensajes; valores distintos nunca comparten token', async () => {
  const inner = innerGrabador({ message: { role: 'assistant', content: 'ok' } });
  const llm = crearAnonimizadorPreLlm({ inner });
  await llm.chatCompletion({ messages: [
    { role: 'user', content: 'apunta +34611222333' },
    { role: 'assistant', content: 'apuntado +34611222333' },
    { role: 'user', content: 'y el de Maria es +34699888777' }
  ] });
  const [m1, m2, m3] = inner.recibidas[0].messages;
  const token1 = m1.content.match(/\[PII_TELEFONO_\d+\]/)[0];
  assert.equal(m2.content.includes(token1), true, 'mismo valor, mismo token (coherencia para el modelo)');
  const token3 = m3.content.match(/\[PII_TELEFONO_\d+\]/)[0];
  assert.notEqual(token3, token1, 'valores distintos, tokens distintos');
});

test('pre-LLM: restaura contenido y arguments de tool_calls; token inventado NO se restaura', async () => {
  const inner = innerGrabador({
    message: {
      role: 'assistant',
      content: 'Llamo al [PII_TELEFONO_1] y al [PII_TELEFONO_9]',
      tool_calls: [{ id: 'call-7', type: 'function', function: { name: 'enviar_whatsapp', arguments: '{"telefono":"[PII_TELEFONO_1]"}' } }]
    }
  });
  const llm = crearAnonimizadorPreLlm({ inner });
  const respuesta = await llm.chatCompletion({ messages: [{ role: 'user', content: 'llama al +34611222333' }] });
  assert.equal(respuesta.message.content, 'Llamo al +34611222333 y al [PII_TELEFONO_9]',
    'restaura solo lo del mapa; el token inventado queda sin tocar (nunca crea datos)');
  const args = JSON.parse(respuesta.message.tool_calls[0].function.arguments);
  assert.equal(args.telefono, '+34611222333', 'arguments restaurados al valor que el usuario aporto');
  assert.equal(respuesta.message.tool_calls[0].id, 'call-7', 'tool_call id intacto');
});

test('pre-LLM: lista blanca acotada no enmascara lo autorizado', async () => {
  const inner = innerGrabador({ message: { role: 'assistant', content: 'ok' } });
  const llm = crearAnonimizadorPreLlm({ inner, permitir: ['+34611222333'] });
  await llm.chatCompletion({ messages: [{ role: 'user', content: 'mi numero es +34611222333 y el otro es +34699888777' }] });
  const texto = inner.recibidas[0].messages[0].content;
  assert.equal(texto.includes('+34611222333'), true, 'autorizado: no se enmascara');
  assert.equal(texto.includes('+34699888777'), false, 'el resto si');
});

test('pre-LLM: streaming se rechaza fail-closed en este corte', async () => {
  const inner = innerGrabador({ message: { content: 'ok' } });
  const llm = crearAnonimizadorPreLlm({ inner });
  await assert.rejects(
    llm.chatCompletion({ messages: [{ role: 'user', content: 'hola' }], options: { stream: true } }),
    /streaming no soportado/
  );
  assert.equal(inner.recibidas.length, 0, 'la llamada NO sale');
});

test('pre-LLM: la peticion del llamador nunca se muta in situ', async () => {
  const inner = innerGrabador({ message: { content: 'ok' } });
  const llm = crearAnonimizadorPreLlm({ inner });
  const mensaje = { role: 'user', content: 'mi telefono es +34611222333' };
  const peticion = { messages: [mensaje] };
  await llm.chatCompletion(peticion);
  assert.equal(mensaje.content, 'mi telefono es +34611222333', 'historia del llamador intacta');
});

// ---------------------------------------------------- guardias bypass ---

function processorConversacionLocal(llamadasLlm) {
  return crearMessageProcessor({
    llmProvider: {
      chatCompletion: async () => {
        llamadasLlm.push(1);
        return { message: { content: 'respuesta del agente', tool_calls: [] } };
      }
    },
    memoryRepository: { buscar: async () => [], guardar: async () => {}, listar: async () => [], olvidar: async () => true },
    enrutadorInferencia: {
      clasificarIntencion: async () => ({ intencion: 'conversacion', confianza: 0.99, via: 'local_slm' }),
      responderConversacion: async () => ({ exito: true, via: 'local_slm', respuesta: 'respuesta local SLM', confianza: 0.99 })
    }
  });
}

test('guardia: un "si" desnudo NUNCA se intercepta aunque el SLM tenga confianza 0.99', async () => {
  const llamadasLlm = [];
  const processor = processorConversacionLocal(llamadasLlm);
  const respuesta = await processor.procesarMensajeEntrante({ userId: 'u', text: 'si', channel: 'whatsapp' });
  assert.equal(respuesta, 'respuesta del agente', 'la confirmacion llega al agente');
  assert.ok(llamadasLlm.length >= 1, 'el agente fue invocado');
});

test('guardia: si el ultimo turno pedia confirmacion, no hay bypass', async () => {
  const llamadasLlm = [];
  const processor = processorConversacionLocal(llamadasLlm);
  const historial = [
    { role: 'user', content: 'apunta 12 euros de taxi' },
    { role: 'assistant', content: 'Taxi, 12 euros. No lo registro hasta que confirmes: responde "si" o corrigeme.' }
  ];
  const respuesta = await processor.procesarMensajeEntrante(
    { userId: 'u', text: 'vale, apuntalo', channel: 'whatsapp' },
    { historial }
  );
  assert.equal(respuesta, 'respuesta del agente', 'con confirmacion pendiente el agente decide');
  assert.ok(llamadasLlm.length >= 1);
});

test('pre-LLM multipart: contenido no textual hacia la nube se rechaza fail-closed y no sale nada', async () => {
  const inner = innerGrabador({ message: { role: 'assistant', content: 'ok' } });
  const llm = crearAnonimizadorPreLlm({ inner });
  await assert.rejects(
    llm.chatCompletion({
      provider: 'groq',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'lee esto' }, { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,AA' } }] }]
    }),
    /multipart/i
  );
  assert.equal(inner.recibidas.length, 0, 'ningun byte de la peticion multipart alcanzo al proveedor cloud');
});

test('pre-LLM local probado: provider ollama sin baseUrl pasa intacto (ticketVision local no se rompe)', async () => {
  const inner = innerGrabador({ message: { role: 'assistant', content: '{"establecimiento":"X"}' } });
  const llm = crearAnonimizadorPreLlm({ inner });
  const multipart = [{ type: 'text', text: 'PROMPT' }, { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,AA' } }];
  const r = await llm.chatCompletion({ provider: 'ollama', model: 'qwen2.5vl:7b', messages: [{ role: 'user', content: multipart }] });
  assert.equal(r.message.content, '{"establecimiento":"X"}');
  assert.deepEqual(inner.recibidas[0].messages[0].content, multipart, 'la peticion local viaja sin anonimizar ni reordenar');
});

test('pre-LLM local probado: baseUrl loopback explicito tambien pasa intacto', async () => {
  const inner = innerGrabador({ message: { role: 'assistant', content: 'ok' } });
  const llm = crearAnonimizadorPreLlm({ inner });
  await llm.chatCompletion({ provider: 'ollama', baseUrl: 'http://127.0.0.1:11434', messages: [{ role: 'user', content: 'mi telefono es +34611222333' }] });
  assert.match(inner.recibidas[0].messages[0].content, /\+34611222333/, 'destino local: sin anonimizar');
});

test('pre-LLM: etiqueta ollama con baseUrl REMOTA no es local probado; multipart se rechaza y texto se anonimiza', async () => {
  const inner = innerGrabador({ message: { role: 'assistant', content: 'ok' } });
  const llm = crearAnonimizadorPreLlm({ inner });
  await assert.rejects(
    llm.chatCompletion({ provider: 'ollama', baseUrl: 'https://ollama.remoto.example', messages: [{ role: 'user', content: [{ type: 'text', text: 'x' }] }] }),
    /multipart/i
  );
  assert.equal(inner.recibidas.length, 0);
  await llm.chatCompletion({ provider: 'ollama', baseUrl: 'https://ollama.remoto.example', messages: [{ role: 'user', content: 'mi telefono es +34611222333' }] });
  assert.ok(!inner.recibidas[0].messages[0].content.includes('+34611222333'), 'baseUrl remota no probada local: se anonimiza');
});

test('proteccion central: el despachador de llmService enruta por la envolvente registrada y limpiar la retira', async () => {
  const { chatCompletion, registrarEnvolventeChatCompletion, limpiarEnvolventeChatCompletion } = await import('../../src/core/llmService.js');
  const prev = process.env.DAVIS_PII_PRELLM;
  process.env.DAVIS_PII_PRELLM = '1';
  const llamadas = [];
  registrarEnvolventeChatCompletion(async (p) => { llamadas.push(p); return { message: { role: 'assistant', content: 'via envolvente' } }; });
  try {
    const r = await chatCompletion({ messages: [{ role: 'user', content: 'hola' }] });
    assert.equal(r.message.content, 'via envolvente');
    assert.equal(llamadas.length, 1, 'la llamada paso por la envolvente central, no por el crudo');
  } finally {
    limpiarEnvolventeChatCompletion();
    if (prev === undefined) delete process.env.DAVIS_PII_PRELLM; else process.env.DAVIS_PII_PRELLM = prev;
  }
});

test('pre-LLM: OLLAMA_HOST remoto sin baseUrl explicito NO es local probado (nunca PII en claro por config implicita)', async () => {
  const prev = process.env.OLLAMA_HOST;
  process.env.OLLAMA_HOST = 'https://ollama.remoto.example:11434';
  try {
    const inner = innerGrabador({ message: { role: 'assistant', content: 'ok' } });
    const llm = crearAnonimizadorPreLlm({ inner });
    await llm.chatCompletion({ provider: 'ollama', messages: [{ role: 'user', content: 'mi telefono es +34611222333' }] });
    assert.ok(!inner.recibidas[0].messages[0].content.includes('+34611222333'), 'OLLAMA_HOST remoto: anonimizado');
    await assert.rejects(
      llm.chatCompletion({ provider: 'ollama', messages: [{ role: 'user', content: [{ type: 'text', text: 'x' }] }] }),
      /multipart/i
    );
  } finally {
    if (prev === undefined) delete process.env.OLLAMA_HOST; else process.env.OLLAMA_HOST = prev;
  }
});

test('pre-LLM: OLLAMA_HOST loopback sin baseUrl explicito sigue siendo local probado', async () => {
  const prev = process.env.OLLAMA_HOST;
  process.env.OLLAMA_HOST = 'http://localhost:11434';
  try {
    const inner = innerGrabador({ message: { role: 'assistant', content: 'ok' } });
    const llm = crearAnonimizadorPreLlm({ inner });
    await llm.chatCompletion({ provider: 'ollama', messages: [{ role: 'user', content: 'mi telefono es +34611222333' }] });
    assert.match(inner.recibidas[0].messages[0].content, /\+34611222333/);
  } finally {
    if (prev === undefined) delete process.env.OLLAMA_HOST; else process.env.OLLAMA_HOST = prev;
  }
});
