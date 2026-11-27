# Guia de Tokens, Credenciales y Configuracion por Tenant

Guia practica para obtener, configurar y verificar los tokens, claves de API y accesos necesarios para operar D.A.V.I.S. tanto a nivel de servidor/propietario como en modo multi-tenant (`DAVIS_TENANTS_ENABLED=1`).

---

## 1. Modelo de accesos: servidor/propietario vs tenant

En D.A.V.I.S. existe una separacion estricta entre las credenciales de infraestructura (configuradas en el entorno del proceso) y los datos aislados por `tenant_id`.

### 1.1 Que se configura a nivel de servidor / propietario (`.env`)

Las credenciales externas y secretos criptograficos se leen exclusivamente desde variables de entorno (`process.env`, cargadas desde `DAVIS_ENV_FILE`, `<DATA_DIR>/.env` o `<repo>/.env`):

- **Identidad del propietario**: `AUTHORIZED_USER_PHONE`, `BOT_PHONE`, `AUTHORIZED_USER_LID`. Resuelven al tenant `propietario` mediante `esPropietario()` en `src/core/tenancy.js`.
- **Proveedores LLM, Embeddings y Voz**: `GROQ_API_KEY`, `OPENAI_API_KEY`, `OLLAMA_HOST`, `OLLAMA_MODEL`, `DAVIS_EMBEDDING_MODEL`, `QDRANT_URL`, `DAVIS_QDRANT_API_KEY`, `WHISPER_BIN`, `WHISPER_MODEL`.
- **Seguridad y API REST**: `API_TOKEN`, `MEMORY_ENCRYPTION_KEY`, `BACKUP_PASSPHRASE`, `DAVIS_BACKUP_KEY`.
- **Integraciones personales del propietario**: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`, `DAVIS_GITHUB_TOKEN` / `GITHUB_TOKEN`, `GITHUB_WEBHOOK_SECRET`, `DAVIS_EMT_CLIENT_ID`, `DAVIS_EMT_PASS_KEY`, `DAVIS_HA_URL`, `DAVIS_HA_TOKEN`, `DAVIS_WOL_MAC`, `DAVIS_QBIT_URL`.

Regla de seguridad: ninguna credencial se solicita ni se recibe por chat; si falta una variable, el servicio responde con estado `configRequired` indicando que debe definirse en el entorno.

### 1.2 Que se aisla por `tenant_id`

Cuando `AISLAMIENTO_COMPLETO === true` (constante en `src/core/tenancy.js`) y `DAVIS_TENANTS_ENABLED=1`:

- **Identificacion y alta**: un tenant no propietario tiene un identificador valido (`^[a-z0-9][a-z0-9_-]{0,63}$`, distinto de `propietario`) vinculado a su canal canonico (por ejemplo `<telefono>@s.whatsapp.net`) en SQLite (`tenants`).
- **Almacenamiento en disco**: cada tenant tiene su arbol aislado en `data/tenants/<tenantId>/` (`notes/`, `diario/`, `episodios/`, `indices/`, `trazas/`, `brain_memory.json`, `knowledge_vectors.json`, `knowledge_graph.json`, `calendar_events.json`, `finanzas.json`, etc.), validado en tiempo de ejecucion por `verificarArbolTenant()` contra traversal, symlinks y hardlinks.
- **Memoria vectorial y citas**: coleccion propia en Qdrant (`davis_memorias_<tenantId>`) y filas filtradas por `tenant_id` en `booking.db` (MCP Booking).
- **Planes y cuotas**: `demo` (15.000 tokens/dia, 5 RPM), `cliente` (100.000 tokens/dia, 15 RPM), `staff` (500.000 tokens/dia, 60 RPM) y `propietario` (ilimitado), persistidos en `tenant_limites` y `tenant_uso`.
- **RBAC fail-closed (`src/services/rbacService.js`)**: un tenant no propietario solo puede ejecutar herramientas de su lista blanca incluidas en las clases `datos_tenant` y `sin_estado` (incluyendo las de MCP Booking y vision de tickets). Las herramientas de clases `credenciales` (GitHub), `host` (bash, backups, Home Assistant, Wake-on-LAN, qBittorrent, EMT) y `datos_propietario` (Google Calendar oficial, Gmail) quedan restringidas al `propietario`.

En resumen: los tenants comparten la capa de inferencia LLM, voz local, Qdrant y SQLite del servidor bajo su cuota, pero nunca acceden a los tokens ni datos privados del propietario.

---

## 2. Como obtener credenciales paso a paso

### 2.1 Google OAuth2 (Google Calendar API v3 y Gmail API v1)

Tanto `src/services/calendarService.js` como `src/services/gmailService.js` utilizan el mismo flujo OAuth2 contra `https://oauth2.googleapis.com/token` con `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` y `GOOGLE_REFRESH_TOKEN` (renovacion automatica en memoria con margen de 60 segundos antes de expirar).

