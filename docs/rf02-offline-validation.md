# RF02: validacion local sin activar inferencia

Estado a 11 de noviembre de 2026. Base de preparacion: `ec6a99ad3ff062ffca17d4512bde52a29f330951`, rama ERS. No se cambia main ni el bot en ejecucion.

## Resultado

La variante medida no es adecuada para el camino de respuesta rapida. Las seis llamadas historicas tardaron 7.272-9.217 s, con `keep_alive=0` y timeout cliente de 30 s. Ninguna muestra estuvo dentro de 80 ms, 250 ms ni 2 s. Esto describe esas seis llamadas, no predice el porcentaje de timeouts de otra configuracion.

La preparacion mantiene el SLM sin activar. El flujo Groq actual no se sustituye. Las rutas deterministas existentes no se contabilizan como inferencia SLM.

Procedencia: se recupera la correccion de admision del 10 de noviembre: el timeout del cliente no libera el turno mientras la peticion real siga pendiente. El parche historico recuperado, no el nuevo adaptador mejorado, coincide byte a byte con SHA256 `520cb91d114808d66346241a226d60174666f0f7a8406c18f349e9392b198738`. Antes de la mejora nueva de plazo en cola, el adaptador recuperado coincide con el medido: `7f2464daf0038a6190697d0fe5a6edc44d1925763e09efa8d58f0f86936cdfa9`. Esta correccion no cancela el servidor ni pone un plazo duro de CPU. Si la peticion no termina, la admision queda bloqueada. La version historica no acotaba la espera en cola. La revision actual anade un plazo total para el llamador que empieza antes de obtener cliente y encolar: al agotarse rechaza al llamador, sin liberar una generacion SDK activa. Un llamador que caduco en cola queda marcado y su callback comprueba esa marca antes de llamar al SDK, por lo que no genera mas tarde. El timeout depende del event loop; no es un deadline duro de CPU. Los callbacks de cola pueden seguir retenidos hasta que la peticion bloqueada termine; no es un limite global de memoria ni un sistema de admision operacional completo.

## Nuevo analizador offline

`measurementSummary.js` es una funcion pura. `summarize.mjs` solo lee los ficheros locales indicados. No importan servicios de produccion, llaman al modelo, descargan modelos, leen variables de configuracion ni activan nada.

```sh
node scripts/rf02/summarize.mjs tests/fixtures/rf02-cold-six-historical.jsonl
node --test tests/sector3/rf02_measurement_summary.test.js tests/sector3/rf02_timeout_admission.test.js tests/sector3/rf02_inferencia_especulativa.test.js
```

El fixture conserva los datos de las seis llamadas sinteticas del 10 de noviembre, recuperados de su salida historica. No es una nueva medicion ni una lectura del servidor actual. La serializacion del fixture se reconstruyo; no se afirma identidad binaria con el JSONL original.

La revision nueva del adaptador es un cambio local adicional, no bytes historicos. Pruebas nuevas cubren peticion colgada, varios llamadores caducados, rechazo/resolve tardios, ausencia de ejecucion SDK al liberarse la cola y plazo compartido entre espera y generacion. No cancela CPU del servidor. El modelo de concurrencia sigue siendo por instancia o serializador inyectado.

El analizador:

- Exige protocolo, manifest de casos, digest, modelo ASCII acotado a 128 caracteres, IDs ASCII acotados a 64 caracteres, configuracion, resultados completos y resumen coherente. Rechaza IDs duplicados, muestras incompletas, duraciones invalidas o estados implicitos.
- Separa aceptacion del servicio (`exito`) de correccion semantica. No convierte la confianza del modelo ni `semanticMatch` del harness historico en etiquetas independientes de calidad.
- Admite un fichero opcional de juicios, por ID, con `semanticCorrect` booleano y `source` no vacio. La procedencia declarada es para revision humana, no una autenticacion automatica. Sin esos juicios, calidad = desconocida.
- No imprime prompts ni respuestas. Solo IDs, cifras y estados.
- Devuelve rangos descriptivos y conteos de muestras bajo cada objetivo. No calcula ni certifica P95 poblacional, velocidad warm, calibracion, ahorro causal o admision de produccion. `productionEligible` siempre es false; no es un mecanismo de activacion.

