/**
 * tests/sector3/qdrant_second_brain.test.js - Suite de pruebas de Qdrant Second Brain (RF-03).
 *
 * Cobertura:
 *  1. Parseo de Markdown: frontmatter YAML, etiquetas, titulo y fecha.
 *  2. Troceado inteligente: particion semantica, solapamiento (overlap) y metadatos estrictos:
 *     { tenant_id: 'propietario', file, tag, content, chunk_index, created_at }.
 *  3. Recoleccion recursiva de archivos de notas.
 *  4. Indexacion vectorial completa en Qdrant con bge-m3 (1024 dimensiones) y UUID deterministas.
 *  5. Consulta densa en la coleccion davis_memorias_propietario.
 *  6. Degradacion elegante (graceful fallback) ante desconexion o errores HTTP de Qdrant.
 *  7. Integracion de buscar_recuerdo_semantico con fallback de segundo cerebro.
 *  8. Multi-tenant y defensa de dimensionalidad.
 *
 * Strict Policy: Zero Emojis.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  parsearNotaMarkdown,
  trocearNota,
  recolectarArchivosMarkdown,
  crearQdrantSecondBrainService,
  MODELO_EMBEDDING_DEFECTO,
  DIMENSIONES_DEFECTO
} from '../../src/services/qdrantSecondBrainService.js';
import { crearQdrantVectorStoreAdapter, idAUuid } from '../../src/adapters/outbound/vectorstores/qdrantVectorStoreAdapter.js';
import { buscarSemantico, registrarSegundoCerebroPorDefecto } from '../../src/services/brainSearchService.js';

function crearDirectorioTemporal(prefijo = 'davis-qdrant-sb-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefijo));
}

// Generador de embedding stub de 1024 dimensiones determinista
function crearEmbeddingsStub1024(dims = 1024) {
  return {
    id: 'ollama:bge-m3',
    esReal: true,
    dimensiones: () => dims,
    embeber: async (textos) => {
      const lista = Array.isArray(textos) ? textos : [];
      return lista.map((t, idx) => {
        const vec = new Array(dims).fill(0.001);
        const lower = String(t).toLowerCase();
        if (lower.includes('docker') || lower.includes('servidor')) vec[0] = 0.95;
        if (lower.includes('redes') || lower.includes('tcp')) vec[1] = 0.92;
        if (lower.includes('receta') || lower.includes('cocina')) vec[2] = 0.88;
        vec[idx % dims] += 0.05;
        return vec;
      });
    }
  };
}

// Simulador de Qdrant REST con espia de llamadas
function crearQdrantRestStub() {
  const llamadas = [];
  const colecciones = new Map();
  const puntosPorColeccion = new Map();

  const fetchStub = async (url, init = {}) => {
    const metodo = init.method || 'GET';
    const u = new URL(url);
    const pathname = u.pathname;
    const cuerpo = init.body ? JSON.parse(init.body) : undefined;
    llamadas.push({ metodo, url, pathname, cuerpo, headers: init.headers });

    const ok = (payload, status = 200) => ({
      ok: status >= 200 && status < 300,
      status,
      json: async () => payload,
      text: async () => JSON.stringify(payload)
    });

    // GET /collections/:name
    const matchCol = pathname.match(/^\/collections\/([^/]+)$/);
    if (metodo === 'GET' && matchCol) {
      const colName = matchCol[1];
      if (!colecciones.has(colName)) {
        return { ok: false, status: 404, json: async () => ({}), text: async () => 'Not found' };
      }
      return ok({
        result: {
          config: {
            params: {
              vectors: { size: colecciones.get(colName).size, distance: 'Cosine' }
            }
          }
        }
      });
    }

    // PUT /collections/:name
    if (metodo === 'PUT' && matchCol) {
      const colName = matchCol[1];
      colecciones.set(colName, { size: cuerpo?.vectors?.size || 1024 });
      if (!puntosPorColeccion.has(colName)) puntosPorColeccion.set(colName, []);
      return ok({ result: true });
    }

    // PUT /collections/:name/points
    const matchPoints = pathname.match(/^\/collections\/([^/]+)\/points$/);
    if (metodo === 'PUT' && matchPoints) {
      const colName = matchPoints[1];
      const existentes = puntosPorColeccion.get(colName) || [];
      const nuevos = cuerpo?.points || [];
      for (const p of nuevos) {
        const idx = existentes.findIndex((e) => e.id === p.id);
        if (idx >= 0) existentes[idx] = p;
        else existentes.push(p);
      }
      puntosPorColeccion.set(colName, existentes);
      return ok({ result: { status: 'completed' } });
    }

    // POST /collections/:name/points/search
    const matchSearch = pathname.match(/^\/collections\/([^/]+)\/points\/search$/);
    if (metodo === 'POST' && matchSearch) {
      const colName = matchSearch[1];
      const almacenados = puntosPorColeccion.get(colName) || [];
      const queryVec = cuerpo?.vector || [];
      const limit = cuerpo?.limit || 10;

      // Calcular similitud coseno aproximada
      const resultados = almacenados.map((item) => {
        let dot = 0;
        let normA = 0;
        let normB = 0;
        for (let i = 0; i < Math.min(queryVec.length, item.vector.length); i++) {
          dot += queryVec[i] * item.vector[i];
          normA += queryVec[i] * queryVec[i];
          normB += item.vector[i] * item.vector[i];
        }
        const sim = (normA && normB) ? dot / (Math.sqrt(normA) * Math.sqrt(normB)) : 0;
        return {
          id: item.id,
          score: Math.max(0, Math.min(1, sim)),
          payload: item.payload
        };
      }).sort((a, b) => b.score - a.score).slice(0, limit);

      return ok({ result: resultados });
    }

    // POST /collections/:name/points/count
    const matchCount = pathname.match(/^\/collections\/([^/]+)\/points\/count$/);
    if (metodo === 'POST' && matchCount) {
      const colName = matchCount[1];
      const total = (puntosPorColeccion.get(colName) || []).length;
      return ok({ result: { count: total } });
    }

    throw new Error(`Ruta REST de Qdrant no contemplada en stub: ${metodo} ${pathname}`);
  };

  return { llamadas, colecciones, puntosPorColeccion, fetchStub };
}

// ---------- 1. Parseo de Markdown ----------

test('parsearNotaMarkdown: extrae frontmatter completo, tags y contenido', () => {
  const contenido = [
    '---',
    'timestamp: 2026-11-07T14:00:00.000Z',
    'category: tecnologia',
    'author: David',
    'source: whatsapp',
    'tags:',
    '  - docker',
    '  - debian',
    '  - red',
    '---',
    '',
    '# Despliegue de Servidor VPS',
    '',
    'Configuracion de puertos 6333 para Qdrant y 11434 para Ollama.',
    'Se requiere configurar firewall ufw y politicas de seguridad.'
  ].join('\n');

  const parsed = parsearNotaMarkdown(contenido, '2026-11-07/2026-11-07_140000_tecnologia.md');

  assert.equal(parsed.file, '2026-11-07_140000_tecnologia.md');
  assert.equal(parsed.titulo, 'Despliegue de Servidor VPS');
  assert.equal(parsed.category, 'tecnologia');
  assert.equal(parsed.author, 'David');
  assert.equal(parsed.source, 'whatsapp');
  assert.deepEqual(parsed.tags, ['docker', 'debian', 'red']);
  assert.equal(parsed.tag, 'docker, debian, red');
  assert.equal(parsed.created_at, '2026-11-07T14:00:00.000Z');
  assert.ok(parsed.body.includes('Configuracion de puertos'));
});

test('parsearNotaMarkdown: derivacion sin frontmatter por ruta y etiquetas en linea', () => {
  const contenido = [
    '# Nota Rapida de Cocina',
    'Tags: recetas, pasta, salsa',
    '',
    'Hervir la pasta durante 8 minutos al dente.'
  ].join('\n');

  const parsed = parsearNotaMarkdown(contenido, '2026-11-08/receta.md');
  assert.equal(parsed.titulo, 'Nota Rapida de Cocina');
  assert.deepEqual(parsed.tags, ['recetas', 'pasta', 'salsa']);
  assert.equal(parsed.tag, 'recetas, pasta, salsa');
  assert.ok(parsed.created_at.includes('2026-11-08'));
});

// ---------- 2. Troceado Inteligente y Metadatos ----------

test('trocearNota: genera chunks con metadatos requeridos { tenant_id, file, tag, content, chunk_index, created_at }', () => {
  const nota = {
    file: 'servidor.md',
    titulo: 'Arquitectura VPS',
    category: 'sistemas',
    tag: 'vps, linux',
    tags: ['vps', 'linux'],
    created_at: '2026-11-07T12:00:00Z',
    body: [
      '## Seccion 1: Almacenamiento',
      'Configuracion de disco SSD y particionado ext4 con cuotas de usuario.',
      '',
      '## Seccion 2: Memoria y Swap',
      'El VPS cuenta con 24 GiB de memoria RAM y no dispone de particion swap.',
      'Es prioritario vigilar los consumos de memoria de los modelos locales.',
      '',
      '## Seccion 3: Monitorizacion',
      'Servicio systemd configurado con reinicio automatico en caso de fallo.'
    ].join('\n')
  };

  const chunks = trocearNota(nota, { tenantId: 'propietario', maxChars: 180, overlap: 30 });
  assert.ok(chunks.length >= 2, 'debe generar multiples fragmentos');

  for (let i = 0; i < chunks.length; i++) {
    const c = chunks[i];
    assert.equal(c.id, `servidor.md#chunk_${i}`);
    assert.ok(c.texto.includes('Arquitectura VPS'));

    const p = c.payload;
    // Verificacion de los 6 metadatos obligatorios
    assert.equal(p.tenant_id, 'propietario');
    assert.equal(p.file, 'servidor.md');
    assert.equal(p.tag, 'vps, linux');
    assert.ok(typeof p.content === 'string' && p.content.length > 0);
    assert.equal(p.chunk_index, i);
    assert.equal(p.created_at, '2026-11-07T12:00:00Z');
  }
});

// ---------- 3. Recoleccion de Archivos Markdown ----------

test('recolectarArchivosMarkdown: lee recursivamente solo ficheros .md', () => {
  const tmpDir = crearDirectorioTemporal();
  const sub1 = path.join(tmpDir, '2026-11-07');
  const sub2 = path.join(tmpDir, '2026-11-08');
  fs.mkdirSync(sub1, { recursive: true });
  fs.mkdirSync(sub2, { recursive: true });

  fs.writeFileSync(path.join(sub1, 'nota1.md'), '# Nota 1\nContenido 1', 'utf8');
  fs.writeFileSync(path.join(sub1, 'ignorar.txt'), 'Texto plano', 'utf8');
  fs.writeFileSync(path.join(sub2, 'nota2.md'), '# Nota 2\nContenido 2', 'utf8');

  const recolectados = recolectarArchivosMarkdown(tmpDir);
  assert.equal(recolectados.length, 2);
  const nombres = recolectados.map((r) => path.basename(r.rutaRelativa)).sort();
  assert.deepEqual(nombres, ['nota1.md', 'nota2.md']);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ---------- 4. Indexacion Vectorial en Qdrant (RF-03) ----------

test('indexarTodasLasNotas: crea coleccion davis_memorias_propietario e indexa vectores de 1024d', async () => {
  const tmpDir = crearDirectorioTemporal();
  const fechaDir = path.join(tmpDir, '2026-11-07');
  fs.mkdirSync(fechaDir, { recursive: true });

  fs.writeFileSync(path.join(fechaDir, 'nota_redes.md'), [
    '---',
    'timestamp: 2026-11-07T16:00:00Z',
    'category: redes',
    'tags: [tcp, handshake, ip]',
    '---',
    '# Protocolos de Red',
    'El three-way handshake de TCP establece la conexion fiable entre cliente y servidor.'
  ].join('\n'), 'utf8');

  const { llamadas, fetchStub } = crearQdrantRestStub();
  const embeddingsStub = crearEmbeddingsStub1024(DIMENSIONES_DEFECTO);

  const vectorStore = crearQdrantVectorStoreAdapter({
    url: 'http://127.0.0.1:6333',
    dimensiones: DIMENSIONES_DEFECTO,
    fetchImpl: fetchStub
  });

  const servicio = crearQdrantSecondBrainService({
    carpetaNotas: tmpDir,
    tenantId: 'propietario',
    dimensiones: DIMENSIONES_DEFECTO,
    modeloEmbedding: MODELO_EMBEDDING_DEFECTO,
    vectorStore,
    embeddings: embeddingsStub
  });

  const res = await servicio.indexarTodasLasNotas();
  assert.equal(res.ok, true);
  assert.equal(res.totalNotas, 1);
  assert.ok(res.totalChunks >= 1);

  // Validar creacion de la coleccion requerida davis_memorias_propietario
  const putCol = llamadas.find((l) => l.metodo === 'PUT' && l.pathname === '/collections/davis_memorias_propietario');
  assert.ok(putCol, 'debe crear la coleccion davis_memorias_propietario');
  assert.equal(putCol.cuerpo.vectors.size, 1024);
  assert.equal(putCol.cuerpo.vectors.distance, 'Cosine');

  // Validar puntos indexados con UUID determinista y metadatos
  const putPoints = llamadas.find((l) => l.metodo === 'PUT' && l.pathname === '/collections/davis_memorias_propietario/points');
  assert.ok(putPoints, 'debe subir puntos a la coleccion');
  const puntos = putPoints.cuerpo.points;
  assert.ok(puntos.length >= 1);

  const punto0 = puntos[0];
  const uuidEsperado = idAUuid('nota_redes.md#chunk_0');
  assert.equal(punto0.id, uuidEsperado);
  assert.equal(punto0.vector.length, 1024);

  // Metadatos verificados
  assert.equal(punto0.payload.tenant_id, 'propietario');
  assert.equal(punto0.payload.file, 'nota_redes.md');
  assert.equal(punto0.payload.tag, 'tcp, handshake, ip');
  assert.equal(punto0.payload.chunk_index, 0);
  assert.equal(punto0.payload.created_at, '2026-11-07T16:00:00Z');
  assert.ok(punto0.payload.content.includes('three-way handshake'));

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ---------- 5. Busqueda Densa en Qdrant ----------

test('buscar: recupera fragmentos semanticamente relevantes con metadatos tipados', async () => {
  const tmpDir = crearDirectorioTemporal();
  const fechaDir = path.join(tmpDir, '2026-11-07');
  fs.mkdirSync(fechaDir, { recursive: true });

  fs.writeFileSync(path.join(fechaDir, 'doc1.md'), '# Redes TCP\nConexion fiable con three-way handshake.', 'utf8');
  fs.writeFileSync(path.join(fechaDir, 'doc2.md'), '# Recetas de Cocina\nPasta con tomate y albahaca.', 'utf8');

  const { fetchStub } = crearQdrantRestStub();
  const embeddingsStub = crearEmbeddingsStub1024(DIMENSIONES_DEFECTO);

  const vectorStore = crearQdrantVectorStoreAdapter({
    url: 'http://127.0.0.1:6333',
    dimensiones: DIMENSIONES_DEFECTO,
    fetchImpl: fetchStub
  });

  const servicio = crearQdrantSecondBrainService({
    carpetaNotas: tmpDir,
    tenantId: 'propietario',
    dimensiones: DIMENSIONES_DEFECTO,
    vectorStore,
    embeddings: embeddingsStub
  });

  await servicio.indexarTodasLasNotas();

  const resBusqueda = await servicio.buscar('como se conecta tcp en redes', { topK: 3 });
  assert.equal(resBusqueda.ok, true);
  assert.equal(resBusqueda.semantica, true);
  assert.ok(resBusqueda.resultados.length >= 1);

  const top1 = resBusqueda.resultados[0];
  assert.equal(top1.tipo, 'segundo_cerebro');
  assert.equal(top1.file, 'doc1.md');
  assert.ok(top1.texto.includes('three-way handshake'));

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ---------- 6. Fallback Graceful ante indisponibilidad de Qdrant ----------

test('buscar: degradacion elegante si Qdrant no responde o arroja error HTTP', async () => {
  const vectorStoreRoto = {
    motor: 'qdrant',
    esIndustrial: true,
    indexar: async () => { throw new Error('ECONNREFUSED 127.0.0.1:6333'); },
    buscarDenso: async () => { throw new Error('ECONNREFUSED 127.0.0.1:6333'); },
    borrar: async () => {},
    contar: async () => 0
  };

  const servicio = crearQdrantSecondBrainService({
    vectorStore: vectorStoreRoto,
    embeddings: crearEmbeddingsStub1024(1024)
  });

  const res = await servicio.buscar('consulta sobre servidores');
  assert.equal(res.ok, false);
  assert.equal(res.fallback, true);
  assert.equal(res.semantica, false);
  assert.deepEqual(res.resultados, []);
  assert.match(res.error, /ECONNREFUSED/);
});

// ---------- 7. Integracion de buscar_recuerdo_semantico con degradacion elegante ----------

test('buscarSemantico: integra Qdrant Second Brain y degrada limpiamente a lexico si falla', async () => {
  const tmpDir = crearDirectorioTemporal();
  const fechaDir = path.join(tmpDir, '2026-11-07');
  fs.mkdirSync(fechaDir, { recursive: true });
  fs.writeFileSync(path.join(fechaDir, 'manual.md'), '# Manual de Linux\nComandos basicos del sistema operativo bash.', 'utf8');

  // Caso A: Qdrant disponible devuelve resultado semantico
  const mockSegundoCerebroExito = {
    buscar: async (q) => ({
      ok: true,
      semantica: true,
      resultados: [
        {
          file: 'manual.md',
          referencia: 'Manual de Linux',
          content: 'Comandos basicos del sistema operativo bash.',
          score: 0.94
        }
      ]
    })
  };

  const rExito = await buscarSemantico('terminal comandos', {
    carpetaNotas: tmpDir,
    qdrantSecondBrain: mockSegundoCerebroExito
  });

  assert.equal(rExito.ok, true);
  assert.equal(rExito.semantica, true);
  assert.ok(rExito.resultados.length >= 1);
  assert.ok(rExito.resultados[0].texto.includes('Comandos basicos'));

  // Caso B: Qdrant falla -> Degradacion elegante sin excepcion, recurre a busqueda lexica
  const mockSegundoCerebroFallo = {
    buscar: async () => {
      throw new Error('Servicio Qdrant no alcanzable en puerto 6333');
    }
  };

  const rFallback = await buscarSemantico('manual', {
    carpetaNotas: tmpDir,
    qdrantSecondBrain: mockSegundoCerebroFallo
  });

  assert.equal(rFallback.ok, true);
  assert.ok(rFallback.resultados.length >= 1);
  assert.equal(rFallback.semantica, false, 'sin modelo ni Qdrant declara busqueda por palabras');

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ---------- 8. Aislamiento Multi-Tenant y Seguridad ----------

test('qdrant second brain: aislamiento por tenant y respeto de colecciones', async () => {
  const { llamadas, fetchStub } = crearQdrantRestStub();
  const vectorStore = crearQdrantVectorStoreAdapter({
    url: 'http://127.0.0.1:6333',
    dimensiones: 1024,
    fetchImpl: fetchStub
  });

  const servicioTenantB = crearQdrantSecondBrainService({
    tenantId: 'tenant_invitado',
    dimensiones: 1024,
    vectorStore,
    embeddings: crearEmbeddingsStub1024(1024)
  });

  const tmpDir = crearDirectorioTemporal();
  const res = await servicioTenantB.indexarTodasLasNotas({ carpetaNotas: tmpDir });
  assert.equal(res.ok, true);

  // La coleccion debe ser particionada por tenant
  await vectorStore.indexar('tenant_invitado', [
    { id: 'nota_b', texto: 'prueba aislada', vector: new Array(1024).fill(0.1), payload: {} }
  ]);

  const putColTenantB = llamadas.find((l) => l.pathname === '/collections/davis_memorias_tenant_invitado');
  assert.ok(putColTenantB, 'debe crear coleccion aislada para tenant_invitado');

  fs.rmSync(tmpDir, { recursive: true, force: true });
});
