/**
 * Registro de auditoria de invocaciones de herramientas con cadena de
 * hashes SHA256 (RNF-04 del ERS de proximo nivel).
 *
 * Cada fila enlaza con el hash de la anterior (prev_hash), asi que
 * modificar, borrar o reordenar una fila pasada se detecta con
 * verificarCadena(). Solo se persisten HASHES de argumentos y respuesta:
 * el registro nunca contiene datos del usuario ni secretos.
 *
 * LIMITES DECLARADOS frente al RNF ("registro firmado criptograficamente
 * ... inmutable"): esto es evidencia de integridad por encadenamiento,
 * NO una firma con clave (no hay identidad del firmante) y NO
 * inmutabilidad real (quien tenga escritura sobre la DB puede rehacer la
 * cadena completa). Endurecerlo requeriria anclar el ultimo hash fuera
 * de la DB (p. ej. exportacion periodica firmada): deuda visible.
 *
 * Strict Policy: Zero Emojis.
 */
import crypto from 'node:crypto';
import { TENANT_PROPIETARIO, afirmarTenantId } from '../core/tenancy.js';
import { crearPiiAnonymizer } from './piiAnonymizerService.js';

const GENESIS = 'GENESIS';

function sha256(texto) {
  return crypto.createHash('sha256').update(String(texto), 'utf8').digest('hex');
}

/** Serializacion canonica (claves ordenadas) para hashes estables. */
export function canonizar(valor) {
  if (valor === null || typeof valor !== 'object') return JSON.stringify(valor ?? null);
  if (Array.isArray(valor)) return `[${valor.map(canonizar).join(',')}]`;
  const claves = Object.keys(valor).sort();
  return `{${claves.map((k) => `${JSON.stringify(k)}:${canonizar(valor[k])}`).join(',')}}`;
}

export function crearAuditLogService(db, { anonimizador = null } = {}) {
  if (!db || typeof db.prepare !== 'function') {
    throw new TypeError('crearAuditLogService requiere una base better-sqlite3 abierta.');
  }
  // Los hashes se calculan sobre el contenido ANONIMIZADO: un SHA256 sin
  // clave sobre un telefono o IBAN real seria reversible por diccionario.
  // Limite residual declarado: argumentos no-PII de baja entropia (p. ej.
  // un importe) siguen siendo adivinables por diccionario; endurecerlo
  // requeriria HMAC con clave fuera de la DB.
  const pii = anonimizador || crearPiiAnonymizer();
  const enmascarar = (v) => pii.anonimizar(canonizar(v)).texto;
  const selUltimo = db.prepare('SELECT hash FROM audit_herramientas ORDER BY id DESC LIMIT 1');
  const ins = db.prepare(`
    INSERT INTO audit_herramientas (tenant_id, herramienta, args_sha256, respuesta_sha256, prev_hash, hash, creado_en)
    VALUES (@tenant_id, @herramienta, @args_sha256, @respuesta_sha256, @prev_hash, @hash, @creado_en)
  `);
  const selRango = db.prepare('SELECT * FROM audit_herramientas WHERE id >= ? ORDER BY id');

  function calcularHash(fila) {
    return sha256([
      fila.prev_hash, fila.tenant_id, fila.herramienta,
      fila.args_sha256, fila.respuesta_sha256 ?? '', fila.creado_en
    ].join('|'));
  }

  return Object.freeze({
    /**
     * Registra una invocacion. La insercion y la lectura del ultimo hash
     * van en UNA transaccion inmediata: dos procesos no bifurcan la cadena.
     */
    registrar({ tenantId = TENANT_PROPIETARIO, herramienta, args = {}, respuesta = null, ahora = null } = {}) {
      afirmarTenantId(tenantId);
      if (typeof herramienta !== 'string' || !herramienta.trim()) {
        throw new TypeError('audit.registrar: herramienta obligatoria.');
      }
      const fila = {
        tenant_id: tenantId,
        herramienta: herramienta.trim().slice(0, 80),
        args_sha256: sha256(enmascarar(args)),
        respuesta_sha256: respuesta === null || respuesta === undefined ? null : sha256(enmascarar(respuesta)),
        creado_en: (ahora instanceof Date ? ahora : new Date(ahora ?? Date.now())).toISOString()
      };
      return db.transaction(() => {
        fila.prev_hash = selUltimo.get()?.hash || GENESIS;
        fila.hash = calcularHash(fila);
        ins.run(fila);
        return fila.hash;
      }).immediate();
    },

    /**
     * Recorre la cadena recomputando hashes y enlaces.
     * @returns {{ ok: boolean, filasVerificadas: number, primerError: Object|null }}
     */
    verificarCadena({ desdeId = 1 } = {}) {
      let prev = GENESIS;
      let n = 0;
      for (const fila of selRango.all(desdeId)) {
        n += 1;
        if (fila.prev_hash !== prev) {
          return { ok: false, filasVerificadas: n - 1, primerError: { id: fila.id, causa: 'enlace roto' } };
        }
        if (calcularHash(fila) !== fila.hash) {
          return { ok: false, filasVerificadas: n - 1, primerError: { id: fila.id, causa: 'contenido alterado' } };
        }
        prev = fila.hash;
      }
      return { ok: true, filasVerificadas: n, primerError: null };
    },

    ultimoHash() {
      return selUltimo.get()?.hash || null;
    }
  });
}
