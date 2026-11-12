#!/bin/bash
# deploy.sh - Despliegue de F.R.I.D.A.Y-bot en el VPS Oracle.
# Lo invoca el workflow por SSH con RELEASE_SHA=<sha probado en CI>.
#
# Modelo: RELEASE AISLADA por SHA + corte controlado. El bot en marcha NO se
# toca hasta que la release exacta pasa la puerta en el servidor. Estado
# compartido (data/, sesion de WhatsApp, .env) vive fuera de las releases y
# se enlaza dentro.
#
# Politica de fallos HONESTA:
#  - ANTES del corte (pasos 0-5): cualquier fallo para el despliegue y el
#    bot anterior sigue corriendo intacto.
#  - DESPUES del corte (paso 6, symlink cambiado): un fallo deja un ESTADO
#    PARCIAL que se reporta con precision. NADA se revierte solo: cualquier
#    restauracion (incluido volver al symlink anterior) es una decision
#    aprobada aparte, porque puede perder datos escritos tras el corte.
set -euo pipefail

BASE="${DEPLOY_BASE:-/home/ubuntu}"
REPO_URL="${REPO_URL:-https://github.com/DCastellanos4/F.R.I.D.A.Y-bot.git}"
PM2="${PM2_BIN:-pm2}"
REPO=$BASE/jarvis-repo            # repo git de referencia (solo fetch)
ENLACE=$BASE/jarvis               # ruta viva que PM2 referencia: symlink a la release
RELEASES=$BASE/releases
ESTADO=$BASE/jarvis-estado        # data/, auth_info_baileys/, .env compartidos
BACKUPS=$BASE/backups
LOCK=$BASE/.deploy.lock
TS=$(date +%Y%m%d-%H%M%S)
# Namespace de temporales POR INVOCACION: el workflow crea un mktemp unico
# y lo pasa como DEPLOY_TMP. TODOS los ficheros de trabajo (scripts, TAPs,
# fixtures, lock temporal) viven ahi y solo ahi: dos despliegues (o un
# ensayo harness dentro de la suite) NUNCA comparten ruta. Sin DEPLOY_TMP
# se cae a un mktemp propio, nunca al /tmp compartido.
DTMP="${DEPLOY_TMP:-}"
if [ -z "$DTMP" ]; then DTMP=$(mktemp -d /tmp/deploy-tmp-XXXXXX); fi
mkdir -p "$DTMP"
NECESARIOS="$DTMP/snapshot.js $DTMP/quality-gate.mjs"
for f in $NECESARIOS; do
  [ -f "$f" ] || { echo "PARADA: falta $f (el invocador debe copiar los scripts al namespace DEPLOY_TMP)." >&2; exit 1; }
done
SHA=${RELEASE_SHA:?PARADA: RELEASE_SHA ausente - se despliega solo el SHA probado en CI}
CORTE=0

# Un solo despliegue a la vez (el workflow tambien serializa con concurrency).
exec 9>"$LOCK"
flock -n 9 || { echo "PARADA: otro despliegue en curso." >&2; exit 1; }

echo "== [0/7] Preparacion de referencias =="
mkdir -p "$RELEASES" "$ESTADO" "$BACKUPS"
chmod 700 "$BACKUPS"
if [ ! -d "$REPO/.git" ]; then
  git clone "$REPO_URL" "$REPO"
fi
git -C "$REPO" fetch origin
git -C "$REPO" cat-file -e "$SHA^{commit}" || { echo "PARADA: el SHA $SHA no existe en origin." >&2; exit 1; }

echo "== [1/7] Control de orden: no desplegar algo mas viejo ni divergente =="
SHA_ACTUAL=""
if [ -L "$ENLACE" ]; then
  APUNTA=$(readlink -f "$ENLACE")
  [ -f "$APUNTA/.git-meta/sha" ] && SHA_ACTUAL=$(cat "$APUNTA/.git-meta/sha")
fi
if [ -z "$SHA_ACTUAL" ] && [ -d "$ENLACE/.git" ]; then
  SHA_ACTUAL=$(git -C "$ENLACE" rev-parse HEAD 2>/dev/null || true)
