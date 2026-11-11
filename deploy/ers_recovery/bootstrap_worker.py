"""Prepared LOCAL holder worker. No service backend or PM2 capabilities.
An installed service would need independent root-config/source custody admission.
"""
import argparse,hashlib,importlib,json,os,socket,sys,types,signal
from pathlib import Path

def packet(c,value):
 b=json.dumps(value,separators=(',',':')).encode()
 if len(b)>4096 or c.send(b)!=len(b):raise ValueError('PROTOCOL')
def receive(c):
 b,anc,flags,_=c.recvmsg(4096,0)
 if anc or flags:raise ValueError('PROTOCOL')
 return json.loads(b)
def main(cfg,*,hold_until_signal=False):
 required={'mode','role','directory','lock','socket','token','expectedSourceFiles','apps'}
 if type(cfg) is not dict or set(cfg)!=required or cfg['mode']!='LOCAL_SYNTHETIC_ONLY' or cfg['role'] not in ('controller','watchdog'):raise ValueError('CONFIG')
 root=Path(__file__).resolve().parent
 names={'composition.py', 'observations.py', 'paired.py', 'bounded_unit.py', 'local_runner.py', 'policy.py', 'unit_read.py', 'campaign.py', 'bootstrap_worker.py', 'local_unit_launcher.py', 'lease.py', 'bounded_http.py', 'unit_contract.py', 'bounded_rpc.py'}
 if set(cfg['expectedSourceFiles'])!=names:raise ValueError('SOURCE_SET')
 for name,want in cfg['expectedSourceFiles'].items():
  if hashlib.sha256((root/name).read_bytes()).hexdigest()!=want:raise ValueError('SOURCE_CHANGED')
 if type(cfg['token']) is not str or len(cfg['token'])!=64:raise ValueError('TOKEN')
 # Private closed package root after exact expected source check. No bot imports.
 package=types.ModuleType('_ers_local');package.__path__=[str(root)];sys.modules['_ers_local']=package
 lease_mod=importlib.import_module('_ers_local.lease');comp=importlib.import_module('_ers_local.composition');paired=importlib.import_module('_ers_local.paired');policy=importlib.import_module('_ers_local.policy');contract=importlib.import_module('_ers_local.unit_contract')
 directory=contract.local_namespace(cfg['directory'])
 # No arbitrary path within this local worker's private test namespace.
 if cfg['socket']!=str(directory/'channel.sock') or cfg['lock']!=str(directory/'deploy.lock'):raise ValueError('FIXED_LOCAL_PATHS')
 c=socket.socket(socket.AF_UNIX,socket.SOCK_SEQPACKET);c.settimeout(3);listener=None;lease=None;store=None
 try:
  if cfg['role']=='controller':
   lease=lease_mod.Lease.acquire_existing(cfg['lock']);c.bind(cfg['socket']);c.listen(1);print('LISTENING',flush=True);listener=c;c,_=listener.accept();c.settimeout(3)
   hello=receive(c)
   if type(hello) is not dict or set(hello)!={'token','identity'} or hello['token']!=cfg['token']:raise ValueError('AUTH')
   remote=hello['identity'];lease_mod.peer(c,remote);packet(c,{'token':cfg['token'],'identity':lease_mod.identity(),'epoch':lease.epoch});lease.offer(c,remote)
  else:
   c.connect(cfg['socket']);packet(c,{'token':cfg['token'],'identity':lease_mod.identity()});hello=receive(c)
   if type(hello) is not dict or set(hello)!={'token','identity','epoch'} or hello['token']!=cfg['token']:raise ValueError('AUTH')
   remote=hello['identity'];lease_mod.peer(c,remote);lease=lease_mod.Lease.accept(c,remote,cfg['lock'],hello['epoch'])
  apps=[policy.App(**row) for row in cfg['apps']];store=comp.Store(directory)
  pair=paired.Pair(store,lease,c,remote,paired.source_digest(),apps,donor=cfg['role']=='controller')
  if cfg['role']=='controller':
   pair.enroll();answer=pair._request({'op':'CENSUS'})
   if answer.get('state')!=paired.digest(pair.live):raise ValueError('CENSUS')
   print(json.dumps({'status':'LOCAL_ORIGINAL_HOLDERS_COMMITTED','productionAdmission':False}),flush=True)
   # Keep the original FD alive until local launcher explicitly ends the test.
   if hold_until_signal:signal.pause()
   elif sys.stdin.buffer.read(1)!=b'X':raise ValueError('NO_LOCAL_EXIT')
  else:
   for _ in range(4):pair.service_once()
   print('COMMITTED',flush=True)
   if hold_until_signal:signal.pause()
   elif sys.stdin.buffer.read(1)!=b'X':raise ValueError('NO_LOCAL_EXIT')
 finally:
  if store is not None:store.close()
  if lease is not None:lease.close()
  c.close()
  if listener is not None:listener.close()
if __name__=='__main__':
 try:
  p=argparse.ArgumentParser();p.add_argument('--config');p.add_argument('--stdin-config',action='store_true');a=p.parse_args()
  if bool(a.config)==bool(a.stdin_config):raise ValueError('CONFIG_ROUTE')
  if a.stdin_config:b=sys.stdin.buffer.readline(16385)
  else:
   fd=os.open(a.config,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
   try:b=os.read(fd,16385)
   finally:os.close(fd)
  if len(b)>16384:raise ValueError('CONFIG_LIMIT')
  main(json.loads(b),hold_until_signal=bool(a.config))
 except BaseException:raise SystemExit(2) from None
