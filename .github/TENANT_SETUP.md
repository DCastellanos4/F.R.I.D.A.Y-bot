# Guia de Despliegue, Secrets y Configuracion de Tokens por Tenant

Guia practica orientada a despliegue en VPS y configuracion en GitHub para operar D.A.V.I.S. con todas sus integraciones activas y politica de aislamiento multi-tenant (`src/core/tenancy.js`).

Para el detalle completo de cada integracion y comprobaciones de salud, consulta tambien [docs/guia-tokens-tenants.md](../docs/guia-tokens-tenants.md).

---

## 1. Modelo Multi-Tenant y Alcance de Credenciales

En `src/core/tenancy.js` existen dos niveles:
- **Tenant `propietario`:** identidad principal configurada mediante `AUTHORIZED_USER_PHONE` y `AUTHORIZED_USER_LID`. Sus datos residen en `data/` (ruta historica) y `data/jarvis.db` (`DAVIS_SQLITE_PATH`).
- **Tenants adicionales (`data/tenants/<tenant_id>/`):** requieren `DAVIS_TENANTS_ENABLED=1` en el entorno y `AISLAMIENTO_COMPLETO = true` en codigo. Sus memorias, calendario local, grafo, vectores y ficheros personales quedan aislados por `tenant_id` bajo `data/tenants/<tenant_id>/`.
- **Credenciales del servidor:** los tokens de APIs externas (LLM, Google, EMT, GitHub, cifrado, hogar) se cargan desde el fichero de entorno del servidor (`DAVIS_ENV_FILE`, `<DATA_DIR>/.env` o `<repo>/.env`). Por seguridad, nunca deben enviarse ni solicitarse por el chat de WhatsApp.

Si anades o modificas variables en el `.env` de un servidor ya en ejecucion con PM2, recarga el entorno con:

```bash
pm2 restart ecosystem.config.cjs --update-env
```

---

## 2. GitHub Actions Secrets vs `.env` del VPS

El pipeline `.github/workflows/ci-cd.yml` separa estrictamente los secretos de CI/CD de los tokens de ejecucion del bot.

### Secrets y Variables en GitHub (Settings -> Secrets and variables -> Actions)

Solo se necesitan para el job `deploy` (entorno `production` en `.github/workflows/ci-cd.yml`). El job `tests` ejecuta la suite sin requerir claves de produccion:

| Nombre | Tipo en GitHub | Uso en `ci-cd.yml` |
| :--- | :--- | :--- |
| `ORACLE_SSH_PRIVATE_KEY` | Secret | Clave privada SSH en formato PEM para conectar al VPS |
| `ORACLE_SSH_HOST_KEY` | Secret | Clave publica del host (`ssh-keyscan`) para `StrictHostKeyChecking=yes` |
| `ORACLE_SSH_DESTINO` | Variable (`vars`) | Destino SSH en formato `usuario@ip_o_host` |

### Variables y Tokens en el `.env` del VPS

Todas las credenciales de runtime viven exclusivamente en el `.env` del servidor (o en `DAVIS_ENV_FILE`), con permisos restringidos (`chmod 600 .env`). Nunca subas el `.env` al repositorio ni lo guardes en GitHub Secrets si no lo consume un workflow.

---

## 3. Como Obtener los Tokens Principales

### A. Google Calendar y Gmail (`GOOGLE_REFRESH_TOKEN`)

Reutilizado por `src/services/calendarService.js` y `src/services/gmailService.js` para renovar automaticamente el `access_token` sin caducidad horaria.

1. Accede a Google Cloud Console y crea o selecciona un proyecto.
2. En **APIs y servicios -> Biblioteca**, habilita **Google Calendar API** y **Gmail API**.
3. Configura la **Pantalla de consentimiento OAuth** (tipo Externo en modo pruebas si es uso personal, anadiendo tu cuenta en Usuarios de prueba).
4. En **Credenciales -> Crear credenciales -> ID de cliente de OAuth**, elige **Aplicacion web** y anade como URI de redireccion autorizada `https://developers.google.com/oauthplayground` (o tu callback local si usas flujo propio).
5. Copia `GOOGLE_CLIENT_ID` y `GOOGLE_CLIENT_SECRET` al `.env`.
6. Para generar `GOOGLE_REFRESH_TOKEN`:
   - Abre OAuth 2.0 Playground (`https://developers.google.com/oauthplayground`).
   - En el icono de configuracion (arriba a la derecha), marca **Use your own OAuth credentials** e introduce tu `GOOGLE_CLIENT_ID` y `GOOGLE_CLIENT_SECRET`.
   - Selecciona estos scopes recomendados (definidos en `.env.example`):
     - `https://www.googleapis.com/auth/calendar`
     - `https://www.googleapis.com/auth/gmail.readonly`
     - `https://www.googleapis.com/auth/gmail.compose`
   - Pulsa **Authorize APIs**, inicia sesion con la cuenta de Google del entorno/tenant y acepta los permisos.
   - Pulsa **Exchange authorization code for tokens** y copia el valor de `refresh_token` en `GOOGLE_REFRESH_TOKEN`.
