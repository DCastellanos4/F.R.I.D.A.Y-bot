// Wiring de consumo ERS (corte local, inerte por defecto):
//  - B1: contenedor con pipeline asincrono -> ACK inmediato, job publicado,
//    worker real, entregador real con alta de canal en caliente.
//  - B4: worker audita cada accion con efectos (RNF-04, hash sobre PII
//    anonimizada) y la cadena de hashes verifica.
//  - RF-03: semanticMemoryService consume el buscador hibrido registrado
//    y la escritura de memoria fuerza reindexacion (invalidacion cerrada).
//  - RF-02: messageProcessor consume la conversacion de nivel 1 con
//    escalada (sin enrutador o sin confianza -> camino historico intacto).
//
// Strict Policy: Zero Emojis.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { abrirBaseDatos } from '../../src/adapters/outbound/persistence/sqlite/connection.js';
import { ejecutarMigraciones } from '../../src/adapters/outbound/persistence/sqlite/migraciones.js';
import { crearSqliteOutboxStore } from '../../src/adapters/outbound/persistence/sqlite/sqliteOutboxStore.js';
import { crearPipelineAsincrono } from '../../src/composition/asyncPipeline.js';
import { crearContenedor } from '../../src/composition/container.js';
import { crearAuditLogService, canonizar } from '../../src/security/auditLogService.js';
import { crearPiiAnonymizer } from '../../src/security/piiAnonymizerService.js';
import { crearMessageProcessor } from '../../src/core/messageProcessor.js';
import {
  buscarMemoriaSemantica,
  invalidarIndiceSemantico,
  registrarBuscadorHibridoPorDefecto
} from '../../src/services/semanticMemoryService.js';

const sha256 = (t) => crypto.createHash('sha256').update(String(t), 'utf8').digest('hex');

function dirTemporal(etiqueta) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `davis-${etiqueta}-`));
}

// ---------------------------------------------------------------- B1 ---

test('B1: contenedor con pipeline activo devuelve ACK inmediato y publica el trabajo (sin tocar el LLM)', async () => {
  const recibidos = [];
  const pipelineFaux = {
    recibir: (inbound) => { recibidos.push(inbound); return 'job-1'; },
    registrarCanal: () => {},
    iniciar: () => {},
    cerrar: async () => {}
  };
  let llamadasLlm = 0;
  const contenedor = crearContenedor({
    llmProvider: { chatCompletion: async () => { llamadasLlm += 1; return { message: { content: 'x' } }; } },
    memoryRepository: { buscar: async () => [], guardar: async () => {}, listar: async () => [], olvidar: async () => true },
    pipelineAsincrono: pipelineFaux
  });
  const t0 = Date.now();
  const respuesta = await contenedor.procesarMensajeEntrante({ userId: 'u1', text: 'hola', channel: 'whatsapp' });
  assert.equal(respuesta, 'Recibido, lo estoy procesando.', 'ACK inmediato declarado');
  assert.equal(recibidos.length, 1, 'el mensaje quedo publicado en el outbox');
  assert.equal(recibidos[0].text, 'hola');
  assert.equal(llamadasLlm, 0, 'el ACK no invoca al agente');
  assert.ok(Date.now() - t0 < 1000, 'el ACK es inmediato');
  assert.equal(typeof contenedor.registrarCanalEntrega, 'function');
});

test('B1: sin pipeline el contenedor sigue el camino sincrono historico', async () => {
  let llamadasLlm = 0;
  const contenedor = crearContenedor({
    llmProvider: {
      chatCompletion: async () => {
        llamadasLlm += 1;
        return { message: { content: 'respuesta directa', tool_calls: [] } };
      }
    },
    memoryRepository: { buscar: async () => [], guardar: async () => {}, listar: async () => [], olvidar: async () => true },
    pipelineAsincrono: null
  });
  const respuesta = await contenedor.procesarMensajeEntrante({ userId: 'u1', text: 'hola', channel: 'whatsapp' });
  assert.notEqual(respuesta, 'Recibido, lo estoy procesando.');
  assert.ok(llamadasLlm >= 1, 'camino historico: el agente responde');
});