fi
if [ -n "$SHA_ACTUAL" ]; then
  if [ "$SHA_ACTUAL" = "$SHA" ]; then echo "Ese SHA ya esta desplegado; nada que hacer."; exit 0; fi
  git -C "$REPO" merge-base --is-ancestor "$SHA_ACTUAL" "$SHA" \
    || { echo "PARADA: el SHA probado NO es descendiente del desplegado ($SHA_ACTUAL): fuera de orden o divergente." >&2; exit 1; }
fi

echo "== [2/7] Estado compartido y migracion (una sola vez) =="
# Copia (nunca mueve ni borra) data/, auth_info_baileys/ y .env al estado
# compartido si aun no estan. Funciona tanto si ENLACE es el directorio real
# heredado (checkout vivo pre-CI/CD) como si ya es un symlink a una release.
ORIGEN_ESTADO="$ENLACE"
for item in data auth_info_baileys .env; do
  if [ -e "$ORIGEN_ESTADO/$item" ] && [ ! -e "$ESTADO/$item" ]; then
    cp -a "$ORIGEN_ESTADO/$item" "$ESTADO/$item"
    echo "estado migrado a $ESTADO/$item (el original se conserva)"
  fi
done
echo "== [3/7] Release aislada del SHA exacto =="
DESTINO=$RELEASES/${TS}-${SHA:0:8}
git -C "$REPO" worktree add --detach "$DESTINO" "$SHA"
mkdir -p "$DESTINO/.git-meta" && echo "$SHA" > "$DESTINO/.git-meta/sha"
# El checkout del worktree puede traer data/ VERSIONADO (metricas.jsonl).
# ln -sfn sobre un directorio real NO lo reemplaza: crea el enlace DENTRO.
# Se elimina la copia del checkout (contenido recuperable de git; el estado
# vivo ya migro a $ESTADO) y luego se enlaza. La sesion de WhatsApp vive
# dentro de data/ (data/auth_info_baileys).
if [ -d "$DESTINO/data" ] && [ ! -L "$DESTINO/data" ]; then
  mv "$DESTINO/data" "$DESTINO/.git-meta/data-checkout"
fi
ln -sfn "$ESTADO/data" "$DESTINO/data"
ln -sfn "$ESTADO/.env" "$DESTINO/.env"

# Validacion REAL de los enlaces antes de instalar nada (falla cerrada):
# data debe ser el enlace al estado compartido y la sesion debe ser legible
# a traves de el; .env idem. Sin esto, el bot arrancaria sin estado/sesion.
[ -L "$DESTINO/data" ] && [ "$(readlink -f "$DESTINO/data")" = "$ESTADO/data" ]   || { echo "PARADA: $DESTINO/data no enlaza a $ESTADO/data (colision de ruta)." >&2; exit 1; }
[ -r "$DESTINO/data/auth_info_baileys/creds.json" ]   || { echo "PARADA: sesion de WhatsApp no legible en el estado compartido; no se despliega a ciegas." >&2; exit 1; }
[ -L "$DESTINO/.env" ] && [ "$(readlink -f "$DESTINO/.env")" = "$ESTADO/.env" ]   || { echo "PARADA: $DESTINO/.env no enlaza a $ESTADO/.env." >&2; exit 1; }
echo "enlaces de estado verificados (data, sesion, .env)"
cd "$DESTINO"
npm ci --no-audit --no-fund

