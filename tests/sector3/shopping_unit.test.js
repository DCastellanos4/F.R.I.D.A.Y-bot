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
  const r = await verificarOfertaJsonLd('https://tienda.example/p/1', {}, { fetchFn: fetchFalso, ahora: '2026-11-05T15:00:00+01:00' });
  assert.equal(r.ok, true);
  assert.equal(r.precio, 59.95);
  assert.equal(r.moneda, 'EUR');
  assert.equal(r.disponible, true);
  assert.equal(r.comprobadoEn, '2026-11-05T14:00:00.000Z');
});

test('verificar: sin JSON-LD o sin precio es no-verificable, nunca inventado', async () => {
  const sinLd = await verificarOfertaJsonLd('https://tienda.example/p/2', {}, { fetchFn: async () => ({ ok: true, text: async () => '<html></html>' }) });
  assert.equal(sinLd.ok, false);
  assert.equal(sinLd.noVerificable, true);
  const sinPrecio = await verificarOfertaJsonLd('https://tienda.example/p/3', {}, { fetchFn: async () => ({ ok: true, text: async () => '<script type="application/ld+json">{"@type":"Product","name":"X"}</script>' }) });
  assert.equal(sinPrecio.ok, false, 'sin precio legible no se confirma');
  const caida = await verificarOfertaJsonLd('https://tienda.example/p/4', {}, { fetchFn: async () => ({ ok: false, status: 403 }) });
  assert.match(caida.error, /403/);
});

test('verificar: agotado se lee como no disponible', async () => {
  const html = FICHA_HTML.replace('InStock', 'OutOfStock');
  const r = await verificarOfertaJsonLd('https://tienda.example/p/5', {}, { fetchFn: async () => ({ ok: true, text: async () => html }) });
  assert.equal(r.disponible, false);
});

test('buscar: fuente elegida sin configurar es config-required y lo dice, sin simular resultados', async () => {
  const entorno = { DAVIS_COMPRAS_FUENTE: 'ebay' };
  const r = await buscarProducto({ consulta: 'bolsa stussy' }, { env: entorno });
  assert.equal(r.ok, false);
  assert.equal(r.configRequired, true);
  assert.match(r.error, /config-required/);
  const fuentes = estadoFuentesBusqueda();
  assert.equal(fuentes.find((f) => f.id === 'priceradars').estado, 'operativa', 'el comparador integrado es la fuente por defecto');
  assert.equal(fuentes.find((f) => f.id === 'ebay').estado, 'config-required');
  assert.equal(fuentes.find((f) => f.id === 'amazon').estado, 'config-required');
  const vacia = await buscarProducto({ consulta: '  ' });
  assert.equal(vacia.ok, false);
});

test('verificar: vincula la oferta al producto pedido; si la pagina es de otra cosa, el precio no se confirma', async () => {
  const ficha = (nombre) => `<script type="application/ld+json">{"@type":"Product","name":"${nombre}","brand":{"name":"Stussy"},"offers":{"price":"59.95","priceCurrency":"EUR","availability":"https://schema.org/InStock"}}</script>`;
  const coincide = await verificarOfertaJsonLd('https://tienda.example/p/1', { producto: 'bolsa stussy tri harness' }, { fetchFn: async () => ({ ok: true, text: async () => ficha('Bolsa Stussy Tri Harness negra') }) });
  assert.equal(coincide.ok, true);
  assert.equal(coincide.vinculacion.estado, 'alta');
  assert.equal(coincide.precioConfirmado, true);

  const otraCosa = await verificarOfertaJsonLd('https://tienda.example/p/2', { producto: 'bolsa stussy tri harness' }, { fetchFn: async () => ({ ok: true, text: async () => ficha('Funda de movil generica transparente') }) });
  assert.equal(otraCosa.ok, true, 'la pagina se lee...');
  assert.equal(otraCosa.vinculacion.estado, 'ninguna', '...pero no es el producto pedido');
  assert.equal(otraCosa.precioConfirmado, false, 'el precio NO se presenta como el del producto solicitado');
  assert.ok(otraCosa.advertencias.some((a) => /no del producto pedido/i.test(a)));

  const parcial = await verificarOfertaJsonLd('https://tienda.example/p/3', { producto: 'bolsa stussy tri harness negra' }, { fetchFn: async () => ({ ok: true, text: async () => ficha('Bolsa Stussy verde') }) });
  assert.equal(parcial.vinculacion.estado, 'parcial');
  assert.equal(parcial.precioConfirmado, true, 'parcial avisa pero no anula');
  assert.ok(parcial.advertencias.some((a) => /parcialmente/.test(a)));
});

test('verificar: valida la moneda (ISO 4217 y esperada EUR) con advertencias explicitas', async () => {
  const fichaMoneda = (m) => `<script type="application/ld+json">{"@type":"Product","name":"Bolsa X","offers":{"price":"59.95"${m ? `,"priceCurrency":"${m}"` : ''},"availability":"https://schema.org/InStock"}}</script>`;
  const usd = await verificarOfertaJsonLd('https://tienda.example/p/1', {}, { fetchFn: async () => ({ ok: true, text: async () => fichaMoneda('USD') }) });
  assert.equal(usd.moneda, 'USD');
  assert.ok(usd.advertencias.some((a) => /USD, no en EUR/.test(a)));
  const rara = await verificarOfertaJsonLd('https://tienda.example/p/2', {}, { fetchFn: async () => ({ ok: true, text: async () => fichaMoneda('euros') }) });
  assert.ok(rara.advertencias.some((a) => /ISO 4217/.test(a)));
  const sinMoneda = await verificarOfertaJsonLd('https://tienda.example/p/3', {}, { fetchFn: async () => ({ ok: true, text: async () => fichaMoneda(null) }) });
  assert.ok(sinMoneda.advertencias.some((a) => /no declara la moneda/.test(a)));
  const eur = await verificarOfertaJsonLd('https://tienda.example/p/4', {}, { fetchFn: async () => ({ ok: true, text: async () => fichaMoneda('EUR') }) });
  assert.deepEqual(eur.advertencias, []);
});
