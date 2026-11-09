# RF-02 Inferencia Especulativa: contratos de integracion

Bloque RF-02 del ERS (`docs/ers-arquitectura-proximo-nivel.md`), preparado como
modulos aislados. Ningun archivo compartido se ha tocado; este documento es el
contrato para que el propietario de integracion ERS lo conecte.

## Archivos nuevos (ninguno compartido modificado)

- `src/adapters/outbound/llm/ollamaSlmAdapter.js` - LLMProviderPort sobre el
  SLM local de Ollama. Devuelve null sin modelo configurado (fail-safe).
  Carga perezosa del paquete `ollama` (ya es dependencia; package.json intacto).
  Serializa inferencias (una en vuelo); acepta serializador inyectado.
- `src/services/localSlmInferenceService.js` - Nivel 1: clasificacion de
  intenciones, extraccion de argumentos JSON validada contra esquema y
  respuestas conversacionales. Umbral 0.82 (ERS). Nunca finge exito: todo
  fallo se declara con motivo.
- `src/core/inferenceRouter.js` - Decision de via local/nube con escalada,
  politica de tenant fail-closed y registro de decisiones por inyeccion.
  La via nube es siempre el chatCompletion inyectado (proveedor actual
  Groq gpt-oss-120b/20b); el router NO elige modelo ni proveedor cloud.
- `tests/sector3/rf02_inferencia_especulativa.test.js` - 24 pruebas
  aisladas (falsos inyectados, sin red, sin Ollama real). Al vivir en
  sector3, `tests/run_all.js` las descubre sin editar el runner.

## Cableado pendiente (integracion, dueño unico ERS)

1. `container.js`: construir adaptador SLM + servicio + router e inyectar
   `registrarDecision` hacia telemetria. Ejemplo de fixture:
   ```js
   const slmAdapter = crearOllamaSlmAdapter({ serializador: colaInferenciaCompartida });
   const slm = slmAdapter ? crearLocalSlmInferenceService({ provider: slmAdapter }) : null;
   const router = crearEnrutadorInferencia({
     slm,
     chatCompletionNube: (p) => llmProvider.chatCompletion(p),
     registrarDecision: registrarDecisionSlm // puente hacia telemetry.js
   });
   ```
2. `intentRouterService.js`: sustituir la llamada directa del clasificador
   por `router.clasificarIntencion`. ATENCION: hoy el umbral de inyeccion
   de herramientas es 0.6 (UMBRAL_CONFIANZA); el 0.82 del SLM es solo la
   puerta de ejecucion local. La integracion debe conservar el 0.6 sobre
   la clasificacion final venga de la via que venga, y la cache por
   mensaje normalizado existente.
3. `telemetry.js`: registrar la metrica del ERS `tokens_saved_by_local_slm`.
   Propuesta: Counter prom-client `davis_tokens_saved_by_local_slm_total`
   alimentado desde `registrarDecision` cuando via='local_slm'. Los labels
   'via' y 'motivo' ya estan en ATRIBUTOS_PERMITIDOS. El ahorro es
   ESTIMACION por bytes (como groqBudget.estimarTokensPeticion), no coste
   medido: declararlo asi en el panel.

## Variables de entorno

- `DAVIS_SLM_MODEL`: candidato `qwen2.5:3b` (ya descargado en el VPS, 1.9 GB,
  sin descarga adicional). Sin esta variable el bloque queda deshabilitado y
  todo sigue yendo a la nube, como hoy.
- `DAVIS_SLM_HOST` (def: http://127.0.0.1:11434, solo localhost).
- `DAVIS_SLM_TIMEOUT_MS` (def: 2000; red de seguridad antes de escalar).
- `DAVIS_SLM_KEEP_ALIVE` (def: '5m'; -1 residente o 0 bajo demanda: decidir
  tras medir RAM en carga real).

## Recursos medidos del VPS (2026-11-09, lectura RO)

4 vCPU CPU-only, 23.4 GiB RAM sin swap, 116 GB libres. Ollama en localhost
con qwen2.5:3b (1.9 GB), qwen2.5:7b (4.7 GB), qwen2.5vl:7b (6 GB, tickets) y
jarvis:latest (1.9 GB, base sin verificar). Ningun modelo cargado y
concurrencia de Ollama sin configurar. La admision CPU esta serializada en
el adaptador; para admision global con el pipeline de tickets, inyectar un
serializador compartido. La cola de presupuesto TPM de Groq no sirve para
CPU local.

## Lo que NO esta validado (no declarar como cumplido)

- Calidad y confianza del SLM: la confianza es autodeclarada por el modelo y
  el umbral 0.82 es objetivo del ERS, no calibracion medida. Pendiente:
  bateria dorada contra el enrutador actual con el modelo real.
- SLA de latencia (< 80 ms local, P95 <= 250 ms, 60% de consultas en local):
  sin medir. En CPU-only compartida con el pipeline de vision no prometer
  cifras hasta medirlas.
- Ahorro de coste/tokens (RNF-03, 75%): la metrica es estimacion de tokens
  de entrada evitados, no una medicion de coste por MAU.
- keep_alive definitivo y coexistencia RAM con qwen2.5vl:7b de tickets.

## Lo que este bloque NO hizo (por alcance y autoridad)

- Sin cambios en container.js, package.json, llmService, intentRouterService
  ni telemetry.js (hooks compartidos: los aplica el integrador).
- Sin push, sin mutaciones en el VPS, sin generaciones reales, sin descarga
  de modelos, sin cambio de proveedor cloud (se mantiene Groq gratuito
  actual; las alternativas del ERS quedan fuera por decision vigente).
- Pipeline de tickets (qwen2.5vl:7b) intacto.
