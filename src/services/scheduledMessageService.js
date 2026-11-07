import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { DATA_DIR } from '../config/paths.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CARPETA_DATA = DATA_DIR;
const ARCHIVO_MENSAJES = path.join(CARPETA_DATA, 'scheduled_messages.json');
const ARCHIVO_LOG_ENVIOS = path.join(CARPETA_DATA, 'scheduled_messages.log');

// Acuse de recibo: un mensaje 'enviado' cuyo acuse nunca llega se marca
// 'incierto' pasado este plazo (configurable). NUNCA se reintenta solo:
// reenviar podria duplicar un mensaje que si llego.
export const TIMEOUT_ACUSE_MS = Number.parseInt(process.env.DAVIS_ACUSE_TIMEOUT_MS || '600000', 10) || 600000;

// Rotacion del log de envios (append-only por diseno): al superar el tope,
// el log actual pasa a .1 conservandose como copia (el contenido nunca se
// pierde sin respaldo; el backup anterior se reemplaza) y se empieza uno
// nuevo. Un solo backup: acotado y suficiente para el VPS.
export const LOG_ENVIOS_MAX_BYTES = Number.parseInt(process.env.DAVIS_LOG_ENVIOS_MAX_BYTES || '1048576', 10) || 1048576;

function rotarLogEnviosSiNecesario() {
  try {
    if (!fs.existsSync(ARCHIVO_LOG_ENVIOS)) return;
    const tam = fs.statSync(ARCHIVO_LOG_ENVIOS).size;
    if (tam < LOG_ENVIOS_MAX_BYTES) return;
    const backup = `${ARCHIVO_LOG_ENVIOS}.1`;
    fs.renameSync(ARCHIVO_LOG_ENVIOS, backup);
    console.log(`[LOG] scheduled_messages.log rotado (${tam} bytes); copia conservada en ${path.basename(backup)}`);
  } catch (err) {
    console.error('Error rotando log de envios:', err.message);
  }
}

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
export function leerMensajesProgramados(deps = {}) {
  const ruta = deps.rutaArchivo || ARCHIVO_MENSAJES;
  try {
    if (!fs.existsSync(ruta)) {
      return [];
    }
    const raw = fs.readFileSync(ruta, 'utf-8');
    return JSON.parse(raw);
  } catch (err) {
    console.error('Error leyendo mensajes programados:', err.message);
    return [];
  }
}

/**
 * Guarda la lista de mensajes programados en disco de forma duradera.
 */
