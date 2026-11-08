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
const STOPS_PROG = 'stop_id,stop_name,stop_lat,stop_lon,wheelchair_boarding\n60200,Aranjuez,40.0,-3.6,1\n17000,Madrid-Atocha,40.4,-3.69,1\n';
const TRIPS_PROG = 'route_id,service_id,trip_id,trip_headsign\nC3,LAB,C3-101,Madrid-Chamartin\nC3,LAB,C3-102,Madrid-Chamartin\nC3,FES,C3-900,Madrid-Atocha\n';
const CAL_PROG = 'service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\nLAB,1,1,1,1,1,0,0,20260101,20261231\nFES,0,0,0,0,0,1,1,20260101,20261231\n';
const STOP_TIMES_PROG = 'trip_id,arrival_time,departure_time,stop_id,stop_sequence\nC3-101,15:30:00,15:30:00,60105,10\nC3-101,16:00:00,16:00:00,60200,11\nC3-102,16:20:00,16:20:00,60105,10\nC3-102,16:50:00,16:50:00,60200,11\nC3-900,17:00:00,17:00:00,60200,5\nC3-900,17:40:00,17:40:00,17000,6\n';
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
const STOP_TIMES_NOCHE = 'trip_id,arrival_time,departure_time,stop_id,stop_sequence\nC3-101,25:30:00,25:30:00,60200,11\nC3-101,26:10:00,26:10:00,17000,12\nC3-102,23:30:00,23:30:00,60200,11\nC3-102,00:10:00,00:10:00,17000,12\nC3-900,17:00:00,17:00:00,60200,5\nC3-900,17:40:00,17:40:00,17000,6\n';
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

// 10) Regresion 8 nov 2026 (gap de produccion): el GTFS de Cercanias en
// produccion no trae trip_headsign y las salidas programadas salian con
// destino vacio. El destino se deriva del propio GTFS oficial: ultima parada
// del viaje (max stop_sequence) resuelta por stops.txt. NADA se infiere.
const STOPS_SIN_HEAD = 'stop_id,stop_name,stop_lat,stop_lon,wheelchair_boarding\n60200,Aranjuez,40.0,-3.6,1\n60105,Leganes,40.3,-3.7,1\n60000,Madrid-Chamartin,40.4,-3.6,1\n60900,Villalba,40.6,-4.0,1\n';
const TRIPS_SIN_HEAD = 'route_id,service_id,trip_id,trip_headsign\nC3,TODOS,C3-101,\nC3,TODOS,C3-102,\n';
const CAL_TODOS = 'service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\nTODOS,1,1,1,1,1,1,1,20260101,20261231\n';
const STOP_TIMES_SIN_HEAD = 'trip_id,arrival_time,departure_time,stop_id,stop_sequence\nC3-101,15:30:00,15:30:00,60105,10\nC3-101,16:00:00,16:00:00,60200,11\nC3-101,16:30:00,16:30:00,60000,12\nC3-102,16:50:00,16:50:00,60200,11\nC3-102,17:20:00,17:20:00,60900,12\n';
const zipSinHead = zipDePrueba([
  { nombre: 'stops.txt', datos: STOPS_SIN_HEAD, metodo: 8 },
  { nombre: 'trips.txt', datos: TRIPS_SIN_HEAD, metodo: 8 },
  { nombre: 'calendar.txt', datos: CAL_TODOS, metodo: 8 },
  { nombre: 'stop_times.txt', datos: STOP_TIMES_SIN_HEAD, metodo: 8 }
]);
function depsSinHead(tag) {
  return {
    rutaArchivo: `/tmp/test-transporte-renfe-sh-${tag}.json`,
    rutaCache: `/tmp/test-estaciones-renfe-sh-${tag}.json`,
    rutaCacheHorarios: `/tmp/test-horarios-renfe-sh-${tag}`,
    ahora: ahoraSabado,
    fetchFn: async (url) => {
      if (url.includes('fomento_transit')) return { arrayBuffer: async () => zipSinHead.buffer.slice(zipSinHead.byteOffset, zipSinHead.byteOffset + zipSinHead.length) };
      if (url.includes('google_transit')) return { arrayBuffer: async () => zipLd.buffer.slice(zipLd.byteOffset, zipLd.byteOffset + zipLd.length) };
      return { text: async () => feedVacio };
    },
    fetchFnCercanias: async () => ({ text: async () => feedVacio })
  };
}
const depsSH = depsSinHead('a');
try { fs.unlinkSync(depsSH.rutaCache); } catch { /* nada */ }
try { fs.unlinkSync(depsSH.rutaArchivo); } catch { /* nada */ }
fs.rmSync(depsSH.rutaCacheHorarios, { recursive: true, force: true });
const rSH = await proximasLlegadas({ parada: 'aranjuez' }, depsSH);
assert.ok(rSH.ok, 'resuelve aranjuez sin headsign');
assert.strictEqual(rSH.programadas.length, 2, 'dos salidas programadas');
assert.strictEqual(rSH.programadas[0].hora, '16:00');
assert.strictEqual(rSH.programadas[0].destino, 'Madrid-Chamartin', 'destino derivado de la ultima parada del viaje (GTFS oficial)');
assert.strictEqual(rSH.programadas[1].destino, 'Villalba', 'cada viaje deriva SU destino, no se infiere uno unico');
fs.rmSync(depsSH.rutaCacheHorarios, { recursive: true, force: true });
try { fs.unlinkSync(depsSH.rutaArchivo); } catch { /* nada */ }

