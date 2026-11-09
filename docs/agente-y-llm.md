# Agente y LLM

El cerebro es `src/core/jarvisAgent.js`: un bucle de rondas donde el modelo
responde o invoca herramientas, y los resultados vuelven al contexto hasta
cerrar la respuesta. Todo el acceso a modelo pasa por `src/core/llmService.js`.

## Proveedores de modelo

`LLM_PROVIDER` (o autodeteccion por prefijo de clave) elige el proveedor:

| Proveedor | Activacion | Modelo por defecto |
| --- | --- | --- |
| `groq` | `GROQ_API_KEY` o `OPENAI_API_KEY` con prefijo `gsk_` | `openai/gpt-oss-120b` |
| `openai` | `OPENAI_API_KEY` | `gpt-4o-mini` |
| `ollama` | sin claves, o `LLM_PROVIDER=ollama` | `OLLAMA_MODEL` (host `OLLAMA_HOST`) |
| openrouter / deepseek | clave o base URL correspondiente | segun configuracion |

El despliegue actual usa Groq en plan gratuito. El SDK se usa con
reintentos internos desactivados para que el router de failover controle
los intentos y la contabilidad de uso no se multiplique.

### Failover entre modelos Groq

Cuando el modelo principal devuelve un error recuperable (429, 5xx, errores
de cuota), el router reintenta con los modelos de respaldo de
`GROQ_MODELOS_RESPALDO` (por defecto `openai/gpt-oss-20b`). Los tokens que
devuelve el proveedor (`usage`) se normalizan igual en nube y en Ollama
para la medicion de uso.

### Presupuesto preventivo Groq

`src/core/groqBudget.js` reserva presupuesto por proceso antes de cada
llamada (8000 TPM por defecto) con una estimacion conservadora por bytes;
las cabeceras reales de Groq mandan sobre la estimacion. Es prevencion, no
una garantia de cuota del proveedor. Detalle en [eficiencia-ia.md](eficiencia-ia.md).

## Contexto selectivo

`src/core/selectiveContext.js` compone el system prompt por piezas:

- `NUCLEO_PERSONALIDAD`: identidad y tono de D.A.V.I.S., siempre presente.
- `INSTRUCCIONES_DOMINIO`: reglas por area, solo cuando el mensaje las toca.
- `CAPACIDADES_MINIMAS`: recordatorio corto de que si tiene herramientas.
- `RESUMEN_CAPACIDADES_FACTUAL`: descripcion determinista de las
  capacidades reales, generada desde un inventario verificado, para que el
  modelo describa lo que existe y no improvise modulos inexistentes.

## Catalogo de herramientas y enrutado

`src/core/tools.js` define unas 140 herramientas con su esquema y su
ejecutor. El proveedor admite un maximo de 128 por llamada, asi que el
catalogo se acota antes de cada peticion:

1. `intentRouterService` clasifica el mensaje por areas (reglas directas,
   clasificador por modelo y desambiguacion) usando
   `MAPA_INTENCION_HERRAMIENTAS`.
2. `specialistRouterService` asigna un especialista (coder, ops, personal,
   general) con prompt contextual y subconjunto de herramientas, mas
   ejemplos few-shot dinamicos para afinar los parametros.
3. `toolDiscovery` aplica el descubrimiento progresivo para no ofrecer todo
   el catalogo en cada ronda.

Las mutaciones con efectos pasan por `idempotencyService` (ventana de 10
minutos) para no ejecutar dos veces la misma operacion.

## Historial y memoria de conversacion

`conversationHistoryService` mantiene por chat una ventana de 12 mensajes
que es lo que ve el modelo, con un maximo de 40 persistidos; al crecer, los
tramos antiguos se condensan en un resumen con el propio modelo. Lo que
sale de la ventana se archiva en la memoria episodica
(`episodicMemoryService`, JSONL por chat, con busqueda posterior). Antes de
tocar el disco, OTP y credenciales se redactan (`redaccionService`).

## Guardarrailes de pre-envio

`preSendGuardrailService` intercepta cada respuesta antes de WhatsApp:

1. Veto de emojis.
2. Validacion y autocorreccion sintactica de bloques de codigo JS/JSON.
3. Deteccion de alucinaciones: contrasta afirmaciones de acciones con las
   llamadas reales registradas en la traza, y valida numeros/JIDs contra el
   contexto conocido.
4. Reintento transparente de fallos transitorios en herramientas
   idempotentes.

## Trazas y errores

`traceService` guarda por chat el recorrido de cada mensaje (via de
enrutado, areas, herramientas invocadas y si salieron bien, rondas,
duracion), sin argumentos ni contenido sensible. La herramienta
`explicar_recorrido` lo usa para explicar en llano como llego el bot a una
respuesta. `errorSanitizerService` convierte errores internos del proveedor
(cuotas, organizacion, claves) en mensajes seguros: el detalle queda en
logs y a WhatsApp solo sale lo honesto y reutilizable, como el tiempo de
reintento real.
