/**
 * Medicion de tokens por tenant. SOLO MIDE: nunca bloquea ni limita, y un
 * fallo del libro jamas rompe la respuesta al usuario.
 *
 * Sin cuotas numericas, sin tiers, sin precios. Los tokens son los reales que
 * devuelve el proveedor (usage); el coste en euros no se calcula aqui. Un
 * modelo gratuito (p. ej. Groq) no genera cobro atribuible.
 *
 * Strict Policy: Zero Emojis.
 */
import { TENANT_PROPIETARIO, esTenantIdValido } from '../core/tenancy.js';

let storePorDefecto = null;

export function registrarStoreUsoPorDefecto(store) {
  storePorDefecto = store || null;
}

export function diaLocal(d = new Date(), zona = 'Europe/Madrid') {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: zona, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

export function medirUso({ tenantId = TENANT_PROPIETARIO, modelo, usage, store = storePorDefecto, ahora = new Date() } = {}) {
  try {
    if (!store || !usage) return false;
    const entrada = usage.prompt_tokens ?? usage.promptTokens;
    const salida = usage.completion_tokens ?? usage.completionTokens;
    if (!Number.isSafeInteger(entrada) || entrada < 0 || !Number.isSafeInteger(salida) || salida < 0) return false;
    // Sin tenantId (historico) = propietario; un id presente pero invalido NO se
    // atribuye al propietario: no se mide.
    const tid = tenantId === undefined || tenantId === null ? TENANT_PROPIETARIO : tenantId;
    if (!esTenantIdValido(tid)) return false;
    store.registrar({ tenantId: tid, dia: diaLocal(ahora), modelo, entrada, salida });
    return true;
  } catch {
    return false;
  }
}
