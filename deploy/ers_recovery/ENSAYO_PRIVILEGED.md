# Concrete privileged preparation, LOCAL evidence only

This delta prepares actual Python programs for a separately approved root intervention. It does not install or start anything, reserve an account, reload systemd, change PM2, deploy the bot or admit production. Schema2 stays proposal-only. Earlier fixture evidence is not OS evidence. `ENSAYO_OS.md` and `ENSAYO_EXECUTORS.md` describe earlier layers; this document governs the new concrete layer.

## Exact entrypoints and execution boundary

- `ensayo_bootstrap.execute_prepared_bundle`: validate the complete holder bytes and closed nine-module control set, create an exclusive external root seed journal, record account disposition, refuse existing final roots, reserve the specified numeric principal through fixed NSS/account commands, install exact files without replacement, and seal root configs plus lifecycle. Returns prepared, not started. It never selects numeric IDs or infers approval.
- `ensayo_start_controller.StartController.launch`: fresh bounded memory and pids-ancestor capacity checks, durable no-retry launch intent, explicitly GLOBAL daemon-reload, cleanup start first, root-owned cleanup socket check, supervisor start. Neither a successful command nor this return value proves the OS gate passed.
- Installed control command for each role: `/usr/bin/python3 -I <controlRoot>/ensayo_control_program.py --config <controlRoot>/<role>.json`. Configs are root0400. The executable verifies exact root-owned module/source/config/unit pins before private imports. Only the exact supervisor/cleanup config paths are accepted; no install mode or fixture fallback.
- Holder gate command: `/usr/bin/python3 -I <sourceRoot>/ensayo_prestart_gate.py --config <role-config>`. It runs as the dedicated nonroot holder principal. It never starts the holder or creates a lease. Root peer credentials, PID/start/boot, role, invocation, manifest and both-reservation digest authenticate release. A separate ten-second alarm and socket timeout bound it.
- `ensayo_finalizer.Finalizer.finish`: external root operator only, after both original root custodians have stopped. Checks original invocation/PID absence and completed cleanup, preflights every removable root's exact child inventory, removes exact residual roots/sockets/units, applies the explicit account decision through `PrincipalRetire`, and performs a GLOBAL reload. It leaves control evidence and bootstrap seed explicitly retained. No recursive deletion, account adoption, force, home deletion or autonomous retry.

These root programs retain root authority. The fixed path/argv allowlists, nofollow operations, source custody and service mounts constrain the reviewed workflow; they are not a proof that compromised root code is kernel-confined to those operations. Parent roots must be non-writable by holders. A concurrent privileged actor can race checks; multi-object checks and release are not atomic. Every future execution still needs source-grounded approval of the actual code, inputs, effects and residual policy.

## Custody before holder release

The new reservation stage is `ONLY_EXACT_CUSTODIED_PRESTART_GATE_NO_HOLDER`. Reservation is before HOLDER creation, not before every process. Each scope contains exactly the independently verified short nonroot gate. No manual mkdir under systemd's cgroup tree, no migration and no delegation is used.

Both manager/process/argv/invocation/cgroup/key/member checks run before the first reservation/release effect. Each role is checked again immediately. A separate cleanup service is already alive before supervisor release. The supervisor retains original cgroup directory/events/procs descriptors; SCM_RIGHTS transfers both original directory FDs to cleanup. Cleanup opens the original fields relative to those FDs, matches both reservations against the durable root journal, and ACKs before any release. The root-root peer is checked against the corresponding manager process.

Release is sequential, not atomic. Controller is released first. Its original runtime directory, exact holder socket and manager transition are checked before releasing watchdog, preventing watchdog from racing socket creation. Both COMMIT receipts must then match the independent manager/process/invocation/cgroup observations and one lock key. Receipt claims remain holder-writable, not OS attestation or proof of continuous original OFD ownership. Exact FD/flock continuity, deny probes and kernel enforcement are not certified by this layer.

