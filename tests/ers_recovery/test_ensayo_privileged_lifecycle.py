"""LOCAL syscall/NSS/manager fakes only. Never root/systemctl/account commands."""
import copy,hashlib,os,pwd,grp,stat,tempfile,unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
from test_ensayo_os import manifest,ROOT
from test_ensayo_privileged_backend import Journal
from deploy.ers_recovery import ensayo_os as c,ensayo_bootstrap as bootstrap
from deploy.ers_recovery.ensayo_principal_bootstrap import PrincipalBootstrap
from deploy.ers_recovery.ensayo_principal_retire import PrincipalRetire
from deploy.ers_recovery.ensayo_root_install import ExactRemover
from deploy.ers_recovery.ensayo_start_controller import StartController
from deploy.ers_recovery.ensayo_finalizer import Finalizer

class MemoryIO:
 def __init__(self):self.objects={};self.effects=[];self.fail=None;self.nextino=10
 def snapshot(self,p):
  if p=='/LOCAL_SYNTHETIC_SEED':return {'fixture':'FAKE_SEED_NOT_ROOT'}
  return copy.deepcopy(self.objects.get(p))
 def make(self,p,b,uid,gid,mode,kind):
  if p in self.objects:raise FileExistsError()
  if self.fail==p:raise RuntimeError('SYNTHETIC_CRASH_AFTER_INTENT')
  self.nextino+=1;key={'dev':1,'ino':self.nextino,'uid':uid,'gid':gid,'mode':mode,'type':kind,'nlink':2 if kind==stat.S_IFDIR else 1}
  if kind==stat.S_IFREG:key.update(size=len(b),sha256=hashlib.sha256(b).hexdigest())
  self.objects[p]=key;self.effects.append(('create',p,b));return copy.deepcopy(key)
 def create(self,p,b,*,uid,gid,mode):return self.make(p,b,uid,gid,mode,stat.S_IFREG)
 def create_directory(self,p,*,uid,gid,mode):return self.make(p,None,uid,gid,mode,stat.S_IFDIR)
 def children(self,p):return sorted(q[len(p)+1:] for q in self.objects if q.startswith(p+'/') and '/' not in q[len(p)+1:])
 def remove(self,p,key):
  if self.snapshot(p)!=key:raise c.ContractHold('SYNTHETIC_DRIFT')
  if key['type']==stat.S_IFDIR and any(q.startswith(p+'/') for q in self.objects):raise OSError('DIRECTORY_NOT_EMPTY')
  del self.objects[p];self.effects.append(('remove',p,None))
class NSS:
 def __init__(self,m):self.m=m;self.user=None;self.group=None;self.commands=[];self.fail=None
 def user_name(self,name):return self.user
 def user_id(self,uid):return self.user
 def group_name(self,name):return self.group
 def group_id(self,gid):return self.group
 def groups(self,name,gid):return [gid]
 def execute(self,argv):
  self.commands.append(argv)
  if self.fail==Path(argv[0]).name:raise RuntimeError('SYNTHETIC_ACCOUNT_EFFECT_AMBIGUOUS')
  if argv[0].endswith('groupadd'):self.group=grp.struct_group(('ers-ensayo','x',self.m['gid'],[]))
  elif argv[0].endswith('useradd'):self.user=pwd.struct_passwd(('ers-ensayo','x',self.m['uid'],self.m['gid'],'','/nonexistent','/usr/sbin/nologin'))
  elif argv[0].endswith('userdel'):self.user=None
  elif argv[0].endswith('groupdel'):self.group=None
  else:raise AssertionError('COMMAND_NOT_FAKE_ALLOWLIST')
class Seed(Journal):
 def __init__(self,m):super().__init__(m);self.path='/LOCAL_SYNTHETIC_SEED';self.closed=False
 def close(self):self.closed=True
