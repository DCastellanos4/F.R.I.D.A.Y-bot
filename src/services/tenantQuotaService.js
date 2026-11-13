/**
 * Servicio de Cuotas y Planes de Consumo por Tenant.
 *
 * Presets configurados:
 *  - 'demo': 15.000 tokens/dia, 5 RPM.
 *  - 'cliente': 100.000 tokens/dia, 15 RPM.
 *  - 'staff': 500.000 tokens/dia, 60 RPM.
 *  - 'propietario': ilimitado.
 *
 * Fail-closed security:
 *  - Todo tenant no propietario sin plan o desconocido queda denegado por defecto.
 *  - Errores y rechazos devuelven mensajes sanitizados sin filtrar detalles del host o proveedor.
 *  - Persistencia dual: soporte para SQLite (limitesStore/usageStore) y memoria interna.
 *
 * Strict Policy: Zero Emojis.
 */

import { randomUUID } from 'node:crypto';
import { TENANT_PROPIETARIO, afirmarTenantId, esTenantIdValido } from '../core/tenancy.js';
import { diaLocal } from './usageLedgerService.js';

export const PLANES = Object.freeze({
  demo: Object.freeze({
    id: 'demo',
    nombre: 'demo',
    tokensDia: 15_000,
    peticionesMinuto: 5,
    tokensMes: null
  }),
  cliente: Object.freeze({
    id: 'cliente',
    nombre: 'cliente',
    tokensDia: 100_000,
    peticionesMinuto: 15,
    tokensMes: null
  }),
  staff: Object.freeze({
    id: 'staff',
    nombre: 'staff',
    tokensDia: 500_000,
    peticionesMinuto: 60,
    tokensMes: null
  }),
  propietario: Object.freeze({
    id: 'propietario',
    nombre: 'propietario',
    tokensDia: null,
    peticionesMinuto: null,
    tokensMes: null
  })
});

export const NOMBRES_PLANES = Object.freeze(Object.keys(PLANES));

export function esNombrePlanValido(nombre) {
  return typeof nombre === 'string' && Object.prototype.hasOwnProperty.call(PLANES, nombre);
}

export const MENSAJES_DENEGACION = Object.freeze({
  cuota_diaria: 'Limite de uso alcanzado para este usuario.',
  limite_peticiones: 'Limite de peticiones por minuto excedido para este usuario.',
  medicion_pendiente: 'Control de uso no disponible: medicion pendiente de verificar.',
  error_control_uso: 'Control de uso no disponible para este usuario.',
  sin_plan: 'Acceso no disponible para este usuario.',
  tenant_desconocido: 'Acceso no disponible para este usuario.',
  almacenamiento_no_seguro: 'Almacenamiento no disponible para este usuario.'
});

export function sanitizarMensajeDenegacion(motivo) {
  if (motivo === 'cuota_diaria' || motivo === 'cuota_mensual' || motivo === 'LimiteUso') {
    return MENSAJES_DENEGACION.cuota_diaria;
  }
  if (motivo === 'limite_peticiones') {
    return MENSAJES_DENEGACION.limite_peticiones;
  }
  if (motivo === 'medicion_pendiente') {
    return MENSAJES_DENEGACION.medicion_pendiente;
  }
  if (motivo === 'error_control_uso' || motivo === 'MedicionUso') {
    return MENSAJES_DENEGACION.error_control_uso;
  }
  if (motivo === 'sin_plan' || motivo === 'tenant_desconocido' || motivo === 'tenant_invalido') {
    return MENSAJES_DENEGACION.tenant_desconocido;
  }
  return MENSAJES_DENEGACION.cuota_diaria;
}

