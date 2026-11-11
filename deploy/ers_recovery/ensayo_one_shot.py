"""Prepared one-attempt operator callable. Import/plan loading has NO effects.
Plan/binding/status is not owner approval. The trusted caller must independently
recover owner authority and supply a checker before run. No SSH/secret transport,
CLI auto-start, retry, repair, recursive deletion or automatic future retirement.
"""
import base64,copy,hashlib,importlib,math,os,stat,sys,time,types
from pathlib import Path
from . import ensayo_os as c
from .ensayo_system_allocation import Allocation,AllocationSeedJournal,validate_plan as allocation_plan
from .ensayo_bootstrap import CONTROL,execute_prepared_bundle
from .ensayo_retirement import EXECUTOR_NAMES
from .ensayo_privileged_io import RootIO,FixedRunner
from .ensayo_start_controller import StartController
from .ensayo_root_journal import RootJournal
from .ensayo_principal_retire import PrincipalRetire
from .ensayo_finalizer import Finalizer
from .ensayo_principal_bootstrap import NSS
from .lease import identity
EXTERNAL={'ensayo_bootstrap.py','ensayo_system_allocation.py','ensayo_one_shot.py','ensayo_start_controller.py','ensayo_principal_retire.py','ensayo_finalizer.py','ensayo_root_journal.py'}
MATERIAL_NAMES=c.STAGING_SOURCES|CONTROL|EXECUTOR_NAMES|EXTERNAL
CAPS={'materialFileBytes':1048576,'materialTotalBytes':12582912,'waitSeconds':90,'pollMillis':1000,'preFinalizeAllowanceSeconds':120,'accountCommandSeconds':2,'managerCommandSeconds':2,'externalManagerCommandsMax':192,'binaryPassesMax':5,'binaryPassBytesMax':100663296,'utilityMemoryCap':'NOT_CGROUP_LIMITED','utilityTaskCap':'NOT_CGROUP_LIMITED','utilityCpuCap':'NOT_CGROUP_LIMITED'}
POLICY={'controlSeedMinSeconds':86400,'followup':'ONE_STATE_REVIEW_AND_PRIVATE_NOTICE_NO_DELETE','retire':'SEPARATE_FUTURE_OWNER_APPROVAL_OF_EXACT_TICKET','executorAuditSharedParents':'RETAIN_INDEFINITELY_UNTIL_SEPARATE_SPECIFIC_REQUEST_AND_REVIEW','nativeAccountDatabaseBackupsAuditCaches':'SYSTEM_SIDE_EFFECTS_NOT_PURGED','existingSqliteBackupRetention':'UNCHANGED'}
TARGET={'account':'ubuntu','address':'51.170.48.166','hostKeyType':'ssh-ed25519','hostKeySha256':'SHA256:cPziJJ/oUNY7Q/fBXdCPvv0hueD4i1IPbqHKe9DtJuM','hostKeyPublicFile':'/etc/ssh/ssh_host_ed25519_key.pub','transport':'EXTERNAL_OPERATOR_PINNED_SSH_NOT_IMPLEMENTED_HERE'}
SCOPE='ONE_ISOLATED_NO_BOT_NATIVE_ACCOUNT_TWO_GLOBAL_RELOADS_EXCLUSIVE_SCOPE_ALL_DESCENDANTS_EXACT_CLOSEOUT'

