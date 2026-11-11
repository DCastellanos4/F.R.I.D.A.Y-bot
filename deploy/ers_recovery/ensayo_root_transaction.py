"""Root-intervention transaction semantics exercised through a mapped fixture.
No production/root transport exists here. Simulated manager/account/kernel facts
are named as such and never become OS admission. No subprocess, SSH or systemctl.
"""
import hashlib,os,secrets,stat,time
from pathlib import Path
from . import ensayo_os as c
from .ensayo_intervention import render_control_units
from .ensayo_fixture_executor import Ledger,namespace,inspect_at,sync_dir

CLASS='ROOT_TRANSACTION_FIXTURE_NOT_ROOT_EXECUTION'
class Crash(RuntimeError):pass

class FixtureRootBackend:
 """Closed mapped filesystem and independent simulated manager clock.
 Semantic metadata is separate from real local file identity. No chown/accounts,
 kernel containment, NSS, resource capacity or manager facts are actually proved.
 """
 def __init__(self,root,m):
  self.root=namespace(root,'ers-ensayo-rootfixture-',exists=True);self.m=c.validate_staging(m);self.objects={};self.units={};self.account=None;self.timer=None;self.clock=0;self.calls=[];self.nextpid=10000;self.scopes={}
  self.rootfd=os.open(self.root,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW|os.O_CLOEXEC);s=os.fstat(self.rootfd);self.rootkey=(s.st_dev,s.st_ino)
 def guard(self):
  s=self.root.lstat()
  if (s.st_dev,s.st_ino)!=self.rootkey or self.root.resolve()!=self.root:c.reject('ROOTFIXTURE_ROOT_DRIFT')
 def allowed(self):
  m=self.m;i=m['intervention']
  return {m['sourceRoot'],m['configRoot'],m['runtimeRoot'],i['controlRoot'],i['canaryRoot']}|{m['sourceRoot']+'/'+n for n in c.STAGING_SOURCES}|set(m['configs'].values())|set(m['paths'].values())|{'/etc/systemd/system/'+m['units'][r] for r in c.ROLES}|{'/etc/systemd/system/'+i[k] for k in ('supervisorUnit','cleanupUnit')}|{'/etc/systemd/system/ers-ensayo-cleanup-'+m['epoch']+'.timer'}|{i['controlRoot']+'/'+n for n in ('supervisor.py','cleanup.py','supervisor.json','cleanup.json')}|{i['canaryRoot']+'/'+n for n in ('public.txt','channel.sock')}
 def name(self,path):
  if path not in self.allowed():c.reject('ROOTFIXTURE_PATH_NOT_CLOSED')
  return hashlib.sha256(path.encode()).hexdigest()
 def snapshot(self,path):
  self.guard();name=self.name(path)
  if path not in self.objects:
   try:os.stat(name,dir_fd=self.rootfd,follow_symlinks=False)
   except FileNotFoundError:return None
   c.reject('ROOTFIXTURE_UNOWNED_COLLISION')
  original=self.objects[path]
  try:actual=inspect_at(self.rootfd,name)
  except OSError:c.reject('ROOTFIXTURE_OBJECT_MISSING_OR_UNREADABLE')
  if actual!=original['actual']:c.reject('ROOTFIXTURE_OBJECT_IDENTITY_DRIFT')
  return original
 def create(self,path,data,*,owner,group,mode,kind='file'):
  self.guard();name=self.name(path)
  if self.snapshot(path) is not None:c.reject('ROOTFIXTURE_NO_REPLACE')
  if kind not in ('file','directory','socket'):c.reject('ROOTFIXTURE_KIND')
  # Socket/dir in this backend are semantically simulated records; this class
  # cannot attest a real AF_UNIX deny or root-owned filesystem inode.
  fd=os.open(name,os.O_CREAT|os.O_EXCL|os.O_WRONLY|os.O_NOFOLLOW|os.O_CLOEXEC,0o600,dir_fd=self.rootfd)
  try:
   if os.write(fd,data)!=len(data):c.reject('ROOTFIXTURE_SHORT_WRITE')
   os.fsync(fd)
  finally:os.close(fd)
  sync_dir(self.rootfd);value={'actual':inspect_at(self.rootfd,name),'declared':{'kind':kind,'uid':owner,'gid':group,'mode':mode,'sha256':hashlib.sha256(data).hexdigest() if kind=='file' else None},'class':CLASS};self.objects[path]=value;self.calls.append(('create',path));return value
 def remove(self,path,want):
  if self.snapshot(path)!=want:c.reject('ROOTFIXTURE_REMOVE_DRIFT')
  os.unlink(self.name(path),dir_fd=self.rootfd);sync_dir(self.rootfd);del self.objects[path];self.calls.append(('remove',path))
 def reserve_fixture_principal(self):
  if self.account is not None:c.reject('ROOTFIXTURE_PRINCIPAL_COLLISION')
  self.account={'user':'ers-ensayo','group':'ers-ensayo','uid':self.m['uid'],'gid':self.m['gid'],'class':CLASS,'nss':'NOT_OBSERVED_FIXTURE_ONLY'};self.calls.append(('reserve_fixture_principal',None));return dict(self.account)
 def retire_fixture_principal(self,original):
  if self.account!=original or any(u['active'] for u in self.units.values()):c.reject('ROOTFIXTURE_PRINCIPAL_DRIFT_OR_LIVE')
  self.account=None;self.calls.append(('retire_fixture_principal',None))
 def arm(self,unit,source_pin,cleanup_name):
  if self.timer is not None:c.reject('ROOTFIXTURE_TIMER_NO_REARM')
  self.timer={'unit':unit,'sourcePin':source_pin,'cleanup':cleanup_name,'deadline':self.clock+60,'armed':True,'class':CLASS};self.calls.append(('arm_independent_fixture_timer',unit));return dict(self.timer)
 def reserve_scope(self,role):
  if role not in c.ROLES or role in self.scopes or self.m['units'][role] in self.units:c.reject('ROOTFIXTURE_SCOPE_NO_ADOPT')
  scope={'role':role,'unit':self.m['units'][role],'path':'/system.slice/'+self.m['units'][role],'key':[27,20000+len(self.scopes)],'nonce':secrets.token_hex(32),'owner':0,'delegated':False,'sourceDigest':c.digest(self.m['sourceFiles']),'class':CLASS}
  self.scopes[role]={'reservation':scope,'members':[]};self.calls.append(('reserve_empty_exclusive_scope',role));return dict(scope)
 def scope_census(self,reservation):
  role=reservation['role'];scope=self.scopes.get(role)
  if scope is None or scope['reservation']!=reservation or reservation['owner']!=0 or reservation['delegated'] is not False:c.reject('ROOTFIXTURE_SCOPE_CUSTODY_DRIFT')
  unit=self.units.get(reservation['unit'])
  if unit is not None and unit['active'] and not any(v.get('original') for v in scope['members']):c.reject('ROOTFIXTURE_MANAGER_WITHOUT_SCOPE_ORIGINAL')
  for member in scope['members']:
   if member['scopeNonce']!=reservation['nonce'] or member['origin']!='EXCLUSIVE_FIXTURE_SPAWN_LINEAGE' or member['uid']!=self.m['uid']:c.reject('ROOTFIXTURE_FOREIGN_SCOPE_DESCENDANT')
  return [dict(v) for v in scope['members']]
 def scope_complete_check(self,reservation):
  members=self.scope_census(reservation)
  # New proposed authority is explicit: all descendants in this exact owned scope.
  for member in members:
   unit=self.units.get(reservation['unit'])
   if member.get('original') and (unit is None or unit['identity']!=member['identity'] or unit['invocation']!=member['invocation'] or unit['cgroupKey']!=reservation['key']):c.reject('ROOTFIXTURE_SCOPE_MANAGER_DRIFT')
  return members
 def stop_scope(self,reservation):
  members=self.scope_complete_check(reservation)
  self.scopes[reservation['role']]['members']=[]
  if reservation['unit'] in self.units:self.units[reservation['unit']]['active']=False
  self.calls.append(('stop_all_exact_scope_descendants',reservation['role']));return {'reservation':reservation,'terminated':[v['identity'] for v in members],'remaining':[],'class':CLASS,'authority':'PROPOSED_ALL_DESCENDANTS_NOT_ORIGINAL_PID_ONLY'}

 def start(self,unit,role):
  if self.timer is None or not self.timer['armed'] or self.clock>=self.timer['deadline']:c.reject('ROOTFIXTURE_TIMER_REQUIRED_BEFORE_START')
  if unit in self.units:c.reject('ROOTFIXTURE_NO_RESTART')
  if role not in self.scopes:c.reject('ROOTFIXTURE_DURABLE_SCOPE_REQUIRED')
  reservation=self.scopes[role]['reservation']
  if self.scope_census(reservation):c.reject('ROOTFIXTURE_SCOPE_MUST_BE_EMPTY')
  self.nextpid+=1;identity={'pid':self.nextpid,'start':str(self.clock+100),'boot':'b'*8+'-'+'b'*4+'-'+'b'*4+'-'+'b'*4+'-'+'b'*12};value={'unit':unit,'role':role,'identity':identity,'invocation':format(self.nextpid,'032x'),'cgroup':'/system.slice/'+unit,'cgroupKey':reservation['key'],'active':True,'class':CLASS};self.units[unit]=value;self.scopes[role]['members'].append({'identity':identity,'invocation':value['invocation'],'uid':self.m['uid'],'scopeNonce':reservation['nonce'],'origin':'EXCLUSIVE_FIXTURE_SPAWN_LINEAGE','original':True});self.calls.append(('start',unit));return dict(value)
 def stop_exact(self,original):
  current=self.units.get(original['unit'])
  if current!=original:c.reject('ROOTFIXTURE_UNIT_IDENTITY_DRIFT')
  current['active']=False;self.calls.append(('stop_exact',original['unit']));return {'expected':original['identity'],'result':'FIXTURE_ORIGINAL_ABSENT','class':CLASS}
 def death(self,original):
  current=self.units.get(original['unit'])
  if current is None or {k:v for k,v in current.items() if k!='active'}!={k:v for k,v in original.items() if k!='active'} or current['active']:c.reject('ROOTFIXTURE_ABSENCE_UNVERIFIED')
  return {'expected':original['identity'],'result':'FIXTURE_ORIGINAL_ABSENT','class':CLASS}
 def probe(self,role):
  if role not in c.ROLES:c.reject('ROOTFIXTURE_PROBE_ROLE')
  # Explicitly simulated outcomes, not actual kernel syscall observations.
  return {'role':role,'class':CLASS,'canaryRead':'SIMULATED_DENIED','canaryConnect':'SIMULATED_DENIED','sourceWrite':'SIMULATED_DENIED','configWrite':'SIMULATED_DENIED','runtimeWrite':'SIMULATED_ALLOWED'}
 def manager(self,unit):
  if unit not in self.units:c.reject('ROOTFIXTURE_MANAGER_MISSING')
  return dict(self.units[unit])
 def close(self):os.close(self.rootfd)

