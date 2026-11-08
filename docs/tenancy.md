# Tenancy: fundamentos locales (fase 1)

Estado real. Nada de esto habilita usuarios nuevos, canales, cuotas numericas, tiers ni acceso externo.

## Hecho (con tests)
- `src/core/tenancy.js`: tenant 'propietario' por defecto, `tenantId` validado, `esPropietario` identico a la resolucion historica de `esMensajeDeDavid` (subcadena en telefono/LID y mapeo inverso Baileys). `resolverTenant` nunca crea tenants.
- Migracion 002 (aditiva): `tenants`, `identidades`, `tenant_id DEFAULT 'propietario'` en memorias y finanzas_*, reconstruccion de PK de presupuestos y config (copia completa de filas), `uso_tokens`.
- Almacenes SQLite de memorias y finanzas con alcance de tenant: lectura y reemplazo solo de SU tenant. Sin opcion = propietario.
- Libro persistente de tokens reales por tenant, dia y modelo efectivo. Solo mide. Sin precios ni coste.
- RBAC: propietario y llamantes historicos sin cambios; resto denegado por defecto (lista blanca vacia). Tenant desconocido: denegado antes de llamar al LLM.

## No hecho (faltantes reales)
- `esMensajeDeDavid` en whatsappBot sigue siendo la puerta real; `resolverTenant` aun no se usa en el camino de mensajes (a proposito: los remitentes ajenos siguen en el filtro VIP/rele).
- Aislamiento NO aplicado a: ~45 ficheros JSON, memoria semantica/grafo/vectores (`semanticMemoryService`, `graphMemoryService`), historial por chatId, importExport/backup (solo propietario).
- Backup de tenants no propietarios y cifrado por tenant: sin diseno cerrado (no excluirlos como "seguro por defecto": faltaria recuperabilidad). No se toca el cifrado existente.
- Cuotas, rate limiting, estimacion de coste, retencion/RGPD: sin implementar.
- Verificar con datos de produccion la migracion 002 (reconstruccion de tablas) antes de desplegar: usar el snapshot previo.

## Inventario de ficheros de datos por riesgo y cobertura real

Estado: la compuerta fail-closed (`AISLAMIENTO_COMPLETO = false`) sigue cerrada. La lista blanca RBAC vacia deniega herramientas pero NO sustituye el aislamiento de datos: lo que sigue es lo que esta o no probado. Nada de esto prueba aislamiento total.

Aislado Y probado con LLM stub (tests `tenancy_llm_sin_fuga`, `tenancy_semantica_grafo`):
- `brain_memory.json` (memoria exacta y semantica), `knowledge_vectors.json`, `knowledge_graph.json`: ruta por tenant forzada en `aislarOpcionesTenant`; puertos del propietario (`memoryRepository`, `obtenerMemorias`, `contactosConocidos`) retirados.
- Historial y episodios por chatId: clave con ambito de tenant.
- Cola `scheduled_messages.json`: dueño por registro; listar/cancelar/despachar (`tenancy_colas_proactivas`).
- Cache de idempotencia: el hash incluye el tenant (no propietario).
- SQLite (memorias, finanzas, presupuestos, config, uso de tokens): `tenant_id` y stores con ambito (tests de fundamentos). Importacion/exportacion JSON usa los stores del propietario; `estadoTablas` cuenta solo filas del propietario (las tablas con `tenant_id`): datos de tenants ni bloquean la importacion ni entran en su verificacion de integridad; datos del propietario sin marca de origen siguen fallando cerrado (`tenancy_singletons_importexport`, con mutacion).

