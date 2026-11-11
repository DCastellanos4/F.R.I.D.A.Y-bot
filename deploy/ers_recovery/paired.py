"""Two-process LOCAL prepared-only replication. No production execution surface.

The donor is the sole planner while connected. The receiver only reconciles
existing stop intents after donor death, using its live replica and original FD.
A protocol exception poisons that object; a restarted object cannot adopt JSON.
This is controlled-process custody, not remote executable attestation.
"""
import copy
import hashlib
import json
import os
import socket
from pathlib import Path

from .composition import InvalidState
from .lease import identity, peer, record, receive_record
from .policy import App, recovery


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True).encode()).hexdigest()


def source_digest():
    # Hash only this local code, never user files or runtime configuration.
    root = Path(__file__).parent
    return digest({p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(root.glob('*.py'))})


def observed_process(pid):
    ident = identity(pid)
    exe = os.stat(f'/proc/{pid}/exe')
    groups = Path(f'/proc/{pid}/cgroup').read_text()
    if identity(pid) != ident:
        raise InvalidState('PROCESS_CHANGED_DURING_OBSERVATION')
    return {'identity': ident, 'exe': [exe.st_dev, exe.st_ino], 'cgroup': groups}


class Pair:
    def __init__(self, store, lease, channel, expected_peer, expected_source, apps, *, donor):
        self.store, self.lease, self.channel = store, lease, channel
        self.owner = observed_process(os.getpid())
        self.remote = observed_process(expected_peer['pid'])
        if self.remote['identity'] != expected_peer:
            raise InvalidState('PEER_CHANGED')
        self.code = source_digest()
        if self.code != expected_source: raise InvalidState('SOURCE_MISMATCH')
        self.epoch = lease.validate()['epoch']
        self.baselines = {str(app.app_id): {'baseline': vars(app), 'intent': None} for app in apps}
        if len(self.baselines) != 2 or any(app.status != 'online' for app in apps):
            raise InvalidState('TWO_ONLINE_BASELINES_REQUIRED')
        self.donor = donor
        self.failed = False
        self.live = self.pending = None
        self.initialized = False
        self.disconnected = False
        peer(channel, expected_peer)

    def own(self):
        if self.failed: raise InvalidState('PAIR_INVALIDATED')
        if source_digest() != self.code:raise InvalidState('LOCAL_SOURCE_CHANGED')
        if observed_process(os.getpid()) != self.owner:
            raise InvalidState('OWNER_CUSTODY_CHANGED')
        lease = self.lease.validate()
        if lease['epoch'] != self.epoch: raise InvalidState('EPOCH_CHANGED')
        return {'process': self.owner, 'source': self.code, 'lease': lease}

    def expected_remote(self):
        peer(self.channel, self.remote['identity'])
        if observed_process(self.remote['identity']['pid']) != self.remote:
            raise InvalidState('PEER_CUSTODY_CHANGED')
        return {'process': self.remote, 'source': self.code, 'lease': self.lease.validate()}

    def _request(self, value):
        try:
            self.own(); record(self.channel, value)
            answer = receive_record(self.channel)
            if answer.get('custody') != self.expected_remote():
                raise InvalidState('PEER_REFERENCE_NOT_CONFIRMED')
            self.own()
            return answer
        except BaseException:
            self.failed = True
            raise

    def _persist(self, state):
        try:self.store.write(state)
        except BaseException:
            self.failed = True
            raise

    def enroll(self):
        if not self.donor or self.initialized: raise InvalidState('NO_ENROLL_RETRY')
        self.initialized = True
        state = {'epoch': self.epoch, 'source': self.code, 'revision': 0, 'phase': 'ENROLL_PENDING',
                 'apps': copy.deepcopy(self.baselines), 'productionAdmission': False}
        with self.store.transaction():
            try:self.store.read()
            except FileNotFoundError:pass
            else:raise InvalidState('JOURNAL_EXISTS_NO_ADOPTION')
            self._persist(state)
            answer = self._request({'op': 'ENROLL', 'state': state, 'donor': self.owner})
            if answer.get('state') != digest(state):
                self.failed = True;raise InvalidState('ENROLL_ACK_MISMATCH')
            self.live = copy.deepcopy(state)
            ready = copy.deepcopy(state);ready['revision'] = 1;ready['phase'] = 'LOCAL_PAIRED'
            self._transition(ready)
        return 'LOCAL_PAIRED_NO_PRODUCTION_ADMISSION'

    def _check_journal(self):
        self.own()
        if self.live is None or self.store.read() != self.live:
            self.failed = True;raise InvalidState('JOURNAL_NOT_LIVE_REPLICA')

    def _transition(self, following):
        self._check_journal()
        # Both live copies consume the proposal before persistence. An uncertain
        # prepare/commit invalidates the sender, and receiver retains pending.
        self.pending = copy.deepcopy(following)
        result = self._request({'op': 'PREPARE', 'prior': digest(self.live), 'state': following})
        if result.get('state') != digest(following):
            self.failed = True;raise InvalidState('PREPARE_ACK_MISMATCH')
        self._persist(following)
        result = self._request({'op': 'COMMIT', 'state': digest(following)})
        if result.get('state') != digest(following):
            self.failed = True;raise InvalidState('COMMIT_ACK_MISMATCH')
        self.live, self.pending = copy.deepcopy(following), None

    def stop_intent(self, app_id):
        if not self.donor or self.disconnected:raise InvalidState('DONOR_ONLY_NEW_WORK')
        try:
            with self.store.transaction():
                self._check_journal()
                if self.live['phase'] != 'LOCAL_PAIRED':raise InvalidState('PAIR_NOT_READY')
                state=copy.deepcopy(self.live);app=state['apps'][str(app_id)]
                if app['intent'] is not None:raise InvalidState('INTENT_CONSUMED')
                app['intent']='STOP_PENDING';state['revision']+=1
                self._transition(state)
        except BaseException:
            self.failed=True;raise
        return 'SYNTHETIC_STOP_INTENT_ONLY'

    def service_once(self):
        """Receiver reactor step. Timeout/parse/identity errors poison the replica."""
        if self.donor:raise InvalidState('RECEIVER_ONLY')
        try:
            self.own()
            if self.channel.recv(1, socket.MSG_PEEK) == b'':
                # EOF is transport loss only. It does not prove donor death,
                # destroy the last committed replica or authorize failover.
                return 'CHANNEL_CLOSED_NOT_DEATH_PROOF'
            request = receive_record(self.channel)
            self.expected_remote()
            op=request['op']
            if op=='ENROLL':
                if self.initialized:raise InvalidState('NO_REENROLLMENT')
                state=request['state']
                if (state != {'epoch':self.epoch,'source':self.code,'revision':0,'phase':'ENROLL_PENDING',
                              'apps':self.baselines,'productionAdmission':False}
                        or request['donor']!=self.remote):raise InvalidState('UNEXPECTED_INITIAL_STATE')
                # No state is recovered from disk here. It comes from the live
                # authenticated donor, compared with independently supplied baseline.
                self.live=copy.deepcopy(state);self.initialized=True
            elif op=='PREPARE':
                self._check_journal()
                state=request['state']
                if self.pending is not None or request['prior']!=digest(self.live):
                    raise InvalidState('STALE_OR_PENDING_PROPOSAL')
                if (state['epoch']!=self.epoch or state['source']!=self.code
                        or state['revision']!=self.live['revision']+1
                        or state['productionAdmission'] is not False
                        or set(state['apps'])!=set(self.baselines)):
                    raise InvalidState('BAD_TRANSITION')
                # Donor can only move ENROLL_PENDING to LOCAL_PAIRED or consume
                # exactly one previously empty stop intent. Never clear intents.
                expected=copy.deepcopy(self.live);expected['revision']+=1
                if expected['phase']=='ENROLL_PENDING':expected['phase']='LOCAL_PAIRED'
                else:
                    changes=[key for key in expected['apps'] if state['apps'][key]!=expected['apps'][key]]
                    if len(changes)!=1:raise InvalidState('ONE_STOP_INTENT_REQUIRED')
                    key=changes[0]
                    if expected['apps'][key]['intent'] is not None:raise InvalidState('INTENT_ALREADY_CONSUMED')
                    expected['apps'][key]['intent']='STOP_PENDING'
                if state!=expected:raise InvalidState('UNSUPPORTED_TRANSITION')
                self.pending=copy.deepcopy(state)
            elif op=='COMMIT':
                if self.pending is None or request['state']!=digest(self.pending) or self.store.read()!=self.pending:
                    raise InvalidState('COMMIT_NOT_DURABLE_OR_NOT_PENDING')
                self.live,self.pending=self.pending,None
            elif op=='CENSUS':
                self._check_journal()
            else:raise InvalidState('UNKNOWN_OPERATION')
            current=self.pending if self.pending is not None else self.live
            record(self.channel,{'state':digest(current),'custody':self.own()})
            return 'LOCAL_MESSAGE_HANDLED'
        except BaseException:
            self.failed=True;raise

    def peer_gone(self):
        """Explicit local survivor transition, requires positive PID-death evidence.

        EOF or timeout alone is not donor death. A live disconnected donor blocks.
        """
        try:
            ident=identity(self.remote['identity']['pid'])
        except FileNotFoundError:ident=None
        if ident==self.remote['identity']:raise InvalidState('PEER_STILL_PRESENT')
        self.disconnected=True
        if self.failed or self.pending is not None or self.live is None or self.live['phase']!='LOCAL_PAIRED':
            raise InvalidState('SURVIVOR_STATE_UNCERTAIN')
        self.channel.close()
        try:
            with self.store.transaction():self._check_journal()
        except BaseException:
            self.failed=True;raise
        return 'LOCAL_SURVIVOR_ORIGINAL_REFERENCE'

    def survivor_start_intent(self, now, *, same_daemon, same_release, original_absent):
        if not self.disconnected:raise InvalidState('NOT_SURVIVOR')
        try:
            with self.store.transaction():
                self._check_journal()
                if self.pending is not None:raise InvalidState('PENDING_PROPOSAL_NO_RETRY')
                state=copy.deepcopy(self.live);app=state['apps'][str(now.app_id)]
                result=recovery(App(**app['baseline']),now,app['intent'],continuous_lease=True,
                                same_daemon=same_daemon,same_release=same_release,original_absent=original_absent)
                if result!='ELIGIBLE_RETAINED_START_NOT_EXECUTED':return result
                app['intent']='START_PENDING';state['revision']+=1
                self._persist(state);self.live=copy.deepcopy(state)
        except BaseException:
            self.failed=True;raise
        return 'SYNTHETIC_SURVIVOR_START_INTENT_ONLY'
