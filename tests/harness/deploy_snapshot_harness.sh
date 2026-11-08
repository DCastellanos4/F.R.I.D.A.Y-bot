#!/bin/bash
# deploy_snapshot_harness.sh - Ensayo LOCAL de deploy.sh con pm2/npm/curl
# falsos y estado de mentira. Nada toca produccion ni la red exterior
# (REPO_URL es un bare repo local). Cubre:
#   A) snapshot con tar que falla -> bot recuperado, sin .dbk1, sin corte
#   B) despliegue feliz -> .dbk1 valido 0600, procesos online, corte hecho
# Uso: deploy_snapshot_harness.sh A|B
set -uo pipefail

ESCENARIO=${1:?A|B|C|D|E}
# node REAL resuelto ANTES de acotar el PATH (en CI, setup-node lo instala
# fuera de /usr/bin): el node falso delega siempre a este binario.
REAL_NODE=$(command -v node) || { echo "harness: falta node en PATH" >&2; exit 2; }
# Raiz del repo ANTES de cualquier cd (deploy.sh vive aqui).
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
BASE=$(mktemp -d /tmp/deploy-harness-XXXXXX)
if [ -z "${KEEP:-}" ]; then trap 'rm -rf "$BASE"' EXIT; fi

# --- bare origin local con un commit minimo -------------------------------
git init --bare -q "$BASE/origin.git"
git init -q "$BASE/src"
cd "$BASE/src"
git config user.email h@h && git config user.name h
printf '{"name":"h","version":"1.0.0","dependencies":{}}\n' > package.json
printf '{"name":"h","version":"1.0.0","lockfileVersion":3,"packages":{}}\n' > package-lock.json
printf 'module.exports = { apps: [] };\n' > ecosystem.config.cjs
mkdir -p deploy
cp "$ROOT/deploy/deploy.sh" "$ROOT/deploy/snapshot.js" "$ROOT/deploy/quality-gate.mjs" deploy/
# Namespace de temporales PROPIO (como el workflow, pero bajo $BASE):
# el deploy interno NUNCA toca el /tmp compartido ni el namespace del
# despliegue exterior.
DTMP_H="$BASE/dtmp" && mkdir -p "$DTMP_H"
cp "$ROOT/deploy/snapshot.js" "$ROOT/deploy/quality-gate.mjs" "$DTMP_H/"
export DEPLOY_TMP="$DTMP_H"
git add -A && git commit -qm init
git push -q "$BASE/origin.git" HEAD:main
SHA=$(git rev-parse HEAD)
cd /

# --- estado compartido de mentira -----------------------------------------
ESTADO=$BASE/jarvis-estado
mkdir -p "$ESTADO/data/auth_info_baileys" "$BASE/backups"
echo '{"fake":true}' > "$ESTADO/data/auth_info_baileys/creds.json"
printf 'DAVIS_BACKUP_KEY=clave-harness-larga-123456\n' > "$ESTADO/.env"

# --- binarios falsos -------------------------------------------------------
BIN=$BASE/bin && mkdir -p "$BIN"
STATE=$BASE/pm2-state
if [ "$ESCENARIO" = "D" ]; then
  printf 'stopped\n' > "$STATE"  # writers YA parados a proposito antes del deploy
else
  printf 'online\n' > "$STATE"
fi

cat > "$BIN/pm2" <<'PM2EOF'
#!/bin/bash
STATE="__STATE__"
LOG="__BASE__/.pm2/logs/jarvis-whatsapp-out.log"
mkdir -p "$(dirname "$LOG")"
st() { cat "$STATE"; }
echo "$(date +%s%N) pm2 $*" >> "${PM2_TRACE:-/dev/null}"
case "$1" in
  jlist)
    case "$(st)" in
      online) S='"status":"online","restart_time":0,"pm_uptime":999999999999' ;;
      stopping) S='"status":"stopping","restart_time":0,"pm_uptime":999999999999' ;;
      *) S='"status":"stopped","restart_time":0,"pm_uptime":0' ;;
    esac
    echo "[{\"name\":\"jarvis-whatsapp\",\"pm2_env\":{$S,\"pm_out_log_path\":\"$LOG\"}},{\"name\":\"jarvis-api\",\"pm2_env\":{$S}}]" ;;
  stop) if [ "${STOP_QUEDA_STOPPING:-}" = 1 ]; then echo stopping > "$STATE"; else echo stopped > "$STATE"; fi ;;
  start|restart)
    # FAIL_START solo rompe el arranque de la NUEVA release (ecosystem),
    # no el rearranque post-snapshot de los procesos vivos por nombre.
    if [ "${FAIL_START:-}" = 1 ] && [[ "$*" == *ecosystem* ]]; then echo "boom"; exit 1; fi
    echo online > "$STATE"
    echo "D.A.V.I.S. CONECTADO Y EN LINEA" >> "$LOG" ;;
  delete) : ;;
  save) : ;;
  ls) echo "pm2-ls-falso" ;;
  *) exit 1 ;;
