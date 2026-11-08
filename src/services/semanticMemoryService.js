import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Resolves the active data directory.
 * Respects process.env.DAVIS_DATA_DIR for test isolation and production override.
 */
function resolveDataDir() {
  if (process.env.DAVIS_DATA_DIR) {
    return process.env.DAVIS_DATA_DIR;
  }
  // When located inside src/services/, the repository root data directory is ../../data
  const candidateFromSrc = path.resolve(__dirname, '..', '..', 'data');
  if (fs.existsSync(candidateFromSrc)) {
    return candidateFromSrc;
  }
  // When located in root directory, data directory is ./data
  const candidateFromRoot = path.resolve(__dirname, 'data');
  if (fs.existsSync(candidateFromRoot)) {
    return candidateFromRoot;
  }
  return candidateFromSrc;
}

export function getDefaultStorePath() {
  return path.join(resolveDataDir(), 'brain_memory.json');
}

export function getDefaultVectorsPath() {
  return path.join(resolveDataDir(), 'knowledge_vectors.json');
}

/**
 * Categorias de memoria cuyo contenido NUNCA entra en el indice vectorial:
 * son credenciales. La busqueda exacta (memoryService) ya las protege con
 * cifrado en reposo; el camino vectorial no debe convertirse en una via
 * para sacarlas en plano ni al prompt. Se excluyen tanto al indexar como
 * al consultar (por si un knowledge_vectors.json antiguo ya las contiene).
 */
const CATEGORIAS_SENSIBLES_RAG = new Set(['clave']);

export function esDocumentoSensibleRag(doc) {
  if (!doc || typeof doc !== 'object') {
    return false;
  }
  const categoria = String(doc.categoria || '').toLowerCase().trim();
  return CATEGORIAS_SENSIBLES_RAG.has(categoria);
}

function filtrarDocumentosSensibles(docs) {
  if (!Array.isArray(docs)) {
    return [];
  }
  return docs.filter((doc) => !esDocumentoSensibleRag(doc));
}

/**
 * Firma del contenido del archivo de memorias para detectar escrituras
 * nuevas: si cambia (guardar, actualizar, olvidar o edicion externa), el
 * indice vectorial en disco o en cache deja de ser fiable y se reconstruye.
 * Se usa un hash del contenido (no mtime) porque dos escrituras seguidas
 * pueden caer en el mismo milisegundo y con el mismo tamano.
 */
function firmaArchivoMemoria(storePath) {
  try {
    const raw = fs.readFileSync(storePath);
    return crypto.createHash('sha256').update(raw).digest('hex');
  } catch {
    return null;
  }
}

// Fuente de memorias inyectable: lectura y firma de frescura. Por
// defecto, el archivo JSON historico; la raiz de composicion registra la
// fuente SQLite cuando la persistencia activa es SQLite, para que el
// indice vectorial siga detectando escrituras nuevas sin ese archivo.
let fuenteMemoriasPorDefecto = null;

export function registrarFuenteMemoriasPorDefecto(fuente) {
  fuenteMemoriasPorDefecto = fuente || null;
}

function fuenteDe(options, storePath) {
  const fuente = (options && options.fuente) || fuenteMemoriasPorDefecto;
  if (fuente && typeof fuente.leerMemorias === 'function' && typeof fuente.firma === 'function') {
    return fuente;
  }
  return {
    leerMemorias: () => leerMemoriasDesdeArchivo(storePath),
    firma: () => firmaArchivoMemoria(storePath)
  };
}

/**
 * Common Spanish stop words used for vocabulary filtering in TF-IDF.
 */
