/**
 * setup_aislamiento.mjs
 *
 * Debe importarse ANTES que cualquier modulo del bot: fija un DAVIS_DATA_DIR
 * temporal para que ninguna prueba escriba en el data/ del repo ni, via el
 * despliegue, en el data/ de produccion. Respeta un DAVIS_DATA_DIR ya fijado.
 *
 * Strict Policy: Zero Emojis.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

if (!process.env.DAVIS_DATA_DIR) {
  const d = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'davis-sector2-')), 'data');
  fs.mkdirSync(d, { recursive: true });
  process.env.DAVIS_DATA_DIR = d;
}
process.env.DAVIS_HISTORY_DIR = process.env.DAVIS_HISTORY_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'davis-sector2-hist-'));
process.env.NODE_ENV = process.env.NODE_ENV || 'test';
