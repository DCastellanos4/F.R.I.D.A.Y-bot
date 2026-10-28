import * as cheerio from 'cheerio';
import { YoutubeTranscript } from 'youtube-transcript';
import { chatCompletion } from './llmService.js';
import { config } from './config.js';
import { navegarYExtraerArticulo } from './browserService.js';

/**
 * Extrae el ID de un vídeo de YouTube
 */
function extraerYoutubeId(url) {
  const match = url.match(/(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=))([\w-]{11})/);
  return match ? match[1] : null;
}

/**
 * Descarga y limpia el contenido de una URL web o vídeo de YouTube,
 * priorizando el navegador real Playwright Chromium para sortear JavaScript y muros.
 */
export async function extraerTextoDeUrl(url) {
  try {
    const ytId = extraerYoutubeId(url);

    // Si es YouTube: intentar extraer la transcripción (subtítulos)
    if (ytId) {
      console.log(`[Video] [Resumidor] Detectado vídeo de YouTube (ID: ${ytId}). Extrayendo subtítulos...`);
      try {
        const transcript = await YoutubeTranscript.fetchTranscript(ytId, { lang: 'es' })
          .catch(() => YoutubeTranscript.fetchTranscript(ytId)); // Fallback a cualquier idioma

        if (transcript && transcript.length > 0) {
          const textoCompleto = transcript.map(t => t.text).join(' ');
          const extracto = textoCompleto.slice(0, 4500);

          return {
            ok: true,
            tipo: 'youtube',
            titulo: `Vídeo de YouTube (${url})`,
            contenido: extracto,
            url: url
          };
        }
      } catch (errYt) {
        console.warn(`Aviso: Subtítulos de YouTube no disponibles: ${errYt.message}. Obteniendo metadatos...`);
      }

      // Si no tiene subtítulos, obtener título y descripción mediante oEmbed
      const oembedRes = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`);
      if (oembedRes.ok) {
        const data = await oembedRes.json();
        return {
          ok: true,
          tipo: 'youtube_meta',
          titulo: data.title || 'Vídeo de YouTube',
          contenido: `Canal: ${data.author_name}. Título del vídeo: ${data.title}.`,
          url: url
        };
      }
    }

    // 1. Para páginas web y noticias: Usar primero Playwright Chromium real
    try {
      console.log(`[Web] [Resumidor] Leyendo artículo con Playwright Chromium: ${url}...`);
      const resBrowser = await navegarYExtraerArticulo(url, { timeout: 15000 });
      if (resBrowser.ok && resBrowser.contenido && resBrowser.contenido.length >= 80) {
        return {
          ok: true,
          tipo: 'articulo_playwright',
          titulo: resBrowser.titulo,
          autor: resBrowser.autor,
          fecha: resBrowser.fecha,
          contenido: resBrowser.contenido,
          url: url
        };
      }
    } catch (errBrowser) {
      console.warn(`[Aviso] [Resumidor] Playwright falló (${errBrowser.message}). Aplicando fallback con Cheerio...`);
    }

    // 2. Fallback secundario: Cheerio + HTTP fetch estándar
    console.log(`[Web] [Resumidor Cheerio Fallback] Analizando HTML plano: ${url}...`);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);

    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      },
      signal: controller.signal
    });
    clearTimeout(timeout);

    if (!res.ok) {
      return { ok: false, error: `Error HTTP ${res.status} al acceder a la página.` };
    }

    const html = await res.text();
    const $ = cheerio.load(html);

    const titulo = $('meta[property="og:title"]').attr('content') ||
                   $('meta[name="twitter:title"]').attr('content') ||
                   $('title').text().trim() ||
                   'Página Web';

    // Eliminar elementos basura
    $('script, style, nav, footer, header, noscript, aside, form, iframe, svg, [role="navigation"], .ads, .comments, .banner').remove();

    // Priorizar el cuerpo del artículo
    let texto = $('article').text() || $('main').text() || $('body').text();
    texto = texto.replace(/\s+/g, ' ').trim();

    if (!texto || texto.length < 50) {
      return { ok: false, error: 'No se pudo extraer suficiente texto legible de la página.' };
    }

    return {
      ok: true,
      tipo: 'articulo_web_cheerio',
      titulo: titulo.replace(/\s+/g, ' ').trim(),
      contenido: texto.slice(0, 4500),
      url: url
    };
  } catch (err) {
    console.error('Error al extraer URL:', err.message);
    return { ok: false, error: `No se pudo acceder al enlace: ${err.message}` };
  }
}

/**
 * Ejecuta el resumen inteligente con FRIDAY formateado para WhatsApp
 */
export async function generarResumenInteligente(url) {
  const datos = await extraerTextoDeUrl(url);

  if (!datos.ok) {
    return `[Aviso] David, no he podido leer el enlace: ${datos.error}`;
  }

  console.log(`[D.A.V.I.S.] [Resumidor] Sintetizando con FRIDAY el contenido de "${datos.titulo}" (${datos.tipo})...`);

  const prompt = `Analiza y resume el siguiente contenido de forma clara y directa para leer en WhatsApp.

TÍTULO: ${datos.titulo}
URL: ${datos.url}
TEXTO:
${datos.contenido}

INSTRUCCIONES DE FORMATO:
- Sé conciso y objetivo al estilo de F.R.I.D.A.Y. (asistente táctica de Tony Stark).
- Estructura exactamente así:
 *RESUMEN TÁCTICO:* ${datos.titulo}
 ${datos.url}

 *Idea Principal:*
[1 o 2 frases explicando de qué trata y por qué es relevante]

 *Puntos Clave:*
• [Punto 1 destacado]
• [Punto 2 destacado]
• [Punto 3 destacado]

[Sniper] *Conclusión:*
[1 frase de cierre o conclusión final]`;

  try {
    const respuesta = await chatCompletion({
      messages: [
        { role: 'system', content: 'Eres F.R.I.D.A.Y., la asistente táctica de Tony Stark, experta en sintetizar textos largos y noticias en resúmenes ejecutivos rápidos y claros para David.' },
        { role: 'user', content: prompt }
      ],
      options: {
        max_tokens: 350,
        temperature: 0.2
      }
    });

    return (respuesta.message.content || '').trim();
  } catch (err) {
    return `Error generando el resumen táctico: ${err.message}`;
  }
}
