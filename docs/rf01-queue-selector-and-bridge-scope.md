# RF-01: puente outbox SQLite a BullMQ, preparacion LOCAL

Base del puente 91fe50d737cf6ac363b8cd03b39827415887f5aa. Se han validado las costuras LOCAL tanto con broker inyectado como con Redis 7.2.7 real y procesos Node separados, siempre con entradas sinteticas. No se ha conectado al Redis de produccion, instalado un servicio del sistema, llamado a un modelo real, desplegado, activado ni cambiado el ensayo aparcado. No es certificacion RF-01 completo ni exactly-once externo. La ejecucion y sus limites se documentan en rf01-real-redis-validation.md.

## Camino implementado

- DAVIS_QUEUE ausente o sqlite conserva la cola SQLite historica. redis elige ahora el puente, sin fallback silencioso al sondeo SQLite como transporte. Cualquier otro valor falla antes de construir proveedor/persistencia. Con DAVIS_ASYNC_PIPELINE desactivado no se construye el pipeline ni se inicia un broker. Los flags no han sido activados en el servidor.
- El ACK sigue a una escritura SQLite local. No espera a que Redis este disponible. Cada evento tiene transporte sqlite o redis. El evento completo, tenant, texto, argumentos y destinatario se quedan en SQLite. Las APIs legacy de reclamo/fin/fallo/recuperacion no pueden tomar las filas redis; checkpoint y respuesta legacy las rechazan dentro de la misma transaccion.
- Migracion aditiva 010: transporte (default sqlite para los eventos anteriores), claim_token, lease_until e indice. No se altera una migracion aplicada ni se mueve automaticamente una cola anterior a Redis. Un despliegue deberia detener todos los workers antiguos antes de usar la migracion/carril nuevo; no se soporta mezcla de versiones que ignoren las nuevas guardias.
- El puente reconcilia como maximo 32 IDs pendientes por ciclo. SQLite mantiene disponible_en, intentos y fallido. Redis solo recibe {id:evt_UUID}; el jobId es el mismo, sin dos puntos ni formato solo numerico. Los IDs mal formados se rechazan. El broker no es la fuente de contenido ni el permiso para ejecutar.
- Una notificacion puede publicarse mas de una vez. Si cae el proceso entre INSERT y publicacion, el pendiente se vuelve a encontrar. Si cae tras publicar, puede publicarse de nuevo. BullMQ mantiene como maximo un job con ese ID mientras exista; al completarlo o fallarlo retira la notificacion, para que SQLite pueda volver a notificar un pendiente con backoff. Esto solo afecta a notificaciones nuevas sin contenido privado, no a la retencion de SQLite, auditoria ni backups. No hay una marca dispatched que impida recuperar tras perdida del contenido de Redis.
- El consumidor reclama el ID original con CAS SQLite dentro de transaccion inmediata. Si ya esta tomado, completado, fallido o aun no disponible, no ejecuta. El token aleatorio cambia en cada reclamo y no sale hacia Redis. Checkpoint, auditoria del worker y INSERT OR IGNORE de respuesta verifican el token/lease dentro de la MISMA transaccion que escribe. Fin/fallo tambien verifican token y lease atomicamente. No basta un check anterior separado.
- Default lease 60s, heartbeat 10s. Si falla la renovacion se cierra la admision de ese trabajador de forma permanente, aunque una lectura posterior aun vea su lease vigente. No inserta resultados/response tras ese fallo, ni pasa inmediatamente el evento a pendiente por su cuenta; queda para recuperacion al vencer. El wrapper comprueba titularidad antes de invocar cada herramienta. No cancela una llamada externa ya en vuelo.
- El worker usa checkpoint por ID original y el core conserva acciones inciertas en TODOS los checkpoints siguientes. Una accion planificada sin confirmacion de cierre no se reejecuta automaticamente tras una, dos o mas recuperaciones. Se mantiene la incertidumbre, no se convierte un timeout en prueba de que no hubo efecto.
- La respuesta usa resp_eventID. Un trabajador antiguo tras nuevo reclamo no puede fijar una respuesta obsoleta antes del nuevo trabajador, ni auditar un resultado como si siguiera siendo titular. El entregador anterior no cambia: enviando antes de enviar, incierto ante fallo ambiguo, sin reenvio ciego.
- Un resultado del handler con lease valida completa SQLite; un fallo de procesamiento con titularidad valida actualiza los intentos/backoff de SQLite. BullMQ attempts=1: no hay segunda politica independiente de reintentos del negocio. Una notificacion fallida o perdida puede volver a generarse desde el outbox. Fallos de broker se cuentan sin volcar excepciones privadas; estadoCola expone contadores y estado acotado. No hay alertas o monitores externos nuevos.
- El cierre detiene intake/reconciliacion, cierra el broker y espera a las operaciones propias. No impone un limite universal sobre un SDK/herramienta que no devuelve; no mata procesos ni vuelve a ejecutar para completar el cierre.

