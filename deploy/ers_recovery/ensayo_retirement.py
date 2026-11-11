"""External control/seed retirement, never scheduled or authorized by this module.
Run from reviewed root code OUTSIDE the targets. Ticket and closeout journal are
explicit audit residuals. Proposed24h is not approval and does not trigger work.
"""
import copy,hashlib,os,stat,time
from pathlib import Path
from . import ensayo_os as c
from .ensayo_privileged_io import RootIO,FixedRunner
from .ensayo_principal_bootstrap import NSS
from .lease import identity

CONTROL_NAMES={'ensayo_privileged_io.py','ensayo_manager_collector.py','ensayo_root_journal.py','ensayo_root_custodian.py','ensayo_scope_fd.py','ensayo_scope_handoff.py','ensayo_runtime_cleanup.py','ensayo_root_install.py','ensayo_control_program.py'}
EXECUTOR_NAMES=c.STAGING_SOURCES|{'ensayo_privileged_io.py','ensayo_principal_bootstrap.py','ensayo_retirement.py'}

def paths(m):
 e=m['epoch'];base='/var/lib/ers-ensayo-retirement/'+e
 return {'shared':'/var/lib/ers-ensayo-retirement','audit':base,'ticket':base+'/ticket.json','closeout':base+'/closeout.jsonl','seed':'/var/lib/ers-ensayo-bootstrap-'+e+'.jsonl'}

class RetirementIO(RootIO):
 def __init__(self,m,*,calls=None):
  super().__init__(m,calls=calls);self.p=paths(m);self.allow.update(self.p.values())
 def read_exact(self,p,key,*,limit=131072):
  if self.snapshot(p,limit=limit)!=key:raise c.ContractHold('RETIRE_READ_PIN_DRIFT')
  d,name=self.parent(p)
  try:
   fd=self.s.open(name,os.O_RDONLY|os.O_NOFOLLOW|os.O_CLOEXEC,dir_fd=d)
   try:
    chunks=[];total=0
    while total<=limit:
     b=self.s.read(fd,min(65536,limit+1-total))
     if not b:break
     chunks.append(b);total+=len(b)
   finally:self.s.close(fd)
  finally:self.s.close(d)
  b=b''.join(chunks)
  if len(b)>limit or self.snapshot(p,limit=limit)!=key or hashlib.sha256(b).hexdigest()!=key.get('sha256'):raise c.ContractHold('RETIRE_READ_CHANGED')
  return b

class AuditJournal:
 """Exclusive external journal. A preexisting closeout is never adopted/retried."""
 def __init__(self,m,io,ticket_digest):
  self.io=io;self.path=paths(m)['closeout'];self.closed=False
  if io.snapshot(self.path) is not None:raise c.ContractHold('RETIRE_CLOSEOUT_EXISTS_HOLD_NO_RETRY')
  io.create(self.path,b'',uid=0,gid=0,mode=0o600);d,name=io.parent(self.path)
  try:self.fd=io.s.open(name,os.O_WRONLY|os.O_APPEND|os.O_NOFOLLOW|os.O_CLOEXEC,dir_fd=d)
  finally:io.s.close(d)
  self.key=io.snapshot(self.path)
  try:self.append({'op':'RETIRE_INTENT','ticketDigest':ticket_digest})
  except BaseException:self.close();raise
 def append(self,row):
  if self.io.snapshot(self.path)!=self.key:raise c.ContractHold('RETIRE_AUDIT_DRIFT')
  b=c.encode(row)+b'\n'
  if len(b)>16384 or self.key['size']+len(b)>131072:raise c.ContractHold('RETIRE_AUDIT_QUOTA')
  if self.io.s.write(self.fd,b)!=len(b):raise c.ContractHold('RETIRE_AUDIT_PARTIAL')
  self.io.s.fsync(self.fd);after=self.io.snapshot(self.path)
  if after['dev']!=self.key['dev'] or after['ino']!=self.key['ino'] or after['size']!=self.key['size']+len(b):raise c.ContractHold('RETIRE_AUDIT_REPLACED')
  self.key=after
 def close(self):
  if not self.closed:self.io.s.close(self.fd);self.closed=True

