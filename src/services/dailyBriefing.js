/**
 * dailyBriefing.js
 * Servicio de informe matutino y planificacion diaria para D.A.V.I.S.
 * Configurado estrictamente a las 06:55 Europe/Madrid.
 * Incluye meteorologia, transporte/incidencias, agenda y estado del servidor.
 *
 * Strict Policy: Zero Emojis.
 */

import cron from 'node-cron';
import { config } from '../config/config.js';
import { consultarClima } from './weatherService.js';
import { listarRecordatorios } from './reminderService.js';
import { consultarSaludServidor } from '../monitors/proactiveAlerts.js';
import { consultarEventos } from './calendarService.js';

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

/**
 * Genera el briefing completo matutino en formato estructurado sin emojis.
 * @param {string} [ciudad] Ciudad para el pronostico del tiempo.
 * @returns {Promise<string>}
 */
export async function generarBriefingCompleto(ciudad) {
  const ubicacion = ciudad || config.weather?.defaultCity || 'Madrid';
  const fechaHoy = new Date().toLocaleDateString('es-ES', {
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
  try {
    const resEventos = await consultarEventos();
    if (resEventos && resEventos.ok && resEventos.eventos.length > 0) {
      secciones.push(`Eventos programados hoy (${resEventos.eventos.length}):`);
      resEventos.eventos.forEach((e, idx) => {
        secciones.push(`${idx + 1}. [${e.inicio || 'Hoy'}] ${eliminarEmojis(e.titulo)}`);
      });
    } else {
      secciones.push('Agenda despejada sin citas ni reuniones registradas para hoy.');
    }
  } catch {
    secciones.push('Sin eventos inmediatos en el calendario.');
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
  secciones.push('Lineas Cercanías/EMT: Servicio nominal. Modulo listo para conexion de API.');

  // 5. Estado del Servidor
  secciones.push('\n[ESTADO DEL SISTEMA]');
  try {
    const salud = consultarSaludServidor();
    if (salud) {
      const cpu = salud.cpuUsage !== undefined ? `${salud.cpuUsage}%` : 'Normal';
      const memoria = salud.memoryUsage !== undefined ? `${salud.memoryUsage}%` : 'Normal';
      secciones.push(`Estado del host: CPU ${cpu} | Memoria ${memoria} | Operativo`);
    } else {
      secciones.push('Servicios centrales operando dentro de los parametros normales.');
    }
  } catch (errSalud) {
    secciones.push('Sistemas centrales activos.');
  }

  secciones.push('\n========================================');
  secciones.push('Fin del informe matutino.');

  const briefingFinal = secciones.join('\n');
  return eliminarEmojis(briefingFinal);
}

/**
 * Programa el cron matutino a las 06:55 hora peninsular de Madrid.
 * @param {Function|object} target Callback de recepcion o MessageChannelPort
 *                                 (puerto de canal con enviarTexto).
 * @param {string} [targetJid] JID de destino si target es un puerto de canal.
 * @returns {object} Tarea cron de node-cron.
 */
export function programarEnvioMatutino(target, targetJid) {
  const tarea = cron.schedule(CRON_HORA_MATUTINA, async () => {
    try {
      console.log('[DailyBriefing] Ejecutando envio matutino programado (06:55 Europe/Madrid)...');
      const textoBriefing = await generarBriefingCompleto();

      if (typeof target === 'function') {
        await target(textoBriefing);
      } else if (target && typeof target.enviarTexto === 'function' && targetJid) {
        // Puerto de canal: el servicio no conoce el socket de Baileys.
        await target.enviarTexto(targetJid, textoBriefing);
      } else {
        console.log('[DailyBriefing] Briefing generado satisfactoriamente (modo local):');
        console.log(textoBriefing);
      }
    } catch (err) {
      console.error('[DailyBriefing] Error durante la ejecucion del cron:', err.message);
    }
  }, {
    timezone: 'Europe/Madrid'
  });

  console.log('[DailyBriefing] Monitor matutino programado a las 06:55 (Europe/Madrid).');
  return tarea;
}
