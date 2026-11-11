# LOCAL compatibility and native account allocation v1

2026-11-11. Prepared for independent review only. No account command, privileged program, SSH, install, start, manager reload, main update or CI execution was performed for this delta. `productionAdmission=false`; installation remains blocked pending review, authority and exact inputs.

## Small compatibility change

Both closed-property readers, `FixedRunner` and `unit_read.manager_unit`, now call `systemctl show --all`. They still reject missing, duplicate and unknown properties. Empty `DropInPaths`, `PartOf` or `ControlGroup` stays an explicit empty value, not an omitted fact. Consumers do not fill missing fields. This fixes a locally demonstrated systemd249 compatibility risk. It does not show that a privileged ERS program failed on HOST: none was executed.

## Recommended allocation option

Use the already planned native shadow account tools to choose their own unused system IDs. Do not choose a UID/GID manually and do not keep diagnosing optional SYS range keys. The approved future effect would be creation of a new isolated `ers-ensayo` account/group by the system allocator, not adoption of an existing identity.

Commands prepared, NOT executed:

- `groupadd --system -- ers-ensayo` (no `--gid`)
- `useradd --system --gid <returned-exact-group-id> --no-user-group --no-create-home --no-log-init --comment '' --home-dir /nonexistent --shell /usr/sbin/nologin --groups '' --password '!' -- ers-ensayo` (no `--uid`)

Native tools own their configuration, compiled fallback and NSS collision handling. This code does not assert the HOST uses 101-999 or any other range. If native allocation fails, returns an invalid/nonpositive ID, ambiguous result or mismatched reverse NSS, HOLD with no retry. The reviewed binary checks remain the existing root-owned fixed-path checks, not a claim that upstream source is the installed binary or that every native side effect is independently reversible.

### Phase and custody contract

1. An allocation plan contains the exact manifest template but NO uid/gid/groups fields. Structural validation uses internal sentinel1 values only to validate the unchanged schema; they are never candidates, command parameters or operational manifests.
2. A root-only O_EXCL0600 seed at the existing fixed epoch path is created before any command. Its initial row binds the plan digest. Never reopen/adopt it or recover an account by name.
3. Confirm both names absent. Journal/fsync group intent, invoke native group allocation once, verify name and returned numeric reverse NSS, positive GID and no members. Store original returned identity with only accepted non-secret password markers.
4. Recheck original group and user-name absence. Journal/fsync user intent, invoke native user allocation once, verify both name and numeric reverse NSS, exact primary group, no supplementary groups, `/nonexistent`, nologin, blank comment and a non-secret passwd marker.
5. Record both returned identities and one original `PRINCIPAL_RESERVED` receipt. Fill numeric fields and groups=[gid] in a copied manifest and validate it. Journal/fsync `ALLOCATION_MANIFEST_FROZEN`, binding plan, receipt and final manifest digests.
6. `execute_prepared_bundle(... allocation=original_object)` can consume that exact in-memory object and original still-open seed only once. It verifies material parity/pins first, then the complete allocation chain and fresh exact NSS before handoff. No second `useradd`/`groupadd`, no arbitrary existing principal receipt. Holder configs, root configs, units and later gates all receive the same numeric manifest. No start is performed by bootstrap.
7. Shared origin validation now supports the exact eight-row allocation/freeze/control prefix in both RootJournal and both seed-retirement readers. Existing explicit-ID legacy manifests remain supported. No source-set expansion for holders or retirement: allocation and bootstrap are external preparation code, not imported by running holders.

### Rollback boundary

Before handoff, a fully receipted allocation can use the existing receipt-bound `PrincipalRetire`: exact original identity and reverse NSS, userdel without force/home removal, verify absence, then groupdel and verify absence. Group-only rollback is allowed only with its exact original receipt, current unchanged NSS, no user present, and NO user intent. Once user intent exists without a durable verified receipt/freeze, or any command/durability result is uncertain, HOLD and preserve evidence. Do not delete a name based on a guess. A native account command can have partially changed system account databases even when it times out or exits nonzero. Automatic repair/retry is not safe. The seed is an explicit residual.

After bootstrap handoff, allocation rollback is forbidden. The existing cleanup/finalizer/retirement workflow owns exact identity removal. Unexpected files, NSS drift, prior retirement intent or lost original FD block action. This is not an all-host account-generation proof: another privileged writer could replace an identity with indistinguishable fields. Coordination with other account managers and native tools' locking remains an operational assumption, not a synthetic-test result.

## Brief decision sheet for main, after review

Pick: native system allocation, not user-selected numeric IDs. The next user decision can be approval of one isolated no-bot rehearsal intervention with this allocation method and its bounded effects, rather than asking which UID/GID to use. There is no new generic diagnostic request.

The complete scope still needs explicit owner approval: new non-login account/group; exact reviewed local code and epoch; files in listed isolated roots; fresh capacity validation as part of the approved execution gate; global daemon-reload; holder controller/watchdog32MiB each,16tasks,20%CPU each, no swap; root supervisor/cleanup32MiB each,8tasks,10%CPU each; terminate all descendants of the two originally reserved exclusive scopes when cleanup applies; remove the exact unused created account/group at closeout. These values are the existing proposal, not promises or measured isolation. Other PM2/bot/model/DB/env/log data is excluded.

Retention is separate: 24h control/seed retention is still only proposed, no schedule. External executor, audit records and shared parents remain explicit residuals under an owner-approved policy. Do not imply that everything vanishes after24h. Existing encrypted backup/SQLite retention stays untouched. A failed/ambiguous account allocation can leave an account or seed for operator-led reconciliation; never advertise guaranteed rollback.

The staged RO window established only point-in-time parents/absence, binary custody, selected manager properties and selected capacity observations. It did not validate loaded sandbox policies, real cgroup-FD behavior, original OFD continuity, privileged races or both-custodian-dead filesystem cleanup. Local tests do not replace that eventual isolated rehearsal and do not admit production.

## Evidence freshness after this delta

Changing `ensayo_os.py`, control code or retirement code changes source/executor digests and therefore their exact content-addressed target paths. Earlier RO absence facts belong to the earlier paths only. New paths must pass the exact normal execution preflight if that execution is later approved; do not open an extra diagnostic window now or copy old absence evidence onto new hashes. No IDs or updated HOST targets are selected/reserved by this package.

## Public sources read

- systemd249, `--all` includes empty properties for show: https://www.freedesktop.org/software/systemd/man/249/systemctl.html
- useradd semantics, system/no-home/no-log-init options: https://manpages.ubuntu.com/manpages/jammy/en/man8/useradd.8.html
- groupadd system allocation and collisions: https://manpages.ubuntu.com/manpages/jammy/en/man8/groupadd.8.html
- current manuals corroborating options: https://man7.org/linux/man-pages/man8/useradd.8.html and https://man7.org/linux/man-pages/man8/groupadd.8.html
- upstream shadow4.8.1 UID allocator explicitly uses getdef fallback when SYS keys absent, rejects invalid bounds: https://raw.githubusercontent.com/shadow-maint/shadow/4.8.1/libmisc/find_new_uid.c
- corresponding GID allocator: https://raw.githubusercontent.com/shadow-maint/shadow/4.8.1/libmisc/find_new_gid.c
- upstream useradd: native system allocation, no home/mail for system accounts; no-log-init suppresses log initialization: https://raw.githubusercontent.com/shadow-maint/shadow/4.8.1/src/useradd.c

These are public semantics and historical upstream source, not proof of the HOST package version/configuration. Native allocation, if later authorized, returns the actual IDs rather than assuming upstream defaults.
