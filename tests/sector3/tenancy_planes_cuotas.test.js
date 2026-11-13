/**
 * Suite de pruebas exhaustiva para el motor de planes y cuotas por tenant:
 *  - Presets ('demo', 'cliente', 'staff', 'propietario').
 *  - Rate limiting por minuto (RPM) y desbloqueo en ventana siguiente.
 *  - Cuota diaria de tokens y reseteo diario.
 *  - Aislamiento estricto entre tenants y exencion del propietario.
 *  - Seguridad fail-closed (sin plan, tenant invalido, mensajes sanitizados).
 *  - Integracion con compuerta de entrada y AISLAMIENTO_COMPLETO = true.
 *
 * Strict Policy: Zero Emojis.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { abrirBaseDatos } from '../../src/adapters/outbound/persistence/sqlite/connection.js';
import { ejecutarMigraciones } from '../../src/adapters/outbound/persistence/sqlite/migraciones.js';
import { crearSqliteTenantRepository } from '../../src/adapters/outbound/persistence/sqlite/sqliteTenantRepository.js';
import { crearSqliteUsageStore } from '../../src/adapters/outbound/persistence/sqlite/sqliteUsageStore.js';
import { crearSqliteLimitesStore } from '../../src/adapters/outbound/persistence/sqlite/sqliteLimitesStore.js';
import {
  PLANES,
  NOMBRES_PLANES,
  esNombrePlanValido,
  MENSAJES_DENEGACION,
  crearTenantQuotaService
} from '../../src/services/tenantQuotaService.js';
import {
  AISLAMIENTO_COMPLETO,
  tenantsHabilitados,
  verificarCuotaTenant,
  TENANT_PROPIETARIO
} from '../../src/core/tenancy.js';
import { crearMessageProcessor } from '../../src/core/messageProcessor.js';

const T0 = new Date('2026-03-15T12:00:00.000Z');

function montarEntornoSqlite() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  ejecutarMigraciones(db);
  const repo = crearSqliteTenantRepository(db);
  for (const tid of ['tenant-a', 'tenant-b', 'tenant-c']) {
    try { repo.registrarTenant({ id: tid, nombre: tid }); } catch { /* ya existe */ }
  }
  const lim = crearSqliteLimitesStore(db);
  const uso = crearSqliteUsageStore(db);
  const quota = crearTenantQuotaService({ db, limitesStore: lim, usageStore: uso });
  return { db, repo, lim, uso, quota };
}

test('presets de planes: definicion exacta de limites y tokens', () => {
  assert.equal(PLANES.demo.tokensDia, 15_000);
  assert.equal(PLANES.demo.peticionesMinuto, 5);
  assert.equal(PLANES.cliente.tokensDia, 100_000);
  assert.equal(PLANES.cliente.peticionesMinuto, 15);
  assert.equal(PLANES.staff.tokensDia, 500_000);
  assert.equal(PLANES.staff.peticionesMinuto, 60);
  assert.equal(PLANES.propietario.tokensDia, null);
  assert.equal(PLANES.propietario.peticionesMinuto, null);

  assert.ok(esNombrePlanValido('demo'));
  assert.ok(esNombrePlanValido('cliente'));
  assert.ok(esNombrePlanValido('staff'));
  assert.ok(esNombrePlanValido('propietario'));
  assert.equal(esNombrePlanValido('desconocido'), false);
  assert.equal(esNombrePlanValido(null), false);
});

test('asignacion de plan: valida nombres y protege al propietario', () => {
  const quota = crearTenantQuotaService();
  assert.throws(() => quota.asignarPlan('propietario', 'demo'), /propietario/);
  assert.throws(() => quota.asignarPlan('tenant-a', 'plan-inventado'), /desconocido/);
  assert.throws(() => quota.asignarPlan('../invalido', 'demo'), /invalido/);

  const planA = quota.asignarPlan('tenant-a', 'demo');
  assert.equal(planA.nombre, 'demo');
  assert.equal(quota.obtenerPlan('tenant-a').tokensDia, 15_000);
  assert.equal(quota.obtenerPlan(TENANT_PROPIETARIO).nombre, 'propietario');
});

