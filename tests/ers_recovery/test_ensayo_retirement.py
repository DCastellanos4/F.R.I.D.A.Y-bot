"""Concrete retirement algorithms with fake account/manager/syscalls only."""
import copy,hashlib,json,os,stat,tempfile,unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
from test_ensayo_os import manifest,ROOT
import test_ensayo_privileged_lifecycle as lifecycle_tests
MemoryIO=lifecycle_tests.MemoryIO
from test_ensayo_privileged_backend import MappedCalls
from deploy.ers_recovery import ensayo_os as c,ensayo_retirement as r

class IO(MemoryIO):
 def __init__(self):super().__init__();self.data={};self.fail_remove=None
 def create(self,p,b,*,uid,gid,mode):
  key=super().create(p,b,uid=uid,gid=gid,mode=mode);self.data[p]=b;return key
 def read_exact(self,p,key,*,limit=131072):
  b=self.data[p]
  if self.snapshot(p)!=key or len(b)>limit or hashlib.sha256(b).hexdigest()!=key['sha256']:raise c.ContractHold('SYNTHETIC_READ_DRIFT')
  return b
 def replace_data(self,p,b):
  self.data[p]=b;self.objects[p].update(size=len(b),sha256=hashlib.sha256(b).hexdigest())
 def remove(self,p,key):
  super().remove(p,key);self.data.pop(p,None)
  if self.fail_remove==p:raise RuntimeError('SYNTHETIC_CRASH_AFTER_UNLINK')
class Log:
 def __init__(self,m,io,digest):self.io=io;self.path=r.paths(m)['closeout'];self.rows=[];self.closed=False;io.create(self.path,b'',uid=0,gid=0,mode=0o600);self.append({'op':'RETIRE_INTENT','ticketDigest':digest})
 def append(self,row):self.rows.append(copy.deepcopy(row));self.io.replace_data(self.path,b''.join(c.encode(v)+b'\n' for v in self.rows))
 def close(self):self.closed=True

