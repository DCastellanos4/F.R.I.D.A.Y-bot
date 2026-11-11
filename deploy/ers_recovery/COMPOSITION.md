# Local journal composition, not a maintenance executor

This layer is new on top of prepared-only commit
888fdb0a8764e3231aebe05c01bf68a483a8356d. The four reviewed primitive/policy/test/
README files remain unchanged. Its tests are separate composition evidence.

## Boundaries

Store binds a private 0700 directory and independent 0600 regular journal lock.
It uses a nonblocking in-process mutex plus an independently opened flock,
checks pathname identity, and writes bounded JSON through file fsync, atomic
replace, then directory fsync. The journal lock is NOT the shared deploy FD:
unlocking it cannot release deploy exclusion. A read is not permission to act.

Session creates a new journal only if none exists. Epoch, owner PID/start/boot,
source and two online app baselines are fixed in memory and checked again.
A fresh Session cannot adopt an existing journal even with the original lease;
a reopened/reacquired lease cannot revive old baseline authority. This is
conservative: coordinated survivor adoption still needs a separate protocol.

Transfer writes TRANSFER_PENDING before sendmsg. Only a verified transport ACK
allows ACK_OBSERVED, which does NOT admit work. Timeout/error yields
TRANSFER_UNCONFIRMED and no retry in that epoch. A failed durable write may have
landed: it invalidates this live Session rather than guessing no effects.
LOCAL_PREPARED requires live original reference and matching peer identity.
It is deliberately NOT a production commitment. productionAdmission is ALWAYS
false. This module has no API capable of production admission or PM2 mutation.

stop_intent/start_intent only write synthetic intent records. A separate
adapter would have to revalidate facts under serialization and carry actual user
authority before effects. START_PENDING does not retry. An original online app
is left unchanged while the other app may be considered separately. Daemon,
release, original absence inputs remain hypothetical caller facts here, not
attested live reads. They must not be confused with executed recovery.

## Fault handling demonstrated locally

Tests combine the actual lease transport with independent receiver processes
and a real temporary journal. They exercise ACK-only/no admission, ACK loss,
receiver death, surviving original reference, closed-reference GAP, rejection of
journal adoption after reconnection/reacquisition, independent journal exclusion,
per-app intent, original online continuity and stale source/baseline rejection.
Fault injection before file fsync, before replace, after replace/before directory
fsync, and around ACK/LOCAL_PREPARED persistence checks conservative uncertainty
and no retry. Injected exceptions model caller-visible failures; these tests do
NOT prove power-loss durability or filesystem behavior under kernel failure.

## What is still missing

- No systemd InvocationID/cgroup/executable attestation, private socket service,
  two-unit installer, resource limits or OS watchdog/controller composition.
- Peer PID presence is NOT proof its FD remains open. A matching ACK once is
  NOT current two-holder custody. A future integration must observe/handshake
  live holder references before production admission, and bind each survivor
  to its original uninterrupted custody. This layer never claims that proof.
- The donor Session retaining its own FD can plan local reconciliation after
  peer death. This does NOT implement a receiver-side recovery coordinator or
  restore continuity from persisted JSON after process death.
- No drain, native fixture, PM2 read/start, HTTP classification, WhatsApp marker
  collection or 75-second real-service observation. These remain external
  adapters not provided by this cut. The primitive's peer checks are not a
  complete trust boundary against another process with the same uid.
- Same-host common failure, both holders dying, reboot, unlock or inode
  replacement breaks continuity. No automated old-baseline recovery after gap.
- Work exhaustion should start cleanup immediately. Cleanup, recovery and
  observation have distinct budgets. This layer sets no production timers and
  promises no outage bound or recovery success.

The next review is of these explicit local invariants, not a claim that the
production maintenance window is ready. No previous harness is reconstructed.
No CI, bot runtime, deployment workflow or installation configuration changes.
