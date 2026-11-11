# RF02 timeout and admission

Observed bug: the adapter put Promise.race(request, timeout) inside its admission queue. On a caller timeout the queue advanced, even when the actual non-streaming SDK request was still running. A subsequent call could overlap it, contradicting the intended one-in-flight rule.

Minimal correction: the queue now receives and retains the actual request promise. The caller separately receives the timeout result. A late success cannot replace the timeout. A late rejection is handled. Once the real request resolves or rejects, the queue may admit the next explicitly requested call. No request is retried automatically. The same contract applies to an injected shared serializador that awaits its callback result.

Limits: this does not cancel server generation or guarantee a wall-clock CPU deadline. If the actual request never settles, admission remains blocked, deliberately. Queued callers can remain pending; no automatic reset, retry, recovery or forced server stop was added. A benchmark must stop admitting calls after its first timeout rather than enqueue a replacement. Exclusion is per adapter instance by default; system-wide exclusion with tickets still requires the existing shared serializer and operational coordination.

Directed verification: 28 tests pass, zero failures/skips. The 24 existing RF02 tests plus four local deferred-SDK cases cover real settlement after client timeout (success and failure), maximum one active call, late result isolation, shared serializer ownership, and immediate SDK failure followed by a new explicit call. No model, network or service was used. This is not a server cancellation test, performance result, SLA, calibration or savings claim.

## Follow-up local revision, November 11

The historical correction above remains provenance, not the final adapter bytes. The new caller deadline starts before client setup and includes queue wait and generation. Expired queued callbacks check their own expired flag and never call the SDK later. A running SDK request still holds admission until real settlement; timeout does not cancel its CPU. Caller timeout depends on event-loop scheduling, not a hard real-time bound. Blocked queue callbacks may remain retained until the active request settles; this change does not add a global memory bound. Tests added for queued expiry, late success/rejection, multiple waiting callers and shared total deadline.
