/**
 * Monitores proactivos, watchdogs del Sector 2, drenado de cola de alertas
 * y resolucion de avisos de salud del clasificador para el canal WhatsApp.
 *
 * Strict Policy: Zero Emojis.
 */

import { iniciarMonitorRecordatorios } from '../../../services/reminderService.js';
import { iniciarMonitorMensajesProgramados, registrarIdWhatsApp } from '../../../services/scheduledMessageService.js';
import { iniciarVigilanteProactivo } from '../../../monitors/proactiveAlerts.js';
import { iniciarSniperWatchdog } from '../../../monitors/sniperService.js';
import { iniciarMonitorRadar } from '../../../services/jobRadarService.js';
import { iniciarMonitorFlashcards } from '../../../services/flashcardService.js';
import { iniciarMonitorOps } from '../../../services/opsService.js';
import { iniciarMonitorHogar } from '../../../services/hogarService.js';
import { iniciarMonitorViajes } from '../../../services/viajesService.js';
import { iniciarMonitorFinanzas } from '../../../services/financeService.js';
import { iniciarMonitorProcesos } from '../../../services/processWatchdogService.js';
import { iniciarMonitorFechas } from '../../../services/specialDatesService.js';
import { iniciarMonitorSnoozes } from '../../../services/snoozeService.js';
import { iniciarMonitorDigest } from '../../../services/brainDigestService.js';
import { enHorarioSilencio, esAlertaUrgente } from '../../../services/quietHoursService.js';
import { programarEnvioMatutino } from '../../../services/dailyBriefing.js';
import { iniciarProgramacionBackup } from '../../../services/backupScheduleService.js';
import { mensajeErrorParaUsuario } from '../../../services/errorSanitizerService.js';
import { drainAlerts, formatAlertText, peekAlerts } from '../../../services/alertQueueService.js';
import { checkAndHealContainers, inspectContainers, clasificarFalloDocker } from '../../../monitors/dockerMonitorService.js';
import { checkAndPurgeIfExceeded } from '../../../system/diskStorageService.js';
import { scanFail2banLog } from '../../../monitors/fail2banMonitorService.js';
import { checkBandwidthSpike } from '../../../monitors/networkMonitorService.js';

let serviciosIniciados = false;

/**
 * Resuelve como notificar cuando el clasificador de intenciones esta degradado.
 * La metrica siempre se registra; el aviso saliente por WhatsApp a David solo
 * se activa con DAVIS_AVISO_SALUD_CLASIFICADOR=1.
 */
export function resolverAvisoSaludClasificador(deps = {}, enviarFn) {
  if (typeof deps.avisarSaludClasificador === 'function') {
    return { fn: deps.avisarSaludClasificador, destino: 'inyectado' };
  }
  if (process.env.DAVIS_AVISO_SALUD_CLASIFICADOR === '1' && typeof enviarFn === 'function') {
    return { fn: (textoAviso) => enviarFn(textoAviso), destino: 'whatsapp-david' };
  }
  return {
    fn: async (textoAviso) => console.warn('[SaludClasificador] Clasificador degradado (aviso por WhatsApp desactivado):', textoAviso),
    destino: 'log'
  };
}

/**
 * Drena y despacha las alertas pendientes de la cola entre procesos al chat de David.
 */
export async function drenarColaAlertas(deps = {}) {
  const fnSilencio = typeof deps.enHorarioSilencio === 'function' ? deps.enHorarioSilencio : enHorarioSilencio;
  const enSilencio = fnSilencio(deps.quietDeps || {});

  const drenarFn = deps.drenar || drainAlerts;
  const esUrgenteFn = deps.esAlertaUrgente || esAlertaUrgente;
  const enviarFn = deps.enviarMensajeADavid;
  const peekFn = deps.peekAlerts || peekAlerts;

  let alertas = [];
  if (enSilencio) {
    const pendientes = typeof peekFn === 'function' ? peekFn(deps.drainOptions || {}) : [];
    const hayUrgentes = Array.isArray(pendientes) && pendientes.some(esUrgenteFn);
    if (!hayUrgentes) {
      return [];
    }
    alertas = drenarFn({ predicate: esUrgenteFn, ...(deps.drainOptions || {}) });
  } else {
    alertas = drenarFn(deps.drainOptions || {});
  }

  for (const alerta of alertas) {
    const textoAlerta = formatAlertText(alerta);
    if (typeof enviarFn === 'function') {
      await enviarFn(textoAlerta);
    }
  }
  return alertas;
}

/**
 * Arranca el watchdog de Docker con sondeo previo y politica explicita.
 * Devuelve { estado, timer } para pruebas.
 */
