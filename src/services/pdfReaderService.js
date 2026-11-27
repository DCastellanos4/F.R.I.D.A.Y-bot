import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Maximum default chunk size in characters for text splitting.
 */
export const DEFAULT_CHUNK_SIZE = 1500;

/**
 * Default overlap between consecutive chunks in characters.
 */
export const DEFAULT_CHUNK_OVERLAP = 200;

/**
 * Maximum characters for the executive summary.
 */
export const MAX_SUMMARY_LENGTH = 600;

/**
 * Normalizes text by collapsing whitespace and trimming.
 *
 * @param {string} text
 * @returns {string}
 */
export function normalizeWhitespace(text) {
  if (!text || typeof text !== 'string') return '';
  return text
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Decodes a PDF stream object, handling FlateDecode (zlib) compression.
 * Returns the raw bytes or decoded text.
 *
 * @param {Buffer} streamData
 * @param {boolean} isFlateDecode
 * @returns {string}
 */
function decodeStream(streamData, isFlateDecode) {
  try {
    if (isFlateDecode) {
      const inflated = zlib.inflateSync(streamData);
      return inflated.toString('latin1');
    }
    return streamData.toString('latin1');
  } catch {
    return streamData.toString('latin1');
  }
}

/**
 * Extracts text from PDF Tj and TJ operators in a content stream.
 * Handles basic ASCII and Latin-1 encoded text objects.
 *
 * @param {string} contentStream
 * @returns {string}
 */
function extractTextFromStream(contentStream) {
  const chunks = [];
  let inBT = false;

  const lines = contentStream.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed === 'BT') {
      inBT = true;
      continue;
    }
    if (trimmed === 'ET') {
      if (inBT) chunks.push(' ');
      inBT = false;
      continue;
    }

    if (!inBT) continue;

    // Td / TD / T* - new line operators
    if (/^T[dD\*]/.test(trimmed)) {
      chunks.push('\n');
      continue;
    }

    // Tj: (text)Tj  or  (text) Tj
    const tjMatch = trimmed.match(/\((.*?)\)\s*Tj/);
    if (tjMatch) {
      chunks.push(decodePdfString(tjMatch[1]));
      continue;
    }

    // TJ: [(text) offset (text)] TJ
    const tjArrayMatch = trimmed.match(/\[(.*?)\]\s*TJ/s);
    if (tjArrayMatch) {
      const content = tjArrayMatch[1];
      const parts = [...content.matchAll(/\((.*?)\)/gs)];
      for (const p of parts) {
        chunks.push(decodePdfString(p[1]));
      }
      chunks.push(' ');
      continue;
    }
  }

  return chunks.join('');
}

/**
 * Decodes a PDF string literal, handling common escape sequences.
 *
 * @param {string} str
 * @returns {string}
 */
function decodePdfString(str) {
  let result = '';
  let i = 0;
  while (i < str.length) {
    if (str[i] === '\\' && i + 1 < str.length) {
      const next = str[i + 1];
      if (next === 'n') { result += '\n'; i += 2; }
      else if (next === 'r') { result += '\r'; i += 2; }
      else if (next === 't') { result += '\t'; i += 2; }
      else if (next === '\\') { result += '\\'; i += 2; }
      else if (next === '(') { result += '('; i += 2; }
      else if (next === ')') { result += ')'; i += 2; }
      else if (next >= '0' && next <= '7') {
        const oct = str.slice(i + 1, i + 4);
        result += String.fromCharCode(parseInt(oct, 8));
        i += 4;
      } else { result += next; i += 2; }
    } else {
      result += str[i];
      i++;
    }
  }
  return result;
}

/**
 * Extracts all text content from a PDF buffer using pure JavaScript parsing.
 * Handles FlateDecode compressed streams and plain text streams.
 *
 * @param {Buffer|string} bufferOrPath - PDF buffer or absolute file path.
 * @returns {string} Extracted full text content.
 */