Sin aislar (no probado, global, riesgo alto: datos personales o envios): `contactos.json`, `calendar_events.json`, `reminders.json`, `snoozes.json`, `avisos_llegada.json`, `viajes_vigilados.json`, `procesos_vigilados.json`, `tracked_items.json`, `entregas.json`, `compra.json`, `habitos.json`, `quedadas.json`, `menus.json`, `hogar_config.json`, `usuarios.json`, `alerts_queue.json`, `flashcards*.json`, `job_radar*.json`, `applications.json`, `entrevistas.json`.
Sin aislar, riesgo medio: `ideas.json`, `study_plans.json`, `skills.json`, `traductor.json`, `recomendador.json`, `digest_cerebro.json`, `fechas_senaladas.json`, `modo_nocturno.json`, `transporte.json`.
Globales de sistema (no son datos de usuario, pero comparten registro): `ops_config.json`, `manifiesto.json`, `watchdog_state.json`, `metricas*.jsonl`, `*.log`.
Hoy los protege solo la compuerta cerrada y RBAC vacio (probado sobre todo el catalogo de herramientas), no un aislamiento propio.

Actualizacion: `tracked_items.json` (sniper) y `alerts_queue.json` llevan dueño por registro (propietario = sin campo). La cola de alertas la drena el canal del propietario: las alertas etiquetadas con tenant no salen por ahi. Ningun servicio llama aun a `enqueueAlert` con `tenantId` (los servicios de tenant no estan activos), por lo que el etiquetado es defensa preparada. `calendar_events.json` solo lo usa el briefing del propietario (ninguna herramienta lo expone al LLM); la API de Google Calendar usa credenciales del propietario y no debe ofrecerse a tenants.

Actualizacion (rutas por servicio y singletons):
- Con ruta de tenant forzada y probado con sentinel dir (`tenancy_servicios_ruta`): contactos, habitos, compra, quedadas, ideas, snoozes, entregas, procesos, fechas, llegada, menus, viajes, flashcards, recordatorios (crear), candidaturas, planes, traductor, transporte, entrevistas. Esto prueba que el servicio respeta la ruta recibida, no que el despacho sea seguro: los recordatorios solo se envian desde el fichero global, asi que uno de tenant nunca se envia (falla cerrado).
- Sigue sin ruta/aislamiento: `usuarios.json` (solo lo usa importar/exportar del propietario), monitores flashcard/radar, `ops_config.json`, `manifiesto.json`, `watchdog_state.json`, `metricas*.jsonl`, `*.log`, `skills.json`, `recomendador.json`, `digest_cerebro.json`, `modo_nocturno.json`, `hogar_config.json`. Siguen abiertos hasta probarse o excluirse expresamente del alcance seguro.
- Singletons por defecto (memoria, finanzas, libro de uso): probada la alternancia propietario/tenants y la concurrencia de microtareas dentro de un proceso (`tenancy_singletons_importexport`). No prueba concurrencia entre procesos pm2 para memoria/finanzas (el runner de migraciones si la tiene).
- Atribucion de tokens: `medirUso` con un `tenantId` presente pero invalido ya NO se anota al propietario: no se mide (test). Sin tenantId sigue siendo el propietario.

Actualizacion (buscar_recuerdo_semantico y notas):
- Fuga real cerrada: `buscar_recuerdo_semantico` leia memorias del almacen SQLite por defecto del propietario y notas de `DATA_DIR/notes` aunque el agente fuera de un tenant. Ahora `brainSearchService` usa solo `rutaArchivoMemorias` si se le da, y `aislarOpcionesTenant` fuerza `carpetaNotas` y `carpetaDiario` a `tenants/<id>/`. Esto cubre tambien digest, wiki, preguntar_documentos, analizar_cv_oferta, resumir_apuntes, capturar_pagina, guardar/listar notas y diario (que antes escribian siempre en la carpeta global).
- Prueba: E2E por el bucle real del agente con LLM stub (`tenancy_llm_sin_fuga`, tests 5 y 6), con SQLite del propietario registrado por defecto, notas propias y ajenas, mutaciones reales (quitar la ruta de memorias; quitar `carpetaNotas` forzada) que fallan. La lista blanca solo se abre en ese test mediante `opciones.permitidasUsuario` (opcion interna, ningun llamador de produccion la pasa); con la lista vacia el tenant queda denegado. Tests de servicio: `tenancy_notas_ruta`.
- Defecto corregido: la denegacion RBAC devolvia un string en vez de `{texto}`, asi que el modelo recibia un resultado de herramienta vacio. Seguia fallando cerrado, pero sin mensaje.
- Defecto corregido: `listar_notas_recientes` pasaba un objeto como `limit` e ignoraba categoria; ahora `listRecentNotes(limite, {category, carpetaNotas})`.
- Pendiente: `ejecutar_skill` sin E2E.