// 11) Filtro por destino ("que trenes hay hacia madrid desde aranjuez"):
// solo quedan las salidas cuyo destino encaja; sin coincidencias se dice
// claro en lugar de soltar todas.
const depsF = depsSinHead('b');
try { fs.unlinkSync(depsF.rutaCache); } catch { /* nada */ }
try { fs.unlinkSync(depsF.rutaArchivo); } catch { /* nada */ }
fs.rmSync(depsF.rutaCacheHorarios, { recursive: true, force: true });
const rFiltro = await proximasLlegadas({ parada: 'aranjuez', destino: 'madrid' }, depsF);
assert.ok(rFiltro.ok, 'resuelve con filtro');
assert.strictEqual(rFiltro.programadas.length, 1, 'solo la salida hacia Madrid');
assert.strictEqual(rFiltro.programadas[0].destino, 'Madrid-Chamartin');
const rFiltroVacio = await proximasLlegadas({ parada: 'aranjuez', destino: 'sevilla' }, depsF);
assert.ok(rFiltroVacio.ok, 'resuelve con filtro sin coincidencias');
assert.strictEqual(rFiltroVacio.programadas.length, 0, 'no inventa salidas hacia Sevilla');
assert.match(rFiltroVacio.nota || '', /Ninguna de las proximas salidas/, 'lo dice claro');
fs.rmSync(depsF.rutaCacheHorarios, { recursive: true, force: true });
try { fs.unlinkSync(depsF.rutaArchivo); } catch { /* nada */ }

// 12) Cache de horarios antigua (sin version, destinos vacios): se ignora y
// se regenera desde el GTFS, no se sirven destinos vacios cacheados.
const depsC = depsSinHead('c');
try { fs.unlinkSync(depsC.rutaCache); } catch { /* nada */ }
try { fs.unlinkSync(depsC.rutaArchivo); } catch { /* nada */ }
fs.rmSync(depsC.rutaCacheHorarios, { recursive: true, force: true });
fs.mkdirSync(depsC.rutaCacheHorarios, { recursive: true });
fs.writeFileSync(
  `${depsC.rutaCacheHorarios}/60200-20261107.json`,
  JSON.stringify({ generadoEn: new Date(ahoraSabado).toISOString(), fecha: '20261107', estacion: '60200', horarios: [{ viaje: 'FAKE-1', epoch: Math.floor(ahoraSabado / 1000) + 600, hora: '15:10', destino: '' }] }),
  'utf-8'
);
const rCache = await proximasLlegadas({ parada: 'aranjuez' }, depsC);
assert.ok(rCache.ok, 'resuelve con cache antigua presente');
assert.strictEqual(rCache.programadas.length, 2, 'la cache sin version se ignora y se regenera');
assert.strictEqual(rCache.programadas[0].destino, 'Madrid-Chamartin', 'destinos regenerados, no vacios cacheados');
fs.rmSync(depsC.rutaCacheHorarios, { recursive: true, force: true });
try { fs.unlinkSync(depsC.rutaArchivo); } catch { /* nada */ }

