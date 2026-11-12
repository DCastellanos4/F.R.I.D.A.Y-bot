# ERS: Arquitectura MCP Modular y Enrutamiento Dinamico de Herramientas

Estado: Especificacion Tecnica Formal (Borrador de Arquitectura)  
Ambito: Desacoplamiento del Monolito de Herramientas y Modularizacion Multi-Tenant  
Politica de estilo: Cero emojis, castellano tecnico, contratos verificables  

---

## 1. Proposito y Contexto

D.A.V.I.S. cuenta actualmente con 140 herramientas declaradas de forma monolitica en `src/core/tools.js` e integradas en `src/core/jarvisAgent.js`. Aunque existe un podador de intenciones (`src/services/specialistRouterService.js`), el catalogo completo excede el limite duro de 128 herramientas impuesto por APIs de proveedores en la nube (como OpenAI o Groq). Cuando el clasificador duda o se activa la red de seguridad, el catalogo se trunca de manera forzada.

Asimismo, la meta de comercializar D.A.V.I.S. para verticales de negocio (por ejemplo, gestion de reservas y citas en comercios locales, monitorizacion de servidores DevOps o extraccion contable de facturas) exige que un cliente particular o comercio jamas cargue herramientas innecesarias de otros sectores.

Este documento formaliza la Especificacion de Requisitos del Sistema (ERS) para migrar el catalogo de herramientas hacia una arquitectura basada en **Model Context Protocol (MCP)**, combinada con **Carga Dinamica Semantica (Dynamic Tool Selection)** y perfiles aislados por tenant.

---

## 2. Diagrama de Arquitectura Objetivo

```
                                +-----------------------------+
                                |  Canales de Ingestion       |
                                |  (WhatsApp / REST API / CI) |
                                +--------------+--------------+
                                               |
                                               v
                                +-----------------------------+
                                |  Orquestador Central        |
                                |  (jarvisAgent.js)           |
                                +--------------+--------------+
                                               |
                     +-------------------------+-------------------------+
                     |                                                   |
                     v                                                   v
        +-------------------------+                         +-------------------------+
        | Perfil de Tenant        |                         | Router Semantico Tools  |
        | (Filtro duro de ambito) |                         | (RAG de herramientas)   |
        +------------+------------+                         +------------+------------+
                     |                                                   |
                     +-------------------------+-------------------------+
                                               |
                                               v
                                +-----------------------------+
                                |  McpClientAdapter           |
                                |  (Pool de Clientes MCP)     |
                                +--------------+--------------+
                                               | (JSON-RPC stdio / SSE)
        +----------------------+---------------+----------------------+----------------------+
        |                      |                                      |                      |
        v                      v                                      v                      v
+---------------+      +---------------+                      +---------------+      +---------------+
|  mcp-server-  |      |  mcp-server-  |                      |  mcp-server-  |      |  mcp-server-  |
|    booking    |      |    devops     |                      |    finance    |      |   lifestyle   |
| (Citas/Slots) |      | (Docker/Bash) |                      | (Tickets/OCR) |      | (Habitos/Rutas|
+---------------+      +---------------+                      +---------------+      +---------------+
```

---

## 3. Requisitos Funcionales (RF)

### RF-MCP-01: Micro-servidores MCP Aislados por Dominio
El monolito de herramientas se fragmentara en micro-servidores MCP independientes, ejecutados en procesos secundarios aislados comunicados mediante `stdio` o `HTTP/SSE`:

1. **`mcp-server-booking` (Comercios Locales y Citas)**:
   - `consultar_disponibilidad`: calculador determinista de slots libres en SQLite sin colisiones.
   - `reservar_cita`: reserva transaccional con duracion de servicio, nombre de cliente y telefono.
   - `cancelar_cita`: anulacion y liberacion de hueco en calendario.
   - `sincronizar_google_calendar`: sincronizacion bidireccional mediante OAuth2.
