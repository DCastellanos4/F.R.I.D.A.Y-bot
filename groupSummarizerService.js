import { config } from './config.js';

// Bufer en memoria para almacenar mensajes de grupos de WhatsApp (@g.us)
const groupMessageBuffers = new Map();

/**
 * Normaliza un identificador de usuario o grupo
 */
function normalizeJid(jid) {
  if (!jid || typeof jid !== 'string') return '';
  return jid.trim();
}

/**
 * Normaliza texto para comparaciones linguisticas eliminando acentos
 */
function normalizeText(text) {
  if (!text || typeof text !== 'string') return '';
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

/**
 * Detecta si un mensaje menciona a David directamente
 * (por nombre, telefono, LID o etiqueta Baileys)
 *
 * @param {string} text - Texto del mensaje
 * @param {string[]} [mentionedJids=[]] - Array de JIDs etiquetados en contextInfo
 * @returns {boolean}
 */
export function isDavidMentioned(text, mentionedJids = []) {
  const davidPhone = (config && config.userPhone) ? String(config.userPhone).trim() : '34635605605';
  const davidLid = (config && config.userLid) ? String(config.userLid).trim() : '149868706304033';

  // 1. Comprobacion de menciones formales en metadatos de WhatsApp
  if (Array.isArray(mentionedJids) && mentionedJids.length > 0) {
    for (const jid of mentionedJids) {
      if (typeof jid === 'string') {
        const norm = jid.trim();
        if (davidPhone && norm.includes(davidPhone)) return true;
        if (davidLid && norm.includes(davidLid)) return true;
      }
    }
  }

  if (!text || typeof text !== 'string') return false;

  const normalized = normalizeText(text);

  // 2. Menciones por nombre o acronimo del asistente
  if (/\b(david|davis)\b/i.test(normalized)) {
    return true;
  }
  if (/\bd\.?a\.?v\.?i\.?s\.?\b/i.test(normalized)) {
    return true;
  }

  // 3. Menciones con arroba @David o @346...
  if (/@\s*david\b/i.test(text)) {
    return true;
  }
  if (davidPhone && text.includes(davidPhone)) {
    return true;
  }
  if (davidLid && text.includes(davidLid)) {
    return true;
  }

  return false;
}

/**
 * Extrae tareas pendientes o elementos de accion de un texto
 *
 * @param {string} text - Texto del mensaje
 * @param {string} [senderJid=''] - Remitente del mensaje
 * @returns {Array<{ task: string, sender: string, text: string, timestamp?: number }>}
 */
export function extractPendingTasks(text, senderJid = '') {
  if (!text || typeof text !== 'string') return [];

  const tasks = [];
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);

  for (const line of lines) {
    // 1. Prefijos explicitos de tareas: TODO, TAREA, TASK, ACCION, PENDIENTE
    const explicitMatch = line.match(/^(?:TODO|TASK|TAREA|ACCION|ACCIÓN|PENDIENTE)\s*[:\-]\s*(.+)$/i);
    if (explicitMatch && explicitMatch[1].trim().length > 3) {
      tasks.push({
        task: explicitMatch[1].trim(),
        sender: senderJid,
        text: line
      });
      continue;
    }

    // 2. Notacion de casilla de verificacion [ ] o - [ ]
    const checkboxMatch = line.match(/^(?:[\-\*]\s*)?\[\s*\]\s*(.+)$/i);
    if (checkboxMatch && checkboxMatch[1].trim().length > 3) {
      tasks.push({
        task: checkboxMatch[1].trim(),
        sender: senderJid,
        text: line
      });
      continue;
    }

    // 3. Patrones linguisticos de obligacion o pendiente
    const pendingMatch = line.match(/(?:tenemos|tengo|queda|esta)\s+pendiente\s+(?:de\s+)?(.+)/i);
    if (pendingMatch && pendingMatch[1].trim().length > 3) {
      tasks.push({
        task: pendingMatch[1].trim(),
        sender: senderJid,
        text: line
      });
      continue;
    }

    const obligationMatch = line.match(/(?:hay\s+que|tenemos\s+que|tienes\s+que|debes|debemos)\s+(.+)/i);
    if (obligationMatch && obligationMatch[1].trim().length > 3) {
      tasks.push({
        task: obligationMatch[1].trim(),
        sender: senderJid,
        text: line
      });
      continue;
    }

    // 4. Solicitudes directas de accion con por favor
    const requestMatch = line.match(/por\s+favor\s*,?\s*(revisa|revisar|envia|enviar|haz|hacer|mira|mirar|prepara|preparar|actualiza|actualizar|termina|terminar)\s+(.+)/i);
    if (requestMatch) {
      tasks.push({
        task: `${requestMatch[1]} ${requestMatch[2]}`.trim(),
        sender: senderJid,
        text: line
      });
      continue;
    }

    // 5. Plazos y fechas limite
    const deadlineMatch = line.match(/(?:deadline|fecha\s+limite|limite\s+de\s+entrega)\s*[:\-]\s*(.+)/i);
    if (deadlineMatch && deadlineMatch[1].trim().length > 3) {
      tasks.push({
        task: deadlineMatch[1].trim(),
        sender: senderJid,
        text: line
      });
      continue;
    }
  }

  return tasks;
}

