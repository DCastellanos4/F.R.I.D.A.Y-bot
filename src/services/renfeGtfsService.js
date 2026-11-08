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
function localizarEntradaZip(bufferZip, nombreBuscado) {
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
      return { metodo, datos: buf.subarray(inicioDatos, inicioDatos + tamComprimido) };
    }
    pos += 46 + largoNombre + largoExtra + largoComentario;
  }
  return null;
}

export function extraerFicheroZip(bufferZip, nombreBuscado) {
  const entrada = localizarEntradaZip(bufferZip, nombreBuscado);
  if (!entrada) return null;
  if (entrada.metodo === 0) return Buffer.from(entrada.datos);
  if (entrada.metodo === 8) return zlib.inflateRawSync(entrada.datos);
  return null;
}

/**
 * Recorre una entrada ZIP (Deflate o Stored) linea a linea SIN cargar el
 * fichero entero en memoria (stop_times.txt supera los 250 MB). onLinea
 * recibe cada linea; si devuelve true se conserva en el resultado.
 */
async function filtrarLineasZip(bufferZip, nombreBuscado, onLinea) {
  const entrada = localizarEntradaZip(bufferZip, nombreBuscado);
  if (!entrada) return null;
  const fuera = [];
  let resto = '';
  const procesar = (texto, final) => {
    const trozos = (resto + texto).split(/\r?\n/);
    resto = final ? '' : trozos.pop();
    for (const l of trozos) {
      if (!l) continue;
      if (onLinea(l)) fuera.push(l);
    }
    if (final && resto && onLinea(resto)) fuera.push(resto);
  };
  if (entrada.metodo === 0) {
    procesar(entrada.datos.toString('utf-8'), true);
    return fuera;
  }
  if (entrada.metodo !== 8) return null;
  const inflador = zlib.createInflateRaw();
  inflador.write(entrada.datos);
  inflador.end();
  let buf = '';
  for await (const chunk of inflador) {
    buf += chunk.toString('utf-8');
    const trozos = buf.split(/\r?\n/);
    buf = trozos.pop();
    for (const l of trozos) {
      if (!l) continue;
      if (onLinea(l)) fuera.push(l);
    }
  }
  if (buf && onLinea(buf)) fuera.push(buf);
  return fuera;
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

// --- Horario programado (stop_times/trips/calendar del GTFS estatico) ---
// El feed GTFS-RT de Renfe solo difunde la PROXIMA parada de los trenes en
// curso, asi que en estaciones con pocos trenes puede no salir nada en vivo.
// Este fallback lista las siguientes salidas PROGRAMADAS del dia (sin info
// en vivo), cacheadas por estacion y fecha.

function rutaCacheHorarios(deps = {}, paradaId, fecha) {
  const base = deps.rutaCacheHorarios || path.join(DATA_DIR, 'horarios-renfe');
  return path.join(base, `${paradaId}-${fecha}.json`);
}

function partesMadrid(ahora) {
  const partes = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).formatToParts(ahora);
  const g = (t) => (partes.find((p) => p.type === t) || {}).value;
  const fecha = `${g('year')}${g('month')}${g('day')}`;
  const diaUtc = new Date(Date.UTC(Number(g('year')), Number(g('month')) - 1, Number(g('day')))).getUTCDay();
  return {
    fecha,
    diaSemana: diaUtc === 0 ? 7 : diaUtc, // 1=lunes .. 7=domingo
    segundosDia: (Number(g('hour')) % 24) * 3600 + Number(g('minute')) * 60 + Number(g('second'))
  };
}

function parseCsvSimple(txt) {
  const lineas = txt.split(/\r?\n/);
  const cab = (lineas[0] || '').split(',').map((s) => s.trim());
  const filas = [];
  for (let i = 1; i < lineas.length; i++) {
    if (!lineas[i] || !lineas[i].trim()) continue;
    filas.push(lineas[i].split(','));
  }
  return { cab, filas };
}

