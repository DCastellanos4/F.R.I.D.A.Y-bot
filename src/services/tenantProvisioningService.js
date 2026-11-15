/**
 * tenantProvisioningService.js - Servicio centralizado de aprovisionamiento de tenants y Second Brain.
 *
 * Responsabilidades:
 *  - Registro de cuenta tenant en base de datos SQLite con validacion de formato y roles.
 *  - Asignacion de plan y cuota de consumo (tokens/dia, RPM).
 *  - Configuracion de permisos RBAC para catalogo seguro (Second Brain, Citas, Finanzas, Habitos).
 *  - Aprovisionamiento del sistema de archivos aislado (notes, diario, trazas, memorias).
 *  - Sembrado de nota de bienvenida y creacion de coleccion en Qdrant (davis_memorias_<tenant_id>).
 *  - Vinculacion de identidades de canal (WhatsApp JID/LID).
 *
 * Strict Policy: Zero Emojis.
 */

import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from '../config/paths.js';
import { esTenantIdValido, TENANT_PROPIETARIO, afirmarTenantId } from '../core/tenancy.js';
import { esNombrePlanValido, PLANES } from './tenantQuotaService.js';
import { CLASES_APTAS_TENANT, claseDeHerramienta } from './rbacService.js';

export const HERRAMIENTAS_DEFECTO_TENANT = Object.freeze([
  'guardar_memoria',
  'buscar_memoria',
  'listar_memorias',
  'olvidar_memoria',
  'buscar_recuerdo_semantico',
  'consultar_disponibilidad',
  'reservar_cita',
  'cancelar_cita',
  'listar_citas',
  'anadir_compra',
  'listar_compra',
  'tachar_compra',
  'vaciar_compra',
  'registrar_contacto',
  'buscar_contacto',
  'listar_contactos',
  'registrar_habito',
  'marcar_habito',
  'listar_habitos',
  'anotar_idea',
  'listar_ideas',
  'crear_quedada',
  'listar_quedadas'
]);

/**
 * Normaliza un identificador de canal a formato canonico.
 */
export function normalizarIdentificadorCanal(canal, identificador) {
  if (!identificador || typeof identificador !== 'string') return null;
  const limpio = identificador.trim();
  if (canal === 'whatsapp') {
    if (limpio.endsWith('@s.whatsapp.net') || limpio.endsWith('@lid')) return limpio;
    const soloDigitos = limpio.replace(/\D/g, '');
    if (soloDigitos.length >= 8) return `${soloDigitos}@s.whatsapp.net`;
  }
  return limpio;
}

/**
 * Aprovisiona la estructura de directorios y archivos de un Second Brain de tenant.
 *
 * @param {string} tenantId
 * @param {string} [nombre]
 * @param {string} [dataDir]
 * @returns {object}
 */
export function provisionarEstructuraArchivosTenant(tenantId, nombre = '', dataDir = DATA_DIR) {
  afirmarTenantId(tenantId);
  if (tenantId === TENANT_PROPIETARIO) return { ok: true, propietario: true };

  const raizTenant = path.join(path.resolve(dataDir), 'tenants', tenantId);
  const carpetas = [
    raizTenant,
    path.join(raizTenant, 'notes'),
    path.join(raizTenant, 'diario'),
    path.join(raizTenant, 'episodios'),
    path.join(raizTenant, 'indices'),
    path.join(raizTenant, 'trazas')
  ];

  for (const c of carpetas) {
    if (!fs.existsSync(c)) {
      fs.mkdirSync(c, { recursive: true });
    }
  }

  // Inicializar archivo de memorias JSON si no existe
  const rutaMemorias = path.join(raizTenant, 'brain_memory.json');
  if (!fs.existsSync(rutaMemorias)) {
    fs.writeFileSync(rutaMemorias, JSON.stringify([], null, 2), 'utf8');
  }

  // Sembrar nota inicial de bienvenida en su Second Brain
  const rutaBienvenida = path.join(raizTenant, 'notes', 'bienvenida.md');
  if (!fs.existsSync(rutaBienvenida)) {
    const fechaIso = new Date().toISOString();
    const contenidoBienvenida = `---
title: "Bienvenido a tu Second Brain de DAVIS"
category: "bienvenida"
tags: [inicio, configuracion, davis]
author: "${nombre || tenantId}"
created_at: "${fechaIso}"
---

# Bienvenido a tu Segundo Cerebro de DAVIS

Este es tu espacio privado e independiente dentro de DAVIS.
Todo el conocimiento que registres aquí se almacena de forma aislada y no es compartido con ningún otro tenant ni usuario.

## Capacidades de tu Second Brain:
- **Notas personales**: Guarda notas con categorías y etiquetas.
- **Memoria semántica**: Recuerdos contextuales estructurados.
- **Gestión de Citas y Reservas**: Consulta de disponibilidad, reserva y cancelación en tiempo real.
- **Finanzas y Hábitos**: Registro de gastos y seguimiento de rutinas.

Para empezar, pídele a DAVIS:
- "Guarda una nota sobre mi proyecto Alpha"
- "Consulta las citas registradas"
- "Recuérdame revisar las métricas mañana"
`;
    fs.writeFileSync(rutaBienvenida, contenidoBienvenida, 'utf8');
  }

  return {
    ok: true,
    raizTenant,
    carpetaNotas: path.join(raizTenant, 'notes'),
    rutaMemorias
  };
}

