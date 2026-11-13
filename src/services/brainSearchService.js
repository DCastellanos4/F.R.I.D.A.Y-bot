/**
 * brainSearchService.js - Busqueda semantica en memorias y notas (RF-03).
 *
 * Amplia la busqueda por palabras clave de memoryService:
 *  1. Integra busqueda vectorial densa via Qdrant (coleccion davis_memorias_propietario)
 *     y/o buscador hibrido si estan configurados, con degradacion elegante (graceful fallback).
 *  2. Si Qdrant no esta disponible o falla, recurre a candidatos lexicos de memorias y notas.
 *  3. Si hay modelo de re-ranking (chatCompletion), realiza seleccion semantica contextual.
 *  4. Sin modelo ni Qdrant: responde con la busqueda por palabras clave declarando semantica=false.
 *
 * Strict Policy: Zero Emojis.
 */
import { buscarMemorias, listarMemorias } from './memoryService.js';
import { leerNotas } from './notesReader.js';

let segundoCerebroPorDefecto = null;

/**
 * Registra el servicio de segundo cerebro por defecto para busquedas semanticas.
 *
 * @param {object|null} servicio
 */
export function registrarSegundoCerebroPorDefecto(servicio) {
  segundoCerebroPorDefecto = servicio || null;
}

// Con rutaArchivoMemorias (ambito de tenant) las memorias salen SOLO de ese
// archivo; sin ella, el almacen por defecto del propietario (comportamiento previo).
function depsMemoria(deps) {
  return deps && deps.rutaArchivoMemorias ? { rutaArchivo: deps.rutaArchivoMemorias } : {};
}

function candidatas(consulta, deps) {
  const q = String(consulta || '').toLowerCase();
  const palabras = q.split(/\s+/).filter((w) => w.length > 2);
  const memorias = (palabras.length
    ? buscarMemorias(consulta, depsMemoria(deps))
    : listarMemorias(null, depsMemoria(deps)))
    .slice(0, 10)
    .map((m) => ({ tipo: 'memoria', referencia: m.sujeto, texto: `${m.sujeto}: ${m.dato}` }));
  const notas = leerNotas({ limite: 60 }, deps)
    .filter((n) => palabras.length === 0 || palabras.some((w) =>
      n.titulo.toLowerCase().includes(w) || n.tags.some((t) => t.includes(w)) || n.contenido.toLowerCase().includes(w)))
    .slice(0, 10)
    .map((n) => ({ tipo: 'nota', referencia: n.titulo, texto: n.contenido.slice(0, 400) }));
  return [...memorias, ...notas].slice(0, 20);
}

/**
 * Busqueda semantica en memorias y segundo cerebro. Devuelve { ok, resultados, semantica }
 * con degradacion elegante (graceful fallback) si Qdrant no responde o no esta desplegado.
 *
 * @param {string} consulta
 * @param {object} [deps]
 * @returns {Promise<{ ok: boolean, resultados: Array<object>, semantica: boolean, error?: string }>}
 */
export async function buscarSemantico(consulta, deps = {}) {
  const q = String(consulta || '').trim();
  if (!q) return { ok: false, error: 'Dime que quieres buscar.' };

  // 1. Intentar consulta densa en Qdrant Second Brain con degradacion elegante
  const qdrant = deps.qdrantSecondBrain || deps.segundoCerebro || segundoCerebroPorDefecto;
  const denseResults = [];
  if (qdrant && typeof qdrant.buscar === 'function') {
    try {
      const respQdrant = await qdrant.buscar(q, { topK: 10 });
      if (respQdrant && respQdrant.ok && Array.isArray(respQdrant.resultados)) {
        for (const item of respQdrant.resultados) {
          denseResults.push({
            tipo: 'nota',
            referencia: item.referencia || item.file || 'segundo_cerebro',
            texto: (item.content || item.texto || '').slice(0, 400),
            esDenso: true
          });
        }
      }
    } catch {
      // Fallback graceful: fallo o indisponibilidad de Qdrant no interrumpe el flujo
    }
  }

  // 2. Intentar buscador hibrido si esta presente en dependencias
  if (deps.buscadorHibrido && typeof deps.buscadorHibrido.buscar === 'function') {
    try {
      const respHibrido = await deps.buscadorHibrido.buscar('propietario', q, { topK: 5 });
      if (Array.isArray(respHibrido)) {
        for (const h of respHibrido) {
          denseResults.push({
            tipo: 'memoria',
            referencia: h.id || 'hibrido',
            texto: (h.texto || '').slice(0, 400),
            esDenso: true
          });
        }
      }
    } catch {
      // Fallback graceful
    }
  }

  // 3. Obtener candidatos lexicos tradicionales (memorias + notas en disco)
  const base = candidatas(q, deps);

  // Combinar resultados densos y lexicos evitando duplicados
  const textosVistos = new Set();
  const combinados = [];

  for (const item of [...denseResults, ...base]) {
    const clave = (item.texto || '').trim().slice(0, 100).toLowerCase();
    if (clave && !textosVistos.has(clave)) {
      textosVistos.add(clave);
      combinados.push(item);
    }
  }

  if (combinados.length === 0) {
    return { ok: true, resultados: [], semantica: denseResults.length > 0 };
  }

  // 4. Si hay chatCompletion disponible, re-rankear semanticamente
  if (typeof deps.chatCompletion === 'function') {
    try {
      const lista = combinados.slice(0, 20).map((c, i) => `${i + 1}. [${c.tipo}] ${c.texto}`).join('\n');
      const resp = await deps.chatCompletion({
        messages: [
          { role: 'system', content: 'De la lista numerada de recuerdos y notas de David, elige los que respondan o se relacionen con su consulta, aunque no compartan palabras exactas. Devuelve SOLO los numeros elegidos separados por comas (maximo 5), o "ninguno".' },
          { role: 'user', content: `Consulta: ${q}\n\n${lista}` }
        ]
      });
      const texto = (resp?.message?.content || resp?.content || '').trim();
      const indices = [...texto.matchAll(/\d+/g)].map((m) => Number(m[0]) - 1).filter((i) => i >= 0 && i < combinados.length);
      const elegidos = [...new Set(indices)].slice(0, 5).map((i) => combinados[i]);
      if (elegidos.length > 0) {
        return { ok: true, resultados: elegidos, semantica: true };
      }
    } catch {
      // Degradacion elegante: continua con el orden directo
    }
  }

  // 5. Sin chatCompletion: si se obtuvieron resultados densos de Qdrant, la busqueda es semantica
  if (denseResults.length > 0) {
    return { ok: true, resultados: combinados.slice(0, 5), semantica: true };
  }

  // 6. Sin Qdrant ni modelo: responder con busqueda lexico-textual declarando semantica=false
  return { ok: true, resultados: base.slice(0, 5), semantica: false };
}
