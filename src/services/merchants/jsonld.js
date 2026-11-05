/**
 * jsonld.js - Adaptador de verificacion por datos estructurados JSON-LD.
 *
 * Verificar una oferta es leer ESA pagina ahora (schema.org/Product con
 * precio y disponibilidad). Reglas duras:
 *   - La URL se abre con safeFetch (anti-SSRF) salvo fetch inyectado en
 *     pruebas.
 *   - Si se indica el producto buscado, la oferta leida se VINCULA a el:
 *     coincidencia alta/parcial/ninguna por nombre, marca, modelo, MPN, SKU y
 *     GTIN. Con vinculacion "ninguna" el precio NO se presenta como el del
 *     producto pedido (precioConfirmado: false): la pagina puede ser de otra
 *     cosa.
 *   - La moneda se valida (ISO 4217) y se advierte si no es la esperada.
 *   - Lo no legible es no-verificable, nunca inventado.
 *
 * Strict Policy: Zero Emojis.
 */
import { fetchSeguro } from '../safeFetch.js';

function extraerJsonLds(html) {
  const bloques = [];
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    try {
      bloques.push(JSON.parse(m[1]));
    } catch {
      // bloque mal formado: se omite
    }
  }
  return bloques;
}

function aplanar(nodo, productos) {
  if (Array.isArray(nodo)) return nodo.forEach((n) => aplanar(n, productos));
  if (!nodo || typeof nodo !== 'object') return;
  const tipo = nodo['@type'];
  const tipos = Array.isArray(tipo) ? tipo : [tipo];
  if (tipos.includes('Product')) productos.push(nodo);
  if (nodo['@graph']) aplanar(nodo['@graph'], productos);
  if (nodo.mainEntity) aplanar(nodo.mainEntity, productos);
}

