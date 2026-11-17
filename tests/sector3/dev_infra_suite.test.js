/**
 * dev_infra_suite.test.js - Verificacion integral de Knowledge Graph, Fallback LLM y Backup Nocturno.
 *
 * Cobertura:
 * 1. Knowledge Graph SQLite multi-tenant (Migracion 015, store, container y jarvisAgent).
 * 2. Fallback LLM con llama-3.3-70b-versatile y destierro total de qwen.
 * 3. Backup nocturno con destino configurado y politica de ultimo backup.
 *
 * Strict Policy: Zero Emojis.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import Database from 'better-sqlite3';

import { MIGRACIONES, ejecutarMigraciones } from '../../src/adapters/outbound/persistence/sqlite/migraciones.js';
import {
  crearSqliteKnowledgeGraphStore,
  knowledgeGraphStore
} from '../../src/adapters/outbound/persistence/sqlite/sqliteDomainStores.js';
import {
  desterrarQwen,
  modelosRespaldoGroq,
  resolverCadenaModelos,
  MODELO_FALLBACK_ROBUSTO,
  reiniciarCircuitoModelos
} from '../../src/core/routerLLM.js';
import {
  chatCompletion,
  resolveCloudConfig
} from '../../src/core/llmService.js';
import {
  ejecutarBackupNocturno,
  iniciarProgramacionBackup,
  detenerProgramacionBackup,
  obtenerEstadoProgramacion,
  RUTA_BACKUP_NOCTURNO_DEFECTO,
  CRON_BACKUP_NOCTURNO_DEFECTO
} from '../../src/services/backupScheduleService.js';
import {
  obtenerContextoGrafo,
  registrarStoreKnowledgeGraphPorDefecto
} from '../../src/services/graphMemoryService.js';

describe('1. Knowledge Graph SQLite Multi-Tenant', () => {
  let db;
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'davis-kg-test-'));
    db = new Database(path.join(tmpDir, 'test_kg.db'));
    ejecutarMigraciones(db);
  });

  it('migracion 015 existe y crea las tablas knowledge_graph con tenant_id e indices', () => {
    const mig015 = MIGRACIONES.find((m) => m.version === 15);
    assert.ok(mig015, 'Migracion 015 debe existir');
    assert.equal(mig015.nombre, '015_knowledge_graph_multitenant');

    const tablaEntidades = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='knowledge_graph_entidades'").get();
    assert.ok(tablaEntidades, 'Tabla knowledge_graph_entidades debe existir');

    const tablaRelaciones = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='knowledge_graph_relaciones'").get();
    assert.ok(tablaRelaciones, 'Tabla knowledge_graph_relaciones debe existir');

    const indicesEntidades = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='knowledge_graph_entidades'").all();
    const nombresIdx = indicesEntidades.map((i) => i.name);
    assert.ok(nombresIdx.includes('idx_kg_entidades_tenant'));
    assert.ok(nombresIdx.includes('idx_kg_entidades_nombre'));
  });

  it('knowledgeGraphStore guarda entidades, relaciones y obtiene grafo por tenant', () => {
    const store = crearSqliteKnowledgeGraphStore(db);

    // Tenant propietario
    store.guardarEntidad({ id: 'mama', nombre: 'Mama', tipo: 'persona' }, 'propietario');
    store.guardarEntidad({ id: 'cumpleanos', nombre: 'Cumpleanos', tipo: 'fecha' }, 'propietario');
    store.guardarRelacion({ origen: 'mama', destino: 'cumpleanos', relacion: 'tiene_evento' }, 'propietario');

    // Tenant secundario aislado
    store.guardarEntidad({ id: 'mama', nombre: 'Mama de Invitado', tipo: 'persona' }, 'invitado');

    const grafoProp = store.obtenerGrafo('propietario');
    assert.ok(grafoProp.nodos.mama);
    assert.equal(grafoProp.nodos.mama.nombre, 'Mama');
    assert.equal(grafoProp.aristas.length, 1);
    assert.equal(grafoProp.aristas[0].relacion, 'tiene_evento');

    const grafoInvitado = store.obtenerGrafo('invitado');
    assert.ok(grafoInvitado.nodos.mama);
    assert.equal(grafoInvitado.nodos.mama.nombre, 'Mama de Invitado');
    assert.equal(grafoInvitado.aristas.length, 0, 'No debe filtrar relaciones de otros tenants');
  });

  it('buscarVecinos resuelve vecindades de entidades por tenantId', () => {
    const store = knowledgeGraphStore(db);

    store.guardarEntidad({ id: 'david', nombre: 'David', tipo: 'persona' }, 'propietario');
    store.guardarEntidad({ id: 'madrid', nombre: 'Madrid', tipo: 'lugar' }, 'propietario');
    store.guardarRelacion({ origen: 'david', destino: 'madrid', relacion: 'vive_en' }, 'propietario');

    const vecinos = store.buscarVecinos('david', 1, 'propietario');
    assert.equal(vecinos.entidad.nombre, 'David');
    assert.equal(vecinos.conexiones.length, 1);
    assert.equal(vecinos.conexiones[0].relacion, 'vive_en');
    assert.equal(vecinos.conexiones[0].hacia.nombre, 'Madrid');

    // Tenant alternativo no ve conexiones
    const vecinosAlt = store.buscarVecinos('david', 1, 'otro_tenant');
    assert.equal(vecinosAlt.entidad, null);
    assert.equal(vecinosAlt.conexiones.length, 0);
  });

  it('importarDesdeJson importa nodos y aristas a SQLite correctamente', () => {
    const store = crearSqliteKnowledgeGraphStore(db);
    const mockData = {
      nodos: {
        madrid: { id: 'madrid', nombre: 'Madrid', tipo: 'lugar' },
        atocha: { id: 'atocha', nombre: 'Atocha', tipo: 'lugar' }
      },
      aristas: [
        { origen: 'atocha', destino: 'madrid', relacion: 'ubicada_en' }
      ]
    };

    const res = store.importarDesdeJson(mockData, 'propietario');
    assert.equal(res.ok, true);
    assert.equal(res.entidades, 2);
    assert.equal(res.relaciones, 1);

    const grafo = store.obtenerGrafo('propietario');
    assert.ok(grafo.nodos.madrid);
    assert.ok(grafo.nodos.atocha);
    assert.equal(grafo.aristas[0].relacion, 'ubicada_en');
  });

  it('obtenerContextoGrafo consume knowledgeGraphStore con soporte multi-tenant', () => {
    const store = crearSqliteKnowledgeGraphStore(db);
    store.guardarEntidad({ id: 'mama', nombre: 'Mama', tipo: 'persona' }, 'propietario');
    store.guardarEntidad({ id: 'regalo_30_eur', nombre: 'Regalo 30 EUR', tipo: 'gasto' }, 'propietario');
    store.guardarRelacion({ origen: 'mama', destino: 'regalo_30_eur', relacion: 'destinataria_de' }, 'propietario');

    const contextoProp = obtenerContextoGrafo('compre un detalle para mama', {
      knowledgeGraphStore: store,
      tenantId: 'propietario'
    });

    assert.ok(contextoProp.includes('Mama'));
    assert.ok(contextoProp.includes('destinataria_de'));
    assert.ok(contextoProp.includes('Regalo 30 EUR'));

    // Tenant ajeno no tiene ese contexto
    const contextoAjeno = obtenerContextoGrafo('compre un detalle para mama', {
      knowledgeGraphStore: store,
      tenantId: 'usuario_externo'
    });
    assert.equal(contextoAjeno, '');
  });
});

describe('2. Fallback LLM y Destierro de Qwen', () => {
  it('desterrarQwen sustituye cualquier variante de Qwen por llama-3.3-70b-versatile', () => {
    assert.equal(desterrarQwen('qwen/qwen3.8-27b'), MODELO_FALLBACK_ROBUSTO);
    assert.equal(desterrarQwen('qwen2.5:3b'), MODELO_FALLBACK_ROBUSTO);
    assert.equal(desterrarQwen('Qwen-72B-Chat'), MODELO_FALLBACK_ROBUSTO);
    assert.equal(desterrarQwen('openai/gpt-oss-120b'), 'openai/gpt-oss-120b');
    assert.equal(desterrarQwen('llama-3.3-70b-versatile'), 'llama-3.3-70b-versatile');
  });

  it('resolveCloudConfig desanitiza modelos qwen y los reemplaza por llama-3.3-70b-versatile', () => {
    const configRes = resolveCloudConfig({
      provider: 'groq',
      apiKey: 'gsk_test',
      model: 'qwen/qwen3.8-27b'
    });
    assert.equal(configRes.model, MODELO_FALLBACK_ROBUSTO);
  });

  it('modelosRespaldoGroq desanitiza cualquier qwen en lista de respaldo', () => {
    const anterior = process.env.GROQ_MODELOS_RESPALDO;
    try {
      process.env.GROQ_MODELOS_RESPALDO = 'qwen2.5:3b,openai/gpt-oss-20b';
      const respaldos = modelosRespaldoGroq();
      assert.ok(!respaldos.includes('qwen2.5:3b'));
      assert.ok(respaldos.includes(MODELO_FALLBACK_ROBUSTO));
      assert.ok(respaldos.includes('openai/gpt-oss-20b'));
    } finally {
      if (anterior === undefined) delete process.env.GROQ_MODELOS_RESPALDO;
      else process.env.GROQ_MODELOS_RESPALDO = anterior;
    }
  });

  it('resolverCadenaModelos construye cadena limpia sin modelos qwen', () => {
    const cadena = resolverCadenaModelos('qwen2.5-coder', { provider: 'groq' });
    assert.equal(cadena[0], MODELO_FALLBACK_ROBUSTO);
    assert.ok(cadena.every((m) => !/qwen/i.test(m)));
  });
});

describe('3. Backup Nocturno Diario con Politica Ultimo Backup', () => {
  let tmpBackupDir;
  let tmpDataDir;

  beforeEach(() => {
    tmpBackupDir = fs.mkdtempSync(path.join(os.tmpdir(), 'davis-backups-'));
    tmpDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'davis-data-'));
    fs.writeFileSync(path.join(tmpDataDir, 'archivo_prueba.txt'), 'contenido de prueba para backup');
  });

  it('ejecuta backup y elimina backups previos dejando unicamente el ultimo', async () => {
    const clave = 'clave-segura-test-12345';

    // Primer backup (simulado hace unos segundos)
    const b1 = await ejecutarBackupNocturno({
      backupDir: tmpBackupDir,
      dataDir: tmpDataDir,
      passphrase: clave,
      date: new Date(Date.now() - 5000),
      sourceFiles: { 'test1.txt': 'contenido 1' }
    });
    assert.ok(fs.existsSync(b1.backupPath));
    assert.equal(b1.backupAnteriorBorrado, false);

    // Segundo backup (nuevo)
    const b2 = await ejecutarBackupNocturno({
      backupDir: tmpBackupDir,
      dataDir: tmpDataDir,
      passphrase: clave,
      date: new Date(),
      sourceFiles: { 'test2.txt': 'contenido 2' }
    });
    assert.ok(fs.existsSync(b2.backupPath));
    assert.equal(b2.backupAnteriorBorrado, true);
    assert.ok(b2.archivosBorrados.length >= 1);

    // Verificar que el primero fue eliminado y solo existe el segundo
    assert.equal(fs.existsSync(b1.backupPath), false, 'El backup anterior debio ser eliminado');
    assert.equal(fs.existsSync(b2.backupPath), true, 'El nuevo backup debe conservarse');

    const archivosRestantes = fs.readdirSync(tmpBackupDir).filter((f) => f.endsWith('.davbak'));
    assert.equal(archivosRestantes.length, 1, 'Debe haber exactamente un solo backup (politica ultimo backup)');
  });

  it('inicia y detiene la programacion cron de backup nocturno', () => {
    let cronEjecutado = false;
    const mockCron = {
      schedule: (expr, fn, opts) => {
        cronEjecutado = true;
        return {
          stop: () => { cronEjecutado = false; }
        };
      }
    };

    const estado = iniciarProgramacionBackup({
      backupDir: tmpBackupDir
    }, { cron: mockCron });

    assert.equal(estado.activo, true);
    assert.equal(estado.cronExpression, CRON_BACKUP_NOCTURNO_DEFECTO);

    const parado = detenerProgramacionBackup();
    assert.equal(parado, true);
  });
});
