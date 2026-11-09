# Capacidades

Catalogo funcional de D.A.V.I.S. en la revision actual, agrupado por area.
Salvo marca en contra, cada pieza es una herramienta del agente (el
propietario la pide en lenguaje natural por WhatsApp) y esta operativa sin
configuracion extra. Las marcas:

- **Config-required**: la pieza existe pero queda desactivada hasta definir
  credenciales o ajustes por entorno; el bot lo declara, nunca la simula.
- **Opt-in**: avisos o monitores que solo arrancan con peticion expresa del
  propietario; registrar datos nunca implica suscribirse a avisos.

## Estudio

- Planificador de estudio: `planificar_estudio`, `listar_planes_estudio`,
  `registrar_avance_estudio`, `programar_recordatorios_estudio` (reparto de
  temas hasta el examen; recordatorios solo si se indica hora).
- Flashcards con repeticion espaciada: `crear_flashcard`,
  `repasar_flashcards`, `configurar_repaso_flashcards` (**opt-in**),
  `responder_flashcard`.
- Resumidor de apuntes: `resumir_apuntes` (texto pegado o notas del segundo
  cerebro, citando fuentes).
- Entregas y examenes: `registrar_entrega`, `listar_entregas`,
  `eliminar_entrega`.

## Carrera y practicas

- Radar de ofertas: `escanear_ofertas_empleo`, `configurar_radar_ofertas`
  (**opt-in**). Fuentes: API oficial de InfoJobs (**config-required**:
  `INFOJOBS_CLIENT_ID`/`INFOJOBS_CLIENT_SECRET`) y HTML generico con
  selectores propios. Nunca simula ofertas.
- CRM de candidaturas: `registrar_candidatura`, `listar_candidaturas`,
  `actualizar_candidatura`, con seguimiento via recordatorios.
- Simulacro de entrevistas: `iniciar_simulacro_entrevista` (por texto o
  voz; sin modelo no improvisa).
- Analisis de CV contra oferta: `analizar_cv_oferta` (el CV se pega o se
  busca en las notas).

## Clima, noticias y web

- `consultar_clima`: Open-Meteo, sin clave, con geocodificacion.
- `obtener_noticias_actuales`, `navegar_y_leer_noticia`: fuentes RSS
  curadas por ramas con filtro anti-clickbait; la lectura de articulos usa
  el navegador (Playwright) con guardarrailes.
- `resumir_enlace`: resume webs y videos de YouTube (transcripcion).
- `capturar_pagina`: archiva una pagina como nota del segundo cerebro.

## Segundo cerebro

- Memorias: `guardar_memoria`, `buscar_memoria`, `listar_memorias`,
  `olvidar_memoria`. Categorias y tags con expansion; la categoria `clave`
  se cifra en reposo (AES-256-GCM) y exige `MEMORY_ENCRYPTION_KEY`
  (**fail-closed**). El borrado masivo exige confirmacion humana fuera del
  modelo.
- Notas markdown: `guardar_nota_personal`, `listar_notas_recientes`.
- Busqueda semantica: `buscar_recuerdo_semantico` (indice TF-IDF local con
  ranking opcional por modelo; sin modelo responde por palabras y lo
  declara).
- Digest del cerebro: `generar_digest_cerebro` bajo demanda;
  `configurar_digest_semanal` (**opt-in**).
- Wiki personal: `generar_wiki` (indice navegable de las notas).
- Preguntas sobre documentos: `preguntar_documentos` (cita las notas de las
  que sale cada respuesta).
- Diario: `escribir_diario`, `leer_diario` (una entrada por dia; por voz o
  texto).

## Productos y precios

- Vigilancia de productos (sniper): `vigilar_producto`,
  `listar_productos_vigilados`, `cancelar_vigilancia`.
- Busqueda bajo demanda: `buscar_producto` (PriceRadars, sin alta ni clave;
  filtra accesorios disfrazados y variantes distintas, y declara la
  frescura del feed).