7. Opcionalmente, define `GOOGLE_CALENDAR_ID=primary` (o el ID de un calendario especifico). Como fallback sin OAuth2 completo, el sistema acepta `GOOGLE_CALENDAR_ACCESS_TOKEN`, `GOOGLE_GMAIL_ACCESS_TOKEN` o `GMAIL_ACCESS_TOKEN`.

### B. GitHub (`DAVIS_GITHUB_TOKEN` / `GITHUB_TOKEN` y `GITHUB_WEBHOOK_SECRET`)

- **`DAVIS_GITHUB_TOKEN` (o `GITHUB_TOKEN`):** usado por `src/services/githubAgentService.js` y `src/services/devToolsService.js` para crear ramas, commits, Pull Requests y consultar repositorios privados sin el limite de 60 peticiones/hora de la API publica.
  1. En GitHub, ve a **Settings -> Developer settings -> Personal access tokens**.
  2. Crea un **Fine-grained token** (recomendado, limitado a los repositorios concretos con permisos de lectura/escritura en `Contents` y `Pull requests`) o un token clasico con scope `repo`.
  3. Guardalo en `DAVIS_GITHUB_TOKEN` dentro del `.env` del VPS.
- **`GITHUB_WEBHOOK_SECRET`:** usado por `api.js` para validar la firma HMAC de `/api/webhook/github`.
  1. Genera un secreto aleatorio en el servidor:
     ```bash
     openssl rand -hex 32
     ```
  2. Pon el mismo valor en `GITHUB_WEBHOOK_SECRET` del `.env` y en el webhook configurado en tu repositorio de GitHub (**Settings -> Webhooks**).

### C. LLMs y Voz (`GROQ_API_KEY`, `OPENAI_API_KEY`, Ollama)

- **Groq (recomendado por defecto en `.env.example`):**
  1. Crea una clave en la consola de Groq (`console.groq.com`).
  2. Configura en `.env`:
     ```ini
     LLM_PROVIDER=groq
     GROQ_API_KEY=gsk_...
     OPENAI_API_KEY=gsk_...
     OPENAI_BASE_URL=https://api.groq.com/openai/v1
     OPENAI_MODEL=llama-3.3-70b-versatile
     ```
  `GROQ_API_KEY` tambien habilita el fallback de transcripcion de audio (`audioTranscriberService.js`) y vision multimodal (`visionService.js`).
- **Ollama local (sin clave externa):**
  ```ini
  LLM_PROVIDER=ollama
  OLLAMA_HOST=http://127.0.0.1:11434
  OLLAMA_MODEL=jarvis
  ```

### D. Transporte Madrid EMT (`DAVIS_EMT_CLIENT_ID` y `DAVIS_EMT_PASS_KEY`)

1. Registrate en el portal de desarrolladores de la EMT de Madrid (MobilityLabs).
2. Crea una aplicacion para obtener tu `X-ClientId` y `passKey`.
3. Guardalos en `.env` como `DAVIS_EMT_CLIENT_ID` y `DAVIS_EMT_PASS_KEY`.

### E. API REST, Cifrado de Memoria y Backups

Genera claves independientes con `openssl rand -hex 32` en el VPS:
- `API_TOKEN`: obligatorio para autenticar peticiones a la API REST (`api.js`).
- `MEMORY_ENCRYPTION_KEY`: obligatorio para guardar credenciales cifradas en el Second Brain (`memoryService.js`).
- `BACKUP_PASSPHRASE` (y `DAVIS_BACKUP_KEY`, minimo 16 caracteres para backups de sesion en `opsService.js`): cifra los contenedores `.davbak` con AES-256-GCM.

### F. Hogar y Red (Opcional)

- **Home Assistant:** genera un token de acceso de larga duracion en tu perfil de Home Assistant y define `DAVIS_HA_URL` y `DAVIS_HA_TOKEN`.
- **Wake-on-LAN:** activa WoL en la BIOS/red del equipo y define `DAVIS_WOL_MAC` (opcionalmente `DAVIS_WOL_BROADCAST`).
- **qBittorrent WebUI:** activa la interfaz web y define `DAVIS_QBIT_URL`, `DAVIS_QBIT_USER` y `DAVIS_QBIT_PASS`.

---

## 4. Verificacion Rapida

En el VPS, tras configurar `.env` y reiniciar PM2:

```bash
pm2 restart ecosystem.config.cjs --update-env
node tests/run_all.js
```

Para comprobar si falta alguna credencial critica o si hay emojis no permitidos en la documentacion, `node tests/run_all.js` incluye el escaner de cumplimiento cero emojis.
