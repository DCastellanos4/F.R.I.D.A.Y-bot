# Tenancy: Aislamiento Completo y Motor de Cuotas SaaS (Fase 2)

Estado: OPERATIVO EN PRODUCCION. El switch `AISLAMIENTO_COMPLETO = true` se encuentra permanentemente activo con compuerta fail-closed.

## 1. Estado de Implementacion

- `src/core/tenancy.js`: `AISLAMIENTO_COMPLETO = true`. `tenantsHabilitados()` activo si `process.env.DAVIS_TENANTS_ENABLED === '1'`. En ausencia de tenant autorizado o con parametros invalidos, el sistema opera fail-closed y deniega el acceso antes de cualquier ejecucion.
- `src/composition/tenantPlans.js`: Definicion de presets de planes:
  * `demo`: 15.000 tokens/dia, 5 RPM.
  * `cliente`: 100.000 tokens/dia, 15 RPM.
  * `staff`: 500.000 tokens/dia, 60 RPM.
  * `propietario`: ilimitado (sin cuotas de tokens ni rate limits).
- `src/services/tenantQuotaService.js`: Control persistente de consumo:
  * Persistencia dual: SQLite (`tenant_limites`, `tenant_uso`) con fallback en memoria.
  * Ventana deslizante de 1 minuto para RPM.
  * Ventana diaria acumulada de tokens con reseteo automatico por fecha local.
- `src/core/messageProcessor.js` y `src/composition/container.js`: Verificacion temprana de cuotas. Si un tenant supera su limite diario o de RPM, la peticion se deniega en la frontera de entrada, devolviendo un mensaje sanitizado sin consumir inferencia de LLM ni exponer datos de infraestructura.

## 2. Aislamiento de Almacenamiento y Rutas

- SQLite: Tablas `tenants`, `tenant_limites`, `tenant_uso`, `memorias`, `finanzas_gastos`, `finanzas_suscripciones`, `presupuestos_categoria` particionadas por columna `tenant_id`.
- Sistema de archivos: `aislarOpcionesTenant` fuerza que todas las rutas de notas, diarios, grafos y memorias operen exclusivamente bajo `tenants/<tenantId>/`. Los datos de un tenant son inaccesibles para los demas.
- Propietario: El propietario conserva su ruta historica directa en la raiz de datos y esta completamente exento de restricciones de cuota o rate limit.

## 3. Cobertura de Pruebas
- Suite: `tests/sector3/tenancy_planes_cuotas.test.js` (14/14 tests pasando).
- Cobertura global de Tenancy: 54/54 tests pasando (fundamentos, limites de uso, puente WhatsApp, sin fuga en LLM, rutas de notas y semantica).
