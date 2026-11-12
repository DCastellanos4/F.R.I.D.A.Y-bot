#!/usr/bin/env node
/**
 * index.js - Micro-servidor MCP mcp-server-media para D.A.V.I.S.
 *
 * Implementa el protocolo Model Context Protocol (MCP) sobre JSON-RPC 2.0 por stdio.
 * Proporciona herramientas de procesamiento multimedia: descarga con yt-dlp,
 * transcripcion de audio con Whisper local y sintesis de voz Edge-TTS en formato OGG Opus.
 *
 * Herramientas expuestas:
 *   - descargar_multimedia: extractor yt-dlp con limite de tamano
 *   - transcribir_audio: interfaz con whisper local
 *   - sintetizar_voz: sintesis de voz Edge-TTS en formato OGG Opus
 *
 * Strict Policy: Zero Emojis.
 */
import readline from 'node:readline';
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

const execFileAsync = promisify(execFile);

export const WHATSAPP_MAX_INLINE_BYTES = 16 * 1024 * 1024; // 16 MB
export const OGGS_MAGIC = Buffer.from([0x4f, 0x67, 0x67, 0x53]); // 'OggS'

let cachedFfmpegPath = null;

/**
 * Localiza el ejecutable de ffmpeg en el sistema anfitrion.
 */
export function getFfmpegExecutable() {
  if (cachedFfmpegPath && fs.existsSync(cachedFfmpegPath)) {
    return cachedFfmpegPath;
  }

  if (process.env.FFMPEG_PATH && fs.existsSync(process.env.FFMPEG_PATH)) {
    cachedFfmpegPath = process.env.FFMPEG_PATH;
    return cachedFfmpegPath;
  }

  // Comprobar localAppData WinGet paquetes
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
              }
            }
          }
        }
      } catch (_) {}
    }
  }

  // Comprobar en PATH del sistema
  try {
    const probe = execFileSync('ffmpeg', ['-version'], { windowsHide: true, stdio: 'ignore' });
    cachedFfmpegPath = 'ffmpeg';
    return cachedFfmpegPath;
  } catch (_) {}

  return 'ffmpeg';
}

/**
 * Determina el comando para invocar yt-dlp (binario en PATH o modulo python).
 */
export function getYtDlpCommand() {
  if (process.env.YTDLP_PATH && fs.existsSync(process.env.YTDLP_PATH)) {
    return { bin: process.env.YTDLP_PATH, prefixArgs: [] };
  }

  try {
    execFileSync('yt-dlp', ['--version'], { windowsHide: true, stdio: 'ignore' });
    return { bin: 'yt-dlp', prefixArgs: [] };
  } catch (_) {}

  // Fallback a modulo de Python
  try {
    execFileSync('python', ['-c', 'import yt_dlp'], { windowsHide: true, stdio: 'ignore' });
    return { bin: 'python', prefixArgs: ['-m', 'yt_dlp'] };
  } catch (_) {}

  return null;
}

/**
 * Determina el comando para invocar edge-tts (binario en PATH o modulo python).
 */
export function getEdgeTtsCommand() {
  if (process.env.EDGETTS_BIN && fs.existsSync(process.env.EDGETTS_BIN)) {
    return { bin: process.env.EDGETTS_BIN, prefixArgs: [] };
  }

  try {
    execFileSync('edge-tts', ['--version'], { windowsHide: true, stdio: 'ignore' });
    return { bin: 'edge-tts', prefixArgs: [] };
  } catch (_) {}

  // Fallback a modulo de Python
  try {
    execFileSync('python', ['-c', 'import edge_tts'], { windowsHide: true, stdio: 'ignore' });
    return { bin: 'python', prefixArgs: ['-m', 'edge_tts'] };
  } catch (_) {}

  return null;
}

/**
 * Determina la ruta al binario ejecutable de Whisper.
 */
export function getWhisperExecutable() {
  if (process.env.WHISPER_BIN && fs.existsSync(process.env.WHISPER_BIN)) {
    return process.env.WHISPER_BIN;
  }

  for (const nombre of ['whisper-cli', 'whisper', 'whisper.exe']) {
    try {
      execFileSync(nombre, ['--help'], { windowsHide: true, stdio: 'ignore' });
      return nombre;
    } catch (_) {}
  }

  return null;
}

