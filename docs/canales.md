# Canales

## WhatsApp (`whatsappBot.js`)

El canal principal. Usa Baileys (la libreria no oficial de WhatsApp Web):
la sesion vive en `auth_info_baileys/` (estado compartido del despliegue) y
el emparejamiento inicial se hace por QR en logs.

### Control de acceso

- Solo responde al propietario: allowlist por telefono
  (`AUTHORIZED_USER_PHONE`), numero del bot (`BOT_PHONE`) y LID
  (`AUTHORIZED_USER_LID`), con mapeo inverso de Baileys entre telefono y
  LID.
- Los mensajes de terceros no llegan al modelo: con el modo VIP activo solo
  escalan los contactos VIP o lo clasificado como urgente; el resto queda
  en el buzon de rele.
- En grupos el bot no conversa en absoluto: solo acumula lo que ve
  para `resumir_grupo` y `estadisticas_grupo`.

### Flujos fuera del modelo

Estos flujos los ejecuta el canal directamente, sin pasar por el LLM:

- OTP de la consola bash (ver [Seguridad](seguridad.md)).
- "confirmar borrado \<id\>" para el borrado masivo del segundo cerebro.
- "aprobar skill \<nombre\>" / "rechazar skill \<nombre\>".
- "si" de confirmacion de acciones criticas dictadas por voz.

### Media y formatos

- Notas de voz: transcripcion whisper local y entrada como texto; deteccion
  de urgencia.
- Imagenes: lectura de tickets si el adaptador de vision esta configurado
  (si no, se declara y se ofrece la via de texto).
- Documentos y multimedia: descarga con yt-dlp bajo demanda.
- Encuestas nativas, vCards, mensajes efimeros y respuestas con nota de voz
  (PTT).
- Normalizacion de formato: el markdown `**doble**` del modelo se convierte
  al `*simple*` que WhatsApp interpreta como negrita.

### Cola de alertas

El proceso drena `alerts_queue.json` hacia el chat del propietario
(recordatorios, monitores, briefing, snoozes...). Con el modo nocturno
activo, las alertas no urgentes esperan al final de la franja. Los mensajes
programados llevan acuse de recibo y nunca se reenvian solos.

## API REST (`api.js`)

Servidor HTTP auxiliar (proceso `jarvis-api`). Sin `API_TOKEN` configurado
responde 503 en todo: la API esta deshabilitada de fabrica (fail-closed).

| Endpoint | Metodo | Papel |
| --- | --- | --- |
| `/metrics` | GET | Metricas Prometheus; solo localhost. |
| `/api/webhook/github` | POST | Webhook de GitHub con verificacion HMAC-SHA256 timing-safe; los fallos de workflow se encolan como alerta. |
| `/api/chat` | POST | Entrada conversacional alternativa al chat. |
| `/api/clima` | GET | Clima por lugar y momento. |
| `/api/memorias` | GET | Consulta del segundo cerebro. |
| `/api/sniper` | GET | Estado de productos vigilados. |
| `/api/recordatorios` | GET | Recordatorios. |
| `/api/resumir` | POST | Resumen de URL. |
| `/api/salud` | GET | Salud del servicio. |
| `/api/briefing` | GET | Ultimo briefing diario. |

## Carril multiusuario (preparado, cerrado)

Existe un puente de tenants para chats directos de WhatsApp
(`src/composition/whatsappTenantBridge.js`) con identidad exacta verificada
desde el evento del socket, RBAC y cuotas. Ambas compuertas estan cerradas
(`AISLAMIENTO_COMPLETO = false` en codigo y `DAVIS_TENANTS_ENABLED` sin
definir), asi que ningun mensaje externo lo usa hoy. Detalle y limites en
[tenancy.md](tenancy.md) y [tenancy-auditoria-minima-local.md](tenancy-auditoria-minima-local.md).
