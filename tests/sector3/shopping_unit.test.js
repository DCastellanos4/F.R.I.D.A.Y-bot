/**
 * shopping_unit.test.js
 * Pruebas unitarias del buscador de productos (alcance: bajo demanda, sin
 * compras ni vigilancia). El cableado de entrada va en su propio archivo
 * cuando se complete el bloque.
 *
 * Strict Policy: Zero Emojis.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verificarOfertaJsonLd } from '../../src/services/merchants/jsonld.js';
import { buscarProducto, estadoFuentesBusqueda } from '../../src/services/productSearchService.js';

const FICHA_HTML = `<html><head><script type="application/ld+json">
{"@context":"https://schema.org","@type":"Product","name":"Bolsa X","offers":{"@type":"Offer","price":"59.95","priceCurrency":"EUR","availability":"https://schema.org/InStock"}}
</script></head><body>ficha</body></html>`;

test('verificar: lee precio y stock reales del JSON-LD y declara la hora', async () => {
  const fetchFalso = async () => ({ ok: true, text: async () => FICHA_HTML });
  const r = await verificarOfertaJsonLd('https://tienda.example/p/1', { fetchFn: fetchFalso, ahora: '2026-11-05T15:00:00+01:00' });
  assert.equal(r.ok, true);
  assert.equal(r.precio, 59.95);
  assert.equal(r.moneda, 'EUR');
  assert.equal(r.disponible, true);
  assert.equal(r.comprobadoEn, '2026-11-05T14:00:00.000Z');
});

test('verificar: sin JSON-LD o sin precio es no-verificable, nunca inventado', async () => {
  const sinLd = await verificarOfertaJsonLd('https://tienda.example/p/2', { fetchFn: async () => ({ ok: true, text: async () => '<html></html>' }) });
  assert.equal(sinLd.ok, false);
  assert.equal(sinLd.noVerificable, true);
  const sinPrecio = await verificarOfertaJsonLd('https://tienda.example/p/3', { fetchFn: async () => ({ ok: true, text: async () => '<script type="application/ld+json">{"@type":"Product","name":"X"}</script>' }) });
  assert.equal(sinPrecio.ok, false, 'sin precio legible no se confirma');
  const caida = await verificarOfertaJsonLd('https://tienda.example/p/4', { fetchFn: async () => ({ ok: false, status: 403 }) });
  assert.match(caida.error, /403/);
});

test('verificar: agotado se lee como no disponible', async () => {
  const html = FICHA_HTML.replace('InStock', 'OutOfStock');
  const r = await verificarOfertaJsonLd('https://tienda.example/p/5', { fetchFn: async () => ({ ok: true, text: async () => html }) });
  assert.equal(r.disponible, false);
});

test('buscar: sin fuente configurada es config-required y lo dice, sin simular resultados', async () => {
  const r = await buscarProducto({ consulta: 'bolsa stussy' });
  assert.equal(r.ok, false);
  assert.equal(r.configRequired, true);
  assert.match(r.error, /config-required|fuente configurada/);
  assert.ok(estadoFuentesBusqueda().every((f) => f.estado === 'config-required'));
  const vacia = await buscarProducto({ consulta: '  ' });
  assert.equal(vacia.ok, false);
});
