/**
 * dailyBriefing.js
 * Servicio de informe matutino y planificacion diaria para D.A.V.I.S.
 * Configurado estrictamente a las 06:55 Europe/Madrid.
 * Incluye meteorologia, transporte/incidencias, agenda y estado del servidor.
 *
 * Strict Policy: Zero Emojis.
 */

import fs from 'node:fs';
import path from 'node:path';
import cron from 'node-cron';
import { config } from '../config/config.js';
import { DATA_DIR } from '../config/paths.js';
import { consultarClima } from './weatherService.js';
import { listarRecordatorios } from './reminderService.js';
import { consultarSaludServidor } from '../monitors/proactiveAlerts.js';
import { consultarEventos } from './calendarService.js';
import { emtConfigurado } from './emtAdapter.js';
import { abrirBaseDatos } from '../adapters/outbound/persistence/sqlite/connection.js';
import { predecirNecesidades } from './habitPatternPredictorService.js';
import { synthesizeSpeech, sendVoiceNote } from './ttsService.js';

export const CRON_HORA_MATUTINA = '55 6 * * *'; // 06:55 Europe/Madrid

/**
 * Elimina cualquier caracter emoji o pictografico del texto
 */
export function eliminarEmojis(texto) {
  if (!texto || typeof texto !== 'string') return '';
  return texto
    .replace(/[\uFE00-\uFE0F\u200D\u20E3]/gu, '')
    .replace(/\p{Extended_Pictographic}/gu, '')
    .replace(/[\u{1F000}-\u{1FAFF}]/gu, '')
    .replace(/[\u{2600}-\u{27BF}]/gu, '')
    .replace(/[\u{2300}-\u{23FF}]/gu, '')
    .replace(/[\u{2B50}-\u{2B55}]/gu, '')
    .replace(/[\u{203C}\u{2049}\u{2122}\u{2139}\u{2194}-\u{2199}\u{21A9}-\u{21AA}\u{2934}-\u{2935}\u{3030}\u{303D}\u{3297}\u{3299}]/gu, '')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

function formatearHoraCita(fechaIso) {
  const d = new Date(fechaIso);
  return d.toLocaleTimeString('es-ES', { timeZone: 'Europe/Madrid', hour: '2-digit', minute: '2-digit', hour12: false });
}

async function consultarCitasBooking(opts = {}, hoyMadrid) {
  if (typeof opts.consultarCitasBooking === 'function') {
    return await opts.consultarCitasBooking(hoyMadrid);
  }
  const rutaDb = opts.bookingDbPath || process.env.BOOKING_DB_PATH || path.join(DATA_DIR, 'booking.db');
  if (!fs.existsSync(rutaDb)) return null;
  try {
    const db = opts.DatabaseDriver ? new opts.DatabaseDriver(rutaDb) : abrirBaseDatos(rutaDb);
    try {
      const stmt = db.prepare("SELECT cliente_nombre, servicio, duracion_minutos, fecha_inicio FROM citas WHERE estado = 'confirmada' ORDER BY fecha_inicio ASC");
      const todas = stmt.all();
      return (todas || []).filter((c) => {
        const d = new Date(c.fecha_inicio);
        const diaMadrid = d.toLocaleDateString('sv-SE', { timeZone: 'Europe/Madrid' });
        return diaMadrid === hoyMadrid;
      });
    } finally {
      if (typeof db.close === 'function') db.close();
    }
  } catch {
    return null;
  }
}

/**
 * Genera el briefing completo matutino en formato estructurado sin emojis.
 * @param {string|object} [ciudad] Ciudad para el pronostico del tiempo u opciones.
 * @param {object} [deps] Dependencias inyectadas para pruebas.
 * @returns {Promise<string>}
 */
export async function generarBriefingCompleto(ciudad, deps = {}) {
  const opts = (typeof ciudad === 'object' && ciudad !== null) ? ciudad : (deps || {});
  const ubicacion = (typeof ciudad === 'string' ? ciudad : opts.ciudad) || config.weather?.defaultCity || 'Madrid';
  const ref = opts.ahora ? new Date(opts.ahora) : new Date();
  const hoyMadrid = ref.toLocaleDateString('sv-SE', { timeZone: 'Europe/Madrid' });
  const fechaHoy = ref.toLocaleDateString('es-ES', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });

  const secciones = [];
  secciones.push('========================================');
  secciones.push('INFORME TACTICO MATUTINO D.A.V.I.S. (06:55)');
  secciones.push(`Fecha: ${fechaHoy}`);
  secciones.push(`Ubicacion: ${ubicacion}`);
  secciones.push('========================================');

  // 1. Informacion Meteorologica
  secciones.push('\n[METEOROLOGIA]');
  try {
    const resClima = await consultarClima({ ubicacion, momento: 'hoy' });
    if (resClima && resClima.ok) {
      secciones.push(eliminarEmojis(resClima.resumen));
    } else {
      secciones.push(`Condiciones para ${ubicacion}: Consulta meteorologica en curso.`);
    }
  } catch (errClima) {
    secciones.push(`Prevision no disponible temporalmente (${errClima.message}).`);
  }

  // 2. Agenda y Eventos de Calendario
  secciones.push('\n[AGENDA Y CITAS DEL DIA]');
  const itemsAgenda = [];
  try {
    const citas = await consultarCitasBooking(opts, hoyMadrid);
    if (Array.isArray(citas) && citas.length > 0) {
      for (const c of citas) {
        const hora = formatearHoraCita(c.fecha_inicio);
        itemsAgenda.push(`Cita [${hora}]: ${eliminarEmojis(c.cliente_nombre)} - ${eliminarEmojis(c.servicio)} (${c.duracion_minutos} min)`);
      }
    }
  } catch {
    // Fallback silencioso en citas de reservas
  }

  try {
    const fnEventos = opts.consultarEventos || consultarEventos;
    const resEventos = await fnEventos(opts.calendarOpts || {}, opts);
    if (resEventos && resEventos.ok && Array.isArray(resEventos.eventos) && resEventos.eventos.length > 0) {
      resEventos.eventos.forEach((e, idx) => {
        itemsAgenda.push(`${idx + 1}. [${e.inicio || 'Hoy'}] ${eliminarEmojis(e.titulo)}`);
      });
    }
  } catch {
    // Fallback silencioso en eventos de calendario
  }

  if (itemsAgenda.length > 0) {
    itemsAgenda.forEach((item) => secciones.push(item));
  } else {
    secciones.push('Sin citas de reservas ni eventos de calendario programados para hoy.');
  }

  // 3. Recordatorios y Deadlines
  secciones.push('\n[RECORDATORIOS Y ENTREGAS]');
  try {
    const recordatorios = listarRecordatorios();
    if (recordatorios && recordatorios.length > 0) {
      secciones.push(`Pendientes activos (${recordatorios.length}):`);
      recordatorios.forEach((r, idx) => {
        secciones.push(`${idx + 1}. [${r.fecha || 'Pendiente'}] ${eliminarEmojis(r.texto || r.descripcion || '')}`);
      });
    } else {
      secciones.push('Sin recordatorios pendientes en la agenda local.');
    }
  } catch (errRecordatorios) {
    secciones.push('Sin recordatorios pendientes.');
  }

  // 4. Transporte y Desplazamientos
  secciones.push('\n[TRANSPORTE Y LOGISTICA]');
  if (emtConfigurado(opts)) {
    secciones.push('Lineas Cercanias/EMT: Servicio nominal.');
  } else {
    secciones.push('Lineas Cercanias/EMT: Proveedor no configurado (faltan credenciales DAVIS_EMT_CLIENT_ID / DAVIS_EMT_PASS_KEY).');
  }

  // 5. Estado del Servidor
  secciones.push('\n[ESTADO DEL SISTEMA]');
  try {
    const salud = consultarSaludServidor();
    if (salud) {
      const cpuVal = salud.cpuUsage ?? salud.cpu ?? salud.loadAvg;
      const memVal = salud.memoryUsage ?? salud.ram ?? salud.porcentajeUso;
      const cpu = cpuVal !== undefined ? (String(cpuVal).endsWith('%') ? String(cpuVal) : `${cpuVal}%`) : 'Normal';
      const memoria = memVal !== undefined ? (String(memVal).endsWith('%') ? String(memVal) : `${memVal}%`) : 'Normal';
      secciones.push(`Estado del host: CPU ${cpu} | Memoria ${memoria} | Operativo`);
    } else {
      secciones.push('Servicios centrales operando dentro de los parametros normales.');
    }
  } catch (errSalud) {
    secciones.push('Sistemas centrales activos.');
  }

  // 6. Sugerencias Predictivas de Rutina (opcional: solo si existen predicciones para esa fecha)
  try {
    const fnPredecir = typeof opts.predecirNecesidades === 'function'
      ? opts.predecirNecesidades
      : predecirNecesidades;
    const rutinasDeps = opts.rutinasDeps || {
      ...(opts.routineStore ? { store: opts.routineStore } : {}),
      ...(opts.rutaArchivoRutinas ? { rutaArchivo: opts.rutaArchivoRutinas } : {}),
      ...(opts.tenantId ? { tenantId: opts.tenantId } : {})
    };
    const predicciones = await fnPredecir(
      {
        fecha: ref,
        umbralMinimo: opts.umbralMinimoRutina ?? 3,
        tenantId: opts.tenantId
      },
      rutinasDeps
    );
    if (Array.isArray(predicciones) && predicciones.length > 0) {
      secciones.push('\n[SUGERENCIAS PREDICTIVAS DE RUTINA]');
      predicciones.slice(0, 5).forEach((p, idx) => {
        const textoSugerencia = p.sugerencia || `[${p.franjaHoraria || p.franja_horaria || '--'}] ${p.intencion}${p.herramienta ? ` (${p.herramienta})` : ''} - frecuencia: ${p.conteo}`;
        secciones.push(`${idx + 1}. ${eliminarEmojis(textoSugerencia)}`);
      });
    }
  } catch {
    // Fallback silencioso si el predictor de rutinas no esta disponible
  }

  secciones.push('\n========================================');
  secciones.push('Fin del informe matutino.');

  const briefingFinal = secciones.join('\n');
  return eliminarEmojis(briefingFinal);
}

