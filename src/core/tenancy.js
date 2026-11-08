/**
 * Tenancy: identidad de producto del agente (no de canal).
 *
 * Reglas de este modulo (solo fundamentos locales; nada habilita usuarios):
 *  - Hay UN tenant por defecto, 'propietario'. Todo dato y comportamiento
 *    historico pertenece a el.
 *  - tenantId es obligatorio y validado en cada repositorio con alcance de
 *    tenant. No existe consulta "sin tenant".
 *  - esPropietario(jid) reproduce EXACTAMENTE la resolucion historica de
 *    esMensajeDeDavid (subcadena en telefono/LID y mapeo inverso Baileys).
 *    No amplia ni estrecha lo aceptado: los jid de terceros siguen sin
 *    resolverse a ningun tenant (siguen en el filtro VIP / rele).
 *  - Un identificador desconocido NUNCA crea un tenant.
 *
 * Strict Policy: Zero Emojis.
 */

export const TENANT_PROPIETARIO = 'propietario';

const RE_TENANT = /^[a-z0-9][a-z0-9_-]{0,63}$/;

export function esTenantIdValido(id) {
  return typeof id === 'string' && RE_TENANT.test(id);
}

/** Lanza TypeError si el tenant no es un id valido. Devuelve el id. */
export function afirmarTenantId(id) {
  if (!esTenantIdValido(id)) {
    throw new TypeError(`tenantId invalido: se esperaba un id [a-z0-9_-] (1-64), recibido ${typeof id === 'string' ? JSON.stringify(id.slice(0, 20)) : typeof id}.`);
  }
  return id;
}

/**
 * Resolucion historica del propietario, extraida tal cual del adaptador de canal.
 * @param {string} jid
 * @param {{phone?: string, lid?: string, leerMapeoInverso?: (rawId:string)=>(string|null)}} deps
 */
export function esPropietario(jid, deps = {}) {
  if (!jid) return false;
  const phone = deps.phone;
  const lid = deps.lid;
  if (phone && jid.includes(phone)) return true;
  if (lid && jid.includes(lid)) return true;
  try {
    const rawId = jid.split('@')[0].split(':')[0];
    const mapeado = typeof deps.leerMapeoInverso === 'function' ? deps.leerMapeoInverso(rawId) : null;
    if (typeof mapeado === 'string' && phone && mapeado.includes(phone)) return true;
  } catch { /* sin mapeo legible: no se resuelve */ }
  return false;
}

/**
 * Resuelve el tenant de un identificador de canal.
 *  - propietario si coincide con la resolucion historica;
 *  - tenant registrado si hay una identidad EXACTA en el repositorio;
 *  - null en cualquier otro caso (el llamante mantiene el flujo actual).
 * Nunca crea tenants.
 */
export function resolverTenant(jid, { propietario = {}, repositorioIdentidades = null, canal = 'whatsapp' } = {}) {
  if (esPropietario(jid, propietario)) return TENANT_PROPIETARIO;
  if (repositorioIdentidades && typeof repositorioIdentidades.buscar === 'function' && jid) {
    const id = repositorioIdentidades.buscar(canal, String(jid));
    if (esTenantIdValido(id) && id !== TENANT_PROPIETARIO) return id;
  }
  return null;
}
