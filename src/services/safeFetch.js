/**
 * safeFetch.js - Apertura segura de URLs externas (anti-SSRF).
 *
 * Cualquier URL que llega de un mensaje o de una respuesta de herramienta es
 * hostil hasta demostrar lo contrario. Defensas:
 *   - solo http(s), sin credenciales incrustadas, puertos 80/443, sin hosts
 *     locales ni IP literal privada/reservada;
 *   - validacion DNS EN EL LOOKUP DEL PROPIO SOCKET (patron de
 *     jobRadarService): la IP se rechaza en la resolucion que la conexion
 *     realmente usa - no hay ventana TOCTOU entre validar y conectar;
 *   - redirecciones seguidas a mano (max 3), cada destino revalidado;
 *   - timeout con destruccion de la conexion y cuerpo limitado en streaming.
 *
 * El contenido devuelto sigue siendo hostil: interpretarlo es del adaptador.
 *
 * Strict Policy: Zero Emojis.
 */
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { lookup as dnsLookupCallbacks } from 'node:dns';

const TIMEOUT_DEFECTO_MS = 8000;
const MAX_BYTES_DEFECTO = 1500000;
const MAX_REDIRECTS_DEFECTO = 3;

export function esIpPrivadaOReservada(ip) {
  if (net.isIPv4(ip)) {
    const p = ip.split('.').map(Number);
    if (p[0] === 0 || p[0] === 10 || p[0] === 127 || p[0] >= 224) return true;
    if (p[0] === 100 && p[1] >= 64 && p[1] <= 127) return true;
    if (p[0] === 169 && p[1] === 254) return true;
    if (p[0] === 172 && p[1] >= 16 && p[1] <= 31) return true;
    if (p[0] === 192 && p[1] === 168) return true;
    if (p[0] === 192 && p[1] === 0) return true;
    if (p[0] === 198 && (p[1] === 18 || p[1] === 19)) return true;
    if (p[0] === 198 && p[1] === 51 && p[2] === 100) return true;
    if (p[0] === 203 && p[1] === 0 && p[2] === 113) return true;
    return false;
  }
  if (net.isIPv6(ip)) {
    const b = ip.toLowerCase();
    if (b === '::1' || b === '::') return true;
    if (b.startsWith('::ffff:')) {
      const v4 = b.slice(7);
      return net.isIPv4(v4) ? esIpPrivadaOReservada(v4) : true;
    }
    if (b.startsWith('fc') || b.startsWith('fd')) return true;
    if (/^fe[89ab]/.test(b)) return true;
    if (b.startsWith('2001:db8')) return true;
    return false;
  }
  return false; // no es una IP literal: es un nombre de host, lo valida el lookup del socket
}

export function validarUrlExterna(urlStr) {
  if (typeof urlStr !== 'string' || !urlStr || urlStr.length > 2048) {
    return { ok: false, motivo: 'URL ausente o demasiado larga.' };
  }
  let url;
  try { url = new URL(urlStr); } catch { return { ok: false, motivo: 'URL no valida.' }; }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, motivo: `Esquema no permitido (${url.protocol}); solo http(s).` };
  }
  if (url.username || url.password) {
    return { ok: false, motivo: 'No abro URLs con credenciales incrustadas.' };
  }
  const puerto = url.port || (url.protocol === 'https:' ? '443' : '80');
  if (!['80', '443'].includes(puerto)) {
    return { ok: false, motivo: `Puerto no permitido (${puerto}); solo 80/443.` };
  }
  const host = url.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) {
    return { ok: false, motivo: 'Nombre de host local no permitido.' };
  }
  const hostSinCorchetes = host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host;
  if (net.isIP(hostSinCorchetes) && esIpPrivadaOReservada(hostSinCorchetes)) {
    return { ok: false, motivo: 'IP privada, loopback o reservada no permitida.' };
  }
  return { ok: true, url };
}

/**
 * Lookup para el socket: valida las IPs EN la resolucion que la conexion
 * realmente usa. Si alguna es privada/reservada, la conexion ni se abre.
 */