test('B1 end-to-end local: recibir -> worker procesa -> entregador entrega por canal registrado en caliente', async () => {
  const dir = dirTemporal('e2e');
  const db = abrirBaseDatos(path.join(dir, 'p.db'));
  ejecutarMigraciones(db);
  const enviados = [];
  const pipeline = crearPipelineAsincrono({
    db,
    intervaloColaMs: 15,
    intervaloEntregaMs: 15,
    procesar: async (inbound) => `eco:${inbound.text}`
  });
  // Alta en caliente: el canal se registra DESPUES de construir el pool.
  pipeline.registrarCanal('whatsapp', {
    canal: 'whatsapp',
    enviarTexto: async (destinatario, texto) => { enviados.push({ destinatario, texto }); }
  });
  pipeline.iniciar();
  try {
    const idJob = pipeline.recibir({ userId: 'david', text: 'prueba', channel: 'whatsapp', messageId: 'm1', timestamp: new Date() });
    assert.ok(idJob, 'recibir devuelve el id del trabajo persistido');
    for (let i = 0; i < 200 && enviados.length === 0; i++) {
      await new Promise((r) => setTimeout(r, 20));
    }
    assert.equal(enviados.length, 1, 'la respuesta final llego por el canal registrado');
    assert.equal(enviados[0].texto, 'eco:prueba');
    assert.equal(enviados[0].destinatario, 'david');
  } finally {
    await pipeline.cerrar();
    db.close();
  }
});

// ---------------------------------------------------------------- B4 ---

test('B4: el worker audita cada accion con efectos una vez, con PII anonimizada y cadena verificable', async () => {
  const dir = dirTemporal('audit');
  const db = abrirBaseDatos(path.join(dir, 'a.db'));
  ejecutarMigraciones(db);
  const store = crearSqliteOutboxStore(db);
  const auditoria = crearAuditLogService(db);
  // Contrato del ensayo: el detector PII reconoce telefonos ES con y
  // sin separadores ('+34 611 22 33 44' y '+34611222333').
  const claveAccion = 'enviar_whatsapp:"{\\"telefono\\":\\"+34611222333\\",\\"texto\\":\\"hola\\"}"';
  const pipeline = crearPipelineAsincrono({
    db,
    intervaloColaMs: 15,
    intervaloEntregaMs: 15,
    auditoria,
    procesar: async (inbound, ctx) => {
      // Simula la costura ReAct: marca planificada de DOS rondas con la
      // misma accion (la re-emision NO debe duplicar la auditoria).
      ctx.opciones.onCheckpointRonda(1, { ronda: 1, accionesPlanificadas: [claveAccion], accionesConEfectos: [] });
      ctx.opciones.onCheckpointRonda(2, { ronda: 2, accionesPlanificadas: [claveAccion], accionesConEfectos: [claveAccion] });
      return 'hecho';
    }
  });
  pipeline.registrarCanal('whatsapp', { canal: 'whatsapp', enviarTexto: async () => {} });
  pipeline.iniciar();
  try {
    pipeline.recibir({ userId: 'david', text: 'manda un whatsapp', channel: 'whatsapp', messageId: 'm2', timestamp: new Date() });
    let filas = [];
    for (let i = 0; i < 200 && filas.length === 0; i++) {
      await new Promise((r) => setTimeout(r, 20));
      filas = db.prepare('SELECT * FROM audit_herramientas').all();
    }
    assert.equal(filas.length, 1, 'una sola fila de auditoria pese a dos marcas de la misma accion');
    assert.equal(filas[0].herramienta, 'enviar_whatsapp');
    // PII: el hash NO es el del valor en claro; es el del anonimizado.
    const args = { telefono: '+34611222333', texto: 'hola' };
    const hashCrudo = sha256(canonizar(args));
    const anon = crearPiiAnonymizer().anonimizar(canonizar(args)).texto;
    assert.notEqual(filas[0].args_sha256, hashCrudo, 'el hash no corresponde al telefono en claro');
    assert.equal(filas[0].args_sha256, sha256(anon), 'el hash corresponde al contenido anonimizado');
    assert.equal(anon.includes('+34611222333'), false, 'el anonimizador enmascaro el telefono');
    const verificacion = auditoria.verificarCadena();
    assert.equal(verificacion.ok, true, 'cadena de hashes integra');
  } finally {
    await pipeline.cerrar();
    db.close();
  }
});

// --------------------------------------------------------------- RF-03 ---

function escribirMemorias(ruta, memorias) {
  fs.writeFileSync(ruta, JSON.stringify(memorias, null, 2), 'utf8');
}

