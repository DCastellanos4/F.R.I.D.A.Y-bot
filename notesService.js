import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const NOTES_BASE_DIR = path.resolve(__dirname, 'data', 'notes');

/**
 * Triggers indicating an explicit personal note instruction.
 */
const EXPLICIT_NOTE_TRIGGERS = [
  'nota',
  'notas',
  'apunta',
  'apunte',
  'apuntes',
  'recordar',
  'recordatorio',
  'reflexion',
  'reflexión',
  'idea',
  'ideas',
  'memo',
  'pensamiento',
  'diario'
];

const NOTE_TRIGGER_REGEX = new RegExp(
  `^(${EXPLICIT_NOTE_TRIGGERS.join('|')})(\\s*[:\\-]\\s*|\\s+)`,
  'i'
);

/**
 * Validates whether incoming message is a personal note.
 *
 * @param {string} text - Message text or audio transcript.
 * @param {boolean} [isSelfChat=false] - Whether message was sent to self-chat.
 * @returns {boolean}
 */
export function isPersonalNote(text, isSelfChat = false) {
  if (typeof text !== 'string') {
    return false;
  }

  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return false;
  }

  // Any message sent by David to his private self-chat is classified as a personal note
  if (isSelfChat === true) {
    return true;
  }

  // In shared or general chats, require explicit note prefixes
  return NOTE_TRIGGER_REGEX.test(trimmed);
}

/**
 * Sanitizes category name for safe directory and filename usage.
 *
 * @param {string} category - Raw category name.
 * @returns {string} Sanitized category.
 */
export function sanitizeCategory(category) {
  if (!category || typeof category !== 'string') {
    return 'general';
  }

  const cleaned = category
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9_-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');

  return cleaned || 'general';
}

/**
 * Automatically classifies note text into standard categories.
 * Standard categories: ideas, tareas, personal, proyectos, general.
 *
 * @param {string} text - Note text.
 * @returns {'ideas'|'tareas'|'personal'|'proyectos'|'general'}
 */
export function categorizeNote(text) {
  if (!text || typeof text !== 'string') {
    return 'general';
  }

  const normalized = text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

  // Prefix-based rapid matching
  if (/^idea[s]?\s*[:\-]?\s+/i.test(normalized)) {
    return 'ideas';
  }
  if (/^(tarea[s]?|recordar|recordatorio|comprar|hacer|llamar|enviar|revisar|pagar)\s*[:\-]?\s+/i.test(normalized)) {
    return 'tareas';
  }
  if (/^(reflexi[oó]n|personal|diario|salud|familia)\s*[:\-]?\s+/i.test(normalized)) {
    return 'personal';
  }
  if (/^(proyecto[s]?|arquitectura|modulo|sistema|codigo)\s*[:\-]?\s+/i.test(normalized)) {
    return 'proyectos';
  }

  // Keyword scoring dictionary
  const categoryKeywords = {
    tareas: [
      'tarea', 'tareas', 'hacer', 'comprar', 'recordar', 'recordatorio',
      'llamar', 'enviar', 'pendiente', 'pendientes', 'revisar', 'pagar',
      'urgente', 'cita', 'reunion', 'presupuesto', 'pedido', 'adquirir',
      'mandar', 'contactar'
    ],
    ideas: [
      'idea', 'ideas', 'innovacion', 'concepto', 'posibilidad',
      'ocurrencia', 'pensar en', 'crear', 'disenar', 'modulo',
      'nueva funcion', 'brainstorm', 'hipotesis', 'propuesta'
    ],
    proyectos: [
      'proyecto', 'proyectos', 'arquitectura', 'desarrollo', 'release',
      'deploy', 'codigo', 'sistema', 'servidor', 'nodo', 'microservicio',
      'cluster', 'docker', 'api', 'backend', 'frontend', 'database',
      'base de datos', 'infraestructura', 'git', 'endpoint'
    ],
    personal: [
      'personal', 'salud', 'gym', 'gimnasio', 'dieta', 'familia',
      'casa', 'medico', 'reflexion', 'sueno', 'dormir', 'habito',
      'libro', 'pelicula', 'entrenamiento', 'bienestar', 'descanso'
    ]
  };

  let bestCategory = 'general';
  let highestScore = 0;

  for (const [category, words] of Object.entries(categoryKeywords)) {
    let score = 0;
    for (const word of words) {
      if (normalized.includes(word)) {
        score++;
      }
    }
    if (score > highestScore) {
      highestScore = score;
      bestCategory = category;
    }
  }

  return bestCategory;
}

/**
 * Extracts tags from note text and supplied metadata.
 *
 * @param {string} text - Note text.
 * @param {object} [metadata={}] - Note metadata.
 * @returns {string[]} Deduplicated list of lowercase tags.
 */
