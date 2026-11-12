/**
 * transport.js - Consultas deterministas de horarios Renfe y radar de vuelos para mcp-server-lifestyle.
 *
 * Strict Policy: Zero Emojis.
 */

const ESTACIONES_RENFE = {
  atocha: 'Madrid-Atocha',
  'madrid-atocha': 'Madrid-Atocha',
  'madrid atocha': 'Madrid-Atocha',
  chamartin: 'Madrid-Chamartin',
  'madrid-chamartin': 'Madrid-Chamartin',
  'madrid chamartin': 'Madrid-Chamartin',
  sants: 'Barcelona-Sants',
  'barcelona-sants': 'Barcelona-Sants',
  'barcelona sants': 'Barcelona-Sants',
  barcelona: 'Barcelona-Sants',
  'santa justa': 'Sevilla-Santa Justa',
  'sevilla-santa justa': 'Sevilla-Santa Justa',
  sevilla: 'Sevilla-Santa Justa',
  'joaquin sorolla': 'Valencia-Joaquin Sorolla',
  'valencia-joaquin sorolla': 'Valencia-Joaquin Sorolla',
  valencia: 'Valencia-Joaquin Sorolla',
  delicias: 'Zaragoza-Delicias',
  'zaragoza-delicias': 'Zaragoza-Delicias',
  zaragoza: 'Zaragoza-Delicias',
  aranjuez: 'Aranjuez',
  alcala: 'Alcala de Henares',
  'alcala de henares': 'Alcala de Henares',
  segovia: 'Segovia-Guiomar',
  'segovia-guiomar': 'Segovia-Guiomar',
  toledo: 'Toledo'
};

const AEROPUERTOS = {
  madrid: 'MAD',
  mad: 'MAD',
  barcelona: 'BCN',
  bcn: 'BCN',
  lisboa: 'LIS',
  lis: 'LIS',
  paris: 'CDG',
  cdg: 'CDG',
  londres: 'LHR',
  lhr: 'LHR',
  roma: 'FCO',
  fco: 'FCO',
  milan: 'MXP',
  mxp: 'MXP',
  sevilla: 'SVQ',
  svq: 'SVQ',
  valencia: 'VLC',
  vlc: 'VLC',
  malaga: 'AGP',
  agp: 'AGP'
};

/**
 * Normaliza el nombre de una estacion Renfe.
 */
export function normalizarEstacion(nombre) {
  const limpio = String(nombre || '').trim().toLowerCase();
  return ESTACIONES_RENFE[limpio] || String(nombre || '').trim();
}

/**
 * Normaliza el codigo o ciudad de un aeropuerto IATA.
 */
export function normalizarAeropuerto(nombre) {
  const limpio = String(nombre || '').trim().toLowerCase();
  return AEROPUERTOS[limpio] || String(nombre || '').trim().toUpperCase();
}

/**
 * Catalogo base determinista de horarios Renfe por corredor.
 */