2. **`mcp-server-devops` (SysAdmin y Servidores)**:
   - `ejecutar_comando_bash`: ejecucion controlada con interceptor 2FA OTP (120s TTL).
   - `controlar_docker`: inspeccion y auto-reinicio con circuit breaker.
   - `verificar_almacenamiento`: purga automatica al 85% de disco.
   - `inspeccionar_fail2ban`: deteccion y baneo de IPs atacantes.
   - `comprobar_certificados_ssl`: alerta proactiva de expiracion TLS.
3. **`mcp-server-finance` (Facturas, Tickets y Gastos)**:
   - `extraer_ticket_vision`: OCR estructurado de tickets y facturas (CIF, base, IVA, total).
   - `registrar_gasto`: persistencia contable en SQLite o Google Sheets.
   - `exportar_resumen_trimestral`: calculo de IVA soportado y categorias.
4. **`mcp-server-media` (Contenido y Voz)**:
   - `descargar_multimedia`: extractor yt-dlp con escalera de compresion FFmpeg acotada a 16MB.
   - `transcribir_audio`: ejecucion local de whisper.cpp CLI.
   - `sintetizar_voz`: generacion Edge-TTS en formato OGG Opus.
5. **`mcp-server-lifestyle` (Asistente Personal)**:
   - Habitos, menus semanales, listas de compra, horarios Renfe GTFS en vivo y radar de vuelos.

### RF-MCP-02: Adaptador Cliente MCP en D.A.V.I.S. (`McpClientAdapter`)
- Debe implementar el estandar JSON-RPC 2.0 segun la especificacion formal de MCP.
- Debe soportar inicio bajo demanda (*lazy spawn*) y reutilizacion de procesos persistentes (*warm pool*).
- Debe mapear de forma transparente las herramientas devueltas por `tools/list` al formato nativo `tools: [{ type: "function", function: ... }]` consumido por el LLM.
- Timeout estricto por llamada: maximo 15 segundos por invocacion de herramienta; ante expiracion, interrumpe el subproceso (*SIGKILL*) y responde con error tipado fail-closed (`MCP_TIMEOUT_EXPIRED`).

### RF-MCP-03: Enrutamiento Dinamico y Acotamiento de Esquemas (Tool RAG)
Para garantizar que el modelo nunca reciba mas de 128 herramientas:
- **Fase 1 (Filtrado por Tenant/Ambito)**:
  - Si el emisor es un cliente de comercio local (ej. peluqueria), D.A.V.I.S. solo conecta `mcp-server-booking`.
  - Si el emisor es el administrador tecnico, se anade `mcp-server-devops`.
- **Fase 2 (Busqueda Semantica Top-K)**:
  - En peticiones abiertas del propietario donde multiples dominios estan habilitados, un indice FTS5/vectorial indexa los esquemas de herramientas (`nombre`, `descripcion`, `parametros_clave`).
  - El sistema selecciona un maximo de **K = 6 a 8 herramientas mas relevantes** para inyectar en la llamada actual del LLM.
  - **Garantia formal**: ninguna invocacion a la API de inferencia superara las 12 herramientas activas en el payload.

### RF-MCP-04: Mantenimiento de Politicas de Seguridad y Guardarrailes
- La migracion a MCP no debilita las guardias existentes:
  - Comandos destructivos en `mcp-server-devops` siguen requiriendo token OTP de 6 digitos verificado en memoria de D.A.V.I.S. antes de emitir la orden `tools/call`.
  - Anonimizacion PII (RNF-04): ningun texto no anonimizado sale hacia modelos externos en la seleccion de herramientas.
  - Trazabilidad y auditoria: cada invocacion a un servidor MCP registra emisor, servidor destino, metodo y hash de parametros en `data/audit_mcp.jsonl`.

---

## 4. Requisitos No Funcionales (RNF)

