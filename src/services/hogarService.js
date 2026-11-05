/**
 * hogarService.js - Bloque 14 de las 50: servidor y hogar.
 *
 * nº 18 Wake-on-LAN: paquete magico UDP real a la MAC configurada por
 *       entorno (DAVIS_WOL_MAC, opcional DAVIS_WOL_BROADCAST). Sin MAC:
 *       config-required, nunca inventada.
 * nº 19 Monitor de red: lee la tabla de vecinos (ip neigh / arp) DEL
 *       EQUIPO DONDE CORRE EL BOT y la declara como tal (si el bot esta en
 *       el VPS, es la LAN del VPS, no la de casa). Aviso de desconocidos
 *       solo con opt-in.
 * nº 20 Domotica: Home Assistant (DAVIS_HA_URL + DAVIS_HA_TOKEN por
 *       entorno). La URL la configura el propietario (red local), no llega
 *       por chat: por eso se permite IP privada AQUI y solo aqui. Tapo/Tuya
 *       directos: no implementados, la via es HA.
 * nº 21 Panel de descargas: qBittorrent Web API (DAVIS_QBIT_URL/USER/PASS
 *       por entorno) + espacio en disco local (df) operativo ya. Aviso al
 *       terminar: solo con opt-in.
 * nº 22 Termometro Oracle: estimacion real via OCI CLI/Cost API:
 *       config-required (credenciales OCI en el servidor); sin ellas lo
 *       dice y no inventa cifras.
 *
 * Strict Policy: Zero Emojis.
 */
import fs from 'node:fs';
import path from 'node:path';
import dgram from 'node:dgram';
import { execFile } from 'node:child_process';
import { enqueueAlert } from './alertQueueService.js';

const DATA_DIR = process.env.DAVIS_DATA_DIR || path.join(process.cwd(), 'data');
export const ARCHIVO_CONFIG_HOGAR_DEFECTO = path.join(DATA_DIR, 'hogar_config.json');

function leerConfigHogar(deps = {}) {
  const ruta = deps.rutaConfig || ARCHIVO_CONFIG_HOGAR_DEFECTO;
  let cfg = {};
  try { cfg = JSON.parse(fs.readFileSync(ruta, 'utf8')); } catch { cfg = {}; }
  return {
    vigilanciaRed: { activo: false, conocidos: [], ...(cfg.vigilanciaRed || {}) },
    avisoDescargas: { activo: false, referencia: null, ...(cfg.avisoDescargas || {}) }
  };
}

function escribirConfigHogar(cfg, deps = {}) {
  const ruta = deps.rutaConfig || ARCHIVO_CONFIG_HOGAR_DEFECTO;
  fs.mkdirSync(path.dirname(ruta), { recursive: true });
  fs.writeFileSync(ruta, JSON.stringify(cfg, null, 2));
}

/* ------------------------------ nº 18 WoL -------------------------------- */

function construirPaqueteMagico(mac) {
  const limpia = String(mac || '').replace(/[^0-9a-fA-F]/g, '');
  if (limpia.length !== 12) return null;
  const macBuf = Buffer.from(limpia, 'hex');
  const paquete = Buffer.alloc(102);
  paquete.fill(0xff, 0, 6);
  for (let i = 0; i < 16; i++) macBuf.copy(paquete, 6 + i * 6);
  return paquete;
}

export function encenderPc(deps = {}) {
  const mac = deps.mac || process.env.DAVIS_WOL_MAC;
  if (!mac) {
    return Promise.resolve({ ok: false, configRequired: true, error: 'Wake-on-LAN necesita la MAC de tu PC en DAVIS_WOL_MAC (entorno del servidor, no por chat) y que el PC tenga WoL activado en BIOS/Windows.' });
  }
  const paquete = construirPaqueteMagico(mac);
  if (!paquete) return Promise.resolve({ ok: false, error: 'La MAC configurada no tiene formato valido.' });
  const broadcast = deps.broadcast || process.env.DAVIS_WOL_BROADCAST || '255.255.255.255';
  const enviarUdp = deps.enviarUdp || ((pkt, destino) => new Promise((resolve, reject) => {
    const sock = dgram.createSocket('udp4');
    sock.once('error', reject);
    sock.bind(() => {
      sock.setBroadcast(true);
      sock.send(pkt, 9, destino, (err) => {
        sock.close();
        if (err) reject(err);
        else resolve();
      });
    });
  }));
  return enviarUdp(paquete, broadcast).then(
    () => ({ ok: true, nota: `Paquete magico enviado a ${mac} via ${broadcast}. El PC tarda 1-2 min en estar listo; WoL solo funciona si esta activado en el PC y el bot llega a su red.` }),
    (err) => ({ ok: false, error: `No he podido enviar el paquete WoL: ${err.message}` })
  );
}