echo "== [4/7] Puerta en el servidor: criticos + suite aislados (fixtures temporales, sin datos reales ni sesion) =="
# La carpeta de datos temporal termina en /data: varios tests comprueban la
# forma de las rutas por defecto (.../data/<fichero>).
mkdir -p "$DTMP/cicd-data-$TS/data"
# TMPDIR de los tests DENTRO del namespace: os.tmpdir() (mkdtemp de la suite)
# ya no escribe en el /tmp compartido. Se limpia solo este subdirectorio,
# cuando los procesos de test ya terminaron (ejecucion en primer plano).
mkdir -p "$DTMP/tmp-tests-$TS"
export TMPDIR="$DTMP/tmp-tests-$TS"
export DAVIS_DATA_DIR="$DTMP/cicd-data-$TS/data" DAVIS_HISTORY_DIR="$DTMP/cicd-history-$TS" NODE_ENV=test
# Aislamiento de entorno de tests: deben correr con las MISMAS variables que
# en CI (ninguna de produccion). El .env de la release es un ENLACE al estado
# compartido y dotenv lo cargaba en cada proceso de test (contaminacion real:
# DAVIS_METRICS_HOST=172.30.50.1 -> bind al bridge -> ECONNREFUSED loopback).
# El cierre de esa via vive en src/config/config.js (NODE_ENV=test no carga
# .env del estado ni del repo); aqui se limpia lo heredado del shell SSH.
unset DAVIS_HARNESS_DEPLOY DAVIS_TEST_REAL_EXEC DAVIS_OTEL_ENABLED DAVIS_OTEL_ENDPOINT DAVIS_OTEL_SERVICIO DAVIS_METRICS_ENABLED DAVIS_METRICS_HOST DAVIS_METRICS_REDES_PERMITIDAS DAVIS_METRICS_PUERTO DAVIS_METRICS_PUERTO_WS DAVIS_METRICS_PUERTO_API
CRITICOS="tests/sector2/task0_foundations.test.js tests/sector2/task0_challenge.test.js tests/sector2/integration.test.js tests/sector2/task12_bash_console.test.js tests/sector2/task15_github_webhook.test.js tests/sector2/task16_backup.test.js tests/sector2/task21_memory_encryption.test.js tests/sector2/deploy_aislamiento.test.js tests/sector3/safefetch_unit.test.js tests/sector3/process_watchdog.test.js"
# Lista explicita de ficheros: 'node --test <directorio>' NO es portable
# (algunas versiones lo tratan como modulo y fallan).
timeout 900 node --test --test-reporter=tap $CRITICOS > "$DTMP/criticos-$TS.tap" || true
timeout 900 node tests/run_all.js > "$DTMP/suite-$TS.tap" || true
# Procesos de test terminados: limpiar SOLO el TMPDIR propio (guarda de ruta).
case "$TMPDIR" in "$DTMP"/tmp-tests-*) rm -rf -- "$TMPDIR" ;; esac
unset TMPDIR
# Los timeouts/errores del runner NO se enmascaran: la puerta falla cerrada
# si falta el resumen TAP o no se ejecuto nada. '|| true' solo evita que
# set -e oculte el motivo; quien decide es la puerta.
node "$DTMP/quality-gate.mjs" --critical "$DTMP/criticos-$TS.tap" --suite "$DTMP/suite-$TS.tap" --min-pct "${MIN_PASS_PCT:-95}" \
  || { echo "PARADA: puerta no superada en servidor; ANTES del corte, el bot sigue con la release anterior." >&2; exit 1; }
rm -rf "$DTMP/cicd-data-$TS" "$DTMP/cicd-history-$TS"

# Validate service-scoped private activation before stopping producers. A
# configured RF01/API install must not silently revert to old defaults.
node -e "require(process.argv[1])" "$DESTINO/ecosystem.config.cjs" \
  || { echo "PARADA: configuracion privada de activacion invalida; servicios actuales intactos." >&2; exit 1; }

echo "== [5/7] Snapshot cifrado del estado (obligatorio, DBK1 GCM autenticado) =="
PASS="${DAVIS_BACKUP_KEY:-${BACKUP_PASSPHRASE:-}}"
if [ -z "$PASS" ] && [ -f "$ESTADO/.env" ]; then set -a; . "$ESTADO/.env"; set +a; PASS="${DAVIS_BACKUP_KEY:-${BACKUP_PASSPHRASE:-}}"; fi
[ -n "$PASS" ] || { echo "PARADA: falta DAVIS_BACKUP_KEY/BACKUP_PASSPHRASE en el servidor; no se despliega sin punto de restauracion cifrado. ANTES del corte: el bot sigue intacto." >&2; exit 1; }