/**
 * Sintetiza los temas principales a partir de los mensajes analizados
 */
function extractMainTopics(messages) {
  if (!messages || messages.length === 0) return [];

  const topics = [];
  const combinedText = messages.map(m => m.text).join(' ');
  const norm = normalizeText(combinedText);

  // Analisis tematico contextual
  if (/reunion|coordin|reunir|junta|horario|calendario/.test(norm)) {
    topics.push('Coordinacion de reuniones y trabajo de equipo.');
  }
  if (/arquitectura|diseno|sector|modulo|sistema|tecnic|desarrollo/.test(norm)) {
    topics.push('Revision tecnica de arquitectura y diseno del sistema.');
  }
  if (/informe|documento|reporte|entrega|presentacion/.test(norm)) {
    topics.push('Elaboracion y envio de informes y documentacion.');
  }
  if (/despliegue|servidor|produccion|vps|deploy|docker|pm2/.test(norm)) {
    topics.push('Operaciones de despliegue y supervision de infraestructura.');
  }
  if (/error|fallo|bug|incidencia|problema|correccion/.test(norm)) {
    topics.push('Resolucion de incidencias y depuracion tecnica.');
  }

  // Fallback con puntos destacados de mensajes representativos
  if (topics.length === 0) {
    const representative = messages
      .filter(m => m.text.length > 15 && !m.text.toLowerCase().startsWith('hola'))
      .slice(0, 3);

    for (const msg of representative) {
      const cleanSnippet = msg.text.replace(/\s+/g, ' ').slice(0, 90).trim();
      topics.push(`Intercambio operativo: "${cleanSnippet}".`);
    }
  }

  if (topics.length === 0) {
    topics.push('Conversacion general del grupo.');
  }

  return topics;
}

/**
 * Ingiere y almacena un mensaje de grupo en el bufer en memoria
 *
 * @param {string|object} groupJidOrMsg - JID del grupo o mensaje de Baileys
 * @param {string} [senderJid] - JID del participante
 * @param {string} [text] - Contenido textual
 * @param {number} [timestamp] - Marca de tiempo en segundos (epoch)
 * @returns {Promise<{ ok: boolean, groupJid: string, count: number }>}
 */
