/**
 * productSearchService.js - Buscador de productos bajo demanda (alcance
 * aprobado por David, 5 nov 2026: busqueda y verificacion bajo demanda, SIN
 * compras, SIN vigilancia automatica, SIN altas ni APIs de pago).
 *
 * Orquesta adaptadores por fuente (src/services/merchants/). Cada adaptador
 * declara su estado: operativa o config-required (le falta clave/alta).
 * Verificar una oferta es leer la pagina del vendedor ahora (adaptador
 * jsonld); lo que no se puede abrir y leer no se presenta como disponible.
 *
 * Strict Policy: Zero Emojis.
 */
import { verificarOfertaJsonLd } from './merchants/jsonld.js';

/**
 * Fuentes de busqueda declaradas. Ninguna se finja operativa: la busqueda
 * necesita una fuente configurada (API oficial con clave o un comparador
 * aceptado por David); hasta entonces es config-required y lo dice.
 */
const FUENTES_BUSQUEDA = [
  { id: 'api-oficial', nombre: 'API oficial de tienda (Amazon PA-API, eBay Browse...)', estado: 'config-required', motivo: 'necesita alta y clave (DAVIS_*, nunca por chat)' }
];

export function estadoFuentesBusqueda() {
  return FUENTES_BUSQUEDA.map((f) => ({ ...f }));
}

export async function buscarProducto({ consulta } = {}, deps = {}) {
  const q = String(consulta || '').trim();
  if (!q) return { ok: false, error: 'Dime que producto buscar (modelo exacto si lo tienes).' };
  if (typeof deps.buscarEnFuente !== 'function') {
    const fuentes = estadoFuentesBusqueda().map((f) => `- ${f.nombre}: ${f.estado} (${f.motivo})`).join('\n');
    return {
      ok: false,
      configRequired: true,
      error: `La busqueda necesita una fuente configurada. Estado actual:\n${fuentes}\nSi me pasas el enlace de una ficha concreta, SI puedo verificarla ahora (precio y stock leidos de la pagina).`
    };
  }
  const candidatos = await deps.buscarEnFuente(q);
  return { ok: true, candidatos: Array.isArray(candidatos) ? candidatos : [] };
}

export async function verificarOferta({ url } = {}, deps = {}) {
  return verificarOfertaJsonLd(url, deps);
}
