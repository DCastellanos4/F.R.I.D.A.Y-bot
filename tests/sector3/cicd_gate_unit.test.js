/**
 * cicd_gate_unit.test.js
 * Tests de la puerta de calidad del CI/CD (deploy/quality-gate.mjs):
 * criterio aprobado = criticos 100% ejecutados y sin fallos + suite >=95%
 * de ejecutadas. Cubre los casos negativos fail-closed.
 *
 * Strict Policy: Zero Emojis.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsearResumenTap, evaluarPuerta } from '../../deploy/quality-gate.mjs';

const tap = ({ tests, pass, fail, skipped }) => `# tests ${tests}\n# pass ${pass}\n# fail ${fail}\n# skipped ${skipped}\n`;
const criticoOk = parsearResumenTap(tap({ tests: 30, pass: 30, fail: 0, skipped: 0 }));

test('puerta: caso feliz - criticos perfectos y suite al 100%', () => {
  const r = evaluarPuerta({ critico: criticoOk, suite: parsearResumenTap(tap({ tests: 663, pass: 661, fail: 0, skipped: 2 })), minPct: 95 });
  assert.equal(r.superada, true);
  assert.equal(r.pct, 100);
});

test('puerta: fallo NO critico dentro del margen (4 de 200 = 98%) SUPERA, con aviso', () => {
  const suite = parsearResumenTap(tap({ tests: 200, pass: 196, fail: 4, skipped: 0 }));
  const r = evaluarPuerta({ critico: criticoOk, suite, minPct: 95 });
  assert.equal(r.superada, true, 'criterio aprobado: <=5% de fallos no criticos puede pasar');
  assert.ok(r.motivos.some((m) => m.startsWith('Aviso: 4 fallo(s) NO criticos')));
});

test('puerta: 94.x% de ejecutadas BLOQUEA aunque los fallos sean no criticos', () => {
  const suite = parsearResumenTap(tap({ tests: 200, pass: 188, fail: 12, skipped: 0 }));
  const r = evaluarPuerta({ critico: criticoOk, suite, minPct: 95 });
  assert.equal(r.superada, false);
  assert.ok(r.motivos.some((m) => m.includes('94.00% < 95%')));
});

test('puerta: las omitidas NO cuentan en el denominador (94/98 ejecutadas = 95.9% supera; 94/100 seria 94%)', () => {
  const suite = parsearResumenTap(tap({ tests: 100, pass: 94, fail: 4, skipped: 2 }));
  const r = evaluarPuerta({ critico: criticoOk, suite, minPct: 95 });
  assert.ok(Math.abs(r.pct - (94 * 100) / 98) < 0.001, 'denominador = ejecutadas');
  assert.equal(r.superada, true, 'excluyendo skips supera el 95%');
});

test('puerta: critica fallando BLOQUEA aunque la suite este al 99%', () => {
  const criticoMal = parsearResumenTap(tap({ tests: 30, pass: 29, fail: 1, skipped: 0 }));
  const suite = parsearResumenTap(tap({ tests: 663, pass: 660, fail: 1, skipped: 2 }));
  const r = evaluarPuerta({ critico: criticoMal, suite, minPct: 95 });
  assert.equal(r.superada, false);
  assert.ok(r.motivos.some((m) => m.includes('CRITICA(S) fallando')));
});

test('puerta: critica OMITIDA BLOQUEA (skip no vale como superada)', () => {
  const criticoSkip = parsearResumenTap(tap({ tests: 30, pass: 29, fail: 0, skipped: 1 }));
  const r = evaluarPuerta({ critico: criticoSkip, suite: parsearResumenTap(tap({ tests: 100, pass: 100, fail: 0, skipped: 0 })), minPct: 95 });
  assert.equal(r.superada, false);
  assert.ok(r.motivos.some((m) => m.includes('omitida')));
});

test('puerta: conjunto critico vacio (ficheros ausentes) BLOQUEA', () => {
  const vacio = parsearResumenTap(tap({ tests: 0, pass: 0, fail: 0, skipped: 0 }));
  const r = evaluarPuerta({ critico: vacio, suite: parsearResumenTap(tap({ tests: 100, pass: 100, fail: 0, skipped: 0 })), minPct: 95 });
  assert.equal(r.superada, false);
  assert.ok(r.motivos.some((m) => m.includes('no ejecuto ninguna test')));
});

test('puerta: TAP no parseable o ausente BLOQUEA (error del runner)', () => {
  const roto = parsearResumenTap('segmentation fault\n');
  assert.equal(roto.parseable, false);
  const r1 = evaluarPuerta({ critico: roto, suite: criticoOk, minPct: 95 });
  assert.equal(r1.superada, false);
  const r2 = evaluarPuerta({ critico: criticoOk, suite: parsearResumenTap(''), minPct: 95 });
  assert.equal(r2.superada, false);
  const r3 = evaluarPuerta({ critico: null, suite: null, minPct: 95 });
  assert.equal(r3.superada, false);
});

test('puerta: suite con cero ejecutadas BLOQUEA', () => {
  const suite = parsearResumenTap(tap({ tests: 10, pass: 0, fail: 0, skipped: 10 }));
  const r = evaluarPuerta({ critico: criticoOk, suite, minPct: 95 });
  assert.equal(r.superada, false);
});

test('puerta: TAP truncado sin lineas de resumen -> bloquea (error del runner no se enmascara)', () => {
  const truncado = 'TAP version 13\n# Subtest: algo\nok 1 algo\n';
  const r = evaluarPuerta({ critico: parsearResumenTap(truncado), suite: parsearResumenTap(truncado), minPct: 95 });
  assert.equal(r.superada, false);
  assert.ok(r.motivos.some((m) => m.includes('no parseable')));
});

test('puerta: suite con 0 tests ejecutadas -> bloquea', () => {
  const vacio = 'TAP version 13\n# tests 0\n# pass 0\n# fail 0\n# skipped 0\n';
  const ok = 'TAP version 13\n# tests 5\n# pass 5\n# fail 0\n# skipped 0\n';
  const r = evaluarPuerta({ critico: parsearResumenTap(ok), suite: parsearResumenTap(vacio), minPct: 95 });
  assert.equal(r.superada, false);
  assert.ok(r.motivos.some((m) => m.includes('no ejecuto ninguna')));
});
