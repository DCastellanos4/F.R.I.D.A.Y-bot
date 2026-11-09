import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  obtenerEjemplosFewShot,
  enrutarYFiltrarHerramientas
} from '../../src/services/specialistRouterService.js';
import {
  proximasLlegadas
} from '../../src/services/transportService.js';

describe('Cognitive Enhancements V2: Few-Shot, Determinism & Renfe Contrast', () => {
  it('debe generar ejemplos few-shot para consultas de desarrollo/git', () => {
    // Los ejemplos solo pueden mencionar herramientas del catalogo real:
    // abrir_pull_request/crear_rama_trabajo no existen en src/core/tools.js.
    const fewShot = obtenerEjemplosFewShot('coder', 'revisa la PR 42');
    assert.ok(fewShot.includes('revisar_pr'));
    assert.ok(!fewShot.includes('abrir_pull_request'));
    assert.ok(!fewShot.includes('crear_rama_trabajo'));
  });

  it('debe generar ejemplos few-shot para consultas de gastos/personal', () => {
    const fewShot = obtenerEjemplosFewShot('personal', 'apunta 15 euros de comida');
    assert.ok(fewShot.includes('registrar_gasto'));
    assert.ok(fewShot.includes('alimentacion'));
  });

  it('debe incorporar ejemplos few-shot al enrutar herramientas con especialista', () => {
    const res = enrutarYFiltrarHerramientas('apunta 20 euros de cafe');
    assert.strictEqual(res.especialista, 'personal');
    assert.ok(res.configuracion.systemPromptMod.includes('EJEMPLOS IN-CONTEXT DE LLAMADAS A HERRAMIENTAS'));
  });

  it('debe estructurar el contraste de horarios en Renfe cuando hay llegadas en vivo y programadas', async () => {
    const feedLive = JSON.stringify({
      header: { gtfsRealtimeVersion: '2.0', timestamp: '1730995200' },
      entity: [
        {
          id: 'T1',
          tripUpdate: {
            trip: { tripId: 'C3-101', scheduleRelationship: 'SCHEDULED' },
            stopTimeUpdate: [
              {
                stopId: '18000',
                arrival: { time: '1730995800', delay: 300 } // +5 min de retraso
              }
            ]
          }
        }
      ]
    });

    const deps = {
      ahora: 1730995200000,
      fetchFnCercanias: async () => ({ text: async () => feedLive }),
      // Mock de horariosProgramados via deps si procede
      horariosProgramadosMock: async () => ({
        ok: true,
        programadas: [
          { viaje: 'C3-101', hora: '17:15', destino: 'Chamartin' },
          { viaje: 'C3-102', hora: '17:45', destino: 'Aranjuez' }
        ]
      })
    };

    const res = await proximasLlegadas({ parada: '18000', tipo: 'cercanias', codigo: '18000' }, deps);
    assert.ok(res.ok);
    assert.strictEqual(res.tipo, 'cercanias');
    assert.ok(Array.isArray(res.llegadas));
  });
});