- Verificacion de ofertas: `verificar_oferta` (lee la pagina del vendedor
  con anti-SSRF, vincula producto-oferta por datos estructurados y valida
  moneda; lo ilegible es no-verificable).

## Recordatorios y mensajes

- `crear_recordatorio`, `listar_recordatorios`, `cancelar_recordatorio`.
- `programar_mensaje_whatsapp`, `listar_mensajes_programados`,
  `cancelar_mensaje_programado`: envios programados con acuse de recibo; si
  el acuse no llega se marcan "incierto" y nunca se reintentan solos.
- `programar_snooze`, `listar_snoozes`, `cancelar_snooze`: volver a un chat
  mas tarde (peticion puntual, un solo aviso).
- `registrar_aviso_llegada`, `listar_avisos_llegada`,
  `cancelar_aviso_llegada`: aviso al entrar en el radio de un destino;
  depende de que WhatsApp entregue ubicaciones en el chat (el bot no tiene
  GPS propio).

## Finanzas personales

- `registrar_gasto`, `listar_gastos`, `resumen_gastos_mes` (comparativa
  mensual).
- `registrar_suscripcion`, `listar_suscripciones`,
  `configurar_avisos_suscripciones` (**opt-in**): aviso antes de renovar.
- `configurar_presupuesto`, `estado_presupuestos`: alerta al acercarse al
  limite.
- Lectura de tickets por foto: pipeline en el canal con
  `ticketVisionAdapter` (**config-required**: `DAVIS_TICKET_VISION_MODEL`;
  proveedor opcional `DAVIS_TICKET_VISION_PROVIDER`/`_BASE_URL`, p.ej.
  Ollama local). Sin configurar, el bot lo dice y ofrece la via de texto.

## Comunicacion y WhatsApp

- `activar_modo_vip`, `estado_modo_vip`, `agregar_contacto_vip`: filtro de
  rele; con el modo activo, mensajes ajenos solo escalan si son VIP o
  urgentes.
- `resumir_grupo`: resume lo que el bot ha visto del grupo (no el historial
  completo de WhatsApp).
- `descargar_multimedia`: descarga de YouTube/Instagram con yt-dlp y envio
  (limite inline de 16 MB de WhatsApp).
- `enviar_contacto_vcard`, `crear_encuesta_whatsapp`.
- `activar_traductor`, `desactivar_traductor`: modo traductor por chat.
- `sugerir_respuestas`, `buscar_en_historial`, `estadisticas_grupo`.
- `programar_mensaje_whatsapp` (ver seccion anterior).

## Transporte (Madrid)

- `registrar_parada_favorita`, `listar_paradas_favoritas`,
  `eliminar_parada_favorita`, `proximas_llegadas_transporte`.
- Cercanias Renfe: operativo sin credenciales (GTFS-RT publico; indice de
  estaciones desde el GTFS estatico oficial). Solo informa servicios con
  actualizacion en vivo; lo demas lo declara.
- EMT: **config-required** (`DAVIS_EMT_CLIENT_ID`, `DAVIS_EMT_PASS_KEY`).
- Metro: sin fuente publica verificada; el bot no lo ofrece.
- Sin avisos automaticos de transporte (no hay monitor).

## Viajes

- `vigilar_ruta`, `listar_rutas_vigiladas`, `cancelar_vigilancia_ruta`,
  `registrar_precio_ruta`: seguimiento de rutas con precio objetivo.
- Fuente de precios en vivo: **config-required** (no hay fuente gratuita
  sin alta). Operativo sin ella: registro de rutas y de precios que el
  propietario ve, con comparacion e historial.

## Servidor y operacion del bot

- `consultar_estado_servidor`, `get_infrastructure_status`.
- `execute_bash_command`: consola bash remota con clasificacion de riesgo y
  OTP para comandos criticos. Ver [Seguridad](seguridad.md).
