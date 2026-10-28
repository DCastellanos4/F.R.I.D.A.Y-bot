import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const WHATSAPP_MAX_INLINE_BYTES = 16 * 1024 * 1024; // 16 MB limit
const TEMP_DOWNLOADS_DIR = path.join(__dirname, 'data', 'temp_downloads');

const EMOJI_FILTER_REGEX = /\p{Extended_Pictographic}/gu;

export const YOUTUBE_REGEX = /(?:https?:\/\/)?(?:www\.|m\.)?(?:youtube\.com\/(?:watch\?(?:[^\s]*&)?v=|shorts\/|v\/|embed\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/i;
export const INSTAGRAM_REGEX = /(?:https?:\/\/)?(?:www\.)?instagram\.com\/(?:p|reel|reels|tv)\/([a-zA-Z0-9_-]+)/i;
export const TIKTOK_REGEX = /(?:https?:\/\/)?(?:(?:www\.|m\.)?tiktok\.com\/@[a-zA-Z0-9_.-]+\/video\/\d+|(?:vm|vt)\.tiktok\.com\/[a-zA-Z0-9]+|(?:www\.|m\.)?tiktok\.com\/t\/[a-zA-Z0-9]+)/i;
export const GENERAL_MEDIA_REGEX = /(?:https?:\/\/)?(?:[a-zA-Z0-9-]+\.)?(youtube\.com|youtu\.be|instagram\.com|tiktok\.com)\/\S+/i;

let cachedFfmpegPath = null;

/**
 * Ensures temporary download directory exists.
 * @returns {string} Path to temp directory
 */
export function ensureTempDir() {
  try {
    if (!fs.existsSync(TEMP_DOWNLOADS_DIR)) {
      fs.mkdirSync(TEMP_DOWNLOADS_DIR, { recursive: true });
    }
    return TEMP_DOWNLOADS_DIR;
  } catch {
    return os.tmpdir();
  }
}

/**
 * Discovers and caches the best available FFmpeg binary on host system.
 * Supports environment variables, Windows imageio-ffmpeg binaries, and system PATH.
 * @returns {string} Executable path or 'ffmpeg' command
 */
export function getFfmpegPath() {
  if (cachedFfmpegPath) {
    return cachedFfmpegPath;
  }

  if (process.env.FFMPEG_PATH && fs.existsSync(process.env.FFMPEG_PATH)) {
    cachedFfmpegPath = process.env.FFMPEG_PATH;
    return cachedFfmpegPath;
  }

  const winImageioPath = 'C:\\Users\\David\\AppData\\Roaming\\Python\\Python315\\site-packages\\imageio_ffmpeg\\binaries\\ffmpeg-win-x86_64-v7.1.exe';
  if (fs.existsSync(winImageioPath)) {
    cachedFfmpegPath = winImageioPath;
    return cachedFfmpegPath;
  }

  try {
    const pyCheck = execFileSync('python', ['-c', 'import shutil; print(shutil.which("ffmpeg") or "")'], {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'ignore'],
      windowsHide: true
    }).trim();
    if (pyCheck && fs.existsSync(pyCheck)) {
      cachedFfmpegPath = pyCheck;
      return cachedFfmpegPath;
    }
  } catch {
    // continue fallback
  }

  try {
    const pyImageio = execFileSync('python', ['-c', 'import imageio_ffmpeg; print(imageio_ffmpeg.get_ffmpeg_exe())'], {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'ignore'],
      windowsHide: true
    }).trim();
    if (pyImageio && fs.existsSync(pyImageio)) {
      cachedFfmpegPath = pyImageio;
      return cachedFfmpegPath;
    }
  } catch {
    // continue fallback
  }

  cachedFfmpegPath = 'ffmpeg';
  return cachedFfmpegPath;
}

/**
 * Strips emoji characters to enforce strict zero-emoji policy.
 * @param {string} str - Raw text
 * @returns {string} Sanitized text
 */
export function sanitizeText(str) {
  if (typeof str !== 'string') return '';
  return str.replace(EMOJI_FILTER_REGEX, '').trim();
}

