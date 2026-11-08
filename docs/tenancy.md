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
