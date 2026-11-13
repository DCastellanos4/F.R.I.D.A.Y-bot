#!/usr/bin/env node
/**
 * scripts/migrar_second_brain_qdrant.js - Migracion e indexacion vectorial de notas en Qdrant (RF-03).
 *
 * Lee todas las notas de data/notes/, las trocea de forma inteligente e indexa
 * en la coleccion davis_memorias_propietario de Qdrant usando bge-m3 (1024 dims).
 *
 * Strict Policy: Zero Emojis.
 */

import path from 'node:path';
import { DATA_DIR } from '../src/config/paths.js';
import { crearQdrantSecondBrainService } from '../src/services/qdrantSecondBrainService.js';

async function main() {
  const qdrantUrl = process.env.QDRANT_URL || 'http://127.0.0.1:6333';
  const ollamaHost = process.env.OLLAMA_HOST || 'http://127.0.0.1:11434';
  const modelo = process.env.DAVIS_EMBEDDING_MODEL || 'bge-m3';
  const dims = Number.parseInt(process.env.DAVIS_EMBEDDING_DIMS || '', 10) || 1024;
  const carpetaNotas = process.env.DAVIS_NOTES_DIR || path.join(DATA_DIR, 'notes');

  console.log('[Second Brain Migration] Iniciando indexacion vectorial...');
  console.log(`[Config] Qdrant URL: ${qdrantUrl}`);
  console.log(`[Config] Ollama Host: ${ollamaHost}`);
  console.log(`[Config] Modelo Embeddings: ${modelo} (${dims} dimensiones)`);
  console.log(`[Config] Directorio de notas: ${carpetaNotas}`);

  try {
    const servicio = crearQdrantSecondBrainService({
      qdrantUrl,
      dimensiones: dims,
      modeloEmbedding: modelo,
      carpetaNotas
    });

    const resultado = await servicio.indexarTodasLasNotas({ carpetaNotas });
    console.log(`[Second Brain Migration] Proceso finalizado con exito.`);
    console.log(`[Stats] Notas leidas: ${resultado.totalNotas}`);
    console.log(`[Stats] Chunks indexados: ${resultado.totalChunks}`);
    console.log(`[Stats] Omitidos: ${resultado.omitidos}`);
  } catch (error) {
    console.error(`[Second Brain Migration Error] Fallo durante la indexacion: ${error.message}`);
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  main();
}
