/**
 * Dashboard provisionado de Grafana: filtro de entorno SIN mezcla silenciosa.
 *
 * Las metricas de las sondas de staging comparten nombres (herramientas,
 * modelos) con las de produccion. Si los paneles agregaran todos los jobs, una
 * sonda se veria como actividad real de David. Reglas comprobadas aqui
 * (estaticas: no hay Grafana en CI; la inspeccion visual es aparte):
 *  - existe la variable "entorno", por defecto PRODUCCION, sin opcion Todos
 *    y sin multiseleccion;
 *  - TODA consulta sobre metricas jarvis_* filtra job=~"$entorno";
 *  - la regex de produccion cubre los jobs de prometheus.yml y NO uno de
 *    sonda; la de staging solo jobs davis-staging*.
 *
 * Strict Policy: Zero Emojis.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const DASH = path.resolve('deploy/observabilidad/grafana/provisioning/dashboards/jarvis.json');
const PROM = path.resolve('deploy/observabilidad/prometheus.yml');
const dash = JSON.parse(fs.readFileSync(DASH, 'utf8'));

const anclada = (re) => new RegExp(`^(?:${re})$`);

test('variable entorno: produccion por defecto, sin Todos ni multi', () => {
  const v = (dash.templating?.list || []).find((x) => x.name === 'entorno');
  assert.ok(v, 'existe la variable entorno');
  assert.equal(v.multi, false);
  assert.equal(v.includeAll, false);
  assert.equal(v.current.text, 'Produccion');
  assert.equal(v.current.value, 'jarvis-.+');
  assert.equal(v.options.filter((o) => o.selected).length, 1, 'una unica seleccion por defecto');
});

test('todas las consultas filtran job por el entorno', () => {
  let n = 0;
  for (const p of dash.panels) {
    for (const t of p.targets) {
      n += 1;
      const metricas = t.expr.match(/jarvis_[a-z_]+/g) || [];
      assert.ok(metricas.length > 0, `panel "${p.title}" usa metricas jarvis_*`);
      const selectores = t.expr.match(/jarvis_[a-z_]+(\{[^}]*\})?/g);
      for (const sel of selectores) {
        assert.ok(sel.includes('job=~"$entorno"'), `selector sin filtro de entorno: ${sel} (panel "${p.title}")`);
      }
    }
  }
  assert.ok(n >= 7, `se revisaron las consultas del dashboard (${n})`);
});

test('regex de entorno: produccion cubre los jobs reales y no los de sonda; staging al reves', () => {
  const v = dash.templating.list.find((x) => x.name === 'entorno');
  const prod = anclada(v.options.find((o) => o.text === 'Produccion').value);
  const stg = anclada(v.options.find((o) => o.text.startsWith('Staging')).value);
  const yml = fs.readFileSync(PROM, 'utf8');
  const jobs = [...yml.matchAll(/job_name:\s*(\S+)/g)].map((m) => m[1]);
  assert.ok(jobs.length >= 2, `jobs de prometheus.yml: ${jobs}`);
  for (const j of jobs) {
    assert.ok(prod.test(j), `job de produccion ${j} entra en Produccion`);
    assert.ok(!stg.test(j), `job de produccion ${j} NO entra en Staging`);
  }
  for (const j of ['davis-staging-probe', 'davis-staging']) {
    assert.ok(stg.test(j), `${j} entra en Staging`);
    assert.ok(!prod.test(j), `${j} NO entra en Produccion`);
  }
});
