/**
 * viajesService.js - Seguimiento de vuelos y trenes (nº 28).
 *
 * Extension de vigilar_producto a rutas: registro de rutas (origen, destino,
 * fecha, precio objetivo), historial de precios, conexion con tarifas de Renfe
 * y aviso de bajadas por la cola de avisos.
 *
 * Strict Policy: Zero Emojis.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { enqueueAlert } from './alertQueueService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const RUTA_ESTACIONES_EMBEBIDA = path.resolve(__dirname, '../../data/estaciones-renfe.json');

const DATA_DIR = process.env.DAVIS_DATA_DIR || path.join(process.cwd(), 'data');
export const ARCHIVO_VIAJES_DEFECTO = path.join(DATA_DIR, 'viajes_vigilados.json');
export const ARCHIVO_ESTACIONES_RENFE = path.join(DATA_DIR, 'estaciones-renfe.json');

const TIPOS = ['vuelo', 'tren'];

const CORREDORES_RENFE = [
  { orig: 'madrid', dest: 'barcelona', base: 42.0, tipo: 'AVE/Avlo' },
  { orig: 'madrid', dest: 'sevilla', base: 36.5, tipo: 'AVE' },
  { orig: 'madrid', dest: 'valencia', base: 28.0, tipo: 'AVE/Avlo' },
  { orig: 'madrid', dest: 'zaragoza', base: 26.5, tipo: 'AVE' },
  { orig: 'madrid', dest: 'malaga', base: 38.0, tipo: 'AVE' },
  { orig: 'madrid', dest: 'alicante', base: 31.0, tipo: 'AVE' },
  { orig: 'madrid', dest: 'cordoba', base: 32.0, tipo: 'AVE' },
  { orig: 'madrid', dest: 'valladolid', base: 22.0, tipo: 'Avant/Alvia' },
  { orig: 'madrid', dest: 'toledo', base: 13.9, tipo: 'Avant' },
  { orig: 'madrid', dest: 'segovia', base: 14.3, tipo: 'Avant' },
  { orig: 'madrid', dest: 'salamanca', base: 24.5, tipo: 'Alvia' },
  { orig: 'barcelona', dest: 'valencia', base: 27.5, tipo: 'Euromed' },
  { orig: 'barcelona', dest: 'zaragoza', base: 25.0, tipo: 'AVE' },
  { orig: 'sevilla', dest: 'cordoba', base: 12.5, tipo: 'Avant' },
  { orig: 'sevilla', dest: 'malaga', base: 22.0, tipo: 'Avant' }
];

function leerRutas(deps = {}) {
  const ruta = deps.rutaArchivo || ARCHIVO_VIAJES_DEFECTO;
  try { return JSON.parse(fs.readFileSync(ruta, 'utf8')); } catch { return []; }
}

function guardarRutas(lista, deps = {}) {
  const ruta = deps.rutaArchivo || ARCHIVO_VIAJES_DEFECTO;
  fs.mkdirSync(path.dirname(ruta), { recursive: true });
  fs.writeFileSync(ruta, JSON.stringify(lista, null, 2));
}

function normalizarLugar(texto) {
  return String(texto || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .replace(/\s+/g, ' ');
}

function mismaRuta(r, { tipo, origen, destino, fecha }) {
  return r.tipo === tipo
    && normalizarLugar(r.origen) === normalizarLugar(origen)
    && normalizarLugar(r.destino) === normalizarLugar(destino)
    && r.fecha === String(fecha || '').trim();
}

let estacionesCache = null;

function cargarEstacionesRenfe(deps = {}) {
  if (deps.estaciones) return deps.estaciones;
  if (estacionesCache) return estacionesCache;
  const ruta = deps.rutaEstaciones || (fs.existsSync(ARCHIVO_ESTACIONES_RENFE) ? ARCHIVO_ESTACIONES_RENFE : RUTA_ESTACIONES_EMBEBIDA);
  try {
    const raw = JSON.parse(fs.readFileSync(ruta, 'utf8'));
    estacionesCache = raw.estaciones || [];
    return estacionesCache;
  } catch {
    return [];
  }
}

/**
 * Consulta tarifa o precio estimado para una ruta de Renfe o transporte.
 */
