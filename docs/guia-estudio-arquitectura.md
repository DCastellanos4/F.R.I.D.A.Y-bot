# D.A.V.I.S. - Guia Maestra de Estudio de Arquitectura e Ingenieria

Documento de preparacion tecnica para entrevistas de trabajo y comprension profunda del sistema.  
Politica de estilo: Cero emojis, castellano tecnico, respuestas estructuradas para comites de evaluacion.  

---

## Indice del Plan de Estudio

1. [Sesion 1: Filosofia, Arquitectura Hexagonal y Puertos de Entrada](#sesion-1-filosofia-arquitectura-hexagonal-y-puertos-de-entrada)
2. [Sesion 2: El Motor de Razonamiento, Podado de Tools e Inferencia Hibrida](#sesion-2-el-motor-de-razonamiento-podado-de-tools-e-inferencia-hibrida)
3. [Sesion 3: Resiliencia Empresarial, Patron Outbox y Persistencia SQLite](#sesion-3-resiliencia-empresarial-patron-outbox-y-persistencia-sqlite)
4. [Sesion 4: RAG Hibrido, Grafos de Entidades y Privacidad PII Pre-LLM](#sesion-4-rag-hibrido-grafos-de-entidades-y-privacidad-pii-pre-llm)
5. [Sesion 5: Seguridad Operativa, Watchdogs de Infraestructura y Testing Nativo](#sesion-5-seguridad-operativa-watchdogs-de-infraestructura-y-testing-nativo)
6. [Sesion 6: Arquitectura Multi-Tenant SaaS y Autoservicio Seguro](#sesion-6-arquitectura-multi-tenant-saas-y-autoservicio-seguro)
7. [Sesion 7: Microservidores Modulares MCP y Guardas de Terceros](#sesion-7-microservidores-modulares-mcp-y-guardas-de-terceros)
8. [Sesion 8: Knowledge Graph Cognitivo en SQLite Multi-Tenant](#sesion-8-knowledge-graph-cognitivo-en-sqlite-multi-tenant)
9. [Sesion 9: Respaldo Cifrado Atomico y Politica de Retencion Unica](#sesion-9-respaldo-cifrado-atomico-y-politica-de-retencion-unica)
10. [Sesion 10: Inferencia Resiliente, Destierro de Latencia y Multimodalidad Nativa](#sesion-10-inferencia-resiliente-destierro-de-latencia-y-multimodalidad-nativa)
11. [Sesion 11: Operaciones Autonomas Externas (Calendar, Renfe y Agente GitHub)](#sesion-11-operaciones-autonomas-externas-calendar-renfe-y-agente-github)
12. [Sesion 12: Interaccion WhatsApp Avanzada, Botones Nativos y Enlace Semantico de Parentescos](#sesion-12-interaccion-whatsapp-avanzada-botones-nativos-y-enlace-semantico-de-parentescos)
13. [Bateria de Preguntas y Respuestas para Entrevistas Tecnicas](#bateria-de-preguntas-y-respuestas-para-entrevistas-tecnicas)

---

## Sesion 1: Filosofia, Arquitectura Hexagonal y Puertos de Entrada

### 1.1 Que es D.A.V.I.S. de verdad
D.A.V.I.S. (Digital Autonomous Voice & Intelligence System) no es un chatbot de preguntas y respuestas. Es un sistema operativo autonomo personal operado a traves de WhatsApp. Integra un bucle de agentes con capacidad de ejecucion real sobre un servidor Linux (VPS Oracle Cloud), con control de procesos, monitorizacion activa y automatizacion de tareas vitales.

### 1.2 Arquitectura Hexagonal (Puertos y Adaptadores)
- **Principio**: La logica de negocio (el agente y las reglas de decision) no sabe nada de WhatsApp, ni de bases de datos, ni de APIs de modelos especificas.
- **Puertos de Entrada (Inbound Ports)**:
  - `MessageChannelPort`: contrato para recibir y emitir mensajes. Implementado por `whatsappChannelAdapter.js` (Baileys) y endpoints REST (`api.js`).
- **Puertos de Salida (Outbound Ports)**:
  - `LLMProviderPort`: abstraccion sobre proveedores de inferencia (Ollama, Groq, OpenAI, DeepSeek).
  - `JobQueuePort`: abstraccion sobre colas asincronas (`sqliteOutboxQueueAdapter.js`, `bullmqQueueAdapter.js`).
  - `VectorStorePort` y `SparseIndexPort`: abstraccion sobre indices vectoriales y de texto.
- **Raiz de Composicion**: `src/composition/container.js`. Aqui se acoplan los adaptadores concretos a los puertos. En tests se inyectan adaptadores en memoria; en produccion, servicios reales.

### 1.3 Protocolo de WhatsApp sin coste de API
- **Tecnologia**: Libreria Baileys conectada por WebSocket directo al protocolo multi-dispositivo de WhatsApp.
- **Aislamiento**:
  - Validacion de identificador LID (Linked Identity Device).
  - Silenciado de paquetes no autorizados: si un numero no autorizado escribe, el paquete se descarta de forma silenciosa (*silent drop*), evitando fugas de telemetria o consumo de tokens.

---

## Sesion 2: El Motor de Razonamiento, Podado de Tools e Inferencia Hibrida

### 2.1 El problema del catalogo de 140 herramientas
- Las APIs cloud (OpenAI, Groq) imponen un limite maximo duro de 128 herramientas por llamada.
- Entregar mas de 15 herramientas a un modelo de lenguaje pequeno diluye su atencion (*attention dilution*), provocando alucinaciones en argumentos o llamadas a herramientas equivocadas.

### 2.2 Podado Dinamico en Dos Niveles
- **Nivel 1 (Clasificador Ligero Local / SLM)**:
  - Fichero: `src/services/specialistRouterService.js` e `inferenceRouter.js`.
  - Clasifica el texto entrante en un dominio tematico: `devops`, `finanzas`, `bienestar`, `citas`, `conversacion`.
  - Poda el catalogo de 140 a un subconjunto de 5 a 8 herramientas especializadas.
- **Nivel 2 (Bucle de Razonamiento del Agente)**:
  - Fichero: `src/core/jarvisAgent.js` (funcion `consultarJarvis`).
  - El LLM recibe solo el subconjunto acotado.
  - Soporta ejecucion en multiples rondas (multi-step tool execution) con limite de 5 iteraciones maximo.

### 2.3 Presupuesto Preventivo de Tokens
- Fichero: `src/core/selectiveContext.js` y `groqBudget.js`.
- Antes de emitir la llamada al LLM, se calcula el coste en tokens del historial y del sistema.
- Si el contexto se aproxima al umbral critico, se ejecuta una condensacion determinista del historial, garantizando no desbordar la ventana de contexto.

---

## Sesion 3: Resiliencia Empresarial, Patron Outbox y Persistencia SQLite

### 3.1 La falacia de la llamada directa
Si un bot ejecuta una tarea y envia el mensaje directamente por red:
- Si el servidor se apaga o crashea entre la ejecucion y el envio, el usuario no sabe si se hizo.
- Si el proceso reintenta a ciegas, puede duplicar acciones destructivas (ej. enviar el mismo mensaje dos veces o cobrar dos veces).

### 3.2 Patron Outbox Asincrono en SQLite
- Fichero: `src/composition/asyncPipeline.js` y `src/adapters/outbound/persistence/sqlite/sqliteOutboxStore.js`.
- **Fase 1 (Ingestion y ACK)**:
  - El mensaje entrante se inserta en la tabla `outbox_jobs` de SQLite con estado `pendiente`.
  - Se confirma recepcion en menos de 3 ms (`ackMs < 3ms`).
- **Fase 2 (Trabajador Desacoplado)**:
  - `agentWorker.js` extrae el trabajo y procesa la logica del agente.
  - Guarda checkpoints durables por cada ronda de herramientas ejecutada.
- **Fase 3 (Entrega de Respuestas)**:
  - `responseDeliverer.js` lee la cola de respuestas (`channel_responses`) y entrega a WhatsApp.
  - Si ocurre un timeout o desconexion SDK tras iniciar el envio, el estado pasa a `incierto` (*UNCERTAIN*). **Jamas se reintenta a ciegas**; se requiere reconciliacion.

### 3.3 Idempotencia Dura
- Fichero: `src/services/idempotencyService.js`.
- Genera un hash SHA-256 normalizado de la herramienta y sus argumentos.
- Si el modelo entra en un bucle y solicita exactamente la misma herramienta mutante con los mismos parametros en menos de 10 minutos, la llamada se bloquea y devuelve el resultado previo en cache.

---

## Sesion 4: RAG Hibrido, Grafos de Entidades y Privacidad PII Pre-LLM

### 4.1 Por que los vectores solos no funcionan en produccion
- La busqueda puramente vectorial por similitud de coseno es imprecisa con terminos exactos: codigos de error (`ERR_CONN_RESET`), CIFs fiscales, referencias alfanumericas o nombres propios desconocidos por el modelo de embeddings.

### 4.2 Arquitectura RAG Hibrido (RF-03)
- Fichero: `src/core/rag/hybridRetrievalService.js`.
- **Ruta Dispersa (Sparse)**: SQLite FTS5 con algoritmo BM25 para coincidencia lexico-exacta.
- **Ruta Densa (Dense)**: Embeddings generados con Ollama (`nomic-embed-text`) indexados en memoria o Qdrant.
- **Fusion**: `src/core/rag/reciprocalRankFusion.js`. Aplica el algoritmo matematico RRF con constante `k = 60`:
  `RRF_Score(d) = Σ [ 1 / (k + r_m(d)) ]`
- **Re-ranking**: Cross-encoder ligero via HTTP (`httpCrossEncoderRerankerAdapter.js`) para ordenar los 5 mejores fragmentos antes de inyectarlos en el prompt.

### 4.3 Privacidad PII Pre-LLM (RNF-04)
- Fichero: `src/adapters/outbound/llm/piiPreLlmAdapter.js` y `src/security/piiAnonymizerService.js`.
- **Problema**: Los proveedores cloud de LLM (OpenAI, Groq) no deben recibir numeros de telefono, DNIs ni emails reales.
- **Solucion Fail-Closed**:
  - Antes de salir hacia la API externa, un analizador sustituye datos sensibles por marcadores deterministas: `+34 612 345 678` -> `{{PHONE_1}}`.
  - La tabla de correspondencias se retiene localmente en memoria de la sesion.
  - Al recibir la respuesta del LLM, el adaptador reconstituye los valores reales antes de enviar al usuario.
  - Si el anonimizador falla o duda, se aborta la peticion (falla cerrado).

---

## Sesion 5: Seguridad Operativa, Watchdogs de Infraestructura y Testing Nativo

### 5.1 Interlock 2FA OTP para Comandos Destructivos
- Fichero: `src/system/bashConsoleService.js`.
- Permite administrar el servidor desde el chat de WhatsApp de David, pero con barrera criptografica.
- Si el comando contiene palabras clave peligrosas (`reboot`, `rm`, `kill`, `pm2`, `shutdown`, `truncate`):
  - No se ejecuta.
  - Se genera un OTP criptografico de 6 digitos (CSPRNG) con caducidad de 120 segundos y maximo 3 intentos.
  - Se solicita confirmacion en el chat. Solo al introducir el OTP valido se dispara el proceso.
  - Las salidas de consola se sanean para ocultar contraseñas y claves privadas (`.pem`, tokens).

### 5.2 Vigilancia Activa de Infraestructura (Watchdogs)
- **Auto-recuperacion Docker**: `dockerMonitorService.js`. Monitoriza contenedores; si uno cae, lo reinicia. Incluye proteccion contra aleteo (*flapping protection*): si reinicia 3 veces en 10 minutos, abre el circuito y alerta.
- **Autopurga de Disco**: `diskStorageService.js`. Al superar el 85% de capacidad, purga logs antiguos, ejecuta `docker system prune` y limpia caches temporales.
- **Fail2ban Watcher**: `fail2banMonitorService.js`. Detecta intentos de fuerza bruta por SSH y alerta de IPs baneadas.
- **Cola Deduplicada**: `alertQueueService.js`. Centraliza todas las alertas de infraestructura y las drena cada 5 segundos para evitar spamear el chat de WhatsApp.

### 5.3 Estrategia de Testing Nativo
- **Zero Dependencias**: No usa Jest ni Mocha. Corre sobre el runner nativo de Node.js (`node:test` y `node:assert/strict`).
- **Volumen**: Mas de 1190 pruebas unitarias y de integracion.
- **Aislamiento**: Pruebas con bases de datos SQLite en carpetas temporales (`fs.mkdtempSync`), sin cruce de estado entre suites paralelas.

---

## Sesion 6: Arquitectura Multi-Tenant SaaS y Autoservicio Seguro

### 6.1 Particionamiento Fisico y Logico Estricto
- **Filesystem**: `data/tenants/<tenantId>/`. Cada organizacion o cliente posee su subdirectorio aislado (`notes/`, `diario/`, `episodios/`, `indices/`, `trazas/`, `brain_memory.json`).
- **Guarda Anti-Path-Traversal**: `tenantFileSystem.js` intercepta llamadas I/O y verifica con `fs.realpathSync` que ninguna ruta resuelva fuera de la raiz asignada. Si un usuario intenta `../../`, la llamada aborta de inmediato.
- **Base Vectorial Particionada**: Colecciones Qdrant dedicadas (`davis_memorias_<tenantId>`). Las busquedas semanticas de un cliente jamas pueden acceder a vectores o metadatos de otro.
- **Bases Relacionales Multi-Tenant**: Tablas SQLite con columna `tenant_id` e indice compuesto (ej. `idx_citas_tenant`, `idx_gastos_tenant`).

### 6.2 Aprovisionamiento y Autoservicio Atomico
- Fichero: `src/services/tenantProvisioningService.js`.
- **Canales de Alta**:
  - WhatsApp: Intercepcion de comandos directos como `/registro <Nombre>`, `/alta <Nombre>`.
  - API REST: Endpoints seguros `POST /api/v1/tenants/register`.
- **Aprovisionamiento Atomico**: Crea la estructura de carpetas, inicializa el esquema en SQLite, registra la coleccion en Qdrant y asigna la cuota del plan (`demo`, `cliente`, `staff`).
- **Persistencia de Cuotas**: `tenantQuotaService.js` hidrata planes desde la base de datos tras reinicios de procesos.

### 6.3 Matriz RBAC Fail-Closed
- Fichero: `src/services/rbacService.js`.
- Clasificacion de herramientas segun impacto: `datos_tenant`, `sin_estado`, `host`, `credenciales`, `sistema`.
- Los tenants no propietarios solo tienen acceso a `datos_tenant` y `sin_estado`. Si una peticion intenta invocar herramientas de host (`execute_bash_command`, `inspeccionar_docker`) o de administracion, RBAC deniega la llamada de forma estricta.

---

## Sesion 7: Microservidores Modulares MCP y Guardas de Terceros

### 7.1 De Monolito a Model Context Protocol (MCP)
- Fichero: `src/adapters/outbound/mcp/mcpRegistry.js` y directorio `mcp-servers/`.
- Fragmentacion de capacidades del agente en procesos Node.js desacoplados comunicados via STDIO / JSON-RPC:
  - `mcp-servers/booking`: Motor de citas y reservas multi-tenant (`consultar_disponibilidad`, `reservar_cita`, `cancelar_cita`, `listar_citas`).
  - `mcp-servers/devops`: Metricas e infraestructura del host (`consultar_estado_servidor`, `inspeccionar_docker`, `verificar_almacenamiento`, `comprobar_certificados_ssl`).
  - `mcp-servers/finance`: Contabilidad y finanzas multi-tenant (`registrar_gasto`, `listar_gastos`, `resumen_gastos_mes`, `extraer_ticket_vision`, `exportar_resumen_trimestral`).
- **Resiliencia de Esquemas**: Soporte de tipos nullables (`type: ['string', 'null']`) para prevenir rechazos 400 por parte de proveedores cloud (Groq/OpenAI) cuando el modelo omite campos opcionales.

### 7.2 Guardas de Seguridad en Envios a Terceros
- Fichero: `src/core/jarvisAgent.js` (funcion `destinatarioVerificado`).
- **Problema de Alucinacion PII**: Un LLM puede generar un numero telefonico plausible inventado y enviar un WhatsApp real a un desconocido.
- **Mecanismo de Guarda**:
  - Antes de ejecutar `programar_mensaje_whatsapp`, el numero debe estar verificado: o consta en un mensaje previo del usuario en la sesion actual, o coincide con una ficha de contacto en `data/contactos.json`.
  - **Sincronizacion Automatica de Contactos**: `contactsService.js` sincroniza de forma perezosa los contactos del Segundo Cerebro (`brain_memory.json` con categoria `contacto`) hacia la agenda oficial, permitiendo envios rapidos y seguros.

---

## Sesion 8: Knowledge Graph Cognitivo en SQLite Multi-Tenant

### 8.1 Por que SQLite para Grafos de Conocimiento
- Evita la dependencia de infraestructuras pesadas como Neo4j, reduciendo el consumo de RAM en VPS de recursos ajustados a cero overhead adicional.
- Permite transacciones ACID nativas acopladas con el resto del modelo de datos relacional de D.A.V.I.S.

### 8.2 Modelo de Datos (Migracion 015)
- **Fichero**: `src/database/migrations/015_knowledge_graph_sqlite.sql`.
- **Tablas**:
  - `knowledge_graph_entidades`: almacena `id`, `tenant_id`, `nombre`, `tipo`, `propiedades_json`, `created_at`, `updated_at`.
  - `knowledge_graph_relaciones`: almacena `id`, `tenant_id`, `origen_id`, `destino_id`, `tipo_relacion`, `peso`, `metadata_json`, `created_at`.
- **Indices Compuestos**: `idx_kg_entidades_tenant_nombre` y `idx_kg_relaciones_tenant` para busquedas sub-milisegundo.
- **Aislamiento Multi-Tenant**: Toda consulta y mutacion de entidades y aristas filtra forzosamente por `tenant_id`, garantizando que ningun cliente descubra relaciones de otro.

### 8.3 Resolucion Cognitiva y Prevencion de Colisiones
- Fichero: `src/services/knowledgeGraphSqliteService.js`.
- Resuelve ambiguedades de memoria relacional (ej. distinguir la relacion de parentesco familiar `madre` frente a un contacto de terceros o agenda).
- Inyecta subgrafos contextuales en el prompt del LLM en tiempo de inferencia para enriquecer la toma de decisiones con relaciones de segundo orden (A conoce a B, B tiene cita con C).

---

## Sesion 9: Respaldo Cifrado Atomico y Politica de Retencion Unica

### 9.1 Problema de Respaldo en Sistemas Multi-Tenant Activos
- Copiar una base de datos SQLite en caliente durante escrituras de outbox corrompe el fichero `.db` (lecturas sucias de WAL).
- La acumulacion descontrolada de backups colapsa el almacenamiento local o en discos secundarios.

### 9.2 Arquitectura del Servicio de Respaldo
- **Fichero**: `src/services/backupScheduleService.js` y `backupService.js`.
- **Mecanismo Seguro de Snapshot**: Utiliza la API online de backup de SQLite (`VACUUM INTO` o conexion dedicada) para volcar un snapshot consistente sin bloquear a los lectores.
- **Cifrado Criptografico AES-256-GCM**: Empaqueta SQLite, directorios de tenants (`data/tenants/`) y configuracion en un archivo comprimido cifrado (`.davbak`).
- **Politica de Retencion Atomica Unica**:
  1. Genera el nuevo archivo de backup `backup_<TIMESTAMP>.davbak`.
  2. Verifica la integridad criptografica y el hash SHA-256 del nuevo archivo.
  3. Tras validar que el nuevo backup es integro en disco, localiza y elimina de forma segura el backup anterior.
  4. Garantiza que en la ruta configurada (ej. `D:\Documentos\DAVIS BACKUPS`) resida unicamente la copia valida mas reciente, minimizando el impacto en disco.

---

## Sesion 10: Inferencia Resiliente, Destierro de Latencia y Multimodalidad Nativa

### 10.1 Destierro de Modelos Problematicos en Tool-Calling
- **Problema**: Modelos como Qwen en proveedores cloud (Groq) introducen latencias elevadas (>30s) y timeouts en la serializacion de llamadas a herramientas complejas.
- **Solucion Fail-Fast**:
  - Implementacion de saneamiento en arranque (`desterrarQwen()`): sobreescritura automatica de configuracion para forzar `llama-3.3-70b-versatile`.
  - Fallback encadenado: Si Groq reporta 429 o saturacion de cuota, degrada de forma transparente a Ollama local (`llama3.2:3b` o `mistral`) o proveedor alternativo sin interrumpir la sesion de WhatsApp.

### 10.2 Audio Resiliente con Fallback en Cascada
- **Fichero**: `src/services/audioTranscriptionService.js`.
- Ingestion de notas de voz de WhatsApp (`audioMessage`, codecs Opus/OGG).
- Intento primario: Whisper local en Node/Python para cero fuga de datos y coste cero.
- Fallback automatico: Groq Whisper API (`whisper-large-v3-turbo`) con transcripcion en <1.5s si el worker local esta saturado o no disponible.

### 10.3 Vision Multimodal y Lectura de Documentos
- **Fichero**: `src/services/multimodalVisionService.js` y `documentReaderService.js`.
- Ingestion nativa de mensajes `DocumentMessage` de Baileys: extraccion y parsing de texto en PDFs, DOCX y TXT sin dependencias externas innecesarias.
- Procesamiento visual de imagenes, recibos y capturas de pantalla mediante adaptadores de vision hibridos (Gemini 2.5 Flash / Groq Vision).

---

## Sesion 11: Operaciones Autonomas Externas (Calendar, Renfe y Agente GitHub)

### 11.1 Integracion Bidireccional de Google Calendar
- **Fichero**: `src/services/googleCalendarService.js`.
- Sincronizacion en tiempo real de citas y eventos: lectura de disponibilidad, creacion de eventos con alarmas y cancelacion.
- Tratamiento de zona horaria local (`Europe/Madrid`) y reconciliacion con el motor de reservas multi-tenant (`booking`).

### 11.2 Precios y Horarios de Transporte Ferroviario (Renfe)
- **Fichero**: `src/services/renfeService.js`.
- Consulta en vivo de conexiones, trayectos, horarios y tarifas de trenes directos.
- Permite a D.A.V.I.S. cotizar viajes y recordar al usuario opciones optimas por coste y duracion desde el chat.

### 11.3 Agente Autonomo de GitHub
- **Fichero**: `src/services/githubAgentService.js`.
- Bucle autonomo de ciclo de vida de desarrollo de software:
  1. Inspeccion de issues asignados y lectura del arbol de directorios del repositorio.
  2. Ejecucion y analisis de resultados de pruebas unitarias locales.
  3. Aplicacion de parches de codigo y realizacion de commits estructurados.
  4. Apertura y seguimiento de Pull Requests de forma desasistida.

---

## Sesion 12: Interaccion WhatsApp Avanzada, Botones Nativos y Enlace Semantico de Parentescos

### 12.1 Flujo en Grupos de WhatsApp (`@g.us`) y Politica Fail-Closed
- **Fichero**: `src/services/groupInteractionService.js`.
- **Deteccion de menciones**: Expresion regular `@DAVIS`, prefijo `davis:` o metadato `contextInfo.mentionedJid` que apunte al bot.
- **Politica de silencio**: Si el mensaje dentro del grupo no va dirigido expresamente a D.A.V.I.S., se descarta silenciosamente (`ignorado: true`), registrando el mensaje en buffer historico para resumenes pero sin emitir trafico ni gastar tokens.
- **Resumen bajo demanda**: Al invocar `davis resume el grupo`, sintetiza los ultimos intercambios y responde citado dentro del hilo.

### 12.2 Botones Interactivos y Confirmacion Fuera del Modelo
- **Fichero**: `src/services/interactiveActionHandler.js`.
- **Componentes Nativos Baileys**: Sustituye respuestas de texto ambiguas ("si", "confirmo", "1") por botones interactivos estructurados (`sendButtons`).
- **Casos de Uso**:
  - Autorizacion 2FA de consola bash: pulsacion de boton que ejecuta directamente `confirmAndExecute(otp)`.
  - Confirmacion de borrado destructivo: boton con ID efimero de un solo uso.
  - Registro de gastos de tickets: botones "Confirmar gasto" / "Descartar".
  - Autoservicio de tenants: botones de upgrade rapido de plan.

### 12.3 Audio Duplex Continuo y Normalizacion de Voz
- **Fichero**: `src/services/textFormatService.js` (`limpiarTextoParaVoz`).
- **Directiva Duplex**: Al recibir una nota de voz (`esAudio = true`), se inyecta en el prompt una directiva estricta que exige al modelo una respuesta conversacional fluida sin markdown ni tablas.
- **Saneamiento para Edge-TTS**: Eliminacion de asteriscos, corchetes, vinetas, URLs y caracteres especiales antes de enviar el buffer a sintesis de voz en OGG Opus PTT.

### 12.4 Resolutor Semantico de Parentescos y Agenda
- **Fichero**: `src/services/contactRelationResolver.js`.
- **El problema de la ambiguedad**: Evitar que al decir "escribe a mi madre", si la agenda no tiene un contacto llamado "madre", el agente resuelva a un contacto arbitrario (caso real observado: escribir a Paula).
- **Cascada de Resolucion**:
  1. Normalizacion de posesivos y sinonimos de parentesco ("mi madre", "mama" -> "madre").
  2. Coincidencia por nombre exacto en contactos.
  3. Coincidencia por campo `relacion` en fichas SQLite de contactos.
  4. Enlace relacional via Knowledge Graph (`usuario -> madre -> Carmen`).
  5. Extraccion en memorias semanticas del Second Brain.
  6. Si no existe evidencia verificada de parentesco, el envio se bloquea por seguridad (*fail-closed*).

---

## 13. Evolucion Cognitiva v4.0 (Planificacion, Reflexion y Aprendizaje Adaptativo)

Especificacion completa en [`docs/ers-cognitivo-v4.md`](ers-cognitivo-v4.md). Siete pilares construidos sobre el nucleo hexagonal y SQLite WAL:

1. **Memoria Procedural (`proceduralMemoryService.js`)**: Registra directrices operativas y correcciones del usuario (tabla `memoria_procedural`, migracion 016), inyectadas selectivamente sin poder anular reglas de seguridad ni OTP.
2. **Enrutado por Complejidad (`complexityCascadeRouter.js`)**: Clasifica cada turno en Nivel 0 (determinista), Nivel 1 (rapido) o Nivel 2 (razonamiento profundo) para optimizar latencia y cuota.
3. **GraphRAG 2-Hop (`knowledgeGraphAutoExtractor.js`, `graphMemoryService.js`)**: Extraccion automatica de proyectos, estudios, examenes, empleo y suscripciones con traversal BFS acotado de 2 saltos.
4. **Planificacion Compuesta (`taskPlannerService.js`)**: Descomposicion Plan-and-Solve de peticiones multi-paso y seguimiento de sub-objetivos durante el bucle ReAct.
5. **Metacognicion y Reflexion (`cognitiveReflectionService.js`)**: Evaluacion post-ronda para replanificacion segura de lecturas idempotentes fallidas y critica acotada pre-envio (max 1 pasada, sin re-ejecutar mutaciones).
6. **Feedback de Progreso Asincrono (`asyncProgressFeedbackService.js`)**: Estimacion de duracion y acuse tactico unico si supera umbral de 4 segundos, respetando modo silencioso y voz.
7. **Proactividad Predictiva (`habitPatternPredictorService.js`)**: Aprendizaje de rutinas por dia y franja horaria (solo metadatos, tabla `rutinas_actividad`), integrado en `dailyBriefing.js`.

---

## Bateria de Preguntas y Respuestas para Entrevistas Tecnicas

### Pregunta 1: "¿Cual fue el reto arquitectonico mas complejo del proyecto?"
**Respuesta recomendada**:  
"El manejo de resiliencia y tolerancia a fallos en un canal no oficial como WhatsApp. Conectar un LLM con herramientas que mutan el sistema operativo exige garantizar idempotencia dura. Si el proceso cae tras ejecutar una accion pero antes de responder en red, un reintento ciego duplicaria el efecto. Lo resolvi implementando el patron Outbox en SQLite con transacciones ACID, checkpoints por ronda de ejecucion y transicion a estado incierto si la entrega de red no puede verificarse de forma positiva."

### Pregunta 2: "¿Por que elegiste Arquitectura Hexagonal en Node.js?"
**Respuesta recomendada**:  
"Para aislar por completo la logica de toma de decisiones del agente respecto al transporte y la infraestructura. Eso me permitio cambiar entre el WebSocket de Baileys y endpoints REST sin tocar el agente, intercambiar proveedores de inferencia (Ollama local, Groq, OpenAI) con una variable de entorno, y ejecutar mas de 1100 tests de integracion en menos de 40 segundos usando adaptadores falsos en memoria sin tocar red."

### Pregunta 3: "¿Como solucionaste el problema del catalogo excesivo de herramientas (Tool Bloat)?"
**Respuesta recomendada**:  
"Disene un sistema de podado semantico en dos niveles. Con 140 herramientas superaba el limite duro de 128 de las APIs cloud y degradaba la precision del modelo. Implemente un router especialista local que clasifica la intencion de la peticion del usuario y reduce el catalogo a 6 u 8 herramientas relevantes por llamada. Para la siguiente evolucion, he redactado una ERS basada en Model Context Protocol (MCP) para fragmentar el monolito en micro-servidores independientes con busqueda vectorial de herramientas (Tool RAG)."

### Pregunta 4: "¿Como abordas la privacidad cuando usas modelos LLM de terceros?"
**Respuesta recomendada**:  
"Implemente un adaptador envolvente con patron de fallo cerrado (RNF-04). Antes de emitir cualquier prompt hacia OpenAI o Groq, un servicio de anonimizacion local enmascara entidades PII (telefonos, correos, nombres) con marcadores temporales. La tabla de traduccion nunca sale del servidor local. Cuando el modelo devuelve el texto o la invocacion de la herramienta, se reconstituyen los valores reales. Si el enmascarador duda o encuentra ambiguedades, la llamada se bloquea."

### Pregunta 5: "¿Como garantizas el aislamiento multi-tenant en un agente con LLM y busqueda semantica?"
**Respuesta recomendada**:  
"Mediante un aislamiento estricto en tres capas (almacenamiento, vectores y permisos). En disco, cada tenant dispone de un subdirectorio aislado (`data/tenants/<id>/`) protegido por un guard anti-path-traversal con `realpath`. En la capa vectorial, particiono Qdrant en colecciones independientes (`davis_memorias_<id>`), impidiendo cualquier cruce semantico. Y en la capa del agente, un motor RBAC de diseno cerrado (*fail-closed*) filtra el catalogo de herramientas antes de llamar al LLM: los clientes jamas ven ni pueden invocar herramientas de host o comandos de sistema."

### Pregunta 6: "¿Que beneficios aporta la migracion a Model Context Protocol (MCP) y como resuelves la validacion de esquemas con Groq?"
**Respuesta recomendada**:  
"MCP desacopla las herramientas del bucle principal del agente en procesos autonomos via JSON-RPC, facilitando escalabilidad y aislamiento de dependencias. Al conectarlo con proveedores estrictos como Groq, me encontre con que el modelo emitia `null` en parametros opcionales, provocando errores 400 de validacion de esquema. Lo solucione implementando esquemas flexibles con tipos compuestos (`type: ['string', 'null']`), permitiendo que el validador acepte nulos sin degradar el tipado de la herramienta."

### Pregunta 7: "¿Por que implementar el Knowledge Graph en SQLite en lugar de una base de datos de grafos dedicada como Neo4j?"
**Respuesta recomendada**:  
"Por pragmatismo de infraestructura y coste operativo. Un cluster Neo4j o servicio de grafos externo consume al menos 500MB a 1GB de RAM y añade complejidad de red y mantenimiento en un VPS modesto. Implementando el grafo en SQLite con tablas relacionales (`knowledge_graph_entidades` y `knowledge_graph_relaciones`) e indices compuestos con `tenant_id`, conseguimos latencias de resolucion inferiores a 1 milisegundo, consumo de memoria virtual cero adicional y transaccionalidad ACID directa acoplada a la misma base de datos del sistema."

### Pregunta 8: "¿Como resuelves la degradacion de latencia y fallos en inferencia multimodal y de voz?"
**Respuesta recomendada**:  
"Mediante una estrategia de arquitectura en cascada con saneamiento fail-fast. Para voz, el sistema intenta transcripcion local en Whisper; si el worker local se satura o supera umbrales de latencia, conmuta de inmediato a Groq Whisper Cloud (transcripcion en menos de 1.5s). Para el LLM, eliminamos modelos que introducen penalizaciones criticas en invocacion de herramientas estructuradas (como Qwen) fijando `llama-3.3-70b-versatile` con fallback automatico a modelos locales Ollama si el proveedor cloud agota cuota o rate-limit."

### Pregunta 9: "¿Cual es la estrategia de respaldo y recuperacion ante desastres en D.A.V.I.S.?"
**Respuesta recomendada**:  
"Disene un servicio programado de respaldo atomico con cifrado AES-256-GCM. El servicio genera un snapshot consistente de SQLite mediante su mecanismo de backup en caliente para evitar bloqueos del Outbox WAL, empaqueta los directorios de los tenants y valida la integridad y el hash criptografico del nuevo archivo (`.davbak`). Solo tras confirmar que la nueva copia de seguridad es valida y autosuficiente en disco secundario, purga la version anterior, manteniendo estrictamente el respaldo mas reciente sin saturar el almacenamiento."

### Pregunta 10: "¿Como resolviste la ambiguedad en referencias indirectas de contactos, como 'escribe a mi madre'?"
**Respuesta recomendada**:  
"Es un fallo critico comun en agentes conversacionales: al pedir escribir a 'mi madre', si la agenda no tiene un contacto llamado literalmente 'madre', el modelo suele asociar erroneamente a otro contacto reciente o alucinar el destinatario. Lo resolvi implementando un resolutor semantico en cascada (`contactRelationResolver`): primero normaliza el parentesco eliminando posesivos ('mi madre' -> 'madre'); segundo, busca en el campo 'relacion' de la agenda; tercero, consulta el Knowledge Graph en SQLite buscando tripletas relacionales (`usuario -> madre -> Carmen`); y cuarto, inspecciona las memorias persistidas del Second Brain. Si tras esta cascada no existe evidencia verificada de parentesco, el sistema aplica fallo cerrado y pide aclaracion, impidiendo terminantemente enviar mensajes a destinatarios equivocados."

