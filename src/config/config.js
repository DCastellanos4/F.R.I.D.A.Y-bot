import dotenv from 'dotenv';
import fs from 'node:fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { PROJECT_ROOT, DATA_DIR } from './paths.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Contrato de arranque: las variables persistidas se leen de TODOS los
// ficheros existentes de esta lista (el primero que define una variable
// gana; dotenv nunca pisa variables ya presentes en el entorno del
// proceso). Asi un reinicio simple del servicio recoge la configuracion
// nueva sin exports manuales, viva donde viva el estado:
//   1. DAVIS_ENV_FILE        ruta explicita, si el despliegue la define
//   2. <DATA_DIR>/.env       estado compartido fuera de git (p.ej. jarvis-estado)
//   3. <raiz del repo>/.env  layout clasico de desarrollo
// OJO: si una variable YA existe en el entorno cacheado por pm2 con un
// valor viejo, editar el fichero no basta: hace falta `pm2 restart
// --update-env` (o delete+start). Las variables NUEVAS siempre entran.
const candidatosEnv = [
  process.env.DAVIS_ENV_FILE,
  path.join(DATA_DIR, '.env'),
  path.join(PROJECT_ROOT, '.env')
].filter(Boolean);
const ficherosEnv = candidatosEnv.filter((p) => {
  try { return fs.existsSync(p); } catch { return false; }
});
if (ficherosEnv.length > 0) {
  dotenv.config({ path: ficherosEnv, quiet: true });
}

const hasCloudKey = Boolean(
  process.env.OPENAI_API_KEY ||
  process.env.GROQ_API_KEY ||
  process.env.OPENROUTER_API_KEY ||
  process.env.DEEPSEEK_API_KEY
);

const defaultProvider = (process.env.LLM_PROVIDER || (hasCloudKey ? 'openai' : 'ollama')).toLowerCase();

export const config = {
  // Identidades Telefónicas (WhatsApp Multi-Device Baileys)
  userPhone: process.env.AUTHORIZED_USER_PHONE || '34635605605',
  botPhone: process.env.BOT_PHONE || '34711222006',
  userLid: process.env.AUTHORIZED_USER_LID || '149868706304033',

  // Configuración de Proveedor de Inteligencia Artificial
  // 'ollama' (self-hosted local) | 'openai' | 'groq' | 'openrouter' | 'deepseek'
  llm: {
    provider: defaultProvider,
    // Configuración Local Ollama
    ollamaHost: process.env.OLLAMA_HOST || 'http://127.0.0.1:11434',
    ollamaModel: process.env.OLLAMA_MODEL || 'jarvis',
    // Configuración Cloud API (OpenAI, Groq, OpenRouter, DeepSeek, Together, vLLM)
    apiKey: process.env.OPENAI_API_KEY || process.env.GROQ_API_KEY || process.env.OPENROUTER_API_KEY || process.env.DEEPSEEK_API_KEY || '',
    baseUrl: process.env.OPENAI_BASE_URL || '',
    model: process.env.OPENAI_MODEL || ''
  },

  // Compatibilidad hacia atrás directa
  ollamaHost: process.env.OLLAMA_HOST || 'http://127.0.0.1:11434',
  ollamaModel: process.env.OLLAMA_MODEL || 'jarvis',

  // Servidor API REST
  port: parseInt(process.env.PORT, 10) || 3000,

  // Seguridad del API REST y del webhook de GitHub (sin valores por defecto)
  apiToken: process.env.API_TOKEN || '',
  githubWebhookSecret: process.env.GITHUB_WEBHOOK_SECRET || '',

  // Monitor de Servidores y Minecraft
  minecraft: {
    host: process.env.MINECRAFT_HOST || '192.168.1.24',
    port: parseInt(process.env.MINECRAFT_PORT, 10) || 25565
  },

  // Geolocalización y Meteorología por Defecto
  weather: {
    defaultCity: process.env.DEFAULT_CITY || 'Madrid',
    defaultLat: parseFloat(process.env.DEFAULT_LAT) || 40.4168,
    defaultLon: parseFloat(process.env.DEFAULT_LON) || -3.7038
  }
};
