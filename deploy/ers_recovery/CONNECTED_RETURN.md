# Local paired connected-return candidate extension

The original paired protocol only permitted STOP candidates while both holders
were live and START candidates after positive peer death. This extension adds a
normal connected donor START candidate, not a PM2 start effect or admission.

Both original holders use separately injected observation functions. The donor
checks exact baseline app/config, stopped/pid0, positive original-absence and
same daemon/release through the existing recovery policy before PREPARE. The
receiver calls its own observer, rejects disagreement, and consumes START_PENDING
in pending memory before ACK. The donor persists through the existing Store
fsync-file/replace/fsync-directory, then requests COMMIT. The receiver repeats
its own observation before committing. The donor rechecks after the COMMIT ACK.
No candidate is returned if those reads change or any ACK/durability is uncertain.
No prior JSON snapshot is adopted and no productionAdmission flag changes.

START_PENDING is consumed even when the caller did not receive a candidate or
when an eventual effect was not executed. There is no retry. A receiver with a
pending PREPARE cannot become a survivor planner. A receiver that committed
START_PENDING but whose ACK was lost must observe the uncertain start outcome,
not start again. These conservative cases may hold service availability.

The observer result is not supplied by the peer or derived from its journal.
The injected callback is an unfinished adapter boundary: local two-process tests
read separate synthetic fixture files, not PM2/manager state. Production will
require independently bounded source-grounded readers in both original peers,
real exclusion and OS admission, and immediate serialized revalidation before
any bounded action. No local observer token authenticates an external system.

The final read is point-in-time. A future adapter/effect race remains. Neither
this protocol nor current fdinfo proves the absence of an external unlock/relock
or FD reuse between observations. This is not a sandbox against same-UID actors.
No new service, unit, user, source upload, PM2 CLI or mutation method is added.
