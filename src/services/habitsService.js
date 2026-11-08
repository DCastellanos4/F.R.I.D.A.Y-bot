/**
 * habitsService.js - Seguimiento de habitos (nº 44)
 *
 * Habitos con marcado diario y racha (dias seguidos hasta ayer/hoy,
 * calendario Europe/Madrid). Sin avisos proactivos: el seguimiento es bajo
 * demanda de David.
 *
 * Strict Policy: Zero Emojis.
 */
import fs from '../security/tenantFileSystem.js';
import path from 'node:path';
import crypto from 'node:crypto';
import { DATA_DIR } from '../config/paths.js';

export const ARCHIVO_DEFECTO = path.join(DATA_DIR, 'habitos.json');

function rutaArchivo(deps = {}) {
  return deps.rutaArchivo || ARCHIVO_DEFECTO;
}

function leer(deps = {}) {
  try {
    const data = JSON.parse(fs.readFileSync(rutaArchivo(deps), 'utf-8'));
    return { habitos: Array.isArray(data.habitos) ? data.habitos : [] };
  } catch {
    return { habitos: [] };
  }
}

function guardar(estado, deps = {}) {
  const ruta = rutaArchivo(deps);
  fs.mkdirSync(path.dirname(ruta), { recursive: true });
  const tmp = `${ruta}.tmp.${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(estado, null, 2), 'utf-8');
  fs.renameSync(tmp, ruta);
}

function hoy(deps = {}) {
  const ref = deps.ahora ? new Date(deps.ahora) : new Date();
  return ref.toLocaleDateString('sv-SE', { timeZone: 'Europe/Madrid' });
}

function racha(marcas, hoyStr) {
  let r = 0;
  const dia = new Date(hoyStr + 'T12:00:00Z');
  if (!marcas.includes(hoyStr)) dia.setUTCDate(dia.getUTCDate() - 1);
  for (;;) {
    const clave = dia.toISOString().slice(0, 10);
    if (!marcas.includes(clave)) break;
    r++;
    dia.setUTCDate(dia.getUTCDate() - 1);
  }
  return r;
}

export function registrarHabito({ nombre } = {}, deps = {}) {
  const n = String(nombre || '').trim();
  if (!n) return { ok: false, error: 'Dime que habito quieres seguir (por ejemplo: "leer 20 minutos").' };
  if (n.length > 80) return { ok: false, error: 'Nombre demasiado largo.' };
  const estado = leer(deps);
  if (estado.habitos.some((h) => h.nombre.toLowerCase() === n.toLowerCase())) {
    return { ok: false, error: `Ya sigues el habito "${n}".` };
  }
  const habito = { id: crypto.randomBytes(4).toString('hex'), nombre: n, marcas: [], creadoEn: new Date().toISOString() };
  estado.habitos.push(habito);
  guardar(estado, deps);
  return { ok: true, habito };
}

export function marcarHabito({ criterio, fecha } = {}, deps = {}) {
  const c = String(criterio || '').trim().toLowerCase();
  const estado = leer(deps);
  const habito = estado.habitos.find((h) => h.id === criterio || (c && h.nombre.toLowerCase().includes(c)));
  if (!habito) return { ok: false, error: 'No encuentro ese habito. Lista los tuyos con "mis habitos".' };
  const f = /^\d{4}-\d{2}-\d{2}$/.test(String(fecha || '')) ? fecha : hoy(deps);
  if (habito.marcas.includes(f)) return { ok: false, error: `"${habito.nombre}" ya estaba marcado el ${f}.` };
  habito.marcas.push(f);
  habito.marcas.sort();
  guardar(estado, deps);
  return { ok: true, habito, racha: racha(habito.marcas, hoy(deps)) };
}

export function listarHabitos(deps = {}) {
  const hoyStr = hoy(deps);
  return leer(deps).habitos.map((h) => ({
    nombre: h.nombre,
    hechoHoy: h.marcas.includes(hoyStr),
    racha: racha(h.marcas, hoyStr),
    totalDias: h.marcas.length
  }));
}
