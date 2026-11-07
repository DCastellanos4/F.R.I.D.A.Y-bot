import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import {
  verificarYRegistrarIdempotencia,
  guardarResultadoIdempotencia,
  calcularHashIdempotencia,
  limpiarCacheIdempotencia,
  IDEMPOTENCY_DEFAULT_WINDOW_MS
} from '../../src/services/idempotencyService.js';

describe('Idempotency Service Tests', () => {
  const tmpDir = path.join(process.cwd(), 'tests', 'fixtures', 'idempotency_test');
  const rutaArchivo = path.join(tmpDir, 'idempotency_cache.json');
  const deps = { rutaArchivo };

  beforeEach(() => {
    limpiarCacheIdempotencia(deps);
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
    fs.mkdirSync(tmpDir, { recursive: true });
  });

  it('debe ignorar herramientas no mutantes como consultar_clima', () => {
    const res = verificarYRegistrarIdempotencia({
      tool: 'consultar_clima',
      args: { ciudad: 'Madrid' },
      chatId: 'david'
    }, deps);

    assert.strictEqual(res.esMutante, false);
    assert.strictEqual(res.duplicado, false);
  });

  it('debe registrar y permitir la primera ejecucion de registrar_gasto', () => {
    const res = verificarYRegistrarIdempotencia({
      tool: 'registrar_gasto',
      args: { cantidad: 15, concepto: 'Almuerzo' },
      chatId: 'david'
    }, deps);

    assert.strictEqual(res.esMutante, true);
    assert.strictEqual(res.duplicado, false);
    assert.ok(res.clave);
  });

  it('debe detectar duplicados ante llamadas identicas dentro de la ventana de 10 min', () => {
    const ahora = Date.now();
    const payload = {
      tool: 'registrar_gasto',
      args: { cantidad: 15, concepto: 'Almuerzo' },
      chatId: 'david',
      ahora
    };

    const res1 = verificarYRegistrarIdempotencia(payload, deps);
    assert.strictEqual(res1.duplicado, false);

    guardarResultadoIdempotencia(res1.clave, 'Anotado gasto de 15 EUR', deps);

    // Segunda llamada 30 segundos despues
    const res2 = verificarYRegistrarIdempotencia({
      ...payload,
      ahora: ahora + 30000
    }, deps);

    assert.strictEqual(res2.duplicado, true);
    assert.strictEqual(res2.transcurridoSegundos, 30);
    assert.strictEqual(res2.resultadoPrevio, 'Anotado gasto de 15 EUR');
    assert.match(res2.mensaje, /ya fue ejecutada hace 30 segundo\(s\)/);
  });

  it('debe permitir la ejecucion una vez expirada la ventana de tiempo', () => {
    const ahora = Date.now();
    const payload = {
      tool: 'anadir_compra',
      args: { articulo: 'leche' },
      chatId: 'david',
      ahora
    };

    const res1 = verificarYRegistrarIdempotencia(payload, deps);
    assert.strictEqual(res1.duplicado, false);

    // Segunda llamada 11 minutos despues (supera 10 min)
    const res2 = verificarYRegistrarIdempotencia({
      ...payload,
      ahora: ahora + IDEMPOTENCY_DEFAULT_WINDOW_MS + 5000
    }, deps);

    assert.strictEqual(res2.duplicado, false);
  });

  it('calcula hash identico sin importar el orden de las propiedades en args', () => {
    const h1 = calcularHashIdempotencia('crear_evento', { titulo: 'Reunion', hora: '10:00' }, 'chat1');
    const h2 = calcularHashIdempotencia('crear_evento', { hora: '10:00', titulo: 'Reunion' }, 'chat1');
    assert.strictEqual(h1, h2);
  });
});