const CORREDORES_RENFE = {
  'Madrid-Atocha|Barcelona-Sants': [
    { tren_id: 'AVE-03063', tipo: 'AVE', salida: '06:30', llegada: '09:00', duracion: '2h 30m' },
    { tren_id: 'Avlo-06071', tipo: 'Avlo', salida: '07:00', llegada: '09:30', duracion: '2h 30m' },
    { tren_id: 'AVE-03083', tipo: 'AVE', salida: '08:30', llegada: '11:15', duracion: '2h 45m' },
    { tren_id: 'AVE-03103', tipo: 'AVE', salida: '10:00', llegada: '12:30', duracion: '2h 30m' },
    { tren_id: 'Avlo-06121', tipo: 'Avlo', salida: '12:30', llegada: '15:10', duracion: '2h 40m' },
    { tren_id: 'AVE-03143', tipo: 'AVE', salida: '14:00', llegada: '16:30', duracion: '2h 30m' },
    { tren_id: 'AVE-03173', tipo: 'AVE', salida: '17:30', llegada: '20:00', duracion: '2h 30m' },
    { tren_id: 'AVE-03193', tipo: 'AVE', salida: '19:00', llegada: '21:30', duracion: '2h 30m' },
    { tren_id: 'Avlo-06201', tipo: 'Avlo', salida: '20:30', llegada: '23:15', duracion: '2h 45m' }
  ],
  'Barcelona-Sants|Madrid-Atocha': [
    { tren_id: 'AVE-03062', tipo: 'AVE', salida: '06:45', llegada: '09:15', duracion: '2h 30m' },
    { tren_id: 'Avlo-06072', tipo: 'Avlo', salida: '07:15', llegada: '09:45', duracion: '2h 30m' },
    { tren_id: 'AVE-03092', tipo: 'AVE', salida: '09:00', llegada: '11:45', duracion: '2h 45m' },
    { tren_id: 'AVE-03132', tipo: 'AVE', salida: '13:00', llegada: '15:30', duracion: '2h 30m' },
    { tren_id: 'AVE-03162', tipo: 'AVE', salida: '16:00', llegada: '18:30', duracion: '2h 30m' },
    { tren_id: 'Avlo-06182', tipo: 'Avlo', salida: '18:30', llegada: '21:10', duracion: '2h 40m' },
    { tren_id: 'AVE-03202', tipo: 'AVE', salida: '20:00', llegada: '22:30', duracion: '2h 30m' }
  ],
  'Madrid-Atocha|Sevilla-Santa Justa': [
    { tren_id: 'AVE-02070', tipo: 'AVE', salida: '07:00', llegada: '09:35', duracion: '2h 35m' },
    { tren_id: 'AVE-02090', tipo: 'AVE', salida: '09:00', llegada: '11:38', duracion: '2h 38m' },
    { tren_id: 'AVE-02120', tipo: 'AVE', salida: '12:00', llegada: '14:35', duracion: '2h 35m' },
    { tren_id: 'AVE-02160', tipo: 'AVE', salida: '16:00', llegada: '18:40', duracion: '2h 40m' },
    { tren_id: 'AVE-02190', tipo: 'AVE', salida: '19:30', llegada: '22:05', duracion: '2h 35m' }
  ],
  'Madrid-Atocha|Valencia-Joaquin Sorolla': [
    { tren_id: 'AVE-05070', tipo: 'AVE', salida: '07:40', llegada: '09:32', duracion: '1h 52m' },
    { tren_id: 'Avlo-05090', tipo: 'Avlo', salida: '09:40', llegada: '11:35', duracion: '1h 55m' },
    { tren_id: 'AVE-05110', tipo: 'AVE', salida: '11:40', llegada: '13:30', duracion: '1h 50m' },
    { tren_id: 'AVE-05150', tipo: 'AVE', salida: '15:40', llegada: '17:32', duracion: '1h 52m' },
    { tren_id: 'AVE-05180', tipo: 'AVE', salida: '18:40', llegada: '20:30', duracion: '1h 50m' }
  ],
  'Madrid-Atocha|Aranjuez': [
    { tren_id: 'CER-C3-01', tipo: 'Cercanias', salida: '07:15', llegada: '07:58', duracion: '43m' },
    { tren_id: 'CER-C3-02', tipo: 'Cercanias', salida: '07:45', llegada: '08:28', duracion: '43m' },
    { tren_id: 'CER-C3-03', tipo: 'Cercanias', salida: '08:15', llegada: '08:58', duracion: '43m' },
    { tren_id: 'CER-C3-04', tipo: 'Cercanias', salida: '09:15', llegada: '09:58', duracion: '43m' },
    { tren_id: 'CER-C3-05', tipo: 'Cercanias', salida: '11:15', llegada: '11:58', duracion: '43m' },
    { tren_id: 'CER-C3-06', tipo: 'Cercanias', salida: '13:15', llegada: '13:58', duracion: '43m' },
    { tren_id: 'CER-C3-07', tipo: 'Cercanias', salida: '15:15', llegada: '15:58', duracion: '43m' },
    { tren_id: 'CER-C3-08', tipo: 'Cercanias', salida: '18:15', llegada: '18:58', duracion: '43m' },
    { tren_id: 'CER-C3-09', tipo: 'Cercanias', salida: '20:15', llegada: '20:58', duracion: '43m' }
  ],
  'Madrid-Atocha|Alcala de Henares': [
    { tren_id: 'CER-C2-01', tipo: 'Cercanias', salida: '07:20', llegada: '07:55', duracion: '35m' },
    { tren_id: 'CER-C2-02', tipo: 'Cercanias', salida: '08:00', llegada: '08:35', duracion: '35m' },
    { tren_id: 'CER-C2-03', tipo: 'Cercanias', salida: '09:00', llegada: '09:35', duracion: '35m' },
    { tren_id: 'CER-C2-04', tipo: 'Cercanias', salida: '11:00', llegada: '11:35', duracion: '35m' },
    { tren_id: 'CER-C2-05', tipo: 'Cercanias', salida: '14:00', llegada: '14:35', duracion: '35m' },
    { tren_id: 'CER-C2-06', tipo: 'Cercanias', salida: '17:00', llegada: '17:35', duracion: '35m' },
    { tren_id: 'CER-C2-07', tipo: 'Cercanias', salida: '19:30', llegada: '20:05', duracion: '35m' }
  ]
};

