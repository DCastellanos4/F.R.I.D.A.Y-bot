/**
 * bus_emt_determinista.test.js
 * Falla observada 13 nov 2026: "dime buses de tajamar" no activo el dominio
 * de transporte y el modelo contesto con minutos inventados sin llamar a
 * ninguna herramienta. Estas pruebas fijan que las consultas de bus EMT
 * se sirven por un camino determinista desde la API (fetch inyectado).
 * Son pruebas de CODIGO: el funcionamiento real se valida aparte contra la EMT.
 *
 * Strict Policy: Zero Emojis.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'path';
import os from 'os';

const dirEntorno = fs.mkdtempSync(path.join(os.tmpdir(), 'davis-bus-'));
process.env.DAVIS_HISTORY_DIR = path.join(dirEntorno, 'history');
process.env.NODE_ENV = 'test';

const { analizarIntencion, consultarJarvis } = await import('../../src/core/jarvisAgent.js');
const { esConsultaLlegadasBus, resolverParadaBus, registrarParadaFavorita } = await import('../../src/services/transportService.js');

const rutaArchivoTransporte = path.join(dirEntorno, 'transporte.json');

test('esConsultaLlegadasBus reconoce peticiones de bus y descarta lo demas', () => {
  for (const t of ['dime buses de tajamar', 'que autobuses pasan por la parada 3355', 'cuando llega el bus a la parada EMT 3355', 'proximos buses en la parada 3355', 'llegadas de autobuses a la parada EMT 3355']) {
    assert.equal(esConsultaLlegadasBus(t), true, t);
  }
  for (const t of ['avisame cuando llegue el bus', 'guarda la parada 3355 como favorita', 'dime los trenes de Aranjuez', 'el bus de datos del servidor', 'que tiempo hace']) {
    assert.equal(esConsultaLlegadasBus(t), false, t);
  }
});

test('resolverParadaBus: numero explicito, favorita por nombre y linea no confundida con parada', async () => {
  await registrarParadaFavorita({ nombre: 'Tajamar', tipo: 'emt', codigo: '3355' }, { rutaArchivo: rutaArchivoTransporte });
  const deps = { rutaArchivo: rutaArchivoTransporte };
  assert.deepEqual(resolverParadaBus('que buses pasan por la parada 3355', deps), { codigo: '3355', nombre: 'Tajamar' });
  assert.deepEqual(resolverParadaBus('dime buses de tajamar', deps), { codigo: '3355', nombre: 'Tajamar' });
  assert.deepEqual(resolverParadaBus('llegadas de autobuses a la parada EMT 3355', deps), { codigo: '3355', nombre: 'Tajamar' });
  assert.equal(resolverParadaBus('cuando llega el bus 143', deps), null);
  assert.equal(resolverParadaBus('dime buses de la linea 143 ahora', deps), null);
});

test('el regex de intencion activa transporte para frases con bus/autobus', () => {
  for (const t of ['dime buses de tajamar', 'autobuses parada 3355']) {
    const a = analizarIntencion(t);
    assert.ok(a.intenciones.includes('transporte'), t + ' -> ' + JSON.stringify(a.intenciones));
  }
});

function opcionesBase(extra = {}) {
  return {
    chatId: 'bus-test',
    rutaArchivoTransporte,
    clientIdEmt: 'cid',
    passKeyEmt: 'pk',
    // El modelo NO debe intervenir en este camino: si se usa, el test falla.
    chatCompletion: async () => { throw new Error('el modelo no debe usarse'); },
    retornarObjeto: true,
    ...extra
  };
}

function fetchEmtFalso(llamadas, arrive) {
  return async (url, init) => {
    llamadas.push({ url, method: init && init.method });
    if (String(url).includes('/user/login/')) {
      return { json: async () => ({ code: '01', data: [{ accessToken: 'tok' }] }) };
    }
    return { json: async () => ({ code: '00', data: [{ Arrive: arrive }] }) };
  };
}

test('"dime buses de tajamar" consulta la API EMT con la parada 3355 y presenta sus datos', async () => {
  const llamadas = [];
  const r = await consultarJarvis('dime buses de tajamar', [], opcionesBase({
    fetchFnEmt: fetchEmtFalso(llamadas, [
      { line: '143', destination: 'VILLA VALLECAS', estimateArrive: 30, DistanceBus: 100 },
      { line: '143', destination: 'VILLA VALLECAS', estimateArrive: 420, DistanceBus: 2500 }
    ])
  }));
  const texto = typeof r === 'string' ? r : r.respuesta;
  assert.ok(llamadas.some((l) => String(l.url).includes('/stops/3355/arrives/')), 'debe llamar a arrives de la parada 3355');
  assert.match(texto, /Tajamar/);
  assert.match(texto, /Linea 143 a VILLA VALLECAS: llegando/);
  assert.match(texto, /7 min/);
  if (r.traza) assert.equal(r.traza.via, 'determinista_llegadas_bus');
});

test('si la EMT falla, lo dice y no inventa tiempos', async () => {
  const fallo = async () => { throw new Error('red caida'); };
  const r = await consultarJarvis('que autobuses pasan por la parada 3355', [], opcionesBase({ fetchFnEmt: fallo }));
  const texto = typeof r === 'string' ? r : r.respuesta;
  assert.match(texto, /no he podido consultar la EMT/i);
  assert.doesNotMatch(texto, /\d+ min/);
});

test('sin parada identificable pide aclaracion y no llama a la API ni al modelo', async () => {
  const llamadas = [];
  const r = await consultarJarvis('dime los buses que pasan ahora', [], opcionesBase({ fetchFnEmt: fetchEmtFalso(llamadas, []) }));
  const texto = typeof r === 'string' ? r : r.respuesta;
  assert.equal(llamadas.length, 0);
  assert.match(texto, /parada/i);
});