/**
 * Limpia emojis y caracteres graficos del texto.
 */
export function sanitizarTexto(texto) {
  if (!texto || typeof texto !== 'string') return '';
  return texto
    .replace(/\p{Extended_Pictographic}/gu, '')
    .replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}]/gu, '')
    .trim();
}

/**
 * Descarga multimedia o extrae metadatos con yt-dlp respetando limite estricto de tamano.
 */
export async function descargarMultimedia({
  url,
  formato = 'video',
  max_bytes = WHATSAPP_MAX_INLINE_BYTES,
  solo_info = false,
  directorio_salida,
  ytDlpFn
} = {}) {
  if (!url || typeof url !== 'string' || !/^https?:\/\/\S+/i.test(url.trim())) {
    throw new Error('El parametro url es obligatorio y debe ser una URL valida (http/https)');
  }

  const urlLimpia = url.trim();
  const maxBytesLimite = Number(max_bytes) > 0 ? Number(max_bytes) : WHATSAPP_MAX_INLINE_BYTES;

  // Si se inyecta una funcion para pruebas unitarias
  if (typeof ytDlpFn === 'function') {
    return ytDlpFn({ url: urlLimpia, formato, max_bytes: maxBytesLimite, solo_info });
  }

  const cmd = getYtDlpCommand();
  if (!cmd) {
    throw new Error('yt-dlp no esta disponible en el entorno del sistema (se requiere binario yt-dlp o modulo python yt_dlp)');
  }

  if (solo_info) {
    const args = [...cmd.prefixArgs, '--dump-json', '--no-warnings', '--skip-download', urlLimpia];
    const { stdout } = await execFileAsync(cmd.bin, args, { windowsHide: true, timeout: 20000 });
    const info = JSON.parse(stdout);
    return {
      ok: true,
      titulo: info.title || 'Sin titulo',
      duracion: info.duration || null,
      uploader: info.uploader || null,
      formato: formato,
      tamano_bytes: info.filesize || info.filesize_approx || null,
      solo_info: true
    };
  }

  const targetDir = directorio_salida || os.tmpdir();
  fs.mkdirSync(targetDir, { recursive: true });

  const idTemp = `media_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
  const outTemplate = path.join(targetDir, `${idTemp}.%(ext)s`);

  const args = [
    ...cmd.prefixArgs,
    '--no-warnings',
    '--max-filesize', `${maxBytesLimite}`,
    '-o', outTemplate
  ];

  if (formato === 'audio') {
    args.push('-x', '--audio-format', 'mp3');
  } else {
    args.push('-f', 'mp4/bestvideo+bestaudio/best');
  }
  args.push(urlLimpia);

  try {
    const { stdout } = await execFileAsync(cmd.bin, args, { windowsHide: true, timeout: 60000 });

    // Localizar el archivo descargado
    const archivos = fs.readdirSync(targetDir);
    const coincidencia = archivos.find((f) => f.startsWith(idTemp));

    if (!coincidencia) {
      throw new Error('yt-dlp completo la ejecucion pero no se encontro el archivo descargado');
    }

    const rutaDescarga = path.join(targetDir, coincidencia);
    const stat = fs.statSync(rutaDescarga);

    if (stat.size > maxBytesLimite) {
      try { fs.unlinkSync(rutaDescarga); } catch (_) {}
      throw new Error(`El archivo descargado (${stat.size} bytes) supero el limite maximo permitido de ${maxBytesLimite} bytes`);
    }

    return {
      ok: true,
      archivo_ruta: rutaDescarga,
      tamano_bytes: stat.size,
      formato,
      url: urlLimpia
    };
  } catch (err) {
    throw new Error(`Fallo en la descarga con yt-dlp: ${err.message}`);
  }
}

/**
 * Transcribe un archivo o buffer de audio con Whisper local.
 */
export async function transcribirAudio({
  ruta_archivo,
  audio_base64,
  idioma = 'es',
  modelo,
  whisperFn
} = {}) {
  if (!ruta_archivo && !audio_base64) {
    throw new Error('Debe proporcionar ruta_archivo o audio_base64 para transcribir');
  }

  // Soporte de inyeccion para pruebas unitarias
  if (typeof whisperFn === 'function') {
    return whisperFn({ ruta_archivo, audio_base64, idioma, modelo });
  }

  const whisperBin = getWhisperExecutable();
  if (!whisperBin) {
    throw new Error('Binario ejecutable de Whisper no encontrado en el sistema');
  }

  const tmpId = `voice_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
  const tmpDir = os.tmpdir();
  let tmpAudioInput = ruta_archivo;
  let tmpWav = path.join(tmpDir, `${tmpId}.wav`);
  let archivoTemporalCreado = false;

  try {
    if (audio_base64) {
      tmpAudioInput = path.join(tmpDir, `${tmpId}.input`);
      fs.writeFileSync(tmpAudioInput, Buffer.from(audio_base64, 'base64'));
      archivoTemporalCreado = true;
    } else if (!fs.existsSync(ruta_archivo)) {
      throw new Error(`El archivo de audio no existe: ${ruta_archivo}`);
    }

    const ffmpegBin = getFfmpegExecutable();

    // Convertir a WAV 16kHz mono PCM compatible con Whisper
    await execFileAsync(ffmpegBin, [
      '-y',
      '-i', tmpAudioInput,
      '-ar', '16000',
      '-ac', '1',
      '-c:a', 'pcm_s16le',
      tmpWav
    ], { windowsHide: true, timeout: 20000 });

    const whisperModel = modelo || process.env.WHISPER_MODEL || '/usr/local/share/whisper/models/ggml-base.bin';

    const args = [
      '-m', whisperModel,
      '-f', tmpWav,
      '-l', idioma,
      '-nt',
      '--no-prints'
    ];

    const { stdout } = await execFileAsync(whisperBin, args, { windowsHide: true, timeout: 45000 });

    const lineas = stdout.split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('read_audio_data:') && !l.startsWith('whisper_'));

    const textoTranscrito = lineas.join(' ').replace(/\s+/g, ' ').trim();

    return {
      ok: true,
      texto: textoTranscrito,
      idioma,
      archivo: ruta_archivo || 'base64_audio'
    };
  } finally {
    try {
      if (archivoTemporalCreado && fs.existsSync(tmpAudioInput)) fs.unlinkSync(tmpAudioInput);
      if (fs.existsSync(tmpWav)) fs.unlinkSync(tmpWav);
    } catch (_) {}
  }
}

