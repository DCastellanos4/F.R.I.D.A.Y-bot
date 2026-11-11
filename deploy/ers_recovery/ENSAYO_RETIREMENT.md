# Exact control and seed retirement, LOCAL preparation

This layer extends concrete-local-v3. No HOST command, account operation, installation, timer or removal has been run. The code is a root-operator library, not an enabled service or autonomous scheduler. Root code remains root code; point-in-time custody and closed paths do not make a compromised privileged program harmless.

## Executable pieces and integration

`ensayo_retirement.RetirementIO` extends the reviewed nofollow/dirfd-relative `RootIO` with only these epoch-specific targets:

- `/var/lib/ers-ensayo-bootstrap-<epoch>.jsonl`
- `/var/lib/ers-ensayo-retirement/<epoch>/ticket.json`
- `/var/lib/ers-ensayo-retirement/<epoch>/closeout.jsonl`
- Their fixed root-owned audit parents.

The external executor is `/opt/ers-retirement/<digest-of-exact-22-source-pins>`. Bootstrap now requires those22 source byte inputs, checks their complete set and parity with every shared holder/control source before creating the seed, and installs them exclusively with root-owned0755 directory/0444 files. Original external source inode/hash receipts are recorded separately in the seed/lifecycle. Existing executor epochs are never adopted. This is an added PROPOSED installation scope, not authority to install it. The original account or either departed custodian is not needed to execute retirement.

Bootstrap returns `seedOriginal`, `retirementExecutorRoot` and `retirementExecutorPins`. The seed receipt is captured after its last fsynced `LIFECYCLE_SEALED` row and matched to the original open seed FD; no later append occurs before close. It is not reconstructed from a fresh path at retirement time.

`Finalizer.finish_and_freeze(retirement, seed_original=..., not_before=..., executor_pins=...)` is the composed external operator route. It first calls the nonmutating `Retirement.prepare` on the complete current lifecycle. Known-invalid proposed time, executor pins/originals, control or seed custody, unknown control children, audit destination and lifecycle/capacity are rejected BEFORE FINALIZE_INTENT, file deletion or account effects. Finalizer separately checks remaining roots, original units and live account preconditions. Only after both preflights does it finish exact scope/files/account finalization. `RootJournal.seal` then fsyncs, checks the original lifecycle FD and bounded current bytes, returns the closed log and exact inode/hash key, and closes both descriptors. Only then does `Retirement.freeze` operate. A failure newly arising during/after finalization can still leave explicit retained-state HOLD, not permission to rerun Finalizer. This is not an atomic multi-step guarantee. Known preexisting failures covered by prepare must not be deferred into that category.

The retirement code runs from the independently reviewed external source bundle. It checks that its own path is the exact external pinned route, all22 files and directory have the required root custody and exact set/hash, and that those originals match bootstrap receipts. It never imports code from the control directory being retired. The trusted operator is still responsible for loading the approved bundle in an isolated Python package after checking its sources, just as for other prepared callable root entrypoints. No unreviewed downloaded source or ticket text is an execution instruction.

## Freeze, ticket and proposed time

Freeze requires exactly one finalizer-complete last row, both original custodian identities, one original principal receipt/disposition, closed lifecycle bytes equal to the complete supplied log, original seed identity/hash and manifest binding, the original control directory and exactly13 expected files. Unknown children, source drift, seed/lifecycle replacement, reused manager state, principal mismatch or inaccessible identity fail before creating an external ticket or removing any target.

Both original custodian PIDs must be absent. Their exact manager units must be `LoadState=not-found`, inactive, without MainPID/ControlPID, fragment, dropins or InvocationID after Finalizer removed units and performed its global reload. A reused or still-cached/inaccessible unit means HOLD; this layer does not clear or reset manager state to make the test pass. Actual systemd249 behavior remains an OS verification risk.

Account checks use both name and numeric UID/GID. Removed account/group must still be absent through all four lookups; reuse holds. Explicitly retained account/group must match original IDs, names, shell, home and groups. Retirement never creates, deletes or repairs accounts.

