/**
 * multimodal_voice_briefing.test.js
 * Verifica puntos 4.3, 4.4 y 4.7:
 * - Multimodalidad conectada al hilo conversacional (imageMessage, documentMessage)
 * - Soporte de formatos .txt, .md, .csv, .docx, .xlsx y fallback de PDF escaneado
 * - Notas de voz largas (>60s o >600 chars) y mensajes reenviados (isForwarded)
 * - Daily Briefing en audio PTT (enviarEnAudio / DAVIS_BRIEFING_AUDIO=1)
 * - Digest nocturno de grupos (generarDigestNocturnoGrupos)
 *
 * Strict Policy: Zero Emojis.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import zlib from 'node:zlib';

const dirHistorial = fs.mkdtempSync(path.join(os.tmpdir(), 'davis-multimodal-'));
process.env.DAVIS_HISTORY_DIR = dirHistorial;
process.env.NODE_ENV = 'test';

const historial = await import('../../src/services/conversationHistoryService.js');
const bot = await import('../../whatsappBot.js');
const pdfReader = await import('../../src/services/pdfReaderService.js');
const dailyBriefing = await import('../../src/services/dailyBriefing.js');
const groupSummarizer = await import('../../src/services/groupSummarizerService.js');

const JID_DAVID = '123456789012345@lid';

function sockSimulado(enviados) {
  return {
    user: { id: '34600000000:55@s.whatsapp.net', name: 'DAVIS' },
    readMessages: async () => {},
    sendPresenceUpdate: async () => {},
    sendMessage: async (jid, payload) => {
      enviados.push({ jid, payload });
      return { key: { id: 'SIM-' + enviados.length } };
    }
  };
}

/**
 * Construye un archivo ZIP valido en memoria usando zlib.deflateRawSync
 * para probar la extraccion XML de .docx y .xlsx sin dependencias externas.
 */
function buildZipBuffer(files) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const [name, contentStr] of Object.entries(files)) {
    const nameBuf = Buffer.from(name, 'utf-8');
    const rawBuf = Buffer.from(contentStr, 'utf-8');
    const compBuf = zlib.deflateRawSync(rawBuf);

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0, 6);
    localHeader.writeUInt16LE(8, 8);
    localHeader.writeUInt16LE(0, 10);
    localHeader.writeUInt16LE(0, 12);
    localHeader.writeUInt32LE(0, 14);
    localHeader.writeUInt32LE(compBuf.length, 18);
    localHeader.writeUInt32LE(rawBuf.length, 22);
    localHeader.writeUInt16LE(nameBuf.length, 26);
    localHeader.writeUInt16LE(0, 28);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0, 8);
    centralHeader.writeUInt16LE(8, 10);
    centralHeader.writeUInt16LE(0, 12);
    centralHeader.writeUInt16LE(0, 14);
    centralHeader.writeUInt32LE(0, 16);
    centralHeader.writeUInt32LE(compBuf.length, 20);
    centralHeader.writeUInt32LE(rawBuf.length, 24);
    centralHeader.writeUInt16LE(nameBuf.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);

    localParts.push(localHeader, nameBuf, compBuf);
    centralParts.push(centralHeader, nameBuf);
    offset += localHeader.length + nameBuf.length + compBuf.length;
  }

  const centralDir = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(Object.keys(files).length, 8);
  eocd.writeUInt16LE(Object.keys(files).length, 10);
  eocd.writeUInt32LE(centralDir.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, centralDir, eocd]);
}