export async function recordGroupMessage(groupJidOrMsg, senderJid, text, timestamp) {
  let groupJid = groupJidOrMsg;
  let sender = senderJid;
  let messageText = text;
  let ts = timestamp;
  let contextMentions = [];

  // Soporte directo para objetos de mensaje Baileys
  if (groupJidOrMsg && typeof groupJidOrMsg === 'object' && groupJidOrMsg.key) {
    const msg = groupJidOrMsg;
    groupJid = msg.key.remoteJid;
    sender = msg.key.participant || msg.participant || msg.key.remoteJid;
    ts = msg.messageTimestamp ? Number(msg.messageTimestamp) : Math.floor(Date.now() / 1000);

    const m = msg.message;
    if (m) {
      const ephem = m.ephemeralMessage?.message || m.viewOnceMessage?.message || m.viewOnceMessageV2?.message || m;
      messageText = ephem.conversation ||
                    ephem.extendedTextMessage?.text ||
                    ephem.imageMessage?.caption ||
                    ephem.videoMessage?.caption ||
                    '';

      if (ephem.extendedTextMessage?.contextInfo?.mentionedJid) {
        contextMentions = ephem.extendedTextMessage.contextInfo.mentionedJid;
      }
    } else {
      messageText = '';
    }
  }

  // Normalizacion de parametros
  groupJid = normalizeJid(groupJid);
  sender = normalizeJid(sender || 'unknown@s.whatsapp.net');

  if (!groupJid) {
    return { ok: false, error: 'groupJid es obligatorio y no puede estar vacio' };
  }

  if (typeof messageText !== 'string') {
    messageText = messageText !== null && messageText !== undefined ? String(messageText) : '';
  }
  messageText = messageText.trim();

  // Tratamiento del timestamp
  if (ts !== undefined && ts !== null) {
    ts = Number(ts);
    if (isNaN(ts)) {
      ts = Math.floor(Date.now() / 1000);
    } else if (ts > 10000000000) {
      // Si viene en milisegundos, convertir a segundos
      ts = Math.floor(ts / 1000);
    }
  } else {
    ts = Math.floor(Date.now() / 1000);
  }

  const mentionsDavid = isDavidMentioned(messageText, contextMentions);
  const detectedTasks = extractPendingTasks(messageText, sender);

  const messageRecord = {
    groupJid,
    senderJid: sender,
    text: messageText,
    timestamp: ts,
    mentionsDavid,
    hasTasks: detectedTasks.length > 0,
    tasks: detectedTasks
  };

  if (!groupMessageBuffers.has(groupJid)) {
    groupMessageBuffers.set(groupJid, []);
  }

  const buffer = groupMessageBuffers.get(groupJid);
  buffer.push(messageRecord);

  // Mantener un limite de capacidad acotado para evitar desbordamiento
  if (buffer.length > 1000) {
    buffer.shift();
  }

  return {
    ok: true,
    groupJid,
    count: buffer.length
  };
}

/**
 * Genera un resumen estructurado e inteligente de los mensajes de un grupo
 * en una ventana de tiempo determinada (por defecto 24 horas)
 *
 * @param {string} groupJid - JID del grupo (@g.us)
 * @param {number} [hours=24] - Ventana temporal en horas
 * @returns {Promise<{ summaryText: string, davidMentions: Array, pendingTasks: Array, groupJid: string, hours: number, messageCount: number }>}
 */
