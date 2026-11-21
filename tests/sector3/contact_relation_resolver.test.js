/**
 * contact_relation_resolver.test.js
 *
 * Bateria de pruebas de Resolucion Semantica de Contactos y Parentescos:
 * - Normalizacion canonica de parentescos ("mi madre", "mama", "a mi papa").
 * - Resolucion directa por nombre exacto.
 * - Resolucion por campo 'relacion' en fichas de agenda.
 * - Resolucion mediante Knowledge Graph relacional (tripletas SQLite/memoria).
 * - Resolucion mediante memorias del Second Brain.
 * - Prevencion estricta de falsos positivos (no escribir a Paula al pedir escribir a la madre).
 *
 * Strict Policy: Zero Emojis.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizarTerminoBusqueda,
  resolverContactoInteligente
} from '../../src/services/contactRelationResolver.js';
import {
  buscarContacto,
  registrarStoreContactosPorDefecto
} from '../../src/services/contactsService.js';
import { programarMensaje } from '../../src/services/scheduledMessageService.js';

test('normalizarTerminoBusqueda limpia prefijos y mapea parentescos', () => {
  assert.deepEqual(normalizarTerminoBusqueda('mi madre'), { limpio: 'madre', parentesco: 'madre' });
  assert.deepEqual(normalizarTerminoBusqueda('a mi mama'), { limpio: 'mama', parentesco: 'madre' });
  assert.deepEqual(normalizarTerminoBusqueda('para mi padre'), { limpio: 'padre', parentesco: 'padre' });
  assert.deepEqual(normalizarTerminoBusqueda('mi papa'), { limpio: 'papa', parentesco: 'padre' });
  assert.deepEqual(normalizarTerminoBusqueda('mi hermano'), { limpio: 'hermano', parentesco: 'hermano' });
  assert.deepEqual(normalizarTerminoBusqueda('mi abuelita'), { limpio: 'abuelita', parentesco: 'abuela' });
  assert.deepEqual(normalizarTerminoBusqueda('Paula'), { limpio: 'paula', parentesco: null });
  assert.deepEqual(normalizarTerminoBusqueda('carlos'), { limpio: 'carlos', parentesco: null });
});

test('resolverContactoInteligente resuelve contacto por nombre exacto', () => {
  const mockContactsStore = {
    listar: () => [
      { id: '1', nombre: 'Paula', telefono: '+34600111222', relacion: 'amiga' },
      { id: '2', nombre: 'Carmen', telefono: '+34600333444', relacion: 'madre' }
    ]
  };

  const res = resolverContactoInteligente('Paula', { store: mockContactsStore });
  assert.equal(res.ok, true);
  assert.equal(res.nombre, 'Paula');
  assert.equal(res.telefono, '+34600111222');
  assert.equal(res.origen, 'contacto_nombre_exacto');
});

test('resolverContactoInteligente resuelve parentesco por campo relacion en ficha', () => {
  const mockContactsStore = {
    listar: () => [
      { id: '1', nombre: 'Paula', telefono: '+34600111222', relacion: 'amiga' },
      { id: '2', nombre: 'Carmen', telefono: '+34600333444', relacion: 'madre' }
    ]
  };

  // Al pedir "mi madre", NUNCA debe devolver Paula: debe devolver Carmen
  const resMadre = resolverContactoInteligente('mi madre', { store: mockContactsStore });
  assert.equal(resMadre.ok, true);
  assert.equal(resMadre.nombre, 'Carmen');
  assert.equal(resMadre.telefono, '+34600333444');
  assert.equal(resMadre.origen, 'contacto_campo_relacion');

  // Con "mama" tambien debe resolver a Carmen
  const resMama = resolverContactoInteligente('mama', { store: mockContactsStore });
  assert.equal(resMama.ok, true);
  assert.equal(resMama.nombre, 'Carmen');
  assert.equal(resMama.telefono, '+34600333444');
});

test('resolverContactoInteligente resuelve parentesco mediante Knowledge Graph', () => {
  // En este escenario Carmen NO tiene el campo relacion en su ficha, pero el Knowledge Graph tiene la tripleta
  const mockContactsStore = {
    listar: () => [
      { id: '1', nombre: 'Paula', telefono: '+34600111222' },
      { id: '2', nombre: 'Carmen', telefono: '+34600333444' }
    ]
  };

  const mockKgStore = {
    obtenerGrafo: () => ({
      nodos: {
        usuario: { id: 'usuario', nombre: 'David' },
        carmen: { id: 'carmen', nombre: 'Carmen' }
      },
      aristas: [
        { origen: 'usuario', destino: 'carmen', relacion: 'madre' }
      ]
    })
  };

  const res = resolverContactoInteligente('mi madre', {
    store: mockContactsStore,
    knowledgeGraphStore: mockKgStore
  });

  assert.equal(res.ok, true);
  assert.equal(res.nombre, 'Carmen');
  assert.equal(res.telefono, '+34600333444');
  assert.equal(res.origen, 'knowledge_graph');
});

test('resolverContactoInteligente resuelve parentesco mediante memorias del Second Brain', () => {
  const mockContactsStore = {
    listar: () => [
      { id: '1', nombre: 'Paula', telefono: '+34600111222' },
      { id: '2', nombre: 'Antonio', telefono: '+34600555666' }
    ]
  };

  const mockMemoryStore = {
    leer: () => [
      { sujeto: 'Familia', dato: 'mi padre se llama Antonio y es profesor' }
    ]
  };

  const res = resolverContactoInteligente('mi padre', {
    store: mockContactsStore,
    memoryStore: mockMemoryStore
  });

  assert.equal(res.ok, true);
  assert.equal(res.nombre, 'Antonio');
  assert.equal(res.telefono, '+34600555666');
  assert.equal(res.origen, 'second_brain_memory');
});

test('resolverContactoInteligente no asigna contactos arbitrarios cuando no existe el parentesco', () => {
  const mockContactsStore = {
    listar: () => [
      { id: '1', nombre: 'Paula', telefono: '+34600111222', relacion: 'amiga' }
    ]
  };

  // Si pide escribir a su madre y solo esta Paula guardada, debe fallar honestamente
  const res = resolverContactoInteligente('mi madre', { store: mockContactsStore });
  assert.equal(res.ok, false);
  assert.match(res.error, /No tienes ningun contacto registrado como tu "madre"/);
});

test('buscarContacto resuelve consultas naturales con parentesco', () => {
  const mockContactsStore = {
    buscar: (term) => (term === 'carmen' ? [{ id: '2', nombre: 'Carmen', telefono: '+34600333444' }] : []),
    listar: () => [
      { id: '1', nombre: 'Paula', telefono: '+34600111222', relacion: 'amiga' },
      { id: '2', nombre: 'Carmen', telefono: '+34600333444', relacion: 'madre' }
    ]
  };

  const res = buscarContacto('mi madre', { store: mockContactsStore });
  assert.equal(res.ok, true);
  assert.equal(res.contactos.length, 1);
  assert.equal(res.contactos[0].nombre, 'Carmen');
});

test('programarMensaje resuelve destinatario por parentesco de forma segura', () => {
  const mockContactsStore = {
    listar: () => [
      { id: '1', nombre: 'Paula', telefono: '+34600111222', relacion: 'amiga' },
      { id: '2', nombre: 'Carmen', telefono: '+34600333444', relacion: 'madre' }
    ]
  };

  registrarStoreContactosPorDefecto(mockContactsStore);

  const res = programarMensaje({
    numero: 'mi madre',
    mensaje: 'Hola mama, ya voy de camino a casa',
    inmediato: true
  });

  assert.equal(res.ok, true);
  assert.equal(res.programado.numero, '34600333444');
  assert.equal(res.inmediato, true);

  // Limpiar
  registrarStoreContactosPorDefecto(null);
});
