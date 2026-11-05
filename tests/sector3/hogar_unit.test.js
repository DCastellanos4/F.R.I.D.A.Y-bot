/**
 * hogar_unit.test.js
 * Unitaria del bloque 14 (hogar, nº 18-22). Todas las dependencias se
 * inyectan: NADA de paquetes WoL reales, escaneos, llamadas a HA/qbit
 * ni a OCI. Las acciones de hogar solo corren contra deps falsas.
 *
 * Strict Policy: Zero Emojis.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'os';
import {
  encenderPc, listarDispositivosRed, configurarVigilanciaRed, comprobarRedProgramado,
  controlarDomotica, estadoDescargas, configurarAvisoDescargas, comprobarDescargasProgramado,
  estimarFacturaOracle, iniciarMonitorHogar, detenerMonitorHogar
} from '../../src/services/hogarService.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'davis-hogar-unit-'));
const rutaConfig = path.join(tmp, 'hogar_config.json');

test('nº18 WoL: sin MAC config-required; paquete magico 102 bytes con 16xMAC; envio solo via dep inyectada', async () => {
  const macAntes = process.env.DAVIS_WOL_MAC;
  delete process.env.DAVIS_WOL_MAC;
  const sin = await encenderPc({});
  assert.equal(sin.ok, false);
  assert.equal(sin.configRequired, true);
  assert.match(sin.error, /DAVIS_WOL_MAC/);
  assert.match(sin.error, /no por chat/);

  const mala = await encenderPc({ mac: 'zz-zz' });
  assert.equal(mala.ok, false);
  assert.match(mala.error, /formato/);

  const capturado = {};
  const r = await encenderPc({ mac: 'AA:BB:CC:DD:EE:FF', broadcast: '192.168.1.255', enviarUdp: async (pkt, destino) => { capturado.pkt = pkt; capturado.destino = destino; } });
  assert.equal(r.ok, true);
  assert.equal(capturado.destino, '192.168.1.255');
  assert.equal(capturado.pkt.length, 102);
  assert.ok(capturado.pkt.subarray(0, 6).equals(Buffer.alloc(6, 0xff)), 'cabecera FFx6');
  const macBuf = Buffer.from('aabbccddeeff', 'hex');
  for (let i = 0; i < 16; i++) assert.ok(capturado.pkt.subarray(6 + i * 6, 12 + i * 6).equals(macBuf), `repeticion ${i}`);
  if (macAntes !== undefined) process.env.DAVIS_WOL_MAC = macAntes;
});

test('nº19 red: parsea ip neigh, descarta FAILED, marca desconocidos y declara el alcance LAN-del-host', async () => {
  const salida = '192.168.1.1 dev eth0 lladdr aa:aa:aa:aa:aa:aa REACHABLE\n192.168.1.34 dev eth0 lladdr bb:bb:bb:bb:bb:bb STALE\n192.168.1.99 dev eth0  FAILED\n';
  configurarVigilanciaRed({ activo: false, conocidos: ['aa:aa:aa:aa:aa:aa'] }, { rutaConfig });
  const r = await listarDispositivosRed({ rutaConfig, execComando: async (cmd, args) => {
    assert.equal(cmd, 'ip');
    return { ok: true, salida };
  } });
  assert.equal(r.ok, true);
  assert.equal(r.dispositivos.length, 2, 'FAILED fuera');
  assert.deepEqual(r.desconocidos.map((d) => d.mac), ['bb:bb:bb:bb:bb:bb']);
  assert.match(r.alcance, /equipo donde corre el bot/);
  assert.match(r.alcance, /NO es la red de casa/);
});

test('nº19 vigilancia: sin opt-in no escanea (execComando jamas se llama); con opt-in avisa de desconocidos', async () => {
  configurarVigilanciaRed({ activo: false }, { rutaConfig });
  let llamadas = 0;
  const apagada = await comprobarRedProgramado({ rutaConfig, execComando: async () => { llamadas++; return { ok: true, salida: '' }; } });
  assert.equal(apagada.avisos, 0);
  assert.equal(llamadas, 0, 'sin opt-in no hay escaneo');

  configurarVigilanciaRed({ activo: true, conocidos: ['aa:aa:aa:aa:aa:aa', 'basura', 'xx:xx'] }, { rutaConfig });
  const cfg = JSON.parse(fs.readFileSync(rutaConfig, 'utf8'));
  assert.deepEqual(cfg.vigilanciaRed.conocidos, ['aa:aa:aa:aa:aa:aa'], 'MACs invalidas filtradas');
  const salida = '192.168.1.7 dev eth0 lladdr cc:cc:cc:cc:cc:cc REACHABLE\n';
  const encoladas = [];
  const r = await comprobarRedProgramado({ rutaConfig, execComando: async () => ({ ok: true, salida }), enqueue: (a) => encoladas.push(a) });
  assert.equal(r.avisos, 1);
  assert.match(encoladas[0].body, /cc:cc:cc:cc:cc:cc/);
});

test('nº20 domotica: config-required sin env; valida entidad/dominio; POST a la URL configurada con bearer; nunca URL por chat', async () => {
  const urlAntes = process.env.DAVIS_HA_URL;
  const tokAntes = process.env.DAVIS_HA_TOKEN;
  delete process.env.DAVIS_HA_URL;
  delete process.env.DAVIS_HA_TOKEN;
  const sin = await controlarDomotica({ entidad: 'light.salon', accion: 'on' }, {});
  assert.equal(sin.ok, false);
  assert.equal(sin.configRequired, true);
  assert.match(sin.error, /nunca por chat/);

  const mala = await controlarDomotica({ entidad: 'http://evil.example/x', accion: 'on' }, { haUrl: 'http://192.168.1.10:8123', haToken: 't' });
  assert.equal(mala.ok, false);
  const dom = await controlarDomotica({ entidad: 'camera.porcion', accion: 'on' }, { haUrl: 'http://192.168.1.10:8123', haToken: 't' });
  assert.match(dom.error, /no soportado/);

  const peticion = {};
  const fetchFalso = async (url, opts) => { peticion.url = url; peticion.opts = opts; return { ok: true, status: 200 }; };
  const r = await controlarDomotica({ entidad: 'light.salon', accion: 'toggle' }, { haUrl: 'http://192.168.1.10:8123/', haToken: 'TOKEN-LARGO', fetchFn: fetchFalso });
  assert.equal(r.ok, true);
  assert.equal(peticion.url, 'http://192.168.1.10:8123/api/services/light/turn_toggle');
  assert.equal(peticion.opts.headers.authorization, 'Bearer TOKEN-LARGO');
  assert.deepEqual(JSON.parse(peticion.opts.body), { entity_id: 'light.salon' });
  if (urlAntes !== undefined) process.env.DAVIS_HA_URL = urlAntes;
  if (tokAntes !== undefined) process.env.DAVIS_HA_TOKEN = tokAntes;
});

test('nº21 descargas: disco local operativo sin qbit; con qbit mapea torrents; aviso solo con opt-in y al terminar', async () => {
  const qAntes = process.env.DAVIS_QBIT_URL;
  delete process.env.DAVIS_QBIT_URL;
  const soloDisco = await estadoDescargas({ execComando: async () => ({ ok: true, salida: 'Filesystem Size Used Avail Use% Mounted on\n/dev/sda1 40G 12G 28G 30% /\n' }) });
  assert.equal(soloDisco.ok, true);
  assert.equal(soloDisco.disco.libre, '28G');
  assert.equal(soloDisco.qbit, null);
  assert.match(soloDisco.nota, /no configurado/);

  const fetchQbit = async (url) => url.includes('auth/login')
    ? { ok: true, status: 200, headers: { get: () => 'SID=x' } }
    : { ok: true, status: 200, text: async () => JSON.stringify([{ name: 'ubuntu.iso', progress: 1, state: 'uploading', dlspeed: 0, amount_left: 0 }]) };
  const conQ = await estadoDescargas({ qbitUrl: 'http://192.168.1.20:8080', qbitUser: 'u', qbitPass: 'p', fetchFn: fetchQbit, execComando: async () => ({ ok: true, salida: 'h\n/dev/sda1 40G 12G 28G 30% /\n' }) });
  assert.equal(conQ.qbit[0].progreso, 100);

  // Opt-in y ciclo de aviso
  const cfgRuta = path.join(tmp, 'hogar_desc.json');
  configurarAvisoDescargas({ activo: false }, { rutaConfig: cfgRuta });
  const apagado = await comprobarDescargasProgramado({ rutaConfig: cfgRuta, qbitUrl: 'http://x', fetchFn: fetchQbit });
  assert.equal(apagado.avisos, 0);
  configurarAvisoDescargas({ activo: true }, { rutaConfig: cfgRuta });
  const primera = await comprobarDescargasProgramado({ rutaConfig: cfgRuta, qbitUrl: 'http://x', fetchFn: fetchQbit, execComando: async () => ({ ok: true, salida: 'h\n/dev/sda1 40G 12G 28G 30% /\n' }) });
  assert.equal(primera.avisos, 0, 'primera lectura: referencia');
  const fetchVacia = async (url) => url.includes('auth/login')
    ? { ok: true, status: 200, headers: { get: () => 'SID=x' } }
    : { ok: true, status: 200, text: async () => '[]' };
  const encoladas = [];
  const segunda = await comprobarDescargasProgramado({ rutaConfig: cfgRuta, qbitUrl: 'http://x', fetchFn: fetchVacia, execComando: async () => ({ ok: true, salida: 'h\n/dev/sda1 40G 12G 28G 30% /\n' }), enqueue: (a) => encoladas.push(a) });
  assert.equal(segunda.avisos, 1);
  assert.match(encoladas[0].body, /ubuntu\.iso/);
  if (qAntes !== undefined) process.env.DAVIS_QBIT_URL = qAntes;
});

test('nº22 Oracle: config-required sin OCI y declara Always Free; con exec inyectado devuelve la salida', async () => {
  const antes = process.env.DAVIS_OCI_CONFIGURADO;
  delete process.env.DAVIS_OCI_CONFIGURADO;
  const sin = await estimarFacturaOracle({});
  assert.equal(sin.ok, false);
  assert.equal(sin.configRequired, true);
  assert.match(sin.error, /nunca por chat/);
  assert.match(sin.error, /Always Free/);
  const con = await estimarFacturaOracle({ execComando: async (cmd) => { assert.equal(cmd, 'oci'); return { ok: true, salida: '0.00 EUR' }; } });
  assert.equal(con.ok, true);
  assert.match(con.estimacion, /0\.00/);
  if (antes !== undefined) process.env.DAVIS_OCI_CONFIGURADO = antes;
});

test('monitor hogar: arranca y para; las comprobaciones se autoprotegen sin opt-in', () => {
  const r = iniciarMonitorHogar({ intervaloMs: 3600000, rutaConfig });
  assert.equal(r.iniciado, true);
  const otra = iniciarMonitorHogar({});
  assert.match(otra.mensaje, /ya estaba/);
  detenerMonitorHogar();
});