/**
 * Validates whether the given text contains a supported media URL (YouTube, Reels, TikTok).
 * @param {string} text - Message text or candidate URL
 * @returns {boolean} True if supported media link found
 */
export function isMediaUrl(text) {
  if (!text || typeof text !== 'string') return false;
  const trimmed = text.trim();
  return (
    YOUTUBE_REGEX.test(trimmed) ||
    INSTAGRAM_REGEX.test(trimmed) ||
    TIKTOK_REGEX.test(trimmed) ||
    GENERAL_MEDIA_REGEX.test(trimmed)
  );
}

/**
 * Extracts and canonicalizes the first supported media URL from freeform text.
 * @param {string} text - Message text
 * @returns {string|null} Normalized URL or null
 */
export function extractMediaUrl(text) {
  if (!text || typeof text !== 'string') return null;
  const match =
    text.match(YOUTUBE_REGEX) ||
    text.match(INSTAGRAM_REGEX) ||
    text.match(TIKTOK_REGEX) ||
    text.match(GENERAL_MEDIA_REGEX);

  if (!match) return null;
  let rawUrl = match[0].trim();
  rawUrl = rawUrl.replace(/[.,!?:;)\]]+$/, '');
  if (!/^https?:\/\//i.test(rawUrl)) {
    rawUrl = 'https://' + rawUrl;
  }
  return rawUrl;
}

/**
 * Compresses oversized video using FFmpeg to comply with WhatsApp 16 MB limit.
 * Applies multi-pass ladder: 720p (CRF 28) -> 480p (CRF 32).
 * @param {string} inputPath - Source video path
 * @param {number} [targetLimitBytes] - Threshold in bytes
 * @returns {Promise<{ path: string, size: number, asDocument: boolean }>}
 */
export async function compressVideoToLimit(inputPath, targetLimitBytes = WHATSAPP_MAX_INLINE_BYTES) {
  const ffmpegBin = getFfmpegPath();
  const dir = path.dirname(inputPath);
  const ext = path.extname(inputPath);
  const base = path.basename(inputPath, ext);

  const outPass1 = path.join(dir, `${base}_c720.mp4`);
  try {
    await execFileAsync(ffmpegBin, [
      '-y',
      '-i', inputPath,
      '-vf', 'scale=-2:720',
      '-c:v', 'libx264',
      '-crf', '28',
      '-preset', 'fast',
      '-c:a', 'aac',
      '-b:a', '128k',
      '-movflags', '+faststart',
      outPass1
    ], { windowsHide: true });

    const stat1 = await fs.promises.stat(outPass1);
    if (stat1.size <= targetLimitBytes) {
      return { path: outPass1, size: stat1.size, asDocument: false };
    }

    const outPass2 = path.join(dir, `${base}_c480.mp4`);
    await execFileAsync(ffmpegBin, [
      '-y',
      '-i', inputPath,
      '-vf', 'scale=-2:480',
      '-c:v', 'libx264',
      '-crf', '32',
      '-preset', 'fast',
      '-c:a', 'aac',
      '-b:a', '96k',
      '-movflags', '+faststart',
      outPass2
    ], { windowsHide: true });

    const stat2 = await fs.promises.stat(outPass2);
    await fs.promises.unlink(outPass1).catch(() => {});

    if (stat2.size <= targetLimitBytes) {
      return { path: outPass2, size: stat2.size, asDocument: false };
    }

    return { path: outPass2, size: stat2.size, asDocument: true };
  } catch {
    const statOrig = await fs.promises.stat(inputPath).catch(() => ({ size: 0 }));
    return {
      path: inputPath,
      size: statOrig.size,
      asDocument: statOrig.size > targetLimitBytes
    };
  }
}

/**
 * Downloads media from supported URL using python -m yt_dlp and FFmpeg post-processing.
 * @param {string} rawUrl - Target URL or text containing URL
 * @param {object} [options] - Configuration options
 * @param {'video'|'audio'} [options.format] - Target media type (default 'video')
 * @param {boolean} [options.audioOnly] - If true, extracts MP3 audio
 * @param {number} [options.maxSizeBytes] - WhatsApp threshold (default 16MB)
 * @param {string} [options.outputPath] - Custom output directory
 * @param {number} [options.timeoutMs] - Command timeout in ms
 * @returns {Promise<object>} Result contract or error object
 */
