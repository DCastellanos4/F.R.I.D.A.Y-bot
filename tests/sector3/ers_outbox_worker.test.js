/**
 * RF-01 (ERS proximo nivel): outbox transaccional, cola duradera SQLite y
 * worker con checkpoints y recuperacion ante caidas.
 *
 * Cubre:
 * - La migracion 006 crea outbox_events, job_checkpoints y channel_responses.
 * - Publicar/reclamar/completar y reclamo atomico (dos reclamos no pisan).
 * - Reintento con backoff y fallo definitivo tras maxIntentos.
 * - Recuperacion de un trabajo en_curso cuyo reclamo expiro (worker muerto).
 * - Worker end-to-end con procesador simulado: checkpoints por ronda,
 *   respuesta encolada UNA sola vez aunque el trabajo se reejecute.
 * - La cola SQLite consume trabajos publicados (sondeo real).
 *
 * Strict Policy: Zero Emojis.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { abrirBaseDatos } from '../../src/adapters/outbound/persistence/sqlite/connection.js';
import { ejecutarMigraciones } from '../../src/adapters/outbound/persistence/sqlite/migraciones.js';
import { crearSqliteOutboxStore } from '../../src/adapters/outbound/persistence/sqlite/sqliteOutboxStore.js';
import { crearSqliteOutboxQueue } from '../../src/adapters/outbound/queue/sqliteOutboxQueueAdapter.js';
import { crearWorkerAgente } from '../../src/workers/agentWorker.js';

function crearEntorno() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'davis-outbox-'));
  const db = abrirBaseDatos(path.join(dir, 'jarvis.db'));
  ejecutarMigraciones(db);
  return { db, store: crearSqliteOutboxStore(db), dir };
}

function dormir(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

test('migracion 006 crea las tablas del outbox y es idempotente', () => {
  const { db } = crearEntorno();
  const tablas = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((t) => t.name);
  for (const t of ['outbox_events', 'job_checkpoints', 'channel_responses']) {
    assert.ok(tablas.includes(t), `falta la tabla ${t}`);
  }
  const segunda = ejecutarMigraciones(db);
  assert.deepEqual(segunda.aplicadasAhora, []);
  db.close();
});

test('publicar y reclamar: el reclamo es atomico y no repite trabajos', () => {
  const { db, store } = crearEntorno();
  const id = store.publicar({
    tenantId: 'propietario',
    canal: 'whatsapp',
    tipo: 'mensaje_entrante',
    payload: { userId: 'chat1', text: 'hola', channel: 'whatsapp' }
  });
  assert.ok(id);
  const primero = store.reclamarPendientes({ limite: 4 });
  assert.equal(primero.length, 1);
  assert.equal(primero[0].id, id);
  assert.equal(primero[0].payload.text, 'hola');
  assert.equal(primero[0].estado, 'en_curso');
  const segundo = store.reclamarPendientes({ limite: 4 });
  assert.equal(segundo.length, 0, 'un trabajo en_curso no se reclama dos veces');
  store.marcarCompletado(id);
  assert.deepEqual(store.contadores(), { pendiente: 0, en_curso: 0, completado: 1, fallido: 0 });
  db.close();
});

test('fallo con reintento: backoff y fallo definitivo tras maxIntentos', () => {
  const { db, store } = crearEntorno();
  const id = store.publicar({ canal: 'whatsapp', tipo: 'mensaje_entrante', payload: { userId: 'c', text: 'x' } });
  store.reclamarPendientes({});
  store.marcarFallido(id, new Error('boom'), { maxIntentos: 2, backoffMs: 60000 });
  let contadores = store.contadores();
  assert.equal(contadores.pendiente, 1, 'tras el primer fallo vuelve a pendiente');
  // Con el backoff no esta disponible todavia.
  assert.equal(store.reclamarPendientes({}).length, 0, 'el backoff retrasa la disponibilidad');
  // Forzamos disponibilidad inmediata para el segundo intento.
  db.prepare("UPDATE outbox_events SET disponible_en = ? WHERE id = ?").run(new Date(0).toISOString(), id);
  store.reclamarPendientes({});
  store.marcarFallido(id, new Error('boom2'), { maxIntentos: 2, backoffMs: 60000 });
  contadores = store.contadores();
  assert.equal(contadores.fallido, 1, 'agotados los intentos queda fallido y visible');
  const fila = db.prepare('SELECT ultimo_error, intentos FROM outbox_events WHERE id = ?').get(id);
  assert.equal(fila.intentos, 2);
  assert.match(fila.ultimo_error, /boom2/);
  db.close();
});

test('recuperacion: un trabajo en_curso con reclamo expirado vuelve a pendiente', () => {
  const { db, store } = crearEntorno();
  const id = store.publicar({ canal: 'api', tipo: 'mensaje_entrante', payload: { userId: 'c', text: 'x' } });
  store.reclamarPendientes({});
  // Simulamos la muerte del worker: el reclamo queda viejo y nadie completa.
  db.prepare('UPDATE outbox_events SET reclamado_en = ? WHERE id = ?')
    .run(new Date(Date.now() - 120000).toISOString(), id);
  assert.equal(store.recuperarExpirados({ expiracionMs: 60000 }), 1);
  const reclamados = store.reclamarPendientes({});
  assert.equal(reclamados.length, 1, 'el trabajo se reprocesa tras la caida');
  assert.equal(reclamados[0].id, id);
  db.close();
});

test('worker: checkpoints por ronda y respuesta idempotente ante reejecucion', async () => {
  const { db, store } = crearEntorno();
  let ejecuciones = 0;
  const procesar = async (inbound, { opciones }) => {
    ejecuciones += 1;
    for (let ronda = 0; ronda < 2; ronda++) {
      opciones.onCheckpointRonda(ronda, { herramientasCompletadas: [`t${ronda}`] });
    }
    return `respuesta a ${inbound.text}`;
  };
  const cola = crearSqliteOutboxQueue({ outboxStore: store, intervaloMs: 20 });
  const worker = crearWorkerAgente({ cola, procesar, outboxStore: store });

  const id = store.publicar({
    canal: 'whatsapp',
    tipo: 'mensaje_entrante',
    payload: { userId: 'user@s.whatsapp.net', text: 'dime la hora', channel: 'whatsapp' }
  });
  worker.iniciar();
  for (let i = 0; i < 100 && store.contadores().completado === 0; i++) await dormir(20);
  await worker.cerrar();

  assert.equal(store.contadores().completado, 1, 'trabajo completado');
  const checkpoints = store.checkpoints(id);
  assert.equal(checkpoints.length, 2, 'un checkpoint por ronda');
  assert.deepEqual(checkpoints[1].estado, { herramientasCompletadas: ['t1'] });

  // Reejecucion simulada tras caida entre respuesta y completado: la
  // respuesta NO se duplica en channel_responses (id determinista).
  const encolada1 = store.encolarRespuesta({ jobId: id, canal: 'whatsapp', destinatario: 'u', payload: { texto: 'r' } });
  assert.equal(encolada1, false, 'la respuesta del trabajo ya existe: no se duplica');

  const pendientes = store.respuestasPendientes({ canal: 'whatsapp' });
  assert.equal(pendientes.length, 1);
  assert.equal(pendientes[0].payload.texto, 'respuesta a dime la hora');
  store.marcarRespuestaEntregada(pendientes[0].id);
  assert.equal(store.respuestasPendientes({ canal: 'whatsapp' }).length, 0);
  db.close();
});

test('cola sqlite: reintento automatico de un manejador que falla una vez', async () => {
  const { db, store } = crearEntorno();
  let intentos = 0;
  const cola = crearSqliteOutboxQueue({ outboxStore: store, intervaloMs: 20, backoffMs: 1, maxIntentos: 3 });
  const worker = crearWorkerAgente({
    cola,
    outboxStore: store,
    procesar: async () => {
      intentos += 1;
      if (intentos === 1) throw new Error('caida transitoria');
      return 'ok';
    }
  });
  store.publicar({ canal: 'api', tipo: 'mensaje_entrante', payload: { userId: 'u', text: 'x', channel: 'api' } });
  worker.iniciar();
  for (let i = 0; i < 100 && store.contadores().completado === 0; i++) await dormir(20);
  await worker.cerrar();
  assert.equal(intentos, 2, 'fallo una vez y reintento completo');
  assert.equal(store.contadores().completado, 1);
  db.close();
});
