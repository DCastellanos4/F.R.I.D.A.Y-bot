# Local two-unit bootstrap and proposed admission contract

This delta joins a source manifest, unit-source renderer, independent-process
launcher, actual descriptor handoff and a loaded-unit projection matcher. It
never installs or starts a unit, calls systemctl, acquires the real deploy lock,
uses PM2, opens the bot/session/data, stops services or grants production.
All outputs keep productionAdmission=false. No production command exists.

## One contract, every local consumer

unit_contract validates exact role sets, epoch, fixed Python spelling, explicit
non-root numeric UID/GID/groups, denied paths, closed14Python-file source set,
role budgets, unit names and worker-config paths. Renderer, launcher and worker
check the same14source names. The worker consumes a smaller explicit subinterface
(mode, role, private namespace/path selectors, token, expected pin map and
synthetic app fixtures), not the full OS manifest. It does not independently
attest its rendered UID/groups/resources/deniedPaths or loaded units. SourceRoot names the hash of the expected pin map.
No source expectation is learned from a manager response. Different role names,
config paths, groups, resources or source set fail closed before local launch.

The renderer emits both exact .service sources and their hashes. They use the
same explicit principal but separate unit/cgroup/budget identities. There is no
PartOf/BindsTo coupling, automatic restart or shared parent process. They keep
the private runtime directory on one unit's exit so a surviving holder does not
lose the shared socket/journal path automatically. This creates a later cleanup
obligation, not an automatic cleanup operation now.

The rendered units are PROPOSALS, not reviewed installed containment. Their
32MiB/16Tasks test values are synthetic inputs, not sizing advice or measured
HOST limits. Local tests do not apply those limits. There is no reason to claim
that two Python PIDs account for Node threads/model/ticket helpers.

## Actual original holder handoff, local only

local_unit_launcher accepts only an empty private owned /tmp/ers-local-unit-*
fixture namespace. It creates only that fixture's existing-lock stand-in. It
spawns two independent child processes with -I, minimal environment, closed
inherited FDs and independent process groups. It never passes a flock FD through
exec or systemd-run. A per-run random token goes through private stdin, never
stdout or a file. Source pins are checked before spawn and again by each worker.

The controller acquires the fixture flock, binds a private SOCK_SEQPACKET path,
and accepts the watchdog. Both validate the shared token and peer credentials
plus original PID/start/boot through the reviewed lease module. The controller
transfers the original open-file-description with SCM_RIGHTS and receives the
reviewed ACK. No reopening/reacquiring lock is substituted for continuity.

Both run the existing Pair enrollment: ENROLL, durable PREPARE/COMMIT, then an
actual CENSUS exchange. They retain original references after enrollment. The
launcher verifies the lock is still busy and both originals live. A second test
kills only the original controller and proves the watchdog's original reference
still excludes a new lock acquisition. It executes no recovery/start decision.

Tests end their own fixture workers explicitly. Bounded protocol reads and
kill/reap cleanup apply only to these synthetic processes. No teardown is offered
as an availability-safe way to end a real maintenance campaign. In rendered
file-config mode the worker retains its reference until a signal; no test stdin
control channel or automatic service effect is fabricated.

## Admission matcher, not installed attestation

match_loaded_units consumes the bounded_unit shape and uses independently
expected unit-source hashes, cgroups, user/group/group-set, MemoryMax/TasksMax,
source path/no-dropins/no-reload, KillMode/OOMPolicy, RuntimeDirectory and no
PartOf/BindsTo. It runs the existing unit_custody validator and checks equality
with the worker's attestation. The two PIDs and InvocationIDs must differ.
Even exact synthetic observations return kernelContainment=UNVERIFIED,
effectAdapter=ABSENT and productionAdmission=false.

The LOCAL launcher does not turn its own uninstalled process cgroups into these
unit attestations. It does not call match_loaded_units with fake manager rows to
let a production runner advance. Tests exercise that matcher separately using
labeled synthetic manager fixtures. There is no new RO unit call on HOST.

## Explicit unresolved production boundaries

- Unit installer and root-owned immutable source/config custody do not exist.
  A token plus a same-UID-owned config is not root-authorized OS admission.
- The rendered Python path is a contract spelling, not inode/hash verification
  of the executable used by installed services. The local test uses its current
  Python interpreter and does not prove the installed path.
- Mount/namespace deny semantics, effective process groups, capabilities,
  resource accounting and loaded source semantics still need kernel evidence.
- The proposal intentionally denies .pm2 and shared bot data, and its worker
  accepts only LOCAL_SYNTHETIC_ONLY. It cannot be turned into the maintenance
  backend by filling a boolean or installing the unit sources as-is.
- Its fixture lock lives in the private runtime namespace, not the real shared
  deployment lock. A real cooperative handoff must use the existing deploy lock
  inode and reconcile all deploy actors under separately approved scope.
- The worker's apps are synthetic. No real baseline, returned-start observer,
  PM2 effect adapter, effective cron/watch/node resolution, WhatsApp log chain,
  in-flight external effects reconciliation or owner effect approval is added.
- Separate units reduce one common parent failure, not host/slice failure or
  resource exhaustion. A double-holder loss still creates a custody gap.
- No production install, pause, launch window, restore or retry is authorized.

## Current tests

The v2 correction adds a shared local-namespace guard used directly by both
launcher and worker before lock/socket/Store operations, and validates the
sourceRoot/hash-map equality inside validate for every manifest consumer.

22 distinct new tests pass (17 original cases plus five v2 regression cases). They include two original real processes, actual
SCM_RIGHTS+flock+durable Pair enrollment/CENSUS, wrong token/source/group/path
refusals, source renderer/coherent role budgets, and loaded projection mismatch
cases. The full local ERS Python suite is200/200. The new tests do not claim
systemd installation, kernel containment, real service recovery or a75s wait.
