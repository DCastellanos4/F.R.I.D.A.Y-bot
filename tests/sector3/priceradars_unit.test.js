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
import { crearAdaptadorPriceRadars, AVISO_PRICERADARS, clasificarCandidato } from '../../src/services/merchants/priceradars.js';
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
  assert.equal(c.stockSegun, 'feed del comparador, sin reconfirmar con el comercio', 'el stock no se declara fresco del comercio');
});

test('filtro accesorio/variante: una funda "para iphone 16" no se presenta como el iPhone 16', async () => {
  // Regresion dirigida: si se quita MARCAS_ACCESORIO o el filtro, esta prueba falla.
  const json = JSON.stringify({ products: [
    { id: 'f1', slug: 'f1--funda-para-iphone-16', name: 'Funda de silicona para iPhone 16', brand: 'Generica', lowestPrice: 499, currency: 'EUR', inStock: true, offerCount: 1, merchantName: 'AliExpress', deeplink: 'https://es.aliexpress.example/item/1' },
    { id: 'p1', slug: 'p1--iphone-16', name: 'Apple iPhone 16 128GB negro', brand: 'Apple', lowestPrice: 85900, currency: 'EUR', inStock: true, offerCount: 3, merchantName: 'MediaMarkt', deeplink: 'https://tienda.example/iphone16' }
  ], totalCount: 2 });
  const adaptador = crearAdaptadorPriceRadars({ fetchFn: async () => ({ ok: true, text: async () => json }) });
  const r = await adaptador('iphone 16');
  assert.equal(r.candidatos.length, 1, 'solo queda el producto');
  assert.equal(r.candidatos[0].nombre, 'Apple iPhone 16 128GB negro');
  assert.equal(r.accesoriosOmitidos, 1, 'la funda se aparta, no se presenta como el telefono');
  // Pero si David PIDE una funda, el accesorio si es el producto buscado:
  const r2 = await adaptador('funda iphone 16');
  assert.equal(r2.candidatos.length, 2, 'pidiendo funda no se filtra');
});

test('variante distinta se marca; sin vinculo se descarta', () => {
  assert.equal(clasificarCandidato('iphone 16', 'Apple iPhone 16 Pro Max').variante, 'distinta');
  assert.equal(clasificarCandidato('iphone 16 pro', 'Apple iPhone 16 Pro 256GB').variante, 'misma');
  assert.equal(clasificarCandidato('iphone 16', 'Cargador rapido USB-C 20W').tipo, 'accesorio');
  assert.equal(clasificarCandidato('iphone 16', 'Lavadora frontal 8kg').tipo, 'sin-vinculo');
});

test('el aviso declara la frescura real: feed sin fecha por oferta, stock no reconfirmado', () => {
  assert.match(AVISO_PRICERADARS, /no trae fecha de refresco por oferta/);
  assert.match(AVISO_PRICERADARS, /NO el del comercio ahora mismo/);
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
