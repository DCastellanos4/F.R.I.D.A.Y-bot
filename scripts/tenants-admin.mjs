#!/usr/bin/env node
/**
 * tenants-admin.mjs - Administracion LOCAL de tenants no propietarios:
 * altas, suspension/reactivacion, permisos, cuotas y conciliacion de
 * medicion pendiente.
 *
 * Por que existe: las altas y la conciliacion son operaciones
 * administrativas deliberadas. Sin este script solo habria SQL manual a
 * mano, sin validacion de catalogo apto, sin transaccion unica y con
 * riesgo de DELETE ciego de marcadores de medicion. Este script es la
 * unica via prevista; NO hay herramienta LLM para estas operaciones.
 *
 * No abre ninguna compuerta: registrar un tenant no lo activa. La
 * compuerta de codigo (AISLAMIENTO_COMPLETO) y la de entorno
 * (DAVIS_TENANTS_ENABLED) siguen cerradas hasta la activacion aprobada.
 * La composicion relee rol/permisos/estado antes de cada efecto, asi que
 * los cambios aplican en caliente, sin reinicio.
 *
 * Uso:
 *   node scripts/tenants-admin.mjs alta --id <tenantId> --nombre <n> --jid <digitos@s.whatsapp.net|digitos@lid>
 *   node scripts/tenants-admin.mjs suspender <tenantId>
 *   node scripts/tenants-admin.mjs reactivar <tenantId>
 *   node scripts/tenants-admin.mjs permisos-listar <tenantId>
 *   node scripts/tenants-admin.mjs permisos-establecer <tenantId> --herramientas <h1,h2,...>
 *   node scripts/tenants-admin.mjs cuotas-ver <tenantId>
 *   node scripts/tenants-admin.mjs cuotas-establecer <tenantId> [--tokens-dia N] [--tokens-mes N] [--peticiones-minuto N]
 *   node scripts/tenants-admin.mjs cuotas-quitar <tenantId>
 *   node scripts/tenants-admin.mjs desvincular --jid <jid> --confirmar DESVINCULAR
 *   node scripts/tenants-admin.mjs estado <tenantId>
 *   node scripts/tenants-admin.mjs conciliar-medicion --tenant <id> --ticket <t> --dia <YYYY-MM-DD> --modelo <m>
 *         --entrada N --salida N --evidencia "<referencia a la evidencia del proveedor>" [--cero-verificado]
 *
 * Configuracion (entorno):
 *   DAVIS_SQLITE_PATH   (defecto data/jarvis.db, misma resolucion que el contenedor)
 *   DAVIS_DATA_DIR      (defecto data)
 *
 * Reglas:
 *   - Cada comando escribe en UNA transaccion (BEGIN IMMEDIATE) o no escribe.
 *   - Ningun comando migra la base por defecto: el esquema lo crea el
 *     arranque normal de la app. Contra una base nueva o incompleta el
 *     comando falla; --migrar aplica las migraciones pendientes de forma
 *     deliberada (aditivas, seguras entre procesos).
 *   - La base debe existir: no se crea un fichero nuevo por accidente.
 *   - Nunca toca datos del propietario ni admite limites para el.
 *   - conciliar-medicion exige cifras verificadas por el operador contra la
 *     evidencia del proveedor; no estima ni infiere. Sin evidencia no hay
 *     desbloqueo: el marcador y el bloqueo se conservan. La conciliacion
 *     queda registrada en tenant_medicion_conciliada (sin contenido privado).
 *
 * Strict Policy: Zero Emojis.
 */
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { DATA_DIR } from '../src/config/paths.js';
import { abrirBaseDatos } from '../src/adapters/outbound/persistence/sqlite/connection.js';
import { ejecutarMigraciones } from '../src/adapters/outbound/persistence/sqlite/migraciones.js';
import { crearSqliteTenantRepository } from '../src/adapters/outbound/persistence/sqlite/sqliteTenantRepository.js';
import { crearSqliteLimitesStore } from '../src/adapters/outbound/persistence/sqlite/sqliteLimitesStore.js';
import { crearSqliteUsageStore } from '../src/adapters/outbound/persistence/sqlite/sqliteUsageStore.js';
import { TENANT_PROPIETARIO, afirmarTenantId } from '../src/core/tenancy.js';
import { diaLocal } from '../src/services/usageLedgerService.js';

const CANAL_WHATSAPP = 'whatsapp';
const RE_JID = /^\d{6,15}@(s\.whatsapp\.net|lid)$/;
const RE_DIA = /^\d{4}-\d{2}-\d{2}$/;
const RE_ENTERO = /^\d+$/;

