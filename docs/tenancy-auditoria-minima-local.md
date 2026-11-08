# Matriz local del minimo multiusuario (8 noviembre 2026)

Base desplegada inmutable durante esta fase: `2092d0ae893eac997237fdc6ccbe485dcf2a5016`.
Esta matriz describe un candidato LOCAL posterior, no lo que esta en produccion.
No hay push, activacion de tenants reales, canales nuevos, schedulers nuevos ni cifras de cuotas.
La compuerta publica y la lista blanca por defecto siguen cerradas. No se amplia ninguna clase RBAC.
Las pruebas usan propietario/A/B sinteticos en directorios privados.

## Clases aptas actuales: 27 datos_tenant y 4 sin_estado

CATALOGO = `tests/sector3/tenancy_catalogo_e2e.test.js`: bucle real del agente, ejecutores/servicios reales, llamadas del modelo simuladas. Una prueba compara el conjunto cubierto con la clase completa para fallar si se anade una herramienta sin cobertura.

| Herramientas | Fuente/destino | Estado del candidato local | Prueba |
| --- | --- | --- | --- |
| `guardar_memoria`, `listar_memorias`, `olvidar_memoria`, `buscar_memoria`, `buscar_recuerdo_semantico` | `brain_memory.json` propio | Hecho: alta/lectura/operaciones y borrado si existe | CATALOGO |
| `registrar_contacto`, `listar_contactos`, `buscar_contacto` | `contactos.json` propio | Hecho: alta/lectura/operaciones y borrado si existe | CATALOGO |
| `registrar_habito`, `listar_habitos`, `marcar_habito` | `habitos.json` propio | Hecho: alta/lectura/operaciones y borrado si existe | CATALOGO |
| `anadir_compra`, `listar_compra`, `tachar_compra`, `vaciar_compra` | `compra.json` propio | Hecho: alta/lectura/operaciones y borrado si existe | CATALOGO |
| `anotar_idea`, `listar_ideas` | `ideas.json` propio | Hecho: alta/lectura/operaciones y borrado si existe | CATALOGO |
| `poner_menu`, `ver_menu` | `menus.json` propio | Hecho: alta/lectura/operaciones y borrado si existe | CATALOGO |
| `crear_quedada`, `listar_quedadas` | `quedadas.json` propio | Hecho: alta/lectura/operaciones y borrado si existe | CATALOGO |
| `registrar_entrega`, `listar_entregas`, `eliminar_entrega` | `entregas.json` propio | Hecho: alta/lectura/operaciones y borrado si existe | CATALOGO |
| `registrar_fecha_senalada`, `listar_fechas_senaladas`, `eliminar_fecha_senalada` | `fechas_senaladas.json` propio | Hecho: alta/lectura/operaciones y borrado si existe | CATALOGO |
| `obtener_noticias_actuales` | RSS publico curado + verificacion HEAD | Hecho offline: titular real del servicio aparece en resultado | CATALOGO, solo transporte simulado |
| `resumen_deportivo` | RSS anterior + modelo secundario con titulares | Hecho offline: probado contrato `{articulos}` y prompt secundario no vacuo | CATALOGO, solo transporte/modelo simulados |
| `buscar_producto` | API publica PriceRadars, consulta de entrada | Hecho offline: resultado de producto verificado, HTTPS interceptado en transporte | CATALOGO |
| `guiar_depuracion` | Solo fallo/contexto de entrada + modelo secundario | Hecho offline: argumentos comprobados en llamada secundaria, resultado no vacuo | CATALOGO |

No son verificaciones de disponibilidad ni veracidad de proveedores en vivo. No se sustituyen ejecutores ni se permite heredar callbacks privados del propietario para superar las pruebas.

## Fuentes indirectas y entradas

