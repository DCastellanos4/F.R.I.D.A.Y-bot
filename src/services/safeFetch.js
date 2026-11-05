/**
 * safeFetch.js - Apertura segura de URLs externas (anti-SSRF).
 *
 * Cualquier URL que llega de un mensaje o de una respuesta de herramienta es
 * hostil hasta demostrar lo contrario: puede apuntar a la red interna del
 * servidor (169.254.169.254, localhost, 192.168...) o gastar trucos de
 * redireccion. Esta envoltura:
 *   - solo permite http(s), sin credenciales en la URL y puertos 80/443;
 *   - resuelve el host y rechaza IPs privadas/loopback/reservadas
 *     (limitacion conocida: TOCTOU entre esta comprobacion y la resolucion
 *     interna de fetch; mitigada revalidando cada salto de redireccion);
 *   - sigue redirecciones a mano (max 3) revalidando cada destino;
 *   - corta por tiempo (8s por defecto) y por tamano (1,5 MB).
 *
 * Nunca sustituye el juicio sobre el CONTENIDO: eso es del adaptador.
 *
 * Strict Policy: Zero Emojis.
 */
import dns from 'node:dns/promises';
import net from 'node:net';

export function esIpPrivadaOReservada(ip) {
  if (net.isIPv4(ip)) {
    const p = ip.split('.').map(Number);
    if (p[0] === 0 || p[0] === 10 || p[0] === 127 || p[0] >= 224) return true;
    if (p[0] === 100 && p[1] >= 64 && p[1] <= 127) return true;
    if (p[0] === 169 && p[1] === 254) return true;
    if (p[0] === 172 && p[1] >= 16 && p[1] <= 31) return true;
    if (p[0] === 192 && p[1] === 168) return true;
    if (p[0] === 192 && p[1] === 0) return true;
    if (p[0] === 192 && p[1] === 0 && p[2] === 2) return true;
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
  return true; // formato desconocido: prudente
}

/**
 * Abre una URL de forma segura. Devuelve { ok, status, text } compatible con
 * el subconjunto de fetch que usan los adaptadores. Lanza Error con motivo
 * legible cuando el destino no es seguro o la respuesta no sirve.
 */
export async function fetchSeguro(url, opciones = {}, deps = {}) {
  const { timeoutMs = 8000, maxBytes = 1500000, maxRedirects = 3, headers = {} } = opciones;
  const lookup = deps.lookup || ((host) => dns.lookup(host, { all: true }));
  const fetchFn = deps.fetchFn || globalThis.fetch;
  if (typeof fetchFn !== 'function') throw new Error('Sin fetch disponible');

  let actual = String(url || '');
  for (let salto = 0; salto <= maxRedirects; salto++) {
    let u;
    try { u = new URL(actual); } catch { throw new Error('URL no valida'); }
    if (!/^https?:$/.test(u.protocol)) throw new Error('Solo abro enlaces http(s)');
    if (u.username || u.password) throw new Error('No abro URLs con credenciales incrustadas');
    const puerto = u.port || (u.protocol === 'https:' ? '443' : '80');
    if (!['80', '443'].includes(puerto)) throw new Error(`Puerto no permitido (${puerto})`);
    const resueltas = await lookup(u.hostname);
    const lista = Array.isArray(resueltas) ? resueltas : [resueltas];
    if (!lista.length) throw new Error(`El dominio ${u.hostname} no resuelve`);
    for (const r of lista) {
      if (esIpPrivadaOReservada(r.address)) throw new Error('Destino interno o reservado: no lo abro');
    }

    const ctrl = new AbortController();
    const temporizador = setTimeout(() => ctrl.abort(), timeoutMs);
    let resp;
    try {
      resp = await fetchFn(actual, {
        redirect: 'manual',
        signal: ctrl.signal,
        headers: {
          'user-agent': 'Mozilla/5.0 (compatible; DAVIS-bot/1.0; +verificacion-de-ofertas)',
          accept: 'text/html,application/xhtml+xml,application/json',
          ...headers
        }
      });
    } catch (err) {
      throw new Error(err.name === 'AbortError' ? 'La pagina tardo demasiado en responder' : `No pude abrir la pagina: ${err.message}`);
    } finally {
      clearTimeout(temporizador);
    }

    if ([301, 302, 303, 307, 308].includes(resp.status)) {
      const destino = resp.headers && typeof resp.headers.get === 'function' ? resp.headers.get('location') : null;
      if (!destino) throw new Error('Redireccion sin destino: no la sigo');
      actual = new URL(destino, actual).toString();
      continue;
    }

    const declarada = resp.headers && typeof resp.headers.get === 'function' ? Number(resp.headers.get('content-length') || 0) : 0;
    if (declarada > maxBytes) throw new Error('La respuesta es demasiado grande: no la proceso');

    let texto;
    if (resp.body && typeof resp.body[Symbol.asyncIterator] === 'function') {
      const trozos = [];
      let total = 0;
      for await (const trozo of resp.body) {
        total += trozo.length;
        if (total > maxBytes) throw new Error('La respuesta es demasiado grande: no la proceso');
        trozos.push(trozo);
      }
      texto = Buffer.concat(trozos).toString('utf8');
    } else if (typeof resp.text === 'function') {
      texto = await resp.text();
      if (typeof texto === 'string' && texto.length > maxBytes) throw new Error('La respuesta es demasiado grande: no la proceso');
    } else {
      throw new Error('Respuesta sin cuerpo legible');
    }
    return { ok: resp.ok, status: resp.status, text: async () => texto };
  }
  throw new Error('Demasiadas redirecciones: no la sigo');
}
