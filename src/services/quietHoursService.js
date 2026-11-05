/**
 * quietHoursService.js - Modo desconexion nocturno (nº 50)
 *
 * Mientras esta activo y dentro de la franja (por defecto 23:00-08:00,
 * Europe/Madrid), el drenado de la cola de alertas se pospone: las alertas
 * no urgentes esperan al final de la franja. Los recordatorios puntuales que
 * David programa explicitamente no se tocan.
 *
 * Strict Policy: Zero Emojis.
 */
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from '../config/paths.js';

export const ARCHIVO_DEFECTO = path.join(DATA_DIR, 'modo_nocturno.json');

function rutaArchivo(deps = {}) {
  return deps.rutaArchivo || ARCHIVO_DEFECTO;
}

export function leerConfig(deps = {}) {
  try {
    return JSON.parse(fs.readFileSync(rutaArchivo(deps), 'utf-8'));
  } catch {
    return { activo: false, desde: '23:00', hasta: '08:00' };
  }
}

export function configurarModoNocturno({ activo, desde, hasta } = {}, deps = {}) {
  const cfg = leerConfig(deps);
  cfg.activo = activo === true;
  const horaOk = (h) => /^\d{1,2}:\d{2}$/.test(String(h || ''));
  if (horaOk(desde)) cfg.desde = desde;
  if (horaOk(hasta)) cfg.hasta = hasta;
  if (!horaOk(cfg.desde)) cfg.desde = '23:00';
  if (!horaOk(cfg.hasta)) cfg.hasta = '08:00';
  const ruta = rutaArchivo(deps);
  fs.mkdirSync(path.dirname(ruta), { recursive: true });
  const tmp = `${ruta}.tmp.${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2), 'utf-8');
  fs.renameSync(tmp, ruta);
  return { ok: true, config: cfg };
}

/**
 * Devuelve true si ahora mismo el bot deberia guardar silencio proactivo.
 */
export function enHorarioSilencio(deps = {}) {
  const cfg = leerConfig(deps);
  if (cfg.activo !== true) return false;
  const ref = deps.ahora ? new Date(deps.ahora) : new Date();
  const hm = new Intl.DateTimeFormat('es-ES', { timeZone: 'Europe/Madrid', hour: '2-digit', minute: '2-digit', hour12: false }).format(ref);
  const [h, m] = hm.split(':').map(Number);
  const minutos = h * 60 + m;
  const [dh, dm] = cfg.desde.split(':').map(Number);
  const [hh, hmm] = cfg.hasta.split(':').map(Number);
  const ini = dh * 60 + dm;
  const fin = hh * 60 + hmm;
  if (ini <= fin) return minutos >= ini && minutos < fin;
  return minutos >= ini || minutos < fin;
}