#### Paso 1: Proyecto y APIs en Google Cloud Console

1. Entra en Google Cloud Console (`https://console.cloud.google.com/`) y crea un proyecto nuevo (o selecciona uno existente).
2. Ve a **APIs y servicios > Biblioteca** y habilita:
   - **Google Calendar API**
   - **Gmail API**

#### Paso 2: Pantalla de consentimiento OAuth

1. Ve a **APIs y servicios > Pantalla de consentimiento OAuth**.
2. Elige tipo **Externo** (si usas una cuenta `@gmail.com` personal) o **Interno** (Google Workspace).
3. Completa nombre de la aplicacion y correo de asistencia.
4. En **Permisos (Scopes)**, anade exactamente los scopes recomendados en `.env.example`:
   - `https://www.googleapis.com/auth/calendar`
   - `https://www.googleapis.com/auth/gmail.readonly`
   - `https://www.googleapis.com/auth/gmail.compose`
5. Si la app esta en estado **Prueba (Testing)**, ve a **Usuarios de prueba** y anade la cuenta de Google del propietario que autorizara el acceso.

#### Paso 3: Crear credenciales ID de cliente OAuth

1. Ve a **APIs y servicios > Credenciales > Crear credenciales > ID de cliente de OAuth**.
2. Selecciona **Aplicacion web** (si vas a usar OAuth 2.0 Playground) o **Aplicacion de escritorio** (si usaras script local / `curl`).
3. Si eliges **Aplicacion web** para OAuth Playground, anade como URI de redireccionamiento autorizado:
   - `https://developers.google.com/oauthplayground`
4. Guarda los valores generados:
   - `GOOGLE_CLIENT_ID`
   - `GOOGLE_CLIENT_SECRET`

#### Paso 4: Generar `GOOGLE_REFRESH_TOKEN`

**Opcion A: Google OAuth 2.0 Playground**

1. Abre `https://developers.google.com/oauthplayground/`.
2. Pulsa el icono de configuracion (rueda dentada arriba a la derecha), marca **Use your own OAuth credentials** e introduce tu `GOOGLE_CLIENT_ID` y `GOOGLE_CLIENT_SECRET`.
3. En la lista de la izquierda (Step 1), introduce o selecciona los tres scopes:
   - `https://www.googleapis.com/auth/calendar`
   - `https://www.googleapis.com/auth/gmail.readonly`
   - `https://www.googleapis.com/auth/gmail.compose`
4. Pulsa **Authorize APIs**, inicia sesion con la cuenta autorizada y concede los permisos.
5. En Step 2, pulsa **Exchange authorization code for tokens** y copia el valor de `refresh_token` en `GOOGLE_REFRESH_TOKEN`.

**Opcion B: Navegador + `curl` local**

1. Si creaste un cliente con redirect `http://127.0.0.1` (o aplicacion de escritorio), abre esta URL en el navegador sustituyendo `<CLIENT_ID>`:
   ```text
   https://accounts.google.com/o/oauth2/v2/auth?client_id=<CLIENT_ID>&redirect_uri=http://127.0.0.1&response_type=code&scope=https://www.googleapis.com/auth/calendar%20https://www.googleapis.com/auth/gmail.readonly%20https://www.googleapis.com/auth/gmail.compose&access_type=offline&prompt=consent
   ```
2. Tras autorizar, copia el parametro `code` de la URL de redireccion e intercambialo por el `refresh_token`:
   ```bash
   curl -s -X POST https://oauth2.googleapis.com/token \
     -H "Content-Type: application/x-www-form-urlencoded" \
     -d "client_id=<CLIENT_ID>" \
     -d "client_secret=<CLIENT_SECRET>" \
     -d "code=<AUTHORIZATION_CODE>" \
     -d "redirect_uri=http://127.0.0.1" \
     -d "grant_type=authorization_code"
   ```
3. Copia el campo `refresh_token` de la respuesta JSON en `GOOGLE_REFRESH_TOKEN`.

Variables resultantes en `.env`:
```env
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GOOGLE_REFRESH_TOKEN=...
GOOGLE_CALENDAR_ID=primary
```
Opcionalmente, si necesitas tokens directos de respaldo sin OAuth2 automatico, el codigo soporta `GOOGLE_CALENDAR_ACCESS_TOKEN`, `GOOGLE_CALENDAR_API_KEY`, `GOOGLE_GMAIL_ACCESS_TOKEN` y `GMAIL_ACCESS_TOKEN`.

---

### 2.2 LLMs, Embeddings y Voz