ControlPID to MainPID continuity is never assumed. Main process, source argv, executable inode, IDs/groups, cgroup inode, invocation and manager resource values are read again. Memory, swap, Tasks and CPU duration projections must match the proposal. Unexpected formatting or inaccessible fields hold; version numbers do not prove compatibility.

## Independent lifetime and honest cleanup

Cleanup retains the original FDs while independently watching a pidfd for supervisor death, or its own thirty-second selector deadline after handoff. It does not depend on the supervisor loop remaining alive. Holder units have start timeout12s and RuntimeMaxSec30. Root supervisor has RuntimeMaxSec60; cleanup has RuntimeMaxSec70. These are proposed maximum bounds, not measured latency or promised successful cleanup. Capacity remains unmeasured until a future authorized fresh check. A late or failed operation holds without retry.

No concrete timer unit is installed or armed. The legacy `cleanupTimer` renderer is labelled historical semantic-fixture-only. A late timer cannot recover original FDs and could restart a completed cleanup invocation. The separate live cleanup custodian, its own wait and manager limits replace that route.

Stop is allowed only for the exact prior reserved scopes after both-role validation. Original retained cgroup FDs must independently report no processes and populated0 before file cleanup. ENODEV, removal, unreadability, unexpected events or inaccessible identity is HOLD, never proof of death and never permission to erase files. If both custodians die, this layer promises no filesystem cleanup. Retained state and manager lifetime limits remain; no path-name takeover is attempted.

The cleanup service removes exact holder file contents only. Its ReadWritePaths are the exact control, gate, runtime, source, config and canary roots it needs. It has no broad writable `/run`, `/var/lib`, `/opt/ers`, `/etc/ers-ensayo` or `/etc/systemd/system`. Mounted roots and every unit file are left for the external finalizer after services exit. Unknown entries or identity drift hold before deletion. Partial effects stay journaled, without repair/retry. The lifecycle deliberately remains outside both holders.

## Files and account residuals

The account/group name is proposed `ers-ensayo`, non-login, no home creation, no supplementary groups. Numeric UID/GID are unresolved/unapproved. Existing names or IDs are never adopted. Each account command has durable intent and NSS postchecks. A failed/ambiguous command stops the sequence and cannot be retried through this interface.

Disposition is a required explicit execution input: remove the exact original unused account/group, or retain under the owner's explicit decision. It is not a boolean manufactured by a fixture. Userdel/groupdel have no force/home-removal flags, and their refusal leaves a journaled HOLD. Group/account reuse, extra members or unexpected NSS state block retirement.

Control files, mutable lifecycle, shared parents created by bootstrap and the external seed remain explicit residuals. See [ENSAYO_RETIREMENT.md](ENSAYO_RETIREMENT.md) for the new LOCAL freeze/ticket/external-operator retirement route and follow-through. It does not schedule or authorize destruction at24h. Audit records, external executor and shared parents remain separately disclosed. This does not modify the existing unrelated ciphertext retention task.

## Local evidence and remaining gates

Tests inject syscall/NSS/manager boundaries, exercise actual nofollow/no-replace algorithms, local socketpair SCM_RIGHTS and retained FDs, journal/fsync handling, bootstrap-to-config pin parity, account refusal/crash behavior, controller readiness ordering, COMMIT contrasts, exact runtime cleanup, residual finalization and pre-effect rejection of unknown entries. No root, real systemctl, account tool, HOST cgroup or PM2 command is run by these tests.

The semantic transaction fixture is separately updated to model an exact gate-only reservation. Its simulated timer is historical test machinery, not the concrete operational route. It does not stand in for the programs above.

Not yet proved: actual systemd249 property formatting and lifecycle, cgroup FD behavior across real stop/removal, service mount behavior, actual capacity/headroom and selected numeric IDs, loaded sandbox limits, kernel deny/path/socket/proc/capability sentinels, continuity of original shared OFD/flock, both-custodians-dead filesystem recovery and actual authorized timed control-evidence retirement. The LOCAL retirement route is prepared separately in ENSAYO_RETIREMENT.md. The current concrete code remains LOCAL review preparation, not operative-ready or safe-to-deploy evidence. No next OS window is implied by a test PASS.
