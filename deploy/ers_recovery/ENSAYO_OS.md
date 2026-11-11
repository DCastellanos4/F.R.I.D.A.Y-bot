> Historical layer record. Current concrete preparation and limits: [ENSAYO_PRIVILEGED.md](ENSAYO_PRIVILEGED.md). Statements below about absent root executors or empty reservation scopes describe the earlier layer, not the current gate-only implementation.

# ENSAYO_OS: prepared, not installed or kernel-verified

Base: `26fd840dedef142e8ce2ec8b7a5a916492d2eb39`. This delta adds a separate no-bot-effects contract. It does not alter `unit_contract.py`, `bootstrap_worker.py`, or `local_unit_launcher.py` and does not widen their LOCAL namespace.

## Routes

- `ensayo_os.py`: closed manifest, renderer, bounded config/source/receipt readers, independent projection matcher, installation and cleanup planners without executors.
- `ensayo_os_worker.py --config /etc/ers-ensayo/<epoch>/<role>.json`: only the RootCustody route. No fixture flag or stdin fallback. The manifest has explicit source and Python pins, UID/GID/groups, role budgets and exact paths. Root-owned, non-group/world-writable config ancestors and sources are required before creating mutable state. The Python command resolves to an explicit versioned inode/hash pin and `/proc/self/exe` must agree. All consumers validate the manifest and sourceRoot/pin-map binding.
- `ensayo_os_fixture.py`: a separate LOCAL mapped fixture. Only private direct `/tmp/ers-ensayo-fixture-*` roots. `/etc`, `/opt`, `/run` are canonical labels mapped to owned fixture files; it never opens those HOST paths. Evidence is permanently `LOCAL_MAPPED_FIXTURE_NOT_ROOT_NOT_OS`. It is not selected by the service entrypoint. Source, config and actual local executable custody are checked as fixture evidence, not root evidence.

## Separation and protocol

Config is root-owned read-only authority under `/etc/ers-ensayo/<epoch>`. Files must be root:manifest.gid 0440, and the epoch config directory root:manifest.gid 0750; root-owned non-writable ancestors remain required. Other users have no file access or epoch-directory traversal. Both readers recheck file identity/content and directory custody policy after parsing. File keys are compared completely; directory checks compare policy, not inode identity between checks. This is point-in-time custody with root ancestors not writable by holders, not an atomic snapshot. Token-bearing config is never returned on failure. Fixture config uses the same 0440/0750 group policy with its local owner instead of root. No real GID is selected by this rule. Mutable state is under the dedicated principal's `/run/ers-ensayo-<epoch>`, outside PrivateTmp. The exact synthetic lock is `ensayo.lock`, not the real deploy exclusion. Socket, journal, journal lock and two receipt names are closed manifest values. The two proposed units have distinct names, no BindsTo/PartOf, `Restart=no`, and preserve runtime state. They do not enable themselves.

Controller requires an empty runtime before exclusively creating the fixture lock. Both roles validate the complete contract/custody before socket/state use, exchange token, process peer identity and manifest digest, transfer the original SCM_RIGHTS lease with ACK, and use the existing ENROLL/PREPARE/COMMIT/CENSUS protocol. No PM2 or model call exists here. The synthetic app records are not a live baseline. No receipt is issued after failed token or incomplete FD ACK.

Receipts contain source/manifest digests, epoch, original PID/start/boot, invocation and cgroup claims, and the lock key. They are bounded, exclusive-created and fsynced. Parent readers enforce private runtime projection, nofollow, inode stability, exact shape and limits. A holder can change its own receipt: this is not OS attestation. `match_staging` separately compares manager, process/executable and original-FD projections and rendered unit-file hashes. Even a match returns `productionAdmission=false`, `kernelContainment=UNVERIFIED`, `effectAdapter=ABSENT`. Its inputs are supplied projections; a HOST collector has not been implemented or authorized by this delta.

## Lifetime, resource and cleanup boundaries

Workers never remove shared runtime, signal the peer, restart, or adopt journals from prior holders. Successful holders stay alive until externally terminated. The 10-second preparation deadline is a plan requirement for an external supervisor, not an active systemd timeout that might kill both before follow-through. It must be arranged before any future start.

Memory and Tasks numbers in tests are synthetic explicit inputs only. No CPU/RAM/Tasks combined measurement, sizing or kernel enforcement has been shown. Runtime byte/entry quotas are bounded userspace checks at protocol checkpoints, not filesystem/kernel quotas. PrivateNetwork/AF_UNIX does not isolate HOST UNIX sockets; future approved kernel/path/FD/proc/capability sentinel tests remain required.

The installation planner requires exact absent targets and refuses existing ones. It has no command executor, privilege path or replacement behavior. Point-in-time absence does not remove the need for exclusive no-replace creation and revalidation. Parent directory creation/custody and existing shared parents need explicit future treatment, not broad inferred installation permission.

Cleanup planning consumes an external exact creation inventory with dev/inode/type/hash/owner/mode/link count, independent death evidence tied to both recorded original PID/start/boot identities, and an exact current inventory. It plans only exact file removals and empty-directory removals. Drift, unknown paths, incomplete death checks or unrelated prefixes hold. No recursive deletion, prefix glob, real deploy-lock removal, bot state restore, or executable cleanup exists. Inventory, deadline, death checks and actual cleanup must live outside both holders. A partial/crashed install can reconcile only its actually recorded created objects, with remaining unknown entries held for review.

## Author tests

`PYTHONDONTWRITEBYTECODE=1 /usr/bin/python3 -m unittest discover -s tests/ers_recovery -p test_ensayo_os.py`

44 tests: closed cross-LOCAL/OS schemas; role/path/sourceRoot equality; explicit Python and principal requirements; mutable/replaced/symlink/hardlink config; private ancestors; extra source rejection; effective UID/GID/groups mismatch; no HOST mapping escape; bounded/duplicate JSON; forged, partial, oversized and symlink receipt; receipt/manager/proc/FD disagreement; quota checks; two independent original holders using the mapped fixture; surviving original FD after controller death; both-dead state retained for external cleanup; bad token; partial FD ACK loss; bad Python pin before mutable state; refuse-existing install plan; exact cleanup and identity drift/death mismatch.

Full Python ERS suite: 244 tests = original 200 plus these 44. The six v2 regressions add root-reader synthetic rejection of 0644 and wrong-GID 0640/0440, acceptance of correct-GID 0440 after revalidation, identity drift rejection, private epoch-directory policy and fixture parity. Root-reader mocks are not root installation or kernel evidence. Neither result is an OS test. No installation, HOST read/measurement, main change, CI run, PM2 action, production effect or owner principal/budget selection was performed. This is author evidence pending independent review, not approval to preserve or execute.