def validate(plan,materials):
 c.exact(plan,{'schema','status','productionAdmission','scope','target','allocationPlan','materialPins','binaryPins','caps','policy','budgetTotals'},'ONE_SHOT_PLAN')
 if plan['schema']!=1 or plan['status']!='PENDING_AUTHORITY' or plan['productionAdmission'] is not False or plan['scope']!=SCOPE or plan['target']!=TARGET or plan['caps']!=CAPS or plan['policy']!=POLICY:raise c.ContractHold('ONE_SHOT_PENDING_CLOSED_SCOPE')
 allocation_plan(plan['allocationPlan']);t=plan['allocationPlan']['manifestTemplate'];m=dict(t,uid=1,gid=1,groups=[1]);c.validate_staging(m)
 c.exact(materials,MATERIAL_NAMES,'ONE_SHOT_MATERIAL_SET');c.exact(plan['materialPins'],MATERIAL_NAMES,'ONE_SHOT_MATERIAL_PIN_SET')
 if any(type(b) is not bytes or len(b)>CAPS['materialFileBytes'] or hashlib.sha256(b).hexdigest()!=plan['materialPins'][n] for n,b in materials.items()) or sum(map(len,materials.values()))>CAPS['materialTotalBytes']:raise c.ContractHold('ONE_SHOT_MATERIAL_PINS_CAPS')
 if {n:plan['materialPins'][n] for n in c.STAGING_SOURCES}!=m['sourceFiles']:raise c.ContractHold('ONE_SHOT_HOLDER_PARITY')
 expected={'controller':(33554432,16,20),'watchdog':(33554432,16,20),'supervisor':(33554432,8,10),'cleanup':(33554432,8,10)}
 for role,(mem,tasks,cpu) in expected.items():
  b=m['resources'][role] if role in c.ROLES else m['intervention']['budgets'][role]
  if (b['memoryMaxBytes'],b['tasksMax'],b['cpuQuotaPercent'],b['memorySwapMaxBytes'])!=(mem,tasks,cpu,0):raise c.ContractHold('ONE_SHOT_EXACT_128MIB_BUDGETS')
 if plan['budgetTotals']!={'services':4,'memoryMaxBytes':134217728,'tasksMax':48,'cpuQuotaPercent':60,'memorySwapMaxBytes':0}:raise c.ContractHold('ONE_SHOT_TOTAL_BUDGETS')
 names={'/usr/bin/python3.10','/usr/bin/systemctl','/usr/sbin/groupadd','/usr/sbin/useradd','/usr/sbin/userdel','/usr/sbin/groupdel'};c.exact(plan['binaryPins'],names,'ONE_SHOT_BINARY_PINS')
 for path,p in plan['binaryPins'].items():
  c.exact(p,{'dev','ino','size','sha256'},'ONE_SHOT_BINARY_PIN_SHAPE')
  if any(not c.intpos(p[k]) for k in ('dev','ino','size')) or not c.HEX(64,p['sha256']):raise c.ContractHold('ONE_SHOT_BINARY_PIN_TYPES')
 py=m['python']
 if py['resolved'] not in names or {k:py[k] for k in ('dev','ino','size','sha256')}!=plan['binaryPins'][py['resolved']]:raise c.ContractHold('ONE_SHOT_PYTHON_PARITY')
 return copy.deepcopy(plan)

