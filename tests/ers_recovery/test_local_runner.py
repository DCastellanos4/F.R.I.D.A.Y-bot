from pathlib import Path
import sys,copy,unittest
ROOT=Path(__file__).resolve().parents[2];sys.path.insert(0,str(ROOT))
from deploy.ers_recovery.local_runner import LocalRunner
from deploy.ers_recovery.campaign import GATES,CampaignHold
from deploy.ers_recovery.policy import Health
from deploy.ers_recovery.paired import digest
import test_campaign as fixture

class FakePair:
 def __init__(self):self.live={'revision':1};self.actions=[];self.bad=False
 def _check_journal(self):
  if self.bad:raise CampaignHold('SYNTHETIC_CUSTODY_LOSS')
 def _request(self,msg):return {'state':digest(self.live)}
 def stop_intent(self,app):self.actions.append(('STOP',app));return 'SYNTHETIC_STOP_INTENT_ONLY'
 def connected_start_intent(self,app):self.actions.append(('START',app));return 'SYNTHETIC_CONNECTED_START_INTENT_ONLY'
class Runner(unittest.TestCase):
 def new(self):
  b=fixture.CampaignSequence().baseline();p=FakePair();p.baselines={str(i):{'baseline':{'app_id':i,'config':r['configDigest'],'pid':r['pid'],'start':int(r['start']),'status':r['status']}} for i,r in b.items()};return LocalRunner(p,b,{k:True for k in GATES},at=0),p
 def returned(self,r):
  for i,t in ((0,1),(1,2)):
   r.stop_candidate(i,at=t);s=copy.deepcopy(r.campaign.baseline[i]);s.update(pid=0,status='stopped');r.observe_stop(s,at=t+.1,original_absent=True)
  r.rehearsal_candidate(at=3);r.observe_rehearsal(at=4,no_real_effects=True)
  for i,t in ((0,5),(1,6)):
   r.return_candidate(i,at=t);s=copy.deepcopy(r.campaign.baseline[i]);s.update(pid=1000+i,restart_time=0,pm_uptime=100000);r.observe_return(s,at=t+.1,start=str(50+i))
 def health(self,i,t):return Health(1000+i,50+i,0,100000,100000+int(t*1000))
 def test_actual_stability_composes_before_exit(self):
  r,p=self.new();self.returned(r);r.begin_stability((401,'Unauthorized'),self.health(0,7),self.health(1,7),at=7)
  for t in range(7,83,5):result=r.stability_sample(t,self.health(0,t),self.health(1,t),(401,'Unauthorized'),listener_owned=True,wa_connected=True)
  self.assertEqual(result,'OPERATIONAL_EQUIVALENCE_SAMPLED');self.assertFalse(r.verify_exit(at=83,reconciled=True)['productionAdmission'])
  self.assertEqual(p.actions,[('STOP',0),('STOP',1),('START',0),('START',1)])
 def test_custody_fail_prevents_pair_stop(self):
  r,p=self.new();p.bad=True
  with self.assertRaises(CampaignHold):r.stop_candidate(0,at=1)
  self.assertEqual(p.actions,[]);self.assertTrue(r.held)
 def test_pending_no_retry_reaches_pair_once(self):
  r,p=self.new();r.stop_candidate(0,at=1)
  with self.assertRaises(CampaignHold):r.stop_candidate(0,at=2)
  self.assertEqual(p.actions,[('STOP',0)])
 def test_no_synthetic_string_can_mark_stability(self):
  r,p=self.new();self.returned(r)
  with self.assertRaises(CampaignHold):r.verify_exit(at=7,reconciled=True)
 def test_bad_wa_sample_holds_no_exit(self):
  r,p=self.new();self.returned(r);r.begin_stability((401,'Unauthorized'),self.health(0,7),self.health(1,7),at=7)
  with self.assertRaises(CampaignHold):r.stability_sample(7,self.health(0,7),self.health(1,7),(401,'Unauthorized'),listener_owned=True,wa_connected=False)
  self.assertTrue(r.held)
 def test_stability_must_match_return_record(self):
  r,p=self.new();self.returned(r)
  with self.assertRaises(CampaignHold):r.begin_stability((401,'Unauthorized'),Health(999,50,0,100000,1000),self.health(1,7),at=7)

 def test_wrong_return_start_never_enters_stability(self):
  r,p=self.new();self.returned(r)
  with self.assertRaises(CampaignHold):r.begin_stability((401,'Unauthorized'),Health(1000,999,0,100000,1000),self.health(1,7),at=7)