/**
 * Sintetiza voz a partir de texto utilizando Edge-TTS y codifica a OGG Opus.
 */
export async function sintetizarVoz({
  texto,
  voz = 'es-ES-AlvaroNeural',
  formato_salida = 'ogg_opus',
  ruta_salida,
  retornar_base64 = false,
  edgeTtsFn
} = {}) {
  const textoLimpio = sanitizarTexto(texto);
  if (!textoLimpio) {
    throw new Error('El parametro texto es obligatorio y no puede estar vacio');
  }

  // Soporte de inyeccion para pruebas unitarias
  if (typeof edgeTtsFn === 'function') {
    return edgeTtsFn({ texto: textoLimpio, voz, formato_salida, ruta_salida, retornar_base64 });
  }

  const cmd = getEdgeTtsCommand();
  if (!cmd) {
    throw new Error('edge-tts no esta disponible en el entorno del sistema (se requiere binario edge-tts o modulo python edge_tts)');
  }

  const ffmpegBin = getFfmpegExecutable();
  const tmpId = `tts_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
  const tmpDir = os.tmpdir();
  const tmpMp3 = path.join(tmpDir, `${tmpId}.mp3`);
  const destinoOgg = ruta_salida || path.join(tmpDir, `${tmpId}.ogg`);

  try {
    // 1. Sintesis directa con edge-tts a MP3 temporal
    const argsEdge = [
      ...cmd.prefixArgs,
      '-t', textoLimpio,
      '-v', voz,
      '--write-media', tmpMp3
    ];
    await execFileAsync(cmd.bin, argsEdge, { windowsHide: true, timeout: 30000 });

    if (!fs.existsSync(tmpMp3) || fs.statSync(tmpMp3).size === 0) {
      throw new Error('edge-tts no genero el archivo de audio esperado');
    }

    // 2. Transcodificacion a OGG Opus (compatible WhatsApp / PTT)
    await execFileAsync(ffmpegBin, [
      '-y',
      '-i', tmpMp3,
      '-c:a', 'libopus',
      '-b:a', '32k',
      '-vbr', 'on',
      '-application', 'voip',
      destinoOgg
    ], { windowsHide: true, timeout: 20000 });

    if (!fs.existsSync(destinoOgg)) {
      throw new Error('ffmpeg no pudo generar el archivo de salida OGG Opus');
    }

    const stat = fs.statSync(destinoOgg);
    const buf = fs.readFileSync(destinoOgg);

    // Verificar cabecera 'OggS'
    const esOggValido = buf.subarray(0, 4).equals(OGGS_MAGIC);
    if (!esOggValido) {
      throw new Error('El archivo generado no contiene la cabecera OggS valida');
    }

    const resultado = {
      ok: true,
      ruta_archivo: destinoOgg,
      tamano_bytes: stat.size,
      formato: 'ogg_opus',
      voz
    };

    if (retornar_base64) {
      resultado.audio_base64 = buf.toString('base64');
    }

    return resultado;
  } finally {
    try {
      if (fs.existsSync(tmpMp3)) fs.unlinkSync(tmpMp3);
    } catch (_) {}
  }
}

export const TOOLS_SCHEMA = [
  {
    name: 'descargar_multimedia',
    description: 'Extractor multimedia con yt-dlp con limite de tamano para descargas de audio y video.',
    inputSchema: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'URL del video o contenido multimedia (YouTube, TikTok, etc.)'
        },
        formato: {
          type: 'string',
          enum: ['video', 'audio'],
          description: 'Formato deseado de descarga (video o audio)'
        },
        max_bytes: {
          type: 'number',
          description: 'Limite maximo de tamano de archivo en bytes (defecto: 16 MB)'
        },
        solo_info: {
          type: 'boolean',
          description: 'Si es true, solo extrae metadatos sin descargar el archivo'
        }
      },
      required: ['url']
    }
  },
  {
    name: 'transcribir_audio',
    description: 'Interfaz con Whisper local para transcripcion automatica de audio a texto.',
    inputSchema: {
      type: 'object',
      properties: {
        ruta_archivo: {
          type: 'string',
          description: 'Ruta local al archivo de audio o video a transcribir'
        },
        audio_base64: {
          type: 'string',
          description: 'Audio codificado en base64 para transcripcion directa'
        },
        idioma: {
          type: 'string',
          description: 'Codigo ISO de idioma para Whisper (por defecto: es)'
        },
        modelo: {
          type: 'string',
          description: 'Nombre o ruta del modelo GGML de Whisper'
        }
      }
    }
  },
  {
    name: 'sintetizar_voz',
    description: 'Sintesis de voz rapida con Edge-TTS y codificacion OGG Opus compatible con notas de voz de WhatsApp.',
    inputSchema: {
      type: 'object',
      properties: {
        texto: {
          type: 'string',
          description: 'Texto a sintetizar mediante voz artificial'
        },
        voz: {
          type: 'string',
          description: 'Identificador de la voz de Edge-TTS (ej: es-ES-AlvaroNeural)'
        },
        formato_salida: {
          type: 'string',
          enum: ['ogg_opus'],
          description: 'Formato de salida del audio codificado'
        },
        retornar_base64: {
          type: 'boolean',
          description: 'Si es true, devuelve tambien el audio codificado en base64'
        }
      },
      required: ['texto']
    }
  }
];

export function crearManejadorRpc(deps = {}) {
  return async function procesarPeticion(solicitud) {
    if (!solicitud || typeof solicitud !== 'object') {
      return {
        jsonrpc: '2.0',
        id: null,
        error: { code: -32600, message: 'Invalid Request: se esperaba un objeto JSON' }
      };
    }

    const { id, method, params } = solicitud;

    const idValido = id === undefined || id === null || typeof id === 'string' || typeof id === 'number';
    if (!idValido) {
      return {
        jsonrpc: '2.0',
        id: null,
        error: { code: -32600, message: 'Invalid Request: id invalido' }
      };
    }

    if (typeof method !== 'string' || !method) {
      if (id !== undefined) {
        return {
          jsonrpc: '2.0',
          id: id ?? null,
          error: { code: -32600, message: 'Invalid Request: method invalido' }
        };
      }
      return null;
    }

    // Notificaciones
    if (method === 'notifications/initialized' || method === 'initialized') {
      if (id !== undefined && id !== null) {
        return {
          jsonrpc: '2.0',
          id,
          result: { acknowledged: true }
        };
      }
      return null;
    }

    if (method === 'initialize') {
      return {
        jsonrpc: '2.0',
        id: id ?? null,
        result: {
          protocolVersion: params?.protocolVersion || '2024-11-05',
          capabilities: {
            tools: {}
          },
          serverInfo: {
            name: 'mcp-server-media',
            version: '1.0.0'
          }
        }
      };
    }

    if (method === 'tools/list') {
      return {
        jsonrpc: '2.0',
        id: id ?? null,
        result: {
          tools: TOOLS_SCHEMA
        }
      };
    }

    if (method === 'tools/call') {
      const nombreHerramienta = params?.name;
      const args = params?.arguments || {};

      try {
        let datosResultado;
        switch (nombreHerramienta) {
          case 'descargar_multimedia':
            datosResultado = await descargarMultimedia({
              url: args.url,
              formato: args.formato,
              max_bytes: args.max_bytes,
              solo_info: args.solo_info,
              ytDlpFn: deps.ytDlpFn
            });
            break;

          case 'transcribir_audio':
            datosResultado = await transcribirAudio({
              ruta_archivo: args.ruta_archivo,
              audio_base64: args.audio_base64,
              idioma: args.idioma,
              modelo: args.modelo,
              whisperFn: deps.whisperFn
            });
            break;

          case 'sintetizar_voz':
            datosResultado = await sintetizarVoz({
              texto: args.texto,
              voz: args.voz,
              formato_salida: args.formato_salida,
              ruta_salida: args.ruta_salida,
              retornar_base64: args.retornar_base64,
              edgeTtsFn: deps.edgeTtsFn
            });
            break;

          default:
            return {
              jsonrpc: '2.0',
              id: id ?? null,
              result: {
                content: [
                  {
                    type: 'text',
                    text: JSON.stringify({ ok: false, error: `Herramienta no encontrada: ${nombreHerramienta}` })
                  }
                ],
                isError: true
              }
            };
        }

        const fallido = datosResultado?.ok === false;
        return {
          jsonrpc: '2.0',
          id: id ?? null,
          result: {
            content: [
              {
                type: 'text',
                text: JSON.stringify(datosResultado)
              }
            ],
            isError: fallido
          }
        };
      } catch (err) {
        return {
          jsonrpc: '2.0',
          id: id ?? null,
          result: {
            content: [
              {
                type: 'text',
                text: JSON.stringify({ ok: false, error: err.message })
              }
            ],
            isError: true
          }
        };
      }
    }

    if (method === 'ping') {
      return {
        jsonrpc: '2.0',
        id: id ?? null,
        result: {}
      };
    }

    return {
      jsonrpc: '2.0',
      id: id ?? null,
      error: {
        code: -32601,
        message: `Metodo no encontrado: ${method}`
      }
    };
  };
}

export function iniciarServidor(deps = {}) {
  const procesar = crearManejadorRpc(deps);

  const rl = readline.createInterface({
    input: process.stdin,
    terminal: false
  });

  rl.on('line', async (linea) => {
    const limpia = linea.trim();
    if (!limpia) return;
    try {
      const parsed = JSON.parse(limpia);
      const respuesta = await procesar(parsed);
      if (respuesta !== null && respuesta !== undefined) {
        process.stdout.write(JSON.stringify(respuesta) + '\n');
      }
    } catch (err) {
      const errorParse = {
        jsonrpc: '2.0',
        id: null,
        error: {
          code: -32700,
          message: `Parse error: ${err.message}`
        }
      };
      process.stdout.write(JSON.stringify(errorParse) + '\n');
    }
  });

  rl.on('close', () => {
    process.exit(0);
  });

  process.on('SIGINT', () => {
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    process.exit(0);
  });

  return { rl, procesar };
}

// Auto-arranque al ejecutar como script independiente
const esEjecucionDirecta = Boolean(
  process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
);

if (esEjecucionDirecta && process.env.TEST_IMPORT_ONLY !== 'true') {
  iniciarServidor();
}
