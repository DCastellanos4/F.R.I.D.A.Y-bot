"""External LOCAL-prepared system allocator. No import/CLI effects or admission.
A plan omits numeric IDs. Only successful native allocation + exact NSS produce
one frozen manifest. No range parsing/default selection, account adoption or
recovery by name. Keep the original seed FD and Allocation object until handoff.
"""
import copy
from . import ensayo_os as c
from .ensayo_principal_bootstrap import NSS,PrincipalBootstrap
from .ensayo_principal_retire import PrincipalRetire
NAME='ers-ensayo'


def validate_plan(plan):
 c.exact(plan,{'allocation','manifestTemplate'},'ALLOCATION_PLAN_SHAPE')
 if plan['allocation']!='NATIVE_SHADOW_SYSTEM_NO_NUMERIC_SELECTION':raise c.ContractHold('ALLOCATION_POLICY')
 template=plan['manifestTemplate']
 if type(template) is not dict or any(k in template for k in ('uid','gid','groups')):raise c.ContractHold('ALLOCATION_NO_PRESELECTED_IDS')
 # Structural validation only. These sentinels are never allocation candidates,
 # commands, receipts, frozen manifests or operational inputs.
 c.validate_staging(dict(template,uid=1,gid=1,groups=[1]))
 return copy.deepcopy(plan)

