"""Prepared-only local composition. Persists synthetic intent, never executes it.

No production admission API exists. A fresh process cannot adopt continuity from
this journal. Caller supplies a private directory and source/config digests,
never env, logs, tokens, message text or conversation data.
"""
from contextlib import contextmanager
import copy
from dataclasses import asdict
import fcntl
import json
import os
from pathlib import Path
import stat
import threading
import uuid

from .lease import UnsafeLease, identity
from .policy import App, recovery


class InvalidState(RuntimeError):
    pass


class Store:
    def __init__(self, directory):
        self.directory = Path(directory)
        s = os.lstat(directory)
        if not stat.S_ISDIR(s.st_mode) or s.st_uid != os.getuid() or stat.S_IMODE(s.st_mode) != 0o700:
            raise InvalidState('PRIVATE_DIRECTORY_REQUIRED')
        self.directory_fd = os.open(directory, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC)
        if (os.fstat(self.directory_fd).st_dev, os.fstat(self.directory_fd).st_ino) != (s.st_dev, s.st_ino):
            os.close(self.directory_fd)
            raise InvalidState('DIRECTORY_REPLACED')
        self.directory_key = (s.st_dev, s.st_ino)
        try:
            self.lock_fd = os.open('journal.lock', os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW | os.O_CLOEXEC | os.O_NONBLOCK, 0o600, dir_fd=self.directory_fd)
        except BaseException:
            os.close(self.directory_fd); self.directory_fd = None
            raise
        locked = os.fstat(self.lock_fd)
        if (not stat.S_ISREG(locked.st_mode) or locked.st_uid != os.getuid()
                or stat.S_IMODE(locked.st_mode) != 0o600 or locked.st_nlink != 1):
            self.close()
            raise InvalidState('UNSAFE_JOURNAL_LOCK')
        self.lock_key = (locked.st_dev, locked.st_ino)
        self.thread_lock = threading.Lock()

    def _validate(self):
        d = os.lstat(self.directory)
        lock = os.stat('journal.lock', dir_fd=self.directory_fd, follow_symlinks=False)
        own = os.fstat(self.lock_fd)
        if ((d.st_dev, d.st_ino) != self.directory_key or not stat.S_ISDIR(d.st_mode)
                or d.st_uid != os.getuid() or stat.S_IMODE(d.st_mode) != 0o700
                or (lock.st_dev, lock.st_ino) != self.lock_key or lock.st_nlink != 1
                or (own.st_dev, own.st_ino) != self.lock_key or own.st_nlink != 1
                or any(not stat.S_ISREG(s.st_mode) or s.st_uid != os.getuid()
                       or stat.S_IMODE(s.st_mode) != 0o600 for s in (lock, own))):
            raise InvalidState('JOURNAL_CUSTODY_CHANGED')

    @contextmanager
    def transaction(self):
        if not self.thread_lock.acquire(blocking=False):
            raise InvalidState('JOURNAL_BUSY_IN_PROCESS')
        locked = False
        try:
            self._validate()
            fcntl.flock(self.lock_fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            locked = True
            self._validate()
            yield
        finally:
            try:
                if locked:
                    # Different OFD from deploy exclusion, safe to LOCK_UN here.
                    fcntl.flock(self.lock_fd, fcntl.LOCK_UN)
            finally:
                self.thread_lock.release()

    def read(self):
        self._validate()
        fd = os.open('journal.json', os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC | os.O_NONBLOCK, dir_fd=self.directory_fd)
        try:
            s = os.fstat(fd)
            if (not stat.S_ISREG(s.st_mode) or s.st_uid != os.getuid()
                    or stat.S_IMODE(s.st_mode) != 0o600 or s.st_nlink != 1 or s.st_size > 65536):
                raise InvalidState('UNSAFE_JOURNAL')
            with os.fdopen(fd) as stream:
                fd = None
                return json.load(stream)
        finally:
            if fd is not None: os.close(fd)

    def write(self, state):
        self._validate()
        data = json.dumps(state, sort_keys=True).encode()
        if len(data) > 65536: raise InvalidState('JOURNAL_TOO_LARGE')
        name = '.journal-' + uuid.uuid4().hex
        fd = os.open(name, os.O_CREAT | os.O_EXCL | os.O_WRONLY | os.O_NOFOLLOW | os.O_CLOEXEC, 0o600, dir_fd=self.directory_fd)
        try:
            with os.fdopen(fd, 'wb') as stream:
                fd = None
                stream.write(data); stream.flush(); os.fsync(stream.fileno())
            self._validate()
            os.replace(name, 'journal.json', src_dir_fd=self.directory_fd, dst_dir_fd=self.directory_fd)
            os.fsync(self.directory_fd)
        finally:
            if fd is not None: os.close(fd)
            try: os.unlink(name, dir_fd=self.directory_fd)
            except FileNotFoundError: pass

    def close(self):
        for attr in ('lock_fd', 'directory_fd'):
            value = getattr(self, attr, None)
            if value is not None:
                os.close(value); setattr(self, attr, None)


class Session:
    def __init__(self, store, lease, source, apps):
        if len(apps) != 2 or len({app.app_id for app in apps}) != 2:
            raise InvalidState('EXACT_TWO_DISTINCT_APPS_REQUIRED')
        if not source or any(app.status != 'online' for app in apps):
            raise InvalidState('SOURCE_AND_ONLINE_BASELINE_REQUIRED')
        self.store, self.lease = store, lease
        self.owner = identity()
        self.epoch = lease.validate()['epoch']
        self.source = source
        self.baselines = {str(a.app_id): asdict(a) for a in apps}
        self.peer = None
        self.failed = False
        with store.transaction():
            try: store.read()
            except FileNotFoundError: pass
            else: raise InvalidState('JOURNAL_EXISTS_NO_REPLAY_OR_ADOPTION')
            initial = {'epoch': self.epoch, 'source': source, 'owner': self.owner,
                       'phase': 'CREATED', 'apps': {str(a.app_id): {'baseline': asdict(a), 'intent': None} for a in apps},
                       'productionAdmission': False}
            store.write(initial)
            self.committed = copy.deepcopy(initial)

    def _persist(self, state):
        try:
            self.store.write(state)
            self.committed = copy.deepcopy(state)
        except BaseException:
            # fsync/replace may have landed even if their caller saw an error.
            # This live object cannot keep planning after ambiguous durability.
            self.failed = True
            raise

    def _guard(self, state):
        if self.failed: raise InvalidState('SESSION_INVALIDATED')
        if state != self.committed:
            self.failed = True
            raise InvalidState('JOURNAL_DIVERGED_FROM_LIVE_COMMITMENTS')
        try:
            current = self.lease.validate()
            if (identity() != self.owner or current['epoch'] != self.epoch
                    or state['epoch'] != self.epoch or state['source'] != self.source
                    or state['owner'] != self.owner or state.get('productionAdmission') is not False
                    or set(state['apps']) != set(self.baselines)
                    or any(state['apps'][k]['baseline'] != v or state['apps'][k]['intent'] not in
                           (None, 'STOP_PENDING', 'START_PENDING') for k, v in self.baselines.items())):
                raise UnsafeLease('SESSION_IDENTITY_CHANGED')
        except (OSError, UnsafeLease):
            self.failed = True
            state['phase'] = 'GAP'; self._persist(state)
            raise InvalidState('EXCLUSION_GAP_NO_OLD_BASELINE_ACTION')
        if state['phase'] in ('GAP', 'TRANSFER_UNCONFIRMED'):
            raise InvalidState('NO_ACTION_IN_UNCERTAIN_PHASE')
        return current

    def transfer_once(self, channel, expected_peer):
        # Journal reservation precedes sendmsg. It is safe to hold this local
        # transaction only for the bounded caller socket timeout. No child reads
        # this journal or waits for its mutex while sending the transport ACK.
        with self.store.transaction():
            state = self.store.read(); self._guard(state)
            if state['phase'] != 'CREATED': raise InvalidState('NO_TRANSFER_RETRY')
            state['phase'] = 'TRANSFER_PENDING'; self._persist(state)
            try:
                ack = self.lease.offer(channel, expected_peer)
                if identity(expected_peer['pid']) != expected_peer:
                    raise UnsafeLease('PEER_CHANGED_AFTER_ACK')
            except BaseException:
                state['phase'] = 'TRANSFER_UNCONFIRMED'; self._persist(state)
                raise
            self.peer = expected_peer
            state.update(phase='ACK_OBSERVED', peer=expected_peer, ack=ack)
            self._persist(state)
            return 'ACK_OBSERVED_NOT_ADMITTED'

    def prepare_local(self):
        with self.store.transaction():
            state = self.store.read(); self._guard(state)
            if state['phase'] != 'ACK_OBSERVED' or self.peer != state.get('peer'):
                raise InvalidState('ACK_REQUIRED')
            if identity(self.peer['pid']) != self.peer:
                raise InvalidState('PEER_NO_LONGER_PRESENT')
            state['phase'] = 'LOCAL_PREPARED'; self._persist(state)
        return 'LOCAL_PREPARED_NOT_PRODUCTION_ADMISSION'

    def stop_intent(self, app_id):
        with self.store.transaction():
            state = self.store.read(); self._guard(state)
            if state['phase'] != 'LOCAL_PREPARED': raise InvalidState('LOCAL_PREPARATION_REQUIRED')
            if identity(self.peer['pid']) != self.peer: raise InvalidState('TWO_PEERS_REQUIRED_FOR_NEW_WORK')
            app = state['apps'][str(app_id)]
            if app['intent'] is not None: raise InvalidState('INTENT_ALREADY_EXISTS')
            app['intent'] = 'STOP_PENDING'; self._persist(state)
        return 'SYNTHETIC_STOP_INTENT_ONLY'

    def start_intent(self, now, *, same_daemon, same_release, original_absent):
        # Survivor's original reference remains the authority for this LOCAL
        # reconciliation. A new Session cannot adopt this journal after a gap.
        with self.store.transaction():
            state = self.store.read(); self._guard(state)
            if state['phase'] != 'LOCAL_PREPARED': raise InvalidState('LOCAL_PREPARATION_REQUIRED')
            app = state['apps'][str(now.app_id)]
            result = recovery(App(**app['baseline']), now, app['intent'], continuous_lease=True,
                              same_daemon=same_daemon, same_release=same_release,
                              original_absent=original_absent)
            if result == 'ELIGIBLE_RETAINED_START_NOT_EXECUTED':
                app['intent'] = 'START_PENDING'; self._persist(state)
                return 'SYNTHETIC_START_INTENT_ONLY'
            return result