export async function generateGroupSummary(groupJid, hours = 24) {
  const normGroupJid = normalizeJid(groupJid);
  const windowHours = Number(hours) > 0 ? Number(hours) : 24;

  const buffer = groupMessageBuffers.get(normGroupJid) || [];
  const nowSeconds = Math.floor(Date.now() / 1000);
  const cutoff = nowSeconds - (windowHours * 3600);

  // Filtrar exclusivamente los mensajes que caigan dentro de la ventana de horas solicitada
  const recentMessages = buffer.filter(m => m.timestamp >= cutoff);

  // Caso: Grupo sin actividad en la ventana temporal
  if (recentMessages.length === 0) {
    return {
      groupJid: normGroupJid,
      hours: windowHours,
      messageCount: 0,
      summaryText: `No se han registrado mensajes en el grupo ${normGroupJid} durante las ultimas ${windowHours} horas.`,
      davidMentions: [],
      pendingTasks: []
    };
  }

  // Recopilar menciones a David
  const davidMentions = [];
  for (const m of recentMessages) {
    if (m.mentionsDavid || isDavidMentioned(m.text)) {
      davidMentions.push({
        sender: m.senderJid,
        text: m.text,
        timestamp: m.timestamp,
        date: new Date(m.timestamp * 1000).toISOString()
      });
    }
  }

  // Recopilar tareas pendientes y acciones requeridas
  const pendingTasks = [];
  for (const m of recentMessages) {
    const tasksInMsg = m.tasks && m.tasks.length > 0 ? m.tasks : extractPendingTasks(m.text, m.senderJid);
    for (const t of tasksInMsg) {
      pendingTasks.push({
        task: t.task,
        sender: m.senderJid,
        text: m.text,
        timestamp: m.timestamp
      });
    }
  }

  // Temas y puntos principales
  const topics = extractMainTopics(recentMessages);
  const uniqueParticipants = Array.from(new Set(recentMessages.map(m => m.senderJid)));

  // Construccion del informe en Markdown estructurado, sobrio y sin emojis
  const summaryLines = [
    '# RESUMEN EJECUTIVO DE ACTIVIDAD EN GRUPO',
    '',
    `- Grupo: ${normGroupJid}`,
    `- Periodo analizado: Ultimas ${windowHours} horas`,
    `- Total de mensajes procesados: ${recentMessages.length}`,
    `- Participantes activos: ${uniqueParticipants.length}`,
    '',
    '## TEMAS PRINCIPALES Y DISCUSION',
    ...topics.map(topic => `- ${topic}`),
    '',
    `## MENCIONES DIRECTAS A DAVID (${davidMentions.length})`
  ];

  if (davidMentions.length > 0) {
    for (const mention of davidMentions) {
      summaryLines.push(`- Remitente [${mention.sender}]: "${mention.text}"`);
    }
  } else {
    summaryLines.push('- Sin menciones directas en este periodo.');
  }

  summaryLines.push('');
  summaryLines.push(`## TAREAS PENDIENTES Y ACCIONES IDENTIFICADAS (${pendingTasks.length})`);

  if (pendingTasks.length > 0) {
    for (const item of pendingTasks) {
      summaryLines.push(`- [ACCION] ${item.task} (remitente: ${item.sender})`);
    }
  } else {
    summaryLines.push('- Sin tareas pendientes detectadas en este periodo.');
  }

  summaryLines.push('');
  summaryLines.push('## SINTESIS GENERAL');
  summaryLines.push(`Supervision completada con exito. Total de participantes: ${uniqueParticipants.length}. Mensajes analizados: ${recentMessages.length}.`);

  const summaryText = summaryLines.join('\n');

  return {
    groupJid: normGroupJid,
    hours: windowHours,
    messageCount: recentMessages.length,
    summaryText,
    davidMentions,
    pendingTasks
  };
}

/**
 * Obtiene los mensajes almacenados para un grupo dentro de un intervalo
 */
export function getGroupMessages(groupJid, hours = 24) {
  const normGroupJid = normalizeJid(groupJid);
  const buffer = groupMessageBuffers.get(normGroupJid) || [];
  const cutoff = Math.floor(Date.now() / 1000) - (Number(hours) || 24) * 3600;
  return buffer.filter(m => m.timestamp >= cutoff);
}

/**
 * Limpia el bufer de mensajes de un grupo especifico
 */
export function clearGroupBuffer(groupJid) {
  const norm = normalizeJid(groupJid);
  return groupMessageBuffers.delete(norm);
}

/**
 * Limpia todos los buferes de grupos en memoria
 */
export function clearAllGroupBuffers() {
  groupMessageBuffers.clear();
}

/**
 * Obtiene la lista de grupos actualmente monitorizados
 */
export function getBufferedGroups() {
  return Array.from(groupMessageBuffers.keys());
}

export default {
  recordGroupMessage,
  generateGroupSummary,
  isDavidMentioned,
  extractPendingTasks,
  getGroupMessages,
  clearGroupBuffer,
  clearAllGroupBuffers,
  getBufferedGroups
};