test('RF-03: la busqueda semantica consume el buscador hibrido registrado y la escritura fuerza reindexacion', async () => {
  const dir = dirTemporal('rf03');
  const ruta = path.join(dir, 'mem.json');
  escribirMemorias(ruta, [
    { id: 'm1', sujeto: 'David', dato: 'prefiere cafe sin azucar', categoria: 'general', tags: [] }
  ]);
  let indexaciones = 0;
  let documentosIndexados = 0;
  const buscadorFaux = {
    indexar: async (tenant, docs) => { indexaciones += 1; documentosIndexados = docs.length; return { ok: true, total: docs.length, omitidos: 0 }; },
    buscar: async (tenant, consulta, opciones) => ([
      { id: 'm1', score: 0.9, calibrado: true, canales: ['denso', 'disperso'], rangos: {}, rerankeado: true, texto: 'prefiere cafe sin azucar', item: { id: 'm1', sujeto: 'David', dato: 'prefiere cafe sin azucar', categoria: 'general', tags: [] } }
    ])
  };
  registrarBuscadorHibridoPorDefecto(buscadorFaux);
  try {
    const r1 = await buscarMemoriaSemantica('cafe', { storePath: ruta, soloArchivo: false, topK: 3 });
    assert.equal(indexaciones, 1, 'primera busqueda indexa la fuente');
    assert.equal(documentosIndexados, 1);
    assert.equal(r1.length, 1);
    assert.equal(r1[0].sujeto, 'David');
    assert.equal(r1[0].dato, 'prefiere cafe sin azucar');
    assert.equal(r1[0].similitud, 0.9, 'misma forma de resultado que el camino historico');

    await buscarMemoriaSemantica('cafe', { storePath: ruta, topK: 3 });
    assert.equal(indexaciones, 1, 'firma sin cambios: no reindexa');

    // Escritura de memoria: la firma cambia y la invalidacion lo fuerza.
    escribirMemorias(ruta, [
      { id: 'm1', sujeto: 'David', dato: 'prefiere cafe sin azucar', categoria: 'general', tags: [] },
      { id: 'm2', sujeto: 'David', dato: 'entrena los martes', categoria: 'general', tags: [] }
    ]);
    invalidarIndiceSemantico(); // lo invoca memoryService tras cada escritura
    await buscarMemoriaSemantica('cafe', { storePath: ruta, topK: 3 });
    assert.equal(indexaciones, 2, 'tras escribir memoria se reindexa antes de responder');
    assert.equal(documentosIndexados, 2, 'la reindexacion ve el documento nuevo');
  } finally {
    registrarBuscadorHibridoPorDefecto(null);
  }
});

test('RF-03: un fallo del motor hibrido se declara y cae al camino TF-IDF historico', async () => {
  const dir = dirTemporal('rf03fb');
  const ruta = path.join(dir, 'mem.json');
  escribirMemorias(ruta, [
    { id: 'm1', sujeto: 'David', dato: 'prefiere cafe sin azucar', categoria: 'general', tags: [] }
  ]);
  registrarBuscadorHibridoPorDefecto({
    indexar: async () => { throw new Error('qdrant caido'); },
    buscar: async () => { throw new Error('qdrant caido'); }
  });
  try {
    const r = await buscarMemoriaSemantica('cafe', { storePath: ruta, topK: 3 });
    assert.ok(Array.isArray(r), 'el camino historico responde aunque el motor nuevo falle');
  } finally {
    registrarBuscadorHibridoPorDefecto(null);
  }
});

// --------------------------------------------------------------- RF-02 ---

function processorConEnrutador(enrutador, llamadasLlm) {
  return crearMessageProcessor({
    llmProvider: {
      chatCompletion: async () => {
        llamadasLlm.push(1);
        return { message: { content: 'respuesta del agente', tool_calls: [] } };
      }
    },
    memoryRepository: { buscar: async () => [], guardar: async () => {}, listar: async () => [], olvidar: async () => true },
    enrutadorInferencia: enrutador
  });
}

test('RF-02: charla con respuesta local de confianza se responde en nivel 1 sin invocar al agente', async () => {
  const llamadasLlm = [];
  const enrutador = {
    clasificarIntencion: async () => ({ intencion: 'conversacion', confianza: 0.95, via: 'local_slm' }),
    responderConversacion: async () => ({ exito: true, via: 'local_slm', respuesta: 'Hola David, todo en orden.', confianza: 0.9 })
  };
  const processor = processorConEnrutador(enrutador, llamadasLlm);
  const respuesta = await processor.procesarMensajeEntrante({ userId: 'u', text: 'buenas', channel: 'whatsapp' });
  assert.equal(respuesta, 'Hola David, todo en orden.');
  assert.equal(llamadasLlm.length, 0, 'nivel 1: cero llamadas al LLM cloud');
});

test('RF-02: respuesta local sin confianza escala al camino historico (agente)', async () => {
  const llamadasLlm = [];
  const enrutador = {
    clasificarIntencion: async () => ({ intencion: 'conversacion', confianza: 0.95, via: 'local_slm' }),
    responderConversacion: async () => ({ exito: false, via: 'cloud', motivo: 'baja_confianza' })
  };
  const processor = processorConEnrutador(enrutador, llamadasLlm);
  const respuesta = await processor.procesarMensajeEntrante({ userId: 'u', text: 'buenas', channel: 'whatsapp' });
  assert.equal(respuesta, 'respuesta del agente', 'escala al agente completo');
  assert.ok(llamadasLlm.length >= 1, 'el agente fue invocado');
});

