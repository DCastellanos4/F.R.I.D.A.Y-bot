/**
 * tenantSelfService.js - Servicio de Autoservicio y Cuotas para Tenants (SaaS)
 *
 * Permite a los usuarios y clientes gestionar sus suscripciones, comprobar su
 * consumo de tokens en tiempo real y cambiar de plan mediante comandos directos
 * de WhatsApp o herramientas del agente.
 *
 * Strict Policy: Zero Emojis.
 */

import { PLANES, NOMBRES_PLANES, esNombrePlanValido } from './tenantQuotaService.js';
import { afirmarTenantId, TENANT_PROPIETARIO } from '../core/tenancy.js';

/**
 * Genera el resumen textual del estado de cuota y consumo de un tenant.
 *
 * @param {string} tenantId
 * @param {object} deps
 * @returns {string}
 */
export function consultarCuotaTexto(tenantId, deps = {}) {
  const quotaService = deps.quotaService || deps.controlUso;
  if (!quotaService || typeof quotaService.consultarConsumo !== 'function') {
    return 'El servicio de control de cuotas no se encuentra disponible temporalmente.';
  }

  try {
    const estado = quotaService.consultarConsumo(tenantId, { ahora: deps.ahora || new Date() });
    const plan = estado.plan || 'sin_plan';
    const tokensHoy = Number(estado.tokensHoy || 0).toLocaleString('es-ES');
    const limiteTokens = estado.limiteTokens === null ? 'Ilimitado' : Number(estado.limiteTokens).toLocaleString('es-ES');
    const restante = estado.restanteTokens === Infinity ? 'Ilimitado' : Number(estado.restanteTokens).toLocaleString('es-ES');
    const rpm = estado.peticionesMinuto === null ? 'Ilimitado' : `${estado.peticionesMinuto} peticiones/min`;

    return [
      'Estado de tu suscripcion D.A.V.I.S.:',
      `* Plan activo: ${plan.toUpperCase()}`,
      `* Consumo hoy: ${tokensHoy} / ${limiteTokens} tokens`,
      `* Tokens restantes hoy: ${restante}`,
      `* Limite de velocidad: ${rpm}`,
      '',
      'Para ver otros planes escribe: /planes',
      'Para cambiar de plan escribe: /upgrade <nombre_plan>'
    ].join('\n');
  } catch (err) {
    console.warn('[TenantSelfService] Error consultando cuota:', err.message);
    return 'No se pudo obtener el estado de la cuota en este momento.';
  }
}

/**
 * Devuelve el catalogo de planes disponibles para autoservicio.
 *
 * @returns {string}
 */
export function listarPlanesTexto() {
  return [
    'Planes disponibles en D.A.V.I.S.:',
    '',
    '* DEMO:',
    '  - Cuota: 15.000 tokens/dia',
    '  - Velocidad: 5 peticiones/minuto',
    '  - Acceso: Asistente basico y Second Brain personal',
    '',
    '* CLIENTE (Recomendado):',
    '  - Cuota: 100.000 tokens/dia',
    '  - Velocidad: 15 peticiones/minuto',
    '  - Acceso: Citas, finanzas, habitos, notas y RAG contextual',
    '',
    '* STAFF:',
    '  - Cuota: 500.000 tokens/dia',
    '  - Velocidad: 60 peticiones/minuto',
    '  - Acceso: Alta concurrencia y flujo continuo',
    '',
    'Para solicitar o actualizar tu plan escribe:',
    '/upgrade <nombre_plan>   (ejemplo: /upgrade cliente)'
  ].join('\n');
}

/**
 * Ejecuta el cambio de plan solicitado por un tenant.
 *
 * @param {string} tenantId
 * @param {string} nombrePlan
 * @param {object} deps
 * @returns {string}
 */
export function procesarUpgradePlan(tenantId, nombrePlan, deps = {}) {
  afirmarTenantId(tenantId);
  const quotaService = deps.quotaService || deps.controlUso;
  if (!quotaService || typeof quotaService.asignarPlan !== 'function') {
    return 'El servicio de asignacion de planes no se encuentra disponible temporalmente.';
  }

  if (tenantId === TENANT_PROPIETARIO) {
    return 'El propietario dispone de acceso ilimitado permanente sin restricciones de cuota.';
  }

  const planLimpio = String(nombrePlan || '').trim().toLowerCase();
  if (!esNombrePlanValido(planLimpio) || planLimpio === 'propietario') {
    return `Plan no reconocido: "${nombrePlan}". Planes validos: ${NOMBRES_PLANES.filter((p) => p !== 'propietario').join(', ')}.`;
  }

  try {
    const preset = quotaService.asignarPlan(tenantId, planLimpio, { ahora: deps.ahora || new Date() });

    // Actualizar en repositorio persistente si se provee
    if (deps.tenantRepository && typeof deps.tenantRepository.actualizarPlan === 'function') {
      try {
        deps.tenantRepository.actualizarPlan(tenantId, planLimpio);
      } catch (errRepo) {
        console.warn('[TenantSelfService] Aviso actualizando plan en tenantRepository:', errRepo.message);
      }
    }

    const tokensDia = Number(preset.tokensDia).toLocaleString('es-ES');
    return [
      'Plan actualizado con exito en D.A.V.I.S.:',
      `* Nuevo plan: ${planLimpio.toUpperCase()}`,
      `* Cuota diaria: ${tokensDia} tokens/dia`,
      `* Velocidad maxima: ${preset.peticionesMinuto} peticiones/minuto`,
      'Tu nuevo limite entra en vigencia de forma inmediata.'
    ].join('\n');
  } catch (err) {
    console.warn('[TenantSelfService] Error asignando plan:', err.message);
    return `No se pudo aplicar el cambio de plan: ${err.message}`;
  }
}

/**
 * Intercepta y procesa comandos de autoservicio de texto antes del clasificador.
 *
 * @param {string} texto
 * @param {object} deps
 * @returns {string|null} respuesta o null si no es un comando de autoservicio
 */
export function procesarComandoAutoservicio(texto, deps = {}) {
  if (!texto || typeof texto !== 'string') return null;
  const t = texto.trim().toLowerCase();

  // /cuota o /consumo
  if (t === '/cuota' || t === '/consumo' || t === 'cuota' || t === 'consumo') {
    return consultarCuotaTexto(deps.tenantId || TENANT_PROPIETARIO, deps);
  }

  // /planes o /precios
  if (t === '/planes' || t === '/plan' || t === '/precios' || t === 'planes') {
    return listarPlanesTexto();
  }

  // /upgrade <plan> o /cambiar-plan <plan>
  const matchUpgrade = texto.trim().match(/^\/(?:upgrade|cambiar-plan|plan)\s+([a-zA-Z0-9_\-]+)$/i);
  if (matchUpgrade) {
    return procesarUpgradePlan(deps.tenantId || TENANT_PROPIETARIO, matchUpgrade[1], deps);
  }

  return null;
}