- **RNF-MCP-01 (Latencia IPC)**: El retardo introducido por la comunicacion JSON-RPC sobre stdio no debe exceder 15 milisegundos por transaccion de herramienta.
- **RNF-MCP-02 (Aislamiento de Fallos)**: El colapso, excepcion no capturada o fallo de memoria en un servidor MCP secundario jamas debe detener el proceso central de D.A.V.I.S. (`whatsappBot.js` o `api.js`). El error debe aislarse y notificarse al usuario como fallo de servicio externo.
- **RNF-MCP-03 (Consumo de Memoria en VPS)**: Cada micro-servidor MCP en Node.js o Python debe limitar su espacio de trabajo (*heap*) a un maximo de 128 MB de RAM.
- **RNF-MCP-04 (Compatibilidad Regresiva)**: El sistema debe poder operar en modo hibrido mediante una variable de entorno (`DAVIS_MCP_ENABLED=1`). En su defecto (`0`), D.A.V.I.S. conserva el catalogo monolitico local.

---

## 5. Guia Paso a Paso de Implementacion Adaptada a D.A.V.I.S.

### Paso 1: Definicion del Puerto Hexagonal y Estructuras de Datos
Crear el puerto de conexion en `src/ports/outbound/McpClientPort.js`:
```javascript
export class McpClientPort {
  async conectarServidor(identificador, configuracionTransporte) { throw new Error('NO_IMPLEMENTADO'); }
  async listarHerramientas(servidorId) { throw new Error('NO_IMPLEMENTADO'); }
  async ejecutarHerramienta(servidorId, nombreHerramienta, argumentos) { throw new Error('NO_IMPLEMENTADO'); }
  async desconectarTodo() { throw new Error('NO_IMPLEMENTADO'); }
}
```

### Paso 2: Implementacion del Adaptador Stdio MCP
Crear `src/adapters/outbound/mcp/stdioMcpClientAdapter.js`:
- Usa el SDK oficial `@modelcontextprotocol/sdk` (o un cliente ligero JSON-RPC 2.0 sobre `child_process.spawn`).
- Control de ciclo de vida del subproceso con cierre seguro (*graceful shutdown*) al terminar D.A.V.I.S.
- Interceptor de stdout/stderr para evitar contaminacion de logs con datos sensibles.

### Paso 3: Modularizacion del Primer Servidor (`mcp-server-booking`)
Crear el paquete autonomo en `deploy/mcp/servers/booking/`:
- Dependencias minimas: `better-sqlite3` y `@modelcontextprotocol/sdk`.
- Esquema de base de datos de citas con indices unicos para evitar overbooking:
  ```sql
  CREATE TABLE IF NOT EXISTS appointments (
    id TEXT PRIMARY KEY,
    service_id TEXT NOT NULL,
    customer_phone TEXT NOT NULL,
    customer_name TEXT NOT NULL,
    start_time TEXT NOT NULL UNIQUE,
    end_time TEXT NOT NULL,
    status TEXT CHECK(status IN ('confirmed', 'cancelled')) NOT NULL DEFAULT 'confirmed',
    created_at TEXT NOT NULL
  );
  ```
- Servidor expone exactamente las herramientas `consultar_disponibilidad`, `reservar_cita` y `cancelar_cita`.

### Paso 4: Conexion con el Router de Especialistas y Seleccion Dinamica
Modificar `src/services/specialistRouterService.js`:
- Asociar categorias de intencion con servidores MCP especificos:
  - Intencion `agenda` o `citas` -> activa `mcp-server-booking`.
  - Intencion `sistema` o `devops` -> activa `mcp-server-devops`.
  - Intencion `finanzas` o `tickets` -> activa `mcp-server-finance`.
- Sustituir la reduccion estatica de arrays en `tools.js` por una consulta al pool de servidores MCP activos para el canal o usuario.

### Paso 5: Suite de Pruebas Automatizadas
Crear bateria de pruebas unitarias en `tests/sector3/mcp_modular_suite.test.js`:
1. Prueba de arranque y handshake JSON-RPC de servidores MCP.
2. Prueba de aislamiento: servidor que lanza un error 500 o crashea no detiene el agente.
3. Prueba de limite estricto: asegurar que el payload hacia el LLM nunca sobrepasa 12 herramientas activas.
4. Prueba de transaccionalidad de reservas concurrentes (prevencion de citas solapadas).
5. Verificacion estricta de cero emojis en codigo, contratos y salidas de prueba.

