/**
 * brainDigestService.js - Digest semanal del segundo cerebro (nº 39)
 *
 * Bajo demanda (generar_digest_cerebro) siempre disponible. El envio
 * proactivo semanal solo con opt-in explicito del propietario
 * (configurar_digest_semanal con guard en el ejecutor), una vez por semana.
 *
 * Strict Policy: Zero Emojis.
 */
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from '../config/paths.js';
import { listarMemorias } from './memoryService.js';
import { leerNotas } from './notesReader.js';
import { enqueueAlert } from './alertQueueService.js';

export const ARCHIVO_DEFECTO = path.join(DATA_DIR, 'digest_cerebro.json');
export const INTERVALO_DEFECTO_MS = Number(process.env.DAVIS_DIGEST_INTERVALO_MS) || 24 * 60 * 60 * 1000;

function rutaArchivo(deps = {}) {
  return deps.rutaArchivo || ARCHIVO_DEFECTO;
}

function leerConfig(deps = {}) {
  try {
    return JSON.parse(fs.readFileSync(rutaArchivo(deps), 'utf-8'));
  } catch {
    return {};
  }
}

function guardarConfig(cfg, deps = {}) {
  const ruta = rutaArchivo(deps);
  fs.mkdirSync(path.dirname(ruta), { recursive: true });
  const tmp = `${ruta}.tmp.${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2), 'utf-8');
  fs.renameSync(tmp, ruta);
}

function ahora(deps = {}) {
  return deps.ahora ? new Date(deps.ahora) : new Date();
}

/**
 * Genera el digest de los ultimos N dias. Devuelve { ok, texto, total }.
 * Con modelo: resumen redactado; sin modelo: lista plana y lo declara.
 */
export async function generarDigest({ dias = 7 } = {}, deps = {}) {
  const ref = ahora(deps);
  const corte = new Date(ref.getTime() - dias * 86400000);
  const notas = leerNotas({ limite: 200 }, deps).filter((n) => new Date(n.fecha + 'T23:59:59') >= corte);
  const memorias = listarMemorias().filter((m) => m.fechaRegistro && new Date(m.fechaRegistro) >= corte);
  const total = notas.length + memorias.length;
  if (total === 0) {
    return { ok: true, texto: `Nada nuevo en el segundo cerebro en los ultimos ${dias} dias, David.`, total: 0 };
  }
  const material = [
    ...memorias.map((m) => `[memoria] ${m.sujeto}: ${m.dato}`),
    ...notas.map((n) => `[nota ${n.fecha}] ${n.titulo}: ${n.contenido.slice(0, 200).replace(/\n+/g, ' ')}`)
  ].slice(0, 30);
  if (typeof deps.chatCompletion === 'function') {
    try {
      const resp = await deps.chatCompletion({
        messages: [
          { role: 'system', content: 'Resume en 5-8 lineas lo que David ha guardado esta semana en su segundo cerebro, agrupado por tema, en espanol, sin emojis. No inventes nada que no este en la lista.' },
          { role: 'user', content: material.join('\n') }
        ]
      });
      const texto = (resp?.message?.content || resp?.content || '').trim();
      if (texto) return { ok: true, texto: `Digest del segundo cerebro (${dias} dias, ${total} entradas):\n${texto}`, total };
    } catch {
      // cae a la lista plana
    }
  }
  const plana = material.slice(0, 15).map((l) => '- ' + l).join('\n');
  return { ok: true, texto: `Digest del segundo cerebro (${dias} dias, ${total} entradas; sin resumen porque el modelo no esta disponible):\n${plana}`, total };
}

export function configurarDigestSemanal({ activo } = {}, deps = {}) {
  const cfg = leerConfig(deps);
  cfg.digestSemanal = activo === true;
  guardarConfig(cfg, deps);
  if (cfg.digestSemanal) {
    iniciarMonitorDigest(deps);
    return { ok: true, activo: true };
  }
  detenerMonitorDigest();
  return { ok: true, activo: false };
}

export async function lanzarDigestSemanal(deps = {}) {
  const cfg = leerConfig(deps);
  if (cfg.digestSemanal !== true) return { ok: true, enviado: false };
  const ref = ahora(deps);
  const semana = `${ref.getUTCFullYear()}-S${String(Math.ceil(((ref - new Date(Date.UTC(ref.getUTCFullYear(), 0, 1))) / 86400000 + 1) / 7)).padStart(2, '0')}`;
  if (cfg.ultimoDigestSemana === semana) return { ok: true, enviado: false };
  // Solo el lunes (o el primer dia de la semana en que el bot este vivo).
  const diaMadrid = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Madrid', weekday: 'short' }).format(ref) === 'Mon' ? 1 : 0);
  if (diaMadrid !== 1) return { ok: true, enviado: false };
  const digest = await generarDigest({ dias: 7 }, deps);
  if (digest.total === 0) return { ok: true, enviado: false };
  const encolar = typeof deps.enqueue === 'function'
    ? deps.enqueue
    : (alerta) => enqueueAlert(alerta, deps.alertQueueOptions || {});
  encolar({ title: 'Digest semanal del segundo cerebro', details: digest.texto, priority: 'low', source: 'digest-cerebro' });
  cfg.ultimoDigestSemana = semana;
  guardarConfig(cfg, deps);
  return { ok: true, enviado: true };
}

let temporizador = null;

export function iniciarMonitorDigest(deps = {}) {
  if (temporizador) return { iniciado: true, mensaje: 'El monitor del digest ya estaba activo.' };
  const cfg = leerConfig(deps);
  if (cfg.digestSemanal !== true) {
    return { iniciado: false, motivo: 'Digest semanal desactivado: el propietario lo activa explicitamente (configurar_digest_semanal).' };
  }
  temporizador = setInterval(() => {
    lanzarDigestSemanal(deps).catch((err) => console.error('[Digest] Error en digest semanal:', err.message));
  }, deps.intervaloMs || INTERVALO_DEFECTO_MS);
  if (typeof temporizador.unref === 'function') temporizador.unref();
  return { iniciado: true };
}

export function detenerMonitorDigest() {
  if (temporizador) {
    clearInterval(temporizador);
    temporizador = null;
  }
  return { ok: true };
}
