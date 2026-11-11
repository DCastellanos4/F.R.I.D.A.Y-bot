"""All executions are injected NSS/journal fakes. No accounts/root/SSH/manager."""
import copy,grp,pwd,unittest
from test_ensayo_os import manifest,ROOT
from test_ensayo_privileged_lifecycle import NSS,MemoryIO
from deploy.ers_recovery import ensayo_os as c,ensayo_bootstrap as b
from deploy.ers_recovery.ensayo_system_allocation import Allocation,validate_plan
class Seed:
 def __init__(self,plan):self.data=[{'op':'ROOT_ALLOCATION_BEGIN','planDigest':c.digest(plan)}];self.path='/LOCAL_SYNTHETIC_SEED';self.closed=False;self.fail=None
 def check(self):
  if self.closed:raise c.ContractHold('FAKE_CLOSED_ORIGINAL_FD')
 def rows(self):self.check();return copy.deepcopy(self.data)
 def append(self,r):
  self.check()
  if r['op']==self.fail:raise c.ContractHold('FAKE_DURABILITY_FAILURE')
  self.data.append(copy.deepcopy(r))
 def close(self):self.closed=True
class AllocationTests(unittest.TestCase):
 def fixture(self):
  m=manifest();m['groups']=[m['gid']];template={k:v for k,v in m.items() if k not in ('uid','gid','groups')};plan={'allocation':'NATIVE_SHADOW_SYSTEM_NO_NUMERIC_SELECTION','manifestTemplate':template};seed=Seed(plan);nss=NSS(m);a=Allocation(plan,seed,nss=nss,execute=nss.execute);return m,plan,seed,nss,a
 def test_native_allocates_no_numeric_candidates_and_freezes(self):
  m,p,s,n,a=self.fixture();out=a.allocate();self.assertEqual(out['manifest'],m);self.assertFalse(out['productionAdmission']);self.assertNotIn('--gid',n.commands[0]);self.assertNotIn('--uid',n.commands[1]);self.assertIn('--system',n.commands[0]);self.assertIn('--system',n.commands[1]);self.assertEqual(a.confirm(m),out['receipt']);self.assertFalse(any(r['op']=='ROOT_CONTROL_BEGIN' for r in s.rows()));a.claim(m);c.validate_journal_origin(m,s.rows())
 def test_no_preselected_ids_or_existing_name(self):
  for name in ('uid','gid','groups'):
   m,p,s,n,a=self.fixture();p['manifestTemplate'][name]=m[name]
   with self.assertRaises(c.ContractHold):validate_plan(p)
   self.assertEqual(n.commands,[])
  for name in ('user','group'):
   m,p,s,n,a=self.fixture();setattr(n,name,object())
   with self.assertRaises(c.ContractHold):a.allocate()
   self.assertEqual(n.commands,[])
 def test_group_effect_unknown_or_failed_user_no_retry_no_delete(self):
  for command in ('groupadd','useradd'):
   m,p,s,n,a=self.fixture();n.fail=command
   with self.assertRaises(RuntimeError):a.allocate()
   count=len(n.commands)
   with self.assertRaises(c.ContractHold):a.allocate()
   with self.assertRaises(c.ContractHold):a.rollback()
   self.assertEqual(len(n.commands),count)
 def test_root_user_or_group_result_and_supplementary_groups_rejected(self):
  for bad in ('uid','gid','supplementary','groupreverse','userreverse'):
   m,p,s,n,a=self.fixture()
   if bad=='uid':n.m['uid']=0
   elif bad=='gid':n.m['gid']=0
   elif bad=='supplementary':n.groups=lambda name,gid:[gid,gid+1]
   elif bad=='groupreverse':n.group_id=lambda gid:None
   else:n.user_id=lambda uid:None
   with self.assertRaises(c.ContractHold):a.allocate()
   self.assertFalse(any(r['op']=='ALLOCATION_MANIFEST_FROZEN' for r in s.rows()))
 def test_drift_and_manifest_tamper_before_claim_no_install(self):
  for bad in ('uid','group','manifest','seed','closed'):
   m,p,s,n,a=self.fixture();out=a.allocate()
   if bad=='uid':n.user=pwd.struct_passwd(('ers-ensayo','x',m['uid']+1,m['gid'],'','/nonexistent','/usr/sbin/nologin'))
   elif bad=='group':n.group=grp.struct_group(('ers-ensayo','x',m['gid'],['other']))
   elif bad=='manifest':m['uid']+=1
   elif bad=='seed':s.data[6]['manifestDigest']='0'*64
   else:s.closed=True
   with self.assertRaises(c.ContractHold):a.claim(m)
   self.assertFalse(any(r['op']=='ROOT_CONTROL_BEGIN' for r in s.data))
 def test_full_rollback_exact_identity_no_force_or_home_removal(self):
  m,p,s,n,a=self.fixture();a.allocate();out=a.rollback();self.assertIn('NO_HOME',out['status']);self.assertIsNone(n.user);self.assertIsNone(n.group)
  self.assertFalse(any('--force' in argv or '--remove' in argv for argv in n.commands))
  count=len(n.commands)
  with self.assertRaises(c.ContractHold):a.rollback()
  self.assertEqual(len(n.commands),count)
 def test_group_only_rollback_before_any_user_intent(self):
  m,p,s,n,a=self.fixture();real=n.execute
  def race(argv):
   real(argv)
   n.user=object() # Causes absence recheck to stop before user intent.
  a.execute=race
  with self.assertRaises(c.ContractHold):a.allocate()
  n.user=None;a.execute=real;out=a.rollback();self.assertIn('ORIGINAL_GROUP',out['status']);self.assertEqual(len(n.commands),2);self.assertTrue(n.commands[-1][0].endswith('groupdel'))
 def test_freeze_failure_never_becomes_usable_or_deleted_by_name(self):
  m,p,s,n,a=self.fixture();s.fail='ALLOCATION_MANIFEST_FROZEN'
  with self.assertRaises(c.ContractHold):a.allocate()
  with self.assertRaises(c.ContractHold):a.claim(m)
  with self.assertRaises(c.ContractHold):a.rollback()
  self.assertEqual(len(n.commands),2)
 def test_allocation_chain_readers_reject_every_prefix_mutation(self):
  m,p,s,n,a=self.fixture();a.allocate();a.claim(m);rows=s.rows();c.validate_journal_origin(m,rows)
  for i in range(8):
   modified=copy.deepcopy(rows);modified[i]['unexpected']=True
   with self.assertRaises(c.ContractHold):c.validate_journal_origin(m,modified)
  with self.assertRaises(c.ContractHold):c.validate_journal_origin(m,rows+[rows[-1]])
  with self.assertRaises(c.ContractHold):c.validate_journal_origin(m,[rows[-1]]+rows[:-1])
  with self.assertRaises(c.ContractHold):c.validate_journal_origin(m,rows+[rows[6]])
 def test_bootstrap_consumes_original_once_without_second_creation(self):
  m,p,s,n,a=self.fixture();a.allocate();io=MemoryIO();sources={k:(ROOT/k).read_bytes() for k in c.STAGING_SOURCES};controls={k:(ROOT/k).read_bytes() for k in b.CONTROL};ret={k:(ROOT/k).read_bytes() for k in b.EXECUTOR_NAMES}
  out=b.execute_prepared_bundle(m,sources,controls,retirement_bytes=ret,account_disposition='REMOVE_IF_EXACT_UNUSED',allocation=a,io_factory=lambda m:io)
  self.assertFalse(out['productionAdmission']);self.assertEqual(len(n.commands),2);self.assertTrue(s.closed)
  lifecycle=next(data for op,path,data in io.effects if path.endswith('/lifecycle.jsonl'))
  c.validate_journal_origin(m,[c.load_json(v) for v in lifecycle.splitlines()])
  root=m['intervention']['controlRoot'];config=next(data for op,path,data in io.effects if path==root+'/supervisor.json');self.assertEqual(c.load_json(config)['manifest']['uid'],m['uid']);self.assertEqual(c.load_json(config)['manifest']['groups'],[m['gid']])
 def test_invalid_material_before_claim_no_install_or_close(self):
  m,p,s,n,a=self.fixture();a.allocate();io=MemoryIO()
  with self.assertRaises(c.ContractHold):b.execute_prepared_bundle(m,{}, {},retirement_bytes={},account_disposition='REMOVE_IF_EXACT_UNUSED',allocation=a,io_factory=lambda m:io)
  self.assertEqual(io.effects,[]);self.assertFalse(a.claimed);self.assertFalse(s.closed)
 def test_external_retirement_accepts_exact_frozen_allocation_prefix(self):
  from test_ensayo_retirement import RetirementTests
  from deploy.ers_recovery import ensayo_retirement as r
  from unittest.mock import patch
  f=RetirementTests().fixture();m=f.m;plan={'allocation':'NATIVE_SHADOW_SYSTEM_NO_NUMERIC_SELECTION','manifestTemplate':{k:v for k,v in m.items() if k not in ('uid','gid','groups')}};seed=Seed(plan);n=NSS(m);a=Allocation(plan,seed,nss=n,execute=n.execute);a.allocate();a.claim(m);prefix=seed.rows();f.j.data=prefix+[v for v in f.j.data[1:] if v['op'] not in ('PRINCIPAL_GROUP_INTENT','PRINCIPAL_GROUP_CREATED','PRINCIPAL_USER_INTENT','PRINCIPAL_RESERVED')]
  f.io.replace_data(f.lifecycle,b''.join(c.encode(v)+b'\n' for v in f.j.rows()));lk=f.io.snapshot(f.lifecycle)
  f.io.replace_data(f.p['seed'],b''.join(c.encode(v)+b'\n' for v in prefix+[{'op':'LIFECYCLE_SEALED','path':f.lifecycle,'key':lk}]))
  with patch.object(r,'__file__',f.external+'/ensayo_retirement.py'):
   out=f.retire.freeze(f.j.rows(),seed_original=f.io.snapshot(f.p['seed']),lifecycle_original=lk,not_before=186400,executor_pins=f.pins)
  self.assertTrue(out['notScheduled']);self.assertFalse(out['ticket'].get('productionAdmission',False))
if __name__=='__main__':unittest.main()