test('imageMessage registra intercambio en conversationHistoryService para repreguntar en el siguiente mensaje', async () => {
  historial.limpiarHistorial(JID_DAVID);
  const enviados = [];
  const sock = sockSimulado(enviados);

  await bot.procesarMensajesEntrantes(sock, {
    messages: [{
      key: { remoteJid: JID_DAVID, fromMe: false, id: 'IMG-1' },
      message: {
        imageMessage: {
          caption: 'Que pone en este cartel?',
          mimetype: 'image/jpeg'
        }
      },
      messageTimestamp: Math.floor(Date.now() / 1000)
    }],
    type: 'notify'
  }, {
    descargarMedia: async () => Buffer.from('fake-jpeg'),
    analizarImagen: async () => ({ ok: true, analisis: 'El cartel indica horario de apertura de 09:00 a 20:00.' })
  });

  assert.equal(enviados.length, 1);
  assert.match(enviados[0].payload.text, /09:00 a 20:00/);

  const ctx = historial.obtenerHistorial(JID_DAVID);
  assert.equal(ctx.length, 2, 'el analisis de la imagen debe quedar registrado en el historial');
  assert.match(ctx[0].content, /Imagen recibida.*Que pone en este cartel/);
  assert.match(ctx[1].content, /09:00 a 20:00/);

  // Repregunta siguiente recibe el contexto previo en messages
  let mensajesRecibidosPorLlm = null;
  await bot.procesarMensajesEntrantes(sock, {
    messages: [{
      key: { remoteJid: JID_DAVID, fromMe: false, id: 'TXT-FOLLOWUP' },
      message: { conversation: 'A que hora cierra?' },
      messageTimestamp: Math.floor(Date.now() / 1000)
    }],
    type: 'notify'
  }, {
    chatCompletion: async ({ messages }) => {
      mensajesRecibidosPorLlm = messages;
      return { message: { content: 'Cierra a las 20:00.' } };
    }
  });

  assert.ok(mensajesRecibidosPorLlm.some(m => m.content.includes('09:00 a 20:00')));
});

test('documentMessage PDF y CSV registran intercambio en historial y PDF escaneado ofrece fallback claro', async () => {
  historial.limpiarHistorial(JID_DAVID);
  const enviados = [];
  const sock = sockSimulado(enviados);

  // 1. PDF con texto
  await bot.procesarMensajesEntrantes(sock, {
    messages: [{
      key: { remoteJid: JID_DAVID, fromMe: false, id: 'DOC-PDF-1' },
      message: {
        documentMessage: {
          fileName: 'contrato.pdf',
          mimetype: 'application/pdf',
          caption: 'Resume las clausulas'
        }
      },
      messageTimestamp: Math.floor(Date.now() / 1000)
    }],
    type: 'notify'
  }, {
    descargarMedia: async () => Buffer.from('%PDF-1.4 mock'),
    procesarDocumentoPDF: async () => ({
      ok: true,
      tipo: 'consulta',
      respuesta: 'Clausula 1: duracion de 12 meses prorrogables.'
    })
  });

  assert.equal(enviados.length, 1);
  assert.match(enviados[0].payload.text, /12 meses/);

  const ctxTrasPdf = historial.obtenerHistorial(JID_DAVID);
  assert.equal(ctxTrasPdf.length, 2);
  assert.match(ctxTrasPdf[0].content, /contrato\.pdf/);
  assert.match(ctxTrasPdf[1].content, /12 meses/);

  // 2. PDF escaneado sin texto pero con fallback de vision
  await bot.procesarMensajesEntrantes(sock, {
    messages: [{
      key: { remoteJid: JID_DAVID, fromMe: false, id: 'DOC-PDF-SCAN' },
      message: {
        documentMessage: {
          fileName: 'escaneo.pdf',
          mimetype: 'application/pdf'
        }
      },
      messageTimestamp: Math.floor(Date.now() / 1000)
    }],
    type: 'notify'
  }, {
    descargarMedia: async () => Buffer.from('%PDF-1.4 scanned'),
    procesarDocumentoPDF: async () => ({ ok: false, error: 'PDF escaneado sin texto.' }),
    renderizarPdfAImagen: async () => Buffer.from('png-page-1'),
    analizarImagen: async () => ({ ok: true, analisis: 'Factura escaneada por importe de 145 EUR.' })
  });

  assert.equal(enviados.length, 2);
  assert.match(enviados[1].payload.text, /145 EUR/);

  // 3. CSV sin consulta -> resumen + historial
  await bot.procesarMensajesEntrantes(sock, {
    messages: [{
      key: { remoteJid: JID_DAVID, fromMe: false, id: 'DOC-CSV-1' },
      message: {
        documentMessage: {
          fileName: 'ventas.csv',
          mimetype: 'text/csv'
        }
      },
      messageTimestamp: Math.floor(Date.now() / 1000)
    }],
    type: 'notify'
  }, {
    descargarMedia: async () => Buffer.from('producto,precio,unidades\nLicencia Pro Empresarial,120,4\nSoporte Anual Dedicado,300,2\n')
  });

  assert.equal(enviados.length, 3);
  assert.match(enviados[2].payload.text, /Licencia Pro Empresarial/);
  assert.equal(historial.obtenerHistorial(JID_DAVID).length, 6);
});