class Retirement:
 def __init__(self,m,*,io=None,runner=None,nss=None,identityfn=identity,clock=time.time,journal_factory=AuditJournal):
  self.m=c.validate_staging(m);self.p=paths(m);self.io=RetirementIO(m) if io is None else io;self.runner=FixedRunner(m) if runner is None else runner;self.nss=NSS() if nss is None else nss;self.identity=identityfn;self.clock=clock;self.journal_factory=journal_factory
 def actors(self,actors,principal,disposition):
  c.exact(actors,{'supervisor','cleanup'},'RETIRE_BOTH_CUSTODIANS')
  # Finalizer removed unit files and globally reloaded. Never adopt a replacement
  # manager invocation, even when a new unit is inactive. Unknown is not absent.
  for role,original in actors.items():
   o=self.runner.invoke('show',self.m['intervention'][role+'Unit'])
   if o.get('Id')!=self.m['intervention'][role+'Unit'] or o.get('LoadState')!='not-found' or o.get('FragmentPath') or o.get('DropInPaths') or o.get('InvocationID') or o.get('ActiveState')!='inactive' or o.get('MainPID')!='0' or o.get('ControlPID')!='0':raise c.ContractHold('RETIRE_UNIT_ABSENCE_OR_REUSE')
   try:observed=self.identity(original['identity']['pid'])
   except FileNotFoundError:observed=None
   if observed is not None:raise c.ContractHold('RETIRE_ORIGINAL_PID_ABSENCE_UNVERIFIED')
  expected={'op':'PRINCIPAL_RESERVED','user':'ers-ensayo','group':'ers-ensayo','uid':self.m['uid'],'gid':self.m['gid'],'home':'/nonexistent','shell':'/usr/sbin/nologin','groups':[self.m['gid']]}
  if principal!=expected:raise c.ContractHold('RETIRE_PRINCIPAL_RECEIPT')
  n=self.nss;u=n.user_name('ers-ensayo');g=n.group_name('ers-ensayo');uid=n.user_id(self.m['uid']);gid=n.group_id(self.m['gid'])
  if disposition=='REMOVE_IF_EXACT_UNUSED':
   if any(v is not None for v in (u,g,uid,gid)):raise c.ContractHold('RETIRE_ACCOUNT_REUSED_OR_NOT_ABSENT')
  elif disposition=='RETAIN_EXPLICIT_OWNER_ACCEPTED':
   if u is None or g is None or uid!=u or gid!=g or (u.pw_uid,u.pw_gid,u.pw_dir,u.pw_shell)!=(self.m['uid'],self.m['gid'],'/nonexistent','/usr/sbin/nologin') or u.pw_name!='ers-ensayo' or g.gr_name!='ers-ensayo' or g.gr_gid!=self.m['gid'] or g.gr_mem or n.groups('ers-ensayo',self.m['gid'])!=[self.m['gid']]:raise c.ContractHold('RETIRE_RETAINED_ACCOUNT_DRIFT')
  else:raise c.ContractHold('RETIRE_ACCOUNT_DECISION')
 def executor(self,pins):
  c.exact(pins,EXECUTOR_NAMES,'RETIRE_EXACT_EXECUTOR_SET')
  if any(not c.HEX(64,h) for h in pins.values()):raise c.ContractHold('RETIRE_EXECUTOR_HASHES')
  root='/opt/ers-retirement/'+c.digest(pins)
  if isinstance(self.io,RetirementIO):self.io.allow.update({root}|{root+'/'+n for n in pins})
  key=self.io.snapshot(root)
  if key is None or key['type']!=stat.S_IFDIR or key['uid']!=0 or key['gid']!=0 or key['mode']!=0o755 or self.io.children(root)!=sorted(pins):raise c.ContractHold('RETIRE_EXECUTOR_ROOT_CUSTODY')
  for n,h in pins.items():
   key=self.io.snapshot(root+'/'+n)
   if key is None or key['type']!=stat.S_IFREG or key['uid']!=0 or key['gid']!=0 or key['mode']!=0o444 or key['nlink']!=1 or key.get('sha256')!=h:raise c.ContractHold('RETIRE_EXECUTOR_SOURCE_PIN')
  if Path(__file__).resolve()!=Path(root+'/ensayo_retirement.py'):raise c.ContractHold('RETIRE_EXECUTOR_NOT_EXTERNAL_PINNED_ROUTE')
  return root
 def audit_destination(self):
  # An absent shared parent implies absent descendants only after its exact
  # nofollow lookup. Never traverse its missing children before creation.
  shared=self.io.snapshot(self.p['shared'])
  if shared is None:return None
  if shared['type']!=stat.S_IFDIR or shared['uid']!=0 or shared['gid']!=0 or shared['mode']!=0o700:raise c.ContractHold('RETIRE_AUDIT_PARENT_CUSTODY')
  if self.io.snapshot(self.p['audit']) is not None:raise c.ContractHold('RETIRE_AUDIT_EPOCH_EXISTS_NO_RETRY')
  return shared
 def prepare(self,rows,*,seed_original,not_before,executor_pins,journal):
  """Nonmutating known-input/control/seed/executor preflight BEFORE finalizer.
  Finalizer owns live account/unit/remaining-root preflight. Freeze rechecks the
  post-state. Unknown preexisting state is never deferred until after deletion.
  """
  now=int(self.clock())
  if type(not_before) is not int or not_before<now or not_before-now>7*86400:raise c.ContractHold('RETIRE_PROPOSED_TIME_REQUIRED')
  executor_root=self.executor(executor_pins)
  original={r['path']:r['key'] for r in rows if r['op']=='RETIRE_EXECUTOR_CREATED'}
  if set(original)!={executor_root}|{executor_root+'/'+n for n in executor_pins} or any(self.io.snapshot(p)!=key for p,key in original.items()):raise c.ContractHold('RETIRE_ORIGINAL_EXTERNAL_EXECUTOR')
  self.audit_destination()
  root=self.m['intervention']['controlRoot'];created={r['path']:r['key'] for r in rows if r['op']=='INSTALL_CREATED'}
  files={root+'/'+n for n in CONTROL_NAMES|{'supervisor.json','cleanup.json','bootstrap-receipt.json','lifecycle.jsonl'}}
  sockets={r['path']:r['key'] for r in rows if r['op']=='ROOT_SOCKET_BOUND' and r['path'].startswith(root+'/')}
  if root not in created or self.io.snapshot(root)!=created[root] or set(p for p in created if p.startswith(root+'/'))!=files-{root+'/lifecycle.jsonl'}:raise c.ContractHold('RETIRE_ORIGINAL_CONTROL_ROOT')
  if self.io.children(root)!=sorted(Path(p).name for p in files|set(sockets)):raise c.ContractHold('RETIRE_UNKNOWN_CONTROL_CHILD')
  for p in files-{root+'/lifecycle.jsonl'}:
   if self.io.snapshot(p)!=created[p]:raise c.ContractHold('RETIRE_ORIGINAL_CONTROL_FILE')
  for p,key in sockets.items():
   if self.io.snapshot(p)!=key:raise c.ContractHold('RETIRE_CONTROL_SOCKET_DRIFT')
  # The live mutable log is not sealed yet. Verify bytes equal original rows
  # and original journal descriptor custody, rather than accepting a path copy.
  journal.check()
  lifecycle=self.io.snapshot(root+'/lifecycle.jsonl');data=self.io.read_exact(root+'/lifecycle.jsonl',lifecycle)
  if not data.endswith(b'\n') or [c.load_json(v) for v in data.splitlines()]!=rows:raise c.ContractHold('RETIRE_PREFINALIZE_LIFECYCLE_BINDING')
  if not callable(getattr(journal,'seal',None)) or len(rows)>256 or len(data)>98304:raise c.ContractHold('RETIRE_FINALIZER_SEAL_OR_LOG_CAPACITY')
  if self.io.snapshot(self.p['seed'])!=seed_original or seed_original.get('type')!=stat.S_IFREG or seed_original.get('uid')!=0 or seed_original.get('gid')!=0 or seed_original.get('mode')!=0o600 or seed_original.get('nlink')!=1:raise c.ContractHold('RETIRE_ORIGINAL_SEED')
  b=self.io.read_exact(self.p['seed'],seed_original);seedrows=[c.load_json(v) for v in b.splitlines()]
  if not b.endswith(b'\n') or not seedrows or seedrows[-1].get('op')!='LIFECYCLE_SEALED':raise c.ContractHold('RETIRE_SEED_BINDING')
  c.validate_journal_origin(self.m,seedrows)
  return {'status':'PRE_FINALIZER_INPUTS_CUSTODY_CHECKED_NOT_ATOMIC','notAuthority':True}
 def freeze(self,rows,*,seed_original,lifecycle_original,not_before,executor_pins):
  """Called only AFTER Finalizer completion, lifecycle fsync/close and seed close.
  seed_original is the exact closed bootstrap return receipt, never a fresh
  path snapshot masquerading as the original. This function supplies no approval.
  """
  if type(not_before) is not int or not_before<int(self.clock()) or not_before-int(self.clock())>7*86400:raise c.ContractHold('RETIRE_PROPOSED_TIME_REQUIRED')
  if type(executor_pins) is not dict or not executor_pins or any(type(n) is not str or not c.HEX(64,h) for n,h in executor_pins.items()):raise c.ContractHold('RETIRE_EXTERNAL_EXECUTOR_PINS')
  executor_root=self.executor(executor_pins)
  executor_created={r['path']:r['key'] for r in rows if r['op']=='RETIRE_EXECUTOR_CREATED'}
  if set(executor_created)!={executor_root}|{executor_root+'/'+n for n in executor_pins} or any(self.io.snapshot(p)!=key for p,key in executor_created.items()):raise c.ContractHold('RETIRE_ORIGINAL_EXTERNAL_EXECUTOR')
  complete=[r for r in rows if r['op']=='ROOT_FINALIZER_COMPLETE']
  if len(complete)!=1 or rows[-1]!=complete[0]:raise c.ContractHold('RETIRE_FINALIZER_COMPLETE_REQUIRED')
  actors=[r for r in rows if r['op']=='ROOT_CUSTODIAN_ORIGINAL'];principals=[r for r in rows if r['op']=='PRINCIPAL_RESERVED'];decisions=[r for r in rows if r['op']=='ACCOUNT_DISPOSITION']
  if len(actors)!=2 or len(principals)!=1 or len(decisions)!=1:raise c.ContractHold('RETIRE_LIFECYCLE_BINDING')
  actors={r['role']:r for r in actors};principal=principals[0];decision=decisions[0]['decision'];self.actors(actors,principal,decision)
  root=self.m['intervention']['controlRoot'];created={r['path']:r['key'] for r in rows if r['op']=='INSTALL_CREATED'};expected={p:k for p,k in created.items() if p.startswith(root+'/')};expected[root+'/lifecycle.jsonl']=None
  if root not in created or self.io.snapshot(root)!=created[root]:raise c.ContractHold('RETIRE_ORIGINAL_CONTROL_ROOT')
  if self.io.children(root)!=sorted(Path(p).name for p in expected):raise c.ContractHold('RETIRE_UNKNOWN_CONTROL_CHILD')
  if set(expected)!={root+'/'+n for n in CONTROL_NAMES|{'supervisor.json','cleanup.json','bootstrap-receipt.json','lifecycle.jsonl'}}:raise c.ContractHold('RETIRE_EXACT_CONTROL_SET')
  if self.io.snapshot(root+'/lifecycle.jsonl')!=lifecycle_original:raise c.ContractHold('RETIRE_ORIGINAL_CLOSED_LIFECYCLE')
  inventory={root:created[root]}
  for p,key in expected.items():
   actual=self.io.snapshot(p)
   if actual is None or actual['type']!=stat.S_IFREG or actual['uid']!=0 or actual['gid']!=0 or actual['nlink']!=1 or actual['mode'] not in (0o400,0o444,0o600):raise c.ContractHold('RETIRE_CONTROL_FILE_CUSTODY')
   if key is not None and actual!=key:raise c.ContractHold('RETIRE_ORIGINAL_CONTROL_FILE')
   inventory[p]=actual
  lifecycle=self.io.read_exact(root+'/lifecycle.jsonl',inventory[root+'/lifecycle.jsonl']);parsed=[c.load_json(line) for line in lifecycle.splitlines()]
  if not lifecycle.endswith(b'\n') or parsed!=rows:raise c.ContractHold('RETIRE_CLOSED_LIFECYCLE_BINDING')
  if self.io.snapshot(self.p['seed'])!=seed_original or seed_original.get('type')!=stat.S_IFREG or seed_original.get('uid')!=0 or seed_original.get('gid')!=0 or seed_original.get('mode')!=0o600 or seed_original.get('nlink')!=1:raise c.ContractHold('RETIRE_ORIGINAL_SEED')
  seedrows=[c.load_json(line) for line in self.io.read_exact(self.p['seed'],seed_original).splitlines()]
  if not seedrows or seedrows[-1].get('op')!='LIFECYCLE_SEALED':raise c.ContractHold('RETIRE_SEED_BINDING')
  c.validate_journal_origin(self.m,seedrows)
  inventory[self.p['seed']]=seed_original
  ticket={'schema':1,'status':'PROPOSED_PENDING_OWNER_AUTHORITY_NO_SCHEDULE','manifestDigest':c.digest(self.m),'epoch':self.m['epoch'],'notBeforeUnixProposed':not_before,'executorPins':executor_pins,'actors':actors,'principal':principal,'accountDisposition':decision,'inventory':inventory,'executorRootRetained':'/opt/ers-retirement/'+c.digest(executor_pins),'auditResiduals':[self.p['ticket'],self.p['closeout']],'sharedParentsRetained':['/opt/ers','/etc/ers-ensayo','/var/lib/ers-ensayo-control',self.p['shared']]}
  # Recheck entire frozen set before even creating external audit directories.
  self.verify_targets(ticket,set())
  shared=self.audit_destination()
  if shared is None:self.io.create_directory(self.p['shared'],uid=0,gid=0,mode=0o700)
  self.io.create_directory(self.p['audit'],uid=0,gid=0,mode=0o700)
  key=self.io.create(self.p['ticket'],c.encode(ticket),uid=0,gid=0,mode=0o400)
  return {'status':'RETIREMENT_TICKET_PENDING_AUTHORITY_AND_FOLLOWTHROUGH','ticket':ticket,'ticketKey':key,'ticketDigest':c.digest(ticket),'auditDirectoryKey':self.io.snapshot(self.p['audit']),'notScheduled':True}
 def verify_targets(self,ticket,removed):
  inventory=ticket['inventory'];root=self.m['intervention']['controlRoot']
  if set(inventory)!={root,self.p['seed']}|{root+'/'+n for n in CONTROL_NAMES|{'supervisor.json','cleanup.json','bootstrap-receipt.json','lifecycle.jsonl'}}:raise c.ContractHold('RETIRE_EXACT_TARGET_SET')
  if root not in removed:
   expected=sorted(Path(p).name for p in inventory if p.startswith(root+'/') and p not in removed)
   if self.io.children(root)!=expected:raise c.ContractHold('RETIRE_UNKNOWN_OR_MISSING_CHILD')
  for p,key in inventory.items():
   if p in removed:
    # Once the original parent was removed, verify its absence directly. Do
    # not reopen a missing parent or adopt a replacement to check child names.
    if p.startswith(root+'/') and root in removed:continue
    if self.io.snapshot(p) is not None:raise c.ContractHold('RETIRE_REMOVED_TARGET_REAPPEARED')
   elif self.io.snapshot(p)!=key:raise c.ContractHold('RETIRE_TARGET_DRIFT')
 def audit(self,frozen,*,started=False):
  expected=['closeout.jsonl','ticket.json'] if started else ['ticket.json']
  if self.io.snapshot(self.p['audit'])!=frozen['auditDirectoryKey'] or self.io.children(self.p['audit'])!=expected or self.io.snapshot(self.p['ticket'])!=frozen['ticketKey'] or self.io.read_exact(self.p['ticket'],frozen['ticketKey'])!=c.encode(frozen['ticket']):raise c.ContractHold('RETIRE_AUDIT_OR_TICKET_DRIFT_NO_RETRY')
 def status(self,frozen):
  # Follow-through read only. A complete receipt is reconciled against absence;
  # a partial/existing journal is never converted into a retry instruction.
  try:
   key=self.io.snapshot(self.p['closeout'])
   if key is None:
    self.audit(frozen);self.verify_targets(frozen['ticket'],set())
    return {'status':'PENDING_OWNER_AUTHORITY_OR_NOT_BEFORE','notScheduled':True,'ticketDigest':frozen['ticketDigest']}
   self.audit(frozen,started=True)
   if key['type']!=stat.S_IFREG or key['uid']!=0 or key['gid']!=0 or key['mode']!=0o600 or key['nlink']!=1:raise c.ContractHold('RETIRE_CLOSEOUT_CUSTODY')
   data=self.io.read_exact(self.p['closeout'],key);rows=[c.load_json(v) for v in data.splitlines()]
   if not data.endswith(b'\n') or not rows or rows[0]!={'op':'RETIRE_INTENT','ticketDigest':frozen['ticketDigest']}:raise c.ContractHold('RETIRE_CLOSEOUT_BINDING')
   if rows[-1].get('op')!='RETIRE_COMPLETE' or rows[-1].get('ticketDigest')!=frozen['ticketDigest']:raise c.ContractHold('RETIRE_PARTIAL_HOLD_NO_RETRY')
   self.verify_targets(frozen['ticket'],set(frozen['ticket']['inventory']))
   return {'status':'VERIFIED_COMPLETE_NO_REPEAT_REMOVAL','auditResiduals':frozen['ticket']['auditResiduals'],'ticketDigest':frozen['ticketDigest']}
  except (OSError,c.ContractHold,KeyError,ValueError,TypeError) as error:
   return {'status':'HOLD_RESIDUAL_NO_RETRY','reason':str(error) if isinstance(error,c.ContractHold) else 'RETIRE_READ_UNVERIFIABLE','targetsNotCertifiedAbsent':sorted(frozen.get('ticket',{}).get('inventory',{}))}
 def execute(self,frozen,*,approved_binding=None):
  """approved_binding is a guard against the wrong ticket, NOT proof of consent.
  Trusted operator must independently recover owner authority before invoking.
  Default never deletes. Do not turn a ticket status into this argument.
  """
  ticket=frozen['ticket'];digest=c.digest(ticket)
  if approved_binding!={'ticketDigest':digest,'notBeforeUnix':ticket['notBeforeUnixProposed'],'scope':'EXACT_CONTROL_AND_SEED_WITH_EXTERNAL_AUDIT_RETAINED'}:raise c.ContractHold('RETIRE_PENDING_OWNER_AUTHORITY_NO_EFFECT')
  if self.clock()<ticket['notBeforeUnixProposed']:raise c.ContractHold('RETIRE_NOT_BEFORE')
  if ticket['manifestDigest']!=c.digest(self.m) or ticket['epoch']!=self.m['epoch'] or digest!=frozen['ticketDigest']:raise c.ContractHold('RETIRE_TICKET_BINDING')
  self.audit(frozen)
  self.executor(ticket['executorPins']);self.actors(ticket['actors'],ticket['principal'],ticket['accountDisposition']);self.verify_targets(ticket,set())
  journal=self.journal_factory(self.m,self.io,digest);removed=set();root=self.m['intervention']['controlRoot']
  order=sorted(p for p in ticket['inventory'] if p not in (root,self.p['seed']))+[root,self.p['seed']]
  try:
   for p in order:
    self.audit(frozen,started=True);self.executor(ticket['executorPins'])
    self.actors(ticket['actors'],ticket['principal'],ticket['accountDisposition']);self.verify_targets(ticket,removed)
    journal.append({'op':'RETIRE_REMOVE_INTENT','path':p,'key':ticket['inventory'][p]});self.io.remove(p,ticket['inventory'][p])
    if self.io.snapshot(p) is not None:raise c.ContractHold('RETIRE_ABSENCE_UNVERIFIED')
    removed.add(p);journal.append({'op':'RETIRE_REMOVED','path':p})
   self.verify_targets(ticket,removed);journal.append({'op':'RETIRE_COMPLETE','ticketDigest':digest,'auditResiduals':ticket['auditResiduals'],'sharedParentsRetained':ticket['sharedParentsRetained']})
   return {'status':'EXACT_CONTROL_SEED_REMOVED_EXTERNAL_AUDIT_RETAINED','ticketDigest':digest,'auditResiduals':ticket['auditResiduals'],'productionAdmission':False}
  finally:journal.close()