# Snapshot CONSISTENTE: TODOS los writers del estado compartido (bot y API)
# quedan PARADOS durante el tar. Sin quiesce, tar sale !=0 ("file changed as
# we read it") y, peor, puede dejar una copia incoherente de SQLite o de la
# sesion de Baileys que NO es un punto de restauracion garantizable. La API
# de backup de SQLite no cubre el estado volatil de Baileys, asi que la
# unica garantia honesta es el quiesce. Caida anunciada de ~1 minuto ANTES
# del corte; si algo falla, el bot se rearranca SIEMPRE (trap).
SNAP_PARADOS=0
# Estado PREVIO deliberado: solo se reviven los writers que estaban online
# ANTES del quiesce. Si el bot estaba parado a proposito, un fallo del
# snapshot NO debe dejarlo arrancado (cambio de estado no autorizado).
WRITERS_PREVIOS=$($PM2 jlist | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{const j=JSON.parse(d);console.log(['jarvis-whatsapp','jarvis-api'].filter(n=>{const p=j.find(x=>x.name===n);return p&&p.pm2_env.status==='online'}).join(' '))}catch(e){console.log('')}})" || true)
soltar_writers() {
  if [ "$SNAP_PARADOS" = "1" ]; then
    SNAP_PARADOS=0
    if [ -n "$WRITERS_PREVIOS" ]; then
      echo "snapshot: rearrancando SOLO los writers que estaban online ($WRITERS_PREVIOS)..." >&2
      $PM2 start $WRITERS_PREVIOS >/dev/null 2>&1 \
        || $PM2 restart $WRITERS_PREVIOS >/dev/null 2>&1 \
        || echo "AVISO: el rearranque automatico fallo; revisar 'pm2 ls' YA." >&2
    else
      echo "snapshot: ningun writer estaba online antes del quiesce; se respeta ese estado parado." >&2
    fi
  fi
}
trap soltar_writers EXIT
$PM2 stop jarvis-api jarvis-whatsapp >/dev/null 2>&1 || true
# Espera ACOTADA con polling: 'pm2 stop' es asincrono y jlist puede mostrar
# 'stopping' durante unos segundos. Se espera hasta 30s a que cada writer
# conocido quede 'stopped'. Cualquier otro estado pasado el plazo (online,
# stopping, errored, launching, churn de autorestart) significa posible
# escritor residual: NO se copia (mejor parar antes del corte con el bot en
# marcha que snapshot incoherente). Un proceso ausente de jlist no es writer
# y no bloquea. NUNCA se relaja a aceptar un writer activo.
WRITERS_PARADOS=0
ULTIMO_ESTADO_WRITERS=""
for i in $(seq 1 30); do
  ULTIMO_ESTADO_WRITERS=$($PM2 jlist | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const j=JSON.parse(d);const mal=['jarvis-whatsapp','jarvis-api'].filter(n=>{const p=j.find(x=>x.name===n);return p&&p.pm2_env.status!=='stopped'});if(mal.length){console.log('writers no parados del todo: '+mal.join(','));process.exit(1)}})" 2>&1) && { WRITERS_PARADOS=1; break; }
  sleep 1
done
[ "$WRITERS_PARADOS" = "1" ] || [ -z "$ULTIMO_ESTADO_WRITERS" ] || echo "$ULTIMO_ESTADO_WRITERS" >&2
if [ "$WRITERS_PARADOS" = "1" ]; then
  SNAP_PARADOS=1
else
  echo "PARADA: no se pudieron parar los writers; snapshot cancelado. ANTES del corte: el bot sigue con la release anterior." >&2
  [ -n "$WRITERS_PREVIOS" ] && $PM2 start $WRITERS_PREVIOS >/dev/null 2>&1 || true
  exit 1
