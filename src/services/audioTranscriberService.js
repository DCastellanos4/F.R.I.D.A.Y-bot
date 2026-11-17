/**
 * audioTranscriberService.js - Servicio de Transcripcion de Audio con Fallback
 * Arquitectura: Whisper.cpp local como motor primario, con fallback automatico
 * a Groq Whisper API (whisper-large-v3-turbo) ante ausencia o fallo local.
 *
 * Strict Policy: Zero Emojis.
 */
import fs from 'fs';
import path from 'path';
import os from 'os';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

const WHISPER_BIN_DEFAULT = process.env.WHISPER_BIN || '/home/ubuntu/whisper.cpp/build/bin/whisper-cli';
const WHISPER_MODEL_DEFAULT = process.env.WHISPER_MODEL || '/home/ubuntu/whisper.cpp/models/ggml-base.bin';
const WHISPER_LANG_DEFAULT = process.env.WHISPER_LANG || 'es';

/**
 * Transcribe un buffer de audio localmente usando ffmpeg y whisper.cpp
 */
export async function transcribirAudioLocal(audioBuffer, deps = {}) {
  if (!audioBuffer || audioBuffer.length === 0) {
    return { ok: false, error: 'Buffer de audio vacio' };
  }

  const whisperBin = deps.whisperBin || process.env.WHISPER_BIN || WHISPER_BIN_DEFAULT;
  const whisperModel = deps.whisperModel || process.env.WHISPER_MODEL || WHISPER_MODEL_DEFAULT;
  const whisperLang = deps.whisperLang || process.env.WHISPER_LANG || WHISPER_LANG_DEFAULT;

  if (!fs.existsSync(whisperBin)) {
    return { ok: false, error: `whisper.cpp local no encontrado en ${whisperBin}` };
  }

  const tmpId = `voice_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
  const tmpOgg = path.join(os.tmpdir(), `${tmpId}.ogg`);
  const tmpWav = path.join(os.tmpdir(), `${tmpId}.wav`);

  try {
    fs.writeFileSync(tmpOgg, audioBuffer);

    await execFileAsync('ffmpeg', [
      '-y',
      '-i', tmpOgg,
      '-ar', '16000',
      '-ac', '1',
      '-c:a', 'pcm_s16le',
      tmpWav
    ]);

    const { stdout } = await execFileAsync(whisperBin, [
      '-m', whisperModel,
      '-f', tmpWav,
      '-l', whisperLang,
      '-nt',
      '-t', '4',
      '--no-prints'
    ]);

    const lineas = stdout.split('\n')
      .map(l => l.trim())
      .filter(l => l && !l.startsWith('read_audio_data:') && !l.startsWith('whisper_'));

    const textoTranscrito = lineas.join(' ').replace(/\s+/g, ' ').trim();

    if (!textoTranscrito) {
      return { ok: false, error: 'whisper.cpp devolvio salida vacia' };
    }

    return {
      ok: true,
      texto: textoTranscrito,
      proveedor: 'local'
    };
  } catch (err) {
    return {
      ok: false,
      error: `Error en transcribirAudioLocal: ${err.message}`
    };
  } finally {
    try { if (fs.existsSync(tmpOgg)) fs.unlinkSync(tmpOgg); } catch {}
    try { if (fs.existsSync(tmpWav)) fs.unlinkSync(tmpWav); } catch {}
  }
}

/**
 * Transcribe un buffer de audio usando Groq Whisper Cloud API (whisper-large-v3-turbo)
 */
export async function transcribirAudioConGroq(audioBuffer, deps = {}) {
  if (!audioBuffer || audioBuffer.length === 0) {
    return { ok: false, error: 'Buffer de audio vacio' };
  }

  const apiKey = deps.apiKey || deps.groqApiKey || process.env.GROQ_API_KEY;
  if (!apiKey) {
    return { ok: false, error: 'No hay GROQ_API_KEY configurada para fallback de transcripcion.' };
  }

  const baseUrl = (deps.baseUrl || process.env.GROQ_BASE_URL || 'https://api.groq.com/openai/v1').replace(/\/+$/, '');
  const model = deps.model || process.env.GROQ_WHISPER_MODEL || 'whisper-large-v3-turbo';
  const language = deps.language || deps.whisperLang || process.env.WHISPER_LANG || WHISPER_LANG_DEFAULT;
  const fetchFn = deps.fetchFn || globalThis.fetch;

  try {
    const formData = new FormData();
    const blob = new Blob([audioBuffer], { type: 'audio/ogg' });
    formData.append('file', blob, 'audio.ogg');
    formData.append('model', model);
    formData.append('language', language);
    formData.append('response_format', 'json');

    const res = await fetchFn(`${baseUrl}/audio/transcriptions`, {
      method: 'POST',
      headers: {
        'authorization': `Bearer ${apiKey}`,
        'user-agent': 'DAVIS-Audio-Transcriber'
      },
      body: formData
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      return { ok: false, error: `Groq Whisper API respondio ${res.status}: ${errText}` };
    }

    const data = await res.json();
    const texto = String(data?.text || '').trim();
    if (!texto) {
      return { ok: false, error: 'Groq Whisper devolvio texto vacio' };
    }

    return {
      ok: true,
      texto,
      proveedor: 'groq',
      modelo: model
    };
  } catch (err) {
    return { ok: false, error: `Error en Groq Whisper API: ${err.message}` };
  }
}

/**
 * Transcribe un buffer de audio con resiliencia: intenta primero local con whisper.cpp
 * y si falla o no esta disponible, recurre a Groq Whisper API (whisper-large-v3-turbo).
 */
export async function transcribirAudioBuffer(audioBuffer, deps = {}) {
  if (!audioBuffer || audioBuffer.length === 0) {
    return { ok: false, error: 'Buffer de audio vacio' };
  }

  // 1. Intento de transcripcion local
  const fnLocal = typeof deps.transcribirLocal === 'function' ? deps.transcribirLocal : transcribirAudioLocal;
  try {
    const resLocal = await fnLocal(audioBuffer, deps);
    if (resLocal && resLocal.ok && resLocal.texto && resLocal.texto.trim().length > 1) {
      return resLocal;
    }
  } catch (errLocal) {
    console.warn('[AudioTranscriber] Excepcion en Whisper local:', errLocal.message);
  }

  // 2. Fallback a Groq Whisper API (whisper-large-v3-turbo)
  const fnGroq = typeof deps.transcribirAudioConGroq === 'function'
    ? deps.transcribirAudioConGroq
    : (typeof deps.transcribirGroq === 'function' ? deps.transcribirGroq : transcribirAudioConGroq);

  const resGroq = await fnGroq(audioBuffer, deps);
  if (resGroq && resGroq.ok && resGroq.texto && resGroq.texto.trim().length > 1) {
    return resGroq;
  }

  return {
    ok: false,
    error: resGroq?.error || 'No se pudo transcribir el audio ni con Whisper local ni con Groq Whisper API'
  };
}

export const transcribirAudio = transcribirAudioBuffer;
