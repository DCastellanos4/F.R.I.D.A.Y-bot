/**
 * priceradars.js - Adaptador de busqueda via PriceRadars.
 *
 * Comparador gratuito, SIN alta, SIN clave y SIN coste (API JSON publica de
 * solo lectura, documentada en https://priceradars.com/llms-full.txt y
 * verificada en vivo el 5 nov 2026): cubre Espana y devuelve producto,
 * precio mas bajo, moneda, stock, comercio y enlace al comercio.
 *
 * Limites honestos y filtros duros:
 *   - Accesorios disfrazados de producto: si la ficha es una funda, soporte,
 *     cable, etc. "para" lo buscado y la consulta NO pedia un accesorio, se
 *     aparta (accesoriosOmitidos) y NO se presenta como el producto.
 *   - Variantes: si la ficha es otra variante (pro/max/plus/mini/ultra/air/
 *     se/lite) distinta de la pedida, se marca variante:'distinta'.
 *   - Vinculacion: candidatos sin coincidencia razonable con la consulta se
     *     descartan (descartadosSinVinculo), nunca se presentan como el
 *     producto.
 *   - Frescura: la busqueda NO trae fecha de refresco por oferta y el stock
 *     es el del feed del comparador (no el del comercio ahora mismo): cada
 *     respuesta lo declara y remite a verificar_oferta para el enlace exacto.
 *
 * Precios de la API: en CENTIMOS (199 = 1,99 EUR, verificado contra el
 * deeplink del comercio); aqui se convierten a unidades.
 *
 * Strict Policy: Zero Emojis.
 */
import { fetchSeguro } from '../safeFetch.js';

const BASE = 'https://priceradars.com';

export const AVISO_PRICERADARS = 'Resultados del comparador PriceRadars (gratuito, sin alta). Frescura: la busqueda no trae fecha de refresco por oferta y el stock es el del feed del comparador, NO el del comercio ahora mismo; el precio final manda en la web del comercio. Si quieres, pasame el enlace exacto de la ficha y lo verifico al momento (precio y stock leidos de la pagina, con hora de comprobacion).';

/** Marcadores de accesorio: presentes en la ficha y ausentes de la consulta
 * implican "no es el producto, es algo PARA el producto". */
const MARCAS_ACCESORIO = ['funda', 'carcasa', 'protector', 'protectora', 'cristal', 'pelicula', 'hidrogel', 'soporte', 'cable', 'cargador', 'adaptador', 'correa', 'repuesto', 'repuestos', 'pegatina', 'estuche', 'tapa', 'visor', 'conector', 'resistencia', 'diodo', 'placa'];

/** Marcadores de variante de modelo. */
const MARCAS_VARIANTE = ['pro', 'max', 'plus', 'mini', 'ultra', 'air', 'se', 'lite'];

function tokens(texto) {
  return String(texto || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 2);
}

/**
 * Clasifica un candidato contra la consulta:
 *  tipo: 'producto' | 'accesorio' | 'sin-vinculo'
 *  variante: 'misma' | 'distinta' (solo orientativo, no excluye)
 */
export function clasificarCandidato(consulta, nombreCandidato) {
  const q = new Set(tokens(consulta));
  const c = tokens(nombreCandidato);
  const cSet = new Set(c);
  const marcaAccesorio = MARCAS_ACCESORIO.find((m) => cSet.has(m) && !q.has(m));
  const coincidencias = [...q].filter((t) => cSet.has(t) || (t.length >= 4 && c.some((x) => x.includes(t) || t.includes(x))));
  const ratio = q.size ? coincidencias.length / q.size : 0;
  const variantesQ = MARCAS_VARIANTE.filter((v) => q.has(v)).sort().join(',');
  const variantesC = MARCAS_VARIANTE.filter((v) => cSet.has(v)).sort().join(',');
  const variante = variantesQ === variantesC ? 'misma' : 'distinta';
  if (marcaAccesorio) return { tipo: 'accesorio', motivo: `la ficha es un accesorio ("${marcaAccesorio}") para otro producto`, variante, ratio };
  if (q.size > 0 && ratio < 0.4) return { tipo: 'sin-vinculo', motivo: 'la ficha no coincide con lo buscado', variante, ratio };
  return { tipo: 'producto', variante, ratio };
}

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
    let accesoriosOmitidos = 0;
    let descartadosSinVinculo = 0;
    const candidatos = [];
    for (const p of productos) {
      const clase = clasificarCandidato(consulta, p.name || '');
      if (clase.tipo === 'accesorio') { accesoriosOmitidos++; continue; }
      if (clase.tipo === 'sin-vinculo') { descartadosSinVinculo++; continue; }
      let dominio = null;
      try { dominio = p.deeplink ? new URL(p.deeplink).hostname : null; } catch { dominio = null; }
      candidatos.push({
        nombre: p.name || null,
        marca: p.brand || null,
        precio: Number.isFinite(p.lowestPrice) ? p.lowestPrice / 100 : null,
        moneda: p.currency || null,
        enStock: typeof p.inStock === 'boolean' ? p.inStock : null,
        stockSegun: p.inStock != null ? 'feed del comparador, sin reconfirmar con el comercio' : null,
        condicion: p.condition || null,
        comercio: p.merchantName || dominio,
        ofertas: Number.isFinite(p.offerCount) ? p.offerCount : null,
        variante: clase.variante,
        enlace: p.deeplink || null,
        fichaComparador: p.slug ? `${BASE}/en/es/product/${p.slug}` : null
      });
    }
    return {
      candidatos,
      accesoriosOmitidos,
      descartadosSinVinculo,
      totalResultados: Number.isFinite(data.totalCount) ? data.totalCount : candidatos.length
    };
  };
}
