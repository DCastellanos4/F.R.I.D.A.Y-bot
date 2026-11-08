/**
 * Adaptador de salida: almacen de metricas del clasificador en JSONL.
 *
 * El core (intentRouterService) solo conoce el puerto
 * { registrar(evento), leerEventos() }; el acceso a fs vive aqui.
 *
 * Se conserva la regla historica: en pruebas nunca se escribe en data/
 * del repo salvo ruta inyectada explicitamente.
 *
 * Strict Policy: Zero Emojis.
 */
import fs from 'node:fs';
import path from 'node:path';

const DATA_DIR = process.env.DAVIS_DATA_DIR || path.join(process.cwd(), 'data');
const RUTA_METRICAS_DEFECTO = path.join(DATA_DIR, 'metricas_clasificador.jsonl');

export function crearJsonlClassifierMetricsStore({ rutaArchivo } = {}) {
  const ruta = rutaArchivo || RUTA_METRICAS_DEFECTO;
  const rutaExplicita = Boolean(rutaArchivo);
  return Object.freeze({
    registrar(evento) {
      // En pruebas nunca se escribe en data/ del repo: solo con ruta inyectada.
      if (process.env.NODE_ENV === 'test' && !rutaExplicita) return;
      try {
        fs.mkdirSync(path.dirname(ruta), { recursive: true });
        fs.appendFileSync(ruta, JSON.stringify({ ts: new Date().toISOString(), ...evento }) + '\n', 'utf-8');
      } catch (err) {
        console.error('[SaludClasificador] No se pudo registrar la metrica:', err.message);
      }
    },
    leerEventos() {
      try {
        if (!fs.existsSync(ruta)) return [];
        return fs.readFileSync(ruta, 'utf-8').split('\n').filter(Boolean)
          .map((l) => { try { return JSON.parse(l); } catch { return null; } })
          .filter(Boolean);
      } catch {
        return [];
      }
    }
  });
}