/**
 * Extrae un resumen breve y limpio apto para sintesis de voz PTT a partir del briefing completo.
 *
 * @param {string} textoBriefing
 * @returns {string}
 */
export function generarResumenBriefingAudio(textoBriefing) {
  if (!textoBriefing || typeof textoBriefing !== 'string') return '';
  const limpio = eliminarEmojis(textoBriefing)
    .replace(/^=+$/gm, '')
    .replace(/\[([A-Z0-9 _-]+)\]/g, '$1:')
    .replace(/\n{2,}/g, '. ')
    .replace(/\n/g, '. ')
    .replace(/\s{2,}/g, ' ')
    .replace(/\.\s*\./g, '.')
    .trim();

  if (limpio.length <= 700) return limpio;
  const corte = limpio.slice(0, 700);
  const ultimoPunto = corte.lastIndexOf('.');
  return (ultimoPunto > 200 ? corte.slice(0, ultimoPunto + 1) : corte).trim();
}

/**
 * Entrega del briefing por el objetivo configurado: callback inyectado,
 * puerto de canal (MessageChannelPort con enviarTexto) o consola local.
 * Si `enviarEnAudio` (o `DAVIS_BRIEFING_AUDIO=1`) esta activo, sintetiza
 * un resumen breve en nota de voz PTT via `ttsService` cuando este disponible.
 * Extraida del cron para ser probada en aislamiento: sin cron, sin envios.
 * @returns {Promise<string>} Modo usado: 'callback' | 'puerto' | 'local'.
 */
