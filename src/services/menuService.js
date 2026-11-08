/**
 * menuService.js - Planificador de menus semanal (nº 45)
 *
 * Menu por dia (comida y cena) en una semana concreta. Sugerencias con el
 * modelo bajo demanda; el menu que se guarda es el que David confirma o
 * dicta (la sugerencia nunca se persiste sola).
 *
 * Strict Policy: Zero Emojis.
 */
import fs from '../security/tenantFileSystem.js';
import path from 'node:path';
import { DATA_DIR } from '../config/paths.js';

export const ARCHIVO_DEFECTO = path.join(DATA_DIR, 'menus.json');
const DIAS = ['lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado', 'domingo'];

function rutaArchivo(deps = {}) {
  return deps.rutaArchivo || ARCHIVO_DEFECTO;
}

function leer(deps = {}) {
  try {
    return JSON.parse(fs.readFileSync(rutaArchivo(deps), 'utf-8'));
  } catch {
    return { semanas: {} };
  }
}

function guardar(estado, deps = {}) {
  const ruta = rutaArchivo(deps);
  fs.mkdirSync(path.dirname(ruta), { recursive: true });
  const tmp = `${ruta}.tmp.${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(estado, null, 2), 'utf-8');
  fs.renameSync(tmp, ruta);
}

export function semanaActual(deps = {}) {
  const ref = deps.ahora ? new Date(deps.ahora) : new Date();
  const madrid = new Date(ref.toLocaleString('en-US', { timeZone: 'Europe/Madrid' }));
  const diaSemana = (madrid.getDay() + 6) % 7;
  const lunes = new Date(madrid);
  lunes.setDate(lunes.getDate() - diaSemana);
  return lunes.toISOString().slice(0, 10);
}

export function ponerMenu({ dia, comida, cena, semana } = {}, deps = {}) {
  const d = String(dia || '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  if (!DIAS.includes(d)) return { ok: false, error: 'Dia invalido: lunes a domingo.' };
  const c = String(comida || '').trim();
  const n = String(cena || '').trim();
  if (!c && !n) return { ok: false, error: 'Dime la comida, la cena o ambas.' };
  const estado = leer(deps);
  if (!estado.semanas) estado.semanas = {};
  const s = /^\d{4}-\d{2}-\d{2}$/.test(String(semana || '')) ? semana : semanaActual(deps);
  if (!estado.semanas[s]) estado.semanas[s] = {};
  if (!estado.semanas[s][d]) estado.semanas[s][d] = {};
  if (c) estado.semanas[s][d].comida = c.slice(0, 120);
  if (n) estado.semanas[s][d].cena = n.slice(0, 120);
  guardar(estado, deps);
  return { ok: true, semana: s, dia: d };
}

export function verMenu({ semana } = {}, deps = {}) {
  const estado = leer(deps);
  const s = /^\d{4}-\d{2}-\d{2}$/.test(String(semana || '')) ? semana : semanaActual(deps);
  const datos = (estado.semanas && estado.semanas[s]) || {};
  const lineas = DIAS.filter((d) => datos[d]).map((d) => `- ${d}: ${datos[d].comida || '-'} / ${datos[d].cena || '-'}`);
  return { ok: true, semana: s, lineas, vacio: lineas.length === 0 };
}

/**
 * Propuesta de menu semanal con el modelo. NO se persiste: David la confirma
 * dictandola con poner_menu.
 */
export async function sugerirMenu({ preferencias } = {}, deps = {}) {
  if (typeof deps.chatCompletion !== 'function') {
    return { ok: false, error: 'Necesito el modelo de lenguaje para proponer menus; dimelos tu y los apunto.' };
  }
  const resp = await deps.chatCompletion({
    messages: [
      { role: 'system', content: 'Propone un menu semanal (lunes a domingo, comida y cena) sencillo y variado para un estudiante. Formato: una linea por dia, "lunes: comida / cena". Sin emojis ni introducciones.' },
      { role: 'user', content: String(preferencias || 'Sin preferencias especiales.').slice(0, 500) }
    ]
  });
  const texto = (resp?.message?.content || resp?.content || '').trim();
  if (!texto) return { ok: false, error: 'El modelo no ha devuelto propuesta.' };
  return { ok: true, propuesta: texto };
}
