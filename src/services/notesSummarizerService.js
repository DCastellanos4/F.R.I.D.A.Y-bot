/**
 * notesSummarizerService.js - Resumidor de apuntes (nº 7)
 *
 * Resume apuntes: un texto pegado directamente o notas del segundo cerebro
 * que encajen con un criterio (titulo, categoria, tags o contenido). Cita de
 * que notas sale; sin coincidencias ni modelo, lo dice y no inventa.
 *
 * Strict Policy: Zero Emojis.
 */
import { leerNotas } from './notesReader.js';

export async function resumirApuntes({ texto, criterio } = {}, deps = {}) {
  if (typeof deps.chatCompletion !== 'function') {
    return { ok: false, error: 'Necesito el modelo de lenguaje para resumir.' };
  }
  let material = String(texto || '').trim();
  let fuentes = [];
  if (!material) {
    const c = String(criterio || '').trim().toLowerCase();
    if (!c) return { ok: false, error: 'Dime que apuntes resumir (por ejemplo: "resume mis apuntes de redes") o pega el texto.' };
    const notas = leerNotas({}, deps).filter((n) =>
      n.titulo.toLowerCase().includes(c) ||
      n.categoria.toLowerCase().includes(c) ||
      n.tags.some((t) => t.includes(c)) ||
      n.contenido.toLowerCase().includes(c)
    ).slice(0, 8);
    if (notas.length === 0) return { ok: false, error: `No encuentro apuntes que encajen con "${criterio}".` };
    material = notas.map((n) => `# ${n.titulo} (${n.fecha})\n${n.contenido}`).join('\n\n');
    fuentes = notas.map((n) => n.titulo);
  }
  const resp = await deps.chatCompletion({
    messages: [
      { role: 'system', content: 'Resume estos apuntes en espanol, sin emojis: primero 3-5 ideas clave en vinetas y despues un parrafo corto de repaso. Fiel al texto; si algo importante no consta, no lo inventes.' },
      { role: 'user', content: material.slice(0, 6000) }
    ]
  });
  const resumen = (resp?.message?.content || resp?.content || '').trim();
  if (!resumen) return { ok: false, error: 'El modelo no ha devuelto resumen.' };
  return { ok: true, resumen, fuentes };
}
