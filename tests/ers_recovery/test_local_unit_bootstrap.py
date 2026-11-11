import copy,hashlib,os,tempfile,unittest
from pathlib import Path
from deploy.ers_recovery.unit_contract import validate,prepared,digest,ContractHold,ROLES,DENIED,match_loaded_units
from deploy.ers_recovery.local_unit_launcher import run_local
ROOT=Path(__file__).resolve().parents[2]/'deploy/ers_recovery'
def manifest():
 names=['bootstrap_worker.py', 'bounded_http.py', 'bounded_rpc.py', 'bounded_unit.py', 'campaign.py', 'composition.py', 'lease.py', 'local_runner.py', 'local_unit_launcher.py', 'observations.py', 'paired.py', 'policy.py', 'unit_contract.py', 'unit_read.py'];pins={n:hashlib.sha256((ROOT/n).read_bytes()).hexdigest() for n in names};epoch='a'*16
 return {'schema':1,'mode':'LOCAL_BOOTSTRAP_PROPOSAL','productionAdmission':False,'epoch':epoch,'sourceRoot':'/opt/ers/'+digest(pins),'sourceFiles':pins,'python':'/usr/bin/python3','uid':os.getuid(),'gid':os.getgid(),'groups':sorted(set(os.getgroups())),'deniedPaths':list(DENIED),'resources':{r:{'memoryMaxBytes':33554432,'tasksMax':16,'provenance':'SYNTHETIC_PROPOSAL_NOT_HOST_SIZING'} for r in ROLES},'units':{r:'ers-'+r+'-'+epoch+'.service' for r in ROLES},'workerConfig':{r:'/run/ers-'+epoch+'/'+r+'.json' for r in ROLES}}
class Contract(unittest.TestCase):
 def test_two_real_independent_original_processes(self):
  with tempfile.TemporaryDirectory(prefix='ers-local-unit-') as d:
   out=run_local(d,manifest());self.assertFalse(out['productionAdmission']);self.assertTrue(out['leaseBusy']);self.assertEqual(len(set(out['holderPids'])),2);self.assertEqual(out['effects'],[]);self.assertEqual(out['osUnitAdmission'],'NOT_INSTALLED_NOT_ATTESTED')
 def test_survivor_original_reference_after_controller_death(self):
  with tempfile.TemporaryDirectory(prefix='ers-local-unit-') as d:
   out=run_local(d,manifest(),kill_controller=True);self.assertTrue(out['survivorLeaseBusyAfterControllerDeath']);self.assertEqual(out['effects'],[])
 def test_bad_token_no_commit(self):
  with tempfile.TemporaryDirectory(prefix='ers-local-unit-') as d:
   with self.assertRaises(ContractHold):run_local(d,manifest(),token_override='b'*64)
 def test_closed_source_pin_before_spawn(self):
  m=manifest();m['sourceFiles']['paired.py']='0'*64;m['sourceRoot']='/opt/ers/'+digest(m['sourceFiles'])
  with tempfile.TemporaryDirectory(prefix='ers-local-unit-') as d:
   with self.assertRaisesRegex(ContractHold,'LAUNCH_SOURCE_MISMATCH'):run_local(d,m)
 def test_group_contract_not_discovered_override(self):
  m=manifest();m['groups']=[99999]
  with tempfile.TemporaryDirectory(prefix='ers-local-unit-') as d:
   with self.assertRaisesRegex(ContractHold,'LOCAL_IDS'):run_local(d,m)
 def test_units_budgets_and_consumer_paths(self):
  m=manifest();o=prepared(m)
  self.assertFalse(o['productionAdmission']);self.assertEqual(set(o['units']),set(ROLES))
  for role,s in o['units'].items():
   self.assertIn('Restart=no',s);self.assertIn('PrivateNetwork=yes',s);self.assertIn('RuntimeDirectoryPreserve=yes',s);self.assertIn('MemoryMax=33554432',s);self.assertIn(m['workerConfig'][role],s);self.assertNotIn('PartOf=',s);self.assertNotIn('BindsTo=',s)
 def test_cross_role_path_drift(self):
  m=manifest();m['workerConfig']['watchdog']=m['workerConfig']['controller']
  with self.assertRaises(ContractHold):validate(m)
 def test_no_production_switch(self):
  m=manifest();m['productionAdmission']=True
  with self.assertRaises(ContractHold):prepared(m)
 def test_unresolved_budget_no_render(self):
  m=manifest();m['resources']['controller']['tasksMax']=None
  with self.assertRaises(ContractHold):prepared(m)
 def test_extra_source_denied(self):
  m=manifest();m['sourceFiles']['bot.py']='0'*64
  with self.assertRaises(ContractHold):validate(m)
 def test_denied_paths_crosscheck(self):
  m=manifest();m['deniedPaths']=[]
  with self.assertRaises(ContractHold):validate(m)
 def test_injection_path_denied(self):
  m=manifest();m['sourceRoot']='/opt/ers/x\nExecStart=/bin/sh'
  with self.assertRaises(ContractHold):validate(m)
 def test_existing_private_dir_content_denied(self):
  with tempfile.TemporaryDirectory(prefix='ers-local-unit-') as d:
   (Path(d)/'existing').write_text('synthetic')
   with self.assertRaises(ContractHold):run_local(d,manifest())

