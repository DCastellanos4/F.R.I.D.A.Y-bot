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
ln -sfn /home/ubuntu/releases/20261115-151806-1dc892d7/node_modules "$REL_DIR/node_modules"
ln -sfn "$REL_DIR" /home/ubuntu/jarvis
echo "Actualizado symlink /home/ubuntu/jarvis -> $REL_DIR"
pm2 restart jarvis-whatsapp jarvis-api --update-env
pm2 status
