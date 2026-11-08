/**
 * RBAC de herramientas: DENEGADO POR DEFECTO para todo lo que no sea el
 * propietario.
 *
 *  - propietario: todas las herramientas, exactamente como hoy.
 *  - tenantId ausente (llamantes historicos, todos del propietario): propietario.
 *  - cualquier otro tenant: solo las herramientas de su lista blanca explicita.
 *    La lista por defecto esta VACIA: ningun tenant no propietario ejecuta nada
 *    hasta que se apruebe una lista. Tenant o herramienta desconocidos: denegado.
 *
 * Strict Policy: Zero Emojis.
 */
import { TENANT_PROPIETARIO, esTenantIdValido } from '../core/tenancy.js';

export const HERRAMIENTAS_PERMITIDAS_USUARIO_POR_DEFECTO = Object.freeze([]);

export function puedeEjecutarHerramienta({
  tenantId,
  herramienta,
  catalogo = null,
  permitidasUsuario = HERRAMIENTAS_PERMITIDAS_USUARIO_POR_DEFECTO,
  rolDe = null
} = {}) {
  if (tenantId === undefined || tenantId === null || tenantId === TENANT_PROPIETARIO) {
    return { permitido: true, motivo: 'propietario' };
  }
  if (!esTenantIdValido(tenantId)) return { permitido: false, motivo: 'tenant_invalido' };
  const rol = typeof rolDe === 'function' ? rolDe(tenantId) : null;
  if (rol !== 'usuario') return { permitido: false, motivo: 'tenant_desconocido' };
  if (typeof herramienta !== 'string' || !herramienta) return { permitido: false, motivo: 'herramienta_invalida' };
  if (catalogo && !catalogo.has(herramienta)) return { permitido: false, motivo: 'herramienta_desconocida' };
  return permitidasUsuario.includes(herramienta)
    ? { permitido: true, motivo: 'lista_blanca' }
    : { permitido: false, motivo: 'no_en_lista_blanca' };
}