class BundleTests(unittest.TestCase):
 def fixture(self):
  m=manifest();m['groups']=[m['gid']];sources={n:(ROOT/n).read_bytes() for n in c.STAGING_SOURCES};controls={n:(ROOT/n).read_bytes() for n in bootstrap.CONTROL};io=MemoryIO();seed=Seed(m);nss=NSS(m)
  call=lambda **kw:bootstrap.execute_prepared_bundle(m,sources,controls,retirement_bytes={n:(ROOT/n).read_bytes() for n in bootstrap.EXECUTOR_NAMES},account_disposition='REMOVE_IF_EXACT_UNUSED',seed_factory=lambda m:seed,principal_factory=lambda m,j:PrincipalBootstrap(m,j,nss=nss,execute=nss.execute),io_factory=lambda m:io,**kw)
  return m,sources,controls,io,seed,nss,call
 def test_complete_bootstrap_pins_configs_journal_no_starts_or_timer(self):
  m,s,controls,io,j,nss,call=self.fixture();result=call();self.assertEqual(result['status'],'ROOT_FILES_AND_ACCOUNT_PREPARED_NOT_STARTED');self.assertTrue(j.closed);self.assertEqual(len(nss.commands),2)
  data={p:b for op,p,b in io.effects if op=='create'};root=m['intervention']['controlRoot'];cfg=c.load_json(data[root+'/supervisor.json']);self.assertEqual(set(cfg['controlPins']),bootstrap.CONTROL);self.assertEqual(cfg['manifest'],m);self.assertEqual(cfg['bootstrapReceipt'],hashlib.sha256(data[root+'/bootstrap-receipt.json']).hexdigest());self.assertEqual(set(cfg['unitSourceHashes']),set(m['units'].values())|{m['intervention'][r+'Unit'] for r in ('supervisor','cleanup')});self.assertFalse(any(p.endswith('.timer') for p in io.objects));self.assertTrue(data[root+'/lifecycle.jsonl'].endswith(b'\n'));self.assertEqual(c.load_json(data[root+'/lifecycle.jsonl'].splitlines()[0])['manifestDigest'],c.digest(m))
  for name,b in controls.items():self.assertEqual(cfg['controlPins'][name],hashlib.sha256(b).hexdigest())
  for unit,h in cfg['unitSourceHashes'].items():self.assertEqual(h,hashlib.sha256(data['/etc/systemd/system/'+unit]).hexdigest())
 def test_bad_holder_pin_before_any_effect_or_seed(self):
  m,s,co,io,j,nss,call=self.fixture();s['lease.py']+=b'\n# altered'
  with self.assertRaises(c.ContractHold):call()
  self.assertEqual(io.effects,[]);self.assertEqual(nss.commands,[]);self.assertFalse(j.closed)
 def test_final_root_collision_blocks_accounts(self):
  m,s,co,io,j,nss,call=self.fixture();io.objects[m['sourceRoot']]={'collision':True}
  with self.assertRaises(c.ContractHold):call()
  self.assertEqual(nss.commands,[]);self.assertTrue(j.closed)
 def test_partial_install_intent_preserved_no_repair_or_second_principal(self):
  m,s,co,io,j,nss,call=self.fixture();io.fail=m['sourceRoot']+'/lease.py'
  with self.assertRaises(RuntimeError):call()
  self.assertEqual([r for r in j.rows() if r['op']=='INSTALL_INTENT'][-1]['path'],io.fail);self.assertFalse(any(r['op']=='INSTALL_CREATED' and r['path']==io.fail for r in j.rows()));self.assertFalse(any(op=='remove' for op,p,b in io.effects));self.assertEqual(len(nss.commands),2)
  with self.assertRaises(c.ContractHold):PrincipalBootstrap(m,j,nss=nss,execute=nss.execute).reserve()
  self.assertEqual(len(nss.commands),2)
 def test_source_config_unit_roots_retained_after_holder_cleanup(self):
  m,s,co,io,j,nss,call=self.fixture();call();reservations={};empty={}
  for role in c.ROLES:
   r={'unit':m['units'][role],'invocation':'1'*32,'cgroupKey':[27,10+len(empty)]};reservations[role]=r;j.append({'op':'GATE_RESERVATION','role':role,'reservation':r});empty[role]=dict(r,members=[],source='INDEPENDENT_PINNED_CGROUP_FD')
  out=ExactRemover(m,j,io=io).remove_installed(scope_empty_evidence=empty)
  self.assertIn('ROOT_RESIDUALS',out['status']);self.assertIn(m['sourceRoot'],io.objects);self.assertFalse(any(p.startswith(m['sourceRoot']+'/') for p in io.objects));self.assertTrue(all('/etc/systemd/system/'+u in io.objects for u in m['units'].values()));self.assertIn(m['configRoot'],io.objects);self.assertIn(m['runtimeRoot'],io.objects)
 def test_remover_missing_or_drifted_role_no_effect(self):
  m,s,co,io,j,nss,call=self.fixture();call();before=copy.deepcopy(io.objects)
  with self.assertRaises(c.ContractHold):ExactRemover(m,j,io=io).remove_installed(scope_empty_evidence={})
  self.assertEqual(io.objects,before)

