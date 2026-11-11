from pathlib import Path
import sys,unittest,subprocess
from unittest.mock import patch
ROOT=Path(__file__).resolve().parents[2];sys.path.insert(0,str(ROOT))
from deploy.ers_recovery.bounded_unit import bounded_unit
from deploy.ers_recovery.observations import Unverifiable
class BoundedUnit(unittest.TestCase):
 def test_real_worker_invalid_unit_no_systemctl(self):
  with self.assertRaises(Unverifiable):bounded_unit('sshd.service',1,'f'*64,'/not-root')
 def test_large_config_and_bad_deadline_rejected(self):
  with self.assertRaises(Unverifiable):bounded_unit('x'*3000,1,'f'*64,'/test')
  with self.assertRaises(Unverifiable):bounded_unit('unit',1,'f'*64,'/test',deadline=float('nan'))
 def test_global_deadline_kills_reaps_worker(self):
  class Child:
   returncode=None;calls=0;killed=False
   def communicate(self,*a,**kw):
    self.calls+=1
    if self.calls==1:raise subprocess.TimeoutExpired('fixedunitworker',.1)
    self.returncode=-9;return b'',None
   def poll(self):return self.returncode
   def kill(self):self.killed=True
  p=Child()
  with patch('deploy.ers_recovery.bounded_unit.subprocess.Popen',return_value=p),self.assertRaises(Unverifiable):bounded_unit('unit',1,'f'*64,'/test',deadline=.1)
  self.assertTrue(p.killed);self.assertEqual(p.calls,2)
 def test_bad_stdout_shape_size_json_fail_closed(self):
  for data in [b'{' ,b'x'*32769,b'{}']:
   class Child:
    returncode=0
    def communicate(self,*a,**kw):return data,None
    def poll(self):return 0
   with self.subTest(size=len(data)),patch('deploy.ers_recovery.bounded_unit.subprocess.Popen',return_value=Child()),self.assertRaises(Unverifiable):bounded_unit('unit',1,'f'*64,'/test')

 def test_exact_success_is_reprojected_no_extra_private_keys(self):
  import json
  from test_unit_read import record,UNIT
  from deploy.ers_recovery.observations import unit_custody
  m=record();pinfo={'identity':{'pid':10,'start':'20','boot':'testboot'},'exe':[1,2],'cgroup':'0::/ers.slice/controller\n'}
  projection={k:m[k] for k in ('Id','LoadState','ActiveState','SubState','MainPID','InvocationID','ControlGroup')};projection['MainPID']=10;projection['SourceDigest']='f'*64
  a=unit_custody(projection,pinfo['identity'],pinfo['cgroup'],expected_unit=UNIT,expected_source='f'*64,expected_cgroup='/ers.slice/controller')
  result={'manager':m,'process':pinfo,'attestation':a}
  class Child:
   returncode=0
   def communicate(self,*a,**kw):return json.dumps(result).encode(),None
   def poll(self):return 0
  with patch('deploy.ers_recovery.bounded_unit.subprocess.Popen',return_value=Child()):
   self.assertEqual(bounded_unit(UNIT,10,'f'*64,'/ers.slice/controller'),result)
   result['process']['identity']['secret']='synthetic'
   with self.assertRaises(Unverifiable):bounded_unit(UNIT,10,'f'*64,'/ers.slice/controller')
