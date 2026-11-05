/**
 * notesReader.js - Lectura compartida de notas del segundo cerebro.
 *
 * Lee los markdown de la carpeta de notas (YYYY-MM-DD/*.md, formato de
 * notesService) con la carpeta inyectable para pruebas. Solo lectura.
 *
 * Strict Policy: Zero Emojis.
 */
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from '../config/paths.js';

export function carpetaNotas(deps = {}) {
  return deps.carpetaNotas || path.join(DATA_DIR, 'notes');
}

/**
 * Lista notas como { ruta, titulo, categoria, tags, contenido, fecha }.
 * Ordenadas de mas reciente a mas antigua. Tope duro de 200.
 */
export function leerNotas({ limite = 200 } = {}, deps = {}) {
  const base = carpetaNotas(deps);
  const notas = [];
  let dias;
  try {
    dias = fs.readdirSync(base, { withFileTypes: true })
      .filter((d) => d.isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(d.name))
      .map((d) => d.name)
      .sort()
      .reverse();
  } catch {
    return [];
  }
  for (const dia of dias) {
    if (notas.length >= limite) break;
    let ficheros;
    try {
      ficheros = fs.readdirSync(path.join(base, dia)).filter((f) => f.endsWith('.md')).sort().reverse();
    } catch {
      continue;
    }
    for (const f of ficheros) {
      if (notas.length >= limite) break;
      const ruta = path.join(base, dia, f);
      try {
        const contenido = fs.readFileSync(ruta, 'utf-8');
        const titulo = (contenido.match(/^#\s+(.+)$/m) || [])[1] || f.replace(/\.md$/, '');
        const categoria = (contenido.match(/categor[ií]a:\s*(.+)/i) || [])[1]?.trim() || 'general';
        const tags = ((contenido.match(/tags:\s*(.+)/i) || [])[1] || '')
          .split(',').map((t) => t.trim().toLowerCase()).filter(Boolean);
        notas.push({ ruta, titulo: titulo.trim(), categoria, tags, contenido: contenido.slice(0, 4000), fecha: dia });
      } catch {
        // nota ilegible: se omite
      }
    }
  }
  return notas;
}