| Camino | Estado local / prueba | Limite |
| --- | --- | --- |
| Firma legacy `(mensaje, opciones)` | Normalizada antes de gate/control/RBAC/aislamiento. `tenancy_adversarial_paths` prueba entrada publica e interna y ambas firmas owner | Auditoria de llamadores: `src/core/messageProcessor.js:72` usa tres argumentos y opciones de composicion interna; `scripts/test_llm_provider.js` usa un argumento. No se encontro llamador productivo legacy controlado externamente |
| Memoria por defecto SQLite owner | Crear/leer/borrar A con repositorio owner real registrado no lo toca. `tenancy_catalogo_e2e` + `tenancy_llm_sin_fuga` | Mutacion real de la ruta de guardar_memoria falla en familia y SQLite owner |
| RAG memoria/notas/diario | Rutas forzadas por tenant; notas y documentos con containment realpath y lector protegido. `tenancy_llm_sin_fuga`, `tenancy_notas_ruta`, `tenancy_adversarial_paths` | Escribir notas/diario sigue fuera de clases aptas, no se habilita |
| Grafo/vectores/episodios/indices/trazas/idempotencia | Opciones forzadas al subarbol tenant; `tenancy_llm_sin_fuga`, `tenancy_adversarial_paths` | No se heredan destinos ni callbacks privados; historiales de entrada sin procedencia tenant se descartan |
| Puertos de datos/executores/metricas/productos/noticias | Allowlist positiva de opciones operativas; desconocidos descartados, control/rol/modelo siguen siendo puertos de composicion interna confiables | No se deben convertir en opciones procedentes del texto del usuario |
| Prompt e inventario de integraciones owner | Prompt tenant independiente sin configuracion del host; catalogo ofrecido filtrado por RBAC. `tenancy_adversarial_paths` | El propietario conserva prompt/catalogo historico |
| Cache de clasificacion | Clave tenant + mensaje, prueba A/B con mismo texto y modelos distintos invocados | Cache owner historica conservada |
| URL/resumen y trenes deterministas antes del bucle | Rechazo tenant antes de red/efectos, aunque mensaje case con rama. `tenancy_adversarial_paths` | Renfe/owner no cambian; transporte sigue owner-only |
| Archivos/directorios/enlaces | Guardia lstat/realpath en raiz/ancestros/arbol antes de entrada/modelo/tools; rechaza enlaces simbolicos, hardlinks, especiales; IO final con O_NOFOLLOW/fstat sin truncar antes de validar | No es containment atomico de ancestros: ver brecha siguiente |
| Cuotas y libro de uso | Persistentes y por tenant; control antes de cada llamada de modelo, incluido secundario; owner exento. Pruebas previas `tenancy_limites_uso` y E2E | Sin cifras configuradas ni reserva previa: peticiones en vuelo pueden rebasar cuota de tokens |
| Recuperacion en copia nueva | Backup sintetico restaurado, owner/A/B leidos; operaciones y borrado A en copia dejan owner/B/original intactos. Integrity/FK comprobadas. `tenancy_backup_recuperacion` | No prueba restauracion selectiva activa ni snapshot manual con escritores concurrentes |

## Excluido expresamente

Todas las clases `host`, `credenciales`, `identidad`, `terceros`, `global_sistema` y `datos_propietario` siguen denegadas a no propietarios, incluso si una lista blanca interna intenta incluirlas. Las herramientas no clasificadas fallan cerradas.
No se entregan canales/altas reales, envios multiusuario, monitores, recordatorios, snoozes, radar, flashcards proactivas, skills, acceso a cuentas owner, backup desde tenant ni nuevas clases aptas.
Las rutas preparadas de servicios excluidos NO equivalen a capacidad E2E multiusuario entregada.

## Brechas tecnicas que quedan abiertas

- Un proceso hostil con el mismo UID y capacidad de renombrar ancestros concurrentemente puede competir entre check y use. O_NOFOLLOW protege el componente final, no los ancestros; pre/post realpath no equivale a openat2/dirfd ni sandbox del SO. No dar acceso al filesystem a tenants ni afirmar aislamiento adversarial completo. Antes de ese modelo de amenaza hace falta containment atomico nativo o aislamiento de SO.
- No hay productor de historial tenant confiable ni canal multiusuario productivo. Los arrays de historial sin ambito se descartan para no filtrar; continuidad completa no se entrega.
- Backup manual lee archivos en instantes distintos. No se certifica consistencia concurrente; el snapshot de despliegue con writers detenidos es un mecanismo distinto, no cambiado en esta fase.
- No hay restauracion selectiva en DB activa ni reserva atomica de presupuesto de tokens para peticiones en vuelo.

## Evidencia de mutaciones reales

- Retirar ruta del payload `guardar_memoria`: fallan familia y SQLite owner (2 tests).
- Retirar guardia de arbol: fallan 6 regresiones de enlaces/read/RAG/write/directorios.
- Retirar O_NOFOLLOW final: falla su regresion de apertura (comprueba flag real, no demuestra containment de ancestros).
- Retirar clave tenant del cache: falla alternancia A/B.
- Contrato deportivo previo `{noticias}` contra RSS real `{articulos}`: rojo real; corregido admitiendo ambos contratos sin cambiar adaptadores owner existentes.
- Todas las mutaciones se revirtieron antes de la validacion final. No se cambia produccion.
