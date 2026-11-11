/** Offline RF02 evidence summary. No model, network, environment or activation path. */
function requireValue(ok, message) {
  if (!ok) throw new TypeError(`RF02 evidence: ${message}`);
}
function finiteNonnegative(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}
function range(values) {
  return { min: Math.min(...values), max: Math.max(...values) };
}

export function resumirMedicionSlm(records, { judgments = {}, targetsMs = [80, 250, 2000] } = {}) {
  requireValue(Array.isArray(records), 'records must be an array');
  requireValue(records.length >= 3 && records.length <= 10002, 'record count out of bounds');
  requireValue(records[0]?.type === 'protocol' && records.at(-1)?.type === 'summary', 'protocol and summary boundaries required');
  const protocol = records[0];
  const summary = records.at(-1);
  const results = records.slice(1, -1);
  requireValue(results.length > 0 && results.every(r => r?.type === 'result'), 'only result records between boundaries');
  requireValue(typeof protocol.model === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/.test(protocol.model), 'model required');
  requireValue(typeof protocol.digest === 'string' && /^[0-9a-f]{64}$/.test(protocol.digest), 'model digest required');
  requireValue(Number.isSafeInteger(protocol.maxCalls) && protocol.maxCalls > 0 && protocol.maxCalls <= 10000, 'maxCalls invalid');
  requireValue(Array.isArray(protocol.cases) && protocol.cases.length === protocol.maxCalls, 'case manifest required');
  const cases = new Map();
  for (const c of protocol.cases) {
    requireValue(typeof c?.id === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(c.id) && !cases.has(c.id), 'duplicate or missing manifest id');
    cases.set(c.id, c);
  }
  requireValue(Object.hasOwn(protocol, 'keepAlive') && finiteNonnegative(protocol.perCallMs) && protocol.perCallMs > 0, 'variant settings required');
  requireValue(summary.attempted === results.length && results.length <= protocol.maxCalls, 'attempt count mismatch');
  requireValue(summary.maxCalls === protocol.maxCalls && finiteNonnegative(summary.elapsedMs), 'summary mismatch');
  requireValue(Number.isSafeInteger(summary.peakOwnUnderlyingRequests) && summary.peakOwnUnderlyingRequests >= 0, 'peak request count invalid');
  requireValue(typeof summary.underlyingPending === 'boolean' && typeof summary.admissionStopped === 'boolean', 'summary state must be explicit');
  requireValue(Array.isArray(targetsMs) && targetsMs.length > 0 && targetsMs.every(v => finiteNonnegative(v) && v > 0), 'latency targets invalid');
  requireValue(judgments !== null && typeof judgments === 'object' && !Array.isArray(judgments), 'judgments must be an object');
  const seen = new Set();
  const rows = [];
  for (const r of results) {
    requireValue(cases.has(r.id) && !seen.has(r.id), 'unknown or duplicate result id');
    seen.add(r.id);
    requireValue(finiteNonnegative(r.wallMs), 'wallMs invalid');
    requireValue(typeof r.result?.exito === 'boolean', 'acceptance must be explicit');
    requireValue(typeof r.underlyingPending === 'boolean', 'pending state must be explicit');
    requireValue(r.transport?.done === true, 'incomplete transport is not a completed sample');
    const total = r.transport.total_duration;
    const load = r.transport.load_duration;
    requireValue(Number.isSafeInteger(total) && total >= 0 && Number.isSafeInteger(load) && load >= 0 && load <= total, 'transport durations invalid');
    const judgment = Object.hasOwn(judgments, r.id) ? judgments[r.id] : null;
    requireValue(judgment === null || (typeof judgment?.semanticCorrect === 'boolean' && typeof judgment?.source === 'string' && judgment.source.length > 0), 'judgment needs semanticCorrect and source');
    rows.push({ id: r.id, accepted: r.result.exito, semanticCorrect: judgment?.semanticCorrect ?? null,
      wallMs: r.wallMs, loadMs: load / 1e6, nonLoadMs: (total - load) / 1e6, pending: r.underlyingPending });
  }
  requireValue(Object.keys(judgments).every(id => seen.has(id)), 'judgment without result');
  // Model confidence and the old harness semanticMatch are deliberately not adjudicators.
  const quality = { adjudicated: 0, correctAccepted: 0, correctRejected: 0, incorrectAccepted: 0, incorrectRejected: 0, unknown: 0 };
  for (const r of rows) {
    if (r.semanticCorrect === null) { quality.unknown++; continue; }
    quality.adjudicated++;
    const key = `${r.semanticCorrect ? 'correct' : 'incorrect'}${r.accepted ? 'Accepted' : 'Rejected'}`;
    quality[key]++;
  }
  return {
    scope: 'historical_observed_variant_only', model: protocol.model, digest: protocol.digest,
    sampleCount: rows.length, manifestCount: protocol.cases.length, keepAlive: protocol.keepAlive,
    measuredClientTimeoutMs: protocol.perCallMs,
    latency: { wallMs: range(rows.map(r => r.wallMs)), loadMs: range(rows.map(r => r.loadMs)),
      nonLoadMs: range(rows.map(r => r.nonLoadMs)),
      observedSamplesWithinTarget: targetsMs.map(ms => ({ targetMs: ms, count: rows.filter(r => r.wallMs <= ms).length })),
      populationP95Ms: null, warmLatencyMs: null },
    quality, rows,
    ownConcurrency: { observedPeak: summary.peakOwnUnderlyingRequests, residualPending: summary.underlyingPending || rows.some(r => r.pending),
      globalExclusionWithTickets: 'unverified' },
    claims: { productionEligible: false, confidenceCalibrated: false, causalTokenSavings: null, costSavings: null,
      reason: 'offline descriptive evidence cannot authorize activation, prove warm speed, quality calibration, a population SLA, global resource exclusion or causal savings' }
  };
}
