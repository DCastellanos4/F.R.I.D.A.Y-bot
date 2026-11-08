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

/**
 * Herramientas que actuan sobre recursos del HOST o del PROPIETARIO sin ninguna
 * opcion de ruta/ambito (domotica y encendido de PC, backups de sesion, auditoria
 * de dependencias, red, servidor, repos, radar de empleo global, digest de notas
 * del propietario, configuracion del sistema). Quedan DENEGADAS a cualquier no
 * propietario aunque alguien las anada a la lista blanca por error.
 */
export const HERRAMIENTAS_SOLO_PROPIETARIO = Object.freeze([
  'encender_pc', 'controlar_domotica', 'estado_descargas', 'estimar_factura_oracle',
  'configurar_aviso_descargas', 'listar_dispositivos_red', 'configurar_vigilancia_red',
  'crear_backup_sesion', 'verificar_backup_sesion', 'auditar_dependencias',
  'configurar_vigilancia_dependencias', 'configurar_informe_metricas', 'actividad_repos',
  'configurar_alertas_repos', 'revisar_pr', 'consultar_estado_servidor',
  'escanear_ofertas_empleo', 'configurar_radar_ofertas', 'generar_digest_cerebro',
  'configurar_digest_semanal', 'configurar_vigilante_procesos'
]);

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
  if (HERRAMIENTAS_SOLO_PROPIETARIO.includes(herramienta)) return { permitido: false, motivo: 'solo_propietario' };
  return permitidasUsuario.includes(herramienta)
    ? { permitido: true, motivo: 'lista_blanca' }
    : { permitido: false, motivo: 'no_en_lista_blanca' };
}
