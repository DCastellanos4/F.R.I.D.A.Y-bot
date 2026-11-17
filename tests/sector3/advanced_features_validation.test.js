/**
 * advanced_features_validation.test.js - Validacion integral de funcionalidades avanzadas.
 *
 * 1. Knowledge Graph en SQLite con aislamiento multi-tenant.
 * 2. Calendar bidireccional (crear, modificar, cancelar).
 * 3. Viajes/transporte funcional (rutas, tarifas, vigilancia).
 * 4. GitHub autonomo tools.
 * 5. Backup nocturno (creacion en D:\Documentos\DAVIS BACKUPS y politica de borrado del anterior).
 *
 * Strict Policy: Zero Emojis en codigo, cadenas, logs y aserciones.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import Database from 'better-sqlite3';

import '../sector2/setup_aislamiento.mjs';

import { MIGRACIONES, ejecutarMigraciones } from '../../src/adapters/outbound/persistence/sqlite/migraciones.js';
import {
  crearSqliteKnowledgeGraphStore,
  knowledgeGraphStore
} from '../../src/adapters/outbound/persistence/sqlite/sqliteDomainStores.js';
import {
  obtenerContextoGrafo,
  registrarStoreKnowledgeGraphPorDefecto
} from '../../src/services/graphMemoryService.js';

import {
  crearEvento,
  modificarEvento,
  cancelarEvento,
  consultarEventos
} from '../../src/services/calendarService.js';

import {
  consultarPrecioRutaRenfe,
  vigilarRuta,
  listarRutasVigiladas,
  cancelarVigilanciaRuta,
  registrarPrecioRuta,
  comprobarRutasProgramado
} from '../../src/services/viajesService.js';

import {
  crearRamaTrabajo,
  crearCommit,
  empujarRama,
  abrirPullRequest,
  ejecutarTareaProgramacion
} from '../../src/services/githubAgentService.js';

import {
  ejecutarBackupNocturno,
  iniciarProgramacionBackup,
  detenerProgramacionBackup,
  obtenerEstadoProgramacion,
  RUTA_BACKUP_NOCTURNO_DEFECTO,
  CRON_BACKUP_NOCTURNO_DEFECTO
} from '../../src/services/backupScheduleService.js';

import { herramientasJarvis, MAPA_INTENCION_HERRAMIENTAS, NOMBRES_HERRAMIENTAS_JARVIS } from '../../src/core/tools.js';
import { consultarJarvis, analizarIntencion } from '../../src/core/jarvisAgent.js';
import { CLASIFICACION_HERRAMIENTAS } from '../../src/services/rbacService.js';

describe('1. Knowledge Graph en SQLite con aislamiento multi-tenant', () => {
  let db;
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'davis-kg-adv-'));
    db = new Database(path.join(tmpDir, 'test_kg_adv.db'));
    ejecutarMigraciones(db);
  });

  it('migracion 015 crea esquema relacional y entidades con tenant_id e indices', () => {
    const mig015 = MIGRACIONES.find((m) => m.version === 15);
    assert.ok(mig015, 'Migracion 015 debe estar definida');
    assert.equal(mig015.nombre, '015_knowledge_graph_multitenant');

    const tablaEntidades = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='knowledge_graph_entidades'").get();
    assert.ok(tablaEntidades, 'Tabla knowledge_graph_entidades debe existir');

    const tablaRelaciones = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='knowledge_graph_relaciones'").get();
    assert.ok(tablaRelaciones, 'Tabla knowledge_graph_relaciones debe existir');

    const pragmaEnt = db.prepare('PRAGMA table_info(knowledge_graph_entidades)').all();
    const colTenantEnt = pragmaEnt.find((c) => c.name === 'tenant_id');
    assert.ok(colTenantEnt, 'knowledge_graph_entidades debe incluir columna tenant_id');

    const pragmaRel = db.prepare('PRAGMA table_info(knowledge_graph_relaciones)').all();
    const colTenantRel = pragmaRel.find((c) => c.name === 'tenant_id');
    assert.ok(colTenantRel, 'knowledge_graph_relaciones debe incluir columna tenant_id');
  });

  it('aislamiento estricto multi-tenant: guardarEntidad y guardarRelacion no cruzan datos entre tenants', () => {
    const store = crearSqliteKnowledgeGraphStore(db);

    // Tenant Alpha
    store.guardarEntidad({ id: 'servidor_prod', nombre: 'Servidor Principal', tipo: 'proyecto' }, 'tenant_alpha');
    store.guardarEntidad({ id: 'david', nombre: 'David C.', tipo: 'persona' }, 'tenant_alpha');
    store.guardarRelacion({ origen: 'david', destino: 'servidor_prod', relacion: 'administra' }, 'tenant_alpha');

    // Tenant Beta
    store.guardarEntidad({ id: 'servidor_prod', nombre: 'Servidor Aislado Beta', tipo: 'proyecto' }, 'tenant_beta');
    store.guardarEntidad({ id: 'laura', nombre: 'Laura M.', tipo: 'persona' }, 'tenant_beta');
    store.guardarRelacion({ origen: 'laura', destino: 'servidor_prod', relacion: 'supervisa' }, 'tenant_beta');

    const grafoAlpha = store.obtenerGrafo('tenant_alpha');
    const grafoBeta = store.obtenerGrafo('tenant_beta');

    assert.equal(Object.keys(grafoAlpha.nodos).length, 2);
    assert.equal(grafoAlpha.nodos.servidor_prod.nombre, 'Servidor Principal');
    assert.equal(grafoAlpha.aristas.length, 1);
    assert.equal(grafoAlpha.aristas[0].relacion, 'administra');

    assert.equal(Object.keys(grafoBeta.nodos).length, 2);
    assert.equal(grafoBeta.nodos.servidor_prod.nombre, 'Servidor Aislado Beta');
    assert.equal(grafoBeta.aristas.length, 1);
    assert.equal(grafoBeta.aristas[0].relacion, 'supervisa');
  });

  it('buscarVecinos respeta aislamiento por tenantId', () => {
    const store = knowledgeGraphStore(db);

    store.guardarEntidad({ id: 'nodo_central', nombre: 'Nodo Central', tipo: 'concepto' }, 'tenant_x');
    store.guardarEntidad({ id: 'vecino_x', nombre: 'Vecino X', tipo: 'concepto' }, 'tenant_x');
    store.guardarRelacion({ origen: 'nodo_central', destino: 'vecino_x', relacion: 'conecta_con' }, 'tenant_x');

    store.guardarEntidad({ id: 'nodo_central', nombre: 'Nodo Central', tipo: 'concepto' }, 'tenant_y');
    store.guardarEntidad({ id: 'vecino_y', nombre: 'Vecino Y', tipo: 'concepto' }, 'tenant_y');
    store.guardarRelacion({ origen: 'nodo_central', destino: 'vecino_y', relacion: 'asociado_a' }, 'tenant_y');

    const resX = store.buscarVecinos('nodo_central', 1, 'tenant_x');
    assert.equal(resX.conexiones.length, 1);
    assert.equal(resX.conexiones[0].hacia.nombre, 'Vecino X');

    const resY = store.buscarVecinos('nodo_central', 1, 'tenant_y');
    assert.equal(resY.conexiones.length, 1);
    assert.equal(resY.conexiones[0].hacia.nombre, 'Vecino Y');
  });

  it('obtenerContextoGrafo inyecta conocimiento relacional aislado por tenantId', () => {
    const store = crearSqliteKnowledgeGraphStore(db);
    registrarStoreKnowledgeGraphPorDefecto(store);

    store.guardarEntidad({ id: 'david', nombre: 'David', tipo: 'persona' }, 'tenant_seguro');
    store.guardarEntidad({ id: 'madrid', nombre: 'Madrid', tipo: 'lugar' }, 'tenant_seguro');
    store.guardarRelacion({ origen: 'david', destino: 'madrid', relacion: 'reside_en' }, 'tenant_seguro');

    const ctxTenantSeguro = obtenerContextoGrafo('donde vive david', {
      knowledgeGraphStore: store,
      tenantId: 'tenant_seguro'
    });
    assert.ok(ctxTenantSeguro.includes('David'));
    assert.ok(ctxTenantSeguro.includes('reside_en'));
    assert.ok(ctxTenantSeguro.includes('Madrid'));

    const ctxOtroTenant = obtenerContextoGrafo('donde vive david', {
      knowledgeGraphStore: store,
      tenantId: 'tenant_otro'
    });
    assert.equal(ctxOtroTenant, '', 'Tenant sin datos no debe filtrar relaciones de otros');
  });
});

describe('2. Google Calendar bidireccional (crear, modificar, cancelar)', () => {
  let dirTmpCal;
  let rutaArchivoCal;

  beforeEach(() => {
    dirTmpCal = fs.mkdtempSync(path.join(os.tmpdir(), 'davis-cal-adv-'));
    rutaArchivoCal = path.join(dirTmpCal, 'cal_adv.json');
  });

  it('crearEvento, modificarEvento y cancelarEvento gestionan el ciclo completo localmente', async () => {
    const deps = { rutaArchivo: rutaArchivoCal, apiKey: null };

    // 1. Crear
    const resCrear = await crearEvento({
      titulo: 'Reunion Estrategica Q1',
      inicio: '2026-12-05 11:00',
      fin: '2026-12-05 12:30',
      descripcion: 'Revision de objetivos anuales'
    }, deps);

    assert.equal(resCrear.ok, true);
    assert.ok(resCrear.evento.id);
    assert.equal(resCrear.evento.titulo, 'Reunion Estrategica Q1');
    assert.equal(resCrear.fuente, 'local');

    // 2. Modificar
    const resMod = await modificarEvento({
      id: resCrear.evento.id,
      titulo: 'Reunion Estrategica Q1 (Reprogramada)',
      inicio: '2026-12-05 15:00',
      descripcion: 'Actualizacion de horario de sala'
    }, deps);

    assert.equal(resMod.ok, true);
    assert.equal(resMod.evento.titulo, 'Reunion Estrategica Q1 (Reprogramada)');
    assert.equal(resMod.evento.inicio, '2026-12-05 15:00');

    // Consultar rango
    const resCons = await consultarEventos({ desde: '2026-12-01', hasta: '2026-12-31' }, deps);
    assert.equal(resCons.eventos.length, 1);
    assert.equal(resCons.eventos[0].titulo, 'Reunion Estrategica Q1 (Reprogramada)');

    // 3. Cancelar
    const resCanc = await cancelarEvento({ id: resCrear.evento.id }, deps);
    assert.equal(resCanc.ok, true);
    assert.equal(resCanc.cancelados, 1);

    const resConsVacio = await consultarEventos({ desde: '2026-12-01', hasta: '2026-12-31' }, deps);
    assert.equal(resConsVacio.eventos.length, 0);
  });

  it('sincronizacion con Google Calendar v3 API via mock fetch', async () => {
    const llamadasApi = [];
    const mockFetch = async (url, opts = {}) => {
      llamadasApi.push({ url, method: opts.method || 'GET', headers: opts.headers });
      if (opts.method === 'POST') {
        return { ok: true, json: async () => ({ id: 'gcal_evento_101', summary: 'Cita Remota' }) };
      }
      if (opts.method === 'PATCH') {
        return { ok: true, json: async () => ({ id: 'gcal_evento_101', summary: 'Cita Remota Editada' }) };
      }
      return { ok: true, json: async () => ({ items: [] }) };
    };

    const deps = {
      rutaArchivo: rutaArchivoCal,
      apiKey: 'gkey_test_123',
      accessToken: 'gtoken_test_123',
      fetchFn: mockFetch
    };

    const resCrear = await crearEvento({
      titulo: 'Cita Remota',
      inicio: '2026-12-10 10:00'
    }, deps);

    assert.equal(resCrear.ok, true);
    assert.equal(resCrear.evento.id, 'gcal_evento_101');
    assert.equal(resCrear.fuente, 'google');

    const resMod = await modificarEvento({
      id: 'gcal_evento_101',
      titulo: 'Cita Remota Editada'
    }, deps);

    assert.equal(resMod.ok, true);
    assert.equal(resMod.fuente, 'google');
    assert.ok(llamadasApi.some((call) => call.method === 'POST'));
    assert.ok(llamadasApi.some((call) => call.method === 'PATCH'));
  });

  it('despacho de herramientas crear_evento, modificar_evento y cancelar_evento en jarvisAgent', async () => {
    const nombres = herramientasJarvis.map((h) => h.function.name);
    assert.ok(nombres.includes('crear_evento'));
    assert.ok(nombres.includes('modificar_evento'));
    assert.ok(nombres.includes('cancelar_evento'));

    assert.ok(CLASIFICACION_HERRAMIENTAS.datos_propietario.includes('crear_evento'));
    assert.ok(CLASIFICACION_HERRAMIENTAS.datos_propietario.includes('modificar_evento'));
    assert.ok(CLASIFICACION_HERRAMIENTAS.datos_propietario.includes('cancelar_evento'));

    const mockChat = async ({ messages }) => {
      const ultimo = messages[messages.length - 1];
      if (ultimo.role === 'tool') {
        return { message: { role: 'assistant', content: 'Accion confirmada: ' + ultimo.content } };
      }
      return {
        message: {
          role: 'assistant',
          content: null,
          tool_calls: [{
            id: 'call_cal_01',
            type: 'function',
            function: {
              name: 'crear_evento',
              arguments: JSON.stringify({ titulo: 'Demo Calendar', inicio: '2026-12-15 16:00' })
            }
          }]
        }
      };
    };

    const salida = await consultarJarvis('agrega evento Demo Calendar', {
      chatCompletion: mockChat,
      rutaArchivoCalendario: path.join(dirTmpCal, 'cal_bot.json')
    });

    assert.ok(typeof salida === 'string');
    assert.match(salida, /Demo Calendar/);
  });
});

describe('3. Viajes/transporte funcional (rutas, tarifas, vigilancia)', () => {
  let dirTmpViajes;
  let rutaArchivoViajes;

  beforeEach(() => {
    dirTmpViajes = fs.mkdtempSync(path.join(os.tmpdir(), 'davis-viajes-adv-'));
    rutaArchivoViajes = path.join(dirTmpViajes, 'viajes_adv.json');
  });

  it('consultarPrecioRutaRenfe calcula tarifas oficiales para corredores AVE y Cercanias', async () => {
    // AVE Madrid-Barcelona
    const resAve = await consultarPrecioRutaRenfe({
      tipo: 'tren',
      origen: 'Madrid Puerta de Atocha',
      destino: 'Barcelona Sants',
      fecha: '2026-12-24'
    });
    assert.equal(resAve.ok, true);
    assert.equal(resAve.fuente, 'renfe_tarifas_gtfs');
    assert.equal(resAve.moneda, 'EUR');
    assert.match(resAve.servicio, /AVE/);
    assert.ok(resAve.precio >= 30 && resAve.precio <= 70);

    // Cercanias Aravaca - Pozuelo
    const resCer = await consultarPrecioRutaRenfe({
      tipo: 'tren',
      origen: 'Aravaca',
      destino: 'Pozuelo',
      fecha: '2026-12-10'
    });
    assert.equal(resCer.ok, true);
    assert.equal(resCer.servicio, 'Cercanias');
    assert.equal(resCer.precio, 2.6);
  });

  it('vigilancia de ruta y comprobacion programada con aviso de bajadas', async () => {
    const deps = { rutaArchivo: rutaArchivoViajes };

    // 1. Vigilar ruta
    const resVig = vigilarRuta({
      tipo: 'tren',
      origen: 'Madrid',
      destino: 'Valencia',
      fecha: '2026-12-18',
      precioObjetivo: 35.0
    }, deps);

    assert.equal(resVig.ok, true);
    assert.equal(resVig.ruta.precioObjetivo, 35.0);

    const rutas = listarRutasVigiladas(deps);
    assert.equal(rutas.length, 1);
    assert.equal(rutas[0].origen, 'madrid');
    assert.equal(rutas[0].destino, 'valencia');

    // 2. Registrar precio manual
    const resReg = registrarPrecioRuta({
      criterio: rutas[0].id,
      precio: 32.5
    }, deps);
    assert.equal(resReg.ok, true);
    assert.equal(resReg.ruta.historial.length, 1);

    // 3. Comprobacion programada con mock de encolado de alertas
    const alertas = [];
    const resComp = await comprobarRutasProgramado({
      ...deps,
      consultarPrecioRuta: async () => ({ ok: true, precio: 22.0, fuente: 'renfe_test' }),
      enqueue: (alerta) => alertas.push(alerta)
    });

    assert.equal(resComp.ok, true);
    assert.equal(resComp.avisos, 1);
    assert.equal(alertas.length, 1);
    assert.match(alertas[0].title, /Bajada en tu tren/);

    // 4. Cancelar vigilancia
    const resCanc = cancelarVigilanciaRuta({ criterio: rutas[0].id }, deps);
    assert.equal(resCanc.ok, true);
    assert.equal(listarRutasVigiladas(deps).length, 0);
  });

  it('herramientas de viajes registradas y clasificadas en RBAC', () => {
    const nombres = herramientasJarvis.map((h) => h.function.name);
    assert.ok(nombres.includes('vigilar_ruta'));
    assert.ok(nombres.includes('listar_rutas_vigiladas'));
    assert.ok(nombres.includes('cancelar_vigilancia_ruta'));
    assert.ok(nombres.includes('registrar_precio_ruta'));

    assert.ok(CLASIFICACION_HERRAMIENTAS.global_sistema.includes('vigilar_ruta'));
    assert.ok(CLASIFICACION_HERRAMIENTAS.global_sistema.includes('listar_rutas_vigiladas'));
    assert.ok(CLASIFICACION_HERRAMIENTAS.global_sistema.includes('cancelar_vigilancia_ruta'));
    assert.ok(CLASIFICACION_HERRAMIENTAS.global_sistema.includes('registrar_precio_ruta'));
  });
});

describe('4. GitHub autonomo tools', () => {
  it('herramientas registradas en tools.js, mapeadas en MAPA_INTENCION y clasificadas en RBAC', () => {
    const herramientasGit = [
      'crear_rama_trabajo',
      'crear_commit',
      'abrir_pull_request',
      'empujar_rama',
      'ejecutar_tarea_programacion'
    ];

    const nombres = herramientasJarvis.map((h) => h.function.name);
    for (const h of herramientasGit) {
      assert.ok(nombres.includes(h), `Herramienta ${h} debe existir en herramientasJarvis`);
      assert.ok(NOMBRES_HERRAMIENTAS_JARVIS.has(h), `Herramienta ${h} debe estar en NOMBRES_HERRAMIENTAS_JARVIS`);
      const esHostOCred = CLASIFICACION_HERRAMIENTAS.host.includes(h) || CLASIFICACION_HERRAMIENTAS.credenciales.includes(h);
      assert.ok(esHostOCred, `Herramienta ${h} debe estar clasificada en host o credenciales`);
    }

    assert.deepEqual(MAPA_INTENCION_HERRAMIENTAS.github, herramientasGit);
  });

  it('servicios githubAgentService ejecutan comandos git y GitHub API mockeados', async () => {
    const llamadasGit = [];
    const mockExecGit = async (args, cwd) => {
      llamadasGit.push({ args, cwd });
      if (args[0] === 'rev-parse') return 'abc1234';
      if (args[0] === 'status') return 'nothing to commit, working tree clean';
      return 'ok';
    };

    // Crear rama
    const resRama = await crearRamaTrabajo({ nombreRama: 'feat/test-adv', base: 'main' }, { execGit: mockExecGit });
    assert.equal(resRama.ok, true);
    assert.equal(resRama.rama, 'feat/test-adv');

    // Crear commit
    const resCommit = await crearCommit({ mensaje: 'test: commit autonomo', archivos: ['src/'] }, { execGit: mockExecGit });
    assert.equal(resCommit.ok, true);
    assert.equal(resCommit.hash, 'abc1234');

    // Empujar rama
    const resEmpujar = await empujarRama({ rama: 'feat/test-adv' }, {
      token: 'ghp_mock_token_123',
      execGit: mockExecGit
    });
    assert.equal(resEmpujar.ok, true);

    // Abrir PR
    const llamadasFetch = [];
    const mockFetch = async (url, opts = {}) => {
      llamadasFetch.push({ url, body: JSON.parse(opts.body) });
      return {
        ok: true,
        json: async () => ({
          html_url: 'https://github.com/DCastellanos4/F.R.I.D.A.Y-bot/pull/99',
          number: 99,
          title: 'Nueva funcionalidad avanzada',
          state: 'open'
        })
      };
    };

    const resPr = await abrirPullRequest({
      titulo: 'Nueva funcionalidad avanzada',
      cuerpo: 'PR autonomo generado por D.A.V.I.S.',
      rama: 'feat/test-adv',
      base: 'main'
    }, {
      token: 'ghp_mock_token_123',
      fetchFn: mockFetch
    });

    assert.equal(resPr.ok, true);
    assert.equal(resPr.numero, 99);
    assert.equal(llamadasFetch.length, 1);
  });

  it('despacho de herramientas de githubAgentService a traves de jarvisAgent', async () => {
    const mockChatGit = async ({ messages }) => {
      const ultimo = messages[messages.length - 1];
      if (ultimo.role === 'tool') {
        return { message: { role: 'assistant', content: 'Completado: ' + ultimo.content } };
      }
      return {
        message: {
          role: 'assistant',
          content: null,
          tool_calls: [{
            id: 'call_git_01',
            type: 'function',
            function: {
              name: 'crear_commit',
              arguments: JSON.stringify({ mensaje: 'fix: resolver regresion' })
            }
          }]
        }
      };
    };

    const res = await consultarJarvis('haz commit con fix: resolver regresion', {
      chatCompletion: mockChatGit,
      execGit: async () => 'commit ejecutado'
    });

    assert.ok(typeof res === 'string');
    assert.match(res, /fix: resolver regresion/);
  });
});

describe('5. Backup nocturno (creacion en D:\\Documentos\\DAVIS BACKUPS y politica de borrado del anterior)', () => {
  it('ruta de backup nocturno por defecto apunta a D:\\Documentos\\DAVIS BACKUPS y cron a 0 3 * * *', () => {
    assert.equal(CRON_BACKUP_NOCTURNO_DEFECTO, '0 3 * * *');
    if (!process.env.DAVIS_BACKUP_DESTINO) {
      assert.equal(RUTA_BACKUP_NOCTURNO_DEFECTO, 'D:\\Documentos\\DAVIS BACKUPS');
    }
  });

  it('ejecutarBackupNocturno crea nuevo backup y elimina atomica y exclusivamente backups previos', async () => {
    const dirBackupTest = fs.mkdtempSync(path.join(os.tmpdir(), 'davis-backup-adv-'));
    const dirDataOrigen = fs.mkdtempSync(path.join(os.tmpdir(), 'davis-data-adv-'));

    // Primer backup
    const b1 = await ejecutarBackupNocturno({
      backupDir: dirBackupTest,
      dataDir: dirDataOrigen,
      passphrase: 'clave_de_prueba_segura_backup',
      date: new Date(Date.now() - 5000),
      sourceFiles: { 'test1.txt': 'contenido 1' }
    });

    assert.ok(b1.backupPath, 'El primer backup debe tener backupPath valido');
    assert.ok(b1.sizeBytes > 0, 'El primer backup debe tener tamano mayor a cero');
    assert.ok(fs.existsSync(b1.backupPath), 'El primer archivo de backup debe existir');
    assert.equal(b1.backupAnteriorBorrado, false);

    // Segundo backup (nuevo)
    const b2 = await ejecutarBackupNocturno({
      backupDir: dirBackupTest,
      dataDir: dirDataOrigen,
      passphrase: 'clave_de_prueba_segura_backup',
      date: new Date(),
      sourceFiles: { 'test2.txt': 'contenido 2' }
    });

    assert.ok(b2.backupPath, 'El segundo backup debe tener backupPath valido');
    assert.ok(b2.sizeBytes > 0, 'El segundo backup debe tener tamano mayor a cero');
    assert.ok(fs.existsSync(b2.backupPath), 'El nuevo archivo de backup debe existir');
    assert.equal(b2.backupAnteriorBorrado, true);
    assert.ok(b2.archivosBorrados.length >= 1);

    // Politica ultimo backup: b1 debe haber sido eliminado y solo debe quedar b2
    assert.equal(fs.existsSync(b1.backupPath), false, 'El backup anterior debio ser eliminado');
    assert.equal(fs.existsSync(b2.backupPath), true, 'El nuevo backup debe conservarse');

    const archivosRestantes = fs.readdirSync(dirBackupTest).filter((f) => f.endsWith('.davbak'));
    assert.equal(archivosRestantes.length, 1, 'Debe haber exactamente un solo backup (politica ultimo backup)');
  });

  it('iniciarProgramacionBackup y detenerProgramacionBackup gestionan el scheduler', () => {
    const llamadasCron = [];
    let cronDetenido = false;

    const mockCron = {
      schedule: (exp, fn, opts) => {
        llamadasCron.push({ exp, opts });
        return {
          stop: () => { cronDetenido = true; }
        };
      }
    };

    const programacion = iniciarProgramacionBackup({
      cronExpression: '0 4 * * *',
      backupDir: 'D:\\Documentos\\DAVIS BACKUPS'
    }, { cron: mockCron });

    assert.equal(programacion.activo, true);
    assert.equal(programacion.cronExpression, '0 4 * * *');
    assert.equal(llamadasCron.length, 1);

    detenerProgramacionBackup();
    assert.equal(cronDetenido, true);
    assert.equal(obtenerEstadoProgramacion().activo, false);
  });
});
