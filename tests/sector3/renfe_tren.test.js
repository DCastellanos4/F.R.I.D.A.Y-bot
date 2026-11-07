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

// 5) favorita tipo tren: el codigo se valida contra el indice oficial
const cacheReg = '/tmp/test-estaciones-renfe-reg.json';
fs.writeFileSync(cacheReg, JSON.stringify({ generadoEn: new Date().toISOString(), estaciones: [
  { id: '60000', nombre: 'Madrid-Puerta de Atocha-Almudena Grandes', tipo: 'tren' },
  { id: '18000', nombre: 'Madrid-Atocha Cercanias', tipo: 'cercanias' }
] }), 'utf-8');
const regTren = await registrarParadaFavorita({ nombre: 'atocha ave', tipo: 'tren', codigo: '60000' }, { rutaArchivo: '/tmp/test-transporte-renfe2.json', rutaCache: cacheReg });
assert.ok(regTren.ok, 'registra favorita tipo tren');
assert.strictEqual(regTren.estacion, 'Madrid-Puerta de Atocha-Almudena Grandes', 'informa del nombre oficial');
const regMalo = await registrarParadaFavorita({ nombre: 'inventada', tipo: 'cercanias', codigo: '99999' }, { rutaArchivo: '/tmp/test-transporte-renfe2.json', rutaCache: cacheReg });
assert.strictEqual(regMalo.ok, false, 'codigo inexistente rechazado');
assert.match(regMalo.error, /indice oficial/, 'el error remite al indice oficial');
try { fs.unlinkSync('/tmp/test-transporte-renfe2.json'); } catch { /* nada */ }
try { fs.unlinkSync(cacheReg); } catch { /* nada */ }

console.log('renfe_tren.test.js OK');

// 6) intencion de transporte con lenguaje natural plural ("proximos trenes
// de Aranjuez" no activaba la herramienta: regresion del 7 nov 2026)
const { analizarIntencion } = await import('../../src/core/jarvisAgent.js');
for (const frase of ['proximos trenes de aranjuez', 'cuando sale el proximo tren de atocha', 'trenes a sevilla', 'proximo cercanias']) {
  const r = analizarIntencion(frase);
  assert.ok(r.intenciones.includes('transporte'), `intencion transporte detectada en "${frase}"`);
  assert.ok(r.herramientas.some((h) => h.function && h.function.name === 'proximas_llegadas_transporte'), `herramienta ofrecida para "${frase}"`);
}

// 7) estacion duplicada en ambos indices (mismo id): se resuelve sin preguntar
const STOPS_LD_DUP = 'stop_id,stop_code,stop_name,stop_desc,stop_lat,stop_lon,zone_id,stop_url,location_type,parent_station,stop_timezone,wheelchair_boarding\n17000,,Madrid-Chamartin-Clara Campoamor,,40.4,-3.6,,,,,Europe/Madrid,1\n';
const zipLdDup = zipDePrueba([{ nombre: 'stops.txt', datos: STOPS_LD_DUP, metodo: 8 }]);
const depsDup = {
  rutaArchivo: '/tmp/test-transporte-renfe3.json',
  rutaCache: '/tmp/test-estaciones-renfe-dup.json',
  ahora: ahora * 1000,
  fetchFn: async (url) => {
    if (url.includes('google_transit')) return { arrayBuffer: async () => zipLdDup.buffer.slice(zipLdDup.byteOffset, zipLdDup.byteOffset + zipLdDup.length) };
    if (url.includes('fomento_transit')) return { arrayBuffer: async () => zip.buffer.slice(zip.byteOffset, zip.byteOffset + zip.length) };
    return { text: async () => feedLd };
  },
  fetchFnCercanias: async () => ({ text: async () => feedLd })
};
try { fs.unlinkSync(depsDup.rutaCache); } catch { /* nada */ }
try { fs.unlinkSync(depsDup.rutaArchivo); } catch { /* nada */ }
const rDup = await proximasLlegadas({ parada: 'chamartin' }, depsDup);
assert.ok(rDup.ok, 'misma estacion en ambos indices no pregunta');
assert.strictEqual(rDup.tipo, 'cercanias', 'prefiere el feed de Cercanias (mismo id)');
try { fs.unlinkSync(depsDup.rutaArchivo); } catch { /* nada */ }

console.log('renfe_tren.test.js OK (ampliado)');

