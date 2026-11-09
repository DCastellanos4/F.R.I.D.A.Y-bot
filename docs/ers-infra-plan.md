# ERS - Preparacion de infraestructura y rollback

Propuesta pendiente de aprobacion. Este documento no autoriza cambios,
instalaciones, descargas de modelos, inferencias reales ni activaciones.
Las versiones de imagen, recursos disponibles y politica de persistencia
requieren una comprobacion del entorno antes de proponer comandos finales.

## Wiring real del corte

| Pieza | Activacion | Dependencia efectiva |
| --- | --- | --- |
| Pipeline asincrono | DAVIS_ASYNC_PIPELINE=1 | SQLite: DAVIS_ERS_PIPELINE_DB, DAVIS_SQLITE_PATH o DATA_DIR/ers_pipeline.db |
| Busqueda hibrida | QDRANT_URL | Qdrant + embeddings Ollama, FTS5 SQLite y reranker opcional |
| Embeddings | con busqueda hibrida | DAVIS_EMBEDDING_MODEL=bge-m3, DAVIS_EMBEDDING_DIMS=1024; host OLLAMA_HOST |
| Reranker | DAVIS_RERANKER_URL | HTTP /rerank compatible TEI, modelo objetivo BAAI/bge-reranker-base |
| SLM | DAVIS_SLM_MODEL | Ollama: DAVIS_SLM_HOST, defecto loopback:11434 |
| PII central | DAVIS_PII_PRELLM=1 | En proceso; DAVIS_PII_PERMITIR lista acotada opcional |
| Traductor/entrevista | DAVIS_AUX_CHAT_COMPLETION=1 | Reparacion opt-in del proveedor central |

El adaptador BullMQ existe pero NO es la cola elegida por la bandera del
pipeline en este corte. Su variable DAVIS_REDIS_URL no activa ese wiring.
TEI sirve el reranker; los embeddings de este wiring se generan por Ollama.
Ninguna tabla implica que esos servicios o modelos esten disponibles hoy.

## Validacion escalonada propuesta, pendiente de permiso

1. Antes de activar PII: revisar configuracion efectiva de LLM_PROVIDER y
   OLLAMA_HOST al arranque y el destino capturado del cliente. Ollama ignora
   baseUrl/host de cada peticion. No fijar DAVIS_TICKET_VISION_BASE_URL como
   supuesto remedio: no cambia ese transporte. ticketVision qwen2.5vl debe
   conservar proveedor efectivo Ollama y host real loopback. Si no, detener
   la activacion y resolver el destino, sin cambiarlo por iniciativa propia.
2. Ensayo PII con datos sinteticos y proveedor instrumentado: texto remoto
   anonimizado, multipart remoto bloqueado, restauracion local; mapa ausente
   del payload. Inferencia real de tickets solo tras permiso separado.
3. Auxiliar opt-in: comprobar primero default intacto; traduccion y
   entrevista de laboratorio sin ampliar audiencia ni herramientas.
4. Pipeline SQLite en copia aislada: ACK, entrega, auditoria, reinicio y
   reconciliacion de estados inciertos. No prometer exactly-once externo.
5. Busqueda hibrida: medir CPU/RAM/disco disponibles antes de proponer
   Qdrant, descarga bge-m3 y TEI. Tras permiso, validar dimensiones,
   exclusion de documentos sensibles, reranking y comportamiento en fallo.
6. SLM: medir recursos junto a vision/embeddings; revisar antes la deuda de
   guardias del bypass, clasificacion y extraccion de argumentos RF-02.

## Rollback propuesto

- Cambiar variables requiere reinicio controlado: no es instantaneo porque
  el contenedor y algunos clientes capturan configuracion al construirse.
- Desactivar el pipeline no vacia su outbox SQLite. Inventariar pendientes,
  entregados e inciertos, detener productores/workers de forma controlada,
  y reconciliar antes de pasar a sincrono. No duplicar efectos a ciegas.
- Quitar QDRANT_URL y reiniciar devuelve el wiring historico TF-IDF;
  conservar indice y base de datos, sin borrar colecciones por defecto.
- Quitar flags PII, auxiliar o SLM y reiniciar restaura los caminos sin esos
  flags. Retirar PII elimina una proteccion, por lo que necesita decision
  explicita, no debe ser un fallback automatico ante errores.
- Guardar revision, configuracion anterior y copia consistente de SQLite
  antes de un cambio aprobado. Un revert de codigo no deshace efectos
  externos ni es por si solo un rollback seguro de datos.