/* --------------------------- nº 19 monitor de red ------------------------ */

function ejecutar(comando, args, deps) {
  if (typeof deps.execComando === 'function') return deps.execComando(comando, args);
  return new Promise((resolve) => {
    execFile(comando, args, { timeout: 15000, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({ ok: !err, salida: stdout || '', error: err ? (stderr || err.message) : null });
    });
  });
}

function parsearVecinos(salida) {
  // ip neigh: "192.168.1.34 dev eth0 lladdr aa:bb:cc:dd:ee:ff REACHABLE"
  const dispositivos = [];
  for (const linea of String(salida || '').split('\n')) {
    const m = linea.match(/^(\S+)\s+dev\s+\S+\s+lladdr\s+([0-9a-f:]{17})\s+(\w+)/i);
    if (m) dispositivos.push({ ip: m[1], mac: m[2].toLowerCase(), estado: m[3] });
  }
  return dispositivos;
}

export async function listarDispositivosRed(deps = {}) {
  let r = await ejecutar('ip', ['neigh', 'show'], deps);
  if (!r.ok || !r.salida.trim()) {
    const r2 = await ejecutar('arp', ['-a'], deps);
    if (!r2.ok) return { ok: false, error: 'Ni "ip neigh" ni "arp" estan disponibles en este equipo.' };
    r = { ok: true, salida: r2.salida.replace(/[()]/g, ' ').replace(/\? \(([^)]+)\)/g, '$1') };
  }
  const dispositivos = parsearVecinos(r.salida).filter((d) => d.estado !== 'FAILED');
  const cfg = leerConfigHogar(deps);
  const conocidos = new Set(cfg.vigilanciaRed.conocidos);
  return {
    ok: true,
    dispositivos,
    desconocidos: conocidos.size ? dispositivos.filter((d) => !conocidos.has(d.mac)) : [],
    alcance: 'Vecinos del equipo donde corre el bot (su propia LAN). Si el bot esta en el VPS, esto NO es la red de casa: para vigilar la de casa haria falta un equipo alli (por ejemplo la Raspberry/PC) ejecutando esto.'
  };
}

export function configurarVigilanciaRed({ activo, conocidos } = {}, deps = {}) {
  const cfg = leerConfigHogar(deps);
  if (typeof activo === 'boolean') cfg.vigilanciaRed.activo = activo;
  if (Array.isArray(conocidos)) cfg.vigilanciaRed.conocidos = conocidos.map((m) => String(m).toLowerCase().replace(/[^0-9a-f:]/g, '')).filter((m) => m.length === 17);
  escribirConfigHogar(cfg, deps);
  return { ok: true, activo: cfg.vigilanciaRed.activo, conocidos: cfg.vigilanciaRed.conocidos.length };
}

export async function comprobarRedProgramado(deps = {}) {
  const cfg = leerConfigHogar(deps);
  if (!cfg.vigilanciaRed.activo) return { ok: true, avisos: 0, motivo: 'Vigilancia de red desactivada (falta opt-in).' };
  const r = await listarDispositivosRed(deps);
  if (!r.ok) return { ok: false, error: r.error };
  if (!r.desconocidos.length) return { ok: true, avisos: 0 };
  const encolar = typeof deps.enqueue === 'function' ? deps.enqueue : (a) => enqueueAlert(a, deps.alertQueueOptions || {});
  encolar({
    title: `${r.desconocidos.length} dispositivo(s) desconocido(s) en la red`,
    body: r.desconocidos.map((d) => `${d.ip} (${d.mac})`).join(', ') + '. Si son tuyos, dime "marca como conocidos los dispositivos de mi red" con sus MAC.'
  });
  return { ok: true, avisos: 1 };
}

