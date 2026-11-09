/**
 * Adaptador VectorStorePort de DESARROLLO: vectores en memoria con
 * persistencia JSON opcional por tenant.
 *
 * NO CUMPLE RF-03. Existe para desarrollar y probar el pipeline hibrido
 * (RRF, reranker, contratos) sin levantar Qdrant. `esIndustrial=false`
 * lo declara: ningun informe puede presentar un pipeline montado sobre
 * este adaptador como motor vectorial industrial. La similitud es coseno
 * exacto por fuerza bruta: correcta a escala de pruebas, inaceptable como
 * indice de produccion.
 *
 * Strict Policy: Zero Emojis.
 */

import fs from 'node:fs';
import path from 'node:path';
import { afirmarTenantId } from '../../../core/tenancy.js';
import { afirmarVectorStore } from '../../../ports/outbound/VectorStorePort.js';
import { computeCosineSimilarity } from '../../../services/semanticMemoryService.js';

/**
 * @param {object} [opciones]
 * @param {string} [opciones.carpetaPersistencia]  Si se da, un JSON por tenant; si no, solo memoria.
 */
export function crearDevLocalVectorStoreAdapter(opciones = {}) {
  const carpeta = opciones.carpetaPersistencia || null;
  const porTenant = new Map(); // tenantId -> Map<id, {texto, vector, payload}>

  function rutaDe(tenantId) {
    return carpeta ? path.join(carpeta, `vectores_dev_${tenantId}.json`) : null;
  }

  function mapaDe(tenantId) {
    afirmarTenantId(tenantId);
    let mapa = porTenant.get(tenantId);
    if (!mapa) {
      mapa = new Map();
      const ruta = rutaDe(tenantId);
      if (ruta) {
        try {
          const crudo = JSON.parse(fs.readFileSync(ruta, 'utf8'));
          for (const [id, entrada] of Object.entries(crudo.documentos || {})) {
            mapa.set(id, entrada);
          }
        } catch { /* sin persistencia previa: vacio */ }
      }
      porTenant.set(tenantId, mapa);
    }
    return mapa;
  }

  function persistir(tenantId) {
    const ruta = rutaDe(tenantId);
    if (!ruta) return;
    const mapa = porTenant.get(tenantId) || new Map();
    fs.mkdirSync(path.dirname(ruta), { recursive: true });
    fs.writeFileSync(ruta, JSON.stringify({ version: 1, documentos: Object.fromEntries(mapa) }), 'utf8');
  }

  async function indexar(tenantId, docs) {
    const mapa = mapaDe(tenantId);
    const lista = Array.isArray(docs) ? docs : [];
    for (const d of lista) {
      mapa.set(d.id, { texto: d.texto, vector: d.vector, payload: d.payload || {} });
    }
    persistir(tenantId);
    return { ok: true, total: lista.length };
  }

  async function buscarDenso(tenantId, vector, topK) {
    const mapa = mapaDe(tenantId);
    const limite = Number.isInteger(topK) && topK > 0 ? topK : 20;
    const puntuados = [];
    for (const [id, entrada] of mapa) {
      const score = computeCosineSimilarity(vector, entrada.vector);
      puntuados.push({ id, score, texto: entrada.texto, payload: entrada.payload });
    }
    puntuados.sort((a, b) => b.score - a.score);
    return puntuados.slice(0, limite);
  }

  async function borrar(tenantId, ids) {
    const mapa = mapaDe(tenantId);
    let total = 0;
    for (const id of Array.isArray(ids) ? ids : []) {
      if (mapa.delete(id)) total += 1;
    }
    persistir(tenantId);
    return { ok: true, total };
  }

  async function contar(tenantId) {
    return mapaDe(tenantId).size;
  }

  return afirmarVectorStore({
    motor: 'dev-local',
    esIndustrial: false,
    indexar,
    buscarDenso,
    borrar,
    contar
  });
}
