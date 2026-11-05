/**
 * Tactical Speech Synthesis and Push-To-Talk (PTT) Service
 * Fast speech synthesis using Edge-TTS and ffmpeg encoding to WhatsApp PTT
 * compatible OGG Opus audio stream.
 * Zero-emoji compliant.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import cp from 'node:child_process';
import crypto from 'node:crypto';
import { promisify } from 'node:util';

const execFile = promisify(cp.execFile);

/**
 * Magic bytes for OGG container format ('OggS').
 */
export const OGGS_MAGIC = Buffer.from([0x4f, 0x67, 0x67, 0x53]);

let cachedFfmpegPath = null;

/**
 * Resolves the ffmpeg executable location on the system.
 * Checks environment variable, PATH, and local WinGet/common directories.
 * @returns {string} Executable path or 'ffmpeg'
 */
export function getFfmpegPath() {
  if (cachedFfmpegPath) return cachedFfmpegPath;

  if (process.env.FFMPEG_PATH && fs.existsSync(process.env.FFMPEG_PATH)) {
    cachedFfmpegPath = process.env.FFMPEG_PATH;
    return cachedFfmpegPath;
  }

  // Check if available directly in current execution PATH
  try {
    const test = cp.spawnSync('ffmpeg', ['-version']);
    if (test.status === 0) {
      cachedFfmpegPath = 'ffmpeg';
      return cachedFfmpegPath;
    }
  } catch {
    // Continue searching known installation paths
  }

  // Check WinGet Packages in LocalAppData
  const localAppData = process.env.LOCALAPPDATA || '';
  if (localAppData) {
    const wingetBase = path.join(localAppData, 'Microsoft', 'WinGet', 'Packages');
    if (fs.existsSync(wingetBase)) {
      try {
        const pkgs = fs.readdirSync(wingetBase);
        for (const pkg of pkgs) {
          if (pkg.toLowerCase().includes('ffmpeg')) {
            const fullPkgDir = path.join(wingetBase, pkg);
            const candidateRoot = path.join(fullPkgDir, 'ffmpeg.exe');
            if (fs.existsSync(candidateRoot)) {
              cachedFfmpegPath = candidateRoot;
              return cachedFfmpegPath;
            }
            const subdirs = fs.readdirSync(fullPkgDir);
            for (const sub of subdirs) {
              const subPath = path.join(fullPkgDir, sub);
              if (fs.statSync(subPath).isDirectory()) {
                const candidateBin = path.join(subPath, 'bin', 'ffmpeg.exe');
                if (fs.existsSync(candidateBin)) {
                  cachedFfmpegPath = candidateBin;
                  return cachedFfmpegPath;
                }
                const candidateDirect = path.join(subPath, 'ffmpeg.exe');
                if (fs.existsSync(candidateDirect)) {
                  cachedFfmpegPath = candidateDirect;
                  return cachedFfmpegPath;
                }
              }
            }
          }
        }
      } catch {
        // Continue searching fallback paths
      }
    }
  }

  // Check standard Windows installations
  const commonLocations = [
    'C:\\Program Files\\ffmpeg\\bin\\ffmpeg.exe',
    'C:\\Program Files (x86)\\ffmpeg\\bin\\ffmpeg.exe',
    'C:\\ffmpeg\\bin\\ffmpeg.exe',
    'C:\\ProgramData\\chocolatey\\bin\\ffmpeg.exe'
  ];

  for (const loc of commonLocations) {
    if (fs.existsSync(loc)) {
      cachedFfmpegPath = loc;
      return cachedFfmpegPath;
    }
  }

  cachedFfmpegPath = 'ffmpeg';
  return cachedFfmpegPath;
}

/**
 * Synthesizes text into WhatsApp PTT compatible OGG Opus audio buffer.
 *
 * @param {string} text - Text to synthesize.
 * @param {object} [options] - Synthesis options.
 * @param {string} [options.voice='es-ES-AlvaroNeural'] - Voice model.
 * @param {string} [options.rate='+0%'] - Speech rate modulation.
 * @param {string} [options.pitch='+0Hz'] - Pitch modulation.
 * @param {string} [options.volume='+0%'] - Volume modulation.
 * @returns {Promise<Buffer>} OGG Opus audio buffer.
 */
