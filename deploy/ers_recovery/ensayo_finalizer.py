"""External finalizer after both root custodians have exited.
Never kills arbitrary processes, deletes homes or adopts residual account names.
Any drift/partial prior finalization preserves residuals and returns HOLD.
"""
import grp,os,pwd,stat
from pathlib import Path
from . import ensayo_os as c
from .ensayo_privileged_io import RootIO
from .lease import identity
class Finalizer:
 def __init__(self,m,journal,*,io=None,manager=None,identityfn=identity,account_remove=None):self.m=c.validate_staging(m);self.j=journal;self.io=RootIO(m) if io is None else io;self.manager=manager;self.identity=identityfn;self.account_remove=account_remove
 def finish(self):
  rows=self.j.rows()
  if any(r['op']=='FINALIZE_INTENT' for r in rows):raise c.ContractHold('ROOT_FINALIZER_PARTIAL_NO_RETRY')
  custodians={r['role']:r for r in rows if r['op']=='ROOT_CUSTODIAN_ORIGINAL'}
  if len([r for r in rows if r['op']=='ROOT_CUSTODIAN_ORIGINAL'])!=2:raise c.ContractHold('ROOT_FINALIZER_DUPLICATE_CUSTODIAN')
  if set(custodians)!={'supervisor','cleanup'} or not any(r['op']=='ROOT_CONTROL_COMPLETE' and r.get('status')=='HOLDER_OBJECTS_REMOVED_ROOT_RESIDUALS_REQUIRE_FINALIZER' for r in rows):raise c.ContractHold('ROOT_FINALIZER_COMPLETE_CUSTODIAN_LIFECYCLE')
  for role,r in custodians.items():
   o=self.manager.invoke('show',self.m['intervention'][role+'Unit'])
   if o['InvocationID']!=r['invocation'] or int(o['MainPID']) or int(o['ControlPID']) or o['ActiveState'] not in ('inactive','failed'):raise c.ContractHold('ROOT_FINALIZER_ROOT_UNIT_NOT_ORIGINAL_STOPPED')
   try:present=self.identity(r['identity']['pid'])
   except FileNotFoundError:present=None
   if present is not None:raise c.ContractHold('ROOT_FINALIZER_ORIGINAL_ROOT_PID_ABSENCE_UNVERIFIED')
  created={r['path']:r['key'] for r in rows if r['op']=='INSTALL_CREATED'};removed={r['path'] for r in rows if r['op']=='REMOVED'}
  i=self.m['intervention'];retain={p for p in created if p==i['controlRoot'] or p.startswith(i['controlRoot']+'/') or p in ('/opt/ers','/etc/ers-ensayo','/var/lib/ers-ensayo-control')}
  selected={p:k for p,k in created.items() if p not in retain|removed}
  # All roots/units exact before first finalizer effect. No prefix census deletion.
  for p,key in selected.items():
   if self.io.snapshot(p)!=key:raise c.ContractHold('ROOT_FINALIZER_OBJECT_DRIFT')
  # Entire removable roots must contain only exact inventory children. Unknown
  # names hold BEFORE deleting any unit/socket/file, not midway through rmdir.
  sockets=[r for r in rows if r['op']=='ROOT_SOCKET_BOUND']
  known=set(created)-removed|{r['path'] for r in sockets}
  for p,key in selected.items():
   if key['type']==stat.S_IFDIR:
    expected=sorted(q[len(p)+1:] for q in known if q.startswith(p+'/') and '/' not in q[len(p)+1:])
    if self.io.children(p)!=expected:raise c.ContractHold('ROOT_FINALIZER_UNKNOWN_ROOT_CONTENT')
  # Gate/release and custody sockets are created by their exact custodian code.
  # Unknown socket inventory or any extra contents leaves rmdir holding safely.
  sockets=[r for r in rows if r['op']=='ROOT_SOCKET_BOUND']
  for s in sockets:
   if self.io.snapshot(s['path'])!=s['key']:raise c.ContractHold('ROOT_FINALIZER_SOCKET_DRIFT')
  decision=next((r['decision'] for r in rows if r['op']=='ACCOUNT_DISPOSITION'),None)
  if decision not in ('REMOVE_IF_EXACT_UNUSED','RETAIN_EXPLICIT_OWNER_ACCEPTED') or (decision=='REMOVE_IF_EXACT_UNUSED' and self.account_remove is None):raise c.ContractHold('ROOT_FINALIZER_ACCOUNT_DECISION_OR_CUSTODIAN_REQUIRED')
  receipts=[r for r in rows if r['op']=='PRINCIPAL_RESERVED']
  if len(receipts)!=1:raise c.ContractHold('ROOT_FINALIZER_ORIGINAL_PRINCIPAL_REQUIRED')
  receipt=receipts[0]
  if decision=='REMOVE_IF_EXACT_UNUSED':
   # A bare callable is not an account custodian or evidence of NSS preflight.
   from .ensayo_principal_retire import PrincipalRetire
   account=getattr(self.account_remove,'__self__',None)
   if type(account) is not PrincipalRetire or getattr(self.account_remove,'__func__',None) is not PrincipalRetire.remove or account.j is not self.j or account.m!=self.m:raise c.ContractHold('ROOT_FINALIZER_EXACT_ACCOUNT_CUSTODIAN_REQUIRED')
   account.preflight(receipt) # no journal append/account effect; rechecked at remove
  self.j.append({'op':'FINALIZE_INTENT','selected':sorted(selected),'retainedControlSeconds':i['retention']['seconds']})
  for s in sockets:self.io.remove(s['path'],s['key']);self.j.append({'op':'FINALIZER_REMOVED_SOCKET','path':s['path']})
  for p in sorted(selected,key=lambda p:(selected[p]['type']==stat.S_IFDIR,-p.count('/'),p)):
   self.io.remove(p,selected[p]);self.j.append({'op':'FINALIZER_REMOVED','path':p})
  decision=next((r['decision'] for r in rows if r['op']=='ACCOUNT_DISPOSITION'),None)
  if decision=='REMOVE_IF_EXACT_UNUSED':
   self.account_remove(receipt);account='REMOVAL_EXTERNALLY_VERIFIED'
  elif decision=='RETAIN_EXPLICIT_OWNER_ACCEPTED':account='ACCOUNT_GROUP_REMAIN_EXPLICIT_OWNER_DECISION'
  else:raise c.ContractHold('ROOT_FINALIZER_ACCOUNT_DECISION_MISSING')
  self.manager.invoke('daemon-reload')
  result={'status':'ROOT_FINALIZER_CLOSED_WITH_EXPLICIT_CONTROL_RETENTION','controlRetained':sorted(retain),'retentionSecondsProposed':i['retention']['seconds'],'account':account,'productionAdmission':False};self.j.append({'op':'ROOT_FINALIZER_COMPLETE','result':result});return result

 def finish_and_freeze(self,retirement,*,seed_original,not_before,executor_pins):
  """External operator route. Journal must be closed before freezing its bytes.
  Failure leaves residuals/HOLD, never reruns finish or deletes evidence.
  """
  retirement.prepare(self.j.rows(),seed_original=seed_original,not_before=not_before,executor_pins=executor_pins,journal=self.j)
  result=self.finish()
  rows,lifecycle_original=self.j.seal()
  frozen=retirement.freeze(rows,seed_original=seed_original,lifecycle_original=lifecycle_original,not_before=not_before,executor_pins=executor_pins)
  return {'finalizer':result,'retirement':frozen,'status':'FINALIZED_TICKET_PENDING_OWNER_AUTHORITY_NO_SCHEDULE'}
