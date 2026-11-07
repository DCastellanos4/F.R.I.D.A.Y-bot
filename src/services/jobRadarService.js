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
import http from 'node:http';
import https from 'node:https';
import dnsCallbacks from 'node:dns';
import * as cheerio from 'cheerio';
import { DATA_DIR } from '../config/paths.js';
import { enqueueAlert } from './alertQueueService.js';

// Limites de seguridad para la descarga de fuentes HTML (SSRF)
export const MAX_HTML_BYTES = 512 * 1024;
export const TIMEOUT_HTTP_MS = 10000;
export const MAX_REDIRECTS = 3;
const CAMPOS_SENSIBLES = /secret|token|password|passwd|credential|authorization|apikey|api_key|clientsecret|client_id/i;

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
    const config = { ...configDefecto(), ...JSON.parse(raw) };
    config.fuentes = limpiarFuentesSensibles(config.fuentes);
    return config;
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
export function configurarRadar({ palabrasClave = null, ubicacion = null, remoto = null, activo = null, fuentes = null } = {}, deps = {}) {
  if (fuentes !== null) {
    return { ok: false, error: 'Las fuentes del radar solo las edita el propietario en el fichero de configuracion; no se aceptan por chat.' };
  }
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

/**
 * SSRF: una URL de fuente solo es valida si es http(s), sin credenciales
 * incrustadas, con nombre de host publico y sin resolver a IPs privadas,
 * loopback, link-local (metadatos cloud) o reservadas.
 */
function esIpBloqueada(ip) {
  if (ip.includes(':')) {
    const v6 = ip.toLowerCase();
    return v6 === '::1' || v6 === '::' || v6.startsWith('fe80:') || v6.startsWith('fc') || v6.startsWith('fd');
  }
  if (!/^\d+\.\d+\.\d+\.\d+$/.test(ip)) return false; // nombre de host, no IP literal
  const partes = ip.split('.').map(Number);
  if (partes.some((p) => p < 0 || p > 255)) return true;
  const [a, b] = partes;
  return a === 0 || a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168) || (a === 169 && b === 254) || a >= 224;
}

export async function validarUrlFuente(urlStr, deps = {}) {
  if (typeof urlStr !== 'string' || urlStr.length > 2048) {
    return { ok: false, motivo: 'URL ausente o demasiado larga.' };
  }
  let url;
  try {
    url = new URL(urlStr);
  } catch {
    return { ok: false, motivo: 'URL con formato invalido.' };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, motivo: `Esquema no permitido: ${url.protocol}. Solo http/https.` };
  }
  if (url.username || url.password) {
    return { ok: false, motivo: 'La URL no puede llevar credenciales incrustadas.' };
  }
  const host = url.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) {
    return { ok: false, motivo: 'Nombre de host local no permitido.' };
  }
  const hostSinCorchetes = host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host;
  if (esIpBloqueada(hostSinCorchetes)) {
    return { ok: false, motivo: 'IP privada, loopback o reservada no permitida.' };
  }
  // La validacion DNS anti-rebinding ocurre en el lookup del propio socket
  // (crearLookupSeguro): validar antes de resolver por separado seria TOCTOU.
  return { ok: true, url };
}

/**
 * Lookup para el socket: valida las IPs EN la resolucion que la conexion
 * realmente usa. Si alguna es privada/reservada, la conexion ni se abre.
 * Asi no hay ventana TOCTOU entre validar y conectar.
 */
function crearLookupSeguro(deps = {}) {
  const resolver = deps.dnsLookup || ((h, cb) => dnsCallbacks.lookup(h, { all: true }, cb));
  return (hostname, options, callback) => {
    const terminar = (err, addresses) => {
      if (err) { callback(err); return; }
      const lista = (Array.isArray(addresses) ? addresses : [addresses]).filter(Boolean);
      if (lista.length === 0 || lista.some((r) => esIpBloqueada(String(r.address || r)))) {
        callback(new Error('El nombre de host resuelve a una IP privada o reservada.'));
        return;
      }
      callback(null, lista[0].address || lista[0], lista[0].family || 4);
    };
    try {
      const ret = resolver(hostname, terminar);
      if (ret && typeof ret.then === 'function') {
        ret.then((addrs) => terminar(null, addrs), terminar);
      }
    } catch (err) {
      terminar(err);
    }
  };
}

/**
 * Peticion HTTP(S) acotada: lookup validado en el socket, timeout con
 * destruccion de la conexion y cuerpo limitado en streaming.
 */
function peticionSegura(url, deps = {}) {
  return new Promise((resolve, reject) => {
    const maxBytes = deps.maxBytes || MAX_HTML_BYTES;
    const modulo = url.protocol === 'http:' ? http : https;
    const hacerPeticion = deps.requestImpl || ((u, o) => modulo.request(u, o));
    const req = hacerPeticion(url.href, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; DAVIS-job-radar)' },
      lookup: crearLookupSeguro(deps)
    });
    const limpiar = () => clearTimeout(temporizador);
    const temporizador = setTimeout(() => {
      req.destroy(new Error(`Tiempo de espera agotado (${deps.timeoutMs || TIMEOUT_HTTP_MS} ms).`));
    }, deps.timeoutMs || TIMEOUT_HTTP_MS);
    req.on('response', (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400) {
        limpiar();
        res.resume();
        resolve({ statusCode: res.statusCode, headers: res.headers, cuerpo: null });
        return;
      }
      const len = Number(res.headers['content-length']);
      if (len && len > maxBytes) {
        limpiar();
        req.destroy();
        reject(new Error(`Respuesta demasiado grande (${len} bytes).`));
        return;
      }
      const chunks = [];
      let total = 0;
      res.on('data', (c) => {
        total += c.length;
        if (total > maxBytes) {
          limpiar();
          req.destroy();
          reject(new Error(`Respuesta demasiado grande (mas de ${maxBytes} bytes).`));
          return;
        }
        chunks.push(c);
      });
      res.on('end', () => {
        limpiar();
        resolve({ statusCode: res.statusCode, headers: res.headers, cuerpo: Buffer.concat(chunks).toString('utf-8') });
      });
      res.on('error', (err) => { limpiar(); reject(err); });
    });
    req.on('error', (err) => { limpiar(); reject(err); });
    req.end();
  });
}

