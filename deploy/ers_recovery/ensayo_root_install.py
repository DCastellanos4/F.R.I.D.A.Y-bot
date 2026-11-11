"""Exact privileged installation effect sequence under an existing root journal.
No authority is created by this code. Account reservation and the external root
control directory/journal are separate approved bootstrap prerequisites. This
module refuses to silently reuse a principal or fabricate bootstrap inventory.
"""
import hashlib,os,secrets,stat
from pathlib import Path
from . import ensayo_os as c
from .ensayo_privileged_io import RootIO

class Installer:
 def __init__(self,m,journal,*,io=None):
  self.m=c.validate_staging(m);self.journal=journal;self.io=RootIO(m) if io is None else io
 def create(self,path,data,*,uid,gid,mode,directory=False):
  rows=self.journal.rows()
  if any(r.get('op')=='INSTALL_INTENT' and not any(q.get('op')=='INSTALL_CREATED' and q.get('path')==r['path'] for q in rows) for r in rows):raise c.ContractHold('ROOT_INSTALL_UNCERTAIN_NO_RETRY')
  if self.io.snapshot(path) is not None:raise c.ContractHold('ROOT_INSTALL_REFUSE_EXISTING')
  self.journal.append({'op':'INSTALL_INTENT','path':path,'kind':'directory' if directory else 'file'})
  if directory:key=self.io.create_directory(path,uid=uid,gid=gid,mode=mode)
  else:key=self.io.create(path,data,uid=uid,gid=gid,mode=mode)
  self.journal.append({'op':'INSTALL_CREATED','path':path,'key':key});return key
 def install_holders(self,source_bytes,*,principal_receipt,bootstrap_digest):
  m=self.m;i=m['intervention']
  c.exact(principal_receipt,{'op','user','group','uid','gid','home','shell','groups'},'ROOT_PRINCIPAL_RECEIPT_SHAPE')
  expected={'op':'PRINCIPAL_RESERVED','user':'ers-ensayo','group':'ers-ensayo','uid':m['uid'],'gid':m['gid'],'home':'/nonexistent','shell':'/usr/sbin/nologin','groups':[m['gid']]}
  originals=[r for r in self.journal.rows() if r.get('op')=='PRINCIPAL_RESERVED']
  if principal_receipt!=expected or originals!=[expected] or c.digest(expected)!=bootstrap_digest:raise c.ContractHold('ROOT_PRINCIPAL_ORIGINAL_RECEIPT_REQUIRED')
  c.exact(source_bytes,c.STAGING_SOURCES,'ROOT_INSTALL_EXACT_SOURCE_SET')
  for name,data in source_bytes.items():
   if type(data) is not bytes or len(data)>1048576 or hashlib.sha256(data).hexdigest()!=m['sourceFiles'][name]:raise c.ContractHold('ROOT_INSTALL_SOURCE_PIN')
  if any(r.get('op')=='HOLDER_INSTALL_BEGIN' for r in self.journal.rows()):raise c.ContractHold('ROOT_INSTALL_NO_SECOND_ATTEMPT')
  self.journal.append({'op':'HOLDER_INSTALL_BEGIN','manifestDigest':c.digest(m)})
  # Parent roots must be separately supplied by the privileged bootstrap with
  # exact receipts. No chmod/chown/adoption of existing shared roots occurs here.
  directories=[(m['sourceRoot'],0,0,0o755),(m['configRoot'],0,m['gid'],0o750),(m['runtimeRoot'],m['uid'],m['gid'],0o700),(i['canaryRoot'],0,0,0o755),(i['gateRoot'],0,m['gid'],0o750)]
  # Validate absence of ALL final targets before first install intent.
  targets=[p for p,*rest in directories]+[m['sourceRoot']+'/'+n for n in source_bytes]+list(m['configs'].values())+['/etc/systemd/system/'+u for u in m['units'].values()]+[i['canaryRoot']+'/public.txt']
  # Children of an absent proposed root need not have an existing parent yet.
  for path,*rest in directories:
   if self.io.snapshot(path) is not None:raise c.ContractHold('ROOT_INSTALL_TARGET_COLLISION')
  for path,uid,gid,mode in directories:self.create(path,None,uid=uid,gid=gid,mode=mode,directory=True)
  for name,data in sorted(source_bytes.items()):self.create(m['sourceRoot']+'/'+name,data,uid=0,gid=0,mode=0o444)
  token=secrets.token_hex(32)
  for role in c.ROLES:self.create(m['configs'][role],c.encode({'manifest':m,'role':role,'token':token}),uid=0,gid=m['gid'],mode=0o440)
  for role,text in c.render_staging(m)['sources'].items():self.create('/etc/systemd/system/'+m['units'][role],text.encode(),uid=0,gid=0,mode=0o444)
  self.create(i['canaryRoot']+'/public.txt',b'ERS_PUBLIC_CANARY_V1\n',uid=0,gid=0,mode=0o644)
  return {'status':'ROOT_HOLDER_FILES_INSTALLED_NOT_STARTED','productionAdmission':False,'bootstrapPrincipalDigest':bootstrap_digest}

