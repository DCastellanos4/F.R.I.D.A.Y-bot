/**
 * devToolsService.js - Bloque 12 de las 50: herramientas de desarrollo.
 *
 * nº 9  Revisor de PRs: lee la PR (API publica de GitHub, sin clave para
 *       repos publicos; DAVIS_GITHUB_TOKEN opcional por entorno, NUNCA por
 *       chat, para repos privados o mas cuota) y devuelve una resena de
 *       seguridad y estilo PARA DAVID por WhatsApp. NUNCA publica comentarios
 *       en GitHub: revisar no es actuar en el repo.
 * nº 13 Generador de CHANGELOG: redacta la entrada desde git log (repo local)
 *       agrupada en Anadido/Cambiado/Corregido. Devuelve el texto; no toca
 *       archivos ni hace commits.
 * nº 14 Pair programming: guia de depuracion paso a paso por chat (una
 *       hipotesis cada vez, pidiendo salidas concretas). El historial del
 *       propio bot mantiene la conversacion.
 * nº 15 Gestor de ideas: anota propuestas en local y propone prioridades con
 *       el modelo cuando David lo pide. Revision semanal proactiva: solo con
 *       opt-in explicito (no implementada aqui a proposito).
 *
 * Strict Policy: Zero Emojis.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { fetchSeguro } from './safeFetch.js';

const DATA_DIR = process.env.DAVIS_DATA_DIR || path.join(process.cwd(), 'data');
export const ARCHIVO_IDEAS_DEFECTO = path.join(DATA_DIR, 'ideas.json');

/* ------------------------------ nº 15 ideas ------------------------------ */

function leerIdeas(deps) {
  const ruta = deps.rutaArchivo || ARCHIVO_IDEAS_DEFECTO;
  try {
    const datos = JSON.parse(fs.readFileSync(ruta, 'utf8'));
    return Array.isArray(datos) ? datos : [];
  } catch {
    return [];
  }
}

function escribirIdeas(ideas, deps) {
  const ruta = deps.rutaArchivo || ARCHIVO_IDEAS_DEFECTO;
  fs.mkdirSync(path.dirname(ruta), { recursive: true });
  fs.writeFileSync(ruta, JSON.stringify(ideas, null, 2));
}

export function anotarIdea({ titulo, detalle } = {}, deps = {}) {
  const t = String(titulo || '').trim();
  if (!t) return { ok: false, error: 'Dime la idea en una frase (por ejemplo: "anota esta idea: modo lectura para las notas").' };
  const ideas = leerIdeas(deps);
  const idea = {
    id: `idea-${Date.now().toString(36)}`,
    titulo: t.slice(0, 140),
    detalle: String(detalle || '').trim().slice(0, 1000) || null,
    fecha: (deps.ahora ? new Date(deps.ahora) : new Date()).toISOString(),
    prioridad: 'pendiente'
  };
  ideas.push(idea);
  escribirIdeas(ideas, deps);
  return { ok: true, idea, total: ideas.length };
}

export function listarIdeas(deps = {}) {
  return leerIdeas(deps);
}

export async function priorizarIdeas(deps = {}) {
  const pendientes = leerIdeas(deps).filter((i) => i.prioridad === 'pendiente');
  if (pendientes.length === 0) return { ok: false, error: 'No hay ideas pendientes de priorizar.' };
  if (typeof deps.chatCompletion !== 'function') return { ok: false, error: 'Necesito el modelo de lenguaje para proponer prioridades.' };
  const lista = pendientes.map((i) => `- [${i.id}] ${i.titulo}${i.detalle ? `: ${i.detalle}` : ''} (${i.fecha.slice(0, 10)})`).join('\n');
  const resp = await deps.chatCompletion({
    messages: [
      { role: 'system', content: 'Eres el gestor de ideas de un bot personal. Ordena estas propuestas de mayor a menor prioridad para un estudiante que mantiene su bot como proyecto personal: impacto diario primero, esfuerzo pequeno suma, dependencias externas restan. Responde en espanol, sin emojis, una linea por idea con su [id], prioridad propuesta (alta/media/baja) y motivo de 5-10 palabras. No inventes ideas nuevas.' },
      { role: 'user', content: lista }
    ]
  });
  const propuesta = (resp?.message?.content || resp?.content || '').trim();
  if (!propuesta) return { ok: false, error: 'El modelo no ha devuelto propuesta.' };
  return { ok: true, propuesta, pendientes: pendientes.length, nota: 'Propuesta para revisar contigo; no he cambiado nada.' };
}

/* ---------------------------- nº 13 changelog ---------------------------- */

function ejecutarGit(args, deps) {
  if (typeof deps.execGit === 'function') return deps.execGit(args);
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd: deps.repoPath || process.cwd(), timeout: 15000, maxBuffer: 1024 * 1024 }, (err, stdout) => {
      if (err) reject(err);
      else resolve(stdout);
    });
  });
}