export function extraerTextoPDF(bufferOrPath) {
  let buffer;

  if (typeof bufferOrPath === 'string') {
    if (!fs.existsSync(bufferOrPath)) {
      throw new Error(`PDF file not found: ${bufferOrPath}`);
    }
    buffer = fs.readFileSync(bufferOrPath);
  } else if (Buffer.isBuffer(bufferOrPath)) {
    buffer = bufferOrPath;
  } else {
    throw new Error('Input must be a Buffer or a file path string');
  }

  // Validate PDF magic bytes
  const magic = buffer.slice(0, 5).toString('ascii');
  if (!magic.startsWith('%PDF')) {
    throw new Error('Invalid PDF: missing %PDF header');
  }

  const content = buffer.toString('latin1');
  const textChunks = [];

  // Find all stream...endstream regions
  const streamRegex = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
  // Find object dictionaries that precede each stream
  const objRegex = /(\d+ \d+ obj[\s\S]*?)(?=stream)/g;

  let objMatch;
  const objDicts = new Map();
  while ((objMatch = objRegex.exec(content)) !== null) {
    const dictContent = objMatch[1];
    const filterMatch = dictContent.match(/\/Filter\s*\/(\w+)/);
    if (filterMatch) {
      objDicts.set(objMatch.index, filterMatch[1]);
    }
  }

  let streamMatch;
  while ((streamMatch = streamRegex.exec(content)) !== null) {
    const streamStart = streamMatch.index;
    const rawStream = streamMatch[1];

    // Check if this stream has FlateDecode filter
    let isFlateDecode = false;
    for (const [objPos, filter] of objDicts) {
      if (objPos < streamStart && objPos > streamStart - 2000) {
        if (filter === 'FlateDecode') {
          isFlateDecode = true;
        }
        break;
      }
    }

    let decodedContent;
    if (isFlateDecode) {
      try {
        const streamBuf = Buffer.from(rawStream, 'latin1');
        decodedContent = decodeStream(streamBuf, true);
      } catch {
        decodedContent = rawStream;
      }
    } else {
      decodedContent = rawStream;
    }

    // Only process streams that look like content (contain BT/ET markers or text)
    if (decodedContent.includes('BT') || decodedContent.includes('Tj') || decodedContent.includes('TJ')) {
      const extracted = extractTextFromStream(decodedContent);
      if (extracted.trim().length > 0) {
        textChunks.push(extracted);
      }
    }
  }

  // Fallback: extract parenthesized strings from the raw PDF (for simple non-compressed PDFs)
  if (textChunks.length === 0) {
    const fallbackMatches = [...content.matchAll(/\(([^\\\(\)]{1,200})\)/g)];
    for (const m of fallbackMatches) {
      const decoded = decodePdfString(m[1]);
      if (/[a-zA-Z]{2,}/.test(decoded)) {
        textChunks.push(decoded + ' ');
      }
    }
  }

  const fullText = textChunks.join('\n');
  return normalizeWhitespace(fullText);
}

export const extractPdfText = extraerTextoPDF;

/**
 * Splits a text string into overlapping semantic chunks for processing.
 *
 * @param {string|Array<object>} textoOChunks - Full text or array of existing chunks.
 * @param {number} [maxChunkSize=DEFAULT_CHUNK_SIZE] - Max characters per chunk.
 * @param {number} [overlap=DEFAULT_CHUNK_OVERLAP] - Overlap characters.
 * @returns {Array<{index: number, text: string, charStart: number, charEnd: number}>}
 */
