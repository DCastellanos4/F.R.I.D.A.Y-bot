# Integraciones externas

Servicios de terceros que usa el bot, con la credencial que necesitan y su
estado en el despliegue actual. "Operativo" = funciona sin configuracion
adicional. "Config-required" = la pieza existe y lo declara, pero no actua
hasta definir la credencial por entorno (nunca por chat).

## Modelo de lenguaje

| Servicio | Variables | Estado |
| --- | --- | --- |
| Groq | `GROQ_API_KEY` (o `OPENAI_API_KEY` con prefijo `gsk_`) | Operativo; proveedor por defecto (`openai/gpt-oss-120b`, respaldo `openai/gpt-oss-20b`). |
| OpenAI | `OPENAI_API_KEY` | Soportado como alternativa de proveedor. |
| Ollama | `OLLAMA_HOST`, `OLLAMA_MODEL` | Soportado (local o remoto). |
| OpenRouter / DeepSeek | clave o `OPENAI_BASE_URL` correspondiente | Soportado por autodeteccion. |

## Datos y contenido

| Servicio | Variables | Estado |
| --- | --- | --- |
| Open-Meteo | ninguna | Operativo (clima y geocodificacion). |
| Fuentes RSS curadas | ninguna | Operativo (noticias y deportes, con filtro anti-clickbait). |
| youtube-transcript | ninguna | Operativo (resumenes de YouTube). |
| Renfe GTFS-RT + GTFS estatico | ninguna | Operativo para Cercanias (feed publico, CC-BY 4.0). |
| EMT Madrid (MobilityLabs) | `DAVIS_EMT_CLIENT_ID`, `DAVIS_EMT_PASS_KEY` | Config-required; desactivado sin credenciales. |
| Google Calendar | `GOOGLE_CALENDAR_API_KEY`, `GOOGLE_CALENDAR_ID` | Config-required; sin clave se usa el calendario local `calendar_events.json` (solo lo lee el briefing). |
| InfoJobs | `INFOJOBS_CLIENT_ID`, `INFOJOBS_CLIENT_SECRET` | Config-required para el radar de ofertas. |
| PriceRadars | ninguna | Operativo (busqueda de productos; API publica de solo lectura). |
| JSON-LD de comercios | ninguna | Operativo (verificacion de ofertas leyendo la pagina del vendedor con anti-SSRF). |

## Hogar y servidor

| Servicio | Variables | Estado |
| --- | --- | --- |
| Home Assistant | `DAVIS_HA_URL`, `DAVIS_HA_TOKEN` | Config-required (domotica). |
| qBittorrent Web API | `DAVIS_QBIT_URL`, `DAVIS_QBIT_USER`, `DAVIS_QBIT_PASS` | Config-required (panel de descargas). |
| Wake-on-LAN | `DAVIS_WOL_MAC` (opcional `DAVIS_WOL_BROADCAST`) | Config-required. |
| Oracle Cloud (Cost API) | credenciales OCI en el servidor | Config-required (estimacion de factura). |
| GitHub API | `DAVIS_GITHUB_TOKEN` opcional | Operativo para repos publicos (actividad, revision de PRs); el token amplia cuota y repos privados. |
| GitHub webhook | `GITHUB_WEBHOOK_SECRET` | Config-required para las alertas de CI. |

## Procesamiento local

| Pieza | Variables | Estado |
| --- | --- | --- |
| whisper.cpp | `WHISPER_BIN`, `WHISPER_MODEL`, `WHISPER_LANG` | Operativo en el VPS (transcripcion de notas de voz; espanol por defecto). |
| edge-tts + ffmpeg | ninguna | Operativo (respuestas habladas en OGG Opus). |
| yt-dlp + ffmpeg | ninguna | Operativo (descarga de multimedia, limite inline 16 MB). |
| Playwright (Chromium) | ninguna | Operativo para lectura de articulos; degradacion declarada si no esta instalado. |
| Vision de tickets | `DAVIS_TICKET_VISION_MODEL` (opcional `DAVIS_TICKET_VISION_PROVIDER`, `_BASE_URL`, `_TIMEOUT_MS`) | Config-required; soporta modelo local via Ollama con descarga al terminar (keep_alive 0). |

## Variables de plataforma

`AUTHORIZED_USER_PHONE`, `BOT_PHONE`, `AUTHORIZED_USER_LID` (allowlist),
`API_TOKEN` (API REST; sin el, deshabilitada), `BACKUP_PASSPHRASE` /
`DAVIS_BACKUP_KEY` (cifrado de backups), `MEMORY_ENCRYPTION_KEY` (cifrado
de credenciales en memoria), `PORT`, `DEFAULT_CITY`, `DEFAULT_LAT`,
`DEFAULT_LON`, `MINECRAFT_HOST`, `MINECRAFT_PORT`, `DAVIS_ENV_FILE`,
`DAVIS_DATA_DIR`, `DAVIS_HISTORY_DIR`, `DAVIS_PERSISTENCE` (json/sqlite),
`DAVIS_TENANTS_ENABLED` (compuerta multiusuario, sin definir).
