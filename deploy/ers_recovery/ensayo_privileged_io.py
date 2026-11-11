"""Concrete privileged syscall substrate for a future approved intervention.
No CLI or auto-execution. Preparation tests use explicit syscall fakes. This is
not the semantic FixtureRootBackend and does not manufacture manager/kernel facts.
"""
import hashlib,os,selectors,stat,subprocess,time
from pathlib import Path
from .unit_contract import ContractHold
from . import ensayo_os as c

class Calls:
 """Real implementations, invoked only when an operator explicitly instantiates.
 Tests replace this complete interface. RootIO refuses nonroot real use.
 """
 is_fixture=False
 def euid(self):return os.geteuid()
 def open(self,*a,**kw):return os.open(*a,**kw)
 def close(self,*a):return os.close(*a)
 def stat(self,*a,**kw):return os.stat(*a,**kw)
 def fstat(self,*a):return os.fstat(*a)
 def mkdir(self,*a,**kw):return os.mkdir(*a,**kw)
 def read(self,*a):return os.read(*a)
 def write(self,*a):return os.write(*a)
 def fchmod(self,*a):return os.fchmod(*a)
 def fchown(self,*a):return os.fchown(*a)
 def fsync(self,*a):return os.fsync(*a)
 def unlink(self,*a,**kw):return os.unlink(*a,**kw)
 def rmdir(self,*a,**kw):return os.rmdir(*a,**kw)
 def scandir(self,*a,**kw):return os.scandir(*a,**kw)

def quota_usec(value):
 # Closed systemd duration projection, no float or locale-dependent parsing.
 import re
 match=re.fullmatch(r'([0-9]{1,12})(us|ms|s)',value)
 if not match:raise ContractHold('MANAGER_CPU_QUOTA_SCHEMA')
 return int(match[1])*{'us':1,'ms':1000,'s':1000000}[match[2]]

def identity(s):
 return {'dev':s.st_dev,'ino':s.st_ino,'uid':s.st_uid,'gid':s.st_gid,'mode':stat.S_IMODE(s.st_mode),'nlink':s.st_nlink,'type':stat.S_IFMT(s.st_mode)}

