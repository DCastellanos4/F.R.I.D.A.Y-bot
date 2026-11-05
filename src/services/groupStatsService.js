/**
 * groupStatsService.js - Estadisticas de grupos (nº 35)
 *
 * Estadisticas del historial que el propio bot ha visto y persistido de un
 * chat (el mismo almacen que usa buscar_en_historial). Solo lectura.
 *
 * Limitacion honesta: solo cubre los mensajes que el bot ha procesado de ese
 * chat (ventana persistida), no todo el historial de WhatsApp del grupo.
 *
 * Strict Policy: Zero Emojis.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DATA_DIR } from '../config/paths.js';

function carpeta(deps = {}) {
  if (deps.carpetaHistorial) return deps.carpetaHistorial;
  return process.env.DAVIS_HISTORY_DIR
    ? path.resolve(process.env.DAVIS_HISTORY_DIR)
    : path.join(DATA_DIR, 'historial');
}

function rutaChat(chatId, deps = {}) {
  const hash = crypto.createHash('sha256').update(String(chatId)).digest('hex').slice(0, 24);
  return path.join(carpeta(deps), `${hash}.json`);
}

/**
 * Estadisticas de los mensajes persistidos de un chat.
 * Devuelve { ok, total, tuyos, mios, porDia, horaMasActiva, cobertura } o { ok:false, error }.
 */
export function estadisticasChat({ chatId } = {}, deps = {}) {
  if (!chatId) return { ok: false, error: 'No se de que chat quieres las estadisticas.' };
  let mensajes;
  try {
    const data = JSON.parse(fs.readFileSync(rutaChat(chatId, deps), 'utf-8'));
    mensajes = Array.isArray(data.mensajes) ? data.mensajes : [];
  } catch {
    return { ok: false, error: 'No tengo historial guardado de ese chat: solo puedo medir lo que he visto desde que estoy conectado.' };
  }
  const porDia = {};
  const porHora = {};
  let tuyos = 0;
  let mios = 0;
  for (const m of mensajes) {
    if (!m || typeof m.content !== 'string') continue;
    if (m.role === 'assistant') mios++;
    else tuyos++;
    const ts = m.ts || m.timestamp || null;
    if (ts) {
      const f = new Date(ts);
      if (!Number.isNaN(f.getTime())) {
        const dia = f.toLocaleDateString('es-ES', { timeZone: 'Europe/Madrid' });
        const hora = Number(new Intl.DateTimeFormat('es-ES', { timeZone: 'Europe/Madrid', hour: '2-digit', hour12: false }).format(f));
        porDia[dia] = (porDia[dia] || 0) + 1;
        porHora[hora] = (porHora[hora] || 0) + 1;
      }
    }
  }
  const horaMasActiva = Object.entries(porHora).sort((a, b) => b[1] - a[1])[0] || null;
  return {
    ok: true,
    total: tuyos + mios,
    tuyos,
    mios,
    porDia,
    horaMasActiva: horaMasActiva ? { hora: Number(horaMasActiva[0]), mensajes: horaMasActiva[1] } : null,
    cobertura: `${mensajes.length} mensajes vistos por el bot en este chat`
  };
}
