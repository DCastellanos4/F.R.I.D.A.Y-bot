# ERS - Plan de infraestructura, rollback y validacion escalonada

Documento de PREPARACION. Nada de lo aqui descrito esta instalado ni
activado. La infraestructura se coordina por el canal y cada paso exige
luz verde explicita. Strict Policy: Zero Emojis.

## Servicios y variables (todo inerte por defecto)

| Pieza | Servicio | Variable de activacion | Sin la variable |
| --- | --- | --- | --- |
| B1 pipeline asincrono | Redis (BullMQ) | `DAVIS_ASYNC_PIPELINE=1` + Redis accesible | camino sincrono historico |
| RF-03 busqueda hibrida | Qdrant + TEI (bge-m3) | `QDRANT_URL` (+ TEI segun adaptador) | TF-IDF historico |
| RF-02 SLM local | Ollama (modelo SLM) | `DAVIS_SLM_MODEL` | clasificacion cloud historica |
| RNF-04 PII pre-LLM | ninguno (en proceso) | `DAVIS_PII_PRELLM=1` (+`DAVIS_PII_PERMITIR` csv acotado) | sin anonimizacion |
| Modos auxiliares (traductor/entrevista) | ninguno (repara inyeccion) | `DAVIS_AUX_CHAT_COMPLETION=1` | comportamiento previo intacto |
| ticketVision local | Ollama qwen2.5vl:7b loopback | `DAVIS_TICKET_VISION_MODEL` (+provider/baseUrl) | inactivo |

## Secuencia de activacion escalonada propuesta

1. `DAVIS_PII_PRELLM=1` (sin infra externa): validar una conversacion de
   prueba con telefono/email/DNI reales de laboratorio; verificar en logs
   del proveedor que sale el token, nunca el valor; verificar que la
   respuesta restaura; verificar que ticketVision local sigue leyendo
   tickets (destino loopback resuelto intacto) y que un multipart hacia
   nube se rechaza con el error declarado.
2. `DAVIS_AUX_CHAT_COMPLETION=1`: activar traductor y entrevista con el
   proveedor central; validar una traduccion y una entrevista de prueba;
   sin este env el comportamiento es el historico.
3. Redis + `DAVIS_ASYNC_PIPELINE=1`: validar ACK inmediato, entrega por
   canal, marca durable y auditoria del worker; matar el worker a mitad
   y verificar recuperacion sin duplicar efectos dentro de la ventana de
   idempotencia.
4. Qdrant + TEI + `QDRANT_URL`: validar reindexacion por firma,
   resultados hibridos y caida a TF-IDF con Qdrant caido.
5. `DAVIS_SLM_MODEL`: validar clasificacion y conversacion nivel 1 con
   las guardias (confirmaciones desnudas y pendientes llegan al agente;
   respuestas que fingen accion caen al agente).

## Rollback por paso

- Cada variable se retira de forma independiente: sin la variable, el
  comportamiento historico queda restaurado al instante (no hay estado
  migrado que deshacer en los pasos 1, 2 y 5).
- Paso 3: retirar `DAVIS_ASYNC_PIPELINE=1`; los trabajos pendientes en
  Redis NO se pierden: se drenan al reactivar o se procesan a mano;
  el camino sincrono sigue operativo mientras tanto.
- Paso 4: retirar `QDRANT_URL`; la busqueda vuelve a TF-IDF sin tocar el
  indice vectorial (se puede borrar la coleccion si se abandona).
- Revert de codigo: cada corte es un commit sobre `ers/fase1-outbox`;
  revertir el commit del paso y reiniciar el servicio. La rama nunca se
  ha empujado aun; el push es decision separada posterior al dictamen.

## Validacion previa obligatoria en el entorno real

- Antes de activar `DAVIS_PII_PRELLM=1` verificar el destino real de
  Ollama (`OLLAMA_HOST`, config) para confirmar que ticketVision resuelve
  a loopback; si el VPS apuntara a un Ollama remoto, la vision de
  tickets pasaria a tratarse como nube (multipart rechazado) y habria
  que fijar `DAVIS_TICKET_VISION_BASE_URL=http://127.0.0.1:11434`.
