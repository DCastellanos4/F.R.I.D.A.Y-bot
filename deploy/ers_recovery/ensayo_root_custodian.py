"""Concrete gate custodian and conservative cleanup controller.
No fixture semantic inheritance. Defaults use root journal, manager CLI and real
bounded proc/cgroup collector. No installation/account provisioning here.
"""
import os,secrets,signal,socket,stat,struct,time
from pathlib import Path
from . import ensayo_os as c
from .ensayo_privileged_io import FixedRunner,RootIO
from .ensayo_manager_collector import Collector
from .ensayo_root_journal import RootJournal
from .lease import identity,record,receive_record

class Custodian:
 def __init__(self,m,*,runner=None,collector=None,journal=None):
  self.m=c.validate_staging(m);self.runner=FixedRunner(m) if runner is None else runner;self.collector=Collector(m,self.runner) if collector is None else collector;self.journal=RootJournal(m,create=True) if journal is None else journal;self.reservations={};self.cleanup_ack=None;self.scopefds={}
 def validate_gate(self,role,request,peer):
  c.exact(request,{'op','role','identity','invocation','manifestDigest'},'ROOT_GATE_REQUEST_SHAPE')
  if request['op']!='GATE_READY' or request['role']!=role or request['manifestDigest']!=c.digest(self.m) or peer['uid']!=self.m['uid'] or request['identity']!=peer['identity']:raise c.ContractHold('ROOT_GATE_PEER_REQUEST')
  observed=self.collector.scope(role,stage='GATE_ONLY')
  if observed['process']['identity']!=peer['identity'] or observed['invocation']!=request['invocation']:raise c.ContractHold('ROOT_GATE_MANAGER_PEER_MISMATCH')
  return observed
 def reserve_both(self,requests):
  if set(requests)!=set(c.ROLES) or self.reservations:raise c.ContractHold('ROOT_GATE_EXACT_BOTH_NO_RETRY')
  # Full no-effects prepass first. Recheck each observed scope before persistence.
  observed={role:self.validate_gate(role,requests[role]['request'],requests[role]['peer']) for role in c.ROLES}
  for role in c.ROLES:
   if self.validate_gate(role,requests[role]['request'],requests[role]['peer'])!=observed[role]:raise c.ContractHold('ROOT_GATE_RESERVATION_DRIFT')
   reservation=dict(observed[role],nonce=secrets.token_hex(32),manifestDigest=c.digest(self.m),sourceDigest=c.digest(self.m['sourceFiles']),reservationStage='ONLY_EXACT_CUSTODIED_PRESTART_GATE_NO_HOLDER')
   self.journal.append({'op':'GATE_RESERVATION','role':role,'reservation':reservation});self.reservations[role]=reservation
  return c.digest(self.reservations)
 def release_both(self,requests,*,send=record,wait_controller=None):
  if set(self.reservations)!=set(c.ROLES):raise c.ContractHold('ROOT_GATE_RESERVATIONS_INCOMPLETE')
  if self.cleanup_ack is None or self.cleanup_ack.get('reservationsDigest')!=c.digest(self.reservations):raise c.ContractHold('ROOT_GATE_INDEPENDENT_SCOPE_CUSTODY_ACK_REQUIRED')
  for role in c.ROLES:
   now=self.validate_gate(role,requests[role]['request'],requests[role]['peer']);want=self.reservations[role]
   if any(now[k]!=want[k] for k in now):raise c.ContractHold('ROOT_GATE_RELEASE_PREPASS_DRIFT')
  digest=c.digest(self.reservations);root=identity()
  for role in c.ROLES:
   # Sequential release is not atomic. A later drift may leave one holder
   # launched, but independent per-unit timeouts and cleanup own its lifetime.
   now=self.validate_gate(role,requests[role]['request'],requests[role]['peer']);want=self.reservations[role]
   if any(now[k]!=want[k] for k in now):raise c.ContractHold('ROOT_GATE_RELEASE_ROLE_DRIFT')
   self.journal.append({'op':'RELEASE_INTENT','role':role,'reservationDigest':c.digest(want)})
   req=requests[role]['request'];send(requests[role]['channel'],{'op':'RELEASE_PRESTART_GATE_ONLY','role':role,'identity':req['identity'],'invocation':req['invocation'],'manifestDigest':c.digest(self.m),'rootCustodian':root,'bothReservationsDigest':digest})
   self.journal.append({'op':'RELEASE_SENT_NOT_HOLDER_PROOF','role':role})
   if role=='controller':(self.wait_controller_ready if wait_controller is None else wait_controller)()
 def wait_controller_ready(self):
  # Watchdog must not race the controller's exclusively bound holder socket.
  # Waiting is only for absence/expected manager transition, never a custody retry.
  deadline=time.monotonic()+2
  created={r['path']:r['key'] for r in self.journal.rows() if r['op']=='INSTALL_CREATED'}
  if self.m['runtimeRoot'] not in created:raise c.ContractHold('ROOT_RUNTIME_ORIGINAL_REQUIRED')
  while time.monotonic()<deadline:
   state=self.collector.manager('controller')
   if state['SubState']=='running':
    from .ensayo_privileged_io import identity as object_identity
    if object_identity(Path(self.m['runtimeRoot']).lstat())!=created[self.m['runtimeRoot']]:raise c.ContractHold('ROOT_RUNTIME_DIRECTORY_REPLACED')
    try:s=Path(self.m['paths']['socket']).lstat()
    except FileNotFoundError:time.sleep(.01);continue
    if not stat.S_ISSOCK(s.st_mode) or (s.st_uid,s.st_gid,stat.S_IMODE(s.st_mode))!=(self.m['uid'],self.m['gid'],0o600):raise c.ContractHold('ROOT_CONTROLLER_SOCKET_CUSTODY')
    self.collector.scope('controller',stage='HOLDER',reservation=self.reservations['controller'])
    return
   if state['SubState'] not in ('start-pre','start','running'):raise c.ContractHold('ROOT_CONTROLLER_START_FAILED')
   time.sleep(.01)
  raise c.ContractHold('ROOT_CONTROLLER_READY_DEADLINE')
 def validate_holders(self):
  if set(self.reservations)!=set(c.ROLES):raise c.ContractHold('ROOT_NO_PRIOR_RESERVATIONS')
  results={role:self.collector.scope(role,stage='HOLDER',reservation=self.reservations[role]) for role in c.ROLES}
  receipts={}
  for role,result in results.items():
   receipt,key=c.read_receipt(self.m,role,c.RootCustody())
   if receipt['custodyClass']!=c.RootCustody.evidence_class or receipt['process']!=result['process']['identity'] or receipt['invocation']!=result['invocation'] or receipt['cgroup']!=result['process']['cgroup']:raise c.ContractHold('ROOT_COMMIT_RECEIPT_PROCESS_MISMATCH')
   receipts[role]=receipt
  if receipts['controller']['leaseKey']!=receipts['watchdog']['leaseKey']:raise c.ContractHold('ROOT_COMMIT_RECEIPT_LOCK_MISMATCH')
  for role,result in results.items():self.journal.append({'op':'HOLDER_OBSERVED','role':role,'observation':result})
  return {'status':'ROOT_MANAGER_PROC_TRANSITION_OBSERVED_NOT_KERNEL_GATE','productionAdmission':False,'kernelContainment':'UNVERIFIED','effectAdapter':'ABSENT','holders':results}
 def serve_gates(self,*,handoff):
  # Socket path parent must be pre-created root:GID0750 by exact installer.
  root=Path(self.m['intervention']['gateRoot']);c.ancestors(root.parent,0);c.config_directory(root,owner=0,gid=self.m['gid']);sockpath=root/'release.sock'
  server=socket.socket(socket.AF_UNIX,socket.SOCK_SEQPACKET);channels=[];deadline=time.monotonic()+10;requests={}
  try:
   # bind fails if any previous socket or object exists. No unlink/repair.
   self.journal.append({'op':'ROOT_SOCKET_INTENT','path':str(sockpath)})
   server.bind(str(sockpath));os.chown(sockpath,0,self.m['gid']);os.chmod(sockpath,0o660);self.journal.append({'op':'ROOT_SOCKET_BOUND','path':str(sockpath),'key':RootIO(self.m).snapshot(str(sockpath))});server.listen(2)
   for role in c.ROLES:self.journal.append({'op':'START_PRE_INTENT','role':role});self.runner.invoke('start',self.m['units'][role])
   while len(requests)<2:
    remaining=deadline-time.monotonic()
    if remaining<=0:raise c.ContractHold('ROOT_GATE_ACCEPT_DEADLINE')
    server.settimeout(remaining);ch,_=server.accept();channels.append(ch);ch.settimeout(max(.001,deadline-time.monotonic()));pid,uid,_=struct.unpack('3i',ch.getsockopt(socket.SOL_SOCKET,socket.SO_PEERCRED,12));request=receive_record(ch);role=request.get('role') if type(request) is dict else None
    if role not in c.ROLES or role in requests:raise c.ContractHold('ROOT_GATE_DUPLICATE_OR_ROLE')
    peer={'uid':uid,'identity':identity(pid)};self.validate_gate(role,request,peer);requests[role]={'request':request,'peer':peer,'channel':ch}
   self.reserve_both(requests)
   from .ensayo_scope_fd import ScopeFD
   self.scopefds={role:ScopeFD(self.m,r) for role,r in self.reservations.items()}
   self.cleanup_ack=handoff(self.reservations,self.scopefds)
   self.journal.append({'op':'INDEPENDENT_CLEANUP_CUSTODY_ACK','ack':self.cleanup_ack})
   self.release_both(requests)
   # Poll only the expected start-pre transition, not arbitrary custody holds.
   while time.monotonic()<deadline:
    states={role:self.collector.manager(role) for role in c.ROLES}
    if all(v['SubState']=='running' for v in states.values()):
     try:
      for role in c.ROLES:Path(self.m['paths'][role+'Receipt']).lstat()
     except FileNotFoundError:pass
     else:return self.validate_holders() # Any malformed/replaced receipt HOLDS.
    if any(v['SubState'] not in ('start-pre','start','running') for v in states.values()):raise c.ContractHold('ROOT_HOLDER_TRANSITION_FAILED')
    time.sleep(.01)
   raise c.ContractHold('ROOT_HOLDER_TRANSITION_DEADLINE')
  finally:
   for ch in channels:ch.close()
   server.close()
   for scope in self.scopefds.values():scope.close()
   # Deliberately leave exact socket for inventory/custodian cleanup. No name-
   # based unlink in a failure path; no autonomous retry or new invocation.

