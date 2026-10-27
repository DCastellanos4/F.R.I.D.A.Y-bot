import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CARPETA_DATA = path.join(__dirname, 'data');
const ARCHIVO_MENSAJES = path.join(CARPETA_DATA, 'scheduled_messages.json');
const ARCHIVO_LOG_ENVIOS = path.join(CARPETA_DATA, 'scheduled_messages.log');

if (!fs.existsSync(CARPETA_DATA)) {
  fs.mkdirSync(CARPETA_DATA, { recursive: true });
}

/**
 * Normaliza un número de teléfono a formato internacional WhatsApp.
 * Si no incluye prefijo internacional y es un número español (9 dígitos empezando por 6, 7, 8 o 9),
 * añade automáticamente el prefijo de país +34.
 */
export function normalizarNumeroTelefono(numeroRaw) {
  if (!numeroRaw && numeroRaw !== 0) {
    return { ok: false, error: 'Número de teléfono no especificado.' };
  }

  let str = String(numeroRaw).trim();

  // Limpiar posibles esquemas o etiquetas de texto
  str = str.replace(/^(tel:|whatsapp:|wa:)/i, '');

  // Manejo de prefijo 00 internacional (ej: 0034612345678 -> 34612345678)
  if (str.startsWith('00')) {
    str = str.substring(2);
  }

  // Eliminar espacios, guiones, paréntesis, puntos y '+'
  let digitos = str.replace(/[\s\-\(\)\.\+]/g, '');

  if (!/^\d+$/.test(digitos)) {
    return { ok: false, error: `El número "${numeroRaw}" contiene caracteres no válidos.` };
  }

  // Si tiene 9 dígitos y empieza por 6, 7, 8 o 9 (móviles y fijos españoles) -> autodefault +34
  if (digitos.length === 9 && /^[6789]/.test(digitos)) {
    digitos = '34' + digitos;
  }

  // Comprobar rango de longitud estándar internacional E.164 (entre 8 y 15 dígitos)
  if (digitos.length < 8 || digitos.length > 15) {
    return {
      ok: false,
      error: `La longitud del número (${digitos.length} dígitos) no es válida para WhatsApp (estándar E.164: entre 8 y 15 dígitos).`
    };
  }

  return {
    ok: true,
    numero: digitos,
    jid: `${digitos}@s.whatsapp.net`
  };
}

/**
 * Lee los mensajes programados desde disco.
 */
export function leerMensajesProgramados() {
  try {
    if (!fs.existsSync(ARCHIVO_MENSAJES)) {
      return [];
    }
    const raw = fs.readFileSync(ARCHIVO_MENSAJES, 'utf-8');
    return JSON.parse(raw);
  } catch (err) {
    console.error('Error leyendo mensajes programados:', err.message);
    return [];
  }
}

/**
 * Guarda la lista de mensajes programados en disco de forma duradera.
 */
export function guardarMensajesProgramados(lista) {
  try {
    fs.writeFileSync(ARCHIVO_MENSAJES, JSON.stringify(lista, null, 2), 'utf-8');
  } catch (err) {
    console.error('Error guardando mensajes programados:', err.message);
  }
}

/**
 * Extrae partes de fecha y hora en el huso horario peninsular (Europe/Madrid).
 */
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

/**
 * Calcula el timestamp Unix de destino a partir de minutos relativos, hora y/o fecha.
 * Soporta envío inmediato (ahora / inmediato / minutosEnElFuturo === 0).
 */
