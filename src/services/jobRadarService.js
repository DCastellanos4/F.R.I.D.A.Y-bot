/**
 * jobRadarService.js
 * Radar de ofertas de practicas y empleo (funcion 1 del roadmap de 50).
 * Fuentes adaptadoras reales:
 *  - infojobs-api: API oficial de InfoJobs; requiere INFOJOBS_CLIENT_ID e
 *    INFOJOBS_CLIENT_SECRET (developer.infojobs.net). Sin ellas la fuente se
 *    reporta 'config-required', nunca se simulan ofertas.
 *  - html-generico: pagina publica de resultados con selectores CSS propios
 *    (portales sin API). Requiere url + selectores en la configuracion.
 * Las ofertas nuevas se anuncian por la cola de alertas existente. El HTTP es
 * inyectable en pruebas; en produccion usa fetch global (Node 20+).
 *
 * Strict Policy: Zero Emojis.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import * as cheerio from 'cheerio';
import { DATA_DIR } from '../config/paths.js';
import { enqueueAlert } from './alertQueueService.js';

export const ARCHIVO_CONFIG_DEFECTO = path.join(DATA_DIR, 'job_radar.json');
export const ARCHIVO_VISTOS_DEFECTO = path.join(DATA_DIR, 'job_radar_seen.json');
export const INTERVALO_DEFECTO_MS = Number(process.env.DAVIS_RADAR_INTERVALO_MS) || 6 * 60 * 60 * 1000;

function configDefecto() {
  return {
    activo: false,
    palabrasClave: ['full stack', 'desarrollador junior', 'practicas'],
    ubicacion: 'Madrid',
    remoto: null,
    fuentes: [{ id: 'infojobs', tipo: 'infojobs-api', enabled: true }]
  };
}

function rutaConfig(deps = {}) {
  return deps.rutaConfig || ARCHIVO_CONFIG_DEFECTO;
}

function rutaVistos(deps = {}) {
  return deps.rutaVistos || ARCHIVO_VISTOS_DEFECTO;
}

export function leerConfigRadar(deps = {}) {
  try {
    const raw = fs.readFileSync(rutaConfig(deps), 'utf-8');
    return { ...configDefecto(), ...JSON.parse(raw) };
  } catch {
    return configDefecto();
  }
}

function guardarConfigRadar(config, deps = {}) {
  const archivo = rutaConfig(deps);
  fs.mkdirSync(path.dirname(archivo), { recursive: true });
  fs.writeFileSync(archivo, JSON.stringify(config, null, 2), 'utf-8');
}

function leerVistos(deps = {}) {
  try {
    return JSON.parse(fs.readFileSync(rutaVistos(deps), 'utf-8')) || {};
  } catch {
    return {};
  }
}

function guardarVistos(vistos, deps = {}) {
  const archivo = rutaVistos(deps);
  fs.mkdirSync(path.dirname(archivo), { recursive: true });
  fs.writeFileSync(archivo, JSON.stringify(vistos, null, 2), 'utf-8');
}

/**
 * Ajusta la configuracion del radar. Solo pisa los campos proporcionados.
 */
export function configurarRadar({ palabrasClave = null, ubicacion = null, remoto = null, activo = null } = {}, deps = {}) {
  const config = leerConfigRadar(deps);
  if (palabrasClave !== null) {
    if (!Array.isArray(palabrasClave) || palabrasClave.length === 0 || palabrasClave.some((p) => !String(p).trim())) {
      return { ok: false, error: 'palabrasClave debe ser una lista no vacia de textos.' };
    }
    config.palabrasClave = palabrasClave.map((p) => String(p).trim());
  }
  if (ubicacion !== null) config.ubicacion = String(ubicacion).trim();
  if (remoto !== null) config.remoto = Boolean(remoto);
  if (activo !== null) config.activo = Boolean(activo);
  guardarConfigRadar(config, deps);
  return { ok: true, config };
}

function idOferta(url, titulo) {
  return crypto.createHash('sha1').update(`${url || ''}|${titulo || ''}`).digest('hex').slice(0, 16);
}

async function httpJson(url, options, deps) {
  const fetchImpl = deps.fetchJson
    ? async (u, o) => ({ status: 200, json: async () => deps.fetchJson(u, o) })
    : fetch;
  const res = await fetchImpl(url, options);
  if (!res || (res.status && res.status >= 400)) {
    throw new Error(`HTTP ${res ? res.status : 'sin respuesta'}`);
  }
  return res.json();
}

/**
 * Fuente InfoJobs (API oficial). Requiere credenciales de desarrollador.
 */
async function buscarEnInfojobs(fuente, config, deps) {
  const env = deps.env || process.env;
  const clientId = env.INFOJOBS_CLIENT_ID;
  const clientSecret = env.INFOJOBS_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return {
      fuente: fuente.id,
      estado: 'config-required',
      detalle: 'Faltan INFOJOBS_CLIENT_ID e INFOJOBS_CLIENT_SECRET. Se crean gratis en developer.infojobs.net.',
      ofertas: []
    };
  }
  try {
    const params = new URLSearchParams();
    params.set('q', config.palabrasClave.join(' '));
    if (config.ubicacion) params.set('province', config.ubicacion);
    params.set('maxResults', '20');
    params.set('order', 'publication-date-desc');
    const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    const data = await httpJson(`https://api.infojobs.net/api/9/offer?${params.toString()}`, {
      headers: { Authorization: `Basic ${auth}`, Accept: 'application/json' }
    }, deps);
    const ofertas = (data.offers || []).map((o) => ({
      id: idOferta(o.link, o.title),
      titulo: o.title || 'Sin titulo',
      empresa: o.author?.name || 'Sin empresa',
      ubicacion: [o.city, o.province?.value].filter(Boolean).join(', ') || null,
      url: o.link || null,
      fuente: fuente.id
    }));
    return { fuente: fuente.id, estado: 'ok', ofertas };
  } catch (err) {
    return { fuente: fuente.id, estado: 'error', detalle: err.message, ofertas: [] };
  }
}