function serviciosActivos(calendarTxt, calendarDatesTxt, fecha, diaSemana) {
  const activos = new Set();
  if (calendarTxt) {
    const { cab, filas } = parseCsvSimple(calendarTxt);
    const iS = cab.indexOf('service_id'), iIni = cab.indexOf('start_date'), iFin = cab.indexOf('end_date');
    const diasCab = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
    const iDia = cab.indexOf(diasCab[diaSemana - 1] || 'monday');
    for (const f of filas) {
      if (iS === -1) continue;
      const enRango = (f[iIni] || '') <= fecha && fecha <= (f[iFin] || '');
      if (enRango && iDia !== -1 && (f[iDia] || '').trim() === '1') activos.add((f[iS] || '').trim());
    }
  }
  if (calendarDatesTxt) {
    const { cab, filas } = parseCsvSimple(calendarDatesTxt);
    const iS = cab.indexOf('service_id'), iF = cab.indexOf('date'), iT = cab.indexOf('exception_type');
    for (const f of filas) {
      if ((f[iF] || '').trim() !== fecha) continue;
      if ((f[iT] || '').trim() === '1') activos.add((f[iS] || '').trim());
      if ((f[iT] || '').trim() === '2') activos.delete((f[iS] || '').trim());
    }
  }
  return activos;
}

/**
 * Siguientes salidas PROGRAMADAS de hoy en una estacion (sin info en vivo).
 * Devuelve { ok, programadas: [{ viaje, segundos, hora, destino }] } o
 * { ok:false, error } si el GTFS no tiene horarios para esa estacion hoy.
 */