export async function downloadMedia(rawUrl, options = {}) {
  if (!rawUrl || typeof rawUrl !== 'string') {
    return { ok: false, error: 'URL no proporcionada o invalida' };
  }

  const extractedUrl = extractMediaUrl(rawUrl);
  const cleanUrl = extractedUrl || rawUrl.trim();

  if (!cleanUrl.startsWith('http://') && !cleanUrl.startsWith('https://')) {
    return { ok: false, error: 'URL no valida o protocolo no soportado: ' + sanitizeText(rawUrl) };
  }

  const isAudio = options.format === 'audio' || Boolean(options.audioOnly);
  const mediaType = isAudio ? 'audio' : 'video';
  const targetDir = options.outputPath || ensureTempDir();
  const maxLimit = options.maxSizeBytes || WHATSAPP_MAX_INLINE_BYTES;
  const timeoutMs = options.timeoutMs || 120000;

  const jobId = `media_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  const outTemplate = path.join(targetDir, `${jobId}.%(ext)s`);

  const ffmpegBin = getFfmpegPath();
  const pyArgs = [
    '-m', 'yt_dlp',
    '--no-playlist',
    '--no-warnings',
    '--no-call-home'
  ];

  if (ffmpegBin) {
    pyArgs.push('--ffmpeg-location', ffmpegBin);
  }

  if (isAudio) {
    pyArgs.push('-x', '--audio-format', 'mp3');
  } else {
    pyArgs.push(
      '-f', 'bestvideo[height<=720][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<=720]+bestaudio/best[height<=720][ext=mp4]/best[height<=720]/best',
      '--merge-output-format', 'mp4',
      '--postprocessor-args', 'ffmpeg:-movflags +faststart'
    );
  }

  pyArgs.push('-o', outTemplate, cleanUrl);

  try {
    await execFileAsync('python', pyArgs, {
      timeout: timeoutMs,
      windowsHide: true,
      maxBuffer: 10 * 1024 * 1024
    });
  } catch (err) {
    const rawMsg = err.stderr || err.stdout || err.message || 'Error desconocido al descargar';
    const cleanErr = sanitizeText(String(rawMsg).slice(0, 300));
    return {
      ok: false,
      error: `Error al descargar contenido multimedia: ${cleanErr}`
    };
  }

  let finalPath = null;
  try {
    const files = await fs.promises.readdir(targetDir);
    const matched = files.filter(f => f.startsWith(jobId));
    if (matched.length > 0) {
      const finished = matched.filter(f => !f.endsWith('.part') && !f.endsWith('.temp') && !f.endsWith('.ytdl'));
      const picked = finished.length > 0 ? finished[0] : matched[0];
      finalPath = path.join(targetDir, picked);
    }
  } catch (err) {
    return { ok: false, error: 'Error al acceder a directorio temporal: ' + sanitizeText(err.message) };
  }

  if (!finalPath || !fs.existsSync(finalPath)) {
    return { ok: false, error: 'No se encontro el archivo descargado en disco' };
  }

  let finalStat = await fs.promises.stat(finalPath);
  let asDocument = false;

  if (mediaType === 'video' && finalStat.size > maxLimit) {
    const compResult = await compressVideoToLimit(finalPath, maxLimit);
    if (compResult.path !== finalPath) {
      await fs.promises.unlink(finalPath).catch(() => {});
      finalPath = compResult.path;
      finalStat = await fs.promises.stat(finalPath);
    }
    asDocument = compResult.asDocument;
  }

  const ext = path.extname(finalPath).toLowerCase();
  let mimeType = 'application/octet-stream';
  if (mediaType === 'audio') {
    if (ext === '.mp3') mimeType = 'audio/mpeg';
    else if (ext === '.m4a') mimeType = 'audio/mp4';
    else if (ext === '.webm') mimeType = 'audio/webm';
    else mimeType = 'audio/mpeg';
  } else {
    mimeType = 'video/mp4';
  }

  const buffer = await fs.promises.readFile(finalPath);
  const fileName = sanitizeText(path.basename(finalPath));

  const cleanup = async () => {
    if (finalPath && fs.existsSync(finalPath)) {
      await fs.promises.unlink(finalPath).catch(() => {});
    }
  };

  return {
    ok: true,
    filePath: finalPath,
    buffer,
    mediaType,
    mimeType,
    fileName,
    fileSize: buffer.length,
    asDocument,
    cleanup
  };
}

/**
 * Sends downloaded media through Baileys socket enforcing WhatsApp inline limits.
 * Falls back to document presentation if size exceeds 16 MB.
 * @param {object} sock - Baileys WASocket instance
 * @param {string} remoteJid - Destination JID
 * @param {object} mediaResult - Object returned by downloadMedia
 * @param {object} [quotedMsg] - Optional message to quote
 * @returns {Promise<object>} Sent message result
 */
export async function sendMediaMessage(sock, remoteJid, mediaResult, quotedMsg = undefined) {
  if (!sock || !remoteJid) {
    throw new Error('Socket y remoteJid son requeridos');
  }

  if (!mediaResult || mediaResult.ok === false) {
    const errorMsg = mediaResult?.error || 'No se pudo descargar el archivo multimedia';
    const payload = {
      text: `Error al procesar el archivo multimedia: ${sanitizeText(errorMsg)}`
    };
    return await sock.sendMessage(remoteJid, payload, quotedMsg ? { quoted: quotedMsg } : {});
  }

  let payload;
  const targetBuffer = mediaResult.buffer || (mediaResult.filePath ? await fs.promises.readFile(mediaResult.filePath) : null);

  if (mediaResult.mediaType === 'audio') {
    payload = {
      audio: targetBuffer || { url: mediaResult.filePath },
      mimetype: mediaResult.mimeType || 'audio/mpeg',
      fileName: mediaResult.fileName || 'audio.mp3'
    };
  } else {
    const caption = sanitizeText(mediaResult.title || mediaResult.caption || 'Video procesado para entrega directa');
    const isDoc = Boolean(mediaResult.asDocument || (targetBuffer && targetBuffer.length > WHATSAPP_MAX_INLINE_BYTES));

    if (isDoc) {
      payload = {
        document: targetBuffer || { url: mediaResult.filePath },
        mimetype: mediaResult.mimeType || 'video/mp4',
        fileName: mediaResult.fileName || 'video.mp4',
        caption
      };
    } else {
      payload = {
        video: targetBuffer || { url: mediaResult.filePath },
        mimetype: mediaResult.mimeType || 'video/mp4',
        caption
      };
    }
  }

  const sendOptions = quotedMsg ? { quoted: quotedMsg } : {};
  const sent = await sock.sendMessage(remoteJid, payload, sendOptions);

  if (typeof mediaResult.cleanup === 'function') {
    await mediaResult.cleanup().catch(() => {});
  }

  return sent;
}

/**
 * Safely removes a single temporary media file from disk.
 * @param {string} filePath - Absolute path to delete
 */
export async function cleanupMediaFile(filePath) {
  if (!filePath || typeof filePath !== 'string') return;
  try {
    if (fs.existsSync(filePath)) {
      await fs.promises.unlink(filePath);
    }
  } catch {
    // Ignore cleanup error
  }
}

/**
 * Cleans expired files from the temporary downloads directory.
 * @param {number} [maxAgeMs=3600000] - Expiration threshold in milliseconds
 */
export async function cleanTempDownloads(maxAgeMs = 3600000) {
  const dir = ensureTempDir();
  try {
    const files = await fs.promises.readdir(dir);
    const now = Date.now();
    for (const f of files) {
      const full = path.join(dir, f);
      try {
        const st = await fs.promises.stat(full);
        if (now - st.mtimeMs > maxAgeMs) {
          await fs.promises.unlink(full);
        }
      } catch {
        // Ignore single file unlink error
      }
    }
  } catch {
    // Ignore dir read error
  }
}
