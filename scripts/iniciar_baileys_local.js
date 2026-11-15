#!/usr/bin/env node
/**
 * iniciar_baileys_local.js - Lanzador de Baileys en entorno local (PC).
 *
 * Muestra el codigo QR en la consola de Windows/PowerShell para vincular WhatsApp
 * directamente con D.A.V.I.S.
 *
 * Importante: Para evitar conflictos de conexion con WhatsApp Web, la instancia
 * en el VPS debe estar detenida durante las pruebas locales:
 *   ssh -i C:\Users\David\.ssh\oracle_key.pem ubuntu@<VPS_IP> "pm2 stop jarvis-whatsapp"
 *
 * Strict Policy: Zero Emojis.
 */

import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

console.log('================================================================');
console.log('         D.A.V.I.S. - LANZADOR LOCAL DE WHATSAPP (BAILEYS)     ');
console.log('================================================================');
console.log('Directorio del proyecto:', ROOT_DIR);

// Asegurar que exista carpeta data y auth
const dataDir = path.join(ROOT_DIR, 'data');
const authDir = path.join(dataDir, 'auth_info_baileys');
if (!fs.existsSync(authDir)) {
  fs.mkdirSync(authDir, { recursive: true });
}

// Configurar entorno local
process.env.DAVIS_PERSISTENCE = process.env.DAVIS_PERSISTENCE || 'sqlite';
process.env.DAVIS_MCP_ENABLED = process.env.DAVIS_MCP_ENABLED || '1';
process.env.DAVIS_TENANTS_ENABLED = process.env.DAVIS_TENANTS_ENABLED || '1';

console.log('Modo persistencia:', process.env.DAVIS_PERSISTENCE);
console.log('MCPs habilitados:', process.env.DAVIS_MCP_ENABLED);
console.log('Tenants habilitados:', process.env.DAVIS_TENANTS_ENABLED);
console.log('Ruta de credenciales:', authDir);
console.log('\nIniciando cliente de WhatsApp... Escanea el codigo QR que aparecera a continuacion con tu telefono:\n');

// Importar y arrancar whatsappBot
import(path.join(ROOT_DIR, 'whatsappBot.js')).catch((err) => {
  console.error('[Error Critico al iniciar Baileys]', err);
  process.exit(1);
});