class RetirementTests(unittest.TestCase):
 def fixture(self):
  m,old,j,nss,states,calls,finalizer=lifecycle_tests.FinalizerTests().fixture();finalizer.finish();io=IO();io.objects=copy.deepcopy(old.objects);io.effects=copy.deepcopy(old.effects)
  for op,p,b in old.effects:
   if op=='create' and b is not None and p in io.objects:io.data[p]=b
  lifecycle=m['intervention']['controlRoot']+'/lifecycle.jsonl';io.replace_data(lifecycle,b''.join(c.encode(v)+b'\n' for v in j.rows()));lifecycle_key=io.snapshot(lifecycle)
  p=r.paths(m);seedbytes=c.encode({'op':'ROOT_CONTROL_BEGIN','manifestDigest':c.digest(m)})+b'\n'+c.encode({'op':'LIFECYCLE_SEALED','path':lifecycle,'key':lifecycle_key})+b'\n';seedkey=io.create(p['seed'],seedbytes,uid=0,gid=0,mode=0o600)
  pins={n:hashlib.sha256((ROOT/n).read_bytes()).hexdigest() for n in r.EXECUTOR_NAMES};external='/opt/ers-retirement/'+c.digest(pins)
  self.assertIn(external,io.objects)
  observations={m['intervention'][role+'Unit']:{'Id':m['intervention'][role+'Unit'],'LoadState':'not-found','FragmentPath':'','DropInPaths':'','InvocationID':'','ActiveState':'inactive','MainPID':'0','ControlPID':'0'} for role in ('supervisor','cleanup')}
  def invoke(verb,unit=None):
   if verb!='show':raise AssertionError('RETIREMENT_NEVER_STARTS_OR_RELOADS_MANAGER')
   return copy.deepcopy(observations[unit])
  def absent(pid):raise FileNotFoundError()
  logs=[]
  def logfactory(*a):log=Log(*a);logs.append(log);return log
  retire=r.Retirement(m,io=io,runner=SimpleNamespace(invoke=invoke),nss=nss,identityfn=absent,clock=lambda:100000,journal_factory=logfactory)
  freeze=lambda:retire.freeze(j.rows(),seed_original=seedkey,lifecycle_original=lifecycle_key,not_before=186400,executor_pins=pins)
  return SimpleNamespace(m=m,io=io,j=j,nss=nss,retire=retire,freeze=freeze,external=external,p=p,observations=observations,logs=logs,lifecycle=lifecycle,seedkey=seedkey,pins=pins)
 def freeze(self,f):
  with patch.object(r,'__file__',f.external+'/ensayo_retirement.py'):return f.freeze()
 def run_retire(self,f,ticket,binding):
  with patch.object(r,'__file__',f.external+'/ensayo_retirement.py'):return f.retire.execute(ticket,approved_binding=binding)
 def binding(self,t):return {'ticketDigest':t['ticketDigest'],'notBeforeUnix':t['ticket']['notBeforeUnixProposed'],'scope':'EXACT_CONTROL_AND_SEED_WITH_EXTERNAL_AUDIT_RETAINED'}
 def test_freeze_exact_closed_inventory_proposal_only_no_schedule(self):
  f=self.fixture();before=copy.deepcopy(f.io.objects);ticket=self.freeze(f)
  self.assertTrue(ticket['notScheduled']);self.assertIn('PENDING_AUTHORITY',ticket['status']);self.assertEqual(len(ticket['ticket']['inventory']),15)
  self.assertEqual(set(f.io.objects)-set(before),{f.p['shared'],f.p['audit'],f.p['ticket']});self.assertEqual(f.io.data[f.p['ticket']],c.encode(ticket['ticket']));self.assertEqual(f.io.snapshot(f.p['seed']),f.seedkey)
 def test_unknown_or_drift_before_freeze_zero_effects(self):
  for fault in ('unknown','module','seed','lifecycle','root','source','missingcomplete','account','unit','pid'):
   with self.subTest(fault=fault):
    f=self.fixture();root=f.m['intervention']['controlRoot']
    if fault=='unknown':f.io.objects[root+'/unknown']={'unowned':True}
    elif fault=='module':f.io.objects[root+'/ensayo_root_install.py']['ino']+=1
    elif fault=='seed':f.io.objects[f.p['seed']]['ino']+=1
    elif fault=='lifecycle':f.io.objects[f.lifecycle]['ino']+=1
    elif fault=='root':f.io.objects[root]['ino']+=1
    elif fault=='source':f.io.objects[f.external+'/ensayo_retirement.py']['sha256']='f'*64
    elif fault=='missingcomplete':f.j.data.pop()
    elif fault=='account':f.nss.user=object()
    elif fault=='unit':f.observations[f.m['intervention']['cleanupUnit']]['LoadState']='loaded'
    else:f.retire.identity=lambda pid:{'pid':pid,'start':'REUSED'}
    before=copy.deepcopy(f.io.objects);effects=copy.deepcopy(f.io.effects)
    with self.assertRaises(c.ContractHold):self.freeze(f)
    self.assertEqual(f.io.objects,before);self.assertEqual(f.io.effects,effects);self.assertEqual(f.logs,[])
 def test_ticket_write_failure_preserves_control_seed_and_refuses_new_epoch_adoption(self):
  f=self.fixture();f.io.fail=f.p['ticket'];root=f.m['intervention']['controlRoot'];targets={p:copy.deepcopy(v) for p,v in f.io.objects.items() if p==root or p.startswith(root+'/') or p==f.p['seed']}
  with self.assertRaises(RuntimeError):self.freeze(f)
  self.assertIn(f.p['audit'],f.io.objects);self.assertNotIn(f.p['ticket'],f.io.objects)
  before=copy.deepcopy(f.io.effects)
  with self.assertRaises(c.ContractHold):self.freeze(f)
  self.assertEqual(f.io.effects,before)
  for p,key in targets.items():self.assertEqual(f.io.snapshot(p),key)

 def test_default_and_early_time_no_closeout_no_removal(self):
  f=self.fixture();t=self.freeze(f);before=copy.deepcopy(f.io.objects);effects=copy.deepcopy(f.io.effects)
  for binding in (None,self.binding(t)):
   with self.assertRaises(c.ContractHold):self.run_retire(f,t,binding)
   self.assertEqual(f.io.objects,before);self.assertEqual(f.io.effects,effects);self.assertEqual(f.logs,[])
 def test_prior_unknown_drift_reuse_after_freeze_no_first_intent_or_delete(self):
  for fault in ('unknown','file','root','seed','ticket','audit','unit','pid','username','uid','groupname','gid','source','closeout','targetset'):
   with self.subTest(fault=fault):
    f=self.fixture();t=self.freeze(f);f.retire.clock=lambda:186400;root=f.m['intervention']['controlRoot']
    if fault=='unknown':f.io.objects[root+'/unknown']={'unowned':True}
    elif fault=='file':f.io.objects[root+'/supervisor.json']['ino']+=1
    elif fault=='root':f.io.objects[root]['ino']+=1
    elif fault=='seed':f.io.objects[f.p['seed']]['sha256']='e'*64
    elif fault=='ticket':f.io.objects[f.p['ticket']]['ino']+=1
    elif fault=='audit':f.io.objects[f.p['audit']]['ino']+=1
    elif fault=='unit':f.observations[f.m['intervention']['cleanupUnit']]['InvocationID']='a'*32
    elif fault=='pid':f.retire.identity=lambda pid:{'pid':pid}
    elif fault=='username':f.nss.user_name=lambda name:object()
    elif fault=='uid':f.nss.user_id=lambda uid:object()
    elif fault=='groupname':f.nss.group_name=lambda name:object()
    elif fault=='gid':f.nss.group_id=lambda gid:object()
    elif fault=='source':f.io.objects[f.external+'/lease.py']['sha256']='d'*64
    elif fault=='closeout':f.io.create(f.p['closeout'],b'PARTIAL',uid=0,gid=0,mode=0o600)
    else:
     t['ticket']['inventory']['/etc/passwd']={'unowned':True};t['ticketDigest']=c.digest(t['ticket']);f.io.replace_data(f.p['ticket'],c.encode(t['ticket']));t['ticketKey']=f.io.snapshot(f.p['ticket'])
    before=copy.deepcopy(f.io.objects);effects=copy.deepcopy(f.io.effects)
    with self.assertRaises(c.ContractHold):self.run_retire(f,t,self.binding(t))
    self.assertEqual(f.io.objects,before);self.assertEqual(f.io.effects,effects);self.assertFalse(f.logs)
 def test_success_removes_control_seed_only_and_preserves_external_audit(self):
  f=self.fixture();t=self.freeze(f);f.retire.clock=lambda:186400;out=self.run_retire(f,t,self.binding(t))
  self.assertIn('EXTERNAL_AUDIT_RETAINED',out['status']);self.assertTrue(all(f.io.snapshot(p) is None for p in t['ticket']['inventory']));self.assertIn(f.p['ticket'],f.io.objects);self.assertIn(f.p['closeout'],f.io.objects);self.assertEqual(f.logs[0].rows[-1]['op'],'RETIRE_COMPLETE');self.assertTrue(f.logs[0].closed)
  for p in t['ticket']['sharedParentsRetained']:
   if p in f.io.objects:self.assertEqual(f.io.objects[p]['type'],stat.S_IFDIR)
  before=copy.deepcopy(f.io.effects)
  with self.assertRaises(c.ContractHold):self.run_retire(f,t,self.binding(t))
  self.assertEqual(f.io.effects,before)
 def test_crash_after_first_unlink_keeps_audit_and_refuses_retry(self):
  f=self.fixture();t=self.freeze(f);f.retire.clock=lambda:186400;first=sorted(p for p in t['ticket']['inventory'] if p not in (f.p['seed'],f.m['intervention']['controlRoot']))[0];f.io.fail_remove=first
  with self.assertRaises(RuntimeError):self.run_retire(f,t,self.binding(t))
  self.assertIsNone(f.io.snapshot(first));self.assertEqual(f.logs[0].rows[-1]['op'],'RETIRE_REMOVE_INTENT');self.assertTrue(f.logs[0].closed);before=copy.deepcopy(f.io.effects)
  with self.assertRaises(c.ContractHold):self.run_retire(f,t,self.binding(t))
  self.assertEqual(f.io.effects,before)
 def test_finalizer_wrapper_seals_before_freeze_and_preserves_no_authority(self):
  from deploy.ers_recovery.ensayo_finalizer import Finalizer
  events=[];obj=object.__new__(Finalizer);obj.finish=lambda:events.append('FINALIZE_COMPLETE') or {'result':True};obj.j=SimpleNamespace(rows=lambda:['BEFORE_ROWS'],seal=lambda:events.append('SEAL_AND_CLOSE') or (['ROWS'],{'original':'KEY'}))
  def freeze(rows,**kw):
   events.append('FREEZE');self.assertEqual(rows,['ROWS']);self.assertEqual(kw['lifecycle_original'],{'original':'KEY'});return {'status':'PENDING_AUTHORITY'}
  out=obj.finish_and_freeze(SimpleNamespace(prepare=lambda *a,**kw:events.append('PREPARE'),freeze=freeze),seed_original={'seed':'ORIGINAL'},not_before=186400,executor_pins={'CODE':'PIN'})
  self.assertEqual(events,['PREPARE','FINALIZE_COMPLETE','SEAL_AND_CLOSE','FREEZE']);self.assertIn('PENDING_OWNER_AUTHORITY_NO_SCHEDULE',out['status'])