export async function horariosProgramados(paradaId, tipo, deps = {}) {
  const estacion = String(paradaId || '').replace(/\D/g, '');
  if (!estacion) return { ok: false, error: 'Estacion invalida.' };
  const ahora = deps.ahora ? new Date(deps.ahora) : new Date();
  const hoy = partesMadrid(ahora);
  const ayer = partesMadrid(new Date(ahora.getTime() - 86400000));
  const medianocheHoy = Math.floor(ahora.getTime() / 1000) - hoy.segundosDia;
  const ruta = rutaCacheHorarios(deps, estacion, hoy.fecha);
  let cache = null;
  try { cache = JSON.parse(fs.readFileSync(ruta, 'utf-8')); } catch { /* sin cache */ }
  // v2: los horarios incluyen destino derivado del GTFS; caches antiguas
  // (sin v, destinos vacios) se ignoran y se regeneran.
  let filas = cache && cache.v === 2 && Array.isArray(cache.horarios) ? cache.horarios : null;
  if (!filas) {
    const url = tipo === 'tren' ? URL_GTFS_LD : URL_GTFS_CERCANIAS;
    const fetchFn = deps.fetchFn || fetch;
    const resp = await fetchFn(url, { signal: AbortSignal.timeout(deps.timeoutMs || 60000) });
    const buf = Buffer.from(await resp.arrayBuffer());
    if (buf.length > MAX_BYTES) throw new Error('El GTFS supera el tamano maximo admitido.');
    const tripsTxt = extraerFicheroZip(buf, 'trips.txt');
    const calendarTxt = extraerFicheroZip(buf, 'calendar.txt');
    const calendarDatesTxt = extraerFicheroZip(buf, 'calendar_dates.txt');
    if (!tripsTxt) return { ok: false, error: 'El GTFS no contiene trips.txt.' };
    const { cab: cabT, filas: filasT } = parseCsvSimple(tripsTxt.toString('utf-8'));
    const iTrip = cabT.indexOf('trip_id'), iServ = cabT.indexOf('service_id'), iHead = cabT.indexOf('trip_headsign');
    const viajeInfo = new Map();
    for (const f of filasT) viajeInfo.set((f[iTrip] || '').trim(), { servicio: (f[iServ] || '').trim(), destino: iHead !== -1 ? (f[iHead] || '').trim() : '' });
    const activosHoy = serviciosActivos(
      calendarTxt ? calendarTxt.toString('utf-8') : null,
      calendarDatesTxt ? calendarDatesTxt.toString('utf-8') : null,
      hoy.fecha, hoy.diaSemana
    );
    const activosAyer = serviciosActivos(
      calendarTxt ? calendarTxt.toString('utf-8') : null,
      calendarDatesTxt ? calendarDatesTxt.toString('utf-8') : null,
      ayer.fecha, ayer.diaSemana
    );
    const encontradas = await filtrarLineasZip(buf, 'stop_times.txt', (l) => {
      const cols = l.split(',');
      const info = viajeInfo.get((cols[0] || '').trim());
      return (cols[3] || '').trim() === estacion && !!info && (activosHoy.has(info.servicio) || activosAyer.has(info.servicio));
    });
    if (!encontradas) return { ok: false, error: 'El GTFS no contiene stop_times.txt.' };
    const ahoraEpoch = Math.floor(ahora.getTime() / 1000);
    const medianocheAyerReal = ahoraEpoch - 86400 - ayer.segundosDia;
    filas = [];
    for (const l of encontradas) {
      const cols = l.split(',');
      const horaTxt = (cols[2] || cols[1] || '').trim();
      const [h, m, s] = horaTxt.split(':').map((x) => Number(x));
      const segundosDia = (h || 0) * 3600 + (m || 0) * 60 + (s || 0);
      const info = viajeInfo.get((cols[0] || '').trim()) || {};
      const horaFmt = `${String(Math.floor(segundosDia / 3600) % 24).padStart(2, '0')}:${String(Math.floor((segundosDia % 3600) / 60)).padStart(2, '0')}`;
      // GTFS: horas >= 24:00 pertenecen al dia de servicio (puede ser ayer).
      if (activosHoy.has(info.servicio)) filas.push({ viaje: (cols[0] || '').trim(), epoch: medianocheHoy + segundosDia, hora: horaFmt, destino: info.destino || '' });
      if (activosAyer.has(info.servicio) && segundosDia >= 86400) filas.push({ viaje: (cols[0] || '').trim(), epoch: medianocheAyerReal + segundosDia, hora: horaFmt, destino: info.destino || '' });
    }
    // Destino del viaje: si trips.txt no trae trip_headsign (caso del GTFS
    // de Cercanias en produccion, detectado 8 nov 2026: todos los destinos
    // vacios), se deriva del propio GTFS oficial: ultima parada del viaje
    // (max stop_sequence) resuelta por stops.txt. No se infiere ningun
    // destino de memoria: si no se puede derivar, queda vacio.
    const sinDestino = new Set(filas.filter((f) => !f.destino).map((f) => f.viaje));
    if (sinDestino.size > 0) {
      const stopsTxt = extraerFicheroZip(buf, 'stops.txt');
      const nombres = new Map();
      if (stopsTxt) for (const e of parsearStops(stopsTxt.toString('utf-8'))) nombres.set(e.id, e.nombre);
      const ultimaParada = new Map();
      await filtrarLineasZip(buf, 'stop_times.txt', (l) => {
        const cols = l.split(',');
        const v = (cols[0] || '').trim();
        if (!sinDestino.has(v)) return false;
        const seq = Number((cols[4] || '').trim()) || 0;
        const prev = ultimaParada.get(v);
        if (!prev || seq > prev.seq) ultimaParada.set(v, { seq, stopId: (cols[3] || '').trim() });
        return false;
      });
      for (const f of filas) {
        if (f.destino) continue;
        const u = ultimaParada.get(f.viaje);
        const nombre = u && nombres.get(u.stopId);
        if (nombre) f.destino = nombre;
      }
    }
    filas.sort((a, b) => a.epoch - b.epoch);
    try {
      fs.mkdirSync(path.dirname(ruta), { recursive: true });
      const tmp = `${ruta}.tmp.${process.pid}`;
      fs.writeFileSync(tmp, JSON.stringify({ v: 2, generadoEn: ahora.toISOString(), fecha: hoy.fecha, estacion, horarios: filas }), 'utf-8');
      fs.renameSync(tmp, ruta);
    } catch { /* sin cache no pasa nada */ }
  }
  const ahoraEpoch = Math.floor(ahora.getTime() / 1000);
  const programadas = filas
    .filter((f) => f.epoch >= ahoraEpoch - 60)
    .slice(0, 5)
    .map((f) => ({ viaje: f.viaje, segundos: f.epoch - ahoraEpoch, hora: f.hora, destino: f.destino, programado: true }));
  return { ok: true, programadas };
}
