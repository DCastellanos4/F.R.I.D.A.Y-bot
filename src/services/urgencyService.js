/**
 * Urgency and Stress Classification Service for Tactical Audio
 * Analyzes transcribed speech text and audio duration to detect urgency keywords
 * and calculate speech cadence / rate for prompt modulation.
 * Zero-emoji compliant.
 */

// Negation phrases that counteract urgency words like 'prisa' or 'urgente'
const CALM_PATTERNS = [
  /\bsin\s+prisa\b/gi,
  /\bno\s+corre\s+prisa\b/gi,
  /\bno\s+hay\s+prisa\b/gi,
  /\bno\s+es\s+urgente\b/gi,
  /\bsin\s+urgencia\b/gi,
  /\bcon\s+calma\b/gi,
  /\btranquilo\b/gi,
  /\btranquila\b/gi,
  /\bcuando\s+puedas\b/gi
];

// Keywords indicating critical emergency
const CRITICAL_KEYWORDS = [
  'emergencia',
  'socorro',
  'auxilio',
  'se cayo',
  'se ha caido',
  'servidor caido',
  'sistema caido',
  'caida total',
  'catastrofe',
  'peligro'
];

// Keywords indicating high urgency
const URGENT_KEYWORDS = [
  'urgente',
  'urgencia',
  'alta prioridad',
  'prioritario',
  'prioritaria',
  'inmediato',
  'inmediata',
  'inmediatamente',
  'ahora mismo',
  'cuanto antes',
  'rapido',
  'rapida',
  'deprisa',
  'prisa',
  'corre',
  'corriendo',
  'ya'
];

/**
 * Normalizes text by removing diacritics and converting to lowercase.
 * @param {string} text
 * @returns {string}
 */
function normalizeText(text) {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

/**
 * Counts the number of words in a string.
 * @param {string} text
 * @returns {number}
 */
function countWords(text) {
  if (!text || typeof text !== 'string') return 0;
  const tokens = text.trim().split(/\s+/).filter(w => w.length > 0);
  return tokens.length;
}

/**
 * Classifies the urgency of a transcribed audio message.
 *
 * @param {string} transcribedText - The transcribed text of the voice note.
 * @param {number} durationSeconds - The duration of the voice note in seconds.
 * @returns {{ isUrgent: boolean, level: 'normal'|'high'|'critical', speechRate: number, reason: string }}
 */
export function classifyUrgency(transcribedText, durationSeconds) {
  if (!transcribedText || typeof transcribedText !== 'string' || transcribedText.trim().length === 0) {
    return {
      isUrgent: false,
      level: 'normal',
      speechRate: 0,
      reason: 'Texto vacio o no valido'
    };
  }

  const rawText = transcribedText.trim();
  const wordCount = countWords(rawText);

  // Calculate speech rate (words per second)
  let speechRate = 0;
  if (typeof durationSeconds === 'number' && durationSeconds > 0 && !Number.isNaN(durationSeconds)) {
    speechRate = Number((wordCount / durationSeconds).toFixed(2));
    if (!Number.isFinite(speechRate) || Number.isNaN(speechRate)) {
      speechRate = 0;
    }
  }

  // Pre-process text to mask non-urgent negation phrases (e.g. 'sin prisa', 'no es urgente')
  let filteredText = rawText;
  let hasCalmModifier = false;
  for (const pattern of CALM_PATTERNS) {
    if (pattern.test(filteredText)) {
      hasCalmModifier = true;
      filteredText = filteredText.replace(pattern, ' ');
    }
  }

  const normalized = normalizeText(filteredText);

  // Check critical keywords
  const matchedCritical = [];
  for (const kw of CRITICAL_KEYWORDS) {
    const normKw = normalizeText(kw);
    const regex = new RegExp(`(^|\\b|\\W)${normKw}(\\b|\\W|$)`, 'i');
    if (regex.test(normalized)) {
      matchedCritical.push(kw);
    }
  }

  // Check urgent keywords
  const matchedUrgent = [];
  for (const kw of URGENT_KEYWORDS) {
    const normKw = normalizeText(kw);
    const regex = new RegExp(`(^|\\b|\\W)${normKw}(\\b|\\W|$)`, 'i');
    if (regex.test(normalized)) {
      matchedUrgent.push(kw);
    }
  }

  const hasCritical = matchedCritical.length > 0;
  const hasUrgent = matchedUrgent.length > 0;
  const isFastPaced = speechRate >= 3.5;
  const isExtremelyFast = speechRate >= 4.0;

  // Decision logic
  if (hasCritical && (isExtremelyFast || isFastPaced || matchedUrgent.length >= 2)) {
    return {
      isUrgent: true,
      level: 'critical',
      speechRate,
      reason: `Cadencia acelerada (${speechRate} palabras/segundo) y palabras de emergencia detectadas: ${[...matchedCritical, ...matchedUrgent].join(', ')}`
    };
  }

  if (hasCritical) {
    return {
      isUrgent: true,
      level: isFastPaced ? 'critical' : 'high',
      speechRate,
      reason: `Palabras de emergencia detectadas: ${matchedCritical.join(', ')}`
    };
  }

  if (hasUrgent) {
    if (hasCalmModifier && matchedUrgent.length === 0 && speechRate < 3.0) {
      return {
        isUrgent: false,
        level: 'normal',
        speechRate,
        reason: 'Ritmo y lexico normales'
      };
    }

    const level = (isExtremelyFast && matchedUrgent.length >= 2) ? 'critical' : 'high';
    return {
      isUrgent: true,
      level,
      speechRate,
      reason: `Palabra clave de urgencia detectada: ${matchedUrgent.join(', ')}`
    };
  }

  if (isExtremelyFast && !hasCalmModifier) {
    return {
      isUrgent: true,
      level: 'high',
      speechRate,
      reason: `Cadencia de voz acelerada (${speechRate} palabras/segundo)`
    };
  }

  return {
    isUrgent: false,
    level: 'normal',
    speechRate,
    reason: 'Ritmo y lexico normales'
  };
}

/**
 * Returns an LLM directive instructing concise, direct output when urgent.
 *
 * @param {{ isUrgent: boolean, level: 'normal'|'high'|'critical', speechRate?: number, reason?: string }} urgencyResult
 * @returns {string} Directive text for system prompt modulation
 */
export function getUrgencyPromptDirective(urgencyResult) {
  if (!urgencyResult || !urgencyResult.isUrgent) {
    return '';
  }

  if (urgencyResult.level === 'critical') {
    return 'DIRECTIVA CRITICA: Situacion de maxima urgencia o emergencia detectada (' +
      (urgencyResult.reason || 'prioridad critica') +
      '). Responde de inmediato, de forma telegrafica, ultra-concisa y directa al grano. Cero formulas de cortesia, cero introducciones, ve directo a la solucion o accion requerida.';
  }

  return 'DIRECTIVA DE URGENCIA: Mensaje con prioridad alta detectado (' +
    (urgencyResult.reason || 'prioridad alta') +
    '). Responde de forma concisa, ejecutiva y directa, priorizando la accion inmediata sin rodeos innecesarios.';
}
