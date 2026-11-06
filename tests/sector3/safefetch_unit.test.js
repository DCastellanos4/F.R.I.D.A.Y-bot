/**
 * safefetch_unit.test.js
 * Pruebas unitarias de la apertura segura de URLs (anti-SSRF). La defensa
 * clave es que la IP se valida EN EL LOOKUP DEL PROPIO SOCKET (no antes ni
 * despues): estas pruebas capturan el lookup que recibe la capa de red y
 * verifican que la conexion ni se abre con IP privada. Si alguien revierte
 * a "validar y luego resolver por separado" (TOCTOU), fallan.
 *
 * Strict Policy: Zero Emojis.
 */
import '../sector2/setup_aislamiento.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { fetchSeguro, esIpPrivadaOReservada, validarUrlExterna } from '../../src/services/safeFetch.js';

function reqFalso(handler) {
  return (u, o) => {
    const req = new EventEmitter();
    req.destroy = (err) => { if (err) process.nextTick(() => req.emit('error', err)); };
    req.end = () => handler(u, o, req);
    return req;
  };
}

function resFalsa(req, status, headers = {}, cuerpo = null) {
  const res = new EventEmitter();
  res.statusCode = status;
  res.headers = headers;
  res.resume = () => {};
  process.nextTick(() => {
    req.emit('response', res);
    if (cuerpo != null) process.nextTick(() => { res.emit('data', Buffer.from(cuerpo)); res.emit('end'); });
    else process.nextTick(() => res.emit('end'));
  });
}

test('clasifica IPs privadas y reservadas', () => {
  for (const ip of ['10.0.0.5', '192.168.1.1', '127.0.0.1', '169.254.169.254', '172.16.0.1', '::1', 'fd00::1', 'fe80::1', '0.0.0.0', '224.0.0.1']) {
    assert.equal(esIpPrivadaOReservada(ip), true, ip);
  }
  for (const ip of ['93.184.216.34', '8.8.8.8', '2606:4700:4700::1111']) {
    assert.equal(esIpPrivadaOReservada(ip), false, ip);
  }
});

test('rechaza esquemas no-http, credenciales, puertos raros, hosts locales e IP literal privada', async () => {
  await assert.rejects(fetchSeguro('file:///etc/passwd'), /http\(s\)/);
  await assert.rejects(fetchSeguro('ftp://ejemplo.com/x'), /http\(s\)/);
  await assert.rejects(fetchSeguro('https://user:pass@tienda.example/p'), /credenciales/);
  await assert.rejects(fetchSeguro('https://tienda.example:8080/p'), /Puerto/);
  await assert.rejects(fetchSeguro('http://localhost:80/admin'), /local/);
  await assert.rejects(fetchSeguro('http://169.254.169.254/latest/meta-data'), /privada|reservada/);
  assert.equal(validarUrlExterna('https://tienda.example/p').ok, true);
});

test('la IP se valida EN el lookup del propio socket: con IP privada la conexion ni se abre', async () => {
  let lookupDelSocket = null;
  let peticionAbierta = false;
  const requestImpl = reqFalso(async (u, o, req) => {
    lookupDelSocket = o.lookup;
    peticionAbierta = true; // el codigo de conexion se alcanzo, pero el lookup debe cortar
    o.lookup(u ? new URL(u).hostname : 'metadata.interno', {}, (err) => {
      if (err) { req.emit('error', err); return; }
      resFalsa(req, 200, {}, 'no deberia llegar');
    });
  });
  const dnsInterno = (h, cb) => cb(null, [{ address: '169.254.169.254', family: 4 }]);
  await assert.rejects(
    fetchSeguro('https://metadata.interno/latest', {}, { dnsLookup: dnsInterno, requestImpl }),
    /privada o reservada/
  );
  assert.equal(typeof lookupDelSocket, 'function', 'la capa de red recibio un lookup propio (validacion ligada al socket)');
  assert.equal(peticionAbierta, true);
});

test('con IP publica el lookup del socket deja pasar y se lee el cuerpo', async () => {
  const requestImpl = reqFalso((u, o, req) => {
    o.lookup(new URL(u).hostname, {}, (err) => {
      if (err) { req.emit('error', err); return; }
      resFalsa(req, 200, {}, '<html>ficha</html>');
    });
  });
  const dnsPublico = (h, cb) => cb(null, [{ address: '93.184.216.34', family: 4 }]);
  const r = await fetchSeguro('https://tienda.example/p/1', {}, { dnsLookup: dnsPublico, requestImpl });
  assert.equal(r.ok, true);
  assert.equal(await r.text(), '<html>ficha</html>');
});

test('sigue una redireccion revalidando el destino y rechaza redirect a red interna', async () => {
  let salto = 0;
  const dnsPublico = (h, cb) => cb(null, [{ address: '93.184.216.34', family: 4 }]);
  const requestImpl = reqFalso((u, o, req) => {
    salto++;
    if (salto === 1) { resFalsa(req, 302, { location: '/final' }); return; }
    resFalsa(req, 200, {}, 'destino-final');
  });
  const r = await fetchSeguro('https://tienda.example/p/1', {}, { dnsLookup: dnsPublico, requestImpl });
  assert.equal(await r.text(), 'destino-final');
  // Redirect a IP literal privada: ni consulta DNS, lo corta la validacion de URL.
  const requestImplMalo = reqFalso((u, o, req) => resFalsa(req, 302, { location: 'http://169.254.169.254/robame' }));
  await assert.rejects(
    fetchSeguro('https://tienda.example/trampa', {}, { dnsLookup: dnsPublico, requestImpl: requestImplMalo }),
    /privada|reservada/
  );
});

test('corta respuestas demasiado grandes (content-length y cuerpo real)', async () => {
  const dnsPublico = (h, cb) => cb(null, [{ address: '93.184.216.34', family: 4 }]);
  await assert.rejects(
    fetchSeguro('https://tienda.example/big', { maxBytes: 1000 }, {
      dnsLookup: dnsPublico,
      requestImpl: reqFalso((u, o, req) => resFalsa(req, 200, { 'content-length': '2000000' }, 'x'))
    }),
    /demasiado grande/
  );
  const grande = 'x'.repeat(2_000_000);
  await assert.rejects(
    fetchSeguro('https://tienda.example/big2', { maxBytes: 1000 }, {
      dnsLookup: dnsPublico,
      requestImpl: reqFalso((u, o, req) => resFalsa(req, 200, {}, grande))
    }),
    /demasiado grande/
  );
});
