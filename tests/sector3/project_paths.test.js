/**
 * project_paths.test.js
 * Regresion de la reorganizacion por carpetas: las rutas del proyecto se
 * anclan a la raiz (src/config/paths.js) y los overrides de entorno siguen
 * mandando, sin depender del directorio de trabajo ni de la ubicacion de
 * cada modulo.
 *
 * Strict Policy: Zero Emojis.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_ESPERADO = path.resolve(__dirname, '..', '..');

test('paths.js ancla PROJECT_ROOT y DATA_DIR a la raiz del repositorio sin override', async () => {
  const previo = process.env.DAVIS_DATA_DIR;
  delete process.env.DAVIS_DATA_DIR;
  try {
    // Query unica para evadir la cache de modulos y releer la variable de entorno.
    const { PROJECT_ROOT, DATA_DIR } = await import(`../../src/config/paths.js?test=${Date.now()}`);
    assert.equal(PROJECT_ROOT, ROOT_ESPERADO);
    assert.equal(DATA_DIR, path.join(ROOT_ESPERADO, 'data'));
  } finally {
    if (previo !== undefined) process.env.DAVIS_DATA_DIR = previo;
  }
});

test('DAVIS_DATA_DIR tiene prioridad sobre la carpeta por defecto', async () => {
  const dirTemporal = fs.mkdtempSync(path.join(os.tmpdir(), 'davis-data-test-'));
  const previo = process.env.DAVIS_DATA_DIR;
  process.env.DAVIS_DATA_DIR = dirTemporal;
  try {
    const { DATA_DIR } = await import(`../../src/config/paths.js?test2=${Date.now()}`);
    assert.equal(DATA_DIR, dirTemporal, 'el override aísla los datos fuera del repo');
  } finally {
    if (previo !== undefined) process.env.DAVIS_DATA_DIR = previo; else delete process.env.DAVIS_DATA_DIR;
  }
});

test('DAVIS_HISTORY_DIR tiene prioridad sobre la carpeta por defecto', async () => {
  const dirTemporal = fs.mkdtempSync(path.join(os.tmpdir(), 'davis-hist-test-'));
  const valorPrevio = process.env.DAVIS_HISTORY_DIR;
  process.env.DAVIS_HISTORY_DIR = dirTemporal;
  try {
    // Query unica para evadir la cache de modulos y releer la variable de entorno.
    const servicio = await import(`../../src/services/conversationHistoryService.js?test=${Date.now()}`);
    servicio.registrarMensaje('chat-regresion-paths', 'user', 'mensaje de regresion');
    const archivos = fs.readdirSync(dirTemporal);
    assert.equal(archivos.length, 1, 'el historial debe escribirse en el override');
    const modo = fs.statSync(path.join(dirTemporal, archivos[0])).mode & 0o777;
    if (process.platform !== 'win32') {
      assert.equal(modo, 0o600, 'el historial conserva permisos 600');
    }
    const historial = servicio.obtenerHistorial('chat-regresion-paths');
    assert.equal(historial.length, 1);
    assert.equal(historial[0].content, 'mensaje de regresion');
  } finally {
    if (valorPrevio === undefined) delete process.env.DAVIS_HISTORY_DIR;
    else process.env.DAVIS_HISTORY_DIR = valorPrevio;
    fs.rmSync(dirTemporal, { recursive: true, force: true });
  }
});