export function extractTags(text, metadata = {}) {
  const tagsSet = new Set();

  if (Array.isArray(metadata.tags)) {
    for (const item of metadata.tags) {
      if (typeof item === 'string' && item.trim().length > 0) {
        tagsSet.add(item.trim().toLowerCase());
      }
    }
  } else if (typeof metadata.tags === 'string' && metadata.tags.trim().length > 0) {
    for (const item of metadata.tags.split(',')) {
      if (item.trim().length > 0) {
        tagsSet.add(item.trim().toLowerCase());
      }
    }
  }

  if (metadata.category && typeof metadata.category === 'string') {
    tagsSet.add(sanitizeCategory(metadata.category));
  }

  if (typeof text === 'string') {
    const hashtagMatches = text.match(/#([a-zA-Z0-9_\u00C0-\u017F]+)/g);
    if (hashtagMatches) {
      for (const match of hashtagMatches) {
        const cleanTag = match.slice(1).toLowerCase();
        if (cleanTag.length > 0) {
          tagsSet.add(cleanTag);
        }
      }
    }
  }

  return Array.from(tagsSet);
}

/**
 * Extracts structured key points from note text.
 *
 * @param {string} text - Note text.
 * @returns {string[]} List of extracted key points.
 */
export function extractKeyPoints(text) {
  if (!text || typeof text !== 'string') {
    return [];
  }

  const strippedPrefix = text
    .replace(
      /^(nota|notas|apunta|apunte|apuntes|recordar|recordatorio|reflexi[oó]n|idea|ideas|memo|pensamiento|diario)\s*[:\-]\s*/i,
      ''
    )
    .trim();

  const lines = strippedPrefix.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const points = [];

  for (const line of lines) {
    const cleaned = line.replace(/^[-*•\d.)\]]\s*/, '').trim();
    if (!cleaned) continue;

    const clauses = cleaned.split(/(?<=[.!?])\s+/).map(s => s.trim()).filter(Boolean);
    for (const clause of clauses) {
      if (clause.length > 3) {
        points.push(clause);
      }
    }
  }

  const unique = Array.from(new Set(points));
  if (unique.length === 0 && strippedPrefix.length > 0) {
    unique.push(strippedPrefix);
  }

  return unique;
}

/**
 * Saves personal note into structured Markdown file under data/notes/YYYY-MM-DD/.
 *
 * @param {string} text - Note text or voice transcript.
 * @param {object} [metadata={}] - Optional metadata (category, source, author, tags, timestamp).
 * @returns {Promise<{ ok: boolean, filePath: string, fileName: string, category: string, timestamp: string }>}
 */
export async function savePersonalNote(text, metadata = {}) {
  if (typeof text !== 'string' || text.trim().length === 0) {
    throw new Error('Note text must be a non-empty string');
  }

  const safeMeta = metadata && typeof metadata === 'object' ? metadata : {};
  const now = safeMeta.timestamp ? new Date(safeMeta.timestamp) : new Date();

  const pad = (n) => String(n).padStart(2, '0');
  const year = now.getFullYear();
  const month = pad(now.getMonth() + 1);
  const day = pad(now.getDate());
  const hours = pad(now.getHours());
  const minutes = pad(now.getMinutes());
  const seconds = pad(now.getSeconds());

  const dateFolder = `${year}-${month}-${day}`;
  const timeStr = `${hours}${minutes}${seconds}`;

  const rawCategory = safeMeta.category || categorizeNote(text);
  const category = sanitizeCategory(rawCategory);

  const targetDir = path.join(NOTES_BASE_DIR, dateFolder);
  await fs.mkdir(targetDir, { recursive: true });

  const baseFileName = `${dateFolder}_${timeStr}_${category}`;
  let fileName = `${baseFileName}.md`;
  let filePath = path.join(targetDir, fileName);

  let collisionCounter = 1;
  while (true) {
    try {
      await fs.access(filePath);
      fileName = `${baseFileName}_${collisionCounter}.md`;
      filePath = path.join(targetDir, fileName);
      collisionCounter++;
    } catch {
      break;
    }
  }

  const tags = extractTags(text, { ...safeMeta, category });
  const keyPoints = extractKeyPoints(text);
  const source = safeMeta.source || 'text';
  const author = safeMeta.author || 'David';
  const isoTimestamp = now.toISOString();
  const formattedDate = `${dateFolder} ${hours}:${minutes}:${seconds}`;

  const frontmatterLines = [
    '---',
    `timestamp: ${isoTimestamp}`,
    `date: "${formattedDate}"`,
    `category: ${category}`,
    `source: ${source}`,
    `author: ${author}`
  ];

  if (tags.length > 0) {
    frontmatterLines.push('tags:');
    for (const tag of tags) {
      frontmatterLines.push(`  - ${tag}`);
    }
  } else {
    frontmatterLines.push('tags: []');
  }
  frontmatterLines.push('---');

  const bodyLines = [
    '',
    `# Nota Personal: ${formattedDate}`,
    '',
    `- Categoria: ${category}`,
    `- Origen: ${source}`,
    `- Fecha: ${formattedDate}`,
    `- Autor: ${author}`,
    tags.length > 0 ? `- Etiquetas: ${tags.join(', ')}` : '- Etiquetas: ninguna',
    '',
    '## Transcripcion / Contenido',
    text.trim(),
    '',
    '## Puntos Clave'
  ];

  if (keyPoints.length > 0) {
    for (const point of keyPoints) {
      bodyLines.push(`- ${point}`);
    }
  } else {
    bodyLines.push('- Sin puntos clave detectados.');
  }
  bodyLines.push('');

  const markdownContent = frontmatterLines.join('\n') + bodyLines.join('\n');
  await fs.writeFile(filePath, markdownContent, 'utf8');

  return {
    ok: true,
    filePath,
    fileName,
    category,
    timestamp: isoTimestamp
  };
}