class ReviewerNoEffectsRegressions(unittest.TestCase):
 def test_exactremover_all_epoch_roots_unknown_or_drift_before_any_delete(self):
  for rootname in ('sourceRoot','configRoot','runtimeRoot','controlRoot','gateRoot','canaryRoot'):
   for fault in ('unknown','drift'):
    with self.subTest(root=rootname,fault=fault):
     m,s,co,io,j,nss,call=BundleTests().fixture();call();root=m.get(rootname,m['intervention'].get(rootname))
     if fault=='unknown':io.objects[root+'/unknown']={'unowned':True}
     else:io.objects[root]['ino']+=1
     empty={}
     for role in c.ROLES:
      r={'unit':m['units'][role],'invocation':'1'*32,'cgroupKey':[27,10]};j.append({'op':'GATE_RESERVATION','role':role,'reservation':r});empty[role]=dict(r,members=[],source='INDEPENDENT_PINNED_CGROUP_FD')
     before=copy.deepcopy(io.objects);log=j.rows();effects=copy.deepcopy(io.effects)
     with self.assertRaises(c.ContractHold):ExactRemover(m,j,io=io).remove_installed(scope_empty_evidence=empty)
     self.assertEqual(io.objects,before);self.assertEqual(io.effects,effects);self.assertEqual(j.rows(),log);self.assertFalse(any(r['op']=='REMOVE_INTENT' for r in j.rows()))
 def test_finalizer_account_missing_forged_callable_nss_drift_before_any_intent(self):
  for fault in ('missing','duplicate','receipt','callable','user','group','extra','uidlookup','gidlookup'):
   with self.subTest(fault=fault):
    m,io,j,nss,states,calls,f=FinalizerTests().fixture()
    if fault=='missing':j.data=[r for r in j.data if r['op']!='PRINCIPAL_RESERVED']
    elif fault=='duplicate':j.append(next(r for r in j.rows() if r['op']=='PRINCIPAL_RESERVED'))
    elif fault=='receipt':next(r for r in j.data if r['op']=='PRINCIPAL_RESERVED')['home']='/wrong'
    elif fault=='callable':f.account_remove=lambda receipt:None
    elif fault=='user':nss.user=pwd.struct_passwd((*nss.user[:6],'/bin/sh'))
    elif fault=='group':nss.group=grp.struct_group((*nss.group[:2],m['gid']+1,nss.group.gr_mem))
    elif fault=='extra':nss.group=grp.struct_group((*nss.group[:3],['unrelated']))
    elif fault=='uidlookup':nss.user_id=lambda uid:None
    elif fault=='gidlookup':nss.group_id=lambda gid:None
    before=copy.deepcopy(io.objects);log=j.rows();effects=copy.deepcopy(io.effects);commands=copy.deepcopy(nss.commands)
    with self.assertRaises(c.ContractHold):f.finish()
    self.assertEqual(io.objects,before);self.assertEqual(io.effects,effects);self.assertEqual(j.rows(),log);self.assertEqual(nss.commands,commands);self.assertFalse(any(r['op']=='FINALIZE_INTENT' for r in j.rows()));self.assertFalse(any(verb=='daemon-reload' for verb,unit in calls))