console.log('renfe_tren.test.js OK (destino derivado + filtro)');

// 13) "Hacia Madrid" NO es solo el terminal: un tren que termina en otra
// poblacion pero para en Madrid despues del origen SI cumple el filtro; y
// uno en direccion inversa (pasa por Madrid ANTES de llegar al origen) NO.
const STOPS_REC = 'stop_id,stop_name,stop_lat,stop_lon,wheelchair_boarding\n60200,Aranjuez,40.0,-3.6,1\n17000,Madrid-Atocha,40.4,-3.69,1\n60900,Villalba,40.6,-4.0,1\n';
const TRIPS_REC = 'route_id,service_id,trip_id,trip_headsign\nC3,TODOS,C3-101,\nC3,TODOS,C3-102,\nC3,TODOS,C3-103,\n';
const STOP_TIMES_REC = 'trip_id,arrival_time,departure_time,stop_id,stop_sequence\nC3-101,16:00:00,16:00:00,60200,11\nC3-101,16:40:00,16:40:00,17000,12\nC3-101,17:20:00,17:20:00,60900,13\nC3-102,15:00:00,15:00:00,60900,1\nC3-102,15:40:00,15:40:00,17000,2\nC3-102,16:20:00,16:20:00,60200,3\nC3-103,15:10:00,15:10:00,60900,1\nC3-103,15:50:00,15:50:00,60200,2\nC3-103,16:10:00,16:10:00,17000,3\n';
const zipRec = zipDePrueba([
  { nombre: 'stops.txt', datos: STOPS_REC, metodo: 8 },
  { nombre: 'trips.txt', datos: TRIPS_REC, metodo: 8 },
  { nombre: 'calendar.txt', datos: CAL_TODOS, metodo: 8 },
  { nombre: 'stop_times.txt', datos: STOP_TIMES_REC, metodo: 8 }
]);
function depsRec(tag, feed) {
  return {
    rutaArchivo: `/tmp/test-transporte-renfe-rec-${tag}.json`,
    rutaCache: `/tmp/test-estaciones-renfe-rec-${tag}.json`,
    rutaCacheHorarios: `/tmp/test-horarios-renfe-rec-${tag}`,
    ahora: ahoraSabado,
    fetchFn: async (url) => {
      if (url.includes('fomento_transit')) return { arrayBuffer: async () => zipRec.buffer.slice(zipRec.byteOffset, zipRec.byteOffset + zipRec.length) };
      if (url.includes('google_transit')) return { arrayBuffer: async () => zipLd.buffer.slice(zipLd.byteOffset, zipLd.byteOffset + zipLd.length) };
      return { text: async () => feed };
    },
    fetchFnCercanias: async () => ({ text: async () => feed })
  };
}
const depsRecA = depsRec('a', feedVacio);
try { fs.unlinkSync(depsRecA.rutaCache); } catch { /* nada */ }
try { fs.unlinkSync(depsRecA.rutaArchivo); } catch { /* nada */ }
fs.rmSync(depsRecA.rutaCacheHorarios, { recursive: true, force: true });
const rRec = await proximasLlegadas({ parada: 'aranjuez' }, depsRecA);
assert.ok(rRec.ok, 'resuelve recorrido');
assert.strictEqual(rRec.programadas.length, 2, 'dos salidas (el que TERMINA en Aranjuez se excluye: es una llegada)');
assert.ok(!rRec.programadas.some((p) => p.viaje === 'C3-102'), 'C3-102 termina en Aranjuez: no es una salida');
assert.strictEqual(rRec.programadas[0].viaje, 'C3-103', 'parada intermedia en ruta se conserva');
assert.strictEqual(rRec.programadas[0].destino, 'Madrid-Atocha');
assert.deepStrictEqual(rRec.programadas[0].paradasPosteriores, ['Madrid-Atocha']);
assert.strictEqual(rRec.programadas[1].viaje, 'C3-101');
assert.strictEqual(rRec.programadas[1].destino, 'Villalba', 'terminal fuera de Madrid');
assert.deepStrictEqual(rRec.programadas[1].paradasPosteriores, ['Madrid-Atocha', 'Villalba'], 'recorrido posterior derivado del GTFS');
const rRecMadrid = await proximasLlegadas({ parada: 'aranjuez', destino: 'madrid' }, depsRecA);
assert.strictEqual(rRecMadrid.programadas.length, 2, 'Madrid intermedio y terminal SI cumplen el filtro');
assert.ok(rRecMadrid.programadas.some((p) => p.viaje === 'C3-101'), 'Madrid intermedio (terminal Villalba) incluido');
assert.ok(rRecMadrid.programadas.some((p) => p.viaje === 'C3-103'), 'Madrid terminal incluido');
const rRecVillalba = await proximasLlegadas({ parada: 'aranjuez', destino: 'villalba' }, depsRecA);
assert.strictEqual(rRecVillalba.programadas.length, 1, 'terminal tambien casa');
assert.strictEqual(rRecVillalba.programadas[0].viaje, 'C3-101');
const rRecNada = await proximasLlegadas({ parada: 'aranjuez', destino: 'sevilla' }, depsRecA);
assert.strictEqual(rRecNada.programadas.length, 0, 'sin coincidencia: cero');
assert.match(rRecNada.nota || '', /recorrido GTFS/, 'la nota cita el recorrido GTFS');
fs.rmSync(depsRecA.rutaCacheHorarios, { recursive: true, force: true });
try { fs.unlinkSync(depsRecA.rutaArchivo); } catch { /* nada */ }