export function crearTenantQuotaService({
  db = null,
  limitesStore = null,
  usageStore = null,
  planPorDefecto = null
} = {}) {
  const planesAsignados = new Map();
  const consumoTokensMemoria = new Map();
  const peticionesVentanaMemoria = new Map();
  const medicionesPendientesMemoria = new Map();

  function limpiarVentanasAntiguas(tenantId, ventanaActual) {
    const prefijo = `${tenantId}:`;
    for (const clave of peticionesVentanaMemoria.keys()) {
      if (clave.startsWith(prefijo)) {
        const v = Number(clave.slice(prefijo.length));
        if (v < ventanaActual) {
          peticionesVentanaMemoria.delete(clave);
        }
      }
    }
  }

  function resolverPlan(tenantId) {
    if (tenantId === TENANT_PROPIETARIO) return PLANES.propietario;
    const asignado = planesAsignados.get(tenantId) || planPorDefecto;
    if (asignado && PLANES[asignado]) return PLANES[asignado];
    return null;
  }

  return Object.freeze({
    PLANES,

    asignarPlan(tenantId, nombrePlan, { ahora = new Date() } = {}) {
      afirmarTenantId(tenantId);
      if (tenantId === TENANT_PROPIETARIO) {
        if (nombrePlan !== 'propietario') {
          throw new Error('El propietario solo admite plan ilimitado "propietario".');
        }
        return PLANES.propietario;
      }
      if (!esNombrePlanValido(nombrePlan)) {
        throw new Error(`Plan desconocido: ${nombrePlan}. Planes validos: ${NOMBRES_PLANES.join(', ')}.`);
      }
      const preset = PLANES[nombrePlan];
      planesAsignados.set(tenantId, nombrePlan);

      if (limitesStore && typeof limitesStore.configurar === 'function') {
        limitesStore.configurar(tenantId, {
          tokensDia: preset.tokensDia,
          tokensMes: preset.tokensMes,
          peticionesMinuto: preset.peticionesMinuto
        }, { ahora });
      }

      return preset;
    },

    obtenerPlan(tenantId) {
      afirmarTenantId(tenantId);
      return resolverPlan(tenantId);
    },

    quitarPlan(tenantId) {
      afirmarTenantId(tenantId);
      planesAsignados.delete(tenantId);
      if (limitesStore && typeof limitesStore.quitar === 'function') {
        limitesStore.quitar(tenantId);
      }
    },

    registrarConsumo({ tenantId, tokens, modelo = 'default', ahora = new Date() } = {}) {
      if (!tenantId || tenantId === TENANT_PROPIETARIO) {
        if (usageStore && typeof usageStore.registrar === 'function' && Number.isSafeInteger(tokens) && tokens > 0) {
          usageStore.registrar({
            tenantId: TENANT_PROPIETARIO,
            dia: diaLocal(ahora),
            modelo,
            entrada: tokens,
            salida: 0
          });
        }
        return { ok: true, tenantId: TENANT_PROPIETARIO };
      }
      afirmarTenantId(tenantId);
      if (!Number.isSafeInteger(tokens) || tokens < 0) {
        throw new TypeError('tokens debe ser un entero positivo o cero.');
      }

      const dia = diaLocal(ahora);
      const clave = `${tenantId}:${dia}`;
      const actual = consumoTokensMemoria.get(clave) || 0;
      consumoTokensMemoria.set(clave, actual + tokens);

      if (usageStore && typeof usageStore.registrar === 'function') {
        usageStore.registrar({
          tenantId,
          dia,
          modelo,
          entrada: tokens,
          salida: 0
        });
      }

      return { ok: true, tenantId, dia, totalHoy: actual + tokens };
    },

    consultarConsumo(tenantId, { ahora = new Date() } = {}) {
      if (!tenantId || tenantId === TENANT_PROPIETARIO) {
        return {
          tenantId: TENANT_PROPIETARIO,
          plan: 'propietario',
          dia: diaLocal(ahora),
          tokensHoy: 0,
          limiteTokens: null,
          restanteTokens: Infinity,
          peticionesMinuto: null
        };
      }
      afirmarTenantId(tenantId);
      const plan = resolverPlan(tenantId);
      const dia = diaLocal(ahora);

      let gastado = consumoTokensMemoria.get(`${tenantId}:${dia}`) || 0;
      if (usageStore && typeof usageStore.rango === 'function') {
        const fila = usageStore.rango(tenantId, dia, dia);
        if (fila && Number.isSafeInteger(fila.entrada)) {
          gastado = fila.entrada + (fila.salida || 0);
        }
      }

      const limiteTokens = plan?.tokensDia ?? null;
      const restanteTokens = limiteTokens === null ? Infinity : Math.max(0, limiteTokens - gastado);

      return {
        tenantId,
        plan: plan?.nombre || null,
        dia,
        tokensHoy: gastado,
        limiteTokens,
        restanteTokens,
        peticionesMinuto: plan?.peticionesMinuto ?? null
      };
    },

    reiniciarVentanaDiaria(tenantId, { dia = diaLocal(new Date()) } = {}) {
      afirmarTenantId(tenantId);
      const clave = `${tenantId}:${dia}`;
      consumoTokensMemoria.delete(clave);

      if (db) {
        try {
          db.prepare('DELETE FROM uso_tokens WHERE tenant_id = ? AND dia = ?').run(tenantId, dia);
        } catch { /* Ignorar error si la tabla no existe en entornos no SQLite */ }
      }

      return { ok: true, tenantId, dia };
    },

    iniciarMedicion(tenantId, { ahora = new Date() } = {}) {
      afirmarTenantId(tenantId);
      if (tenantId === TENANT_PROPIETARIO) return null;
      if (limitesStore && typeof limitesStore.iniciarMedicion === 'function') {
        return limitesStore.iniciarMedicion(tenantId, { ahora });
      }

      const plan = resolverPlan(tenantId);
      if (!plan || plan.tokensDia === null) return null;

      if (medicionesPendientesMemoria.has(tenantId)) {
        const e = new Error('Medicion/cuota no disponible.');
        e.name = 'LimiteUso';
        throw e;
      }

      const decision = this.autorizar({ tenantId, ahora, consumirPeticion: false });
      if (!decision.permitido) {
        const e = new Error('Medicion/cuota no disponible.');
        e.name = 'LimiteUso';
        throw e;
      }

      const ticket = randomUUID();
      medicionesPendientesMemoria.set(tenantId, ticket);
      return ticket;
    },

    confirmarMedicion(tenantId, ticket) {
      afirmarTenantId(tenantId);
      if (!ticket) return;
      if (limitesStore && typeof limitesStore.confirmarMedicion === 'function') {
        limitesStore.confirmarMedicion(tenantId, ticket);
        return;
      }

      if (medicionesPendientesMemoria.get(tenantId) !== ticket) {
        throw new Error('Medicion pendiente no coincide.');
      }
      medicionesPendientesMemoria.delete(tenantId);
    },

    autorizar({ tenantId = TENANT_PROPIETARIO, ahora = new Date(), consumirPeticion = true } = {}) {
      if (tenantId === undefined || tenantId === null || tenantId === TENANT_PROPIETARIO) {
        return { permitido: true, motivo: 'propietario' };
      }
      if (!esTenantIdValido(tenantId)) {
        return {
          permitido: false,
          motivo: 'tenant_invalido',
          mensaje: MENSAJES_DENEGACION.tenant_desconocido
        };
      }

      const plan = resolverPlan(tenantId);
      if (!plan) {
        return {
          permitido: false,
          motivo: 'sin_plan',
          mensaje: MENSAJES_DENEGACION.sin_plan
        };
      }

      if (limitesStore && typeof limitesStore.autorizar === 'function') {
        const decision = limitesStore.autorizar({ tenantId, ahora, consumirPeticion });
        if (!decision.permitido) {
          return {
            ...decision,
            mensaje: sanitizarMensajeDenegacion(decision.motivo)
          };
        }
        return decision;
      }

      // Verificacion en memoria
      if (medicionesPendientesMemoria.has(tenantId)) {
        return {
          permitido: false,
          motivo: 'medicion_pendiente',
          mensaje: MENSAJES_DENEGACION.medicion_pendiente
        };
      }

      const dia = diaLocal(ahora);
      const gastado = consumoTokensMemoria.get(`${tenantId}:${dia}`) || 0;
      if (plan.tokensDia !== null && gastado >= plan.tokensDia) {
        return {
          permitido: false,
          motivo: 'cuota_diaria',
          usado: gastado,
          limite: plan.tokensDia,
          mensaje: MENSAJES_DENEGACION.cuota_diaria
        };
      }

      if (consumirPeticion && plan.peticionesMinuto !== null) {
        const ventana = Math.floor(ahora.getTime() / 60_000);
        limpiarVentanasAntiguas(tenantId, ventana);
        const claveVentana = `${tenantId}:${ventana}`;
        const conteo = peticionesVentanaMemoria.get(claveVentana) || 0;
        if (conteo >= plan.peticionesMinuto) {
          const reintentarEnMs = (ventana + 1) * 60_000 - ahora.getTime();
          return {
            permitido: false,
            motivo: 'limite_peticiones',
            limite: plan.peticionesMinuto,
            reintentarEnMs,
            mensaje: MENSAJES_DENEGACION.limite_peticiones
          };
        }
        peticionesVentanaMemoria.set(claveVentana, conteo + 1);
      }

      return { permitido: true, motivo: 'dentro_de_limites' };
    }
  });
}

let quotaServicePorDefecto = null;

export function registrarTenantQuotaServicePorDefecto(servicio) {
  quotaServicePorDefecto = servicio || null;
}

export function obtenerTenantQuotaServicePorDefecto() {
  return quotaServicePorDefecto;
}