class ComposedCleanupRegressions(unittest.TestCase):
 def fixture(self,td):
  from deploy.ers_recovery import ensayo_runtime_cleanup as rc,ensayo_root_install as install,ensayo_control_program as program
  from deploy.ers_recovery.ensayo_privileged_io import identity
  m,s,co,io,j,nss,call=BundleTests().fixture();call();root=Path(td)/'runtime';root.mkdir(mode=0o700);lock=root/'ensayo.lock';lock.write_bytes(b'LOCAL_SYNTHETIC');lock.chmod(0o600);key=identity(root.lstat());io.objects[m['runtimeRoot']]=key
  next(r for r in j.data if r['op']=='INSTALL_CREATED' and r['path']==m['runtimeRoot'])['key']=copy.deepcopy(key)
  scopes={}
  for role in c.ROLES:
   r={'unit':m['units'][role],'invocation':'1'*32,'cgroupKey':[27,10]};j.append({'op':'GATE_RESERVATION','role':role,'reservation':r});e=dict(r,members=[],source='INDEPENDENT_PINNED_CGROUP_FD');scopes[role]=SimpleNamespace(empty=lambda e=e:copy.deepcopy(e))
  children=io.children;io.children=lambda p:sorted(q.name for q in root.iterdir()) if p==m['runtimeRoot'] else children(p)
  modules={'ensayo_runtime_cleanup':rc,'ensayo_root_install':install}
  return m,io,j,scopes,root,lock,rc,program,modules
 def test_real_wrapper_global_unknown_or_drift_no_runtime_or_known_deletions(self):
  for name in ('sourceRoot','configRoot','controlRoot','gateRoot','canaryRoot'):
   for fault in ('unknown','drift'):
    with self.subTest(root=name,fault=fault),tempfile.TemporaryDirectory() as td:
     m,io,j,scopes,root,lock,rc,program,modules=self.fixture(td);target=m.get(name,m['intervention'].get(name))
     if fault=='unknown':io.objects[target+'/unknown']={'unowned':True}
     else:io.objects[target]['ino']+=1
     realpath=Path;before=copy.deepcopy(io.objects);log=j.rows();effects=copy.deepcopy(io.effects)
     with patch.object(rc,'Path',side_effect=lambda p:root if str(p)==m['runtimeRoot'] else realpath(p)),patch.object(c,'ancestors',return_value=None),self.assertRaises(c.ContractHold):program.cleanup_files(m,j,scopes,lambda name:modules[name],io=io)
     self.assertTrue(lock.exists());self.assertEqual(lock.read_bytes(),b'LOCAL_SYNTHETIC');self.assertEqual(io.objects,before);self.assertEqual(j.rows(),log);self.assertEqual(io.effects,effects);self.assertFalse(any(r['op'] in ('RUNTIME_REMOVED','REMOVE_INTENT') for r in j.rows()))
 def test_real_wrapper_success_runtime_then_immutable_cleanup(self):
  with tempfile.TemporaryDirectory() as td:
   m,io,j,scopes,root,lock,rc,program,modules=self.fixture(td);realpath=Path
   with patch.object(rc,'Path',side_effect=lambda p:root if str(p)==m['runtimeRoot'] else realpath(p)),patch.object(c,'ancestors',return_value=None):out=program.cleanup_files(m,j,scopes,lambda name:modules[name],io=io)
   self.assertFalse(lock.exists());self.assertIn('ROOT_RESIDUALS',out['status']);ops=[r['op'] for r in j.rows()];self.assertLess(ops.index('RUNTIME_REMOVED'),ops.index('REMOVE_INTENT'));self.assertFalse(any(p.startswith(m['configRoot']+'/') for p in io.objects))

