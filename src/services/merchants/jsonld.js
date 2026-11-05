/**
 * jsonld.js - Adaptador de verificacion por datos estructurados JSON-LD.
 *
 * Muchas fichas de producto publican schema.org/Product con precio y
 * disponibilidad. Verificar una oferta es leer ESA pagina ahora: sin fetch
 * inyectado (produccion) usa fetch global; si la pagina no se puede abrir o
 * no trae Product con precio, devuelve no-verificable, nunca un precio
 * inventado.
 *
 * Strict Policy: Zero Emojis.
 */

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

export async function verificarOfertaJsonLd(url, deps = {}) {
  const u = String(url || '').trim();
  if (!/^https?:\/\//i.test(u)) return { ok: false, error: 'Necesito una URL http(s) de la ficha del producto.' };
  const fetchFn = deps.fetchFn || globalThis.fetch;
  if (typeof fetchFn !== 'function') return { ok: false, error: 'No tengo forma de abrir la pagina ahora mismo.' };
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
  const p = productos[0];
  const oferta = normalizarOferta(p.offers);
  if (!oferta) {
    return { ok: false, noVerificable: true, error: 'La ficha no publica precio legible; no lo confirmo.' };
  }
  return {
    ok: true,
    nombre: String(p.name || '').trim() || null,
    precio: oferta.precio,
    moneda: oferta.moneda,
    disponible: oferta.disponible,
    disponibilidad: oferta.disponibilidad,
    comprobadoEn: (deps.ahora ? new Date(deps.ahora) : new Date()).toISOString(),
    nota: 'Precio y disponibilidad leidos de la propia pagina; el envio y el total final se confirman en la cesta.'
  };
}
