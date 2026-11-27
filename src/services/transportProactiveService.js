/**
 * transportProactiveService.js - Monitor proactivo de transporte diario (4.6)
 *
 * Cruza paradas favoritas (transportService.js) con franjas habituales
 * (habitPatternPredictorService.js o ventana horaria configurada), consulta
 * incidencias y retrasos (Cercanias/Tren GTFS-RT y EMT) y genera alertas
 * unicamente cuando hay incidencia o retraso relevante (ruido cero en
 * operacion normal, opt-in).
 *
 * Strict Policy: Zero Emojis.
 */
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from '../config/paths.js';
import { listarParadasFavoritas } from './transportService.js';
import { predecirNecesidades, franjaHorariaDe } from './habitPatternPredictorService.js';
import { llegadasCercanias, llegadasTrenLD } from './cercaniasAdapter.js';
import { llegadasEmt } from './emtAdapter.js';

export const ARCHIVO_ESTADO_DEFECTO = path.join(DATA_DIR, 'transporte_proactivo.json');
const UMBRAL_RETRASO_MIN_DEFECTO = 5;

function rutaEstado(deps = {}) {
  if (deps.rutaEstado) return deps.rutaEstado;
  if (process.env.DAVIS_DATA_DIR) {
    return path.join(process.env.DAVIS_DATA_DIR, 'transporte_proactivo.json');
  }
  return ARCHIVO_ESTADO_DEFECTO;
}

function leerEstado(deps = {}) {
  try {
    const data = JSON.parse(fs.readFileSync(rutaEstado(deps), 'utf-8'));
    return {
      config: data.config && typeof data.config === 'object' ? data.config : {},
      notificadas: data.notificadas && typeof data.notificadas === 'object' ? data.notificadas : {}
    };
  } catch {
    return { config: {}, notificadas: {} };
  }
}

