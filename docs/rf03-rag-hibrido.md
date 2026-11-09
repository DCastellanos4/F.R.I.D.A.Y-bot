# RF-03: Motor RAG Hibrido - Decision de infraestructura y contrato de integracion

Bloque RF-03 del ERS (`docs/ers-arquitectura-proximo-nivel.md` v3.0.0-PROD).
Estado: codigo y pruebas aisladas completos; infraestructura y certificacion
pendientes de ventana autorizada. Este documento NO toca la seccion de
instalacion del README.

## 1. Decision de motor vectorial (sustentada en recursos del VPS)

Grounding del VPS (9 nov 2026): 4 vCPU CPU-only, 23.4 GiB RAM, 116 GiB de
disco libres, sin swap, Docker operativo via sudo, puertos
6379/5432/6333/6334 libres, sin Redis/Postgres/Qdrant desplegados.

| Opcion | Cumple ERS | Coste en este VPS | Veredicto |
| --- | --- | --- | --- |
| **Qdrant en Docker** | Si (opcion explicita del ERS) | Un contenedor, ~0.3-0.5 GiB RAM en reposo a esta escala, HNSW con persistencia en disco SSD, API REST (cero dependencias npm nuevas) | **Elegido** |
| pgvector sobre PostgreSQL | Si (opcion explicita del ERS) | Exige provisionar PostgreSQL completo (servicio, tuning, backups) mas el driver `pg` en package.json para usar una sola extension | Descartado: sobrecoste operativo para el mismo cumplimiento |
| Vectores en SQLite (bruto) | **No** | Minimo, pero no es pgvector/Qdrant: el ERS nombra ambos motores y exige indice HNSW escalable | Solo como almacen de desarrollo (`dev-local`), declarado `esIndustrial=false` |

El canal denso queda detras de `VectorStorePort`: si una medicion futura
cambia la balanza, pgvector entra como adaptador nuevo sin tocar el nucleo.

## 2. Dependencias de la ventana de infraestructura (nada instalado aun)

Versiones verificadas contra fuentes oficiales el 9 nov 2026:

1. Qdrant: `qdrant/qdrant:v1.20.0` (publicada 22 oct 2026; ~69 MB
   comprimidos linux/amd64; digest ghcr
   `sha256:3a80102f9b2855184d74b6d79e3351320314298c4be1f88ecaf832f147ef7a02`).
   SEGURIDAD: una instancia self-hosted arranca SIN autenticacion, SIN TLS
   y en TODAS las interfaces (documentacion oficial de Qdrant). Despliegue
   obligatorio: `-p 127.0.0.1:6333:6333` (solo loopback) y
   `QDRANT__SERVICE__API_KEY` fijada; el adaptador la envia en la cabecera
   `api-key` (variable `DAVIS_QDRANT_API_KEY`). Existe variante
   `v1.20.0-unprivileged` si se prefiere usuario no root en el contenedor.
2. Embeddings: `ollama pull bge-m3` (~1.2 GB, 1024d, multilingue: encaja
   con el corpus en espanol). Alternativa mas ligera si el CPU se resiente:
   `nomic-embed-text` (768d, ~274 MB), con peor multilingue.
3. Reranker: `ghcr.io/huggingface/text-embeddings-inference:cpu-1.9` con
   `--model-id BAAI/bge-reranker-base`. Compatibilidad VERIFICADA en la
   lista oficial de modelos soportados de TEI (rerankers con posiciones
   absolutas: XLM-RoBERTa como bge-reranker-base/large, GTE, ModernBert);
   no hace falta plan B. Pesos ~1.1 GB (primera descarga del contenedor;
   montar volumen `/data` para no repetirla). Endpoint `/rerank` con
   `raw_scores:false` (defecto: TEI aplica la sigmoide y devuelve
   probabilidades [0,1]) y `truncate:true` (limite 512 tokens del modelo).
   Nota de RAM: TEI levanta un tokenizer por nucleo; en 4 vCPU es manejable
   pero se vigilara en la medicion.

Presupuesto de RAM conjunto estimado: ~2.5-3.5 GiB en carga (Qdrant + TEI +
bge-m3 bajo demanda). Sobre 23 GiB disponibles es holgado, pero bge-m3 y el
modelo de tickets (qwen2.5vl:7b, ~7.8 GiB por foto) no deben solaparse en
pico: el ciclo de vida bajo demanda (keep_alive=0) se mantiene.

Sin embeddings cloud nuevos: el canal denso usa solo el Ollama local ya
autorizado, sin enviar memorias a terceros.

## 3. Arquitectura entregada (todo ficheros NUEVOS, cero ediciones compartidas)

