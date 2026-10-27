import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CARPETA_DATA = path.join(__dirname, 'data');
const ARCHIVO_RECORDATORIOS = path.join(CARPETA_DATA, 'reminders.json');
const ARCHIVO_LOG_ALERTAS = path.join(CARPETA_DATA, 'alerts.log');

if (!fs.existsSync(CARPETA_DATA)) {
  fs.mkdirSync(CARPETA_DATA, { recursive: true });
}

function leerRecordatorios() {
  try {
    if (!fs.existsSync(ARCHIVO_RECORDATORIOS)) {
      return [];
    }
    const raw = fs.readFileSync(ARCHIVO_RECORDATORIOS, 'utf-8');
    return JSON.parse(raw);
  } catch (err) {
    console.error('Error leyendo recordatorios:', err.message);
    return [];
  }
}

function guardarRecordatorios(lista) {
  try {
    fs.writeFileSync(ARCHIVO_RECORDATORIOS, JSON.stringify(lista, null, 2), 'utf-8');
  } catch (err) {
    console.error('Error guardando recordatorios:', err.message);
  }
}

function obtenerFechaHoraMadrid(fecha = new Date()) {
  const formateador = new Intl.DateTimeFormat('es-ES', {
    timeZone: 'Europe/Madrid',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });
  const parts = formateador.formatToParts(fecha);
  const mapa = {};
  for (const p of parts) mapa[p.type] = p.value;
  return {
    year: parseInt(mapa.year, 10),
    month: parseInt(mapa.month, 10),
    day: parseInt(mapa.day, 10),
    hour: parseInt(mapa.hour, 10),
    minute: parseInt(mapa.minute, 10),
    second: parseInt(mapa.second, 10)
  };
}

function calcularTimestamp(minutosEnElFuturo, horaTexto) {
  const ahora = new Date();

  // Caso 1: Minutos relativos en el futuro (ej: en 15 minutos)
  if (typeof minutosEnElFuturo === 'number' && minutosEnElFuturo > 0) {
    return new Date(ahora.getTime() + minutosEnElFuturo * 60 * 1000);
  }

  // Caso 2: Hora fija en horario español (Europe/Madrid)
  // Soporta "21:30", "08:00", "9:00", pero también "9", "21", "a las 9", "a las 21"
  if (horaTexto && (typeof horaTexto === 'string' || typeof horaTexto === 'number')) {
    const texto = horaTexto.toString().trim();
    const match = texto.match(/(\d{1,2})(?::(\d{2}))?/);
    if (match) {
      const targetHour = parseInt(match[1], 10);
      const targetMin = match[2] ? parseInt(match[2], 10) : 0;

      if (targetHour >= 0 && targetHour <= 23 && targetMin >= 0 && targetMin <= 59) {
        const m = obtenerFechaHoraMadrid(ahora);
        const pad = n => String(n).padStart(2, '0');
        let fechaStr = `${m.year}-${pad(m.month)}-${pad(m.day)}T${pad(targetHour)}:${pad(targetMin)}:00`;

        // Determinar offset exacto de Madrid (+01:00 CET o +02:00 CEST)
        let objetivo = new Date(fechaStr + '+01:00');
        if (obtenerFechaHoraMadrid(objetivo).hour !== targetHour) {
          objetivo = new Date(fechaStr + '+02:00');
        }

        // Si la hora ya pasó hoy en Madrid, es para mañana a esa misma hora
        if (objetivo.getTime() <= ahora.getTime()) {
          const manana = new Date(ahora.getTime() + 24 * 60 * 60 * 1000);
          const mManana = obtenerFechaHoraMadrid(manana);
          fechaStr = `${mManana.year}-${pad(mManana.month)}-${pad(mManana.day)}T${pad(targetHour)}:${pad(targetMin)}:00`;
          objetivo = new Date(fechaStr + '+01:00');
          if (obtenerFechaHoraMadrid(objetivo).hour !== targetHour) {
            objetivo = new Date(fechaStr + '+02:00');
          }
        }

        return objetivo;
      }
    }
  }

  // Por defecto si no se especificó hora: 15 minutos en el futuro
  return new Date(ahora.getTime() + 15 * 60 * 1000);
}