export function calcularTimestampMensaje({ minutosEnElFuturo = null, hora = null, fecha = null, inmediato = false }) {
  const ahora = new Date();

  // Caso 0: Envío inmediato explícito ("ahora", "inmediato" o minutosEnElFuturo === 0)
  if (inmediato || minutosEnElFuturo === 0) {
    return new Date(ahora.getTime());
  }

  // Caso 1: Minutos relativos en el futuro (ej: en 15 minutos)
  if (typeof minutosEnElFuturo === 'number' && minutosEnElFuturo > 0) {
    return new Date(ahora.getTime() + minutosEnElFuturo * 60 * 1000);
  }

  // Caso 2: Hora fija en horario español (Europe/Madrid)
  if (hora && (typeof hora === 'string' || typeof hora === 'number')) {
    const texto = hora.toString().trim();

    if (/ahora|ya|inmediat/i.test(texto)) {
      return new Date(ahora.getTime());
    }

    const match = texto.match(/(\d{1,2})(?::(\d{2}))?/);
    if (match) {
      let targetHour = parseInt(match[1], 10);
      const targetMin = match[2] ? parseInt(match[2], 10) : 0;

      // Soporte para "de la tarde" / "de la noche"
      if (/tarde|noche/i.test(texto) && targetHour < 12) {
        targetHour += 12;
      }

      if (targetHour >= 0 && targetHour <= 23 && targetMin >= 0 && targetMin <= 59) {
        const m = obtenerFechaHoraMadrid(ahora);
        const pad = n => String(n).padStart(2, '0');

        let targetYear = m.year;
        let targetMonth = m.month;
        let targetDay = m.day;

        // Si se especificó fecha
        if (fecha && typeof fecha === 'string') {
          const fNorm = fecha.trim().toLowerCase();
          if (fNorm === 'mañana' || fNorm === 'manana') {
            const manana = new Date(ahora.getTime() + 24 * 60 * 60 * 1000);
            const mManana = obtenerFechaHoraMadrid(manana);
            targetYear = mManana.year;
            targetMonth = mManana.month;
            targetDay = mManana.day;
          } else {
            const isoMatch = fNorm.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
            const esMatch = fNorm.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
            if (isoMatch) {
              targetYear = parseInt(isoMatch[1], 10);
              targetMonth = parseInt(isoMatch[2], 10);
              targetDay = parseInt(isoMatch[3], 10);
            } else if (esMatch) {
              targetDay = parseInt(esMatch[1], 10);
              targetMonth = parseInt(esMatch[2], 10);
              targetYear = parseInt(esMatch[3], 10);
            }
          }
        }

        let fechaStr = `${targetYear}-${pad(targetMonth)}-${pad(targetDay)}T${pad(targetHour)}:${pad(targetMin)}:00`;

        // Ajuste fino según horario de verano/invierno de Madrid (+01:00 o +02:00)
        let objetivo = new Date(fechaStr + '+01:00');
        if (obtenerFechaHoraMadrid(objetivo).hour !== targetHour) {
          objetivo = new Date(fechaStr + '+02:00');
        }

        // Si no se especificó fecha explícita y la hora indicada ya pasó hoy, se programa para mañana
        if (!fecha && objetivo.getTime() <= ahora.getTime()) {
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

  // Por defecto, si no se especificó ni hora futura ni minutos futuros, se tramita para envío inmediato AHORA
  return new Date(ahora.getTime());
}

/**
 * Programa o envía un mensaje de WhatsApp para su entrega (inmediata o futura).
 */
export function programarMensaje({ numero, mensaje, minutosEnElFuturo = null, hora = null, fecha = null, inmediato = false }) {
  if (!mensaje || !String(mensaje).trim()) {
    return { ok: false, error: 'Debe especificar el texto del mensaje a enviar.' };
  }

  const normTel = normalizarNumeroTelefono(numero);
  if (!normTel.ok) {
    return { ok: false, error: normTel.error };
  }

  // Detección automática en el mensaje si no se pasaron argumentos temporales explícitos
  let minCalc = minutosEnElFuturo;
  let horaCalc = hora;
  let esInmediato = inmediato || (minutosEnElFuturo === 0);

  if (!esInmediato && minCalc === null && horaCalc === null && mensaje) {
    const matchMin = mensaje.match(/en\s+(\d+)\s*(?:min|minuto|m\b)/i);
    const matchHoras = mensaje.match(/en\s+(\d+)\s*(?:hora|h\b)/i);
    const matchAHoras = mensaje.match(/a\s+las\s+(\d{1,2}(?::\d{2})?)/i);
    const matchAhora = /\b(ahora|inmediatamente|ya\b|ahorita)/i.test(mensaje);

    if (matchAhora) esInmediato = true;
    else if (matchMin) minCalc = parseInt(matchMin[1], 10);
    else if (matchHoras) minCalc = parseInt(matchHoras[1], 10) * 60;
    else if (matchAHoras) horaCalc = matchAHoras[1];
    else esInmediato = true; // Por defecto si solo se dice "envíale un mensaje a X diciendo Y" -> envío inmediato
  }

  const fechaObjetivo = calcularTimestampMensaje({
    minutosEnElFuturo: esInmediato ? 0 : minCalc,
    hora: horaCalc,
    fecha,
    inmediato: esInmediato
  });

  const id = `sch_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
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
    numero: normTel.numero,
    destinatarioJid: normTel.jid,
    mensaje: String(mensaje).trim(),
    timestamp: fechaObjetivo.getTime(),
    fechaHoraLocal: formatoLocal,
    enviado: false,
    creadoEn: new Date().toISOString()
  };

  const lista = leerMensajesProgramados();
  lista.push(nuevo);
  guardarMensajesProgramados(lista);

  console.log(`[Mensaje ${esInmediato ? 'Inmediato' : 'Programado'} Guardado] Para +${nuevo.numero} ("${nuevo.mensaje}") [${esInmediato ? 'AHORA' : nuevo.fechaHoraLocal}]`);

  // Si es entrega inmediata, disparar el monitor en background sin demoras
  if (esInmediato || fechaObjetivo.getTime() <= Date.now()) {
    setTimeout(() => {
      despacharMensajesPendientes().catch(err => console.error('Error despachando inmediato:', err));
    }, 50);
  }

  return {
    ok: true,
    programado: nuevo,
    inmediato: esInmediato || fechaObjetivo.getTime() <= Date.now() + 5000
  };
}

/**
 * Consulta la lista de mensajes programados.
 */
export function listarMensajesProgramados(soloPendientes = true) {
  const lista = leerMensajesProgramados();
  if (soloPendientes) {
    return lista.filter(m => !m.enviado);
  }
  return lista;
}

/**
 * Cancela un mensaje programado según criterio (ID, teléfono, texto o '*' para todos).
 */
export function cancelarMensajeProgramado(criterio) {
  const lista = leerMensajesProgramados();
  const crit = (criterio || '').toString().toLowerCase().trim();

  if (crit === '*' || crit === 'todos' || crit === 'todas' || crit.includes('todo') || crit.includes('toda')) {
    const pendientes = lista.filter(m => !m.enviado).length;
    guardarMensajesProgramados([]);
    return {
      ok: true,
      mensaje: `Se han cancelado todos los envíos programados del sistema (${pendientes} pendientes eliminados), señor.`
    };
  }

  // Búsqueda por ID, por número de teléfono o por coincidencia en el texto
  const index = lista.findIndex(m => {
    if (m.id.toLowerCase() === crit) return true;
    if (m.numero.includes(crit.replace(/\D/g, '')) && crit.replace(/\D/g, '').length >= 6) return true;
    if (m.mensaje.toLowerCase().includes(crit)) return true;
    return false;
  });

  if (index === -1) {
    return { ok: false, mensaje: 'No se encontró ningún mensaje programado que coincida con el criterio indicado, señor.' };
  }

  const [eliminado] = lista.splice(index, 1);
  guardarMensajesProgramados(lista);

  return {
    ok: true,
    mensaje: `Mensaje programado para +${eliminado.numero} cancelado con éxito: "${eliminado.mensaje}", señor.`,
    eliminado
  };
}

let intervaloMonitorMensajes = null;
let callbackEnvioGlobal = null;

/**
 * Comprueba y despacha de inmediato cualquier mensaje programado pendiente cuyo timestamp haya vencido.
 */
export async function despacharMensajesPendientes() {
  const lista = leerMensajesProgramados();
  const ahora = Date.now();
  let huboCambios = false;
  const despachados = [];

  for (const m of lista) {
    if (!m.enviado && m.timestamp <= ahora) {
      m.enviado = true;
      m.enviadoEn = new Date().toISOString();
      huboCambios = true;
      despachados.push(m);

      console.log(`\n========================================`);
      console.log(`[DESPACHO DE MENSAJE WHATSAPP]`);
      console.log(`Destinatario: +${m.numero} (${m.destinatarioJid})`);
      console.log(`Mensaje: "${m.mensaje}"`);
      console.log(`Hora programada: ${m.fechaHoraLocal}`);
      console.log(`========================================\n`);

      const entradaLog = `[${new Date().toISOString()}] Para: +${m.numero} | Mensaje: "${m.mensaje}" | Programado: ${m.fechaHoraLocal}\n`;
      try {
        fs.appendFileSync(ARCHIVO_LOG_ENVIOS, entradaLog, 'utf-8');
      } catch (err) {
        console.error('Error escribiendo log de envíos programados:', err.message);
      }

      if (typeof callbackEnvioGlobal === 'function') {
        try {
          await callbackEnvioGlobal(m);
        } catch (err) {
          console.error(`Error en callback de envío a +${m.numero}:`, err.message);
        }
      }
    }
  }

  if (huboCambios) {
    guardarMensajesProgramados(lista);
  }

  return despachados;
}

/**
 * Inicia el vigilante de fondo que comprueba cada N milisegundos si ha llegado la hora de despachar algún mensaje programado.
 */
export function iniciarMonitorMensajesProgramados(callbackEnvio = null, intervaloMs = 5000) {
  if (callbackEnvio) callbackEnvioGlobal = callbackEnvio;
  if (intervaloMonitorMensajes) return;

  intervaloMonitorMensajes = setInterval(async () => {
    await despacharMensajesPendientes();
  }, intervaloMs);
}

/**
 * Detiene el monitor (útil para pruebas y reinicios limpios).
 */
export function detenerMonitorMensajesProgramados() {
  if (intervaloMonitorMensajes) {
    clearInterval(intervaloMonitorMensajes);
    intervaloMonitorMensajes = null;
  }
  callbackEnvioGlobal = null;
}