class Allocation:
 def __init__(self,plan,seed,*,nss=None,execute=None):
  self.plan=validate_plan(plan);self.seed=seed;self.nss=NSS() if nss is None else nss
  # Fixed, root-only executor is reused, not a caller-controlled command string.
  self.execute=PrincipalBootstrap._execute.__get__(self) if execute is None else execute
  self.receipt=None;self.manifest=None;self.claimed=False
 def original(self):
  self.seed.check()
  rows=self.seed.rows()
  if not rows or rows[0]!={'op':'ROOT_ALLOCATION_BEGIN','planDigest':c.digest(self.plan)}:raise c.ContractHold('ALLOCATION_ORIGINAL_SEED')
  return rows
 def group(self,gid):
  g=self.nss.group_name(NAME)
  if g is None or not c.intpos(gid) or g.gr_name!=NAME or g.gr_passwd not in ('x','!','*','!!') or g.gr_gid!=gid or g.gr_mem or self.nss.group_id(gid)!=g:raise c.ContractHold('ALLOCATION_GROUP_NSS_DRIFT')
  return g
 def user(self,uid,gid):
  u=self.nss.user_name(NAME)
  if u is None or not c.intpos(uid) or u.pw_name!=NAME or u.pw_passwd not in ('x','!','*','!!') or u.pw_gecos!='' or (u.pw_uid,u.pw_gid,u.pw_dir,u.pw_shell)!=(uid,gid,'/nonexistent','/usr/sbin/nologin') or self.nss.user_id(uid)!=u or self.nss.groups(NAME,gid)!=[gid]:raise c.ContractHold('ALLOCATION_USER_NSS_DRIFT')
  return u
 def allocate(self):
  rows=self.original()
  if len(rows)!=1:raise c.ContractHold('ALLOCATION_NO_RETRY_OR_ADOPTION')
  if self.nss.user_name(NAME) is not None or self.nss.group_name(NAME) is not None:raise c.ContractHold('ALLOCATION_NAME_COLLISION')
  self.seed.append({'op':'PRINCIPAL_GROUP_INTENT','name':NAME,'allocation':'SYSTEM'})
  self.execute(['/usr/sbin/groupadd','--system','--',NAME])
  g=self.nss.group_name(NAME)
  if g is None:raise c.ContractHold('ALLOCATION_GROUP_RESULT_UNKNOWN')
  gid=g.gr_gid;self.group(gid)
  self.seed.append({'op':'PRINCIPAL_GROUP_CREATED','name':NAME,'gid':gid,'nss':list(g)})
  # Recheck absence and the original group before issuing useradd. No -o,
  # non-unique, force, home creation, extra groups or caller-provided UID.
  if self.nss.user_name(NAME) is not None:raise c.ContractHold('ALLOCATION_USER_NAME_RACE')
  self.group(gid)
  self.seed.append({'op':'PRINCIPAL_USER_INTENT','name':NAME,'gid':gid,'allocation':'SYSTEM'})
  self.execute(['/usr/sbin/useradd','--system','--gid',str(gid),'--no-user-group','--no-create-home','--no-log-init','--comment','','--home-dir','/nonexistent','--shell','/usr/sbin/nologin','--groups','','--password','!','--',NAME])
  u=self.nss.user_name(NAME)
  if u is None:raise c.ContractHold('ALLOCATION_USER_RESULT_UNKNOWN')
  uid=u.pw_uid;self.user(uid,gid);self.group(gid)
  self.seed.append({'op':'PRINCIPAL_USER_CREATED','name':NAME,'uid':uid,'gid':gid,'nss':list(u)})
  m=dict(copy.deepcopy(self.plan['manifestTemplate']),uid=uid,gid=gid,groups=[gid]);c.validate_staging(m)
  r={'op':'PRINCIPAL_RESERVED','user':NAME,'group':NAME,'uid':uid,'gid':gid,'home':'/nonexistent','shell':'/usr/sbin/nologin','groups':[gid]}
  self.seed.append(r)
  self.seed.append({'op':'ALLOCATION_MANIFEST_FROZEN','manifestDigest':c.digest(m),'receiptDigest':c.digest(r),'planDigest':c.digest(self.plan)})
  self.manifest=copy.deepcopy(m);self.receipt=copy.deepcopy(r)
  return {'manifest':copy.deepcopy(m),'receipt':copy.deepcopy(r),'productionAdmission':False,'status':'NATIVE_ACCOUNT_ALLOCATED_MANIFEST_FROZEN_NOT_INSTALLED_NOT_STARTED'}
 def confirm(self,m):
  rows=self.original()
  if self.manifest is None or m!=self.manifest or self.receipt is None:raise c.ContractHold('ALLOCATION_MANIFEST_BINDING')
  if [r for r in rows if r['op']=='PRINCIPAL_RESERVED']!=[self.receipt] or [r for r in rows if r['op']=='ALLOCATION_MANIFEST_FROZEN']!=[{'op':'ALLOCATION_MANIFEST_FROZEN','manifestDigest':c.digest(m),'receiptDigest':c.digest(self.receipt),'planDigest':c.digest(self.plan)}]:raise c.ContractHold('ALLOCATION_FREEZE_BINDING')
  groups=[r for r in rows if r['op']=='PRINCIPAL_GROUP_CREATED'];users=[r for r in rows if r['op']=='PRINCIPAL_USER_CREATED']
  if len(groups)!=1 or len(users)!=1 or list(self.group(m['gid']))!=groups[0]['nss'] or list(self.user(m['uid'],m['gid']))!=users[0]['nss']:raise c.ContractHold('ALLOCATION_ORIGINAL_NSS_IDENTITY')
  if any(r['op'] in ('ALLOCATION_ROLLBACK_INTENT','PRINCIPAL_RETIRE_INTENT') for r in rows):raise c.ContractHold('ALLOCATION_RETIRED_OR_UNCERTAIN')
  return copy.deepcopy(self.receipt)
 def claim(self,m):
  self.confirm(m);rows=self.original()
  if self.claimed or any(r['op'] in ('ROOT_CONTROL_BEGIN','INSTALL_INTENT','HOLDER_INSTALL_BEGIN') for r in rows):raise c.ContractHold('ALLOCATION_HANDOFF_ONCE')
  c.validate_journal_origin(m,rows+[{'op':'ROOT_CONTROL_BEGIN','manifestDigest':c.digest(m)}])
  self.seed.append({'op':'ROOT_CONTROL_BEGIN','manifestDigest':c.digest(m)})
  self.claimed=True
  return self.seed
 def rollback(self):
  """Only before installation. An unreceipted effect stays HOLD, not deleted.
  No recovery after process death, no retry, and no all-host identity guarantee.
  """
  rows=self.original()
  if self.claimed or any(r['op'] in ('ROOT_CONTROL_BEGIN','INSTALL_INTENT','ALLOCATION_ROLLBACK_INTENT','PRINCIPAL_RETIRE_INTENT') for r in rows):raise c.ContractHold('ALLOCATION_ROLLBACK_BOUNDARY')
  if self.receipt is not None:
   self.confirm(self.manifest)
   # Reuse exact existing receipt-aware retirement, no force/home removal.
   return PrincipalRetire(self.manifest,self.seed,nss=self.nss,execute=self._retire_execute).remove(self.receipt)
  groups=[r for r in rows if r['op']=='PRINCIPAL_GROUP_CREATED']
  if len(groups)!=1 or any(r['op']=='PRINCIPAL_USER_INTENT' for r in rows):raise c.ContractHold('ALLOCATION_PARTIAL_UNVERIFIED_NO_DELETE')
  r=groups[0];g=self.group(r['gid'])
  if list(g)!=r['nss'] or self.nss.user_name(NAME) is not None:raise c.ContractHold('ALLOCATION_PARTIAL_IDENTITY_DRIFT')
  self.seed.append({'op':'ALLOCATION_ROLLBACK_INTENT','gid':r['gid'],'nss':r['nss']})
  self._retire_execute(['/usr/sbin/groupdel','--',NAME])
  if self.nss.group_name(NAME) is not None or self.nss.group_id(r['gid']) is not None:raise c.ContractHold('ALLOCATION_ROLLBACK_ABSENCE_UNVERIFIED')
  self.seed.append({'op':'PRINCIPAL_GROUP_REMOVED','gid':r['gid']})
  return {'status':'ORIGINAL_GROUP_REMOVED_NO_HOME_ACTION'}
 def _retire_execute(self,argv):
  # Tests may inject a fake NSS executor. Real retirement uses its independent
  # allowlist rather than broadening the allocation executor to deletion verbs.
  if getattr(self.execute,'__func__',None) is PrincipalBootstrap._execute:return PrincipalRetire._execute(self,argv)
  return self.execute(argv)

# External bootstrap component only, not loaded by holders/control/retirement.
from .ensayo_bootstrap import SeedJournal
class AllocationSeedJournal(SeedJournal):
 def __init__(self,plan):
  plan=validate_plan(plan)
  self._open(plan['manifestTemplate']['epoch'],{'op':'ROOT_ALLOCATION_BEGIN','planDigest':c.digest(plan)})