export async function iniciarWatchdogDocker(deps = {}) {
  const inspect = deps.inspect || inspectContainers;
  const heal = deps.heal || checkAndHealContainers;
  const log = deps.log || console.log;
  const logErr = deps.logErr || console.error;
  const every = deps.every || setInterval;
  const clear = deps.clear || clearInterval;
  const espera = typeof deps.esperaSondeoMs === 'number' ? deps.esperaSondeoMs : 3000;
  const periodo = typeof deps.periodoMs === 'number' ? deps.periodoMs : 60 * 1000;
  const dormir = deps.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));

  let falloInicial = null;
  for (let intento = 0; intento < 2; intento++) {
    try {
      await inspect();
      falloInicial = null;
      break;
    } catch (err) {
      falloInicial = clasificarFalloDocker(err.message);
      if (falloInicial !== 'denegado') {
        if (falloInicial === 'ausente') break;
        logErr('Error en sondeo inicial de Docker:', err.message);
        break;
      }
      if (intento === 0) await dormir(espera);
    }
  }
  if (falloInicial === 'ausente') {
    log('[Watchdog Docker] Docker no instalado en este host; vigilancia desactivada (sin ruido en logs).');
    return { estado: 'ausente', timer: null };
  }
  if (falloInicial === 'denegado') {
    log('[Watchdog Docker] Sin acceso al socket de Docker para este usuario; vigilancia y auto-curacion desactivadas. Se reactiva al reiniciar el bot con acceso concedido.');
    return { estado: 'denegado', timer: null };
  }

  let denegadas = 0;
  let enFallo = false;
  const timer = every(async () => {
    try {
      await heal();
      denegadas = 0;
      if (enFallo) { enFallo = false; log('[Watchdog Docker] Docker vuelve a responder.'); }
    } catch (errDocker) {
      if (clasificarFalloDocker(errDocker.message) === 'denegado') {
        denegadas += 1;
        if (denegadas >= 3) {
          clear(timer);
          log('[Watchdog Docker] Acceso al socket de Docker perdido de forma sostenida; vigilancia desactivada.');
          return;
        }
      } else {
        denegadas = 0;
      }
      if (!enFallo) { enFallo = true; logErr('Error en watchdog de Docker:', errDocker.message); }
    }
  }, periodo);
  return { estado: 'activo', timer };
}

/**
 * Ejecuta una pasada de todos los vigilantes del Sector 2 (Docker, Disco, Fail2ban, Red).
 */
export async function ejecutarWatchdogsSector2(deps = {}) {
  const resultados = {};
  try {
    resultados.docker = await checkAndHealContainers(deps.dockerDeps || {});
  } catch (errDocker) {
    resultados.docker = { error: errDocker.message };
  }
  try {
    resultados.disco = await checkAndPurgeIfExceeded(85, deps.diskDeps || {});
  } catch (errDisco) {
    resultados.disco = { error: errDisco.message };
  }
  try {
    const f2bState = deps.fail2banState || { offset: 0, deduplicationCache: new Map() };
    resultados.fail2ban = await scanFail2banLog(deps.fail2banLog || '/var/log/fail2ban.log', f2bState, deps.fail2banDeps || {});
  } catch (errF2b) {
    resultados.fail2ban = { error: errF2b.message };
  }
  try {
    resultados.red = await checkBandwidthSpike(10.0, deps.netDeps || {});
  } catch (errRed) {
    resultados.red = { error: errRed.message };
  }
  return resultados;
}

/**
 * Registra los disparadores proactivos en segundo plano (vigilante, recordatorios,
 * mensajes programados, sniper, briefing y watchdogs del sistema).
 */
