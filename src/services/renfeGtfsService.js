/**
 * renfeGtfsService.js - Indice de estaciones Renfe a partir del GTFS estatico
 * oficial (data.renfe.com, licencia CC-BY 4.0).
 *
 * Alcance: conexion Renfe pedida por David el 7 nov 2026. Permite resolver el
 * NOMBRE de una estacion (ej: "atocha") a su stop_id y tipo de feed, para no
 * pedirle codigos numericos.
 *
 * Fuentes:
 * - Cercanias/Rodalies: https://ssl.renfe.com/ftransit/Fichero_CER_FOMENTO/fomento_transit.zip
 * - AV/LD/MD: https://ssl.renfe.com/gtransit/Fichero_AV_LD/google_transit.zip
 * Solo se extrae stops.txt y se cachea el indice en disco (TTL 7 dias).
 *
 * Strict Policy: Zero Emojis.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { DATA_DIR } from '../config/paths.js';

const URL_GTFS_CERCANIAS = 'https://ssl.renfe.com/ftransit/Fichero_CER_FOMENTO/fomento_transit.zip';
const URL_GTFS_LD = 'https://ssl.renfe.com/gtransit/Fichero_AV_LD/google_transit.zip';
const MAX_BYTES = 40 * 1024 * 1024;
const TTL_MS = 7 * 24 * 60 * 60 * 1000;

function rutaCache(deps = {}) {
  return deps.rutaCache || path.join(DATA_DIR, 'estaciones-renfe.json');
}

/**
 * Extrae un fichero concreto de un buffer ZIP (metodo Stored o Deflate) sin
 * dependencias externas. Devuelve Buffer o null si no existe la entrada.
 */
export function extraerFicheroZip(bufferZip, nombreBuscado) {
  const buf = Buffer.isBuffer(bufferZip) ? bufferZip : Buffer.from(bufferZip);
  // End of Central Directory: buscar firma 0x06054b50 en los ultimos 64 KB.
  const inicio = Math.max(0, buf.length - 65536 - 22);
  let eocd = -1;
  for (let i = buf.length - 22; i >= inicio; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd === -1) return null;
  const entradas = buf.readUInt16LE(eocd + 10);
  let pos = buf.readUInt32LE(eocd + 16);
  for (let e = 0; e < entradas; e++) {
    if (buf.readUInt32LE(pos) !== 0x02014b50) return null;
    const metodo = buf.readUInt16LE(pos + 10);
    const tamComprimido = buf.readUInt32LE(pos + 20);
    const largoNombre = buf.readUInt16LE(pos + 28);
    const largoExtra = buf.readUInt16LE(pos + 30);
    const largoComentario = buf.readUInt16LE(pos + 32);
    const offsetLocal = buf.readUInt32LE(pos + 42);
    const nombre = buf.subarray(pos + 46, pos + 46 + largoNombre).toString('utf-8');
    if (nombre === nombreBuscado) {
      if (buf.readUInt32LE(offsetLocal) !== 0x04034b50) return null;
      const nombreLocal = buf.readUInt16LE(offsetLocal + 26);
      const extraLocal = buf.readUInt16LE(offsetLocal + 28);
      const inicioDatos = offsetLocal + 30 + nombreLocal + extraLocal;
      const datos = buf.subarray(inicioDatos, inicioDatos + tamComprimido);
      if (metodo === 0) return Buffer.from(datos);
      if (metodo === 8) return zlib.inflateRawSync(datos);
      return null;
    }
    pos += 46 + largoNombre + largoExtra + largoComentario;
  }
  return null;
}

function parsearStops(txt, tipo) {
  const lineas = txt.split(/\r?\n/);
  const cab = lineas[0].split(',').map((s) => s.trim());
  const iId = cab.indexOf('stop_id');
  const iNombre = cab.indexOf('stop_name');
  if (iId === -1 || iNombre === -1) return [];
  const vistos = new Set();
  const out = [];
  for (let i = 1; i < lineas.length; i++) {
    const l = lineas[i];
    if (!l || !l.trim()) continue;
    const cols = l.split(',');
    const id = (cols[iId] || '').trim();
    const nombre = (cols[iNombre] || '').trim();
    if (!id || !nombre || vistos.has(id)) continue;
    vistos.add(id);
    out.push({ id, nombre, tipo });
  }
  return out;
}

function normalizar(texto) {
  return String(texto || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

async function descargarIndice(deps = {}) {
  const fetchFn = deps.fetchFn || fetch;
  const estaciones = [];
  for (const [tipo, url] of [['cercanias', URL_GTFS_CERCANIAS], ['tren', URL_GTFS_LD]]) {
    const resp = await fetchFn(url, { signal: AbortSignal.timeout(deps.timeoutMs || 30000) });
    const buf = Buffer.from(await resp.arrayBuffer());
    if (buf.length > MAX_BYTES) throw new Error(`El GTFS de ${tipo} supera el tamano maximo admitido.`);
    const stops = extraerFicheroZip(buf, 'stops.txt');
    if (!stops) throw new Error(`El GTFS de ${tipo} no contiene stops.txt.`);
    estaciones.push(...parsearStops(stops.toString('utf-8'), tipo));
  }
  return estaciones;
}

/**
 * Indice de estaciones con cache en disco (TTL 7 dias; si falla la descarga se
 * usa la cache caducada, y si no hay cache se propaga el error).
 */
export async function cargarIndiceEstaciones(deps = {}) {
  const ruta = rutaCache(deps);
  let cache = null;
  try { cache = JSON.parse(fs.readFileSync(ruta, 'utf-8')); } catch { /* sin cache */ }
  const fresca = cache && Array.isArray(cache.estaciones) && (Date.now() - new Date(cache.generadoEn).getTime()) < TTL_MS;
  if (fresca) return cache.estaciones;
  try {
    const estaciones = await descargarIndice(deps);
    fs.mkdirSync(path.dirname(ruta), { recursive: true });
    const tmp = `${ruta}.tmp.${process.pid}`;
    fs.writeFileSync(tmp, JSON.stringify({ generadoEn: new Date().toISOString(), estaciones }), 'utf-8');
    fs.renameSync(tmp, ruta);
    return estaciones;
  } catch (err) {
    if (cache && Array.isArray(cache.estaciones)) return cache.estaciones;
    throw err;
  }
}

/**
 * Resuelve un texto (nombre de estacion) a candidatos { id, nombre, tipo }.
 * Devuelve [] si no hay coincidencias razonables.
 */
export async function resolverEstaciones(texto, deps = {}) {
  const q = normalizar(texto);
  if (!q) return [];
  const estaciones = await cargarIndiceEstaciones(deps);
  const conNorm = estaciones.map((e) => ({ ...e, norm: normalizar(e.nombre) }));
  let mejores = conNorm.filter((e) => e.norm === q);
  if (mejores.length === 0) mejores = conNorm.filter((e) => e.norm.split(' ').some((p) => p === q) || e.norm.startsWith(q + ' '));
  if (mejores.length === 0) mejores = conNorm.filter((e) => e.norm.includes(q));
  return mejores.slice(0, 5).map(({ norm, ...resto }) => resto);
}
