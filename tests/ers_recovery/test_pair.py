import fcntl,json,os
from pathlib import Path
import subprocess,sys,tempfile,time,unittest
ROOT=Path(__file__).resolve().parents[2];sys.path.insert(0,str(ROOT))
from deploy.ers_recovery.composition import Store

class PairedProcesses(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.d=Path(self.tmp.name);self.j=self.d/'journal';self.j.mkdir(mode=0o700)
        self.lock=self.d/'lock';self.lock.touch(mode=0o600);self.ps=[]
        self.donor=self.launch('donor');config=json.loads(self.donor.stdout.readline())
        self.receiver=self.launch('receiver',json.dumps(config));remote=json.loads(self.receiver.stdout.readline())
        self.donor.stdin.write(json.dumps(remote)+'\n');self.donor.stdin.flush()
        self.assertEqual(self.donor.stdout.readline().strip(),'READY');self.assertEqual(self.receiver.stdout.readline().strip(),'READY')
    def launch(self,role,*extra):
        p=subprocess.Popen([sys.executable,str(ROOT/'tests/ers_recovery/pair_worker.py'),role,str(self.j),str(self.lock),str(self.d/'socket'),*extra],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
        self.ps.append(p);return p
    def tearDown(self):
        for p in self.ps:
            if p.poll() is None:p.kill()
            p.wait();p.stdin.close();p.stdout.close();p.stderr.close()
        self.tmp.cleanup()
    def ask(self,p,command):
        p.stdin.write(command+'\n');p.stdin.flush()
        line=p.stdout.readline()
        self.assertTrue(line,p.stderr.read() if p.poll() is not None else 'actor returned no result')
        return json.loads(line)
    def enrolled(self):
        result=self.ask(self.donor,'ENROLL');self.assertEqual(result.get('result'),'LOCAL_PAIRED_NO_PRODUCTION_ADMISSION',result)
    def kill_donor(self):self.donor.kill();self.donor.wait(timeout=3)
    def busy(self):
        fd=os.open(self.lock,os.O_RDONLY)
        try:
            try:fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB);return False
            except BlockingIOError:return True
        finally:os.close(fd)
    def test_real_pair_intent_mirrored_then_survivor(self):
        self.enrolled();self.assertEqual(self.ask(self.donor,'STOP0')['result'],'SYNTHETIC_STOP_INTENT_ONLY')
        replica=self.ask(self.receiver,'LIVE')['result'];self.assertEqual(replica['live']['apps']['0']['intent'],'STOP_PENDING')
        self.kill_donor();self.assertTrue(self.busy())
        self.assertEqual(self.ask(self.receiver,'GONE')['result'],'LOCAL_SURVIVOR_ORIGINAL_REFERENCE')
        self.assertEqual(self.ask(self.receiver,'START0')['result'],'SYNTHETIC_SURVIVOR_START_INTENT_ONLY')
        self.assertEqual(self.ask(self.receiver,'START0')['result'],'HOLD_START_OUTCOME_UNCERTAIN')
        self.assertEqual(self.ask(self.receiver,'START1')['result'],'HOLD_STOP_PROVENANCE_UNCERTAIN')
        self.assertFalse(self.ask(self.receiver,'LIVE')['result']['live']['productionAdmission'])
    def test_receiver_death_keeps_donor_reference_and_blocks_work(self):
        self.enrolled();self.receiver.kill();self.receiver.wait(timeout=3);self.assertTrue(self.busy())
        self.assertIn('error',self.ask(self.donor,'STOP0'))
        self.assertIn('error',self.ask(self.donor,'STOP1'))
    def test_alive_donor_not_failover(self):
        self.enrolled();self.assertIn('PEER_STILL_PRESENT',self.ask(self.receiver,'GONE')['error'])
    def test_no_stop_before_enroll(self):self.assertIn('error',self.ask(self.donor,'STOP0'))
    def test_json_rollback_not_survivor_authority(self):
        self.enrolled();old=json.loads((self.j/'journal.json').read_text());self.ask(self.donor,'STOP0');self.kill_donor()
        store=Store(self.j)
        try:
            with store.transaction():store.write(old)
        finally:store.close()
        self.assertIn('JOURNAL_NOT_LIVE_REPLICA',self.ask(self.receiver,'GONE')['error'])
        self.assertIn('error',self.ask(self.receiver,'START0'))
    def test_close_survivor_reference_no_old_baseline(self):
        self.enrolled();self.ask(self.donor,'STOP0');self.kill_donor();self.ask(self.receiver,'CLOSEFD')
        self.assertIn('error',self.ask(self.receiver,'GONE'));self.assertFalse(self.busy())
    def test_donor_survives_receiver_after_mirrored_stop(self):
        self.enrolled();self.ask(self.donor,'STOP0');self.receiver.kill();self.receiver.wait(timeout=3)
        self.assertEqual(self.ask(self.donor,'GONE')['result'],'LOCAL_SURVIVOR_ORIGINAL_REFERENCE')
        self.assertEqual(self.ask(self.donor,'START0')['result'],'SYNTHETIC_SURVIVOR_START_INTENT_ONLY')
        self.assertEqual(self.ask(self.donor,'START0')['result'],'HOLD_START_OUTCOME_UNCERTAIN')
    def test_prepare_ack_lost_no_candidate_no_pending_failover(self):
        self.enrolled();self.assertIn('error',self.ask(self.donor,'FAULT_ACK1'))
        self.assertIsNotNone(self.ask(self.receiver,'LIVE')['result']['pending'])
        self.kill_donor();self.assertIn('SURVIVOR_STATE_UNCERTAIN',self.ask(self.receiver,'GONE')['error'])
        self.assertIn('error',self.ask(self.receiver,'START0'))
    def test_persist_failure_after_prepare_is_uncertain(self):
        self.enrolled();self.assertIn('error',self.ask(self.donor,'FAULT_PERSIST'))
        self.assertIsNotNone(self.ask(self.receiver,'LIVE')['result']['pending'])
        self.kill_donor();self.assertIn('SURVIVOR_STATE_UNCERTAIN',self.ask(self.receiver,'GONE')['error'])
    def test_commit_ack_lost_replica_committed_no_sender_retry(self):
        self.enrolled();self.assertIn('error',self.ask(self.donor,'FAULT_ACK2'))
        replica=self.ask(self.receiver,'LIVE')['result'];self.assertIsNone(replica['pending'])
        self.assertEqual(replica['live']['apps']['0']['intent'],'STOP_PENDING')
        self.assertIn('error',self.ask(self.donor,'STOP0'))
        self.kill_donor();self.assertEqual(self.ask(self.receiver,'GONE')['result'],'LOCAL_SURVIVOR_ORIGINAL_REFERENCE')
        self.assertEqual(self.ask(self.receiver,'START0')['result'],'SYNTHETIC_SURVIVOR_START_INTENT_ONLY')
    def test_postpersist_precommit_failure_no_survivor_candidate(self):
        self.enrolled();self.assertIn('error',self.ask(self.donor,'FAULT_POSTPERSIST'))
        self.assertEqual(json.loads((self.j/'journal.json').read_text())['apps']['0']['intent'],'STOP_PENDING')
        self.kill_donor();self.assertIn('SURVIVOR_STATE_UNCERTAIN',self.ask(self.receiver,'GONE')['error'])
        self.assertIn('error',self.ask(self.receiver,'START0'))
    def test_reenroll_and_repeated_stop_never_return_second_candidate(self):
        self.enrolled();self.assertIn('error',self.ask(self.donor,'ENROLL'))
        self.assertEqual(self.ask(self.donor,'STOP0')['result'],'SYNTHETIC_STOP_INTENT_ONLY')
        self.assertIn('error',self.ask(self.donor,'STOP0'))
    def test_receiver_journal_baseline_forgery_blocks(self):
        self.enrolled();self.ask(self.donor,'STOP0');self.kill_donor()
        store=Store(self.j)
        try:
            with store.transaction():
                forged=store.read();forged['apps']['0']['baseline']['config']='forged';store.write(forged)
        finally:store.close()
        self.assertIn('JOURNAL_NOT_LIVE_REPLICA',self.ask(self.receiver,'GONE')['error'])
    def test_both_die_releases_lock(self):
        self.enrolled();self.kill_donor();self.receiver.kill();self.receiver.wait(timeout=3);self.assertFalse(self.busy())
    def test_path_replaced_not_excluded(self):
        self.enrolled();self.ask(self.donor,'STOP0');self.kill_donor();self.lock.rename(self.d/'oldlock');self.lock.touch(mode=0o600)
        self.assertIn('error',self.ask(self.receiver,'GONE'));self.assertFalse(self.busy())

if __name__=='__main__':unittest.main()


class ConnectedReturn(unittest.TestCase):
    setUp=PairedProcesses.setUp
    launch=PairedProcesses.launch
    tearDown=PairedProcesses.tearDown
    ask=PairedProcesses.ask
    enrolled=PairedProcesses.enrolled
    busy=PairedProcesses.busy
    def observation(self,role,*,absent=True,status='stopped',config='api-sha',pid=0):
        value={'app':{'app_id':0,'config':config,'pid':pid,'start':0,'status':status},'sameDaemon':True,'sameRelease':True,'originalAbsent':absent}
        (self.j/('synthetic-observation-'+role+'.json')).write_text(json.dumps(value))
    def prepared_stop(self):
        self.enrolled();self.assertEqual(self.ask(self.donor,'STOP0')['result'],'SYNTHETIC_STOP_INTENT_ONLY')
        self.observation('donor');self.observation('receiver')
    def test_two_live_independent_observers_commit_start_candidate(self):
        self.prepared_stop();self.assertEqual(self.ask(self.donor,'RETURN0')['result'],'SYNTHETIC_CONNECTED_START_INTENT_ONLY')
        self.assertEqual(self.ask(self.receiver,'LIVE')['result']['live']['apps']['0']['intent'],'START_PENDING')
        self.assertIsNone(self.ask(self.receiver,'LIVE')['result']['pending']);self.assertTrue(self.busy())
        self.assertIn('error',self.ask(self.donor,'RETURN0'))
    def test_independent_receiver_disagrees_blocks_candidate(self):
        self.prepared_stop();self.observation('receiver',absent=False)
        self.assertIn('error',self.ask(self.donor,'RETURN0'))
        self.assertTrue(self.ask(self.donor,'LIVE').get('error') or self.ask(self.donor,'LIVE')['result']['failed'])
        self.assertEqual(self.ask(self.receiver,'LIVE')['result']['live']['apps']['0']['intent'],'STOP_PENDING')
    def test_donor_uncertain_does_not_even_prepare_start(self):
        self.prepared_stop();self.observation('donor',status='errored')
        self.assertIn('error',self.ask(self.donor,'RETURN0'))
        self.assertEqual(self.ask(self.receiver,'LIVE')['result']['live']['apps']['0']['intent'],'STOP_PENDING')
    def test_donor_cannot_return_unstopped_other_app(self):
        self.prepared_stop();self.assertIn('error',self.ask(self.donor,'RETURN1'))
    def test_fresh_process_cannot_adopt_return_from_json(self):
        self.prepared_stop();self.ask(self.donor,'RETURN0');self.donor.kill();self.donor.wait(timeout=3)
        self.assertEqual(self.ask(self.receiver,'GONE')['result'],'LOCAL_SURVIVOR_ORIGINAL_REFERENCE')
        self.assertEqual(self.ask(self.receiver,'START0')['result'],'HOLD_START_OUTCOME_UNCERTAIN')
    def test_missing_independent_observation_holds(self):
        self.prepared_stop();(self.j/'synthetic-observation-receiver.json').unlink()
        self.assertIn('error',self.ask(self.donor,'RETURN0'))
    def test_baseline_config_change_holds(self):
        self.prepared_stop();self.observation('receiver',config='changed')
        self.assertIn('error',self.ask(self.donor,'RETURN0'))

    def test_changed_receiver_observation_before_commit_blocks(self):
        self.prepared_stop();self.assertIn('error',self.ask(self.donor,'RETURN_COMMIT_CHANGED'))
        remote=self.ask(self.receiver,'LIVE')['result'];self.assertTrue(remote['failed']);self.assertIsNotNone(remote['pending'])
        self.assertEqual(remote['live']['apps']['0']['intent'],'STOP_PENDING')
    def test_prepare_ack_loss_no_candidate_and_pending_receiver(self):
        self.prepared_stop();self.assertIn('error',self.ask(self.donor,'RETURN_ACK1'))
        self.assertIsNotNone(self.ask(self.receiver,'LIVE')['result']['pending'])
        self.donor.kill();self.donor.wait(timeout=3)
        self.assertIn('error',self.ask(self.receiver,'GONE'))
    def test_commit_ack_loss_never_returns_candidate_or_retries(self):
        self.prepared_stop();self.assertIn('error',self.ask(self.donor,'RETURN_ACK2'))
        self.assertEqual(self.ask(self.receiver,'LIVE')['result']['live']['apps']['0']['intent'],'START_PENDING')
        self.assertIn('error',self.ask(self.donor,'RETURN0'))

    def test_integrated_runner_two_live_original_holders_and_real_stability(self):
        self.enrolled()
        data={str(i):{'app':{'app_id':i,'config':'api-sha' if i==0 else 'wa-sha','pid':0,'start':0,'status':'stopped'},'sameDaemon':True,'sameRelease':True,'originalAbsent':True} for i in (0,1)}
        for role in ('donor','receiver'):(self.j/('synthetic-observation-'+role+'.json')).write_text(json.dumps(data))
        result=self.ask(self.donor,'RUNNER_SEQUENCE')
        self.assertEqual(result['result']['phase'],'LOCAL_COMPLETE_NO_PRODUCTION_EFFECTS',result)
        self.assertFalse(result['result']['productionAdmission']);self.assertEqual(len(result['result']['actions']),7)
        remote=self.ask(self.receiver,'LIVE')['result'];self.assertEqual([v['intent'] for v in remote['live']['apps'].values()],['START_PENDING','START_PENDING']);self.assertTrue(self.busy())
