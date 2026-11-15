#!/usr/bin/env node
/**
 * crear_cuenta_tenant.js - CLI para alta y provisionamiento de cuentas Tenant.
 *
 * Uso:
 *   node scripts/crear_cuenta_tenant.js --id=empresa_acme --nombre="Acme Corp" --plan=cliente --identificador=34600112233
 *
 * Planes disponibles: demo, cliente, staff
 *
 * Strict Policy: Zero Emojis.
 */

import path from 'node:path';
import { DATA_DIR } from '../src/config/paths.js';
import { abrirBaseDatos } from '../src/adapters/outbound/persistence/sqlite/connection.js';
import { ejecutarMigraciones } from '../src/adapters/outbound/persistence/sqlite/migraciones.js';
import { crearSqliteTenantRepository } from '../src/adapters/outbound/persistence/sqlite/sqliteTenantRepository.js';
import { crearSqliteLimitesStore } from '../src/adapters/outbound/persistence/sqlite/sqliteLimitesStore.js';
import { crearSqliteUsageStore } from '../src/adapters/outbound/persistence/sqlite/sqliteUsageStore.js';
import { crearTenantQuotaService, PLANES, esNombrePlanValido } from '../src/services/tenantQuotaService.js';
import { esTenantIdValido } from '../src/core/tenancy.js';

function parsearArgs() {
  const args = {};
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith('--')) {
      const eq = arg.indexOf('=');
      if (eq !== -1) {
        const k = arg.slice(2, eq).trim();
        const v = arg.slice(eq + 1).trim();
        args[k] = v;
      } else {
        args[arg.slice(2).trim()] = true;
      }
    }
  }
  return args;
}

async function main() {
  const args = parsearArgs();
  const id = args.id;
  const nombre = args.nombre || id;
  const plan = args.plan || 'demo';
  const canal = args.canal || 'whatsapp';
  const identificador = args.identificador || args.telefono || null;
  const herramientasRaw = args.herramientas || '';

  if (!id) {
    console.error('Error: parametro --id es obligatorio. Ejemplo: --id=cliente_1 --nombre="Mi Empresa" --plan=demo');
    process.exit(1);
  }

  if (!esTenantIdValido(id)) {
    console.error(`Error: el id "${id}" no es valido. Solo letras minusculas, numeros, guiones y guiones bajos (1-64 caracteres).`);
    process.exit(1);
  }

  if (!esNombrePlanValido(plan) || plan === 'propietario') {
    console.error(`Error: plan "${plan}" invalido. Planes validos para tenants: demo, cliente, staff.`);
    process.exit(1);
  }

  const rutaDb = process.env.DAVIS_SQLITE_PATH || path.join(DATA_DIR, 'jarvis.db');
  console.log(`[Tenancy CLI] Abriendo base de datos SQLite en: ${rutaDb}`);
  const db = abrirBaseDatos(rutaDb);
  ejecutarMigraciones(db);

  const tenantRepo = crearSqliteTenantRepository(db);
  const limitesStore = crearSqliteLimitesStore(db);
  const usageStore = crearSqliteUsageStore(db);
  const quotaService = crearTenantQuotaService({ limitesStore, usageStore });

  try {
    let tenant = tenantRepo.obtener(id);
    if (!tenant) {
      tenant = tenantRepo.registrarTenant({ id, nombre, rol: 'usuario' });
      console.log(`[Tenancy CLI] Tenant "${id}" (${nombre}) registrado exitosamente.`);
    } else {
      console.log(`[Tenancy CLI] El tenant "${id}" ya existia previamente. Actualizando configuracion...`);
    }

    quotaService.asignarPlan(id, plan);
    console.log(`[Tenancy CLI] Plan "${plan}" asignado (${PLANES[plan].tokensDia} tokens/dia, ${PLANES[plan].peticionesMinuto} RPM).`);

    if (herramientasRaw) {
      const herramientas = herramientasRaw.split(',').map((h) => h.trim()).filter(Boolean);
      tenantRepo.configurarPermisos(id, herramientas);
      console.log(`[Tenancy CLI] Permisos de herramientas configurados: ${herramientas.join(', ')}`);
    }

    if (identificador) {
      // Normalizar identificador para WhatsApp si aplica
      let idFinal = identificador;
      if (canal === 'whatsapp' && !idFinal.includes('@')) {
        const soloDigitos = idFinal.replace(/\D/g, '');
        idFinal = `${soloDigitos}@s.whatsapp.net`;
      }
      try {
        tenantRepo.vincularIdentidad(id, canal, idFinal);
        console.log(`[Tenancy CLI] Identidad vinculada: [${canal}] -> ${idFinal}`);
      } catch (errIdent) {
        console.warn(`[Tenancy CLI] Aviso al vincular identidad: ${errIdent.message}`);
      }
    }

    console.log('\n======================================================');
    console.log(`RESUMEN DE CUENTA TENANT CREADA:`);
    console.log(`- ID: ${id}`);
    console.log(`- Nombre: ${nombre}`);
    console.log(`- Plan: ${plan}`);
    console.log(`- Cuota diaria: ${PLANES[plan].tokensDia} tokens`);
    console.log(`- Limite por minuto: ${PLANES[plan].peticionesMinuto} RPM`);
    if (identificador) console.log(`- Canal vinculado: ${canal} (${identificador})`);
    console.log('======================================================\n');
  } catch (err) {
    console.error(`[Tenancy CLI] Error creando cuenta tenant: ${err.message}`);
    process.exit(1);
  } finally {
    db.close();
  }
}

main();