export function dividirEnFragmentos(textoOChunks, maxChunkSize = DEFAULT_CHUNK_SIZE, overlap = DEFAULT_CHUNK_OVERLAP) {
  if (Array.isArray(textoOChunks)) return textoOChunks;

  const text = String(textoOChunks || '');
  if (text.length === 0) return [];

  const chunks = [];
  let start = 0;
  let index = 0;

  while (start < text.length) {
    const end = Math.min(start + maxChunkSize, text.length);
    // Try to break at a sentence boundary
    let boundary = end;
    if (end < text.length) {
      const lookback = text.slice(Math.max(start, end - 200), end);
      const lastSentenceEnd = Math.max(
        lookback.lastIndexOf('. '),
        lookback.lastIndexOf('.\n'),
        lookback.lastIndexOf('? '),
        lookback.lastIndexOf('! ')
      );
      if (lastSentenceEnd > 0) {
        boundary = Math.max(start, end - 200) + lastSentenceEnd + 2;
      }
    }

    chunks.push({
      index,
      text: text.slice(start, boundary).trim(),
      charStart: start,
      charEnd: boundary
    });

    index++;
    start = Math.max(start + 1, boundary - overlap);
  }

  return chunks;
}

export const splitIntoChunks = dividirEnFragmentos;

/**
 * Tokenizes text into lowercase word tokens, removing stop words.
 *
 * @param {string} text
 * @returns {string[]}
 */
function tokenize(text) {
  const stops = new Set(['de', 'la', 'el', 'en', 'y', 'a', 'los', 'las', 'por', 'un', 'una', 'con',
    'para', 'su', 'al', 'lo', 'como', 'mas', 'se', 'que', 'del', 'no', 'es', 'son',
    'the', 'is', 'at', 'which', 'on', 'a', 'an', 'and', 'in', 'to', 'of', 'for', 'with']);
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 2 && !stops.has(t));
}

/**
 * Computes cosine similarity between two token frequency maps.
 *
 * @param {Map<string, number>} vecA
 * @param {Map<string, number>} vecB
 * @returns {number}
 */