const SPANISH_STOP_WORDS = new Set([
  'de', 'la', 'que', 'el', 'en', 'y', 'a', 'los', 'del', 'se', 'las', 'por', 'un',
  'para', 'con', 'no', 'una', 'su', 'al', 'lo', 'como', 'mas', 'pero', 'sus', 'le',
  'ya', 'o', 'este', 'si', 'porque', 'esta', 'son', 'entre', 'cuando', 'muy',
  'sin', 'sobre', 'tambien', 'me', 'hasta', 'hay', 'donde', 'quien', 'desde',
  'todo', 'nos', 'durante', 'todos', 'uno', 'les', 'ni', 'contra', 'otros', 'ese',
  'eso', 'ante', 'ellos', 'esto', 'mi', 'mis', 'antes', 'algunos', 'unos', 'yo',
  'tu', 'te', 'ti', 'otro', 'otras', 'otra', 'tanto', 'esa', 'estos', 'mucho',
  'quienes', 'nada', 'muchos', 'cual', 'sea', 'poco', 'ella', 'estar', 'haber',
  'estas', 'estaba', 'estamos', 'estan', 'es', 'fue', 'fueron', 'era', 'sido',
  'ser', 'tiene', 'tienen', 'tenia', 'ha', 'han', 'hecho', 'ahora'
]);

/**
 * Common English stop words.
 */
const ENGLISH_STOP_WORDS = new Set([
  'the', 'is', 'at', 'which', 'on', 'a', 'an', 'and', 'in', 'to', 'of', 'for',
  'with', 'that', 'this', 'it', 'by', 'as', 'are', 'from', 'or', 'be', 'was',
  'were', 'been', 'has', 'have', 'had', 'do', 'does', 'did', 'but', 'not'
]);

/**
 * Normalizes input text by removing accents, special characters, and collapsing whitespace.
 *
 * @param {string} text
 * @returns {string}
 */
