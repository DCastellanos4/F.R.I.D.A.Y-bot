"""LOCAL whole-cycle fakes only: no HOST, SSH, root, accounts or systemctl.
Uses actual native allocator, bootstrap, StartController, exact remover,
PrincipalRetire, Finalizer, Retirement.prepare/freeze behind fake NSS/IO/manager.
"""
import copy,hashlib,json,stat,unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
from test_ensayo_os import ROOT
from test_ensayo_privileged_lifecycle import NSS
from test_ensayo_retirement import IO
from deploy.ers_recovery import ensayo_os as c,ensayo_retirement as retirement,ensayo_start_controller as starter
from deploy.ers_recovery.ensayo_system_allocation import Allocation
from deploy.ers_recovery.ensayo_one_shot import OneShot,CAPS,POLICY,SCOPE,MATERIAL_NAMES,validate,load_prepared,RealEffects,BudgetRunner
from deploy.ers_recovery.ensayo_bootstrap import execute_prepared_bundle,CONTROL
from deploy.ers_recovery.ensayo_retirement import EXECUTOR_NAMES
from deploy.ers_recovery.ensayo_root_install import ExactRemover
from deploy.ers_recovery.ensayo_principal_retire import PrincipalRetire
from deploy.ers_recovery.ensayo_finalizer import Finalizer
from deploy.ers_recovery.ensayo_start_controller import StartController
PLAN=Path(__file__).with_name('fixtures')/'ensayo-one-shot-plan.json'

def inputs():return json.loads(PLAN.read_text()),{n:(ROOT/n).read_bytes() for n in MATERIAL_NAMES}
class Log:
 def __init__(self,io,path,rows):self.io=io;self.path=path;self.closed=False;self.io.create(path,b''.join(c.encode(r)+b'\n' for r in rows),uid=0,gid=0,mode=0o600)
 def check(self):
  if self.closed:raise c.ContractHold('FAKE_ORIGINAL_FD_CLOSED')
 def rows(self):self.check();return [c.load_json(v) for v in self.io.data[self.path].splitlines()]
 def append(self,row):self.check();self.io.replace_data(self.path,self.io.data[self.path]+c.encode(row)+b'\n')
 def close(self):self.closed=True
 def seal(self):self.check();rows=self.rows();key=self.io.snapshot(self.path);self.close();return rows,key
class ExistingLog(Log):
 def __init__(self,io,path):self.io=io;self.path=path;self.closed=False
