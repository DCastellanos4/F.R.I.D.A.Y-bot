/**
 * Adaptador SparseIndexPort: BM25 REAL con SQLite FTS5 (RF-03, canal disperso).
 *
 * La funcion bm25() de FTS5 es una implementacion genuina de Okapi BM25;
 * `esIndustrial=true` es honesto para el ranking disperso. El tokenizer
 * unicode61 con remove_diacritics=2 iguala "camion"/"camion" (acentos),
 * que es lo correcto para el corpus en espanol.
 *
 * Decision de emplazamiento: base de datos DEDICADA (por defecto
 * data/rag_sparse.db), separada de jarvis.db a proposito:
 *  - No anade migraciones al esquema compartido (ese fichero lo tocan
 *    otros bloques del ERS; cero colisiones).
 *  - Se puede borrar y reconstruir entera desde la fuente de memorias:
 *    es un indice derivado, no un almacen primario.
 *
 * Particion multi-tenant: columna tenant_id con filtro OBLIGATORIO en
 * toda consulta (fail-closed via afirmarTenantId). better-sqlite3 ya es
 * dependencia del proyecto: cero dependencias nuevas.
 *
 * Strict Policy: Zero Emojis.
 */

import Database from 'better-sqlite3';
import path from 'node:path';
import { afirmarTenantId } from '../../../core/tenancy.js';
import { afirmarSparseIndex } from '../../../ports/outbound/SparseIndexPort.js';

const NOMBRE_TABLA = 'memorias_fts';

function normalizarConsultaMatch(consulta) {
  // Tokens literales entre comillas dobles unidos por OR: sin sintaxis
  // MATCH del usuario (nada de columnas, NEAR ni operadores). Las
  // comillas internas se duplican segun la regla de FTS5.
  const tokens = String(consulta || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 2)
    .slice(0, 32);
  const unicos = [...new Set(tokens)];
  return unicos.map((t) => `"${t.replace(/"/g, '""')}"`).join(' OR ');
}

/**
 * @param {object} [opciones]
 * @param {string} [opciones.rutaDb]  Fichero SQLite del indice disperso.
 * @param {Database.Database} [opciones.db]  Conexion inyectada (pruebas).
 */
export function crearSqliteFts5SparseAdapter(opciones = {}) {
  const db = opciones.db || new Database(opciones.rutaDb || path.join(process.env.DAVIS_DATA_DIR || 'data', 'rag_sparse.db'));
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS ${NOMBRE_TABLA} USING fts5(
      tenant_id UNINDEXED,
      doc_id UNINDEXED,
      texto,
      tokenize = 'unicode61 remove_diacritics 2'
    );
  `);

  const stmtUpsertDelete = db.prepare(`DELETE FROM ${NOMBRE_TABLA} WHERE tenant_id = ? AND doc_id = ?`);
  const stmtInsert = db.prepare(`INSERT INTO ${NOMBRE_TABLA} (tenant_id, doc_id, texto) VALUES (?, ?, ?)`);
  const stmtBuscar = db.prepare(`
    SELECT doc_id, bm25(${NOMBRE_TABLA}) AS rank
    FROM ${NOMBRE_TABLA}
    WHERE ${NOMBRE_TABLA} MATCH ? AND tenant_id = ?
    ORDER BY rank
    LIMIT ?
  `);
  const stmtBorrar = db.prepare(`DELETE FROM ${NOMBRE_TABLA} WHERE tenant_id = ? AND doc_id = ?`);
  const stmtContar = db.prepare(`SELECT COUNT(*) AS n FROM ${NOMBRE_TABLA} WHERE tenant_id = ?`);

  const upsertTransaccional = db.transaction((tenantId, docs) => {
    for (const d of docs) {
      stmtUpsertDelete.run(tenantId, d.id);
      stmtInsert.run(tenantId, d.id, d.texto);
    }
  });

  async function indexar(tenantId, docs) {
    afirmarTenantId(tenantId);
    const lista = (Array.isArray(docs) ? docs : []).filter((d) => d && typeof d.id === 'string' && typeof d.texto === 'string' && d.texto.trim());
    if (lista.length === 0) return { ok: true, total: 0 };
    upsertTransaccional(tenantId, lista);
    return { ok: true, total: lista.length };
  }

  async function buscar(tenantId, consulta, topK) {
    afirmarTenantId(tenantId);
    const match = normalizarConsultaMatch(consulta);
    if (!match) return [];
    const limite = Number.isInteger(topK) && topK > 0 ? topK : 20;
    // bm25() devuelve valores negativos: mas negativo = mejor. Se expone
    // scoreBm25 solo informativo; la fusion usa el ORDEN, no el valor.
    const filas = stmtBuscar.all(match, tenantId, limite);
    return filas.map((f) => ({ id: f.doc_id, scoreBm25: f.rank }));
  }

  async function borrar(tenantId, ids) {
    afirmarTenantId(tenantId);
    let total = 0;
    const borrarVarios = db.transaction((lista) => {
      for (const id of lista) {
        total += stmtBorrar.run(tenantId, id).changes;
      }
    });
    borrarVarios(Array.isArray(ids) ? ids.filter((id) => typeof id === 'string') : []);
    return { ok: true, total };
  }

  async function contar(tenantId) {
    afirmarTenantId(tenantId);
    return stmtContar.get(tenantId).n;
  }

  return afirmarSparseIndex({
    motor: 'sqlite-fts5',
    esIndustrial: true,
    indexar,
    buscar,
    borrar,
    contar
  });
}
