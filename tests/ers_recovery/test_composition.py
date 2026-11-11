import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
ROOT=Path(__file__).resolve().parents[2];sys.path.insert(0,str(ROOT))
from deploy.ers_recovery.composition import Store, Session, InvalidState
from deploy.ers_recovery.lease import Lease, identity
from deploy.ers_recovery.policy import App
from test_recovery import WORKER

class Composition(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.d=Path(self.tmp.name);self.private=self.d/'journal';self.private.mkdir(mode=0o700)
        self.path=self.d/'lock';self.path.touch(mode=0o600);self.lease=Lease.acquire_existing(self.path)
        self.store=Store(self.private);self.apps=[App(0,'api-sha',100,10,'online'),App(1,'wa-sha',101,11,'online')]
        self.session=Session(self.store,self.lease,'source-sha',self.apps);self.children=[]
    def tearDown(self):
        self.lease.close();self.store.close()
        for p in self.children:
            if p.poll() is None:p.kill()
            p.wait();p.stdin.close();p.stdout.close();p.stderr.close()
        self.tmp.cleanup()
    def transfer(self):
        server=socket.socket(socket.AF_UNIX,socket.SOCK_SEQPACKET);server.bind(str(self.d/'socket'));server.listen(1);server.settimeout(3)
        p=subprocess.Popen([sys.executable,'-c',WORKER,str(ROOT),str(self.d/'socket'),str(self.path),json.dumps(identity()),self.lease.epoch],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
        self.children.append(p);c,_=server.accept();server.close();c.settimeout(3)
        remote=json.loads(p.stdout.readline())
        try:r=self.session.transfer_once(c,remote)
        finally:c.close()
        self.assertEqual(p.stdout.readline().strip(),'READY')
        return p,r
    def prepared(self):
        p,r=self.transfer();self.assertEqual(r,'ACK_OBSERVED_NOT_ADMITTED')
        self.assertEqual(self.session.prepare_local(),'LOCAL_PREPARED_NOT_PRODUCTION_ADMISSION');return p
    def stopped(self,i=0):return App(i,'api-sha' if i==0 else 'wa-sha',0,0,'stopped')
    def start(self,i=0):return self.session.start_intent(self.stopped(i),same_daemon=True,same_release=True,original_absent=True)
    def test_composed_ack_then_local_intents_no_admission(self):
        self.prepared();self.session.stop_intent(0);self.assertEqual(self.start(),'SYNTHETIC_START_INTENT_ONLY')
        self.assertEqual(self.start(),'HOLD_START_OUTCOME_UNCERTAIN')
        self.assertFalse(self.store.read()['productionAdmission'])
    def test_ack_alone_does_not_prepare_stop(self):
        self.transfer()
        with self.assertRaises(InvalidState):self.session.stop_intent(0)
    def test_no_ack_no_prepare(self):
        with self.assertRaises(InvalidState):self.session.prepare_local()
    def test_lost_ack_is_durable_uncertain_no_retry(self):
        a,b=socket.socketpair(socket.AF_UNIX,socket.SOCK_SEQPACKET);a.settimeout(.03)
        try:
            with self.assertRaises(TimeoutError):self.session.transfer_once(a,identity())
            self.assertEqual(self.store.read()['phase'],'TRANSFER_UNCONFIRMED')
            with self.assertRaises(InvalidState):self.session.transfer_once(a,identity())
            with self.assertRaises(InvalidState):self.session.stop_intent(0)
        finally:a.close();b.close()
    def test_receiver_death_blocks_new_work_but_own_reference_reconciles(self):
        p=self.prepared();self.session.stop_intent(0);p.kill();p.wait(timeout=3)
        with self.assertRaises((InvalidState,OSError)):self.session.stop_intent(1)
        self.assertEqual(self.start(),'SYNTHETIC_START_INTENT_ONLY')
    def test_closed_reference_durable_gap(self):
        self.prepared();self.session.stop_intent(0);self.lease.close()
        with self.assertRaises(InvalidState):self.start()
        self.assertEqual(self.store.read()['phase'],'GAP')
    def test_reacquire_cannot_adopt_existing_journal(self):
        p=self.prepared();self.lease.close();p.kill();p.wait(timeout=3)
        fresh=Lease.acquire_existing(self.path)
        try:
            with self.assertRaises(InvalidState):Session(self.store,fresh,'source-sha',self.apps)
        finally:fresh.close()
    def test_restart_session_no_adoption_even_same_fd(self):
        self.prepared()
        with self.assertRaises(InvalidState):Session(self.store,self.lease,'source-sha',self.apps)
    def test_per_app_original_running_not_restarted(self):
        self.prepared();self.session.stop_intent(0);self.session.stop_intent(1)
        self.assertEqual(self.session.start_intent(self.apps[0],same_daemon=True,same_release=True,original_absent=False),'NO_ACTION_ORIGINAL_RUNNING')
        self.assertEqual(self.start(1),'SYNTHETIC_START_INTENT_ONLY')
    def test_two_store_mutex_excludes_not_shared_deploy_fd(self):
        other=Store(self.private)
        try:
            with self.store.transaction():
                with self.assertRaises(BlockingIOError):
                    with other.transaction():pass
            self.lease.validate()
        finally:other.close()
    def test_same_store_mutex_not_reentrant(self):
        with self.store.transaction():
            with self.assertRaises(InvalidState):
                with self.store.transaction():pass
        self.lease.validate()
    def test_interruption_before_replace_keeps_previous_and_no_action(self):
        self.prepared()
        with patch('deploy.ers_recovery.composition.os.replace',side_effect=OSError('synthetic replace failure')):
            with self.assertRaises(OSError):self.session.stop_intent(0)
        self.assertIsNone(self.store.read()['apps']['0']['intent'])
        with self.assertRaises(InvalidState):self.start()
    def test_interruption_after_replace_is_ambiguous_not_retry(self):
        self.prepared();real=os.fsync
        def fail_directory(fd):
            if fd==self.store.directory_fd:raise OSError('synthetic directory sync failure')
            return real(fd)
        with patch('deploy.ers_recovery.composition.os.fsync',side_effect=fail_directory):
            with self.assertRaises(OSError):self.session.stop_intent(0)
        self.assertEqual(self.store.read()['apps']['0']['intent'],'STOP_PENDING')
        with self.assertRaises(InvalidState):self.start()
    def test_before_file_fsync_keeps_previous(self):
        self.prepared()
        with patch('deploy.ers_recovery.composition.os.fsync',side_effect=OSError('synthetic sync failure')):
            with self.assertRaises(OSError):self.session.stop_intent(0)
        self.assertIsNone(self.store.read()['apps']['0']['intent'])
        self.assertEqual(list(self.private.glob('.journal-*')),[])
    def test_ack_record_write_failure_not_admitted(self):
        original=self.store.write
        def fail_ack(state):
            if state['phase']=='ACK_OBSERVED':raise OSError('synthetic ACK persistence failure')
            original(state)
        with patch.object(self.store,'write',side_effect=fail_ack):
            with self.assertRaises(OSError):self.transfer()
        self.assertEqual(self.store.read()['phase'],'TRANSFER_PENDING')
        with self.assertRaises(InvalidState):self.session.prepare_local()
    def test_commit_write_failure_not_admitted(self):
        self.transfer();original=self.store.write
        def fail_commit(state):
            original(state)
            if state['phase']=='LOCAL_PREPARED':raise OSError('synthetic postcommit failure')
        with patch.object(self.store,'write',side_effect=fail_commit):
            with self.assertRaises(OSError):self.session.prepare_local()
        self.assertEqual(self.store.read()['phase'],'LOCAL_PREPARED')
        self.assertFalse(self.store.read()['productionAdmission'])
        with self.assertRaises(InvalidState):self.session.stop_intent(0)
    def test_journal_path_replaced_blocks(self):
        self.prepared();(self.private/'journal.lock').rename(self.private/'old.lock');(self.private/'journal.lock').touch(mode=0o600)
        with self.assertRaises(InvalidState):self.session.stop_intent(0)
    def test_journal_cannot_set_production_admission(self):
        self.prepared();s=self.store.read();s['productionAdmission']=True
        with self.store.transaction():self.store.write(s)
        with self.assertRaises(InvalidState):self.session.stop_intent(0)
    def test_baseline_changed_blocks(self):
        self.prepared();s=self.store.read();s['apps']['0']['baseline']['config']='other'
        with self.store.transaction():self.store.write(s)
        with self.assertRaises(InvalidState):self.session.stop_intent(0)
    def test_snapshot_rollback_cannot_repeat_start_candidate(self):
        self.prepared();self.session.stop_intent(0);snapshot=self.store.read()
        self.assertEqual(self.start(),'SYNTHETIC_START_INTENT_ONLY')
        with self.store.transaction():self.store.write(snapshot)
        with self.assertRaisesRegex(InvalidState,'DIVERGED'):self.start()
        with self.assertRaises(InvalidState):self.start()
    def test_forged_prepared_without_ack_cannot_start(self):
        forged=self.store.read();forged['phase']='LOCAL_PREPARED';forged['apps']['0']['intent']='STOP_PENDING'
        with self.store.transaction():self.store.write(forged)
        with self.assertRaisesRegex(InvalidState,'DIVERGED'):self.start()
    def test_lock_chmod_insecure_blocks(self):
        self.prepared();os.chmod(self.private/'journal.lock',0o666)
        with self.assertRaisesRegex(InvalidState,'CUSTODY_CHANGED'):self.session.stop_intent(0)
    def test_store_lock_fd_replaced_blocks(self):
        self.prepared();target=self.d/'other';target.touch(mode=0o600)
        fd=os.open(target,os.O_RDWR)
        try:os.dup2(fd,self.store.lock_fd)
        finally:os.close(fd)
        with self.assertRaisesRegex(InvalidState,'CUSTODY_CHANGED'):self.session.stop_intent(0)
    def test_source_changed_blocks(self):
        self.prepared();s=self.store.read();s['source']='different'
        with self.store.transaction():self.store.write(s)
        with self.assertRaises(InvalidState):self.session.stop_intent(0)
        self.assertEqual(self.store.read()['phase'],'LOCAL_PREPARED')

if __name__=='__main__':unittest.main()
