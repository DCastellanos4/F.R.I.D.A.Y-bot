/**
 * wikiService.js - Wiki personal navegable (nº 40)
 *
 * Genera un indice markdown navegable del segundo cerebro, agrupado por
 * categoria, con enlaces relativos a cada nota y sus tags. Se regenera
 * entero bajo demanda; nunca toca las notas.
 *
 * Strict Policy: Zero Emojis.
 */
import fs from 'node:fs';
import path from 'node:path';
import { leerNotas, carpetaNotas } from './notesReader.js';

/**
 * Regenera el indice. Devuelve { ok, rutaIndice, total, categorias }.
 */
export function generarWiki(deps = {}) {
  const base = carpetaNotas(deps);
  const notas = leerNotas({ limite: 500 }, deps);
  if (notas.length === 0) {
    return { ok: false, error: 'Todavia no hay notas en el segundo cerebro: cuando vayas guardando, aqui tendras tu wiki.' };
  }
  const porCategoria = {};
  for (const n of notas) {
    const cat = n.categoria || 'general';
    if (!porCategoria[cat]) porCategoria[cat] = [];
    porCategoria[cat].push(n);
  }
  const lineas = [
    '# Wiki personal de David',
    '',
    `Indice generado: ${new Date().toISOString().slice(0, 10)}. ${notas.length} notas en ${Object.keys(porCategoria).length} categorias.`,
    ''
  ];
  for (const [cat, lista] of Object.entries(porCategoria).sort()) {
    lineas.push(`## ${cat} (${lista.length})`, '');
    for (const n of lista) {
      const rel = path.relative(path.join(base, '..'), n.ruta).split(path.sep).join('/');
      const tags = n.tags.length ? ` - ${n.tags.map((t) => '#' + t).join(' ')}` : '';
      lineas.push(`- [${n.titulo}](../${rel}) (${n.fecha})${tags}`);
    }
    lineas.push('');
  }
  const rutaIndice = path.join(base, 'INDICE.md');
  fs.mkdirSync(base, { recursive: true });
  const tmp = `${rutaIndice}.tmp.${process.pid}`;
  fs.writeFileSync(tmp, lineas.join('\n'), 'utf-8');
  fs.renameSync(tmp, rutaIndice);
  return { ok: true, rutaIndice, total: notas.length, categorias: Object.keys(porCategoria).length };
}