class RootIO:
 """Fixed manifest allowlist, descriptor-relative, nofollow ancestor custody.
 No chown of an existing path. No recursive deletes, replace, shell or path API.
 The root-owned execution config remains the external authority boundary.
 """
 def __init__(self,manifest,*,calls=None):
  self.m=c.validate_staging(manifest);self.s=Calls() if calls is None else calls
  if self.s.euid()!=0:raise ContractHold('ROOT_IO_REQUIRES_PRIVILEGED_EXECUTION')
  m=self.m;i=m['intervention']
  self.allow={'/opt/ers','/etc/ers-ensayo','/var/lib/ers-ensayo-control',m['sourceRoot'],m['configRoot'],m['runtimeRoot'],i['controlRoot'],i['canaryRoot'],i['gateRoot']}|{m['sourceRoot']+'/'+n for n in c.STAGING_SOURCES}|set(m['configs'].values())|set(m['paths'].values())|{'/etc/systemd/system/'+u for u in m['units'].values()}|{'/etc/systemd/system/'+i[r+'Unit'] for r in ('supervisor','cleanup')}|{'/etc/systemd/system/ers-ensayo-cleanup-'+m['epoch']+'.timer'}|{i['controlRoot']+'/'+n for n in ('supervisor.py','cleanup.py','supervisor.json','cleanup.json','ensayo_privileged_io.py','ensayo_manager_collector.py','ensayo_root_journal.py','ensayo_root_custodian.py','ensayo_scope_fd.py','ensayo_scope_handoff.py','ensayo_runtime_cleanup.py','ensayo_root_install.py','ensayo_control_program.py','bootstrap-receipt.json','lifecycle.jsonl')}|{i['gateRoot']+'/release.sock',i['controlRoot']+'/custody.sock'}|{i['canaryRoot']+'/'+n for n in ('public.txt','channel.sock')}
 def parent(self,path):
  if path not in self.allow:raise ContractHold('ROOT_IO_FIXED_TARGET_REQUIRED')
  p=Path(path)
  if not p.is_absolute() or '..' in p.parts or str(p)!=path:raise ContractHold('ROOT_IO_EXACT_PATH')
  fd=self.s.open('/',os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW|os.O_CLOEXEC)
  try:
   for part in p.parts[1:-1]:
    nextfd=self.s.open(part,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW|os.O_CLOEXEC,dir_fd=fd)
    s=self.s.fstat(nextfd)
    if not stat.S_ISDIR(s.st_mode) or s.st_uid!=0 or s.st_mode&0o022:self.s.close(nextfd);raise ContractHold('ROOT_IO_ROOT_ANCESTOR_REQUIRED')
    self.s.close(fd);fd=nextfd
   return fd,p.name
  except BaseException:self.s.close(fd);raise
 def snapshot(self,path,*,limit=1048576):
  d,name=self.parent(path)
  try:
   try:before=self.s.stat(name,dir_fd=d,follow_symlinks=False)
   except FileNotFoundError:return None
   result=identity(before)
   if stat.S_ISDIR(before.st_mode) or stat.S_ISSOCK(before.st_mode):return result
   if not stat.S_ISREG(before.st_mode) or before.st_nlink!=1 or before.st_size>limit:raise ContractHold('ROOT_IO_TYPE_OR_SIZE')
   fd=self.s.open(name,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK|os.O_CLOEXEC,dir_fd=d)
   try:
    own=self.s.fstat(fd)
    if c.file_key(own)!=c.file_key(before):raise ContractHold('ROOT_IO_OPEN_RACE')
    data=b''
    while len(data)<limit:
     b=self.s.read(fd,min(65536,limit-len(data)))
     if not b:break
     data+=b
    if len(data)!=own.st_size or c.file_key(self.s.fstat(fd))!=c.file_key(own) or c.file_key(self.s.stat(name,dir_fd=d,follow_symlinks=False))!=c.file_key(own):raise ContractHold('ROOT_IO_SNAPSHOT_CHANGED')
    result.update(size=len(data),sha256=hashlib.sha256(data).hexdigest());return result
   finally:self.s.close(fd)
  finally:self.s.close(d)
 def create(self,path,data,*,uid,gid,mode):
  if type(data) is not bytes or len(data)>1048576 or any(type(v) is not int or v<0 for v in (uid,gid,mode)) or mode&0o022:raise ContractHold('ROOT_IO_CREATE_PARAMETERS')
  d,name=self.parent(path)
  try:
   fd=self.s.open(name,os.O_CREAT|os.O_EXCL|os.O_WRONLY|os.O_NOFOLLOW|os.O_CLOEXEC,0o600,dir_fd=d)
   try:
    # A failure here intentionally leaves a partial object. Caller intent log
    # must hold, not repair, retry, unlink, or claim completion.
    offset=0
    while offset<len(data):
     written=self.s.write(fd,data[offset:])
     if written<=0:raise ContractHold('ROOT_IO_SHORT_WRITE')
     offset+=written
    self.s.fchown(fd,uid,gid);self.s.fchmod(fd,mode);self.s.fsync(fd)
   finally:self.s.close(fd)
   self.s.fsync(d)
  finally:self.s.close(d)
  return self.snapshot(path)
 def create_directory(self,path,*,uid,gid,mode):
  if any(type(v) is not int or v<0 for v in (uid,gid,mode)) or mode&0o022:raise ContractHold('ROOT_IO_DIRECTORY_PARAMETERS')
  d,name=self.parent(path)
  try:
   self.s.mkdir(name,0o700,dir_fd=d);fd=self.s.open(name,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW|os.O_CLOEXEC,dir_fd=d)
   try:self.s.fchown(fd,uid,gid);self.s.fchmod(fd,mode);self.s.fsync(fd)
   finally:self.s.close(fd)
   self.s.fsync(d)
  finally:self.s.close(d)
  return self.snapshot(path)
 def children(self,path,*,limit=64):
  d,name=self.parent(path);fd=None
  try:
   fd=self.s.open(name,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW|os.O_CLOEXEC,dir_fd=d);before=identity(self.s.fstat(fd));names=[]
   with self.s.scandir(fd) as entries:
    for row in entries:
     if len(names)>=limit:raise ContractHold('ROOT_IO_CHILD_QUOTA')
     names.append(row.name)
   if identity(self.s.fstat(fd))!=before or identity(self.s.stat(name,dir_fd=d,follow_symlinks=False))!=before:raise ContractHold('ROOT_IO_CHILD_DIRECTORY_DRIFT')
   return sorted(names)
  finally:
   if fd is not None:self.s.close(fd)
   self.s.close(d)
 def remove(self,path,want):
  # Root-only ancestors and no delegation to the holders are prerequisites.
  # No atomic name+hash unlink primitive exists; immediate checks are not an
  # atomic multi-object transaction. A privileged concurrent actor can race.
  if self.snapshot(path)!=want:raise ContractHold('ROOT_IO_REMOVE_DRIFT')
  d,name=self.parent(path)
  try:
   if identity(self.s.stat(name,dir_fd=d,follow_symlinks=False))!={k:want[k] for k in ('dev','ino','uid','gid','mode','nlink','type')}:raise ContractHold('ROOT_IO_REMOVE_IDENTITY_CHANGED')
   if want['type']==stat.S_IFDIR:self.s.rmdir(name,dir_fd=d)
   else:self.s.unlink(name,dir_fd=d)
   self.s.fsync(d)
  finally:self.s.close(d)

