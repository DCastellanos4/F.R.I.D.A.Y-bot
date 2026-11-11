# ERS proximo nivel: estado de integracion (corte revisable)

Rama `ers/fase1-outbox`, base `20d53469`. Todo INERTE por defecto: sin
`DAVIS_SLM_MODEL`, `QDRANT_URL` ni `DAVIS_ASYNC_PIPELINE` el
comportamiento es el historico.
Suite integrada: 1253 pass / 0 fail / 7 skip (1191 baseline + 62 nuevos)
en el ultimo corte completo medido; los cortes posteriores reportan
conteos por suites afectadas (limite de 120 s del entorno local).
El ERS declara baseline 1.193; el real conocido es 1.191: discrepancia
del documento, no del codigo.

## Bloques integrados

- **RF-01**: migracion 006 (outbox_events, job_checkpoints,
  channel_responses), 007 (audit_herramientas) y 008 (enviando_en);
  outbox store con reclamo atomico y recuperacion de reclamos expirados,
  JobQueuePort, cola SQLite (dev) y adaptador BullMQ
  (carga perezosa, fail-closed), worker con checkpoints y auditoria,
  entregador con clases de fallo explicitas (solo fallo pre-envio
  verificado reintenta; lo ambiguo cierra a incierto sin reenvio ciego),
  hook aditivo en el bucle ReAct (opciones.onCheckpointRonda /
  checkpointInicial). Wiring local B1: contenedor instancia el pipeline
  con `DAVIS_ASYNC_PIPELINE=1` (ACK inmediato + alta en caliente del
  canal de entrega; whatsappBot registra el adaptador solo con ese env).
  El corte LOCAL posterior agrega migracion 010 y puente ID-only elegido
  con `DAVIS_QUEUE=redis`: token/lease SQLite cercan checkpoint, auditoria,
  respuesta y cierre; incertidumbres sobreviven a multiples recuperaciones.
  No hay Redis vivo/activacion/ensayo real. El default SQLite se conserva;
  ver docs/rf01-queue-selector-and-bridge-scope.md para limites y drenaje.
- **RF-02**: modulos SLM (delta revisado) + wiring en el clasificador
  conservando umbral 0.6 y cache; conversacion nivel-1 consumida en
  messageProcessor con guardias (confirmacion desnuda o pendiente siempre
  llega al agente) y escalada; extraccion de argumentos declarada NO
  consumida por disenyo (re-extraer lo que el LLM ya especifico anade
  generacion y arriesga cambiar la accion; ver brechas);
  metricas `jarvis_inferencia_decisiones_total`
  y `jarvis_tokens_saved_by_local_slm_total` (ESTIMACION por bytes, no
  coste medido). Via cloud: siempre el proveedor actual (Groq).
- **RF-03**: motor hibrido (delta v2) detras de puertos; contenedor lo
  construye solo con `QDRANT_URL` y lo registra como buscador por
  defecto: `buscarMemoriaSemantica` lo consume con frescura por firma
  (una escritura de memoria fuerza reindexacion antes de responder) y
  caida declarada al TF-IDF historico; `esIndexable` mantiene fuera la
  categoria `clave` y documentos sensibles.
- **RNF-04**: anonimizador PII (IBAN mod-97, DNI/NIE mod-23, tarjetas
  Luhn, telefonos, emails; lista blanca acotada; restauracion local) y
  auditoria con cadena SHA256 calculada sobre contenido YA anonimizado.

## Brechas declaradas (no confundir con cumplimiento)

