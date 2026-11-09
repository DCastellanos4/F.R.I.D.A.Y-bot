# Limitaciones conocidas

Lista honesta de lo que no esta activo, lo que depende de configuracion y
las brechas declaradas en la revision actual.

## Piezas presentes pero sin camino activo

- `visionService` y `pdfReaderService`: sin llamantes de produccion (el
  lector de tickets activo es `ticketVisionAdapter`, que es config-required
  y va por el proveedor configurado).
- `githubAgentService` (agente autonomo de ramas/commits/PRs): existe como
  servicio y el especialista coder lo menciona en su prompt, pero sus
  herramientas (`crear_rama_trabajo`, `crear_commit`, `abrir_pull_request`,
  `empujar_rama`, `ejecutar_tarea_programacion`) no estan ofrecidas en el
  catalogo real del agente, asi que no se ejecutan.
- `calendarService`: solo lo usa el briefing diario para leer eventos. La
  escritura/sincronizacion bidireccional con Google Calendar no esta
  cableada como herramienta del agente.

## Dependientes de configuracion (config-required)

Lectura de tickets por foto, EMT Madrid, radar de InfoJobs, Google
Calendar, Home Assistant, qBittorrent, Wake-on-LAN, estimacion de factura
Oracle, subida de backups a Object Storage, fuente en vivo de precios de
viajes. Cada pieza declara la carencia cuando falta su credencial y nunca
simula la funcion; el estado concreto en cada despliegue depende de esas
variables de entorno.

## Limites de fuentes de datos

- Cercanias Renfe: solo informa servicios con actualizacion en vivo del
  feed; un servicio sin incidencia puede no aparecer y el bot lo declara.
- Metro de Madrid: sin fuente publica verificada; no se ofrece.
- Productos: el comparador no trae fecha de refresco por oferta y el stock
  es el del feed; la verificacion en la pagina del vendedor es el paso que
  confirma.
- Grupos de WhatsApp: resumenes y estadisticas cubren solo los mensajes que
  el bot ha procesado, no el historial completo del grupo.
- Aviso de llegada: depende de que WhatsApp entregue ubicaciones en el
  chat; el bot no tiene GPS propio.

## Limites operativos

- Un mensaje programado cuyo acuse nunca llega se marca "incierto" y no se
  reenvia solo (reenviar podria duplicar un mensaje que si llego).
- El backup manual no garantiza consistencia con escritores concurrentes;
  el snapshot consistente es el de despliegue, con procesos parados.
- Observabilidad (OpenTelemetry/Prometheus/Grafana): opcional y apagada
  por defecto en el codigo; su activacion es por entorno
  (ver [observabilidad.md](observabilidad.md)).
- Presupuesto Groq: preventivo por proceso, no garantia de cuota; las
  cabeceras del proveedor mandan.

## Multiusuario (tenancy)

- Compuertas cerradas: `AISLAMIENTO_COMPLETO = false` (constante de codigo)
  y `DAVIS_TENANTS_ENABLED` sin definir. Ningun usuario ajeno al
  propietario puede usar el bot; el carril existe pero esta desactivado.
- Sin altas, canales, monitores ni envios multiusuario; las cuotas por
  tenant son configurables pero sin cifras definidas y son control post-uso
  (una peticion en vuelo puede rebasar la cuota antes de registrarse).
- Brecha tecnica declarada: la defensa de filesystem de tenants no es
  containment atomico de ancestros (TOCTOU ante un proceso hostil con el
  mismo UID); por eso no se da acceso al filesystem a tenants.
- Estado completo y evidencias en [tenancy.md](tenancy.md) y
  [tenancy-auditoria-minima-local.md](tenancy-auditoria-minima-local.md).