class OneShot:
 def __init__(self,plan,materials):self.plan=validate(plan,materials);self.materials=dict(materials);self.used=False
 def run(self,*,authority_check=None,effects=None):
  # A JSON field, approved_binding, a peer message or a boolean cannot select
  # this path. Caller owns authentication, source evidence and exact scope.
  if authority_check is None:return {'status':'PENDING_AUTHORITY','productionAdmission':False,'attempted':False}
  if not callable(authority_check):raise c.ContractHold('ONE_SHOT_TRUSTED_AUTHORITY_CHECK_REQUIRED')
  if self.used:raise c.ContractHold('ONE_SHOT_NO_RETRY')
  checked=c.digest(self.plan);result=authority_check(copy.deepcopy(self.plan)) # must raise unless original authority covers the effects
  if result is not None or c.digest(self.plan)!=checked:raise c.ContractHold('ONE_SHOT_AUTHORITY_CHECK_NOT_A_BINDING_OR_BOOLEAN')
  validate(self.plan,self.materials)
  self.used=True;stage='PREFLIGHT';ledger=[]
  try:
   io=RealEffects(self.plan,self.materials) if effects is None else effects
   io.preflight();ledger.append(stage)
   stage='ALLOCATE_FREEZE';allocated=io.allocate();m=allocated['manifest'];c.validate_staging(m)
   template={k:v for k,v in m.items() if k not in ('uid','gid','groups')}
   if template!=self.plan['allocationPlan']['manifestTemplate'] or m['groups']!=[m['gid']]:raise c.ContractHold('ONE_SHOT_RETURNED_MANIFEST_PARITY')
   ledger.append(stage);stage='INSTALL';prepared=io.install(m);ledger.append(stage)
   if prepared.get('status')!='ROOT_FILES_AND_ACCOUNT_PREPARED_NOT_STARTED' or prepared.get('productionAdmission') is not False or prepared.get('accountDisposition')!='REMOVE_IF_EXACT_UNUSED':raise c.ContractHold('ONE_SHOT_PREPARED_NOT_ADMITTED')
   stage='START';io.start(m);ledger.append(stage)
   stage='AWAIT_ORIGINAL_CLOSEOUT';io.await_closeout(m);ledger.append(stage)
   stage='FINALIZE_FREEZE';closed=io.finalize(m,prepared);ledger.append(stage)
   frozen=closed['retirement'];ticket=frozen['ticket']
   if frozen.get('notScheduled') is not True or ticket.get('status')!='PROPOSED_PENDING_OWNER_AUTHORITY_NO_SCHEDULE' or frozen.get('ticketDigest')!=c.digest(ticket) or ticket['manifestDigest']!=c.digest(m) or ticket['epoch']!=m['epoch'] or ticket['notBeforeUnixProposed']<closed['closedAtUnix']+86400:raise c.ContractHold('ONE_SHOT_CLOSED_TICKET_BINDING')
   # Deliberately do NOT call Retirement.execute, create a timer or accept an
   # approved_binding. Future authority and parent-managed scheduling are separate.
   return {'status':'CLOSED_FOLLOWTHROUGH_HANDOFF_REQUIRED_NOT_SCHEDULED','productionAdmission':False,'planDigest':c.digest(self.plan),'manifestDigest':c.digest(m),'stages':ledger,'closed':closed,'followthrough':{'status':'REQUIRES_PARENT_SCHEDULE_CONFIRMATION','atUnix':ticket['notBeforeUnixProposed'],'ticketDigest':frozen['ticketDigest'],'epoch':m['epoch'],'scope':POLICY['followup'],'retirementApproval':POLICY['retire']}}
  except Exception:
   return {'status':'HOLD_NO_RETRY_NO_AUTOMATIC_ROLLBACK','productionAdmission':False,'failedStage':stage,'completedStages':ledger,'residualsMayExist':stage!='PREFLIGHT','followthrough':'REPORT_HOLD_PRIVATE_NO_AUTOMATIC_DELETE'}
  finally:
   if 'io' in locals():
    try:io.close_handles()
    except Exception:return {'status':'HOLD_NO_RETRY_NO_AUTOMATIC_ROLLBACK','productionAdmission':False,'failedStage':'HANDLE_CLOSE_UNVERIFIED','completedStages':ledger,'residualsMayExist':stage!='PREFLIGHT','followthrough':'REPORT_HOLD_PRIVATE_NO_AUTOMATIC_DELETE'}

class TrackedSeed(AllocationSeedJournal):
 def __init__(self,plan):
  self.closed=False
  try:super().__init__(plan)
  except BaseException:
   if hasattr(self,'fd'):self.close()
   raise
 def close(self):
  if not self.closed:self.closed=True;super().close()
class TrackedJournal(RootJournal):
 def __init__(self,m):
  self.closed=False
  try:super().__init__(m)
  except BaseException:
   if not self.closed:self.close()
   raise
 def close(self):
  if not self.closed:
   self.closed=True
   try:
    if hasattr(self,'fd'):os.close(self.fd)
   finally:
    if hasattr(self,'d'):os.close(self.d)
class BudgetRunner(FixedRunner):
 def __init__(self,m):super().__init__(m);self.commands=0
 def invoke(self,*args):
  if self.commands>=CAPS['externalManagerCommandsMax']:raise c.ContractHold('ONE_SHOT_EXTERNAL_MANAGER_COMMAND_CAP')
  self.commands+=1;return super().invoke(*args)

