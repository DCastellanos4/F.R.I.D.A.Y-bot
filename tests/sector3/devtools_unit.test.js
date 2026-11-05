/**
 * devtools_unit.test.js
 * Pruebas unitarias del bloque 12 (nº 9 revisor PRs, nº 13 changelog,
 * nº 14 pair programming, nº 15 ideas). Todo con deps inyectadas: nada de
 * red, git ni modelo reales.
 *
 * Strict Policy: Zero Emojis.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'os';
import { anotarIdea, listarIdeas, priorizarIdeas, generarEntradaChangelog, guiarDepuracion, revisarPullRequest } from '../../src/services/devToolsService.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'davis-devtools-'));
const rutaIdeas = path.join(tmp, 'ideas.json');

test('nº15 ideas: anota, lista y prioriza solo con modelo, sin cambiar nada', async () => {
  const r1 = anotarIdea({ titulo: 'modo lectura para notas' }, { rutaArchivo: rutaIdeas, ahora: '2026-11-05T16:00:00+01:00' });
  assert.equal(r1.ok, true);
  assert.equal(r1.idea.prioridad, 'pendiente');
  const r2 = anotarIdea({ titulo: 'resumen de commits semanal' }, { rutaArchivo: rutaIdeas });
  assert.equal(r2.total, 2);
  assert.equal(listarIdeas({ rutaArchivo: rutaIdeas }).length, 2);
  assert.equal(anotarIdea({ titulo: ' ' }, { rutaArchivo: rutaIdeas }).ok, false);

  const sinModelo = await priorizarIdeas({ rutaArchivo: rutaIdeas });
  assert.equal(sinModelo.ok, false, 'sin modelo no propone prioridades');
  const conModelo = await priorizarIdeas({
    rutaArchivo: rutaIdeas,
    chatCompletion: async () => ({ message: { content: '- [idea-x] alta: impacto diario\n- [idea-y] baja: dependencia externa' } })
  });
  assert.equal(conModelo.ok, true);
  assert.match(conModelo.propuesta, /alta/);
  assert.equal(listarIdeas({ rutaArchivo: rutaIdeas })[0].prioridad, 'pendiente', 'la propuesta no cambia las ideas');
});

test('nº13 changelog: lee git log via execGit y redacta entrada; no toca archivos', async () => {
  const gitFalso = async (args) => {
    assert.ok(args.includes('log'));
    return '- Bloque 11 compras (8c891f0)\n- Corrige redirect SSRF (bb0f39d)';
  };
  const r = await generarEntradaChangelog({}, {
    execGit: gitFalso,
    chatCompletion: async ({ messages }) => {
      assert.match(messages[1].content, /8c891f0/, 'el modelo recibe el log real');
      return { message: { content: '## [sin publicar]\n### Anadido\n- Buscador de productos.' } };
    }
  });
  assert.equal(r.ok, true);
  assert.equal(r.commits, 2);
  assert.match(r.entrada, /Anadido/);
  assert.match(r.nota, /no he tocado CHANGELOG/);
  const rango = await generarEntradaChangelog({ desde: 'v1.0.0' }, { execGit: gitFalso, chatCompletion: async () => ({ message: { content: 'x' } }) });
  assert.equal(rango.ok, true);
  const fallo = await generarEntradaChangelog({}, { execGit: async () => { throw new Error('not a git repo'); }, chatCompletion: async () => ({}) });
  assert.equal(fallo.ok, false);
  assert.match(fallo.error, /not a git repo/);
});

test('nº14 pair programming: sin fallo o sin modelo no inventa; con modelo guia paso a paso', async () => {
  assert.equal((await guiarDepuracion({ fallo: ' ' })).ok, false);
  assert.equal((await guiarDepuracion({ fallo: 'el bot no arranca' })).ok, false);
  const r = await guiarDepuracion({
    fallo: 'el bot no arranca: Error Cannot find module',
    contexto: 'node whatsappBot.js'
  }, { chatCompletion: async () => ({ message: { content: 'Sintoma: modulo no resuelto.\nHipotesis 1: dependencia sin instalar. Comprueba: npm ls baileys.\nPasame la salida.' } }) });
  assert.equal(r.ok, true);
  assert.match(r.guia, /Hipotesis 1/);
  assert.match(r.nota, /siguiente paso/);
});

test('nº9 revisor PR: lee PR y diff via API, resena aqui y NUNCA publica en GitHub', async () => {
  const urls = [];
  const fetchFalso = async (url, opts) => {
    urls.push({ url, accept: opts?.headers?.accept });
    if (opts?.headers?.accept === 'application/vnd.github.v3.diff') {
      return { ok: true, text: async () => 'diff --git a/a.js b/a.js\n+const token = "SECRETO123";' };
    }
    return { ok: true, text: async () => JSON.stringify({ number: 18, title: 'Compras', user: { login: 'David' }, state: 'open', draft: false, changed_files: 9, additions: 500, deletions: 40, body: 'PR de compras', html_url: 'https://github.com/DCastellanos4/F.R.I.D.A.Y-bot/pull/18' }) };
  };
  let promptVisto = '';
  const r = await revisarPullRequest({ numero: 18 }, {
    fetchFn: fetchFalso,
    chatCompletion: async ({ messages }) => { promptVisto = messages[1].content; return { message: { content: 'apto con comentarios: posible secreto en a.js' } }; }
  });
  assert.equal(r.ok, true);
  assert.equal(r.numero, 18);
  assert.equal(r.url, 'https://github.com/DCastellanos4/F.R.I.D.A.Y-bot/pull/18');
  assert.match(r.resena, /apto con comentarios/);
  assert.match(r.nota, /NO he publicado ningun comentario/);
  assert.equal(r.conToken, false, 'API publica sin clave por defecto');
  assert.match(promptVisto, /SECRETO123/, 'el diff llega al modelo');
  assert.ok(urls.every((u) => u.url.startsWith('https://api.github.com/')), 'solo lectura a la API');
  const noExiste = await revisarPullRequest({ numero: 9999 }, { fetchFn: async () => ({ ok: false, status: 404 }), chatCompletion: async () => ({}) });
  assert.equal(noExiste.ok, false);
  assert.match(noExiste.error, /404/);
});
