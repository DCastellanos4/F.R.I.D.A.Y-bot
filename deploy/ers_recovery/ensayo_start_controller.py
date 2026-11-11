"""Capacity gate and exact startup ordering for an approved root bundle.
No capacity is inferred from earlier preflight. Failure/unknown means NO START.
"""
import os,re,time
from pathlib import Path
from . import ensayo_os as c
from .ensayo_privileged_io import FixedRunner
class StartController:
 def __init__(self,m,journal,*,runner=None,read=None):self.m=c.validate_staging(m);self.journal=journal;self.runner=FixedRunner(m) if runner is None else runner;self.read=self._read if read is None else read
 def _read(self,path,cap):
  fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK|os.O_CLOEXEC)
  try:b=os.read(fd,cap+1)
  finally:os.close(fd)
  if len(b)>cap:raise c.ContractHold('ROOT_START_FIELD_QUOTA')
  return b.decode('ascii')
 def capacity(self):
  mem=self.read('/proc/meminfo',8192);values=[]
  for line in mem.splitlines():
   if line.startswith('MemAvailable:'):
    match=re.fullmatch(r'MemAvailable:\s*([0-9]{1,16}) kB',line)
    if not match:raise c.ContractHold('ROOT_START_MEMORY_SCHEMA')
    values.append(int(match[1])*1024)
  if len(values)!=1:raise c.ContractHold('ROOT_START_MEMORY_REQUIRED')
  # Check every possible pids-limited ancestor for this exact system.slice
  # layout. Only root pids.max ENOENT is exempt by cgroup-v2 contract.
  free=[]
  for base in ('/sys/fs/cgroup/system.slice','/sys/fs/cgroup'):
   try:limit=self.read(base+'/pids.max',64).strip()
   except FileNotFoundError:
    # cgroup-v2 docs: root is exempt and has no resource control interface.
    # Only exact hierarchy root absence is NOT_APPLICABLE, never other errors.
    if base=='/sys/fs/cgroup':continue
    raise
   current=self.read(base+'/pids.current',64).strip()
   if not re.fullmatch('[0-9]{1,16}',current) or (limit!='max' and not re.fullmatch('[0-9]{1,16}',limit)):raise c.ContractHold('ROOT_START_PIDS_SCHEMA')
   if limit!='max':free.append(int(limit)-int(current))
  head=self.m['intervention']['headroom']
  if values[0]<head['memoryAvailableMinBytes'] or (free and min(free)<head['parentPidsFreeMin']):raise c.ContractHold('ROOT_START_CAPACITY_NO_START')
  return {'memoryAvailableBytes':values[0],'pidsFreeMin':min(free) if free else 'ALL_CHECKED_PIDS_LIMITS_UNLIMITED','source':'FRESH_BOUNDED_MEMINFO_AND_BOTH_PIDS_ANCESTORS','notPerformanceGuarantee':True}
 def launch(self):
  if any(r['op']=='ROOT_LAUNCH_INTENT' for r in self.journal.rows()):raise c.ContractHold('ROOT_START_NO_RETRY')
  capacity=self.capacity();self.journal.append({'op':'ROOT_LAUNCH_INTENT','capacity':capacity,'reloadScope':'GLOBAL_MANAGER_NOT_UNIT_SCOPED'})
  self.runner.invoke('daemon-reload')
  # Cleanup alive before supervisor, both before any holder gate release. Start
  # is nonblocking but startup is confirmed by independent manager/socket checks.
  i=self.m['intervention'];self.runner.invoke('start',i['cleanupUnit']);deadline=time.monotonic()+2
  while time.monotonic()<deadline:
   observed=self.runner.invoke('show',i['cleanupUnit'])
   if observed['Id']==i['cleanupUnit'] and observed['User']=='0' and observed['SubState']=='running' and int(observed['MainPID'])>0:
    sock=Path(i['controlRoot'])/'custody.sock'
    try:s=sock.lstat()
    except FileNotFoundError:time.sleep(.01);continue
    if not __import__('stat').S_ISSOCK(s.st_mode) or s.st_uid!=0 or __import__('stat').S_IMODE(s.st_mode)!=0o600:raise c.ContractHold('ROOT_START_CLEANUP_SOCKET_CUSTODY')
    break
   if observed['SubState'] not in ('dead','start','start-pre','running'):raise c.ContractHold('ROOT_START_CLEANUP_FAILED')
   time.sleep(.01)
  else:raise c.ContractHold('ROOT_START_CLEANUP_DEADLINE')
  self.runner.invoke('start',i['supervisorUnit']);self.journal.append({'op':'ROOT_SUPERVISOR_START_REQUESTED','productionAdmission':False})
  return {'status':'ROOT_CONTROL_START_REQUESTED_NOT_OS_GATE','productionAdmission':False}
