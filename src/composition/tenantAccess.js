/** Enrutamiento solo por identidad autenticada por el adaptador confiable.
 * No lee tenantId, rol ni permisos del texto/metadata/opciones de consulta.
 * No registra identidades, tenants ni cuotas. No abre el gate publico.
 */
import { createHash } from 'node:crypto';
import { TENANT_PROPIETARIO } from '../core/tenancy.js';

export function crearAccesoTenants({ autenticar, esPropietario, tenantRepository, limitesStore, quotaService } = {}) {
  const storeUso = quotaService || limitesStore;
  if (typeof autenticar !== 'function' || typeof esPropietario !== 'function' || !tenantRepository || !storeUso) throw new TypeError('Acceso tenant requiere autenticador y repositorios confiables.');
  return Object.freeze({
    async resolver(inbound) {
      let identidad;
      try { identidad = await autenticar(inbound); } catch { return null; }
      if (!identidad || typeof identidad.canal !== 'string' || !identidad.canal || typeof identidad.identificador !== 'string' || !identidad.identificador) return null;
      const chatId = identidad.canal + ':' + createHash('sha256').update(identidad.identificador).digest('hex');
      if (esPropietario(identidad) === true) return { tenantId: TENANT_PROPIETARIO, chatId };
      const tid = tenantRepository.buscar(identidad.canal, identidad.identificador);
      if (!tid || tid === TENANT_PROPIETARIO) return null;
      const t = tenantRepository.obtener(tid);
      if (!t || t.estado !== 'activo' || t.rol !== 'usuario') return null;
      const vinculada = (id) => id === tid && tenantRepository.buscar(identidad.canal,identidad.identificador) === tid;
      return {
        tenantId: tid, chatId,
        // Se relee el estado en cada control de herramienta. No cachear roles
        // ni listas de permisos en el canal despues de una revocacion.
        rolDeTenant: (id) => { if (!vinculada(id)) return null; const actual = tenantRepository.obtener(id); return actual?.estado === 'activo' ? actual.rol : null; },
        permitidasUsuario: [],
        permisosDeTenant: (id) => vinculada(id) ? tenantRepository.leerPermisos(id) : [],
        controlUso: storeUso
      };
    }
  });
}