Freeze creates an external epoch audit directory exclusively, then `ticket.json` O_EXCL/root0400. A safe shared audit parent is accepted as NOT_OWNED_OR_SHARED, not repaired. Its absence is checked before attempting to look up an epoch child; an absent parent is created exclusively before traversal, never interpreted as an inaccessible child or adopted epoch. Partial ticket creation leaves residuals; an existing audit epoch prevents a retry. The ticket contains exact target identities/hashes, original actors/principal, manifest/executor pins, proposed not-before Unix timestamp and explicit retained audit/executor/shared-parent scope. The default status is `PROPOSED_PENDING_OWNER_AUTHORITY_NO_SCHEDULE`. Nothing in a ticket approves24h or creates a wake.

## Retirement and follow-through

The trusted operator must independently recover the owner's approval for the exact ticket, timestamp, target set and residual policy before invoking `execute`. Its `approved_binding` argument only protects against the wrong ticket/time/scope. It is NOT evidence of consent. Default invocation raises `RETIRE_PENDING_OWNER_AUTHORITY_NO_EFFECT` before writes. A proposed ticket must never manufacture its own approval argument.

At or after the approved not-before time, the operator rechecks the original audit directory/ticket, exact frozen targets and child set, external source bundle, manager/PID absence and account disposition. Closeout creation is exclusive: any preexisting closeout, even empty or partial, means no retry. `AuditJournal` records RETIRE_INTENT outside the deletion targets before the first unlink. Every deletion has its own intent/receipt with fsync, exact pinned identity and absence readback. Complete checks repeat before each effect. A drift appearing after one deletion may leave a partial result; the code does not claim an atomic transaction.

Removal order is exact control files, empty original control directory, then exact original seed. A removed parent is checked for absence directly; children are not reopened through a replacement parent. No recursive deletion, wildcard, path-prefix adoption, forced account cleanup or unknown-object removal exists. Crash after unlink and before receipt leaves the external intent intact and prohibits autonomous continuation.

`status(frozen)` is the read-only follow-through route. It returns pending, verified complete/no repeat, or HOLD_RESIDUAL_NO_RETRY with targets not certified absent. A complete closeout is not enough on its own: current target absence must also match. Unknown/reappeared/inaccessible state is not absence. Status does not schedule, delete, repair or retry anything.

Before a future actual intervention, main must bind the bootstrap receipt, freeze result, exact ticket digest and owner-approved not-before time into one durable retention task and a clock wake. That task must be set up as part of the approved execution, not left as a future suggestion. On its wake, read status first. Verified completion means no duplicate removal. Pending requires current authority and preflight before executing. Partial or inaccessible state is handed back as HOLD, naming retained targets. Success is reported only after rereading the closeout and absence. No real wake has been created by this preparation.

## Explicit residuals, not "everything gone at24h"

The immutable ticket, closeout journal, external22-source executor and shared parents remain. They are separate audit/code residuals under an owner-approved policy that is still unresolved. Shared parents may contain other epochs and are never removed by this route. The scope is only control+seed removal, not deleting every trace. Existing ciphertext/SQLite retention due in November is unrelated and unchanged.

The bootstrap and live journal131072-byte limits remain. The log row cap is now384 to cover the added46 external-executor intent/receipt rows plus finalizer/control events; a quota failure is HOLD, not truncation. Finalizer/retirement do not reset quota history.

## LOCAL verification and remaining risks

Tests include the real finalizer prepare→finish→seal→freeze wrapper: invalid time/empty pins, unknown control, seed/control/executor drift, existing audit epoch, lifecycle mismatch/capacity/original-FD failure all leave objects/effects/journal/account commands unchanged with no FINALIZE_INTENT. Tests also cover the composed real local dirfd freeze/ticket/retire/readback using fake root metadata/NSS/manager; source/root/seed/lifecycle/unknown contrasts before freeze;15 contrasts after freeze before first intent; exact success/residuals; early/default authority hold; ticket-write crash/no epoch adoption; crash after unlink/no retry; unknown injection between effects; read-only pending/complete/partial/reappeared status; root journal seal and exact output shape; original FD close; audit fsync/no-replace and symlink refusal. No root/systemd/account/HOST call is made by tests.

LOCAL success does not prove systemd249 property formatting or cache lifecycle, cgroup FD behavior after real stop, service mount semantics, kernel deny/proc/capability sentinels, actual headroom/selected IDs, continuous shared OFD/flock ownership, both-custodian-dead filesystem recovery, or immunity to a concurrent privileged actor. The earlier author holder-ready fixture flake stays open; no change here claims to fix it. Independent review of this delta is still required before preservation or any operational offer.