export function crearRecordatorio({ mensaje, minutosEnElFuturo = null, hora = null }) {
  // Detección automática en el mensaje si no se pasaron argumentos explícitos
  let minCalc = minutosEnElFuturo;
  let horaCalc = hora;

  if (!minCalc && !horaCalc && mensaje) {
    const matchMin = mensaje.match(/en\s+(\d+)\s*(?:min|minuto|m\b)/i);
    const matchHoras = mensaje.match(/en\s+(\d+)\s*(?:hora|h\b)/i);
    const matchAHoras = mensaje.match(/a\s+las\s+(\d{1,2}(?::\d{2})?)/i);

    if (matchMin) minCalc = parseInt(matchMin[1], 10);
    else if (matchHoras) minCalc = parseInt(matchHoras[1], 10) * 60;
    else if (matchAHoras) horaCalc = matchAHoras[1];
  }

  const fechaObjetivo = calcularTimestamp(minCalc, horaCalc);
  const id = `rem_${Date.now()}_${Math.floor(Math.random() * 1000)}`;

  const formatoLocal = fechaObjetivo.toLocaleString('es-ES', {
    timeZone: 'Europe/Madrid',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });

  const nuevo = {
    id,
    mensaje: mensaje ? mensaje.trim() : 'Recordatorio',
    timestamp: fechaObjetivo.getTime(),
    fechaHoraLocal: formatoLocal,
    completado: false,
    creadoEn: new Date().toISOString()
  };

  const lista = leerRecordatorios();
  lista.push(nuevo);
  guardarRecordatorios(lista);

  console.log(`[Recordatorio Guardado] "${nuevo.mensaje}" programado para el ${nuevo.fechaHoraLocal}`);

  return {
    ok: true,
    recordatorio: nuevo
  };
}

export function listarRecordatorios(soloPendientes = true) {
  const lista = leerRecordatorios();
  if (soloPendientes) {
    return lista.filter(r => !r.completado);
  }
  return lista;
}

export function cancelarRecordatorio(criterio) {
  const lista = leerRecordatorios();
  const crit = (criterio || '').toString().toLowerCase().trim();

  if (crit === '*' || crit === 'todos' || crit === 'todas' || crit.includes('todo') || crit.includes('toda')) {
    const pendientes = lista.filter(r => !r.completado).length;
    guardarRecordatorios([]);
    return { ok: true, mensaje: `Se han cancelado todos los recordatorios del sistema (${pendientes} pendientes eliminados), señor.` };
  }

  const index = lista.findIndex(r => r.id === crit || r.mensaje.toLowerCase().includes(crit));
  if (index === -1) {
    return { ok: false, mensaje: 'No se encontró ningún recordatorio que coincida, señor.' };
  }

  const [eliminado] = lista.splice(index, 1);
  guardarRecordatorios(lista);

  return { ok: true, recordatorio: eliminado, mensaje: `Recordatorio cancelado con éxito: "${eliminado.mensaje}", señor.` };
}

let intervaloMonitor = null;
let callbackNotificacionGlobal = null;

/**
 * Comprueba y despacha de inmediato cualquier recordatorio vencido.
 */
export async function despacharRecordatoriosPendientes() {
  const lista = leerRecordatorios();
  const ahora = Date.now();
  let huboCambios = false;
  const disparados = [];

  for (const r of lista) {
    if (!r.completado && r.timestamp <= ahora) {
      r.completado = true;
      huboCambios = true;
      disparados.push(r);

      const alertaTexto = `[RECORDATORIO]\n\nNota: ${r.mensaje}\nHora programada: ${r.fechaHoraLocal}`;
      console.log(`\n========================================`);
      console.log(`[ALERTA DISPARADA]`);
      console.log(alertaTexto);
      console.log(`========================================\n`);

      const entradaLog = `[${new Date().toISOString()}] ${r.mensaje} (${r.fechaHoraLocal})\n`;
      try {
        fs.appendFileSync(ARCHIVO_LOG_ALERTAS, entradaLog, 'utf-8');
      } catch (err) {}

      if (typeof callbackNotificacionGlobal === 'function') {
        try {
          await callbackNotificacionGlobal(r, alertaTexto);
        } catch (err) {
          console.error('Error enviando notificación WhatsApp:', err.message);
        }
      }
    }
  }

  if (huboCambios) {
    guardarRecordatorios(lista);
  }

  return disparados;
}

export function iniciarMonitorRecordatorios(callbackNotificacion = null, intervaloMs = 10000) {
  if (callbackNotificacion) callbackNotificacionGlobal = callbackNotificacion;
  if (intervaloMonitor) return;

  intervaloMonitor = setInterval(async () => {
    await despacharRecordatoriosPendientes();
  }, intervaloMs);
}

export function detenerMonitorRecordatorios() {
  if (intervaloMonitor) {
    clearInterval(intervaloMonitor);
    intervaloMonitor = null;
  }
  callbackNotificacionGlobal = null;
}
