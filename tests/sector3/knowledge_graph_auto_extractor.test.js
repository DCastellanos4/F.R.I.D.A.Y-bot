/**
 * knowledge_graph_auto_extractor.test.js - Pruebas del extractor automatico de grafos post-conversacion
 *
 * Strict Policy: Zero Emojis.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extraerRelacionesDeTexto,
  persistirTripletasEnGrafo,
  procesarTurnoConversacionParaGrafo
} from '../../src/services/knowledgeGraphAutoExtractor.js';
import { abrirBaseDatos } from '../../src/adapters/outbound/persistence/sqlite/connection.js';
import { ejecutarMigraciones } from '../../src/adapters/outbound/persistence/sqlite/migraciones.js';
import { crearSqliteKnowledgeGraphStore } from '../../src/adapters/outbound/persistence/sqlite/sqliteDomainStores.js';

test('KnowledgeGraph AutoExtractor: extrae relaciones de parentesco en espanol', () => {
  const texto = 'Mi madre es Carmen y mi hermano se llama Carlos.';
  const tripletas = extraerRelacionesDeTexto(texto);

  assert.ok(tripletas.length >= 2, 'debe extraer al menos dos relaciones');
  const relMadre = tripletas.find((t) => t.relacion === 'madre');
  assert.ok(relMadre, 'debe identificar relacion de madre');
  assert.equal(relMadre.destino.nombre, 'Carmen');

  const relHermano = tripletas.find((t) => t.relacion === 'hermano');
  assert.ok(relHermano, 'debe identificar relacion de hermano');
  assert.equal(relHermano.destino.nombre, 'Carlos');
});

test('KnowledgeGraph AutoExtractor: extrae profesiones y empleo', () => {
  const texto = 'David trabaja en Google y Ana es medica en el hospital.';
  const tripletas = extraerRelacionesDeTexto(texto);

  const relGoogle = tripletas.find((t) => t.relacion === 'trabaja_en');
  assert.ok(relGoogle, 'debe extraer trabaja_en');
  assert.equal(relGoogle.origen.nombre, 'David');
  assert.equal(relGoogle.destino.nombre, 'Google');
  assert.equal(relGoogle.destino.tipo, 'organizacion');
});

test('KnowledgeGraph AutoExtractor: extrae residencia y viajes', () => {
  const texto = 'David vive en Madrid y manana viaja a Paris.';
  const tripletas = extraerRelacionesDeTexto(texto);

  const relVive = tripletas.find((t) => t.relacion === 'vive_en');
  assert.ok(relVive, 'debe extraer vive_en');
  assert.equal(relVive.origen.nombre, 'David');
  assert.equal(relVive.destino.nombre, 'Madrid');
  assert.equal(relVive.destino.tipo, 'lugar');

  const relViaja = tripletas.find((t) => t.relacion === 'viaja_a');
  assert.ok(relViaja, 'debe extraer viaja_a');
  assert.equal(relViaja.destino.nombre, 'Paris');
});

test('KnowledgeGraph AutoExtractor: persiste tripletas en SQLite con aislamiento multi-tenant', () => {
  const db = abrirBaseDatos(':memory:');
  ejecutarMigraciones(db);
  const store = crearSqliteKnowledgeGraphStore(db);

  const tripletas = [
    {
      origen: { id: 'david', nombre: 'David', tipo: 'persona' },
      relacion: 'amigo_de',
      destino: { id: 'pedro', nombre: 'Pedro', tipo: 'persona' },
      peso: 1.0,
      metadata: {}
    }
  ];

  // Guardar en tenant A
  const guardadasA = persistirTripletasEnGrafo(tripletas, { store, tenantId: 'tenant-a' });
  assert.equal(guardadasA, 1);

  // Verificar que tenant A lo ve
  const grafoA = store.obtenerGrafo('tenant-a');
  assert.ok(grafoA.nodos.david, 'tenant A debe tener nodo david');
  assert.ok(grafoA.nodos.pedro, 'tenant A debe tener nodo pedro');
  assert.equal(grafoA.aristas.length, 1);

  // Verificar que tenant B NO lo ve (aislamiento fail-closed)
  const grafoB = store.obtenerGrafo('tenant-b');
  assert.equal(Object.keys(grafoB.nodos).length, 0, 'tenant B no debe ver datos de tenant A');
  assert.equal(grafoB.aristas.length, 0);

  db.close();
});

test('KnowledgeGraph AutoExtractor: procesa turno conversacional y actualiza grafo', async () => {
  const db = abrirBaseDatos(':memory:');
  ejecutarMigraciones(db);
  const store = crearSqliteKnowledgeGraphStore(db);

  const textoUsuario = 'Mi amigo Carlos vive en Sevilla';
  const respuestaAsistente = 'Entendido, he registrado que Carlos vive en Sevilla.';

  const resultado = await procesarTurnoConversacionParaGrafo(textoUsuario, respuestaAsistente, {
    store,
    tenantId: 'propietario'
  });

  assert.equal(resultado.ok, true);
  assert.ok(resultado.guardadas >= 1);

  const grafo = store.obtenerGrafo('propietario');
  assert.ok(grafo.nodos.carlos);
  assert.ok(grafo.nodos.sevilla);
  assert.equal(grafo.nodos.sevilla.tipo, 'lugar');

  db.close();
});