class PrincipalTests(unittest.TestCase):
 def fixture(self):
  m=manifest();m['groups']=[m['gid']];j=Journal(m);nss=NSS(m);return m,j,nss,PrincipalBootstrap(m,j,nss=nss,execute=nss.execute)
 def test_group_effect_ambiguous_no_user_or_retry(self):
  m,j,nss,p=self.fixture();nss.fail='groupadd'
  with self.assertRaises(RuntimeError):p.reserve()
  with self.assertRaises(c.ContractHold):p.reserve()
  self.assertEqual(len(nss.commands),1);self.assertEqual(j.rows()[-1]['op'],'PRINCIPAL_GROUP_INTENT')
 def test_collision_and_extra_groups_before_effect(self):
  for fault in ('name','groups'):
   m,j,nss,p=self.fixture()
   if fault=='name':nss.user=object()
   else:m['groups']=sorted(set([m['gid'],m['gid']+1]))
   with self.assertRaises(c.ContractHold):p.reserve()
   self.assertEqual(nss.commands,[])
 def test_original_account_retirement_no_force_no_home_actions(self):
  m,j,nss,p=self.fixture();r=p.reserve();out=PrincipalRetire(m,j,nss=nss,execute=nss.execute).remove(r);self.assertIsNone(nss.user);self.assertIsNone(nss.group);self.assertIn('NO_HOME',out['status']);self.assertTrue(all('--force' not in a and '--remove' not in a for a in nss.commands))
  with self.assertRaises(c.ContractHold):PrincipalRetire(m,j,nss=nss,execute=nss.execute).remove(r)
 def test_retire_drift_or_unbound_receipt_no_deletion(self):
  m,j,nss,p=self.fixture();r=p.reserve();nss.group=grp.struct_group(('ers-ensayo','x',m['gid'],['unrelated']))
  with self.assertRaises(c.ContractHold):PrincipalRetire(m,j,nss=nss,execute=nss.execute).remove(r)
  self.assertEqual(len(nss.commands),2)

class CapacityTests(unittest.TestCase):
 def fixture(self):
  m=manifest();j=Journal(m);data={'/proc/meminfo':'MemAvailable: 1000000 kB\n','/sys/fs/cgroup/system.slice/pids.max':'1024\n','/sys/fs/cgroup/system.slice/pids.current':'10\n','/sys/fs/cgroup/pids.max':'max\n','/sys/fs/cgroup/pids.current':'10\n'};runner=SimpleNamespace(invoke=lambda *a: (_ for _ in ()).throw(AssertionError('NO_MANAGER_EFFECT_ALLOWED')));return m,j,data,StartController(m,j,runner=runner,read=lambda p,cap:data[p])
 def test_capacity_both_ancestor_limits_and_memory(self):
  m,j,d,s=self.fixture();self.assertEqual(s.capacity()['pidsFreeMin'],1014);d['/sys/fs/cgroup/pids.max']='100';d['/sys/fs/cgroup/pids.current']='90'
  with self.assertRaises(c.ContractHold):s.launch()
  self.assertFalse(any(r['op']=='ROOT_LAUNCH_INTENT' for r in j.rows()))
 def test_malformed_missing_low_capacity_no_reload(self):
  for value in ('MemAvailable: 10 kB\n','MemAvailable: wrong\n','MemAvailable: 1000000 kB\nMemAvailable: 1000000 kB\n'):
   m,j,d,s=self.fixture();d['/proc/meminfo']=value
   with self.assertRaises(c.ContractHold):s.launch()
   self.assertEqual(len(j.rows()),1)
 def test_root_pidsmax_absence_only_root_exempt(self):
  m,j,d,s=self.fixture()
  def read(p,cap):
   if p=='/sys/fs/cgroup/pids.max':raise FileNotFoundError()
   return d[p]
  s.read=read;self.assertEqual(s.capacity()['pidsFreeMin'],1014)
  s.read=lambda p,cap: (_ for _ in ()).throw(PermissionError())
  with self.assertRaises(PermissionError):s.launch()

