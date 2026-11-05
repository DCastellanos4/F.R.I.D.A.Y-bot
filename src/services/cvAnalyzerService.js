/**
 * cvAnalyzerService.js - Analizador de CV contra oferta (nº 4)
 *
 * Compara el CV de David con una oferta concreta usando el modelo. El CV se
 * pega como texto o se busca en las notas del segundo cerebro (titulo/tags
 * con "cv" o "curriculum"). Nunca inventa encaje: sin CV o sin modelo lo
 * dice y para.
 *
 * Strict Policy: Zero Emojis.
 */
import { leerNotas } from './notesReader.js';

function buscarCvEnNotas(deps = {}) {
  const notas = leerNotas({}, deps);
  const cv = notas.find((n) => /\bcv\b|curriculum/i.test(`${n.titulo} ${n.tags.join(' ')}`));
  return cv ? { texto: cv.contenido, fuente: cv.titulo } : null;
}

export async function analizarCvContraOferta({ oferta, cvTexto } = {}, deps = {}) {
  const o = String(oferta || '').trim();
  if (!o) return { ok: false, error: 'Pasame la oferta (texto o enlace pegado) para comparar.' };
  let cv = String(cvTexto || '').trim();
  let fuente = 'texto pegado';
  if (!cv) {
    const hallado = buscarCvEnNotas(deps);
    if (!hallado) return { ok: false, error: 'No tengo tu CV: pegamelo como texto o guardalo en tus notas (titulo o tag "cv").' };
    cv = hallado.texto;
    fuente = `nota "${hallado.fuente}"`;
  }
  if (typeof deps.chatCompletion !== 'function') {
    return { ok: false, error: 'Necesito el modelo de lenguaje para analizar el encaje.' };
  }
  const resp = await deps.chatCompletion({
    messages: [
      { role: 'system', content: 'Analiza el encaje entre el CV y la oferta. En espanol, sin emojis, con este formato:\nENCAJE: alto | medio | bajo\nPUNTOS FUERTES: 2-4 vinetas con lo del CV que casa con la oferta\nLAGUNAS: 2-4 vinetas con lo que pide la oferta y no aparece en el CV\nCONSEJO: una o dos frases accionables\nBasa todo en los textos; si algo no consta, dilo.' },
      { role: 'user', content: `CV:\n${cv.slice(0, 4000)}\n\nOFERTA:\n${o.slice(0, 3000)}` }
    ]
  });
  const analisis = (resp?.message?.content || resp?.content || '').trim();
  if (!analisis) return { ok: false, error: 'El modelo no ha devuelto analisis.' };
  return { ok: true, analisis, fuenteCv: fuente };
}