test('rate limiting por minuto (RPM) en memoria: plan demo (5 RPM) rechaza la sexta y reabre al siguiente minuto', () => {
  const quota = crearTenantQuotaService();
  quota.asignarPlan('tenant-a', 'demo');

  for (let i = 1; i <= 5; i++) {
    const res = quota.autorizar({ tenantId: 'tenant-a', ahora: T0 });
    assert.equal(res.permitido, true, `Peticion ${i} debe estar permitida`);
  }

  const sexta = quota.autorizar({ tenantId: 'tenant-a', ahora: T0 });
  assert.equal(sexta.permitido, false);
  assert.equal(sexta.motivo, 'limite_peticiones');
  assert.equal(sexta.limite, 5);
  assert.equal(sexta.mensaje, MENSAJES_DENEGACION.limite_peticiones);
  assert.ok(sexta.reintentarEnMs > 0);

  // Las denegadas no consumen ritmo adicional
  for (let i = 0; i < 3; i++) {
    const r = quota.autorizar({ tenantId: 'tenant-a', ahora: T0 });
    assert.equal(r.permitido, false);
    assert.equal(r.motivo, 'limite_peticiones');
  }

  // Siguiente minuto: ventana reabierta
  const siguienteMinuto = new Date(T0.getTime() + 60_000);
  const reabierta = quota.autorizar({ tenantId: 'tenant-a', ahora: siguienteMinuto });
  assert.equal(reabierta.permitido, true);
});

test('rate limiting por minuto (RPM) con persistencia SQLite', () => {
  const { db, quota } = montarEntornoSqlite();
  try {
    quota.asignarPlan('tenant-a', 'cliente'); // 15 RPM
    for (let i = 1; i <= 15; i++) {
      const res = quota.autorizar({ tenantId: 'tenant-a', ahora: T0 });
      assert.equal(res.permitido, true, `Peticion ${i} permitida`);
    }
    const excesiva = quota.autorizar({ tenantId: 'tenant-a', ahora: T0 });
    assert.equal(excesiva.permitido, false);
    assert.equal(excesiva.motivo, 'limite_peticiones');
    assert.equal(excesiva.mensaje, MENSAJES_DENEGACION.limite_peticiones);
  } finally {
    db.close();
  }
});

test('cuota diaria de tokens: plan demo (15.000) permite hasta 15.000 y deniega inmediatamente despues', () => {
  const quota = crearTenantQuotaService();
  quota.asignarPlan('tenant-a', 'demo');

  quota.registrarConsumo({ tenantId: 'tenant-a', tokens: 14_999, ahora: T0 });
  assert.equal(quota.autorizar({ tenantId: 'tenant-a', ahora: T0 }).permitido, true);

  quota.registrarConsumo({ tenantId: 'tenant-a', tokens: 1, ahora: T0 });
  const denegada = quota.autorizar({ tenantId: 'tenant-a', ahora: T0 });
  assert.equal(denegada.permitido, false);
  assert.equal(denegada.motivo, 'cuota_diaria');
  assert.equal(denegada.usado, 15_000);
  assert.equal(denegada.limite, 15_000);
  assert.equal(denegada.mensaje, MENSAJES_DENEGACION.cuota_diaria);
});

test('reseteo de ventana diaria: dia siguiente restaura la cuota completa', () => {
  const quota = crearTenantQuotaService();
  quota.asignarPlan('tenant-a', 'demo');

  quota.registrarConsumo({ tenantId: 'tenant-a', tokens: 20_000, ahora: T0 });
  assert.equal(quota.autorizar({ tenantId: 'tenant-a', ahora: T0 }).permitido, false);

  const diaSiguiente = new Date(T0.getTime() + 24 * 3600 * 1000);
  assert.equal(quota.autorizar({ tenantId: 'tenant-a', ahora: diaSiguiente }).permitido, true);

  const infoDiaNuevo = quota.consultarConsumo('tenant-a', { ahora: diaSiguiente });
  assert.equal(infoDiaNuevo.tokensHoy, 0);
  assert.equal(infoDiaNuevo.restanteTokens, 15_000);
});

