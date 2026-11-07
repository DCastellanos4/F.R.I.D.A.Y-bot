import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import {
  cargarGrafo,
  guardarGrafo,
  agregarNodo,
  agregarArista,
  extraerEntidadesDeTexto,
  buscarVecindadGrafo,
  obtenerContextoGrafo
} from '../../src/services/graphMemoryService.js';

describe('Graph Memory & Entity Linking Tests', () => {
  const tmpDir = path.join(process.cwd(), 'tests', 'fixtures', 'graph_test');
  const rutaArchivo = path.join(tmpDir, 'knowledge_graph.json');
  const deps = { rutaArchivo };

  beforeEach(() => {
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
    fs.mkdirSync(tmpDir, { recursive: true });
  });

  it('debe inicializar y persistir un grafo vacio', () => {
    const grafo = cargarGrafo(deps);
    assert.deepStrictEqual(grafo.nodos, {});
    assert.deepStrictEqual(grafo.aristas, []);
    guardarGrafo(grafo, deps);
    assert.ok(fs.existsSync(rutaArchivo));
  });

  it('debe agregar nodos y aristas dirigidas entre entidades', () => {
    const grafo = cargarGrafo(deps);
    agregarNodo(grafo, { id: 'mama', nombre: 'Mama', tipo: 'persona' });
    agregarNodo(grafo, { id: 'cumpleanos', nombre: 'Cumpleanos', tipo: 'fecha' });
    agregarArista(grafo, {
      origen: 'mama',
      destino: 'cumpleanos',
      relacion: 'tiene_evento'
    });

    guardarGrafo(grafo, deps);

    const reloaded = cargarGrafo(deps);
    assert.ok(reloaded.nodos.mama);
    assert.ok(reloaded.nodos.cumpleanos);
    assert.strictEqual(reloaded.aristas.length, 1);
    assert.strictEqual(reloaded.aristas[0].relacion, 'tiene_evento');
  });

  it('debe extraer entidades clave de texto en espanol', () => {
    const texto = 'Ayer compre con David un billete de 25 euros en Atocha';
    const entidades = extraerEntidadesDeTexto(texto);
    const nombres = entidades.map((e) => e.nombre);
    assert.ok(nombres.includes('david'));
    assert.ok(nombres.includes('atocha'));
    assert.ok(nombres.includes('ayer'));
    assert.ok(entidades.some((e) => e.tipo === 'gasto'));
  });

  it('debe resolver vecindades y generar contexto relacional para el prompt', () => {
    const grafo = cargarGrafo(deps);
    agregarNodo(grafo, { id: 'mama', nombre: 'Mama', tipo: 'persona' });
    agregarNodo(grafo, { id: 'regalo_30_eur', nombre: 'Regalo 30 EUR', tipo: 'gasto' });
    agregarArista(grafo, {
      origen: 'mama',
      destino: 'regalo_30_eur',
      relacion: 'destinataria_de'
    });
    guardarGrafo(grafo, deps);

    const contexto = obtenerContextoGrafo('compre algo para mama', deps);
    assert.ok(contexto.includes('Mama'));
    assert.ok(contexto.includes('destinataria_de'));
    assert.ok(contexto.includes('Regalo 30 EUR'));
  });
});
