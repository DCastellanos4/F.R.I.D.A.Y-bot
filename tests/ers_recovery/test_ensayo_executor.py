import copy,hashlib,json,os,shutil,signal,subprocess,tempfile,time,unittest
from pathlib import Path
from unittest.mock import patch
from test_ensayo_os import manifest,ROOT
from deploy.ers_recovery import ensayo_fixture_executor as e
from deploy.ers_recovery.ensayo_os import ContractHold
class Harness:
 def __init__(self):
  self.control=tempfile.TemporaryDirectory(prefix='ers-ensayo-control-');self.target=Path(tempfile.mkdtemp(prefix='ers-ensayo-fixture-'));self.target.rmdir();self.i=e.Installer(self.target,self.control.name,manifest());self.s=None
 def install(self):return self.i.install(ROOT)
 def run(self,seconds=10):self.s=e.Supervisor(self.i,seconds=seconds);return self.s.run()
 def cleanup(self):return self.i.cleanup(children=list(self.s.children.values()) if self.s else [])
 def close(self):
  if self.s:
   self.s.stop();self.s.close()
  self.i.close()
  if self.target.exists():shutil.rmtree(self.target)
  self.control.cleanup()
 def __enter__(self):return self
 def __exit__(self,*args):self.close()
class Executors(unittest.TestCase):
 def test_actual_install_supervisor_collector_exact_cleanup(self):
  with Harness() as h:
   inv=h.install();self.assertEqual(len(inv),27);out=h.run();self.assertFalse(out['productionAdmission']);self.assertEqual(out['kernelContainment'],'UNVERIFIED');self.assertEqual(out['roles']['controller']['manager'],'NOT_PRESENT_LOCAL_FIXTURE_NO_SYSTEMD');self.assertNotEqual(out['roles']['controller']['identity']['pid'],out['roles']['watchdog']['identity']['pid']);self.assertLessEqual(out['reads'],80)
   result=h.cleanup();self.assertEqual(result['status'],'EXACT_FIXTURE_CLEANED');self.assertFalse(h.target.exists());self.assertTrue((Path(h.control.name)/'inventory.jsonl').exists())
 def test_install_exclusive_no_replace(self):
  with Harness() as h:
   h.install();p=h.target/'fixture.json';before=p.read_bytes()
   with self.assertRaises(FileExistsError):h.i.create('fixture.json',data=b'replacement')
   self.assertEqual(p.read_bytes(),before)
   with self.assertRaises(ContractHold):h.cleanup()
 def test_existing_root_rejected_without_ledger(self):
  with tempfile.TemporaryDirectory(prefix='ers-ensayo-control-') as control,tempfile.TemporaryDirectory(prefix='ers-ensayo-fixture-') as root:
   with self.assertRaises(ContractHold):e.Installer(root,control,manifest())
   self.assertEqual(list(Path(control).iterdir()),[])
 def test_source_pin_failure_before_destination(self):
  with Harness() as h:
   h.i.m['sourceFiles']['paired.py']='0'*64
   with self.assertRaises(ContractHold):h.install()
   self.assertFalse(h.target.exists())
 def test_arbitrary_canonical_paths_rejected(self):
  for p in ['/etc/ers-ensayo','/run/ers-ensayo-test','/tmp/ers-ensayo-fixture-a/child']:
   with self.assertRaises(ContractHold):e.namespace(p,'ers-ensayo-fixture-',exists=False)
 def test_control_private_not_in_holder_root(self):
  with Harness() as h:
   h.install();rows=h.i.ledger.read();self.assertEqual(rows[0]['class'],e.CLASS);self.assertFalse(any('token' in json.dumps(r).lower() for r in rows));self.assertFalse((h.target/'inventory.jsonl').exists());self.assertEqual((Path(h.control.name)/'inventory.jsonl').stat().st_mode&0o777,0o600)
 def test_partial_ledger_holds(self):
  with Harness() as h:
   h.install();os.write(h.i.ledger.fd,b'{')
   with self.assertRaises(ContractHold):h.i.ledger.read()
   with self.assertRaises(ContractHold):h.cleanup()
 def test_create_crash_between_intent_and_effect_holds(self):
  with Harness() as h:
   h.install();h.i.ledger.append({'op':'INTENT','path':'runtime/ensayo.lock','kind':'file'})
   with self.assertRaisesRegex(ContractHold,'EXECUTOR_UNCERTAIN_CREATION'):h.cleanup()
   self.assertTrue(h.target.exists())
 def test_cleanup_hash_drift_deletes_nothing(self):
  with Harness() as h:
   h.install();p=h.target/'fixture.json';p.chmod(0o600);p.write_bytes(b'drift');p.chmod(0o400)
   with self.assertRaises(ContractHold):h.cleanup()
   self.assertTrue((h.target/'source'/'paired.py').exists());self.assertTrue(p.exists())
 def test_cleanup_unknown_entry_deletes_nothing(self):
  with Harness() as h:
   h.install();(h.target/'config'/'unknown').write_text('synthetic')
   with self.assertRaises(ContractHold):h.cleanup()
   self.assertTrue((h.target/'fixture.json').exists())
 def test_cleanup_parent_symlink_drift_holds(self):
  with Harness() as h,tempfile.TemporaryDirectory() as elsewhere:
   h.install();p=h.target/'runtime';p.rmdir();p.symlink_to(elsewhere)
   with self.assertRaises(ContractHold):h.cleanup()
   self.assertTrue((h.target/'source'/'paired.py').exists())
 def test_deadline_kills_exact_original_no_automatic_cleanup(self):
  with Harness() as h:
   h.install();h.s=e.Supervisor(h.i,seconds=.15)
   with patch.object(h.s,'wait_path',side_effect=lambda *a,**kw:time.sleep(.2)):
    with self.assertRaisesRegex(ContractHold,'EXECUTOR_ABSOLUTE_DEADLINE'):h.s.run()
   self.assertTrue(all(ch.p.poll() is not None for ch in h.s.children.values()));self.assertTrue(h.target.exists())
 def test_holder_death_external_supervisor_and_inventory_survive(self):
  with Harness() as h:
   h.install();h.s=e.Supervisor(h.i);ch=h.s.spawn('controller');h.s.wait_path(h.i.m['paths']['socket']);ch.p.kill();ch.p.wait(timeout=2)
   with self.assertRaises(ContractHold):h.s.check()
   h.s.stop();self.assertTrue(h.i.ledger.read());self.assertTrue(h.target.exists())
 def test_live_holder_prevents_cleanup(self):
  with Harness() as h:
   h.install();h.s=e.Supervisor(h.i);h.s.spawn('controller');h.s.wait_path(h.i.m['paths']['socket'])
   with self.assertRaises(ContractHold):h.cleanup()
   self.assertTrue((h.target/'fixture.json').exists())
 def test_no_restart_or_pid_from_receipt(self):
  with Harness() as h:
   h.install();h.s=e.Supervisor(h.i);h.s.spawn('controller')
   with self.assertRaises(ContractHold):h.s.spawn('controller')
   with self.assertRaises(ContractHold):e.OriginalChild({'pid':os.getpid()})
 def test_collector_forged_receipt_not_independent(self):
  with Harness() as h:
   h.install();h.s=e.Supervisor(h.i);h.s.spawn('controller');h.s.wait_path(h.i.m['paths']['socket']);h.s.spawn('watchdog')
   for role in e.c.ROLES:h.s.wait_path(h.i.m['paths'][role+'Receipt'],receipt=True)
   p=h.target/'runtime'/'controller.receipt.json';r=json.loads(p.read_bytes());r['process']['pid']=os.getpid();p.write_bytes(e.c.encode(r))
   with self.assertRaises(ContractHold):e.collect_fixture(h.i,h.s.children)
 def test_proc_cap_and_fd_bound(self):
  b=e.ProcBudget()
  with self.assertRaises(ContractHold):b.read('/proc/self/status',1)
  b=e.ProcBudget();b.reads=80
  with self.assertRaises(ContractHold):b.read('/proc/self/status',8192)
 def test_ledger_reopen_is_readonly_orientation_not_adoption(self):
  with Harness() as h:
   h.install();other=e.Ledger(h.control.name)
   try:self.assertEqual(other.read(),h.i.ledger.read())
   finally:other.close()
   with self.assertRaises(FileExistsError):e.Ledger(h.control.name,create=True)

