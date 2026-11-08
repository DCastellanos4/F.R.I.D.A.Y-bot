/**
 * brainSearchService.js - Busqueda semantica en memorias y notas (nº 38)
 *
 * Amplia la busqueda por palabras clave de memoryService: primero junta
 * candidatos por coincidencia textual y, si hay modelo disponible, le pide
 * que elija los relevantes aunque no compartan palabras con la consulta.
 * Sin modelo: responde con la busqueda por palabras y lo declara.
 *
 * Strict Policy: Zero Emojis.
 */
import { buscarMemorias, listarMemorias } from './memoryService.js';
import { leerNotas } from './notesReader.js';

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
 * Busqueda semantica. Devuelve { ok, resultados, semantica } donde
 * semantica=true indica ranking por modelo; false = solo palabras clave.
 */
export async function buscarSemantico(consulta, deps = {}) {
  const q = String(consulta || '').trim();
  if (!q) return { ok: false, error: 'Dime que quieres buscar.' };
  const base = candidatas(q, deps);
  if (base.length === 0) return { ok: true, resultados: [], semantica: false };
  if (typeof deps.chatCompletion !== 'function') {
    return { ok: true, resultados: base.slice(0, 5), semantica: false };
  }
  try {
    const lista = base.map((c, i) => `${i + 1}. [${c.tipo}] ${c.texto}`).join('\n');
    const resp = await deps.chatCompletion({
      messages: [
        { role: 'system', content: 'De la lista numerada de recuerdos y notas de David, elige los que respondan o se relacionen con su consulta, aunque no compartan palabras exactas. Devuelve SOLO los numeros elegidos separados por comas (maximo 5), o "ninguno".' },
        { role: 'user', content: `Consulta: ${q}\n\n${lista}` }
      ]
    });
    const texto = (resp?.message?.content || resp?.content || '').trim();
    const indices = [...texto.matchAll(/\d+/g)].map((m) => Number(m[0]) - 1).filter((i) => i >= 0 && i < base.length);
    const elegidos = [...new Set(indices)].slice(0, 5).map((i) => base[i]);
    return { ok: true, resultados: elegidos, semantica: true };
  } catch {
    return { ok: true, resultados: base.slice(0, 5), semantica: false };
  }
}