/* ----------------------------- nº 20 domotica ---------------------------- */

export async function controlarDomotica({ entidad, accion } = {}, deps = {}) {
  const base = deps.haUrl || process.env.DAVIS_HA_URL;
  const token = deps.haToken || process.env.DAVIS_HA_TOKEN;
  if (!base || !token) {
    return { ok: false, configRequired: true, error: 'La domotica va por Home Assistant: faltan DAVIS_HA_URL y DAVIS_HA_TOKEN (token de larga duracion) en el entorno del servidor, nunca por chat. Tapo/Tuya directos no estan implementados; HA es la via.' };
  }
  const e = String(entidad || '').trim();
  if (!/^[a-z_]+\.[a-z0-9_]+$/i.test(e)) return { ok: false, error: 'Dime la entidad de Home Assistant (por ejemplo: light.salon o switch.enchufe_terraza).' };
  const dominio = e.split('.')[0].toLowerCase();
  const accionesPorDominio = { light: ['on', 'off', 'toggle'], switch: ['on', 'off', 'toggle'], fan: ['on', 'off', 'toggle'] };
  if (!accionesPorDominio[dominio]) return { ok: false, error: `Dominio "${dominio}" no soportado (light, switch o fan).` };
  const a = String(accion || '').toLowerCase();
  if (!accionesPorDominio[dominio].includes(a)) return { ok: false, error: 'Accion no valida: on, off o toggle.' };
  const fetchFn = deps.fetchFn || globalThis.fetch;
  try {
    const resp = await fetchFn(`${String(base).replace(/\/$/, '')}/api/services/${dominio}/turn_${a === 'toggle' ? 'toggle' : a}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ entity_id: e })
    });
    if (!resp.ok) return { ok: false, error: `Home Assistant respondio ${resp.status}; no he podido ${a === 'on' ? 'encender' : a === 'off' ? 'apagar' : 'conmutar'} ${e}.` };
    return { ok: true, entidad: e, accion: a, nota: 'Orden enviada a tu Home Assistant.' };
  } catch (err) {
    return { ok: false, error: `No llego a Home Assistant: ${err.message}` };
  }
}

/* -------------------------- nº 21 panel descargas ------------------------ */

export async function estadoDescargas(deps = {}) {
  // Espacio en disco: siempre operativo (local).
  const df = await ejecutar('df', ['-h', deps.rutaDisco || '/'], deps);
  let disco = null;
  const linea = String(df.salida || '').split('\n')[1];
  if (df.ok && linea) {
    const partes = linea.trim().split(/\s+/);
    disco = { total: partes[1], usado: partes[2], libre: partes[3], porcentaje: partes[4] };
  }
  const url = deps.qbitUrl || process.env.DAVIS_QBIT_URL;
  if (!url) {
    return { ok: true, disco, qbit: null, nota: 'qBittorrent no configurado (DAVIS_QBIT_URL/USER/PASS por entorno): solo veo el espacio en disco de este equipo.' };
  }
  const fetchFn = deps.fetchFn || globalThis.fetch;
  try {
    const login = await fetchFn(`${url}/api/v2/auth/login`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: `username=${encodeURIComponent(deps.qbitUser || process.env.DAVIS_QBIT_USER || '')}&password=${encodeURIComponent(deps.qbitPass || process.env.DAVIS_QBIT_PASS || '')}` });
    const cookie = login.headers.get('set-cookie') || '';
    if (!login.ok && login.status !== 200) return { ok: true, disco, qbit: null, nota: `qBittorrent no admite el login (${login.status}).` };
    const resp = await fetchFn(`${url}/api/v2/torrents/info`, { headers: { cookie } });
    if (!resp.ok) return { ok: true, disco, qbit: null, nota: `qBittorrent respondio ${resp.status} al listar torrents.` };
    const lista = JSON.parse(await resp.text());
    return {
      ok: true,
      disco,
      qbit: lista.map((t) => ({ nombre: String(t.name || '').slice(0, 80), progreso: Math.round((t.progress || 0) * 100), estado: t.state, velocidadBajada: t.dlspeed, restantes: t.amount_left }))
    };
  } catch (err) {
    return { ok: true, disco, qbit: null, nota: `No llego a qBittorrent: ${err.message}` };
  }
}

export function configurarAvisoDescargas({ activo } = {}, deps = {}) {
  const cfg = leerConfigHogar(deps);
  cfg.avisoDescargas.activo = Boolean(activo);
  if (cfg.avisoDescargas.activo) cfg.avisoDescargas.referencia = 'pendiente-primera-lectura';
  escribirConfigHogar(cfg, deps);
  return { ok: true, activo: cfg.avisoDescargas.activo };
}

export async function comprobarDescargasProgramado(deps = {}) {
  const cfg = leerConfigHogar(deps);
  if (!cfg.avisoDescargas.activo) return { ok: true, avisos: 0, motivo: 'Aviso de descargas desactivado (falta opt-in).' };
  const r = await estadoDescargas(deps);
  if (!r.qbit) return { ok: true, avisos: 0, motivo: 'qBittorrent no disponible en este ciclo.' };
  const actuales = r.qbit.map((t) => t.nombre);
  if (!Array.isArray(cfg.avisoDescargas.referencia)) {
    cfg.avisoDescargas.referencia = actuales;
    escribirConfigHogar(cfg, deps);
    return { ok: true, avisos: 0, motivo: 'Referencia inicial guardada.' };
  }
  const terminadas = cfg.avisoDescargas.referencia.filter((n) => !actuales.includes(n));
  const completadas = r.qbit.filter((t) => t.progreso === 100 && !cfg.avisoDescargas.referencia.includes(t.nombre));
  cfg.avisoDescargas.referencia = actuales;
  escribirConfigHogar(cfg, deps);
  const avisar = [...new Set([...terminadas, ...completadas.map((t) => t.nombre)])];
  if (!avisar.length) return { ok: true, avisos: 0 };
  const encolar = typeof deps.enqueue === 'function' ? deps.enqueue : (a) => enqueueAlert(a, deps.alertQueueOptions || {});
  encolar({ title: 'Descarga(s) terminada(s)', body: avisar.join('\n') });
  return { ok: true, avisos: 1 };
}

/* --------------------------- nº 22 factura Oracle ------------------------ */

export async function estimarFacturaOracle(deps = {}) {
  const execOci = deps.execComando;
  if (typeof execOci === 'function') {
    const r = await execOci('oci', ['ce', 'cost-summary', 'request']);
    if (r.ok && r.salida) return { ok: true, estimacion: r.salida.trim(), nota: 'Salida de la OCI CLI del servidor.' };
  }
  if (!process.env.DAVIS_OCI_CONFIGURADO) {
    return { ok: false, configRequired: true, error: 'El termometro de la factura necesita la OCI CLI configurada en el servidor (oci setup config, con su clave API; nunca por chat). Sin ella no invento cifras. OJO: con recursos Always Free la factura suele ser 0 EUR; las sorpresas vienen de superar esos limites.' };
  }
  return { ok: false, configRequired: true, error: 'OCI marcada como configurada pero la CLI no responde aqui; revisa "oci ce cost-summary" en el servidor.' };
}

/* --------------------------- monitor integrado --------------------------- */

let temporizadorHogar = null;

/**
 * Monitor de hogar: cada intervalo comprueba la red y las descargas. Cada
 * comprobacion se auto-protege con su flag de opt-in: sin activacion
 * textual del propietario, no escanea nada ni envia avisos.
 */
export function iniciarMonitorHogar(deps = {}) {
  if (temporizadorHogar) return { iniciado: true, mensaje: 'El monitor de hogar ya estaba activo.' };
  temporizadorHogar = setInterval(() => {
    for (const fn of [comprobarRedProgramado, comprobarDescargasProgramado]) {
      Promise.resolve()
        .then(() => fn(deps))
        .catch((err) => console.error('[Hogar] Error en comprobacion:', err.message));
    }
  }, deps.intervaloMs || Number(process.env.DAVIS_HOGAR_INTERVALO_MS) || 3600000);
  if (typeof temporizadorHogar.unref === 'function') temporizadorHogar.unref();
  return { iniciado: true };
}

export function detenerMonitorHogar() {
  if (temporizadorHogar) {
    clearInterval(temporizadorHogar);
    temporizadorHogar = null;
  }
  return { ok: true };
}
