import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { provisionarTenant, provisionarEstructuraArchivosTenant } from '../../src/services/tenantProvisioningService.js';
import { abrirBaseDatos } from '../../src/adapters/outbound/persistence/sqlite/connection.js';
import { ejecutarMigraciones } from '../../src/adapters/outbound/persistence/sqlite/migraciones.js';
import { crearSqliteTenantRepository } from '../../src/adapters/outbound/persistence/sqlite/sqliteTenantRepository.js';
import { crearSqliteLimitesStore } from '../../src/adapters/outbound/persistence/sqlite/sqliteLimitesStore.js';
import { crearSqliteUsageStore } from '../../src/adapters/outbound/persistence/sqlite/sqliteUsageStore.js';
import { crearTenantQuotaService } from '../../src/services/tenantQuotaService.js';

test('Provisioning de Tenant y Aislamiento de Second Brain', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'davis-tenants-test-'));
  const dbPath = path.join(tmpDir, 'test_jarvis.db');
  const db = abrirBaseDatos(dbPath);
  ejecutarMigraciones(db);

  const tenantRepo = crearSqliteTenantRepository(db);
  const limitesStore = crearSqliteLimitesStore(db);
  const usageStore = crearSqliteUsageStore(db);
  const quotaService = crearTenantQuotaService({ limitesStore, usageStore });

  // 1. Aprovisionar Tenant A (Clinica Dental)
  const resA = await provisionarTenant({
    id: 'clinica_dental_alpha',
    nombre: 'Clinica Dental Alpha',
    plan: 'cliente',
    canal: 'whatsapp',
    identificador: '34611223344'
  }, {
    tenantRepository: tenantRepo,
    quotaService,
    dataDir: tmpDir
  });

  assert.equal(resA.ok, true);
  assert.equal(resA.tenantId, 'clinica_dental_alpha');
  assert.equal(resA.plan, 'cliente');
  assert.equal(resA.qdrantColeccion, 'davis_memorias_clinica_dental_alpha');
  assert.equal(resA.identificadorVinculado, '34611223344@s.whatsapp.net');

  // Verificar estructura de archivos de Tenant A
  const raizA = path.join(tmpDir, 'tenants', 'clinica_dental_alpha');
  assert.equal(fs.existsSync(raizA), true);
  assert.equal(fs.existsSync(path.join(raizA, 'notes', 'bienvenida.md')), true);
  assert.equal(fs.existsSync(path.join(raizA, 'brain_memory.json')), true);

  const bienvenidaTextoA = fs.readFileSync(path.join(raizA, 'notes', 'bienvenida.md'), 'utf8');
  assert.match(bienvenidaTextoA, /Clinica Dental Alpha/);

  // 2. Aprovisionar Tenant B (Taller Mecanico)
  const resB = await provisionarTenant({
    id: 'taller_mecanico_beta',
    nombre: 'Taller Mecanico Beta',
    plan: 'demo',
    canal: 'whatsapp',
    identificador: '+34 622 334 455'
  }, {
    tenantRepository: tenantRepo,
    quotaService,
    dataDir: tmpDir
  });

  assert.equal(resB.ok, true);
  assert.equal(resB.tenantId, 'taller_mecanico_beta');
  assert.equal(resB.identificadorVinculado, '34622334455@s.whatsapp.net');

  const raizB = path.join(tmpDir, 'tenants', 'taller_mecanico_beta');
  assert.equal(fs.existsSync(raizB), true);
  assert.notEqual(raizA, raizB);

  // 3. Escribir una nota privada en Tenant A
  const notaPrivadaA = path.join(raizA, 'notes', 'paciente_secreto.md');
  fs.writeFileSync(notaPrivadaA, '# Paciente confidencial\nHistoria clinica 1234.', 'utf8');

  // Verificar que Tenant B no tiene esa nota
  assert.equal(fs.existsSync(path.join(raizB, 'notes', 'paciente_secreto.md')), false);

  // 4. Verificar resolucion de identidades en el repositorio
  const lookupA = tenantRepo.buscar('whatsapp', '34611223344@s.whatsapp.net');
  assert.equal(lookupA, 'clinica_dental_alpha');

  const lookupB = tenantRepo.buscar('whatsapp', '34622334455@s.whatsapp.net');
  assert.equal(lookupB, 'taller_mecanico_beta');

  // 5. Verificar aislamiento en permisos RBAC
  const permisosA = tenantRepo.leerPermisos('clinica_dental_alpha');
  assert.equal(permisosA.includes('consultar_disponibilidad'), true);
  assert.equal(permisosA.includes('reservar_cita'), true);
  assert.equal(permisosA.includes('execute_bash_command'), false);
  assert.equal(permisosA.includes('get_infrastructure_status'), false);

  // Limpieza
  db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});