fi
# 0600 DESDE LA CREACION (umask 077): el .env y la sesion viajan cifrados,
# pero ni el temporal ni el final nacen legibles. El snapshot se escribe a
# un nombre temporal y SOLO se renombra a .dbk1 si el cifrado+roundtrip
# completo termina bien: un snapshot fallido NUNCA queda como punto de
# restauracion.
umask 077
SNAP_TMP="$BACKUPS/.pre-deploy-$TS.dbk1.tmp"
RC=0
tar -czf - -C "$ESTADO" . | PASS="$PASS" node "$DTMP/snapshot.js" > "$SNAP_TMP" || RC=$?
if [ "$RC" -ne 0 ] || [ ! -s "$SNAP_TMP" ]; then
  rm -f "$SNAP_TMP"
  echo "PARADA: snapshot fallo (rc=$RC). El temporal se borro: no queda punto de restauracion falso." >&2
  soltar_writers
  echo "ANTES del corte: el bot vuelve a la release anterior intacta." >&2
  exit 1
fi
mv "$SNAP_TMP" "$BACKUPS/pre-deploy-$TS.dbk1"
soltar_writers
echo "snapshot cifrado verificado (writers quiesced, 0600 desde creacion): $BACKUPS/pre-deploy-$TS.dbk1"
trap - EXIT

# Higiene de entorno ANTES del corte: DAVIS_DATA_DIR/DAVIS_HISTORY_DIR se
# exportaron para aislar la suite; si quedan en el entorno, pm2 las hereda
# y el bot arrancaria contra el temporal borrado (sin sesion ni datos).
unset DAVIS_DATA_DIR DAVIS_HISTORY_DIR
echo "== [6/7] Corte controlado (punto a partir del cual NO hay vuelta atras automatica) =="
ANTERIOR=$(readlink -f "$ENLACE" 2>/dev/null || true)
# Si ENLACE es todavia un DIRECTORIO REAL (despliegue pre-CI/CD), se aparta
# entero y conservado AHORA, ya con puerta y snapshot superados. ln -sfn sobre
# un directorio real NO lo reemplaza (crearia el enlace dentro): por eso este
# paso es obligatorio. PM2 sigue corriendo el codigo viejo tras el mv (el cwd
# del proceso apunta al mismo inodo); el cambio efectivo llega con el restart.
if [ -d "$ENLACE" ] && [ ! -L "$ENLACE" ]; then
  mv "$ENLACE" "$BASE/jarvis.pre-cicd-$TS"
  echo "directorio heredado conservado en $BASE/jarvis.pre-cicd-$TS (nada borrado)"
fi
ln -sfn "$DESTINO" "$ENLACE"
CORTE=1
# Marca PRE-restart: ruta y tamano del log de salida del proceso VIEJO. La
# evidencia del proceso NUEVO se liga asi: si PM2 rota a otro fichero (p.ej.
# sufijo -1), todo su contenido es del proceso nuevo; si mantiene el mismo
# fichero, lo nuevo son los bytes posteriores a este offset. Capturar DESPUES
# del restart perderia un CONECTADO o un QR inmediatos.
JLIST_PRE=$($PM2 jlist || true)
OUT_LOG_PRE=$(echo "$JLIST_PRE" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{const j=JSON.parse(d);const p=j.find(x=>x.name==='jarvis-whatsapp');console.log(p&&p.pm2_env?p.pm2_env.pm_out_log_path||'':'')}catch(e){console.log('')}})")
# Offset por RUTA para todos los logs de salida conocidos: tras delete+start,
# PM2 puede REUSAR un fichero antiguo (p.ej. out-1.log) con lineas historicas
# dentro; solo cuentan los bytes escritos tras el offset de ESA ruta. Un
# fichero que no existia antes pertenece entero al proceso nuevo.
DIR_LOGS=$(dirname "${OUT_LOG_PRE:-$BASE/.pm2/logs/jarvis-whatsapp-out.log}")
declare -A OFFSETS_PRE=()
for f in "$DIR_LOGS"/jarvis-whatsapp-out*.log; do
  [ -f "$f" ] && OFFSETS_PRE["$f"]=$(stat -c %s "$f")