class StartupWiringTests(unittest.TestCase):
 def test_global_reload_then_cleanup_socket_then_supervisor_once(self):
  from deploy.ers_recovery import ensayo_start_controller as sc
  m,j,d,controller=CapacityTests().fixture();calls=[]
  def invoke(verb,unit=None):
   calls.append((verb,unit))
   if verb=='show':return {'Id':unit,'User':'0','SubState':'running','MainPID':'999'}
   return {'status':'SYNTHETIC_ONLY'}
  controller.runner=SimpleNamespace(invoke=invoke);fakepath=SimpleNamespace(__truediv__=lambda a,b:a)
  class FakePath:
   def __truediv__(self,other):return self
   def lstat(self):return SimpleNamespace(st_mode=stat.S_IFSOCK|0o600,st_uid=0)
  with patch.object(sc,'Path',return_value=FakePath()):out=controller.launch()
  self.assertEqual(calls[0],('daemon-reload',None));self.assertLess(calls.index(('start',m['intervention']['cleanupUnit'])),calls.index(('start',m['intervention']['supervisorUnit'])));self.assertIn('NOT_OS_GATE',out['status']);self.assertEqual(j.rows()[1]['op'],'ROOT_LAUNCH_INTENT')
  count=len(calls)
  with self.assertRaises(c.ContractHold):controller.launch()
  self.assertEqual(len(calls),count)
 def test_cleanup_bad_socket_no_supervisor_request(self):
  from deploy.ers_recovery import ensayo_start_controller as sc
  m,j,d,controller=CapacityTests().fixture();calls=[]
  def invoke(verb,unit=None):
   calls.append((verb,unit));return {'Id':unit,'User':'0','SubState':'running','MainPID':'999'}
  class FakePath:
   def __truediv__(self,other):return self
   def lstat(self):return SimpleNamespace(st_mode=stat.S_IFREG|0o600,st_uid=0)
  controller.runner=SimpleNamespace(invoke=invoke)
  with patch.object(sc,'Path',return_value=FakePath()),self.assertRaisesRegex(c.ContractHold,'ROOT_START_CLEANUP_SOCKET_CUSTODY'):controller.launch()
  self.assertNotIn(('start',m['intervention']['supervisorUnit']),calls);self.assertEqual(j.rows()[-1]['op'],'ROOT_LAUNCH_INTENT')

class RootConfigTests(unittest.TestCase):
 def fixture(self):
  from deploy.ers_recovery import ensayo_control_program as cp
  m,s,co,io,j,nss,call=BundleTests().fixture();call();data={p:b for op,p,b in io.effects if op=='create'};return cp,m,data
 def test_actual_config_pin_consumer_matches_bootstrap_producer(self):
  cp,m,data=self.fixture();root=m['intervention']['controlRoot'];real_import=__import__('importlib').import_module
  def importer(name):
   if name=='_ers_root_control.ensayo_os':return c
   if name=='_ers_root_control.ensayo_intervention':return real_import('deploy.ers_recovery.ensayo_intervention')
   raise AssertionError('UNEXPECTED_MODULE_IMPORT')
  with patch.object(cp,'_read',side_effect=lambda p,cap,mode:data[str(p)]),patch.object(cp,'__file__',root+'/ensayo_control_program.py'),patch.object(cp.importlib,'import_module',side_effect=importer),patch.object(cp.os,'getuid',return_value=0),patch.object(cp.os,'geteuid',return_value=0):cfg,contract=cp.load(root+'/supervisor.json')
  self.assertEqual(cfg['manifest'],m);self.assertIs(contract,c)
 def test_altered_control_pin_fails_before_import(self):
  cp,m,data=self.fixture();root=m['intervention']['controlRoot'];data[root+'/ensayo_root_install.py']+=b'\n# modified'
  with patch.object(cp,'_read',side_effect=lambda p,cap,mode:data[str(p)]),patch.object(cp.importlib,'import_module',side_effect=AssertionError('NO_UNVERIFIED_IMPORT')),self.assertRaisesRegex(ValueError,'ROOT_CONTROL_SOURCE_PIN'):cp.load(root+'/supervisor.json')
 def test_altered_unit_or_bootstrap_receipt_fails_closed(self):
  for fault in ('unit','receipt'):
   cp,m,data=self.fixture();root=m['intervention']['controlRoot'];path='/etc/systemd/system/'+m['units']['watchdog'] if fault=='unit' else root+'/bootstrap-receipt.json';data[path]+=b' '
   def importer(name):return c if name.endswith('.ensayo_os') else __import__('deploy.ers_recovery.ensayo_intervention',fromlist=['*'])
   with patch.object(cp,'_read',side_effect=lambda p,cap,mode:data[str(p)]),patch.object(cp,'__file__',root+'/ensayo_control_program.py'),patch.object(cp.importlib,'import_module',side_effect=importer),self.assertRaises(ValueError):cp.load(root+'/supervisor.json')