class RealEffects:
 """Root-only implementations. Construction does not run commands or write.
 Every effects boundary is injectable only through an explicit LOCAL test fake.
 Utilities are bounded by known per-field/time caps, NOT the service cgroups.
 Kernel/filesystem stalls are not guaranteed interruptible. No universal deadline.
 """
 def __init__(self,plan,materials):
  self.plan=plan;self.materials=materials;self.m=dict(plan['allocationPlan']['manifestTemplate'],uid=1,gid=1,groups=[1]);self.allocation=None;self.journal=None;self.seed=None;self.runner=None;self.binary_passes=0
 def absent(self,path):
  # Missing ancestor means absent only after exact safe nofollow traversal.
  current=Path('/')
  for part in Path(path).parts[1:]:
   current=current/part
   try:s=current.lstat()
   except FileNotFoundError:return
   if str(current)==path:raise c.ContractHold('ONE_SHOT_TARGET_EXISTS')
   if not stat.S_ISDIR(s.st_mode) or s.st_uid!=0 or s.st_mode&0o022 or current.resolve()!=current:raise c.ContractHold('ONE_SHOT_TARGET_ANCESTOR')
 def hostkey(self):
  # Nonsecret host key only, same pin supplied by owner. No private key read.
  p=Path(TARGET['hostKeyPublicFile']);c.ancestors(p.parent,0);raw,key=c.bounded_file(p,4096,uid=0)
  parts=raw.split()
  if len(parts)<2 or parts[0]!=b'ssh-ed25519':raise c.ContractHold('ONE_SHOT_TARGET_HOSTKEY_TYPE')
  try:blob=base64.b64decode(parts[1],validate=True)
  except ValueError:raise c.ContractHold('ONE_SHOT_TARGET_HOSTKEY_SCHEMA') from None
  if len(blob)!=51 or blob[:19]!=b'\x00\x00\x00\x0bssh-ed25519\x00\x00\x00\x20':raise c.ContractHold('ONE_SHOT_TARGET_HOSTKEY_SCHEMA')
  fingerprint='SHA256:'+base64.b64encode(hashlib.sha256(blob).digest()).decode().rstrip('=')
  if fingerprint!=TARGET['hostKeySha256']:raise c.ContractHold('ONE_SHOT_TARGET_HOSTKEY_MISMATCH')
 def binaries(self):
  if self.binary_passes>=CAPS['binaryPassesMax']:raise c.ContractHold('ONE_SHOT_BINARY_PASS_CAP')
  self.binary_passes+=1
  if str(Path('/usr/bin/python3').resolve())!=self.m['python']['resolved']:raise c.ContractHold('ONE_SHOT_PYTHON_ALIAS')
  for path,p in self.plan['binaryPins'].items():
   c.ancestors(Path(path).parent,0);data,key=c.bounded_file(Path(path),16777216,uid=0,gid=0,mode=0o755)
   if Path(path).resolve()!=Path(path) or {k:key[k] for k in ('dev','ino','size','sha256')}!=p:raise c.ContractHold('ONE_SHOT_LIVE_BINARY_PIN')
 def preflight(self):
  if os.getuid()!=0 or os.geteuid()!=0:raise c.ContractHold('ONE_SHOT_REAL_ROOT_REQUIRED')
  self.hostkey();self.binaries();m=self.m;i=m['intervention'];pins={n:self.plan['materialPins'][n] for n in EXECUTOR_NAMES}
  targets=[m['sourceRoot'],m['configRoot'],m['runtimeRoot'],i['gateRoot'],i['canaryRoot'],i['controlRoot'],'/var/lib/ers-ensayo-bootstrap-'+m['epoch']+'.jsonl','/opt/ers-retirement/'+c.digest(pins),'/var/lib/ers-ensayo-retirement/'+m['epoch']]+['/etc/systemd/system/'+u for u in list(m['units'].values())+[i['supervisorUnit'],i['cleanupUnit']]]
  for p in targets:self.absent(p)
  # Existing safe shared parents are not owned/adopted/repaired. Match exact
  # bootstrap/retirement modes before account allocation begins.
  for p,mode in (('/opt/ers',0o755),('/etc/ers-ensayo',0o755),('/var/lib/ers-ensayo-control',0o755),('/opt/ers-retirement',0o755),('/var/lib/ers-ensayo-retirement',0o700)):
   c.ancestors(Path(p).parent,0)
   try:s=Path(p).lstat()
   except FileNotFoundError:continue
   if not stat.S_ISDIR(s.st_mode) or s.st_uid or s.st_gid or stat.S_IMODE(s.st_mode)!=mode or Path(p).resolve()!=Path(p):raise c.ContractHold('ONE_SHOT_SHARED_PARENT_CUSTODY')
  self.runner=BudgetRunner(m)
  for unit in list(m['units'].values())+[i['supervisorUnit'],i['cleanupUnit']]:
   o=self.runner.invoke('show',unit)
   if o['LoadState']!='not-found' or o['ActiveState']!='inactive' or o['SubState']!='dead' or o['FragmentPath'] or o['DropInPaths'] or o['ControlGroup'] or o['NeedDaemonReload']!='no' or o['MainPID']!='0' or o['ControlPID']!='0':raise c.ContractHold('ONE_SHOT_UNIT_NOT_ABSENT')
  n=NSS()
  if n.user_name('ers-ensayo') is not None or n.group_name('ers-ensayo') is not None:raise c.ContractHold('ONE_SHOT_PRINCIPAL_COLLISION')
  StartController(m,None,runner=self.runner).capacity()
 def allocate(self):
  self.binaries();self.seed=TrackedSeed(self.plan['allocationPlan']);self.allocation=Allocation(self.plan['allocationPlan'],self.seed);out=self.allocation.allocate();self.m=out['manifest'];self.runner.m=c.validate_staging(self.m);return out
 def install(self,m):
  self.binaries()
  return execute_prepared_bundle(m,{n:self.materials[n] for n in c.STAGING_SOURCES},{n:self.materials[n] for n in CONTROL},retirement_bytes={n:self.materials[n] for n in EXECUTOR_NAMES},account_disposition='REMOVE_IF_EXACT_UNUSED',allocation=self.allocation)
 def start(self,m):
  self.binaries();self.journal=TrackedJournal(m);return StartController(m,self.journal,runner=self.runner).launch()
 def await_closeout(self,m):
  deadline=time.monotonic()+CAPS['waitSeconds']
  while time.monotonic()<deadline:
   rows=self.journal.rows();done=[r for r in rows if r['op']=='ROOT_CONTROL_COMPLETE'];actors=[r for r in rows if r['op']=='ROOT_CUSTODIAN_ORIGINAL']
   if len(done)>1 or len(actors)>2:raise c.ContractHold('ONE_SHOT_DUPLICATE_CLOSEOUT')
   if done:
    if done[0].get('status')!='HOLDER_OBJECTS_REMOVED_ROOT_RESIDUALS_REQUIRE_FINALIZER' or {a['role'] for a in actors}!={'supervisor','cleanup'}:raise c.ContractHold('ONE_SHOT_INCOMPLETE_CLOSEOUT')
    stopped=True
    for a in actors:
     o=self.runner.invoke('show',m['intervention'][a['role']+'Unit'])
     if o['InvocationID']!=a['invocation']:raise c.ContractHold('ONE_SHOT_CUSTODIAN_REUSE')
     if o['ActiveState'] not in ('inactive','failed') or o['MainPID']!='0' or o['ControlPID']!='0':stopped=False;continue
     try:identity(a['identity']['pid'])
     except FileNotFoundError:continue
     raise c.ContractHold('ONE_SHOT_ORIGINAL_PID_STILL_PRESENT')
    if stopped:return
   time.sleep(CAPS['pollMillis']/1000)
  raise c.ContractHold('ONE_SHOT_CLOSEOUT_DEADLINE')
 def external_retirement(self,m,prepared):
  root=Path(prepared['retirementExecutorRoot']);expected={n:self.plan['materialPins'][n] for n in EXECUTOR_NAMES}
  if prepared['retirementExecutorPins']!=expected or str(root)!='/opt/ers-retirement/'+c.digest(expected):raise c.ContractHold('ONE_SHOT_EXTERNAL_EXECUTOR_BINDING')
  c.ancestors(root,0)
  if sorted(p.name for p in root.iterdir())!=sorted(expected):raise c.ContractHold('ONE_SHOT_EXTERNAL_EXECUTOR_CONTENTS')
  for n,h in expected.items():
   data,key=c.bounded_file(root/n,1048576,uid=0,gid=0,mode=0o444)
   if key['sha256']!=h:raise c.ContractHold('ONE_SHOT_EXTERNAL_EXECUTOR_HASH')
  name='_ers_retirement_'+m['epoch']
  if any(k==name or k.startswith(name+'.') for k in sys.modules):raise c.ContractHold('ONE_SHOT_EXTERNAL_PACKAGE_NO_REUSE')
  package=types.ModuleType(name);package.__path__=[str(root)];sys.modules[name]=package
  return importlib.import_module(name+'.ensayo_retirement').Retirement(m,runner=self.runner)
 def finalize(self,m,prepared):
  self.binaries();retire=self.external_retirement(m,prepared);principal=PrincipalRetire(m,self.journal);finalizer=Finalizer(m,self.journal,manager=self.runner,account_remove=principal.remove)
  # >=24h after actual seal. Allow120s for preparation/finalizer. If exceeded,
  # HOLD after effects, never claim the earlier proposal is a24h retention.
  not_before=math.ceil(time.time())+86400+CAPS['preFinalizeAllowanceSeconds']
  closed=finalizer.finish_and_freeze(retire,seed_original=prepared['seedOriginal'],not_before=not_before,executor_pins=prepared['retirementExecutorPins'])
  now=math.ceil(time.time())
  if now+86400>not_before:raise c.ContractHold('ONE_SHOT_RETENTION_MINIMUM_NOT_MET')
  closed['closedAtUnix']=now;return closed
 def close_handles(self):
  # These are original process-local FDs only. Never stop/delete/retry here.
  failed=False
  for holder in (self.journal,self.seed):
   if holder is not None and not holder.closed:
    try:holder.close()
    except OSError:failed=True
  if failed:raise c.ContractHold('ONE_SHOT_HANDLE_CLOSE_UNVERIFIED')

