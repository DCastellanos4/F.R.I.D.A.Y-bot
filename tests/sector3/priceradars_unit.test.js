/**
 * priceradars_unit.test.js
 * Pruebas unitarias del adaptador PriceRadars (comparador gratuito sin alta):
 * mapeo de centimos a EUR, comercio desde deeplink, sin resultados honesto
 * y errores HTTP honestos. Fetch siempre inyectado.
 *
 * Strict Policy: Zero Emojis.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crearAdaptadorPriceRadars, AVISO_PRICERADARS } from '../../src/services/merchants/priceradars.js';
import { buscarProducto } from '../../src/services/productSearchService.js';

const JSON_BUSQUEDA = JSON.stringify({
  products: [{
    id: 'abc', slug: 'abc--auriculares-x', name: 'Auriculares X', brand: 'MarcaX',
    lowestPrice: 3299, currency: 'EUR', inStock: true, condition: 'NEW', offerCount: 2,
    merchantName: '', deeplink: 'https://es.tienda.example/item/123'
  }],
  totalCount: 42, brands: [], priceRange: { min: 100, max: 9900 }
});

test('mapea productos: centimos a EUR, comercio desde deeplink, ficha del comparador', async () => {
  let urlPedida = null;
  const adaptador = crearAdaptadorPriceRadars({
    fetchFn: async (url) => { urlPedida = url; return { ok: true, text: async () => JSON_BUSQUEDA }; }
  });
  const r = await adaptador('auriculares x');
  assert.match(urlPedida, /country=es&locale=es/);
  assert.equal(r.totalResultados, 42);
  assert.equal(r.candidatos.length, 1);
  const c = r.candidatos[0];
  assert.equal(c.precio, 32.99, 'centimos a EUR');
  assert.equal(c.moneda, 'EUR');
  assert.equal(c.enStock, true);
  assert.equal(c.comercio, 'es.tienda.example', 'sin merchantName usa el dominio del deeplink');
  assert.equal(c.enlace, 'https://es.tienda.example/item/123');
  assert.equal(c.fichaComparador, 'https://priceradars.com/en/es/product/abc--auriculares-x');
});

test('sin resultados: lista vacia honesta, cero inventado', async () => {
  const adaptador = crearAdaptadorPriceRadars({
    fetchFn: async () => ({ ok: true, text: async () => '{"products":[],"totalCount":0}' })
  });
  const r = await adaptador('producto inexistente xyz');
  assert.deepEqual(r.candidatos, []);
  assert.equal(r.totalResultados, 0);
});

test('servicio: fuente por defecto es priceradars y propaga aviso; error HTTP es honesto', async () => {
  const okRes = await buscarProducto({ consulta: 'auriculares x' }, {
    fetchFn: async () => ({ ok: true, text: async () => JSON_BUSQUEDA })
  });
  assert.equal(okRes.ok, true);
  assert.equal(okRes.fuente, 'priceradars');
  assert.equal(okRes.candidatos.length, 1);
  assert.equal(okRes.aviso, AVISO_PRICERADARS);

  const fallo = await buscarProducto({ consulta: 'x' }, {
    fetchFn: async () => ({ ok: false, status: 503 })
  });
  assert.equal(fallo.ok, false);
  assert.match(fallo.error, /503/);
});