test('pdfReaderService extraerTextoDocumento soporta TXT, MD, CSV, DOCX, XLSX y detecta PDF escaneado', () => {
  const mdRes = pdfReader.extraerTextoDocumento(Buffer.from('# Titulo\n\nContenido tecnico en markdown.'), { fileName: 'notas.md' });
  assert.equal(mdRes.ok, true);
  assert.equal(mdRes.formato, 'md');
  assert.match(mdRes.texto, /Contenido tecnico en markdown/);

  const csvRes = pdfReader.extraerTextoDocumento(Buffer.from('col1,col2\nval1,val2'), { fileName: 'datos.csv' });
  assert.equal(csvRes.ok, true);
  assert.equal(csvRes.formato, 'csv');
  assert.match(csvRes.texto, /col1,col2/);

  const docxBuf = buildZipBuffer({
    'word/document.xml': '<w:document><w:body><w:p><w:r><w:t>Acta de reunion tecnica</w:t></w:r></w:p><w:p><w:r><w:t>Acuerdo de despliegue viernes.</w:t></w:r></w:p></w:body></w:document>'
  });
  const docxRes = pdfReader.extraerTextoDocumento(docxBuf, { fileName: 'acta.docx' });
  assert.equal(docxRes.ok, true);
  assert.equal(docxRes.formato, 'docx');
  assert.match(docxRes.texto, /Acta de reunion tecnica/);
  assert.match(docxRes.texto, /Acuerdo de despliegue viernes/);

  const xlsxBuf = buildZipBuffer({
    'xl/sharedStrings.xml': '<sst><si><t>Concepto</t></si><si><t>Servidor VPS</t></si></sst>',
    'xl/worksheets/sheet1.xml': '<worksheet><sheetData><row><c t="s"><v>0</v></c><c t="inlineStr"><is><t>Importe</t></is></c></row><row><c t="s"><v>1</v></c><c><v>49.90</v></c></row></sheetData></worksheet>'
  });
  const xlsxRes = pdfReader.extraerTextoDocumento(xlsxBuf, { fileName: 'presupuesto.xlsx' });
  assert.equal(xlsxRes.ok, true);
  assert.equal(xlsxRes.formato, 'xlsx');
  assert.match(xlsxRes.texto, /Concepto \| Importe/);
  assert.match(xlsxRes.texto, /Servidor VPS \| 49\.90/);

  const pdfVacio = pdfReader.extraerTextoDocumento(Buffer.from('%PDF-1.4\n%%EOF'), { fileName: 'vacio.pdf' });
  assert.equal(pdfVacio.ok, false);
  assert.equal(pdfVacio.esEscaneado, true);
});

test('nota de voz larga (>60s) y mensaje reenviado inyectan directiva de resumen estructurado y sin mutaciones sin confirmacion', async () => {
  historial.limpiarHistorial(JID_DAVID);
  const enviados = [];
  const sock = sockSimulado(enviados);

  let systemPrompts = [];
  const chatCompletion = async ({ messages }) => {
    const sys = messages.find(m => m.role === 'system')?.content || '';
    systemPrompts.push(sys);
    return { message: { content: 'Resumen estructurado generado.' } };
  };

  // Nota de voz > 60s y reenviada
  await bot.procesarMensajesEntrantes(sock, {
    messages: [{
      key: { remoteJid: JID_DAVID, fromMe: false, id: 'AUD-LONG-1' },
      message: {
        audioMessage: {
          seconds: 95,
          contextInfo: { isForwarded: true }
        }
      },
      messageTimestamp: Math.floor(Date.now() / 1000)
    }],
    type: 'notify'
  }, {
    descargarMedia: async () => Buffer.from('ogg-fake'),
    transcribirAudio: async () => ({ ok: true, texto: 'Hola David, recuerda revisar la factura el lunes y agendar la reunion del martes a las diez.' }),
    sintetizarVoz: async () => { throw new Error('sin tts en test'); },
    chatCompletion
  });

  assert.equal(systemPrompts.length, 1);
  assert.match(systemPrompts[0], /resumen estructurado/i);
  assert.match(systemPrompts[0], /recordatorios, eventos o notas/i);
  assert.match(systemPrompts[0], /NO ejecutes mutaciones/i);
});

