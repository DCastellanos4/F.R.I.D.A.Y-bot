/**
 * renfe_tren.test.js
 * Pruebas del indice GTFS de estaciones Renfe y del feed LD (alcance: conexion
 * Renfe pedida por David el 7 nov 2026). Todo con fetch/datos inyectados, sin
 * llamadas reales a la red.
 *
 * Strict Policy: Zero Emojis.
 */
import assert from 'node:assert';
import fs from 'node:fs';
import zlib from 'node:zlib';

const { extraerFicheroZip, resolverEstaciones } = await import('../../src/services/renfeGtfsService.js');
const { llegadasTrenLD } = await import('../../src/services/cercaniasAdapter.js');
const { proximasLlegadas, registrarParadaFavorita } = await import('../../src/services/transportService.js');

function zipDePrueba(entradas) {
  // entradas: [{ nombre, datos (string), metodo: 0|8 }]
  const locales = [];
  const centrales = [];
  let offset = 0;
  for (const e of entradas) {
    const datos = Buffer.from(e.datos, 'utf-8');
    const comprimido = e.metodo === 8 ? zlib.deflateRawSync(datos) : datos;
    const nombre = Buffer.from(e.nombre, 'utf-8');
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(e.metodo, 8);
    local.writeUInt32LE(0, 14); // crc sin usar por el extractor
    local.writeUInt32LE(comprimido.length, 18);
    local.writeUInt32LE(datos.length, 22);
    local.writeUInt16LE(nombre.length, 26);
    local.writeUInt16LE(0, 28);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(e.metodo, 10);
    central.writeUInt32LE(comprimido.length, 20);
    central.writeUInt32LE(datos.length, 24);
    central.writeUInt16LE(nombre.length, 28);
    central.writeUInt32LE(offset, 42);
    locales.push(local, nombre, comprimido);
    centrales.push(Buffer.concat([central, nombre]));
    offset += 30 + nombre.length + comprimido.length;
  }
  const dirCentral = Buffer.concat(centrales);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entradas.length, 8);
  eocd.writeUInt16LE(entradas.length, 10);
  eocd.writeUInt32LE(dirCentral.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locales, dirCentral, eocd]);
}

const STOPS = 'stop_id,stop_name,stop_lat,stop_lon,wheelchair_boarding\n17000,Madrid-Chamartin-Clara Campoamor,40.4,-3.6,1\n18000,Madrid-Atocha Cercanias,40.4,-3.6,1\n';
const zip = zipDePrueba([{ nombre: 'stops.txt', datos: STOPS, metodo: 8 }]);

// 1) extractor zip (deflate)
const extraido = extraerFicheroZip(zip, 'stops.txt');
assert.ok(extraido, 'extrae stops.txt');
assert.ok(extraido.toString('utf-8').includes('Madrid-Atocha Cercanias'), 'contenido correcto');
assert.strictEqual(extraerFicheroZip(zip, 'nope.txt'), null, 'entrada inexistente devuelve null');

// 2) indice + resolucion de nombres con fetch inyectado
const depsIndice = {
  rutaCache: '/tmp/test-estaciones-renfe.json',
  fetchFn: async (url) => ({ arrayBuffer: async () => zip.buffer.slice(zip.byteOffset, zip.byteOffset + zip.length) })
};
try { fs.unlinkSync(depsIndice.rutaCache); } catch { /* nada */ }
const chamartin = await resolverEstaciones('chamartin', depsIndice);
assert.strictEqual(chamartin.length, 2, 'chamartin aparece en ambos feeds inyectados (mismo zip de prueba)');
assert.ok(chamartin.every((e) => e.id === '17000'), 'id correcto');
const atocha = await resolverEstaciones('atocha', depsIndice);
assert.strictEqual(atocha.length, 2, 'atocha aparece en ambos feeds inyectados');
assert.ok(atocha.every((e) => e.id === '18000'), 'id correcto');
const ninguna = await resolverEstaciones('estacion inexistente xyz', depsIndice);
assert.strictEqual(ninguna.length, 0, 'sin coincidencias devuelve []');

// 3) feed LD con fetch inyectado
const ahora = Math.floor(Date.now() / 1000);
const feedLd = JSON.stringify({
  header: { gtfsRealtimeVersion: '2.0', timestamp: String(ahora) },
  entity: [{ id: 'TU1', tripUpdate: { trip: { tripId: '0146012026-11-07', scheduleRelationship: 'SCHEDULED' }, stopTimeUpdate: [{ arrival: { delay: 540, time: String(ahora + 600) }, stopId: '60000' }] } }]
});
const rLd = await llegadasTrenLD('60000', { fetchFn: async () => ({ text: async () => feedLd }), ahora: ahora * 1000 });
assert.ok(rLd.ok, 'feed LD ok');
assert.strictEqual(rLd.llegadas[0].retrasoSegundos, 540);
assert.strictEqual(rLd.llegadas[0].segundos, 600);

// 4) proximasLlegadas resolviendo por nombre (tipo tren via indice inyectado)
const STOPS_LD = 'stop_id,stop_code,stop_name,stop_desc,stop_lat,stop_lon,zone_id,stop_url,location_type,parent_station,stop_timezone,wheelchair_boarding\n60000,,Madrid-Puerta de Atocha,,40.4,-3.6,,,,,Europe/Madrid,1\n';
const zipLd = zipDePrueba([{ nombre: 'stops.txt', datos: STOPS_LD, metodo: 8 }]);
const depsNombre = {
  rutaArchivo: '/tmp/test-transporte-renfe.json',
  rutaCache: '/tmp/test-estaciones-renfe-ld.json',
  ahora: ahora * 1000,
  fetchFn: async (url) => {
    if (url.includes('google_transit')) return { arrayBuffer: async () => zipLd.buffer.slice(zipLd.byteOffset, zipLd.byteOffset + zipLd.length) };
    if (url.includes('fomento_transit')) return { arrayBuffer: async () => zip.buffer.slice(zip.byteOffset, zip.byteOffset + zip.length) };
    return { text: async () => feedLd };
  },
  fetchFnCercanias: async () => ({ text: async () => feedLd })
};
try { fs.unlinkSync(depsNombre.rutaCache); } catch { /* nada */ }
try { fs.unlinkSync(depsNombre.rutaArchivo); } catch { /* nada */ }
const rNombre = await proximasLlegadas({ parada: 'puerta de atocha' }, depsNombre);
assert.ok(rNombre.ok, 'resuelve por nombre LD');
assert.strictEqual(rNombre.tipo, 'tren');
assert.strictEqual(rNombre.parada, 'Madrid-Puerta de Atocha');

// 5) favorita tipo tren
const regTren = registrarParadaFavorita({ nombre: 'atocha ave', tipo: 'tren', codigo: '60000' }, { rutaArchivo: '/tmp/test-transporte-renfe2.json' });
assert.ok(regTren.ok, 'registra favorita tipo tren');
try { fs.unlinkSync('/tmp/test-transporte-renfe2.json'); } catch { /* nada */ }

console.log('renfe_tren.test.js OK');
