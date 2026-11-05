/**
 * career_block.test.js
 * Pruebas unitarias del bloque 1 del roadmap de 50 funciones:
 * CRM de candidaturas (nº 2) y radar de ofertas (nº 1). Todo con
 * almacenamiento temporal e HTTP/alertas inyectados: sin red ni efectos.
 *
 * Strict Policy: Zero Emojis.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'path';
import os from 'os';

import {
  registrarCandidatura,
  listarCandidaturas,
  actualizarCandidatura,
  resumenCandidaturas,
  pendientesDeSeguimiento
} from '../../src/services/applicationTrackerService.js';
import {
  configurarRadar,
  escanearRadar,
  leerConfigRadar,
  validarUrlFuente,
  fetchHtmlSeguro,
  iniciarMonitorRadar,
  detenerMonitorRadar,
  fuenteLista
} from '../../src/services/jobRadarService.js';

function dirTemporal() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'davis-career-'));
}

function depsCrm(dir) {
  return { rutaArchivo: path.join(dir, 'applications.json') };
}

// DNS publico falso: las pruebas usan dominios inventados; el servicio
// valida resolucion DNS anti-rebinding, asi que se inyecta una IP publica.
const DNS_PUBLICO_FALSO = async () => [{ address: '93.184.216.34' }];

function depsRadar(dir, extra = {}) {
  return {
    rutaConfig: path.join(dir, 'radar.json'),
    rutaVistos: path.join(dir, 'radar_seen.json'),
    dnsLookup: DNS_PUBLICO_FALSO,
    ...extra
  };
}

const HTML_OFERTAS = `
<html><body>
  <div class="oferta"><h2 class="tit">Full Stack Junior</h2><a class="lnk" href="/oferta/123">Ver</a><span class="emp">Acme</span></div>
  <div class="oferta"><h2 class="tit">Backend Node</h2><a class="lnk" href="https://portal.example/jobs/9">Ver</a><span class="emp">Globex</span></div>
  <div class="oferta"><h2 class="tit">Sin enlace</h2></div>
</body></html>`;

const FUENTE_HTML = {
  id: 'portal-pruebas',
  tipo: 'html-generico',
  enabled: true,
  url: 'https://portal.example/jobs?q=fullstack',
  selectores: { item: '.oferta', titulo: '.tit', enlace: '.lnk', empresa: '.emp' }
};

// ---------- CRM ----------

test('CRM: registrar persiste y deduplica activas, permite tras descartar', () => {
  const deps = depsCrm(dirTemporal());
  const r1 = registrarCandidatura({ empresa: 'Acme', puesto: 'Full Stack' }, deps);
  assert.equal(r1.ok, true);
  assert.ok(r1.candidatura.id);
  assert.equal(r1.candidatura.estado, 'registrada');

  const dup = registrarCandidatura({ empresa: ' ACME ', puesto: 'full stack' }, deps);
  assert.equal(dup.ok, false, 'dedupe insensible a mayusculas y espacios');
  assert.equal(dup.existente.id, r1.candidatura.id);

  actualizarCandidatura(r1.candidatura.id, { estado: 'descartada' }, deps);
  const r2 = registrarCandidatura({ empresa: 'Acme', puesto: 'Full Stack' }, deps);
  assert.equal(r2.ok, true, 'tras descartar se puede registrar de nuevo');
  assert.notEqual(r2.candidatura.id, r1.candidatura.id);
});

test('CRM: estado invalido y validaciones de entrada', () => {
  const deps = depsCrm(dirTemporal());
  assert.equal(registrarCandidatura({ empresa: '', puesto: 'X' }, deps).ok, false);
  assert.equal(registrarCandidatura({ empresa: 'Acme' }, deps).ok, false);
  assert.equal(registrarCandidatura({ empresa: 'Acme', puesto: 'X', estado: 'volando' }, deps).ok, false);
});

test('CRM: actualizar por id, por texto, ambiguo y no encontrada', () => {
  const deps = depsCrm(dirTemporal());
  const a = registrarCandidatura({ empresa: 'Acme', puesto: 'Backend' }, deps).candidatura;
  registrarCandidatura({ empresa: 'Acme', puesto: 'Frontend' }, deps);

  const ok = actualizarCandidatura(a.id, { estado: 'entrevista', notas: 'Primera ronda el lunes' }, deps);
  assert.equal(ok.ok, true);
  assert.equal(ok.candidatura.estado, 'entrevista');
  assert.equal(ok.candidatura.historial.length, 2);
  assert.ok(ok.candidatura.notas.includes('Primera ronda'));

  const ambiguo = actualizarCandidatura('acme', { estado: 'oferta' }, deps);
  assert.equal(ambiguo.ok, false);
  assert.equal(ambiguo.coincidencias.length, 2);

  assert.equal(actualizarCandidatura('empresa-inexistente', { estado: 'oferta' }, deps).ok, false);
  assert.equal(actualizarCandidatura(a.id, { estado: 'volando' }, deps).ok, false);
});

test('CRM: listar filtra por estado y resumen cuenta', () => {
  const deps = depsCrm(dirTemporal());
  registrarCandidatura({ empresa: 'Acme', puesto: 'Backend', estado: 'enviada' }, deps);
  registrarCandidatura({ empresa: 'Globex', puesto: 'Data', estado: 'entrevista' }, deps);

  assert.equal(listarCandidaturas({}, deps).length, 2);
  const entrevistas = listarCandidaturas({ estado: 'entrevista' }, deps);
  assert.equal(entrevistas.length, 1);
  assert.equal(entrevistas[0].empresa, 'Globex');

  const resumen = resumenCandidaturas(deps);
  assert.equal(resumen.total, 2);
  assert.equal(resumen.porEstado.enviada, 1);
  assert.equal(resumen.porEstado.entrevista, 1);
});

test('CRM: seguimiento crea recordatorio via inyeccion y detecta procesos dormidos', () => {
  const dir = dirTemporal();
  const deps = depsCrm(dir);
  const recordatorios = [];
  deps.crearRecordatorio = (r) => { recordatorios.push(r); return { ok: true }; };

  const r = registrarCandidatura({ empresa: 'Acme', puesto: 'Backend', seguimientoDias: 5 }, deps);
  assert.equal(r.recordatorio.ok, true);
  assert.equal(recordatorios.length, 1);
  assert.equal(recordatorios[0].minutosEnElFuturo, 5 * 24 * 60);
  assert.ok(recordatorios[0].mensaje.includes('Backend'));

  // Sin movimiento reciente: candidatura "vieja" aparece como pendiente
  const archivo = path.join(dir, 'applications.json');
  const lista = JSON.parse(fs.readFileSync(archivo, 'utf-8'));
  lista[0].actualizadaEn = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
  fs.writeFileSync(archivo, JSON.stringify(lista), 'utf-8');
  const pendientes = pendientesDeSeguimiento({ dias: 5 }, deps);
  assert.equal(pendientes.length, 1);
  actualizarCandidatura(lista[0].id, { estado: 'descartada' }, deps);
  assert.equal(pendientesDeSeguimiento({ dias: 5 }, deps).length, 0, 'descartadas no piden seguimiento');
});

// ---------- Radar ----------

test('Radar: desactivado informa sin escanear', async () => {
  const res = await escanearRadar(depsRadar(dirTemporal()));
  assert.equal(res.ok, true);
  assert.equal(res.escaneado, false);
  assert.match(res.motivo, /desactivado/i);
});

test('Radar: InfoJobs sin credenciales es config-required, nunca simula', async () => {
  const dir = dirTemporal();
  const deps = depsRadar(dir, { env: {} });
  configurarRadar({ activo: true }, deps);
  const res = await escanearRadar(deps);
  assert.equal(res.escaneado, true);
  assert.equal(res.nuevas.length, 0);
  assert.equal(res.fuentes[0].estado, 'config-required');
  assert.match(res.fuentes[0].detalle, /INFOJOBS_CLIENT_ID/);
});

test('Radar: fuente HTML con fetch inyectado, dedupe y alertas en cola', async () => {
  const dir = dirTemporal();
  const alertas = [];
  const deps = depsRadar(dir, {
    fetchHtml: async () => HTML_OFERTAS,
    enqueue: (a) => alertas.push(a)
  });
  // Configuracion con fuente HTML (sin InfoJobs)
  fs.writeFileSync(path.join(dir, 'radar.json'), JSON.stringify({
    activo: true,
    palabrasClave: ['full stack'],
    ubicacion: 'Madrid',
    remoto: null,
    fuentes: [FUENTE_HTML]
  }), 'utf-8');

  const res1 = await escanearRadar(deps);
  assert.equal(res1.escaneado, true);
  assert.equal(res1.nuevas.length, 2, 'la oferta sin enlace se descarta');
  assert.equal(res1.nuevas[0].titulo, 'Full Stack Junior');
  assert.equal(res1.nuevas[0].empresa, 'Acme');
  assert.equal(res1.nuevas[1].url, 'https://portal.example/jobs/9', 'href absoluto se conserva');
  assert.equal(alertas.length, 2, 'una alerta por oferta nueva');
  assert.match(alertas[0].title, /Full Stack Junior/);

  const res2 = await escanearRadar(deps);
  assert.equal(res2.nuevas.length, 0, 'dedupe: lo ya visto no se repite');
  assert.equal(res2.totalEncontradas, 2);
  assert.equal(alertas.length, 2, 'sin alertas duplicadas');
});

test('Radar: configurar valida palabras clave y persiste', () => {
  const deps = depsRadar(dirTemporal());
  assert.equal(configurarRadar({ palabrasClave: [] }, deps).ok, false);
  assert.equal(configurarRadar({ palabrasClave: ['  '] }, deps).ok, false);

  const res = configurarRadar({ palabrasClave: ['full stack', 'cloud'], ubicacion: 'Madrid', remoto: true, activo: true }, deps);
  assert.equal(res.ok, true);
  const cfg = leerConfigRadar(deps);
  assert.deepEqual(cfg.palabrasClave, ['full stack', 'cloud']);
  assert.equal(cfg.activo, true);
  assert.equal(cfg.remoto, true);
  // Reconfigurar solo una cosa no pisa el resto
  configurarRadar({ ubicacion: 'Barcelona' }, deps);
  assert.deepEqual(leerConfigRadar(deps).palabrasClave, ['full stack', 'cloud']);
});

test('Radar: fuente HTML sin selectores completos es config-required', async () => {
  const dir = dirTemporal();
  const deps = depsRadar(dir, { fetchHtml: async () => HTML_OFERTAS });
  fs.writeFileSync(path.join(dir, 'radar.json'), JSON.stringify({
    activo: true,
    palabrasClave: ['x'],
    fuentes: [{ id: 'rota', tipo: 'html-generico', enabled: true, url: 'https://portal.example/jobs' }]
  }), 'utf-8');
  const res = await escanearRadar(deps);
  assert.equal(res.fuentes[0].estado, 'config-required');
  assert.equal(res.nuevas.length, 0);
});

// ---------- Seguridad SSRF y aislamiento (revision previa a publicacion) ----------

test('SSRF: validarUrlFuente rechaza esquemas, credenciales y destinos internos', async () => {
  const rechazadas = [
    'file:///etc/passwd',
    'ftp://portal.example/jobs',
    'javascript:alert(1)',
    'data:text/html,<html></html>',
    'http://localhost/jobs',
    'http://127.0.0.1/jobs',
    'http://[::1]/jobs',
    'http://169.254.169.254/latest/meta-data',
    'http://10.0.0.5/jobs',
    'http://192.168.1.1/jobs',
    'http://172.16.0.9/jobs',
    'http://0.0.0.0/jobs',
    'http://usuario:clave@portal.example/jobs',
    'http://portal.example.internal/jobs',
    'no-es-una-url'
  ];
  for (const url of rechazadas) {
    const res = await validarUrlFuente(url);
    assert.equal(res.ok, false, `debia rechazar: ${url}`);
  }
  const valida = await validarUrlFuente('https://portal.example/jobs?q=node');
  assert.equal(valida.ok, true);
});

// Transporte falso estilo node:http para probar fetchHtmlSeguro sin red
import { EventEmitter } from 'node:events';
function peticionFalsa(respuestas, espia = {}) {
  let llamada = 0;
  return (url, opciones) => {
    espia.urls = espia.urls || [];
    espia.urls.push(url);
    espia.opciones = opciones;
    const req = new EventEmitter();
    req.destroy = (err) => { if (err) req.emit('error', err); };
    req.end = () => {
      const spec = respuestas[Math.min(llamada++, respuestas.length - 1)];
      setImmediate(() => {
        if (spec.error) { req.emit('error', new Error(spec.error)); return; }
        const res = new EventEmitter();
        res.statusCode = spec.statusCode;
        res.headers = spec.headers || {};
        res.resume = () => {};
        req.emit('response', res);
        for (const chunk of spec.chunks || []) res.emit('data', Buffer.from(chunk));
        res.emit('end');
      });
    };
    return req;
  };
}

test('SSRF: el DNS se valida en el propio socket (anti-rebinding sin TOCTOU)', async () => {
  // Con el transporte real, un lookup que devuelve IP privada impide la conexion
  await assert.rejects(
    () => fetchHtmlSeguro('https://portal.example/jobs', { dnsLookup: async () => [{ address: '10.1.2.3', family: 4 }] }),
    /privada|reservada/
  );
  // Y la peticion falsa recibe un lookup de socket, no una resolucion previa separada
  const espia = {};
  const req = peticionFalsa([{ statusCode: 200, headers: {}, chunks: ['<html></html>'] }], espia);
  await fetchHtmlSeguro('https://portal.example/jobs', { requestImpl: req, dnsLookup: DNS_PUBLICO_FALSO });
  assert.equal(typeof espia.opciones.lookup, 'function', 'el socket usa lookup validador');
});

test('SSRF: fetchHtmlSeguro bloquea redireccion a metadatos cloud y limita tamano', async () => {
  const espia = {};
  const reqRedir = peticionFalsa([{ statusCode: 302, headers: { location: 'http://169.254.169.254/latest/meta-data' } }], espia);
  await assert.rejects(
    () => fetchHtmlSeguro('https://portal.example/jobs', { requestImpl: reqRedir, dnsLookup: DNS_PUBLICO_FALSO }),
    /seguridad/
  );
  assert.equal(espia.urls.length, 1, 'la redireccion rechazada nunca se pidio');

  const reqGrande = peticionFalsa([{ statusCode: 200, headers: {}, chunks: [new Array(600 * 1024).join('a')] }]);
  await assert.rejects(
    () => fetchHtmlSeguro('https://portal.example/jobs', { requestImpl: reqGrande, dnsLookup: DNS_PUBLICO_FALSO }),
    /grande/
  );
});

test('SSRF: fetchHtmlSeguro aplica timeout y sigue una redireccion valida', async () => {
  // Timeout: la peticion que nunca responde se destruye
  const reqMuda = () => {
    const req = new EventEmitter();
    req.destroy = (err) => { if (err) req.emit('error', err); };
    req.end = () => {};
    return req;
  };
  await assert.rejects(
    () => fetchHtmlSeguro('https://portal.example/jobs', { requestImpl: reqMuda, dnsLookup: DNS_PUBLICO_FALSO, timeoutMs: 50 }),
    /Tiempo de espera/
  );

  // Redireccion valida: se sigue y se revalida
  const espia = {};
  const reqOk = peticionFalsa([
    { statusCode: 301, headers: { location: '/jobs2' } },
    { statusCode: 200, headers: {}, chunks: ['<html>ok</html>'] }
  ], espia);
  const html = await fetchHtmlSeguro('https://portal.example/jobs', { requestImpl: reqOk, dnsLookup: DNS_PUBLICO_FALSO });
  assert.equal(html, '<html>ok</html>');
  assert.deepEqual(espia.urls, ['https://portal.example/jobs', 'https://portal.example/jobs2']);
});

test('SSRF: escanearRadar no llama a la red si la URL de la fuente es interna', async () => {
  const dir = dirTemporal();
  let llamadasFetch = 0;
  const deps = depsRadar(dir, { fetchHtml: async () => { llamadasFetch++; return HTML_OFERTAS; } });
  fs.writeFileSync(path.join(dir, 'radar.json'), JSON.stringify({
    activo: true,
    palabrasClave: ['x'],
    fuentes: [{ id: 'maliciosa', tipo: 'html-generico', enabled: true, url: 'http://169.254.169.254/latest/meta-data', selectores: { item: '.oferta', titulo: '.tit', enlace: '.lnk' } }]
  }), 'utf-8');
  const res = await escanearRadar(deps);
  assert.equal(llamadasFetch, 0, 'no se descargo nada de la URL interna');
  assert.equal(res.fuentes[0].estado, 'error');
  assert.match(res.fuentes[0].detalle, /seguridad/);
});

test('Credenciales: campos sensibles de la config nunca se leen ni persisten', () => {
  const dir = dirTemporal();
  const deps = depsRadar(dir);
  fs.writeFileSync(path.join(dir, 'radar.json'), JSON.stringify({
    activo: true,
    palabrasClave: ['x'],
    fuentes: [{ id: 'p', tipo: 'html-generico', enabled: true, url: 'https://portal.example/jobs', selectores: { item: '.a', titulo: '.b', enlace: '.c' }, clientSecret: 'NO-DEBE-PERSISTIR', apiKey: 'TAMPOCO' }]
  }), 'utf-8');
  const cfg = leerConfigRadar(deps);
  assert.equal(cfg.fuentes[0].clientSecret, undefined);
  assert.equal(cfg.fuentes[0].apiKey, undefined);
  // Reconfigurar no reescribe los campos sensibles al fichero
  configurarRadar({ ubicacion: 'Madrid' }, deps);
  const crudo = fs.readFileSync(path.join(dir, 'radar.json'), 'utf-8');
  assert.ok(!crudo.includes('NO-DEBE-PERSISTIR'), 'el secreto no debe quedar en el fichero');
  // El chat no puede editar fuentes
  assert.equal(configurarRadar({ fuentes: [] }, deps).ok, false);
});

test('Monitor: desactivado por defecto, solo arranca con fuente lista', () => {
  const dir = dirTemporal();
  const deps = depsRadar(dir);
  let res = iniciarMonitorRadar(deps);
  assert.equal(res.iniciado, false, 'config por defecto desactivada');
  assert.match(res.motivo, /desactivado/i);

  configurarRadar({ activo: true }, deps);
  res = iniciarMonitorRadar(deps, 60 * 60 * 1000);
  assert.equal(res.iniciado, false, 'InfoJobs sin credenciales no basta');
  detenerMonitorRadar();

  fs.writeFileSync(path.join(dir, 'radar.json'), JSON.stringify({
    activo: true,
    palabrasClave: ['x'],
    fuentes: [{ id: 'p', tipo: 'html-generico', enabled: true, url: 'https://portal.example/jobs', selectores: { item: '.a', titulo: '.b', enlace: '.c' } }]
  }), 'utf-8');
  assert.equal(fuenteLista(leerConfigRadar(deps).fuentes[0], deps), true);
  res = iniciarMonitorRadar(deps, 60 * 60 * 1000);
  assert.equal(res.iniciado, true, 'con fuente lista si arranca');
  detenerMonitorRadar();
  const res2 = iniciarMonitorRadar(deps, 60 * 60 * 1000);
  assert.equal(res2.iniciado, true, 'reinicio tras detener');
  detenerMonitorRadar();
});

test('Persistencia: aislamiento entre almacenes y escrituras rapidas consecutivas', () => {
  const dirA = dirTemporal();
  const dirB = dirTemporal();
  const depsA = depsCrm(dirA);
  const depsB = depsCrm(dirB);

  registrarCandidatura({ empresa: 'Acme', puesto: 'Backend' }, depsA);
  assert.equal(listarCandidaturas({}, depsB).length, 0, 'los almacenes no comparten estado');
  assert.equal(listarCandidaturas({}, depsA).length, 1);

  // 50 registros rapidos consecutivos: todos persisten (escritura atomica)
  for (let i = 0; i < 50; i++) {
    registrarCandidatura({ empresa: `Empresa${i}`, puesto: 'Junior' }, depsB);
  }
  assert.equal(listarCandidaturas({}, depsB).length, 50);
  const crudo = JSON.parse(fs.readFileSync(path.join(dirB, 'applications.json'), 'utf-8'));
  assert.equal(crudo.length, 50, 'el fichero no quedo corrupto');

  // Vistos del radar aislados por ruta
  const rA = depsRadar(dirA);
  const rB = depsRadar(dirB);
  for (const d of [rA, rB]) {
    fs.writeFileSync(d.rutaConfig, JSON.stringify({ activo: true, palabrasClave: ['x'], fuentes: [FUENTE_HTML] }), 'utf-8');
  }
  return (async () => {
    await escanearRadar({ ...rA, fetchHtml: async () => HTML_OFERTAS, enqueue: () => {} });
    const resB = await escanearRadar({ ...rB, fetchHtml: async () => HTML_OFERTAS, enqueue: () => {} });
    assert.equal(resB.nuevas.length, 2, 'lo visto en A no afecta a B');
  })();
});
