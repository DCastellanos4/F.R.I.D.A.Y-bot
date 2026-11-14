#!/bin/bash
cd "$(dirname "$0")"

# Cargar variables de .env de forma segura si existe
if [ -f .env ]; then
  set -a
  source <(sed -e '/^[[:space:]]*#/d' -e '/^[[:space:]]*$/d' .env 2>/dev/null) 2>/dev/null || true
  set +a
fi

BOT_PHONE=${BOT_PHONE:-34700000000}
AUTHORIZED_USER_PHONE=${AUTHORIZED_USER_PHONE:-34600000000}

echo "=================================================="
echo "VINCULACION DE WHATSAPP PARA D.A.V.I.S."
echo "=================================================="
echo "Bot (SIM): +$BOT_PHONE"
echo "Usuario Autorizado: +$AUTHORIZED_USER_PHONE"
echo "=================================================="
echo "Selecciona el metodo de vinculacion:"
echo "1) Codigo de 8 digitos (Pairing Code para +$BOT_PHONE)"
echo "2) Escanear codigo QR en la terminal"
echo ""
read -p "Elige una opcion (1 o 2, por defecto 1): " opcion

if [ "$opcion" = "2" ]; then
    echo "Generando codigo QR en terminal..."
    node whatsappBot.js
else
    echo "Solicitando codigo de vinculacion para +$BOT_PHONE..."
    node whatsappBot.js --pairing
fi
