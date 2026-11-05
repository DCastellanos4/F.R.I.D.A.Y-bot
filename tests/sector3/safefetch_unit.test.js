/**
 * safefetch_unit.test.js
 * Pruebas unitarias de la apertura segura de URLs (anti-SSRF) que usan los
 * adaptadores de compras. DNS y fetch siempre inyectados: nada de red real.
 *
 * Strict Policy: Zero Emojis.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchSeguro, esIpPrivadaOReservada } from '../../src/services/safeFetch.js';

const lookupPublico = async () => [{ address: '93.184.216.34', family: 4 }];

function respuestaConCuerpo(texto, extra = {}) {
  const bytes = Buffer.from(texto, 'utf8');
  const body = new ReadableStream({
    start(c) { c.enqueue(bytes); c.close(); }
  });
  return { ok: true, status: 200, headers: new Headers(), body, ...extra };
}

test('clasifica IPs privadas y reservadas', () => {
  for (const ip of ['10.0.0.5', '192.168.1.1', '127.0.0.1', '169.254.169.254', '172.16.0.1', '::1', 'fd00::1', 'fe80::1', '0.0.0.0', '224.0.0.1']) {
    assert.equal(esIpPrivadaOReservada(ip), true, ip);
  }
  for (const ip of ['93.184.216.34', '8.8.8.8', '2606:4700:4700::1111']) {
    assert.equal(esIpPrivadaOReservada(ip), false, ip);
  }
});

test('rechaza esquemas no-http, credenciales y puertos raros sin tocar DNS', async () => {
  await assert.rejects(fetchSeguro('file:///etc/passwd'), /http\(s\)/);
  await assert.rejects(fetchSeguro('ftp://ejemplo.com/x'), /http\(s\)/);
  await assert.rejects(fetchSeguro('https://user:pass@tienda.example/p'), /credenciales/);
  await assert.rejects(fetchSeguro('https://tienda.example:8080/p'), /Puerto/);
});

test('rechaza destinos que resuelven a red interna', async () => {
  const lookupInterno = async () => [{ address: '169.254.169.254', family: 4 }];
  await assert.rejects(
    fetchSeguro('https://metadata.interno/latest', {}, { lookup: lookupInterno, fetchFn: async () => { throw new Error('no deberia abrir'); } }),
    /interno o reservado/
  );
});

test('sigue una redireccion segura revalidando el destino y lee el cuerpo', async () => {
  const llamadas = [];
  const fetchFalso = async (url) => {
    llamadas.push(url);
    if (llamadas.length === 1) return { ok: false, status: 302, headers: new Headers({ location: '/final' }) };
    return respuestaConCuerpo('<html>ficha</html>');
  };
  const r = await fetchSeguro('https://tienda.example/p/1', {}, { lookup: lookupPublico, fetchFn: fetchFalso });
  assert.equal(r.ok, true);
  assert.equal(await r.text(), '<html>ficha</html>');
  assert.deepEqual(llamadas, ['https://tienda.example/p/1', 'https://tienda.example/final']);
});

test('corta respuestas demasiado grandes (content-length y cuerpo real)', async () => {
  const grande = Buffer.alloc(2_000_000, 65);
  await assert.rejects(
    fetchSeguro('https://tienda.example/big', { maxBytes: 1000 }, {
      lookup: lookupPublico,
      fetchFn: async () => ({ ok: true, status: 200, headers: new Headers({ 'content-length': '2000000' }), body: new ReadableStream({ start(c) { c.enqueue(grande); c.close(); } }) })
    }),
    /demasiado grande/
  );
  await assert.rejects(
    fetchSeguro('https://tienda.example/big2', { maxBytes: 1000 }, {
      lookup: lookupPublico,
      fetchFn: async () => ({ ok: true, status: 200, headers: new Headers(), body: new ReadableStream({ start(c) { c.enqueue(grande); c.close(); } }) })
    }),
    /demasiado grande/
  );
});
