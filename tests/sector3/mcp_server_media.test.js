/**
 * tests/sector3/mcp_server_media.test.js
 *
 * Pruebas unitarias e integracion para el micro-servidor MCP mcp-server-media.
 * Pruebas directas de funciones exportadas (sintesis, descarga y transcripcion)
 * y ejecucion sobre subproceso stdio JSON-RPC 2.0.
 *
 * Strict Policy: Zero Emojis.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import readline from 'node:readline';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  sanitizarTexto,
  getFfmpegExecutable,
  getYtDlpCommand,
  getEdgeTtsCommand,
  getWhisperExecutable,
  descargarMultimedia,
  transcribirAudio,
  sintetizarVoz,
  OGGS_MAGIC,
  WHATSAPP_MAX_INLINE_BYTES
} from '../../mcp-servers/media/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '../../');
const MEDIA_SERVER_PATH = path.resolve(REPO_ROOT, 'mcp-servers/media/index.js');

test('mcp-server-media: pruebas unitarias directas de utilidades y sintesis', async () => {
  // 1. Sanitizacion de texto (Strict Zero Emojis)
  assert.equal(sanitizarTexto('Hola mundo'), 'Hola mundo');
  assert.equal(sanitizarTexto('Hola \u{1F600} mundo \u{1F680}!'), 'Hola  mundo !');
  assert.equal(sanitizarTexto(''), '');

  // 2. Deteccion de ejecutables
  const ffmpeg = getFfmpegExecutable();
  assert.ok(ffmpeg, 'ffmpeg debe estar disponible o resolverse');

  const ytdlp = getYtDlpCommand();
  assert.ok(ytdlp && ytdlp.bin, 'yt-dlp debe estar disponible via binario o python -m yt_dlp');

  const edgetts = getEdgeTtsCommand();
  assert.ok(edgetts && edgetts.bin, 'edge-tts debe estar disponible via binario o python -m edge_tts');

  // 3. Sintesis real de voz a OGG Opus
  const resSintesis = await sintetizarVoz({
    texto: 'Mensaje de prueba de voz para MCP media',
    voz: 'es-ES-AlvaroNeural',
    retornar_base64: true
  });

  assert.equal(resSintesis.ok, true);
  assert.equal(resSintesis.formato, 'ogg_opus');
  assert.ok(resSintesis.tamano_bytes > 0);
  assert.ok(fs.existsSync(resSintesis.ruta_archivo));
  assert.ok(resSintesis.audio_base64);

  // Verificacion de cabecera 'OggS'
  const bufferOgg = fs.readFileSync(resSintesis.ruta_archivo);
  assert.ok(bufferOgg.subarray(0, 4).equals(OGGS_MAGIC), 'El archivo generado debe comenzar con OggS');

  // Limpieza
  try { fs.unlinkSync(resSintesis.ruta_archivo); } catch (_) {}

  // 4. Validacion de texto vacio en sintesis
  await assert.rejects(
    async () => sintetizarVoz({ texto: '' }),
    /El parametro texto es obligatorio/
  );

  // 5. Descarga multimedia: validacion de URL
  await assert.rejects(
    async () => descargarMultimedia({ url: 'invalida' }),
    /El parametro url es obligatorio y debe ser una URL valida/
  );

  // Inyeccion de funcion mock para descargar_multimedia
  const mockDescarga = await descargarMultimedia({
    url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    ytDlpFn: async ({ url, formato }) => ({
      ok: true,
      titulo: 'Test Song',
      duracion: 212,
      archivo_ruta: '/tmp/test.mp4',
      tamano_bytes: 1048576,
      formato
    })
  });
  assert.equal(mockDescarga.ok, true);
  assert.equal(mockDescarga.titulo, 'Test Song');

  // 6. Transcripcion de audio: validacion de parametros
  await assert.rejects(
    async () => transcribirAudio({}),
    /Debe proporcionar ruta_archivo o audio_base64/
  );

  // Inyeccion de funcion mock para transcripcion
  const mockTrans = await transcribirAudio({
    audio_base64: 'UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=',
    whisperFn: async ({ idioma }) => ({
      ok: true,
      texto: 'Transcripcion simulada con exito',
      idioma
    })
  });
  assert.equal(mockTrans.ok, true);
  assert.equal(mockTrans.texto, 'Transcripcion simulada con exito');
});

test('mcp-server-media: ejecucion stdio JSON-RPC 2.0 via subproceso', async () => {
  const child = spawn(process.execPath, [MEDIA_SERVER_PATH], {
    cwd: REPO_ROOT,
    env: { ...process.env },
    stdio: ['pipe', 'pipe', 'pipe']
  });

  const rl = readline.createInterface({
    input: child.stdout,
    terminal: false
  });

  const respuestas = [];
  rl.on('line', (line) => {
    if (!line.trim()) return;
    try {
      respuestas.push(JSON.parse(line));
    } catch (_) {}
  });

  async function enviarPeticion(payload) {
    const idEsperado = payload.id;
    const posInicial = respuestas.length;
    child.stdin.write(JSON.stringify(payload) + '\n');

    const inicio = Date.now();
    while (Date.now() - inicio < 12000) {
      for (let i = posInicial; i < respuestas.length; i++) {
        if (respuestas[i].id === idEsperado) {
          return respuestas[i];
        }
      }
      await new Promise((r) => setTimeout(r, 20));
    }
    throw new Error(`Timeout esperando respuesta para id: ${idEsperado}`);
  }

  try {
    // 1. Handshake initialize
    const initRes = await enviarPeticion({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2024-11-05' }
    });
    assert.equal(initRes.id, 1);
    assert.equal(initRes.result.serverInfo.name, 'mcp-server-media');
    assert.ok(initRes.result.capabilities.tools);

    // 2. Notificacion initialized
    child.stdin.write(JSON.stringify({
      jsonrpc: '2.0',
      method: 'notifications/initialized'
    }) + '\n');

    // 3. Ping
    const pingRes = await enviarPeticion({
      jsonrpc: '2.0',
      id: 2,
      method: 'ping'
    });
    assert.equal(pingRes.id, 2);
    assert.deepEqual(pingRes.result, {});

    // 4. tools/list
    const listRes = await enviarPeticion({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/list'
    });
    assert.equal(listRes.id, 3);
    const toolNames = listRes.result.tools.map((t) => t.name);
    assert.ok(toolNames.includes('descargar_multimedia'));
    assert.ok(toolNames.includes('transcribir_audio'));
    assert.ok(toolNames.includes('sintetizar_voz'));
    assert.equal(toolNames.length, 3);

    // 5. tools/call: sintetizar_voz
    const callTtsRes = await enviarPeticion({
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: {
        name: 'sintetizar_voz',
        arguments: {
          texto: 'Comprobando servicio MCP media sobre stdio'
        }
      }
    });
    assert.equal(callTtsRes.id, 4);
    assert.equal(callTtsRes.result.isError, false);
    const dataTts = JSON.parse(callTtsRes.result.content[0].text);
    assert.equal(dataTts.ok, true);
    assert.equal(dataTts.formato, 'ogg_opus');
    assert.ok(dataTts.tamano_bytes > 0);
    try { fs.unlinkSync(dataTts.ruta_archivo); } catch (_) {}

    // 6. tools/call: transcribir_audio sin argumentos (espera isError=true)
    const callTransErr = await enviarPeticion({
      jsonrpc: '2.0',
      id: 5,
      method: 'tools/call',
      params: {
        name: 'transcribir_audio',
        arguments: {}
      }
    });
    assert.equal(callTransErr.id, 5);
    assert.equal(callTransErr.result.isError, true);

    // 7. tools/call: descargar_multimedia con url invalida (espera isError=true)
    const callYtErr = await enviarPeticion({
      jsonrpc: '2.0',
      id: 6,
      method: 'tools/call',
      params: {
        name: 'descargar_multimedia',
        arguments: { url: 'ftp://invalida' }
      }
    });
    assert.equal(callYtErr.id, 6);
    assert.equal(callYtErr.result.isError, true);

    // 8. Metodo JSON-RPC no encontrado (-32601)
    const unknownRes = await enviarPeticion({
      jsonrpc: '2.0',
      id: 7,
      method: 'metodo_inexistente'
    });
    assert.equal(unknownRes.id, 7);
    assert.equal(unknownRes.error.code, -32601);
  } finally {
    rl.close();
    child.kill('SIGTERM');
    await new Promise((r) => setTimeout(r, 100));
  }
});