done
# Corte de procesos con arranque LIMPIO, no 'pm2 restart': restart disparo un
# bucle de SIGINT en 2 de 2 despliegues (procesos muriendo 3-6s tras arrancar,
# causa interna de PM2 no determinada); delete+start produjo procesos
# estables en 2 de 2 recuperaciones. Es el mismo ecosystem y el mismo cwd:
# solo cambia que el estado interno del proceso PM2 se crea de cero.
# La verificacion de salud posterior es quien certifica el resultado.
SALIDA_DEL=$($PM2 delete jarvis-api jarvis-whatsapp 2>&1) || {
  if echo "$SALIDA_DEL" | grep -qiE "not found|does not exist|doesn't exist|no such process"; then
    echo "pm2 delete: los procesos no existian (arranque desde cero)."
  else
    echo "ESTADO PARCIAL TRAS EL CORTE: pm2 delete fallo por causa desconocida y se PARA antes de seguir tocando procesos:" >&2
    echo "$(echo "$SALIDA_DEL" | tail -3 | cut -c1-200)" >&2
    echo "El symlink ya apunta a $DESTINO. NO se revierte automaticamente; restaurar es decision aprobada aparte." >&2
    exit 1
  fi
}
if ! $PM2 start "$DESTINO/ecosystem.config.cjs" >/dev/null || ! $PM2 save >/dev/null; then
  echo "ESTADO PARCIAL TRAS EL CORTE: el symlink ya apunta a $DESTINO pero el arranque limpio de PM2 FALLO." >&2
  echo "El bot puede estar caido. El codigo nuevo esta activo en disco; el anterior sigue en ${ANTERIOR:-la copia pre-cicd}." >&2
  echo "NO se revierte automaticamente. Restaurar el symlink anterior es una decision aprobada aparte (puede perder datos escritos tras el corte)." >&2
  exit 1
fi
sleep 20
if ! $PM2 jlist | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const j=JSON.parse(d);const p=n=>j.find(x=>x.name===n);const bad=['jarvis-whatsapp','jarvis-api'].filter(n=>!p(n)||p(n).pm2_env.status!=='online');if(bad.length){console.error('no online: '+bad.join(','));process.exit(1)}})"; then
  echo "ESTADO PARCIAL TRAS EL CORTE: pm2 restart se ejecuto pero algun proceso NO quedo online." >&2
  echo "Release activa: $DESTINO. Revisar: pm2 logs jarvis-whatsapp --lines 50 (arranque, LID reconocido, QR)." >&2
  echo "NO se revierte automaticamente; restaurar es decision aprobada aparte. Si WhatsApp pidiera QR: PARAR y avisar a David, NO restaurar sesion solo." >&2
  exit 1
fi
echo "== Verificacion de salud post-corte (ventana ${VENTANA_SALUD:-75}s; cierra el falso verde de un crash-loop) =="
# Un proceso en crash-loop aparece 'online' en cualquier muestra instantanea:
# la prueba fiable es que el CONTADOR DE REINICIOS y el UPTIME no se muevan
# durante una ventana mas larga que el periodo del bucle, y que la evidencia
# de WhatsApp sea del proceso NUEVO (offsets de log por ruta marcados antes
# del corte, no lineas historicas). Nunca se vuelcan contenidos de mensajes ni variables: solo
# contadores, timestamps y cadenas fijas de banner.
VENTANA="${VENTANA_SALUD:-75}"
JLIST0=$($PM2 jlist)
OUT_LOG=$(echo "$JLIST0" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const j=JSON.parse(d);const p=j.find(x=>x.name==='jarvis-whatsapp');console.log(p&&p.pm2_env?p.pm2_env.pm_out_log_path||'':'')})")
CONT_T0=$(echo "$JLIST0" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const j=JSON.parse(d);const r=n=>{const p=j.find(x=>x.name===n);console.log(p?p.pm2_env.restart_time:-1)};r('jarvis-whatsapp');r('jarvis-api')})" | paste -sd' ' -)
# La rotacion y el reuso de ficheros los resuelven los offsets por ruta
# (OFFSETS_PRE, marcados antes del corte): un fichero reutilizado solo aporta
# sus bytes nuevos; uno inexistente antes del corte aporta todo su contenido.
sleep "$VENTANA"
if ! $PM2 jlist | node -e "
let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{
  const [wa0,api0]=process.argv[1].split(' ').map(Number);
  const win=Number(process.argv[2]);
  const antes={'jarvis-whatsapp':wa0,'jarvis-api':api0};
  const ahora=JSON.parse(d);
  const mal=[];
  for(const n of ['jarvis-whatsapp','jarvis-api']){
    const p=ahora.find(x=>x.name===n);
    if(!p||p.pm2_env.status!=='online'){mal.push(n+' no online');continue}
    if(p.pm2_env.restart_time!==antes[n]){mal.push(n+' reinicio en ventana ('+antes[n]+'->'+p.pm2_env.restart_time+')');continue}
    if(Date.now()-p.pm2_env.pm_uptime<win*1000){mal.push(n+' uptime menor que la ventana (bucle posible)')}
  }
  if(mal.length){console.error('inestabilidad post-corte: '+mal.join('; '));process.exit(1)}
})" "$CONT_T0" "$VENTANA"; then
  echo "ESTADO PARCIAL TRAS EL CORTE: procesos inestables (posible crash-loop). Release activa: $DESTINO." >&2
  echo "NO se revierte automaticamente; restaurar es decision aprobada aparte. Diagnosticar: pm2 describe y pm2 logs --lines 50." >&2
  exit 1
