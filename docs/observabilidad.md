# Observabilidad (Mejora 3): OpenTelemetry + Prometheus + Grafana

## Que hace

- **Trazas OTel**: cada mensaje entrante genera un TraceId que atraviesa
  `mensaje_entrante` → `consulta` → `clasificacion` (si aplica) → `llm_call`
  (cada llamada) → `tool` (cada herramienta) → `db_write` (escrituras SQLite
  memoria/finanzas). Export OTLP HTTP a Jaeger local en el VPS.
- **Metricas Prometheus** (prom-client), un listener dedicado **por proceso**
  (el agente vive en `jarvis-whatsapp`; la API es otro proceso):
  - `jarvis_consulta_duracion_segundos` (histograma, label `via`)
  - `jarvis_llm_duracion_segundos` (histograma, labels `modelo`, `resultado`)
  - `jarvis_llm_tokens_total` (contador, labels `modelo`, `tipo`, `sesion`)
  - `jarvis_tool_duracion_segundos` (histograma, labels `herramienta`, `resultado`)
  - `jarvis_tool_errores_total` (contador, labels `herramienta`, `tipo`)
  - La API ademas responde `/metrics` en su puerto normal (3000), solo
    localhost; los listeners dedicados son la via que scrapea Prometheus.
- **Dashboard Grafana** provisionado: P95/P99 de LLM y herramientas,
  errores por minuto, tokens por sesion.

## Topologia (preflight VPS: aarch64, sin Docker previo, firewall restrictivo)

Red bridge DEDICADA con subred fija (172.30.50.0/24). NINGUN servicio usa
host network (con host network todos los listeners del contenedor quedan
expuestos y no hereda la seguridad del port mapping). Los unicos puertos
publicados al host van bindeados a 127.0.0.1; Jaeger tiene listeners
auxiliares (14250/14268/14269/6831/6832) que NO se publican y solo existen
dentro de la red interna. Imagenes multi-arch (arm64 OK).

| Puerto host | Servicio | Publicacion |
| --- | --- | --- |
| 9464 | /metrics jarvis-whatsapp (el agente) | 172.30.50.1 (gateway del bridge) |
| 9465 | /metrics jarvis-api | 172.30.50.1 (gateway del bridge) |
| 4318 | OTLP HTTP (Jaeger) | 127.0.0.1 via port mapping |
| 16686 | Jaeger UI | 127.0.0.1 via port mapping |
| 3001 | Grafana | 127.0.0.1 via port mapping (3000 lo ocupa la API) |
| 9090 | Prometheus | NO publicado al host; solo red interna |

Reconciliacion de conectividad: un listener bindeado a 127.0.0.1 en el
host NO es alcanzable desde un contenedor (el bridge entra por otra
interfaz; `host.docker.internal` resuelve a 172.30.50.1, no a loopback).
Por eso el bot bindea sus listeners de metricas a la IP GATEWAY del bridge
(`DAVIS_METRICS_HOST=172.30.50.1`): alcanzable solo desde la subred
interna y el propio host, NUNCA 0.0.0.0 indiscriminado. El origen del
scrape es una IP de 172.30.50.0/24, autorizada por la whitelist CIDR
estricta `DAVIS_METRICS_REDES_PERMITIDAS=172.30.50.0/24` en
`jarvis-estado/.env`. La auth del API no se debilita: /metrics no pide
token y se protege por origen; el fail-closed 503 del resto del API esta
intacto y la ruta /metrics va antes del gate API_TOKEN, deliberado. La
ruta /metrics del puerto 3000 sigue siendo solo localhost (no la scrapea
Prometheus; la via son los listeners dedicados).
Orden de arranque: primero `docker compose up -d` (crea la red y su
gateway), despues el reinicio pm2; si el bridge no existe al bindear, el
listener falla RUIDOSO (console.error + estado.error) y el bot sigue.

Acceso a UIs por tunel SSH: `ssh -L 3001:127.0.0.1:3001 -L 16686:127.0.0.1:16686 vps`.

## Privacidad (regla dura, con pruebas)

- **Whitelist dura de atributos** de span: solo `canal, sesion, via, modelo,
  herramienta, entidad, operacion, resultado, motivo, ronda, tipo`.
  Cualquier otra clave se DESCARTA: el truncado no sanitiza secretos, la
  whitelist si. Nunca texto de mensajes, argumentos de herramientas,
  contenido de memorias ni secretos.