class CleanupController:
 """Kill only independently revalidated reserved manager-owned scopes.
 Pending release/main transition is acceptable only with the same reservation;
 unknown scopes or absent durable reservation hold, never get adopted by name.
 """
 def __init__(self,m,*,runner=None,collector=None,journal=None):
  self.m=c.validate_staging(m);self.runner=FixedRunner(m) if runner is None else runner;self.collector=Collector(m,self.runner) if collector is None else collector;self.journal=RootJournal(m) if journal is None else journal
 def original_reservations(self):
  reservations={}
  for row in self.journal.rows():
   if row['op']=='GATE_RESERVATION':
    role=row['role'];r=row['reservation']
    if role not in c.ROLES or role in reservations or r['manifestDigest']!=c.digest(self.m) or r['sourceDigest']!=c.digest(self.m['sourceFiles']) or r['reservationStage']!='ONLY_EXACT_CUSTODIED_PRESTART_GATE_NO_HOLDER':raise c.ContractHold('ROOT_CLEANUP_RESERVATION_BINDING')
    reservations[role]=r
  if set(reservations)!=set(c.ROLES):raise c.ContractHold('ROOT_CLEANUP_BOTH_PRIOR_RESERVATIONS_REQUIRED')
  return reservations
 def current(self,role,reservation):
  # Try both explicitly recognized stages. No arbitrary PID or scope adopted.
  manager=self.collector.manager(role)
  stage='GATE_ONLY' if manager['SubState']=='start-pre' else 'HOLDER'
  observed=self.collector.scope(role,stage=stage,reservation=reservation)
  if stage=='GATE_ONLY' and observed['process']['identity']!=reservation['process']['identity']:raise c.ContractHold('ROOT_CLEANUP_GATE_REUSE')
  return observed
 def stop(self,scopefds):
  reservations=self.original_reservations()
  if set(scopefds)!=set(c.ROLES):raise c.ContractHold('ROOT_CLEANUP_BOTH_ORIGINAL_FDS_REQUIRED')
  observed={};already_empty={}
  for role,r in reservations.items():
   try:already_empty[role]=scopefds[role].empty()
   except c.ContractHold as error:
    if str(error)!='SCOPE_FD_NOT_EMPTY':raise
    observed[role]=self.current(role,r)
  for role,r in reservations.items():
   if role in already_empty:continue
   if self.current(role,r)!=observed[role]:raise c.ContractHold('ROOT_CLEANUP_IMMEDIATE_DRIFT')
   self.journal.append({'op':'STOP_RESERVED_SCOPE_INTENT','role':role,'reservationDigest':c.digest(r),'scope':'ALL_DESCENDANTS_PROPOSED_NOT_ORIGINAL_PID_ONLY'})
   self.runner.invoke('stop',self.m['units'][role])
   scopefds[role].empty()
   self.journal.append({'op':'ORIGINAL_CGROUP_EMPTY_CONFIRMED','role':role,'evidence':scopefds[role].empty()})
  # Filesystem removals require separate pinned runtime handles and independent
  # cgroup emptiness. This method intentionally does NOT claim full cleanup.
  return {'status':'SCOPES_STOPPED_ORIGINAL_FDS_EMPTY_FILES_NOT_REMOVED','productionAdmission':False}
