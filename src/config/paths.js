/**
 * paths.js
 * Anclas de rutas del proyecto (raiz y carpeta de datos).
 * Centraliza la resolucion para que los modulos vivan en subcarpetas
 * sin depender de su propia ubicacion.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIRNAME = path.dirname(fileURLToPath(import.meta.url));

export const PROJECT_ROOT = path.resolve(DIRNAME, '..', '..');
export const DATA_DIR = path.join(PROJECT_ROOT, 'data');
