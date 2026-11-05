/**
 * viajesService.js - Bloque 15 de las 50: seguimiento de vuelos y trenes (nº 28).
 *
 * Extension de vigilar_producto a rutas: registro de rutas (origen, destino,
 * fecha, precio objetivo), historial de precios y aviso de bajadas por la
 * cola de avisos. Cada ruta nace de una peticion textual expresa de David;
 * el monitor solo comprueba rutas registradas (autoproteccion).
 *
 * FUENTE DE PRECIOS EN VIVO: CONFIG-REQUIRED. No hay fuente gratuita de
 * precios de vuelos/trenes sin alta (Amadeus, Kiwi/Tequila y similares
 * exigen cuenta; Renfe no tiene API publica). Este servicio NO inventa
 * precios ni simula una fuente: sin proveedor configurado por el
 * propietario lo declara. Lo operativo sin proveedor:
 *   - registro/cancelacion/listado de rutas vigiladas;
 *   - registro manual de precios que David ve ("el Madrid-Lisboa del 12
 *     esta a 45 EUR") con comparacion contra el objetivo e historial.
 * El proveedor en vivo se inyecta (deps.consultarPrecioRuta) o se configura
 * en el servidor; aqui no se implementa ninguno no verificable.
 *
 * Strict Policy: Zero Emojis.
 */
import fs from 'node:fs';
import path from 'node:path';
import { enqueueAlert } from './alertQueueService.js';

const DATA_DIR = process.env.DAVIS_DATA_DIR || path.join(process.cwd(), 'data');
export const ARCHIVO_VIAJES_DEFECTO = path.join(DATA_DIR, 'viajes_vigilados.json');

const TIPOS = ['vuelo', 'tren'];

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
  return String(texto || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function mismaRuta(r, { tipo, origen, destino, fecha }) {
  return r.tipo === tipo
    && r.origen === normalizarLugar(origen)
    && r.destino === normalizarLugar(destino)
    && r.fecha === String(fecha || '').trim();
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
    creada: new Date().toISOString()
  };
  lista.push(ruta);
  guardarRutas(lista, deps);
  return {
    ok: true,
    ruta,
    nota: 'Aviso de fuente: no tengo proveedor de precios en vivo configurado (Amadeus/Kiwi exigen alta; Renfe no tiene API publica). Mientras tanto puedes pasarme precios que veas ("el vuelo esta a 45 EUR") y los comparo con tu objetivo; la comprobacion automatica queda pendiente de configurar una fuente en el servidor.'
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
  ruta.historial.push({ precio: p, cuando: new Date().toISOString(), fuente: 'manual' });
  guardarRutas(lista, deps);
  const baja = minimoPrevio === null || p < minimoPrevio;
  const bajoObjetivo = ruta.precioObjetivo != null && p <= ruta.precioObjetivo;
  return { ok: true, ruta, precio: p, baja, bajoObjetivo, minimoPrevio };
}

/**
 * Comprobacion programada: SOLO con proveedor inyectado/configurado.
 * Sin proveedor: no consulta nada ni inventa precios (config-required).
 */
export async function comprobarRutasProgramado(deps = {}) {
  const rutas = listarRutasVigiladas(deps);
  if (!rutas.length) return { ok: true, avisos: 0, motivo: 'Sin rutas vigiladas.' };
  const consultar = deps.consultarPrecioRuta;
  if (typeof consultar !== 'function') {
    return { ok: true, avisos: 0, configRequired: true, motivo: 'Sin proveedor de precios en vivo configurado: no consulto nada. Registra precios manualmente o configura una fuente en el servidor.' };
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
    r.historial.push({ precio, cuando: new Date().toISOString(), fuente: String(resultado.fuente || 'proveedor') });
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