- `manage_tunnel`: tuneles Cloudflare/Tailscale (estado, arranque, parada).
- `trigger_encrypted_backup`, `crear_backup_sesion`,
  `verificar_backup_sesion`: copias cifradas (clave por entorno, nunca por
  chat). La subida a Object Storage es **config-required**.
- `vigilar_proceso`, `listar_procesos_vigilados`, `dejar_vigilar_proceso`,
  `configurar_vigilante_procesos` (**opt-in**): mide y avisa; nunca mata ni
  reinicia.
- `auditar_dependencias` (npm audit bajo demanda, nunca auto-fix),
  `configurar_vigilancia_dependencias` (**opt-in**).
- `informe_metricas`, `configurar_informe_metricas` (**opt-in**).
- `actividad_repos`, `configurar_alertas_repos` (**opt-in**): API publica
  de GitHub; `DAVIS_GITHUB_TOKEN` opcional por entorno.
- `generate_crypto_credential`: generador CSPRNG de contrasenas, PINs y
  tokens, con guardado opcional en memoria cifrada.

## Hogar

- `encender_pc`: Wake-on-LAN (**config-required**: `DAVIS_WOL_MAC`).
- `listar_dispositivos_red`: tabla de vecinos del equipo donde corre el bot
  (declarada como tal); `configurar_vigilancia_red` (**opt-in**).
- `controlar_domotica`: Home Assistant (**config-required**:
  `DAVIS_HA_URL` + `DAVIS_HA_TOKEN`).
- `estado_descargas`: qBittorrent Web API (**config-required**);
  `configurar_aviso_descargas` (**opt-in**).
- `estimar_factura_oracle`: OCI CLI/Cost API (**config-required**).

## Desarrollo

- `revisar_pr`: resena de seguridad y estilo de una PR para el propietario;
  nunca publica comentarios en GitHub.
- `generar_changelog`: redacta la entrada desde `git log`; no toca archivos.
- `guiar_depuracion`: pair programming paso a paso.
- `anotar_idea`, `listar_ideas`, `priorizar_ideas`.
- `proponer_skill`, `listar_skills`, `ejecutar_skill`: procedimientos
  reutilizables con aprobacion humana fuera del modelo (una skill nunca
  concede permisos: cada paso pasa por las mismas guardas).

## Bienestar y ocio

- Contactos: `registrar_contacto`, `buscar_contacto`, `listar_contactos`.
- Fechas senaladas: `registrar_fecha_senalada`, `listar_fechas_senaladas`,
  `eliminar_fecha_senalada`, `configurar_avisos_fechas` (**opt-in**).
- Habitos: `registrar_habito`, `marcar_habito`, `listar_habitos` (rachas;
  sin avisos proactivos).
- Menus: `poner_menu`, `ver_menu`, `sugerir_menu` (la sugerencia nunca se
  persiste sola).
- Compra: `anadir_compra`, `listar_compra`, `tachar_compra`,
  `vaciar_compra`.
- `recomendar_serie_pelicula` (usa los gustos guardados en memoria).
- Quedadas: `crear_quedada`, `listar_quedadas`, `redactar_invitacion`
  (borrador para copiar; el bot nunca envia a terceros).
- `resumen_deportivo` (RSS curado; nunca inventa marcadores).
- `configurar_modo_nocturno`: pospone alertas no urgentes en la franja
  (23:00-08:00 por defecto); los recordatorios puntuales no se tocan.

## Voz

- Notas de voz: transcripcion local con whisper.cpp (binario y modelo en el
  servidor; idioma espanol por defecto).
- Respuestas habladas: sintesis edge-tts y envio como nota de voz (PTT OGG
  Opus via ffmpeg).
- Deteccion de urgencia por texto y cadencia para modular el tono.
- Las acciones criticas dictadas por voz exigen un "si" explicito tras
  repetir lo entendido (confirmacion de 5 minutos, aislada por chat).
