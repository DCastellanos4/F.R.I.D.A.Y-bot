let chromiumModule = null;
async function getChromium() {
  if (chromiumModule) return chromiumModule;
  try {
    const pw = await import('playwright');
    chromiumModule = pw.chromium;
    return chromiumModule;
  } catch (err) {
    return null;
  }
}

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

// Cache en memoria para evitar descargar la misma URL varias veces en corto tiempo (TTL: 15 minutos)
const cachePaginas = new Map();
const TTL_CACHE_MS = 15 * 60 * 1000;

/**
 * Guardarrailes de seguridad estrictos para navegacion autonoma:
 * - Prohibicion absoluta de URLs de autenticacion / login / registro / OAuth.
 * - Prohibicion absoluta de pasarelas de pago, checkouts y compras.
 * - Solo lectura segura de contenido publico.
 */
// Segmentos de ruta/host que implican autenticacion, compra o administracion.
// Se comparan como SEGMENTOS completos (no subcadenas) para no bloquear
// lectura publica legitima: una noticia sobre un banco, un articulo de un
// autor (/autor/...) o la Wikipedia de "Cartografia" no son un checkout.
const SEGMENTOS_PROHIBIDOS = new Set([
  'login', 'log-in', 'signin', 'sign-in', 'signup', 'sign-up',
  'oauth', 'auth', 'sso',
  'password', 'passwd',
  'checkout', 'payment', 'payments', 'pago',
  'cart', 'carrito', 'cesta',
  'admin', 'dashboard'
]);

// Compatibilidad: algunos consumidores importan la lista de patrones.
export const PATRONES_PROHIBIDOS = [...SEGMENTOS_PROHIBIDOS];

function segmentosDeUrl(parsed) {
  const bruto = `${parsed.hostname}${parsed.pathname}${parsed.search}`.toLowerCase();
  // Se conserva el guion dentro de cada segmento ("sign-in" sigue siendo un
  // segmento); el resto de separadores (/, ., ?, &, =, _, %) trocea.
  return bruto.split(/[\/.?&=_%+]+/).filter(Boolean);
}

export function validarGuardarrailesNavegacion(url) {
  if (!url || typeof url !== 'string' || !url.startsWith('http')) {
    return { permitido: false, motivo: 'URL invalida o esquema no permitido (solo http/https).' };
  }

  try {
    const parsed = new URL(url);
    const segmentos = segmentosDeUrl(parsed);

    for (const segmento of segmentos) {
      if (SEGMENTOS_PROHIBIDOS.has(segmento)) {
        return {
          permitido: false,
          motivo: `Bloqueado por guardarrail de seguridad: la URL contiene la seccion "${segmento}", propia de login, compra o administracion. DAVIS opera en modo lectura publica segura.`
        };
      }
    }

    return { permitido: true };
  } catch {
    return { permitido: false, motivo: 'URL malformada.' };
  }
}

/**
 * Lanza una instancia ligera de Chromium headless optimizada para ARM64 / Oracle VPS
 */
async function crearPaginaNavegador() {
  const chromium = await getChromium();
  if (!chromium) {
    throw new Error('Playwright Chromium no esta instalado en este entorno.');
  }
  const browser = await chromium.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--disable-accelerated-2d-canvas'
    ]
  });

  const context = await browser.newContext({
    userAgent: USER_AGENT,
    locale: 'es-ES',
    timezoneId: 'Europe/Madrid',
    viewport: { width: 1280, height: 800 }
  });

  const page = await context.newPage();

  // Bloqueo de imagenes, medios y fuentes pesadas para acelerar la navegacion a < 2 segundos
  await page.route('**/*', (route) => {
    const type = route.request().resourceType();
    if (['image', 'media', 'font'].includes(type)) {
      return route.abort();
    }
    return route.continue();
  });

  return { browser, context, page };
}

/**
 * Navega a una URL con Playwright Chromium con guardarrailes activos,
 * sortea muros/consentimiento y extrae el cuerpo completo del articulo o informacion publica.
 */
