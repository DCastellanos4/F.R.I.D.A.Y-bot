/**
 * Repositorio de tenants e identidades (SQLite). Solo ALTA EXPLICITA: ningun
 * camino de lectura crea tenants ni identidades. Hoy no hay alta alguna salvo
 * el tenant 'propietario' sembrado por la migracion 002.
 *
 * Strict Policy: Zero Emojis.
 */
import { CLASES_APTAS_TENANT, claseDeHerramienta } from '../../../../services/rbacService.js';
import { TENANT_PROPIETARIO, afirmarTenantId } from '../../../../core/tenancy.js';

const ROLES = new Set(['propietario', 'usuario']);

export function crearSqliteTenantRepository(db, deps = {}) {
  const ahora = deps.ahora || (() => new Date().toISOString());
  const insTenant = db.prepare('INSERT INTO tenants (id, nombre, rol, estado, creado_en) VALUES (?, ?, ?, ?, ?)');
  const getTenant = db.prepare('SELECT id, nombre, rol, estado, creado_en FROM tenants WHERE id = ?');
  const insIdent = db.prepare('INSERT INTO identidades (tenant_id, canal, identificador, creada_en) VALUES (?, ?, ?, ?)');
  const getIdent = db.prepare('SELECT tenant_id FROM identidades WHERE canal = ? AND identificador = ?');

  const permisos = db.prepare('SELECT herramienta FROM tenant_herramientas WHERE tenant_id = ? ORDER BY herramienta');
  const quitarPermisos = db.prepare('DELETE FROM tenant_herramientas WHERE tenant_id = ?');
  const ponerPermiso = db.prepare('INSERT INTO tenant_herramientas (tenant_id,herramienta) VALUES (?,?)');
  const estado = db.prepare('UPDATE tenants SET estado = ? WHERE id = ?');

  return Object.freeze({
    /** Alta explicita. No permite crear otro 'propietario'. */
    registrarTenant({ id, nombre, rol = 'usuario' } = {}) {
      afirmarTenantId(id);
      if (id === TENANT_PROPIETARIO) throw new Error('El tenant propietario ya existe y no se puede crear de nuevo.');
      if (!ROLES.has(rol) || rol === 'propietario') throw new Error('Rol invalido: un tenant nuevo solo puede ser "usuario".');
      if (typeof nombre !== 'string' || !nombre.trim()) throw new Error('nombre requerido.');
      insTenant.run(id, nombre.trim().slice(0, 80), rol, 'activo', ahora());
      return getTenant.get(id);
    },
    configurarPermisos(id, herramientas) {
      afirmarTenantId(id);
      if (id === TENANT_PROPIETARIO || !getTenant.get(id)) throw new Error('Solo tenants registrados no propietarios.');
      if (!Array.isArray(herramientas) || herramientas.some(h => !CLASES_APTAS_TENANT.includes(claseDeHerramienta(h)))) throw new Error('Capacidad fuera del catalogo apto.');
      db.transaction(() => { quitarPermisos.run(id); for (const h of new Set(herramientas)) ponerPermiso.run(id,h); }).immediate();
    },
    leerPermisos(id) { afirmarTenantId(id); return permisos.all(id).map(f => f.herramienta); },
    establecerEstado(id, valor) {
      afirmarTenantId(id);
      if (id === TENANT_PROPIETARIO || !['activo','suspendido'].includes(valor)) throw new Error('Estado/tenant invalido.');
      if (estado.run(valor,id).changes !== 1) throw new Error('Tenant inexistente.');
    },
    obtener(id) {
      afirmarTenantId(id);
      return getTenant.get(id) || null;
    },
    /** Vincula una identidad EXACTA de canal a un tenant existente y activo. */
    vincularIdentidad(tenantId, canal, identificador) {
      afirmarTenantId(tenantId);
      if (tenantId === TENANT_PROPIETARIO) throw new Error('El propietario se resuelve por configuracion, no por identidades en BD.');
      const t = getTenant.get(tenantId);
      if (!t || t.estado !== 'activo') throw new Error('Tenant inexistente o inactivo.');
      if (typeof canal !== 'string' || !canal || typeof identificador !== 'string' || !identificador) throw new Error('canal e identificador requeridos.');
      insIdent.run(tenantId, canal, identificador, ahora());
      return { ok: true };
    },
    /** Coincidencia EXACTA. Devuelve tenantId o null. Nunca crea nada. */
    buscar(canal, identificador) {
      const f = getIdent.get(String(canal), String(identificador));
      if (!f) return null;
      const t = getTenant.get(f.tenant_id);
      return t && t.estado === 'activo' ? t.id : null;
    }
  });
}
