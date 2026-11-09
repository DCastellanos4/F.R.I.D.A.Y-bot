# Monitores y alertas

Vigilancia proactiva del propio sistema. Toda alerta viaja por
`alertQueueService` (`data/alerts_queue.json`) y la entrega el proceso de
WhatsApp en el chat del propietario, respetando el modo nocturno. Los
monitores miden y avisan; ninguno actua sobre terceros ni toca datos de
usuario. Dos automatismos acotados si actuan sobre el propio sistema: el
auto-reinicio de contenedores (`dockerMonitorService`, con cortacircuitos
anti flapping) y la purga de descargas temporales al superar el umbral de
disco (`diskStorageService`).

## Salud del servidor

- `proactiveAlerts`: estado del VPS (CPU, memoria, disco, alcance de
  puertos) y de servicios registrados como el servidor de Minecraft
  (`MINECRAFT_HOST`/`MINECRAFT_PORT`). Alimenta tambien el briefing diario.
- `processWatchdogService`: procesos registrados por el propietario
  (patron de comando), con limites opcionales de CPU/memoria, aviso una vez
  por transicion y enfriamiento de 30 minutos. La vigilancia proactiva es
  opt-in; nunca reinicia ni mata procesos.
- `diskStorageService`: purga de descargas temporales y aviso al superar el
  umbral de disco (85 % por defecto).

## Infraestructura

- `dockerMonitorService`: contenedores caidos con auto-reinicio acotado por
  un cortacircuitos (ventana deslizante anti flapping) y alerta.
- `fail2banMonitorService`: baneos en `fail2ban.log` y fallos de
  autenticacion SSH en `auth.log`, con deduplicacion de 24 h.
- `networkMonitorService`: picos de trafico leyendo `/proc/net/dev` (umbral
  10 Mbps, enfriamiento de 5 minutos).
- `sslMonitorService`: caducidad de certificados por conexion TLS nativa;
  aviso por debajo de 15 dias.
- `githubWebhookService`: fallos de workflows de GitHub Actions (verificado
  por HMAC) encolados como alerta.
- `tunnelManagerService`: estado y control de tuneles Cloudflare/Tailscale.

## Avisos personales

- `sniperService`: vigilancia de productos registrados (precios).
- `flashcardService`: repaso espaciado que encola las tarjetas que tocan
  (opt-in).
- `specialDatesService`: aviso un dia antes y el mismo dia de fechas
  senaladas (opt-in, una vez por fecha y ano).
- `snoozeService`: un aviso puntual por snooze pedido.
- `arrivalWatchService`: un aviso al entrar en el radio del destino, cuando
  WhatsApp entrega la ubicacion.
- `financeService`: aviso previo a renovaciones de suscripciones y alerta
  de presupuesto (opt-in).
- `jobRadarService`: ofertas nuevas del radar (opt-in).
- `brainDigestService`: digest semanal del segundo cerebro (opt-in).
- `quietHoursService`: modo nocturno que pospone las alertas no urgentes en
  la franja configurada.

## Briefing diario

`dailyBriefing` (cron 06:55 Europe/Madrid): meteorologia, recordatorios del
dia, eventos (Google Calendar si hay clave; si no, el calendario local) y
salud del servidor, en un unico mensaje.
