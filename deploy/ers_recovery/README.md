# ERS recovery primitives, new prepared-only line

Base: repository commit `49ebba73b45dce0567108333c85d54f26c1685dc`.
This is a new implementation, not a recovered maintenance harness. It inherits
no previous test counts or readiness verdict. Nothing imports these modules
from the bot, deploy script or CI. There is no maintenance CLI, PM2 client,
HTTP client, service installation or automatic restart here.

## What is implemented

`lease.py` opens an EXISTING regular lock file with O_NOFOLLOW/CLOEXEC and
acquires a nonblocking exclusive flock. It refuses a busy lock. It sends a
reference to the same open-file-description to a known process via a connected
AF_UNIX/SOCK_SEQPACKET channel. Both sides check peer uid, PID, /proc starttime
and boot identity, then check epoch/inode and ACK. The receiver uses
MSG_CMSG_CLOEXEC. validate() checks current pathname/fd identity, link count,
non-inheritability and an exclusive FLOCK entry in Linux fdinfo. It never calls
LOCK_UN; close() releases only its own reference.

`policy.py` provides pure decisions, not execution: original online apps remain
untouched; a stopped app with recorded stop intent and absent original process
can be considered for a retained-record start. A pending start is NEVER retried
blindly. Changed identity or an exclusion gap blocks recovery. A proposed
75-second sampled observer compares protected/disabled anonymous HTTP classes,
process identity, restart counter, launch timestamp, advancing uptime, listener
ownership and connection evidence. It cannot certify authenticated API
functionality, message delivery, or unobserved time between samples.

Tests use synthetic files and independent local processes. Run explicitly:

    PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s tests/ers_recovery -v

No dependency installation or network service is needed. The 75-second observer
is tested with synthetic monotonic samples, not 75 seconds of production data.

## Required composition, NOT implemented

1. Controller and watchdog must live in separate units and budgets. Each must
   hold the SAME open-file-description before a pause is admitted. The client
   of systemd-run does not automatically pass arbitrary descriptors to units.
2. An authenticated socket in an independently verified private directory must
   bind expected units, cgroups, executable/source identity, token and epoch to
   these process identities. This primitive checks PID/start/uid/boot only; it
   does NOT attest systemd InvocationID/cgroup or source provenance. Do not use
   it alone as an admission gate. Caller owns socket timeout and directory/path
   custody checks. Successful ACK is transport evidence, NOT durable commit.
3. Admission requires durable two-holder commitment, fresh baseline and intent
   journal, and a SEPARATE journal lock. Shared flock references do not exclude
   one another. Revalidate immediately before mutation and reconcile pending
   actions on response loss. No timeout proves that work did not happen.
4. A survivor can recover only while it retains uninterrupted custody of its
   original reference and the baseline/daemon/config/release remain valid.
   Reopening and reacquiring a lock is a NEW epoch, not proof of continuity.
5. No explicit LOCK_UN or conversion to shared mode is permitted in either
   holder, including context managers or teardown helpers. Either holder can
   unlock the shared description for both. Do not pass the FD to fixtures or
   helpers. If a holder must exec, transfer/ACK beforehand; CLOEXEC closes its
   reference. Do not solve this by leaking inheritable FDs through the tree.
6. If both holders die, a common slice failure occurs, the last reference
   closes, the host reboots, an explicit unlock occurs or the inode changes,
   mark an exclusion GAP. Stop admission, acquire a new lease only for current
   reconciliation, and do NOT restart using the previous baseline. A lock on an
   unlinked old inode does not exclude a deploy opening its replacement.
7. A work deadline triggers cleanup immediately. Cleanup, recovery and the
   75-second observation are separate phases. No deadline releases the last
   lock while an app remains stopped. No maximum outage is established.
8. Production adapters must collect exact allowlisted PM2 identity/config,
   socket/daemon custody, listener ownership and fresh connection evidence.
   HTTP comparison needs a pre-pause baseline and bounded classification, not
   tokens or private response bodies. Marker absence/rotation is uncertainty,
   not permission to restart an original app. Retained PM2 start stability is
   NOT established by these tests. There is no delete/start/save fallback.

## Known limits and decision

flock is cooperative. Manual/root writers can ignore it or replace its inode.
There is no transactional way in this primitive to prevent those outside
actors. A validate() result is a point observation, not an eternal capability.
Two holders protect against one holder's death, not common-mode failure. Their
recovery loops, cross-unit lifetime and OS resource caps still need composition
review. Socket ACK loss can leave a receiver holding a reference even though the
donor reports failure; neither result means absence. The caller must reconcile.

The pure policy takes facts as inputs. It does not authenticate their source,
persist a journal, prove continuous custody, read PM2, or prevent a stale caller
from lying about those facts. Therefore this line is NOT ready to stop a bot or
run an OS campaign. The next code step is composition with independently
reviewed unit/journal/read adapters, not reconstruction of a lost harness.
Any production pause or expanded recovery remains a separate approval.

## Source contracts inspected

- https://man7.org/linux/man-pages/man2/flock.2.html
- https://man7.org/linux/man-pages/man7/unix.7.html
- https://raw.githubusercontent.com/DCastellanos4/F.R.I.D.A.Y-bot/49ebba73b45dce0567108333c85d54f26c1685dc/deploy/deploy.sh
- https://raw.githubusercontent.com/DCastellanos4/F.R.I.D.A.Y-bot/49ebba73b45dce0567108333c85d54f26c1685dc/api.js
- https://raw.githubusercontent.com/DCastellanos4/F.R.I.D.A.Y-bot/49ebba73b45dce0567108333c85d54f26c1685dc/src/config/config.js
- https://raw.githubusercontent.com/DCastellanos4/F.R.I.D.A.Y-bot/49ebba73b45dce0567108333c85d54f26c1685dc/src/config/paths.js

The source's API auth gate precedes /api/salud. An anonymous 401 Unauthorized
or 503 disabled classification is operational comparison only, never a 200
functional health test. The source's own configured-token anonymous deployment
check is inconsistent with that auth gate and is not copied as validation.
