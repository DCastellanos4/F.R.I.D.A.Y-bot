/**
 * recommenderService.js - Recomendador de series y peliculas (nº 47)
 *
 * Recomienda con el modelo, apoyandose en los gustos guardados en memoria
 * (nº 25-27) y en lo ya recomendado para no repetir. Sin modelo no inventa:
 * pide el genero o dice que lo intente luego.
 *
 * Strict Policy: Zero Emojis.
 */
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from '../config/paths.js';

export const ARCHIVO_DEFECTO = path.join(DATA_DIR, 'recomendador.json');

function rutaArchivo(deps = {}) {
  return deps.rutaArchivo || ARCHIVO_DEFECTO;
}

function leer(deps = {}) {
  try {
    const data = JSON.parse(fs.readFileSync(rutaArchivo(deps), 'utf-8'));
    return { recomendadas: Array.isArray(data.recomendadas) ? data.recomendadas : [] };
  } catch {
    return { recomendadas: [] };
  }
}

function guardar(estado, deps = {}) {
  const ruta = rutaArchivo(deps);
  fs.mkdirSync(path.dirname(ruta), { recursive: true });
  const tmp = `${ruta}.tmp.${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(estado, null, 2), 'utf-8');
  fs.renameSync(tmp, ruta);
}

export async function recomendarSeriePelicula({ genero, tipo } = {}, deps = {}) {
  if (typeof deps.chatCompletion !== 'function') {
    return { ok: false, error: 'Necesito el modelo de lenguaje para recomendar; dime que te apetece y te lo apunto en la lista de pendientes.' };
  }
  const estado = leer(deps);
  const gustos = typeof deps.obtenerMemorias === 'function' ? (await deps.obtenerMemorias().catch(() => [])) : [];
  const gustosTxt = (Array.isArray(gustos) ? gustos : []).map((m) => (typeof m === 'string' ? m : m.contenido || m.texto || '')).filter(Boolean).slice(0, 15).join('; ');
  const yaRecomendadas = estado.recomendadas.slice(-30).join('; ');
  const resp = await deps.chatCompletion({
    messages: [
      { role: 'system', content: `Recomienda 3 ${tipo === 'serie' ? 'series' : tipo === 'pelicula' ? 'peliculas' : 'peliculas o series'} en espanol, una por linea: "Titulo (ano, plataforma aproximada): razon breve". Sin emojis. Gustos conocidos de David: ${gustosTxt || 'desconocidos'}. Ya recomendadas (no repetir): ${yaRecomendadas || 'ninguna'}.` },
      { role: 'user', content: String(genero || 'Sorprendeme.').slice(0, 300) }
    ]
  });
  const texto = (resp?.message?.content || resp?.content || '').trim();
  if (!texto) return { ok: false, error: 'El modelo no ha devuelto recomendaciones.' };
  const titulos = texto.split('\n').map((l) => l.replace(/^[-*\d.)\s]+/, '').split(':')[0].split('(')[0].trim()).filter(Boolean).slice(0, 3);
  estado.recomendadas.push(...titulos);
  estado.recomendadas = estado.recomendadas.slice(-60);
  guardar(estado, deps);
  return { ok: true, recomendacion: texto };
}
