/**
 * Composicion de Planes y Presets de Tenants.
 *
 * Re-exporta definiciones y factorias del servicio de cuotas para integracion
 * modular en la raiz de composicion.
 *
 * Strict Policy: Zero Emojis.
 */

export {
  PLANES,
  NOMBRES_PLANES,
  esNombrePlanValido,
  MENSAJES_DENEGACION,
  sanitizarMensajeDenegacion,
  crearTenantQuotaService,
  registrarTenantQuotaServicePorDefecto,
  obtenerTenantQuotaServicePorDefecto
} from '../services/tenantQuotaService.js';