// 14) Mezcla: llegada en vivo SIN destino (Renfe RT no lo publica) +
// programadas. Con filtro activo la llegada en vivo no se presenta como si
// cumpliera el filtro: queda aparte y se dice.
const ahoraEpochSab = Math.floor(ahoraSabado / 1000);
const feedUno = JSON.stringify({
  header: { gtfsRealtimeVersion: '2.0', timestamp: String(ahoraEpochSab) },
  entity: [{ id: 'e1', tripUpdate: { trip: { tripId: 'C3-900X' }, stopTimeUpdate: [{ stopId: '60200', arrival: { time: ahoraEpochSab + 900, delay: 0 } }] } }]
});
const depsRecB = depsRec('b', feedUno);
try { fs.unlinkSync(depsRecB.rutaCache); } catch { /* nada */ }
try { fs.unlinkSync(depsRecB.rutaArchivo); } catch { /* nada */ }
fs.rmSync(depsRecB.rutaCacheHorarios, { recursive: true, force: true });
const rMezcla = await proximasLlegadas({ parada: 'aranjuez', destino: 'madrid' }, depsRecB);
assert.ok(rMezcla.ok, 'resuelve mezcla');
assert.strictEqual(rMezcla.llegadas.length, 0, 'la llegada en vivo sin destino NO se presenta como filtrada');
assert.strictEqual((rMezcla.llegadasSinVerificarDestino || []).length, 1, 'queda aparte como no verificable');
assert.match(rMezcla.nota || '', /no se pueden verificar/, 'la nota lo explica');
assert.strictEqual(rMezcla.contrastados.length, 2, 'contrastadas filtradas por recorrido');
assert.ok(rMezcla.contrastados.every((c) => c.viaje !== 'C3-102'), 'el que termina en origen tampoco aparece contrastado');
fs.rmSync(depsRecB.rutaCacheHorarios, { recursive: true, force: true });
try { fs.unlinkSync(depsRecB.rutaArchivo); } catch { /* nada */ }