class RuntimeTests(unittest.TestCase):
 def fixture(self,td):
  from deploy.ers_recovery import ensayo_runtime_cleanup as rc
  from deploy.ers_recovery.ensayo_privileged_io import identity
  m=manifest();p=Path(td)/'runtime';p.mkdir(mode=0o700);realpath=Path
  mapper=lambda path: p if str(path)==m['runtimeRoot'] else realpath(path)
  with patch.object(rc,'Path',side_effect=mapper),patch.object(c,'ancestors',return_value=None):r=rc.PinnedRuntime(m,identity(p.lstat()))
  return m,p,r
 def test_exact_entries_removed_with_repeated_death_check(self):
  with tempfile.TemporaryDirectory() as td:
   m,p,r=self.fixture(td);calls=[];j=Journal(m)
   try:
    for name in ('ensayo.lock','journal.lock'):(p/name).write_bytes(b'LOCAL_SYNTHETIC');(p/name).chmod(0o600)
    out=r.remove(j,death_check=lambda:calls.append('INDEPENDENT_READ'));self.assertEqual(list(p.iterdir()),[]);self.assertEqual(len(calls),3);self.assertIn('DIRECTORY_RETAINED',out['status'])
   finally:r.close()
 def test_unknown_symlink_or_failed_death_never_removed(self):
  for fault in ('unknown','symlink','death'):
   with tempfile.TemporaryDirectory() as td:
    m,p,r=self.fixture(td);name='unknown' if fault=='unknown' else 'ensayo.lock';target=p/name
    if fault=='symlink':target.symlink_to('/does-not-exist')
    else:target.write_bytes(b'LOCAL');target.chmod(0o600)
    def death():
     if fault=='death':raise c.ContractHold('SCOPE_FD_ORIGINAL_UNREADABLE_NO_DEATH_PROOF')
    try:
     with self.assertRaises(c.ContractHold):r.remove(Journal(m),death_check=death)
     self.assertTrue(target.exists() or target.is_symlink())
    finally:r.close()

