/**
 * routerLLM.js - Router de modelos LLM con failover y circuito de seguridad.
 *
 * Soporte robusto para llama-3.3-70b-versatile como modelo de respaldo y
 * politica de destierro total de modelos Qwen en entornos Groq/Cloud.
 *
 * Strict Policy: Zero Emojis.
 */

import { reiniciarPresupuestosGroq } from './groqBudget.js';

export const MODELO_FALLBACK_ROBUSTO = 'llama-3.3-70b-versatile';
export const MODELO_PRIMARIO_DEFECTO = 'openai/gpt-oss-120b';

export const circuitoModelos = new Map(); // modelo -> { hasta: epochMs, motivo: 'cuota' | 'temporal' }
export const MAX_INTENTOS_POR_MODELO = 2;
export const ESPERA_MAX_REINTENTO_MS = 10000;

/**
 * Destierra cualquier variante de modelo Qwen y la sustituye por llama-3.3-70b-versatile.
 */
export function desterrarQwen(modelo) {
  if (!modelo || typeof modelo !== 'string') return MODELO_FALLBACK_ROBUSTO;
  if (/qwen/i.test(modelo)) {
    console.warn(`[RouterLLM] Modelo Qwen (${modelo}) desterrado. Reemplazando por ${MODELO_FALLBACK_ROBUSTO}.`);
    return MODELO_FALLBACK_ROBUSTO;
  }
  return modelo;
}

/**
 * Resuelve la lista de modelos de respaldo para Groq.
 */
export function modelosRespaldoGroq() {
  const crudo = process.env.GROQ_MODELOS_RESPALDO || 'openai/gpt-oss-20b';
  return crudo
    .split(',')
    .map((m) => m.trim())
    .filter(Boolean)
    .map((m) => desterrarQwen(m));
}

/**
 * Determina si un error HTTP o de red amerita conmutar al modelo de respaldo.
 */
export function esErrorConmutable(err) {
  const status = err?.status ?? err?.statusCode ?? err?.response?.status;
  if (status === 429) return true;
  if (typeof status === 'number' && status >= 500 && status < 600) return true;
  if (status == null) {
    const texto = `${err?.name || ''} ${err?.code || ''} ${err?.message || ''}`;
    if (/timeout|connection|network|econn|eai_again|socket|fetch failed/i.test(texto)) return true;
  }
  return false;
}

/**
 * Extrae los segundos de espera indicados por la cabecera retry-after.
 */
export function segundosRetryAfter(err) {
  const h = err?.headers;
  const bruto = typeof h?.get === 'function' ? h.get('retry-after') : (h?.['retry-after'] ?? h?.['Retry-After']);
  if (bruto == null) return null;
  const n = Number(bruto);
  if (Number.isFinite(n)) return Math.max(0, n);
  const fecha = Date.parse(bruto);
  return Number.isFinite(fecha) ? Math.max(0, Math.round((fecha - Date.now()) / 1000)) : null;
}

/**
 * Resuelve la cadena de conmutacion garantizando que no existan modelos Qwen
 * y que llama-3.3-70b-versatile este disponible si se solicita.
 */
export function resolverCadenaModelos(modeloPrincipal, opciones = {}) {
  const principal = desterrarQwen(modeloPrincipal || MODELO_PRIMARIO_DEFECTO);
  const cadena = [principal];

  const esGroq = opciones.provider === 'groq' || (opciones.baseUrl || '').includes('groq.com');
  if (esGroq) {
    for (const m of modelosRespaldoGroq()) {
      const saneado = desterrarQwen(m);
      if (!cadena.includes(saneado)) cadena.push(saneado);
    }
  }

  return cadena;
}

/**
 * Limpia el circuito de modelos aparcados (solo para pruebas o reinicios).
 */
export function reiniciarCircuitoModelos() {
  circuitoModelos.clear();
  reiniciarPresupuestosGroq();
}
