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
- SQLite (memorias, finanzas, presupuestos, config, uso de tokens): `tenant_id` y stores con ambito (tests de fundamentos). Importacion/exportacion JSON usa los stores del propietario; los conteos de `estadoTablas` cuentan TODAS las filas (con tenants reales podrian bloquear una reimportacion: falla del lado seguro, pendiente de revisar).

Sin aislar (no probado, global, riesgo alto: datos personales o envios): `contactos.json`, `calendar_events.json`, `reminders.json`, `snoozes.json`, `avisos_llegada.json`, `viajes_vigilados.json`, `procesos_vigilados.json`, `tracked_items.json`, `entregas.json`, `compra.json`, `habitos.json`, `quedadas.json`, `menus.json`, `hogar_config.json`, `usuarios.json`, `alerts_queue.json`, `flashcards*.json`, `job_radar*.json`, `applications.json`, `entrevistas.json`.
Sin aislar, riesgo medio: `ideas.json`, `study_plans.json`, `skills.json`, `traductor.json`, `recomendador.json`, `digest_cerebro.json`, `fechas_senaladas.json`, `modo_nocturno.json`, `transporte.json`.
Globales de sistema (no son datos de usuario, pero comparten registro): `ops_config.json`, `manifiesto.json`, `watchdog_state.json`, `metricas*.jsonl`, `*.log`.
Hoy los protege solo la compuerta cerrada y RBAC vacio (probado sobre todo el catalogo de herramientas), no un aislamiento propio.
