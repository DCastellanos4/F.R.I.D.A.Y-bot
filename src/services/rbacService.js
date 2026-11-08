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
 * Clasificacion por IMPACTO de TODO el catalogo de herramientas. Un tenant no
 * propietario solo puede ejecutar una herramienta si (1) esta en su lista blanca
 * Y (2) su clase es apta. Toda herramienta sin clasificar (nueva o desconocida)
 * se deniega. La lista blanca no puede ampliar nada fuera de las clases aptas.
 *
 *  host              ejecuta/afecta al servidor, red, ficheros o navegador del host
 *  credenciales      usa tokens, claves o secretos del propietario
 *  identidad         identidad/VIP/permisos o codigo ejecutable (skills)
 *  terceros          envia/lee mensajes con otras personas como el propietario
 *  global_sistema    monitores, colas o configuracion del sistema con canal del propietario
 *  datos_propietario datos personales aun SIN aislar por tenant
 *  datos_tenant      datos con ruta/ambito de tenant verificados con test de servicio
 *  sin_estado        consulta externa o utilidad cuyo UNICO origen de datos es la entrada del
 *                    tenant o una fuente publica fija (verificado leyendo el camino de datos)
 */
export const CLASIFICACION_HERRAMIENTAS = Object.freeze({
  host: [
    'execute_bash_command', 'manage_tunnel', 'trigger_encrypted_backup', 'get_infrastructure_status',
    'encender_pc', 'controlar_domotica', 'estado_descargas', 'estimar_factura_oracle',
    'configurar_aviso_descargas', 'listar_dispositivos_red', 'configurar_vigilancia_red',
    'crear_backup_sesion', 'verificar_backup_sesion', 'auditar_dependencias',
    'configurar_vigilancia_dependencias', 'informe_metricas', 'configurar_informe_metricas',
    'consultar_estado_servidor', 'descargar_multimedia', 'capturar_pagina', 'navegar_y_leer_noticia',
    'resumir_enlace', 'generar_wiki', 'generar_changelog', 'verificar_oferta', 'proximas_llegadas_transporte', 'registrar_parada_favorita',
    'listar_paradas_favoritas', 'eliminar_parada_favorita'
  ],
  credenciales: [
    'generate_crypto_credential', 'confirm_bash_otp', 'actividad_repos', 'configurar_alertas_repos', 'revisar_pr'
  ],
  identidad: [
    'activar_modo_vip', 'estado_modo_vip', 'agregar_contacto_vip', 'ejecutar_skill', 'proponer_skill', 'listar_skills'
  ],
  terceros: [
    'programar_mensaje_whatsapp', 'listar_mensajes_programados', 'cancelar_mensaje_programado',
    'resumir_grupo', 'estadisticas_grupo', 'enviar_contacto_vcard', 'crear_encuesta_whatsapp',
    'redactar_invitacion', 'sugerir_respuestas', 'activar_traductor', 'desactivar_traductor',
    'buscar_en_historial', 'explicar_recorrido'
  ],
  global_sistema: [
    'escanear_ofertas_empleo', 'configurar_radar_ofertas', 'generar_digest_cerebro', 'configurar_digest_semanal',
    'configurar_vigilante_procesos', 'vigilar_proceso', 'listar_procesos_vigilados', 'dejar_vigilar_proceso',
    'configurar_modo_nocturno', 'configurar_avisos_suscripciones', 'configurar_avisos_fechas',
    'configurar_repaso_flashcards', 'programar_recordatorios_estudio', 'crear_recordatorio',
    'listar_recordatorios', 'cancelar_recordatorio', 'vigilar_producto', 'listar_productos_vigilados',
    'cancelar_vigilancia', 'programar_snooze', 'listar_snoozes', 'cancelar_snooze',
    'registrar_aviso_llegada', 'listar_avisos_llegada', 'cancelar_aviso_llegada',
    'vigilar_ruta', 'listar_rutas_vigiladas', 'cancelar_vigilancia_ruta', 'registrar_precio_ruta',
    'repasar_flashcards', 'responder_flashcard', 'crear_flashcard'
  ],
  datos_propietario: [
    'planificar_estudio', 'listar_planes_estudio', 'registrar_avance_estudio', 'registrar_candidatura',
    'listar_candidaturas', 'actualizar_candidatura', 'guardar_nota_personal', 'listar_notas_recientes',
    'registrar_gasto', 'listar_gastos', 'resumen_gastos_mes', 'registrar_suscripcion', 'listar_suscripciones',
    'configurar_presupuesto', 'estado_presupuestos', 'escribir_diario', 'leer_diario', 'preguntar_documentos',
    'sugerir_menu', 'recomendar_serie_pelicula', 'iniciar_simulacro_entrevista', 'analizar_cv_oferta',
    'resumir_apuntes', 'priorizar_ideas', 'consultar_clima'
  ],
  datos_tenant: [
    'guardar_memoria', 'buscar_memoria', 'listar_memorias', 'olvidar_memoria', 'buscar_recuerdo_semantico',
    'registrar_contacto', 'buscar_contacto', 'listar_contactos', 'registrar_habito', 'marcar_habito',
    'listar_habitos', 'anadir_compra', 'listar_compra', 'tachar_compra', 'vaciar_compra', 'anotar_idea',
    'listar_ideas', 'poner_menu', 'ver_menu', 'crear_quedada', 'listar_quedadas', 'registrar_entrega',
    'listar_entregas', 'eliminar_entrega', 'registrar_fecha_senalada', 'listar_fechas_senaladas',
    'eliminar_fecha_senalada'
  ],
  sin_estado: [
    'obtener_noticias_actuales', 'resumen_deportivo', 'buscar_producto', 'guiar_depuracion'
  ]
});

export const CLASES_APTAS_TENANT = Object.freeze(['datos_tenant', 'sin_estado']);

export function claseDeHerramienta(nombre) {
  for (const [clase, lista] of Object.entries(CLASIFICACION_HERRAMIENTAS)) {
    if (lista.includes(nombre)) return clase;
  }
  return null;
}

// Compatibilidad: todo lo que NO es apto para un tenant por su clase.
export const HERRAMIENTAS_SOLO_PROPIETARIO = Object.freeze(
  Object.entries(CLASIFICACION_HERRAMIENTAS)
    .filter(([clase]) => !CLASES_APTAS_TENANT.includes(clase))
    .flatMap(([, lista]) => lista)
);

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
  const clase = claseDeHerramienta(herramienta);
  if (clase === null) return { permitido: false, motivo: 'sin_clasificar' };
  if (!CLASES_APTAS_TENANT.includes(clase)) return { permitido: false, motivo: 'solo_propietario' };
  return permitidasUsuario.includes(herramienta)
    ? { permitido: true, motivo: 'lista_blanca' }
    : { permitido: false, motivo: 'no_en_lista_blanca' };
}
