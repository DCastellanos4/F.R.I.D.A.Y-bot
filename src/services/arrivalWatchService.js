/**
 * arrivalWatchService.js - Aviso de llegada (nº 36)
 *
 * David activa un aviso de llegada a un destino ("avisame cuando llegue a
 * casa"): el bot vigila los mensajes de ubicacion (fija o en vivo) que
 * lleguen de ese chat y, al entrar en el radio del destino, encola UN aviso
 * y completa la vigilancia. Cada aviso es peticion explicita y de un solo
 * uso, con caducidad (por defecto 12 h).
 *
 * Limitacion honesta: el bot no tiene GPS propio; depende de que WhatsApp
 * entregue ubicaciones (compartida en vivo o un pin) en el chat vigilado.
 *
 * Strict Policy: Zero Emojis.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DATA_DIR } from '../config/paths.js';
import { enqueueAlert } from './alertQueueService.js';

export const ARCHIVO_DEFECTO = path.join(DATA_DIR, 'avisos_llegada.json');
export const RADIO_DEFECTO_M = 200;
export const TTL_DEFECTO_MS = 12 * 60 * 60 * 1000;

function rutaArchivo(deps = {}) {
  return deps.rutaArchivo || ARCHIVO_DEFECTO;
}

function leerEstado(deps = {}) {
  try {
    const data = JSON.parse(fs.readFileSync(rutaArchivo(deps), 'utf-8'));
    return { avisos: Array.isArray(data.avisos) ? data.avisos : [] };
  } catch {
    return { avisos: [] };
  }
}

function guardarEstado(estado, deps = {}) {
  const ruta = rutaArchivo(deps);
  fs.mkdirSync(path.dirname(ruta), { recursive: true });
  const tmp = `${ruta}.tmp.${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(estado, null, 2), 'utf-8');
  fs.renameSync(tmp, ruta);
}

function ahora(deps = {}) {
  return deps.ahora ? new Date(deps.ahora) : new Date();
}

function coordenadaValida(lat, lon) {
  const la = Number(lat);
  const lo = Number(lon);
  if (!Number.isFinite(la) || !Number.isFinite(lo)) return null;
  if (la < -90 || la > 90 || lo < -180 || lo > 180) return null;
  return { lat: la, lon: lo };
}

export function distanciaMetros(a, b) {
  const R = 6371000;
  const rad = (g) => (g * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function registrarAvisoLlegada({ chatId, nombre, latitud, longitud, radioMetros } = {}, deps = {}) {
  if (!chatId) return { ok: false, error: 'No se en que chat vigilar tu ubicacion.' };
  const destino = coordenadaValida(latitud, longitud);
  if (!destino) {
    return { ok: false, error: 'Necesito las coordenadas del destino. Comparteme la ubicacion del sitio (pin de WhatsApp) o dime latitud y longitud.' };
  }
  let radio = Number(radioMetros);
  if (!Number.isFinite(radio) || radio <= 0) radio = RADIO_DEFECTO_M;
  radio = Math.min(Math.max(Math.round(radio), 50), 5000);
  const n = String(nombre || '').trim().slice(0, 60) || 'el destino';
  const estado = leerEstado(deps);
  const duplicado = estado.avisos.find((a) => a.estado === 'activo' && a.chatId === chatId && a.nombre.toLowerCase() === n.toLowerCase());
  if (duplicado) return { ok: false, error: `Ya tienes un aviso de llegada activo para ${duplicado.nombre} en este chat.` };
  const ref = ahora(deps);
  const aviso = {
    id: crypto.randomBytes(4).toString('hex'),
    chatId: String(chatId),
    nombre: n,
    destino,
    radioMetros: radio,
    creadoEn: ref.toISOString(),
    caducaEn: new Date(ref.getTime() + TTL_DEFECTO_MS).toISOString(),
    estado: 'activo'
  };
  estado.avisos.push(aviso);
  guardarEstado(estado, deps);
  return { ok: true, aviso };
}

export function listarAvisosLlegada(deps = {}) {
  purgarCaducados(deps);
  return leerEstado(deps).avisos.filter((a) => a.estado === 'activo');
}

export function cancelarAvisoLlegada(criterio, deps = {}) {
  const estado = leerEstado(deps);
  const c = String(criterio || '').trim().toLowerCase();
  const idx = estado.avisos.findIndex((a) => a.estado === 'activo' && (a.id === criterio || (c && a.nombre.toLowerCase().includes(c))));
  if (idx === -1) return { ok: false, error: 'No encuentro ningun aviso de llegada activo con ese nombre.' };
  estado.avisos[idx].estado = 'cancelado';
  guardarEstado(estado, deps);
  return { ok: true, aviso: estado.avisos[idx] };
}

function purgarCaducados(deps = {}) {
  const estado = leerEstado(deps);
  const ref = ahora(deps);
  let cambios = false;
  for (const a of estado.avisos) {
    if (a.estado === 'activo' && new Date(a.caducaEn) <= ref) {
      a.estado = 'caducado';
      cambios = true;
    }
  }
  if (cambios) guardarEstado(estado, deps);
}

/**
 * Procesa una ubicacion entrante (pin o actualizacion de ubicacion en vivo)
 * de un chat. Devuelve { ok, disparados } y encola un aviso por cada
 * vigilancia que entra en radio (una sola vez: queda completada).
 */
export function procesarUbicacionEntrante({ chatId, latitud, longitud } = {}, deps = {}) {
  if (!chatId) return { ok: true, disparados: 0 };
  const pos = coordenadaValida(latitud, longitud);
  if (!pos) return { ok: true, disparados: 0 };
  purgarCaducados(deps);
  const estado = leerEstado(deps);
  const encolar = typeof deps.enqueue === 'function'
    ? deps.enqueue
    : (alerta) => enqueueAlert(alerta, deps.alertQueueOptions || {});
  let disparados = 0;
  for (const a of estado.avisos) {
    if (a.estado !== 'activo' || a.chatId !== String(chatId)) continue;
    const dist = distanciaMetros(pos, a.destino);
    if (dist > a.radioMetros) continue;
    encolar({
      title: `Llegada a ${a.nombre}`,
      details: `La ubicacion de este chat ha entrado en el radio de ${a.radioMetros} m de ${a.nombre} (a ${Math.round(dist)} m). Aviso completado.`,
      priority: 'normal',
      source: 'aviso-llegada'
    });
    a.estado = 'completado';
    a.completadoEn = new Date().toISOString();
    disparados++;
  }
  if (disparados > 0) guardarEstado(estado, deps);
  return { ok: true, disparados };
}
