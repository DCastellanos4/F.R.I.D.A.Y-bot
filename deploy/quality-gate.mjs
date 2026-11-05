#!/usr/bin/env node
/**
 * quality-gate.mjs - Puerta de calidad del CI/CD de F.R.I.D.A.Y-bot.
 *
 * Criterio aprobado por David (WhatsApp 2026-11-05 22:27):
 *   - Tests CRITICOS: todos ejecutados, 0 fallos y 0 omitidos (skip = fallo).
 *   - Suite completa: >= MIN_PCT de las tests EJECUTADAS pasan (las omitidas
 *     no cuentan en el denominador y se reportan aparte). Los fallos NO
 *     criticos pueden pasar si el porcentaje aguanta.
 * Fail-closed: fichero TAP ausente, resumen no parseable, cero ejecutadas o
 * error del runner => la puerta FALLA.
 *
 * Uso: node deploy/quality-gate.mjs --critical TAP1 --suite TAP2 --min-pct 95
 * Exit 0 = puerta superada; 1 = bloquea despliegue.
 */
import fs from 'node:fs';

function arg(nombre) {
  const i = process.argv.indexOf(`--${nombre}`);
  return i >= 0 ? process.argv[i + 1] : null;
}

export function parsearResumenTap(texto) {
  const num = (etiqueta) => {
    const m = String(texto).match(new RegExp(`^# ${etiqueta} (\\d+)\\s*$`, 'm'));
    return m ? Number(m[1]) : null;
  };
  const r = { tests: num('tests'), pass: num('pass'), fail: num('fail'), skipped: num('skipped') };
  r.parseable = [r.tests, r.pass, r.fail, r.skipped].every((v) => v !== null);
  return r;
}

export function evaluarPuerta({ critico, suite, minPct }) {
  const motivos = [];
  if (!critico || !critico.parseable) motivos.push('BLOQUEO: resumen TAP de criticos ausente o no parseable.');
  else {
    if (critico.tests === 0 || critico.pass === 0) motivos.push('BLOQUEO: el conjunto critico no ejecuto ninguna test (¿ficheros ausentes?).');
    if (critico.fail > 0) motivos.push(`BLOQUEO: ${critico.fail} test(s) CRITICA(S) fallando.`);
    if (critico.skipped > 0) motivos.push(`BLOQUEO: ${critico.skipped} test(s) CRITICA(S) omitida(s): una critica omitida no cuenta como superada.`);
  }
  let pct = null;
  if (!suite || !suite.parseable) motivos.push('BLOQUEO: resumen TAP de la suite ausente o no parseable (¿error del runner?).');
  else {
    const ejecutadas = suite.tests - suite.skipped;
    if (ejecutadas <= 0) motivos.push('BLOQUEO: la suite no ejecuto ninguna test.');
    else {
      pct = (suite.pass * 100) / ejecutadas;
      if (pct < minPct) motivos.push(`BLOQUEO: ${pct.toFixed(2)}% < ${minPct}% minimo de tests ejecutadas.`);
      if (suite.fail > 0) motivos.push(`Aviso: ${suite.fail} fallo(s) NO criticos dentro del margen (${pct.toFixed(2)}% >= ${minPct}%).`);
    }
  }
  const superada = motivos.every((m) => !m.startsWith('BLOQUEO'));
  return { superada, pct, motivos };
}

if (process.argv[1] && process.argv[1].endsWith('quality-gate.mjs')) {
  const rutaCritico = arg('critical');
  const rutaSuite = arg('suite');
  const minPct = Number(arg('min-pct') || '95');
  const leer = (r) => { try { return fs.readFileSync(r, 'utf8'); } catch { return null; } };
  const critico = rutaCritico ? parsearResumenTap(leer(rutaCritico) ?? '') : null;
  const suite = rutaSuite ? parsearResumenTap(leer(rutaSuite) ?? '') : null;
  const r = evaluarPuerta({ critico, suite, minPct });
  for (const m of r.motivos) console.log(m);
  if (r.pct !== null) console.log(`Suite ejecutadas: ${r.pct.toFixed(2)}% (minimo ${minPct}%).`);
  console.log(r.superada ? 'PUERTA SUPERADA' : 'PUERTA NO SUPERADA: no se despliega.');
  process.exit(r.superada ? 0 : 1);
}
