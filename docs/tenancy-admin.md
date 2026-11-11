# Administracion de tenants y activacion (runbook)

Candidato LOCAL (11 noviembre 2026, NO desplegado). Anade
`scripts/tenants-admin.mjs` + `tests/sector3/tenancy_admin_cli.test.js`.
No cambia ningun comportamiento del bot: no toca compuertas, canales,
composicion ni datos. Registrar un tenant NO lo activa: la compuerta de
codigo (`AISLAMIENTO_COMPLETO`) y la de entorno (`DAVIS_TENANTS_ENABLED`)
siguen cerradas hasta una activacion aprobada.

## Por que un CLI y no SQL manual

Las altas, la desvinculacion y la conciliacion son operaciones
administrativas deliberadas. A mano serian SQL directo sin validacion de
catalogo apto, sin transaccion unica y con riesgo de DELETE ciego de
marcadores de medicion. El CLI es la unica via prevista; no existe (ni se
expone) herramienta LLM para estas operaciones.

## Comandos

```
node scripts/tenants-admin.mjs alta --id <tenantId> --nombre <n> --jid <digitos@s.whatsapp.net|digitos@lid>
node scripts/tenants-admin.mjs suspender <tenantId>          # corta la resolucion de identidad en caliente
node scripts/tenants-admin.mjs reactivar <tenantId>
node scripts/tenants-admin.mjs permisos-listar <tenantId>
node scripts/tenants-admin.mjs permisos-establecer <tenantId> --herramientas <h1,h2,...>
node scripts/tenants-admin.mjs cuotas-ver <tenantId>
node scripts/tenants-admin.mjs cuotas-establecer <tenantId> [--tokens-dia N] [--tokens-mes N] [--peticiones-minuto N]
node scripts/tenants-admin.mjs cuotas-quitar <tenantId>
node scripts/tenants-admin.mjs desvincular --jid <jid> --confirmar DESVINCULAR
node scripts/tenants-admin.mjs estado <tenantId>             # tenant, identidades, permisos, cuotas, uso, marcador
node scripts/tenants-admin.mjs conciliar-medicion --tenant <id> --ticket <t> --dia <YYYY-MM-DD> --modelo <m> \
     --entrada N --salida N --evidencia "<referencia a la evidencia del proveedor>" [--cero-verificado]
```

Reglas:
- Cada comando escribe en UNA transaccion (BEGIN IMMEDIATE) o no escribe.
- Ningun comando migra la base por defecto ni la crea si no existe: el
  esquema lo aplica el arranque de la app. `--migrar` aplica las
  migraciones pendientes de forma deliberada (aditivas, seguras entre
  procesos).
- Los comandos de lectura (`estado`, `permisos-listar`, `cuotas-ver`)
  usan una conexion readonly sin PRAGMAs ni migraciones implicitas.
  Esto no garantiza ausencia de efectos sobre -wal/-shm: SQLite puede
  crear o mantener esos ficheros al leer una base WAL. No se ignora el
  WAL ni se usa immutable sobre una base viva. Ante SQLITE_BUSY, la
  lectura falla cerrada sin reintento automatico.
- Una copia para `--db` solo es consistente si procede de una base
  cerrada/con escritores detenidos o de la API de backup de SQLite.
  Un `cp` en caliente de la base WAL no es una copia segura. Leer esa
  copia tampoco garantiza ausencia de bookkeeping WAL/SHM en la copia.
- `--jid` exige el formato exacto (`digitos@s.whatsapp.net` o
  `digitos@lid`): no se infieren equivalencias telefono/LID.
- `alta` falla si la identidad ya esta vinculada: no reasigna en
  silencio; hay que `desvincular` primero, de forma deliberada.
- Permisos: solo herramientas de clases aptas (`datos_tenant`,
  `sin_estado`); desconocida o no apta = rechazo. Whitelist vacia = todo
  denegado.
- Cuotas: sin valores por defecto; 0 no es valido; enteros solo en
  digitos (se rechazan flags sin valor, vacios, notacion cientifica o
  hex) y los flags de texto sin valor se rechazan (no valen como
  booleano); el propietario no admite limites. `cuotas-establecer`
  CONSERVA las cuotas no mencionadas y hace lectura+escritura en un
  BEGIN IMMEDIATE (dos administradores concurrentes no pierden
  actualizaciones); `cuotas-quitar` elimina la fila completa.
  Con cuota de tokens, cada llamada queda serializada por el marcador de
  medicion pendiente.
- Ningun comando mutante aplica al propietario.
- La composicion relee rol/permisos/estado antes de cada efecto, asi que
  altas, suspensiones y revocaciones aplican en caliente, sin reinicio.

## Conciliacion de medicion pendiente

Implementa el protocolo ya documentado en `tenancy.md`:
- Exige `--ticket` exacto del marcador y `--evidencia` del operador
  (referencia a la evidencia verificable del proveedor; nunca prompts ni
  secretos). Sin evidencia no hay desbloqueo: marcador y bloqueo se
  conservan.
- Escribe el incremento verificado, confirma el ticket y registra la
  conciliacion en `tenant_medicion_conciliada` (migracion 009, sin
  contenido privado) en UN BEGIN IMMEDIATE: lectura del marcador,
  comparacion del ticket, incremento, confirmacion y registro atomicos;
  dos conciliaciones concurrentes no duplican.
- Consumo cero solo con `--cero-verificado`: un error HTTP o una
  respuesta vacia NO demuestran consumo cero.
- Conciliar no resetea una cuota agotada: el comando informa de la
  autorizacion resultante.

## Smoke test pre-activacion (via interna de ensayo)

Antes de abrir compuertas con usuarios reales, con las altas ya hechas:
1. `estado <tenantId>` muestra identidad, permisos y cuotas esperadas.
2. Via interna de ensayo (`procesarEnAmbito`, no expuesta en canales):
   mensaje de texto del tenant -> respuesta, cuota consumida en el libro,
   herramienta fuera de whitelist denegada, `suspender` bloquea el
   siguiente mensaje, `reactivar` lo devuelve.

## Runbook de activacion

1. Decisiones del propietario (ninguna se presupone): identidades exactas
   (JID), whitelist por persona, cuotas por persona (o sin limite),
   politica para contenido no soportado (silencio o respuesta "no
   soportado").
2. Altas con `alta` + `permisos-establecer` + `cuotas-establecer`;
   verificar con `estado`.
3. Cambio de codigo `AISLAMIENTO_COMPLETO` -> true y
   `DAVIS_TENANTS_ENABLED=1` en el entorno PM2; despliegue por el pipeline
   habitual (backup con quiesce previo) y health check.
4. Verificacion con UN usuario real autorizado: texto responde; audio,
   media y grupos siguen la politica elegida; desconocido conserva el
   carril historico; propietario intacto.
5. Rollback: revertir constante y variable de entorno + redeploy. Los
   datos de tenants quedan inertes e intactos.

## Limites que se mantienen tras activar

- Cuota de tokens = control post-uso: peticiones en vuelo pueden
  rebasarla; no es hard cap ni reserva.
- Sin historial conversacional entre mensajes para tenants; recuerdos
  persistentes y RAG propios si segun permisos.
- Solo texto directo: sin audio, media, grupos, ubicacion ni
  interactivos.
- Sin envios programados, monitores ni herramientas owner-only.
- Backup caliente con escritores concurrentes no certificado; el snapshot
  consistente es el del deploy con quiesce.
- Sin restauracion selectiva de un tenant en la base activa.
