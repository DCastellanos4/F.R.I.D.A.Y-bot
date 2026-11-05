/**
 * diaryService.js - Diario personal por voz o texto (nº 43)
 *
 * Entradas de diario por dia (data/diario/AAAA-MM-DD.md). La voz llega ya
 * transcrita por el flujo de audio existente, asi que escribir por voz es
 * el mismo camino. Append por dia; lectura por fecha.
 *
 * Strict Policy: Zero Emojis.
 */
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from '../config/paths.js';

function carpeta(deps = {}) {
  return deps.carpetaDiario || path.join(DATA_DIR, 'diario');
}

function rutaDia(fecha, deps = {}) {
  return path.join(carpeta(deps), `${fecha}.md`);
}

function fechaHoy(deps = {}) {
  if (deps.ahora) return new Date(deps.ahora).toLocaleDateString('sv-SE', { timeZone: 'Europe/Madrid' });
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Madrid' });
}

export function escribirDiario({ texto, fecha } = {}, deps = {}) {
  const t = String(texto || '').trim();
  if (!t) return { ok: false, error: 'Dime que quieres apuntar en el diario.' };
  const f = /^\d{4}-\d{2}-\d{2}$/.test(String(fecha || '')) ? fecha : fechaHoy(deps);
  fs.mkdirSync(carpeta(deps), { recursive: true });
  const ruta = rutaDia(f, deps);
  const hora = new Date().toLocaleTimeString('es-ES', { timeZone: 'Europe/Madrid', hour: '2-digit', minute: '2-digit' });
  const existe = fs.existsSync(ruta);
  const bloque = `${existe ? '\n' : `# Diario del ${f}\n`}\n**${hora}** - ${t}\n`;
  fs.appendFileSync(ruta, bloque, 'utf-8');
  return { ok: true, fecha: f, ruta };
}

export function leerDiario({ fecha } = {}, deps = {}) {
  const f = /^\d{4}-\d{2}-\d{2}$/.test(String(fecha || '')) ? fecha : fechaHoy(deps);
  try {
    return { ok: true, fecha: f, contenido: fs.readFileSync(rutaDia(f, deps), 'utf-8') };
  } catch {
    return { ok: false, error: `No hay entrada del diario para ${f}.` };
  }
}