/**
 * Descarga una fuente HTML con defensas SSRF: validacion de URL y de cada
 * redireccion, DNS sin IPs privadas, tiempo y tamano limitados. El HTML se
 * trata siempre como contenido hostil: solo se extraen texto y hrefs.
 */
export async function fetchHtmlSeguro(urlInicial, deps = {}) {
  let urlActual = urlInicial;
  for (let salto = 0; salto <= MAX_REDIRECTS; salto++) {
    const validacion = await validarUrlFuente(urlActual, deps);
    if (!validacion.ok) {
      throw new Error(`URL rechazada por seguridad: ${validacion.motivo}`);
    }
    const res = await peticionSegura(validacion.url, deps);
    if (res.statusCode >= 300 && res.statusCode < 400) {
      const destino = res.headers && res.headers.location;
      if (!destino) throw new Error(`Redireccion ${res.statusCode} sin destino.`);
      urlActual = new URL(destino, validacion.url.href).href;
      continue;
    }
    if (res.statusCode >= 400) {
      throw new Error(`HTTP ${res.statusCode}`);
    }
    return res.cuerpo;
  }
  throw new Error(`Demasiadas redirecciones (mas de ${MAX_REDIRECTS}).`);
}

function sanitizarTexto(texto, maxLongitud) {
  return String(texto || '')
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLongitud);
}

/** Campos sensibles jamas se leen ni se persisten en la config del radar. */
function limpiarFuentesSensibles(fuentes) {
  if (!Array.isArray(fuentes)) return [];
  return fuentes.map((f) => {
    if (!f || typeof f !== 'object') return f;
    const limpia = {};
    for (const [k, v] of Object.entries(f)) {
      if (CAMPOS_SENSIBLES.test(k)) continue;
      limpia[k] = v;
    }
    return limpia;
  });
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
      detalle: 'Faltan INFOJOBS_CLIENT_ID e INFOJOBS_CLIENT_SECRET. Se crean registrando una aplicacion en developer.infojobs.net.',
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
  const validacion = await validarUrlFuente(fuente.url, deps);
  if (!validacion.ok) {
    return {
      fuente: fuente.id,
      estado: 'error',
      detalle: `URL rechazada por seguridad: ${validacion.motivo}`,
      ofertas: []
    };
  }
  try {
    const html = deps.fetchHtml
      ? await deps.fetchHtml(fuente.url)
      : await fetchHtmlSeguro(fuente.url, deps);
    const $ = cheerio.load(html);
    const ofertas = [];
    $(sel.item).each((_, el) => {
      const titulo = sanitizarTexto($(el).find(sel.titulo).first().text(), 200);
      const href = $(el).find(sel.enlace).first().attr('href');
      if (!titulo || !href) return;
      let url;
      try {
        url = new URL(href, fuente.url);
      } catch {
        return;
      }
      // Solo enlaces http(s) sin credenciales llegan a las alertas
      if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.username || url.password) return;
      const empresa = sel.empresa ? sanitizarTexto($(el).find(sel.empresa).first().text(), 100) : null;
      ofertas.push({ id: idOferta(url.href, titulo), titulo, empresa, ubicacion: null, url: url.href, fuente: fuente.id });
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

/** Una fuente esta lista si tiene credenciales (env) o url+selectores validos. */
export function fuenteLista(fuente, deps = {}) {
  if (!fuente || !fuente.enabled) return false;
  if (fuente.tipo === 'infojobs-api') {
    const env = deps.env || process.env;
    return Boolean(env.INFOJOBS_CLIENT_ID && env.INFOJOBS_CLIENT_SECRET);
  }
  if (fuente.tipo === 'html-generico') {
    const sel = fuente.selectores || {};
    return Boolean(fuente.url && sel.item && sel.titulo && sel.enlace);
  }
  return false;
}

/**
 * Rondas periodicas del radar. Desactivado por defecto: solo arranca si el
 * propietario activo el radar y hay al menos una fuente lista; en cualquier
 * otro caso no hay temporizador ni peticiones en segundo plano. Las alertas
 * salen por la cola existente, que whatsappBot ya drena al chat de David.
 */
export function iniciarMonitorRadar(deps = {}, intervaloMs = INTERVALO_DEFECTO_MS) {
  if (intervaloRadar) return { iniciado: true, mensaje: 'El monitor del radar ya estaba activo.' };
  const config = leerConfigRadar(deps);
  if (!config.activo) {
    return { iniciado: false, motivo: 'Radar desactivado: no se inician rondas en segundo plano.' };
  }
  if (!(config.fuentes || []).some((f) => fuenteLista(f, deps))) {
    return { iniciado: false, motivo: 'Radar activo pero sin fuentes listas (faltan credenciales o selectores).' };
  }
  intervaloRadar = setInterval(() => {
    escanearRadar(deps).catch((err) => console.error('[Radar Empleo] Error en ronda:', err.message));
  }, intervaloMs);
  if (typeof intervaloRadar.unref === 'function') intervaloRadar.unref();
  return { iniciado: true };
}

export function detenerMonitorRadar() {
  if (intervaloRadar) {
    clearInterval(intervaloRadar);
    intervaloRadar = null;
  }
}
