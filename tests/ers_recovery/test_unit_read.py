from pathlib import Path
import sys,unittest,subprocess,os
from unittest.mock import patch
ROOT=Path(__file__).resolve().parents[2];sys.path.insert(0,str(ROOT))
from deploy.ers_recovery.unit_read import *
UNIT='ers-controller-0123456789abcdef.service'

def record():
 r={k:'' for k in PROPERTIES};r.update(Id=UNIT,LoadState='loaded',ActiveState='active',SubState='running',MainPID='10',InvocationID='a'*32,ControlGroup='/ers.slice/controller',FragmentPath='/etc/systemd/system/'+UNIT,NeedDaemonReload='no')
 return r

class UnitRead(unittest.TestCase):
 def run_manager(self,out=None,*,code=0):
  calls=[]
  class Child:
   returncode=code
   def communicate(self,*a,**kw):return out,None
   def poll(self):return code
  def popen(*a,**kw):calls.append((a,kw));return Child()
  with patch('deploy.ers_recovery.unit_read.subprocess.Popen',side_effect=popen):result=manager_unit(UNIT)
  return result,calls
 def encode(self,r):return ''.join(k+'='+v+'\n' for k,v in r.items()).encode()
 def test_exact_manager_properties_only_no_exec_or_env(self):
  r,c=self.run_manager(self.encode(record()));self.assertEqual(r,record())
  args,kw=c[0];self.assertEqual(args[0][0:2],['/usr/bin/systemctl','show']);self.assertEqual(args[0][-2:],['--',UNIT])
  self.assertIn('--all',args[0]);self.assertEqual(r['DropInPaths'],'');self.assertEqual(r['PartOf'],'');projection=next(v for v in args[0] if v.startswith('--property='));self.assertNotIn('Environment',projection);self.assertNotIn('ExecStart',projection);self.assertTrue(kw['close_fds']);self.assertEqual(set(kw['env']),{'PATH','LANG','SYSTEMD_PAGER'})
 def test_unknown_or_missing_or_duplicate_properties_fail(self):
  r=record()
  for body in [self.encode(r)+b'Environment=secret\n',self.encode({k:v for k,v in r.items() if k!='Id'}),self.encode(r)+b'Id='+UNIT.encode()+b'\n',b'x'*16385]:
   with self.subTest(length=len(body)),self.assertRaises(Unverifiable):self.run_manager(body)
 def test_not_loaded_reload_dropins_or_wrong_fragment_hold(self):
  for field,value in [('LoadState','not-found'),('NeedDaemonReload','yes'),('DropInPaths','/private/drop.conf'),('FragmentPath','/run/unit.service')]:
   r=record();r[field]=value
   with self.subTest(field=field),self.assertRaises(Unverifiable):self.run_manager(self.encode(r))
 def test_no_arbitrary_systemctl_target(self):
  for name in ['sshd.service','ers-controller-x.service','--all',UNIT+';evil']:
   with self.subTest(name=name),self.assertRaises(Unverifiable):manager_unit(name)
 def test_deadline_kills_reaps_exact_child(self):
  class Child:
   returncode=None;calls=0;killed=False
   def communicate(self,*a,**kw):
    self.calls+=1
    if self.calls==1:raise subprocess.TimeoutExpired('systemctl',.1)
    self.returncode=-9;return b'',None
   def poll(self):return self.returncode
   def kill(self):self.killed=True
  p=Child()
  with patch('deploy.ers_recovery.unit_read.subprocess.Popen',return_value=p),self.assertRaises(Unverifiable):manager_unit(UNIT,deadline=.1)
  self.assertTrue(p.killed);self.assertEqual(p.calls,2)
 def test_process_identity_reads_only_actual_self_metadata(self):
  r=process_identity(os.getpid());self.assertEqual(r['identity']['pid'],os.getpid());self.assertTrue(r['identity']['start'].isdigit());self.assertEqual(len(r['exe']),2)
 def test_composed_source_and_manager_double_read(self):
  r=record();p={'identity':{'pid':10,'start':'20','boot':'testboot'},'exe':[1,2],'cgroup':'0::/ers.slice/controller\n'}
  with patch('deploy.ers_recovery.unit_read.manager_unit',return_value=r) as m,patch('deploy.ers_recovery.unit_read.pinned_fragment',return_value='f'*64) as f,patch('deploy.ers_recovery.unit_read.process_identity',return_value=p) as i:
   result=collect_unit(UNIT,10,'f'*64,'/ers.slice/controller')
  self.assertEqual(result['attestation']['unit'],UNIT);self.assertEqual(m.call_count,2);self.assertEqual(f.call_count,2);self.assertEqual(i.call_count,2)
 def test_changed_loaded_invocation_during_read_holds(self):
  r=record();z=record();z['InvocationID']='b'*32;p={'identity':{'pid':10,'start':'20','boot':'testboot'},'exe':[1,2],'cgroup':'0::/ers.slice/controller\n'}
  with patch('deploy.ers_recovery.unit_read.manager_unit',side_effect=[r,z]),patch('deploy.ers_recovery.unit_read.pinned_fragment',return_value='f'*64),patch('deploy.ers_recovery.unit_read.process_identity',return_value=p),self.assertRaises(Unverifiable):collect_unit(UNIT,10,'f'*64,'/ers.slice/controller')
