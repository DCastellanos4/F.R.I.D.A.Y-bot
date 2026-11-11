import copy,hashlib,os,tempfile,unittest
from pathlib import Path
from test_ensayo_os import manifest,ROOT,projections
from deploy.ers_recovery import ensayo_os as c
from deploy.ers_recovery import ensayo_intervention as policy
from deploy.ers_recovery.ensayo_root_transaction import FixtureRootBackend,RootTransactionFixture,CLASS,Crash
class Harness:
 def __init__(self):
  self.root=tempfile.TemporaryDirectory(prefix='ers-ensayo-rootfixture-');self.control=tempfile.TemporaryDirectory(prefix='ers-ensayo-control-');self.m=manifest();self.b=FixtureRootBackend(self.root.name,self.m);self.t=RootTransactionFixture(self.b,self.control.name);self.sources={n:(ROOT/n).read_bytes() for n in c.STAGING_SOURCES}
 def install(self,decision='REMOVE_IF_EXACT_UNUSED'):
  return self.t.install(self.sources,{'supervisor':b'# PUBLIC SYNTHETIC SUPERVISOR NOT EXECUTED\n','cleanup':b'# PUBLIC SYNTHETIC CLEANUP NOT EXECUTED\n'},account_disposition=decision)
 def capacity(self):return {'class':CLASS,'memoryAvailableBytes':536870912,'parentPidsFree':128}
 def close(self):self.t.close();self.b.close();self.root.cleanup();self.control.cleanup()
 def __enter__(self):return self
 def __exit__(self,*args):self.close()
class Contract(unittest.TestCase):
 def test_closed_schema_all_consumers_cpu_swap_canary(self):
  m=manifest();o=c.render_staging(m)
  for role,text in o['sources'].items():
   self.assertIn('CPUQuota=20%',text);self.assertIn('MemorySwapMax=0',text);self.assertIn(m['intervention']['canaryRoot'],text)
  self.assertFalse(c.match_staging(m,projections(m))['productionAdmission'])
  for fault in ('cpu','swap','canary','status','schema'):
   x=copy.deepcopy(m)
   if fault=='cpu':x['resources']['controller']['cpuQuotaPercent']=0
   if fault=='swap':x['resources']['controller']['memorySwapMaxBytes']=1
   if fault=='canary':x['intervention']['canaryRoot']='/home/ubuntu/.pm2'
   if fault=='status':x['intervention']['status']='APPROVED'
   if fault=='schema':x['schema']=1
   for consumer in (c.validate_staging,c.render_staging,c.staging_launch_plan,lambda v:c.match_staging(v,{})):
    with self.assertRaises(c.ContractHold):consumer(x)
 def test_supervisor_cleanup_budget_timing_and_global_reload_not_scoped(self):
  m=manifest();i=m['intervention'];pins={r:{'path':i['controlRoot']+'/'+r+'.py','sha256':'a'*64} for r in ('supervisor','cleanup')};o=policy.render_control_units(m,pins['supervisor'],pins['cleanup'])
  self.assertIn('RuntimeMaxSec=60',o['units']['supervisor']);self.assertIn('RuntimeMaxSec=10',o['units']['cleanup']);self.assertIn('MemoryMax=33554432',o['units']['supervisor']);self.assertIn('CPUQuota=10%',o['units']['cleanup']);self.assertIn('OnActiveSec=60s',o['cleanupTimer']);self.assertIn(i['cleanupUnit'],o['cleanupTimer']);self.assertEqual(o['rootExecution'],'NOT_IMPLEMENTED_NO_HOST_BACKEND');self.assertEqual(i['daemonReloadScope'],'GLOBAL_MANAGER_RELOAD_REQUIRES_EXPLICIT_APPROVAL')
 def test_manager_match_checks_cpu_swap_and_canary(self):
  m=manifest()
  for k,v in [('CPUQuotaPercent',90),('MemorySwapMax',1024),('InaccessiblePaths',[])]:
   o=projections(m);o['controller']['manager'][k]=v
   with self.assertRaises(c.ContractHold):c.match_staging(m,o)
 def test_account_headroom_retention_no_authority_toggle(self):
  m=manifest()
  for field,value in [('accountDisposition','LEAVE_SILENTLY'),('headroom',{'status':'MEASURED_APPROVED'}),('retention',{'seconds':86400,'status':'APPROVED'})]:
   x=copy.deepcopy(m);x['intervention'][field]=value
   with self.assertRaises(c.ContractHold):c.validate_staging(x)