class RootTransactionFixture:
 """One no-retry transaction with independently replayable durable control log.
 A real backend must be separately built/reviewed/authorized; this constructor
 accepts exactly FixtureRootBackend so no generic adapter smuggles root effects.
 """
 def __init__(self,backend,control,*,create=True):
  if type(backend) is not FixtureRootBackend:c.reject('ROOT_EXECUTION_BACKEND_ABSENT')
  self.b=backend;self.m=backend.m;self.log=Ledger(control,create=create)
  if create:self.log.append({'op':'ROOT_BEGIN','class':CLASS,'manifestDigest':c.digest(self.m)})
 def rows(self):
  rows=self.log.read()
  if not rows or rows[0]!={'op':'ROOT_BEGIN','class':CLASS,'manifestDigest':c.digest(self.m)}:c.reject('ROOTFIXTURE_LEDGER_BINDING')
  return rows
 def mutate(self,op,target,action,*,crash=None):
  # Existing outstanding intent prohibits all subsequent mutation, not only retry.
  self.reconcile()
  self.log.append({'op':'ROOT_INTENT','action':op,'target':target})
  if crash=='before':raise Crash('FIXTURE_CRASH_BEFORE_EFFECT')
  result=action()
  if crash=='after':raise Crash('FIXTURE_CRASH_AFTER_EFFECT_BEFORE_RECEIPT')
  self.log.append({'op':'ROOT_DONE','action':op,'target':target,'result':result});return result
 def reconcile(self,*,allow_pending=False):
  pending=None;done=[]
  for row in self.rows()[1:]:
   if row['op']=='ROOT_INTENT':
    if pending is not None:c.reject('ROOTFIXTURE_PENDING_AMBIGUITY')
    pending=row
   elif row['op']=='ROOT_DONE':
    if pending is None or (row['action'],row['target'])!=(pending['action'],pending['target']):c.reject('ROOTFIXTURE_RECEIPT_WITHOUT_INTENT')
    done.append(row);pending=None
   else:c.reject('ROOTFIXTURE_UNKNOWN_LEDGER_ROW')
  if pending is not None:
   if allow_pending:return done,pending
   c.reject('ROOTFIXTURE_UNCERTAIN_EFFECT_HOLD_NO_RETRY')
  return (done,None) if allow_pending else done
 def install(self,sources,control_programs,*,account_disposition):
  m=self.m;i=m['intervention']
  if account_disposition not in ('REMOVE_IF_EXACT_UNUSED','RETAIN_EXPLICIT_OWNER_ACCEPTED'):c.reject('ROOTFIXTURE_ACCOUNT_DECISION_REQUIRED')
  if type(sources) is not dict or set(sources)!=c.STAGING_SOURCES or any(type(v) is not bytes or len(v)>1048576 or hashlib.sha256(v).hexdigest()!=m['sourceFiles'][n] for n,v in sources.items()):c.reject('ROOTFIXTURE_EXACT_SOURCE_BYTES')
  c.exact(control_programs,{'supervisor','cleanup'},'ROOTFIXTURE_CONTROL_SOURCE_SET')
  if any(type(v) is not bytes or len(v)>1048576 for v in control_programs.values()):c.reject('ROOTFIXTURE_CONTROL_SOURCE_BYTES')
  if self.reconcile():c.reject('ROOTFIXTURE_INSTALL_NO_RETRY')
  pins={role:{'path':i['controlRoot']+'/'+role+'.py','sha256':hashlib.sha256(v).hexdigest()} for role,v in control_programs.items()};control=render_control_units(m,pins['supervisor'],pins['cleanup'])
  # Capacities are explicit fixture inputs, never claimed from HOST/preflight.
  self.mutate('ACCOUNT_DECISION','ers-ensayo',lambda:{'disposition':account_disposition,'class':CLASS})
  self.mutate('RESERVE','ers-ensayo',self.b.reserve_fixture_principal)
  def put(path,data,owner=0,group=0,mode=0o444,kind='file'):
   return self.mutate('CREATE',path,lambda:self.b.create(path,data,owner=owner,group=group,mode=mode,kind=kind))
  for root,uid,gid,mode in [(m['sourceRoot'],0,0,0o755),(m['configRoot'],0,m['gid'],0o750),(m['runtimeRoot'],m['uid'],m['gid'],0o700),(i['controlRoot'],0,0,0o700),(i['canaryRoot'],0,0,0o755)]:put(root,b'',uid,gid,mode,'directory')
  for n,data in sorted(sources.items()):put(m['sourceRoot']+'/'+n,data)
  for role in c.ROLES:put(m['configs'][role],c.encode({'manifest':m,'role':role,'token':'0'*64}),group=m['gid'],mode=0o440)
  for role,data in control_programs.items():put(pins[role]['path'],data,mode=0o400)
  for role,text in c.render_staging(m)['sources'].items():put('/etc/systemd/system/'+m['units'][role],text.encode())
  for role,text in control['units'].items():put('/etc/systemd/system/'+i[role+'Unit'],text.encode())
  timerpath='/etc/systemd/system/ers-ensayo-cleanup-'+m['epoch']+'.timer';put(timerpath,control['cleanupTimer'].encode());put(i['canaryRoot']+'/public.txt',b'ERS_PUBLIC_CANARY_V1\n');put(i['canaryRoot']+'/channel.sock',b'',kind='socket')
  self.mutate('GLOBAL_RELOAD_DECLARED','manager',lambda:{'class':CLASS,'effect':'SIMULATED_GLOBAL_DAEMON_RELOAD_NOT_SCOPED_TO_UNITS'})
  for role in c.ROLES:self.mutate('RESERVE_SCOPE',role,lambda r=role:self.b.reserve_scope(r))
  self.mutate('ARM',timerpath,lambda:self.b.arm(timerpath,pins['cleanup']['sha256'],i['cleanupUnit']))
  return {'class':CLASS,'status':'FIXTURE_ROOT_INSTALL_TRANSACTION_PREPARED','productionAdmission':False}
 def start_and_validate(self,capacity,*,crash=None):
  m=self.m;head=m['intervention']['headroom'];c.exact(capacity,{'class','memoryAvailableBytes','parentPidsFree'},'ROOTFIXTURE_CAPACITY_SHAPE')
  if capacity['class']!=CLASS or type(capacity['memoryAvailableBytes']) is not int or type(capacity['parentPidsFree']) is not int or capacity['memoryAvailableBytes']<head['memoryAvailableMinBytes'] or capacity['parentPidsFree']<head['parentPidsFreeMin']:c.reject('ROOTFIXTURE_CAPACITY_NO_START')
  done=self.reconcile()
  if any(r['action']=='START' for r in done) or not any(r['action']=='ARM' for r in done):c.reject('ROOTFIXTURE_LIFECYCLE_NO_START')
  reservations={r['target']:r['result'] for r in done if r['action']=='RESERVE_SCOPE'}
  if set(reservations)!=set(c.ROLES):c.reject('ROOTFIXTURE_EXACT_RESERVATIONS_REQUIRED')
  # All-or-hold admission before the first durable START intent.
  for role in c.ROLES:
   if self.b.scope_complete_check(reservations[role]) or reservations[role]['sourceDigest']!=c.digest(m['sourceFiles']):c.reject('ROOTFIXTURE_SCOPE_NOT_EMPTY_OR_SOURCE')
  for role in c.ROLES:
   if self.b.scope_complete_check(reservations[role]):c.reject('ROOTFIXTURE_SCOPE_MUST_BE_EMPTY')
   self.mutate('START',role,lambda r=role:self.b.start(m['units'][r],r),crash=crash)
  originals={r['target']:r['result'] for r in self.reconcile() if r['action']=='START'}
  if set(originals)!=set(c.ROLES):c.reject('ROOTFIXTURE_ORIGINAL_SET')
  for role,original in originals.items():
   if self.b.manager(original['unit'])!=original:c.reject('ROOTFIXTURE_MANAGER_DRIFT')
   self.mutate('PROBE',role,lambda r=role:self.b.probe(r))
  return {'class':CLASS,'status':'SIMULATED_ROOT_LIFECYCLE_NOT_OS_GATE','productionAdmission':False,'kernelContainment':'UNVERIFIED','effectAdapter':'ABSENT'}
 def cleanup(self):
  done,pending=self.reconcile(allow_pending=True)
  reservations={r['target']:r['result'] for r in done if r['action']=='RESERVE_SCOPE'}
  if pending is not None:
   # Only uncertain START can be reconciled via a previously durable empty scope.
   # No guessed PID or adoption of unknown units; no rerun of START.
   role=pending['target']
   if pending['action']!='START' or role not in reservations or set(reservations)!=set(c.ROLES):c.reject('ROOTFIXTURE_UNCERTAIN_NONSTART_HOLD')
   reservation=reservations[role];members=self.b.scope_census(reservation)
   result={'scopeReservation':reservation,'observedMembers':members,'status':'UNCERTAIN_START_SCOPE_ONLY_NOT_PID_ADOPTION','class':CLASS}
   self.log.append({'op':'ROOT_DONE','action':'START','target':role,'result':result});done=self.reconcile()
  created={r['target']:r['result'] for r in done if r['action']=='CREATE'};removed={r['target'] for r in done if r['action']=='REMOVE'}
  originals={r['target']:r['result'] for r in done if r['action']=='START'}
  # Partial confirmed starts can be stopped by the independent custodian because
  # it owns the exact original manager/process record; uncertain spawn cannot.
  if len(originals)!=len([r for r in done if r['action']=='START']):c.reject('ROOTFIXTURE_DUPLICATE_ORIGINAL')
  for path,want in created.items():
   if path not in removed and self.b.snapshot(path)!=want:c.reject('ROOTFIXTURE_CLEANUP_PRECHECK_DRIFT')
  if set(self.b.objects)!=set(created)-removed:c.reject('ROOTFIXTURE_CLEANUP_UNKNOWN_OBJECT')
  names=os.listdir(self.b.rootfd)
  if len(names)>64 or set(names)!={self.b.name(p) for p in self.b.objects}:c.reject('ROOTFIXTURE_UNTRACKED_PHYSICAL_OBJECT')
  # Confirmed or uncertain starts both use prior exact scope custody. Inspect
  # every scope first: an unrelated member blocks BEFORE killing any process.
  for reservation in reservations.values():self.b.scope_complete_check(reservation)
  for role,reservation in reservations.items():
   if not any(r['action']=='STOP_SCOPE' and r['target']==role for r in done):self.mutate('STOP_SCOPE',role,lambda s=reservation:self.b.stop_scope(s))
   if self.b.scope_census(reservation):c.reject('ROOTFIXTURE_SCOPE_NOT_EMPTY')
  for path in sorted(set(created)-removed,key=lambda p:(created[p]['declared']['kind']=='directory',-p.count('/'),p)):
   self.mutate('REMOVE',path,lambda p=path:self.b.remove(p,created[p]))
  done=self.reconcile();reserve=next((r['result'] for r in done if r['action']=='RESERVE'),None);decision=next((r['result']['disposition'] for r in done if r['action']=='ACCOUNT_DECISION'),None)
  if decision=='REMOVE_IF_EXACT_UNUSED' and reserve is not None and not any(r['action']=='RETIRE' for r in done):self.mutate('RETIRE','ers-ensayo',lambda:self.b.retire_fixture_principal(reserve))
  elif decision=='RETAIN_EXPLICIT_OWNER_ACCEPTED':self.mutate('RESIDUAL_DISCLOSED','ers-ensayo',lambda:{'class':CLASS,'status':'ACCOUNT_GROUP_REMAIN_EXPLICIT_DECISION_REQUIRED_FOR_REAL_HOST'})
  self.mutate('GLOBAL_RELOAD_DECLARED','manager',lambda:{'class':CLASS,'effect':'SIMULATED_GLOBAL_DAEMON_RELOAD_NOT_SCOPED_TO_UNITS'})
  return {'class':CLASS,'status':'FIXTURE_EXACT_CLEANUP_COMPLETE','productionAdmission':False,'accountResidual':self.b.account is not None}
 def fire_independent_timer(self):
  timer=self.b.timer
  if timer is None or not timer['armed'] or self.b.clock<timer['deadline']:c.reject('ROOTFIXTURE_TIMER_NOT_DUE')
  # Simulated manager activation of cleanup, independent of supervisor liveness.
  return self.cleanup()
 def close(self):self.log.close()