esac
PM2EOF
sed -i "s|__STATE__|$STATE|g; s|__BASE__|$BASE|g" "$BIN/pm2"
chmod +x "$BIN/pm2"

printf '#!/bin/bash\nexit 0\n' > "$BIN/npm"; chmod +x "$BIN/npm"
printf '#!/bin/bash\necho "{\"ok\":false,\"error\":\"API REST deshabilitada\"}"\n' > "$BIN/curl"; chmod +x "$BIN/curl"
if [ "$ESCENARIO" = "A" ] || [ "$ESCENARIO" = "D" ]; then
  printf '#!/bin/bash\necho "tar: file changed as we read it" >&2\nexit 1\n' > "$BIN/tar"
  chmod +x "$BIN/tar"
fi
if [ "$ESCENARIO" = "C" ]; then export STOP_QUEDA_STOPPING=1; fi
if [ "$ESCENARIO" = "E" ]; then export FAIL_START=1; fi
# quality-gate y criticos: la puerta de tests se salta con TAP fabricado
# (no es lo que se ensaya aqui); deploy.sh exige los ficheros TAP:
# los genera el propio deploy con node --test... usamos MIN_PASS_PCT y
# fabricamos node falso SOLO para quality-gate? No: deploy.sh llama node
# real para tests. Envolvemos: fake node que fabrica TAP valido.
cat > "$BIN/node" <<'NODEEOF'
#!/bin/bash
# node falso selectivo: TAP valido para tests; delega snapshot.js y
# quality-gate.mjs y one-liners al node real.
for a in "$@"; do
  case "$a" in
    *snapshot.js|*quality-gate.mjs|-e) exec __REAL_NODE__ "$@" ;;
  esac
done
if [ "${1:-}" = "--test" ] || [[ "$*" == *"--test"* ]] || [[ "$*" == *run_all.js* ]]; then
  echo "TAP version 13"; echo "1..3"; echo "ok 1 a"; echo "ok 2 b"; echo "ok 3 c"
  echo "# tests 3"; echo "# pass 3"; echo "# fail 0"; echo "# skipped 0"
  exit 0
fi
exec __REAL_NODE__ "$@"
NODEEOF
sed -i "s|__REAL_NODE__|$REAL_NODE|g" "$BIN/node"
chmod +x "$BIN/node"

export PATH="$BIN:/usr/bin:/bin"
export DEPLOY_BASE="$BASE" REPO_URL="$BASE/origin.git" RELEASE_SHA="$SHA"
# Traza completa de TODAS las llamadas pm2 del ensayo (auditoria).
export PM2_TRACE="$BASE/pm2-calls.log"
export VENTANA_SALUD=1 MIN_PASS_PCT=0

cd "$BASE"
bash "$ROOT/deploy/deploy.sh" > "$BASE/salida.log" 2>&1
RC=$?

echo "rc=$RC"
echo "pm2-final=$(cat "$STATE")"
ls -la "$BASE/backups/" | grep -E "dbk1|tmp" || echo "backups: (sin dbk1)"
if [ -L "$BASE/jarvis" ]; then echo "symlink=$(readlink "$BASE/jarvis")"; else echo "symlink=(no existe)"; fi
grep -E "PARADA|ESTADO PARCIAL|rearrancando|quiesce|writers" "$BASE/salida.log" | sed 's/^/log: /' | head -8
exit $RC
