import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { DATA_DIR } from '../config/paths.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CARPETA_DATA = DATA_DIR;
const ARCHIVO_RECORDATORIOS = path.join(CARPETA_DATA, 'reminders.json');
const ARCHIVO_LOG_ALERTAS = path.join(CARPETA_DATA, 'alerts.log');

let storeRecordatoriosPorDefecto = null;

export function registrarStoreRecordatoriosPorDefecto(store) {
  storeRecordatoriosPorDefecto = store || null;
}

function storeDe(deps = {}) {
  if (deps.store) return deps.store;
  if (deps.rutaArchivo) return null;
  return storeRecordatoriosPorDefecto;
}

if (!fs.existsSync(CARPETA_DATA)) {
  fs.mkdirSync(CARPETA_DATA, { recursive: true });
}

function leerRecordatorios(deps = {}) {
  const ruta = deps.rutaArchivo || ARCHIVO_RECORDATORIOS;
  try {
    if (!fs.existsSync(ruta)) {
      return [];
    }
    const raw = fs.readFileSync(ruta, 'utf-8');
    return JSON.parse(raw);
  } catch (err) {
    console.error('Error leyendo recordatorios:', err.message);
    return [];
  }
}

function guardarRecordatorios(lista, deps = {}) {
  const ruta = deps.rutaArchivo || ARCHIVO_RECORDATORIOS;
  try {
    fs.writeFileSync(ruta, JSON.stringify(lista, null, 2), 'utf-8');
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

export function crearRecordatorio({ mensaje, minutosEnElFuturo = null, hora = null }, deps = {}) {
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

  const store = storeDe(deps);
  if (store) {
    store.crear({ id, chatId: deps.chatId || '', mensaje: nuevo.mensaje, fechaObjetivo: fechaObjetivo.toISOString() }, deps.tenantId);
    console.log(`[Recordatorio Guardado SQLite] "${nuevo.mensaje}" programado para el ${nuevo.fechaHoraLocal}`);
    return { ok: true, recordatorio: nuevo };
  }

  const lista = leerRecordatorios(deps);
  lista.push(nuevo);
  guardarRecordatorios(lista, deps);

  console.log(`[Recordatorio Guardado] "${nuevo.mensaje}" programado para el ${nuevo.fechaHoraLocal}`);

  return {
    ok: true,
    recordatorio: nuevo
  };
}

export function listarRecordatorios(soloPendientes = true, deps = {}) {
  const store = storeDe(deps);
  if (store) {
    const filas = store.listar(deps.tenantId, soloPendientes ? 'pendiente' : null);
    return filas.map((r) => {
      const ts = new Date(r.fecha_objetivo).getTime();
      const formatoLocal = new Date(ts).toLocaleString('es-ES', {
        timeZone: 'Europe/Madrid',
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
      return {
        id: r.id,
        mensaje: r.mensaje,
        timestamp: ts,
        fechaHoraLocal: formatoLocal,
        completado: r.estado === 'completado',
        creadoEn: r.creado_en
      };
    });
  }

  const lista = leerRecordatorios(deps);
  if (soloPendientes) {
    return lista.filter(r => !r.completado);
  }
  return lista;
}

export function cancelarRecordatorio(criterio, deps = {}) {
  const crit = (criterio || '').toString().toLowerCase().trim();

  const store = storeDe(deps);
  if (store) {
    if (crit === '*' || crit === 'todos' || crit === 'todas' || crit.includes('todo') || crit.includes('toda')) {
      const res = store.cancelarTodos(deps.tenantId);
      return { ok: true, mensaje: `Se han cancelado todos los recordatorios del sistema (${res.cancelados} pendientes eliminados), señor.` };
    }
    const res = store.cancelar(crit, deps.tenantId);
    if (!res.ok) {
      return { ok: false, mensaje: 'No se encontró ningún recordatorio que coincida, señor.' };
    }
    return { ok: true, recordatorio: { id: crit, mensaje: crit }, mensaje: `Recordatorio cancelado con éxito: "${crit}", señor.` };
  }

  const lista = leerRecordatorios(deps);
  if (crit === '*' || crit === 'todos' || crit === 'todas' || crit.includes('todo') || crit.includes('toda')) {
    const pendientes = lista.filter(r => !r.completado).length;
    guardarRecordatorios([], deps);
    return { ok: true, mensaje: `Se han cancelado todos los recordatorios del sistema (${pendientes} pendientes eliminados), señor.` };
  }

  const index = lista.findIndex(r => r.id === crit || r.mensaje.toLowerCase().includes(crit));
  if (index === -1) {
    return { ok: false, mensaje: 'No se encontró ningún recordatorio que coincida, señor.' };
  }

  const [eliminado] = lista.splice(index, 1);
  guardarRecordatorios(lista, deps);

  return { ok: true, recordatorio: eliminado, mensaje: `Recordatorio cancelado con éxito: "${eliminado.mensaje}", señor.` };
}

let intervaloMonitor = null;
let callbackNotificacionGlobal = null;

/**
 * Comprueba y despacha de inmediato cualquier recordatorio vencido.
 */
export async function despacharRecordatoriosPendientes(deps = {}) {
  const store = storeDe(deps);
  if (store) {
    const ahora = Date.now();
    const pendientes = store.listar(deps.tenantId, 'pendiente');
    const disparados = [];

    for (const r of pendientes) {
      const ts = new Date(r.fecha_objetivo).getTime();
      if (ts <= ahora) {
        store.actualizarEstado(r.id, 'completado', deps.tenantId);
        const fechaHoraLocal = new Date(ts).toLocaleString('es-ES', {
          timeZone: 'Europe/Madrid',
          day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
        });
        const rAdaptado = { ...r, timestamp: ts, fechaHoraLocal, completado: true };
        disparados.push(rAdaptado);

        const alertaTexto = `[RECORDATORIO]\n\nNota: ${r.mensaje}\nHora programada: ${fechaHoraLocal}`;
        console.log(`\n========================================`);
        console.log(`[ALERTA DISPARADA]`);
        console.log(alertaTexto);
        console.log(`========================================\n`);

        const entradaLog = `[${new Date().toISOString()}] ${r.mensaje} (${fechaHoraLocal})\n`;
        try {
          fs.appendFileSync(ARCHIVO_LOG_ALERTAS, entradaLog, 'utf-8');
        } catch (err) {}

        if (typeof callbackNotificacionGlobal === 'function') {
          try {
            await callbackNotificacionGlobal(rAdaptado, alertaTexto);
          } catch (err) {
            console.error('Error enviando notificación WhatsApp:', err.message);
          }
        }
      }
    }
    return disparados;
  }

  const lista = leerRecordatorios(deps);
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
    guardarRecordatorios(lista, deps);
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