Ejemplo de juicio independiente para E1:

```json
{"E1":{"semanticCorrect":true,"source":"Revision del resultado sintetico E1: producto=arroz correcto; el servicio lo rechazo por confianza=0.5"}}
```

Ese caso cuenta como contenido correcto rechazado. No se transforma en error de extraccion ni en exito local. En los casos de abstencion, el juicio debe valorar la abstencion esperada y documentarlo, no inventar un producto o una temperatura para forzar coincidencia.

## Lo que la evidencia permite decidir

| Opcion | Estado | Decision en esta preparacion |
| --- | --- | --- |
| SLM frio antes de Groq para cada mensaje | Seis muestras de 7.272-9.217 s | No activar |
| Mantener el modelo cargado | RAM/carga compartida y latencia warm sin medir | No cambiar keepalive; no inferir velocidad warm restando load |
| JSON Schema en la peticion | Soportado por API actual; compatibilidad instalada y calidad no comprobadas aqui | Candidato de formato, no una solucion demostrada de latencia ni verdad |
| Modelo nuevo, mas pequeno, ONNX u otro proveedor | No medido ni preparado | Fuera de este cambio; sin descargas ni cuentas |
| Evaluacion offline con datos ya obtenidos | Preparada y comprobada localmente | Util ahora, sin consumir cuota ni CPU del VPS |
| SLM lento fuera del camino interactivo | Hipotesis de producto, no una funcion activada | Requiere elegir un uso concreto y medirlo; no se presenta como cumplimiento del ERS |

La carga del modelo fue 3.578-4.481 s. El resto observado (`total_duration - load_duration`) fue 3.378-5.239 s. Esa resta no simula una ejecucion warm: cambian estado de cache, planificacion y otras condiciones. Eliminar load tampoco demuestra el objetivo de 250 ms.

## Siguiente paso acotado, no ejecutado

1. Integrar solo el fix de cola y el analizador tras revision, sin activar el SLM.
2. Mantener separados los gates de calidad, latencia, recursos compartidos y permiso de activacion. Un score autodeclarado >=0.82 no calibra el modelo.
3. Antes de una nueva medicion, fijar un objetivo util concreto, ventana, presupuesto de llamadas y comparador. No iniciar mediciones warm ni compartir CPU con tickets por defecto.
4. Una medicion futura debe distinguir cold/warm, tiempo total de la peticion, cola, carga, evaluacion del prompt y generacion, ademas de errores y peticiones residuales. Un resultado favorable de seis ejemplos no certificaria P95 ni calidad general.

No se han hecho nuevas generaciones, descargas, cambios de keepalive, despliegues, llamadas externas, altas de usuarios ni trabajo RAG.

## Fuentes tecnicas consultadas

Documentacion actual consultada el 11 de noviembre de 2026. Sirve para interpretar parametros y campos, no demuestra la version ni el comportamiento del servidor desplegado.

- https://docs.ollama.com/api/usage : duraciones en nanosegundos; distincion load/prompt/eval.
- https://docs.ollama.com/faq : keep_alive=0 descarga tras la respuesta; concurrencia y cola requieren considerar memoria/contexto.
- https://docs.ollama.com/api/generate : parametros de generacion y duraciones devueltas.
- https://docs.ollama.com/api/chat : formato JSON/JSON Schema y parametros de chat.
- https://docs.ollama.com/capabilities/structured-outputs : estructura de salida; no equivale a correccion semantica.
- https://github.com/ollama/ollama-js/blob/main/README.md : abort documentado para generaciones en streaming; no se asume cancelacion CPU de la llamada no-streaming recuperada.

Fuente del proyecto: https://github.com/DCastellanos4/F.R.I.D.A.Y-bot . RF02 y sus objetivos se cotejaron con la base indicada al comienzo.
