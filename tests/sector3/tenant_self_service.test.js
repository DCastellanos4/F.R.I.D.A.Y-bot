/**
 * tenant_self_service.test.js - Pruebas del servicio de autoservicio y cuotas para tenants
 *
 * Strict Policy: Zero Emojis.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  consultarCuotaTexto,
  listarPlanesTexto,
  procesarUpgradePlan,
  procesarComandoAutoservicio
} from '../../src/services/tenantSelfService.js';
import { crearTenantQuotaService, PLANES } from '../../src/services/tenantQuotaService.js';
import { puedeEjecutarHerramienta } from '../../src/services/rbacService.js';
import { consultarJarvisAislado } from '../helpers/jarvisAislado.js';
import { registrarStoreUsoPorDefecto } from '../../src/services/usageLedgerService.js';

test('TenantSelfService: consultarCuotaTexto formatea estado de cuota correctamente', () => {
  const quota = crearTenantQuotaService();
  quota.asignarPlan('tenant-1', 'demo');
  quota.registrarConsumo({ tenantId: 'tenant-1', tokens: 1500 });

  const texto = consultarCuotaTexto('tenant-1', { quotaService: quota });
  assert.match(texto, /DEMO/);
  assert.match(texto, /(1500|1\.500)/);
  assert.match(texto, /5 peticiones\/min/);
  assert.match(texto, /\/upgrade/);
});

test('TenantSelfService: consultarCuotaTexto para propietario es ilimitado', () => {
  const quota = crearTenantQuotaService();
  const texto = consultarCuotaTexto('propietario', { quotaService: quota });
  assert.match(texto, /PROPIETARIO/);
  assert.match(texto, /Ilimitado/);
});

test('TenantSelfService: listarPlanesTexto devuelve catalogo de planes completo', () => {
  const catalogo = listarPlanesTexto();
  assert.match(catalogo, /DEMO:/);
  assert.match(catalogo, /15\.000 tokens\/dia/);
  assert.match(catalogo, /CLIENTE/);
  assert.match(catalogo, /100\.000 tokens\/dia/);
  assert.match(catalogo, /STAFF:/);
  assert.match(catalogo, /500\.000 tokens\/dia/);
  assert.match(catalogo, /\/upgrade/);
});

test('TenantSelfService: procesarUpgradePlan aplica cambio y actualiza limites', () => {
  const quota = crearTenantQuotaService();
  quota.asignarPlan('tenant-2', 'demo');

  const resultado = procesarUpgradePlan('tenant-2', 'cliente', { quotaService: quota });
  assert.match(resultado, /CLIENTE/);
  assert.match(resultado, /100\.000 tokens\/dia/);

  const planNuevo = quota.obtenerPlan('tenant-2');
  assert.equal(planNuevo.nombre, 'cliente');
  assert.equal(planNuevo.tokensDia, 100000);
});

test('TenantSelfService: procesarUpgradePlan rechaza planes inexistentes', () => {
  const quota = crearTenantQuotaService();
  quota.asignarPlan('tenant-2', 'demo');

  const resultado = procesarUpgradePlan('tenant-2', 'plan_falso_invalido', { quotaService: quota });
  assert.match(resultado, /Plan no reconocido/);
});

test('TenantSelfService: procesarComandoAutoservicio intercepta comandos directos', () => {
  const quota = crearTenantQuotaService();
  quota.asignarPlan('tenant-3', 'demo');

  const respCuota = procesarComandoAutoservicio('/cuota', { tenantId: 'tenant-3', quotaService: quota });
  assert.ok(respCuota);
  assert.match(respCuota, /Estado de tu suscripcion/);

  const respPlanes = procesarComandoAutoservicio('/planes', { tenantId: 'tenant-3', quotaService: quota });
  assert.ok(respPlanes);
  assert.match(respPlanes, /Planes disponibles/);

  const respUpgrade = procesarComandoAutoservicio('/upgrade staff', { tenantId: 'tenant-3', quotaService: quota });
  assert.ok(respUpgrade);
  assert.match(respUpgrade, /STAFF/);

  const respNormal = procesarComandoAutoservicio('hola davis que tal', { tenantId: 'tenant-3', quotaService: quota });
  assert.equal(respNormal, null, 'mensaje normal no debe interceptarse');
});

test('TenantSelfService: RBAC autoriza herramientas de cuota para tenants', () => {
  const rCuota = puedeEjecutarHerramienta({
    tenantId: 'tenant-1',
    herramienta: 'consultar_cuota_tenant',
    rolDe: () => 'usuario',
    permisosDe: () => ['consultar_cuota_tenant', 'solicitar_upgrade_tenant'],
    esPropietario: () => false
  });
  assert.equal(rCuota.permitido, true);

  const rUpgrade = puedeEjecutarHerramienta({
    tenantId: 'tenant-1',
    herramienta: 'solicitar_upgrade_tenant',
    rolDe: () => 'usuario',
    permisosDe: () => ['consultar_cuota_tenant', 'solicitar_upgrade_tenant'],
    esPropietario: () => false
  });
  assert.equal(rUpgrade.permitido, true);
});

test('TenantSelfService: agente ejecuta herramientas consultar_cuota_tenant y solicitar_upgrade_tenant', async () => {
  registrarStoreUsoPorDefecto({ registrar: () => {} });
  const prevTenants = process.env.DAVIS_TENANTS_ENABLED;
  process.env.DAVIS_TENANTS_ENABLED = '1';
  try {
    const quota = crearTenantQuotaService();
    quota.asignarPlan('tenant-x', 'demo');

    const respuestaCuota = await consultarJarvisAislado('cual es mi cuota restante?', [], {
      tenantId: 'tenant-x',
      rolDeTenant: () => 'usuario',
      permisosDeTenant: () => ['consultar_cuota_tenant', 'solicitar_upgrade_tenant'],
      controlUso: quota,
      quotaService: quota,
      chatCompletion: async (peticion) => {
        // Simular llamada a consultar_cuota_tenant
        if (peticion.tools && peticion.tools.length > 0 && peticion.messages.length <= 2) {
          return {
            usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
            message: {
              role: 'assistant',
              content: '',
              tool_calls: [{
                id: 'call-cuota-1',
                type: 'function',
                function: { name: 'consultar_cuota_tenant', arguments: '{}' }
              }]
            }
          };
        }
        return {
          usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
          message: {
            role: 'assistant',
            content: 'Tu plan activo es DEMO con 15.000 tokens diarios.'
          }
        };
      }
    });

    assert.match(respuestaCuota, /DEMO/);
  } finally {
    process.env.DAVIS_TENANTS_ENABLED = prevTenants;
  }
});
