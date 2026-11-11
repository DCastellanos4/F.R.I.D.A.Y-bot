"""Retained original cgroup directory and events/procs read descriptors.
No mkdir, migration, delegation, adoption or cgroup.kill writes. The manager owns
its tree. Read failure after removal is HOLD, never assumed empty/dead.
"""
import os,stat
from pathlib import Path
from . import ensayo_os as c
class ScopeFD:
 def __init__(self,m,reservation):
  self.m=c.validate_staging(m);self.r=reservation;unit=reservation['unit']
  if unit not in m['units'].values() or reservation['cgroup']!='/system.slice/'+unit:raise c.ContractHold('SCOPE_FD_FIXED_UNIT')
  self.path=Path('/sys/fs/cgroup')/reservation['cgroup'].lstrip('/');self.fd=None;self.procs=None;self.events=None
  try:
   before=self.path.lstat()
   if not stat.S_ISDIR(before.st_mode) or before.st_uid!=0 or before.st_mode&0o022 or [before.st_dev,before.st_ino]!=reservation['cgroupKey']:raise c.ContractHold('SCOPE_FD_ORIGINAL_CUSTODY')
   self.fd=os.open(self.path,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW|os.O_CLOEXEC)
   for field in ('procs','events'):
    fd=os.open('cgroup.'+field,os.O_RDONLY|os.O_NOFOLLOW|os.O_CLOEXEC,dir_fd=self.fd);setattr(self,field,fd)
   if [os.fstat(self.fd).st_dev,os.fstat(self.fd).st_ino]!=reservation['cgroupKey']:raise c.ContractHold('SCOPE_FD_OPEN_DRIFT')
  except BaseException:self.close();raise
 def _field(self,fd):
  try:os.lseek(fd,0,os.SEEK_SET);b=os.read(fd,4097)
  except OSError:raise c.ContractHold('SCOPE_FD_ORIGINAL_UNREADABLE_NO_DEATH_PROOF') from None
  if len(b)>4096:raise c.ContractHold('SCOPE_FD_FIELD_LIMIT')
  return b.decode('ascii')
 def empty(self):
  own=os.fstat(self.fd)
  if [own.st_dev,own.st_ino]!=self.r['cgroupKey']:raise c.ContractHold('SCOPE_FD_IDENTITY_DRIFT')
  procs=self._field(self.procs).split();rows=self._field(self.events).splitlines();events={}
  for line in rows:
   pair=line.split()
   if len(pair)!=2 or pair[0] in events or pair[0] not in ('populated','frozen') or pair[1] not in ('0','1'):raise c.ContractHold('SCOPE_FD_EVENTS_SCHEMA')
   events[pair[0]]=pair[1]
  if procs or events.get('populated')!='0':raise c.ContractHold('SCOPE_FD_NOT_EMPTY')
  return {'unit':self.r['unit'],'invocation':self.r['invocation'],'cgroupKey':self.r['cgroupKey'],'members':[],'source':'INDEPENDENT_PINNED_CGROUP_FD'}
 def close(self):
  for name in ('procs','events','fd'):
   fd=getattr(self,name,None)
   if fd is not None:os.close(fd);setattr(self,name,None)
