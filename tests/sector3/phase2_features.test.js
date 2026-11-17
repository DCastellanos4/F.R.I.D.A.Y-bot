/**
 * tests/sector3/phase2_features.test.js - Validacion tecnica de funcionalidades de Fase 2.
 *
 * 1. documentMessage procesa PDFs/documentos con pdfReaderService y visionService sin descartar.
 * 2. imageMessage procesa fotos generales con visionService preservando flujo de tickets.
 * 3. Transcripcion de voz tiene fallback funcional a Groq Whisper API (whisper-large-v3-turbo) si whisper local falla.
 * 4. Las 7 tools huerfanas existen en tools.js con schemas validos y no rompen catalogos ni LLM.
 * 5. Regresiones a cero en toda la suite y cero emojis.
 *
 * Strict Policy: Zero Emojis.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import '../sector2/setup_aislamiento.mjs';

const dirEntorno = fs.mkdtempSync(path.join(os.tmpdir(), 'davis-phase2-'));
process.env.DAVIS_HISTORY_DIR = path.join(dirEntorno, 'history');
const carpetaTrazas = path.join(dirEntorno, 'trazas');
fs.mkdirSync(process.env.DAVIS_HISTORY_DIR, { recursive: true });
fs.mkdirSync(carpetaTrazas, { recursive: true });

import { config } from '../../src/config/config.js';
import {
  herramientasJarvis,
  MAPA_INTENCION_HERRAMIENTAS
} from '../../src/core/tools.js';
import { ejecutarHerramienta } from '../../src/core/jarvisAgent.js';
import {
  transcribirAudioBuffer,
  transcribirAudioConGroq,
  transcribirAudioLocal
} from '../../src/services/audioTranscriberService.js';

const { procesarMensajesEntrantes } = await import('../../whatsappBot.js');

const JID_DAVID = `${config.userLid || '123456789012345'}@lid`;

function crearSockSimulado(enviados = []) {
  return {
    user: { id: '34600000000:55@s.whatsapp.net', name: 'DAVIS' },
    readMessages: async () => {},
    sendPresenceUpdate: async () => {},
    sendMessage: async (jid, payload, opts = {}) => {
      enviados.push({ jid, payload, opts });
      return { key: { id: `SIM-${enviados.length}` } };
    }
  };
}

// ---------------------------------------------------------------------------
// 1. documentMessage procesa PDFs y documentos sin descartar
// ---------------------------------------------------------------------------

test('Fase 2 - documentMessage: procesa PDF con pregunta/caption via procesarDocumentoPDF', async () => {
  const enviados = [];
  const sock = crearSockSimulado(enviados);

  let procesarPdfInvocado = false;
  let argsPdfRecibidos = null;

  const mockProcesarDocumentoPDF = async (params) => {
    procesarPdfInvocado = true;
    argsPdfRecibidos = params;
    return {
      ok: true,
      tipo: 'consulta',
      pregunta: params.pregunta,
      respuesta: 'El informe detalla un rendimiento de red optimo sin perdidas.'
    };
  };

  const msgEntrante = {
    key: { remoteJid: JID_DAVID, fromMe: false, id: 'DOC-PDF-1' },
    message: {
      documentMessage: {
        fileName: 'informe_red.pdf',
        mimetype: 'application/pdf',
        caption: 'Cual es el estado del rendimiento de red?'
      }
    },
    messageTimestamp: Math.floor(Date.now() / 1000)
  };

  await procesarMensajesEntrantes(sock, {
    type: 'notify',
    messages: [msgEntrante]
  }, {
    descargarMedia: async () => Buffer.from('%PDF-1.4 mock content'),
    procesarDocumentoPDF: mockProcesarDocumentoPDF
  });

  assert.equal(procesarPdfInvocado, true, 'procesarDocumentoPDF debe haber sido invocado');
  assert.equal(argsPdfRecibidos.pregunta, 'Cual es el estado del rendimiento de red?');
  assert.equal(enviados.length, 1, 'Se envio respuesta al usuario');
  assert.match(enviados[0].payload.text, /El informe detalla un rendimiento de red optimo/);
});

test('Fase 2 - documentMessage: procesa PDF sin caption devolviendo resumen', async () => {
  const enviados = [];
  const sock = crearSockSimulado(enviados);

  const mockProcesarDocumentoPDF = async (params) => {
    return {
      ok: true,
      tipo: 'resumen',
      resumen: 'Resumen ejecutivo: 3 secciones cubiertas, total de 45 paginas analizadas.'
    };
  };

  const msgEntrante = {
    key: { remoteJid: JID_DAVID, fromMe: false, id: 'DOC-PDF-2' },
    message: {
      documentMessage: {
        fileName: 'manual_arquitectura.pdf',
        mimetype: 'application/pdf'
      }
    },
    messageTimestamp: Math.floor(Date.now() / 1000)
  };

  await procesarMensajesEntrantes(sock, {
    type: 'notify',
    messages: [msgEntrante]
  }, {
    descargarMedia: async () => Buffer.from('%PDF-1.4 mock summary'),
    procesarDocumentoPDF: mockProcesarDocumentoPDF
  });

  assert.equal(enviados.length, 1);
  assert.match(enviados[0].payload.text, /Resumen ejecutivo: 3 secciones cubiertas/);
});

test('Fase 2 - documentMessage: procesa documento TXT con consulta y con resumen', async () => {
  const enviados = [];
  const sock = crearSockSimulado(enviados);

  let consultaInvocada = false;
  const mockConsultarSeccion = (pregunta, texto) => {
    consultaInvocada = true;
    return { answer: `Respuesta a "${pregunta}": seccion encontrada con datos de despliegue.` };
  };

  const msgTxtConsulta = {
    key: { remoteJid: JID_DAVID, fromMe: false, id: 'DOC-TXT-1' },
    message: {
      documentMessage: {
        fileName: 'notas_despliegue.txt',
        mimetype: 'text/plain',
        caption: 'donde se configuran los puertos?'
      }
    },
    messageTimestamp: Math.floor(Date.now() / 1000)
  };

  await procesarMensajesEntrantes(sock, {
    type: 'notify',
    messages: [msgTxtConsulta]
  }, {
    descargarMedia: async () => Buffer.from('Puerto 8080 configurado en env.'),
    consultarSeccionPDF: mockConsultarSeccion
  });

  assert.equal(consultaInvocada, true);
  assert.ok(enviados[0].payload.text.includes('donde se configuran los puertos?'));

  // Ahora TXT sin caption -> resumen
  let resumenInvocado = false;
  const mockResumir = (texto) => {
    resumenInvocado = true;
    return 'Resumen de notas tecnicas: puerto y configuracion general.';
  };

  const msgTxtSinCaption = {
    key: { remoteJid: JID_DAVID, fromMe: false, id: 'DOC-TXT-2' },
    message: {
      documentMessage: {
        fileName: 'servicios.txt',
        mimetype: 'text/plain'
      }
    },
    messageTimestamp: Math.floor(Date.now() / 1000)
  };

  await procesarMensajesEntrantes(sock, {
    type: 'notify',
    messages: [msgTxtSinCaption]
  }, {
    descargarMedia: async () => Buffer.from('Servicios activos: nginx, redis, node.'),
    resumirDocumento: mockResumir
  });

  assert.equal(resumenInvocado, true);
  assert.match(enviados[1].payload.text, /Resumen de notas tecnicas/);
});

test('Fase 2 - documentMessage: archivo con formato no soportado informa amablemente sin descartar ni lanzar error', async () => {
  const enviados = [];
  const sock = crearSockSimulado(enviados);

  const msgBinario = {
    key: { remoteJid: JID_DAVID, fromMe: false, id: 'DOC-BIN-1' },
    message: {
      documentMessage: {
        fileName: 'ejecutable.bin',
        mimetype: 'application/octet-stream'
      }
    },
    messageTimestamp: Math.floor(Date.now() / 1000)
  };

  await procesarMensajesEntrantes(sock, {
    type: 'notify',
    messages: [msgBinario]
  }, {
    descargarMedia: async () => Buffer.from([0x00, 0x01, 0x02])
  });

  assert.equal(enviados.length, 1);
  assert.match(enviados[0].payload.text, /actualmente solo proceso documentos PDF o texto plano/);
});

// ---------------------------------------------------------------------------
// 2. imageMessage procesa fotos generales con visionService
// ---------------------------------------------------------------------------

test('Fase 2 - imageMessage: imagen general se analiza con visionService', async () => {
  const enviados = [];
  const sock = crearSockSimulado(enviados);

  let analizarInvocado = false;
  let argsVision = null;

  const mockAnalizarImagen = async (params, deps) => {
    analizarInvocado = true;
    argsVision = params;
    return {
      ok: true,
      analisis: 'La captura muestra una excepcion NullPointerException en el modulo auth.'
    };
  };

  const msgFoto = {
    key: { remoteJid: JID_DAVID, fromMe: false, id: 'IMG-GEN-1' },
    message: {
      imageMessage: {
        caption: 'Que error es este en la consola?',
        mimetype: 'image/png'
      }
    },
    messageTimestamp: Math.floor(Date.now() / 1000)
  };

  await procesarMensajesEntrantes(sock, {
    type: 'notify',
    messages: [msgFoto]
  }, {
    descargarMedia: async () => Buffer.from('mock-png-bytes'),
    analizarImagen: mockAnalizarImagen
  });

  assert.equal(analizarInvocado, true);
  assert.equal(argsVision.prompt, 'Que error es este en la consola?');
  assert.equal(argsVision.mimeType, 'image/png');
  assert.equal(enviados.length, 1);
  assert.match(enviados[0].payload.text, /NullPointerException en el modulo auth/);
});

test('Fase 2 - imageMessage: imagen general sin caption invoca visionService con prompt por defecto', async () => {
  const enviados = [];
  const sock = crearSockSimulado(enviados);

  let promptRecibido = null;
  const mockAnalizarImagen = async (params) => {
    promptRecibido = params.prompt;
    return {
      ok: true,
      analisis: 'Diagrama de red que muestra conexion entre cliente y servidor proxy.'
    };
  };

  const msgFotoSinCaption = {
    key: { remoteJid: JID_DAVID, fromMe: false, id: 'IMG-GEN-2' },
    message: {
      imageMessage: {
        mimetype: 'image/jpeg'
      }
    },
    messageTimestamp: Math.floor(Date.now() / 1000)
  };

  await procesarMensajesEntrantes(sock, {
    type: 'notify',
    messages: [msgFotoSinCaption]
  }, {
    descargarMedia: async () => Buffer.from('mock-jpeg-bytes'),
    analizarImagen: mockAnalizarImagen
  });

  assert.equal(promptRecibido, undefined);
  assert.equal(enviados.length, 1);
  assert.match(enviados[0].payload.text, /Diagrama de red/);
});

test('Fase 2 - imageMessage: imagen con caption de ticket preserva el flujo de ticket', async () => {
  const enviados = [];
  const sock = crearSockSimulado(enviados);

  let ticketInvocado = false;
  let visionGeneralInvocada = false;

  const mockAnalizarTicket = async (buf) => {
    ticketInvocado = true;
    return { importe: 15.3, comercio: 'Mercadona', fecha: '2026-11-17', camposDudosos: [] };
  };

  const mockAnalizarImagen = async () => {
    visionGeneralInvocada = true;
    return { ok: true, analisis: 'no debia llamarse a vision general' };
  };

  const msgTicket = {
    key: { remoteJid: JID_DAVID, fromMe: false, id: 'IMG-TICKET-1' },
    message: {
      imageMessage: {
        caption: 'aqui tienes el ticket del supermercado',
        mimetype: 'image/jpeg'
      }
    },
    messageTimestamp: Math.floor(Date.now() / 1000)
  };

  await procesarMensajesEntrantes(sock, {
    type: 'notify',
    messages: [msgTicket]
  }, {
    rutaArchivoFinanzas: path.join(dirEntorno, 'finanzas_phase2.json'),
    descargarMedia: async () => Buffer.from('ticket-bytes'),
    analizarTicket: mockAnalizarTicket,
    analizarImagen: mockAnalizarImagen
  });

  assert.equal(ticketInvocado, true, 'El flujo de ticket debe haberse activado');
  assert.equal(visionGeneralInvocada, false, 'Vision general NO debe secuestrar tickets');
  assert.equal(enviados.length, 1);
  assert.match(enviados[0].payload.text, /15\.30|Mercadona/i);
});

// ---------------------------------------------------------------------------
// 3. Transcripcion de voz con fallback funcional a Groq Whisper API
// ---------------------------------------------------------------------------

test('Fase 2 - Transcripcion: local exitoso no invoca fallback de Groq', async () => {
  let localLlamado = false;
  let groqLlamado = false;

  const mockLocal = async (buf) => {
    localLlamado = true;
    return { ok: true, texto: 'revisar el servidor de base de datos', proveedor: 'local' };
  };

  const mockGroq = async () => {
    groqLlamado = true;
    return { ok: true, texto: 'texto desde groq' };
  };

  const res = await transcribirAudioBuffer(Buffer.from('audio-data'), {
    transcribirLocal: mockLocal,
    transcribirAudioConGroq: mockGroq
  });

  assert.equal(res.ok, true);
  assert.equal(res.texto, 'revisar el servidor de base de datos');
  assert.equal(res.proveedor, 'local');
  assert.equal(localLlamado, true);
  assert.equal(groqLlamado, false, 'Groq no debe invocarse si whisper local tiene exito');
});

test('Fase 2 - Transcripcion: fallback a Groq Whisper API cuando whisper local falla', async () => {
  let localLlamado = false;
  let groqLlamado = false;

  const mockLocal = async () => {
    localLlamado = true;
    return { ok: false, error: 'whisper.cpp local no encontrado en /usr/bin/whisper-cli' };
  };

  const mockGroq = async (buf, deps) => {
    groqLlamado = true;
    return {
      ok: true,
      texto: 'nota de voz transcrita mediante groq api',
      proveedor: 'groq',
      modelo: 'whisper-large-v3-turbo'
    };
  };

  const res = await transcribirAudioBuffer(Buffer.from('audio-data'), {
    transcribirLocal: mockLocal,
    transcribirAudioConGroq: mockGroq
  });

  assert.equal(localLlamado, true);
  assert.equal(groqLlamado, true, 'Debe activar el fallback a Groq');
  assert.equal(res.ok, true);
  assert.equal(res.texto, 'nota de voz transcrita mediante groq api');
  assert.equal(res.proveedor, 'groq');
  assert.equal(res.modelo, 'whisper-large-v3-turbo');
});

test('Fase 2 - Transcripcion: transcribirAudioConGroq invoca endpoint con modelo whisper-large-v3-turbo', async () => {
  let fetchUrl = null;
  let fetchOptions = null;

  const mockFetch = async (url, opts) => {
    fetchUrl = url;
    fetchOptions = opts;
    return {
      ok: true,
      json: async () => ({ text: 'transcripcion exitosa desde mock api de groq' })
    };
  };

  const res = await transcribirAudioConGroq(Buffer.from('datos-audio'), {
    apiKey: 'gsk_test_api_key_12345',
    baseUrl: 'https://api.groq.com/openai/v1',
    model: 'whisper-large-v3-turbo',
    fetchFn: mockFetch
  });

  assert.equal(res.ok, true);
  assert.equal(res.texto, 'transcripcion exitosa desde mock api de groq');
  assert.equal(res.proveedor, 'groq');
  assert.equal(res.modelo, 'whisper-large-v3-turbo');

  assert.equal(fetchUrl, 'https://api.groq.com/openai/v1/audio/transcriptions');
  assert.equal(fetchOptions.method, 'POST');
  assert.match(fetchOptions.headers.authorization, /^Bearer gsk_test_api_key_12345$/);
});

test('Fase 2 - Transcripcion: audioMessage en whatsappBot con fallo local activa fallback y canaliza al LLM', async () => {
  const enviados = [];
  const sock = crearSockSimulado(enviados);

  let localInvocado = false;
  let groqInvocado = false;
  let llmLlamado = false;

  const mockTranscribir = async (buf, deps) => {
    return transcribirAudioBuffer(buf, {
      transcribirLocal: async () => {
        localInvocado = true;
        return { ok: false, error: 'whisper-cli fallo de ejecucion' };
      },
      transcribirAudioConGroq: async () => {
        groqInvocado = true;
        return {
          ok: true,
          texto: 'que tiempo hace en madrid?',
          proveedor: 'groq',
          modelo: 'whisper-large-v3-turbo'
        };
      }
    });
  };

  const mockChatCompletion = async ({ messages }) => {
    llmLlamado = true;
    return {
      message: {
        content: 'En Madrid hace 22 grados y cielo despejado.'
      }
    };
  };

  const msgAudio = {
    key: { remoteJid: JID_DAVID, fromMe: false, id: 'VOZ-FALLBACK-1' },
    message: {
      audioMessage: {
        seconds: 4,
        mimetype: 'audio/ogg; codecs=opus'
      }
    },
    messageTimestamp: Math.floor(Date.now() / 1000)
  };

  await procesarMensajesEntrantes(sock, {
    type: 'notify',
    messages: [msgAudio]
  }, {
    descargarMedia: async () => Buffer.from('ogg-audio-stream'),
    transcribirAudio: mockTranscribir,
    chatCompletion: mockChatCompletion,
    carpetaTrazas,
    sintetizarVoz: async () => { throw new Error('TTS omitido en test'); }
  });

  assert.equal(localInvocado, true, 'Intento inicial local');
  assert.equal(groqInvocado, true, 'Fallback a Groq ejecutado');
  assert.equal(llmLlamado, true, 'Texto transcrito canalizado al LLM');
  assert.equal(enviados.length, 1);
  assert.match(enviados[0].payload.text, /Madrid|22 grados/);
});

// ---------------------------------------------------------------------------
// 4. Las 7 tools huerfanas existen en tools.js con schemas validos
// ---------------------------------------------------------------------------

test('Fase 2 - Tools huerfanas: existen en herramientasJarvis con esquemas validos', () => {
  const toolsEsperadas = [
    'escanear_ofertas_empleo',
    'configurar_radar_ofertas',
    'encender_pc',
    'controlar_domotica',
    'estado_descargas',
    'configurar_aviso_descargas',
    'estimar_factura_oracle'
  ];

  const mapaHerramientas = new Map();
  for (const h of herramientasJarvis) {
    if (h.type === 'function' && h.function?.name) {
      mapaHerramientas.set(h.function.name, h.function);
    }
  }

  for (const nombreTool of toolsEsperadas) {
    assert.ok(mapaHerramientas.has(nombreTool), `La herramienta "${nombreTool}" debe existir en herramientasJarvis`);
    const fnDef = mapaHerramientas.get(nombreTool);

    assert.ok(typeof fnDef.description === 'string' && fnDef.description.length > 10,
      `La herramienta "${nombreTool}" debe tener una descripcion valida`);

    assert.ok(fnDef.parameters && typeof fnDef.parameters === 'object',
      `La herramienta "${nombreTool}" debe tener objeto parameters`);

    assert.equal(fnDef.parameters.type, 'object',
      `parameters.type de "${nombreTool}" debe ser "object"`);

    assert.ok(typeof fnDef.parameters.properties === 'object',
      `parameters.properties de "${nombreTool}" debe ser un objeto`);

    if (fnDef.parameters.required) {
      assert.ok(Array.isArray(fnDef.parameters.required),
        `parameters.required de "${nombreTool}" debe ser un array`);
      for (const reqField of fnDef.parameters.required) {
        assert.ok(reqField in fnDef.parameters.properties,
          `El campo requerido "${reqField}" de "${nombreTool}" debe figurar en properties`);
      }
    }
  }
});

test('Fase 2 - Tools huerfanas: indexadas en MAPA_INTENCION_HERRAMIENTAS', () => {
  const asociaciones = [
    { tool: 'escanear_ofertas_empleo', categorias: ['empleo'] },
    { tool: 'configurar_radar_ofertas', categorias: ['empleo'] },
    { tool: 'encender_pc', categorias: ['hogar'] },
    { tool: 'controlar_domotica', categorias: ['hogar'] },
    { tool: 'estado_descargas', categorias: ['servidor', 'infraestructura', 'hogar'] },
    { tool: 'configurar_aviso_descargas', categorias: ['hogar'] },
    { tool: 'estimar_factura_oracle', categorias: ['servidor', 'infraestructura', 'ops', 'hogar'] }
  ];

  for (const { tool, categorias } of asociaciones) {
    for (const cat of categorias) {
      const lista = MAPA_INTENCION_HERRAMIENTAS[cat];
      assert.ok(Array.isArray(lista), `Categoria "${cat}" debe existir en MAPA_INTENCION_HERRAMIENTAS`);
      assert.ok(lista.includes(tool), `La herramienta "${tool}" debe estar mapeada en la categoria "${cat}"`);
    }
  }
});

test('Fase 2 - Tools huerfanas: serializacion limpia a JSON sin romper compatibilidad LLM', () => {
  // Verificamos que herramientasJarvis completo no contenga referencias circulares ni tipos invalidos
  const json = JSON.stringify(herramientasJarvis);
  assert.ok(typeof json === 'string');
  const parseado = JSON.parse(json);
  assert.ok(Array.isArray(parseado));
  assert.equal(parseado.length, herramientasJarvis.length);

  for (const item of parseado) {
    assert.equal(item.type, 'function');
    assert.ok(item.function);
    assert.ok(typeof item.function.name === 'string');
    assert.ok(typeof item.function.description === 'string');
    assert.equal(item.function.parameters.type, 'object');
  }
});

test('Fase 2 - Tools huerfanas: ejecucion en jarvisAgent sin romper el despachador central', async () => {
  const dirTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'davis-tools-test-'));

  try {
    // 1. escanear_ofertas_empleo
    const resRadar = await ejecutarHerramienta('escanear_ofertas_empleo', {}, {
      radarDeps: {
        rutaConfig: path.join(dirTmp, 'radar.json'),
        fetchFn: async () => ({ ok: true, text: async () => '' })
      }
    });
    assert.ok(resRadar && typeof resRadar.texto === 'string');

    // 2. configurar_radar_ofertas
    const resCfgRadar = await ejecutarHerramienta('configurar_radar_ofertas', {
      palabrasClave: ['Node.js', 'PostgreSQL'],
      ubicacion: 'Remoto',
      remoto: true,
      activo: false
    }, {
      radarDeps: { rutaConfig: path.join(dirTmp, 'radar.json') },
      mensajeUsuario: 'configura las palabras clave del radar'
    });
    assert.ok(resCfgRadar && typeof resCfgRadar.texto === 'string');

    // 3. encender_pc
    const resEncender = await ejecutarHerramienta('encender_pc', {}, {});
    assert.ok(resEncender && typeof resEncender.texto === 'string');

    // 4. controlar_domotica
    const resDomotica = await ejecutarHerramienta('controlar_domotica', {
      entidad: 'switch.luz_despacho',
      accion: 'encender'
    }, {});
    assert.ok(resDomotica && typeof resDomotica.texto === 'string');

    // 5. estado_descargas
    const resDescargas = await ejecutarHerramienta('estado_descargas', {}, {});
    assert.ok(resDescargas && typeof resDescargas.texto === 'string');

    // 6. configurar_aviso_descargas
    const resAvisoDesc = await ejecutarHerramienta('configurar_aviso_descargas', { activo: false }, {
      rutaConfigHogar: path.join(dirTmp, 'hogar.json'),
      mensajeUsuario: 'desactiva avisos de descargas'
    });
    assert.ok(resAvisoDesc && typeof resAvisoDesc.texto === 'string');

    // 7. estimar_factura_oracle
    const resOracle = await ejecutarHerramienta('estimar_factura_oracle', {}, {});
    assert.ok(resOracle && typeof resOracle.texto === 'string');
  } finally {
    try { fs.rmSync(dirTmp, { recursive: true, force: true }); } catch {}
  }
});

test.after(async () => {
  try {
    const { mcpRegistry } = await import('../../src/adapters/outbound/mcp/mcpRegistry.js');
    if (mcpRegistry && typeof mcpRegistry.close === 'function') {
      await mcpRegistry.close();
    }
  } catch {}
  try {
    fs.rmSync(dirEntorno, { recursive: true, force: true });
  } catch {}
});

