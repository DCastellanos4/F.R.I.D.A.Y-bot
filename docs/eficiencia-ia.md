# Contexto selectivo y presupuesto preventivo

D.A.V.I.S. mantiene Groq y los modelos actuales. No usa MCP ni un proveedor nuevo.

- Núcleo breve de personalidad y reglas críticas, siempre presente. Recuerdos, episodios y relaciones son datos, no permisos ni instrucciones nuevas.
- Solo se incluyen instrucciones de los dominios cuyas herramientas están cargadas. Las preguntas sobre capacidades/configuración conservan sus listas específicas: heuristica para las consultas comunes y recuperacion explicita con descubrir_herramientas.contexto para parafrasis no reconocidas, sin reenviar inventarios siempre. No se truncan historial, argumentos, confirmaciones ni resultados para ahorrar cuota.
- El selector existente propone herramientas; si hay más de 12 se empieza con 12. El modelo puede usar `descubrir_herramientas` para cargar hasta 8 esquemas más mediante búsqueda local, sin embeddings ni otra llamada auxiliar. Dos rondas adicionales como máximo para descubrimiento puro. La búsqueda puede fallar: no concede permisos ni sustituye las guardas del ejecutor.
- Los especialistas dan criterio, pero no vuelven a añadir su catálogo entero. En tenants no se ofrece descubrimiento ni catálogo del propietario. Las compuertas existentes permanecen cerradas.
- El prefijo fijo precede al contexto variable para facilitar la caché automática de Groq. Un hit no está garantizado ni se presupone en el ahorro.

## Cola de Groq

Las llamadas de texto centralizadas en `llmService` pasan por la cola, incluidos clasificadores, servicios auxiliares, reintentos y respaldo. La ruta general de imagenes de `visionService` usa un transporte separado y no esta cubierta por esta cola; la revision de produccion no encontro llamantes activos. Los tickets activos usan Ollama local y no consumen Groq. Si se activa vision cloud, requiere un presupuesto nativo de vision: bytes/3 sobre base64 NO estima sus tokens y puede bloquear fotos legitimas. No se activa esa ruta con este cambio. La cola es por cuenta/endpoint y proceso, conservadora entre modelos. Serializa llamadas, estima entrada por bytes UTF-8/3 y reserva salida explícita (1024 por defecto). Es una estimación, no un tokenizer ni un límite duro de consumo. El presupuesto inicial es 8000 TPM; si las cabeceras indican un límite inferior se respeta.

Tras cada respuesta se leen `x-ratelimit-limit-tokens`, `remaining-tokens`, `reset-tokens` y, en errores, `retry-after`. Se conserva una ventana local de 60 segundos. Usage válido ajusta la reserva; ante errores o usage ausente se conserva la reserva completa. No se descuenta caché supuesta. El circuito por modelo sigue gestionando bloqueos largos del proveedor.

La espera preventiva admite hasta 70 segundos desde que se encola la llamada. Una petición estimada que no cabe o una espera excesiva se detiene sin enviarla y sin fingir que se ha agotado el proveedor. Si ya se ejecutaron acciones, se informa del resultado parcial sin pedir repetirlas.

Limitaciones: otros procesos/clientes con la misma cuenta no comparten esta cola; la API de produccion esta cerrada por falta de API_TOKEN (503 verificado por revision de runtime), por lo que hoy la cola cubre el proceso de WhatsApp activo. Abrir la API en el futuro requiere un coordinador de presupuesto compartido antes de prometer control entre procesos; tampoco se conocen de antemano todos los límites del proveedor. Las cabeceras pueden cambiar y la estimación puede quedarse corta. Los 429 aún son posibles. La serialización y una búsqueda adicional pueden aumentar la latencia; no se promete ahorro ni calidad orgánicos sin observación posterior.

## Medición y validación

La traza agrega llamadas, entrada estimada, entrada medida cuando el proveedor la entrega y espera de presupuesto, sin añadir cuerpos privados a métricas. La medición por tenant y su bloqueo de medición pendiente no se han relajado.

Comparación aislada contra `1a43c01` con el mismo mensaje, sin historial ni datos reales y LLM simulado: bytes de entrada serializada bajaron entre 56 % y 85 % en seis fixtures (charla, clima, gastos, servidor, recuerdos y fallo del clasificador). No son tokens facturados ni un benchmark de calidad. El ahorro de una consulta real depende del historial, recuperación, esquemas y rondas necesarias.

Las pruebas cubren concurrencia, cabeceras reales del SDK simuladas, reserva de salida, fallo ambiguo, rechazo previo al envío, carga progresiva en ReAct y conservación de historial/resultados. Flujos completos sinteticos, incluyendo una herramienta ejecutada exactamente una vez: clima reduce 76,5 % de bytes con las mismas 2 llamadas; fallo del clasificador y herramienta oculta reduce 71,7 % de bytes aun necesitando 4 llamadas frente a 3. Estas pruebas demuestran conservacion de los datos guionizados, no calidad semantica del modelo real.

La suite existente mantiene los controles de destinatarios, OTP, RBAC, aislamiento y resultados parciales del failover.

## Correccion tras muestra real

Una muestra real selecciono clima correctamente, pero la parafrasis "hazme un recorrido por lo que llevas dentro" invento un buscador web general y un procesador autonomo JSON/CSV/XML sin recuperar el inventario. La instruccion de descubrir herramientas NO basto. Se añade siempre un resumen factual breve de funciones implementadas, con limite explicito y sin esquemas, cuentas ni estado de conexion. El inventario detallado y la configuracion siguen bajo demanda. Este coste fijo pequeno es deliberado: el ahorro no justifica perder fundamento factual.

Una guardia estrecha sustituye el patron de autodescripcion con esos modulos inventados por el resumen factual. No es una certificacion general de respuestas: la defensa general es la evidencia minima siempre disponible, y deben observarse nuevas respuestas reales. Los tenants conservan su propio prompt sin inventario del propietario. Las pruebas reproducen el texto erroneo observado incluso si el LLM ignora la evidencia y no llama a descubrimiento.

Una segunda muestra real elimino los dos modulos inventados, pero elaboro afirmaciones falsas sobre acceso autenticado, EMT y proactividad. Las consultas puras reconocidas de autodescripcion ahora se presentan mediante un resumen factual determinista, no una elaboracion libre del modelo: distingue funciones implementadas, configuracion y acceso efectivo, Renfe frente a EMT, confirmacion de comandos segun riesgo, y activacion expresa frente a ejecuciones ya programadas. No afirma estado temporal de cuentas. No sustituye resultados de herramientas ni consultas mixtas o de conexion real. La deteccion es acotada y puede dejar otras parafrasis sin cubrir; no añade clasificador ni llamada LLM. La ruta actual conserva las llamadas existentes y sustituye solo la presentacion final de inventario cuando no se ejecutaron otras herramientas.
