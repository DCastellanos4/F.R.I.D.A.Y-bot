/**
 * setup_aislamiento.mjs
 *
 * Debe importarse ANTES que cualquier modulo del bot: fija un DAVIS_DATA_DIR
 * temporal para que ninguna prueba escriba en el data/ del repo ni, via el
 * despliegue, en el data/ de produccion. Respeta un DAVIS_DATA_DIR ya fijado.
 *
 * Guardia dura (falla cerrada): la ruta efectiva de datos debe resolver
 * FUERA del repo, no puede ser el data/ de produccion (incluido el caso del
 * servidor, donde <repo>/data es un enlace simbolico al estado en vivo) y no
 * puede ser un enlace simbolico. Ante cualquiera de esas condiciones ABORTA
 * el proceso de pruebas antes de importar modulos del bot.
 *
 * Strict Policy: Zero Emojis.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

if (!process.env.DAVIS_DATA_DIR) {
  const d = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'davis-sector2-')), 'data');
  fs.mkdirSync(d, { recursive: true });
  process.env.DAVIS_DATA_DIR = d;
}
process.env.DAVIS_HISTORY_DIR = process.env.DAVIS_HISTORY_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'davis-sector2-hist-'));
process.env.NODE_ENV = process.env.NODE_ENV || 'test';

export function validarDataDirAislado() {
  const dir = process.env.DAVIS_DATA_DIR;
  if (!dir) {
    throw new Error('PARADA: DAVIS_DATA_DIR no fijada en el entorno de pruebas.');
  }
  fs.mkdirSync(dir, { recursive: true });
  if (fs.lstatSync(dir).isSymbolicLink()) {
    throw new Error(`PARADA: DAVIS_DATA_DIR es un enlace simbolico (${dir}); los tests no pueden escribir a traves de enlaces.`);
  }
  const real = fs.realpathSync(dir);
  let realRepoData = null;
  try { realRepoData = fs.realpathSync(path.join(REPO_ROOT, 'data')); } catch { /* sin data/ en repo */ }
  if (realRepoData && real === realRepoData) {
    throw new Error(`PARADA: DAVIS_DATA_DIR resuelve al data/ de produccion (${real}); aislamiento roto, no se ejecuta la suite.`);
  }
  if (real === REPO_ROOT || real.startsWith(REPO_ROOT + path.sep)) {
    throw new Error(`PARADA: DAVIS_DATA_DIR (${real}) esta dentro del repo; los tests deben usar rutas fuera de produccion.`);
  }
  return real;
}

validarDataDirAislado();
