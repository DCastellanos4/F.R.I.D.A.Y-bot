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
export DAVIS_DATA_DIR=/tmp/cicd-data-$TS DAVIS_HISTORY_DIR=/tmp/cicd-history-$TS NODE_ENV=test
CRITICOS="tests/sector2/task0_foundations.test.js tests/sector2/task0_challenge.test.js tests/sector2/integration.test.js tests/sector2/task12_bash_console.test.js tests/sector2/task15_github_webhook.test.js tests/sector2/task16_backup.test.js tests/sector2/task21_memory_encryption.test.js tests/sector3/safefetch_unit.test.js tests/sector3/process_watchdog.test.js"
# Lista explicita de ficheros: 'node --test <directorio>' NO es portable
# (algunas versiones lo tratan como modulo y fallan).
timeout 900 node --test --test-reporter=tap $CRITICOS > /tmp/criticos-$TS.tap || true
timeout 900 node tests/run_all.js > /tmp/suite-$TS.tap || true
# Los timeouts/errores del runner NO se enmascaran: la puerta falla cerrada
# si falta el resumen TAP o no se ejecuto nada. '|| true' solo evita que
# set -e oculte el motivo; quien decide es la puerta.
node deploy/quality-gate.mjs --critical /tmp/criticos-$TS.tap --suite /tmp/suite-$TS.tap --min-pct "${MIN_PASS_PCT:-95}" \
  || { echo "PARADA: puerta no superada en servidor; ANTES del corte, el bot sigue con la release anterior." >&2; exit 1; }
rm -rf /tmp/cicd-data-$TS /tmp/cicd-history-$TS

echo "== [5/7] Snapshot cifrado del estado (obligatorio, DBK1 GCM autenticado) =="
PASS="${DAVIS_BACKUP_KEY:-${BACKUP_PASSPHRASE:-}}"
if [ -z "$PASS" ] && [ -f "$ESTADO/.env" ]; then set -a; . "$ESTADO/.env"; set +a; PASS="${DAVIS_BACKUP_KEY:-${BACKUP_PASSPHRASE:-}}"; fi
[ -n "$PASS" ] || { echo "PARADA: falta DAVIS_BACKUP_KEY/BACKUP_PASSPHRASE en el servidor; no se despliega sin punto de restauracion cifrado. ANTES del corte: el bot sigue intacto." >&2; exit 1; }
tar -czf - -C "$ESTADO" . | PASS="$PASS" node /tmp/snapshot.js > "$BACKUPS/pre-deploy-$TS.dbk1" \
  || { echo "PARADA: snapshot fallo. ANTES del corte: el bot sigue intacto." >&2; exit 1; }
chmod 600 "$BACKUPS/pre-deploy-$TS.dbk1"
echo "snapshot cifrado verificado: $BACKUPS/pre-deploy-$TS.dbk1"

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
if ! $PM2 restart jarvis-whatsapp jarvis-api --update-env; then
  echo "ESTADO PARCIAL TRAS EL CORTE: el symlink ya apunta a $DESTINO pero pm2 restart FALLO." >&2
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
