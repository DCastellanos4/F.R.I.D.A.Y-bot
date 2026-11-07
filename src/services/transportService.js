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
import { llegadasCercanias, llegadasTrenLD } from './cercaniasAdapter.js';
import { resolverEstaciones, cargarIndiceEstaciones, horariosProgramados } from './renfeGtfsService.js';

export const ARCHIVO_DEFECTO = path.join(DATA_DIR, 'transporte.json');
export const TIPOS = ['emt', 'cercanias', 'tren'];

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

export async function registrarParadaFavorita({ nombre, tipo, codigo } = {}, deps = {}) {
  const n = String(nombre || '').trim();
  if (!n) return { ok: false, error: 'Ponle un nombre a la parada (por ejemplo: "casa" o "tajamar").' };
  if (n.length > 60) return { ok: false, error: 'Nombre demasiado largo.' };
  const t = String(tipo || '').trim().toLowerCase();
  if (!TIPOS.includes(t)) return { ok: false, error: 'Tipo invalido: usa "emt" (bus), "cercanias" o "tren" (AVE/larga/media distancia). El Metro no tiene fuente publica de llegadas en vivo.' };
  const c = String(codigo || '').replace(/\D/g, '');
  if (!c) return { ok: false, error: t === 'emt' ? 'Dime el numero de la parada EMT (esta en la marquesina).' : 'Dime el codigo de la estacion de Cercanias.' };
  // Validar el codigo contra el indice GTFS oficial de Renfe para que un
  // codigo equivocado no quede guardado bajo el nombre de otra estacion.
  let estacionOficial = null;
  if (t !== 'emt') {
    try {
      const indice = await cargarIndiceEstaciones(deps);
      estacionOficial = indice.find((e) => e.id === c) || null;
      if (!estacionOficial) return { ok: false, error: `El codigo ${c} no aparece en el indice oficial de estaciones de Renfe. Dime el nombre de la estacion y la busco.` };
    } catch { /* sin indice disponible: se registra sin verificar el codigo */ }
  }
  const estado = leerEstado(deps);
  const duplicada = estado.paradas.find((p) => p.nombre.toLowerCase() === n.toLowerCase());
  if (duplicada) return { ok: false, error: `Ya tienes una parada llamada "${duplicada.nombre}" (${duplicada.tipo} ${duplicada.codigo}).` };
  const parada = { id: crypto.randomBytes(4).toString('hex'), nombre: n, tipo: t, codigo: c, creadaEn: new Date().toISOString() };
  estado.paradas.push(parada);
  guardarEstado(estado, deps);
  return { ok: true, parada, estacion: estacionOficial ? estacionOficial.nombre : null };
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
  let resuelta = null;
  if (parada) {
    const c = String(parada).trim().toLowerCase();
    objetivo = leerEstado(deps).paradas.find((p) => p.id === parada || p.nombre.toLowerCase().includes(c)) || null;
    if (!objetivo && !codigo) {
      // Sin favorita ni codigo: intentar resolver el NOMBRE de la estacion
      // contra el indice GTFS oficial de Renfe (cache local, TTL 7 dias).
      try {
        let candidatas = await resolverEstaciones(parada, deps);
        if (tipo) {
          const t = String(tipo).trim().toLowerCase();
          candidatas = candidatas.filter((e2) => e2.tipo === t);
        }
        // La misma estacion puede salir en el indice de Cercanias y en el de
        // LD con el mismo id: no tiene sentido preguntar por duplicados.
        const vistos = new Set();
        candidatas = candidatas.filter((e2) => {
          if (vistos.has(e2.id)) return false;
          vistos.add(e2.id);
          return true;
        });
        if (candidatas.length === 1) {
          resuelta = candidatas[0];
        } else if (candidatas.length > 1) {
          const lista = candidatas.map((e2) => `- ${e2.nombre} (${e2.tipo === 'tren' ? 'AVE/LD/MD' : 'Cercanias'})`).join('\n');
          return { ok: false, error: `"${parada}" puede ser varias estaciones:\n${lista}\nDime cual.` };
        }
      } catch { /* sin indice disponible: se informa abajo */ }
      if (!resuelta) {
        return { ok: false, error: `No tengo ninguna parada favorita que encaje con "${parada}" y no encuentro esa estacion. Registrala primero (por ejemplo: "mi parada de casa es la EMT 1234") o dime su codigo.` };
      }
    }
  }
  const tipoFinal = (objetivo && objetivo.tipo) || (resuelta && resuelta.tipo) || String(tipo || '').toLowerCase();
  const codigoFinal = (objetivo && objetivo.codigo) || (resuelta && resuelta.id) || String(codigo || '').replace(/\D/g, '');
  if (!TIPOS.includes(tipoFinal) || !codigoFinal) {
    return { ok: false, error: 'Dime la parada (favorita, nombre de estacion o codigo) y si es EMT, Cercanias o tren (AVE/LD/MD). El Metro no tiene fuente publica de llegadas en vivo.' };
  }
  if (tipoFinal === 'emt') {
    const r = await llegadasEmt(codigoFinal, { fetchFn: deps.fetchFnEmt, clientId: deps.clientIdEmt, passKey: deps.passKeyEmt });
    return { ...r, parada: objetivo ? objetivo.nombre : `EMT ${codigoFinal}`, tipo: 'emt' };
  }
  const nombreParada = (objetivo && objetivo.nombre) || (resuelta && resuelta.nombre) || null;
  let r = null;
  if (tipoFinal === 'tren') {
    r = await llegadasTrenLD(codigoFinal, { fetchFn: deps.fetchFnCercanias, ahora: deps.ahora });
  } else {
    r = await llegadasCercanias(codigoFinal, { fetchFn: deps.fetchFnCercanias, ahora: deps.ahora });
  }
  const salida = { ...r, parada: nombreParada || `${tipoFinal === 'tren' ? 'Tren' : 'Cercanias'} ${codigoFinal}`, tipo: tipoFinal };
  // El feed en vivo solo difunde la proxima parada de trenes en curso: si no
  // hay ninguno, ofrecer las siguientes salidas PROGRAMADAS del GTFS estatico.
  if (salida.ok && Array.isArray(salida.llegadas) && salida.llegadas.length === 0) {
    try {
      const prog = await horariosProgramados(codigoFinal, tipoFinal, deps);
      if (prog.ok && prog.programadas.length > 0) {
        salida.programadas = prog.programadas;
        salida.nota = 'No hay trenes con informacion en vivo ahora (el feed de Renfe solo difunde la proxima parada de trenes en curso). Estas son las proximas salidas programadas de hoy.';
      }
    } catch { /* sin horarios: se mantiene la nota del feed en vivo */ }
  }
  return salida;
}
