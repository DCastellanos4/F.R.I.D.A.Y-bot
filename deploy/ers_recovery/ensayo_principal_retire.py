"""Exact account removal companion, only for the original bootstrap receipt.
No --force, --remove/home deletion, name adoption or blanket group changes.
"""
import os,stat,subprocess
from pathlib import Path
from . import ensayo_os as c
from .ensayo_principal_bootstrap import NSS
class PrincipalRetire:
 def __init__(self,m,journal,*,nss=None,execute=None):self.m=c.validate_staging(m);self.j=journal;self.nss=NSS() if nss is None else nss;self.execute=self._execute if execute is None else execute
 def _execute(self,argv):
  if os.geteuid()!=0:raise c.ContractHold('PRINCIPAL_RETIRE_ROOT')
  path=Path(argv[0]);before=path.lstat()
  if path not in (Path('/usr/sbin/userdel'),Path('/usr/sbin/groupdel')) or not stat.S_ISREG(before.st_mode) or before.st_uid!=0 or before.st_nlink!=1 or before.st_mode&0o022 or path.resolve()!=path:raise c.ContractHold('PRINCIPAL_RETIRE_FIXED_BINARY')
  for parent in path.parents:c.ancestors(parent,0)
  done=subprocess.run(argv,stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,env={'PATH':'/usr/sbin:/usr/bin:/bin','LANG':'C','LC_ALL':'C'},cwd='/',close_fds=True,timeout=2)
  if done.returncode or c.file_key(path.lstat())!=c.file_key(before):raise c.ContractHold('PRINCIPAL_RETIRE_UNVERIFIED_HOLD')
 def preflight(self,receipt):
  rows=self.j.rows();originals=[r for r in rows if r['op']=='PRINCIPAL_RESERVED']
  if type(receipt) is not dict or set(receipt)!={'op','user','group','uid','gid','home','shell','groups'}:raise c.ContractHold('PRINCIPAL_RETIRE_ORIGINAL_RECEIPT')
  if originals!=[receipt] or receipt['op']!='PRINCIPAL_RESERVED' or receipt['home']!='/nonexistent' or receipt['shell']!='/usr/sbin/nologin' or receipt['groups']!=[self.m['gid']] or receipt['uid']!=self.m['uid'] or receipt['gid']!=self.m['gid'] or receipt['user']!='ers-ensayo' or receipt['group']!='ers-ensayo':raise c.ContractHold('PRINCIPAL_RETIRE_ORIGINAL_RECEIPT')
  if any(r['op']=='PRINCIPAL_RETIRE_INTENT' for r in rows):raise c.ContractHold('PRINCIPAL_RETIRE_NO_RETRY')
  u=self.nss.user_name('ers-ensayo');g=self.nss.group_name('ers-ensayo')
  if u is None or g is None or (u.pw_uid,u.pw_gid,u.pw_dir,u.pw_shell)!=(receipt['uid'],receipt['gid'],'/nonexistent','/usr/sbin/nologin') or g.gr_gid!=receipt['gid'] or g.gr_mem or self.nss.groups('ers-ensayo',receipt['gid'])!=[receipt['gid']] or self.nss.user_id(receipt['uid'])!=u or self.nss.group_id(receipt['gid'])!=g:raise c.ContractHold('PRINCIPAL_RETIRE_NSS_DRIFT')
  return {'receipt':receipt,'user':tuple(u),'group':tuple(g)}
 def remove(self,receipt):
  self.preflight(receipt)
  # userdel itself must refuse a live account; no force flag can bypass it.
  self.j.append({'op':'PRINCIPAL_RETIRE_INTENT','uid':receipt['uid'],'gid':receipt['gid']});self.execute(['/usr/sbin/userdel','--','ers-ensayo'])
  if self.nss.user_name('ers-ensayo') is not None or self.nss.user_id(receipt['uid']) is not None:raise c.ContractHold('PRINCIPAL_RETIRE_USER_ABSENCE_UNVERIFIED')
  self.j.append({'op':'PRINCIPAL_USER_REMOVED','uid':receipt['uid']});self.execute(['/usr/sbin/groupdel','--','ers-ensayo'])
  if self.nss.group_name('ers-ensayo') is not None or self.nss.group_id(receipt['gid']) is not None:raise c.ContractHold('PRINCIPAL_RETIRE_GROUP_ABSENCE_UNVERIFIED')
  self.j.append({'op':'PRINCIPAL_GROUP_REMOVED','gid':receipt['gid']});return {'status':'ORIGINAL_ACCOUNT_GROUP_REMOVED_NO_HOME_ACTION'}