test('RF-02: sin enrutador el camino es el historico byte a byte', async () => {
  const llamadasLlm = [];
  const processor = crearMessageProcessor({
    llmProvider: {
      chatCompletion: async () => {
        llamadasLlm.push(1);
        return { message: { content: 'respuesta del agente', tool_calls: [] } };
      }
    },
    memoryRepository: { buscar: async () => [], guardar: async () => {}, listar: async () => [], olvidar: async () => true }
  });
  const respuesta = await processor.procesarMensajeEntrante({ userId: 'u', text: 'buenas', channel: 'whatsapp' });
  assert.equal(respuesta, 'respuesta del agente');
  assert.ok(llamadasLlm.length >= 1);
});

test('RF-02 guardias de salida: la respuesta del nivel 1 sale sin emojis (misma superficie que el agente)', async () => {
  const llamadasLlm = [];
  const enrutador = {
    clasificarIntencion: async () => ({ intencion: 'conversacion', confianza: 0.95, via: 'local_slm' }),
    responderConversacion: async () => ({ exito: true, via: 'local_slm', respuesta: 'Perfecto, ahi va. \u{1F600}\u{1F680}', confianza: 0.9 })
  };
  const processor = processorConEnrutador(enrutador, llamadasLlm);
  const respuesta = await processor.procesarMensajeEntrante({ userId: 'u', text: 'buenas', channel: 'whatsapp' });
  assert.equal(respuesta, 'Perfecto, ahi va.');
  assert.equal(llamadasLlm.length, 0);
});

test('RF-02 guardias de salida: respuesta que finge una accion ejecutada NO se entrega; cae al agente', async () => {
  const llamadasLlm = [];
  const enrutador = {
    clasificarIntencion: async () => ({ intencion: 'conversacion', confianza: 0.95, via: 'local_slm' }),
    responderConversacion: async () => ({ exito: true, via: 'local_slm', respuesta: 'Ya lo he enviado a tu contacto, David.', confianza: 0.9 })
  };
  const processor = processorConEnrutador(enrutador, llamadasLlm);
  const respuesta = await processor.procesarMensajeEntrante({ userId: 'u', text: 'buenas', channel: 'whatsapp' });
  assert.equal(respuesta, 'respuesta del agente', 'representacion falsa de ejecucion: el agente es el unico que ejecuta');
  assert.ok(llamadasLlm.length >= 1, 'el agente fue invocado');
});

test('RF-02 guardias de salida: promesa futura del nivel 1 (te aviso / queda programado) cae al agente', async () => {
  const llamadasLlm = [];
  const enrutador = {
    clasificarIntencion: async () => ({ intencion: 'conversacion', confianza: 0.95, via: 'local_slm' }),
    responderConversacion: async () => ({ exito: true, via: 'local_slm', respuesta: 'Queda programado, te aviso manana.', confianza: 0.9 })
  };
  const processor = processorConEnrutador(enrutador, llamadasLlm);
  const respuesta = await processor.procesarMensajeEntrante({ userId: 'u', text: 'buenas', channel: 'whatsapp' });
  assert.equal(respuesta, 'respuesta del agente');
  assert.ok(llamadasLlm.length >= 1);
});

test('gate auxiliar: sin env el traductor/entrevista reciben undefined (comportamiento previo intacto); con opt-in se inyecta el despachador central', async () => {
  const { resolverChatCompletionAux } = await import('../../whatsappBot.js');
  const prev = process.env.DAVIS_AUX_CHAT_COMPLETION;
  try {
    delete process.env.DAVIS_AUX_CHAT_COMPLETION;
    assert.equal(resolverChatCompletionAux({}), undefined, 'por defecto nada cambia al desplegar');
    const inyectado = async () => ({ message: { content: 'x' } });
    assert.equal(resolverChatCompletionAux({ chatCompletion: inyectado }), inyectado, 'la prueba inyectada siempre gana');
    process.env.DAVIS_AUX_CHAT_COMPLETION = '1';
    assert.equal(typeof resolverChatCompletionAux({}), 'function', 'opt-in explicito activa la reparacion');
  } finally {
    if (prev === undefined) delete process.env.DAVIS_AUX_CHAT_COMPLETION; else process.env.DAVIS_AUX_CHAT_COMPLETION = prev;
  }
});
