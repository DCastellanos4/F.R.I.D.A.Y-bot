/**
 * Libro persistente de TOKENS por tenant, dia y modelo efectivo.
 * Cuenta tokens reales devueltos por el proveedor. NO guarda precios ni
 * coste: la estimacion de coste es una capa aparte y marcada como estimacion.
 *
 * Strict Policy: Zero Emojis.
 */
import { TENANT_PROPIETARIO, afirmarTenantId } from '../../../../core/tenancy.js';

export function crearSqliteUsageStore(db) {
  const upsert = db.prepare(`
    INSERT INTO uso_tokens (tenant_id, dia, modelo, entrada, salida, llamadas)
    VALUES (@tenant_id, @dia, @modelo, @entrada, @salida, 1)
    ON CONFLICT(tenant_id, dia, modelo) DO UPDATE SET
      entrada = entrada + @entrada, salida = salida + @salida, llamadas = llamadas + 1
  `);
  const porDia = db.prepare('SELECT modelo, entrada, salida, llamadas FROM uso_tokens WHERE tenant_id = ? AND dia = ? ORDER BY modelo');
  const total = db.prepare('SELECT COALESCE(SUM(entrada),0) e, COALESCE(SUM(salida),0) s, COALESCE(SUM(llamadas),0) l FROM uso_tokens WHERE tenant_id = ? AND dia >= ? AND dia <= ?');

  return Object.freeze({
    registrar({ tenantId = TENANT_PROPIETARIO, dia, modelo, entrada = 0, salida = 0 } = {}) {
      afirmarTenantId(tenantId);
      upsert.run({
        tenant_id: tenantId,
        dia: String(dia).slice(0, 10),
        modelo: String(modelo || 'desconocido').slice(0, 60),
        entrada: Math.max(0, Math.trunc(Number(entrada) || 0)),
        salida: Math.max(0, Math.trunc(Number(salida) || 0))
      });
    },
    diario(tenantId, dia) {
      afirmarTenantId(tenantId);
      return porDia.all(tenantId, String(dia).slice(0, 10));
    },
    rango(tenantId, desde, hasta) {
      afirmarTenantId(tenantId);
      const f = total.get(tenantId, String(desde).slice(0, 10), String(hasta).slice(0, 10));
      return { entrada: f.e, salida: f.s, llamadas: f.l };
    }
  });
}
