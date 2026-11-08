/**
 * Limites de uso CONFIGURABLES por tenant: cuota diaria y mensual de tokens y
 * limite de peticiones por minuto. Mecanismo, no politica:
 *  - No hay ningun valor por defecto. Sin fila o con NULL = sin limite.
 *  - El propietario NUNCA se limita (solo se mide) y no se le pueden configurar limites.
 *  - Todo es persistente y atomico entre procesos (BEGIN IMMEDIATE).
 * Los tokens se miden DESPUES de cada llamada (libro uso_tokens), asi que una
 * peticion puede rebasar la cuota una vez; la siguiente ya se deniega.
 * "Superada" = usado >= limite.
 *
 * Strict Policy: Zero Emojis.
 */
import { TENANT_PROPIETARIO, afirmarTenantId } from '../../../../core/tenancy.js';
import { diaLocal } from '../../../../services/usageLedgerService.js';

const VENTANA_MS = 60 * 1000;

function limiteValido(v, nombre) {
  if (v === null || v === undefined) return null;
  if (!Number.isInteger(v) || v <= 0) throw new Error(`Limite invalido en ${nombre}: entero positivo o null.`);
  return v;
}

export function crearSqliteLimitesStore(db) {
  const leerFila = db.prepare('SELECT tokens_dia, tokens_mes, peticiones_minuto FROM tenant_limites WHERE tenant_id = ?');
  const guardarFila = db.prepare(`
    INSERT INTO tenant_limites (tenant_id, tokens_dia, tokens_mes, peticiones_minuto, actualizado_en)
    VALUES (@tenant_id, @tokens_dia, @tokens_mes, @peticiones_minuto, @ahora)
    ON CONFLICT(tenant_id) DO UPDATE SET tokens_dia = @tokens_dia, tokens_mes = @tokens_mes,
      peticiones_minuto = @peticiones_minuto, actualizado_en = @ahora
  `);
  const borrarFila = db.prepare('DELETE FROM tenant_limites WHERE tenant_id = ?');
  const tokensRango = db.prepare('SELECT COALESCE(SUM(entrada + salida), 0) AS t FROM uso_tokens WHERE tenant_id = ? AND dia >= ? AND dia <= ?');
  const leerVentana = db.prepare('SELECT n FROM tenant_peticiones WHERE tenant_id = ? AND ventana = ?');
  const sumarVentana = db.prepare(`
    INSERT INTO tenant_peticiones (tenant_id, ventana, n) VALUES (?, ?, 1)
    ON CONFLICT(tenant_id, ventana) DO UPDATE SET n = n + 1
  `);
  const limpiarVentanas = db.prepare('DELETE FROM tenant_peticiones WHERE tenant_id = ? AND ventana < ?');

  const decidir = db.transaction((tenantId, ahora, consumirPeticion) => {
    const fila = leerFila.get(tenantId);
    if (!fila || (fila.tokens_dia === null && fila.tokens_mes === null && fila.peticiones_minuto === null)) {
      return { permitido: true, motivo: 'sin_limites' };
    }
    const dia = diaLocal(ahora);
    const mes = dia.slice(0, 7);
    if (fila.tokens_dia !== null) {
      const usado = tokensRango.get(tenantId, dia, dia).t;
      if (usado >= fila.tokens_dia) return { permitido: false, motivo: 'cuota_diaria', usado, limite: fila.tokens_dia };
    }
    if (fila.tokens_mes !== null) {
      const usado = tokensRango.get(tenantId, `${mes}-01`, `${mes}-31`).t;
      if (usado >= fila.tokens_mes) return { permitido: false, motivo: 'cuota_mensual', usado, limite: fila.tokens_mes };
    }
    if (consumirPeticion && fila.peticiones_minuto !== null) {
      const ventana = Math.floor(ahora.getTime() / VENTANA_MS);
      limpiarVentanas.run(tenantId, ventana);
      const n = (leerVentana.get(tenantId, ventana) || { n: 0 }).n;
      if (n >= fila.peticiones_minuto) {
        return { permitido: false, motivo: 'limite_peticiones', limite: fila.peticiones_minuto, reintentarEnMs: (ventana + 1) * VENTANA_MS - ahora.getTime() };
      }
      sumarVentana.run(tenantId, ventana);
    }
    return { permitido: true, motivo: 'dentro_de_limites' };
  });

  return Object.freeze({
    configurar(tenantId, { tokensDia = null, tokensMes = null, peticionesMinuto = null } = {}, { ahora = new Date() } = {}) {
      afirmarTenantId(tenantId);
      if (tenantId === TENANT_PROPIETARIO) throw new Error('El propietario no admite limites: solo medicion.');
      guardarFila.run({
        tenant_id: tenantId,
        tokens_dia: limiteValido(tokensDia, 'tokensDia'),
        tokens_mes: limiteValido(tokensMes, 'tokensMes'),
        peticiones_minuto: limiteValido(peticionesMinuto, 'peticionesMinuto'),
        ahora: ahora.toISOString()
      });
    },
    quitar(tenantId) { afirmarTenantId(tenantId); borrarFila.run(tenantId); },
    leer(tenantId) {
      afirmarTenantId(tenantId);
      const f = leerFila.get(tenantId);
      return f ? { tokensDia: f.tokens_dia, tokensMes: f.tokens_mes, peticionesMinuto: f.peticiones_minuto } : null;
    },
    /** Decide y, si procede, consume una peticion de la ventana. Propietario: siempre permitido. */
    autorizar({ tenantId = TENANT_PROPIETARIO, ahora = new Date(), consumirPeticion = true } = {}) {
      afirmarTenantId(tenantId);
      if (tenantId === TENANT_PROPIETARIO) return { permitido: true, motivo: 'propietario' };
      return decidir.immediate(tenantId, ahora, consumirPeticion);
    }
  });
}
