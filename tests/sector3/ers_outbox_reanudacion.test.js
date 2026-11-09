/**
 * RF-01 profundo: reanudacion REAL con checkpoint dentro del agente
 * (no vacua: las acciones restauradas cambian el comportamiento),
 * estado incierto durable, durabilidad degradada visible, pipeline
 * asincrono local (ack + entrega) y fixture del presupuesto de escritura.
 *
 * Strict Policy: Zero Emojis.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { consultarJarvisAislado as consultarJarvis } from '../helpers/jarvisAislado.js';
import { abrirBaseDatos } from '../../src/adapters/outbound/persistence/sqlite/connection.js';
import { ejecutarMigraciones } from '../../src/adapters/outbound/persistence/sqlite/migraciones.js';
import { crearSqliteOutboxStore } from '../../src/adapters/outbound/persistence/sqlite/sqliteOutboxStore.js';
import { crearPipelineAsincrono } from '../../src/composition/asyncPipeline.js';

const TOOL_EFECTO = 'herramienta_efecto_prueba';

function chatPorRondas(guion) {
  let llamada = 0;
  return async () => {
    const paso = guion[Math.min(llamada++, guion.length - 1)];
    if (paso.throw) throw new Error(paso.throw);
    return { message: { content: paso.content || 'listo', ...(paso.toolCalls ? { tool_calls: paso.toolCalls } : {}) } };
  };
}

const llamadaEfecto = (id, arg) => ({ id, function: { name: TOOL_EFECTO, arguments: JSON.stringify({ valor: arg }) } });

test('reanudacion: accion completada no se repite y la incierta se declara bloqueada', async () => {
  let ejecuciones = 0;
  const ejecutores = { [TOOL_EFECTO]: async () => { ejecuciones += 1; return 'hecho'; } };
  const opcionesBase = {
    chatId: 'chat-resume@test',
    rutaArchivoIdempotencia: path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'davis-idemp-resume-')), 'idemp.json'),
    ejecutores
  };

  // Fase 1: la ronda 1 ejecuta la accion con efecto y el proceso "muere"
  // en la sintesis (la siguiente llamada LLM falla como una caida).
  const checkpoints = [];
  try {
    await consultarJarvis('ejecuta la accion de prueba', [], {
      ...opcionesBase,
      chatCompletion: chatPorRondas([
        { toolCalls: [llamadaEfecto('c1', 'A')] },
        { throw: 'caida_simulada' }
      ]),
      onCheckpointRonda: (ronda, estado) => checkpoints.push({ ronda, estado })
    });
  } catch { /* caida simulada aceptada */ }
  assert.equal(ejecuciones, 1, 'la accion se ejecuto una vez antes de la caida');
  assert.ok(checkpoints.length >= 1, 'hubo checkpoint durable antes de la caida');
  const ultimo = checkpoints[checkpoints.length - 1].estado;

  // Fase 2 (reanudacion): el modelo pide la MISMA accion otra vez; no
  // debe reejecutarse. Ademas, una accion planificada no completada del
  // checkpoint se declara incierta y se bloquea.
  const claveCompletada = `${TOOL_EFECTO}:${JSON.stringify(JSON.stringify({ valor: 'A' }))}`;
  const claveIncierta = `${TOOL_EFECTO}:${JSON.stringify(JSON.stringify({ valor: 'B' }))}`;
  const checkpointInicial = {
    accionesConEfectos: [...(ultimo.accionesConEfectos || [])],
    accionesPlanificadas: [claveIncierta]
  };
  assert.ok(checkpointInicial.accionesConEfectos.includes(claveCompletada), 'el checkpoint registro la accion completada');

  const respuesta = await consultarJarvis('ejecuta la accion de prueba otra vez', [], {
    ...opcionesBase,
    chatCompletion: chatPorRondas([
      { toolCalls: [llamadaEfecto('c2', 'A'), llamadaEfecto('c3', 'B')] },
      { content: 'final sin mas herramientas' }
    ]),
    checkpointInicial
  });
  assert.equal(ejecuciones, 1, 'ni la completada ni la incierta se reejecutaron');
  assert.equal(typeof respuesta, 'string');
});

