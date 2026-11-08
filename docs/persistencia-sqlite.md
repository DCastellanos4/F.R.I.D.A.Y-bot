# Persistencia SQLite (mejora 2)

Base de datos embebida con ACID, WAL y migraciones versionadas para los
datos que hoy viven en JSON: Second Brain (memorias) y finanzas
(gastos, suscripciones, presupuestos, borradores de ticket). Anade
ademas un repositorio de usuarios de SOLO registro (ver abajo).

## Motor

`better-sqlite3@^12` (dependencia nativa con prebuilds; el rango 12.x
esta fijado porque la 13 exige Node >=22 y el VPS corre Node 20 en
aarch64). Tras un `git pull` en el servidor hace falta un `npm ci`.

## Activacion

Por defecto todo sigue en JSON. Para activar SQLite:

```
DAVIS_PERSISTENCE=sqlite
DAVIS_SQLITE_PATH=/home/ubuntu/jarvis-estado/data/jarvis.db   # opcional; por defecto DATA_DIR/jarvis.db
```

El arranque aplica las migraciones pendientes y, si la base esta vacia,
importa los JSON existentes (`brain_memory.json`, `finanzas.json`) en
una sola transaccion. **Los JSON nunca se borran ni se modifican.**

Valores de `DAVIS_PERSISTENCE` distintos de `json`/`sqlite` hacen fallar
el arranque con un error claro.

## Arquitectura

- Los servicios (`memoryService`, `financeService`) conservan toda la
  logica de dominio. La persistencia pasa por una costura de store
  (`leer`/`guardar`/`transaccion`); el store por defecto lo registra el
  contenedor. Una `rutaArchivo` explicita siempre usa JSON (tests).
- `src/adapters/outbound/persistence/sqlite/`:
  - `connection.js`: WAL, `foreign_keys=ON`, `busy_timeout=5000`.
  - `migraciones.js`: migraciones SQL versionadas, idempotentes, cada
    una en su transaccion, registradas en `schema_migrations`.
  - `sqliteMemoryStore.js` / `sqliteFinanceStore.js`: stores.
  - `sqliteMemoryRepository.js`: MemoryRepositoryPort sobre el store.
  - `sqliteUserRepository.js`: UserRepositoryPort (ver alcance).
  - `importExport.js`: importador y exportador con verificacion.
  - `persistenciaSqlite.js`: factoria (abre, migra, verifica, importa).
- El indice semantico (RAG) recibe una fuente inyectable; con SQLite la
  firma de frescura se calcula sobre el contenido de la base, asi que
  el indice se reconstruye tras cada escritura igual que antes. Las
  memorias categoria `clave` siguen excluidas del indice y cifradas en
  reposo (en columnas dedicadas, nunca en claro).

## Concurrencia (limites honestos)

- Modelo de un proceso escritor, igual que con JSON. WAL permite
  lectores concurrentes sin bloquearlos durante una escritura.
- Cada operacion de leer-modificar-escribir corre dentro de una
  transaccion `BEGIN IMMEDIATE`: un segundo escritor (otro proceso con
  la base abierta) espera hasta `busy_timeout` y relee los datos ya
  confirmados dentro de su transaccion, asi que no hay actualizacion
  perdida entre escritores. Si el candado no se libera a tiempo, la
  operacion falla con `database is locked` (error visible, no perdida
  silenciosa).
- No se afirma "cero bloqueos de disco": SQLite es sincrono por diseño.
  Las escrituras son atomicas y rapidas (milisegundos a esta escala).

## Fallo cerrado ante estado inconsistente

Si la base tiene datos pero ninguna marca de origen en `meta` (p.ej.
una importacion interrumpida), el arranque **falla con error claro** y
SQLite no se activa. No hay fallback silencioso al JSON, que podria
estar obsoleto.

## Recuperacion (vuelta a JSON conservando escrituras posteriores)

El JSON original NO es un respaldo vivo: tras escribir en SQLite queda
obsoleto. La recuperacion exporta el estado actual de la base:

1. `pm2 stop` del bot.
2. `DAVIS_SQLITE_PATH=... node scripts/exportar-sqlite-a-json.js`
   crea `data/export-recuperacion/<fecha>/` con `brain_memory.json`,
   `finanzas.json` y `manifiesto.json` (conteos + sha256). Nunca
   sobrescribe exportaciones previas ni los JSON activos.
3. Verifica el manifiesto y revisa los JSON exportados.
4. Copia los JSON verificados sobre los activos de `data/` (guardando
   copia de los anteriores).
5. `DAVIS_PERSISTENCE=json` y arranca.

`scripts/migrar-json-a-sqlite.js` hace la migracion explicita en la
direccion contraria (idempotente).

## Alcance del repositorio de usuarios

`UserRepositoryPort` + tabla `usuarios` (telefono, primer_contacto,
ultimo_acceso) registran el contacto de usuarios YA autenticados. **No
es autorizacion**: la lista blanca historica sigue decidiendo el acceso
y el repositorio no crea cuentas ni cambia permisos. Es la base de
datos para la futura multi-tenancy sin activarla.

## Despliegue

1. `git pull` + `npm ci` (dependencia nativa; en el VPS aarch64 Node 20
   instala en ~1 min; si no hubiera prebuild, compila con la toolchain
   presente).
2. Validacion en datos aislados: `DAVIS_DATA_DIR=<tmp>` +
   `DAVIS_PERSISTENCE=sqlite`, comprobar importacion y operaciones.
3. Produccion sigue en JSON hasta que se decida el flip; la migracion
   es recuperable por el procedimiento de arriba.