- **Sesion = hash opaco** (sha256 truncado), nunca telefono ni chatId.
- **Cardinalidad acotada**: la metrica de tokens admite como mucho 100
  sesiones distintas por proceso; el excedente se agrupa en `sesion="otras"`.
  El detalle por sesion siempre disponible en las trazas (atributo `sesion`).
- Labels de error de tools: clase interna del error (tipo/codigo), NO un
  status HTTP inventado; si la herramienta no lo aporta, es `error` generico.
- Retencion: Prometheus 30 dias local en el VPS; Jaeger (badger en memoria
  del contenedor) efimero. Las trazas contienen solo metadatos: no hay texto
  privado que retener. Coste: todo local/OSS, cero servicios de pago.

## Fallo visible, no silencioso

Si `DAVIS_OTEL_ENABLED=true` pero faltan dependencias o el puerto de
metricas esta ocupado, el bot sigue funcionando PERO lo grita:
`console.error` en arranque, `estadoObservabilidad().error` y el endpoint
/metrics responde 503 con la causa. Los flags nunca ocultan un fallo de
algo explicitamente habilitado.

## Activacion (VPS)

1. `npm ci` en la release (deps nuevas: `@opentelemetry/api`,
   `@opentelemetry/sdk-trace-node`, `@opentelemetry/exporter-trace-otlp-http`,
   `prom-client`; todas JS puro, sin nativas, arm64 OK).
2. Stack: `cd deploy/observabilidad && GRAFANA_ADMIN_PASSWORD=<secreto del entorno, nunca en el repo> docker compose up -d`
   (Docker se instala en el VPS via apt `docker.io` + plugin compose;
   alternativa bare metal: apt `prometheus` + repo oficial Grafana +
   binario Jaeger arm64, mismos puertos loopback).
3. Bot en `jarvis-estado/.env` y reinicio pm2 de ambos con `--update-env`:
   - `DAVIS_OTEL_ENABLED=true`
   - `DAVIS_METRICS_HOST=172.30.50.1` (gateway del bridge; def: 127.0.0.1)
   - `DAVIS_METRICS_REDES_PERMITIDAS=172.30.50.0/24`
   - `DAVIS_OTEL_ENDPOINT` (def: `http://127.0.0.1:4318/v1/traces`)
   - `DAVIS_METRICS_PUERTO_WS` (def: 9464) / `DAVIS_METRICS_PUERTO_API` (def: 9465)
   - `DAVIS_METRICS_ENABLED` (def: sigue a `DAVIS_OTEL_ENABLED`)
4. Verificacion post-despliegue (obligatoria antes de cerrar):
   - `curl 172.30.50.1:9464/metrics` y `172.30.50.1:9465/metrics` devuelven
     HELP/TYPE (conectividad disenada, desde el host y desde un contenedor).
   - `curl 127.0.0.1:9464/metrics` NO responde (bind solo al gateway).
   - Desde fuera del VPS, esos puertos NO responden (firewall + loopback).
   - `ss -tlnp` en el VPS: NINGUN listener de Jaeger/Prometheus/Grafana en
     0.0.0.0 (solo 127.0.0.1); comprobar tambien los auxiliares de Jaeger
     (14250/14268/14269/6831/6832 no aparecen fuera del bridge). Los
     listeners del bot en 172.30.50.1, no en 0.0.0.0.
   - Un mensaje real de prueba deja un trace en Jaeger con spans
     `mensaje_entrante → consulta → llm_call → tool → db_write` y un solo
     TraceId.
   - Inspeccion VISUAL del dashboard en Grafana (no basta el JSON valido).

## Verificacion sin red (suite)

`tests/sector3/observabilidad.test.js`: no-op por defecto, jerarquia y
TraceId unico, whitelist que descarta claves ajenas (ni secretos con nombre
de clave plausible), privacidad de atributos con payload realista, metricas
con tokens por sesion y cardinalidad acotada, /metrics 200 localhost /
403 externo / 503 con causa, listener dedicado solo loopback, db_write sin
datos. Suite completa: 1013/0.
