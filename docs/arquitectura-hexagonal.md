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
sintetico (`tests/sector3/hexagonal_ports.test.js`) y un canal CLI real y
funcional (`chat.js`, canal 'cli') entrando por el mismo puerto que
WhatsApp. Una integracion Telegram completa (polling/webhook, formato de
respuestas, reconexiones) es trabajo de transporte adicional en su propio
adaptador; el dominio ya esta preparado, el transporte no esta incluido.

## Pureza del core (regresion cubierta)

`tests/sector3/core_purity.test.js` falla si `src/core` vuelve a importar
Baileys/whatsappBot o si los puertos importan infraestructura. El envio
interactivo (botones, listas, encuestas) acepta el puerto de canal;
la ruta de persistencia de memoria es inyectable en las 4 operaciones
(guardar/buscar/listar/olvidar), base de la futura migracion a SQLite.

Trabajo restante conocido: la orquestacion de especialistas de
`whatsappBot.js` (voz, tickets, historial, watchdogs) es logica de capa de
canal y sigue importando servicios directamente; mover cada especialista
detras de su propio puerto es una evolucion incremental, no parte de este
corte.

## Precedencia de inyeccion

Una opcion explicita en la llamada (`opciones.chatCompletion`,
`opciones.memoryRepository`) siempre gana a los puertos del contenedor, lo que
mantiene intactos los tests historicos y los overrides del bot.