export function inicializarServiciosProactivos({ enviarMensajeADavid, enviarMensajeWhatsApp, numeroDavidAutorizado = '' } = {}) {
  if (serviciosIniciados) return;
  serviciosIniciados = true;

  console.log('[Servicios Proactivos] Vinculando alertas proactivas al chat de David...');

  // 1. Monitor del servidor Oracle y Minecraft (cada 5 minutos)
  iniciarVigilanteProactivo(async (alerta) => {
    await enviarMensajeADavid(`[D.A.V.I.S. - ALERTA DEL SISTEMA]\n\n${alerta}`);
  }, 5 * 60 * 1000);

  // 2. Monitor de recordatorios programados (cada 30 segundos)
  iniciarMonitorRecordatorios(async (recordatorio) => {
    const notaMensaje = (recordatorio && recordatorio.mensaje)
      ? recordatorio.mensaje
      : (typeof recordatorio === 'string' ? recordatorio : 'Recordatorio programado');
    const textoAviso = `[D.A.V.I.S. - RECORDATORIO]\n\nTal como me pediste, David: "${notaMensaje}".\n\nAsunto completado y archivado.`;
    await enviarMensajeADavid(textoAviso);
  }, 30 * 1000);

  // 3. Monitor de mensajes de WhatsApp programados a terceros (cada 15 segundos)
  iniciarMonitorMensajesProgramados(async (m) => {
    console.log(`[WhatsApp Programado] Despachando mensaje programado para +${m.numero}...`);
    try {
      const res = await enviarMensajeWhatsApp(m.destinatarioJid, m.mensaje);
      if (res.ok) {
        if (res.id) registrarIdWhatsApp(m.id, res.id);
        await enviarMensajeADavid(`[D.A.V.I.S. - MENSAJE ENTREGADO]\n\nEl mensaje para el numero +${m.numero} ha sido transmitido con exito:\n"${m.mensaje}".`);
        return true;
      }
      if (res.incierto) {
        await enviarMensajeADavid(`[D.A.V.I.S. - ENTREGA INCIERTA]\n\nEl mensaje para +${m.numero} pudo haberse transmitido pero el canal no lo confirmo. No se reintentara automaticamente para evitar duplicados:\n"${m.mensaje}".`);
        return { incierto: true };
      }
      console.warn(`[WhatsApp Programado] Envio a +${m.numero} no confirmado por el canal; se reintentara.`);
      return false;
    } catch (errEnvio) {
      console.error(`Error en despacho de mensaje programado a +${m.numero}:`, errEnvio.message);
      await enviarMensajeADavid(`[D.A.V.I.S. - AVISO DE DISPACHO]\n\n${mensajeErrorParaUsuario(errEnvio, { contexto: 'despacho', numero: m.numero })}`);
    }
  }, 15 * 1000);

  // 4. Sniper Watchdog de articulos y ofertas (cada 20 minutos)
  iniciarSniperWatchdog(async (alertaOferta) => {
    await enviarMensajeADavid(`[D.A.V.I.S. - AVISO DE PRECIO]\n\n${alertaOferta}`);
  }, 20 * 60 * 1000);

  // 5. Briefing matutino (07:00 AM hora peninsular de Madrid)
  programarEnvioMatutino(async (textoBriefing) => {
    await enviarMensajeADavid(textoBriefing);
  });

  // 6. Drenado periodico de la cola de alertas entre procesos (alertQueueService)
  setInterval(async () => {
    try {
      await drenarColaAlertas({ enviarMensajeADavid });
    } catch (errCola) {
      console.error('Error drenando cola de alertas:', errCola.message);
    }
  }, 5 * 1000);

  // 6b. Radar de ofertas de empleo
  try {
    iniciarMonitorRadar();
  } catch (errRadar) {
    console.error('Error iniciando radar de ofertas:', errRadar.message);
  }

  // 6c. Flashcards, Ops, Hogar, Viajes y Backup
  try {
    iniciarMonitorFlashcards();
    iniciarMonitorOps();
    iniciarMonitorHogar();
    iniciarMonitorViajes();
    iniciarProgramacionBackup();
  } catch (errFlash) {
    console.error('Error iniciando monitor de flashcards:', errFlash.message);
  }

  // 6d. Finanzas
  try {
    iniciarMonitorFinanzas();
  } catch (errFin) {
    console.error('Error iniciando monitor de finanzas:', errFin.message);
  }

  // 6e. Procesos
  try {
    iniciarMonitorProcesos();
  } catch (errProc) {
    console.error('Error iniciando vigilante de procesos:', errProc.message);
  }

  // 6f. Fechas senaladas
  try {
    iniciarMonitorFechas();
  } catch (errFechas) {
    console.error('Error iniciando monitor de fechas senaladas:', errFechas.message);
  }

  // 6g. Snoozes de chats
  try {
    iniciarMonitorSnoozes();
  } catch (errSnooze) {
    console.error('Error iniciando monitor de snoozes:', errSnooze.message);
  }

  // 6h. Digest semanal del segundo cerebro
  try {
    iniciarMonitorDigest();
  } catch (errDigest) {
    console.error('Error iniciando monitor del digest:', errDigest.message);
  }

  // 7. Watchdog de Docker y Auto-Healing (cada 60 segundos)
  iniciarWatchdogDocker();

  // 8. Vigilante de almacenamiento en disco con purga automatica al superar el 85% (cada 5 minutos)
  setInterval(async () => {
    try {
      await checkAndPurgeIfExceeded(85);
    } catch (errDisco) {
      console.error('Error en vigilante de disco:', errDisco.message);
    }
  }, 5 * 60 * 1000);

  // 9. Watchdog de seguridad Fail2ban (cada 30 segundos)
  const fail2banState = { offset: 0, deduplicationCache: new Map() };
  setInterval(async () => {
    try {
      await scanFail2banLog('/var/log/fail2ban.log', fail2banState);
    } catch {
      // Ignorar si el fichero no esta presente en sistemas no Linux
    }
  }, 30 * 1000);

  // 10. Watchdog de trafico de red y picos de ancho de banda (cada 30 segundos)
  setInterval(async () => {
    try {
      await checkBandwidthSpike(10.0);
    } catch {
      // Ignorar si /proc/net/dev no esta disponible
    }
  }, 30 * 1000);

  console.log(`[Servicios Proactivos] Todos los monitores conectados al WhatsApp de David (+${numeroDavidAutorizado}).`);
}