class FakeEffects:
 def __init__(self,p,materials,*,fail=None):self.p=p;self.materials=materials;self.io=IO();self.events=[];self.fail=fail;self.seed=None;self.j=None;self.nss=None;self.m=None;self.manager_calls=[];self.prepared=None
 def stage(self,name):
  self.events.append(name)
  if self.fail==name:raise c.ContractHold('LOCAL_FAKE_STAGE_HOLD')
 def preflight(self):self.stage('preflight')
 def allocate(self):
  self.stage('allocate');m=dict(self.p['allocationPlan']['manifestTemplate'],uid=12345,gid=12346,groups=[12346]);self.nss=NSS(m);path='/var/lib/ers-ensayo-bootstrap-'+m['epoch']+'.jsonl';self.seed=Log(self.io,path,[{'op':'ROOT_ALLOCATION_BEGIN','planDigest':c.digest(self.p['allocationPlan'])}]);self.a=Allocation(self.p['allocationPlan'],self.seed,nss=self.nss,execute=self.nss.execute);out=self.a.allocate();self.m=out['manifest'];return out
 def install(self,m):
  self.stage('install');self.prepared=execute_prepared_bundle(m,{n:self.materials[n] for n in c.STAGING_SOURCES},{n:self.materials[n] for n in CONTROL},retirement_bytes={n:self.materials[n] for n in EXECUTOR_NAMES},account_disposition='REMOVE_IF_EXACT_UNUSED',allocation=self.a,io_factory=lambda m:self.io);self.j=ExistingLog(self.io,m['intervention']['controlRoot']+'/lifecycle.jsonl');return self.prepared
 def invoke(self,verb,unit=None):
  self.manager_calls.append((verb,unit));m=self.m;i=m['intervention']
  if verb!='show':return {'status':'LOCAL_FAKE_TRANSPORT_ONLY'}
  role=next(r for r in ('supervisor','cleanup') if i[r+'Unit']==unit);index=('supervisor','cleanup').index(role)
  if '/etc/systemd/system/'+unit not in self.io.objects:return {'Id':unit,'LoadState':'not-found','FragmentPath':'','DropInPaths':'','InvocationID':'','ActiveState':'inactive','MainPID':'0','ControlPID':'0'}
  if not self.j or not any(r['op']=='ROOT_CONTROL_COMPLETE' for r in self.j.rows()):return {'Id':unit,'User':'0','SubState':'running','MainPID':'101'}
  return {'Id':unit,'InvocationID':str(index+1)*32,'MainPID':'0','ControlPID':'0','ActiveState':'inactive'}
 def start(self,m):
  self.stage('start');read=lambda p,cap:'MemAvailable: 1000000 kB\n' if p=='/proc/meminfo' else ('max\n' if p.endswith('pids.max') else '10\n')
  class FakePath:
   def __init__(self,p):self.p=p
   def __truediv__(self,p):return self
   def lstat(self):return SimpleNamespace(st_mode=stat.S_IFSOCK|0o600,st_uid=0)
  with patch.object(starter,'Path',FakePath):StartController(m,self.j,runner=SimpleNamespace(invoke=self.invoke),read=read).launch()
 def await_closeout(self,m):
  self.stage('await')
  for index,role in enumerate(c.ROLES):self.j.append({'op':'GATE_RESERVATION','role':role,'reservation':{'unit':m['units'][role],'invocation':str(index+1)*32,'cgroupKey':[27,10+index]}})
  empty={role:{'unit':m['units'][role],'invocation':str(index+1)*32,'cgroupKey':[27,10+index],'members':[],'source':'INDEPENDENT_PINNED_CGROUP_FD'} for index,role in enumerate(c.ROLES)}
  ExactRemover(m,self.j,io=self.io).remove_installed(scope_empty_evidence=empty)
  for index,role in enumerate(('supervisor','cleanup')):self.j.append({'op':'ROOT_CUSTODIAN_ORIGINAL','role':role,'identity':{'pid':100+index,'start':'123','boot':'b'*36},'invocation':str(index+1)*32})
  self.j.append({'op':'ROOT_CONTROL_COMPLETE','status':'HOLDER_OBJECTS_REMOVED_ROOT_RESIDUALS_REQUIRE_FINALIZER'})
 def finalize(self,m,prepared):
  self.stage('finalize')
  def absent(pid):raise FileNotFoundError()
  manager=SimpleNamespace(invoke=self.invoke);r=retirement.Retirement(m,io=self.io,runner=manager,nss=self.nss,identityfn=absent,clock=lambda:100000);account=PrincipalRetire(m,self.j,nss=self.nss,execute=self.nss.execute);f=Finalizer(m,self.j,io=self.io,manager=manager,identityfn=absent,account_remove=account.remove)
  with patch.object(retirement,'__file__',prepared['retirementExecutorRoot']+'/ensayo_retirement.py'):
   out=f.finish_and_freeze(r,seed_original=prepared['seedOriginal'],not_before=186520,executor_pins=prepared['retirementExecutorPins'])
  out['closedAtUnix']=100001;return out
 def close_handles(self):
  self.events.append('close_handles')
  for h in (self.seed,self.j):
   if h is not None and not h.closed:h.close()