class Transactions(unittest.TestCase):
 def test_full_fixture_transaction_and_cleanup_not_os(self):
  with Harness() as h:
   h.install();out=h.t.start_and_validate(h.capacity());self.assertEqual(out['kernelContainment'],'UNVERIFIED');self.assertFalse(out['productionAdmission']);self.assertTrue(h.b.account)
   self.assertTrue(all(r['result']['class']==CLASS for r in h.t.reconcile() if r['action']=='PROBE'));result=h.t.cleanup();self.assertFalse(result['accountResidual']);self.assertEqual(h.b.objects,{});self.assertEqual(h.b.account,None)
 def test_explicit_account_residual_is_reported(self):
  with Harness() as h:
   h.install('RETAIN_EXPLICIT_OWNER_ACCEPTED');h.t.start_and_validate(h.capacity());out=h.t.cleanup();self.assertTrue(out['accountResidual']);self.assertTrue(any(r['action']=='RESIDUAL_DISCLOSED' for r in h.t.reconcile()))
 def test_missing_account_decision_before_first_effect(self):
  with Harness() as h:
   with self.assertRaises(c.ContractHold):h.install('UNDECIDED')
   self.assertEqual(h.b.calls,[])
 def test_no_real_or_arbitrary_root_backend(self):
  with tempfile.TemporaryDirectory(prefix='ers-ensayo-control-') as control:
   with self.assertRaises(c.ContractHold):RootTransactionFixture(object(),control)
   self.assertEqual(list(Path(control).iterdir()),[])
 def test_private_namespace_no_host_paths(self):
  for p in ('/etc/ers-ensayo','/run/ers-ensayo-a','/tmp/ers-ensayo-rootfixture-a/sub'):
   with self.assertRaises(c.ContractHold):FixtureRootBackend(p,manifest())
 def test_source_pin_fault_before_any_mutation(self):
  with Harness() as h:
   h.sources['paired.py']=b'WRONG'
   with self.assertRaises(c.ContractHold):h.install()
   self.assertEqual(h.b.calls,[])
 def test_capacity_below_threshold_never_starts(self):
  for field,value in [('memoryAvailableBytes',536870911),('parentPidsFree',127),('class','HOST_MEASURED')]:
   with Harness() as h:
    h.install();capacity=h.capacity();capacity[field]=value
    with self.assertRaises(c.ContractHold):h.t.start_and_validate(capacity)
    self.assertFalse(any(op=='start' for op,target in h.b.calls));h.t.cleanup()
 def test_cleanup_timer_armed_before_first_start(self):
  with Harness() as h:
   h.install();h.t.start_and_validate(h.capacity());calls=[a for a,b in h.b.calls];self.assertLess(calls.index('arm_independent_fixture_timer'),calls.index('start'))
 def test_dead_supervisor_independent_timer_recovers_confirmed_originals(self):
  with Harness() as h:
   h.install();h.t.start_and_validate(h.capacity());h.t.close();h.t=RootTransactionFixture(h.b,h.control.name,create=False)
   h.b.clock=60;result=h.t.fire_independent_timer();self.assertEqual(result['status'],'FIXTURE_EXACT_CLEANUP_COMPLETE');self.assertEqual(h.b.objects,{});self.assertFalse(any(v['active'] for v in h.b.units.values()))
 def test_deadline_not_due_no_cleanup(self):
  with Harness() as h:
   h.install();h.t.start_and_validate(h.capacity());h.b.clock=59
   with self.assertRaises(c.ContractHold):h.t.fire_independent_timer()
   self.assertTrue(h.b.objects);self.assertFalse(any(op=='remove' for op,target in h.b.calls))
 def test_crash_before_or_after_start_effect_is_uncertain_hold(self):
  for crash in ('before','after'):
   with Harness() as h:
    h.install()
    with self.assertRaises(Crash):h.t.start_and_validate(h.capacity(),crash=crash)
    h.t.close();h.t=RootTransactionFixture(h.b,h.control.name,create=False);h.b.clock=60
    self.assertEqual(h.t.fire_independent_timer()['status'],'FIXTURE_EXACT_CLEANUP_COMPLETE')
    self.assertEqual(h.b.objects,{})
    self.assertFalse(any(scope['members'] for scope in h.b.scopes.values()))
 def test_install_crash_after_create_pending_never_adopts(self):
  with Harness() as h:
   path=h.m['runtimeRoot']
   with self.assertRaises(Crash):h.t.mutate('CREATE',path,lambda:h.b.create(path,b'',owner=0,group=0,mode=0o700,kind='directory'),crash='after')
   self.assertTrue(h.b.objects)
   with self.assertRaises(c.ContractHold):h.t.cleanup()
   with self.assertRaises(c.ContractHold):h.install()
 def test_object_drift_blocks_before_any_stop_or_remove(self):
  with Harness() as h:
   h.install();h.t.start_and_validate(h.capacity());path=h.m['sourceRoot']+'/paired.py';os.unlink(h.b.name(path),dir_fd=h.b.rootfd)
   with self.assertRaises(c.ContractHold):h.t.cleanup()
   self.assertFalse(any(op in ('stop_exact','remove') for op,target in h.b.calls))
 def test_manager_pid_invocation_or_cgroup_reuse_never_killed(self):
  for field,value in [('identity',{'pid':99,'start':'9','boot':'other'}),('invocation','a'*32),('cgroupKey',[1,2])]:
   with Harness() as h:
    h.install();h.t.start_and_validate(h.capacity());unit=h.m['units']['controller'];h.b.units[unit][field]=value
    with self.assertRaises(c.ContractHold):h.t.cleanup()
    self.assertFalse(any(op=='remove' for op,target in h.b.calls));self.assertFalse(any(op=='stop_exact' and target==unit for op,target in h.b.calls))
 def test_unknown_object_census_blocks_cleanup(self):
  with Harness() as h:
   h.install();h.t.start_and_validate(h.capacity());h.b.objects['/UNKNOWN']={'class':CLASS}
   with self.assertRaises(c.ContractHold):h.t.cleanup()
   self.assertFalse(any(op=='remove' for op,target in h.b.calls))
 def test_no_restart_no_install_retry(self):
  with Harness() as h:
   h.install();h.t.start_and_validate(h.capacity())
   with self.assertRaises(c.ContractHold):h.t.start_and_validate(h.capacity())
   with self.assertRaises(c.ContractHold):h.install()
 def test_no_secret_data_in_ledger(self):
  with Harness() as h:
   h.install();text=(Path(h.control.name)/'inventory.jsonl').read_text();self.assertNotIn('token',text);self.assertNotIn('0000000000000000000000000000000000000000000000000000000000000000',text);self.assertIn('SIMULATED_GLOBAL_DAEMON_RELOAD',text)