Actualizacion (multiproceso y radar): `tenancy_multiproceso` lanza 4 procesos Node reales sobre una DB WAL (2 sobre el propietario, 1 por tenant sintetico) con memoria y finanzas: sin perdida y sin mezcla; mutacion (memoryService sin transaccion) hace fallar el test. Radar de ofertas: `aislarOpcionesTenant` fuerza `radarDeps` (config y vistos del tenant, sin cola global); no hay E2E por el agente porque sus herramientas estan denegadas a tenants (`terceros/host`). Los monitores en segundo plano (flashcards, radar) siguen sin ambito de tenant.

Actualizacion (limites de uso, backup y exclusiones):
- Limites configurables (`sqliteLimitesStore`, migracion 003 aditiva `tenant_limites` + `tenant_peticiones`): cuota diaria y mensual de tokens y peticiones por minuto, por tenant. NO hay ningun valor por defecto: sin fila o con NULL no hay limite, y la migracion no inserta filas. El propietario no admite limites (solo medicion) y nunca se deniega. Decision atomica entre procesos (BEGIN IMMEDIATE); una peticion denegada no consume ritmo; "superada" = usado >= limite. Los tokens se miden despues de cada llamada, asi que una peticion puede rebasar la cuota una vez. Enganche: `opciones.controlUso.autorizar({tenantId})` en `consultarJarvisEnAmbito`, solo para tenants y solo si se inyecta; error del controlador = denegado. Hoy no se inyecta en ningun canal (tenants inactivos, compuerta cerrada). No se han definido tiers ni cifras. Pruebas: `tenancy_limites_uso` (limites exactos, persistencia, 4 procesos con limite 30 => exactamente 30, mutaciones reales).
- Backup cifrado actual (`createEncryptedBackup`): recorre `data/` entero (excepto backups, node_modules, .git, temp_downloads, *.davbak, *.tmp), asi que INCLUYE `data/tenants/<id>/`, `jarvis.db` y sus ficheros -wal/-shm como ficheros sueltos, mas package.json/.env/.env.example por defecto. No excluye datos de tenants. La restauracion sintetica aislada (directorio nuevo, clave de prueba) devuelve la base integra con propietario, tenants, uso y limites, y los JSON de tenant (`tenancy_backup_recuperacion`). NO probado: copia con escrituras concurrentes (los ficheros se leen en instantes distintos; una copia consistente en caliente requiere la API de backup de SQLite o checkpoint, solo diseño). Cifrado y clave sin cambios.
- Exportacion/importacion JSON: la exportacion es solo del propietario (memorias, finanzas, usuarios); NO incluye tenants, `uso_tokens` ni `tenant_limites` (esos solo viajan en el snapshot de la base). La importacion sigue fallando cerrado ante datos del propietario sin marca de origen y no toca filas de tenants.
- Excluidos de capacidades multiusuario (denegados por RBAC antes de programar nada, probado con lista blanca que contiene todos): recordatorios, snoozes, avisos de llegada, vigilancias, repaso de flashcards, radar, digest semanal, `ejecutar_skill`, backup. Los monitores en segundo plano y el despacho de recordatorios son solo del propietario. Esto no es una fuga mientras la denegacion ocurra antes de programar; no es una capacidad entregada.
- Limite explicito de `ejecutar_skill`: denegado a no propietarios; cada subtool conserva RBAC; sin E2E por no exportar la funcion solo para pruebas.
