# Paired local replica, prepared-only extension

Base: reviewed remote commit0ff70917f86d10c0ad9014ad5b55b29b9aa986dc.
New files only: paired.py, this document and two synthetic test files. Previous
primitive/policy/composition code remains unchanged. This is not a production
watchdog, installer, OS campaign or PM2 adapter.

## Implemented composition

Two independent local processes first receive references to the SAME flock OFD
through the reviewed lease transport. Each then opens its own Store mutex FD.
Peer checks use actual socket credentials, PID/start/boot, observed executable
dev/inode and /proc cgroup text. Each side checks the local Python source digest.
These observations are NOT systemd InvocationID/cgroup policy enforcement or
remote executable attestation. A same-uid malicious process is outside this
controlled-actor protocol. Current fdinfo cannot certify unobserved lock history.

The donor creates a new journal with ENROLL_PENDING only if it does not exist.
The receiver obtains a snapshot directly from its authenticated live donor and
compares independently supplied baseline/epoch/source expectations. It never
adopts the JSON as authority. LOCAL_PAIRED requires the two live replicas to
exchange PREPARE and COMMIT ACKs with current lease/process/source observations.
This phase is local preparation, never production admission.

For each donor synthetic STOP intent:

1. Donor validates its live replica against journal under its independent mutex.
2. Receiver validates its own live replica and consumes the next proposal in
   MEMORY before PREPARE ACK. Only the supported phase transition or exactly
   one empty STOP intent can change. Baseline/source/epoch cannot change.
3. Donor persists file+replace+directory sync, then requests COMMIT.
4. Receiver compares persisted state to its pending memory, commits memory and
   ACKs. Only then does donor return a SYNTHETIC intent candidate.

The receiver does NOT acquire the journal mutex while ACKing donor proposals:
the donor owns that mutex and the receiver is a read-only replica in that phase.
Taking the same mutex would deadlock. Atomic replace avoids partial file reads;
comparison to its live/pending state rejects unexpected snapshots. Only a
survivor writes after positive evidence of the other process's death, under its
own independently opened journal mutex.

A failure poisons the affected object. PREPARE uncertainty leaves pending
memory, blocking survivor planning. Post-persist/pre-COMMIT uncertainty also
blocks the receiver despite the journal having a newer state. Lost COMMIT ACK
can leave the receiver fully committed while donor is invalidated; a survivor
can use that committed replica after positive donor-death evidence. No exception
means "nothing happened". A retry never reuses a consumed intent.

## Survivor scope

Either process can reconcile after the OTHER original process is positively
absent (PID/start identity), while keeping its own original lease reference and
its own already committed live memory. EOF, timeout or a live disconnected peer
is NOT death proof. Its journal must match its live replica exactly, with no
pending proposal, LOCAL_PAIRED phase and false productionAdmission. Closing or
reopening the lease, inode replacement and stale/forged journal block it.

A survivor may write only a synthetic START_PENDING candidate for its recorded
STOP intent and exact app/config baseline, using pure policy. It cannot begin a
new stop or fixture. START_PENDING is never retried. App originally still online
would be left unchanged. No PM2 action is made. Fresh processes cannot attach
via this protocol to a preexisting journal and recreate continuity.

The synthetic test actor is not an installation entry point. It uses temporary
paths and no credentials, services or production defaults. Its fault hooks exist
ONLY in tests. The test driver kills/reaps peers to establish positive death.
Both-death tests verify release of the last FD, not automatic recovery afterward.

## Evidence and limits

Run this new layer separately:

    PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s tests/ers_recovery -p test_pair.py -v

Real separate donor/receiver processes, kernel FD transfer and journal writes
are exercised. New tests cover either survivor, repeated intent, lost PREPARE
ACK, lost COMMIT ACK, failure before/after persistence, live-peer no-failover,
JSON rollback/forgery, closed reference, replaced inode and common death.
Prior62 tests are regressions only, not this layer's coverage.

No fsync injection proves power-loss durability. No PID/cgroup read proves unit
containment. A peer's current controlled-API lease reply proves a current check,
not tamper-proof FD custody against outside manipulation. The protocol assumes
its actors never LOCK_UN, expose raw FDs, or close/reuse them outside the API.
It does not hide or repair that inherited limitation with JSON.

Before a production intervention still needed: actual unit identities and
resource policy, bounded cleanup and journal-to-PM2 reconciliation adapters,
non-secret current lock/daemon/config/HTTP baseline, stable retained PM2 return,
marker freshness and sampled75s observation. Shared-host common failures and
extended downtime remain risks. Production pause/installation/deployment need
a concrete approved intervention. This layer alone does not make one ready.
