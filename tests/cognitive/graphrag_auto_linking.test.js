import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { ejecutarMigraciones } from '../../src/adapters/outbound/persistence/sqlite/migraciones.js';
import { crearSqliteKnowledgeGraphStore } from '../../src/adapters/outbound/persistence/sqlite/sqliteDomainStores.js';
import {
  extraerRelacionesDeTexto,
  procesarTurnoConversacionParaGrafo
} from '../../src/services/knowledgeGraphAutoExtractor.js';
import {
  recuperarSubgrafoContextual,
  obtenerContextoGrafo
} from '../../src/services/graphMemoryService.js';

test('extraerRelacionesDeTexto captura proyectos, estudios, examenes, empleo y suscripciones', () => {
  const texto = 'Estoy trabajando en el proyecto DAVIS, el bot DAVIS usa Nodejs, estudio Sistemas Distribuidos, el examen de Sistemas Distribuidos es el 2026-12-18, tengo una entrevista en Google y estoy suscrito a Spotify.';
  const tripletas = extraerRelacionesDeTexto(texto);
  const rels = tripletas.map((t) => `${t.origen.id}:${t.relacion}:${t.destino.id}`);

  assert.ok(rels.some((r) => r.includes('trabaja_en_proyecto:davis')), `Falta proyecto: ${rels}`);
  assert.ok(rels.some((r) => r.includes('davis:usa_tecnologia:nodejs')), `Falta tecnologia: ${rels}`);
  assert.ok(rels.some((r) => r.includes('estudia:sistemas_distribuidos')), `Falta estudio: ${rels}`);
  assert.ok(rels.some((r) => r.includes('sistemas_distribuidos:tiene_examen:2026-12-18')), `Falta examen: ${rels}`);
  assert.ok(rels.some((r) => r.includes('entrevista_en:google')), `Falta entrevista: ${rels}`);
  assert.ok(rels.some((r) => r.includes('suscrito_a:spotify')), `Falta suscripcion: ${rels}`);
});

test('GraphRAG 2-hop recupera subgrafo conectado desde SQLite con aislamiento por tenant', async () => {
  const db = new Database(':memory:');
  ejecutarMigraciones(db);
  const store = crearSqliteKnowledgeGraphStore(db);

  await procesarTurnoConversacionParaGrafo(
    'Trabajo en el proyecto Atlas. El proyecto Atlas usa PostgreSQL.',
    '',
    { store, tenantId: 'propietario' }
  );
  await procesarTurnoConversacionParaGrafo(
    'Tengo una entrevista en Microsoft.',
    '',
    { store, tenantId: 'tenant_externo' }
  );

  // Pregunta sobre PostgreSQL debe recuperar Atlas -> PostgreSQL (salto 1) y usuario -> Atlas (salto 2)
  const sub = recuperarSubgrafoContextual('que sabes sobre PostgreSQL?', {
    store,
    tenantId: 'propietario',
    maxHops: 2
  });
  assert.match(sub.texto, /PostgreSQL.*usa_tecnologia.*Atlas/i);
  assert.match(sub.texto, /Atlas.*trabaja_en_proyecto.*usuario/i);
  assert.doesNotMatch(sub.texto, /Microsoft/);

  // Tenant externo no ve nodos de propietario
  const subTenant = recuperarSubgrafoContextual('que sabes sobre PostgreSQL?', {
    store,
    tenantId: 'tenant_externo',
    maxHops: 2
  });
  assert.equal(subTenant.texto, '');

  db.close();
});

test('persistirTripletasEnGrafo y obtenerContextoGrafo operan sobre fallback JSON aislado', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'davis-kg-json-'));
  const rutaArchivo = path.join(dir, 'knowledge_graph.json');

  const res = await procesarTurnoConversacionParaGrafo(
    'El examen de Redes es el 15 de diciembre.',
    '',
    { rutaArchivo, tenantId: 'propietario' }
  );
  assert.ok(res.guardadas >= 1);

  const ctx = obtenerContextoGrafo('cuando tengo el examen de redes?', { rutaArchivo });
  assert.match(ctx, /Redes.*tiene_examen.*15 de diciembre/i);

  fs.rmSync(dir, { recursive: true, force: true });
});
