import Parser from 'rss-parser';

const parser = new Parser({
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'application/rss+xml, application/xml, text/xml, */*'
  }
});

// Palabras y patrones prohibidos (Anti-Slop / Anti-Clickbait)
const PATRONES_SLOP = [
  /loter[ií]a/i, /bonoloto/i, /primitiva/i, /sueldazo/i, /euromillones/i, /comprobar sorteo/i, /n[uú]meros premiados/i,
  /hor[oó]scopo/i, /signos? del zodiaco/i, /astrolog[ií]a/i,
  /supervivientes/i, /gran hermano/i, /influencers?/i, /coraz[oó]n/i, /famosos?/i, /s[aá]lvame/i,
  /cazando gangas/i, /chollos?/i, /descuentos?/i, /ofertas?/i, /black friday/i, /prime day/i,
  /el truco para/i, /la raz[oó]n por la que/i, /esto es lo que pasa si/i, /no te creer[aá]s/i,
  /qu[eé] comer para/i, /pierde peso/i, /trucos caseros/i, /receta f[aá]cil/i
];

export const RAMAS_CURADAS = {
  politica: {
    nombre: '🏛️ Política y Actualidad Nacional',
    fuentes: [
      'https://rss.elconfidencial.com/espana/',
      'https://www.elperiodico.com/es/rss/politica/rss.xml',
      'https://www.europapress.es/rss/rss.aspx?ch=00066'
    ]
  },
  economia: {
    nombre: '💼 Economía, Empresas y Finanzas',
    fuentes: [
      'https://rss.elconfidencial.com/economia/',
      'https://www.elperiodico.com/es/rss/economia/rss.xml',
      'https://e00-expansion.uecdn.es/rss/portada.xml'
    ]
  },
  tecnologia: {
    nombre: '💻 Tecnología, IA e Innovación',
    fuentes: [
      'https://rss.elconfidencial.com/tecnologia/',
      'https://www.xataka.com/feedburner.xml',
      'https://www.elperiodico.com/es/rss/tecnologia/rss.xml'
    ]
  },
  deportes: {
    nombre: '⚽ Deportes de Élite',
    fuentes: [
      'https://rss.elconfidencial.com/deportes/',
      'https://www.elperiodico.com/es/rss/deportes/rss.xml',
      'https://e00-marca.uecdn.es/rss/portada.xml'
    ]
  },
  mundo: {
    nombre: '🌍 Geopolítica e Internacional',
    fuentes: [
      'https://rss.elconfidencial.com/mundo/',
      'https://feeds.bbci.co.uk/mundo/rss.xml',
      'https://www.elperiodico.com/es/rss/internacional/rss.xml'
    ]
  }
};

function esSlop(texto) {
  if (!texto) return false;
  return PATRONES_SLOP.some(patron => patron.test(texto));
}

async function verificarLinkReal(url) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1200);
    const res = await fetch(url, {
      method: 'HEAD',
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      redirect: 'follow',
      signal: controller.signal
    });
    clearTimeout(timer);
    return res.status >= 200 && res.status < 400;
  } catch {
    return url && url.startsWith('http');
  }
}

export async function obtenerNoticiasEstructuradas(categoria = 'general', limite = 5) {
  const cat = (categoria || 'general').toLowerCase();
  let ramaClave = 'politica';

  if (cat.includes('econ') || cat.includes('finan') || cat.includes('bolsa') || cat.includes('empres') || cat.includes('mercado')) {
    ramaClave = 'economia';
  } else if (cat.includes('tech') || cat.includes('tecnolog') || cat.includes('innovac') || /\b(ia|ai)\b/.test(cat)) {
    ramaClave = 'tecnologia';
  } else if (cat.includes('depor') || cat.includes('futbol') || cat.includes('motor') || cat.includes('basket')) {
    ramaClave = 'deportes';
  } else if (cat.includes('mundo') || cat.includes('inter') || cat.includes('geopolit')) {
    ramaClave = 'mundo';
  }

  const rama = RAMAS_CURADAS[ramaClave];
  const articulosCandidatos = [];
  const titularesVistos = new Set();
  const limiteHoras = 30 * 60 * 60 * 1000;
  const ahora = Date.now();

  for (const fuente of rama.fuentes) {
    try {
      const feed = await parser.parseURL(fuente);
      if (!feed || !feed.items) continue;

      for (const item of feed.items) {
        const titulo = (item.title || '').replace(/<[^>]*>?/gm, '').trim();
        const resumen = (item.contentSnippet || item.content || item.title || '').replace(/<[^>]*>?/gm, '').slice(0, 180).trim();
        const link = (item.link || '').trim();

        if (!link || !link.startsWith('http')) continue;
        if (esSlop(titulo) || esSlop(resumen)) continue;

        if (item.pubDate) {
          const fechaPub = new Date(item.pubDate).getTime();
          if (!isNaN(fechaPub) && (ahora - fechaPub) > limiteHoras) {
            continue;
          }
        }

        const palabrasClave = titulo.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, ' ').split(/\s+/).filter(w => w.length > 4).slice(0, 3).join(' ');
        if (titularesVistos.has(palabrasClave)) continue;
        titularesVistos.add(palabrasClave);

        articulosCandidatos.push({
          titulo,
          resumen,
          link,
          fecha: item.pubDate ? new Date(item.pubDate).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }) : 'Hoy'
        });

        if (articulosCandidatos.length >= limite * 2) break;
      }
    } catch (e) {
      console.warn(`Aviso: Error leyendo fuente ${fuente}: ${e.message}`);
    }

    if (articulosCandidatos.length >= limite * 2) break;
  }

  const articulosVerificados = [];
  for (const art of articulosCandidatos) {
    const esValido = await verificarLinkReal(art.link);
    if (esValido) {
      art.id = articulosVerificados.length + 1;
      articulosVerificados.push(art);
    }
    if (articulosVerificados.length >= limite) break;
  }

  return {
    ok: articulosVerificados.length > 0,
    categoria: ramaClave,
    ramaNombre: rama.nombre,
    articulos: articulosVerificados
  };
}

export async function extraerResumenTodasLasRamas(limitePorRama = 5) {
  const resultado = {};

  for (const clave of Object.keys(RAMAS_CURADAS)) {
    const res = await obtenerNoticiasEstructuradas(clave, limitePorRama);
    resultado[clave] = {
      tituloRama: res.ramaNombre,
      items: res.articulos || []
    };
  }

  return resultado;
}