export async function navegarYExtraerArticulo(url, opciones = {}) {
  // 1. Validar guardarrailes
  const chequeo = validarGuardarrailesNavegacion(url);
  if (!chequeo.permitido) {
    return { ok: false, url, error: chequeo.motivo };
  }

  // Comprobar cache en memoria
  const cached = cachePaginas.get(url);
  if (cached && (Date.now() - cached.timestamp) < TTL_CACHE_MS) {
    console.log(`[Playwright] Sirviendo articulo desde cache rapida: ${url}`);
    return { ...cached.data, desdeCache: true };
  }

  let browser = null;
  const timeoutMs = opciones.timeout || 15000;

  try {
    console.log(`[Playwright Guardarrail Activo] Navegando con Chromium a: ${url}...`);
    const instancias = await crearPaginaNavegador();
    browser = instancias.browser;
    const page = instancias.page;

    // Navegar esperando la carga del DOM
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs });

    // Breve pausa para asegurar la ejecucion de JS inicial
    await page.waitForTimeout(800);

    // Intentar neutralizar y remover overlays y banners de consentimiento (Didomi, OneTrust, CMP, etc.)
    try {
      await page.evaluate(() => {
        const selectoresBasura = [
          '#didomi-popup', '#didomi-notice', '.didomi-popup-container',
          '#onetrust-consent-sdk', '#onetrust-banner-sdk',
          '.cmp-container', '.fc-dialog-overlay', '.fc-consent-root',
          '.tp-backdrop', '.tp-modal', '.paywall', '.modal-backdrop',
          '[id*="consent"]', '[class*="cookie"]'
        ];
        selectoresBasura.forEach(sel => {
          document.querySelectorAll(sel).forEach(el => el.remove());
        });
      });
    } catch {}

    // Extraer datos estructurados de la pagina
    const resultado = await page.evaluate(() => {
      // 1. Titulo
      const metaTitle = document.querySelector('meta[property="og:title"]')?.getAttribute('content') ||
                        document.querySelector('meta[name="twitter:title"]')?.getAttribute('content') ||
                        document.querySelector('h1')?.innerText?.trim() ||
                        document.title ||
                        'Informacion';

      // 2. Autor y Fecha
      const autor = document.querySelector('meta[name="author"]')?.getAttribute('content') ||
                    document.querySelector('.author, .byline, [rel="author"]')?.innerText?.trim() ||
                    null;

      const fecha = document.querySelector('meta[property="article:published_time"]')?.getAttribute('content') ||
                    document.querySelector('time')?.getAttribute('datetime') ||
                    document.querySelector('time')?.innerText?.trim() ||
                    null;

      // 3. Contenedor principal
      const contenedor = document.querySelector('article') ||
                         document.querySelector('[itemprop="articleBody"]') ||
                         document.querySelector('.article-body') ||
                         document.querySelector('.news-body') ||
                         document.querySelector('.c-detail__body') ||
                         document.querySelector('main') ||
                         document.body;

      if (!contenedor) {
        return { titulo: metaTitle, autor, fecha, texto: '' };
      }

      // Clonar y remover componentes no textuales
      const clon = contenedor.cloneNode(true);
      const selectoresAEliminar = [
        'script', 'style', 'noscript', 'nav', 'footer', 'header', 'aside', 'form',
        'iframe', 'svg', '.ad', '.ads', '.publicidad', '.banner', '.social-share',
        '.comments', '.relacionadas', '[role="navigation"]', '[role="complementary"]',
        '[role="banner"]'
      ];
      clon.querySelectorAll(selectoresAEliminar.join(', ')).forEach(el => el.remove());

      // Extraer parrafos y subtitulos en orden de lectura
      const bloques = Array.from(clon.querySelectorAll('h2, h3, p'))
        .map(el => {
          const tag = el.tagName.toLowerCase();
          const t = el.innerText.trim();
          if (!t) return null;
          if (tag === 'p') {
            return t.length > 25 ? t : null;
          }
          if (tag === 'h2' || tag === 'h3') {
            return `\n*${t}*\n`;
          }
          return null;
        })
        .filter(Boolean);

      let textoFinal = '';
      if (bloques.length > 0) {
        textoFinal = bloques.join('\n\n');
      } else {
        textoFinal = clon.innerText.replace(/\s+/g, ' ').trim();
      }

      return {
        titulo: metaTitle.trim(),
        autor,
        fecha,
        texto: textoFinal
      };
    });

    const textoLimpio = (resultado.texto || '').trim();

    if (!textoLimpio || textoLimpio.length < 50) {
      return {
        ok: false,
        url,
        titulo: resultado.titulo,
        error: 'El navegador no encontro contenido legible suficiente en la pagina.'
      };
    }

    const respuestaFinal = {
      ok: true,
      url,
      titulo: resultado.titulo,
      autor: resultado.autor,
      fecha: resultado.fecha,
      contenido: textoLimpio.slice(0, 5000),
      longitudTotal: textoLimpio.length
    };

    // Guardar en cache
    cachePaginas.set(url, { timestamp: Date.now(), data: respuestaFinal });

    return respuestaFinal;
  } catch (err) {
    console.error(`[Playwright] Error navegando a ${url}:`, err.message);
    return {
      ok: false,
      url,
      error: `Error de navegacion: ${err.message}`
    };
  } finally {
    if (browser) {
      try {
        await browser.close();
      } catch {}
    }
  }
}

/**
 * Captura de pantalla de pagina web publica respetando guardarrailes.
 */
export async function capturarPantallaWeb(url) {
  const chequeo = validarGuardarrailesNavegacion(url);
  if (!chequeo.permitido) {
    return { ok: false, error: chequeo.motivo };
  }

  let browser = null;
  try {
    console.log(`[Playwright Screenshot] Capturando pagina web: ${url}...`);
    const instancias = await crearPaginaNavegador();
    browser = instancias.browser;
    const page = instancias.page;

    await page.goto(url, { waitUntil: 'load', timeout: 20000 });
    await page.waitForTimeout(1000);

    const buffer = await page.screenshot({
      type: 'jpeg',
      quality: 85,
      fullPage: false
    });

    return {
      ok: true,
      buffer,
      url
    };
  } catch (err) {
    console.error(`[Playwright Screenshot] Error capturando ${url}:`, err.message);
    return {
      ok: false,
      error: err.message
    };
  } finally {
    if (browser) {
      try {
        await browser.close();
      } catch {}
    }
  }
}