// 8) fallback de horario programado: estacion sin trenes en vivo lista las
// siguientes salidas programadas del GTFS estatico (descubierto 7 nov 2026:
// el feed GTFS-RT solo difunde la proxima parada de trenes en curso)
const STOPS_PROG = 'stop_id,stop_name,stop_lat,stop_lon,wheelchair_boarding\n60200,Aranjuez,40.0,-3.6,1\n';
const TRIPS_PROG = 'route_id,service_id,trip_id,trip_headsign\nC3,LAB,C3-101,Madrid-Chamartin\nC3,LAB,C3-102,Madrid-Chamartin\nC3,FES,C3-900,Madrid-Atocha\n';
const CAL_PROG = 'service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\nLAB,1,1,1,1,1,0,0,20260101,20261231\nFES,0,0,0,0,0,1,1,20260101,20261231\n';
const STOP_TIMES_PROG = 'trip_id,arrival_time,departure_time,stop_id,stop_sequence\nC3-101,15:30:00,15:30:00,60105,10\nC3-101,16:00:00,16:00:00,60200,11\nC3-102,16:20:00,16:20:00,60105,10\nC3-102,16:50:00,16:50:00,60200,11\nC3-900,17:00:00,17:00:00,60200,5\n';
// sabado 7 nov 2026 15:00 Madrid = 14:00 UTC
const ahoraSabado = new Date('2026-11-07T14:00:00Z').getTime();
const zipProg = zipDePrueba([
  { nombre: 'stops.txt', datos: STOPS_PROG, metodo: 8 },
  { nombre: 'trips.txt', datos: TRIPS_PROG, metodo: 8 },
  { nombre: 'calendar.txt', datos: CAL_PROG, metodo: 8 },
  { nombre: 'stop_times.txt', datos: STOP_TIMES_PROG, metodo: 8 }
]);
const feedVacio = JSON.stringify({ header: { gtfsRealtimeVersion: '2.0', timestamp: String(Math.floor(ahoraSabado / 1000)) }, entity: [] });
const depsProg = {
  rutaArchivo: '/tmp/test-transporte-renfe4.json',
  rutaCache: '/tmp/test-estaciones-renfe-prog.json',
  rutaCacheHorarios: '/tmp/test-horarios-renfe',
  ahora: ahoraSabado,
  fetchFn: async (url) => {
    if (url.includes('fomento_transit')) return { arrayBuffer: async () => zipProg.buffer.slice(zipProg.byteOffset, zipProg.byteOffset + zipProg.length) };
    if (url.includes('google_transit')) return { arrayBuffer: async () => zipLd.buffer.slice(zipLd.byteOffset, zipLd.byteOffset + zipLd.length) };
    return { text: async () => feedVacio };
  },
  fetchFnCercanias: async () => ({ text: async () => feedVacio })
};
try { fs.unlinkSync(depsProg.rutaCache); } catch { /* nada */ }
try { fs.unlinkSync(depsProg.rutaArchivo); } catch { /* nada */ }
fs.rmSync(depsProg.rutaCacheHorarios, { recursive: true, force: true });
const rProg = await proximasLlegadas({ parada: 'aranjuez' }, depsProg);
assert.ok(rProg.ok, 'resuelve aranjuez');
assert.strictEqual(rProg.llegadas.length, 0, 'sin trenes en vivo');
assert.strictEqual(rProg.programadas.length, 1, 'solo C3-900 (sabado = servicio FES)');
assert.strictEqual(rProg.programadas[0].hora, '17:00');
assert.match(rProg.nota, /programadas/, 'la nota deja claro que son horarios programados');
fs.rmSync(depsProg.rutaCacheHorarios, { recursive: true, force: true });
try { fs.unlinkSync(depsProg.rutaArchivo); } catch { /* nada */ }

console.log('renfe_tren.test.js OK (final)');

// 9) horario GTFS >= 24:00 pertenece al dia de servicio: un tren "25:30" del
// servicio de ayer aparece a las 00:30 de hoy (no como hora futura del dia)
const STOP_TIMES_NOCHE = 'trip_id,arrival_time,departure_time,stop_id,stop_sequence\nC3-101,25:30:00,25:30:00,60200,11\nC3-102,23:30:00,23:30:00,60200,11\nC3-900,17:00:00,17:00:00,60200,5\n';
const zipNoche = zipDePrueba([
  { nombre: 'stops.txt', datos: STOPS_PROG, metodo: 8 },
  { nombre: 'trips.txt', datos: TRIPS_PROG, metodo: 8 },
  { nombre: 'calendar.txt', datos: CAL_PROG, metodo: 8 },
  { nombre: 'stop_times.txt', datos: STOP_TIMES_NOCHE, metodo: 8 }
]);
// sabado 7 nov 2026 00:30 Madrid = viernes 6 nov 23:30 UTC
const ahoraNoche = new Date('2026-11-06T23:30:00Z').getTime();
const depsNoche = {
  rutaArchivo: '/tmp/test-transporte-renfe5.json',
  rutaCache: '/tmp/test-estaciones-renfe-noche.json',
  rutaCacheHorarios: '/tmp/test-horarios-renfe-noche',
  ahora: ahoraNoche,
  fetchFn: async (url) => {
    if (url.includes('fomento_transit')) return { arrayBuffer: async () => zipNoche.buffer.slice(zipNoche.byteOffset, zipNoche.byteOffset + zipNoche.length) };
    if (url.includes('google_transit')) return { arrayBuffer: async () => zipLd.buffer.slice(zipLd.byteOffset, zipLd.byteOffset + zipLd.length) };
    return { text: async () => feedVacio };
  },
  fetchFnCercanias: async () => ({ text: async () => feedVacio })
};
try { fs.unlinkSync(depsNoche.rutaCache); } catch { /* nada */ }
try { fs.unlinkSync(depsNoche.rutaArchivo); } catch { /* nada */ }
fs.rmSync(depsNoche.rutaCacheHorarios, { recursive: true, force: true });
const rNoche = await proximasLlegadas({ parada: 'aranjuez' }, depsNoche);
assert.ok(rNoche.ok, 'resuelve de madrugada');
assert.ok(Array.isArray(rNoche.programadas), 'ofrece programadas de madrugada');
// servicios activos HOY sabado: FES (17:00 ya paso). AYER viernes: LAB
// (23:30 ya paso; 25:30 = 01:30 de hoy, en una hora). Ademas el FES de las
// 17:00 de hoy sabado sigue por venir a las 00:30.
assert.strictEqual(rNoche.programadas.length, 2, 'quedan el 25:30 de ayer (01:30 hoy) y el 17:00 de hoy');
assert.strictEqual(rNoche.programadas[0].hora, '01:30', 'hora normalizada (no 25:30)');
assert.strictEqual(rNoche.programadas[0].viaje, 'C3-101', 'servicio de ayer correcto');
assert.strictEqual(rNoche.programadas[1].hora, '17:00');
assert.strictEqual(rNoche.programadas[0].viaje, 'C3-101');
try { fs.unlinkSync(depsNoche.rutaArchivo); } catch { /* nada */ }

console.log('renfe_tren.test.js OK (definitivo)');
