/**
 * memory_escritura_fallida.test.js - Fallo de escritura en memoria.
 *
 * Antes del arreglo, guardarMemorias tragaba cualquier error de
 * escritura (p.ej. "database is locked" tras agotar busy_timeout) y el
 * servicio respondia ok:true con el log "[Memoria Guardada]" sin haber
 * persistido nada. Estas pruebas fijan el comportamiento correcto:
 *
 * 1. guardarMemoria devuelve ok:false y NO registra exito si el store
 *    falla, tanto en alta nueva como en actualizacion de hecho.
 * 2. olvidarMemoria devuelve ok:false si el borrado no persiste, en
 *    borrado individual y en vaciado total confirmado.
 * 3. El backend JSON historico se comporta igual (ruta no escribible).
 * 4. El camino feliz sigue intacto: ok:true y log de exito.
 *
 * Strict Policy: Zero Emojis.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  guardarMemoria,
  olvidarMemoria,
  listarMemorias
} from '../../src/services/memoryService.js';

function capturarConsola() {
  const logs = [];
  const errores = [];
  const originalLog = console.log;
  const originalError = console.error;
  console.log = (...args) => logs.push(args.map(String).join(' '));
  console.error = (...args) => errores.push(args.map(String).join(' '));
  return {
    logs,
    errores,
    restaurar() {
      console.log = originalLog;
      console.error = originalError;
    }
  };
}

function storeQueFalla() {
  return {
    leer: () => [],
    guardar: () => { throw new Error('database is locked'); }
  };
}

const MEMORIA_PREVIA = {
  id: 'mem_previa',
  sujeto: 'comida favorita',
  dato: 'tortilla',
  categoria: 'personal',
  tags: ['comida', 'favorita', 'tortilla'],
  fechaRegistro: '2026-01-01T00:00:00.000Z'
};

test('guardarMemoria: si el store falla devuelve ok:false y no canta exito', () => {
  const consola = capturarConsola();
  try {
    const r = guardarMemoria({ sujeto: 'talla de pie', dato: 'David calza un 42', store: storeQueFalla() });
    assert.equal(r.ok, false);
    assert.match(r.error, /database is locked/);
    assert.equal(consola.logs.some((l) => l.includes('[Memoria Guardada]')), false);
    assert.equal(consola.errores.some((e) => e.includes('Error guardando memorias')), true);
  } finally {
    consola.restaurar();
  }
});

test('guardarMemoria: una actualizacion que no persiste devuelve ok:false', () => {
  const consola = capturarConsola();
  const store = {
    leer: () => [{ ...MEMORIA_PREVIA }],
    guardar: () => { throw new Error('database is locked'); }
  };
  try {
    const r = guardarMemoria({ sujeto: 'comida favorita', dato: 'tortilla de patatas', categoria: 'personal', store });
    assert.equal(r.ok, false);
    assert.match(r.error, /database is locked/);
    assert.equal(consola.logs.some((l) => l.includes('[Memoria Actualizada]')), false);
  } finally {
    consola.restaurar();
  }
});

test('olvidarMemoria: borrado individual que no persiste devuelve ok:false', () => {
  const consola = capturarConsola();
  const store = {
    leer: () => [{ ...MEMORIA_PREVIA }],
    guardar: () => { throw new Error('database is locked'); }
  };
  try {
    const r = olvidarMemoria('comida favorita', { store });
    assert.equal(r.ok, false);
    assert.match(r.error, /database is locked/);
    assert.equal(consola.logs.some((l) => l.includes('[Memoria Olvidada]')), false);
  } finally {
    consola.restaurar();
  }
});

test('olvidarMemoria: vaciado total confirmado que no persiste devuelve ok:false', () => {
  const consola = capturarConsola();
  const store = {
    leer: () => [{ ...MEMORIA_PREVIA }],
    guardar: () => { throw new Error('database is locked'); }
  };
  try {
    const r = olvidarMemoria('todo', { store, confirmado: true });
    assert.equal(r.ok, false);
    assert.match(r.error, /database is locked/);
    assert.equal(consola.logs.some((l) => l.includes('[Memoria Vaciada]')), false);
  } finally {
    consola.restaurar();
  }
});

test('backend JSON: una ruta no escribible devuelve ok:false y no canta exito', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mem-fallo-json-'));
  const bloqueo = path.join(dir, 'soy-un-fichero');
  fs.writeFileSync(bloqueo, 'x');
  const rutaImposible = path.join(bloqueo, 'memoria.json');
  const consola = capturarConsola();
  try {
    const r = guardarMemoria({ sujeto: 'nota de prueba', dato: 'contenido', rutaArchivo: rutaImposible });
    assert.equal(r.ok, false);
    assert.match(r.error, /No se pudo guardar la memoria/);
    assert.equal(consola.logs.some((l) => l.includes('[Memoria Guardada]')), false);
  } finally {
    consola.restaurar();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('camino feliz intacto: escritura correcta devuelve ok:true y canta exito', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mem-ok-'));
  const ruta = path.join(dir, 'memoria.json');
  const consola = capturarConsola();
  try {
    const r = guardarMemoria({ sujeto: 'nota de prueba', dato: 'contenido', rutaArchivo: ruta });
    assert.equal(r.ok, true);
    assert.equal(r.accion, 'creada');
    assert.equal(consola.logs.some((l) => l.includes('[Memoria Guardada]')), true);
    assert.equal(listarMemorias(null, { rutaArchivo: ruta }).length, 1);
  } finally {
    consola.restaurar();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
