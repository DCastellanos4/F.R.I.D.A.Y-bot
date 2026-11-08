/**
 * capturaService.js - Captura desde el navegador al segundo cerebro (nº 41)
 *
 * "Guarda esta pagina en mis notas": extrae el articulo con el navegador ya
 * existente (browserService, inyectable en tests) y lo archiva como nota.
 * Solo http(s); sin credenciales ni sesiones de terceros.
 *
 * Strict Policy: Zero Emojis.
 */
import { savePersonalNote } from './notesService.js';
import { navegarYExtraerArticulo } from './browserService.js';

export async function capturarPagina({ url, titulo } = {}, deps = {}) {
  const u = String(url || '').trim();
  let parsed;
  try {
    parsed = new URL(u);
  } catch {
    return { ok: false, error: 'URL invalida.' };
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return { ok: false, error: 'Solo puedo capturar paginas web (http/https).' };
  }
  const extraer = typeof deps.extraerArticulo === 'function' ? deps.extraerArticulo : navegarYExtraerArticulo;
  try {
    const articulo = await extraer(u);
    const texto = (articulo && (articulo.contenido || articulo.texto || articulo.content)) || '';
    if (!texto || texto.length < 40) {
      return { ok: false, error: 'No he podido extraer contenido legible de esa pagina.' };
    }
    const tituloFinal = String(titulo || articulo.titulo || articulo.title || u).slice(0, 120);
    const res = await savePersonalNote(`[captura web] ${tituloFinal}\nFuente: ${u}\n\n${texto.slice(0, 8000)}`, {
      source: 'captura-web',
      sender: 'navegador',
      carpetaNotas: deps.carpetaNotas
    });
    if (!res.ok) return { ok: false, error: 'No he podido archivar la captura en tus notas.' };
    return { ok: true, titulo: tituloFinal, archivo: res.filename || null };
  } catch (err) {
    return { ok: false, error: `No he podido capturar la pagina: ${err.message}` };
  }
}