class LoadedContract(unittest.TestCase):
 def fixture(self):
  from deploy.ers_recovery.observations import unit_custody
  from deploy.ers_recovery.unit_read import PROPERTIES
  m=manifest();p=prepared(m);observed={}
  for i,role in enumerate(ROLES):
   unit=m['units'][role];group='/system.slice/'+unit
   manager={k:'' for k in PROPERTIES};manager.update(Id=unit,LoadState='loaded',ActiveState='active',SubState='running',MainPID=str(200+i),InvocationID=str(i+1)*32,ControlGroup=group,FragmentPath='/etc/systemd/system/'+unit,NeedDaemonReload='no',User=str(m['uid']),Group=str(m['gid']),SupplementaryGroups=' '.join(map(str,m['groups'])),KillMode='control-group',OOMPolicy='stop',MemoryMax='33554432',TasksMax='16',RuntimeDirectory='ers-'+m['epoch'])
   process={'identity':{'pid':200+i,'start':'123','boot':'synthetic'},'exe':[1,2],'cgroup':'0::'+group+'\n'}
   projection={k:manager[k] for k in ('Id','LoadState','ActiveState','SubState','MainPID','InvocationID','ControlGroup')};projection.update(MainPID=200+i,SourceDigest=p['unitSourceHashes'][role]);att=unit_custody(projection,process['identity'],process['cgroup'],expected_unit=unit,expected_source=p['unitSourceHashes'][role],expected_cgroup=group);observed[role]={'manager':manager,'process':process,'attestation':att}
  return m,observed
 def test_exact_projections_still_not_admission(self):
  m,o=self.fixture();a=match_loaded_units(m,o);self.assertFalse(a['productionAdmission']);self.assertEqual(a['kernelContainment'],'UNVERIFIED')
 def test_cross_role_budget_group_denied(self):
  for key,val in [('TasksMax','99'),('User','0'),('SupplementaryGroups','99999'),('ControlGroup','/'),('BindsTo','another.service'),('DropInPaths','evil.conf')]:
   m,o=self.fixture();o['watchdog']['manager'][key]=val
   with self.assertRaises(ContractHold):match_loaded_units(m,o)
 def test_fabricated_attestation_source_denied(self):
  m,o=self.fixture();o['controller']['attestation']['source']='0'*64
  with self.assertRaises(ContractHold):match_loaded_units(m,o)
 def test_nonexact_process_denied(self):
  m,o=self.fixture();o['controller']['process']['identity']['extra']='synthetic'
  with self.assertRaises(ContractHold):match_loaded_units(m,o)

class ReviewRegression(unittest.TestCase):
 def test_root_hash_all_consumers(self):
  m=manifest();m['sourceRoot']='/opt/ers/'+'0'*64
  for fn in (validate,prepared,lambda x:match_loaded_units(x,{})):
   with self.assertRaisesRegex(ContractHold,'SOURCE_ROOT_DIGEST_MISMATCH'):fn(m)
 def worker(self,d):
  import importlib.util
  from unittest.mock import patch
  spec=importlib.util.spec_from_file_location('exact_bootstrap_worker',ROOT/'bootstrap_worker.py');worker=importlib.util.module_from_spec(spec);spec.loader.exec_module(worker)
  m=manifest();cfg={'mode':'LOCAL_SYNTHETIC_ONLY','role':'controller','directory':str(d),'lock':str(Path(d)/'deploy.lock'),'socket':str(Path(d)/'channel.sock'),'token':'a'*64,'expectedSourceFiles':m['sourceFiles'],'apps':[]}
  with patch.object(worker.socket,'socket',side_effect=AssertionError('NO_SOCKET_BEFORE_GUARD')):
   with self.assertRaises(ValueError):worker.main(cfg)
  self.assertFalse((Path(d)/'deploy.lock').exists())
 def test_direct_worker_wrong_prefix(self):
  with tempfile.TemporaryDirectory(prefix='wrong-local-') as d:self.worker(d)
 def test_direct_worker_nested_directory(self):
  with tempfile.TemporaryDirectory(prefix='ers-local-unit-') as d:
   p=Path(d)/'ers-local-unit-child';p.mkdir(mode=0o700);self.worker(p)
 def test_direct_worker_symlink(self):
  with tempfile.TemporaryDirectory(prefix='ers-local-unit-') as d:
   p=Path('/tmp')/('ers-local-unit-link-'+str(os.getpid()));p.symlink_to(d)
   try:self.worker(p)
   finally:p.unlink()
 def test_direct_worker_public_directory(self):
  with tempfile.TemporaryDirectory(prefix='ers-local-unit-') as d:
   os.chmod(d,0o755);self.worker(d)