export function guardarMensajesProgramados(lista, deps = {}) {
  const ruta = deps.rutaArchivo || ARCHIVO_MENSAJES;
  try {
    fs.writeFileSync(ruta, JSON.stringify(lista, null, 2), 'utf-8');
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
    estado: 'programado', // programado -> enviado -> entregado/leido | fallido
    intentos: 0,
    ultimoError: null,
    whatsappId: null,
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
export function listarMensajesProgramados(soloPendientes = true, deps = {}) {
  const lista = leerMensajesProgramados(deps);
  if (soloPendientes) {
    return lista.filter(m => !m.enviado);
  }
  return lista;
}

/**
 * Cancela un mensaje programado según criterio (ID, teléfono, texto o '*' para todos).
 */
export function cancelarMensajeProgramado(criterio, deps = {}) {
  const lista = leerMensajesProgramados(deps);
  const crit = (criterio || '').toString().toLowerCase().trim();

  if (crit === '*' || crit === 'todos' || crit === 'todas' || crit.includes('todo') || crit.includes('toda')) {
    const pendientes = lista.filter(m => !m.enviado).length;
    guardarMensajesProgramados([], deps);
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
  guardarMensajesProgramados(lista, deps);

  return {
    ok: true,
    mensaje: `Mensaje programado para +${eliminado.numero} cancelado con éxito: "${eliminado.mensaje}", señor.`,
    eliminado
  };
}

let intervaloMonitorMensajes = null;
let callbackEnvioGlobal = null;

export const MAX_INTENTOS_ENVIO = 3;

/**
 * Comprueba y despacha de inmediato cualquier mensaje programado pendiente cuyo timestamp haya vencido.
 * Devuelve el array de despachados con la propiedad .fallidos para notificar errores.
 */
export async function despacharMensajesPendientes() {
  const lista = leerMensajesProgramados();
  const ahora = Date.now();
  let huboCambios = false;
  const despachados = [];
  const fallidos = [];
  // Registros que ESTA pasada muta; el guardado final los fusiona sobre una
  // lectura fresca en vez de volcar el snapshot antiguo (ver nota al final).
  const modificados = new Map();

  for (const m of lista) {
    if (!m.enviado && m.timestamp <= ahora) {
      huboCambios = true;

      console.log(`\n========================================`);
      console.log(`[DESPACHO DE MENSAJE WHATSAPP]`);
      console.log(`Destinatario: +${m.numero} (${m.destinatarioJid})`);
      console.log(`Mensaje: "${m.mensaje}"`);
      console.log(`Hora programada: ${m.fechaHoraLocal}`);
      console.log(`========================================\n`);

      // El mensaje solo se marca como enviado cuando el canal confirma la
      // entrega al sistema de WhatsApp (callback resuelto sin error).
      // Un fallo NO se traga: se registra y se reintenta hasta MAX_INTENTOS.
      let resultadoEnvio;
      let errorEnvio = null;
      if (typeof callbackEnvioGlobal === 'function') {
        try {
          resultadoEnvio = await callbackEnvioGlobal(m);
        } catch (err) {
          errorEnvio = err.message;
          console.error(`Error en callback de envío a +${m.numero}:`, err.message);
        }
      }

      // Resultado incierto: el canal no confirmo ni descarto la transmision.
      // Se persiste como 'incierto' y sale de la cola de pendientes: un
      // reintento automatico podria duplicar el mensaje. La reconciliacion
      // (comprobar con el destinatario y reenviar o cancelar) es decision de
      // David, no automatica.
      if (!errorEnvio && resultadoEnvio && typeof resultadoEnvio === 'object' && resultadoEnvio.incierto === true) {
        m.enviado = true;
        m.estado = 'incierto';
        m.ultimoError = 'El canal no confirmo la transmision; no se reintenta para evitar duplicados.';
        fallidos.push(m);
        huboCambios = true;
        modificados.set(m.id, m);
        console.error(`[ENTREGA INCIERTA] Mensaje para +${m.numero} en estado desconocido; requiere revision manual.`);
        continue;
      }

      const fallo = errorEnvio !== null || resultadoEnvio === false;

      if (!fallo) {
        m.enviado = true;
        m.enviadoEn = new Date().toISOString();
        m.estado = 'enviado';
        m.ultimoError = null;
        despachados.push(m);
        modificados.set(m.id, m);

        const entradaLog = `[${new Date().toISOString()}] Para: +${m.numero} | Mensaje: "${m.mensaje}" | Programado: ${m.fechaHoraLocal}\n`;
        try {
          rotarLogEnviosSiNecesario();
          fs.appendFileSync(ARCHIVO_LOG_ENVIOS, entradaLog, 'utf-8');
        } catch (err) {
          console.error('Error escribiendo log de envíos programados:', err.message);
        }
      } else {
        m.intentos = (m.intentos || 0) + 1;
        m.ultimoError = errorEnvio || 'El canal de envío no confirmó la entrega.';

        if (m.intentos >= MAX_INTENTOS_ENVIO) {
          // Se detiene el reintento y queda marcado como fallido: jamas se
          // silencia un mensaje que no se pudo entregar.
          m.enviado = true;
          m.estado = 'fallido';
          fallidos.push(m);
          console.error(`[MENSAJE FALLIDO] Tras ${m.intentos} intentos no se pudo entregar a +${m.numero}: ${m.ultimoError}`);
        } else {
          console.warn(`[REINTENTO PENDIENTE] Envío a +${m.numero} falló (intento ${m.intentos}/${MAX_INTENTOS_ENVIO}): ${m.ultimoError}`);
        }
        modificados.set(m.id, m);
      }
    }
  }

  // Acuse perdido: un 'enviado' cuyo acuse nunca llega no puede quedar
  // 'enviado' para siempre ni reintentarse a ciegas (podria duplicar el
  // mensaje). Se marca 'incierto' y se notifica para revision manual.
  for (const m of lista) {
    if (m.estado === 'enviado' && m.enviadoEn) {
      const esperaMs = Date.now() - new Date(m.enviadoEn).getTime();
      if (Number.isFinite(esperaMs) && esperaMs > TIMEOUT_ACUSE_MS) {
        m.estado = 'incierto';
        m.ultimoError = `Sin acuse de recibo tras ${Math.round(TIMEOUT_ACUSE_MS / 60000)} minutos; no se reintenta para evitar duplicados.`;
        huboCambios = true;
        fallidos.push(m);
        modificados.set(m.id, m);
        console.error(`[ACUSE PERDIDO] Mensaje para +${m.numero} sin acuse tras ${Math.round(esperaMs / 60000)} min; marcado como incierto para revision manual.`);
      }
    }
  }

  if (huboCambios) {
    // Persistencia por fusion, NO por volcado del snapshot: `lista` se leyo
    // ANTES de enviar y cualquier escritura concurrente durante el await del
    // envio se perderia al guardar. Fallos del volcado observados o posibles:
    // el whatsappId registrado por el callback (sin el los acuses nunca
    // reconcilian), un acuse entregado/leido llegado durante el envio, una
    // cancelacion hecha mientras se despachaba (resucitaria y se reenviaria)
    // o un mensaje programado nuevo (se borraria sin enviarse jamas).
    const fresca = leerMensajesProgramados();
    const fusionada = fresca.map(reg => {
      const mod = modificados.get(reg.id);
      if (!mod) return reg; // esta pasada no lo toco: se conserva lo fresco
      // Un acuse entregado/leido llegado DURANTE el envio es la verdad mas
      // avanzada: nunca se pisa con nuestro 'enviado' o 'incierto'.
      const estado = (reg.estado === 'entregado' || reg.estado === 'leido') ? reg.estado : mod.estado;
      return { ...mod, estado, whatsappId: mod.whatsappId || reg.whatsappId || null };
    });
    // Un registro modificado que ya no existe en disco (cancelado durante el
    // despacho) no resucita: el envio ya ocurrio, pero la ficha no vuelve.
    guardarMensajesProgramados(fusionada);
  }

  // Compatibilidad: el valor devuelto sigue siendo el array de despachados
  // (los consumidores antiguos usan .length); los fallidos viajan como
  // propiedad adicional para quien quiera notificarlos.
  despachados.fallidos = fallidos;
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

/**
 * Vincula el ID de mensaje de WhatsApp (clave Baileys) con el mensaje
 * programado, para poder reconciliar los acuses de recibo posteriores.
 */
export function registrarIdWhatsApp(idProgramado, whatsappId) {
  if (!idProgramado || !whatsappId) return false;
  const lista = leerMensajesProgramados();
  const m = lista.find(x => x.id === idProgramado);
  if (!m) return false;
  m.whatsappId = whatsappId;
  guardarMensajesProgramados(lista);
  return true;
}

/**
 * Procesa acuses de recibo de WhatsApp (evento messages.update de Baileys).
 * Estados Baileys: 3 = entregado al dispositivo, 4 = reproducido/leido,
 * 5 = leido; un error en update.status o update.error marca el mensaje como
 * fallido. Devuelve las transiciones aplicadas para que el llamador decida
 * si notifica a David.
 */
export function procesarActualizacionEntrega(actualizaciones = []) {
  const lista = leerMensajesProgramados();
  const transiciones = [];
  let huboCambios = false;

  for (const upd of actualizaciones || []) {
    const idWa = upd?.key?.id;
    if (!idWa) continue;
    const m = lista.find(x => x.whatsappId === idWa);
    // Solo fichas con whatsappId (o sea, ya transmitidas); no se exige
    // enviado=true: el acuse puede llegar DURANTE el despacho, antes de que
    // el flag se escriba, y ese acuse no puede perderse.
    if (!m) continue;

    const estado = upd?.update?.status;
    if (upd?.update?.error) {
      if (m.estado !== 'fallido') {
        m.estado = 'fallido';
        m.ultimoError = String(upd.update.error?.message || upd.update.error || 'Error de entrega de WhatsApp');
        transiciones.push({ id: m.id, numero: m.numero, estado: 'fallido' });
        huboCambios = true;
      }
    } else if (typeof estado === 'number' && estado >= 4 && m.estado !== 'leido') {
      m.estado = 'leido';
      transiciones.push({ id: m.id, numero: m.numero, estado: 'leido' });
      huboCambios = true;
    } else if (typeof estado === 'number' && estado >= 3 && (m.estado === 'enviado' || m.estado === 'programado')) {
      m.estado = 'entregado';
      transiciones.push({ id: m.id, numero: m.numero, estado: 'entregado' });
      huboCambios = true;
    }
  }

  if (huboCambios) {
    guardarMensajesProgramados(lista);
  }
  return transiciones;
}