class PrefinalizerCompositionTests(unittest.TestCase):
 def fixture(self):
  m,old,j,nss,states,calls,finalizer=lifecycle_tests.FinalizerTests().fixture();io=IO();io.objects=copy.deepcopy(old.objects);io.effects=copy.deepcopy(old.effects)
  for op,p,b in old.effects:
   if op=='create' and b is not None and p in io.objects:io.data[p]=b
  root=m['intervention']['controlRoot'];life=root+'/lifecycle.jsonl';io.replace_data(life,b''.join(c.encode(v)+b'\n' for v in j.rows()));p=r.paths(m)
  seedkey=io.create(p['seed'],c.encode(j.rows()[0])+b'\n'+c.encode({'op':'LIFECYCLE_SEALED'})+b'\n',uid=0,gid=0,mode=0o600);finalizer.io=io
  j.closed=False;j.check=lambda:None
  def seal():
   io.replace_data(life,b''.join(c.encode(v)+b'\n' for v in j.rows()));j.closed=True;return j.rows(),io.snapshot(life)
  j.seal=seal
  pins={n:hashlib.sha256((ROOT/n).read_bytes()).hexdigest() for n in r.EXECUTOR_NAMES};external='/opt/ers-retirement/'+c.digest(pins)
  def absent(pid):raise FileNotFoundError()
  runner=SimpleNamespace(invoke=lambda verb,unit:{'Id':unit,'LoadState':'not-found','FragmentPath':'','DropInPaths':'','InvocationID':'','ActiveState':'inactive','MainPID':'0','ControlPID':'0'})
  retire=r.Retirement(m,io=io,runner=runner,nss=nss,identityfn=absent,clock=lambda:100000)
  return SimpleNamespace(m=m,io=io,j=j,nss=nss,finalizer=finalizer,retire=retire,seedkey=seedkey,pins=pins,external=external,p=p,life=life)
 def test_known_prefinalizer_failures_no_finalizer_or_account_or_journal_effect(self):
  for fault in ('time','emptyinputs','seed','controlunknown','controlfile','executor','audit','journalbytes','capacity','originalfd'):
   with self.subTest(fault=fault):
    f=self.fixture();notbefore=186400;pins=f.pins
    if fault=='time':notbefore=0
    elif fault=='emptyinputs':pins={}
    elif fault=='seed':f.io.objects[f.p['seed']]['ino']+=1
    elif fault=='controlunknown':f.io.objects[f.m['intervention']['controlRoot']+'/unknown']={'unowned':True}
    elif fault=='controlfile':f.io.objects[f.m['intervention']['controlRoot']+'/supervisor.json']['sha256']='f'*64
    elif fault=='executor':f.io.objects[f.external+'/ensayo_retirement.py']['ino']+=1
    elif fault=='audit':f.io.create_directory(f.p['shared'],uid=0,gid=0,mode=0o700);f.io.create_directory(f.p['audit'],uid=0,gid=0,mode=0o700)
    elif fault=='journalbytes':f.io.replace_data(f.life,c.encode({'op':'FORGED'})+b'\n')
    elif fault=='capacity':
     f.j.data.extend({'op':'LOCAL_SYNTHETIC_LIMIT'} for _ in range(260));f.io.replace_data(f.life,b''.join(c.encode(v)+b'\n' for v in f.j.rows()))
    else:
     def nofd():raise c.ContractHold('ROOT_CONTROL_JOURNAL_DRIFT')
     f.j.check=nofd
    objects=copy.deepcopy(f.io.objects);effects=copy.deepcopy(f.io.effects);rows=f.j.rows();commands=copy.deepcopy(f.nss.commands)
    with patch.object(r,'__file__',f.external+'/ensayo_retirement.py'),self.assertRaises(c.ContractHold):f.finalizer.finish_and_freeze(f.retire,seed_original=f.seedkey,not_before=notbefore,executor_pins=pins)
    self.assertEqual(f.io.objects,objects);self.assertEqual(f.io.effects,effects);self.assertEqual(f.j.rows(),rows);self.assertEqual(f.nss.commands,commands);self.assertFalse(f.j.closed);self.assertFalse(any(v['op']=='FINALIZE_INTENT' for v in f.j.rows()))
 def test_actual_finalizer_prepare_seal_freeze_success_order(self):
  f=self.fixture()
  with patch.object(r,'__file__',f.external+'/ensayo_retirement.py'):out=f.finalizer.finish_and_freeze(f.retire,seed_original=f.seedkey,not_before=186400,executor_pins=f.pins)
  self.assertTrue(f.j.closed);self.assertIsNone(f.nss.user);self.assertIsNone(f.nss.group);self.assertIn('PENDING_OWNER_AUTHORITY',out['status']);self.assertEqual(f.j.rows()[-1]['op'],'ROOT_FINALIZER_COMPLETE');self.assertTrue(out['retirement']['notScheduled']);self.assertIn(f.p['ticket'],f.io.objects)

