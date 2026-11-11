"""Prepared ENSAYO_OS holder. Root-config route only; no LOCAL fallback.
No install, systemctl, bot reads, or effect backend. Fixture entrypoint is separate.
"""
import importlib,json,os,socket,sys,types,signal
from pathlib import Path
sys.dont_write_bytecode=True
ROOT=Path(__file__).resolve().parent
if __package__:
 from . import ensayo_os as contract
else:
 pkg=types.ModuleType('_ers_ensayo');pkg.__path__=[str(ROOT)];sys.modules['_ers_ensayo']=pkg
 contract=importlib.import_module('_ers_ensayo.ensayo_os')

def session(path,custody,*,fixture_invocation=None):
 cfg,key=custody.read_config(path);m,role=contract.validate_config(cfg,path=path)
 evidence=custody.check(m,path,cfg,key)
 if ROOT!=custody.physical(m['sourceRoot']):raise contract.ContractHold('STAGING_EXEC_SOURCE_ROOT_MISMATCH')
 invocation=os.environ.get('INVOCATION_ID') if fixture_invocation is None else fixture_invocation
 if not contract.HEX(32,invocation):raise contract.ContractHold('STAGING_INVOCATION_REQUIRED')
 package=__package__ or '_ers_ensayo'
 lease_mod=importlib.import_module(package+'.lease');comp=importlib.import_module(package+'.composition');paired=importlib.import_module(package+'.paired');policy=importlib.import_module(package+'.policy')
 directory=custody.physical(m['runtimeRoot']);lock=custody.physical(m['paths']['lock']);sockpath=custody.physical(m['paths']['socket']);lease=None;listener=None;store=None;c=None
 def config_check():
  if custody.check(m,path,cfg,key)!=evidence:raise contract.ContractHold('STAGING_CUSTODY_CHANGED')
  contract.runtime_quota(m,custody)
 try:
  # Every admission above occurs before creating mutable state or a socket.
  config_check()
  if role=='controller':
   if any(directory.iterdir()):raise contract.ContractHold('STAGING_EMPTY_RUNTIME_REQUIRED')
   fd=os.open(lock,os.O_CREAT|os.O_EXCL|os.O_WRONLY|os.O_NOFOLLOW|os.O_CLOEXEC,0o600);os.close(fd)
   lease=lease_mod.Lease.acquire_existing(lock);listener=socket.socket(socket.AF_UNIX,socket.SOCK_SEQPACKET);listener.settimeout(3);listener.bind(str(sockpath));os.chmod(sockpath,0o600);listener.listen(1);c,_=listener.accept();c.settimeout(3);hello=lease_mod.receive_record(c)
   if type(hello) is not dict or set(hello)!={'token','identity','manifestDigest'} or hello['token']!=cfg['token'] or hello['manifestDigest']!=contract.digest(m):raise ValueError('AUTH')
   remote=hello['identity'];lease_mod.peer(c,remote);config_check();lease_mod.record(c,{'token':cfg['token'],'identity':lease_mod.identity(),'epoch':lease.epoch,'manifestDigest':contract.digest(m)});lease.offer(c,remote)
  else:
   c=socket.socket(socket.AF_UNIX,socket.SOCK_SEQPACKET);c.settimeout(3);c.connect(str(sockpath));lease_mod.record(c,{'token':cfg['token'],'identity':lease_mod.identity(),'manifestDigest':contract.digest(m)});hello=lease_mod.receive_record(c)
   if type(hello) is not dict or set(hello)!={'token','identity','epoch','manifestDigest'} or hello['token']!=cfg['token'] or hello['manifestDigest']!=contract.digest(m):raise ValueError('AUTH')
   remote=hello['identity'];lease_mod.peer(c,remote);config_check();lease=lease_mod.Lease.accept(c,remote,lock,hello['epoch'])
  apps=[policy.App(0,'synthetic-api',100,10,'online'),policy.App(1,'synthetic-wa',101,11,'online')];config_check();store=comp.Store(directory)
  pair=paired.Pair(store,lease,c,remote,paired.source_digest(),apps,donor=role=='controller')
  if role=='controller':
   pair.enroll();answer=pair._request({'op':'CENSUS'})
   if answer.get('state')!=paired.digest(pair.live):raise ValueError('CENSUS')
  else:
   for _ in range(4):pair.service_once()
  config_check();own=pair.own()
  receipt={'status':'ENSAYO_HOLDER_ORIGINAL_COMMITTED','role':role,'process':lease_mod.identity(),'manifestDigest':contract.digest(m),'sourceDigest':contract.digest(m['sourceFiles']),'epoch':m['epoch'],'invocation':invocation,'cgroup':own['process']['cgroup'],'leaseKey':lease.validate()['key'],'productionAdmission':False,'osContainment':'UNVERIFIED','effectAdapter':'ABSENT','custodyClass':custody.evidence_class}
  contract.write_receipt(m,role,custody,receipt);contract.runtime_quota(m,custody)
  # Lifetime/termination/cleanup belong to an external exact-identity executor.
  # No self cleanup; peer death cannot erase the surviving holder's namespace.
  signal.pause()
 finally:
  if store is not None:store.close()
  if lease is not None:lease.close()
  if c is not None:c.close()
  if listener is not None:listener.close()
if __name__=='__main__':
 try:
  if len(sys.argv)!=3 or sys.argv[1]!='--config':raise ValueError('FIXED_CONFIG_ROUTE')
  session(sys.argv[2],contract.RootCustody())
 except BaseException:raise SystemExit(2) from None
