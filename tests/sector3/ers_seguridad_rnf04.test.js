/**
 * RNF-04 (ERS proximo nivel): anonimizacion PII pre-LLM con restauracion
 * acotada, y registro de auditoria de herramientas con cadena SHA256.
 *
 * Strict Policy: Zero Emojis.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { abrirBaseDatos } from '../../src/adapters/outbound/persistence/sqlite/connection.js';
import { ejecutarMigraciones } from '../../src/adapters/outbound/persistence/sqlite/migraciones.js';
import { crearPiiAnonymizer } from '../../src/security/piiAnonymizerService.js';
import { crearAuditLogService } from '../../src/security/auditLogService.js';

function crearDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'davis-rnf04-'));
  const db = abrirBaseDatos(path.join(dir, 'jarvis.db'));
  ejecutarMigraciones(db);
  return db;
}

// IBAN ES valido de documentacion publica (ejemplo estandar de pruebas).
const IBAN_OK = 'ES91 2100 0418 4502 0005 1332';
const DNI_OK = '12345678Z'; // letra valida por mod-23
const TARJETA_OK = '4111 1111 1111 1111'; // Luhn valido (pan de pruebas)

test('PII: enmascara IBAN, DNI, tarjeta, telefono y email; restauracion exacta', () => {
  const pii = crearPiiAnonymizer();
  const texto = `Paga al IBAN ${IBAN_OK}, mi DNI es ${DNI_OK}, tarjeta ${TARJETA_OK}, tel 612 34 56 78 y correo ana@example.com`;
  const { texto: anon, mapa, detecciones } = pii.anonimizar(texto);
  assert.equal(detecciones, 5);
  for (const original of [IBAN_OK, DNI_OK, TARJETA_OK, '612 34 56 78', 'ana@example.com']) {
    assert.ok(!anon.includes(original), `quedo sin enmascarar: ${original}`);
  }
  assert.match(anon, /\[PII_IBAN_1\]/);
  assert.match(anon, /\[PII_DNI_1\]/);
  const restaurado = pii.restaurar(anon, mapa);
  assert.equal(restaurado, texto, 'la restauracion devuelve el texto original');
});

test('PII: no enmascara falsos positivos (checksums invalidos)', () => {
  const pii = crearPiiAnonymizer();
  const texto = 'pedido 12345678A importe 4111 1111 1111 1112 iban ES00 0000 0000 0000 0000 0000';
  const { detecciones } = pii.anonimizar(texto);
  assert.equal(detecciones, 0, 'DNI con letra mala, tarjeta sin Luhn e IBAN sin mod97 no se enmascaran');
});

test('PII: lista blanca respeta identificadores autorizados', () => {
  const pii = crearPiiAnonymizer();
  const autorizado = '612 34 56 78';
  const { texto, detecciones } = pii.anonimizar(`llama al ${autorizado}`, { permitir: [autorizado] });
  assert.equal(detecciones, 0);
  assert.ok(texto.includes(autorizado), 'el telefono autorizado sigue disponible para la herramienta');
});

test('PII: token desconocido no se inventa al restaurar', () => {
  const pii = crearPiiAnonymizer();
  assert.equal(pii.restaurar('envia a [PII_TELEFONO_9]', {}), 'envia a [PII_TELEFONO_9]');
});

test('auditoria: cadena encadenada verificable y deteccion de manipulacion', () => {
  const db = crearDb();
  const audit = crearAuditLogService(db);
  const h1 = audit.registrar({ herramienta: 'registrar_gasto', args: { importe: 4.5, comercio: 'cafe' }, respuesta: { ok: true } });
  const h2 = audit.registrar({ herramienta: 'crear_recordatorio', args: { texto: 'dentista' } });
  assert.notEqual(h1, h2);
  let r = audit.verificarCadena();
  assert.equal(r.ok, true);
  assert.equal(r.filasVerificadas, 2);

  // Manipulacion directa de una fila pasada: la verificacion la detecta.
  db.prepare("UPDATE audit_herramientas SET herramienta = 'borrar_todo' WHERE id = 1").run();
  r = audit.verificarCadena();
  assert.equal(r.ok, false);
  assert.equal(r.primerError.id, 1);
  assert.equal(r.primerError.causa, 'contenido alterado');
  db.close();
});

test('auditoria: no persiste argumentos ni respuestas, solo hashes', () => {
  const db = crearDb();
  const audit = crearAuditLogService(db);
  audit.registrar({ herramienta: 'registrar_gasto', args: { notas: 'secreto-medico' }, respuesta: { dato: 'sensible-x' } });
  const fila = db.prepare('SELECT * FROM audit_herramientas').get();
  const crudo = JSON.stringify(fila);
  assert.ok(!crudo.includes('secreto-medico') && !crudo.includes('sensible-x'));
  assert.match(fila.args_sha256, /^[0-9a-f]{64}$/);
  assert.match(fila.hash, /^[0-9a-f]{64}$/);
  db.close();
});