function cosineSimilarity(vecA, vecB) {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (const [term, freq] of vecA) {
    normA += freq * freq;
    const bFreq = vecB.get(term) || 0;
    dot += freq * bFreq;
  }
  for (const freq of vecB.values()) {
    normB += freq * freq;
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Builds a frequency map from a token array.
 *
 * @param {string[]} tokens
 * @returns {Map<string, number>}
 */
function freqMap(tokens) {
  const map = new Map();
  for (const t of tokens) {
    map.set(t, (map.get(t) || 0) + 1);
  }
  return map;
}

/**
 * Produces a concise executive summary of a document.
 * Selects the most informative sentences using TF scoring.
 *
 * @param {string|Array<object>} textoOChunks - Full text or chunks.
 * @returns {string} Executive summary without emojis.
 */
export function resumirDocumento(textoOChunks) {
  const text = Array.isArray(textoOChunks)
    ? textoOChunks.map((c) => c.text || '').join('\n')
    : String(textoOChunks || '');

  if (text.trim().length === 0) return 'Document has no extractable text content.';

  // Split into sentences
  const sentences = text
    .split(/[.!?\n]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 20);

  if (sentences.length === 0) return text.slice(0, MAX_SUMMARY_LENGTH).trim();

  // Score each sentence by average TF of its terms
  const allTokens = tokenize(text);
  const globalFreq = freqMap(allTokens);
  const totalTokens = allTokens.length || 1;

  const scored = sentences.map((s) => {
    const tokens = tokenize(s);
    if (tokens.length === 0) return { sentence: s, score: 0 };
    const avgTF = tokens.reduce((sum, t) => sum + (globalFreq.get(t) || 0), 0) / (tokens.length * totalTokens);
    return { sentence: s, score: avgTF };
  });

  scored.sort((a, b) => b.score - a.score);

  // Take top sentences up to MAX_SUMMARY_LENGTH
  const summary = [];
  let len = 0;
  for (const { sentence } of scored) {
    if (len + sentence.length > MAX_SUMMARY_LENGTH) break;
    summary.push(sentence);
    len += sentence.length + 2;
  }

  // Restore original order
  const origOrder = sentences.filter((s) => summary.includes(s));
  return origOrder.join('. ').trim() || scored[0].sentence;
}

export const summarizeDocument = resumirDocumento;

/**
 * Answers a question using the most relevant section of the document.
 * Uses cosine similarity between the question and each chunk.
 *
 * @param {string} pregunta - Natural language question.
 * @param {string|Array<object>} textoOChunks - Full text or pre-split chunks.
 * @param {object} [options={}]
 * @param {number} [options.topK=3] - Number of top chunks to return.
 * @returns {{ answer: string, relevantChunks: Array<object> }}
 */
export function consultarSeccionPDF(pregunta, textoOChunks, options = {}) {
  if (!pregunta || typeof pregunta !== 'string') {
    throw new Error('Question must be a non-empty string');
  }

  const topK = options.topK || 3;

  let chunks;
  if (Array.isArray(textoOChunks)) {
    chunks = textoOChunks;
  } else {
    chunks = dividirEnFragmentos(textoOChunks);
  }

  if (chunks.length === 0) {
    return { answer: 'No document content available to answer the question.', relevantChunks: [] };
  }

  const questionTokens = tokenize(pregunta);
  const questionVec = freqMap(questionTokens);

  if (questionTokens.length === 0) {
    return { answer: 'Question contains no meaningful terms for analysis.', relevantChunks: [] };
  }

  const scoredChunks = chunks
    .map((chunk) => {
      const chunkTokens = tokenize(chunk.text || '');
      const chunkVec = freqMap(chunkTokens);
      const similarity = cosineSimilarity(questionVec, chunkVec);
      return { ...chunk, similarity };
    })
    .filter((c) => c.similarity > 0)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, topK);

  if (scoredChunks.length === 0) {
    return {
      answer: 'No relevant sections found for the given question.',
      relevantChunks: []
    };
  }

  const answer = scoredChunks
    .map((c, i) => `[Section ${i + 1}] ${(c.text || '').slice(0, 400).trim()}`)
    .join('\n\n');

  return {
    answer,
    relevantChunks: scoredChunks
  };
}

export const queryPdfSection = consultarSeccionPDF;

/**
 * Decodes basic XML entities into plain text.
 *
 * @param {string} xmlText
 * @returns {string}
 */
function decodeXmlEntities(xmlText) {
  return String(xmlText || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

/**
 * Extracts entries from a ZIP buffer using Central Directory records (pure Node.js + zlib).
 *
 * @param {Buffer} buffer
 * @param {string[]} targetPrefixes
 * @returns {Map<string, string>} Map of entryName -> UTF-8 XML content
 */
function extractZipXmlEntries(buffer, targetPrefixes = []) {
  const entries = new Map();
  if (!Buffer.isBuffer(buffer) || buffer.length < 22) return entries;

  // Locate End of Central Directory (0x06054b50)
  let eocdPos = -1;
  const minPos = Math.max(0, buffer.length - 65557);
  for (let i = buffer.length - 22; i >= minPos; i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50) {
      eocdPos = i;
      break;
    }
  }
  if (eocdPos === -1) return entries;

  const cdCount = buffer.readUInt16LE(eocdPos + 10);
  const cdOffset = buffer.readUInt32LE(eocdPos + 16);
  if (cdOffset >= buffer.length) return entries;

  let pos = cdOffset;
  for (let i = 0; i < cdCount && pos + 46 <= buffer.length; i++) {
    if (buffer.readUInt32LE(pos) !== 0x02014b50) break;

    const compression = buffer.readUInt16LE(pos + 10);
    const compressedSize = buffer.readUInt32LE(pos + 20);
    const nameLen = buffer.readUInt16LE(pos + 28);
    const extraLen = buffer.readUInt16LE(pos + 30);
    const commentLen = buffer.readUInt16LE(pos + 32);
    const localHeaderOffset = buffer.readUInt32LE(pos + 42);

    const entryName = buffer.subarray(pos + 46, pos + 46 + nameLen).toString('utf-8');
    pos += 46 + nameLen + extraLen + commentLen;

    const matchesPrefix = targetPrefixes.length === 0 || targetPrefixes.some((p) => entryName.startsWith(p));
    if (!matchesPrefix || localHeaderOffset + 30 > buffer.length) continue;
    if (buffer.readUInt32LE(localHeaderOffset) !== 0x04034b50) continue;

    const lNameLen = buffer.readUInt16LE(localHeaderOffset + 26);
    const lExtraLen = buffer.readUInt16LE(localHeaderOffset + 28);
    const dataStart = localHeaderOffset + 30 + lNameLen + lExtraLen;
    if (dataStart + compressedSize > buffer.length) continue;

    const rawData = buffer.subarray(dataStart, dataStart + compressedSize);
    try {
      const content = compression === 8
        ? zlib.inflateRawSync(rawData).toString('utf-8')
        : compression === 0
          ? rawData.toString('utf-8')
          : null;
      if (content !== null) {
        entries.set(entryName, content);
      }
    } catch {
      // Ignore corrupt/unsupported entry
    }
  }

  return entries;
}

/**
 * Extracts plain text from a DOCX buffer (word/document.xml).
 *
 * @param {Buffer} buffer
 * @returns {string}
 */
function extractDocxText(buffer) {
  const entries = extractZipXmlEntries(buffer, ['word/document.xml']);
  const docXml = entries.get('word/document.xml');
  if (!docXml) return '';

  const withBreaks = docXml
    .replace(/<w:br\b[^>]*\/>/gi, '\n')
    .replace(/<\/w:p>/gi, '\n')
    .replace(/<\/w:tr>/gi, '\n')
    .replace(/<\/w:tc>/gi, '\t');

  const stripped = decodeXmlEntities(withBreaks.replace(/<[^>]+>/g, ''));
  return normalizeWhitespace(stripped);
}

/**
 * Extracts plain text from an XLSX buffer (sharedStrings + worksheets).
 *
 * @param {Buffer} buffer
 * @returns {string}
 */
function extractXlsxText(buffer) {
  const entries = extractZipXmlEntries(buffer, ['xl/sharedStrings.xml', 'xl/worksheets/']);
  const sharedStrings = [];
  const ssXml = entries.get('xl/sharedStrings.xml');
  if (ssXml) {
    for (const siMatch of ssXml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/gi)) {
      const parts = [...siMatch[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/gi)].map((m) => decodeXmlEntities(m[1]));
      sharedStrings.push(parts.join(''));
    }
  }

  const sheetNames = [...entries.keys()]
    .filter((k) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(k))
    .sort();

  const lines = [];
  for (const sheetName of sheetNames) {
    const sheetXml = entries.get(sheetName) || '';
    for (const rowMatch of sheetXml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/gi)) {
      const rowCells = [];
      for (const cellMatch of rowMatch[1].matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/gi)) {
        const attrs = cellMatch[1] || '';
        const body = cellMatch[2] || '';
        const typeMatch = attrs.match(/\bt=["']([^"']+)["']/i);
        const cellType = typeMatch ? typeMatch[1] : '';

        if (cellType === 'inlineStr') {
          const tParts = [...body.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/gi)].map((m) => decodeXmlEntities(m[1]));
          if (tParts.length > 0) rowCells.push(tParts.join('').trim());
        } else {
          const vMatch = body.match(/<v\b[^>]*>([\s\S]*?)<\/v>/i);
          if (vMatch) {
            const rawVal = vMatch[1].trim();
            if (cellType === 's') {
              const idx = Number(rawVal);
              rowCells.push(Number.isInteger(idx) && sharedStrings[idx] !== undefined ? sharedStrings[idx] : rawVal);
            } else {
              rowCells.push(decodeXmlEntities(rawVal));
            }
          }
        }
      }
      if (rowCells.some((c) => c.length > 0)) {
        lines.push(rowCells.join(' | '));
      }
    }
  }

  return normalizeWhitespace(lines.join('\n'));
}