function uso() {
  console.log(`Uso: node scripts/tenants-admin.mjs <comando> [opciones]
Comandos:
  alta --id <tenantId> --nombre <n> --jid <digitos@s.whatsapp.net|digitos@lid>
  suspender <tenantId>            reactivar <tenantId>
  permisos-listar <tenantId>      permisos-establecer <tenantId> --herramientas <h1,h2,...>
  cuotas-ver <tenantId>           cuotas-establecer <tenantId> [--tokens-dia N] [--tokens-mes N] [--peticiones-minuto N]
  cuotas-quitar <tenantId>
  desvincular --jid <jid> --confirmar DESVINCULAR
  estado <tenantId>
  conciliar-medicion --tenant <id> --ticket <t> --dia <YYYY-MM-DD> --modelo <m> --entrada N --salida N --evidencia "<ref>" [--cero-verificado]
Opciones generales: --db <ruta> (o DAVIS_SQLITE_PATH)   --migrar (aplicar migraciones pendientes, deliberado)`);
}

function fallar(msg) {
  console.error(`Error: ${msg}`);
  process.exit(1);
}

const FLAGS_BOOLEANOS = new Set(['migrar', 'cero-verificado']);
const COMANDOS_LECTURA = new Set(['estado', 'permisos-listar', 'cuotas-ver']);

function parsearFlags(argv) {
  const posicionales = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const clave = a.slice(2);
      if (FLAGS_BOOLEANOS.has(clave)) { flags[clave] = true; }
      else if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) { flags[clave] = argv[++i]; }
      else { flags[clave] = true; }
    } else posicionales.push(a);
  }
  return { posicionales, flags };
}

/** Entero no negativo EXACTO: solo digitos. Rechaza flags sin valor (true), "", " ", "1e3", "0x10". */
function enteroNoNegativo(v, nombre) {
  if (typeof v !== 'string' || !RE_ENTERO.test(v)) {
    fallar(`${nombre} debe ser un entero no negativo en digitos; recibido ${JSON.stringify(v)}.`);
  }
  return Number(v);
}

function exigirJid(jid) {
  if (typeof jid !== 'string' || !RE_JID.test(jid)) {
    fallar('JID invalido: formato exacto <digitos>@s.whatsapp.net o <digitos>@lid (6-15 digitos). Sin inferencias telefono/LID.');
  }
  return jid;
}

/** Cadena obligatoria: rechaza flags sin valor (true), vacias o no string. */
function exigirCadena(v, nombre) {
  if (typeof v !== 'string' || !v.trim()) {
    fallar(`${nombre} debe ser una cadena no vacia; recibido ${JSON.stringify(v)}.`);
  }
  return v.trim();
}

/** Ningun comando de administracion actua sobre el propietario. */
function exigirNoPropietario(id) {
  afirmarTenantId(id);
  if (id === TENANT_PROPIETARIO) fallar('Esta operacion no aplica al propietario: el propietario no se administra por esta via.');
  return id;
}

function exigirTenantRegistrado(repo, id) {
  if (!repo.obtener(id)) fallar(`Tenant '${id}' inexistente.`);
}

