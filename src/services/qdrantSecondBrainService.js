/**
 * qdrantSecondBrainService.js - Indexacion vectorial y busqueda semantica del Second Brain (RF-03).
 *
 * Conecta las notas personales de David (data/notes/) con la coleccion
 * 'davis_memorias_propietario' en Qdrant usando embeddings bge-m3 (1024 dimensiones)
 * generados por Ollama local.
 *
 * Implementa chunking inteligente de markdown, extraccion de metadatos tipados:
 * { tenant_id: 'propietario', file, tag, content, chunk_index, created_at }
 * y busqueda densa con recuperacion resiliente y degradacion elegante (graceful fallback).
 *
 * Strict Policy: Zero Emojis.
 */

import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from '../config/paths.js';
import { crearQdrantVectorStoreAdapter } from '../adapters/outbound/vectorstores/qdrantVectorStoreAdapter.js';
import { crearOllamaEmbeddingAdapter } from '../adapters/outbound/embeddings/ollamaEmbeddingAdapter.js';
import { TENANT_PROPIETARIO } from '../core/tenancy.js';

export const MODELO_EMBEDDING_DEFECTO = 'bge-m3';
export const DIMENSIONES_DEFECTO = 1024;
export const MAX_CHUNK_CHARS = 600;
export const OVERLAP_CHARS = 80;

/**
 * Parsea el contenido markdown y frontmatter de una nota.
 *
 * @param {string} rawContent
 * @param {string} rutaRelativa
 * @returns {object}
 */