export async function generarEntradaChangelog({ desde, limite } = {}, deps = {}) {
  if (typeof deps.chatCompletion !== 'function') return { ok: false, error: 'Necesito el modelo de lenguaje para redactar la entrada.' };
  const rango = String(desde || '').trim();
  const args = ['log', '--pretty=format:- %s (%h)'];
  if (rango) args.push(`${rango}..HEAD`);
  else args.push(`-${Number.isFinite(limite) ? limite : 15}`);
  let log;
  try {
    log = (await ejecutarGit(args, deps)).trim();
  } catch (err) {
    return { ok: false, error: `No he podido leer el historial git: ${err.message}` };
  }
  if (!log) return { ok: false, error: rango ? `No hay commits en ${rango}..HEAD.` : 'No hay commits en el rango pedido.' };
  const resp = await deps.chatCompletion({
    messages: [
      { role: 'system', content: 'Redacta la entrada de CHANGELOG (Keep a Changelog, espanol, sin emojis) para estos commits: titulo de version/fecha placeholder "## [sin publicar]" y secciones ### Anadido / ### Cambiado / ### Corregido solo si hay material. Una vineta por cambio real, agrupando commits del mismo bloque. Fiel a los mensajes: no inventes cambios que no consten.' },
      { role: 'user', content: log.slice(0, 6000) }
    ]
  });
  const entrada = (resp?.message?.content || resp?.content || '').trim();
  if (!entrada) return { ok: false, error: 'El modelo no ha devuelto entrada.' };
  return { ok: true, entrada, commits: log.split('\n').length, nota: 'Texto propuesto; no he tocado CHANGELOG.md ni hecho commit.' };
}

/* -------------------------- nº 14 pair programming ----------------------- */

export async function guiarDepuracion({ fallo, contexto } = {}, deps = {}) {
  const f = String(fallo || '').trim();
  if (!f) return { ok: false, error: 'Describeme el fallo: que esperabas, que pasa y el mensaje de error si lo hay.' };
  if (typeof deps.chatCompletion !== 'function') return { ok: false, error: 'Necesito el modelo de lenguaje para depurar contigo.' };
  const resp = await deps.chatCompletion({
    messages: [
      { role: 'system', content: 'Modo pair programming por chat con un estudiante (Node.js). Guia la depuracion paso a paso: 1) resume el sintoma en una linea, 2) da UNA hipotesis ordenada por probabilidad y el paso concreto para comprobarla (comando exacto o donde mirar), 3) pide la salida que necesitas para seguir. No des la solucion entera de golpe si no esta probada; nada de emojis; espanol.' },
      { role: 'user', content: `Fallo: ${f}${contexto ? `\nContexto: ${String(contexto).slice(0, 3000)}` : ''}` }
    ]
  });
  const guia = (resp?.message?.content || resp?.content || '').trim();
  if (!guia) return { ok: false, error: 'El modelo no ha devuelto guia.' };
  return { ok: true, guia, nota: 'Seguimos por aqui: mandame la salida y continuo con el siguiente paso.' };
}

/* ----------------------------- nº 9 revisor PR --------------------------- */

export async function revisarPullRequest({ numero, repo } = {}, deps = {}) {
  const n = Number(numero);
  if (!Number.isInteger(n) || n <= 0) return { ok: false, error: 'Dime el numero de PR (por ejemplo: "revisa la PR 18").' };
  const repoObjetivo = String(repo || deps.repoDefecto || process.env.DAVIS_REPO_DEFECTO || 'DCastellanos4/F.R.I.D.A.Y-bot').trim();
  const token = deps.githubToken || process.env.DAVIS_GITHUB_TOKEN || null;
  const cabeceras = { accept: 'application/vnd.github+json', ...(token ? { authorization: `Bearer ${token}` } : {}) };
  const abrir = deps.fetchFn || ((u, o) => fetchSeguro(u, { headers: (o && o.headers) || {} }));

  let info;
  try {
    const r = await abrir(`https://api.github.com/repos/${repoObjetivo}/pulls/${n}`, { headers: cabeceras });
    if (!r.ok) return { ok: false, error: `GitHub respondio ${r.status} al leer la PR ${n} de ${repoObjetivo}${r.status === 404 ? ' (existe? es privada? falta DAVIS_GITHUB_TOKEN?)' : ''}.` };
    info = JSON.parse(await r.text());
  } catch (err) {
    return { ok: false, error: `No he podido leer la PR: ${err.message}` };
  }
  let diff = '';
  try {
    const r = await abrir(`https://api.github.com/repos/${repoObjetivo}/pulls/${n}`, { headers: { ...cabeceras, accept: 'application/vnd.github.v3.diff' } });
    if (r.ok) diff = await r.text();
  } catch {
    diff = '';
  }
  if (typeof deps.chatCompletion !== 'function') return { ok: false, error: 'He leido la PR pero necesito el modelo de lenguaje para redactar la resena.' };
  const material = `PR #${info.number}: ${info.title}\nAutor: ${info.user?.login}\nEstado: ${info.state}${info.draft ? ' (borrador)' : ''}\nArchivos: ${info.changed_files}, +${info.additions}/-${info.deletions}\nDescripcion:\n${String(info.body || '').slice(0, 1500)}\n\nDiff (recortado):\n${diff.slice(0, 12000) || '(diff no disponible)'}`;
  const resp = await deps.chatCompletion({
    messages: [
      { role: 'system', content: 'Eres un revisor de pull requests. Comenta SEGURIDAD (secretos, inyeccion, SSRF, permisos, dependencias) y ESTILO (claridad, errores tipicos, pruebas) de esta PR. Espanol, sin emojis, vinetas concretas con archivo/linea aproximada si se ve en el diff. Empieza con un veredicto: "apto", "apto con comentarios" o "necesita cambios". Si algo no se puede valorar del diff, dilo; no inventes problemas.' },
      { role: 'user', content: material }
    ]
  });
  const resena = (resp?.message?.content || resp?.content || '').trim();
  if (!resena) return { ok: false, error: 'El modelo no ha devuelto resena.' };
  return {
    ok: true,
    repo: repoObjetivo,
    numero: info.number,
    titulo: info.title,
    url: info.html_url,
    resena,
    conToken: Boolean(token),
    nota: 'Resena para ti aqui por WhatsApp; NO he publicado ningun comentario en GitHub.'
  };
}
