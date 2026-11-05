/**
 * shoppingService.js - Lista de la compra por voz o texto (nº 46)
 *
 * Una lista viva: anadir (uno o varios items), listar, tachar y vaciar.
 * La voz llega transcrita por el flujo de audio existente.
 *
 * Strict Policy: Zero Emojis.
 */
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from '../config/paths.js';

export const ARCHIVO_DEFECTO = path.join(DATA_DIR, 'compra.json');

function rutaArchivo(deps = {}) {
  return deps.rutaArchivo || ARCHIVO_DEFECTO;
}

function leer(deps = {}) {
  try {
    const data = JSON.parse(fs.readFileSync(rutaArchivo(deps), 'utf-8'));
    return { items: Array.isArray(data.items) ? data.items : [] };
  } catch {
    return { items: [] };
  }
}

function guardar(estado, deps = {}) {
  const ruta = rutaArchivo(deps);
  fs.mkdirSync(path.dirname(ruta), { recursive: true });
  const tmp = `${ruta}.tmp.${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(estado, null, 2), 'utf-8');
  fs.renameSync(tmp, ruta);
}

export function anadirCompra({ items } = {}, deps = {}) {
  const lista = (Array.isArray(items) ? items : [items])
    .map((i) => String(i || '').trim().slice(0, 80))
    .filter(Boolean);
  if (lista.length === 0) return { ok: false, error: 'Dime que quieres anadir a la compra.' };
  const estado = leer(deps);
  const anadidos = [];
  for (const item of lista) {
    if (estado.items.some((x) => x.toLowerCase() === item.toLowerCase())) continue;
    estado.items.push(item);
    anadidos.push(item);
  }
  guardar(estado, deps);
  return { ok: true, anadidos, total: estado.items.length };
}

export function listarCompra(deps = {}) {
  return leer(deps).items;
}

export function tacharCompra(criterio, deps = {}) {
  const c = String(criterio || '').trim().toLowerCase();
  const estado = leer(deps);
  const idx = estado.items.findIndex((x) => x.toLowerCase().includes(c));
  if (!c || idx === -1) return { ok: false, error: 'No encuentro eso en la lista.' };
  const [tachado] = estado.items.splice(idx, 1);
  guardar(estado, deps);
  return { ok: true, tachado, total: estado.items.length };
}

export function vaciarCompra(deps = {}) {
  guardar({ items: [] }, deps);
  return { ok: true };
}
