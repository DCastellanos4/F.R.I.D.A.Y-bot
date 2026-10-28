import fs from 'fs';
import path from 'path';
import os from 'os';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

const WHISPER_BIN = process.env.WHISPER_BIN || '/home/ubuntu/whisper.cpp/build/bin/whisper-cli';
const WHISPER_MODEL = process.env.WHISPER_MODEL || '/home/ubuntu/whisper.cpp/models/ggml-base.bin';

/**
 * Convierte un buffer de audio (OGG/Opus de WhatsApp) a WAV 16kHz mono y lo transcribe localmente con Whisper
 */
export async function transcribirAudioBuffer(audioBuffer) {
  if (!audioBuffer || audioBuffer.length === 0) {
    return { ok: false, error: 'Buffer de audio vacío' };
  }

  const tmpId = `voice_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
  const tmpOgg = path.join(os.tmpdir(), `${tmpId}.ogg`);
  const tmpWav = path.join(os.tmpdir(), `${tmpId}.wav`);

  try {
    // 1. Escribir archivo OGG temporal
    fs.writeFileSync(tmpOgg, audioBuffer);

    // 2. Convertir a WAV 16kHz mono PCM con ffmpeg
    await execFileAsync('ffmpeg', [
      '-y',
      '-i', tmpOgg,
      '-ar', '16000',
      '-ac', '1',
      '-c:a', 'pcm_s16le',
      tmpWav
    ]);

    // 3. Ejecutar transcripción con whisper.cpp
    const { stdout } = await execFileAsync(WHISPER_BIN, [
      '-m', WHISPER_MODEL,
      '-f', tmpWav,
      '-l', 'auto',
      '-nt',
      '-t', '4',
      '--no-prints'
    ]);

    // 4. Limpiar salida
    const lineas = stdout.split('\n')
      .map(l => l.trim())
      .filter(l => l && !l.startsWith('read_audio_data:') && !l.startsWith('whisper_'));

    const textoTranscrito = lineas.join(' ').replace(/\s+/g, ' ').trim();

    return {
      ok: true,
      texto: textoTranscrito
    };
  } catch (err) {
    console.error('[Error] Error en transcribirAudioBuffer:', err.message);
    return {
      ok: false,
      error: err.message
    };
  } finally {
    // 5. Eliminar archivos temporales
    try { if (fs.existsSync(tmpOgg)) fs.unlinkSync(tmpOgg); } catch {}
    try { if (fs.existsSync(tmpWav)) fs.unlinkSync(tmpWav); } catch {}
  }
}
