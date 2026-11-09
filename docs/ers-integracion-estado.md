# ERS proximo nivel: estado de integracion (corte revisable)

Rama `ers/fase1-outbox`, base `20d53469`. Todo INERTE por defecto: sin
`DAVIS_SLM_MODEL` ni `QDRANT_URL` el comportamiento es el historico.
Suite integrada: 1253 pass / 0 fail / 7 skip (1191 baseline + 62 nuevos).
El ERS declara baseline 1.193; el real conocido es 1.191: discrepancia
del documento, no del codigo.

## Bloques integrados

- **RF-01**: migracion 006 (outbox_events, job_checkpoints,
  channel_responses), outbox store con reclamo atomico y recuperacion de
  reclamos expirados, JobQueuePort, cola SQLite (dev) y adaptador BullMQ
  (carga perezosa, fail-closed), worker con checkpoints, hook aditivo en
  el bucle ReAct (opciones.onCheckpointRonda / checkpointInicial).
- **RF-02**: modulos SLM (delta revisado) + wiring en el clasificador
  conservando umbral 0.6 y cache; metricas `jarvis_inferencia_decisiones_total`
  y `jarvis_tokens_saved_by_local_slm_total` (ESTIMACION por bytes, no
  coste medido). Via cloud: siempre el proveedor actual (Groq).
- **RF-03**: motor hibrido (delta v2) detras de puertos; contenedor lo
  construye solo con `QDRANT_URL`; `esIndexable` mantiene fuera la
  categoria `clave` y documentos sensibles.
- **RNF-04**: anonimizador PII (IBAN mod-97, DNI/NIE mod-23, tarjetas
  Luhn, telefonos, emails; lista blanca acotada; restauracion local) y
  auditoria con cadena SHA256 calculada sobre contenido YA anonimizado.

## Brechas declaradas (no confundir con cumplimiento)

- La cadena SHA256 es evidencia de integridad, NO firma criptografica ni
  inmutabilidad. Residual: args no-PII de baja entropia son adivinables
  por diccionario; endurecer = HMAC/anclaje externo del ultimo hash.
- La confianza del SLM es autodeclarada; el umbral 0.82 es objetivo del
  ERS, no calibracion medida.
- El ahorro `tokens_saved_by_local_slm` es estimacion por bytes, no
  ahorro contrafactual medido; el 75% del RNF-03 no es medible sin MAU.
- El adaptador BullMQ y los clientes Qdrant/TEI solo se han probado con
  stubs; falta prueba contra servicios vivos.
- El checkpoint NO salta herramientas por si solo: la deduplicacion de
  efectos la dan las guardas existentes e idempotencia persistente.
- NO hay garantia exactly-once sobre efectos EXTERNOS: si el proceso
  muere tras ejecutar una herramienta con efecto fuera del sistema
  (p. ej. un envio) y antes de marcar el trabajo, la reejecucion depende
  de la ventana de idempotencia (10 min por defecto) y de que el
  proveedor no ofrece ids de idempotencia. La respuesta al canal si es
  idempotente (id determinista por trabajo) y los checkpoints nunca
  reemiten envios: solo registran herramientas ya completadas.

## Certificacion pendiente (criterios de aceptacion del ERS)

1. Kill real del proceso durante una llamada LLM y reprocesado sin
   duplicar efectos (RF-01, criterio 2).
2. Latencias P95 locales/cloud (RNF-02) y 60% de consultas en local.
3. Recall del RAG hibrido frente al TF-IDF historico y P95 de busqueda.
4. Calibracion del umbral 0.82 con la bateria dorada.
5. Aislamiento multi-tenant sobre el motor vectorial real.

## Infraestructura pendiente (ventana autorizada, gratuita)

- Redis + `npm i bullmq ioredis` (carril BullMQ del RF-01).
- Qdrant en Docker (bind 127.0.0.1, api-key), `ollama pull bge-m3`,
  TEI cpu + bge-reranker-base. Versiones/digests por fijar en la ventana.

## Fuera de alcance de este corte

- RF-04 (MCP): conflicto de alcance sin resolver; cero implementacion.
- RF-05 (voz full-duplex): sin fase en el ERS; requiere decision de canal
  (WhatsApp/Baileys no soporta streaming duplex).

Strict Policy: Zero Emojis.