- La auditoria del worker conserva la MARCA durable antes de las acciones
  con efectos y agrega una fila post-wrapper con hash de la respuesta
  anonimizada. El nuevo hook usa el nombre del catalogo o `desconocida`.
  El contenido hasheado incluye fase y estado (`retorno`, `error` o
  `acceso_denegado`); no hay columnas nuevas de estado ni texto en claro.
  Un retorno no prueba el efecto externo. El error usa una clase fija, no
  el texto de la excepcion. Fallos de auditoria del resultado se declaran
  en los metadatos de la respuesta, sin reintentar la herramienta.
  Limites: solo invocaciones que llegan a ejecutarHerramientaJarvis con
  el hook del worker. Guardias previas, dedup/checkpoint bloqueado,
  herramientas anidadas fuera del wrapper y ejecuciones fuera del worker
  no quedan cubiertas por este hook. La auditoria previa de intenciones
  mantiene su contrato historico; no se convierte en prueba de ejecucion.
  No hay garantia de auditoria completa: una muerte entre el resultado y
  la fila deja la intencion sin resultado. No se reconstruye ni reejecuta.
  Sigue siendo cadena SHA256, no firma ni inmutabilidad. Preparacion local
  detallada en docs/rnf04-audit-result-hook.md, sin activacion en servidor.
- RNF-04 PII PRE-LLM: proteccion central en `llmService.chatCompletion`
  activa con `DAVIS_PII_PRELLM=1`. TODA llamada pasa por la envolvente,
  incluidos los imports directos anteriores a la construccion del
  contenedor (envolvente perezosa si la raiz aun no registro la suya);
  anonimiza contenido y arguments hacia la nube, restaura en local, mapa
  por peticion nunca enviado, estructura e ids intactos, fail-closed,
  streaming bloqueado de momento. Multipart hacia la nube: RECHAZADO
  (fail-closed). La excepcion local exige provider efectivo Ollama y
  host real loopback, resueltos con la misma funcion que el crudo:
  provider explicito o config; host del singleton si ya existe, si no
  config.llm.ollamaHost/config.ollamaHost/defecto. OLLAMA_HOST se captura
  en config al importar. Los hints baseUrl/host de la peticion NO cambian
  el transporte Ollama ni prueban localidad. Ningun otro provider obtiene
  la excepcion local. ticketVision qwen2.5vl se preserva si el proveedor
  efectivo es Ollama y su host real es loopback.
  Limite: sin DAVIS_PII_PRELLM=1 el camino historico NO anonimiza;
  activar esa variable es una decision separada por el canal.
- Modos auxiliares (traductor/entrevista): reparar su inyeccion es
  OPT-IN con DAVIS_AUX_CHAT_COMPLETION=1; sin esa variable reciben
  undefined exactamente como antes del corte. Condensacion y agente
  siguen usando el despachador central (ya estaban activos).
- El bypass conversacional elimina emojis y cae al agente ante algunas
  afirmaciones de ejecucion o promesas futuras. Son heuristicas, no
  guardias equivalentes a todo el pipeline historico ni certificacion
  de seguridad. No se debe activar sin revisar esa deuda.
- La cadena SHA256 es evidencia de integridad, NO firma criptografica ni
  inmutabilidad. Residual EXPLICITO: la anonimizacion PII es determinista,
  asi que el hash de un valor PII permite VERIFICAR una sospecha (ataque
  de diccionario sobre el espacio pequenyo de telefonos/DNI): NO esta
  cerrado. Los args no-PII de baja entropia (importes, fechas) tambien son
  adivinables. Endurecer = HMAC con clave fuera de la DB y anclaje externo
  del ultimo hash.
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

## Infraestructura pendiente (gratuita; se coordina por el canal, no la autoriza este documento)

- Redis gratuito local, autenticacion/persistencia/configuracion revisadas
  y ventana de migracion/drenaje (carril BullMQ preparado, no activado).
  La presencia de dependencias en package.json no prueba el broker vivo.
- Qdrant en Docker (bind 127.0.0.1, api-key), `ollama pull bge-m3`,
  TEI cpu + bge-reranker-base. Versiones/digests por fijar cuando se
  coordine la activacion por el canal.

## Fuera de alcance de este corte

- RF-04 (MCP): conflicto de alcance sin resolver; cero implementacion.
- RF-05 (voz full-duplex): sin fase en el ERS; requiere decision de canal
  (WhatsApp/Baileys no soporta streaming duplex).

Strict Policy: Zero Emojis.
