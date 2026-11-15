/**
 * tenancy_api_alta.test.js - Validacion del alta y provisionamiento de Tenants via API y CLI.
 *
 * Strict Policy: Zero Emojis.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { handleApiRequest } from '../../api.js';
import { abrirBaseDatos } from '../../src/adapters/outbound/persistence/sqlite/connection.js';
import { ejecutarMigraciones } from '../../src/adapters/outbound/persistence/sqlite/migraciones.js';
import { crearSqliteTenantRepository } from '../../src/adapters/outbound/persistence/sqlite/sqliteTenantRepository.js';
import { crearSqliteLimitesStore } from '../../src/adapters/outbound/persistence/sqlite/sqliteLimitesStore.js';
import { crearSqliteUsageStore } from '../../src/adapters/outbound/persistence/sqlite/sqliteUsageStore.js';
import { crearTenantQuotaService, PLANES } from '../../src/services/tenantQuotaService.js';

test('CLI / Servicio: alta y provisionamiento de cuenta tenant con plan', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'davis-tenancy-cli-'));
  const rutaDb = path.join(dir, 'test.db');
  const db = abrirBaseDatos(rutaDb);
  ejecutarMigraciones(db);

  try {
    const tenantRepo = crearSqliteTenantRepository(db);
    const limitesStore = crearSqliteLimitesStore(db);
    const usageStore = crearSqliteUsageStore(db);
    const quotaService = crearTenantQuotaService({ limitesStore, usageStore });

    // Registro
    const t = tenantRepo.registrarTenant({ id: 'empresa_alfa', nombre: 'Alfa Corp', rol: 'usuario' });
    assert.equal(t.id, 'empresa_alfa');
    assert.equal(t.estado, 'activo');

    // Asignacion de plan
    quotaService.asignarPlan('empresa_alfa', 'cliente');
    const plan = quotaService.obtenerPlan('empresa_alfa');
    assert.equal(plan.id, 'cliente');
    assert.equal(plan.tokensDia, 100_000);
    assert.equal(plan.peticionesMinuto, 15);

    // Vinculacion de identidad
    tenantRepo.vincularIdentidad('empresa_alfa', 'whatsapp', '34600111222@s.whatsapp.net');
    assert.equal(tenantRepo.buscar('whatsapp', '34600111222@s.whatsapp.net'), 'empresa_alfa');
  } finally {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('HTTP /api/tenants: endpoint de creacion y consulta de tenants', async () => {
  process.env.API_TOKEN = 'test_token_secret_456';
  const server = http.createServer(handleApiRequest);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const puerto = server.address().port;

  try {
    // 1. Crear tenant via POST
    const payload = JSON.stringify({
      id: 'tenant_test_api',
      nombre: 'Empresa Test API',
      plan: 'staff',
      canal: 'whatsapp',
      identificador: '34699887766'
    });

    const resPost = await fetch(`http://127.0.0.1:${puerto}/api/tenants`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer test_token_secret_456'
      },
      body: payload
    });

    assert.equal(resPost.status, 201);
    const dataPost = await resPost.json();
    assert.equal(dataPost.ok, true);
    assert.equal(dataPost.tenant.id, 'tenant_test_api');
    assert.equal(dataPost.tenant.plan, 'staff');

    // 2. Consultar tenant via GET
    const resGet = await fetch(`http://127.0.0.1:${puerto}/api/tenants?id=tenant_test_api`, {
      headers: {
        'Authorization': 'Bearer test_token_secret_456'
      }
    });
    assert.equal(resGet.status, 200);
    const dataGet = await resGet.json();
    assert.equal(dataGet.ok, true);
    assert.equal(dataGet.tenant.id, 'tenant_test_api');
    assert.equal(dataGet.tenant.nombre, 'Empresa Test API');
  } finally {
    delete process.env.API_TOKEN;
    await new Promise((resolve) => server.close(resolve));
  }
});