class FollowThroughTests(RetirementTests):
 # Only new tests are collected here; inherited tests are deliberately disabled
 # below so one regression never inflates the full-suite count.
 def test_status_pending_complete_partial_and_unknown_is_read_only(self):
  f=self.fixture();t=self.freeze(f);effects=copy.deepcopy(f.io.effects);self.assertIn('PENDING_OWNER',f.retire.status(t)['status']);self.assertEqual(f.io.effects,effects)
  f.retire.clock=lambda:186400;self.run_retire(f,t,self.binding(t));effects=copy.deepcopy(f.io.effects);self.assertEqual(f.retire.status(t)['status'],'VERIFIED_COMPLETE_NO_REPEAT_REMOVAL');self.assertEqual(f.io.effects,effects)
  f.io.objects[f.m['intervention']['controlRoot']]={'reused':True};self.assertEqual(f.retire.status(t)['status'],'HOLD_RESIDUAL_NO_RETRY');self.assertEqual(f.io.effects,effects)
  f=self.fixture();t=self.freeze(f);f.retire.clock=lambda:186400;first=sorted(p for p in t['ticket']['inventory'] if p not in (f.p['seed'],f.m['intervention']['controlRoot']))[0];f.io.fail_remove=first
  with self.assertRaises(RuntimeError):self.run_retire(f,t,self.binding(t))
  effects=copy.deepcopy(f.io.effects);self.assertEqual(f.retire.status(t)['status'],'HOLD_RESIDUAL_NO_RETRY');self.assertEqual(f.io.effects,effects)
 def test_unknown_injected_after_first_effect_stops_next_and_never_retries(self):
  f=self.fixture();t=self.freeze(f);f.retire.clock=lambda:186400;original=f.io.remove;root=f.m['intervention']['controlRoot'];count=[]
  def interfere(p,key):
   original(p,key);count.append(p)
   if len(count)==1:f.io.objects[root+'/unowned']={'injected':True}
  f.io.remove=interfere
  with self.assertRaises(c.ContractHold):self.run_retire(f,t,self.binding(t))
  self.assertEqual(len(count),1);self.assertIn(root+'/unowned',f.io.objects);self.assertNotEqual(f.logs[0].rows[-1]['op'],'RETIRE_COMPLETE');self.assertEqual(f.retire.status(t)['status'],'HOLD_RESIDUAL_NO_RETRY')
  with self.assertRaises(c.ContractHold):self.run_retire(f,t,self.binding(t))
  self.assertEqual(len(count),1)

