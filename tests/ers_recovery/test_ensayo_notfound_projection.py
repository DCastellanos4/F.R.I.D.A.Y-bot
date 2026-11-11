"""LOCAL fake process projection, no systemctl/root/HOST/account execution."""
import copy,unittest
from unittest.mock import patch
from test_ensayo_os import manifest
import test_ensayo_privileged_backend as helpers
from deploy.ers_recovery.ensayo_privileged_io import FixedRunner
from deploy.ers_recovery.ensayo_manager_collector import Collector
from deploy.ers_recovery.ensayo_start_controller import StartController
from deploy.ers_recovery import ensayo_os as c
class Tests(unittest.TestCase):
 def absent(self):
  m=manifest();row={k:'' for k in FixedRunner.properties if k not in ('ExecStart','ExecStartPre')};row.update(Id=m['units']['controller'],LoadState='not-found',ActiveState='inactive',SubState='dead',MainPID='0',ControlPID='0',NeedDaemonReload='no',MemoryMax='infinity',MemorySwapMax='infinity',TasksMax='28686',Delegate='no',Restart='no',CPUQuotaPerSecUSec='infinity');return m,row
 def read(self,row):
  r,calls=helpers.PrivilegedIOTests().runner('print('+repr('\n'.join(k+'='+v for k,v in row.items()))+')')
  with patch.object(r,'binary_custody',return_value={}):out=r.invoke('show',r.m['units']['controller'])
  return out
 def test_notfound20_no_fabricated_properties(self):
  m,row=self.absent();out=self.read(row);self.assertEqual(out,row);self.assertNotIn('ExecStart',out);self.assertNotIn('ExecStartPre',out)
 def test_optional_empty_exec_properties_only_notfound(self):
  for keys in (('ExecStart',),('ExecStartPre',),('ExecStart','ExecStartPre')):
   m,row=self.absent();row.update({k:'' for k in keys});self.assertEqual(self.read(row),row)
 def test_loaded_requires22_missing_one_or_both_hold(self):
  for absent in (('ExecStart',),('ExecStartPre',),('ExecStart','ExecStartPre')):
   m,row=self.absent();row.update(LoadState='loaded',ExecStart='fixed known output',ExecStartPre='fixed prestart output')
   for k in absent:row.pop(k)
   with self.assertRaises(c.ContractHold):self.read(row)
 def test_every_strong_absence_parameter_drift_or_exec_present_nonempty_holds(self):
  for field in ('Id','ActiveState','SubState','MainPID','ControlPID','InvocationID','ControlGroup','FragmentPath','DropInPaths','NeedDaemonReload','ExecStart','ExecStartPre'):
   m,row=self.absent();row[field]='untrusted different value'
   with self.assertRaises(c.ContractHold):self.read(row)
 def test_every_base_missing_holds(self):
  m,row=self.absent()
  for key in row:
   bad=dict(row);del bad[key]
   with self.assertRaises(c.ContractHold):self.read(bad)
 def test_unknown_and_duplicate_still_hold(self):
  m,row=self.absent();row['PRIVATE_UNKNOWN']='NO_ECHO'
  with self.assertRaises(c.ContractHold):self.read(row)
  m,row=self.absent();r,calls=helpers.PrivilegedIOTests().runner('print('+repr('\n'.join(k+'='+v for k,v in row.items())+'\nLoadState=not-found')+')')
  with patch.object(r,'binary_custody',return_value={}),self.assertRaises(c.ContractHold):r.invoke('show',r.m['units']['controller'])
 def test_collector_does_not_adopt_absent_unit(self):
  m,row=self.absent();runner=type('Runner',(),{'invoke':lambda *a:row})()
  with self.assertRaises(c.ContractHold):Collector(m,runner).manager('controller')
 def test_reviewer_real_249_capture_20props(self):
  from pathlib import Path
  raw=Path(__file__).with_name('fixtures').joinpath('systemd249-notfound-show.txt').read_text();row=dict(line.split('=',1) for line in raw.splitlines());self.assertEqual(len(row),20)
  import json
  m=json.loads(json.dumps(manifest()).replace('a'*16,'0123456789abcdef'));fake,calls=helpers.PrivilegedIOTests().runner('import sys;sys.stdout.write('+repr(raw)+')');r=FixedRunner(m,spawn=fake.spawn)
  with patch.object(r,'binary_custody',return_value={}):out=r.invoke('show',m['units']['controller'])
  self.assertEqual(out,row)
if __name__=='__main__':unittest.main()
