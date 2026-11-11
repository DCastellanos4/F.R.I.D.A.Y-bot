# PM2 7.1.1 observation presence contract, prepared-only

The v10 caller failed closed during a directed read because cron_restart was
absent from the returned operational record. It did not prove a stopped or
unhealthy process. The earlier read that printed null used ?? null and was not
proof that the actual record carried that property. No host configuration is
changed to make this read pass.

## Source grounding

Exact source: https://registry.npmjs.org/pm2/-/pm2-7.1.1.tgz
SHA512 matched the registry version record before extraction. Relevant paths:

- lib/API/schema.json: cron_restart has type string/number and no default.
  autorestart has an actual default true. watch, kill_timeout, listen_timeout,
  restart_delay, exp_backoff_restart_delay, max_restarts and max_memory_restart
  do not have an actual schema default. A docDefault is documentation, not a
  value injected by Config.validateJSON.
- lib/tools/Config.js, validateJSON: undefined/null is omitted unless the schema
  has an actual default. Runtime records are not required to carry every option.
- lib/God/Methods.js, getFormatedProcesses: exposes the pm2_env record itself.
- lib/God/ActionMethods.js, getMonitorData: adds operational resource samples,
  but does not fill missing configuration fields.
- lib/Worker.js, registerCron: returns for falsy cron_restart or string '0'.
  This does NOT prove there is no existing job in God.CronJobs. The monitor
  snapshot does not expose that map, and a running daemon's previously loaded
  source is not proved by a current disk hash.
- lib/Common.js, resolveInterpreter: a node alias can remain 'node' after PATH
  checks. lib/God/ForkMode.js uses exec_interpreter or process.execPath. Thus a
  raw node lexeme is not necessarily an absolute path. No start execution may
  infer node == /usr/bin/node from this observation.

## Wire projection and schema 2

Required presence: name, pm_exec_path, pm_cwd, exec_interpreter, exec_mode.
Optional presence: autorestart, watch, cron_restart, kill_timeout,
listen_timeout, restart_delay, exp_backoff_restart_delay, max_restarts,
max_memory_restart. This is a capture contract, not an effective-behavior
normalizer. Missing required fields still fail closed.

The Node projection copies present values and omits absent optional properties.
It never inserts null, false, zero or a remembered ecosystem value. Python's
second projection records configPresence for every allowlisted field as absent,
null or value. config contains only present fields, with their observed values.
The digest covers schema 2, config values and the full presence map. All three
states differ and any change produces a different baseline digest. Schema 1
and schema 2 are never reconciled as equivalent. The comparator returns
HOLD_OBSERVATION_SCHEMA for missing/old schemas, even if a digest happens to
match. A malformed current-schema record retains the domain-error behavior.

The current bounded capture supports primitive JSON values and a bounded watch
string array (128 entries, 4096 characters each, 16384 total characters).
Other arrays/objects fail. Node config numbers must be safe integers to match
the existing Python integer JSON representation. These limits reject unsupported
configurations rather than reinterpret them. Both projections copy watch arrays
so later caller mutation cannot silently alter captured values.

Script and working directory remain absolute. The interpreter must be an
absolute lexical path or the exact observed alias 'node'; other relative aliases
fail. The alias remains raw, is included in the digest and differs from an
absolute path. It is not resolved, substituted, authorized for execution or
claimed to identify the pinned Node interpreter used by the observation helper.

## Safety boundaries

A faithful config snapshot may now be obtained even when optional fields are
absent. That does not close production recovery or start preconditions.
Specifically, ABSENT cron_restart is not a proof of no installed cron job;
ABSENT watch is not proof of no watcher; unset memory/restart options are not
asserted to have a particular effective value. Those claims need separate
source-grounded runtime custody or remain a hold in the intervention plan.

This change does not add a start/stop/save/delete method, change PM2 or ecosystem
configuration, widen the exact two-process identity set, relax socket/daemon or
source custody, certify service health, or establish 75-second stability.
No endpoint body, env, arbitrary error text or full process payload is returned.