// 15) Extraccion natural determinista del destino ("hacia X"): no depende
// del modelo. Frase real de David incluida.
const { extraerDestinoHacia } = await import('../../src/services/transportService.js');
assert.strictEqual(extraerDestinoHacia('que trenes hay ahora mismo hacia madrid desde aranjuez'), 'madrid');
assert.strictEqual(extraerDestinoHacia('dime los trenes que salen ahora mismo de aranjuez'), null);
assert.strictEqual(extraerDestinoHacia('trenes hacia madrid chamartin por favor'), 'madrid chamartin');
assert.strictEqual(extraerDestinoHacia('que trenes hay para atocha'), 'atocha');
assert.strictEqual(extraerDestinoHacia('buenas noches'), null);

console.log('renfe_tren.test.js OK (recorrido + filtro + extraccion)');

// 15) Regresion grounding de argumentos (fallo del modelo de respaldo, smoke
// 8 nov 2026): codigos de estacion INVENTADOS nunca llegan a la fuente
// pudiendo resolver por nombre, y la resolucion tecnica no se traslada a David.
const depsRecG = depsRec('g', feedVacio);
try { fs.unlinkSync(depsRecG.rutaCache); } catch { /* nada */ }
try { fs.unlinkSync(depsRecG.rutaArchivo); } catch { /* nada */ }
fs.rmSync(depsRecG.rutaCacheHorarios, { recursive: true, force: true });
const rCodInv = await proximasLlegadas({ parada: 'aranjuez', codigo: 'R1', tipo: 'r1' }, depsRecG);
assert.ok(rCodInv.ok, 'codigo y tipo inventados + nombre explicito: resuelve por nombre');
assert.strictEqual(rCodInv.programadas.length, 2, 'mismas salidas que resolviendo por nombre');
const rCodSolo = await proximasLlegadas({ codigo: 'R1', tipo: 'cercanias' }, depsRecG);
assert.ok(!rCodSolo.ok, 'codigo inventado sin nombre: no llega a la fuente');
assert.match(rCodSolo.error, /NOMBRE/, 'pide el nombre, no el codigo');
assert.doesNotMatch(rCodSolo.error, /dime su codigo|proporciona.*codigo/i, 'no traslada resolucion tecnica al usuario');
const rCodInex = await proximasLlegadas({ codigo: '99999', tipo: 'cercanias' }, depsRecG);
assert.ok(!rCodInex.ok, 'codigo numerico inexistente en el indice: error');
assert.match(rCodInex.error, /NOMBRE/);
console.log('OK 15/16 grounding de argumentos (servicio)');

// 16) Frase 2 EXACTA del smoke con argumentos inventados por el modelo:
// el agente extrae origen/destino del mensaje y resuelve por nombre.
const { consultarJarvis: consultarJarvisRenfe } = await import('../../src/core/jarvisAgent.js');
const depsRecH = depsRec('h', feedVacio);
try { fs.unlinkSync(depsRecH.rutaCache); } catch { /* nada */ }
try { fs.unlinkSync(depsRecH.rutaArchivo); } catch { /* nada */ }
fs.rmSync(depsRecH.rutaCacheHorarios, { recursive: true, force: true });
const registroRenfe = [];
let llamadasRenfe = 0;
const clienteRenfe = {
  chat: { completions: { create: async (payload) => {
    registroRenfe.push(payload);
    llamadasRenfe += 1;
    if (llamadasRenfe === 1) {
      return { choices: [{ message: { role: 'assistant', content: '', tool_calls: [{ id: 't1', type: 'function', function: { name: 'proximas_llegadas_transporte', arguments: { codigo: 'R1', tipo: 'r1', destino: 'Madrid' } } }] }, finish_reason: 'tool_calls' }] };
    }
    return { choices: [{ message: { role: 'assistant', content: 'Salidas programadas desde Aranjuez hacia Madrid, senor.' }, finish_reason: 'stop' }] };
  } } }
};
await consultarJarvisRenfe('que trenes hay ahora mismo hacia madrid desde aranjuez', [], {
  chatCompletion: async (peticion) => {
    const cruda = await clienteRenfe.chat.completions.create(peticion);
    return { message: cruda.choices[0].message, model: 'test-falso' };
  },
  rutaArchivoTransporte: depsRecH.rutaArchivo,
  fetchFnTransporte: depsRecH.fetchFn,
  fetchFnCercanias: depsRecH.fetchFnCercanias,
  rutaCacheEstacionesRenfe: depsRecH.rutaCache,
  rutaCacheHorariosRenfe: depsRecH.rutaCacheHorarios,
  ahoraTransporte: ahoraSabado
});
const msgsR1 = registroRenfe[1] && (registroRenfe[1].messages || registroRenfe[1].mensajes);
const msgToolRenfe = msgsR1 && msgsR1.find((m) => m.role === 'tool');
assert.ok(msgToolRenfe, 'la herramienta se ejecuto');
assert.match(msgToolRenfe.content, /salidas programadas/i, 'resuelve por nombre pese a codigo/tipo inventados');
assert.match(msgToolRenfe.content, /Aranjuez/);
assert.doesNotMatch(msgToolRenfe.content, /codigo/i, 'no pide codigo ni menciona codigos a David');
console.log('OK 16/16 frase 2 exacta con argumentos inventados (agente)');
console.log('renfe_tren.test.js OK (grounding de argumentos)');