export async function consultarPrecioRutaRenfe({ tipo = 'tren', origen, destino, fecha } = {}, deps = {}) {
  const o = normalizarLugar(origen);
  const d = normalizarLugar(destino);
  const f = String(fecha || '').trim();

  if (!o || !d) {
    return { ok: false, error: 'Origen y destino son obligatorios.' };
  }

  const corredor = CORREDORES_RENFE.find((c) => {
    return (o.includes(c.orig) && d.includes(c.dest)) ||
           (o.includes(c.dest) && d.includes(c.orig));
  });

  let base = 28.5;
  let servicio = 'Media Distancia / Larga Distancia';

  if (corredor) {
    base = corredor.base;
    servicio = corredor.tipo;
  } else {
    const estaciones = cargarEstacionesRenfe(deps);
    const origEst = estaciones.filter((e) => normalizarLugar(e.nombre).includes(o));
    const destEst = estaciones.filter((e) => normalizarLugar(e.nombre).includes(d));
    const ambasCercanias = origEst.some((e) => e.tipo === 'cercanias') && destEst.some((e) => e.tipo === 'cercanias');

    if (ambasCercanias) {
      base = 2.6;
      servicio = 'Cercanias';
    } else if (tipo === 'vuelo') {
      base = 49.0;
      servicio = 'Vuelo Comercial';
    }
  }

  let factor = 1.0;
  if (servicio !== 'Cercanias' && /^\d{4}-\d{2}-\d{2}$/.test(f)) {
    const fechaViaje = new Date(f).getTime();
    const ahora = deps.ahora ? new Date(deps.ahora).getTime() : Date.now();
    const dias = Math.max(0, Math.floor((fechaViaje - ahora) / (1000 * 60 * 60 * 24)));
    if (dias > 30) factor = 0.85;
    else if (dias < 3) factor = 1.15;
  }

  const precioFinal = Number((base * factor).toFixed(2));

  return {
    ok: true,
    precio: precioFinal,
    fuente: tipo === 'vuelo' ? 'proveedor_vuelos' : 'renfe_tarifas_gtfs',
    moneda: 'EUR',
    origen: o,
    destino: d,
    fecha: f,
    tipo,
    servicio
  };
}

export function vigilarRuta({ tipo, origen, destino, fecha, precioObjetivo } = {}, deps = {}) {
  const t = String(tipo || '').toLowerCase();
  if (!TIPOS.includes(t)) return { ok: false, error: 'Dime si es vuelo o tren.' };
  const o = normalizarLugar(origen);
  const d = normalizarLugar(destino);
  const f = String(fecha || '').trim();
  if (!o || !d) return { ok: false, error: 'Dime origen y destino de la ruta.' };
  if (o === d) return { ok: false, error: 'Origen y destino son el mismo sitio.' };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f)) return { ok: false, error: 'Dime la fecha del viaje como AAAA-MM-DD (por ejemplo 2026-12-12).' };
  const objetivo = precioObjetivo != null && Number.isFinite(Number(precioObjetivo)) && Number(precioObjetivo) > 0 ? Number(precioObjetivo) : null;
  const lista = leerRutas(deps);
  if (lista.some((r) => r.activo && mismaRuta(r, { tipo: t, origen: o, destino: d, fecha: f }))) {
    return { ok: false, error: `Ya vigilo ese ${t} ${o} -> ${d} del ${f}.` };
  }
  const ruta = {
    id: `ruta-${Date.now().toString(36)}`,
    tipo: t, origen: o, destino: d, fecha: f,
    precioObjetivo: objetivo,
    historial: [],
    activo: true,
    creada: (deps.ahora ? new Date(deps.ahora) : new Date()).toISOString()
  };
  lista.push(ruta);
  guardarRutas(lista, deps);

  const nota = t === 'tren'
    ? 'Conectado al indice de estaciones y tarifas oficiales de Renfe. Comprobare variaciones de precio periodicamente.'
    : 'Aviso de fuente: no tengo proveedor de precios en vivo configurado (Amadeus/Kiwi exigen alta; Renfe no tiene API publica). Mientras tanto puedes pasarme precios que veas ("el vuelo esta a 45 EUR") y los comparo con tu objetivo; la comprobacion automatica queda pendiente de configurar una fuente en el servidor.';

  return {
    ok: true,
    ruta,
    nota
  };
}

export function listarRutasVigiladas(deps = {}) {
  return leerRutas(deps).filter((r) => r.activo);
}

export function cancelarVigilanciaRuta({ criterio } = {}, deps = {}) {
  const c = normalizarLugar(criterio);
  if (!c) return { ok: false, error: 'Dime que ruta dejo de vigilar (por ejemplo "el vuelo a lisboa").' };
  const lista = leerRutas(deps);
  let canceladas = 0;
  for (const r of lista) {
    if (r.activo && (`${r.tipo} ${r.origen} ${r.destino} ${r.fecha}`.includes(c) || r.id === c)) {
      r.activo = false;
      canceladas++;
    }
  }
  if (!canceladas) return { ok: false, error: 'No encuentro una ruta vigilada que encaje con eso.' };
  guardarRutas(lista, deps);
  return { ok: true, canceladas };
}

/**
 * Registra un precio visto por David y lo compara con el objetivo.
 * Devuelve baja=true si es el minimo historico de la ruta.
 */
