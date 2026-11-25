/**
 * async_progress_feedback.test.js - Pruebas unitarias de feedback tactico de progreso (RF-COG-06)
 *
 * Strict Policy: Zero Emojis.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertNoEmojis } from '../harness/validators.js';
import {
  UMBRAL_ACK_PROGRESO_MS,
  estimarDuracionMs,
  generarMensajeProgreso,
  crearMonitorProgresoTactico
} from '../../src/services/asyncProgressFeedbackService.js';
import { consultarJarvis } from '../../src/core/jarvisAgent.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');

function esperar(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test('UMBRAL_ACK_PROGRESO_MS usa 4000 por defecto y respeta DAVIS_PROGRESS_ACK_MS', async () => {
  assert.equal(typeof UMBRAL_ACK_PROGRESO_MS, 'number');
  assert.ok(UMBRAL_ACK_PROGRESO_MS > 0);
  if (!process.env.DAVIS_PROGRESS_ACK_MS) {
    assert.equal(UMBRAL_ACK_PROGRESO_MS, 4000);
  }

  const prev = process.env.DAVIS_PROGRESS_ACK_MS;
  process.env.DAVIS_PROGRESS_ACK_MS = '6200';
  try {
    const mod = await import(`../../src/services/asyncProgressFeedbackService.js?override=${Date.now()}`);
    assert.equal(mod.UMBRAL_ACK_PROGRESO_MS, 6200);
  } finally {
    if (prev === undefined) delete process.env.DAVIS_PROGRESS_ACK_MS;
    else process.env.DAVIS_PROGRESS_ACK_MS = prev;
  }
});

test('estimarDuracionMs clasifica >=4500ms para tareas pesadas y <=1500ms para chitchat/clima simple', () => {
  const casosLentos = [
    { intenciones: ['navegacion'] },
    { intenciones: ['noticias'] },
    { intenciones: ['carrera'] },
    { intenciones: ['cerebro'] },
    { intenciones: ['github'] },
    { esPlanCompuesto: true },
    { complejidad: { nivel: 2, categoria: 'razonamiento_profundo' } },
    { complejidad: 2 },
    { herramientas: [{ function: { name: 'navegar_y_leer_noticia' } }] }
  ];

  for (const caso of casosLentos) {
    const est = estimarDuracionMs(caso);
    assert.ok(est >= 4500, `Se esperaba >= 4500ms para ${JSON.stringify(caso)}, recibido ${est}`);
  }

  const casosRapidos = [
    {},
    { intenciones: ['chitchat'] },
    { intenciones: ['conversacion'] },
    { intenciones: ['clima'] },
    { intenciones: ['clima'], herramientas: ['consultar_clima'], complejidad: { nivel: 1 } },
    { complejidad: { nivel: 0, categoria: 'determinista' } }
  ];

  for (const caso of casosRapidos) {
    const est = estimarDuracionMs(caso);
    assert.ok(est <= 1500, `Se esperaba <= 1500ms para ${JSON.stringify(caso)}, recibido ${est}`);
  }
});

test('generarMensajeProgreso devuelve texto tactico conciso en espanol sin emojis', () => {
  const muestras = [
    generarMensajeProgreso({ intenciones: ['navegacion'] }),
    generarMensajeProgreso({ intenciones: ['noticias'] }),
    generarMensajeProgreso({ intenciones: ['carrera'] }),
    generarMensajeProgreso({ intenciones: ['cerebro'] }),
    generarMensajeProgreso({ intenciones: ['github'] }),
    generarMensajeProgreso({ complejidad: { nivel: 2 } }),
    generarMensajeProgreso({})
  ];

  for (const msg of muestras) {
    assert.equal(typeof msg, 'string');
    assert.ok(msg.trim().length >= 15 && msg.trim().length <= 140, `Longitud inesperada: ${msg}`);
    assertNoEmojis(msg, 'Mensaje de progreso tactico');
  }
});

test('crearMonitorProgresoTactico dispara como maximo una vez cuando supera umbral y no esta bloqueado', async () => {
  const recibidos = [];
  const monitor = crearMonitorProgresoTactico({
    estimacionMs: 5000,
    umbralMs: 25,
    intenciones: ['navegacion'],
    onProgreso: (msg) => {
      recibidos.push(msg);
    }
  });

  assert.equal(monitor.seEmitio(), false);
  await esperar(70);
  assert.equal(monitor.seEmitio(), true);
  assert.equal(recibidos.length, 1);
  assertNoEmojis(recibidos[0]);

  // Cancelar tras emitir no debe provocar efectos secundarios ni cambiar seEmitio
  monitor.cancelar();
  await esperar(40);
  assert.equal(recibidos.length, 1);
  assert.equal(monitor.seEmitio(), true);
});

test('crearMonitorProgresoTactico cancela limpiamente antes del umbral sin emitir', async () => {
  let llamadas = 0;
  const monitor = crearMonitorProgresoTactico({
    estimacionMs: 5000,
    umbralMs: 60,
    intenciones: ['github'],
    onProgreso: () => {
      llamadas++;
    }
  });

  await esperar(10);
  monitor.cancelar();
  monitor.cancelar();
  await esperar(90);

  assert.equal(llamadas, 0);
  assert.equal(monitor.seEmitio(), false);
});

test('crearMonitorProgresoTactico respeta umbral, silencioso, respuestaVoz, asyncPipeline y callback invalido', async () => {
  let llamadas = 0;
  const casosBloqueados = [
    { estimacionMs: 100, umbralMs: 120, onProgreso: () => { llamadas++; } },
    { estimacionMs: 5000, umbralMs: 15, silencioso: true, onProgreso: () => { llamadas++; } },
    { estimacionMs: 5000, umbralMs: 15, respuestaVoz: true, onProgreso: () => { llamadas++; } },
    { estimacionMs: 5000, umbralMs: 15, asyncPipeline: true, onProgreso: () => { llamadas++; } },
    { estimacionMs: 5000, umbralMs: 15, onProgreso: null },
    { estimacionMs: undefined, umbralMs: 0, onProgreso: () => { llamadas++; } }
  ];

  const monitores = casosBloqueados.map((cfg) => crearMonitorProgresoTactico(cfg));
  await esperar(50);

  assert.equal(llamadas, 0);
  for (const m of monitores) {
    assert.equal(m.seEmitio(), false);
    m.cancelar();
  }
});

test('crearMonitorProgresoTactico captura errores sincronos y asincronos de onProgreso', async () => {
  const mSync = crearMonitorProgresoTactico({
    estimacionMs: 5000,
    umbralMs: 15,
    intenciones: ['cerebro'],
    onProgreso: () => {
      throw new Error('fallo sincrono simulado');
    }
  });

  const mAsync = crearMonitorProgresoTactico({
    estimacionMs: 5000,
    umbralMs: 15,
    intenciones: ['noticias'],
    onProgreso: async () => {
      throw new Error('fallo asincrono simulado');
    }
  });

  await esperar(55);
  assert.equal(mSync.seEmitio(), true);
  assert.equal(mAsync.seEmitio(), true);
});

test('whatsappBot inyecta onProgresoTactico seguro usando canalWhatsapp y respeta esAudio, DAVIS_ASYNC_PIPELINE y modo nocturno', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'davis-progress-wa-'));
  const prevDataDir = process.env.DAVIS_DATA_DIR;
  const prevHistoryDir = process.env.DAVIS_HISTORY_DIR;
  const prevNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'test';
  process.env.DAVIS_DATA_DIR = tmpDir;
  process.env.DAVIS_HISTORY_DIR = path.join(tmpDir, 'history');

  try {
    const botSrc = fs.readFileSync(path.join(REPO_ROOT, 'whatsappBot.js'), 'utf8');
    assert.match(botSrc, /onProgresoTactico/);
    assert.match(botSrc, /canalWhatsapp\.enviarTexto\(remoteJid,\s*msgProgreso\)/);
    assert.match(botSrc, /!esAudio\s*&&\s*process\.env\.DAVIS_ASYNC_PIPELINE\s*!==\s*'1'\s*&&\s*!estaEnModoNocturno/);

    const bot = await import('../../whatsappBot.js');
    assert.equal(typeof bot.procesarMensajesEntrantes, 'function');

    // Ejecucion real de humo en modo sincrono con socket simulado sin tocar red ni LLM real
    const enviados = [];
    const sock = {
      user: { id: '34600000000:55@s.whatsapp.net', name: 'DAVIS' },
      readMessages: async () => {},
      sendPresenceUpdate: async () => {},
      sendMessage: async (jid, payload) => {
        enviados.push({ jid, payload });
        return { key: { id: 'SIM-' + enviados.length } };
      }
    };

    await bot.procesarMensajesEntrantes(sock, {
      type: 'notify',
      messages: [{
        key: { remoteJid: '123456789012345@lid', fromMe: false, id: 'PROG-1' },
        message: { conversation: 'hola' },
        messageTimestamp: Math.floor(Date.now() / 1000)
      }]
    }, {
      chatCompletion: async () => ({ message: { content: 'Buenas, todo en orden.' } }),
      enHorarioSilencio: () => false,
      rutaArchivoMetricas: path.join(tmpDir, 'metricas.jsonl'),
      carpetaTrazas: path.join(tmpDir, 'trazas'),
      rutaArchivoNocturno: path.join(tmpDir, 'nocturno.json')
    });

    assert.ok(enviados.some((e) => e.payload?.text && e.payload.text.includes('Buenas')));
  } finally {
    if (prevDataDir === undefined) delete process.env.DAVIS_DATA_DIR;
    else process.env.DAVIS_DATA_DIR = prevDataDir;
    if (prevHistoryDir === undefined) delete process.env.DAVIS_HISTORY_DIR;
    else process.env.DAVIS_HISTORY_DIR = prevHistoryDir;
    if (prevNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = prevNodeEnv;
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // En Windows SQLite mantiene handle abierto hasta cerrar el proceso de test.
    }
  }
});

test('integracion consultarJarvis emite progreso tactico en consultas lentas pesadas y lo cancela en finally', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'davis-progress-jarvis-'));
  const mensajesProgreso = [];

  try {
    // 1) Consulta pesada (noticias) lenta -> dispara onProgresoTactico una vez y guarda traza.progresoTacticoEmitido
    const resLenta = await consultarJarvis('dime los titulares de noticias de hoy', [], {
      chatId: 'progress-int-slow',
      carpetaTrazas: tmpDir,
      rutaArchivoIdempotencia: path.join(tmpDir, 'idemp.json'),
      retornarTraza: true,
      topKMemorias: 0,
      umbralProgresoMs: 15,
      onProgresoTactico: (msg) => {
        mensajesProgreso.push(msg);
      },
      chatCompletion: async () => {
        await esperar(55);
        return { message: { role: 'assistant', content: 'Aqui tienes los titulares del dia.' } };
      }
    });

    assert.equal(mensajesProgreso.length, 1);
    assertNoEmojis(mensajesProgreso[0], 'Progreso tactico integrado');
    assert.equal(resLenta.traza.progresoTacticoEmitido, true);

    // 2) Consulta simple/chitchat -> estimacionMs (800ms) < umbral (1500ms), no emite aunque tarde 30ms
    const mensajesRapida = [];
    const resRapida = await consultarJarvis('hola, que tal', [], {
      chatId: 'progress-int-fast',
      carpetaTrazas: tmpDir,
      rutaArchivoIdempotencia: path.join(tmpDir, 'idemp.json'),
      retornarTraza: true,
      topKMemorias: 0,
      umbralProgresoMs: 1500,
      onProgresoTactico: (msg) => {
        mensajesRapida.push(msg);
      },
      chatCompletion: async () => {
        await esperar(30);
        return { message: { role: 'assistant', content: 'Hola David.' } };
      }
    });

    assert.equal(mensajesRapida.length, 0);
    assert.equal(resRapida.traza.progresoTacticoEmitido, false);

    // 2b) Consulta pesada pero rapida -> finally cancela el timer antes del umbral
    const mensajesPesadaRapida = [];
    const resPesadaRapida = await consultarJarvis('dime los titulares de noticias de hoy', [], {
      chatId: 'progress-int-fast-heavy',
      carpetaTrazas: tmpDir,
      rutaArchivoIdempotencia: path.join(tmpDir, 'idemp.json'),
      retornarTraza: true,
      topKMemorias: 0,
      umbralProgresoMs: 60,
      onProgresoTactico: (msg) => {
        mensajesPesadaRapida.push(msg);
      },
      chatCompletion: async () => ({ message: { role: 'assistant', content: 'Titulares rapidos.' } })
    });
    await esperar(80);
    assert.equal(mensajesPesadaRapida.length, 0);
    assert.equal(resPesadaRapida.traza.progresoTacticoEmitido, false);

    // 3) Error dentro de LLM -> finally cancela el timer antes del umbral
    const mensajesError = [];
    await assert.rejects(
      () => consultarJarvis('dime los titulares de noticias de hoy', [], {
        chatId: 'progress-int-err',
        carpetaTrazas: tmpDir,
        rutaArchivoIdempotencia: path.join(tmpDir, 'idemp.json'),
        topKMemorias: 0,
        umbralProgresoMs: 40,
        onProgresoTactico: (msg) => {
          mensajesError.push(msg);
        },
        chatCompletion: async () => {
          throw new Error('fallo simulado');
        }
      }),
      /fallo simulado/
    );
    await esperar(60);
    assert.equal(mensajesError.length, 0);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
