# Arquitectura hexagonal (puertos y adaptadores)

El proyecto separa el dominio del resto del mundo con puertos (interfaces) y
adaptadores (implementaciones intercambiables).

```
                 canales                          infraestructura
            +------------------+             +---------------------------+
 WhatsApp --| whatsappInbound  |             | llmServiceProviderAdapter |-- Ollama / nube
 Telegram --| (1 archivo cada  |--Inbound--  | jsonMemoryRepository      |-- JSON plano
 Web ------>|  adaptador)      |  Message    | whatsappChannelAdapter    |-- Baileys
            +------------------+             +---------------------------+
                        |                              ^
                        v                              |
              +---------------------+   puertos de salida (interfaces):
              |  CORE (dominio)     |   LLMProviderPort, MemoryRepositoryPort,
              |  jarvisAgent,       |   MessageChannelPort
              |  memoria, router,   |
              |  reglas de negocio  |
              +---------------------+
```

## Puerto de entrada

`src/ports/inbound/InboundMessage.js`: contrato minimo
`{ userId, text, channel }`, validado e inmutable. El core solo conoce esta
forma; nunca Baileys, Telegram ni HTTP.

## Puertos de salida

- `src/ports/outbound/LLMProviderPort.js`: `chatCompletion(peticion)`. El core
  no importa Ollama ni Groq; el adaptador por defecto envuelve el llmService
  historico.
- `src/ports/outbound/MemoryRepositoryPort.js`: `guardar / buscar / listar /
  olvidar`. El adaptador actual es JSON plano; la migracion a SQLite/Postgres
  (mejora 2) se enchufa aqui sin tocar el dominio.
- `src/ports/outbound/MessageChannelPort.js`: `enviarTexto(destinatario,
  texto, opciones)`. La normalizacion de formato propia de cada canal vive en
  su adaptador, no en el core.

## Raiz de composicion

`src/composition/container.js` decide que adaptadores concretos se usan en
produccion y expone `procesarMensajeEntrante(inbound, { historial, opciones })`,
el punto de entrada unico. `whatsappBot.js` ya no importa el agente: traduce
cada mensaje con su adaptador de entrada y llama al procesador.

## Conectar un canal nuevo

El coste de dominio de un canal nuevo es 1 archivo adaptador:

1. Crear `src/adapters/inbound/<canal>/<canal>InboundAdapter.js` que traduzca
   el formato nativo a `crearInboundMessage({ userId, text, channel })`.
2. Llamar a `procesarMensajeEntrante` del contenedor.
3. (Opcional) un adaptador `MessageChannelPort` para las respuestas.

El cerebro no se toca. Lo probado HOY: el contrato del puerto con un canal
sintetico (`tests/sector3/hexagonal_ports.test.js`) y DOS canales reales y
funcionales entrando por el mismo puerto que WhatsApp: `chat.js` (CLI,
canal 'cli') y `api.js` (HTTP, canal 'api'). Una integracion Telegram
completa (polling/webhook, formato de respuestas, reconexiones) es trabajo
de transporte adicional en su propio adaptador; el dominio ya esta
preparado, el transporte no esta incluido.

## Pureza del core (regresion cubierta)

`tests/sector3/core_purity.test.js` falla si `src/core` vuelve a importar
Baileys/whatsappBot o si los puertos importan infraestructura. El envio
interactivo (botones, listas, encuestas) acepta el puerto de canal;
la ruta de persistencia de memoria es inyectable en las 4 operaciones
(guardar/buscar/listar/olvidar), base de la futura migracion a SQLite.

`src/core` no contiene acceso a fs: las metricas del clasificador van
detras del puerto `metricasClasificador` (adaptador JSONL) y la
persistencia de memoria detras de `MemoryRepositoryPort`.

## Clasificacion de especialistas (negocio vs transporte vs infraestructura)

- **Negocio (dominio invocado por el core):** memoria (exacta, semantica,
  episodica, grafo), finanzas, recordatorios, mensajes programados,
  estudio, flashcards, candidaturas, contactos, notas, diario, viajes,
  quedadas, compra, radar empleo, fechas, snoozes, avisos de llegada,
  transporte, clima, noticias, wiki, digest, busqueda cerebro, documentos,
  capturas, entrevistas, redaccion, traductor, historial-busqueda,
  estadisticas de grupo, horario silencio, urgencia, idempotencia,
  acciones destructivas, skills, sanitizador de errores, guardarrailes
  pre-envio, trazas. Hoy el core los invoca directamente como servicios
  internos; cada uno puede promoverse a puerto outbound propio de forma
  incremental sin mover el dominio.
- **Transporte (capa de canal, correcto fuera del core):** whatsappBot
  (orquestacion), textFormatService (markdown de WhatsApp),
  mediaDownloaderService, ttsService (nota de voz por socket). Estos
  conocen Baileys por diseno; el core nunca los importa.
- **Infraestructura (adaptadores tecnicos):** llmService (ya detras de
  LLMProviderPort), persistencia JSON de memoria y metricas (ya detras de
  puertos), ticketVisionAdapter, browser/pdf/vision, bash/backup/tunnel/
  disco, monitores (docker, red, sniper, alertas), ops.

Envios programados verificados desacoplados: `scheduledMessageService`
recibe el envio como callback inyectado por la capa de canal
(`iniciarMonitorMensajesProgramados(callbackEnvio)`; `registrarIdWhatsApp`
solo persiste el id de entrega para los acuses) y `dailyBriefing` acepta
el puerto de canal (`enviarTexto`) o un callback; ninguno retiene el
socket. Persistencia fusionada por id y acuses de entrega intactos.

Uso restante conocido y aceptado: `conversationHistoryService` se usa
desde la capa de canal (el historial llega al core como parametro).
Los helpers de transporte (`ttsService`, `mediaDownloaderService`) se
llaman desde la capa de canal con el socket como argumento puntual, sin
retencion.

## Aislamiento del estado de pruebas

Bajo `NODE_ENV=test` la raiz de composicion da a la cache de idempotencia
una ruta tmp por proceso: el estado compartido (`data/`) no se toca y dos
ejecuciones seguidas de la suite no colisionan (fallo observado el
8 nov 2026, 13 pruebas; corregido sin limpiar datos compartidos). Las
pruebas que conducen al agente directamente usan
`tests/helpers/jarvisAislado.js` con la misma regla.

## Precedencia de inyeccion

Una opcion explicita en la llamada (`opciones.chatCompletion`,
`opciones.memoryRepository`) siempre gana a los puertos del contenedor, lo que
mantiene intactos los tests historicos y los overrides del bot.