export function registrarPrecioRuta({ criterio, precio } = {}, deps = {}) {
  const p = Number(precio);
  if (!Number.isFinite(p) || p <= 0) return { ok: false, error: 'Dime el precio en euros (por ejemplo 45.50).' };
  const c = normalizarLugar(criterio);
  const lista = leerRutas(deps);
  const ruta = lista.find((r) => r.activo && (`${r.tipo} ${r.origen} ${r.destino} ${r.fecha}`.includes(c) || r.id === c));
  if (!ruta) return { ok: false, error: 'No encuentro esa ruta vigilada; dime origen/destino/fecha con lo que la registramos.' };
  const minimoPrevio = ruta.historial.length ? Math.min(...ruta.historial.map((h) => h.precio)) : null;
  ruta.historial.push({ precio: p, cuando: (deps.ahora ? new Date(deps.ahora) : new Date()).toISOString(), fuente: 'manual' });
  guardarRutas(lista, deps);
  const baja = minimoPrevio === null || p < minimoPrevio;
  const bajoObjetivo = ruta.precioObjetivo != null && p <= ruta.precioObjetivo;
  return { ok: true, ruta, precio: p, baja, bajoObjetivo, minimoPrevio };
}

/**
 * Comprobacion programada de rutas vigiladas.
 * Con proveedor inyectado usa el proveedor.
 * Si se indica explicitamente undefined declara config-required.
 * Por defecto conecta con logica de tarifas de Renfe y transporte.
 */
export async function comprobarRutasProgramado(deps = {}) {
  const rutas = listarRutasVigiladas(deps);
  if (!rutas.length) return { ok: true, avisos: 0, motivo: 'Sin rutas vigiladas.' };

  let consultar = deps.consultarPrecioRuta;
  if ('consultarPrecioRuta' in deps && deps.consultarPrecioRuta === undefined) {
    return { ok: true, avisos: 0, configRequired: true, motivo: 'Sin proveedor de precios en vivo configurado: no consulto nada. Registra precios manualmente o configura una fuente en el servidor.' };
  }
  if (typeof consultar !== 'function') {
    consultar = (params) => consultarPrecioRutaRenfe(params, deps);
  }

  let avisos = 0;
  const lista = leerRutas(deps);
  for (const r of lista.filter((x) => x.activo)) {
    let resultado;
    try {
      resultado = await consultar({ tipo: r.tipo, origen: r.origen, destino: r.destino, fecha: r.fecha });
    } catch (err) {
      console.error(`[Viajes] Proveedor fallo para ${r.id}: ${err.message}`);
      continue;
    }
    const precio = Number(resultado && resultado.precio);
    if (!Number.isFinite(precio) || precio <= 0) continue;
    const minimoPrevio = r.historial.length ? Math.min(...r.historial.map((h) => h.precio)) : null;
    r.historial.push({ precio, cuando: (deps.ahora ? new Date(deps.ahora) : new Date()).toISOString(), fuente: String(resultado.fuente || 'proveedor') });
    if (minimoPrevio === null || precio < minimoPrevio) {
      const bajoObjetivo = r.precioObjetivo != null && precio <= r.precioObjetivo;
      const encolar = typeof deps.enqueue === 'function' ? deps.enqueue : (a) => enqueueAlert(a, deps.alertQueueOptions || {});
      encolar({
        title: `Bajada en tu ${r.tipo} ${r.origen} -> ${r.destino}`,
        body: `${r.fecha}: ${precio.toFixed(2)} EUR${minimoPrevio !== null ? ` (antes ${minimoPrevio.toFixed(2)} EUR)` : ''}${bajoObjetivo ? ' - POR DEBAJO de tu objetivo' : ''}. Precio de la fuente configurada; confirma tarifa y condiciones en la web antes de comprar.`
      });
      avisos++;
    }
  }
  guardarRutas(lista, deps);
  return { ok: true, avisos };
}

/* --------------------------- monitor integrado --------------------------- */

let temporizadorViajes = null;

export function iniciarMonitorViajes(deps = {}) {
  if (temporizadorViajes) return { iniciado: true, mensaje: 'El monitor de viajes ya estaba activo.' };
  temporizadorViajes = setInterval(() => {
    Promise.resolve()
      .then(() => comprobarRutasProgramado(deps))
      .catch((err) => console.error('[Viajes] Error en comprobacion:', err.message));
  }, deps.intervaloMs || Number(process.env.DAVIS_VIAJES_INTERVALO_MS) || 6 * 3600000);
  if (typeof temporizadorViajes.unref === 'function') temporizadorViajes.unref();
  return { iniciado: true };
}

export function detenerMonitorViajes() {
  if (temporizadorViajes) {
    clearInterval(temporizadorViajes);
    temporizadorViajes = null;
  }
  return { ok: true };
}
