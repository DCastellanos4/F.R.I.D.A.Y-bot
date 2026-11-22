/**
 * paths.js
 * Anclas de rutas del proyecto (raiz y carpeta de datos).
 * Centraliza la resolucion para que los modulos vivan en subcarpetas
 * sin depender de su propia ubicacion.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIRNAME = path.dirname(fileURLToPath(import.meta.url));

export const PROJECT_ROOT = path.resolve(DIRNAME, '..', '..');
// En produccion data/ es un ENLACE SIMBOLICO al estado persistente
// (<release>/data -> jarvis-estado/data). La defensa de tenants
// (tenantFileSystem) exige una raiz canonica: si DATA_DIR queda como el
// enlace, realpath(root) !== root y toda lectura/escritura de tenant
// falla cerrada. Canonicalizar aqui mantiene coherentes la guardia y
// todas las rutas derivadas sin relajarla.
function canonicalizar(ruta) {
  try {
    return fs.realpathSync(ruta);
  } catch {
    return path.resolve(ruta);
  }
}

// DAVIS_DATA_DIR permite aislar tests, CI y evaluaciones en un directorio
// temporal; sin ella, se usa el data/ del proyecto (produccion).
export const DATA_DIR = canonicalizar(process.env.DAVIS_DATA_DIR || path.join(PROJECT_ROOT, 'data'));