function normalizarOferta(oferta) {
  if (!oferta) return null;
  const lista = Array.isArray(oferta) ? oferta : [oferta];
  for (const o of lista) {
    if (!o || typeof o !== 'object') continue;
    const precio = Number(o.price ?? o.lowPrice);
    if (!Number.isFinite(precio)) continue;
    const disponibilidad = String(o.availability || '');
    return {
      precio,
      moneda: o.priceCurrency || null,
      disponible: disponibilidad ? !/OutOfStock|SoldOut|Discontinued/i.test(disponibilidad) : null,
      disponibilidad: disponibilidad ? disponibilidad.replace(/^https?:\/\/schema\.org\//, '') : null
    };
  }
  return null;
}

const STOPWORDS = new Set(['para', 'de', 'del', 'la', 'el', 'los', 'las', 'un', 'una', 'con', 'sin', 'en', 'y', 'a', 'the', 'for', 'and', 'with']);

function tokens(texto) {
  return String(texto || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 2 && !STOPWORDS.has(t));
}

/**
 * Compara el producto pedido con lo que la ficha declara. Devuelve
 * { estado: 'alta'|'parcial'|'ninguna'|'sin-referencia', esperados, coincidencias }.
 */
export function vincularProducto(productoEsperado, productoFicha) {
  const esperados = tokens(productoEsperado);
  if (!esperados.length) return { estado: 'sin-referencia', esperados: [], coincidencias: [] };
  const marca = typeof productoFicha.brand === 'string' ? productoFicha.brand : (productoFicha.brand && productoFicha.brand.name) || '';
  const textoFicha = [
    productoFicha.name, marca, productoFicha.model, productoFicha.mpn, productoFicha.sku,
    productoFicha.gtin, productoFicha.gtin13, productoFicha.gtin14, productoFicha.gtin12, productoFicha.gtin8
  ].filter(Boolean).join(' ');
  const presentes = new Set(tokens(textoFicha));
  const lista = [...presentes];
  const coincidencias = esperados.filter((t) => presentes.has(t) || (t.length >= 4 && lista.some((x) => x.includes(t) || t.includes(x))));
  const ratio = coincidencias.length / esperados.length;
  const estado = ratio >= 0.75 ? 'alta' : ratio >= 0.4 ? 'parcial' : 'ninguna';
  return { estado, esperados, coincidencias };
}

const ORDEN_VINCULO = { alta: 3, parcial: 2, ninguna: 1, 'sin-referencia': 0 };

/**
 * Verifica una oferta concreta.
 * opciones: { producto, monedaEsperada = 'EUR' }
 * deps: { fetchFn (pruebas), ahora (pruebas) }
 */
export async function verificarOfertaJsonLd(url, opciones = {}, deps = {}) {
  const u = String(url || '').trim();
  if (!/^https?:\/\//i.test(u)) return { ok: false, error: 'Necesito una URL http(s) de la ficha del producto.' };
  const fetchFn = deps.fetchFn || ((enlace) => fetchSeguro(enlace));
  let html;
  try {
    const resp = await fetchFn(u, { headers: { 'user-agent': 'Mozilla/5.0 (compatible; DAVIS-bot/1.0)' } });
    if (!resp.ok) return { ok: false, error: `La tienda ha respondido ${resp.status}; no puedo verificar esa oferta.` };
    html = await resp.text();
  } catch (err) {
    return { ok: false, error: `No he podido abrir la pagina: ${err.message}` };
  }
  const productos = [];
  for (const bloque of extraerJsonLds(html)) aplanar(bloque, productos);
  if (productos.length === 0) {
    return { ok: false, noVerificable: true, error: 'La pagina no publica datos estructurados de producto; no puedo confirmar precio ni stock desde aqui.' };
  }

  const monedaEsperada = String(opciones.monedaEsperada || 'EUR').toUpperCase();
  const esperado = String(opciones.producto || '').trim();
  let elegido = null;
  let ofertaElegida = null;
  let vinculacion = { estado: 'sin-referencia', esperados: [], coincidencias: [] };
  for (const p of productos) {
    const oferta = normalizarOferta(p.offers);
    if (!oferta) continue;
    const v = esperado ? vincularProducto(esperado, p) : vinculacion;
    if (!elegido || ORDEN_VINCULO[v.estado] > ORDEN_VINCULO[vinculacion.estado]) {
      elegido = p;
      ofertaElegida = oferta;
      vinculacion = v;
    }
    if (v.estado === 'alta') break;
  }
  if (!elegido) {
    return { ok: false, noVerificable: true, error: 'La ficha no publica precio legible; no lo confirmo.' };
  }

  const advertencias = [];
  const moneda = ofertaElegida.moneda;
  if (!moneda) {
    advertencias.push('La ficha no declara la moneda: confirmala en la web antes de fiarte del numero.');
  } else if (!/^[A-Z]{3}$/.test(moneda)) {
    advertencias.push(`La moneda declarada ("${moneda}") no es un codigo ISO 4217 valido; dato sospechoso.`);
  } else if (moneda !== monedaEsperada) {
    advertencias.push(`El precio esta en ${moneda}, no en ${monedaEsperada}: no lo mezcles con otros precios.`);
  }

  let precioConfirmado = true;
  if (vinculacion.estado === 'ninguna') {
    precioConfirmado = false;
    advertencias.push(`La pagina parece ser de "${String(elegido.name || '').slice(0, 80)}", no del producto pedido: NO trates este precio como el del producto solicitado.`);
  } else if (vinculacion.estado === 'parcial') {
    advertencias.push('La ficha solo coincide parcialmente con el producto pedido (posible otra variante, color o talla): verifica modelo y variante en la web.');
  }

  return {
    ok: true,
    nombre: String(elegido.name || '').trim() || null,
    precio: ofertaElegida.precio,
    moneda,
    disponible: ofertaElegida.disponible,
    disponibilidad: ofertaElegida.disponibilidad,
    vinculacion,
    precioConfirmado,
    advertencias,
    comprobadoEn: (deps.ahora ? new Date(deps.ahora) : new Date()).toISOString(),
    nota: 'Precio y disponibilidad leidos de la propia pagina; el envio y el total final se confirman en la cesta.'
  };
}