class LifecycleRegression(unittest.TestCase):
 def ready(self,h):
  h.install();h.s=e.Supervisor(h.i);h.s.spawn('controller');h.s.wait_path(h.i.m['paths']['socket']);h.s.spawn('watchdog')
  for role in e.c.ROLES:h.s.wait_path(h.i.m['paths'][role+'Receipt'],receipt=True)
  h.i.capture_runtime()
 def assert_no_remove(self,h):self.assertFalse(any(r['op']=='REMOVE_INTENT' for r in h.i.ledger.read()))
 def test_live_both_omitted_cleanup_empty_cannot_erase(self):
  with Harness() as h:
   self.ready(h)
   with self.assertRaises(ContractHold):h.i.cleanup(children=[])
   self.assert_no_remove(h);self.assertTrue((h.target/'runtime'/'ensayo.lock').exists());self.assertTrue(all(ch.p.poll() is None for ch in h.s.children.values()))
 def test_only_one_supplied_after_capture_rejected(self):
  with Harness() as h:
   self.ready(h);h.s.stop()
   with self.assertRaises(ContractHold):h.i.cleanup(children=[h.s.children['controller']])
   self.assert_no_remove(h)
 def test_duplicate_substitute_or_identity_mismatch_rejected(self):
  for fault in ('duplicate','substitute','mismatch'):
   with Harness() as h:
    self.ready(h);h.s.stop();children=list(h.s.children.values());substitute=None
    if fault=='duplicate':children=[children[0],children[0]]
    elif fault=='substitute':
     p=subprocess.Popen(['/usr/bin/python3','-c','import time;time.sleep(2)']);substitute=e.OriginalChild(p);substitute.terminate();children=[children[0],substitute]
    else:children[0].original=dict(children[0].original,start='999')
    try:
     with self.assertRaises(ContractHold):h.i.cleanup(children=children)
     self.assert_no_remove(h)
    finally:
     if substitute:substitute.close()
 def test_pending_spawn_intent_blocks_empty_before_remove(self):
  with Harness() as h:
   h.install();h.i.ledger.append({'op':'SUPERVISOR','identity':e.identity(),'class':e.CLASS});h.i.ledger.append({'op':'SPAWN_INTENT','role':'controller'})
   with self.assertRaises(ContractHold):h.i.cleanup(children=[])
   self.assert_no_remove(h)
 def test_partial_spawn_reaped_not_empty_lifecycle(self):
  with Harness() as h:
   h.install();h.s=e.Supervisor(h.i);h.s.spawn('controller');h.s.wait_path(h.i.m['paths']['socket']);h.s.stop()
   with self.assertRaises(ContractHold):h.i.cleanup(children=list(h.s.children.values()))
   self.assert_no_remove(h)
 def test_installed_never_spawned_can_cleanup(self):
  with Harness() as h:
   h.install();self.assertEqual(h.i.cleanup(children=[])['status'],'EXACT_FIXTURE_CLEANED')
