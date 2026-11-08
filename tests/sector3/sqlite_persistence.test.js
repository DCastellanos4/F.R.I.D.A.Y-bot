/**
 * sqlite_persistence.test.js - Persistencia transaccional SQLite.
 *
 * Demuestran que:
 * 1. Las migraciones son versionadas e idempotentes; WAL real en archivo.
 * 2. La costura store de memoryService mantiene el comportamiento:
 *    dedup de hechos, cifrado fail-closed, confirmacion de borrado masivo.
 * 3. La RMW es atomica entre DOS conexiones: un escritor bloquea al
 *    otro (busy_timeout) y al reintentar relee los datos confirmados
 *    (actualiza, no duplica); un lector nunca ve estado a medias (WAL).
 * 4. La costura store de financeService mantiene el comportamiento,
 *    incluido el flujo de borradores de ticket.
 * 5. La importacion JSON -> SQLite es todo-o-nada, idempotente, no toca
 *    los JSON y deja marca de origen; estado inconsistente = fallo cerrado.
 * 6. La exportacion SQLite -> JSON vuelca el estado actual con
 *    verificacion de integridad (conteos + sha256) en directorio nuevo.
 * 7. UserRepositoryPort registra contacto sin autorizar nada.
 * 8. La fuente semantica SQLite mantiene la frescura del indice RAG.
 * 9. El contenedor activa sqlite por entorno y lo registra por defecto.
 *
 * Strict Policy: Zero Emojis.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

import { abrirBaseDatos } from '../../src/adapters/outbound/persistence/sqlite/connection.js';
import { ejecutarMigraciones } from '../../src/adapters/outbound/persistence/sqlite/migraciones.js';
import { crearSqliteMemoryStore } from '../../src/adapters/outbound/persistence/sqlite/sqliteMemoryStore.js';
import { crearSqliteFinanceStore } from '../../src/adapters/outbound/persistence/sqlite/sqliteFinanceStore.js';
import { crearSqliteUserRepository } from '../../src/adapters/outbound/persistence/sqlite/sqliteUserRepository.js';
import { crearPersistenciaSqlite } from '../../src/adapters/outbound/persistence/sqlite/persistenciaSqlite.js';
import {
  importarJsonASqlite,
  exportarSqliteAJson,
  comprobarEstadoConsistente
} from '../../src/adapters/outbound/persistence/sqlite/importExport.js';
import { afirmarUserRepository } from '../../src/ports/outbound/UserRepositoryPort.js';
import {
  guardarMemoria,
  buscarMemorias,
  listarMemorias,
  olvidarMemoria,
  registrarStoreMemoriasPorDefecto
} from '../../src/services/memoryService.js';
import {
  registrarGasto,
  listarGastos,
  registrarSuscripcion,
  configurarPresupuesto,
  estadoPresupuestos,
  crearBorradorDesdeTicket,
  borradorPendiente,
  confirmarBorrador
} from '../../src/services/financeService.js';
import {
  buscarMemoriaSemantica,
  registrarFuenteMemoriasPorDefecto,
  invalidarIndiceSemantico
} from '../../src/services/semanticMemoryService.js';

function dirTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'davis-sqlite-test-'));
}

function abrirMigrada(rutaDb) {
  const db = abrirBaseDatos(rutaDb);
  ejecutarMigraciones(db);
  return db;
}

// ---------------------------------------------------------------- 1. DDL

test('migraciones versionadas e idempotentes; WAL real en archivo', () => {
  const dir = dirTmp();
  const rutaDb = path.join(dir, 'jarvis.db');
  const db = abrirMigrada(rutaDb);

  assert.equal(db.pragma('journal_mode', { simple: true }), 'wal');
  assert.equal(db.pragma('foreign_keys', { simple: true }), 1);

  const versiones = db.prepare('SELECT version, nombre FROM schema_migrations').all();
  assert.deepEqual(versiones.map((v) => v.version), [1, 2, 3, 4]);

  // Segunda ejecucion: no reaplica ni falla.
  const segunda = ejecutarMigraciones(db);
  assert.deepEqual(segunda.aplicadasAhora, []);

  // Integridad referencial activa: borrador con gasto inexistente falla.
  assert.throws(() => {
    db.prepare(
      "INSERT INTO finanzas_borradores (id, estado, datos, gasto_id, creado_en) VALUES ('b1', 'confirmado', '{}', 'no-existe', '2026-01-01')"
    ).run();
  }, /FOREIGN KEY/);
  db.close();
});

// ---------------------------------------------------- 2. Paridad memoria

test('store sqlite de memoria: dedup, listar, buscar y olvidar con confirmacion', () => {
  const db = abrirMigrada(path.join(dirTmp(), 'm.db'));
  const store = crearSqliteMemoryStore(db);
  const deps = { store };

  const creada = guardarMemoria({ sujeto: 'talla de pie', dato: 'David calza un 42', categoria: 'personal', store });
  assert.equal(creada.ok, true);
  assert.equal(creada.accion, 'creada');

  // Mismo hecho con otras palabras: actualiza, no duplica.
  const repetida = guardarMemoria({ sujeto: 'talla de pie', dato: 'David calza un 43', categoria: 'personal', store });
  assert.equal(repetida.accion, 'actualizada');
  assert.equal(listarMemorias(null, deps).length, 1);
  assert.match(listarMemorias(null, deps)[0].dato, /43/);

  const encontradas = buscarMemorias('que talla calza David', deps);
  assert.equal(encontradas.length > 0, true);
  assert.match(encontradas[0].dato, /43/);

  // Borrado masivo exige confirmacion explicita en la misma peticion.
  const sinConfirmar = olvidarMemoria('todo', { store: deps.store });
  assert.equal(sinConfirmar.requiereConfirmacion, true);
  assert.equal(listarMemorias(null, deps).length, 1);

  const confirmado = olvidarMemoria('todo', { store: deps.store, confirmado: true });
  assert.equal(confirmado.ok, true);
  assert.equal(listarMemorias(null, deps).length, 0);
  db.close();
});

test('memoria clave: fail-closed sin clave y cifrada en reposo con clave', () => {
  const dir = dirTmp();
  const db = abrirMigrada(path.join(dir, 'm.db'));
  const store = crearSqliteMemoryStore(db);

  delete process.env.MEMORY_ENCRYPTION_KEY;
  const sinClave = guardarMemoria({ sujeto: 'api demo', dato: 'valor-secreto', categoria: 'clave', store });
  assert.equal(sinClave.ok, false);
  assert.match(sinClave.error, /MEMORY_ENCRYPTION_KEY/);
  assert.equal(listarMemorias(null, { store }).length, 0);

  process.env.MEMORY_ENCRYPTION_KEY = 'clave-de-pruebas';
  const conClave = guardarMemoria({ sujeto: 'api demo', dato: 'valor-secreto', categoria: 'clave', store });
  assert.equal(conClave.ok, true);

  // En la base, el dato viaja cifrado: nunca en claro.
  const fila = db.prepare('SELECT dato, cifrado, salt, iv, tag FROM memorias').get();
  assert.equal(fila.cifrado, 'aes-256-gcm');
  assert.equal(fila.dato.includes('valor-secreto'), false);
  assert.ok(fila.salt && fila.iv && fila.tag);

  // Al leer por el servicio, se descifra.
  const leidas = listarMemorias('clave', { store });
  assert.equal(leidas[0].dato, 'valor-secreto');

  delete process.env.MEMORY_ENCRYPTION_KEY;
  db.close();
});

// ------------------------------------------------- 3. RMW entre conexiones

test('dos conexiones: sin actualizacion perdida y sin lecturas a medias', () => {
  const dir = dirTmp();
  const rutaDb = path.join(dir, 'rmw.db');
  const dbA = abrirMigrada(rutaDb);
  const dbB = abrirMigrada(rutaDb);
  dbB.pragma('busy_timeout = 150'); // en pruebas, espera corta
  const storeA = crearSqliteMemoryStore(dbA);
  const storeB = crearSqliteMemoryStore(dbB);

  // Un lector durante la transaccion de otro nunca ve estado a medias.
  dbA.exec('BEGIN IMMEDIATE');
  dbA.prepare(
    "INSERT INTO memorias (id, sujeto, dato, categoria, fecha_registro) VALUES ('mem_a', 'color favorito', 'azul marino', 'personal', '2026-01-01T00:00:00.000Z')"
  ).run();
  assert.deepEqual(storeB.leer(), []); // snapshot anterior: nada a medias
  dbA.exec('COMMIT');
  assert.equal(storeB.leer().length, 1);

  // Escritor B durante el candado de A: espera y agota busy_timeout.
  dbA.exec('BEGIN IMMEDIATE');
  dbA.prepare(
    "INSERT INTO memorias (id, sujeto, dato, categoria, fecha_registro) VALUES ('mem_b', 'comida favorita', 'tortilla', 'personal', '2026-01-01T00:00:00.000Z')"
  ).run();
  assert.throws(() => storeB.transaccion(() => storeB.leer()), /database is locked/);
  dbA.exec('COMMIT');

  // Tras el commit de A, la RMW de B relee los datos confirmados:
  // el mismo hecho se ACTUALIZA en vez de duplicarse.
  const resultado = guardarMemoria({ sujeto: 'comida favorita', dato: 'tortilla de patatas', categoria: 'personal', store: storeB });
  assert.equal(resultado.accion, 'actualizada');
  const todas = storeA.leer().filter((m) => m.sujeto === 'comida favorita');
  assert.equal(todas.length, 1);
  assert.match(todas[0].dato, /patatas/);

  dbA.close();
  dbB.close();
});

// -------------------------------------------------- 4. Paridad finanzas

test('store sqlite de finanzas: gastos, suscripciones, presupuestos y borradores', () => {
  const db = abrirMigrada(path.join(dirTmp(), 'f.db'));
  const store = crearSqliteFinanceStore(db);
  const deps = { store };

  const gasto = registrarGasto({ importe: 12.5, comercio: 'Lidl', categoria: 'comida' }, deps);
  assert.equal(gasto.ok, true);
  const duplicado = registrarGasto({ importe: 12.5, comercio: 'Lidl', categoria: 'comida', fecha: gasto.gasto.fecha }, deps);
  assert.match(duplicado.aviso, /gasto identico/);
  assert.equal(listarGastos({}, deps).length, 2);

  const sub = registrarSuscripcion({ nombre: 'Spotify', importe: 10.99, diaRenovacion: 5 }, deps);
  assert.equal(sub.ok, true);
  const subRepetida = registrarSuscripcion({ nombre: 'spotify', importe: 10.99, diaRenovacion: 5 }, deps);
  assert.equal(subRepetida.ok, false);

  configurarPresupuesto({ categoria: 'comida', limite: 200 }, deps);
  const presupuestos = estadoPresupuestos({}, deps);
  assert.equal(presupuestos.length, 1);
  assert.equal(presupuestos[0].limite, 200);

  // Flujo de borrador de ticket completo.
  const borrador = crearBorradorDesdeTicket(
    { importe: 7.3, comercio: 'Mercadona', fecha: '2026-11-08', categoria: 'comida', moneda: 'EUR' },
    { ...deps, chatId: 'chat-test' }
  );
  assert.equal(borrador.ok, true);
  const pendiente = borradorPendiente({ ...deps, chatId: 'chat-test' });
  assert.equal(pendiente.id, borrador.borrador.id);
  const confirmacion = confirmarBorrador({ id: pendiente.id }, { ...deps, chatId: 'chat-test' });
  assert.equal(confirmacion.ok, true);
  const estado = store.leer();
  assert.equal(estado.borradores[0].estado, 'confirmado');
  assert.equal(estado.borradores[0].gastoId, confirmacion.gasto.id);
  assert.equal(estado.gastos.some((g) => g.origen === 'foto'), true);
  db.close();
});

// -------------------------------------------------- 5. Importacion

test('importacion: todo-o-nada, idempotente, JSON intactos y marca de origen', () => {
  const dir = dirTmp();
  const rutaMemorias = path.join(dir, 'brain_memory.json');
  const rutaFinanzas = path.join(dir, 'finanzas.json');
  const memorias = [
    { id: 'mem_1', sujeto: 'cumple madre', dato: '12 de marzo', categoria: 'personal', tags: ['cumple'], fechaRegistro: '2026-01-01T00:00:00.000Z', fechaLocal: '01/01/2026 00:00' },
    { id: 'mem_2', sujeto: 'talla pie', dato: '42', categoria: 'personal', tags: [], fechaRegistro: '2026-01-02T00:00:00.000Z', fechaLocal: '02/01/2026 00:00' }
  ];
  const finanzas = {
    gastos: [{ id: 'g1', importe: 5, comercio: 'Bar', categoria: 'ocio', fecha: '2026-11-01', notas: null, origen: 'manual', creadoEn: '2026-11-01T10:00:00.000Z' }],
    suscripciones: [{ id: 's1', nombre: 'Netflix', importe: 12.99, diaRenovacion: 15, categoria: 'ocio', ultimoAvisoPara: null, creadaEn: '2026-10-01T10:00:00.000Z' }],
    presupuestos: { ocio: 100 },
    config: { avisosSuscripciones: true }
  };
  fs.writeFileSync(rutaMemorias, JSON.stringify(memorias, null, 2));
  fs.writeFileSync(rutaFinanzas, JSON.stringify(finanzas, null, 2));
  const bytesMemoriasAntes = fs.readFileSync(rutaMemorias, 'utf-8');
  const bytesFinanzasAntes = fs.readFileSync(rutaFinanzas, 'utf-8');

  const rutaDb = path.join(dir, 'jarvis.db');
  const db = abrirMigrada(rutaDb);
  const memoryStore = crearSqliteMemoryStore(db);
  const financeStore = crearSqliteFinanceStore(db);

  const primera = importarJsonASqlite(db, { rutaMemorias, rutaFinanzas, memoryStore, financeStore });
  assert.equal(primera.ok, true);
  assert.deepEqual(primera.importados, { memorias: 2, gastos: 1, suscripciones: 1, usuarios: 0 });

  // Los JSON de origen quedan byte a byte intactos.
  assert.equal(fs.readFileSync(rutaMemorias, 'utf-8'), bytesMemoriasAntes);
  assert.equal(fs.readFileSync(rutaFinanzas, 'utf-8'), bytesFinanzasAntes);

  // Los datos importados son accesibles e identicos.
  assert.equal(memoryStore.leer().length, 2);
  assert.equal(financeStore.leer().gastos[0].comercio, 'Bar');
  assert.equal(financeStore.leer().config.avisosSuscripciones, true);

  // Idempotente: segunda llamada no duplica.
  const segunda = importarJsonASqlite(db, { rutaMemorias, rutaFinanzas, memoryStore, financeStore });
  assert.equal(segunda.yaImportado, true);
  assert.equal(memoryStore.leer().length, 2);

  // Marca de origen registrada.
  const origen = db.prepare("SELECT valor FROM meta WHERE clave = 'origen'").get();
  assert.equal(origen.valor, 'importada');
  assert.equal(comprobarEstadoConsistente(db), null);
  db.close();
});

test('estado inconsistente (datos sin marca de origen): fallo cerrado', () => {
  const dir = dirTmp();
  const rutaDb = path.join(dir, 'roto.db');
  const db = abrirMigrada(rutaDb);
  // Simula una importacion interrumpida: datos sin marca de origen.
  db.prepare(
    "INSERT INTO memorias (id, sujeto, dato, categoria, fecha_registro) VALUES ('x', 's', 'd', 'general', '2026-01-01')"
  ).run();
  db.close();

  assert.throws(
    () => crearPersistenciaSqlite({ rutaDb }),
    /estado inconsistente/i
  );
});

test('base nueva sin JSON previos se marca como nueva, no importada', () => {
  const dir = dirTmp();
  const persistencia = crearPersistenciaSqlite({ rutaDb: path.join(dir, 'nueva.db') });
  const origen = persistencia.db.prepare("SELECT valor FROM meta WHERE clave = 'origen'").get();
  assert.equal(origen.valor, 'nueva');
  persistencia.cerrar();
});

// -------------------------------------------------- 6. Exportacion

test('exportacion: volcado actual con integridad verificable, sin sobrescribir', () => {
  const dir = dirTmp();
  const rutaDb = path.join(dir, 'exp.db');
  const persistencia = crearPersistenciaSqlite({ rutaDb });
  guardarMemoria({ sujeto: 'equipo', dato: 'portatil lenovo', store: persistencia.memoryStore });
  registrarGasto({ importe: 3.2, comercio: 'Cafe', categoria: 'ocio' }, { store: persistencia.financeStore });
  persistencia.userRepository.registrarContacto('+34611111111');

  const dirExport = path.join(dir, 'export-1');
  const resultado = exportarSqliteAJson(persistencia.db, {
    dirDestino: dirExport,
    memoryStore: persistencia.memoryStore,
    financeStore: persistencia.financeStore
  });
  assert.equal(resultado.ok, true);
  assert.equal(resultado.manifiesto.conteos.memorias, 1);
  assert.equal(resultado.manifiesto.conteos.gastos, 1);
  assert.equal(resultado.manifiesto.conteos.usuarios, 1);
  assert.equal(JSON.parse(fs.readFileSync(resultado.rutaUsuarios, 'utf-8'))[0].telefono, '+34611111111');

  // Integridad verificable: el hash del manifiesto corresponde al archivo.
  const contenido = fs.readFileSync(resultado.rutaMemorias, 'utf-8');
  const hash = crypto.createHash('sha256').update(contenido).digest('hex');
  assert.equal(resultado.manifiesto.sha256['brain_memory.json'], hash);
  assert.equal(JSON.parse(contenido)[0].dato, 'portatil lenovo');

  // Nunca sobrescribe una exportacion previa.
  assert.throws(() => exportarSqliteAJson(persistencia.db, {
    dirDestino: dirExport,
    memoryStore: persistencia.memoryStore,
    financeStore: persistencia.financeStore
  }), /ya existe/);

  // Round trip: la exportacion alimenta una base nueva con los mismos datos.
  const persistencia2 = crearPersistenciaSqlite({
    rutaDb: path.join(dir, 'restaurada.db'),
    rutaMemoriasJson: resultado.rutaMemorias,
    rutaFinanzasJson: resultado.rutaFinanzas,
    rutaUsuariosJson: resultado.rutaUsuarios
  });
  assert.equal(persistencia2.memoryStore.leer().length, 1);
  assert.equal(persistencia2.financeStore.leer().gastos.length, 1);
  assert.equal(persistencia2.userRepository.obtener('+34611111111').telefono, '+34611111111');

  persistencia.cerrar();
  persistencia2.cerrar();
});

// -------------------------------------------------- 7. UserRepository

test('user repository: registra contacto sin autorizar; puerto validado', () => {
  assert.throws(() => afirmarUserRepository({ obtener: () => null }), /registrarContacto/);

  const db = abrirMigrada(path.join(dirTmp(), 'u.db'));
  let reloj = 1_000;
  const repo = crearSqliteUserRepository(db, { ahora: () => new Date(reloj).toISOString() });

  assert.equal(repo.obtener('+34600000000'), null);
  repo.registrarContacto('+34600000000');
  const primero = repo.obtener('+34600000000');
  assert.equal(primero.primerContacto, new Date(1_000).toISOString());

  reloj = 2_000;
  repo.registrarContacto('+34600000000');
  const despues = repo.obtener('+34600000000');
  assert.equal(despues.primerContacto, primero.primerContacto); // no se pisa
  assert.equal(despues.ultimoAcceso, new Date(2_000).toISOString());

  assert.equal(repo.listar().length, 1);
  assert.equal(repo.registrarContacto('').ok, false);
  db.close();
});

// -------------------------------------------- 8. Fuente semantica RAG

test('fuente semantica sqlite: el indice RAG lee de la base y detecta escrituras', async () => {
  const dir = dirTmp();
  const rutaDb = path.join(dir, 'rag.db');
  const persistencia = crearPersistenciaSqlite({ rutaDb });
  const vectorsPath = path.join(dir, 'vectors.json');
  const sinJson = path.join(dir, 'no_existe.json'); // el JSON historico NO existe

  registrarFuenteMemoriasPorDefecto(persistencia.fuenteSemantica);
  invalidarIndiceSemantico();
  try {
    guardarMemoria({ sujeto: 'restaurante favorito', dato: 'casa paco en malasana', categoria: 'personal', store: persistencia.memoryStore });

    // Camino SEMANTICO directo (no el fallback textual de buscarMemorias).
    const primera = await buscarMemoriaSemantica('donde como bien en malasana', {
      storePath: sinJson,
      vectorsPath,
      threshold: 0.01
    });
    assert.equal(primera.length > 0, true);
    assert.match(primera[0].dato, /casa paco/i);

    // El indice en disco se reconstruyo DESDE LA BASE con la firma sqlite.
    const indice1 = JSON.parse(fs.readFileSync(vectorsPath, 'utf-8'));
    assert.equal(indice1.firmaMemoria, persistencia.fuenteSemantica.firma());
    assert.equal(indice1.vocabulary.includes('paco'), true);
    const mtime1 = fs.statSync(vectorsPath).mtimeMs;

    // Escritura nueva: la firma cambia y la siguiente busqueda semantica
    // reconstruye el indice con el termino nuevo.
    guardarMemoria({ sujeto: 'taller de confianza', dato: 'motorland en alcala', categoria: 'personal', store: persistencia.memoryStore });
    invalidarIndiceSemantico();
    const segunda = await buscarMemoriaSemantica('taller para el coche', {
      storePath: sinJson,
      vectorsPath,
      threshold: 0.01
    });
    assert.equal(segunda.some((r) => /motorland/i.test(r.dato)), true);
    const indice2 = JSON.parse(fs.readFileSync(vectorsPath, 'utf-8'));
    assert.equal(indice2.vocabulary.includes('motorland'), true);
    assert.equal(indice2.firmaMemoria, persistencia.fuenteSemantica.firma());
    assert.equal(fs.statSync(vectorsPath).mtimeMs >= mtime1, true);

    // Tras el borrado, la reconstruccion purga el termino del indice en disco.
    olvidarMemoria('taller de confianza', { store: persistencia.memoryStore });
    invalidarIndiceSemantico();
    await buscarMemoriaSemantica('taller para el coche', { storePath: sinJson, vectorsPath, threshold: 0.01 });
    const indice3 = JSON.parse(fs.readFileSync(vectorsPath, 'utf-8'));
    assert.equal(indice3.vocabulary.includes('motorland'), false);
    assert.equal(indice3.vocabulary.includes('paco'), true); // la otra sigue
    assert.equal(indice3.firmaMemoria, persistencia.fuenteSemantica.firma());
  } finally {
    registrarFuenteMemoriasPorDefecto(null);
    invalidarIndiceSemantico();
    persistencia.cerrar();
  }
});

// -------------------------------------------------- 9. Contenedor

test('contenedor: sqlite por entorno registra stores por defecto y registra contacto', async () => {
  const dir = dirTmp();
  process.env.DAVIS_PERSISTENCE = 'sqlite';
  process.env.DAVIS_SQLITE_PATH = path.join(dir, 'cont.db');
  process.env.DAVIS_DATA_DIR = dir;
  try {
    const { crearContenedor } = await import('../../src/composition/container.js');
    const contenedor = crearContenedor({ llmProvider: { chatCompletion: async () => ({ choices: [] }) } });
    assert.ok(contenedor.persistencia);

    // El store por defecto quedo registrado: guardar sin deps va a SQLite
    // (puede haber mas registros si el JSON historico del repo se importo).
    const r = guardarMemoria({ sujeto: 'nota contenedor', dato: 'funciona por defecto' });
    assert.equal(r.ok, true);
    assert.equal(
      contenedor.persistencia.memoryStore.leer().some((m) => m.dato === 'funciona por defecto'),
      true
    );

    // El hook registra el contacto del usuario ya procesado.
    contenedor.persistencia.userRepository.registrarContacto('+34611111111');
    assert.equal(contenedor.persistencia.userRepository.listar().length, 1);

    contenedor.persistencia.cerrar();
  } finally {
    delete process.env.DAVIS_PERSISTENCE;
    delete process.env.DAVIS_SQLITE_PATH;
    delete process.env.DAVIS_DATA_DIR;
    registrarStoreMemoriasPorDefecto(null);
    const { registrarStoreFinanzasPorDefecto } = await import('../../src/services/financeService.js');
    registrarStoreFinanzasPorDefecto(null);
    registrarFuenteMemoriasPorDefecto(null);
  }
});

test('mezcla de backends nunca es silenciosa: ruta JSON explicita con sqlite activo avisa', () => {
  const dir = dirTmp();
  const persistencia = crearPersistenciaSqlite({ rutaDb: path.join(dir, 'mix.db') });
  registrarStoreMemoriasPorDefecto(persistencia.memoryStore);
  const errores = [];
  const originalError = console.error;
  console.error = (msg) => errores.push(String(msg));
  try {
    const rutaJson = path.join(dir, 'aislado.json');
    const r = guardarMemoria({ sujeto: 'nota aislada', dato: 'va a json', rutaArchivo: rutaJson });
    assert.equal(r.ok, true);
    // La escritura fue al JSON (respetado) Y quedo registrado el aviso.
    assert.equal(JSON.parse(fs.readFileSync(rutaJson, 'utf-8')).length, 1);
    assert.equal(persistencia.memoryStore.leer().length, 0);
    assert.equal(errores.some((e) => e.includes('MEZCLA DE BACKENDS')), true);
  } finally {
    console.error = originalError;
    registrarStoreMemoriasPorDefecto(null);
    persistencia.cerrar();
  }
});

test('contenedor: DAVIS_PERSISTENCE desconocido falla claro', async () => {
  process.env.DAVIS_PERSISTENCE = 'oracle';
  try {
    const { crearContenedor } = await import('../../src/composition/container.js');
    assert.throws(() => crearContenedor(), /DAVIS_PERSISTENCE desconocido/);
  } finally {
    delete process.env.DAVIS_PERSISTENCE;
  }
});
