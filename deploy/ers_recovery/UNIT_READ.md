# Prepared fixed unit-manager read collector

The collector reads only ers-controller-<16hex>.service or
ers-watchdog-<16hex>.service through /usr/bin/systemctl show and an explicit
property allowlist. It never invokes start, stop, reset-failed, daemon-reload,
cat or edit, and never requests Environment, ExecStart, logs or command text.
Subprocess stdin is closed, environment fixed, stderr discarded, result bounded
and timeout kills/reaps that exact child. Units outside the fixed name grammar,
unknown/duplicate/missing properties, absent/not-loaded units, pending daemon
reload, drop-ins and nonstandard FragmentPath are unverifiable. No absence is
silently interpreted as safe and no new unit is installed.

Source is pinned separately: exact /etc/systemd/system/<unit>, root-owned
non-writable ancestors and one-link regular no-follow file, bounded read,
FD/path identity, stable stat fields and independently supplied expected SHA256.
The same metadata, manager result and /proc PID/start/boot/exe/cgroup observation
are compared before and after the read. /proc environment and command line are
not read. MainPID is parsed from strict digits, and the existing unit_custody
comparison uses only its exact allowed normalized keys, not the extra manager
properties collected for the later admission planner.

Manager property semantics are those of systemd 249, already grounded in:
https://www.freedesktop.org/software/systemd/man/249/systemd.service.html
https://www.freedesktop.org/software/systemd/man/249/systemd.exec.html
https://www.freedesktop.org/software/systemd/man/249/systemd.resource-control.html

This collector has not been exercised against a live systemd manager. Local
manager/fragment responses in tests are synthetic; only the self-process
metadata test reads actual local kernel metadata. A dictionary is not an OS
attestation and no units currently exist by virtue of this code. Drop-in support
is deliberately rejected, not partially interpreted. Unknown accounting,
common parent-slice failure and resource values remain admission decisions.

Each systemctl call has its own bounded userspace deadline. The complete
collector includes synchronous file/proc reads and TWO manager calls: it is not
an end-to-end wall bound. An independent bounded worker is required before any
production use, just as with HTTP and PM2. Uninterruptible kernel sleep cannot
be guaranteed away by kill+wait. Do not run this collector live until that wrapper
and exact expected unit/source/cgroup/identity contract have been reviewed.

NeedDaemonReload=no plus matching current fragment is useful manager evidence,
not a proof against a hostile root or of all bytes loaded earlier. This code
makes no containment, OOM survival, resource reservation, service recovery or
WhatsApp connection claim. Those require loaded-unit policy, actual manager and
kernel evidence and the missing runner admission. It does not settle log PID
binding: PM2 may own the actual log FD while the bot writes a pipe, so direct
app-FD-to-log-inode assumptions would be wrong. That separate chain needs its
own source-grounded collector and must not read arbitrary raw logs.

## Independent parent boundary, local v2

bounded_unit.py now supplies the missing independent fixed -I worker boundary
for the entire collect_unit sequence (not just one systemctl call). It permits
only the four fixed contract values in bounded JSON stdin. Parent deadline
kills/reaps that exact worker and suppresses raw stderr. stdout is bounded,
manager/process/identity/attestation keysets and scalar types are validated, and
the parent repeats the pure unit_custody comparison against its own expectations.
The worker reads only its reviewed sibling code. This completes a prepared
userspace timeout boundary, not an assurance against uninterruptible kernel
sleep, hostile root, later service effects or successful loaded-unit containment.
No live unit-manager collection is authorized or performed by these tests.

Runtime D-Bus property grounding also uses the versioned manager/unit interface:
https://www.freedesktop.org/software/systemd/man/249/org.freedesktop.systemd1.html
The Unit interface lists Id, load/active/sub states, FragmentPath, DropInPaths
and NeedDaemonReload. Service and execution/resource interfaces supply the
service-specific process and policy properties exposed by systemctl show.
Missing properties remain a protocol hold, not default values.