def load_prepared(plan_path,material_directory,*,expected_plan_sha256):
 """Read public reviewed inputs only, no effects. expected hash selects bytes,
 NOT approval. No secret or command string is accepted. No CLI is provided.
 """
 if not c.HEX(64,expected_plan_sha256):raise c.ContractHold('ONE_SHOT_EXACT_PLAN_PIN')
 p=Path(plan_path);s=p.lstat()
 if not stat.S_ISREG(s.st_mode) or s.st_nlink!=1 or s.st_size>65536 or p.resolve()!=p:raise c.ContractHold('ONE_SHOT_PLAN_FILE')
 raw=p.read_bytes()
 if len(raw)>65536 or hashlib.sha256(raw).hexdigest()!=expected_plan_sha256:raise c.ContractHold('ONE_SHOT_PLAN_FILE_PIN')
 plan=c.load_json(raw);root=Path(material_directory)
 if root.resolve()!=root:raise c.ContractHold('ONE_SHOT_MATERIAL_DIRECTORY')
 materials={}
 for n in MATERIAL_NAMES:
  f=root/n;s=f.lstat()
  if not stat.S_ISREG(s.st_mode) or s.st_nlink!=1 or s.st_size>1048576 or f.resolve()!=f:raise c.ContractHold('ONE_SHOT_MATERIAL_FILE')
  materials[n]=f.read_bytes()
 return OneShot(plan,materials)