fi
echo "procesos estables durante ${VENTANA}s (contadores de reinicio inmoviles)."

if [ -z "$OUT_LOG" ] || [ ! -f "$OUT_LOG" ]; then
  echo "ESTADO PARCIAL TRAS EL CORTE: no se pudo resolver el log de salida de jarvis-whatsapp; sin evidencia de conexion." >&2
  exit 1
fi
if [ -n "${OFFSETS_PRE[$OUT_LOG]:-}" ]; then
  NUEVO=$(tail -c +$(( ${OFFSETS_PRE[$OUT_LOG]} + 1 )) "$OUT_LOG" || true)
else
  NUEVO=$(cat "$OUT_LOG" || true)
fi
if echo "$NUEVO" | grep -qE "ESCANEA ESTE CODIGO QR|CODIGO DE VINCULACION"; then
  echo "ESTADO PARCIAL TRAS EL CORTE: WhatsApp pide vinculacion (QR/codigo): sesion invalidada con el estado actual." >&2
  echo "PARAR: solo David puede re-vincular con la SIM del bot. NO restaurar nada por cuenta propia." >&2
  exit 1
fi
if ! echo "$NUEVO" | grep -q "D.A.V.I.S. CONECTADO Y EN LINEA"; then
  echo "ESTADO PARCIAL TRAS EL CORTE: sin evidencia fresca de conexion de WhatsApp del proceso nuevo en ${VENTANA}s." >&2
  echo "Release activa: $DESTINO. NO se revierte automaticamente; restaurar es decision aprobada aparte." >&2
  exit 1
fi
echo "WhatsApp: conexion fresca confirmada (banner del proceso nuevo, sin QR)."

# Probe resolves the same private API-only config in memory. Never send
# credentials through shell arguments or log headers/raw response bodies.
if ! node "$DESTINO/deploy/api-health.cjs" "$DESTINO/ecosystem.config.cjs"; then
  echo "ESTADO PARCIAL TRAS EL CORTE: API no cumple salud/autenticacion esperada." >&2
  echo "NO se revierte automaticamente; restaurar es decision aprobada aparte." >&2
  exit 1
fi

$PM2 ls

echo "== [7/7] Limpieza: conservar las 3 releases mas recientes (NUNCA la viva) =="
VIVO=$(readlink -f "$ENLACE")
ls -1dt "$RELEASES"/*/ 2>/dev/null | tail -n +4 | while read -r vieja; do
  vieja="${vieja%/}"
  if [ "$(readlink -f "$vieja")" = "$VIVO" ]; then
    echo "se conserva la release viva: $vieja"
    continue
  fi
  git -C "$REPO" worktree remove --force "$vieja" 2>/dev/null || rm -rf "$vieja"
done
echo "DESPLIEGUE COMPLETADO: $SHA"