test('reinicio explicito de ventana diaria con reiniciarVentanaDiaria', () => {
  const { db, quota } = montarEntornoSqlite();
  try {
    quota.asignarPlan('tenant-a', 'demo');
    quota.registrarConsumo({ tenantId: 'tenant-a', tokens: 15_000, ahora: T0 });
    assert.equal(quota.autorizar({ tenantId: 'tenant-a', ahora: T0 }).permitido, false);

    quota.reiniciarVentanaDiaria('tenant-a', { dia: '2026-03-15' });
    assert.equal(quota.autorizar({ tenantId: 'tenant-a', ahora: T0 }).permitido, true);
    assert.equal(quota.consultarConsumo('tenant-a', { ahora: T0 }).tokensHoy, 0);
  } finally {
    db.close();
  }
});

test('aislamiento estricto entre tenants: cuota o rate limit de A no bloquea a B ni a C', () => {
  const quota = crearTenantQuotaService();
  quota.asignarPlan('tenant-a', 'demo');
  quota.asignarPlan('tenant-b', 'cliente');
  quota.asignarPlan('tenant-c', 'staff');

  quota.registrarConsumo({ tenantId: 'tenant-a', tokens: 50_000, ahora: T0 });
  assert.equal(quota.autorizar({ tenantId: 'tenant-a', ahora: T0 }).permitido, false);

  assert.equal(quota.autorizar({ tenantId: 'tenant-b', ahora: T0 }).permitido, true);
  assert.equal(quota.autorizar({ tenantId: 'tenant-c', ahora: T0 }).permitido, true);

  // Consumir todo el rate limit de B
  for (let i = 0; i < 15; i++) quota.autorizar({ tenantId: 'tenant-b', ahora: T0 });
  assert.equal(quota.autorizar({ tenantId: 'tenant-b', ahora: T0 }).permitido, false);
  assert.equal(quota.autorizar({ tenantId: 'tenant-c', ahora: T0 }).permitido, true);
});

test('el propietario esta completamente exento de cuotas y rate limits', () => {
  const quota = crearTenantQuotaService();
  quota.registrarConsumo({ tenantId: TENANT_PROPIETARIO, tokens: 10_000_000, ahora: T0 });

  for (let i = 0; i < 200; i++) {
    const res = quota.autorizar({ tenantId: TENANT_PROPIETARIO, ahora: T0 });
    assert.equal(res.permitido, true);
    assert.equal(res.motivo, 'propietario');
  }

  const info = quota.consultarConsumo(TENANT_PROPIETARIO, { ahora: T0 });
  assert.equal(info.limiteTokens, null);
  assert.equal(info.restanteTokens, Infinity);
  assert.equal(info.peticionesMinuto, null);
});

test('seguridad fail-closed: tenant sin plan o con identificador invalido es denegado', () => {
  const quota = crearTenantQuotaService();
  const sinPlan = quota.autorizar({ tenantId: 'tenant-sin-plan', ahora: T0 });
  assert.equal(sinPlan.permitido, false);
  assert.equal(sinPlan.motivo, 'sin_plan');
  assert.equal(sinPlan.mensaje, MENSAJES_DENEGACION.sin_plan);

  const invalido = quota.autorizar({ tenantId: '..\\malicious', ahora: T0 });
  assert.equal(invalido.permitido, false);
  assert.equal(invalido.motivo, 'tenant_invalido');
  assert.equal(invalido.mensaje, MENSAJES_DENEGACION.tenant_desconocido);
});