class OneShotTests(unittest.TestCase):
 def fixture(self,fail=None):p,m=inputs();return p,m,OneShot(p,m),FakeEffects(p,m,fail=fail)
 def test_pending_authority_and_construction_are_no_effects(self):
  p,m,s,f=self.fixture();out=s.run(effects=f);self.assertEqual(out['status'],'PENDING_AUTHORITY');self.assertEqual(f.events,[]);self.assertFalse(s.used)
 def test_boolean_or_binding_is_not_approval_and_refusal_no_effect(self):
  p,m,s,f=self.fixture()
  for value in (True,False,{'approved_binding':'anything'}):
   with self.assertRaises(c.ContractHold):s.run(authority_check=lambda p:value,effects=f)
  def refuse(p):raise c.ContractHold('FAKE_NO_ORIGINAL_AUTHORITY')
  with self.assertRaises(c.ContractHold):s.run(authority_check=refuse,effects=f)
  self.assertEqual(f.events,[]);self.assertFalse(s.used)
 def test_whole_fake_cycle_exact_budget_order_account_closeout_and_retained_ticket(self):
  p,m,s,f=self.fixture();out=s.run(authority_check=lambda p:None,effects=f)
  self.assertEqual(out['status'],'CLOSED_FOLLOWTHROUGH_HANDOFF_REQUIRED_NOT_SCHEDULED');self.assertFalse(out['productionAdmission']);self.assertEqual(f.events,['preflight','allocate','install','start','await','finalize','close_handles']);self.assertIsNone(f.nss.user);self.assertIsNone(f.nss.group)
  self.assertEqual([v for v in f.manager_calls if v[0]!='show'],[('daemon-reload',None),('start',f.m['intervention']['cleanupUnit']),('start',f.m['intervention']['supervisorUnit']),('daemon-reload',None)])
  ticket=out['closed']['retirement']['ticket'];self.assertIn(f.m['intervention']['controlRoot'],f.io.objects);self.assertIn('/var/lib/ers-ensayo-bootstrap-'+f.m['epoch']+'.jsonl',f.io.objects);self.assertIn(ticket['executorRootRetained'],f.io.objects);self.assertIn('/var/lib/ers-ensayo-retirement/'+f.m['epoch']+'/ticket.json',f.io.objects);self.assertEqual(out['followthrough']['scope'],POLICY['followup']);self.assertGreaterEqual(out['followthrough']['atUnix'],out['closed']['closedAtUnix']+86400);self.assertNotIn('approved_binding',str(out))
  self.assertEqual(p['budgetTotals']['memoryMaxBytes'],134217728);self.assertTrue(f.seed.closed);self.assertTrue(f.j.closed)
  count=len(f.io.effects)
  with self.assertRaises(c.ContractHold):s.run(authority_check=lambda p:None,effects=f)
  self.assertEqual(len(f.io.effects),count)
 def test_each_stage_failure_stops_remaining_cycle_no_automatic_rollback(self):
  stages=['preflight','allocate','install','start','await','finalize']
  for i,stage in enumerate(stages):
   p,m,s,f=self.fixture(stage);out=s.run(authority_check=lambda p:None,effects=f)
   self.assertEqual(out['status'],'HOLD_NO_RETRY_NO_AUTOMATIC_ROLLBACK');self.assertEqual(f.events,stages[:i+1]+['close_handles']);self.assertEqual(out['residualsMayExist'],stage!='preflight');self.assertFalse(any(argv[0].endswith(('userdel','groupdel')) for argv in (f.nss.commands if f.nss else [])))
 def test_material_pin_drift_and_budgets_policy_mismatch_before_any_effect(self):
  for fault in ('source','budget','policy','status','principal'):
   p,m=inputs()
   if fault=='source':m['ensayo_os.py']+=b'changed'
   elif fault=='budget':p['allocationPlan']['manifestTemplate']['intervention']['budgets']['cleanup']['memoryMaxBytes']=67108864
   elif fault=='policy':p['policy']['retire']='AUTOMATIC_DELETE'
   elif fault=='status':p['status']='APPROVED'
   else:p['allocationPlan']['manifestTemplate']['uid']=12345
   with self.assertRaises(c.ContractHold):OneShot(p,m)
 def test_whole_cycle_unknown_content_at_finalize_preserves_account_and_unit_files(self):
  p,m,s,f=self.fixture();real=f.finalize
  def changed(manifest,prepared):
   f.io.objects[manifest['configRoot']+'/UNKNOWN']={'unknown':True};return real(manifest,prepared)
  f.finalize=changed;out=s.run(authority_check=lambda p:None,effects=f);self.assertEqual(out['failedStage'],'FINALIZE_FREEZE');self.assertIsNotNone(f.nss.user);self.assertTrue(all('/etc/systemd/system/'+u in f.io.objects for u in f.m['units'].values()));self.assertFalse(any(op=='remove' and '/etc/systemd/system/' in path for op,path,b in f.io.effects))
 def test_closed_ticket_or_retention_tamper_never_schedules_or_deletes(self):
  for kind in ('digest','time'):
   p,m,s,f=self.fixture();real=f.finalize
   def changed(manifest,prepared):
    out=real(manifest,prepared)
    if kind=='digest':out['retirement']['ticketDigest']='0'*64
    else:out['closedAtUnix']=200000
    return out
   f.finalize=changed;out=s.run(authority_check=lambda p:None,effects=f);self.assertEqual(out['failedStage'],'FINALIZE_FREEZE');self.assertIn(f.m['intervention']['controlRoot'],f.io.objects)
 def test_real_preflight_nonroot_no_commands(self):
  p,m=inputs();io=RealEffects(p,m)
  with patch('deploy.ers_recovery.ensayo_one_shot.os.getuid',return_value=1000),patch.object(io,'binaries',side_effect=AssertionError('NO_READS')):
   with self.assertRaises(c.ContractHold):io.preflight()
 def test_original_handle_close_does_not_probe_or_close_reused_fd(self):
  p,m=inputs();io=RealEffects(p,m);h=SimpleNamespace(closed=True,fd=123,close=lambda:(_ for _ in ()).throw(AssertionError('DO_NOT_CLOSE_REUSED_NUMBER')));io.seed=h;io.journal=h;io.close_handles()
 def test_manager_command_cap_blocks_before_spawn(self):
  p,m=inputs();manifest=dict(p['allocationPlan']['manifestTemplate'],uid=1,gid=1,groups=[1]);r=BudgetRunner(manifest);r.commands=CAPS['externalManagerCommandsMax']
  with patch.object(r,'binary_custody',side_effect=AssertionError('NO_BINARY_READS')),self.assertRaises(c.ContractHold):r.invoke('show',manifest['units']['controller'])
 def test_material_loader_pending_with_exact_hash(self):
  p,m=inputs();sha=hashlib.sha256(PLAN.read_bytes()).hexdigest();s=load_prepared(str(PLAN.resolve()),str(ROOT.resolve()),expected_plan_sha256=sha);self.assertEqual(s.run()['status'],'PENDING_AUTHORITY')
  with self.assertRaises(c.ContractHold):load_prepared(str(PLAN.resolve()),str(ROOT.resolve()),expected_plan_sha256='0'*64)
 def test_account_command_ambiguous_after_effect_preserves_seed_no_install(self):
  p,m,s,f=self.fixture();real=f.allocate
  def ambiguous():
   real();raise RuntimeError('FAKE_COMMAND_RESULT_UNCERTAIN')
  f.allocate=ambiguous;out=s.run(authority_check=lambda p:None,effects=f);self.assertEqual(out['failedStage'],'ALLOCATE_FREEZE');self.assertIsNotNone(f.nss.user);self.assertNotIn('install',f.events);self.assertEqual(len(f.nss.commands),2);self.assertIn(f.seed.path,f.io.objects)
 def test_install_partial_failure_preserves_account_and_original_seed(self):
  p,m,s,f=self.fixture();f.io.fail=p['allocationPlan']['manifestTemplate']['sourceRoot']+'/lease.py';out=s.run(authority_check=lambda p:None,effects=f);self.assertEqual(out['failedStage'],'INSTALL');self.assertIsNotNone(f.nss.user);self.assertEqual(len(f.nss.commands),2);self.assertIn(f.seed.path,f.io.objects);self.assertNotIn('start',f.events);self.assertFalse(any(op=='remove' for op,path,data in f.io.effects))
 def test_start_transport_failure_after_reload_no_retry_no_extra_reload(self):
  p,m,s,f=self.fixture();real=f.invoke
  def transport(verb,unit=None):
   out=real(verb,unit)
   if verb=='start':raise RuntimeError('FAKE_AMBIGUOUS_START')
   return out
  f.invoke=transport;out=s.run(authority_check=lambda p:None,effects=f);self.assertEqual(out['failedStage'],'START');self.assertEqual(sum(v[0]=='daemon-reload' for v in f.manager_calls),1);self.assertNotIn('await',f.events);self.assertIsNotNone(f.nss.user)
 def test_freeze_failure_after_finalizer_preserves_control_seed_no_followup_claim(self):
  p,m,s,f=self.fixture();real=f.finalize
  def freeze_fail(manifest,prepared):
   with patch.object(retirement.Retirement,'freeze',side_effect=c.ContractHold('FAKE_FREEZE_POST_EFFECT_HOLD')):return real(manifest,prepared)
  f.finalize=freeze_fail;out=s.run(authority_check=lambda p:None,effects=f);self.assertEqual(out['failedStage'],'FINALIZE_FREEZE');self.assertIsNone(f.nss.user);self.assertIn(f.m['intervention']['controlRoot'],f.io.objects);self.assertIn(f.seed.path,f.io.objects);self.assertNotIn('atUnix',out)
 def test_import_definitions_do_not_execute_effects(self):
  import importlib
  import deploy.ers_recovery.ensayo_one_shot as module
  with patch.object(module.os,'open',side_effect=AssertionError('NO_OPEN')),patch.object(module.os,'geteuid',side_effect=AssertionError('NO_ROOT_CHECK')),patch.object(module.time,'sleep',side_effect=AssertionError('NO_WAIT')):importlib.reload(module)
 def test_close_failure_is_reported_as_hold_not_success_or_raw_error(self):
  p,m,s,f=self.fixture()
  def fail():raise OSError('PRIVATE_FAKE_DIAGNOSTIC')
  f.close_handles=fail;out=s.run(authority_check=lambda p:None,effects=f);self.assertEqual(out['failedStage'],'HANDLE_CLOSE_UNVERIFIED');self.assertNotIn('PRIVATE_FAKE',str(out))
 def test_real_wait_reused_original_identity_holds_without_finalization(self):
  from deploy.ers_recovery import ensayo_one_shot as module
  p,materials=inputs();io=module.RealEffects(p,materials);m=dict(p['allocationPlan']['manifestTemplate'],uid=12345,gid=12346,groups=[12346]);actors=[{'op':'ROOT_CUSTODIAN_ORIGINAL','role':r,'identity':{'pid':index+100},'invocation':str(index+1)*32} for index,r in enumerate(('supervisor','cleanup'))];rows=actors+[{'op':'ROOT_CONTROL_COMPLETE','status':'HOLDER_OBJECTS_REMOVED_ROOT_RESIDUALS_REQUIRE_FINALIZER'}];io.journal=SimpleNamespace(rows=lambda:rows);io.runner=SimpleNamespace(invoke=lambda verb,unit:{'InvocationID':'1'*32,'ActiveState':'inactive','MainPID':'0','ControlPID':'0'})
  with patch.object(module,'identity',return_value={'pid':100}),self.assertRaises(c.ContractHold):io.await_closeout(m)
 def test_hostkey_preflight_reads_only_public_fixed_path_and_rejects_mismatch(self):
  from deploy.ers_recovery import ensayo_one_shot as module
  import base64
  p,m=inputs();io=module.RealEffects(p,m);blob=b'\x00\x00\x00\x0bssh-ed25519\x00\x00\x00\x20'+b'F'*32;raw=b'ssh-ed25519 '+base64.b64encode(blob)+b' comment'
  with patch.object(module.c,'ancestors'),patch.object(module.c,'bounded_file',return_value=(raw,{})) as read,self.assertRaises(c.ContractHold):io.hostkey()
  self.assertEqual(str(read.call_args.args[0]),'/etc/ssh/ssh_host_ed25519_key.pub')
  for raw in (b'not-a-key',b'ssh-rsa AAAA',b'ssh-ed25519 !!!',b'ssh-ed25519 AAAA'):
   with patch.object(module.c,'ancestors'),patch.object(module.c,'bounded_file',return_value=(raw,{})),self.assertRaises(c.ContractHold):io.hostkey()
if __name__=='__main__':unittest.main()