/**
 * Parses frontmatter and body sections from a stored Markdown note.
 *
 * @param {string} rawContent - Raw markdown file content.
 * @param {string} filePath - Absolute path to file.
 * @param {string} fileName - File name.
 * @returns {object} Structured note object.
 */
function parseNoteContent(rawContent, filePath, fileName) {
  let category = 'general';
  let timestamp = '';
  let source = 'text';
  let author = 'David';
  const tags = [];

  const frontmatterMatch = rawContent.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (frontmatterMatch) {
    const fmLines = frontmatterMatch[1].split(/\r?\n/);
    let inTags = false;
    for (const line of fmLines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('tags:')) {
        inTags = true;
        continue;
      }
      if (inTags) {
        if (trimmed.startsWith('- ')) {
          tags.push(trimmed.slice(2).trim());
          continue;
        } else if (!trimmed.startsWith('-') && trimmed.includes(':')) {
          inTags = false;
        }
      }
      const colonIdx = trimmed.indexOf(':');
      if (colonIdx !== -1) {
        const key = trimmed.slice(0, colonIdx).trim();
        const val = trimmed.slice(colonIdx + 1).trim().replace(/^["']|["']$/g, '');
        if (key === 'category') category = val;
        if (key === 'timestamp') timestamp = val;
        if (key === 'source') source = val;
        if (key === 'author') author = val;
      }
    }
  }

  let noteBody = '';
  const contentSectionMatch = rawContent.match(/## Transcripcion \/ Contenido\r?\n([\s\S]*?)(?=\r?\n## Puntos Clave|\r?\n---|$)/);
  if (contentSectionMatch) {
    noteBody = contentSectionMatch[1].trim();
  } else {
    noteBody = rawContent.replace(/^---\r?\n[\s\S]*?\r?\n---/, '').trim();
  }

  const preview = noteBody.length > 150 ? noteBody.slice(0, 147) + '...' : noteBody;

  return {
    filePath,
    fileName,
    category,
    timestamp,
    source,
    author,
    tags,
    content: noteBody,
    preview,
    rawContent
  };
}

/**
 * Retrieves a list of recent notes saved in storage, ordered from newest to oldest.
 *
 * @param {number} [limit=10] - Maximum number of notes to return.
 * @param {object} [options={}] - Filter options (category, tag).
 * @returns {Promise<Array<object>>} List of parsed notes.
 */
export async function listRecentNotes(limit = 10, options = {}) {
  const maxLimit = typeof limit === 'number' && limit > 0 ? limit : 10;
  const safeOptions = options && typeof options === 'object' ? options : {};
  const notes = [];

  try {
    await fs.access(NOTES_BASE_DIR);
  } catch {
    return [];
  }

  const dateDirs = await fs.readdir(NOTES_BASE_DIR, { withFileTypes: true });
  const sortedDateDirs = dateDirs
    .filter(d => d.isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(d.name))
    .map(d => d.name)
    .sort()
    .reverse();

  for (const dateDir of sortedDateDirs) {
    if (notes.length >= maxLimit) break;

    const dirPath = path.join(NOTES_BASE_DIR, dateDir);
    let files = [];
    try {
      files = await fs.readdir(dirPath, { withFileTypes: true });
    } catch {
      continue;
    }

    const mdFiles = files
      .filter(f => f.isFile() && f.name.endsWith('.md'))
      .map(f => f.name)
      .sort()
      .reverse();

    for (const fileName of mdFiles) {
      if (notes.length >= maxLimit) break;

      const fullPath = path.join(dirPath, fileName);
      try {
        const rawContent = await fs.readFile(fullPath, 'utf8');
        const parsed = parseNoteContent(rawContent, fullPath, fileName);

        if (safeOptions.category && parsed.category !== sanitizeCategory(safeOptions.category)) {
          continue;
        }

        if (safeOptions.tag && !parsed.tags.includes(safeOptions.tag.toLowerCase())) {
          continue;
        }

        notes.push(parsed);
      } catch {
        // Skip unreadable files
      }
    }
  }

  return notes.slice(0, maxLimit);
}

/**
 * Reads and parses a specific note by its file path.
 *
 * @param {string} filePath - Absolute path to markdown note file.
 * @returns {Promise<object>} Structured note object.
 */
export async function getNoteByPath(filePath) {
  if (typeof filePath !== 'string' || filePath.trim().length === 0) {
    throw new Error('File path must be a non-empty string');
  }

  const rawContent = await fs.readFile(filePath, 'utf8');
  const fileName = path.basename(filePath);
  return parseNoteContent(rawContent, filePath, fileName);
}
