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

## Conectar un canal nuevo cuesta 1 archivo

1. Crear `src/adapters/inbound/<canal>/<canal>InboundAdapter.js` que traduzca
   el formato nativo a `crearInboundMessage({ userId, text, channel })`.
2. Llamar a `procesarMensajeEntrante` del contenedor.
3. (Opcional) un adaptador `MessageChannelPort` para las respuestas.

El cerebro no se toca. Cubierto por `tests/sector3/hexagonal_ports.test.js`,
que prueba un canal "telegram" funcionando sin una sola linea de WhatsApp.

## Precedencia de inyeccion

Una opcion explicita en la llamada (`opciones.chatCompletion`,
`opciones.memoryRepository`) siempre gana a los puertos del contenedor, lo que
mantiene intactos los tests historicos y los overrides del bot.