export function normalizarTexto(text) {
  if (!text || typeof text !== 'string') {
    return '';
  }
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Tokenizes text into meaningful terms, excluding stop words and short tokens.
 *
 * @param {string} text
 * @returns {string[]}
 */
export function tokenizarTexto(text) {
  const norm = normalizarTexto(text);
  if (!norm) {
    return [];
  }
  const rawTokens = norm.split(' ');
  const filtered = [];
  for (const token of rawTokens) {
    if (token.length >= 2 && !SPANISH_STOP_WORDS.has(token) && !ENGLISH_STOP_WORDS.has(token)) {
      filtered.push(token);
    }
  }
  return filtered;
}

/**
 * Computes cosine similarity between two vectors.
 * Supports dense numeric arrays `number[]` and sparse dictionary objects `{ [term: string]: number }`.
 * Returns 0.0 if either vector has zero magnitude or inputs are invalid.
 *
 * @param {number[]|Record<string, number>} vecA
 * @param {number[]|Record<string, number>} vecB
 * @returns {number} Cosine similarity in range [-1.0, 1.0]
 */
export function computeCosineSimilarity(vecA, vecB) {
  if (!vecA || !vecB || typeof vecA !== 'object' || typeof vecB !== 'object') {
    return 0.0;
  }

  const isArrayA = Array.isArray(vecA);
  const isArrayB = Array.isArray(vecB);

  // Case 1: Both are dense numeric arrays
  if (isArrayA && isArrayB) {
    const lenA = vecA.length;
    const lenB = vecB.length;
    const minLen = Math.min(lenA, lenB);
    if (minLen === 0 && lenA === 0 && lenB === 0) {
      return 0.0;
    }

    let dotProduct = 0.0;
    let normASq = 0.0;
    let normBSq = 0.0;

    for (let i = 0; i < minLen; i++) {
      const valA = Number(vecA[i]) || 0.0;
      const valB = Number(vecB[i]) || 0.0;
      dotProduct += valA * valB;
      normASq += valA * valA;
      normBSq += valB * valB;
    }

    for (let i = minLen; i < lenA; i++) {
      const valA = Number(vecA[i]) || 0.0;
      normASq += valA * valA;
    }

    for (let i = minLen; i < lenB; i++) {
      const valB = Number(vecB[i]) || 0.0;
      normBSq += valB * valB;
    }

    if (normASq <= 0.0 || normBSq <= 0.0) {
      return 0.0;
    }

    const similarity = dotProduct / (Math.sqrt(normASq) * Math.sqrt(normBSq));
    if (Number.isNaN(similarity)) {
      return 0.0;
    }
    return Math.max(-1.0, Math.min(1.0, similarity));
  }

  // Case 2: Sparse dictionary objects or mixed representation
  let dotProduct = 0.0;
  let normASq = 0.0;
  let normBSq = 0.0;

  if (!isArrayA && !isArrayB) {
    const keysA = Object.keys(vecA);
    const keysB = Object.keys(vecB);
    if (keysA.length === 0 || keysB.length === 0) {
      return 0.0;
    }

    for (const key of keysA) {
      const valA = Number(vecA[key]) || 0.0;
      normASq += valA * valA;
      if (Object.prototype.hasOwnProperty.call(vecB, key)) {
        const valB = Number(vecB[key]) || 0.0;
        dotProduct += valA * valB;
      }
    }

    for (const key of keysB) {
      const valB = Number(vecB[key]) || 0.0;
      normBSq += valB * valB;
    }
  } else if (isArrayA && !isArrayB) {
    for (let i = 0; i < vecA.length; i++) {
      const valA = Number(vecA[i]) || 0.0;
      normASq += valA * valA;
      if (Object.prototype.hasOwnProperty.call(vecB, i)) {
        const valB = Number(vecB[i]) || 0.0;
        dotProduct += valA * valB;
      }
    }
    for (const key of Object.keys(vecB)) {
      const valB = Number(vecB[key]) || 0.0;
      normBSq += valB * valB;
    }
  } else {
    for (const key of Object.keys(vecA)) {
      const valA = Number(vecA[key]) || 0.0;
      normASq += valA * valA;
    }
    for (let i = 0; i < vecB.length; i++) {
      const valB = Number(vecB[i]) || 0.0;
      normBSq += valB * valB;
      if (Object.prototype.hasOwnProperty.call(vecA, i)) {
        const valA = Number(vecA[i]) || 0.0;
        dotProduct += valA * valB;
      }
    }
  }

  if (normASq <= 0.0 || normBSq <= 0.0) {
    return 0.0;
  }

  const similarity = dotProduct / (Math.sqrt(normASq) * Math.sqrt(normBSq));
  if (Number.isNaN(similarity)) {
    return 0.0;
  }
  return Math.max(-1.0, Math.min(1.0, similarity));
}

/**
 * Alias in Spanish for computeCosineSimilarity.
 */
export const calcularSimilitudCoseno = computeCosineSimilarity;

/**
 * Extracts searchable text from a document object or string.
 *
 * @param {object|string} doc
 * @returns {string}
 */
function extractDocText(doc) {
  if (!doc) {
    return '';
  }
  if (typeof doc === 'string') {
    return doc;
  }
  const parts = [];
  if (doc.sujeto) parts.push(doc.sujeto);
  if (doc.dato) parts.push(doc.dato);
  if (doc.text) parts.push(doc.text);
  if (doc.categoria) parts.push(doc.categoria);
  if (Array.isArray(doc.tags)) {
    parts.push(doc.tags.join(' '));
  }
  return parts.join(' ');
}

/**
 * Builds a TF-IDF index over an array of document objects or strings.
 *
 * @param {Array<object|string>} documents
 * @returns {{ vocabulary: string[], idfMap: Record<string, number>, docVectors: Array<number[]>, documents: Array<object|string> }}
 */
export function buildTfIdfIndex(documents) {
  documents = filtrarDocumentosSensibles(documents);
  if (!Array.isArray(documents) || documents.length === 0) {
    return {
      vocabulary: [],
      idfMap: {},
      docVectors: [],
      documents: []
    };
  }

  const docTokensList = [];
  const termDocFreq = new Map();

  for (const doc of documents) {
    const text = extractDocText(doc);
    const tokens = tokenizarTexto(text);
    docTokensList.push(tokens);

    const uniqueInDoc = new Set(tokens);
    for (const term of uniqueInDoc) {
      termDocFreq.set(term, (termDocFreq.get(term) || 0) + 1);
    }
  }

  const vocabulary = Array.from(termDocFreq.keys()).sort();
  const numDocs = documents.length;
  const idfMap = {};

  for (const term of vocabulary) {
    const df = termDocFreq.get(term) || 0;
    // Smoothed IDF formula: ln(1 + (|D| / (1 + df))) + 1
    const idf = Math.log(1 + (numDocs / (1 + df))) + 1;
    idfMap[term] = idf;
  }

  const docVectors = [];
  for (const tokens of docTokensList) {
    const termCounts = new Map();
    for (const t of tokens) {
      termCounts.set(t, (termCounts.get(t) || 0) + 1);
    }

    const totalTerms = tokens.length;
    const vector = new Array(vocabulary.length).fill(0.0);

    if (totalTerms > 0) {
      for (let i = 0; i < vocabulary.length; i++) {
        const term = vocabulary[i];
        const count = termCounts.get(term) || 0;
        if (count > 0) {
          const tf = count / totalTerms;
          vector[i] = tf * idfMap[term];
        }
      }
    }
    docVectors.push(vector);
  }

  return {
    vocabulary,
    idfMap,
    docVectors,
    documents
  };
}

/**
 * Alias in Spanish for buildTfIdfIndex.
 */
export const construirIndiceTfIdf = buildTfIdfIndex;

/**
 * Converts a text string into a TF-IDF vector matching the given vocabulary and IDF map.
 *
 * @param {string} text
 * @param {string[]} vocabulary
 * @param {Record<string, number>} idfMap
 * @returns {number[]} Dense numeric vector
 */
export function vectorizeText(text, vocabulary, idfMap) {
  if (!Array.isArray(vocabulary) || vocabulary.length === 0) {
    return [];
  }
  const tokens = tokenizarTexto(text);
  const vector = new Array(vocabulary.length).fill(0.0);
  if (tokens.length === 0) {
    return vector;
  }

  const termCounts = new Map();
  for (const t of tokens) {
    termCounts.set(t, (termCounts.get(t) || 0) + 1);
  }

  const totalTerms = tokens.length;
  for (let i = 0; i < vocabulary.length; i++) {
    const term = vocabulary[i];
    const count = termCounts.get(term) || 0;
    if (count > 0) {
      const tf = count / totalTerms;
      const idf = idfMap && idfMap[term] !== undefined ? idfMap[term] : 1.0;
      vector[i] = tf * idf;
    }
  }

  return vector;
}

/**
 * Alias in Spanish for vectorizeText.
 */
export const vectorizarTexto = vectorizeText;

/**
 * Loads memories from the specified file path or default store path.
 *
 * @param {string} [filePath]
 * @returns {Array<object>}
 */
export function leerMemoriasDesdeArchivo(filePath) {
  const targetPath = filePath || getDefaultStorePath();
  try {
    if (!fs.existsSync(targetPath)) {
      return [];
    }
    const raw = fs.readFileSync(targetPath, 'utf8');
    if (!raw.trim()) {
      return [];
    }
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.error('Error al leer memorias desde archivo:', err.message);
    return [];
  }
}

// Global in-memory caches
let cachedIndex = null;
let cachedStorePath = null;
let cachedVectorCache = null;
let cachedVectorCachePath = null;

/**
 * Builds or refreshes the semantic index from the given documents or file.
 *
 * @param {object|Array} [options]
 * @returns {object} The built TF-IDF index
 */
export function indexarMemorias(options = {}) {
  let docs = [];
  let targetPath = null;

  if (Array.isArray(options)) {
    docs = options;
  } else if (options && typeof options === 'object') {
    if (Array.isArray(options.memorias)) {
      docs = options.memorias;
    } else if (Array.isArray(options.documents)) {
      docs = options.documents;
    } else {
      targetPath = options.storePath || options.memoryFilePath || getDefaultStorePath();
      docs = leerMemoriasDesdeArchivo(targetPath);
    }
  } else {
    targetPath = getDefaultStorePath();
    docs = leerMemoriasDesdeArchivo(targetPath);
  }

  const index = buildTfIdfIndex(docs);
  if (targetPath) {
    cachedIndex = index;
    cachedStorePath = targetPath;
  }
  return index;
}

/**
 * Helper to construct a vector cache structure from an index and document array.
 *
 * @param {object} index
 * @param {Array<object|string>} docs
 * @returns {object}
 */
function buildVectorCacheFromIndex(index, docs) {
  const vectorEntries = [];
  for (let i = 0; i < docs.length; i++) {
    const doc = docs[i];
    const docId = (typeof doc === 'object' && doc !== null && doc.id) ? doc.id : `doc_${i}`;
    const denseVec = (index.docVectors && index.docVectors[i]) ? index.docVectors[i] : [];

    const sparseVec = {};
    for (let v = 0; v < index.vocabulary.length; v++) {
      const weight = denseVec[v];
      if (weight && weight > 0) {
        sparseVec[index.vocabulary[v]] = Math.round(weight * 10000) / 10000;
      }
    }

    vectorEntries.push({
      id: docId,
      sujeto: (typeof doc === 'object' && doc !== null && doc.sujeto) ? doc.sujeto : '',
      dato: (typeof doc === 'object' && doc !== null) ? (doc.dato || doc.text || '') : String(doc),
      categoria: (typeof doc === 'object' && doc !== null && doc.categoria) ? doc.categoria : 'general',
      tags: (typeof doc === 'object' && doc !== null && Array.isArray(doc.tags)) ? doc.tags : [],
      vector: denseVec.map((val) => Math.round(val * 10000) / 10000),
      sparseVector: sparseVec,
      doc
    });
  }

  return {
    version: '1.0.0',
    fechaActualizacion: new Date().toISOString(),
    totalDocumentos: docs.length,
    vocabulary: index.vocabulary,
    idfMap: index.idfMap,
    vectors: vectorEntries
  };
}

/**
 * Indexes memories into persistent vector cache storage.
 * Computes TF-IDF representations and persists them into knowledge_vectors.json.
 *
 * @param {object} [options]
 * @param {Array<object>} [options.memorias]
 * @param {Array<object>} [options.documents]
 * @param {string} [options.storePath]
 * @param {string} [options.vectorsPath]
 * @returns {{ ok: boolean, total: number, vocabularyLength: number, vectorsPath: string, cache: object, index: object }}
 */
export function indexarMemoriasVectoriales(options = {}) {
  const storePath = options.storePath || options.memoryFilePath || getDefaultStorePath();
  const vectorsPath = options.vectorsPath || getDefaultVectorsPath();

  let docs = [];
  if (Array.isArray(options.memorias)) {
    docs = options.memorias;
  } else if (Array.isArray(options.documents)) {
    docs = options.documents;
  } else if (Array.isArray(options)) {
    docs = options;
  } else {
    // Sin documentos explicitos: la fuente registrada (sqlite) o el archivo.
    docs = fuenteDe(options, storePath).leerMemorias();
  }

  const index = buildTfIdfIndex(docs);
  const cache = buildVectorCacheFromIndex(index, index.documents || docs);
  cache.firmaMemoria = options.firmaMemoria !== undefined ? options.firmaMemoria : fuenteDe(options, storePath).firma();
  cache.fuenteMemoria = storePath;

  if (vectorsPath) {
    try {
      const dir = path.dirname(vectorsPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(vectorsPath, JSON.stringify(cache, null, 2), 'utf8');
    } catch (err) {
      console.error('Error al guardar knowledge_vectors:', err.message);
    }
  }

  cachedVectorCache = cache;
  cachedVectorCachePath = vectorsPath;
  cachedIndex = index;
  cachedStorePath = storePath;

  return {
    ok: true,
    total: docs.length,
    vocabularyLength: index.vocabulary.length,
    vectorsPath,
    cache,
    index
  };
}

/**
 * Invalida las caches en memoria del indice semantico. La llama
 * memoryService tras cada escritura (guardar, actualizar, olvidar) para
 * que la siguiente busqueda reconstruya el indice desde el archivo.
 */
export function invalidarIndiceSemantico() {
  cachedIndex = null;
  cachedStorePath = null;
  cachedVectorCache = null;
  cachedVectorCachePath = null;
}

/**
 * Loads the persistent vector index from knowledge_vectors.json.
 *
 * @param {string} [vectorsPath]
 * @returns {object|null}
 */
export function cargarIndiceVectorial(vectorsPath) {
  const targetPath = vectorsPath || getDefaultVectorsPath();
  try {
    if (!fs.existsSync(targetPath)) {
      return null;
    }
    const raw = fs.readFileSync(targetPath, 'utf8');
    if (!raw.trim()) {
      return null;
    }
    const parsed = JSON.parse(raw);
    if (parsed && Array.isArray(parsed.vocabulary) && Array.isArray(parsed.vectors)) {
      return parsed;
    }
    return null;
  } catch (err) {
    console.error('Error al cargar knowledge_vectors:', err.message);
    return null;
  }
}

/**
 * Writes the vector index cache to disk.
 *
 * @param {object} cache
 * @param {string} [vectorsPath]
 * @returns {boolean}
 */
export function guardarIndiceVectorial(cache, vectorsPath) {
  const targetPath = vectorsPath || getDefaultVectorsPath();
  try {
    const dir = path.dirname(targetPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(targetPath, JSON.stringify(cache, null, 2), 'utf8');
    cachedVectorCache = cache;
    cachedVectorCachePath = targetPath;
    return true;
  } catch (err) {
    console.error('Error al guardar knowledge_vectors:', err.message);
    return false;
  }
}

/**
 * Refreshes the semantic index from disk.
 *
 * @param {string} [memoryFilePath]
 * @returns {number} Indexed document count
 */
export function refreshSemanticIndex(memoryFilePath) {
  const targetPath = memoryFilePath || getDefaultStorePath();
  // Fuente registrada (sqlite) si la hay; si no, el archivo historico.
  const docs = fuenteDe(null, targetPath).leerMemorias();
  cachedIndex = buildTfIdfIndex(docs);
  cachedStorePath = targetPath;
  return docs.length;
}

/**
 * Alias in Spanish for refreshSemanticIndex.
 */
export const refrescarIndiceSemantico = refreshSemanticIndex;

/**
 * Searches memories using semantic similarity (TF-IDF vector cosine distance).
 * Uses precomputed or cached vectors from knowledge_vectors.json when available.
 *
 * @param {string} query
 * @param {object} [options]
 * @param {number} [options.topK=5]
 * @param {number} [options.top_k]
 * @param {number} [options.minScore]
 * @param {number} [options.threshold]
 * @param {string} [options.categoria]
 * @param {string} [options.storePath]
 * @param {string} [options.memoryFilePath]
 * @param {string} [options.vectorsPath]
 * @param {Array<object>} [options.memorias]
 * @param {Array<object>} [options.documents]
 * @returns {Promise<Array<object>>} Ranked list of matching memory records
 */
export async function buscarMemoriaSemantica(query, options = {}) {
  if (!query || typeof query !== 'string' || !query.trim()) {
    return [];
  }

  const tokens = tokenizarTexto(query);
  if (tokens.length === 0) {
    return [];
  }

  const storePath = options.storePath || options.memoryFilePath || getDefaultStorePath();
  const vectorsPath = options.vectorsPath || getDefaultVectorsPath();
  const topK = options.topK || options.top_k || 5;

  // Threshold: options.minScore takes precedence, then options.threshold, otherwise default 0.15
  // When options.memorias is provided directly, allow a lower floor (0.01) if not explicitly set
  let minScore = 0.15;
  if (options.minScore !== undefined) {
    minScore = options.minScore;
  } else if (options.threshold !== undefined) {
    minScore = options.threshold;
  } else if (Array.isArray(options.memorias) || Array.isArray(options.documents)) {
    minScore = 0.01;
  }

  const categoriaFilter = options.categoria ? options.categoria.toLowerCase() : null;

  let vectorCache = null;

  if (Array.isArray(options.memorias)) {
    const tempIndex = buildTfIdfIndex(options.memorias);
    vectorCache = buildVectorCacheFromIndex(tempIndex, tempIndex.documents || options.memorias);
  } else if (Array.isArray(options.documents)) {
    const tempIndex = buildTfIdfIndex(options.documents);
    vectorCache = buildVectorCacheFromIndex(tempIndex, tempIndex.documents || options.documents);
  } else {
    const fuente = fuenteDe(options, storePath);
    const firmaActual = fuente.firma();

    if (cachedVectorCache && cachedVectorCachePath === vectorsPath) {
      vectorCache = cachedVectorCache;
    } else {
      vectorCache = cargarIndiceVectorial(vectorsPath);
      if (vectorCache) {
        cachedVectorCache = vectorCache;
        cachedVectorCachePath = vectorsPath;
      }
    }

    // Frescura: si el archivo de memorias cambio desde que se construyo el
    // indice (guardar/actualizar/olvidar, tambien fuera de este proceso),
    // la firma ya no coincide y hay que reconstruir. Un indice sin firma
    // (generado antes de este control) se reconstruye una vez.
    const indiceVacio = !vectorCache || !Array.isArray(vectorCache.vectors) || vectorCache.vectors.length === 0;
    const firmaIndice = vectorCache ? (vectorCache.firmaMemoria || null) : null;
    const memoriasPresentes = firmaActual !== null;
    const desactualizado = memoriasPresentes && firmaIndice !== firmaActual;

    if (indiceVacio || desactualizado) {
      const memorias = fuente.leerMemorias();
      const indexables = filtrarDocumentosSensibles(memorias);
      if (indexables.length > 0) {
        const indexed = indexarMemoriasVectoriales({ memorias, storePath, vectorsPath, firmaMemoria: firmaActual });
        vectorCache = indexed.cache;
      } else {
        vectorCache = null;
        if (desactualizado) {
          // Purga el indice obsoleto del disco: puede contener memorias ya
          // borradas o documentos que ya no deben indexarse.
          try {
            fs.writeFileSync(vectorsPath, JSON.stringify({
              version: '1.0.0',
              fechaActualizacion: new Date().toISOString(),
              totalDocumentos: 0,
              vocabulary: [],
              idfMap: {},
              vectors: [],
              firmaMemoria: firmaActual,
              fuenteMemoria: storePath
            }, null, 2), 'utf8');
          } catch (errPurgar) {
            console.error('Error al purgar knowledge_vectors obsoleto:', errPurgar.message);
          }
        }
      }
    }
  }

  if (
    !vectorCache ||
    !Array.isArray(vectorCache.vocabulary) ||
    vectorCache.vocabulary.length === 0 ||
    !Array.isArray(vectorCache.vectors) ||
    vectorCache.vectors.length === 0
  ) {
    return [];
  }

  const queryVector = vectorizeText(query, vectorCache.vocabulary, vectorCache.idfMap);

  let queryHasSignal = false;
  for (let i = 0; i < queryVector.length; i++) {
    if (queryVector[i] > 0) {
      queryHasSignal = true;
      break;
    }
  }
  if (!queryHasSignal) {
    return [];
  }

  const results = [];
  for (let i = 0; i < vectorCache.vectors.length; i++) {
    const entry = vectorCache.vectors[i];
    const doc = entry.doc || entry;

    // Defensa en profundidad: una credencial nunca sale por el camino RAG,
    // aunque un knowledge_vectors.json antiguo la tuviera indexada.
    if (esDocumentoSensibleRag(doc) || esDocumentoSensibleRag(entry)) {
      continue;
    }

    if (categoriaFilter && doc.categoria && doc.categoria.toLowerCase() !== categoriaFilter) {
      continue;
    }

    const docVec = entry.vector || entry.sparseVector;
    const score = computeCosineSimilarity(queryVector, docVec);

    if (score >= minScore) {
      const roundedScore = Math.round(score * 10000) / 10000;
      results.push({
        id: doc.id || entry.id || `doc_${i}`,
        sujeto: doc.sujeto || entry.sujeto || '',
        dato: doc.dato || (typeof doc === 'string' ? doc : doc.text || entry.dato || ''),
        categoria: doc.categoria || entry.categoria || 'general',
        tags: Array.isArray(doc.tags) ? doc.tags : (Array.isArray(entry.tags) ? entry.tags : []),
        score: roundedScore,
        similitud: roundedScore,
        item: doc
      });
    }
  }

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, topK);
}

/**
 * Alias in English for buscarMemoriaSemantica.
 */
export const searchSemanticMemory = buscarMemoriaSemantica;

export {
  cargarGrafo,
  guardarGrafo,
  agregarNodo,
  agregarArista,
  extraerEntidadesDeTexto,
  buscarVecindadGrafo,
  obtenerContextoGrafo
} from './graphMemoryService.js';
