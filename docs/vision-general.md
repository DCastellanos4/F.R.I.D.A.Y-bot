# Vision general

D.A.V.I.S. (Digital Autonomous Voice & Intelligence System) es un asistente
personal que opera por WhatsApp para un unico propietario. Corre de forma
continua en un VPS y combina un agente de lenguaje con herramientas,
memoria persistente, monitores proactivos y una API REST auxiliar.

- Paquete: `friday-ai` 2.0.0, Node.js >= 20, modulos ES.
- Canal principal: WhatsApp, mediante la libreria Baileys (sin API oficial).
- Modelo de lenguaje: Groq por defecto (plan gratuito), con soporte para
  Ollama local y cualquier endpoint compatible con OpenAI. Ver
  [Agente y LLM](agente-y-llm.md).
- Persistencia: ficheros JSON en `data/` por defecto, con SQLite embebido
  (better-sqlite3) como alternativa activable. Ver
  [Datos y persistencia](datos.md) y [Persistencia SQLite](persistencia-sqlite.md).

Algunos identificadores internos conservan el nombre historico J.A.R.V.I.S.
(procesos `jarvis-api` y `jarvis-whatsapp`, `jarvisAgent.js`, rutas
`~/jarvis*` en el servidor). Es el mismo proyecto.

## Procesos

Dos procesos gestionados con PM2 (`ecosystem.config.cjs`):

| Proceso | Entrada | Papel |
| --- | --- | --- |
| `jarvis-whatsapp` | `whatsappBot.js` | Bot de WhatsApp: sesion Baileys, agente, monitores y envios. |
| `jarvis-api` | `api.js` | API REST auxiliar, webhook de GitHub y endpoint `/metrics`. |

## Piezas principales

| Capa | Donde | Que hace |
| --- | --- | --- |
| Canal WhatsApp | `whatsappBot.js` | Sesion, allowlist, flujos de confirmacion, audio/media, drenado de alertas. |
| API REST | `api.js` | Endpoints auxiliares con token; fail-closed sin `API_TOKEN`. |
| Core del agente | `src/core/` | Bucle del agente, catalogo de herramientas, contexto selectivo, presupuesto, enrutado. |
| Servicios | `src/services/` | Unas 80 piezas de dominio (memoria, finanzas, transporte, noticias, etc.). |
| Monitores | `src/monitors/` | Vigilancia proactiva del servidor y avisos. |
| Sistema | `src/system/` | Consola bash con OTP, backups cifrados, disco, tuneles. |
| Puertos y adaptadores | `src/ports/`, `src/adapters/`, `src/composition/` | Arquitectura hexagonal: el core no conoce canales ni proveedores concretos. |
| Observabilidad | `src/observability/` | OpenTelemetry y Prometheus, opcionales y apagados por defecto. |

## Principios de diseno

1. Honestidad funcional. Lo que no se puede hacer de verdad se declara y no
   se simula: sin credenciales, sin fuente o sin verificacion, la respuesta
   es "no esta configurado" o "no se puede verificar", nunca un invento.
2. La aprobacion humana vive fuera del modelo. Las acciones destructivas o
   con efectos externos exigen una confirmacion real del propietario por su
   chat (OTP, "confirmar borrado \<id\>", "aprobar skill \<nombre\>"); un
   booleano decidido por el LLM no es aprobacion. Ver [Seguridad](seguridad.md).
3. Fail-closed. Sin token de API la API no abre; sin clave de cifrado no se
   guardan credenciales; sin fuente de datos no se responde con estimaciones.
4. Cero emojis en codigo, comentarios, logs, mensajes y documentacion. La
   suite de pruebas audita todo el arbol.
5. Espanol (Espana) en la conversacion, con zona horaria Europe/Madrid en
   fechas y avisos.
6. Privacidad en registros: ni trazas ni metricas guardan texto de
   mensajes, argumentos de herramientas ni secretos.

## Recorrido de un mensaje

1. Llega un mensaje de WhatsApp (Baileys) y el canal verifica que el
   remitente es el propietario (allowlist de telefono/LID).
2. Se transcribe si es audio, se extrae texto si es media, y se interceptan
   los flujos de confirmacion pendientes (OTP, borrados, skills).
3. El enrutador decide las areas relevantes y acota el catalogo de
   herramientas ofrecidas al modelo (limite de 128 del proveedor).
4. El agente itera: el modelo responde o pide herramientas, las herramientas
   se ejecutan con sus guardas, y el resultado vuelve al modelo.
5. La respuesta pasa los guardarrailes de pre-envio (sin emojis, sintaxis de
   codigo valida, sin afirmaciones de acciones no ejecutadas) y se envia.

Los avisos proactivos (recordatorios, monitores, briefing) viajan por una
cola de alertas que el proceso de WhatsApp drena hacia el chat del
propietario, respetando el modo nocturno si esta activo.
