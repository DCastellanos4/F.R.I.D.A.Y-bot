#!/bin/bash
set -e
SHA=$(git -C /home/ubuntu/jarvis-repo rev-parse --short HEAD)
TS=$(date +%Y%m%d-%H%M%S)
REL_DIR="/home/ubuntu/releases/${TS}-${SHA}"
echo "Creando release: $REL_DIR"
git clone --shared /home/ubuntu/jarvis-repo "$REL_DIR"
rm -rf "$REL_DIR/data"
ln -sfn /home/ubuntu/jarvis-estado/data "$REL_DIR/data"
ln -sfn /home/ubuntu/jarvis-estado/.env "$REL_DIR/.env"
ln -sfn /home/ubuntu/jarvis-shared-node-modules "$REL_DIR/node_modules"
ln -sfn "$REL_DIR" /home/ubuntu/jarvis
echo "Actualizado symlink /home/ubuntu/jarvis -> $REL_DIR"
pm2 delete jarvis-whatsapp jarvis-api || true
pm2 start "$REL_DIR/ecosystem.config.cjs" --update-env
pm2 save
pm2 status
