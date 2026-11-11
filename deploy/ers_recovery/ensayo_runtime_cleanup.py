"""Exact post-stop runtime cleanup through a retained directory capability.
Only original installed private runtime; no recursive/path-prefix deletion.
"""
import hashlib,os,stat
from pathlib import Path
from . import ensayo_os as c
from .ensayo_privileged_io import identity
class PinnedRuntime:
 def __init__(self,m,created_key):
  self.m=c.validate_staging(m);p=Path(m['runtimeRoot']);c.ancestors(p.parent,0);before=p.lstat()
  if identity(before)!=created_key or before.st_uid!=m['uid'] or before.st_gid!=m['gid'] or stat.S_IMODE(before.st_mode)!=0o700:raise c.ContractHold('RUNTIME_ORIGINAL_DIRECTORY_REQUIRED')
  self.path=p;self.key=created_key;self.fd=os.open(p,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW|os.O_CLOEXEC)
  if identity(os.fstat(self.fd))!=self.key:self.close();raise c.ContractHold('RUNTIME_DIRECTORY_OPEN_DRIFT')
 def check(self):
  if identity(self.path.lstat())!=self.key or identity(os.fstat(self.fd))!=self.key:raise c.ContractHold('RUNTIME_DIRECTORY_DRIFT')
 def census(self):
  self.check();names=[]
  with os.scandir(self.fd) as rows:
   for row in rows:
    if len(names)>=8:raise c.ContractHold('RUNTIME_CLEANUP_ENTRY_LIMIT')
    if row.name not in {Path(p).name for p in self.m['paths'].values()}:raise c.ContractHold('RUNTIME_CLEANUP_UNKNOWN_ENTRY')
    names.append(row.name)
  result={};total=0
  for name in names:
   s=os.stat(name,dir_fd=self.fd,follow_symlinks=False)
   if s.st_uid!=self.m['uid'] or s.st_gid!=self.m['gid'] or stat.S_IMODE(s.st_mode)!=0o600 or s.st_nlink!=1:raise c.ContractHold('RUNTIME_CLEANUP_OBJECT_CUSTODY')
   if stat.S_ISSOCK(s.st_mode) and name=='holders.sock':result[name]=identity(s);continue
   if not stat.S_ISREG(s.st_mode) or s.st_size>65536:raise c.ContractHold('RUNTIME_CLEANUP_FILE_LIMIT')
   total+=s.st_size
   if total>131072:raise c.ContractHold('RUNTIME_CLEANUP_TOTAL_LIMIT')
   fd=os.open(name,os.O_RDONLY|os.O_NONBLOCK|os.O_NOFOLLOW|os.O_CLOEXEC,dir_fd=self.fd)
   try:
    own=os.fstat(fd);data=os.read(fd,65537)
    if len(data)!=s.st_size or len(data)>65536 or c.file_key(s)!=c.file_key(own) or c.file_key(own)!=c.file_key(os.fstat(fd)) or c.file_key(own)!=c.file_key(os.stat(name,dir_fd=self.fd,follow_symlinks=False)):raise c.ContractHold('RUNTIME_CLEANUP_FILE_CHANGED')
    result[name]=dict(identity(s),sha256=hashlib.sha256(data).hexdigest(),size=len(data))
   finally:os.close(fd)
  self.check();return result
 def remove(self,journal,*,death_check):
  # The independent collector closure is invoked repeatedly, not a supplied bool.
  # Root control config/code custody must select this callable, never holder data.
  if not callable(death_check):raise c.ContractHold('RUNTIME_INDEPENDENT_DEATH_READER')
  death_check();objects=self.census();journal.append({'op':'RUNTIME_POSTSTOP_CENSUS','directory':self.key,'objects':objects})
  for name,want in objects.items():
   death_check()
   if self.census()!=objects:raise c.ContractHold('RUNTIME_CLEANUP_CENSUS_DRIFT')
   journal.append({'op':'RUNTIME_REMOVE_INTENT','name':name,'key':want});os.unlink(name,dir_fd=self.fd);os.fsync(self.fd);journal.append({'op':'RUNTIME_REMOVED','name':name});objects=dict(objects);del objects[name]
  self.check();return {'status':'EXACT_RUNTIME_ENTRIES_REMOVED_DIRECTORY_RETAINED','productionAdmission':False}
 def close(self):os.close(self.fd)
