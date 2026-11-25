/**
 * tenancy_produccion_fallos.test.js - Dos fallos observados en el servidor real.
 *
 * 1. DATA_DIR canonico: en produccion <release>/data es un ENLACE SIMBOLICO
 *    al estado persistente y la defensa de tenantFileSystem (raiz canonica,
 *    anti-symlink) rechazaba toda lectura/escritura de tenant. paths.js debe
 *    canonicalizar DATA_DIR para que guardia y rutas sean coherentes SIN
 *    relajar la guardia. Este test apunta DAVIS_DATA_DIR a un symlink y
 *    verifica que una escritura+lectura JSON de tenant funciona.
 *    (Sin imports estaticos del proyecto: el entorno se fija antes de
 *    importar, como hace el arranque real.)
 *
 * 2. Caducidad de la medicion pendiente: una peticion interrumpida dejaba
 *    un ticket en tenant_medicion_pendiente y el tenant quedaba bloqueado
 *    para siempre. Un ticket mas viejo que el TTL no deniega y se limpia;
 *    uno reciente sigue denegando (fail-closed).
 *
 * Strict Policy: Zero Emojis.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { abrirBaseDatos } from '../../src/adapters/outbound/persistence/sqlite/connection.js';
import { ejecutarMigraciones } from '../../src/adapters/outbound/persistence/sqlite/migraciones.js';
import { crearSqliteLimitesStore } from '../../src/adapters/outbound/persistence/sqlite/sqliteLimitesStore.js';

test('DATA_DIR canonico: escritura y lectura de memoria de tenant via symlink', async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'davis-symlink-'));
  const real = path.join(base, 'estado', 'data');
  fs.mkdirSync(path.join(real, 'tenants', 't1'), { recursive: true });
  const enlace = path.join(base, 'release-data');
  fs.symlinkSync(real, enlace);

  const previa = process.env.DAVIS_DATA_DIR;
  process.env.DAVIS_DATA_DIR = enlace;
  try {
    const sufijo = `?t=${Date.now()}`;
    const paths = await import(`../../src/config/paths.js${sufijo}`);
    assert.equal(paths.DATA_DIR, fs.realpathSync(enlace));

    const memoria = await import(`../../src/services/memoryService.js${sufijo}`);
    const rutaTenant = path.join(paths.DATA_DIR, 'tenants', 't1', 'brain_memory.json');
    const r = memoria.guardarMemoria({ sujeto: 'nota tenant', dato: 'via enlace', rutaArchivo: rutaTenant });
    assert.equal(r.ok, true);
    assert.equal(memoria.listarMemorias(null, { rutaArchivo: rutaTenant }).length, 1);
  } finally {
    if (previa === undefined) delete process.env.DAVIS_DATA_DIR;
    else process.env.DAVIS_DATA_DIR = previa;
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test('medicion pendiente: ticket caducado no bloquea y se limpia; reciente deniega', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'davis-ttl-'));
  const db = abrirBaseDatos(path.join(dir, 'l.db'));
  ejecutarMigraciones(db);
  const store = crearSqliteLimitesStore(db);
  const tenantId = 'tenant_ttl';
  db.prepare('INSERT INTO tenants (id, nombre, rol, estado, creado_en) VALUES (?, ?, ?, ?, ?)')
    .run(tenantId, 'Tenant TTL', 'usuario', 'activo', new Date().toISOString());
  store.configurar(tenantId, { tokensDia: 15000, peticionesMinuto: 5 });

  const ahora = new Date('2026-11-22T22:00:00.000Z');
  const viejo = new Date('2026-11-22T21:40:00.000Z').toISOString(); // 20 min: caducado
  db.prepare('INSERT INTO tenant_medicion_pendiente (tenant_id,ticket,iniciada_en) VALUES (?,?,?)')
    .run(tenantId, 'ticket-viejo', viejo);

  const decision = store.autorizar({ tenantId, ahora, consumirPeticion: true });
  assert.equal(decision.permitido, true);
  assert.equal(
    db.prepare('SELECT COUNT(*) AS n FROM tenant_medicion_pendiente WHERE tenant_id = ?').get(tenantId).n,
    0
  );

  const reciente = new Date('2026-11-22T21:59:30.000Z').toISOString(); // 30 s: vigente
  db.prepare('INSERT INTO tenant_medicion_pendiente (tenant_id,ticket,iniciada_en) VALUES (?,?,?)')
    .run(tenantId, 'ticket-reciente', reciente);
  const bloqueada = store.autorizar({ tenantId, ahora, consumirPeticion: true });
  assert.equal(bloqueada.permitido, false);
  assert.equal(bloqueada.motivo, 'medicion_pendiente');
  assert.equal(
    db.prepare('SELECT COUNT(*) AS n FROM tenant_medicion_pendiente WHERE tenant_id = ?').get(tenantId).n,
    1
  );

  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});
