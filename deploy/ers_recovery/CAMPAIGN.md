# Local complete-order rehearsal, not the production runner

campaign.py is an executable Python state machine for a single bounded local
rehearsal. It has no production backend, CLI, network, process control or I/O.
All candidates explicitly say LOCAL_SYNTHETIC_CANDIDATE and productionAdmission
is always false. The admission manifest lists the complete missing production
integration boundary; true synthetic gate flags cannot grant authority or attest
OS/peer state.

This closes ordering tests, not the remaining runtime implementation:

- two distinct stopped identities must be positively observed with schema-2
  stable config/presence digests before rehearsal;
- uncertain stop, errored state, changed config, custody gap, late/rewound
  monotonic time and pending outcome all hold rather than retry;
- exactly one candidate per app is consumed before its synthetic outcome;
- return, stability, exit and no-restore/delete/save ordering are explicit;
- copied baselines, flags, candidates and snapshots cannot be mutated through
  a caller's original object references;
- serialized snapshots cannot be supplied to the constructor to resume work.

A budget bounds accepted event time only. This state machine does not kill a
blocked adapter or guarantee a wall-clock recovery time. There is no adapter
here to block or execute effects. Its synthetic REHEARSAL/STABILITY/EXIT result
labels are test inputs, not validated runtime proof. Actual production must use
the independent worker deadlines, real Stability samples, PID/log binding and
exit collector, not supply these strings to invent successful observations.

No journal or existing paired-holder productionAdmission flag is changed. The
paired module currently supports local enrollment/stop candidates and survivor
start candidates only. A live two-holder normal return transition and its own
independent peer observation remain to be designed, implemented and reviewed.
This rehearsal does not add an independent parallel journal or bypass that
missing transition by manipulating its JSON. It therefore cannot be promoted
into a stop/start executor by changing a boolean.

The next implementation must connect the existing live paired memory/journal,
fresh OS/manager evidence and bounded process adapters into an admitted runner.
Until then, neither this local success path nor the manifest resolves production
readiness. No new host test or pause is required to run these local tests.