## Adaptador BullMQ reutilizado

El adaptador anterior enviaba el trabajo completo, generaba otro ID, configuraba backoff linear y no modificaba el outbox al completar. Se limita ahora al protocolo de ID, con jobId estable, attempts=1 y concurrencia 1 por worker. Se mantiene carga perezosa. El cargador inyectable permite probarlo sin Redis. Un fallo inicial de carga conserva la intencion de consumir y la publicacion posterior intenta reconstruir el transporte. La carrera cerrar/cargar no crea una cola tardia. Las notificaciones se validan tambien al consumir y el job.id debe coincidir con data.id.

El destino admitido por este codigo es redis:// de loopback (127.0.0.1, localhost o ::1). No solicita credenciales ni configura autenticacion, TLS, persistencia o servicio. La cola usa el comportamiento nativo de conexion/reconexion de BullMQ; la prueba aislada no afirma disponibilidad del broker de produccion. Los detalles operacionales deben revisarse antes de activar. El contenedor actual permanece sin flags activos.

## Limites no resueltos por estos cambios

- SQLite WAL exige mismo host. No se ofrece un pool multi-host ni persistencia SQL remota.
- La lease usa reloj de pared. Pausas largas/event-loop bloqueado, cambios de reloj, fallos de IO y SDKs en vuelo siguen importando. Una lease no es una prueba de muerte de un proceso ni revoca efectos externos ya iniciados.
- El check antes de invocar evita nuevas invocaciones detectadas como obsoletas. No puede cerrar la carrera entre ese check y el proveedor externo. La marca previa durable mantiene la accion incierta para no repetirla; no hay exactly-once de servicios externos.
- El contrato incierto se apoya en las claves de acciones exactas existentes. Reformulaciones o peticiones nuevas no son deduplicacion semantica universal. La clasificacion historica de herramientas idempotentes no se ha reauditado aqui.
- Worker y core pueden seguir calculando tras perder el reclamo, pero no pueden escribir checkpoints, auditoria o respuesta bajo el token antiguo. No se paga ni consume un modelo real en estas pruebas.
- No hay politica nueva de reintentar una accion incierta ni se copian mensajes privados a Redis. No se cambia la retencion del outbox, de las respuestas, de la auditoria ni del SQLite backup. No hay limpieza automatica de filas de negocio.
- La cadena de auditoria sigue sin firma/inmutabilidad y puede tener huecos por caida. Los metadatos de degradacion del worker no son un aviso visible al destinatario.

## Activacion y decisiones pendientes

El codigo LOCAL no necesita una nueva decision de usuario para escribir estas costuras dentro de implementar ERS. La activacion si requiere otra ventana aprobada y revision del destino/broker gratuito/autenticacion/persistencia/capacidad, configuracion efectiva, backup, migracion y recuperacion. No se ha abierto esa ventana de produccion, pedido secretos ni retomado el ensayo. Solo se ha iniciado Redis temporal aislado LOCAL para validar con datos sinteticos.

Para pasar de SQLite historico a redis: los eventos anteriores permanecen en transporte sqlite. Debe decidirse y verificar una estrategia de drenaje con productores/workers parados de forma controlada, sin volver a publicar trabajos inciertos como nuevos. Este codigo no migra ni adopta pendientes antiguos por inferencia. Tampoco vacia una cola al quitar el flag. Son condiciones de operacion, no un motivo para declarar activacion completa ahora.

Validado LOCAL con broker real: E2E, perdidas reales de Redis y procesos, reclamacion tras caida, no replay incierto, guardia contra worker obsoleto, dos procesos sobre 200 trabajos y backoff de negocio. Pendientes: configuracion y disponibilidad de produccion, carga sostenida representativa, latencia del canal vivo, ventanas de migracion/drenaje y recuperacion operativa. La recuperacion por BullMQ stalled no es inmediata: se observaron 60.395s y 90.412s; no se garantiza un RTO maximo. Los timeouts de 15s y 75s fallaron y se conservan como evidencia, no como certificados de perdida de trabajo.

## Fuentes

- https://docs.bullmq.io/guide/jobs/job-ids: unicidad por cola mientras el job exista; al borrarlo deja de deduplicar.
- https://docs.bullmq.io/guide/retrying-failing-jobs: attempts y backoff incorporado fixed/exponential. Este puente no usa backoff BullMQ para el negocio.
- https://www.sqlite.org/wal.html: WAL comparte memoria entre procesos del mismo anfitrion.