class ScopeReservationRegression(unittest.TestCase):
 def test_prior_reservation_is_durable_and_empty_before_start(self):
  with Harness() as h:
   h.install();done=h.t.reconcile();res=[r for r in done if r['action']=='RESERVE_SCOPE'];self.assertEqual(len(res),2);self.assertTrue(all(not h.b.scope_census(r['result']) for r in res));self.assertFalse(h.b.units)
   h.t.start_and_validate(h.capacity());actions=[r['action'] for r in h.t.reconcile()];self.assertLess(max(i for i,a in enumerate(actions) if a=='RESERVE_SCOPE'),actions.index('START'))
 def test_scope_nonce_inode_owner_reuse_rejected(self):
  for field,value in [('nonce','a'*64),('key',[27,999]),('owner',1000),('delegated',True)]:
   with Harness() as h:
    h.install();h.t.start_and_validate(h.capacity());h.b.scopes['controller']['reservation'][field]=value
    with self.assertRaises(c.ContractHold):h.t.cleanup()
    self.assertFalse(any(op=='remove' for op,target in h.b.calls))
 def test_foreign_descendant_blocks_before_any_kill(self):
  with Harness() as h:
   h.install();h.t.start_and_validate(h.capacity());h.b.scopes['watchdog']['members'].append({'uid':999,'scopeNonce':'FOREIGN','origin':'UNVERIFIED'})
   with self.assertRaises(c.ContractHold):h.t.cleanup()
   self.assertFalse(any(op in ('remove','stop_all_exact_scope_descendants') for op,target in h.b.calls))
 def test_proposed_cleanup_includes_owned_descendant_not_only_original(self):
  with Harness() as h:
   h.install();h.t.start_and_validate(h.capacity());scope=h.b.scopes['controller'];member=dict(scope['members'][0]);member.update(identity={'pid':30000,'start':'999','boot':member['identity']['boot']},original=False);scope['members'].append(member)
   h.t.cleanup();stop=next(r for r in h.t.reconcile() if r['action']=='STOP_SCOPE' and r['target']=='controller');self.assertEqual(len(stop['result']['terminated']),2);self.assertEqual(stop['result']['authority'],'PROPOSED_ALL_DESCENDANTS_NOT_ORIGINAL_PID_ONLY')
 def test_found_scope_not_adopted(self):
  with Harness() as h:
   h.b.scopes['controller']={'reservation':{},'members':[]}
   with self.assertRaises(c.ContractHold):h.install()
   self.assertFalse(any(op=='start' for op,target in h.b.calls))
 def test_uncertain_reservation_no_start_and_no_adoption(self):
  with Harness() as h:
   with self.assertRaises(Crash):h.t.mutate('RESERVE_SCOPE','controller',lambda:h.b.reserve_scope('controller'),crash='after')
   with self.assertRaises(c.ContractHold):h.t.cleanup()
   with self.assertRaises(c.ContractHold):h.t.start_and_validate(h.capacity())

