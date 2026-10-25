#!/bin/bash
cd "$(dirname "$0")"

# Cargar variables de .env de forma segura si existe
if [ -f .env ]; then
  set -a
  source <(sed -e '/^[[:space:]]*#/d' -e '/^[[:space:]]*$/d' .env 2>/dev/null) 2>/dev/null || true
  set +a
fi

BOT_PHONE=${BOT_PHONE:-34711222006}
AUTHORIZED_USER_PHONE=${AUTHORIZED_USER_PHONE:-34635605605}

echo "=================================================="
echo "🤖 VINCULACIÓN DE WHATSAPP PARA F.R.I.D.A.Y."
echo "=================================================="
echo "Bot (SIM): +$BOT_PHONE"
echo "Usuario Autorizado: +$AUTHORIZED_USER_PHONE"
echo "=================================================="
echo "Selecciona el método de vinculación:"
echo "1) Código de 8 dígitos (Pairing Code para +$BOT_PHONE)"
echo "2) Escanear código QR en la terminal"
echo ""
read -p "Elige una opción (1 o 2, por defecto 1): " opcion

if [ "$opcion" = "2" ]; then
    echo "Generando código QR en terminal..."
    node whatsappBot.js
else
    echo "Solicitando código de vinculación para +$BOT_PHONE..."
    node whatsappBot.js --pairing
fi