class FixedRunner:
 """Only literal systemctl verbs/properties on exact generated unit names.
 No shell. Real executable/ancestors root custody before/after bounded Popen.
 stdout is private structured input, never forwarded raw. No journald/env reads.
 """
 properties=('Id','LoadState','ActiveState','SubState','MainPID','ControlPID','InvocationID','ControlGroup','FragmentPath','DropInPaths','NeedDaemonReload','User','Group','SupplementaryGroups','MemoryMax','MemorySwapMax','CPUQuotaPerSecUSec','TasksMax','Restart','Delegate','ExecStart','ExecStartPre')
 def __init__(self,m,*,spawn=None):
  self.m=c.validate_staging(m);self.spawn=subprocess.Popen if spawn is None else spawn;i=m['intervention'];self.units=set(m['units'].values())|{i[r+'Unit'] for r in ('supervisor','cleanup')}|{'ers-ensayo-cleanup-'+m['epoch']+'.timer'}
 def binary_custody(self):
  binary=Path('/usr/bin/systemctl')
  for p in (Path('/'),Path('/usr'),Path('/usr/bin')):
   s=p.lstat()
   if not stat.S_ISDIR(s.st_mode) or p.resolve()!=p or s.st_uid!=0 or s.st_mode&0o022:raise ContractHold('MANAGER_BINARY_ANCESTOR')
  s=binary.lstat()
  if not stat.S_ISREG(s.st_mode) or binary.resolve()!=binary or s.st_uid!=0 or s.st_nlink!=1 or s.st_mode&0o022 or not s.st_mode&0o111:raise ContractHold('MANAGER_FIXED_BINARY_CUSTODY')
  return c.file_key(s)
 def invoke(self,verb,unit=None):
  if verb not in ('show','start','stop','daemon-reload') or (verb!='daemon-reload' and unit not in self.units) or (verb=='daemon-reload' and unit is not None):raise ContractHold('MANAGER_COMMAND_NOT_ALLOWED')
  argv=['/usr/bin/systemctl','--system','--no-pager','--no-ask-password']
  if verb=='show':argv+=['show','--property='+','.join(self.properties),unit]
  elif verb=='daemon-reload':argv+=['daemon-reload']
  else:argv+=([verb,'--no-block',unit] if verb=='start' else [verb,unit])
  pin=self.binary_custody();p=self.spawn(argv,stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,env={'PATH':'/usr/bin:/bin','LANG':'C','LC_ALL':'C','SYSTEMD_COLORS':'0'},cwd='/',close_fds=True,start_new_session=True)
  sel=selectors.DefaultSelector();out=b'';end=time.monotonic()+2
  try:
   sel.register(p.stdout,selectors.EVENT_READ)
   while True:
    remaining=end-time.monotonic()
    if remaining<=0 or not sel.select(remaining):raise ContractHold('MANAGER_COMMAND_DEADLINE')
    b=os.read(p.stdout.fileno(),16385-len(out));out+=b
    if len(out)>16384:raise ContractHold('MANAGER_OUTPUT_LIMIT')
    if not b:break
   if p.wait(timeout=max(.001,end-time.monotonic()))!=0 or self.binary_custody()!=pin:raise ContractHold('MANAGER_COMMAND_UNVERIFIED')
   if verb!='show':
    if out:raise ContractHold('MANAGER_EFFECT_UNEXPECTED_OUTPUT')
    return {'status':'TRANSPORT_RETURNED_ZERO_EFFECT_REQUIRES_RECONCILIATION','verb':verb,'unit':unit}
   result={}
   for line in out.decode('utf8').splitlines():
    if '=' not in line:raise ContractHold('MANAGER_PROJECTION_SCHEMA')
    name,value=line.split('=',1)
    if name not in self.properties or name in result or len(value)>4096:raise ContractHold('MANAGER_PROJECTION_SCHEMA')
    result[name]=value
   if set(result)!=set(self.properties):raise ContractHold('MANAGER_PROJECTION_MISSING')
   return result
  finally:
   sel.close()
   if p.poll() is None:p.kill()
   p.wait(timeout=.25);p.stdout.close()
