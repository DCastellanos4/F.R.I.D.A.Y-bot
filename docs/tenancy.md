# Tenancy: Aislamiento Completo, Second Brain y Motor de Cuotas SaaS

Estado: OPERATIVO EN PRODUCCION. El switch `AISLAMIENTO_COMPLETO = true` se encuentra permanentemente activo con compuerta fail-closed y control en runtime via `DAVIS_TENANTS_ENABLED=1`.

---

## 1. Arquitectura de Tenancy y Cuotas

- `src/core/tenancy.js`: `AISLAMIENTO_COMPLETO = true`. `tenantsHabilitados()` verifica `process.env.DAVIS_TENANTS_ENABLED === '1'`. En ausencia de tenant autorizado o ante parametros invalidos, el sistema opera fail-closed denegando el acceso antes de cualquier ejecucion.
- `src/composition/tenantPlans.js`: Presets de planes oficiales:
  * `demo`: 15.000 tokens/dia, 5 RPM.
  * `cliente`: 100.000 tokens/dia, 15 RPM.
  * `staff`: 500.000 tokens/dia, 60 RPM.
  * `propietario`: ilimitado (sin cuotas de tokens ni rate limits).
- `src/services/tenantQuotaService.js`: Control de consumo y rate limiting:
  * Persistencia dual: SQLite (`tenant_limites`, `tenant_uso`) con fallback en memoria.
  * Hidratacion automatica: `resolverPlan` recupera los limites persistidos en `tenant_limites` tras reinicios de procesos o rotacion de workers.
  * Ventana deslizante de 1 minuto para rate limit de peticiones (RPM).
  * Ventana diaria acumulada de tokens con reseteo automatico segun fecha local.
- `src/core/messageProcessor.js` y `src/composition/container.js`: Verificacion temprana de cuotas. Si un tenant supera su limite diario o de RPM, la peticion se rechaza en la frontera de entrada, retornando un mensaje sanitizado sin consumir inferencia de LLM ni exponer datos de infraestructura.

---

## 2. Second Brain Multi-Tenant (Tarea 2.4)

Cada tenant dispone de una particion fisica y logica completamente aislada de su Second Brain:

1. **Estructura de Archivos Aislada**:
   * Rutas ancladas bajo `data/tenants/<tenantId>/`:
     - `notes/`: Notas personales en formato Markdown (nota inicial `bienvenida.md`).
     - `brain_memory.json`: Almacen de memorias estructuradas del tenant.
     - `diario/`: Entradas de diario personales.
     - `episodios/`: Almacenamiento episodico de interacciones.
     - `indices/`: Indices TF-IDF locales de busqueda.
     - `trazas/`: Logs de auditoria anonimizados por hash.
   * `src/security/tenantFileSystem.js`: Proxy de `fs` con defensa contra traversal, enlaces simbolicos (`O_NOFOLLOW`) y hardlinks (`nlink > 1`).

2. **Aislamiento Vectorial en Qdrant**:
   * Particion de colecciones por tenant: `davis_memorias_<tenantId>`.
   * El RAG hibrido y la herramienta `buscar_recuerdo_semantico` filtran exclusivamente sobre la coleccion de su tenant.
   * Reindexacion automatica: al invocar `guardar_nota_personal`, se dispara la indexacion incremental en Qdrant acotada a `tenantId`.

3. **Aislamiento en MCP Booking (`booking.db`)**:
   * Columna `tenant_id TEXT NOT NULL DEFAULT 'propietario'` con indice `idx_citas_tenant`.
   * Las herramientas `consultar_disponibilidad`, `reservar_cita`, `cancelar_cita` y `listar_citas` inyectan y filtran por `tenant_id`.
   * Dos o mas tenants pueden agendar citas simultaneas en el mismo horario comercial sin colisiones entre si.
   * Las citas del propietario (`propietario`) permanecen totalmente invisibles e inaccesibles para el resto de tenants.

4. **Clasificacion RBAC de Herramientas**:
   * `src/services/rbacService.js` mantiene la compuerta fail-closed:
     - Herramientas MCP Booking clasificadas en `datos_tenant` (`consultar_disponibilidad`, `reservar_cita`, `cancelar_cita`, `listar_citas`).
     - Herramientas MCP DevOps clasificadas en `host` (`ejecutar_comando_bash`, `consultar_estado_servidor`, `inspeccionar_docker`, `verificar_almacenamiento`, `comprobar_certificados_ssl`), restringidas al propietario.
     - Ningun tenant no propietario puede invocar herramientas fuera de las clases aptas (`datos_tenant` y `sin_estado`).

---

## 3. Aprovisionamiento y Autoservicio de Cuentas (Tarea 2.5)

El alta de cuentas y aprovisionamiento se gestiona a traves del servicio central `src/services/tenantProvisioningService.js`:

1. **Aprovisionamiento Atomico (`provisionarTenant`)**:
   * Registro del tenant en la base de datos SQLite (`tenants`).
   * Creacion automatica de la estructura fisica de carpetas (`notes/`, `diario/`, etc.).
   * Generacion de la nota de bienvenida `notes/bienvenida.md`.
   * Creacion e indexacion inicial de la coleccion en Qdrant (`davis_memorias_<tenantId>`).
   * Asignacion de cuota y plan en `tenant_limites`.
   * Configuracion de lista blanca segura de herramientas RBAC.
   * Vinculacion de identidad de canal canonica (WhatsApp: `<telefono>@s.whatsapp.net`).

2. **Onboarding por Autoservicio en WhatsApp**:
   * En `whatsappBot.js`, mensajes de numeros no registrados que inicien con:
     - `/registro <Nombre del Negocio>`
     - `/alta <Nombre del Negocio>`
     - `/crearcuenta <Nombre del Negocio>`
   * Genera el slug identificador (`tenant_<nombre>_<ultimos_4_digitos>`), aprovisiona la cuenta con plan `demo`, indexa su Second Brain y devuelve mensaje de bienvenida guiado.

3. **API REST de Gestion de Tenants**:
   * Endpoints `POST /api/tenants` y `POST /api/v1/tenants/register`.
   * Permite aprovisionar tenants indicando `id`, `nombre`, `plan` (`demo`, `cliente`, `staff`), `canal`, `identificador` y `herramientas` opcionales.

---

## 4. Pruebas y Verificacion

- `tests/sector3/tenant_provisioning_and_isolation.test.js`: Validacion E2E del aprovisionamiento, resolucion de identidades, aislamiento de notas entre tenants y verificacion de permisos RBAC.
- `tests/sector3/mcp_server_booking_multitenant.test.js`: Validacion de citas paralelas sin colision entre tenants y aislamiento estricto de filtros en `booking.db`.
- `tests/sector3/tenancy_planes_cuotas.test.js`: Verificacion de limites de cuota (tokens diarios y RPM por minuto).
- `tests/sector3/tenancy_catalogo_e2e.test.js` y `tests/sector3/tenancy_semantica_grafo.test.js`: Verificacion de que ninguna herramienta no apta se filtra y que no existe fuga de datos entre A, B y propietario.
