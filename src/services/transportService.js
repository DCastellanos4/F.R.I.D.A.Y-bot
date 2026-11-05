/**
 * transportService.js - Transporte publico de Madrid (bloque extra).
 *
 * Alcance aprobado por David el 5 nov 2026 (WhatsApp, "sip metelas"): paradas
 * y estaciones favoritas con consulta de llegadas bajo demanda. SIN avisos
 * automaticos: no hay monitor ni alertas proactivas.
 *
 * - EMT (bus): adaptador MobilityLabs, config-required hasta configurar
 *   DAVIS_EMT_CLIENT_ID y DAVIS_EMT_PASS_KEY.
 * - Cercanias: feed GTFS-RT publico de Renfe, operativo sin credenciales.
 * - Metro de Madrid: sin fuente publica verificada de llegadas en vivo; el
 *   bot lo dice y no lo ofrece.
 *
 * Strict Policy: Zero Emojis.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DATA_DIR } from '../config/paths.js';
import { llegadasEmt } from './emtAdapter.js';
import { llegadasCercanias } from './cercaniasAdapter.js';

export const ARCHIVO_DEFECTO = path.join(DATA_DIR, 'transporte.json');
export const TIPOS = ['emt', 'cercanias'];

function rutaArchivo(deps = {}) {
  return deps.rutaArchivo || ARCHIVO_DEFECTO;
}

function leerEstado(deps = {}) {
  try {
    const data = JSON.parse(fs.readFileSync(rutaArchivo(deps), 'utf-8'));
    return { paradas: Array.isArray(data.paradas) ? data.paradas : [] };
  } catch {
    return { paradas: [] };
  }
}

function guardarEstado(estado, deps = {}) {
  const ruta = rutaArchivo(deps);
  fs.mkdirSync(path.dirname(ruta), { recursive: true });
  const tmp = `${ruta}.tmp.${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(estado, null, 2), 'utf-8');
  fs.renameSync(tmp, ruta);
}

export function registrarParadaFavorita({ nombre, tipo, codigo } = {}, deps = {}) {
  const n = String(nombre || '').trim();
  if (!n) return { ok: false, error: 'Ponle un nombre a la parada (por ejemplo: "casa" o "tajamar").' };
  if (n.length > 60) return { ok: false, error: 'Nombre demasiado largo.' };
  const t = String(tipo || '').trim().toLowerCase();
  if (!TIPOS.includes(t)) return { ok: false, error: 'Tipo invalido: usa "emt" (bus) o "cercanias". El Metro no tiene fuente publica de llegadas en vivo.' };
  const c = String(codigo || '').replace(/\D/g, '');
  if (!c) return { ok: false, error: t === 'emt' ? 'Dime el numero de la parada EMT (esta en la marquesina).' : 'Dime el codigo de la estacion de Cercanias.' };
  const estado = leerEstado(deps);
  const duplicada = estado.paradas.find((p) => p.nombre.toLowerCase() === n.toLowerCase());
  if (duplicada) return { ok: false, error: `Ya tienes una parada llamada "${duplicada.nombre}" (${duplicada.tipo} ${duplicada.codigo}).` };
  const parada = { id: crypto.randomBytes(4).toString('hex'), nombre: n, tipo: t, codigo: c, creadaEn: new Date().toISOString() };
  estado.paradas.push(parada);
  guardarEstado(estado, deps);
  return { ok: true, parada };
}

export function listarParadasFavoritas(deps = {}) {
  return leerEstado(deps).paradas;
}

export function eliminarParadaFavorita(criterio, deps = {}) {
  const estado = leerEstado(deps);
  const c = String(criterio || '').trim().toLowerCase();
  const idx = estado.paradas.findIndex((p) => p.id === criterio || (c && p.nombre.toLowerCase().includes(c)));
  if (idx === -1) return { ok: false, error: 'No encuentro ninguna parada favorita con ese nombre.' };
  const [borrada] = estado.paradas.splice(idx, 1);
  guardarEstado(estado, deps);
  return { ok: true, parada: borrada };
}

/**
 * Proximas llegadas de una parada favorita (por nombre o id) o de un codigo
 * directo. deps.fetchFnEmt / fetchFnCercanias permiten inyectar fetch en tests.
 */
export async function proximasLlegadas({ parada, tipo, codigo } = {}, deps = {}) {
  let objetivo = null;
  if (parada) {
    const c = String(parada).trim().toLowerCase();
    objetivo = leerEstado(deps).paradas.find((p) => p.id === parada || p.nombre.toLowerCase().includes(c)) || null;
    if (!objetivo && !codigo) {
      return { ok: false, error: `No tengo ninguna parada favorita que encaje con "${parada}". Registrala primero (por ejemplo: "mi parada de casa es la EMT 1234").` };
    }
  }
  const tipoFinal = (objetivo && objetivo.tipo) || String(tipo || '').toLowerCase();
  const codigoFinal = (objetivo && objetivo.codigo) || String(codigo || '').replace(/\D/g, '');
  if (!TIPOS.includes(tipoFinal) || !codigoFinal) {
    return { ok: false, error: 'Dime la parada (favorita o codigo) y si es EMT o Cercanias. El Metro no tiene fuente publica de llegadas en vivo.' };
  }
  if (tipoFinal === 'emt') {
    const r = await llegadasEmt(codigoFinal, { fetchFn: deps.fetchFnEmt, clientId: deps.clientIdEmt, passKey: deps.passKeyEmt });
    return { ...r, parada: objetivo ? objetivo.nombre : `EMT ${codigoFinal}`, tipo: 'emt' };
  }
  const r = await llegadasCercanias(codigoFinal, { fetchFn: deps.fetchFnCercanias, ahora: deps.ahora });
  return { ...r, parada: objetivo ? objetivo.nombre : `Cercanias ${codigoFinal}`, tipo: 'cercanias' };
}
