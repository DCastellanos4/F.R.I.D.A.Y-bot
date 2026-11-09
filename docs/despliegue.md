# Despliegue y CI/CD

Pipeline: push a `main` dispara el workflow de GitHub Actions
(`.github/workflows/ci-cd.yml`), que ejecuta la suite de pruebas con la
puerta de calidad y, si pasa, despliega por SSH al VPS Oracle llamando a
`deploy/deploy.sh` con `RELEASE_SHA` fijado al SHA probado. El despliegue
es siempre de un SHA concreto ya verde en CI, nunca de "lo ultimo".

## Puerta de calidad (`deploy/quality-gate.mjs`)

- Tests criticos: todos ejecutados, 0 fallos y 0 omitidos (una critica
  omitida cuenta como fallo).
- Suite completa: al menos el 95 % (`MIN_PASS_PCT`) de las tests ejecutadas
  pasan; las omitidas no cuentan en el denominador y se reportan aparte.
- Fail-closed: TAP ausente, resumen no parseable, cero ejecutadas o error
  del runner hacen fallar la puerta.

La misma puerta se vuelve a ejecutar en el servidor sobre la release exacta
antes de activarla.

## Modelo de release aislada (`deploy/deploy.sh`)

- Cada release es un worktree de git por SHA en `~/releases/<sha>`; la ruta
  viva `~/jarvis` es un symlink a la release activa, y PM2 referencia esa
  ruta.
- Estado compartido fuera de las releases: `data/`, `auth_info_baileys/` y
  `.env` viven en `~/jarvis-estado` y se enlazan dentro de cada release. La
  migracion del estado se hace una sola vez copiando (nunca moviendo).
- Control de orden: no se despliega un SHA que no sea descendiente del
  desplegado (fuera de orden o divergente = parada).
- Un solo despliegue a la vez (flock; el workflow tambien serializa con
  concurrency).
- Todo temporal del despliegue vive en un namespace `DEPLOY_TMP` unico por
  invocacion.

## Snapshot y corte

Antes del corte se detienen todos los writers (`jarvis-api` y
`jarvis-whatsapp`) y se espera acotadamente a que paren de verdad; se toma
un tar del estado completo y se cifra en formato DBK1 con `deploy/snapshot.js`
(clave por entorno, roundtrip de verificacion antes de emitir). El backup
de SQLite no cubre el estado volatil de Baileys: por eso el snapshot es del
estado completo con writers parados.

El corte es el cambio del symlink seguido de un arranque limpio de PM2
(delete + start, no restart), verificando que ambos procesos quedan online.

## Politica de fallos

- Antes del corte: cualquier fallo para el despliegue y el bot sigue con la
  release anterior intacta.
- Despues del corte: un fallo deja un estado parcial que se reporta con
  precision. Nada se revierte solo: cualquier restauracion (incluido volver
  al symlink anterior) es una decision aprobada aparte, porque puede perder
  datos escritos tras el corte.

## Arranque en el VPS

PM2 con `ecosystem.config.cjs` (apps `jarvis-api` y `jarvis-whatsapp`). Las
variables se leen del primer fichero existente entre `DAVIS_ENV_FILE`,
`<DATA_DIR>/.env` y `.env` del repo; los cambios en variables ya cacheadas
por PM2 requieren `pm2 restart --update-env` (o delete + start).
