/**
 * Wiring de integracion ERS (RF-02 + RNF-04): la composicion por defecto
 * queda INERTE sin DAVIS_SLM_MODEL, la costura del enrutador especulativo
 * en el clasificador conserva umbral 0.6 y cache, y la auditoria enmascara
 * PII antes del hash.
 *
 * Strict Policy: Zero Emojis.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { crearContenedor } from '../../src/composition/container.js';
import { clasificarIntencionConModelo, limpiarCacheClasificaciones, UMBRAL_CONFIANZA } from '../../src/core/intentRouterService.js';
import { abrirBaseDatos } from '../../src/adapters/outbound/persistence/sqlite/connection.js';
import { ejecutarMigraciones } from '../../src/adapters/outbound/persistence/sqlite/migraciones.js';
import { crearAuditLogService, canonizar } from '../../src/security/auditLogService.js';

test('contenedor por defecto: sin DAVIS_SLM_MODEL no hay enrutador (inerte)', () => {
  const anterior = process.env.DAVIS_SLM_MODEL;
  delete process.env.DAVIS_SLM_MODEL;
  try {
    const c = crearContenedor({ memoryRepository: null });
    assert.equal(c.enrutadorInferencia, null, 'sin modelo configurado el bloque queda deshabilitado');
  } finally {
    if (anterior !== undefined) process.env.DAVIS_SLM_MODEL = anterior;
  }
});

test('costura RF-02: el enrutador inyectado clasifica, conserva 0.6 y cachea', async () => {
  limpiarCacheClasificaciones();
  let llamadasRouter = 0;
  const enrutadorInferencia = {
    async clasificarIntencion(mensaje, etiquetas, ctx) {
      llamadasRouter += 1;
      assert.ok(Array.isArray(etiquetas) && etiquetas.length > 0);
      return { intencion: 'conversacion', confianza: 0.9, via: 'local_slm' };
    }
  };
  const chatCompletion = async () => { throw new Error('la via directa no debe usarse con router'); };
  const r1 = await clasificarIntencionConModelo('hola, que tal', { chatCompletion, enrutadorInferencia });
  assert.equal(r1.origen, 'local_slm');
  assert.equal(r1.intencion, 'conversacion');
  assert.equal(llamadasRouter, 1);
  const r2 = await clasificarIntencionConModelo('hola, que tal', { chatCompletion, enrutadorInferencia });
  assert.equal(r2.origen, 'cache', 'la cache por mensaje normalizado se conserva');
  assert.equal(llamadasRouter, 1, 'la segunda clasificacion no vuelve al router');
});

test('costura RF-02: confianza baja del router no inyecta herramientas (umbral 0.6)', async () => {
  limpiarCacheClasificaciones();
  const enrutadorInferencia = {
    async clasificarIntencion() { return { intencion: 'finanzas', confianza: UMBRAL_CONFIANZA - 0.01, via: 'cloud' }; }
  };
  const r = await clasificarIntencionConModelo('gasto raro ambiguo', { chatCompletion: async () => ({}), enrutadorInferencia });
  assert.equal(r.intencion, 'finanzas');
  assert.deepEqual(r.herramientas, [], 'por debajo de 0.6 no se inyectan herramientas');
});

test('costura RF-02: si el router falla se cae a la via directa historica', async () => {
  limpiarCacheClasificaciones();
  const enrutadorInferencia = { async clasificarIntencion() { throw new Error('slm caido'); } };
  const chatCompletion = async () => ({ message: { content: '{"intencion":"conversacion","confianza":0.9}' } });
  const r = await clasificarIntencionConModelo('otro mensaje de prueba', { chatCompletion, enrutadorInferencia });
  assert.equal(r.intencion, 'conversacion');
  assert.equal(r.origen, 'modelo');
});

test('auditoria: el hash de args con PII no es reversible por diccionario', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'davis-audit-pii-'));
  const db = abrirBaseDatos(path.join(dir, 'jarvis.db'));
  ejecutarMigraciones(db);
  const audit = crearAuditLogService(db);
  const telefono = '612 34 56 78';
  audit.registrar({ herramienta: 'crear_recordatorio', args: { telefono, texto: 'dentista' } });
  const fila = db.prepare('SELECT * FROM audit_herramientas').get();
  const hashIngenuo = crypto.createHash('sha256').update(canonizar({ telefono, texto: 'dentista' }), 'utf8').digest('hex');
  assert.notEqual(fila.args_sha256, hashIngenuo, 'el hash no se calculo sobre el telefono en claro');
  assert.equal(audit.verificarCadena().ok, true);
  db.close();
});

test('contenedor por defecto: sin QDRANT_URL no hay buscador hibrido (inerte)', () => {
  const anterior = process.env.QDRANT_URL;
  delete process.env.QDRANT_URL;
  try {
    const c = crearContenedor({ memoryRepository: null });
    assert.equal(c.buscadorHibrido, null, 'sin Qdrant la busqueda sigue el camino historico');
  } finally {
    if (anterior !== undefined) process.env.QDRANT_URL = anterior;
  }
});