test('dailyBriefing entregarBriefing soporta enviarEnAudio y DAVIS_BRIEFING_AUDIO=1 con fallback seguro', async () => {
  const textos = [];
  const audios = [];
  const prevEnv = process.env.DAVIS_BRIEFING_AUDIO;

  try {
    process.env.DAVIS_BRIEFING_AUDIO = '1';
    const modo = await dailyBriefing.entregarBriefing(
      (txt) => textos.push(txt),
      JID_DAVID,
      '========================================\nINFORME TACTICO MATUTINO\n[METEOROLOGIA]\nMadrid 18C despejado.\n========================================',
      {
        synthesizeSpeech: async (resumen) => {
          assert.ok(resumen.includes('Madrid 18C despejado'));
          return Buffer.from('OggS-fake-audio');
        },
        onAudio: async (buf, resumen) => {
          audios.push({ buf, resumen });
        }
      }
    );

    assert.equal(modo, 'callback');
    assert.equal(textos.length, 1);
    assert.equal(audios.length, 1);
    assert.equal(audios[0].buf.toString(), 'OggS-fake-audio');

    // Si falla TTS, el texto sigue entregandose sin lanzar excepcion
    const modoFallback = await dailyBriefing.entregarBriefing(
      (txt) => textos.push(txt),
      JID_DAVID,
      'Briefing de prueba',
      {
        enviarEnAudio: true,
        synthesizeSpeech: async () => { throw new Error('ffmpeg no disponible'); }
      }
    );
    assert.equal(modoFallback, 'callback');
    assert.equal(textos.length, 2);
  } finally {
    if (prevEnv === undefined) delete process.env.DAVIS_BRIEFING_AUDIO;
    else process.env.DAVIS_BRIEFING_AUDIO = prevEnv;
  }
});

test('groupSummarizerService generarDigestNocturnoGrupos consolida grupos activos del dia y maneja estado vacio', async () => {
  groupSummarizer.clearAllGroupBuffers();

  const vacio = await groupSummarizer.generarDigestNocturnoGrupos();
  assert.equal(vacio.ok, true);
  assert.equal(vacio.totalGroups, 0);
  assert.match(vacio.digestText, /Sin actividad registrada/);

  const nowSec = Math.floor(Date.now() / 1000);
  await groupSummarizer.recordGroupMessage('1203630001@g.us', '34611111111@s.whatsapp.net', 'David revisa el despliegue por favor', nowSec);
  await groupSummarizer.recordGroupMessage('1203630001@g.us', '34622222222@s.whatsapp.net', 'TAREA: Actualizar certificado SSL antes del viernes', nowSec);
  await groupSummarizer.recordGroupMessage('1203630002@g.us', '34633333333@s.whatsapp.net', 'Todo operativo en el grupo de soporte', nowSec);

  const digest = await groupSummarizer.generarDigestNocturnoGrupos({ hours: 24 });
  assert.equal(digest.ok, true);
  assert.equal(digest.totalGroups, 2);
  assert.equal(digest.totalMessages, 3);
  assert.equal(digest.totalMentions, 1);
  assert.equal(digest.totalTasks, 1);
  assert.match(digest.digestText, /DIGEST NOCTURNO DE GRUPOS/);
  assert.match(digest.digestText, /1203630001@g\.us/);
  assert.match(digest.digestText, /Actualizar certificado SSL/);
});
