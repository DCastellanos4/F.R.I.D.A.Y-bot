/**
 * deadlinesService.js - Calendario de entregas y examenes (nº 8)
 *
 * Registro de entregas y examenes con fecha y dias restantes (Europe/Madrid).
 * Los avisos puntuales los cubre el sistema de recordatorios (nº 2) cuando
 * David los pide; aqui no hay monitor proactivo propio.
 *
 * Strict Policy: Zero Emojis.
 */
import fs from '../security/tenantFileSystem.js';
import path from 'node:path';
import crypto from 'node:crypto';
import { DATA_DIR } from '../config/paths.js';

export const ARCHIVO_DEFECTO = path.join(DATA_DIR, 'entregas.json');
const TIPOS = ['entrega', 'examen'];

function rutaArchivo(deps = {}) {
  return deps.rutaArchivo || ARCHIVO_DEFECTO;
}

function leer(deps = {}) {
  try {
    const data = JSON.parse(fs.readFileSync(rutaArchivo(deps), 'utf-8'));
    return { entregas: Array.isArray(data.entregas) ? data.entregas : [] };
  } catch {
    return { entregas: [] };
  }
}

function guardar(estado, deps = {}) {
  const ruta = rutaArchivo(deps);
  fs.mkdirSync(path.dirname(ruta), { recursive: true });
  const tmp = `${ruta}.tmp.${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(estado, null, 2), 'utf-8');
  fs.renameSync(tmp, ruta);
}

function hoyMadrid(deps = {}) {
  const ref = deps.ahora ? new Date(deps.ahora) : new Date();
  return ref.toLocaleDateString('sv-SE', { timeZone: 'Europe/Madrid' });
}

export function registrarEntrega({ titulo, fecha, tipo } = {}, deps = {}) {
  const t = String(titulo || '').trim().slice(0, 80);
  if (!t) return { ok: false, error: 'Dime que se entrega o que examen es.' };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(fecha || ''))) return { ok: false, error: 'Necesito la fecha en AAAA-MM-DD.' };
  const tipoOk = TIPOS.includes(String(tipo || '').toLowerCase()) ? String(tipo).toLowerCase() : 'entrega';
  const estado = leer(deps);
  if (estado.entregas.some((e) => e.titulo.toLowerCase() === t.toLowerCase() && e.fecha === fecha)) {
    return { ok: false, error: `Ya tienes "${t}" apuntado para el ${fecha}.` };
  }
  const entrega = { id: crypto.randomBytes(4).toString('hex'), titulo: t, fecha, tipo: tipoOk, creadaEn: new Date().toISOString() };
  estado.entregas.push(entrega);
  guardar(estado, deps);
  return { ok: true, entrega };
}

export function listarEntregas(deps = {}) {
  const hoy = hoyMadrid(deps);
  return leer(deps).entregas
    .map((e) => ({ ...e, dias: Math.round((new Date(e.fecha + 'T12:00:00Z') - new Date(hoy + 'T12:00:00Z')) / 86400000) }))
    .sort((a, b) => a.fecha.localeCompare(b.fecha));
}

export function eliminarEntrega(criterio, deps = {}) {
  const c = String(criterio || '').trim().toLowerCase();
  const estado = leer(deps);
  const idx = estado.entregas.findIndex((e) => e.id === criterio || (c && e.titulo.toLowerCase().includes(c)));
  if (!c || idx === -1) return { ok: false, error: 'No encuentro esa entrega o examen.' };
  const [borrada] = estado.entregas.splice(idx, 1);
  guardar(estado, deps);
  return { ok: true, borrada };
}
