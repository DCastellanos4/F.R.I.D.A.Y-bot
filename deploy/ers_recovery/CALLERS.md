# Fixed read callers, prepared-only

New layer above reviewed observation commit e581789b37907978a06112227c2b33114e1ef8c0.
No PM2 mutation API, CLI, service installer or production campaign is introduced.

bounded_http spawns a fixed Python worker with -I and a minimal environment,
no shell, inherited credentials or inherited lease FDs. It permits only a
literal loopback port and operation timeout, uses the reviewed response
classifier, and returns a bounded class, never HTTP body or raw stderr.
The parent owns a wall deadline independent of socket activity. On timeout it
kills and reaps its exact child. Trickle HTTP is tested using a real local server.
Deadline bounds ordinary userspace waiting; kernel uninterruptible sleep cannot
be ruled out by a Python timeout or kill+wait. A timeout is no verified response,
not proof of API failure or absence of effects. These are read operations only.

pm2_read.cjs imports only vendored pm2-axon/pm2-axon-rpc entry modules, NOT
Client, API, CLI or God. Its two fixed RPC methods are getVersion and
getMonitorData. Config must bind an existing socket dev/inode/uid/mode key,
daemon PID/start, exact process IDs/names, expected source entry hashes and the
fixed installed PM2 root. It checks socket/daemon/pins before connect and after
response, projects records in memory, and never prints full rows/env/errors.
Socket replacement, absent daemon and missing config fail closed. This does
not prove module dependency bytes already loaded by the daemon or authenticate
all same-uid actors. Entry hashes alone do not pin the full require graph;
production use must inspect/pin that dependency closure or establish equivalent
trusted root-owned package custody. That remains a preflight requirement.

bounded_rpc supplies an independent parent wall deadline and a minimal env,
with no inherited FDs. It spawns only /usr/bin/node and the fixed sibling CJS
script, caps config/result size, suppresses stderr and reprojects parsed output.
The Node timer alone is not a wall bound for synchronous filesystem/module
reads; the parent owns it. Same kernel-blocking caveat as HTTP applies.

## Evidence scope

HTTP: real independent worker and loopback401/redirect/oversize/trickle, plus
invalid limit cases. PM2: source syntax and projection probes against synthetic
records/local process starttime only. No live PM2 transport/daemon was exercised
locally. Transport remains a directed-read validation, not already PASS.
No Node package install or PM2 daemon was launched for these tests. Local Node
version is not assumed to equal production Node20.

## Exact next directed HOST read, without mutation

Using verified SSH host fingerprint, no CLI/Client/environment or log bodies:
metadata of known deploy lock and parent, known release/current symlink targets,
hashes/realpaths of effective deploy and the PM2 source/package paths, existing
socket identity and daemon pid/start/version, exact two app operational fields,
HTTPanonymous classification and listener-to-PID association. Readlink/stat only
for existing data/env references. Do not read env content, tokens, conversations,
DB/history, backup ciphertext or acquire flock. No service/unit/account writes,
no source upload/installation, no fixture/native run or stop/start/save/delete.
Any helper can stream via SSH stdin without persisting remote files.

Hash-on-disk does not prove bytes already loaded in daemon. Version via RPC is
reported state, not complete provenance. Missing live optional config must be
reported/reconciled against installed defaults, never filled from memory. These
reads change whether the new adapter matches current production and whether the
historical retained-start risk plausibly differs; they cannot certify a restart.
A concrete separately approved intervention remains required for service effects.
