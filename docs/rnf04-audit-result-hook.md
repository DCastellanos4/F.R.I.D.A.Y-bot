# RNF-04: hash de resultado en el worker

Delta LOCAL sobre dcf25485e9e2c9e12eb91932cce1dabe1e63a6b0. No despliega, activa flags, usa modelos, cambia la retencion ni reanuda el ensayo aparcado.

## Brecha cerrada en codigo

El worker ya registraba una marca durable antes de la accion con efectos y una fila de auditoria con argumentos anonimizados. Nunca recibia el resultado de la herramienta, de modo que respuesta_sha256 permanecia NULL en esa costura.

Ahora el wrapper ejecutarHerramientaJarvis llama a un hook interno onResultadoHerramienta. Solo el worker lo conecta al servicio de auditoria existente. No hay nuevo almacenamiento, migration, secreto, transporte, temporizador o servicio. La marca de planificacion anterior a la accion se conserva sin cambio de orden.

El hook notifica:

- retorno: el wrapper devolvio su objeto de respuesta. No significa exito semantico ni confirma un efecto externo.
- error: el ejecutor lanzo. Se hashea una clase fija ERROR_HERRAMIENTA_EFECTO_NO_VERIFICADO, no el mensaje de excepcion. No afirma que el efecto no ocurriera.
- acceso_denegado: el RBAC del wrapper rechazo la llamada sin ejecutar la herramienta.

El nombre del nuevo evento sale del catalogo cerrado o es desconocida. El worker pasa argumentos y el objeto {fase:post_wrapper, estado, valor:respuesta} al auditLogService existente, que anonimiza antes de calcular los hashes. La DB recibe hashes, no el objeto ni la respuesta en claro. Las etiquetas se incluyen en el contenido hasheado; no son nuevas columnas consultables. Se conserva la fila de intencion previa con respuesta NULL y se agrega otra fila para el resultado observado. Dos invocaciones reales iguales producen dos eventos, no una deduplicacion falsa.

Un fallo al guardar el resultado incrementa fallosAuditoriaResultados y marca auditoriaResultados:degradada en los metadatos del outbox. Se conserva tambien el indicador historico durabilidadCheckpoints:degradada. No se incluye el texto del error de auditoria. No se lanza el fallo al ejecutor ni se repite la herramienta por ese fallo. El entregador actual usa texto y no presenta esos metadatos al destinatario: no se promete aviso visible al usuario a partir de ellos.

## Limites

La cobertura exige una invocacion que llegue a ese wrapper con el hook del worker. No cubre guardias anteriores, checkpoints bloqueados, deduplicacion previa, llamadas anidadas que eviten el wrapper ni ejecuciones sincronas fuera del worker. No cambia la auditoria historica de intenciones ni su interpretacion. El cierre de esta brecha no es un inventario exhaustivo de todas las invocaciones del sistema.

Una muerte despues del resultado y antes de la fila puede dejar solo la intencion anterior. No hay recuperacion automatica del resultado, ni reejecucion para reconstruirlo. La auditoria no es una condicion de admision nueva para ejecutar herramientas. Los fallos se declaran como degradacion, no como garantia de integridad completa.

La cadena SHA256 continua sin firma con clave ni anclaje externo; alguien con escritura suficiente podria rehacerla. Tampoco elimina ataques de diccionario sobre hashes de valores de baja entropia. No se afirma inmutabilidad, aislamiento de tenants completo, exactly-once ni validacion real en el servidor.

## Verificacion dirigida

10 pruebas nuevas del hook y 27 existentes de las costuras afectadas: 37 PASS, 0 fallos, 0 skips. Sin baterias generales del ensayo o del proyecto.

Las pruebas nuevas conducen al core real con LLM/herramientas falsos y al worker con SQLite en memoria; comprueban hash de respuesta anonimizada y cadena, orden intencion -> herramienta -> resultado, fallo audit sin reejecucion y con metadatos de degradacion, error sin excepcion retenida, nombre desconocido redactado en el nuevo hook, inercia sin auditor, dos invocaciones no deduplicadas y etiqueta de denegacion. Dos probes de ramas del wrapper compilan su cuerpo actual aislado con dependencias falsas para comprobar denegacion sin ejecutor y hook rechazado sin duplicacion. No son evidencia de RBAC completo ni de runtime.

```sh
NODE_ENV=test node --test tests/sector3/ers_audit_result_hook.test.js tests/sector3/ers_seguridad_rnf04.test.js tests/sector3/ers_wiring_consumo.test.js tests/sector3/ers_outbox_reanudacion.test.js
```