test('durabilidad degradada visible: fallo al guardar checkpoint queda declarado', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'davis-outbox-deg-'));
  const db = abrirBaseDatos(path.join(dir, 'j.db'));
  ejecutarMigraciones(db);
  const store = crearSqliteOutboxStore(db);
  const original = store.guardarCheckpoint;
  const storeRoto = Object.freeze({ ...store, guardarCheckpoint: () => { throw new Error('sqlite llena'); }, publicar: store.publicar, encolarRespuesta: store.encolarRespuesta, ultimoCheckpoint: () => null });
  void original;
  const { crearWorkerAgente } = await import('../../src/workers/agentWorker.js');
  const { crearSqliteOutboxQueue } = await import('../../src/adapters/outbound/queue/sqliteOutboxQueueAdapter.js');
  const cola = crearSqliteOutboxQueue({ outboxStore: storeRoto, intervaloMs: 20 });
  const procesar = async (inbound, { opciones }) => {
    try { opciones.onCheckpointRonda(0, { accionesConEfectos: [] }); } catch { /* el agente real lo gestiona; aqui solo nos importa la declaracion */ }
    return 'ok';
  };
  const worker = crearWorkerAgente({ cola, procesar, outboxStore: storeRoto });
  const id = store.publicar({ canal: 'api', tipo: 'mensaje_entrante', payload: { userId: 'u', text: 'x', channel: 'api' } });
  worker.iniciar();
  for (let i = 0; i < 100; i++) {
    const r = store.respuestasPendientes({ canal: 'api' });
    if (r.length > 0) break;
    await new Promise((r2) => setTimeout(r2, 20));
  }
  await worker.cerrar();
  const pendientes = store.respuestasPendientes({ canal: 'api' });
  assert.equal(pendientes.length, 1, `trabajo ${id} respondido`);
  assert.equal(pendientes[0].payload.durabilidadCheckpoints, 'degradada', 'la degradacion se declara, no se simula durabilidad');
  db.close();
});

test('pipeline asincrono local: recepcion con ack, procesamiento y entrega al canal', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'davis-pipeline-'));
  const db = abrirBaseDatos(path.join(dir, 'j.db'));
  ejecutarMigraciones(db);
  const enviados = [];
  const pipeline = crearPipelineAsincrono({
    db,
    procesar: async (inbound) => `eco:${inbound.text}`,
    canales: { whatsapp: { canal: 'whatsapp', enviarTexto: async (dest, texto) => { enviados.push({ dest, texto }); } } },
    intervaloColaMs: 20,
    intervaloEntregaMs: 20
  });
  const t0 = process.hrtime.bigint();
  pipeline.recibir({ userId: 'user@s.whatsapp.net', text: 'hola', channel: 'whatsapp' });
  const ackMs = Number(process.hrtime.bigint() - t0) / 1e6;
  assert.ok(ackMs < 3, `fixture local: escritura outbox ${ackMs.toFixed(2)} ms (senal, NO el SLA de 5 ms del canal vivo)`);
  pipeline.iniciar();
  for (let i = 0; i < 100 && enviados.length === 0; i++) await new Promise((r) => setTimeout(r, 20));
  await pipeline.cerrar();
  assert.deepEqual(enviados, [{ dest: 'user@s.whatsapp.net', texto: 'eco:hola' }]);
  db.close();
});

test('fixture de presupuesto: 1000 escrituras outbox con media < 3 ms (senal local, no SLA)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'davis-outbox-bench-'));
  const db = abrirBaseDatos(path.join(dir, 'j.db'));
  ejecutarMigraciones(db);
  const store = crearSqliteOutboxStore(db);
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < 1000; i++) {
    store.publicar({ canal: 'api', tipo: 'mensaje_entrante', payload: { userId: 'u', text: `m${i}` } });
  }
  const mediaMs = Number(process.hrtime.bigint() - t0) / 1e6 / 1000;
  assert.ok(mediaMs < 3, `media ${mediaMs.toFixed(4)} ms por escritura (fixture local; la medicion del ERS es con el canal vivo)`);
  db.close();
});

test('efecto sin marca durable NO se ejecuta (bloqueo declarado, no degradacion tras el hecho)', async () => {
  let ejecuciones = 0;
  const respuesta = await consultarJarvis('ejecuta la accion de prueba', [], {
    chatId: 'chat-nomark@test',
    rutaArchivoIdempotencia: path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'davis-idemp-nomark-')), 'i.json'),
    ejecutores: { [TOOL_EFECTO]: async () => { ejecuciones += 1; return 'hecho'; } },
    chatCompletion: chatPorRondas([
      { toolCalls: [llamadaEfecto('c1', 'A')] },
      { content: 'final' }
    ]),
    onCheckpointRonda: () => { throw new Error('sqlite llena'); }
  });
  assert.equal(ejecuciones, 0, 'sin marca durable el efecto externo NO se ejecuta');
  assert.equal(typeof respuesta, 'string', 'el bucle sigue y responde declarando el bloqueo');
});

