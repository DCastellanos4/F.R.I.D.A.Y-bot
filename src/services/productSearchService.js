/**
 * productSearchService.js - Buscador de productos bajo demanda (alcance
 * aprobado por David, 5 nov 2026: busqueda y verificacion bajo demanda, SIN
 * compras, SIN vigilancia automatica, SIN altas ni APIs de pago).
 *
 * Fuente por defecto: PriceRadars (comparador gratuito sin alta ni clave,
 * integrado y verificado en vivo). DAVIS_COMPRAS_FUENTE puede elegir otra:
 * las APIs oficiales quedan config-required hasta su alta (nunca por chat).
 *
 * Verificar una oferta es leer la pagina del vendedor ahora (adaptador
 * jsonld, con vinculacion producto-oferta, moneda validada y apertura
 * anti-SSRF); lo que no se puede abrir y leer no se presenta como
 * disponible.
 *
 * Strict Policy: Zero Emojis.
 */
import { verificarOfertaJsonLd } from './merchants/jsonld.js';
import { crearAdaptadorPriceRadars, AVISO_PRICERADARS } from './merchants/priceradars.js';

const FUENTES_BUSQUEDA = [
  { id: 'priceradars', nombre: 'PriceRadars (comparador gratuito, sin alta ni clave; cobertura desigual: electronica y electrodomesticos, ES)', estado: 'operativa' },
  { id: 'ebay', nombre: 'eBay Browse API (oficial, nivel gratuito ~5.000 llamadas/dia)', estado: 'config-required', motivo: 'necesita alta gratuita en developer.ebay.com y clave (DAVIS_*, nunca por chat)' },
  { id: 'amazon', nombre: 'Amazon Creators/PA-API (oficial)', estado: 'config-required', motivo: 'necesita cuenta de Amazon Associates aprobada y clave (DAVIS_*, nunca por chat)' }
];

export function estadoFuentesBusqueda() {
  return FUENTES_BUSQUEDA.map((f) => ({ ...f }));
}

function resolverFuente(deps, env) {
  if (typeof deps.buscarEnFuente === 'function') return { id: 'personalizada', buscar: deps.buscarEnFuente };
  const elegida = String((env && env.DAVIS_COMPRAS_FUENTE) || 'priceradars').toLowerCase().trim();
  if (elegida === 'priceradars') return { id: 'priceradars', buscar: crearAdaptadorPriceRadars(deps) };
  const f = FUENTES_BUSQUEDA.find((x) => x.id === elegida);
  return { id: elegida, buscar: null, fuente: f };
}

export async function buscarProducto({ consulta } = {}, deps = {}) {
  const q = String(consulta || '').trim();
  if (!q) return { ok: false, error: 'Dime que producto buscar (modelo exacto si lo tienes).' };
  const r = resolverFuente(deps, deps.env || process.env);
  if (!r.buscar) {
    const f = r.fuente || { nombre: r.id, motivo: 'fuente desconocida' };
    return {
      ok: false,
      configRequired: true,
      error: `La fuente elegida (${f.nombre}) es config-required: ${f.motivo}. Mientras tanto puedo buscar con PriceRadars (sin alta, es la fuente por defecto: DAVIS_COMPRAS_FUENTE=priceradars) o verificar el enlace exacto de una ficha.`
    };
  }
  try {
    const res = await r.buscar(q);
    const candidatos = Array.isArray(res) ? res : (res && Array.isArray(res.candidatos) ? res.candidatos : []);
    return {
      ok: true,
      fuente: r.id,
      candidatos,
      totalResultados: Number.isFinite(res && res.totalResultados) ? res.totalResultados : candidatos.length,
      aviso: r.id === 'priceradars' ? AVISO_PRICERADARS : undefined
    };
  } catch (err) {
    return { ok: false, error: `La fuente ${r.id} no ha respondido: ${err.message}` };
  }
}

export async function verificarOferta({ url, producto, monedaEsperada } = {}, deps = {}) {
  return verificarOfertaJsonLd(url, { producto, monedaEsperada }, deps);
}