class ExactRemover:
 def __init__(self,m,journal,*,io=None):self.m=c.validate_staging(m);self.journal=journal;self.io=RootIO(m) if io is None else io
 def preflight(self,*,scope_empty_evidence,runtime_objects=None):
  # Non-boolean identities from the independent manager/cgroup collector. No
  # empty caller list can omit a role; this method does not infer scope death.
  c.exact(scope_empty_evidence,c.ROLES,'ROOT_REMOVAL_BOTH_EMPTY_REQUIRED')
  reservations={r['role']:r['reservation'] for r in self.journal.rows() if r['op']=='GATE_RESERVATION'}
  if set(reservations)!=set(c.ROLES):raise c.ContractHold('ROOT_REMOVAL_PRIOR_SCOPE_RESERVATIONS')
  for role,e in scope_empty_evidence.items():
   c.exact(e,{'unit','invocation','cgroupKey','members','source'},'ROOT_REMOVAL_EMPTY_SHAPE')
   r=reservations[role]
   if (e['unit'],e['invocation'],e['cgroupKey'])!=(r['unit'],r['invocation'],r['cgroupKey']) or e['members']!=[] or e['source']!='INDEPENDENT_PINNED_CGROUP_FD':raise c.ContractHold('ROOT_REMOVAL_SCOPE_NOT_EMPTY')
  rows=self.journal.rows();intents={r['path'] for r in rows if r['op']=='INSTALL_INTENT'};created={r['path']:r['key'] for r in rows if r['op']=='INSTALL_CREATED'}
  if set(created)!=intents or any(r['op']=='REMOVE_INTENT' for r in rows):raise c.ContractHold('ROOT_REMOVAL_PARTIAL_LIFECYCLE_HOLD')
  i=self.m['intervention'];retained={p for p in created if p==i['controlRoot'] or p.startswith(i['controlRoot']+'/') or p in ('/opt/ers','/etc/ers-ensayo','/var/lib/ers-ensayo-control',self.m['runtimeRoot'],self.m['sourceRoot'],self.m['configRoot'],i['gateRoot'],i['canaryRoot']) or p in {'/etc/systemd/system/'+i[r+'Unit'] for r in ('supervisor','cleanup')} or p in {'/etc/systemd/system/'+u for u in self.m['units'].values()} or p=='/etc/systemd/system/ers-ensayo-cleanup-'+self.m['epoch']+'.timer'}
  # Control journal mutates by design and remains retained; exact final cleanup
  # belongs to the external bootstrap owner after both root services have exited.
  selected={p:key for p,key in created.items() if p not in retained}
  # The epoch roots are part of this cleanup boundary even when retained for
  # external rmdir. Unknown children must hold BEFORE any known-file deletion.
  sockets=[r for r in rows if r['op']=='ROOT_SOCKET_BOUND']
  known=set(created)|{self.m['runtimeRoot']+'/'+n for n in (runtime_objects or {})}|{r['path'] for r in sockets}|{i['controlRoot']+'/lifecycle.jsonl'}
  roots=(self.m['sourceRoot'],self.m['configRoot'],self.m['runtimeRoot'],i['controlRoot'],i['gateRoot'],i['canaryRoot'])
  for root in roots:
   if root not in created or self.io.snapshot(root)!=created[root]:raise c.ContractHold('ROOT_REMOVAL_ROOT_DRIFT')
   expected=sorted(q[len(root)+1:] for q in known if q.startswith(root+'/') and '/' not in q[len(root)+1:])
   if self.io.children(root)!=expected:raise c.ContractHold('ROOT_REMOVAL_UNKNOWN_ROOT_CONTENT')
  for p,key in created.items():
   if p==i['controlRoot']+'/lifecycle.jsonl':continue # mutable journal checked by journal reader
   if self.io.snapshot(p)!=key:raise c.ContractHold('ROOT_REMOVAL_PREFLIGHT_DRIFT')
  for socket in sockets:
   if self.io.snapshot(socket['path'])!=socket['key']:raise c.ContractHold('ROOT_REMOVAL_SOCKET_DRIFT')
  return {'created':created,'selected':selected,'retained':retained}
 def remove_installed(self,*,scope_empty_evidence):
  checked=self.preflight(scope_empty_evidence=scope_empty_evidence)
  created,selected,retained=(checked[k] for k in ('created','selected','retained'))
  for p in sorted(selected,key=lambda p:(selected[p]['type']==stat.S_IFDIR,-p.count('/'),p)):
   self.journal.append({'op':'REMOVE_INTENT','path':p,'key':created[p]});self.io.remove(p,created[p]);self.journal.append({'op':'REMOVED','path':p})
  return {'status':'HOLDER_OBJECTS_REMOVED_ROOT_RESIDUALS_REQUIRE_FINALIZER','productionAdmission':False,'retainedForExternalFinalizer':sorted(retained)}