export async function synthesizeSpeech(text, options = {}) {
  if (!text || typeof text !== 'string' || text.trim().length === 0) {
    throw new Error('El texto para sintesis de voz no puede estar vacio');
  }

  const voice = options.voice || 'es-ES-AlvaroNeural';
  const rate = options.rate || '+0%';
  const pitch = options.pitch || '+0Hz';
  const volume = options.volume || '+0%';

  const tmpId = crypto.randomUUID();
  const tmpText = path.join(os.tmpdir(), `davis_tts_${tmpId}.txt`);
  const tmpMp3 = path.join(os.tmpdir(), `davis_tts_${tmpId}.mp3`);
  const tmpOgg = path.join(os.tmpdir(), `davis_tts_${tmpId}.ogg`);

  const ffmpegBin = getFfmpegPath();

  try {
    // Write text to UTF-8 file to prevent command line argument escaping bugs
    await fs.promises.writeFile(tmpText, text.trim(), 'utf8');

    // Run Edge-TTS via python CLI
    const pythonBin = process.env.PYTHON_PATH || 'python';
    const edgeTtsArgs = [
      '-m',
      'edge_tts',
      '--voice',
      voice,
      '--rate',
      rate,
      '--pitch',
      pitch,
      '--volume',
      volume,
      '--file',
      tmpText,
      '--write-media',
      tmpMp3
    ];

    try {
      await execFile(pythonBin, edgeTtsArgs);
    } catch (edgeErr) {
      throw new Error(`Fallo en el motor Edge-TTS: ${edgeErr.message}`);
    }

    // Convert MP3 to WhatsApp PTT compatible OGG Opus container with ffmpeg
    // -c:a libopus -b:a 32k -vbr on -application voip
    const ffmpegArgs = [
      '-y',
      '-i',
      tmpMp3,
      '-c:a',
      'libopus',
      '-b:a',
      '32k',
      '-vbr',
      'on',
      '-application',
      'voip',
      tmpOgg
    ];

    try {
      await execFile(ffmpegBin, ffmpegArgs);
    } catch (ffErr) {
      throw new Error(`Fallo en la conversion de audio con ffmpeg: ${ffErr.message}`);
    }

    const audioBuffer = await fs.promises.readFile(tmpOgg);

    // Verify OggS header magic bytes
    if (audioBuffer.length < 4 || !audioBuffer.subarray(0, 4).equals(OGGS_MAGIC)) {
      throw new Error('El buffer generado no contiene la cabecera OggS valida');
    }

    return audioBuffer;
  } finally {
    // Clean up all temporary files
    await Promise.allSettled([
      fs.promises.unlink(tmpText).catch(() => {}),
      fs.promises.unlink(tmpMp3).catch(() => {}),
      fs.promises.unlink(tmpOgg).catch(() => {})
    ]);
  }
}

/**
 * Dispatches an outbound voice note with PTT flags to WhatsApp via Baileys socket.
 *
 * @param {object} sock - Active Baileys WASocket instance.
 * @param {string} remoteJid - Target remote JID.
 * @param {Buffer} audioBuffer - OGG Opus audio buffer.
 * @param {object} [quotedMsg] - Optional message to quote.
 * @param {object} [extraOptions] - Optional additional message options.
 * @returns {Promise<object>} Baileys sendMessage result.
 */
export async function sendVoiceNote(sock, remoteJid, audioBuffer, quotedMsg, extraOptions = {}) {
  if (!sock || typeof sock.sendMessage !== 'function') {
    throw new Error('Socket de Baileys no valido o no proporcionado');
  }
  if (!remoteJid || typeof remoteJid !== 'string' || remoteJid.trim().length === 0) {
    throw new Error('JID de destino no valido o vacio');
  }
  if (!Buffer.isBuffer(audioBuffer) || audioBuffer.length === 0) {
    throw new Error('Buffer de audio no valido o vacio');
  }

  // Verify OggS magic bytes
  if (audioBuffer.length < 4 || !audioBuffer.subarray(0, 4).equals(OGGS_MAGIC)) {
    throw new Error('El buffer de audio no tiene formato OGG Opus valido (falta cabecera OggS)');
  }

  const payload = {
    audio: audioBuffer,
    mimetype: 'audio/ogg; codecs=opus',
    ptt: true
  };

  const options = {
    ...(quotedMsg ? { quoted: quotedMsg } : {}),
    ...extraOptions
  };

  return await sock.sendMessage(remoteJid, payload, options);
}