/**
 * Extracts text from supported document formats: PDF, TXT, MD, CSV, DOCX, XLSX.
 *
 * @param {Buffer|string} bufferOrPath
 * @param {object} [options={}]
 * @param {string} [options.fileName='']
 * @param {string} [options.mimetype='']
 * @returns {{ ok: boolean, formato: string, texto: string, esEscaneado?: boolean, error?: string }}
 */
export function extraerTextoDocumento(bufferOrPath, options = {}) {
  const fileName = String(options.fileName || (typeof bufferOrPath === 'string' ? path.basename(bufferOrPath) : '')).toLowerCase();
  const mimetype = String(options.mimetype || '').toLowerCase();

  let buffer;
  if (typeof bufferOrPath === 'string') {
    if (!fs.existsSync(bufferOrPath)) {
      return { ok: false, formato: 'desconocido', texto: '', error: `Archivo no encontrado: ${bufferOrPath}` };
    }
    buffer = fs.readFileSync(bufferOrPath);
  } else if (Buffer.isBuffer(bufferOrPath)) {
    buffer = bufferOrPath;
  } else {
    return { ok: false, formato: 'desconocido', texto: '', error: 'Entrada invalida: se esperaba Buffer o ruta.' };
  }

  if (mimetype.includes('pdf') || fileName.endsWith('.pdf')) {
    try {
      const texto = extraerTextoPDF(buffer);
      if (!texto || texto.trim().length < 20) {
        return {
          ok: false,
          formato: 'pdf',
          texto: texto || '',
          esEscaneado: true,
          error: 'El PDF no contiene texto extraible (posiblemente es un documento escaneado o basado en imagenes).'
        };
      }
      return { ok: true, formato: 'pdf', texto, esEscaneado: false };
    } catch (err) {
      return { ok: false, formato: 'pdf', texto: '', error: `Error leyendo PDF: ${err.message}` };
    }
  }

  if (
    fileName.endsWith('.txt') ||
    fileName.endsWith('.md') ||
    fileName.endsWith('.csv') ||
    mimetype.includes('text/plain') ||
    mimetype.includes('text/markdown') ||
    mimetype.includes('text/csv') ||
    mimetype.includes('application/csv')
  ) {
    const formato = fileName.endsWith('.csv') || mimetype.includes('csv')
      ? 'csv'
      : fileName.endsWith('.md') || mimetype.includes('markdown')
        ? 'md'
        : 'txt';
    const texto = normalizeWhitespace(buffer.toString('utf-8'));
    if (!texto) {
      return { ok: false, formato, texto: '', error: `El archivo ${formato.toUpperCase()} esta vacio.` };
    }
    return { ok: true, formato, texto };
  }

  if (fileName.endsWith('.docx') || mimetype.includes('wordprocessingml.document')) {
    const texto = extractDocxText(buffer);
    if (!texto) {
      return {
        ok: false,
        formato: 'docx',
        texto: '',
        error: 'No se pudo extraer texto legible del archivo DOCX (puede estar vacio o cifrado).'
      };
    }
    return { ok: true, formato: 'docx', texto };
  }

  if (fileName.endsWith('.xlsx') || mimetype.includes('spreadsheetml.sheet')) {
    const texto = extractXlsxText(buffer);
    if (!texto) {
      return {
        ok: false,
        formato: 'xlsx',
        texto: '',
        error: 'No se pudo extraer texto legible del archivo XLSX (puede estar vacio o cifrado).'
      };
    }
    return { ok: true, formato: 'xlsx', texto };
  }

  return {
    ok: false,
    formato: 'no_soportado',
    texto: '',
    error: `Formato no soportado (${fileName || mimetype || 'desconocido'}). Formatos admitidos: PDF, TXT, MD, CSV, DOCX y XLSX.`
  };
}

export const extractDocumentText = extraerTextoDocumento;

export default {
  extraerTextoPDF,
  extractPdfText,
  extraerTextoDocumento,
  extractDocumentText,
  dividirEnFragmentos,
  splitIntoChunks,
  resumirDocumento,
  summarizeDocument,
  consultarSeccionPDF,
  queryPdfSection,
  normalizeWhitespace,
  DEFAULT_CHUNK_SIZE,
  DEFAULT_CHUNK_OVERLAP,
  MAX_SUMMARY_LENGTH
};