for _name in tuple(RetirementTests.__dict__):
 if _name.startswith('test_'):setattr(FollowThroughTests,_name,None)

class RetirementSyscalls(unittest.TestCase):
 def io(self,td):
  m=manifest();root=Path(td)
  for name in ('var/lib/ers-ensayo-retirement','var/lib/ers-ensayo-control','opt/ers-retirement'):(root/name).mkdir(parents=True,exist_ok=True)
  (root/'var/lib/ers-ensayo-retirement').chmod(0o700)
  calls=MappedCalls(root);return m,r.RetirementIO(m,calls=calls)
 def test_real_descriptor_audit_append_fsync_and_noretry_on_fake_root(self):
  with tempfile.TemporaryDirectory() as td:
   m,io=self.io(td);p=r.paths(m);io.create_directory(p['audit'],uid=0,gid=0,mode=0o700);j=r.AuditJournal(m,io,'a'*64)
   try:j.append({'op':'RETIRE_REMOVE_INTENT','path':p['seed']});self.assertIn(b'RETIRE_INTENT',io.read_exact(p['closeout'],io.snapshot(p['closeout'])))
   finally:j.close()
   with self.assertRaises(c.ContractHold):r.AuditJournal(m,io,'a'*64)
 def test_composed_real_dirfd_freeze_ticket_retire_and_readback(self):
  with tempfile.TemporaryDirectory() as td:
   m,io=self.io(td);p=r.paths(m);(Path(td)/p['shared'].lstrip('/')).rmdir();self.assertIsNone(io.snapshot(p['shared']));root=m['intervention']['controlRoot'];rows=[{'op':'ROOT_CONTROL_BEGIN','manifestDigest':c.digest(m)}]
   def created(path,b=None,directory=False,mode=0o444):
    key=io.create_directory(path,uid=0,gid=0,mode=mode) if directory else io.create(path,b,uid=0,gid=0,mode=mode)
    rows.append({'op':'INSTALL_CREATED','path':path,'key':key});return key
   created(root,directory=True,mode=0o700)
   for n in sorted(r.CONTROL_NAMES|{'supervisor.json','cleanup.json','bootstrap-receipt.json'}):created(root+'/'+n,b'LOCAL_SYNTHETIC_PUBLIC',mode=0o400 if n.endswith('.json') else 0o444)
   principal={'op':'PRINCIPAL_RESERVED','user':'ers-ensayo','group':'ers-ensayo','uid':m['uid'],'gid':m['gid'],'home':'/nonexistent','shell':'/usr/sbin/nologin','groups':[m['gid']]};rows.append(principal);rows.append({'op':'ACCOUNT_DISPOSITION','decision':'REMOVE_IF_EXACT_UNUSED'})
   for index,role in enumerate(('supervisor','cleanup')):rows.append({'op':'ROOT_CUSTODIAN_ORIGINAL','role':role,'identity':{'pid':100+index,'start':'123','boot':'b'*36},'invocation':str(index+1)*32})
   rows.append({'op':'ROOT_FINALIZER_COMPLETE','result':{'account':'REMOVAL_EXTERNALLY_VERIFIED'}})
   pins={n:hashlib.sha256((ROOT/n).read_bytes()).hexdigest() for n in r.EXECUTOR_NAMES};external='/opt/ers-retirement/'+c.digest(pins);io.allow.update({external}|{external+'/'+n for n in pins});key=io.create_directory(external,uid=0,gid=0,mode=0o755);rows.insert(-1,{'op':'RETIRE_EXECUTOR_CREATED','path':external,'key':key})
   for n in pins:
    key=io.create(external+'/'+n,(ROOT/n).read_bytes(),uid=0,gid=0,mode=0o444);rows.insert(-1,{'op':'RETIRE_EXECUTOR_CREATED','path':external+'/'+n,'key':key})
   life=io.create(root+'/lifecycle.jsonl',b''.join(c.encode(v)+b'\n' for v in rows),uid=0,gid=0,mode=0o600)
   seed=io.create(p['seed'],c.encode(rows[0])+b'\n'+c.encode({'op':'LIFECYCLE_SEALED'})+b'\n',uid=0,gid=0,mode=0o600)
   nss=SimpleNamespace(**{n:lambda *a:None for n in ('user_name','user_id','group_name','group_id')})
   runner=SimpleNamespace(invoke=lambda verb,unit:{'Id':unit,'LoadState':'not-found','FragmentPath':'','DropInPaths':'','InvocationID':'','ActiveState':'inactive','MainPID':'0','ControlPID':'0'})
   def absent(pid):raise FileNotFoundError()
   retirement=r.Retirement(m,io=io,runner=runner,nss=nss,identityfn=absent,clock=lambda:100000)
   with patch.object(r,'__file__',external+'/ensayo_retirement.py'):
    ticket=retirement.freeze(rows,seed_original=seed,lifecycle_original=life,not_before=186400,executor_pins=pins);retirement.clock=lambda:186400
    out=retirement.execute(ticket,approved_binding=RetirementTests().binding(ticket))
   self.assertIsNone(io.snapshot(root));self.assertIsNone(io.snapshot(p['seed']));self.assertIn('EXTERNAL_AUDIT_RETAINED',out['status'])
   readback=io.read_exact(p['closeout'],io.snapshot(p['closeout']));self.assertEqual(c.load_json(readback.splitlines()[-1])['op'],'RETIRE_COMPLETE');self.assertTrue((Path(td)/p['ticket'].lstrip('/')).is_file())

 def test_actual_rootjournal_seal_returns_snapshot_shape_and_closes_original_fd(self):
  from deploy.ers_recovery import ensayo_root_journal as rj
  realstat=os.stat;realfstat=os.fstat;reallstat=Path.lstat
  def project(s):
   names=('st_dev','st_ino','st_uid','st_gid','st_mode','st_nlink','st_size','st_mtime_ns','st_ctime_ns');d={n:getattr(s,n) for n in names};d.update(st_uid=0,st_gid=0);return SimpleNamespace(**d)
  with tempfile.TemporaryDirectory() as td:
   m=manifest();root=Path(td)/'control';root.mkdir(mode=0o700)
   with patch.object(rj,'Path',side_effect=lambda p:root),patch.object(c,'ancestors',return_value=None),patch.object(Path,'lstat',side_effect=lambda *a,**k:project(reallstat(root))),patch.object(os,'fstat',side_effect=lambda fd:project(realfstat(fd))),patch.object(os,'stat',side_effect=lambda *a,**k:project(realstat(*a,**k))):
    # bounded_file needs the actual lifecycle lstat, not the directory mock.
    j=rj.RootJournal(m,create=True);j.append({'op':'ROOT_FINALIZER_COMPLETE'});fd=j.fd
    with patch.object(c,'bounded_file',return_value=((root/'lifecycle.jsonl').read_bytes(),dict(c.file_key(project(realfstat(fd))),sha256=hashlib.sha256((root/'lifecycle.jsonl').read_bytes()).hexdigest()))):rows,key=j.seal()
    self.assertEqual(rows[-1]['op'],'ROOT_FINALIZER_COMPLETE');self.assertEqual(set(key),{'dev','ino','uid','gid','mode','nlink','type','size','sha256'});self.assertEqual(key['type'],stat.S_IFREG)
   with self.assertRaises(OSError):os.fstat(fd)
 def test_seed_exact_read_and_symlink_refusal_no_arbitrary_target(self):
  with tempfile.TemporaryDirectory() as td:
   m,io=self.io(td);p=r.paths(m);key=io.create(p['seed'],b'LOCAL_SYNTHETIC',uid=0,gid=0,mode=0o600);self.assertEqual(io.read_exact(p['seed'],key),b'LOCAL_SYNTHETIC')
   with self.assertRaises(c.ContractHold):io.read_exact('/etc/passwd',key)
   target=Path(td)/p['seed'].lstrip('/');target.unlink();target.symlink_to('/does-not-exist')
   with self.assertRaises(c.ContractHold):io.read_exact(p['seed'],key)

if __name__=='__main__':unittest.main()