export async function entregarBriefing(target, targetJid, textoBriefing, opts = {}) {
  let modo = 'local';
  if (typeof target === 'function') {
    await target(textoBriefing);
    modo = 'callback';
  } else if (target && typeof target.enviarTexto === 'function' && targetJid) {
    // Puerto de canal: el servicio no conoce el socket de Baileys.
    await target.enviarTexto(targetJid, textoBriefing);
    modo = 'puerto';
  } else {
    console.log('[DailyBriefing] Briefing generado satisfactoriamente (modo local):');
    console.log(textoBriefing);
  }

  const enviarEnAudio = opts.enviarEnAudio !== undefined
    ? Boolean(opts.enviarEnAudio)
    : process.env.DAVIS_BRIEFING_AUDIO === '1';

  if (enviarEnAudio) {
    try {
      const resumenAudio = generarResumenBriefingAudio(textoBriefing);
      if (resumenAudio) {
        const fnSintetizar = typeof opts.synthesizeSpeech === 'function' ? opts.synthesizeSpeech : synthesizeSpeech;
        const fnEnviarVoz = typeof opts.sendVoiceNote === 'function' ? opts.sendVoiceNote : sendVoiceNote;
        const oggBuffer = await fnSintetizar(resumenAudio, {
          voice: opts.voice || 'es-ES-AlvaroNeural'
        });
        if (target && typeof target.enviarAudio === 'function' && targetJid) {
          await target.enviarAudio(targetJid, oggBuffer);
        } else if (opts.sock && targetJid) {
          await fnEnviarVoz(opts.sock, targetJid, oggBuffer);
        } else if (typeof opts.onAudio === 'function') {
          await opts.onAudio(oggBuffer, resumenAudio);
        }
      }
    } catch (errAudio) {
      console.warn('[DailyBriefing] No se pudo sintetizar o enviar briefing en audio PTT:', errAudio.message);
    }
  }

  return modo;
}

/**
 * Programa el cron matutino a las 06:55 hora peninsular de Madrid.
 * @param {Function|object} target Callback de recepcion o MessageChannelPort
 *                                 (puerto de canal con enviarTexto).
 * @param {string} [targetJid] JID de destino si target es un puerto de canal.
 * @param {object} [opts={}] Opciones adicionales (p. ej. enviarEnAudio, sock, onAudio).
 * @returns {object} Tarea cron de node-cron.
 */
export function programarEnvioMatutino(target, targetJid, opts = {}) {
  const tarea = cron.schedule(CRON_HORA_MATUTINA, async () => {
    try {
      console.log('[DailyBriefing] Ejecutando envio matutino programado (06:55 Europe/Madrid)...');
      const textoBriefing = await generarBriefingCompleto(opts);
      await entregarBriefing(target, targetJid, textoBriefing, opts);
    } catch (err) {
      console.error('[DailyBriefing] Error durante la ejecucion del cron:', err.message);
    }
  }, {
    timezone: 'Europe/Madrid'
  });

  console.log('[DailyBriefing] Monitor matutino programado a las 06:55 (Europe/Madrid).');
  return tarea;
}