- **Groq (`GROQ_API_KEY`)**:
  1. Crea una cuenta en Groq Console (`https://console.groq.com/`) y genera una clave en **API Keys**.
  2. Configura en `.env`:
     ```env
     LLM_PROVIDER=groq
     GROQ_API_KEY=gsk_...
     OPENAI_MODEL=llama-3.3-70b-versatile
     ```
     (Tambien se autodetecta si `OPENAI_API_KEY` empieza por `gsk_`).
- **Ollama local (`OLLAMA_HOST`, `OLLAMA_MODEL`)**:
  1. Instala Ollama en el servidor y asegurate de que escucha en local (`http://127.0.0.1:11434`).
  2. Descarga el modelo de embeddings requerido para Qdrant (`bge-m3`) y el modelo conversacional o de vision si aplica:
     ```bash
     ollama pull bge-m3
     ```
  3. Configura en `.env`:
     ```env
     OLLAMA_HOST=http://127.0.0.1:11434
     OLLAMA_MODEL=jarvis
     DAVIS_EMBEDDING_MODEL=bge-m3
     DAVIS_EMBEDDING_DIMS=1024
     QDRANT_URL=http://127.0.0.1:6333
     ```
  4. Para lectura de tickets por foto (`extraer_ticket_vision`), define `DAVIS_TICKET_VISION_MODEL` (por ejemplo un modelo de vision en Ollama; sin esta variable el lector queda desactivado).
- **Voz (STT y TTS locales)**:
  - **Transcripcion (STT)**: `whisper.cpp` con `WHISPER_BIN`, `WHISPER_MODEL` y `WHISPER_LANG` (no requiere API key externa).
  - **Sintesis (TTS)**: `edge-tts` + `ffmpeg` instalados en el sistema (no requiere variables ni clave).

---

### 2.3 GitHub (`DAVIS_GITHUB_TOKEN` / `GITHUB_TOKEN` y `GITHUB_WEBHOOK_SECRET`)

- **Token de API (`DAVIS_GITHUB_TOKEN` o `GITHUB_TOKEN`)**:
  - Las consultas publicas funcionan sin token (limite 60 peticiones/hora). Para ampliar cuota, leer repositorios privados o abrir Pull Requests (`abrir_pull_request` en `src/services/githubAgentService.js`), hace falta un Personal Access Token.
  - En GitHub: **Settings > Developer settings > Personal access tokens > Fine-grained tokens** (o Tokens classic).
  - Permisos minimos recomendados: `Contents` (Read and write si creara PRs/ramas), `Pull requests` (Read and write), `Metadata` (Read-only).
  - Define `DAVIS_GITHUB_TOKEN=github_pat_...` (o `GITHUB_TOKEN`).
- **Secreto de Webhook (`GITHUB_WEBHOOK_SECRET`)**:
  - Requerido para verificar la firma HMAC de `POST /api/webhook/github`.
  - Genera un secreto aleatorio en consola:
    ```bash
    openssl rand -hex 32
    ```
  - Configura el mismo valor en `.env` (`GITHUB_WEBHOOK_SECRET=...`) y en GitHub dentro de **Repository > Settings > Webhooks > Secret** (Content type `application/json`).

---

### 2.4 Transporte Madrid - EMT (`DAVIS_EMT_CLIENT_ID` y `DAVIS_EMT_PASS_KEY`)

El adaptador `src/services/emtAdapter.js` consulta los tiempos reales de autobus mediante la API de MobilityLabs de EMT Madrid. Sin estas dos variables, el adaptador permanece desactivado.

1. Registrate en el portal de desarrolladores MobilityLabs de EMT Madrid (`https://mobilitylabs.emtmadrid.es/`).
2. Crea una nueva aplicacion en tu panel de usuario.
3. Copia el **X-ClientId** y el **passKey** asignados a la aplicacion.
4. Define en `.env`:
   ```env
   DAVIS_EMT_CLIENT_ID=...
   DAVIS_EMT_PASS_KEY=...
   ```

---

### 2.5 Seguridad, API REST y Cifrado

Todas estas claves se generan localmente con `openssl` y **nunca** deben reutilizarse entre si:

- **`API_TOKEN`**: obligatorio para autenticar peticiones a la API REST (`/api/...`). Sin el, la API rechaza las peticiones.
  ```bash
  openssl rand -hex 32
  ```
- **`MEMORY_ENCRYPTION_KEY`**: clave dedicada para cifrar credenciales guardadas en Second Brain (categoria `"clave"`). Sin ella, `memoryService.js` rechaza guardar credenciales en lugar de escribirlas en texto claro.
  ```bash
  openssl rand -base64 32
  ```