### Paso 6: Despliegue y Activacion Controlada
- Incorporar la gestion de procesos MCP en `ecosystem.config.cjs` o delegar su arranque automatico como hijos en `stdio`.
- Activar mediante `DAVIS_MCP_ENABLED=1` en el entorno del VPS Oracle.
- Monitorizar telemetria en Prometheus/Grafana midiendo latencias de llamada (`mcp_tool_execution_duration_seconds`).

---

## 6. Criterios de Aceptacion y Verificacion

1. **Cumplimiento de Limite de Proveedor**: El catalogo inyectado en cualquier llamada a LLM jamas supera 16 herramientas (lejos del limite de 128).
2. **Latencia Neta**: El tiempo total de resolucion de herramientas no aumenta mas de 25 ms respecto a la ejecucion monolytica local.
3. **Multi-Tenant Real**: Un cliente configurado como comercio local solo tiene acceso a sus herramientas de citas y catalogo propio; las herramientas administrativas de sistema ni se cargan en memoria ni existen en el esquema del LLM.
4. **Puerta CI/CD**: 100% de la suite de pruebas pasando, 0 advertencias de desbordamiento de catalogo y 0 emojis.

---

## 7. Estado Real de la Implementacion (Fase 1 y Fase 2 Ejecutadas)

Con fecha 2026-11-12, la infraestructura central MCP y los dos primeros micro-servidores estan completados, probados e integrados en `main`:

1. **Infraestructura Core MCP (`src/adapters/outbound/mcp/`)**:
   - `src/ports/outbound/McpClientPort.js`: Contrato formal de puerto hexagonal (`toolsList`, `callTool`, `close`) con funcion de asercion `afirmarMcpClientPort`.
   - `src/adapters/outbound/mcp/mcpClientAdapter.js`: Adaptador cliente sobre `stdio` mediante subprocesos, protocolo JSON-RPC 2.0 (handshake `initialize` y `notifications/initialized`), mapeo automatico a esquemas OpenAI/Groq `{ type: 'function', function: { name, description, parameters } }`, timeout estricto de 15 segundos con error fail-closed (`MCP_TIMEOUT_EXPIRED`), y apagado controlado con SIGTERM y SIGKILL.
   - `src/adapters/outbound/mcp/mcpRegistry.js`: Registro de dominios y agregador de herramientas; enruta transparentemente las llamadas al micro-servidor MCP correspondiente y aisla fallos con `MCP_TOOL_NOT_FOUND`.

2. **Micro-servidor 1: `mcp-server-booking` (`mcp-servers/booking/`)**:
   - Servidor ejecutable autonomo sobre `stdio` (`mcp-servers/booking/index.js`).
   - Persistencia SQLite transaccional (`mcp-servers/booking/db.js`) con soporte dual de drivers (`better-sqlite3` y fallback a `node:sqlite`).
   - Calculo matematico de huecos libres sin colision en horario comercial (09:00 - 20:00).
   - Herramientas: `consultar_disponibilidad`, `reservar_cita`, `cancelar_cita`, `listar_citas`.

3. **Micro-servidor 2: `mcp-server-devops` (`mcp-servers/devops/`)**:
   - Servidor ejecutable autonomo sobre `stdio` (`mcp-servers/devops/index.js`).
   - Herramientas: `ejecutar_comando_bash`, `consultar_estado_servidor`, `inspeccionar_docker`, `verificar_almacenamiento`, `comprobar_certificados_ssl`.

4. **Bateria de Pruebas Automatizadas (36 tests passing en Node.js Windows y Linux VPS)**:
   - `tests/sector3/mcp_client_adapter.test.js`: 11 tests de protocolo, timeouts, errores y ciclo de vida de procesos.
   - `tests/sector3/mcp_server_booking.test.js`: 2 tests directos de motor SQLite y protocolo stdio con subprocesos.
   - `tests/sector3/mcp_server_devops.test.js`: 22 tests unitarios e integracion con telemetria del sistema operativo.
   - `tests/sector3/mcp_e2e_integration.test.js`: Prueba E2E que orquesta en vivo ambos micro-servidores hijos simultaneamente a traves de `McpRegistry`.
