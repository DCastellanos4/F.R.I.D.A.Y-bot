import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '.env') });

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
