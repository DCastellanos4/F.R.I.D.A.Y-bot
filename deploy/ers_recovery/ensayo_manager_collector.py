"""Independent bounded manager/proc/cgroup collector, no effect capability.
No bot/environment/log/session reads; only exact manager-returned role PIDs,
fixed process fields and manifest cgroup under /sys/fs/cgroup/system.slice.
"""
import os,re,stat
from pathlib import Path
from . import ensayo_os as c
from .lease import identity
from .ensayo_privileged_io import quota_usec

class Collector:
 def __init__(self,m,runner,*,read=None,statfn=None,identityfn=None):
  self.m=c.validate_staging(m);self.runner=runner;self.reader=self._read if read is None else read;self.statfn=os.stat if statfn is None else statfn;self.identityfn=identity if identityfn is None else identityfn;self.reads=0;self.bytes=0
 def _read(self,path,cap):
  fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK|os.O_CLOEXEC)
  try:return os.read(fd,cap+1)
  finally:os.close(fd)
 def bounded(self,path,cap):
  self.reads+=1
  if self.reads>64 or self.bytes+cap>131072:raise c.ContractHold('COLLECTOR_QUOTA')
  b=self.reader(path,cap)
  if type(b) is not bytes or len(b)>cap:raise c.ContractHold('COLLECTOR_FIELD_LIMIT')
  self.bytes+=len(b)
  try:return b.decode('ascii')
  except UnicodeError:raise c.ContractHold('COLLECTOR_ENCODING') from None
 def manager(self,role):
  if role not in c.ROLES:raise c.ContractHold('COLLECTOR_ROLE')
  unit=self.m['units'][role];o=self.runner.invoke('show',unit)
  expected={'Id':unit,'LoadState':'loaded','FragmentPath':'/etc/systemd/system/'+unit,'DropInPaths':'','NeedDaemonReload':'no','User':str(self.m['uid']),'Group':str(self.m['gid']),'SupplementaryGroups':' '.join(map(str,self.m['groups'])),'ControlGroup':'/system.slice/'+unit,'Delegate':'no','Restart':'no'}
  if any(o.get(k)!=v for k,v in expected.items()) or not c.HEX(32,o.get('InvocationID')):raise c.ContractHold('COLLECTOR_MANAGER_CUSTODY')
  b=self.m['resources'][role]
  if o.get('MemoryMax')!=str(b['memoryMaxBytes']) or o.get('MemorySwapMax')!='0' or o.get('TasksMax')!=str(b['tasksMax']) or quota_usec(o.get('CPUQuotaPerSecUSec',''))!=b['cpuQuotaPercent']*10000:raise c.ContractHold('COLLECTOR_RESOURCE_LIMITS')
  for k in ('MainPID','ControlPID'):
   if type(o.get(k)) is not str or not re.fullmatch('[0-9]{1,12}',o[k]):raise c.ContractHold('COLLECTOR_MANAGER_PID')
  return o
 def process(self,pid,*,role,stage):
  if type(pid) is not int or pid<=0:raise c.ContractHold('COLLECTOR_POSITIVE_PID')
  before=self.identityfn(pid);base='/proc/'+str(pid);status=self.bounded(base+'/status',8192);cg=self.bounded(base+'/cgroup',4096);exe=self.statfn(base+'/exe')
  rows={}
  for line in status.splitlines():
   if ':' not in line:continue
   name,value=line.split(':',1)
   if name in ('Uid','Gid','Groups'):
    if name in rows:raise c.ContractHold('COLLECTOR_STATUS_DUPLICATE')
    rows[name]=value.split()
  try:uid=[int(v) for v in rows['Uid']];gid=[int(v) for v in rows['Gid']];groups=sorted(int(v) for v in rows['Groups'])
  except (KeyError,ValueError):raise c.ContractHold('COLLECTOR_STATUS_SCHEMA') from None
  if uid!=[self.m['uid']]*4 or gid!=[self.m['gid']]*4 or groups!=self.m['groups'] or [exe.st_dev,exe.st_ino]!=[self.m['python']['dev'],self.m['python']['ino']] or self.identityfn(pid)!=before:raise c.ContractHold('COLLECTOR_PROCESS_CUSTODY')
  expected=[self.m['python']['command'],'-I',self.m['sourceRoot']+('/ensayo_prestart_gate.py' if stage=='GATE_ONLY' else '/ensayo_os_worker.py'),'--config',self.m['configs'][role]]
  argv=self.bounded(base+'/cmdline',4096).split('\x00')
  if argv!=expected+[''] or self.identityfn(pid)!=before:raise c.ContractHold('COLLECTOR_EXACT_ROLE_ARGV_REQUIRED')
  return {'identity':before,'exe':[exe.st_dev,exe.st_ino],'cgroup':cg} 
 def scope(self,role,*,stage,reservation=None):
  o=self.manager(role);unit=self.m['units'][role];path='/sys/fs/cgroup/system.slice/'+unit;before=self.statfn(path,follow_symlinks=False)
  if not stat.S_ISDIR(before.st_mode) or before.st_uid!=0 or before.st_mode&0o022:raise c.ContractHold('COLLECTOR_CGROUP_ROOT_CUSTODY')
  procs=self.bounded(path+'/cgroup.procs',4096).split()
  if len(procs)>32 or len(procs)!=len(set(procs)) or any(not re.fullmatch('[1-9][0-9]{0,11}',v) for v in procs):raise c.ContractHold('COLLECTOR_CGROUP_MEMBERS')
  pids=sorted(int(v) for v in procs)
  if stage=='GATE_ONLY':
   pid=int(o['ControlPID'])
   if int(o['MainPID'])!=0 or pid<=0 or pids!=[pid] or o['SubState']!='start-pre':raise c.ContractHold('COLLECTOR_ONLY_GATE_REQUIRED')
  elif stage=='HOLDER':
   pid=int(o['MainPID'])
   if int(o['ControlPID'])!=0 or pid<=0 or pid not in pids or o['SubState']!='running':raise c.ContractHold('COLLECTOR_HOLDER_REQUIRED')
  else:raise c.ContractHold('COLLECTOR_STAGE')
  process=self.process(pid,role=role,stage=stage)
  if process['cgroup']!='0::'+o['ControlGroup']+'\n':raise c.ContractHold('COLLECTOR_CGROUP_PROCESS_MISMATCH')
  key=[before.st_dev,before.st_ino]
  if reservation is not None and (reservation['unit']!=unit or reservation['invocation']!=o['InvocationID'] or reservation['cgroupKey']!=key):raise c.ContractHold('COLLECTOR_TRANSITION_CUSTODY_DRIFT')
  after=self.statfn(path,follow_symlinks=False)
  if (after.st_dev,after.st_ino)!=(before.st_dev,before.st_ino) or self.manager(role)!=o:raise c.ContractHold('COLLECTOR_FINAL_DRIFT')
  return {'unit':unit,'invocation':o['InvocationID'],'cgroup':o['ControlGroup'],'cgroupKey':key,'stage':stage,'process':process,'memberPids':pids,'manager':o}
