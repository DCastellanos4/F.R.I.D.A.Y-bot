# RF-03: Motor RAG Hibrido - Decision de infraestructura y contrato de integracion

Bloque RF-03 del ERS (`docs/ers-arquitectura-proximo-nivel.md` v3.0.0-PROD).
Estado: OPERATIVO EN PRODUCCION. Indexacion vectorial de notas en Qdrant con embeddings 'bge-m3' (1024 dimensiones) completada y desplegada.

## 1. Decision de motor vectorial

Grounding del VPS: 4 vCPU CPU-only, 24 GiB RAM, 100+ GiB SSD libres.

| Opcion | Cumple ERS | Coste en este VPS | Veredicto |
| --- | --- | --- | --- |
| **Qdrant en Docker** | Si (opcion explicita del ERS) | Un contenedor en loopback `127.0.0.1:6333`, ~0.3-0.5 GiB RAM en reposo, HNSW con persistencia SSD, API REST (cero dependencias npm nuevas). | **Elegido y Desplegado** |
| pgvector sobre PostgreSQL | Si (opcion explicita del ERS) | Exige provisionar PostgreSQL completo mas driver `pg` en package.json para usar una sola extension. | Descartado por sobrecoste operativo. |
| Vectores en SQLite (bruto) | No | Minimo, pero no es pgvector/Qdrant: sin HNSW industrial escalable. | Descartado para produccion. |

El canal denso queda detras de `VectorStorePort`: `src/adapters/outbound/storage/qdrantVectorStoreAdapter.js`.

## 2. Componentes Operativos

1. **Qdrant Core**: Coleccion `davis_memorias_propietario` corriendo en `http://127.0.0.1:6333` (red interna loopback, sin exposicion publica).
2. **Modelo de Embeddings**: `bge-m3` (1024 dimensiones) servido localmente via Ollama en `http://127.0.0.1:11434`.
3. **Servicio de Second Brain**: `src/services/qdrantSecondBrainService.js`.
   - Chunking semantico por encabezados (`#`, `##`, `###`) y limites de parrafo con control de overlap.
   - Metadatos estrictos por punto: `{ tenant_id: 'propietario', file, tag, content, chunk_index, created_at }`.
4. **Script de Migracion Batch**: `scripts/migrar_second_brain_qdrant.js`.
   - Indexa todas las notas Markdown de `data/notes/` calculando embeddings batch y sincronizando puntos en Qdrant.
5. **Fallback Graceful**: `src/services/brainSearchService.js`.
   - Si Qdrant u Ollama no responden o sufren un timeout, la recuperacion conmuta instantaneamente al flujo lexico-textual sin propagar excepciones ni interrumpir la atencion de la consulta.

## 3. Cobertura de Pruebas
- Suite: `tests/sector3/qdrant_second_brain.test.js` (9/9 pruebas pasando al 100%).
- Integracion con memoria semantica: `tests/sector3/semantic_memory_vectorstore.test.js` (pass).
- Politica estricta: Cero emojis en codigo, tests y logs.
