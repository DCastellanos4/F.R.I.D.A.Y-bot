# Contexto selectivo y presupuesto preventivo

D.A.V.I.S. mantiene Groq y los modelos actuales. No usa MCP ni un proveedor nuevo.

- Núcleo breve de personalidad y reglas críticas, siempre presente. Recuerdos, episodios y relaciones son datos, no permisos ni instrucciones nuevas.
- Solo se incluyen instrucciones de los dominios cuyas herramientas están cargadas. Las preguntas sobre capacidades/configuración conservan sus listas específicas. No se truncan historial, argumentos, confirmaciones ni resultados para ahorrar cuota.
- El selector existente propone herramientas; si hay más de 12 se empieza con 12. El modelo puede usar `descubrir_herramientas` para cargar hasta 8 esquemas más mediante búsqueda local, sin embeddings ni otra llamada auxiliar. Dos rondas adicionales como máximo para descubrimiento puro. La búsqueda puede fallar: no concede permisos ni sustituye las guardas del ejecutor.
- Los especialistas dan criterio, pero no vuelven a añadir su catálogo entero. En tenants no se ofrece descubrimiento ni catálogo del propietario. Las compuertas existentes permanecen cerradas.
- El prefijo fijo precede al contexto variable para facilitar la caché automática de Groq. Un hit no está garantizado ni se presupone en el ahorro.

## Cola de Groq

Todas las llamadas cloud pasan por `llmService`, incluidos clasificadores, servicios auxiliares, reintentos y respaldo. La cola es por cuenta/endpoint y proceso, conservadora entre modelos. Serializa llamadas, estima entrada por bytes UTF-8/3 y reserva salida explícita (1024 por defecto). Es una estimación, no un tokenizer ni un límite duro de consumo. El presupuesto inicial es 8000 TPM; si las cabeceras indican un límite inferior se respeta.

Tras cada respuesta se leen `x-ratelimit-limit-tokens`, `remaining-tokens`, `reset-tokens` y, en errores, `retry-after`. Se conserva una ventana local de 60 segundos. Usage válido ajusta la reserva; ante errores o usage ausente se conserva la reserva completa. No se descuenta caché supuesta. El circuito por modelo sigue gestionando bloqueos largos del proveedor.

La espera preventiva admite hasta 70 segundos desde que se encola la llamada. Una petición estimada que no cabe o una espera excesiva se detiene sin enviarla y sin fingir que se ha agotado el proveedor. Si ya se ejecutaron acciones, se informa del resultado parcial sin pedir repetirlas.

Limitaciones: otros procesos/clientes con la misma cuenta no comparten esta cola; tampoco se conocen de antemano todos los límites del proveedor. Las cabeceras pueden cambiar y la estimación puede quedarse corta. Los 429 aún son posibles. La serialización y una búsqueda adicional pueden aumentar la latencia; no se promete ahorro ni calidad orgánicos sin observación posterior.

## Medición y validación

La traza agrega llamadas, entrada estimada, entrada medida cuando el proveedor la entrega y espera de presupuesto, sin añadir cuerpos privados a métricas. La medición por tenant y su bloqueo de medición pendiente no se han relajado.

Comparación aislada contra `1a43c01` con el mismo mensaje, sin historial ni datos reales y LLM simulado: bytes de entrada serializada bajaron entre 56 % y 85 % en seis fixtures (charla, clima, gastos, servidor, recuerdos y fallo del clasificador). No son tokens facturados ni un benchmark de calidad. El ahorro de una consulta real depende del historial, recuperación, esquemas y rondas necesarias.

Las pruebas cubren concurrencia, cabeceras reales del SDK simuladas, reserva de salida, fallo ambiguo, rechazo previo al envío, carga progresiva en ReAct y conservación de historial/resultados. La suite existente mantiene los controles de destinatarios, OTP, RBAC, aislamiento y resultados parciales del failover.
