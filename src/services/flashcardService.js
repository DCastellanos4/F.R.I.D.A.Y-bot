/**
 * flashcardService.js - Flashcards de repaso espaciado (funcion nº 6)
 *
 * Tarjetas pregunta/respuesta por asignatura con repeticion espaciada
 * (variante ligera de SM-2): lo que fallas vuelve pronto, lo que dominas se
 * espacia. Un monitor periodico encola las tarjetas que tocan en la cola de
 * alertas proactiva para que lleguen por WhatsApp.
 *
 * Strict Policy: Zero Emojis.
 */
import fs from 'node:fs';
import path from 'path';
import crypto from 'node:crypto';
import { DATA_DIR } from '../config/paths.js';
import { enqueueAlert } from './alertQueueService.js';

export const ARCHIVO_DEFECTO = path.join(DATA_DIR, 'flashcards.json');
export const ARCHIVO_CONFIG_DEFECTO = path.join(DATA_DIR, 'flashcards_config.json');
export const INTERVALO_DEFECTO_MS = Number(process.env.DAVIS_FLASHCARDS_INTERVALO_MS) || 4 * 60 * 60 * 1000;
export const MAX_POR_RONDA = 3;
export const ZONA_DEFECTO = 'Europe/Madrid';

function configDefecto() {
  // Repaso proactivo DESACTIVADO hasta opt-in explicito del propietario
  return { activo: false, cadenciaHoras: 4, silencioDesde: 22, silencioHasta: 8, ultimaRondaEn: null };
}

function rutaConfig(deps = {}) {
  return deps.rutaConfig || ARCHIVO_CONFIG_DEFECTO;
}

export function leerConfigFlashcards(deps = {}) {
  try {
    return { ...configDefecto(), ...JSON.parse(fs.readFileSync(rutaConfig(deps), 'utf-8')) };
  } catch {
    return configDefecto();
  }
}

function guardarConfig(config, deps = {}) {
  const destino = rutaConfig(deps);
  fs.mkdirSync(path.dirname(destino), { recursive: true });
  fs.writeFileSync(destino, JSON.stringify(config, null, 2), 'utf-8');
}

/**
 * Configura el repaso proactivo. activo=true solo debe llegar con opt-in
 * explicito del propietario (el ejecutor lo verifica en su mensaje).
 */
export function configurarRepaso({ activo = null, cadenciaHoras = null, silencioDesde = null, silencioHasta = null } = {}, deps = {}) {
  const config = leerConfigFlashcards(deps);
  if (cadenciaHoras !== null) {
    const c = Number(cadenciaHoras);
    if (!Number.isFinite(c) || c < 1 || c > 24) {
      return { ok: false, error: 'cadenciaHoras debe ser un numero entre 1 y 24.' };
    }
    config.cadenciaHoras = c;
  }
  for (const [campo, valor] of [['silencioDesde', silencioDesde], ['silencioHasta', silencioHasta]]) {
    if (valor !== null) {
      const h = Number(valor);
      if (!Number.isInteger(h) || h < 0 || h > 23) {
        return { ok: false, error: `${campo} debe ser una hora entera entre 0 y 23.` };
      }
      config[campo] = h;
    }
  }
  if (activo !== null) config.activo = Boolean(activo);
  guardarConfig(config, deps);
  return { ok: true, config };
}

/** Hora local actual (0-23) en la zona configurada. */
function horaEnZona(deps) {
  const zona = deps.zonaHoraria || ZONA_DEFECTO;
  return Number(new Intl.DateTimeFormat('en-US', { timeZone: zona, hour: '2-digit', hourCycle: 'h23' }).format(ahora(deps)));
}

function enHorarioDeSilencio(config, deps) {
  if (config.silencioDesde === config.silencioHasta) return false;
  const hora = horaEnZona(deps);
  if (config.silencioDesde < config.silencioHasta) {
    return hora >= config.silencioDesde && hora < config.silencioHasta;
  }
  return hora >= config.silencioDesde || hora < config.silencioHasta;
}
const FACILIDAD_INICIAL = 2.5;
const FACILIDAD_MINIMA = 1.3;

function ruta(deps = {}) {
  return deps.rutaArchivo || ARCHIVO_DEFECTO;
}