/**
 * Consulta determinista de horarios de trenes Renfe.
 */
export function consultarTrenesRenfe({
  origen,
  destino,
  fecha,
  hora_minima,
  tipo
} = {}) {
  if (!origen || typeof origen !== 'string' || !origen.trim()) {
    throw new Error('El parametro origen es obligatorio');
  }
  if (!destino || typeof destino !== 'string' || !destino.trim()) {
    throw new Error('El parametro destino es obligatorio');
  }

  const origNorm = normalizarEstacion(origen);
  const destNorm = normalizarEstacion(destino);

  if (origNorm.toLowerCase() === destNorm.toLowerCase()) {
    throw new Error('El origen y el destino no pueden ser la misma estacion');
  }

  const fechaFinal = fecha && /^\d{4}-\d{2}-\d{2}$/.test(fecha)
    ? fecha
    : new Date().toISOString().slice(0, 10);

  const claveCorredor = `${origNorm}|${destNorm}`;
  let lista = CORREDORES_RENFE[claveCorredor];

  if (!lista) {
    // Generador determinista sintetico para rutas arbitrarias
    const tipos = ['AVE', 'Alvia', 'Media Distancia', 'Intercity'];
    lista = [
      { tren_id: `MD-101`, tipo: 'Media Distancia', salida: '07:30', llegada: '10:15', duracion: '2h 45m' },
      { tren_id: `ALV-201`, tipo: 'Alvia', salida: '10:15', llegada: '12:45', duracion: '2h 30m' },
      { tren_id: `AVE-301`, tipo: 'AVE', salida: '14:00', llegada: '16:20', duracion: '2h 20m' },
      { tren_id: `AVE-401`, tipo: 'AVE', salida: '18:45', llegada: '21:05', duracion: '2h 20m' }
    ];
  }

  let trenesFiltrados = lista.map((t) => ({
    ...t,
    origen: origNorm,
    destino: destNorm,
    fecha: fechaFinal
  }));

  if (hora_minima && /^\d{1,2}:\d{2}$/.test(hora_minima)) {
    const minMin = hora_minima.padStart(5, '0');
    trenesFiltrados = trenesFiltrados.filter((t) => t.salida >= minMin);
  }

  if (tipo && typeof tipo === 'string' && tipo.toLowerCase() !== 'todos') {
    const tipoFiltro = tipo.toLowerCase();
    trenesFiltrados = trenesFiltrados.filter((t) => t.tipo.toLowerCase().includes(tipoFiltro));
  }

  return {
    ok: true,
    origen: origNorm,
    destino: destNorm,
    fecha: fechaFinal,
    total_trenes: trenesFiltrados.length,
    trenes: trenesFiltrados
  };
}

/**
 * Consulta determinista de rutas y precios en el radar de vuelos.
 */