// 17) Frase 3 del smoke (8 nov 2026): tool Renfe de LECTURA correcta pero
// sintesis del modelo de respaldo VACIA -> salida determinista segura con
// horarios/destinos, sin LLM extra, sin reejecutar la tool, sin efectos
// falsos ni peticion de otra ronda.
const depsRecI = depsRec('i', feedVacio);
try { fs.unlinkSync(depsRecI.rutaCache); } catch { /* nada */ }
try { fs.unlinkSync(depsRecI.rutaArchivo); } catch { /* nada */ }
fs.rmSync(depsRecI.rutaCacheHorarios, { recursive: true, force: true });
const registroRenfeVacia = [];
let llamadasRenfeVacia = 0;
const clienteRenfeVacia = {
  chat: { completions: { create: async (payload) => {
    registroRenfeVacia.push(payload);
    llamadasRenfeVacia += 1;
    if (llamadasRenfeVacia === 1) {
      return { choices: [{ message: { role: 'assistant', content: '', tool_calls: [{ id: 't1', type: 'function', function: { name: 'proximas_llegadas_transporte', arguments: { parada: 'aranjuez' } } }] }, finish_reason: 'tool_calls' }] };
    }
    return { choices: [{ message: { role: 'assistant', content: '' }, finish_reason: 'stop' }] };
  } } }
};
const rVacia = await consultarJarvisRenfe('dime los trenes que salen ahora mismo de aranjuez', [], {
  chatCompletion: async (peticion) => {
    const cruda = await clienteRenfeVacia.chat.completions.create(peticion);
    return { message: cruda.choices[0].message, model: 'test-falso' };
  },
  rutaArchivoTransporte: depsRecI.rutaArchivo,
  fetchFnTransporte: depsRecI.fetchFn,
  fetchFnCercanias: depsRecI.fetchFnCercanias,
  rutaCacheEstacionesRenfe: depsRecI.rutaCache,
  rutaCacheHorariosRenfe: depsRecI.rutaCacheHorarios,
  ahoraTransporte: ahoraSabado
});
assert.strictEqual(llamadasRenfeVacia, 2, 'sin LLM extra ni reejecucion de la tool');
assert.match(rVacia, /salidas programadas/i, 'salida determinista con horarios');
assert.match(rVacia, /15:50|16:00/, 'horarios reales presentes');
assert.match(rVacia, /Madrid-Atocha/, 'destinos presentes');
assert.doesNotMatch(rVacia, /SI se ejecuto|una sola vez|pideme un resumen|reformula/i, 'sin efectos falsos ni peticion de otra ronda');
console.log('OK 17/17 frase 3: sintesis vacia -> datos Renfe deterministas');
console.log('renfe_tren.test.js OK (sintesis vacia Renfe)');
