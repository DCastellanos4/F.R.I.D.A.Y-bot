/**
 * sportsService.js - Resumen deportivo (nº 49)
 *
 * Resume la actualidad deportiva con las fuentes RSS reales ya curadas en
 * newsService (rama "deportes": Marca, El Periodico, El Confidencial). Sin
 * modelo devuelve titulares; con modelo los resume. Nunca inventa marcadores:
 * solo cuenta lo que traen los feeds.
 *
 * Strict Policy: Zero Emojis.
 */
import { obtenerNoticiasEstructuradas } from './newsService.js';

export async function resumenDeportivo({ limite = 5 } = {}, deps = {}) {
  const obtener = typeof deps.obtenerNoticias === 'function' ? deps.obtenerNoticias : obtenerNoticiasEstructuradas;
  let noticias;
  try {
    noticias = await obtener('deportes', limite);
  } catch (err) {
    return { ok: false, error: `No he podido traer las noticias deportivas: ${err.message}` };
  }
  const lista = Array.isArray(noticias) ? noticias : (noticias.articulos || noticias.noticias || []);
  if (lista.length === 0) {
    return { ok: false, error: 'Los feeds deportivos no han devuelto titulares ahora mismo.' };
  }
  const titulares = lista.slice(0, limite).map((n) => ({ titulo: n.titulo || n.title || '', enlace: n.enlace || n.link || '' }));
  if (typeof deps.chatCompletion !== 'function') {
    return { ok: true, resumen: titulares.map((t) => '- ' + t.titulo).join('\n'), titulares, sinModelo: true };
  }
  const resp = await deps.chatCompletion({
    messages: [
      { role: 'system', content: 'Resume en 4-6 lineas la actualidad deportiva a partir de estos titulares reales, en espanol, sin emojis y sin inventar resultados que no aparezcan.' },
      { role: 'user', content: titulares.map((t) => t.titulo).join('\n') }
    ]
  });
  const texto = (resp?.message?.content || resp?.content || '').trim();
  return { ok: true, resumen: texto || titulares.map((t) => '- ' + t.titulo).join('\n'), titulares };
}