/**
 * Fuente HTML generica: pagina de resultados publica + selectores CSS.
 * Util para portales sin API; el usuario aporta la URL de busqueda y los
 * selectores una vez, y el radar repite la lectura.
 */
async function buscarEnHtml(fuente, config, deps) {
  const sel = fuente.selectores || {};
  if (!fuente.url || !sel.item || !sel.titulo || !sel.enlace) {
    return {
      fuente: fuente.id,
      estado: 'config-required',
      detalle: 'La fuente HTML necesita url y selectores {item, titulo, enlace} en la configuracion.',
      ofertas: []
    };
  }
  try {
    const html = deps.fetchHtml
      ? await deps.fetchHtml(fuente.url)
      : await (await fetch(fuente.url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; DAVIS-job-radar)' } })).text();
    const $ = cheerio.load(html);
    const ofertas = [];
    $(sel.item).each((_, el) => {
      const titulo = $(el).find(sel.titulo).first().text().trim();
      const href = $(el).find(sel.enlace).first().attr('href');
      if (!titulo || !href) return;
      let url;
      try {
        url = new URL(href, fuente.url).href;
      } catch {
        return;
      }
      const empresa = sel.empresa ? $(el).find(sel.empresa).first().text().trim() : null;
      ofertas.push({ id: idOferta(url, titulo), titulo, empresa, ubicacion: null, url, fuente: fuente.id });
    });
    return { fuente: fuente.id, estado: 'ok', ofertas };
  } catch (err) {
    return { fuente: fuente.id, estado: 'error', detalle: err.message, ofertas: [] };
  }
}

const ADAPTERS = {
  'infojobs-api': buscarEnInfojobs,
  'html-generico': buscarEnHtml
};

/**
 * Ejecuta una ronda del radar: consulta las fuentes habilitadas, deduplica
 * contra lo ya visto y encola una alerta por oferta nueva. Sin fuentes listas
 * informa del estado real (config-required / error), nunca inventa ofertas.
 */
export async function escanearRadar(deps = {}) {
  const config = leerConfigRadar(deps);
  if (!config.activo) {
    return { ok: true, escaneado: false, motivo: 'Radar desactivado. Activelo configurando el radar (activo: true).' };
  }
  const habilitadas = (config.fuentes || []).filter((f) => f && f.enabled);
  if (habilitadas.length === 0) {
    return { ok: true, escaneado: false, motivo: 'No hay fuentes habilitadas en la configuracion del radar.' };
  }

  const resultadosFuentes = [];
  const encontradas = [];
  for (const fuente of habilitadas) {
    const adapter = ADAPTERS[fuente.tipo];
    if (!adapter) {
      resultadosFuentes.push({ fuente: fuente.id, estado: 'config-required', detalle: `Tipo de fuente desconocido: ${fuente.tipo}`, ofertas: [] });
      continue;
    }
    const resultado = await adapter(fuente, config, deps);
    resultadosFuentes.push(resultado);
    encontradas.push(...resultado.ofertas);
  }

  const vistos = leerVistos(deps);
  const nuevas = encontradas.filter((o) => !vistos[o.id]);
  const encolar = typeof deps.enqueue === 'function'
    ? deps.enqueue
    : (alerta) => enqueueAlert(alerta, deps.alertQueueOptions || {});
  for (const oferta of nuevas) {
    encolar({
      title: `Nueva oferta: ${oferta.titulo}`,
      details: `${oferta.empresa || 'Empresa sin indicar'}${oferta.ubicacion ? ` - ${oferta.ubicacion}` : ''}${oferta.url ? `\n${oferta.url}` : ''}`,
      priority: 'normal',
      source: 'job-radar'
    });
    vistos[oferta.id] = new Date().toISOString();
  }
  guardarVistos(vistos, deps);

  return {
    ok: true,
    escaneado: true,
    nuevas,
    totalEncontradas: encontradas.length,
    fuentes: resultadosFuentes.map(({ fuente, estado, detalle }) => ({ fuente, estado, detalle }))
  };
}

let intervaloRadar = null;

/**
 * Rondas periodicas del radar. Las alertas salen por la cola existente, que
 * whatsappBot ya drena cada 5 segundos al chat de David.
 */
export function iniciarMonitorRadar(deps = {}, intervaloMs = INTERVALO_DEFECTO_MS) {
  if (intervaloRadar) return intervaloRadar;
  intervaloRadar = setInterval(() => {
    escanearRadar(deps).catch((err) => console.error('[Radar Empleo] Error en ronda:', err.message));
  }, intervaloMs);
  if (typeof intervaloRadar.unref === 'function') intervaloRadar.unref();
  return intervaloRadar;
}

export function detenerMonitorRadar() {
  if (intervaloRadar) {
    clearInterval(intervaloRadar);
    intervaloRadar = null;
  }
}