test('verificarCuotaTenant devuelve mensajes sanitizados sin exponer infraestructura', () => {
  const mockControl = {
    autorizar: ({ consumirPeticion }) => ({ permitido: false, motivo: 'limite_peticiones' })
  };
  const r1 = verificarCuotaTenant({ tenantId: 'tenant-a', controlUso: mockControl, ahora: T0 });
  assert.equal(r1.permitido, false);
  assert.equal(r1.mensaje, 'Limite de peticiones por minuto excedido para este usuario.');

  const r2 = verificarCuotaTenant({ tenantId: 'tenant-a', controlUso: null });
  assert.equal(r2.permitido, false);
  assert.equal(r2.mensaje, 'Control de uso no disponible para este usuario.');

  const rError = verificarCuotaTenant({
    tenantId: 'tenant-a',
    controlUso: { autorizar: () => { throw new Error('database connection timeout on 192.168.1.5'); } }
  });
  assert.equal(rError.permitido, false);
  assert.equal(rError.mensaje, 'Limite de uso alcanzado para este usuario.');
  assert.ok(!rError.mensaje.includes('192.168.1.5'));
});

test('switch AISLAMIENTO_COMPLETO = true encendido y compuerta fail-closed', () => {
  assert.equal(AISLAMIENTO_COMPLETO, true);
  assert.equal(tenantsHabilitados({ DAVIS_TENANTS_ENABLED: '1' }), true);
  assert.equal(tenantsHabilitados({ DAVIS_TENANTS_ENABLED: '0' }), false);
  assert.equal(tenantsHabilitados({}), false);
});

test('integracion messageProcessor: mensaje de tenant sobre cuota o RPM es rechazado sin invocar al modelo', async () => {
  const quota = crearTenantQuotaService();
  quota.asignarPlan('tenant-a', 'demo');
  // Agotar tokens para el dia actual
  quota.registrarConsumo({ tenantId: 'tenant-a', tokens: 15_000 });

  let llamadasLlm = 0;
  const chatCompletion = async () => {
    llamadasLlm++;
    return { model: 'stub', message: { role: 'assistant', content: 'respuesta' } };
  };

  const accesoTenantsMock = {
    resolver: async (inbound) => ({
      tenantId: 'tenant-a',
      chatId: 'c-test',
      controlUso: quota,
      rolDeTenant: () => 'usuario',
      permisosDeTenant: () => []
    })
  };

  const processor = crearMessageProcessor({
    llmProvider: { chatCompletion },
    accesoTenants: accesoTenantsMock
  });

  const respuesta = await processor.procesarMensajeEnAmbito(
    { channel: 'whatsapp', userId: 'user-a', text: 'hola' },
    { historial: [] }
  );

  assert.equal(llamadasLlm, 0, 'No debe invocarse al proveedor LLM si excede la cuota');
  assert.match(String(respuesta), /Limite de uso/);
});

test('integracion messageProcessor: mensaje de tenant que excede RPM es rechazado con mensaje sanitizado de ritmo', async () => {
  const quota = crearTenantQuotaService();
  quota.asignarPlan('tenant-a', 'demo'); // 5 RPM

  // Consumir 5 peticiones
  for (let i = 0; i < 5; i++) {
    quota.autorizar({ tenantId: 'tenant-a' });
  }

  let llamadasLlm = 0;
  const chatCompletion = async () => {
    llamadasLlm++;
    return { model: 'stub', message: { role: 'assistant', content: 'respuesta' } };
  };

  const accesoTenantsMock = {
    resolver: async (inbound) => ({
      tenantId: 'tenant-a',
      chatId: 'c-test-rpm',
      controlUso: quota,
      rolDeTenant: () => 'usuario',
      permisosDeTenant: () => []
    })
  };

  const processor = crearMessageProcessor({
    llmProvider: { chatCompletion },
    accesoTenants: accesoTenantsMock
  });

  const respuesta = await processor.procesarMensajeEnAmbito(
    { channel: 'whatsapp', userId: 'user-a', text: 'consulta rapida' },
    { historial: [] }
  );

  assert.equal(llamadasLlm, 0, 'No debe invocarse al proveedor LLM si excede RPM');
  assert.match(String(respuesta), /peticiones por minuto/);
});