function main() {
  // Flags globales (--migrar, --db) valen en cualquier posicion: se parsea
  // todo argv y el comando es el primer posicional.
  const { posicionales, flags } = parsearFlags(process.argv.slice(2));
  const comando = posicionales.shift();
  if (!comando) { uso(); process.exit(1); }

  const rutaDb = typeof flags.db === 'string' && flags.db
    ? flags.db
    : process.env.DAVIS_SQLITE_PATH || path.join(DATA_DIR, 'jarvis.db');
  // Lectura REAL solo lectura: conexion readonly+fileMustExist, sin PRAGMAs
  // (ni journal_mode ni busy_timeout): no escribe en la base ni journal.
  // Dependencia WAL documentada: una base en modo WAL necesita el wal-index
  // (-shm) para leer. Si la base esta viva (bot en marcha) -shm/-wal ya
  // existen y la lectura no escribe datos; si se cerro limpia, SQLite puede
  // recrear -shm/-wal vacios al abrir (bookkeeping de SQLite, no mutacion
  // de datos). Readonly no garantiza cero efectos WAL/SHM. Una copia para
  // --db debe proceder de base cerrada/con escritores detenidos o SQLite
  // backup API; no cp en caliente. No se ignora WAL ni se usa immutable.
  // SQLITE_BUSY falla cerrado, sin reintento automatico.
  // --migrar es una escritura deliberada y fuerza la conexion normal.
  const esLectura = COMANDOS_LECTURA.has(comando) && flags.migrar !== true;
  if (!fs.existsSync(rutaDb)) {
    fallar(`La base no existe en ${rutaDb}. No se crea por accidente: arranca la app una vez o revisa --db/DAVIS_SQLITE_PATH.`);
  }
  const db = esLectura
    ? new Database(rutaDb, { readonly: true, fileMustExist: true })
    : abrirBaseDatos(rutaDb);
  try {
    if (flags.migrar === true) {
      ejecutarMigraciones(db);
      console.log('Migraciones comprobadas/aplicadas (--migrar).');
    }
    let repo, lim, usoStore;
    try {
      repo = crearSqliteTenantRepository(db);
      lim = crearSqliteLimitesStore(db);
      usoStore = crearSqliteUsageStore(db);
    } catch (e) {
      if (/no such table/i.test(String(e && e.message))) {
        fallar(`La base no tiene el esquema esperado (${e.message}). Las migraciones las aplica el arranque de la app; aqui son deliberadas con --migrar.`);
      }
      throw e;
    }

    switch (comando) {
      case 'alta': {
        if (flags.id === undefined || flags.nombre === undefined || flags.jid === undefined) fallar('alta requiere --id, --nombre y --jid.');
        const id = exigirCadena(flags.id, '--id');
        const nombre = exigirCadena(flags.nombre, '--nombre');
        const jid = exigirJid(flags.jid);
        exigirNoPropietario(id);
        const duenyo = repo.identidadRegistrada(CANAL_WHATSAPP, jid);
        if (duenyo) fallar(`Esa identidad ya esta vinculada al tenant '${duenyo}'. No se reasigna en silencio: desvincula primero.`);
        db.transaction(() => {
          repo.registrarTenant({ id, nombre, rol: 'usuario' });
          repo.vincularIdentidad(id, CANAL_WHATSAPP, jid);
        }).immediate();
        console.log(`Tenant '${id}' registrado (rol usuario, estado activo) con identidad whatsapp:${jid}. Sin permisos ni cuotas: whitelist vacia y sin limites hasta configurarlos. La compuerta sigue cerrada; esto NO activa el acceso.`);
        break;
      }
      case 'suspender':
      case 'reactivar': {
        const id = posicionales[0];
        if (!id) fallar(`${comando} requiere <tenantId>.`);
        exigirNoPropietario(id);
        exigirTenantRegistrado(repo, id);
        repo.establecerEstado(id, comando === 'suspender' ? 'suspendido' : 'activo');
        console.log(`Tenant '${id}' ${comando === 'suspender' ? 'suspendido: sus identidades dejan de resolver antes de cualquier efecto' : 'reactivado'}.`);
        break;
      }
      case 'permisos-listar': {
        const id = posicionales[0];
        if (!id) fallar('permisos-listar requiere <tenantId>.');
        afirmarTenantId(id);
        exigirTenantRegistrado(repo, id);
        const lista = repo.leerPermisos(id);
        console.log(lista.length ? lista.join('\n') : `(sin permisos: whitelist vacia, todo denegado a '${id}')`);
        break;
      }
      case 'permisos-establecer': {
        const id = posicionales[0];
        if (!id || typeof flags.herramientas !== 'string') fallar('permisos-establecer requiere <tenantId> y --herramientas <h1,h2,...> (cadena vacia permitida para dejar la whitelist vacia).');
        exigirNoPropietario(id);
        const herramientas = flags.herramientas.split(',').map(s => s.trim()).filter(Boolean);
        repo.configurarPermisos(id, herramientas);
        console.log(`Permisos de '${id}': ${herramientas.length ? herramientas.join(', ') : '(whitelist vacia)'}. Solo clases aptas; la comprobacion sigue antes de cada herramienta.`);
        break;
      }
      case 'cuotas-ver': {
        const id = posicionales[0];
        if (!id) fallar('cuotas-ver requiere <tenantId>.');
        afirmarTenantId(id);
        exigirTenantRegistrado(repo, id);
        const c = lim.leer(id);
        console.log(c ? `tokensDia=${c.tokensDia ?? 'sin limite'} tokensMes=${c.tokensMes ?? 'sin limite'} peticionesMinuto=${c.peticionesMinuto ?? 'sin limite'}` : `(sin fila de limites para '${id}': sin limite)`);
        break;
      }
      case 'cuotas-establecer': {
        const id = posicionales[0];
        if (!id) fallar('cuotas-establecer requiere <tenantId>.');
        exigirNoPropietario(id);
        exigirTenantRegistrado(repo, id);
        // Flags ausentes CONSERVAN el valor ya configurado: establecer una
        // cuota no anula las otras. null explicito solo se logra con cuotas-quitar.
        // Lectura+escritura DENTRO de un BEGIN IMMEDIATE: dos administradores
        // concurrentes no pierden actualizaciones.
        const alguna = flags['tokens-dia'] !== undefined || flags['tokens-mes'] !== undefined || flags['peticiones-minuto'] !== undefined;
        if (!alguna) fallar('Ninguna cuota indicada: no se escribe nada (cuotas-quitar elimina la fila completa).');
        const fijadas = db.transaction(() => {
          const prev = lim.leer(id) || { tokensDia: null, tokensMes: null, peticionesMinuto: null };
          const tokensDia = flags['tokens-dia'] !== undefined ? enteroNoNegativo(flags['tokens-dia'], 'tokens-dia') : prev.tokensDia;
          const tokensMes = flags['tokens-mes'] !== undefined ? enteroNoNegativo(flags['tokens-mes'], 'tokens-mes') : prev.tokensMes;
          const peticionesMinuto = flags['peticiones-minuto'] !== undefined ? enteroNoNegativo(flags['peticiones-minuto'], 'peticiones-minuto') : prev.peticionesMinuto;
          lim.configurar(id, { tokensDia, tokensMes, peticionesMinuto });
          return { tokensDia, tokensMes, peticionesMinuto };
        }).immediate();
        console.log(`Cuotas de '${id}' guardadas (tokensDia=${fijadas.tokensDia ?? '-'} tokensMes=${fijadas.tokensMes ?? '-'} peticionesMinuto=${fijadas.peticionesMinuto ?? '-'}). Con cuota de tokens, cada llamada queda serializada por marcador de medicion pendiente.`);
        break;
      }
      case 'cuotas-quitar': {
        const id = posicionales[0];
        if (!id) fallar('cuotas-quitar requiere <tenantId>.');
        exigirNoPropietario(id);
        exigirTenantRegistrado(repo, id);
        lim.quitar(id);
        console.log(`Limites de '${id}' eliminados: pasa a sin limite. No toca el libro de uso ni marcadores.`);
        break;
      }
      case 'desvincular': {
        if (!flags.jid) fallar('desvincular requiere --jid.');
        exigirJid(flags.jid);
        if (flags.confirmar !== 'DESVINCULAR') fallar('Confirmacion requerida: --confirmar DESVINCULAR. La desvinculacion deja al remitente en el carril historico de desconocidos.');
        const duenyo = repo.identidadRegistrada(CANAL_WHATSAPP, flags.jid);
        if (!duenyo) fallar('Esa identidad no esta registrada.');
        if (duenyo === TENANT_PROPIETARIO) fallar('No se desvincula nada del propietario.');
        const r = db.prepare('DELETE FROM identidades WHERE canal = ? AND identificador = ?').run(CANAL_WHATSAPP, flags.jid);
        if (r.changes !== 1) throw new Error('Desvinculacion inesperada: cambios != 1.');
        console.log(`Identidad whatsapp:${flags.jid} desvinculada de '${duenyo}'. El tenant conserva sus datos, permisos y cuotas.`);
        break;
      }
      case 'estado': {
        const id = posicionales[0];
        if (!id) fallar('estado requiere <tenantId>.');
        afirmarTenantId(id);
        const t = repo.obtener(id);
        if (!t) fallar(`Tenant '${id}' inexistente.`);
        const identidades = db.prepare('SELECT canal, identificador, creada_en FROM identidades WHERE tenant_id = ? ORDER BY creada_en').all(id);
        const permisos = repo.leerPermisos(id);
        const cuotas = lim.leer(id);
        const hoy = diaLocal(new Date());
        const mes = hoy.slice(0, 7);
        const usoHoy = usoStore.rango(id, hoy, hoy);
        const usoMes = usoStore.rango(id, `${mes}-01`, `${mes}-31`);
        const pendiente = db.prepare('SELECT ticket, iniciada_en FROM tenant_medicion_pendiente WHERE tenant_id = ?').get(id);
        console.log([
          `tenant: ${t.id} (${t.nombre}) rol=${t.rol} estado=${t.estado} creado=${t.creado_en}`,
          `identidades: ${identidades.length ? identidades.map(i => `${i.canal}:${i.identificador}`).join(', ') : 'ninguna'}`,
          `permisos: ${permisos.length ? permisos.join(', ') : '(whitelist vacia)'}`,
          `cuotas: ${cuotas ? `tokensDia=${cuotas.tokensDia ?? '-'} tokensMes=${cuotas.tokensMes ?? '-'} peticionesMinuto=${cuotas.peticionesMinuto ?? '-'}` : 'sin limite'}`,
          `uso hoy (${hoy}): entrada=${usoHoy.entrada} salida=${usoHoy.salida} llamadas=${usoHoy.llamadas}`,
          `uso mes (${mes}): entrada=${usoMes.entrada} salida=${usoMes.salida} llamadas=${usoMes.llamadas}`,
          `medicion pendiente: ${pendiente ? `ticket=${pendiente.ticket} desde=${pendiente.iniciada_en} (BLOQUEADO hasta conciliar con evidencia)` : 'ninguna'}`
        ].join('\n'));
        break;
      }
      case 'conciliar-medicion': {
        const tenant = exigirCadena(flags.tenant, '--tenant');
        const ticket = exigirCadena(flags.ticket, '--ticket');
        const dia = exigirCadena(flags.dia, '--dia');
        const modelo = exigirCadena(flags.modelo, '--modelo');
        const evidencia = flags.evidencia === undefined ? undefined : exigirCadena(flags.evidencia, '--evidencia');
        if (evidencia === undefined) {
          fallar('Requiere --tenant, --ticket, --dia, --modelo y --evidencia (referencia a la evidencia verificable del proveedor; nunca prompts ni secretos).');
        }
        exigirNoPropietario(tenant);
        exigirTenantRegistrado(repo, tenant);
        if (!RE_DIA.test(dia)) fallar('--dia debe ser YYYY-MM-DD.');
        const entrada = enteroNoNegativo(flags.entrada, 'entrada');
        const salida = enteroNoNegativo(flags.salida, 'salida');
        if (entrada === 0 && salida === 0 && flags['cero-verificado'] !== true) {
          fallar('Consumo cero solo se acepta con --cero-verificado (la evidencia del proveedor debe demostrar cero; un error HTTP o una respuesta vacia NO lo demuestran).');
        }
        const evidenciaCorta = evidencia.trim().slice(0, 200);
        // Lectura del marcador, comparacion del ticket, incremento y
        // confirmacion DENTRO del mismo BEGIN IMMEDIATE: dos conciliaciones
        // concurrentes no pueden pasar ambas la comprobacion ni sumar dos
        // veces. confirmarMedicion ademas falla si el ticket ya no esta,
        // revirtiendo toda la transaccion.
        const resultado = db.transaction(() => {
          const pendiente = db.prepare('SELECT ticket, iniciada_en FROM tenant_medicion_pendiente WHERE tenant_id = ?').get(tenant);
          if (!pendiente) return { error: `No hay medicion pendiente para '${tenant}': nada que conciliar. No se escribe nada.` };
          if (pendiente.ticket !== ticket) return { error: `El ticket no coincide con el pendiente (iniciado ${pendiente.iniciada_en}). No se escribe nada.` };
          const previo = usoStore.diario(tenant, dia).find(f => f.modelo === String(modelo).slice(0, 60));
          usoStore.registrar({ tenantId: tenant, dia, modelo, entrada, salida });
          lim.confirmarMedicion(tenant, ticket);
          db.prepare(`INSERT INTO tenant_medicion_conciliada
            (tenant_id, ticket, dia, modelo, entrada, salida, evidencia, conciliada_en)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
            .run(tenant, ticket, dia, String(modelo).slice(0, 60), entrada, salida, evidenciaCorta, new Date().toISOString());
          return { previo };
        }).immediate();
        if (resultado.error) fallar(resultado.error);
        const hoy = diaLocal(new Date());
        const mes = hoy.slice(0, 7);
        const usoMes = usoStore.rango(tenant, `${mes}-01`, `${mes}-31`);
        const decision = lim.autorizar({ tenantId: tenant, consumirPeticion: false });
        console.log([
          `Conciliado '${tenant}' ticket=${ticket}: +${entrada} entrada / +${salida} salida en ${dia} modelo=${modelo}${resultado.previo ? ` (ya habia ${resultado.previo.entrada}/${resultado.previo.salida} registrados ese dia/modelo; se han sumado)` : ''}.`,
          `Evidencia registrada en tenant_medicion_conciliada: ${evidenciaCorta}`,
          `Uso mes actual (${mes}): ${usoMes.entrada + usoMes.salida} tokens. Autorizacion ahora: ${decision.permitido ? 'permitido' : `DENEGADO (${decision.motivo})`}.`,
          decision.permitido ? '' : 'Conciliar no resetea una cuota agotada: el tenant sigue bloqueado por cuota, no por marcador.'
        ].filter(Boolean).join('\n'));
        break;
      }
      default:
        uso();
        fallar(`Comando desconocido: ${comando}`);
    }
  } finally {
    db.close();
  }
}

try {
  main();
} catch (e) {
  fallar(e.message);
}
