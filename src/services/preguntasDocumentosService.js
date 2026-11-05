/**
 * preguntasDocumentosService.js - Preguntas sobre tus documentos (nº 42)
 *
 * "Que dicen mis apuntes de redes sobre TCP?": localiza las notas mas
 * relevantes por palabras clave y, con el modelo, responde citando las
 * fuentes. Sin modelo devuelve los fragmentos relevantes y declara que no
 * hay sintesis. Nunca inventa contenido que no este en las notas.
 *
 * Strict Policy: Zero Emojis.
 */
import { leerNotas } from './notesReader.js';

function puntuar(nota, palabras) {
  let score = 0;
  const titulo = nota.titulo.toLowerCase();
  const contenido = nota.contenido.toLowerCase();
  for (const w of palabras) {
    if (titulo.includes(w)) score += 5;
    if (nota.tags.some((t) => t.includes(w))) score += 3;
    if (contenido.includes(w)) score += 2;
  }
  return score;
}

export async function preguntarDocumentos({ pregunta } = {}, deps = {}) {
  const q = String(pregunta || '').trim();
  if (!q) return { ok: false, error: 'Dime que quieres saber de tus documentos.' };
  const palabras = q.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
  const notas = leerNotas({ limite: 200 }, deps);
  if (notas.length === 0) {
    return { ok: false, error: 'Todavia no tengo notas tuyas: guarda apuntes o capturas y te respondo con ellos.' };
  }
  const relevantes = notas
    .map((n) => ({ n, score: puntuar(n, palabras) }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map((r) => r.n);
  if (relevantes.length === 0) {
    return { ok: true, respuesta: 'No encuentro nada sobre eso en tus notas, David.', fuentes: [] };
  }
  if (typeof deps.chatCompletion !== 'function') {
    const fragmentos = relevantes.map((n) => `- ${n.titulo} (${n.fecha}): ${n.contenido.slice(0, 200).replace(/\n+/g, ' ')}`);
    return {
      ok: true,
      respuesta: `No puedo redactar la sintesis sin el modelo, pero estas notas tratan el tema:\n${fragmentos.join('\n')}`,
      fuentes: relevantes.map((n) => n.titulo),
      sinModelo: true
    };
  }
  const material = relevantes.map((n, i) => `[${i + 1}] ${n.titulo} (${n.fecha}):\n${n.contenido.slice(0, 1200)}`).join('\n\n');
  const resp = await deps.chatCompletion({
    messages: [
      { role: 'system', content: 'Responde a la pregunta de David SOLO con la informacion de los fragmentos numerados, en espanol, sin emojis. Al final lista las fuentes usadas como "Fuentes: [n] titulo". Si los fragmentos no bastan, dilo claramente.' },
      { role: 'user', content: `Pregunta: ${q}\n\n${material}` }
    ]
  });
  const texto = (resp?.message?.content || resp?.content || '').trim();
  if (!texto) return { ok: false, error: 'El modelo no ha devuelto respuesta.' };
  return { ok: true, respuesta: texto, fuentes: relevantes.map((n) => n.titulo) };
}