test('entrega: muerte con envio resuelto sin marcar cierra a incierto y NUNCA reenvia', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'davis-deliver-'));
  const db = abrirBaseDatos(path.join(dir, 'j.db'));
  ejecutarMigraciones(db);
  const store = crearSqliteOutboxStore(db);
  const { crearEntregadorRespuestas } = await import('../../src/workers/responseDeliverer.js');

  // Simula la muerte: envio resuelto, marca de entrega falla (proceso muerto).
  let envios = 0;
  const storeMuerte = Object.freeze({
    ...store,
    marcarRespuestaEntregada: () => { throw new Error('proceso muerto'); }
  });
  const idJob = store.publicar({ canal: 'whatsapp', tipo: 'mensaje_entrante', payload: { userId: 'u', text: 'x' } });
  store.encolarRespuesta({ jobId: idJob, canal: 'whatsapp', destinatario: 'u', payload: { texto: 'resp' } });
  const d1 = crearEntregadorRespuestas({
    outboxStore: storeMuerte, intervaloMs: 20,
    canales: { whatsapp: { canal: 'whatsapp', enviarTexto: async () => { envios += 1; } } }
  });
  d1.iniciar();
  await new Promise((r) => setTimeout(r, 120));
  await d1.cerrar();
  assert.equal(envios, 1, 'un solo envio resuelto');

  // Recuperacion: el 'enviando' expirado pasa a incierto y no se reenvia.
  db.prepare("UPDATE channel_responses SET enviando_en = ? WHERE estado = 'enviando'")
    .run(new Date(Date.now() - 300000).toISOString());
  const d2 = crearEntregadorRespuestas({
    outboxStore: store, intervaloMs: 20,
    canales: { whatsapp: { canal: 'whatsapp', enviarTexto: async () => { envios += 1; } } }
  });
  d2.iniciar();
  await new Promise((r) => setTimeout(r, 120));
  await d2.cerrar();
  assert.equal(envios, 1, 'la respuesta incierta NO se reenvia a ciegas');
  assert.equal(store.respuestasIncertas().length, 1, 'queda visible para reconciliacion');
  db.close();
});

test('entrega: SOLO fallo pre-envio verificado vuelve a pendiente y reintenta', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'davis-deliver-retry-'));
  const db = abrirBaseDatos(path.join(dir, 'j.db'));
  ejecutarMigraciones(db);
  const store = crearSqliteOutboxStore(db);
  const { crearEntregadorRespuestas } = await import('../../src/workers/responseDeliverer.js');
  let intentos = 0;
  const idJob = store.publicar({ canal: 'whatsapp', tipo: 'mensaje_entrante', payload: { userId: 'u', text: 'x' } });
  store.encolarRespuesta({ jobId: idJob, canal: 'whatsapp', destinatario: 'u', payload: { texto: 'resp' } });
  const d = crearEntregadorRespuestas({
    outboxStore: store, intervaloMs: 20,
    canales: { whatsapp: { canal: 'whatsapp', enviarTexto: async () => {
      intentos += 1;
      if (intentos === 1) {
        // Sesion inexistente: el adaptador garantiza que el mensaje no salio.
        throw Object.assign(new Error('sin sesion abierta'), { esFalloPreEnvioVerificado: true });
      }
    } } }
  });
  d.iniciar();
  for (let i = 0; i < 100 && intentos < 2; i++) await new Promise((r) => setTimeout(r, 20));
  await d.cerrar();
  assert.equal(intentos, 2, 'fallo pre-envio verificado: reintento y exito');
  assert.equal(store.respuestasPendientes({ canal: 'whatsapp' }).length, 0);
  assert.equal(store.respuestasIncertas().length, 0);
  db.close();
});

test('entrega: timeout ambiguo tras el intento cierra a incierto y NUNCA reintenta', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'davis-deliver-timeout-'));
  const db = abrirBaseDatos(path.join(dir, 'j.db'));
  ejecutarMigraciones(db);
  const store = crearSqliteOutboxStore(db);
  const { crearEntregadorRespuestas } = await import('../../src/workers/responseDeliverer.js');
  let envios = 0;
  const idJob = store.publicar({ canal: 'whatsapp', tipo: 'mensaje_entrante', payload: { userId: 'u', text: 'x' } });
  store.encolarRespuesta({ jobId: idJob, canal: 'whatsapp', destinatario: 'u', payload: { texto: 'resp' } });
  // Canal faux: el mensaje llega al socket pero el SDK rechaza por timeout.
  // Eso NO prueba que WhatsApp no lo recibiera.
  const canalAmbiguo = { canal: 'whatsapp', enviarTexto: async () => {
    envios += 1; // el intento salio hacia el proveedor
    throw new Error('Timed Out'); // sin marca de pre-envio: resultado incierto
  } };
  const d = crearEntregadorRespuestas({ outboxStore: store, intervaloMs: 20, canales: { whatsapp: canalAmbiguo } });
  d.iniciar();
  await new Promise((r) => setTimeout(r, 150));
  await d.cerrar();
  assert.equal(envios, 1, 'timeout ambiguo: un solo intento, cero reenvios ciegos');
  assert.equal(store.respuestasPendientes({ canal: 'whatsapp' }).length, 0, 'no vuelve a pendiente');
  const inciertas = store.respuestasIncertas();
  assert.equal(inciertas.length, 1, 'queda incierta y visible para reconciliacion');
  db.close();
});
