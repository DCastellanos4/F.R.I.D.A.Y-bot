/**
 * priceradars.js - Adaptador de busqueda via PriceRadars.
 *
 * Comparador gratuito, SIN alta, SIN clave y SIN coste (API JSON publica de
 * solo lectura, documentada en https://priceradars.com/llms-full.txt y
 * verificada en vivo el 5 nov 2026): cubre Espana y devuelve producto,
 * precio mas bajo, moneda, stock, comercio y enlace al comercio.
 *
 * Limites honestos: la cobertura es desigual (electronica/electrodomesticos;
 * en consultas concretas pueden dominar accesorios de marketplaces) y los
 * precios vienen de feeds que pueden ir desfasados: el precio final manda en
 * la web del comercio. Por eso cada resultado invita a verificar el enlace
 * exacto con verificar_oferta.
 *
 * Precios de la API: en CENTIMOS (199 = 1,99 EUR, verificado contra el
 * deeplink del comercio); aqui se convierten a unidades.
 *
 * Strict Policy: Zero Emojis.
 */
import { fetchSeguro } from '../safeFetch.js';

const BASE = 'https://priceradars.com';

export const AVISO_PRICERADARS = 'Resultados del comparador PriceRadars (gratuito, sin alta): los precios vienen de feeds de tiendas y pueden variar; el precio final manda en la web del comercio. La cobertura es desigual: si no aparece el producto o salen sobre todo accesorios, pasa el enlace exacto de la ficha y lo verifico al momento.';

export function crearAdaptadorPriceRadars(deps = {}) {
  const abrir = deps.fetchFn || ((u) => fetchSeguro(u));
  return async (consulta) => {
    const url = `${BASE}/api/v1/search?q=${encodeURIComponent(consulta)}&country=es&locale=es&limit=8`;
    let resp;
    try {
      resp = await abrir(url);
    } catch (err) {
      throw new Error(`No pude abrir el comparador: ${err.message}`);
    }
    if (!resp.ok) throw new Error(`El comparador respondio ${resp.status}`);
    let data;
    try {
      data = JSON.parse(await resp.text());
    } catch {
      throw new Error('La respuesta del comparador no es legible');
    }
    const productos = Array.isArray(data.products) ? data.products : [];
    const candidatos = productos.map((p) => {
      let dominio = null;
      try { dominio = p.deeplink ? new URL(p.deeplink).hostname : null; } catch { dominio = null; }
      return {
        nombre: p.name || null,
        marca: p.brand || null,
        precio: Number.isFinite(p.lowestPrice) ? p.lowestPrice / 100 : null,
        moneda: p.currency || null,
        enStock: typeof p.inStock === 'boolean' ? p.inStock : null,
        condicion: p.condition || null,
        comercio: p.merchantName || dominio,
        ofertas: Number.isFinite(p.offerCount) ? p.offerCount : null,
        enlace: p.deeplink || null,
        fichaComparador: p.slug ? `${BASE}/en/es/product/${p.slug}` : null
      };
    });
    return {
      candidatos,
      totalResultados: Number.isFinite(data.totalCount) ? data.totalCount : candidatos.length
    };
  };
}
