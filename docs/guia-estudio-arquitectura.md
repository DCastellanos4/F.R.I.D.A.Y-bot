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
6. [Bateria de Preguntas y Respuestas para Entrevistas Tecnicas](#bateria-de-preguntas-y-respuestas-para-entrevistas-tecnicas)

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
  $$RRF\_Score(d) = \sum_{m \in M} \frac{1}{k + r_m(d)}$$
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