- **`BACKUP_PASSPHRASE` / `DAVIS_BACKUP_KEY`**: passphrase dedicada para copias de seguridad cifradas con AES-256-GCM y scrypt (`trigger_encrypted_backup` usa `BACKUP_PASSPHRASE` / `DAVIS_BACKUP_KEY`; `crear_backup_sesion` en `opsService.js` exige `DAVIS_BACKUP_KEY` de al menos 16 caracteres).
  ```bash
  openssl rand -base64 32
  ```

---

### 2.6 Hogar, Red y Opcionales

Todas se gestionan en `src/services/hogarService.js` y solo estan disponibles para el tenant `propietario`:

- **Home Assistant (`DAVIS_HA_URL` + `DAVIS_HA_TOKEN`)**:
  1. En tu instancia de Home Assistant, haz clic en tu perfil de usuario (abajo a la izquierda) > pestana **Seguridad**.
  2. En **Tokens de acceso de larga duracion**, pulsa **Crear token**, asignale un nombre (p. ej. `DAVIS`) y copia el token generado.
  3. Configura en `.env`:
     ```env
     DAVIS_HA_URL=http://192.168.1.50:8123
     DAVIS_HA_TOKEN=...
     ```
- **Wake-on-LAN (`DAVIS_WOL_MAC`, opcional `DAVIS_WOL_BROADCAST`)**:
  1. Activa Wake-on-LAN en la BIOS/UEFI y en el adaptador de red del PC objetivo.
  2. Obten la direccion MAC del adaptador cableado y configurala en `.env`:
     ```env
     DAVIS_WOL_MAC=AA:BB:CC:DD:EE:FF
     ```
- **qBittorrent Web API (`DAVIS_QBIT_URL`, `DAVIS_QBIT_USER`, `DAVIS_QBIT_PASS`)**:
  1. Activa **Web User Interface (Remote control)** en las preferencias de qBittorrent y define usuario y contrasena.
  2. Configura en `.env`:
     ```env
     DAVIS_QBIT_URL=http://127.0.0.1:8080
     DAVIS_QBIT_USER=admin
     DAVIS_QBIT_PASS=...
     ```

---

## 3. Checklist de verificacion operativa

### 3.1 Verificacion del servidor y del propietario

- [ ] `.env` ubicado en `DAVIS_ENV_FILE`, `<DATA_DIR>/.env` o `<repo>/.env` con `AUTHORIZED_USER_PHONE`, `BOT_PHONE` y `AUTHORIZED_USER_LID`.
- [ ] `API_TOKEN`, `MEMORY_ENCRYPTION_KEY` y `BACKUP_PASSPHRASE` / `DAVIS_BACKUP_KEY` (>= 16 caracteres) generados con `openssl rand` y distintos entre si.
- [ ] Proveedor LLM activo (`GROQ_API_KEY` u `OLLAMA_HOST` + `OLLAMA_MODEL`), `DAVIS_EMBEDDING_MODEL=bge-m3` disponible en Ollama y `QDRANT_URL` accesible.
- [ ] Persistencia y modulos activos: `DAVIS_PERSISTENCE=sqlite`, `DAVIS_MCP_ENABLED=1`, `DAVIS_TENANTS_ENABLED=1`.
- [ ] Si usas Google Calendar/Gmail: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` y `GOOGLE_REFRESH_TOKEN` con los 3 scopes configurados.
- [ ] Si cambiaste variables ya cacheadas en PM2, reinicia actualizando el entorno:
  ```bash
  pm2 restart davis --update-env
  ```

### 3.2 Verificacion por tenant nuevo (`<tenantId>`)

- [ ] Tenant aprovisionado mediante autoservicio en WhatsApp (`/registro <Nombre>`, `/alta <Nombre>`, `/crearcuenta <Nombre>`) o via API REST autenticada (`POST /api/tenants` o `POST /api/v1/tenants/register` con cabecera `Authorization: Bearer <API_TOKEN>`).
- [ ] Registro creado en SQLite (`tenants` y `tenant_limites` con su plan: `demo`, `cliente` o `staff`) y canal vinculado (p. ej. `<telefono>@s.whatsapp.net`).
- [ ] Directorio `data/tenants/<tenantId>/` creado sin enlaces simbolicos ni hardlinks, con subcarpetas `notes/` (incluido `bienvenida.md`), `diario/`, `episodios/`, `indices/`, `trazas/` y `brain_memory.json`.
- [ ] Coleccion vectorial `davis_memorias_<tenantId>` creada en Qdrant.
- [ ] Prueba funcional basica: el tenant puede guardar y buscar una memoria (`guardar_memoria` / `buscar_recuerdo_semantico`) y consultar/reservar citas (`consultar_disponibilidad` / `reservar_cita`) sin ver datos del `propietario`, y recibe denegacion RBAC si intenta invocar herramientas de `host` o `credenciales`.
