import fcntl
import json
import os
from pathlib import Path
import signal
import socket
import subprocess
import sys
import tempfile
import unittest

ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT))
from deploy.ers_recovery.lease import Lease, UnsafeLease, identity
from deploy.ers_recovery.policy import App, recovery, Stability, Health as ProcessHealth

WORKER='''
import json,os,socket,sys
sys.path.insert(0,sys.argv[1])
from deploy.ers_recovery.lease import Lease, identity
c=socket.socket(socket.AF_UNIX,socket.SOCK_SEQPACKET);c.settimeout(2);c.connect(sys.argv[2])
print(json.dumps(identity()),flush=True)
l=Lease.accept(c,json.loads(sys.argv[4]),sys.argv[3],sys.argv[5])
print('READY',flush=True)
for cmd in sys.stdin:
 if cmd.strip()=='VALIDATE': print(json.dumps(l.validate()),flush=True)
 elif cmd.strip()=='CLOSE': l.close();print('CLOSED',flush=True);break
'''

class KernelTransport(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.d=Path(self.tmp.name);self.p=self.d/'deploy.lock';self.p.touch(mode=0o600)
        self.lease=Lease.acquire_existing(self.p);self.children=[]
    def tearDown(self):
        self.lease.close()
        for p in self.children:
            if p.poll() is None:p.kill()
            p.wait()
            p.stdin.close();p.stdout.close();p.stderr.close()
        self.tmp.cleanup()
    def busy(self):
        fd=os.open(self.p,os.O_RDONLY)
        try:
            try:fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB);return False
            except BlockingIOError:return True
        finally:os.close(fd)
    def transfer(self,epoch=None):
        s=socket.socket(socket.AF_UNIX,socket.SOCK_SEQPACKET);s.settimeout(3);path=self.d/'control';s.bind(str(path));s.listen(1)
        p=subprocess.Popen([sys.executable,'-c',WORKER,str(ROOT),str(path),str(self.p),json.dumps(identity()),epoch or self.lease.epoch],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
        self.children.append(p)
        c,_=s.accept();c.settimeout(3);s.close()
        child=json.loads(p.stdout.readline())
        return p,c,child
    def test_real_transfer_ack_and_close_not_unlock(self):
        p,c,child=self.transfer()
        try:ack=self.lease.offer(c,child)
        finally:c.close()
        self.assertEqual(p.stdout.readline().strip(),'READY');self.assertEqual(ack['epoch'],self.lease.epoch)
        self.lease.close();self.assertTrue(self.busy())
        p.stdin.write('VALIDATE\n');p.stdin.flush();self.assertEqual(json.loads(p.stdout.readline())['epoch'],ack['epoch'])
        p.stdin.write('CLOSE\n');p.stdin.flush();self.assertEqual(p.stdout.readline().strip(),'CLOSED');p.wait(timeout=3)
        self.assertFalse(self.busy())
    def test_donor_process_death_keeps_receiver_lock(self):
        # A fresh donor owns acquisition and sendmsg; the driver owns no duplicate.
        self.lease.close()
        server=self.d/'separate-control'
        donor_code = """
import json,socket,sys
sys.path.insert(0,sys.argv[1])
from deploy.ers_recovery.lease import Lease, identity
l=Lease.acquire_existing(sys.argv[3])
s=socket.socket(socket.AF_UNIX,socket.SOCK_SEQPACKET);s.bind(sys.argv[2]);s.listen(1)
print(json.dumps({'identity':identity(),'epoch':l.epoch}),flush=True)
c,_=s.accept();c.settimeout(3)
peer=json.loads(sys.stdin.readline());l.offer(c,peer)
print('ACK',flush=True)
sys.stdin.readline()
"""
        donor=subprocess.Popen([sys.executable,'-c',donor_code,str(ROOT),str(server),str(self.p)],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
        self.children.append(donor);hello=json.loads(donor.stdout.readline())
        receiver=subprocess.Popen([sys.executable,'-c',WORKER,str(ROOT),str(server),str(self.p),json.dumps(hello['identity']),hello['epoch']],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
        self.children.append(receiver);remote=json.loads(receiver.stdout.readline())
        donor.stdin.write(json.dumps(remote)+'\n');donor.stdin.flush()
        self.assertEqual(donor.stdout.readline().strip(),'ACK');self.assertEqual(receiver.stdout.readline().strip(),'READY')
        donor.kill();donor.wait(timeout=3)
        self.assertTrue(self.busy())
        receiver.stdin.write('VALIDATE\n');receiver.stdin.flush()
        self.assertEqual(json.loads(receiver.stdout.readline())['epoch'],hello['epoch'])
        receiver.kill();receiver.wait(timeout=3);self.assertFalse(self.busy())
    def test_receiver_death_keeps_donor_lock(self):
        p,c,child=self.transfer()
        try:self.lease.offer(c,child)
        finally:c.close()
        self.assertEqual(p.stdout.readline().strip(),'READY');p.kill();p.wait(timeout=3)
        self.assertTrue(self.busy());self.lease.validate()
    def test_wrong_peer_never_transfers(self):
        p,c,child=self.transfer();child['start']='wrong'
        try:
            with self.assertRaises(UnsafeLease):self.lease.offer(c,child)
        finally:c.close()
        self.assertTrue(self.busy())
    def test_wrong_epoch_rejected(self):
        p,c,child=self.transfer(epoch='wrong')
        try:
            with self.assertRaises((UnsafeLease,ValueError)):self.lease.offer(c,child)
        finally:c.close()
        p.wait(timeout=3);self.assertNotEqual(p.returncode,0);self.assertTrue(self.busy())
    def test_missing_ack_retains_donor(self):
        a,b=socket.socketpair(socket.AF_UNIX,socket.SOCK_SEQPACKET);a.settimeout(.05)
        try:
            with self.assertRaises(TimeoutError):self.lease.offer(a,identity())
            self.lease.validate();self.assertTrue(self.busy())
        finally:a.close();b.close()
    def test_explicit_unlock_invalidates(self):
        fcntl.flock(self.lease.fd,fcntl.LOCK_UN)
        with self.assertRaises(UnsafeLease):self.lease.validate()
    def test_inode_replacement_invalidates(self):
        self.p.rename(self.d/'old');self.p.touch()
        with self.assertRaises(UnsafeLease):self.lease.validate()
        self.assertFalse(self.busy())
    def test_symlink_rejected(self):
        p=self.d/'link';p.symlink_to(self.p)
        with self.assertRaises(OSError):Lease.acquire_existing(p)
    def test_busy_rejected(self):
        with self.assertRaises(BlockingIOError):Lease.acquire_existing(self.p)
    def test_inheritable_rejected(self):
        os.set_inheritable(self.lease.fd,True)
        with self.assertRaises(UnsafeLease):self.lease.validate()
    def test_closed_rejected(self):
        self.lease.close()
        with self.assertRaises(UnsafeLease):self.lease.validate()

class Decisions(unittest.TestCase):
    def setUp(self):
        self.before=App(0,'sha',100,20,'online');self.stopped=App(0,'sha',0,0,'stopped')
    def decide(self,now=None,intent='STOP_CONFIRMED',**overrides):
        options=dict(continuous_lease=True,same_daemon=True,same_release=True,original_absent=True);options.update(overrides)
        return recovery(self.before,now or self.stopped,intent,**options)
    def test_nominal_candidate_only(self):self.assertEqual(self.decide(),'ELIGIBLE_RETAINED_START_NOT_EXECUTED')
    def test_each_global_guard(self):
        for k in ['continuous_lease','same_daemon','same_release']:
            with self.subTest(k=k):self.assertTrue(self.decide(**{k:False}).startswith('HOLD'))
    def test_original_online_not_restarted(self):self.assertEqual(self.decide(self.before),'NO_ACTION_ORIGINAL_RUNNING')
    def test_changed_pid_hold(self):self.assertEqual(self.decide(App(0,'sha',101,21,'online')),'HOLD_UNEXPECTED_INSTANCE')
    def test_start_pending_no_retry(self):self.assertEqual(self.decide(intent='START_PENDING'),'HOLD_START_OUTCOME_UNCERTAIN')
    def test_start_pending_online_only_observe(self):self.assertEqual(self.decide(App(0,'sha',101,21,'online'),'START_PENDING'),'OBSERVE_START_OUTCOME')
    def test_changed_config(self):self.assertEqual(self.decide(App(0,'other',0,0,'stopped')),'HOLD_APP_IDENTITY_CHANGED')
    def test_no_stop_record(self):self.assertTrue(self.decide(intent=None).startswith('HOLD'))
    def test_original_still_exists(self):self.assertTrue(self.decide(original_absent=False).startswith('HOLD'))

class Health(unittest.TestCase):
    def setUp(self):self.api=ProcessHealth(1,2,0,1000,0);self.wa=ProcessHealth(3,4,0,1000,0);self.http=(401,'Unauthorized')
    def observer(self):return Stability(self.http,self.api,self.wa)
    def sample(self,s,t,**kw):
        d=dict(api_listener_owned=True,wa_connection_confirmed=True);d.update(kw)
        return s.sample(t,ProcessHealth(1,2,0,1000,int(t*1000)),ProcessHealth(3,4,0,1000,int(t*1000)),self.http,**d)
    def test_full_window(self):
        s=self.observer()
        for t in range(0,75,5):self.assertEqual(self.sample(s,t),'OBSERVING')
        self.assertEqual(self.sample(s,75),'OPERATIONAL_EQUIVALENCE_SAMPLED')
    def test_gap_fails_permanently(self):
        s=self.observer();self.sample(s,0);self.assertTrue(self.sample(s,6).startswith('HOLD'));self.assertTrue(self.sample(s,7).startswith('HOLD'))
    def test_crash_restart_fails(self):
        s=self.observer();self.sample(s,0)
        self.assertTrue(s.sample(5,ProcessHealth(1,2,1,2000,5000),self.wa,self.http,api_listener_owned=True,wa_connection_confirmed=True).startswith('HOLD'))
    def test_wrong_http_fails(self):
        s=self.observer();self.assertTrue(s.sample(0,self.api,self.wa,(200,'ok'),api_listener_owned=True,wa_connection_confirmed=True).startswith('HOLD'))
    def test_listener_and_connection_required(self):
        for k in ['api_listener_owned','wa_connection_confirmed']:
            with self.subTest(k=k):self.assertTrue(self.sample(self.observer(),0,**{k:False}).startswith('HOLD'))
    def test_offline_rejected(self):
        s=self.observer()
        self.assertTrue(s.sample(0,ProcessHealth(1,2,0,1000,0,'stopped'),self.wa,self.http,api_listener_owned=True,wa_connection_confirmed=True).startswith('HOLD'))
    def test_frozen_uptime_rejected(self):
        s=self.observer();self.sample(s,0)
        self.assertTrue(s.sample(5,self.api,self.wa,self.http,api_listener_owned=True,wa_connection_confirmed=True).startswith('HOLD'))
    def test_short_window_rejected(self):
        with self.assertRaises(ValueError):Stability(self.http,self.api,self.wa,window=74)
    def test_unknown_http_rejected(self):
        with self.assertRaises(ValueError):Stability((500,'error'),self.api,self.wa)

if __name__=='__main__':unittest.main()
