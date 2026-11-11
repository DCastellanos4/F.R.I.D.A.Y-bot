"""Exact account reservation primitives for an approved privileged bootstrap.
Never choose IDs, adopt a name, modify ubuntu, add supplementary groups or repair
an ambiguous command. Tests inject NSS/runner fakes; no account calls run at import.
"""
import grp,os,pwd,stat,subprocess
from pathlib import Path
from . import ensayo_os as c
class NSS:
 def user_name(self,name):
  try:return pwd.getpwnam(name)
  except KeyError:return None
 def user_id(self,uid):
  try:return pwd.getpwuid(uid)
  except KeyError:return None
 def group_name(self,name):
  try:return grp.getgrnam(name)
  except KeyError:return None
 def group_id(self,gid):
  try:return grp.getgrgid(gid)
  except KeyError:return None
 def groups(self,name,gid):return sorted(set(os.getgrouplist(name,gid)))
class PrincipalBootstrap:
 def __init__(self,m,journal,*,nss=None,execute=None):self.m=c.validate_staging(m);self.journal=journal;self.nss=NSS() if nss is None else nss;self.execute=self._execute if execute is None else execute
 def _execute(self,argv):
  if os.geteuid()!=0:raise c.ContractHold('PRINCIPAL_ROOT_REQUIRED')
  binary=Path(argv[0]);before=binary.lstat()
  for parent in binary.parents:
   s=parent.lstat()
   if not stat.S_ISDIR(s.st_mode) or parent.resolve()!=parent or s.st_uid!=0 or s.st_mode&0o022:raise c.ContractHold('PRINCIPAL_BINARY_ANCESTOR')
  if binary not in (Path('/usr/sbin/groupadd'),Path('/usr/sbin/useradd')) or not stat.S_ISREG(before.st_mode) or before.st_uid!=0 or before.st_nlink!=1 or before.st_mode&0o022 or binary.resolve()!=binary:raise c.ContractHold('PRINCIPAL_FIXED_BINARY')
  done=subprocess.run(argv,stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,env={'PATH':'/usr/sbin:/usr/bin:/bin','LANG':'C','LC_ALL':'C'},cwd='/',close_fds=True,timeout=2)
  if done.returncode or c.file_key(binary.lstat())!=c.file_key(before):raise c.ContractHold('PRINCIPAL_EFFECT_UNVERIFIED_HOLD_NO_RETRY')
 def reserve(self):
  m=self.m;uid=m['uid'];gid=m['gid'];name='ers-ensayo'
  if m['groups'] not in ([],[gid]):raise c.ContractHold('PRINCIPAL_NO_SUPPLEMENTARY_GROUPS')
  if any(r['op'].startswith('PRINCIPAL_') for r in self.journal.rows()):raise c.ContractHold('PRINCIPAL_NO_RETRY_OR_ADOPTION')
  if any(v is not None for v in (self.nss.user_name(name),self.nss.user_id(uid),self.nss.group_name(name),self.nss.group_id(gid))):raise c.ContractHold('PRINCIPAL_NAME_OR_ID_COLLISION')
  # Numeric IDs must already be resolved in an approved bootstrap config. No
  # search/reservation from a synthetic test value becomes authority by inference.
  self.journal.append({'op':'PRINCIPAL_GROUP_INTENT','name':name,'gid':gid});self.execute(['/usr/sbin/groupadd','--system','--gid',str(gid),'--',name]);g=self.nss.group_name(name)
  if g is None or g.gr_gid!=gid or g.gr_mem or self.nss.group_id(gid)!=g:raise c.ContractHold('PRINCIPAL_GROUP_POSTCHECK_HOLD')
  self.journal.append({'op':'PRINCIPAL_GROUP_CREATED','name':name,'gid':gid})
  self.journal.append({'op':'PRINCIPAL_USER_INTENT','name':name,'uid':uid,'gid':gid});self.execute(['/usr/sbin/useradd','--system','--uid',str(uid),'--gid',str(gid),'--no-user-group','--no-create-home','--home-dir','/nonexistent','--shell','/usr/sbin/nologin','--groups','','--password','!','--',name]);u=self.nss.user_name(name)
  if u is None or (u.pw_uid,u.pw_gid,u.pw_dir,u.pw_shell)!=(uid,gid,'/nonexistent','/usr/sbin/nologin') or self.nss.groups(name,gid)!=[gid] or self.nss.user_id(uid)!=u:raise c.ContractHold('PRINCIPAL_USER_POSTCHECK_HOLD')
  record={'op':'PRINCIPAL_RESERVED','user':name,'group':name,'uid':uid,'gid':gid,'home':'/nonexistent','shell':'/usr/sbin/nologin','groups':[gid]};self.journal.append(record)
  return record