export function consultarRadarVuelos({
  origen,
  destino,
  fecha,
  precio_maximo,
  aerolinea,
  solo_directos
} = {}) {
  if (!origen || typeof origen !== 'string' || !origen.trim()) {
    throw new Error('El parametro origen es obligatorio');
  }
  if (!destino || typeof destino !== 'string' || !destino.trim()) {
    throw new Error('El parametro destino es obligatorio');
  }
  if (!fecha || !/^\d{4}-\d{2}-\d{2}$/.test(String(fecha).trim())) {
    throw new Error('El parametro fecha es obligatorio y debe tener formato YYYY-MM-DD');
  }

  const origIata = normalizarAeropuerto(origen);
  const destIata = normalizarAeropuerto(destino);
  const fechaStr = String(fecha).trim();

  if (origIata === destIata) {
    throw new Error('El origen y el destino no pueden ser el mismo aeropuerto');
  }

  // Generador determinista de vuelos basado en hash de ruta y fecha
  const aerolineasBase = [
    { nombre: 'Iberia', codigo: 'IB' },
    { nombre: 'Air Europa', codigo: 'UX' },
    { nombre: 'Ryanair', codigo: 'FR' },
    { nombre: 'Vueling', codigo: 'VY' },
    { nombre: 'TAP Air Portugal', codigo: 'TP' }
  ];

  let seed = 0;
  const hashKey = `${origIata}-${destIata}-${fechaStr}`;
  for (let i = 0; i < hashKey.length; i++) {
    seed = (seed * 31 + hashKey.charCodeAt(i)) % 100000;
  }

  const vuelos = [];
  const horas = ['06:45', '09:30', '13:15', '16:50', '20:10'];

  for (let idx = 0; idx < horas.length; idx++) {
    const al = aerolineasBase[(seed + idx) % aerolineasBase.length];
    const precioBase = 35 + ((seed * (idx + 1)) % 140);
    const esDirecto = solo_directos ? true : ((seed + idx) % 4 !== 0);
    const duracionMin = 75 + ((seed + idx * 10) % 50);
    const hDur = Math.floor(duracionMin / 60);
    const mDur = duracionMin % 60;

    const [hSal, mSal] = horas[idx].split(':').map(Number);
    const totalMinLlegada = hSal * 60 + mSal + duracionMin;
    const hLleg = Math.floor(totalMinLlegada / 60) % 24;
    const mLleg = totalMinLlegada % 60;
    const horaLlegada = `${String(hLleg).padStart(2, '0')}:${String(mLleg).padStart(2, '0')}`;

    vuelos.push({
      vuelo: `${al.codigo}${1000 + ((seed + idx * 37) % 9000)}`,
      aerolinea: al.nombre,
      origen: origIata,
      destino: destIata,
      fecha: fechaStr,
      salida: horas[idx],
      llegada: horaLlegada,
      duracion: `${hDur}h ${mDur}m`,
      escalas: esDirecto ? 0 : 1,
      tipo: esDirecto ? 'directo' : '1 escala',
      precio: Math.round(precioBase * 100) / 100,
      moneda: 'EUR'
    });
  }

  let filtrados = vuelos;

  if (precio_maximo !== undefined && precio_maximo !== null) {
    const pMax = Number(precio_maximo);
    if (Number.isFinite(pMax) && pMax > 0) {
      filtrados = filtrados.filter((v) => v.precio <= pMax);
    }
  }

  if (aerolinea && typeof aerolinea === 'string' && aerolinea.trim()) {
    const alFiltro = aerolinea.trim().toLowerCase();
    filtrados = filtrados.filter((v) => v.aerolinea.toLowerCase().includes(alFiltro) || v.vuelo.toLowerCase().startsWith(alFiltro));
  }

  if (solo_directos === true) {
    filtrados = filtrados.filter((v) => v.escalas === 0);
  }

  filtrados.sort((a, b) => a.precio - b.precio);

  const masBarato = filtrados.length > 0 ? filtrados[0] : null;

  return {
    ok: true,
    origen: origIata,
    destino: destIata,
    fecha: fechaStr,
    total: filtrados.length,
    mas_barato: masBarato,
    vuelos: filtrados
  };
}
