import test from 'node:test';
import assert from 'node:assert/strict';
import {
  NIVEL_COMPLEJIDAD,
  clasificarComplejidadTurno,
  aplicarSugerenciaCascada,
  resolverModeloNivel
} from '../../src/core/complexityCascadeRouter.js';
import { MODELO_FALLBACK_ROBUSTO } from '../../src/core/routerLLM.js';
import { consultarJarvis } from '../../src/core/jarvisAgent.js';
import { explicarUltimoRecorrido } from '../../src/services/traceService.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

test('clasificarComplejidadTurno separa Nivel 0, Nivel 1 y Nivel 2 correctamente', () => {
  const n0 = clasificarComplejidadTurno({ esRutaDeterminista: true });
  assert.equal(n0.nivel, NIVEL_COMPLEJIDAD.DETERMINISTA);
  assert.equal(n0.razon, 'ruta_determinista_0_llm');

  const n1 = clasificarComplejidadTurno({
    mensaje: 'que tiempo hace en Madrid',
    intenciones: ['clima'],
    herramientas: [{}],
    especialista: 'general'
  });
  assert.equal(n1.nivel, NIVEL_COMPLEJIDAD.RAPIDO);
  assert.equal(n1.razon, 'intencion_unica_simple');

  const n2Coder = clasificarComplejidadTurno({
    mensaje: 'revisa esta PR y depura el fallo',
    intenciones: ['devtools'],
    herramientas: [{}],
    especialista: 'coder'
  });
  assert.equal(n2Coder.nivel, NIVEL_COMPLEJIDAD.RAZONAMIENTO);
  assert.equal(n2Coder.razon, 'especialista_coder');

  const n2Multi = clasificarComplejidadTurno({
    mensaje: 'mira el tiempo en Madrid y mandaselo a Paula',
    intenciones: ['clima', 'mensajeProgramado'],
    herramientas: [{}, {}]
  });
  assert.equal(n2Multi.nivel, NIVEL_COMPLEJIDAD.RAZONAMIENTO);
  assert.equal(n2Multi.razon, 'multiples_intenciones');
});

test('resolverModeloNivel aplica destierro de Qwen y aplicarSugerenciaCascada respeta modelos explicitos', () => {
  const m1 = resolverModeloNivel(NIVEL_COMPLEJIDAD.RAPIDO, { DAVIS_MODELO_NIVEL1: 'qwen-2.5-7b' });
  assert.equal(m1, MODELO_FALLBACK_ROBUSTO);

  const m2 = resolverModeloNivel(NIVEL_COMPLEJIDAD.RAZONAMIENTO, { DAVIS_MODELO_NIVEL2: 'openai/gpt-oss-120b' });
  assert.equal(m2, 'openai/gpt-oss-120b');

  const p1 = aplicarSugerenciaCascada({ messages: [], options: { temperature: 0.1 } }, { modeloSugerido: 'openai/gpt-oss-120b', numPredictSugerido: 2048 });
  assert.equal(p1.model, 'openai/gpt-oss-120b');
  assert.equal(p1.options.num_predict, 2048);

  const pExplicito = aplicarSugerenciaCascada({ model: 'custom-model', messages: [] }, { modeloSugerido: 'openai/gpt-oss-120b' });
  assert.equal(pExplicito.model, 'custom-model');
});

test('consultarJarvis registra traza.complejidad y escala a Nivel 2 tras error de herramienta', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'davis-cascade-'));
  let rondaLlm = 0;
  const fakeChat = async () => {
    rondaLlm++;
    if (rondaLlm === 1) {
      return {
        message: {
          role: 'assistant',
          content: null,
          tool_calls: [{ id: 'c1', function: { name: 'consultar_clima', arguments: { ubicacion: 'Madrid' } } }]
        }
      };
    }
    return {
      message: { role: 'assistant', content: 'No pude obtener el clima por un error temporal.' }
    };
  };

  const res = await consultarJarvis('que tiempo hace en Madrid', [], {
    chatCompletion: fakeChat,
    chatId: 'cascade-test-chat',
    carpetaTrazas: dir,
    retornarTraza: true,
    topKMemorias: 0,
    habilitarReflexion: false,
    ejecutores: {
      consultar_clima: async () => { throw new Error('timeout upstream'); }
    }
  });

  assert.equal(res.traza.complejidad.nivel, NIVEL_COMPLEJIDAD.RAZONAMIENTO);
  assert.equal(res.traza.complejidad.razon, 'recuperacion_o_ronda_avanzada');

  const recorrido = explicarUltimoRecorrido('cascade-test-chat', { carpetaTrazas: dir });
  assert.match(recorrido, /Nivel cognitivo: razonamiento_profundo/);

  fs.rmSync(dir, { recursive: true, force: true });
});