class AllRolesBeforeEffectsRegression(unittest.TestCase):
 def test_second_role_manager_drift_or_missing_no_first_kill(self):
  for fault in ('invocation','missing','extraneous'):
   with Harness() as h:
    h.install();h.t.start_and_validate(h.capacity());unit=h.m['units']['watchdog']
    if fault=='invocation':h.b.units[unit]['invocation']='f'*32
    elif fault=='missing':del h.b.units[unit]
    else:h.b.scopes['watchdog']['members'].append({'uid':h.m['uid'],'scopeNonce':'FOREIGN','origin':'FOREIGN'})
    with self.assertRaises(c.ContractHold):h.t.cleanup()
    self.assertFalse(any(op=='stop_all_exact_scope_descendants' for op,target in h.b.calls));self.assertFalse(any(r['action']=='STOP_SCOPE' for r in h.t.reconcile()))
 def test_second_role_reservation_drift_before_first_start_intent(self):
  for field,value in [('delegated',True),('owner',1000),('key',[27,999]),('sourceDigest','f'*64),('nonce','f'*64)]:
   with Harness() as h:
    h.install();h.b.scopes['watchdog']['reservation'][field]=value
    with self.assertRaises(c.ContractHold):h.t.start_and_validate(h.capacity())
    self.assertFalse(any(op=='start' for op,target in h.b.calls));self.assertFalse(any(r.get('action')=='START' for r in h.t.rows()))
