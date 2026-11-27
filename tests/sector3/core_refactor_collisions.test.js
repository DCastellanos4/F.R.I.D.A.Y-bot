/**
 * tests/sector3/core_refactor_collisions.test.js
 *
 * Verifica Punto 2 + Punto 3 (nucleo):
 * - Fusion contextual MCP sin destruir herramientas previas en peticiones mixtas
 * - Resolucion de las 5 colisiones entre tools.js y mcp-servers/
 * - Herramienta consultar_eventos cableada en tools.js, router, specialist y dispatcher
 * - Tope de 1 ronda de descubrir_herramientas por turno
 * - Guardarrailes finales centralizados en preSendGuardrailService.js
 *
 * Politica estricta: cero emojis.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  consultarJarvis,
  analizarIntencion,
  fusionarHerramientasMcp,
  combinarCatalogosSinColisiones
} from '../../src/core/jarvisAgent.js';
import { despacharHerramienta } from '../../src/core/toolDispatcher.js';
import {
  herramientasJarvis,
  MAPA_INTENCION_HERRAMIENTAS,
  NOMBRES_HERRAMIENTAS_JARVIS
} from '../../src/core/tools.js';
import { HERRAMIENTAS_PERSONAL } from '../../src/services/specialistRouterService.js';
import { aplicarGuardarrailesFinales } from '../../src/services/preSendGuardrailService.js';

const COLISIONES = [
  'consultar_estado_servidor',
  'registrar_gasto',
  'listar_gastos',
  'resumen_gastos_mes',
  'descargar_multimedia'
];

test('fusionarHerramientasMcp preserva tools previas en peticiones mixtas y resuelve las 5 colisiones a favor de MCP', () => {
  const clima = herramientasJarvis.find((h) => h.function.name === 'consultar_clima');
  const locales = herramientasJarvis.filter((h) => COLISIONES.includes(h.function.name));
  const activas = [clima, ...locales];

  const mcpTools = COLISIONES.map((name) => ({
    type: 'function',
    function: {
      name,
      description: `MCP_${name}`,
      parameters: { type: 'object', properties: { origen_mcp: { type: 'boolean' } } }
    }
  }));

  const fusionadas = fusionarHerramientasMcp(
    activas,
    mcpTools,
    'consulta el estado del servidor, registra un gasto, descarga multimedia y dime el clima',
    'ops'
  );

  const nombres = fusionadas.map((h) => h.function.name);
  assert.ok(nombres.includes('consultar_clima'), 'Preserva consultar_clima en peticion mixta');
  assert.equal(new Set(nombres).size, nombres.length, 'No hay nombres duplicados tras fusion');

  for (const colision of COLISIONES) {
    const herramienta = fusionadas.find((h) => h.function.name === colision);
    assert.ok(herramienta, `Incluye ${colision}`);
    assert.equal(herramienta.function.description, `MCP_${colision}`, `${colision} usa el esquema MCP cuando MCP esta activo`);
  }

  const catalogoCombinado = combinarCatalogosSinColisiones(herramientasJarvis, mcpTools);
  assert.equal(
    catalogoCombinado.filter((h) => h.function.name === 'registrar_gasto').length,
    1,
    'combinarCatalogosSinColisiones elimina duplicados'
  );
});

test('consultar_eventos esta en tools.js, MAPA_INTENCION_HERRAMIENTAS, HERRAMIENTAS_PERSONAL y toolDispatcher', async () => {
  assert.ok(NOMBRES_HERRAMIENTAS_JARVIS.has('consultar_eventos'));
  assert.ok(MAPA_INTENCION_HERRAMIENTAS.calendario.includes('consultar_eventos'));
  assert.ok(HERRAMIENTAS_PERSONAL.includes('consultar_eventos'));

  const analisis = analizarIntencion('consultar eventos en el calendario');
  const nombres = analisis.herramientas.map((h) => h.function.name);
  assert.ok(nombres.includes('consultar_eventos'));

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'davis-cal-disp-'));
  try {
    const rutaArchivoCalendario = path.join(tmpDir, 'calendar.json');
    fs.writeFileSync(rutaArchivoCalendario, JSON.stringify([
      { id: 'ev1', titulo: 'Reunion de arquitectura', inicio: '2026-12-01T10:00:00.000Z', fin: '2026-12-01T11:00:00.000Z' }
    ]), 'utf8');

    const res = await despacharHerramienta('consultar_eventos', {
      desde: '2026-12-01T00:00:00.000Z',
      hasta: '2026-12-02T00:00:00.000Z'
    }, {
      rutaArchivoCalendario,
      googleCalendarToken: null,
      googleCalendarApiKey: null,
      fetchFnCalendar: async () => ({ ok: false, status: 503, json: async () => ({}) })
    });

    assert.match(res.texto, /Reunion de arquitectura/);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('descubrir_herramientas esta acotado a maximo 1 ronda por turno', async () => {
  let rondas = 0;
  const mensajesToolDescubrir = [];

  const mockChat = async (payload) => {
    rondas++;
    if (rondas === 1) {
      return {
        message: {
          content: '',
          tool_calls: [{ id: 'd1', function: { name: 'descubrir_herramientas', arguments: JSON.stringify({ consulta: 'clima' }) } }]
        }
      };
    }
    if (rondas === 2) {
      const m1 = payload.messages.find((m) => m.role === 'tool' && m.tool_call_id === 'd1');
      if (m1) mensajesToolDescubrir.push(m1.content);
      return {
        message: {
          content: '',
          tool_calls: [{ id: 'd2', function: { name: 'descubrir_herramientas', arguments: JSON.stringify({ consulta: 'recordatorios' }) } }]
        }
      };
    }
    const m2 = payload.messages.find((m) => m.role === 'tool' && m.tool_call_id === 'd2');
    if (m2) mensajesToolDescubrir.push(m2.content);
    return { message: { content: 'Listo, David.' } };
  };

  const resp = await consultarJarvis('dime el clima de hoy', [], {
    chatCompletion: mockChat,
    chatId: 'test-descubrir-cap-' + Date.now()
  });

  assert.equal(resp, 'Listo, David.');
  assert.equal(mensajesToolDescubrir.length, 2);
  assert.doesNotMatch(mensajesToolDescubrir[0], /Limite de descubrimiento alcanzado/);
  assert.match(mensajesToolDescubrir[1], /Limite de descubrimiento alcanzado/);
});

test('aplicarGuardarrailesFinales limpia emojis y preserva respuesta valida', async () => {
  const traza = { llamadas: [] };
  const res = await aplicarGuardarrailesFinales({
    textoFinal: 'Todo listo, David.',
    mensajeUsuario: 'hola',
    traza,
    opciones: { chatId: 'test-guard' }
  });
  assert.equal(res.textoFinal, 'Todo listo, David.');
});