- `src/ports/outbound/EmbeddingProviderPort.js` - contrato de embeddings densos.
- `src/ports/outbound/VectorStorePort.js` - contrato de almacen denso con `esIndustrial`.
- `src/ports/outbound/SparseIndexPort.js` - contrato de indice disperso BM25.
- `src/ports/outbound/RerankerPort.js` - contrato de cross-encoder con `esReal`.
- `src/core/rag/reciprocalRankFusion.js` - RRF k=60 puro y determinista.
- `src/core/rag/hybridRetrievalService.js` - orquestacion: denso + disperso -> RRF -> reranker -> top-K con score [0,1] y procedencia declarada por resultado.
- `src/adapters/outbound/embeddings/ollamaEmbeddingAdapter.js` - `/api/embed` del Ollama local ya existente.
- `src/adapters/outbound/vectorstores/qdrantVectorStoreAdapter.js` - REST real (coleccion por tenant, UUID determinista por documento, defensa de dimensionalidad).
- `src/adapters/outbound/vectorstores/devLocalVectorStoreAdapter.js` - SOLO desarrollo, `esIndustrial=false`.
- `src/adapters/outbound/retrieval/sqliteFts5SparseAdapter.js` - BM25 real via FTS5 `bm25()` en base dedicada `rag_sparse.db` (sin tocar migraciones de jarvis.db; indice derivado, reconstruible).
- `src/adapters/outbound/rerankers/httpCrossEncoderRerankerAdapter.js` - cliente TEI real + passthrough de desarrollo declarado no calibrado.
- `scripts/migrar-vectors-a-motor-hibrido.mjs` - migracion preparada: dry-run por defecto, re-embed desde la fuente (nunca copia vectores TF-IDF), manifiesto verificable, `--revertir` que borra solo artefactos nuevos. `knowledge_vectors.json` y las memorias quedan intactos.
- `tests/sector3/rag_hibrido_rf03.test.js` - 16 pruebas aisladas, todas en verde.

Aislamiento: `tenantId` obligatorio y validado en cada operacion; una
coleccion Qdrant por tenant; filtro `tenant_id` obligatorio en FTS5. El
filtro de credenciales del RAG historico (`esDocumentoSensibleRag`) se
cablea como predicado `esIndexable`: la categoria `clave` no entra en
ningun canal nuevo.

## 4. Contrato de integracion (lo hace el integrador del ERS, no este bloque)

1. `container.js`: construir embeddings/vectorStore/sparseIndex/reranker
   segun entorno y pasar el servicio a `messageProcessor`/`jarvisAgent`.
2. `jarvisAgent.js`: en la busqueda proactiva, si
   `opciones.buscadorHibrido` existe, usarlo y mapear
   `{id, sujeto, dato, categoria, tags, score}` desde `item`+`texto`;
   si no, camino historico `buscarMemoriaSemantica` intacto (rollback).
3. Variables de entorno nuevas: `QDRANT_URL`, `DAVIS_QDRANT_API_KEY`,
   `DAVIS_EMBEDDING_MODEL` (bge-m3), `DAVIS_EMBEDDING_DIMS` (1024),
   `DAVIS_RERANKER_URL` (vacia = reranker desactivado, declarado),
   `DAVIS_RAG_SPARSE_DB`. Sin valores nuevos obligatorios para arrancar:
   sin `QDRANT_URL` el contenedor sigue con el camino historico.
4. Invalidacion: `memoryService` ya invalida el indice TF-IDF tras cada
   escritura; la integracion debe llamar tambien a `hibrido.borrar` /
   re-`indexar` del documento afectado en guardar/actualizar/olvidar
   (frescura por verificar tras la integracion).
5. Telemetria: etiquetar metricas con `etiquetaMotores()`. El servicio NO
   expone ninguna bandera de cumplimiento: `motoresListosParaCertificacion`
   solo dice que los cuatro componentes son reales/industriales, y
   `certificacionRf03` es siempre `no-evaluada` desde codigo.

## 5. Certificacion de RF-03: evidencia externa obligatoria (no simulable)

El cumplimiento NO se deriva de las etiquetas del servicio. Hace falta:

- Ventana de infra: despliegue Qdrant (con bind loopback y API key), pull
  de bge-m3 y del reranker.
- Ejecucion supervisada de la migracion (dry-run ya disponible).
- Prueba contra Qdrant y TEI vivos: los adaptadores REST solo se han
  probado con stubs.
- Recall medido frente al TF-IDF historico sobre consultas reales.
- Latencia P95 de `buscar` medida con embeddings y reranker en la CPU del
  VPS (RNF-02 no medido aun).
- Frescura verificada tras la integracion: una escritura de memoria se
  refleja en la siguiente busqueda hibrida.
- Aislamiento multi-tenant verificado sobre el motor real antes de mover
  `AISLAMIENTO_COMPLETO`.

Solo con esa evidencia medida un informe puede decir RF-03 cumplido.
