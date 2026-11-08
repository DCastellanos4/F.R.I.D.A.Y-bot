/**
 * transport_entry.test.js
 * Pruebas del bloque extra de transporte publico de Madrid (aprobado por
 * David el 5 nov 2026): paradas favoritas y llegadas bajo demanda, sin
 * avisos automaticos. La EMT queda config-required sin credenciales;
 * Cercanias se prueba con fetch inyectado (sin llamadas reales).
 *
 * Strict Policy: Zero Emojis.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'path';
import os from 'os';

const dirEntorno = fs.mkdtempSync(path.join(os.tmpdir(), 'davis-transport-'));
process.env.DAVIS_HISTORY_DIR = path.join(dirEntorno, 'history');
process.env.NODE_ENV = 'test';
delete process.env.DAVIS_EMT_CLIENT_ID;
delete process.env.DAVIS_EMT_PASS_KEY;

const bot = await import('../../whatsappBot.js');
const { analizarIntencion } = await import('../../src/core/jarvisAgent.js');
const { proximasLlegadas, registrarParadaFavorita } = await import('../../src/services/transportService.js');
const { llegadasEmt } = await import('../../src/services/emtAdapter.js');

const JID_DAVID = '149868706304033@lid';

function sockSimulado(enviados) {
  return {
    readMessages: async () => {},
    sendPresenceUpdate: async () => {},
    sendMessage: async (jid, payload) => { enviados.push({ jid, payload }); return { key: { id: 'SIM-' + enviados.length } }; }
  };
}

function mensajeEntrante(texto, id) {
  return {
    key: { remoteJid: JID_DAVID, fromMe: false, id },
    message: { conversation: texto },
    messageTimestamp: Math.floor(Date.now() / 1000)
  };
}

function feedRenfeFalso(ahoraMs) {
  return {
    header: {},
    entity: [
      {
        id: 'TU1',
        tripUpdate: {
          trip: { tripId: 'C7-101', scheduleRelationship: 'SCHEDULED' },
          stopTimeUpdate: [
            { stopId: '17000', arrival: { delay: 300, time: Math.floor(ahoraMs / 1000) + 600 } },
            { stopId: '18001', arrival: { delay: 0, time: Math.floor(ahoraMs / 1000) + 900 } }
          ]
        }
      },
      {
        id: 'TU2',
        tripUpdate: {
          trip: { tripId: 'C4-202', scheduleRelationship: 'CANCELED' },
          stopTimeUpdate: [
            { stopId: '17000', arrival: { delay: 0, time: Math.floor(ahoraMs / 1000) + 1200 } }
          ]
        }
      }
    ]
  };
}

test('Router: "cuando llega el proximo bus" ofrece las herramientas de transporte', () => {
  const r = analizarIntencion('cuando llega el proximo bus de casa');
  const nombres = r.herramientas.map((h) => h.function.name);
  assert.ok(nombres.includes('proximas_llegadas_transporte'), 'falta proximas_llegadas_transporte');
  assert.ok(r.intenciones.includes('transporte'));
});

test('Entrada real: registrar parada favorita la persiste', async () => {
  const enviados = [];
  const rutaTransporte = path.join(dirEntorno, 'transporte1.json');
  const chatFalso = async ({ messages }) => {
    const ultimo = messages[messages.length - 1];
    if (ultimo.role === 'tool') return { message: { content: 'Parada guardada, David.' } };
    return { message: { content: '', tool_calls: [{ id: 'c1', function: { name: 'registrar_parada_favorita', arguments: { nombre: 'casa', tipo: 'emt', codigo: '1234' } } }] } };
  };
  await bot.procesarMensajesEntrantes(sockSimulado(enviados), {
    type: 'notify',
    messages: [mensajeEntrante('mi parada de casa es la EMT 1234', 'TRA-1')]
  }, { chatCompletion: chatFalso, rutaArchivoTransporte: rutaTransporte });
  const estado = JSON.parse(fs.readFileSync(rutaTransporte, 'utf-8'));
  assert.equal(estado.paradas.length, 1);
  assert.equal(estado.paradas[0].codigo, '1234');
  assert.equal(estado.paradas[0].tipo, 'emt');
});

test('EMT sin credenciales: config-required honesto, nunca llegadas inventadas', async () => {
  const r = await llegadasEmt('1234', {});
  assert.equal(r.ok, false);
  assert.equal(r.configRequired, true);
  assert.match(r.error, /DAVIS_EMT_CLIENT_ID/);
});

test('EMT con fetch inyectado: login y parseo de llegadas', async () => {
  const llamadas = [];
  const fetchFalso = async (url, opts) => {
    llamadas.push(url);
    if (url.includes('/user/login/')) {
      assert.equal(opts.headers['X-ClientId'], 'cli-test');
      return { json: async () => ({ code: '00', data: [{ accessToken: 'tok-1' }] }) };
    }
    assert.ok(url.includes('/stops/1234/arrives/'));
    assert.equal(opts.headers.accessToken, 'tok-1');
    return { json: async () => ({ code: '00', data: [{ Arrive: [
      { line: '27', destination: 'Embajadores', estimateArrive: 240, DistanceBus: 300 },
      { line: '27', destination: 'Embajadores', estimateArrive: 9999999, DistanceBus: -1 },
      { line: '141', destination: 'Atocha', estimateArrive: 60, DistanceBus: 100 }
    ] }] }) };
  };
  const r = await llegadasEmt('1234', { fetchFn: fetchFalso, clientId: 'cli-test', passKey: 'pass-test' });
  assert.equal(r.ok, true);
  assert.equal(r.llegadas.length, 2, 'la estimacion sentinel 9999999 se descarta');
  assert.equal(r.llegadas[0].linea, '141', 'ordenadas por tiempo');
  assert.equal(llamadas.length, 2, 'login + arrives');
});

test('Cercanias con feed inyectado: llegadas de la estacion, retrasos y cancelados', async () => {
  const ahora = new Date('2026-11-05T15:00:00+01:00');
  const fetchFalso = async () => ({ text: async () => JSON.stringify(feedRenfeFalso(ahora.getTime())) });
  const rutaTransporte = path.join(dirEntorno, 'transporte2.json');
  const rutaCache = path.join(dirEntorno, 'estaciones-cache.json');
  fs.writeFileSync(rutaCache, JSON.stringify({ generadoEn: new Date().toISOString(), estaciones: [{ id: '17000', nombre: 'Madrid-Chamartin-Clara Campoamor', tipo: 'cercanias' }] }), 'utf-8');
  const reg = await registrarParadaFavorita({ nombre: 'atocha', tipo: 'cercanias', codigo: '17000' }, { rutaArchivo: rutaTransporte, rutaCache });
  assert.equal(reg.ok, true);
  assert.equal(reg.estacion, 'Madrid-Chamartin-Clara Campoamor', 'la confirmacion informa del nombre oficial de la estacion del codigo');
  const r = await proximasLlegadas({ parada: 'atocha' }, { rutaArchivo: rutaTransporte, fetchFnCercanias: fetchFalso, ahora });
  assert.equal(r.ok, true);
  assert.equal(r.tipo, 'cercanias');
  assert.equal(r.llegadas.length, 2, 'solo la estacion pedida (17000), no 18001');
  assert.equal(r.llegadas[0].viaje, 'C7-101');
  assert.equal(r.llegadas[0].retrasoSegundos, 300);
  assert.equal(r.llegadas[1].cancelado, true);
  assert.match(r.nota, /informacion en vivo/);
});

test('Consulta de parada desconocida: error honesto sin inventar', async () => {
  const rutaTransporte = path.join(dirEntorno, 'transporte3.json');
  const r = await proximasLlegadas({ parada: 'no-existe' }, { rutaArchivo: rutaTransporte });
  assert.equal(r.ok, false);
  assert.match(r.error, /registrala como favorita/i);
  assert.doesNotMatch(r.error, /dime su codigo/i, 'no traslada la resolucion tecnica al usuario');
});

test('Metro: el servicio rechaza el tipo y explica por que', async () => {
  const rutaTransporte = path.join(dirEntorno, 'transporte4.json');
  const r = await registrarParadaFavorita({ nombre: 'metro casa', tipo: 'metro', codigo: '100' }, { rutaArchivo: rutaTransporte });
  assert.equal(r.ok, false);
  assert.match(r.error, /Metro no tiene fuente publica/);
});