export function parsearNotaMarkdown(rawContent, rutaRelativa = '') {
  const contenido = String(rawContent || '');
  let category = 'general';
  let timestamp = '';
  let tags = [];
  let author = 'David';
  let source = 'text';

  const fmMatch = contenido.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  let cuerpo = contenido;
  if (fmMatch) {
    cuerpo = contenido.slice(fmMatch[0].length).trim();
    const lineas = fmMatch[1].split(/\r?\n/);
    let enTags = false;
    for (const linea of lineas) {
      const trimmed = linea.trim();
      if (trimmed.startsWith('tags:')) {
        const resto = trimmed.slice(5).trim();
        if (resto) {
          const limpio = resto.replace(/^\[|\]$/g, '');
          tags = limpio.split(',').map((t) => t.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
          enTags = false;
        } else {
          enTags = true;
        }
        continue;
      }
      if (enTags) {
        if (trimmed.startsWith('- ')) {
          tags.push(trimmed.slice(2).trim().replace(/^['"]|['"]$/g, ''));
          continue;
        } else if (!trimmed.startsWith('-') && trimmed.includes(':')) {
          enTags = false;
        }
      }
      const idxColon = trimmed.indexOf(':');
      if (idxColon !== -1) {
        const k = trimmed.slice(0, idxColon).trim();
        const v = trimmed.slice(idxColon + 1).trim().replace(/^["']|["']$/g, '');
        if (k === 'category') category = v;
        if (k === 'timestamp') timestamp = v;
        if (k === 'author') author = v;
        if (k === 'source') source = v;
      }
    }
  }

  // Extraccion de titulo
  const titleMatch = cuerpo.match(/^#\s+(.+)$/m);
  const titulo = titleMatch ? titleMatch[1].trim() : path.basename(rutaRelativa, '.md');

  // Si no habia tags en frontmatter, buscar linea de etiquetas
  if (tags.length === 0) {
    const tagLineMatch = cuerpo.match(/(?:tags|etiquetas):\s*(.+)/i);
    if (tagLineMatch) {
      tags = tagLineMatch[1].split(',').map((t) => t.trim().toLowerCase()).filter(Boolean);
    }
  }

  // Timestamp de respaldo: derivar de fecha en ruta si procede (ej. 2026-11-07)
  if (!timestamp) {
    const fechaMatch = rutaRelativa.match(/(\d{4}-\d{2}-\d{2})/);
    if (fechaMatch) {
      timestamp = new Date(`${fechaMatch[1]}T12:00:00Z`).toISOString();
    } else {
      timestamp = new Date().toISOString();
    }
  }

  return {
    file: path.basename(rutaRelativa),
    relPath: rutaRelativa,
    titulo,
    category,
    author,
    source,
    tags,
    tag: tags.join(', '),
    created_at: timestamp,
    body: cuerpo
  };
}

/**
 * Trocea el texto de una nota de forma inteligente (por secciones markdown o parrafos)
 * respetando el limite maximo y aplicando solapamiento (overlap).
 *
 * @param {object} nota Parseada por parsearNotaMarkdown
 * @param {object} [opciones]
 * @returns {Array<object>} Chunks con metadatos normalizados
 */
export function trocearNota(nota, opciones = {}) {
  const maxChars = opciones.maxChars || MAX_CHUNK_CHARS;
  const overlap = opciones.overlap || OVERLAP_CHARS;
  const tenantId = opciones.tenantId || TENANT_PROPIETARIO;

  const textoCompleto = (nota.body || '').trim();
  if (!textoCompleto) return [];

  // Dividir por encabezados de seccion o parrafos dobles
  const bloques = textoCompleto.split(/(?=\n##?\s+)|(?:\r?\n\s*\r?\n)/)
    .map((b) => b.trim())
    .filter(Boolean);

  const chunksTexto = [];
  let buffer = '';

  for (const bloque of bloques) {
    if ((buffer.length + bloque.length + 1) <= maxChars) {
      buffer = buffer ? `${buffer}\n\n${bloque}` : bloque;
    } else {
      if (buffer) {
        chunksTexto.push(buffer);
        // Mantener cola de overlap si es suficientemente largo
        if (overlap > 0 && buffer.length > overlap) {
          const corte = buffer.slice(buffer.length - overlap);
          buffer = `${corte}\n\n${bloque}`;
        } else {
          buffer = bloque;
        }
      } else {
        // Bloque unico individual que supera maxChars: dividir linealmente
        let inicio = 0;
        while (inicio < bloque.length) {
          const fin = Math.min(inicio + maxChars, bloque.length);
          chunksTexto.push(bloque.slice(inicio, fin).trim());
          if (fin === bloque.length) break;
          inicio += (maxChars - overlap);
        }
        buffer = '';
      }
    }
  }

  if (buffer.trim()) {
    chunksTexto.push(buffer.trim());
  }

  if (chunksTexto.length === 0) {
    chunksTexto.push(textoCompleto.slice(0, maxChars));
  }

  const chunksFinales = [];
  const total = chunksTexto.length;
  for (let idx = 0; idx < total; idx++) {
    const rawChunk = chunksTexto[idx];
    const chunkId = `${nota.file || 'nota'}#chunk_${idx}`;
    const metadatos = {
      tenant_id: tenantId,
      file: nota.file || '',
      tag: nota.tag || '',
      tags: Array.isArray(nota.tags) ? nota.tags : [],
      content: rawChunk,
      chunk_index: idx,
      total_chunks: total,
      created_at: nota.created_at || new Date().toISOString(),
      categoria: nota.category || 'general',
      titulo: nota.titulo || ''
    };

    chunksFinales.push({
      id: chunkId,
      texto: `${nota.titulo ? `${nota.titulo}\n` : ''}${rawChunk}`,
      payload: metadatos
    });
  }

  return chunksFinales;
}

/**
 * Escanea recursivamente un directorio buscando archivos Markdown.
 *
 * @param {string} dirBase
 * @returns {Array<{ rutaAbsoluta: string, rutaRelativa: string, contenido: string }>}
 */
export function recolectarArchivosMarkdown(dirBase) {
  if (!fs.existsSync(dirBase)) return [];
  const resultados = [];

  function explorar(directorioActual, relActual = '') {
    const entradas = fs.readdirSync(directorioActual, { withFileTypes: true });
    for (const entrada of entradas) {
      const rutaAbs = path.join(directorioActual, entrada.name);
      const rel = relActual ? path.join(relActual, entrada.name) : entrada.name;
      if (entrada.isDirectory()) {
        explorar(rutaAbs, rel);
      } else if (entrada.isFile() && entrada.name.endsWith('.md')) {
        try {
          const contenido = fs.readFileSync(rutaAbs, 'utf8');
          resultados.push({ rutaAbsoluta: rutaAbs, rutaRelativa: rel, contenido });
        } catch {
          // archivo inaccesible: omitir
        }
      }
    }
  }

  explorar(dirBase);
  return resultados;
}

/**
 * Factoria del servicio Second Brain Qdrant.
 *
 * @param {object} [deps]
 * @param {string} [deps.qdrantUrl]
 * @param {number} [deps.dimensiones]
 * @param {string} [deps.modeloEmbedding]
 * @param {string} [deps.carpetaNotas]
 * @param {string} [deps.tenantId]
 * @param {object} [deps.vectorStore]
 * @param {object} [deps.embeddings]
 */
export function crearQdrantSecondBrainService(deps = {}) {
  const tenantId = deps.tenantId || TENANT_PROPIETARIO;
  const dimensiones = Number.isInteger(deps.dimensiones) && deps.dimensiones > 0
    ? deps.dimensiones
    : (Number.parseInt(process.env.DAVIS_EMBEDDING_DIMS || '', 10) || DIMENSIONES_DEFECTO);
  const qdrantUrl = deps.qdrantUrl || process.env.QDRANT_URL || 'http://127.0.0.1:6333';
  const modeloEmbedding = deps.modeloEmbedding || process.env.DAVIS_EMBEDDING_MODEL || MODELO_EMBEDDING_DEFECTO;
  const carpetaNotasBase = deps.carpetaNotas || path.join(DATA_DIR, 'notes');

  const vectorStore = deps.vectorStore || crearQdrantVectorStoreAdapter({
    url: qdrantUrl,
    dimensiones,
    apiKey: process.env.DAVIS_QDRANT_API_KEY || ''
  });

  const embeddings = deps.embeddings || crearOllamaEmbeddingAdapter({
    modelo: modeloEmbedding,
    dimensiones
  });

  /**
   * Lee todas las notas de la carpeta, las parsea, trocea e indexa vectorialmente en Qdrant.
   *
   * @param {object} [opciones]
   * @returns {Promise<{ ok: boolean, totalNotas: number, totalChunks: number, omitidos: number }>}
   */
  async function indexarTodasLasNotas(opciones = {}) {
    const carpeta = opciones.carpetaNotas || carpetaNotasBase;
    const archivos = recolectarArchivosMarkdown(carpeta);
    if (archivos.length === 0) {
      return { ok: true, totalNotas: 0, totalChunks: 0, omitidos: 0 };
    }

    const todosLosChunks = [];
    for (const arch of archivos) {
      const nota = parsearNotaMarkdown(arch.contenido, arch.rutaRelativa);
      const chunks = trocearNota(nota, { tenantId });
      todosLosChunks.push(...chunks);
    }

    if (todosLosChunks.length === 0) {
      return { ok: true, totalNotas: archivos.length, totalChunks: 0, omitidos: 0 };
    }

    // Calculo de embeddings densos
    const textos = todosLosChunks.map((c) => c.texto);
    const vectores = await embeddings.embeber(textos);
    if (!Array.isArray(vectores) || vectores.length !== todosLosChunks.length) {
      throw new Error(`QdrantSecondBrain: error al generar embeddings para ${todosLosChunks.length} fragmentos.`);
    }

    const puntosParaIndexar = todosLosChunks.map((chunk, i) => ({
      id: chunk.id,
      texto: chunk.texto,
      vector: vectores[i],
      payload: chunk.payload
    }));

    await vectorStore.indexar(tenantId, puntosParaIndexar);

    return {
      ok: true,
      totalNotas: archivos.length,
      totalChunks: puntosParaIndexar.length,
      omitidos: 0
    };
  }

  /**
   * Realiza una busqueda densa semantica en Qdrant para una consulta dada.
   * Cuenta con degradacion elegante (graceful fallback) en caso de fallo de infraestructura.
   *
   * @param {string} consulta
   * @param {object} [opciones]
   * @param {number} [opciones.topK=5]
   * @param {number} [opciones.minScore=0.0]
   * @returns {Promise<{ ok: boolean, resultados: Array<object>, semantica: boolean, fallback?: boolean, error?: string }>}
   */
  async function buscar(consulta, opciones = {}) {
    const q = String(consulta || '').trim();
    if (!q) {
      return { ok: true, resultados: [], semantica: true };
    }

    const topK = Number.isInteger(opciones.topK) && opciones.topK > 0 ? opciones.topK : 5;
    const minScore = typeof opciones.minScore === 'number' ? opciones.minScore : 0.0;

    try {
      const [vectorConsulta] = await embeddings.embeber([q]);
      if (!Array.isArray(vectorConsulta)) {
        throw new Error('No se genero el vector para la consulta.');
      }

      const coincidencias = await vectorStore.buscarDenso(tenantId, vectorConsulta, topK * 2);
      const filtradas = [];

      for (const m of (Array.isArray(coincidencias) ? coincidencias : [])) {
        const score = typeof m.score === 'number' ? m.score : 0;
        if (score < minScore) continue;
        const payload = m.payload || {};
        filtradas.push({
          id: m.id || payload.doc_id || '',
          score: Math.round(score * 10000) / 10000,
          tipo: 'segundo_cerebro',
          referencia: payload.titulo || payload.file || 'nota',
          file: payload.file || '',
          tag: payload.tag || '',
          tags: Array.isArray(payload.tags) ? payload.tags : [],
          content: payload.content || m.texto || '',
          chunk_index: payload.chunk_index ?? 0,
          created_at: payload.created_at || '',
          texto: payload.content || m.texto || ''
        });
      }

      return {
        ok: true,
        resultados: filtradas.slice(0, topK),
        semantica: true
      };
    } catch (err) {
      // Degradacion elegante: Qdrant o embeddings no disponibles
      return {
        ok: false,
        fallback: true,
        error: err.message,
        resultados: [],
        semantica: false
      };
    }
  }

  /**
   * Obtiene el conteo de vectores actualmente en la coleccion del tenant.
   *
   * @returns {Promise<number>}
   */
  async function contar() {
    try {
      return await vectorStore.contar(tenantId);
    } catch {
      return 0;
    }
  }

  return {
    tenantId,
    dimensiones,
    indexarTodasLasNotas,
    buscar,
    contar,
    vectorStore,
    embeddings
  };
}