export function crearLookupSeguro(deps = {}) {
  const resolver = deps.dnsLookup || ((h, cb) => dnsLookupCallbacks(h, { all: true }, cb));
  return (hostname, options, callback) => {
    const terminar = (err, addresses) => {
      if (err) { callback(err); return; }
      const lista = (Array.isArray(addresses) ? addresses : [addresses]).filter(Boolean);
      if (lista.length === 0 || lista.some((r) => esIpPrivadaOReservada(String(r.address || r)))) {
        callback(new Error('El nombre de host resuelve a una IP privada o reservada.'));
        return;
      }
      callback(null, lista[0].address || lista[0], lista[0].family || 4);
    };
    try {
      const ret = resolver(hostname, terminar);
      if (ret && typeof ret.then === 'function') ret.then((addrs) => terminar(null, addrs), terminar);
    } catch (err) {
      terminar(err);
    }
  };
}

function peticionSegura(url, opciones, deps) {
  return new Promise((resolve, reject) => {
    const maxBytes = opciones.maxBytes || MAX_BYTES_DEFECTO;
    const modulo = url.protocol === 'http:' ? http : https;
    const hacerPeticion = deps.requestImpl || ((u, o) => modulo.request(u, o));
    const req = hacerPeticion(url.href, {
      headers: {
        'user-agent': 'Mozilla/5.0 (compatible; DAVIS-bot/1.0; +verificacion-de-ofertas)',
        accept: 'text/html,application/xhtml+xml,application/json',
        ...(opciones.headers || {})
      },
      lookup: crearLookupSeguro(deps)
    });
    const limpiar = () => clearTimeout(temporizador);
    const temporizador = setTimeout(() => {
      req.destroy(new Error(`La pagina tardo demasiado en responder (${opciones.timeoutMs || TIMEOUT_DEFECTO_MS} ms).`));
    }, opciones.timeoutMs || TIMEOUT_DEFECTO_MS);
    req.on('response', (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400) {
        limpiar();
        res.resume();
        resolve({ status: res.statusCode, headers: res.headers, texto: null });
        return;
      }
      const declarada = Number(res.headers && res.headers['content-length']);
      if (declarada && declarada > maxBytes) {
        limpiar();
        req.destroy();
        reject(new Error('La respuesta es demasiado grande: no la proceso.'));
        return;
      }
      const trozos = [];
      let total = 0;
      res.on('data', (c) => {
        total += c.length;
        if (total > maxBytes) {
          limpiar();
          req.destroy();
          reject(new Error('La respuesta es demasiado grande: no la proceso.'));
          return;
        }
        trozos.push(c);
      });
      res.on('end', () => {
        limpiar();
        resolve({ status: res.statusCode, headers: res.headers, texto: Buffer.concat(trozos).toString('utf8') });
      });
      res.on('error', (err) => { limpiar(); reject(err); });
    });
    req.on('error', (err) => { limpiar(); reject(err); });
    req.end();
  });
}

/**
 * Abre una URL de forma segura. Devuelve { ok, status, text } (subconjunto
 * de fetch que usan los adaptadores). Lanza Error con motivo legible cuando
 * el destino no es seguro o la respuesta no sirve.
 * deps de prueba: { dnsLookup, requestImpl }.
 */
export async function fetchSeguro(urlInicial, opciones = {}, deps = {}) {
  const maxRedirects = opciones.maxRedirects ?? MAX_REDIRECTS_DEFECTO;
  let actual = String(urlInicial || '');
  for (let salto = 0; salto <= maxRedirects; salto++) {
    const validacion = validarUrlExterna(actual);
    if (!validacion.ok) throw new Error(validacion.motivo);
    const res = await peticionSegura(validacion.url, opciones, deps);
    if (res.status >= 300 && res.status < 400) {
      const destino = res.headers && (res.headers.location || (typeof res.headers.get === 'function' ? res.headers.get('location') : null));
      if (!destino) throw new Error('Redireccion sin destino: no la sigo.');
      actual = new URL(destino, validacion.url.href).href;
      continue;
    }
    if (res.status >= 400) {
      return { ok: false, status: res.status, text: async () => '' };
    }
    return { ok: res.status >= 200 && res.status < 300, status: res.status, text: async () => res.texto };
  }
  throw new Error('Demasiadas redirecciones: no la sigo.');
}
