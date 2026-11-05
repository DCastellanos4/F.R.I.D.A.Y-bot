/**
 * viajes_unit.test.js
 * Unitaria del bloque 15 (vuelos/trenes, nº 28). Sin fuente en vivo:
 * el proveedor siempre se inyecta; sin el, config-required honesto.
 *
 * Strict Policy: Zero Emojis.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'os';
import {
  vigilarRuta, listarRutasVigiladas, cancelarVigilanciaRuta, registrarPrecioRuta,
  comprobarRutasProgramado, iniciarMonitorViajes, detenerMonitorViajes
} from '../../src/services/viajesService.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'davis-viajes-unit-'));
const rutaArchivo = path.join(tmp, 'viajes.json');

test('nº28 vigilar: valida tipo/origen/destino/fecha, evita duplicados y declara fuente config-required', () => {
  assert.match(vigilarRuta({ tipo: 'avion', origen: 'a', destino: 'b', fecha: '2026-12-12' }, { rutaArchivo }).error, /vuelo o tren/);
  assert.match(vigilarRuta({ tipo: 'vuelo', origen: 'madrid', destino: 'madrid', fecha: '2026-12-12' }, { rutaArchivo }).error, /mismo sitio/);
  assert.match(vigilarRuta({ tipo: 'vuelo', origen: 'madrid', destino: 'lisboa', fecha: '12 de diciembre' }, { rutaArchivo }).error, /AAAA-MM-DD/);

  const r = vigilarRuta({ tipo: 'vuelo', origen: '  Madrid ', destino: 'Lisboa', fecha: '2026-12-12', precioObjetivo: 50 }, { rutaArchivo });
  assert.equal(r.ok, true);
  assert.equal(r.ruta.origen, 'madrid');
  assert.equal(r.ruta.precioObjetivo, 50);
  assert.match(r.nota, /no tengo proveedor de precios en vivo/, 'declara la fuente pendiente');
  assert.match(r.nota, /no inventa|puedes pasarme precios|configurar una fuente/);

  const dup = vigilarRuta({ tipo: 'vuelo', origen: 'MADRID', destino: 'LISBOA', fecha: '2026-12-12' }, { rutaArchivo });
  assert.equal(dup.ok, false);
  assert.match(dup.error, /Ya vigilo/);
});

test('nº28 registro manual: compara con objetivo, detecta minimo y guarda historial', () => {
  const r1 = registrarPrecioRuta({ criterio: 'lisboa', precio: 62 }, { rutaArchivo });
  assert.equal(r1.ok, true);
  assert.equal(r1.baja, true, 'primer precio es minimo');
  assert.equal(r1.bajoObjetivo, false);
  const r2 = registrarPrecioRuta({ criterio: 'lisboa', precio: 45 }, { rutaArchivo });
  assert.equal(r2.baja, true);
  assert.equal(r2.bajoObjetivo, true, '45 <= objetivo 50');
  const r3 = registrarPrecioRuta({ criterio: 'lisboa', precio: 55 }, { rutaArchivo });
  assert.equal(r3.baja, false);
  assert.equal(r3.minimoPrevio, 45);
  const lista = listarRutasVigiladas({ rutaArchivo });
  assert.equal(lista[0].historial.length, 3);
  assert.equal(lista[0].historial[0].fuente, 'manual');
  assert.match(registrarPrecioRuta({ criterio: 'lisboa', precio: -5 }, { rutaArchivo }).error, /precio/);
  assert.match(registrarPrecioRuta({ criterio: 'tokio', precio: 100 }, { rutaArchivo }).error, /No encuentro/);
});

test('nº28 comprobacion programada: sin proveedor es config-required y NO consulta; con proveedor inyectado avisa solo en bajadas', async () => {
  let consultas = 0;
  const sinProveedor = await comprobarRutasProgramado({ rutaArchivo, consultarPrecioRuta: undefined });
  assert.equal(sinProveedor.configRequired, true);
  assert.equal(sinProveedor.avisos, 0);
  assert.match(sinProveedor.motivo, /no consulto nada/i);

  const encoladas = [];
  const consultar = async () => { consultas++; return { precio: 40, fuente: 'fake' }; };
  const r1 = await comprobarRutasProgramado({ rutaArchivo, consultarPrecioRuta: consultar, enqueue: (a) => encoladas.push(a) });
  assert.equal(consultas, 1);
  assert.equal(r1.avisos, 1, '40 < minimo previo 45');
  assert.match(encoladas[0].title, /Bajada/);
  assert.match(encoladas[0].body, /confirma tarifa y condiciones/, 'caveat de frescura/compra');
  const r2 = await comprobarRutasProgramado({ rutaArchivo, consultarPrecioRuta: async () => ({ precio: 60 }), enqueue: (a) => encoladas.push(a) });
  assert.equal(r2.avisos, 0, '60 no es bajada');
  const r3 = await comprobarRutasProgramado({ rutaArchivo, consultarPrecioRuta: async () => { throw new Error('caido'); }, enqueue: (a) => encoladas.push(a) });
  assert.equal(r3.avisos, 0, 'proveedor caido: sin aviso ni crash');
});

test('nº28 cancelar: por criterio textual; monitor arranca/para', async () => {
  const c = cancelarVigilanciaRuta({ criterio: 'lisboa' }, { rutaArchivo });
  assert.equal(c.ok, true);
  assert.equal(c.canceladas, 1);
  assert.equal(listarRutasVigiladas({ rutaArchivo }).length, 0);
  assert.match(cancelarVigilanciaRuta({ criterio: 'lisboa' }, { rutaArchivo }).error, /No encuentro/);

  const r = iniciarMonitorViajes({ intervaloMs: 3600000, rutaArchivo });
  assert.equal(r.iniciado, true);
  assert.match(iniciarMonitorViajes({}).mensaje, /ya estaba/);
  detenerMonitorViajes();
  // sin rutas activas, la comprobacion no toca proveedor
  let consultas = 0;
  const sin = await comprobarRutasProgramado({ rutaArchivo, consultarPrecioRuta: async () => { consultas++; return { precio: 1 }; } });
  assert.equal(sin.avisos, 0);
  assert.equal(consultas, 0, 'sin rutas vigiladas no consulta');
});