function leerTarjetas(deps = {}) {
  try {
    return JSON.parse(fs.readFileSync(ruta(deps), 'utf-8'));
  } catch {
    return [];
  }
}

function guardarTarjetas(tarjetas, deps = {}) {
  const destino = ruta(deps);
  fs.mkdirSync(path.dirname(destino), { recursive: true });
  const tmp = `${destino}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(tarjetas, null, 2), 'utf-8');
  fs.renameSync(tmp, destino);
}

function ahora(deps = {}) {
  return deps.ahora ? new Date(deps.ahora) : new Date();
}

export function agregarFlashcard({ asignatura, pregunta, respuesta }, deps = {}) {
  if (typeof pregunta !== 'string' || !pregunta.trim() || typeof respuesta !== 'string' || !respuesta.trim()) {
    return { ok: false, error: 'Pregunta y respuesta son obligatorias.' };
  }
  const tarjetas = leerTarjetas(deps);
  const q = pregunta.trim().toLowerCase();
  const asig = (asignatura || 'general').trim();
  const duplicada = tarjetas.find((t) => t.pregunta.toLowerCase() === q && t.asignatura.toLowerCase() === asig.toLowerCase());
  if (duplicada) {
    return { ok: false, error: 'Ya existe esa tarjeta en esa asignatura.', existente: duplicada };
  }
  const ahoraIso = ahora(deps).toISOString();
  const tarjeta = {
    id: crypto.randomUUID().slice(0, 8),
    asignatura: asig,
    pregunta: pregunta.trim(),
    respuesta: respuesta.trim(),
    repaso: {
      intervaloDias: 0,
      facilidad: FACILIDAD_INICIAL,
      proximaRevision: ahoraIso,
      aciertos: 0,
      fallos: 0,
      ultimaAlertaEn: null
    },
    creadaEn: ahoraIso
  };
  tarjetas.push(tarjeta);
  guardarTarjetas(tarjetas, deps);
  return { ok: true, tarjeta };
}

export function pendientesDeRepaso({ limite = MAX_POR_RONDA } = {}, deps = {}) {
  const ahoraMs = ahora(deps).getTime();
  return leerTarjetas(deps)
    .filter((t) => new Date(t.repaso.proximaRevision).getTime() <= ahoraMs)
    .sort((a, b) => new Date(a.repaso.proximaRevision) - new Date(b.repaso.proximaRevision))
    .slice(0, Math.max(limite, 1));
}

/**
 * Registra una respuesta. calidad: 0-5 (>=3 acierto). Acierto: el intervalo
 * crece con la facilidad. Fallo: vuelve a media jornada y baja la facilidad.
 */
export function registrarRespuesta(id, calidad, deps = {}) {
  const tarjetas = leerTarjetas(deps);
  const tarjeta = tarjetas.find((t) => t.id === id);
  if (!tarjeta) {
    return { ok: false, error: `No existe ninguna tarjeta con ID ${id}.` };
  }
  const q = Number(calidad);
  if (!Number.isFinite(q) || q < 0 || q > 5) {
    return { ok: false, error: 'La calidad debe ser un numero entre 0 y 5.' };
  }
  const ahoraDate = ahora(deps);
  const r = tarjeta.repaso;
  if (new Date(r.proximaRevision).getTime() > ahoraDate.getTime()) {
    return { ok: false, error: `Esa tarjeta no toca ahora; su proxima revision es ${r.proximaRevision.slice(0, 16).replace('T', ' ')}. No se califica dos veces la misma revision.` };
  }
  if (q >= 3) {
    r.aciertos++;
    r.intervaloDias = r.intervaloDias < 1 ? 1 : Math.round(r.intervaloDias * r.facilidad);
    r.facilidad = Math.min(r.facilidad + 0.1, 3.0);
  } else {
    r.fallos++;
    r.intervaloDias = 0.5;
    r.facilidad = Math.max(r.facilidad - 0.2, FACILIDAD_MINIMA);
  }
  r.proximaRevision = new Date(ahoraDate.getTime() + r.intervaloDias * 86400000).toISOString();
  r.ultimaRespuestaEn = ahoraDate.toISOString();
  guardarTarjetas(tarjetas, deps);
  return { ok: true, tarjeta, acierto: q >= 3 };
}

export function listarFlashcards({ asignatura } = {}, deps = {}) {
  let tarjetas = leerTarjetas(deps);
  if (asignatura) {
    const q = asignatura.trim().toLowerCase();
    tarjetas = tarjetas.filter((t) => t.asignatura.toLowerCase().includes(q));
  }
  return tarjetas.sort((a, b) => new Date(a.repaso.proximaRevision) - new Date(b.repaso.proximaRevision));
}

export function resumenFlashcards(deps = {}) {
  const tarjetas = leerTarjetas(deps);
  const ahoraMs = ahora(deps).getTime();
  const porAsignatura = {};
  for (const t of tarjetas) {
    porAsignatura[t.asignatura] = (porAsignatura[t.asignatura] || 0) + 1;
  }
  return {
    total: tarjetas.length,
    pendientes: tarjetas.filter((t) => new Date(t.repaso.proximaRevision).getTime() <= ahoraMs).length,
    porAsignatura
  };
}

/**
 * Encola en la cola de alertas las tarjetas que tocan (sin repetir la misma
 * revision ya alertada). Devuelve cuantas se encolaron.
 */
export function lanzarRondaRepaso(deps = {}) {
  const config = leerConfigFlashcards(deps);
  if (!config.activo) {
    return { ok: true, encoladas: 0, motivo: 'Repaso proactivo desactivado: falta opt-in del propietario.' };
  }
  if (enHorarioDeSilencio(config, deps)) {
    return { ok: true, encoladas: 0, motivo: `Horario de silencio (${config.silencioDesde}:00-${config.silencioHasta}:00).` };
  }
  const ahoraMs = ahora(deps).getTime();
  if (config.ultimaRondaEn && (ahoraMs - new Date(config.ultimaRondaEn).getTime()) < config.cadenciaHoras * 3600000) {
    return { ok: true, encoladas: 0, motivo: `Cadencia: ultima ronda hace menos de ${config.cadenciaHoras} h.` };
  }
  const tarjetas = leerTarjetas(deps);
  const candidatas = tarjetas
    .filter((t) => new Date(t.repaso.proximaRevision).getTime() <= ahoraMs)
    .filter((t) => !t.repaso.ultimaAlertaEn || new Date(t.repaso.ultimaAlertaEn) < new Date(t.repaso.proximaRevision))
    .sort((a, b) => new Date(a.repaso.proximaRevision) - new Date(b.repaso.proximaRevision))
    .slice(0, MAX_POR_RONDA);
  if (candidatas.length === 0) return { ok: true, encoladas: 0 };

  const encolar = typeof deps.enqueue === 'function'
    ? deps.enqueue
    : (alerta) => enqueueAlert(alerta, deps.alertQueueOptions || {});
  for (const t of candidatas) {
    encolar({
      title: `Repaso de ${t.asignatura}: ${t.pregunta}`,
      details: `Responde mentalmente y luego contesta con "respuesta flashcard ${t.id} y tu nota del 0 al 5".\nTarjeta ID: ${t.id}`,
      priority: 'normal',
      source: 'flashcards'
    });
    t.repaso.ultimaAlertaEn = new Date(ahoraMs).toISOString();
  }
  guardarTarjetas(tarjetas, deps);
  if (candidatas.length > 0) {
    config.ultimaRondaEn = new Date(ahoraMs).toISOString();
    guardarConfig(config, deps);
  }
  return { ok: true, encoladas: candidatas.length };
}

let temporizador = null;

export function iniciarMonitorFlashcards(deps = {}) {
  if (temporizador) return { iniciado: true, mensaje: 'El monitor de flashcards ya estaba activo.' };
  if (!leerConfigFlashcards(deps).activo) {
    return { iniciado: false, motivo: 'Repaso proactivo desactivado: el propietario no ha activado las rondas (opt-in).' };
  }
  temporizador = setInterval(() => {
    try {
      lanzarRondaRepaso(deps);
    } catch (err) {
      console.error('[Flashcards] Error en ronda de repaso:', err.message);
    }
  }, deps.intervaloMs || INTERVALO_DEFECTO_MS);
  if (typeof temporizador.unref === 'function') temporizador.unref();
  return { iniciado: true };
}

export function detenerMonitorFlashcards() {
  if (temporizador) {
    clearInterval(temporizador);
    temporizador = null;
  }
  return { ok: true };
}
