"""LOCAL-only launcher for independent original holders, never systemctl/PM2."""
import hashlib,json,os,secrets,select,signal,subprocess,sys,time
from pathlib import Path
from .unit_contract import validate,prepared,ContractHold,digest,local_namespace

def line(p,deadline=3):
 end=time.monotonic()+deadline;b=b''
 while time.monotonic()<end:
  ready,_,_=select.select([p.stdout],[],[],max(0,end-time.monotonic()))
  if not ready:break
  chunk=os.read(p.stdout.fileno(),1)
  if not chunk:raise ContractHold('WORKER_CLOSED')
  if chunk==b'\n':return b.decode()
  b+=chunk
  if len(b)>4096:raise ContractHold('WORKER_OUTPUT_LIMIT')
 raise ContractHold('WORKER_DEADLINE')

def run_local(directory,manifest,*,token_override=None,kill_controller=False):
 validate(manifest);proposal=prepared(manifest);root=Path(__file__).resolve().parent
 if (manifest['uid'],manifest['gid'],manifest['groups'])!=(os.getuid(),os.getgid(),sorted(set(os.getgroups()))):raise ContractHold('LOCAL_IDS_MUST_MATCH_EXPLICIT_MANIFEST')
 directory=local_namespace(directory,empty=True)
 for name,want in manifest['sourceFiles'].items():
  if hashlib.sha256((root/name).read_bytes()).hexdigest()!=want:raise ContractHold('LAUNCH_SOURCE_MISMATCH')
 if manifest['sourceRoot']!='/opt/ers/'+digest(manifest['sourceFiles']):raise ContractHold('SOURCE_ROOT_DIGEST_MISMATCH')
 lock=directory/'deploy.lock';fd=os.open(lock,os.O_CREAT|os.O_EXCL|os.O_WRONLY|os.O_CLOEXEC,0o600);os.close(fd)
 token=secrets.token_hex(32);workers=[]
 common={'mode':'LOCAL_SYNTHETIC_ONLY','directory':str(directory),'lock':str(lock),'socket':str(directory/'channel.sock'),'token':token,'expectedSourceFiles':manifest['sourceFiles'],'apps':[{'app_id':0,'config':'synthetic-api','pid':100,'start':10,'status':'online'},{'app_id':1,'config':'synthetic-wa','pid':101,'start':11,'status':'online'}]}
 def spawn(role):
  cfg=dict(common,role=role)
  if role=='watchdog' and token_override is not None:cfg['token']=token_override
  p=subprocess.Popen([sys.executable,'-I',str(root/'bootstrap_worker.py'),'--stdin-config'],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,env={'PATH':'/usr/bin:/bin','LANG':'C.UTF-8'},close_fds=True,start_new_session=True)
  workers.append(p);p.stdin.write(json.dumps(cfg).encode()+b'\n');p.stdin.flush();return p
 try:
  controller=spawn('controller')
  if line(controller)!='LISTENING':raise ContractHold('BOOTSTRAP_LISTENER_FAILED')
  watchdog=spawn('watchdog');answer=json.loads(line(controller))
  if answer!={'status':'LOCAL_ORIGINAL_HOLDERS_COMMITTED','productionAdmission':False} or line(watchdog)!='COMMITTED':raise ContractHold('COMMIT_NOT_VERIFIED')
  if any(p.poll() is not None for p in workers):raise ContractHold('HOLDER_DIED')
  f=os.open(lock,os.O_RDONLY|os.O_NOFOLLOW)
  try:
   import fcntl
   try:fcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB)
   except BlockingIOError:busy=True
   else:busy=False
  finally:os.close(f)
  if not busy:raise ContractHold('SHARED_LEASE_NOT_HELD')
  survivor_busy=None
  if kill_controller:
   os.killpg(controller.pid,signal.SIGKILL);controller.wait(timeout=3)
   f=os.open(lock,os.O_RDONLY|os.O_NOFOLLOW)
   try:
    try:fcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB)
    except BlockingIOError:survivor_busy=True
    else:survivor_busy=False
   finally:os.close(f)
   if survivor_busy is not True or watchdog.poll() is not None:raise ContractHold('SURVIVOR_CUSTODY_LOST')
  result={'status':'LOCAL_TWO_ORIGINAL_PROCESS_BOOTSTRAP_VERIFIED','productionAdmission':False,'holderPids':[p.pid for p in workers],'leaseBusy':True,'manifestDigest':proposal['manifestDigest'],'unitSourceHashes':proposal['unitSourceHashes'],'osUnitAdmission':'NOT_INSTALLED_NOT_ATTESTED','effects':[],'survivorLeaseBusyAfterControllerDeath':survivor_busy}
  for p in workers:
   if p.poll() is None:p.stdin.write(b'X');p.stdin.flush()
  for p in workers:
   code=p.wait(timeout=3)
   if code!=0 and not (kill_controller and p is controller and code==-signal.SIGKILL):raise ContractHold('LOCAL_EXIT_FAILED')
  return result
 finally:
  for p in workers:
   if p.poll() is None:
    try:os.killpg(p.pid,signal.SIGKILL)
    except ProcessLookupError:pass
   p.wait()
   p.stdin.close();p.stdout.close()