function guardarEstado(estado, deps = {}) {
  const ruta = rutaEstado(deps);
  fs.mkdirSync(path.dirname(ruta), { recursive: true });
  const tmp = `${ruta}.tmp.${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(estado, null, 2), 'utf-8');
  fs.renameSync(tmp, ruta);
}

function fechaMadridDe(fecha) {
  return fecha.toLocaleDateString('sv-SE', { timeZone: 'Europe/Madrid' });
}

function coincideFranjaConfigurada(ahora, franjas = []) {
  if (!Array.isArray(franjas) || franjas.length === 0) return false;
  const franjaActual = franjaHorariaDe(ahora);
  return franjas.includes(franjaActual);
}

function hayRutinaTransporteEnFranja(ahora, deps = {}) {
  const predecir = typeof deps.predecirRutinasFn === 'function' ? deps.predecirRutinasFn : predecirNecesidades;
  const predicciones = predecir({
    fecha: ahora,
    franja: true,
    umbralMinimo: deps.umbralRutina ?? 3,
    tenantId: deps.tenantId
  }, deps);
  const lista = Array.isArray(predicciones?.predicciones)
    ? predicciones.predicciones
    : (Array.isArray(predicciones) ? predicciones : []);
  return lista.some((p) => {
    const intencion = String(p.intencion || '').toLowerCase();
    const herramienta = String(p.herramienta || '').toLowerCase();
    return intencion === 'transporte' || herramienta.includes('transporte');
  });
}

async function consultarEstadoParada(parada, ahora, deps = {}) {
  if (typeof deps.consultarIncidenciasFn === 'function') {
    return deps.consultarIncidenciasFn(parada, ahora, deps);
  }
  if (parada.tipo === 'emt') {
    return llegadasEmt(parada.codigo, {
      fetchFn: deps.fetchFnEmt,
      clientId: deps.clientIdEmt,
      passKey: deps.passKeyEmt
    });
  }
  if (parada.tipo === 'tren') {
    return llegadasTrenLD(parada.codigo, { fetchFn: deps.fetchFnCercanias, ahora });
  }
  return llegadasCercanias(parada.codigo, { fetchFn: deps.fetchFnCercanias, ahora });
}

function extraerIncidenciasParada(parada, respuesta, umbralRetrasoMin) {
  if (!respuesta || respuesta.ok === false) return [];

  const incidencias = [];
  if (Array.isArray(respuesta.incidencias)) {
    for (const inc of respuesta.incidencias) {
      incidencias.push({
        clave: `inc:${inc.id || inc.linea || inc.detalle || 'general'}`,
        tipo: 'incidencia',
        detalle: String(inc.detalle || inc.mensaje || inc.descripcion || 'Incidencia en el servicio')
      });
    }
  }

  const llegadas = Array.isArray(respuesta.llegadas) ? respuesta.llegadas : [];
  for (const ll of llegadas) {
    const viaje = ll.viaje || ll.linea || 'servicio';
    if (ll.cancelado === true) {
      incidencias.push({
        clave: `cancel:${viaje}`,
        tipo: 'cancelacion',
        viaje: String(viaje),
        detalle: `Servicio ${viaje} cancelado`
      });
      continue;
    }
    const retrasoMin = typeof ll.retrasoMin === 'number'
      ? ll.retrasoMin
      : (typeof ll.retrasoSegundos === 'number' ? Math.round(ll.retrasoSegundos / 60) : 0);
    if (retrasoMin >= umbralRetrasoMin) {
      incidencias.push({
        clave: `retraso:${viaje}`,
        tipo: 'retraso',
        viaje: String(viaje),
        retrasoMin,
        detalle: `Servicio ${viaje} con retraso de +${retrasoMin} min`
      });
    }
  }

  return incidencias;
}

export function configurarMonitorTransporteProactivo({ activo, umbralRetrasoMin, franjasConfiguradas, usarPredictorRutinas } = {}, deps = {}) {
  const estado = leerEstado(deps);
  estado.config = {
    ...(estado.config || {}),
    ...(activo !== undefined ? { activo: Boolean(activo) } : {}),
    ...(typeof umbralRetrasoMin === 'number' ? { umbralRetrasoMin } : {}),
    ...(Array.isArray(franjasConfiguradas) ? { franjasConfiguradas } : {}),
    ...(usarPredictorRutinas !== undefined ? { usarPredictorRutinas: Boolean(usarPredictorRutinas) } : {})
  };
  guardarEstado(estado, deps);
  return { ok: true, config: estado.config };
}

/**
 * Evalua paradas favoritas en la franja actual y genera alertas solo si
 * el monitor esta activado (opt-in), coincide una franja habitual y existe
 * una incidencia o retraso >= umbralRetrasoMin.
 */
export async function evaluarMonitorTransporteProactivo(ahora = new Date(), deps = {}) {
  let refAhora = ahora;
  let opciones = deps;
  if (ahora && typeof ahora === 'object' && !(ahora instanceof Date)) {
    opciones = ahora;
    refAhora = opciones.ahora ? new Date(opciones.ahora) : new Date();
  } else {
    refAhora = ahora ? new Date(ahora) : new Date();
  }

  const fecha = fechaMadridDe(refAhora);
  const franja = franjaHorariaDe(refAhora);
  const estado = leerEstado(opciones);
  const cfg = estado.config || {};

  const activo = Boolean(
    opciones.activo ??
    opciones.config?.activo ??
    cfg.activo ??
    (process.env.DAVIS_TRANSPORTE_PROACTIVO === 'true')
  );

  if (!activo) {
    return { ok: true, avisar: false, motivo: 'desactivado', fecha, franja, alertas: [], mensaje: null };
  }

  const franjasConfiguradas = opciones.franjasConfiguradas ?? opciones.config?.franjasConfiguradas ?? cfg.franjasConfiguradas ?? [];
  const usarPredictor = opciones.usarPredictorRutinas ?? opciones.config?.usarPredictorRutinas ?? cfg.usarPredictorRutinas ?? true;

  const enFranjaConfig = coincideFranjaConfigurada(refAhora, franjasConfiguradas);
  const enFranjaRutina = usarPredictor ? hayRutinaTransporteEnFranja(refAhora, opciones) : false;

  if (!enFranjaConfig && !enFranjaRutina) {
    return { ok: true, avisar: false, motivo: 'fuera_de_franja_habitual', fecha, franja, alertas: [], mensaje: null };
  }

  const paradas = Array.isArray(opciones.paradas)
    ? opciones.paradas
    : listarParadasFavoritas({ rutaArchivo: opciones.rutaTransporte });

  if (!paradas || paradas.length === 0) {
    return { ok: true, avisar: false, motivo: 'sin_paradas_favoritas', fecha, franja, alertas: [], mensaje: null };
  }

  const umbralRetrasoMin = opciones.umbralRetrasoMin ?? opciones.config?.umbralRetrasoMin ?? cfg.umbralRetrasoMin ?? UMBRAL_RETRASO_MIN_DEFECTO;
  const alertas = [];
  let huboCambios = false;

  for (const parada of paradas) {
    const resp = await consultarEstadoParada(parada, refAhora, opciones);
    const incidencias = extraerIncidenciasParada(parada, resp, umbralRetrasoMin);
    for (const inc of incidencias) {
      const claveDedup = `${fecha}:${franja}:${parada.codigo}:${inc.clave}`;
      if (!opciones.forzar && estado.notificadas[claveDedup]) continue;
      estado.notificadas[claveDedup] = new Date(refAhora).toISOString();
      huboCambios = true;
      alertas.push({
        parada: parada.nombre,
        tipoParada: parada.tipo,
        codigo: parada.codigo,
        ...inc
      });
    }
  }

  if (huboCambios) {
    guardarEstado(estado, opciones);
  }

  if (alertas.length === 0) {
    return { ok: true, avisar: false, motivo: 'operacion_normal', fecha, franja, alertas: [], mensaje: null };
  }

  const lineas = alertas.map((a) => `- ${a.parada} (${a.tipoParada} ${a.codigo}): ${a.detalle}`);
  const mensaje = `Incidencias de transporte en tu franja habitual (${franja}):\n${lineas.join('\n')}`;

  return {
    ok: true,
    avisar: true,
    motivo: 'incidencia_detectada',
    fecha,
    franja,
    alertas,
    mensaje
  };
}
