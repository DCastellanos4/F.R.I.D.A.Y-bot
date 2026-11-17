/**
 * voiceService.js - Servicio de voz y transcripcion de audio
 * Redirige a audioTranscriberService.js para proporcionar transcripcion local
 * con fallback a Groq Whisper API (whisper-large-v3-turbo).
 *
 * Strict Policy: Zero Emojis.
 */
export {
  transcribirAudioLocal,
  transcribirAudioConGroq,
  transcribirAudioBuffer,
  transcribirAudio
} from './audioTranscriberService.js';
