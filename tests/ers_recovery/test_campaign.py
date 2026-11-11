import copy,json
from pathlib import Path
import sys,unittest
ROOT=Path(__file__).resolve().parents[2];sys.path.insert(0,str(ROOT))
from deploy.ers_recovery.campaign import LocalCampaign,CampaignHold,GATES
from deploy.ers_recovery.observations import process_record
import test_observations as fixtures

class CampaignSequence(unittest.TestCase):
 def baseline(self):
  b={i:process_record(fixtures.Projection().raw(i),i,'api' if i==0 else 'wa') for i in (0,1)}
  for i in b:b[i]['start']=str(10+i)
  return b
 def new(self,**kwargs):return LocalCampaign(self.baseline(),{k:True for k in GATES},at=0,**kwargs)
 def stop(self,c,i,t=1):
  c.candidate('STOP_PENDING',i,at=t,custody=True);r=copy.deepcopy(c.baseline[i]);r.update(pid=0,status='stopped')
  c.observed('VERIFY_STOP',at=t+.1,custody=True,record=r,original_absent=True,current_start=None)
 def returned(self,c,i,t=5):
  c.candidate('START_PENDING',i,at=t,custody=True);r=copy.deepcopy(c.baseline[i]);r.update(pid=1000+i,status='online')
  c.observed('VERIFY_START',at=t+.1,custody=True,record=r,current_start=str(50+i))
 def both_stopped(self,c):self.stop(c,0,1);self.stop(c,1,2)
 def returned_pair(self,c):
  self.both_stopped(c);c.candidate('REHEARSAL',at=3,custody=True);c.observed('REHEARSAL_NO_REAL_EFFECTS_CONFIRMED',at=4,custody=True)
  self.returned(c,0,5);self.returned(c,1,6)
 def test_full_synthetic_sequence_no_production_admission(self):
  c=self.new();self.returned_pair(c);c.candidate('OBSERVE_STABILITY',at=7,custody=True);c.observed('OPERATIONAL_EQUIVALENCE_SAMPLED',at=82,custody=True)
  c.candidate('VERIFY_EXIT',at=83,custody=True);c.observed('OWNED_EFFECTS_RECONCILED_EXIT_VERIFIED',at=84,custody=True)
  self.assertEqual(c.phase,'LOCAL_COMPLETE_NO_PRODUCTION_EFFECTS');self.assertFalse(c.snapshot()['productionAdmission'])
 def test_manifest_sets_exact(self):
  m=json.loads((ROOT/'deploy/ers_recovery/admission_manifest.json').read_text());self.assertEqual(set(m['requiredGates']),set(GATES));self.assertFalse(m['productionAdmission'])
 def test_each_missing_gate_blocks_first_effect_candidate(self):
  for k in GATES:
   g={x:True for x in GATES};g[k]=False;c=LocalCampaign(self.baseline(),g,at=0)
   with self.subTest(gate=k),self.assertRaises(CampaignHold):c.candidate('STOP_PENDING',0,at=1,custody=True)
   self.assertEqual(c.actions,[])
 def test_pending_stop_consumed_even_on_interruption(self):
  c=self.new();c.candidate('STOP_PENDING',0,at=1,custody=True)
  with self.assertRaises(CampaignHold):c.candidate('STOP_PENDING',0,at=2,custody=True)
  self.assertEqual(len(c.actions),1)
 def test_errored_and_original_not_absent_do_not_count_stopped(self):
  for status,absent in [('errored',True),('stopped',False)]:
   c=self.new();c.candidate('STOP_PENDING',0,at=1,custody=True);r=copy.deepcopy(c.baseline[0]);r.update(pid=0,status=status)
   with self.subTest(status=status),self.assertRaises(CampaignHold):c.observed('VERIFY_STOP',at=2,custody=True,record=r,original_absent=absent)
   self.assertEqual(c.stopped,set())
 def test_no_rehearsal_after_only_one_stop(self):
  c=self.new();self.stop(c,0)
  with self.assertRaises(CampaignHold):c.candidate('REHEARSAL',at=2,custody=True)
 def test_changed_digest_hold_before_accepting_stop(self):
  c=self.new();c.candidate('STOP_PENDING',0,at=1,custody=True);r=copy.deepcopy(c.baseline[0]);r.update(pid=0,status='stopped',configDigest='different')
  with self.assertRaises(CampaignHold):c.observed('VERIFY_STOP',at=2,custody=True,record=r,original_absent=True)
 def test_new_schema_required(self):
  b=self.baseline();b[0]['observationSchema']=1
  with self.assertRaises(CampaignHold):LocalCampaign(b,{x:True for x in GATES},at=0)
 def test_deadline_does_not_trigger_restore_or_start(self):
  c=self.new();c.candidate('STOP_PENDING',0,at=1,custody=True)
  with self.assertRaises(CampaignHold):c.observed('VERIFY_STOP',at=241,custody=True)
  self.assertEqual([x['action'] for x in c.actions],['STOP_PENDING']);self.assertIsNotNone(c.pending)
 def test_custody_loss_holds_old_baseline_actions(self):
  c=self.new();self.stop(c,0)
  with self.assertRaises(CampaignHold):c.candidate('STOP_PENDING',1,at=2,custody=False)
  self.assertEqual(len(c.actions),1)
 def test_no_restore_delete_save_operation(self):
  for action in ['RESTORE','DELETE','SAVE']:
   c=self.new()
   with self.subTest(action=action),self.assertRaises(CampaignHold):c.candidate(action,at=1,custody=True)
 def test_no_source_aliasing_of_baseline_gate_or_result(self):
  b=self.baseline();g={x:True for x in GATES};c=LocalCampaign(b,g,at=0);b[0]['configDigest']='changed';g[GATES[0]]=False
  proposal=c.candidate('STOP_PENDING',0,at=1,custody=True);proposal['action']='SAVE'
  self.assertEqual(c.pending['action'],'STOP_PENDING');self.assertNotEqual(c.baseline[0]['configDigest'],'changed')
 def test_no_monotonic_time_rollback(self):
  c=self.new();c.candidate('STOP_PENDING',0,at=2,custody=True)
  with self.assertRaises(CampaignHold):c.observed('VERIFY_STOP',at=1,custody=True)
 def test_no_exit_before_stability(self):
  c=self.new();self.returned_pair(c)
  with self.assertRaises(CampaignHold):c.candidate('VERIFY_EXIT',at=7,custody=True)
