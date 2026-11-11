import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { resumirMedicionSlm } from '../../scripts/rf02/measurementSummary.js';
const records = fs.readFileSync(new URL('../fixtures/rf02-cold-six-historical.jsonl', import.meta.url), 'utf8').trim().split('\n').map(JSON.parse);
const clone = () => structuredClone(records);
const judgments = { E1: { semanticCorrect: true, source: 'synthetic raw answer contains producto=arroz; confidence 0.5 rejects acceptance' } };
test('historical six calls are descriptive, not an activation gate', () => {
  const r = resumirMedicionSlm(records, { judgments });
  assert.equal(r.sampleCount, 6); assert.equal(r.keepAlive, 0); assert.equal(r.measuredClientTimeoutMs, 30000);
  assert.ok(r.latency.wallMs.min > 7272 && r.latency.wallMs.max < 9218);
  assert.deepEqual(r.latency.observedSamplesWithinTarget.map(x => x.count), [0, 0, 0]);
  assert.equal(r.quality.correctRejected, 1); assert.equal(r.quality.unknown, 5);
  assert.equal(r.latency.populationP95Ms, null); assert.equal(r.latency.warmLatencyMs, null);
  assert.equal(r.claims.productionEligible, false); assert.equal(r.claims.causalTokenSavings, null);
  assert.equal(r.ownConcurrency.globalExclusionWithTickets, 'unverified');
});
test('confidence and legacy semanticMatch do not silently become quality labels', () => {
  const a = clone(); for (const r of a.slice(1,-1)) { r.semanticMatch=true; r.result.confianza=1; }
  assert.equal(resumirMedicionSlm(a).quality.adjudicated, 0);
});
test('no raw text, prompts or answers are emitted by summary', () => {
  const r = JSON.stringify(resumirMedicionSlm(records));
  for (const needle of ['Ciudad Ejemplo', 'arroz', 'rawSyntheticAnswer', 'cases', 'input']) assert.equal(r.includes(needle), false);
});
for (const [name, mutate] of [
  ['missing protocol', a => a.shift()],
  ['missing summary', a => a.pop()],
  ['duplicate result', a => { a[2]=structuredClone(a[1]); }],
  ['unknown result id', a => { a[1].id='unknown'; }],
  ['duplicate manifest', a => { a[0].cases[1].id=a[0].cases[0].id; }],
  ['incomplete transport', a => { a[1].transport.done=false; }],
  ['negative wall duration', a => { a[1].wallMs=-1; }],
  ['nan duration', a => { a[1].wallMs=NaN; }],
  ['missing acceptance', a => { delete a[1].result.exito; }],
  ['coerced acceptance', a => { a[1].result.exito='true'; }],
  ['missing pending state', a => { delete a[1].underlyingPending; }],
  ['load exceeds total', a => { a[1].transport.load_duration=a[1].transport.total_duration+1; }],
  ['fractional nanoseconds', a => { a[1].transport.load_duration=0.5; }],
  ['attempt mismatch', a => { a.at(-1).attempted=5; }],
  ['missing keepalive', a => { delete a[0].keepAlive; }],
  ['digest absent', a => { delete a[0].digest; }],
  ['invalid peak count', a => { a.at(-1).peakOwnUnderlyingRequests=-1; }],
]) test(`rejects ${name}`, () => { const a=clone();mutate(a);assert.throws(() => resumirMedicionSlm(a), /RF02 evidence/); });
test('quality adjudication requires traceable independent source', () => {
  assert.throws(() => resumirMedicionSlm(records, { judgments: { E1: { semanticCorrect: true } } }), /judgment/);
  assert.throws(() => resumirMedicionSlm(records, { judgments: { missing: { semanticCorrect: true, source: 'test' } } }), /judgment/);
});
test('pending work and overlap remain explicit even with a fast latency', () => {
  const a=clone(); a[1].wallMs=1;a[1].underlyingPending=true;a.at(-1).peakOwnUnderlyingRequests=2;
  const r=resumirMedicionSlm(a);assert.equal(r.ownConcurrency.residualPending,true);assert.equal(r.ownConcurrency.observedPeak,2);
  assert.equal(r.claims.productionEligible,false);
});
test('load removal is descriptive only, never a prediction of warm latency', () => {
  const r=resumirMedicionSlm(records);assert.ok(r.latency.nonLoadMs.min>3300);assert.ok(r.latency.nonLoadMs.max<5300);
  assert.equal(r.latency.warmLatencyMs,null);
});
test('unknown observations cannot enter the completed-sample stream', () => {
  const a=clone();a[2]={type:'result',...a[2],type:'debug'};
  assert.throws(()=>resumirMedicionSlm(a),/only result/);
});
for(const [name,value] of [['oversized model','x'.repeat(129)],['control model','bad\nmodel'],['empty model','']])test(`rejects ${name}`,()=>{
 const a=clone();a[0].model=value;assert.throws(()=>resumirMedicionSlm(a),/model required/);
});
for(const [name,value] of [['oversized id','x'.repeat(65)],['control id','bad\nid'],['html id','<script>']])test(`rejects ${name}`,()=>{
 const a=clone();a[0].cases[0].id=value;a[1].id=value;assert.throws(()=>resumirMedicionSlm(a),/manifest id/);
});