/**
 * Orquestador principal de aprovisionamiento de Tenants.
 *
 * @param {object} params
 * @param {string} params.id - Identificador unico del tenant (slug [a-z0-9_-]).
 * @param {string} params.nombre - Nombre legible de la persona u organizacion.
 * @param {string} [params.plan='demo'] - demo, cliente, staff.
 * @param {string} [params.canal='whatsapp'] - whatsapp o web.
 * @param {string} [params.identificador] - JID o numero telefonico.
 * @param {Array<string>} [params.herramientas] - Lista opcional de herramientas a permitir.
 * @param {object} deps - Dependencias inyectadas (tenantRepository, quotaService, qdrantSecondBrain, dataDir).
 * @returns {Promise<object>}
 */
export async function provisionarTenant({
  id,
  nombre,
  plan = 'demo',
  canal = 'whatsapp',
  identificador = null,
  herramientas = null
} = {}, deps = {}) {
  if (!id || !esTenantIdValido(id)) {
    throw new TypeError(`Identificador de tenant invalido: "${id}". Debe coincidir con [a-z0-9_-] (1-64 caracteres).`);
  }
  if (id === TENANT_PROPIETARIO) {
    throw new Error('El tenant propietario ya existe y no puede crearse por aprovisionamiento.');
  }

  const planEfectivo = plan && esNombrePlanValido(plan) && plan !== 'propietario' ? plan : 'demo';
  const dataDir = deps.dataDir || DATA_DIR;

  // 1. Aprovisionamiento fisico del Second Brain
  const archivos = provisionarEstructuraArchivosTenant(id, nombre, dataDir);

  // 2. Registro de persistencia SQLite
  const tenantRepo = deps.tenantRepository;
  const quotaService = deps.quotaService;

  let tenantRecord = null;
  if (tenantRepo && typeof tenantRepo.registrarTenant === 'function') {
    tenantRecord = tenantRepo.obtener(id);
    if (!tenantRecord) {
      tenantRecord = tenantRepo.registrarTenant({
        id,
        nombre: nombre || id,
        rol: 'usuario'
      });
    }

    // Configurar cuota de plan
    if (quotaService && typeof quotaService.asignarPlan === 'function') {
      quotaService.asignarPlan(id, planEfectivo);
    }

    // Configurar catalogo de herramientas seguras
    const listaOrigen = Array.isArray(herramientas) && herramientas.length > 0
      ? herramientas
      : HERRAMIENTAS_DEFECTO_TENANT;
    const toolsParaConfigurar = listaOrigen.filter((h) => CLASES_APTAS_TENANT.includes(claseDeHerramienta(h)));

    tenantRepo.configurarPermisos(id, toolsParaConfigurar);

    // Vincular identificador si se proporciono
    if (identificador) {
      const idNormalizado = normalizarIdentificadorCanal(canal, identificador);
      if (idNormalizado) {
        try {
          tenantRepo.vincularIdentidad(id, canal, idNormalizado);
        } catch (errIdent) {
          console.warn(`[Provisioning] Aviso al vincular identidad (${canal}:${idNormalizado}):`, errIdent.message);
        }
      }
    }
  }

  // 3. Aprovisionamiento e indexacion en Qdrant si esta configurado
  const qdrant = deps.qdrantSecondBrain;
  let qdrantIndexado = false;
  if (qdrant && typeof qdrant.indexarTodasLasNotas === 'function') {
    try {
      await qdrant.indexarTodasLasNotas({ tenantId: id, carpetaNotas: archivos.carpetaNotas });
      qdrantIndexado = true;
    } catch (errQdrant) {
      console.warn(`[Provisioning] Qdrant no disponible durante provisionamiento inicial de "${id}":`, errQdrant.message);
    }
  }

  return {
    ok: true,
    tenantId: id,
    nombre: nombre || id,
    plan: planEfectivo,
    cuotaDiaria: PLANES[planEfectivo]?.tokensDia || 0,
    peticionesMinuto: PLANES[planEfectivo]?.peticionesMinuto || 0,
    estructuraArchivos: archivos,
    qdrantColeccion: `davis_memorias_${id}`,
    qdrantIndexado,
    identificadorVinculado: identificador ? normalizarIdentificadorCanal(canal, identificador) : null
  };
}
