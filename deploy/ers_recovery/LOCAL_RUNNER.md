# Integrated local campaign with original paired holders

local_runner.py connects the reviewed ordered campaign, original live Pair and
the real pure Stability sampler. It cannot execute a PM2 effect, install units
or turn on productionAdmission. All returned candidates remain synthetic.

Before entering the campaign it matches each schema-2 baseline digest/PID/start
and status against the actual Pair's original baseline. Every transition checks
the original live journal/lease and requests a CENSUS exchange from the original
receiver, with its authenticated process/source/lease checks. No JSON journal
is promoted into a fresh live replica.

A stop or return candidate is emitted only after campaign order admission and
the Pair's existing durable PREPARE/COMMIT exchange. A failure poisons both the
runner and campaign. Pending outcomes cannot be retried. Separate observe calls
still require schema-2 config consistency and positive original absence for a
stop. A return's start identity is retained and bound into the Stability start
signature, together with PID/restart counter/launch timestamp.

The normal path must feed real Stability samples at the required cadence and
75-second interval. A string cannot substitute for the sampler in this runner.
The test invokes the real sampler using synthetic times, HTTP classes and
listener/connection flags: this is not a real wait or service observation.

The integrated separate-process test uses actual original kernel flock FD
references, two real peer processes, source/custody checks, independent fixture
observations, durable journal transitions and CENSUS messages. It executes the
complete 7-candidate campaign through those holders. There is no PM2 socket,
real stop/start, service effect, real log read or production observation.

## Still not a production runner

The gates are local synthetic booleans, not independent OS attestation or owner
approval. In production they must be replaced by the reviewed source-grounded
admission module and cannot be filled true because this test passed. The Pair's
return observers are injection boundaries with synthetic fixture files in tests.
The current run does not establish effective cron/watcher state or bind a node
alias to its future execution path. No systemd containment or resource admission
is manufactured from unit dictionaries. Loaded units are not installed here.

Custody reads and subsequent candidate return are point-in-time. No atomicity
with a future effect or proof of historical no-unlock/relock/FD-reuse is claimed.
Budget checks bound accepted local event times, not blocked system calls; an
actual runner needs independent bounded workers for all reads and effects.
Rehearsal no-effects and external reconciliation flags are explicit unfinished
adapters, not evidence tokens. No last-holder close/release is automated.

A survivor currently plans only through Pair's already reviewed survivor path;
this connected runner fails closed on disconnected peers. Dual-holder death,
pending PREPARE uncertainty and post-writer volume restoration are not handled
by inventing a restarted coordinator. No restore/delete/save operation exists.
No new production grant or implicit pause/CI/main/deploy comes from this module.
