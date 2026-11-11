# RF-01: validacion aislada con Redis real

## Alcance

Validacion LOCAL del 11 de noviembre de 2026 sobre el puente 91fe50d. Redis 7.2.7 real, BullMQ 6.7.2, Node 22.23.4 y SQLite WAL real con better-sqlite3. Dos procesos Node independientes comparten un SQLite del mismo host. Solo entradas, destinatarios y efectos sinteticos. Las herramientas del core se reemplazan por funciones locales sin llamadas externas; el broker NO esta simulado.

No se ha conectado al bot, Redis o SQLite de produccion, ni al ensayo de servidor aparcado. No se ejecuta CI ni se crean servicios del sistema. No se activan tenants, modelos, pagos ni envios a personas. No hay migracion/drenaje de pendientes reales ni cambios de retencion.

## Reproduccion manual, opt-in

Requiere Linux, las dependencias del proyecto y un ejecutable Redis local compatible (>=6.2). No hay descarga o instalacion automatica. No poner la ruta de un wrapper de un servicio existente: se requiere el binario redis-server.

```sh
DAVIS_TEST_REDIS_BINARY=/ruta/absoluta/redis-server node scripts/rf01/validate-real-redis.mjs
```

Sin esta variable absoluta, se detiene antes de crear la prueba. El script elige un puerto efimero, inicia su propio Redis enlazado a 127.0.0.1 y comprueba su process_id antes de escribir. Nunca usa DAVIS_REDIS_URL ni el puerto por defecto de otro servicio. Toda la base de negocio y los logs se crean en un directorio temporal nuevo. Redis usa protected-mode yes, sin AOF ni snapshot: perder TODO Redis deliberadamente pone a prueba que SQLite es la autoridad. Esto no prescribe la configuracion operacional de Redis.

El script crea procesos hijos, les aplica SIGKILL/SIGSTOP/SIGCONT durante escenarios controlados, los cierra y emite validation-result.json en su directorio temporal. A la salida exige childrenRemaining=0; no borra bases de negocio privadas. El resultado deja los temporales sinteticos para inspeccion. No se anade este script al test automatico o a CI.

Una ejecucion puede tardar cerca de dos minutos por los defaults BullMQ de stalled. El deadline por recuperacion de worker es 105s: es un limite del test, NO un SLA ni una garantia de recuperacion en 105s.

## Evidencia observada

La corrida completa portatil dio 13 comprobaciones PASS, 0 fallos y 0 procesos hijos restantes. Estas comprobaciones no son 13 requisitos independientes del ERS completo:

- Binario Redis real y endpoint loopback, no broker inyectado.
- Migracion real desde esquema 009 a 010, preservando un evento anterior en transporte sqlite. No lo adopta automaticamente el carril redis.
- Pipeline E2E por BullMQ, manteniendo eventID y responseID originales.
- Publicacion duplicada de notificacion no vuelve a ejecutar un evento completado.
- Redis no contiene texto/destinatario/tenant/claim token. Se inspecciona tambien un job ACTIVO y su data es exactamente {id:evt_original}.
- SIGKILL de Redis, ACK persistido durante caida y reinicio con Redis VACIO: el outbox republica y completa.
- Fallo de negocio: 2 intentos como maximo, intervalo observado 263ms para backoff SQLite de 250ms. La republicacion de notificaciones no reinicia el contador.
- Dos procesos workers reales y 200 trabajos: 200 invocaciones locales distintas, 200 checkpoints y 200 respuestas. ACK sintetico local p99 0.073ms y max 0.128ms en esa corrida; no prueba el presupuesto de 5ms del canal real ni capacidad sostenida.
- SIGKILL de worker dentro de efecto, despues del intent durable. Reanudacion: exactamente 1 invocacion total del efecto local y 1 respuesta, sin replay de la accion incierta.
- SIGSTOP de worker dentro de efecto, reinicio vacio de Redis y nuevo proceso que reclama: al reanudar el worker viejo, no inserta auditoria de resultado ni cambia la respuesta nueva. Puede haber 2 filas de INTENT, una por intento de procesamiento; no son 2 efectos ni una garantia de unicidad de intent.
- Perdida simultanea de worker y Redis: el nuevo proceso recupera por SQLite.

## Fallos y limites conservados

El primer deadline de 15s fallo. Una corrida posterior con 75s tambien fallo antes de recuperar. No se borran ni se presentan como exitos esas corridas. Los datos seguian pendientes, con checkpoint intent, sin respuesta ni segundo efecto observado.

Se observo recuperacion de worker a 60.395s y, en la corrida portatil instrumentada, a 90.412s. La telemetria muestra el lock Redis vencido, el job aun en active y su paso por stalled; el ciclo de deteccion sigue siendo independiente de la lease SQLite de prueba (900ms). El test no reduce timings BullMQ para fabricar un RTO corto. La fase de stalled-check afecta la demora. No existe un RTO maximo certificado y la corrida de 75s no tenia telemetria suficiente para afirmar su causa individual.

Una asercion inicial de auditoria esperaba 1 fila de intent y recibio 2 al reanudar. Se corrigio el test para distinguir intent de resultado: el requisito es no repetir el efecto y no aceptar resultado obsoleto, no deduplicar todas las auditorias de intent. No se parcheo la aplicacion para ocultar el resultado.

Falta validacion de produccion, canal vivo, carga representativa, autenticacion/capacidad/persistencia del broker real de destino y ventana aprobada de backup/migracion/drenaje. SQLite sigue exigiendo mismo host. No se asegura exactly-once externo, firma/inmutabilidad de auditoria ni ausencia de crash gaps.

## Procedencia del binario usado

Fuente descargada: https://download.redis.io/releases/redis-7.2.7.tar.gz

SHA256 del archivo descargado: 72c081e3b8cfae7144273d26d76736f08319000af46c01515cad5d29765cead5

El ejecutable compilado usado emitio Redis server v=7.2.7 y SHA256 4512209cda20933f595d806761bbfd6c367bcb1aa9a30f8b8ae24013647ba046. No se incluye el binario en git ni se convierte esta prueba en un procedimiento de instalacion productiva.
