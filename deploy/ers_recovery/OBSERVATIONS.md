# Observation boundary, prepared-only

New layer on paired commit999af8db89d1ba511d8743cd18bdc6fe70e59689.
This adds no installed units, PM2 transport/client, service mutations, updater or
maintenance CLI. Earlier files remain frozen. Raw integration data is never
authority to execute an operation.

## Implemented reads and normalization

- PM2 payload projection into an exact two-record ID/name set and operational
  config allowlist. `env`, credentials, monitor blobs and error text are never
  serialized, hashed or returned. Actual RPC acquisition is NOT implemented.
  `getMonitorData` contains full env in memory; a future transport must project
  before returning/logging anything, reject unexpected set and close on timeout.
  It must not construct PM2 Client/CLI: their start path can create directories
  and launch the daemon. A reported RPC callback success does not prove stopped:
  PM2 stopProcessId can report errored through a callback with no RPC error.
- A fixed-loopback anonymous GET to /api/salud, no redirects/proxy/auth headers,
  body limit1024 bytes plus one sentinel, strict JSON with duplicate-key reject.
  Only known401 Unauthorized and exact known503 disabled contract normalize to
  their short classes. Neither class is functional API health or200. Unexpected
  errors, other503, HTML, oversized bodies and redirects are not equivalent.
  The timeout is a socket-operation timeout, NOT an end-to-end wall deadline:
  slow trickling can extend it. An external bounded caller/worker must own the
  global observation deadline before production integration. No health data is
  stored and no API token is read.
- Log file metadata baseline, O_NOFOLLOW/nonblocking regular-file open, bounded
  pread of new bytes, inode/size checks around it, truncation/rotation/excess/
  partial-line HOLD. Only exact console-source open marker or anchored close/QR
  markers produce events. No raw lines are returned. Wrapped/timestamp-prefixed
  logs are NOT silently normalized. Exact marker text alone cannot prove author
  or process identity; a future adapter must bind log writer/process/config and
  baseline offset. An attacker able to write a complete identical log line is
  outside this parser's authentication scope. PID/FD binding is not implemented.
- Unit evidence comparison against exact manager/process/cgroup expectations.
  This is pure comparison, NOT an implemented systemctl/proc collector and NOT
  proof that a caller's dict came from manager. SourceDigest must come from a
  separately verified source pin, not an invented systemctl property. Parent
  slice does not substitute for exact unit cgroup; InvocationID must be known
  from the manager, not trusted just because a process env asserts it.
- Pending intent to observation classification: online original PID/start stays
  untouched, new online process after START_PENDING still needs stability,
  stopped/pid0 only counts with positive original-absence evidence. Errored,
  stopping, launching, changed config or uncertain outcomes never count stopped.
  This helper does not authorize another start/stop or prove daemon continuity.

## Minimum unit/lifetime contract, not an installer

Controller and watchdog in separate units, no PartOf/BindsTo/stop propagation
between them, and no arbitrary shared lifetime kill at15minutes. Both hold the
same OFD before any pause. Directory custody belongs to the maintenance session,
not one holder's default RuntimeDirectory removed on death. No additional PID1
FD store is introduced: that would be a third holder with another lifetime.
Each actual MainPID/start/boot/InvocationID/ControlGroup/source must match the
manager and kernel. OOMPolicy and parent slice limits must be treated as common
failure risks, not independent recovery. TasksMax includes threads. MemoryMax
limits do not reserve memory for the bot. Existing numerical budgets are design
candidates until measured, not proven operating caps.

Cleanup planning must enumerate exact owned unit/invocation/cgroup and account/
path identities in its intent journal. Work expiry starts cleanup immediately.
A global monotonic budget bounds waits (candidate105s inside120s), leaving time
for journal. Timeout is uncertainty: preserve records and never remove shared
state/accounts or claim an empty cgroup/failed client proves stop. Recovery and
sampled75s observation are separate later phases. Last-holder lock release is
only after verified outcomes or explicit takeover, never merely a wall clock.
No cleanup executor or production deadline is provided by this layer.

## Source evidence inspected

- https://registry.npmjs.org/pm2/7.1.1
- https://registry.npmjs.org/pm2/-/pm2-7.1.1.tgz
  Tar SHA512 matches registry integrity. ActionMethods.js
  SHA2562707f1f2d75929e4747b4ea170f64392ba773909b9a3c278042636ce22090f58.
  restartProcessId shares stopProcessId/startProcessId, plus reset/config changes;
  historic restart failures cannot be dismissed as an unrelated code path.
  God/Methods also contains stale _tree_pids cleanup, a plausible difference
  from older versions, not a proven cause or recovery guarantee.
- https://raw.githubusercontent.com/DCastellanos4/F.R.I.D.A.Y-bot/49ebba73b45dce0567108333c85d54f26c1685dc/api.js
- https://raw.githubusercontent.com/DCastellanos4/F.R.I.D.A.Y-bot/49ebba73b45dce0567108333c85d54f26c1685dc/whatsappBot.js
- https://www.freedesktop.org/software/systemd/man/249/systemd.service.html
- https://www.freedesktop.org/software/systemd/man/249/systemd.exec.html
- https://www.freedesktop.org/software/systemd/man/249/systemd.resource-control.html

Local tests cover projected synthetic PM2 payloads, real temporary log deltas,
a real loopback HTTP server and synthetic exact unit evidence. They do not test
production PM2/HTTP/log writers, systemd containment or the retained start path.
No inherited test count proves these new adapters or readiness.

## Focal normalization correction

Log records split ONLY at LF. CR anywhere in a delta is rejected rather than
normalizing CRLF/CR into accepted markers. unit_custody requires an explicit
expected non-root exact cgroup in addition to manager/proc agreement. It still
does not attest that a dict originated with the manager. Public observation
helpers translate missing fields, type errors and ordinary filesystem failures
(including symlink ELOOP) into Unverifiable without raw exception contents.
An independent global deadline remains required for the HTTP collector.
