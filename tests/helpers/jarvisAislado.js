/**
 * jarvisAislado.js - Estado aislado para pruebas que conducen al agente.
 *
 * La cache de idempotencia por defecto vive en data/ (estado compartido,
 * fuera de git): dos ejecuciones de la suite en menos de 10 minutos
 * colisionaban (fallo observado el 8 nov 2026: 13 pruebas en rojo por
 * deduplicacion contra la ejecucion anterior). Todas las pruebas que
 * llaman al agente pasan por aqui: la cache va a un directorio tmp por
 * proceso y el estado compartido/produccion nunca se toca ni se limpia.
 *
 * Una opcion rutaArchivoIdempotencia explicita en la llamada gana al
 * aislado por defecto (la semantica de dedup dentro de la ejecucion se
 * conserva: el tmp es compartido por todo el proceso de pruebas).
 *
 * Strict Policy: Zero Emojis.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { consultarJarvis } from '../../src/core/jarvisAgent.js';

const RUTA_IDEMP_TEST = path.join(
  fs.mkdtempSync(path.join(os.tmpdir(), 'davis-suite-idemp-')),
  'idempotency_cache.json'
);

export function consultarJarvisAislado(mensaje, historial, opciones = {}) {
  let hist = historial;
  let opts = opciones;
  if (!Array.isArray(hist) && hist && typeof hist === 'object') {
    opts = hist;
    hist = [];
  }
  if (!Array.isArray(hist)) hist = [];
  return consultarJarvis(mensaje, hist, { rutaArchivoIdempotencia: RUTA_IDEMP_TEST, ...(opts || {}) });
}