class FinalizerTests(unittest.TestCase):
 def fixture(self):
  m,source,control,io,j,nss,call=BundleTests().fixture();call()
  for role in c.ROLES:
   r={'unit':m['units'][role],'invocation':'1'*32,'cgroupKey':[27,10]};j.append({'op':'GATE_RESERVATION','role':role,'reservation':r})
  empty={r:{'unit':m['units'][r],'invocation':'1'*32,'cgroupKey':[27,10],'members':[],'source':'INDEPENDENT_PINNED_CGROUP_FD'} for r in c.ROLES};ExactRemover(m,j,io=io).remove_installed(scope_empty_evidence=empty)
  for index,role in enumerate(('supervisor','cleanup')):j.append({'op':'ROOT_CUSTODIAN_ORIGINAL','role':role,'identity':{'pid':100+index,'start':'123','boot':'b'*36},'invocation':str(index+1)*32})
  j.append({'op':'ROOT_CONTROL_COMPLETE','status':'HOLDER_OBJECTS_REMOVED_ROOT_RESIDUALS_REQUIRE_FINALIZER'})
  states={m['intervention'][r+'Unit']:{'InvocationID':str(index+1)*32,'MainPID':'0','ControlPID':'0','ActiveState':'inactive'} for index,r in enumerate(('supervisor','cleanup'))};calls=[]
  def manager(verb,unit=None):
   calls.append((verb,unit));return copy.deepcopy(states[unit]) if verb=='show' else {'status':'SYNTHETIC_ONLY'}
  def absent(pid):raise FileNotFoundError()
  retire=PrincipalRetire(m,j,nss=nss,execute=nss.execute)
  f=Finalizer(m,j,io=io,manager=SimpleNamespace(invoke=manager),identityfn=absent,account_remove=retire.remove)
  return m,io,j,nss,states,calls,f
 def test_complete_original_lifecycle_removes_exact_roots_units_accounts(self):
  m,io,j,nss,states,calls,f=self.fixture();out=f.finish();self.assertFalse(any('/etc/systemd/system/' in p for p in io.objects));self.assertNotIn(m['sourceRoot'],io.objects);self.assertNotIn(m['runtimeRoot'],io.objects);self.assertIn(m['intervention']['controlRoot']+'/lifecycle.jsonl',io.objects);self.assertIsNone(nss.user);self.assertIsNone(nss.group);self.assertEqual(calls[-1],('daemon-reload',None));self.assertIn('CONTROL_RETENTION',out['status'])
  with self.assertRaises(c.ContractHold):f.finish()
 def test_live_or_reused_root_unit_or_pid_blocks_all_removal(self):
  for fault in ('unit','pid','invocation'):
   m,io,j,nss,states,calls,f=self.fixture();before=copy.deepcopy(io.objects)
   if fault=='unit':states[m['intervention']['cleanupUnit']]['MainPID']='999'
   elif fault=='invocation':states[m['intervention']['cleanupUnit']]['InvocationID']='f'*32
   else:f.identity=lambda pid:{'pid':pid,'start':'REUSED'}
   with self.assertRaises(c.ContractHold):f.finish()
   self.assertEqual(io.objects,before);self.assertEqual(len(nss.commands),2)
 def test_unknown_residual_never_recursive_removed(self):
  m,io,j,nss,states,calls,f=self.fixture();io.objects[m['runtimeRoot']+'/unexpected']={'unknown':True}
  before=copy.deepcopy(io.objects)
  with self.assertRaisesRegex(c.ContractHold,'ROOT_FINALIZER_UNKNOWN_ROOT_CONTENT'):f.finish()
  self.assertEqual(io.objects,before)
  self.assertIn(m['runtimeRoot']+'/unexpected',io.objects);self.assertEqual(len(nss.commands),2)
 def test_missing_account_custodian_blocks_before_first_finalizer_intent(self):
  m,io,j,nss,states,calls,f=self.fixture();f.account_remove=None;before=copy.deepcopy(io.objects)
  with self.assertRaises(c.ContractHold):f.finish()
  self.assertEqual(io.objects,before);self.assertFalse(any(r['op']=='FINALIZE_INTENT' for r in j.rows()))

class RootJournalTests(unittest.TestCase):
 def test_actual_append_fsync_and_partial_log_hold_with_fake_root_metadata(self):
  from deploy.ers_recovery import ensayo_root_journal as rj
  realstat=os.stat;realfstat=os.fstat;reallstat=Path.lstat
  def root(s):
   attrs=('st_dev','st_ino','st_uid','st_gid','st_mode','st_nlink','st_size','st_mtime_ns','st_ctime_ns');d={k:getattr(s,k) for k in attrs};d['st_uid']=0;return SimpleNamespace(**d)
  with tempfile.TemporaryDirectory() as td:
   m=manifest();p=Path(td)/'control';p.mkdir(mode=0o700)
   with patch.object(rj,'Path',side_effect=lambda path:p),patch.object(c,'ancestors',return_value=None),patch.object(Path,'lstat',side_effect=lambda *a,**kw:root(reallstat(p))),patch.object(os,'fstat',side_effect=lambda fd:root(realfstat(fd))),patch.object(os,'stat',side_effect=lambda *a,**kw:root(realstat(*a,**kw))):
    j=rj.RootJournal(m,create=True)
    try:
     j.append({'op':'LOCAL_SYNTHETIC_ACK','bound':True});self.assertEqual(len(j.rows()),2);os.write(j.fd,b'{PARTIAL')
     with self.assertRaises(c.ContractHold):j.rows()
    finally:j.close()

if __name__=='__main__':unittest.main()
