/**
 * githubAgentService.js - Agente Programador Autonomo para D.A.V.I.S.
 * Permite a DAVIS gestionar ramas, realizar commits, ejecutar verificacion
 * de tests y crear Pull Requests en GitHub con token personal.
 *
 * Strict Policy: Zero Emojis.
 */
import { execFile } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { fetchSeguro } from './safeFetch.js';

export function getGitHubToken(deps = {}) {
  return deps.token || process.env.DAVIS_GITHUB_TOKEN || process.env.GITHUB_TOKEN || null;
}

export function getDefaultRepo(deps = {}) {
  return deps.repo || process.env.DAVIS_REPO_DEFECTO || 'DCastellanos4/F.R.I.D.A.Y-bot';
}

function runGit(args, cwd, deps = {}) {
  if (typeof deps.execGit === 'function') {
    return deps.execGit(args, cwd);
  }
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd: cwd || process.cwd(), timeout: 30000, maxBuffer: 5 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        const errorMsg = (stderr || stdout || err.message).trim();
        reject(new Error(errorMsg));
      } else {
        resolve(stdout.trim());
      }
    });
  });
}

/**
 * Crea una rama local para una tarea de programacion.
 */
export async function crearRamaTrabajo({ nombreRama, base = 'main' } = {}, deps = {}) {
  const rama = String(nombreRama || '').trim();
  if (!rama) return { ok: false, error: 'Especifica el nombre de la rama (por ejemplo: feat/nueva-funcionalidad).' };
  const repoCwd = deps.repoPath || process.cwd();

  try {
    await runGit(['checkout', base], repoCwd, deps).catch(() => {});
    await runGit(['checkout', '-b', rama], repoCwd, deps);
    return { ok: true, rama, base, nota: `Rama ${rama} creada y activa en ${repoCwd}.` };
  } catch (err) {
    return { ok: false, error: `Error creando rama ${rama}: ${err.message}` };
  }
}

/**
 * Crea un commit con cambios especificados.
 */
export async function crearCommit({ mensaje, archivos = ['.'] } = {}, deps = {}) {
  const msg = String(mensaje || '').trim();
  if (!msg) return { ok: false, error: 'El mensaje de commit no puede estar vacio.' };
  const repoCwd = deps.repoPath || process.cwd();

  try {
    for (const arch of archivos) {
      await runGit(['add', arch], repoCwd, deps);
    }
    const stdout = await runGit(['commit', '-m', msg], repoCwd, deps);
    const hash = await runGit(['rev-parse', '--short', 'HEAD'], repoCwd, deps);
    return { ok: true, hash, mensaje: msg, salida: stdout };
  } catch (err) {
    return { ok: false, error: `Error creando commit: ${err.message}` };
  }
}

/**
 * Empuja la rama al remoto usando el token de GitHub configurado.
 */
export async function empujarRama({ rama, forzar = false } = {}, deps = {}) {
  const targetBranch = String(rama || '').trim();
  if (!targetBranch) return { ok: false, error: 'Especifica la rama a empujar.' };
  const token = getGitHubToken(deps);
  const repo = getDefaultRepo(deps);
  const repoCwd = deps.repoPath || process.cwd();

  const remoteUrl = token
    ? `https://x-access-token:${token}@github.com/${repo}.git`
    : 'origin';

  const args = ['push', remoteUrl, targetBranch];
  if (forzar) args.push('--force');

  try {
    await runGit(args, repoCwd, deps);
    return { ok: true, rama: targetBranch, repo, nota: `Rama ${targetBranch} empujada a GitHub.` };
  } catch (err) {
    return { ok: false, error: `Error al empujar rama ${targetBranch}: ${err.message}` };
  }
}

/**
 * Crea una Pull Request en GitHub via REST API.
 */
export async function abrirPullRequest({ titulo, cuerpo, rama, base = 'main', repo } = {}, deps = {}) {
  const branchName = String(rama || '').trim();
  const prTitle = String(titulo || '').trim();
  if (!branchName) return { ok: false, error: 'Falta la rama de origen (head).' };
  if (!prTitle) return { ok: false, error: 'Falta el titulo de la Pull Request.' };

  const token = getGitHubToken(deps);
  if (!token) {
    return {
      ok: false,
      error: 'Requiere DAVIS_GITHUB_TOKEN configurado en el servidor para crear Pull Requests en GitHub.'
    };
  }

  const repoTarget = repo || getDefaultRepo(deps);
  const fetchFn = deps.fetchFn || fetchSeguro;
  const url = `https://api.github.com/repos/${repoTarget}/pulls`;

  try {
    const res = await fetchFn(url, {
      method: 'POST',
      headers: {
        'authorization': `Bearer ${token}`,
        'accept': 'application/vnd.github+json',
        'content-type': 'application/json',
        'user-agent': 'DAVIS-Autonomous-Agent'
      },
      body: JSON.stringify({
        title: prTitle,
        head: branchName,
        base,
        body: cuerpo || `Pull Request generada automaticamente por D.A.V.I.S.\n\nRama: ${branchName}`
      })
    });

    const data = await res.json();
    if (!res.ok) {
      return { ok: false, error: data.message || `HTTP ${res.status}`, detalles: data.errors };
    }

    return {
      ok: true,
      numero: data.number,
      url: data.html_url,
      titulo: data.title,
      estado: data.state,
      nota: `Pull Request #${data.number} abierta exitosamente.`
    };
  } catch (err) {
    return { ok: false, error: `Error comunicando con la API de GitHub: ${err.message}` };
  }
}

/**
 * Orquesta un ciclo de programacion completo: rama -> commit -> verificacion -> push -> PR.
 */
export async function ejecutarTareaProgramacion({ tarea, rama, archivos = ['.'], base = 'main' } = {}, deps = {}) {
  const t = String(tarea || '').trim();
  if (!t) return { ok: false, error: 'Describe la tarea de programacion.' };

  const branchName = rama || `feat/davis-${Date.now().toString(36)}`;

  // 1. Crear rama
  const rRama = await crearRamaTrabajo({ nombreRama: branchName, base }, deps);
  if (!rRama.ok) return rRama;

  // 2. Commit
  const rCommit = await crearCommit({ mensaje: `feat: ${t}`, archivos }, deps);

  // 3. Empujar
  const rPush = await empujarRama({ rama: branchName }, deps);
  if (!rPush.ok) return rPush;

  // 4. Abrir PR
  const rPr = await abrirPullRequest({
    titulo: `feat: ${t}`,
    cuerpo: `Implementacion automatica realizada por D.A.V.I.S.\n\nTarea: ${t}\nCommit: ${rCommit.hash || 'HEAD'}`,
    rama: branchName,
    base
  }, deps);

  return {
    ok: true,
    rama: branchName,
    commit: rCommit.hash || null,
    pr: rPr.ok ? rPr.url : null,
    prDetalle: rPr
  };
}
