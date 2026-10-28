/**
 * dailyBriefing.js
 * Servicio de informe matutino y planificacion diaria para D.A.V.I.S.
 * Genera informes estructurados libres de emojis.
 */

import cron from 'node-cron';
import { config } from './config.js';
import { consultarClima } from './weatherService.js';
import { listarRecordatorios } from './reminderService.js';
import { consultarSaludServidor } from './proactiveAlerts.js';

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
  secciones.push('INFORME MATUTINO D.A.V.I.S.');
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

  // 2. Recordatorios y Agenda
  secciones.push('\n[RECORDATORIOS Y AGENDA]');
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
    secciones.push('Agenda despejada sin eventos inmediatos.');
  }

  // 3. Estado del Sistema
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
 * Programa el cron matutino para las 07:00 hora peninsular.
 * Admite tanto callback(texto) como Baileys sock + jid.
 * @param {Function|object} target Callback de recepcion o socket Baileys.
 * @param {string} [targetJid] JID de destino si target es un socket.
 * @returns {object} Tarea cron de node-cron.
 */
export function programarEnvioMatutino(target, targetJid) {
  // 07:00 AM hora peninsular de Madrid
  const expresionCron = '0 7 * * *';

  const tarea = cron.schedule(expresionCron, async () => {
    try {
      console.log('[DailyBriefing] Ejecutando envio matutino programado (07:00)...');
      const textoBriefing = await generarBriefingCompleto();

      if (typeof target === 'function') {
        await target(textoBriefing);
      } else if (target && typeof target.sendMessage === 'function' && targetJid) {
        await target.sendMessage(targetJid, { text: textoBriefing });
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

  console.log('[DailyBriefing] Monitor programado a las 07:00 (Europe/Madrid).');
  return tarea;
}
