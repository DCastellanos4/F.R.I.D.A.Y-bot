"""Short unprivileged ExecStartPre gate. No holder, lock, journal or child spawn.
Systemd credentials remain the dedicated User/Group. Only UID0 socket peer may
release it; root custodian must independently validate ControlPID and both scopes.
"""
import importlib,os,signal,socket,struct,sys,types
from pathlib import Path
sys.dont_write_bytecode=True
ROOT=Path(__file__).resolve().parent
if __package__:
 from . import ensayo_os as c
 from .lease import identity,record,receive_record
else:
 pkg=types.ModuleType('_ers_gate');pkg.__path__=[str(ROOT)];sys.modules['_ers_gate']=pkg
 c=importlib.import_module('_ers_gate.ensayo_os');lease=importlib.import_module('_ers_gate.lease');identity=lease.identity;record=lease.record;receive_record=lease.receive_record

def run(path):
 custody=c.RootCustody();cfg,key=custody.read_config(path);m,role=c.validate_config(cfg,path=path);evidence=custody.check(m,path,cfg,key)
 if ROOT!=Path(m['sourceRoot']):raise c.ContractHold('GATE_SOURCE_ROOT')
 invocation=os.environ.get('INVOCATION_ID')
 if not c.HEX(32,invocation):raise c.ContractHold('GATE_INVOCATION_REQUIRED')
 root=Path(m['intervention']['gateRoot']);c.config_directory(root,owner=0,gid=m['gid']);c.ancestors(root.parent,0)
 sock=root/'release.sock';s=sock.lstat()
 if not __import__('stat').S_ISSOCK(s.st_mode) or (s.st_uid,s.st_gid,__import__('stat').S_IMODE(s.st_mode))!=(0,m['gid'],0o660):raise c.ContractHold('GATE_ROOT_SOCKET_CUSTODY')
 channel=socket.socket(socket.AF_UNIX,socket.SOCK_SEQPACKET);channel.settimeout(8)
 def timeout(*args):raise c.ContractHold('GATE_DEADLINE')
 previous=signal.signal(signal.SIGALRM,timeout);signal.setitimer(signal.ITIMER_REAL,10)
 try:
  channel.connect(str(sock));pid,uid,gid=struct.unpack('3i',channel.getsockopt(socket.SOL_SOCKET,socket.SO_PEERCRED,12))
  if uid!=0 or pid<=0:raise c.ContractHold('GATE_ROOT_PEER_REQUIRED')
  peer=identity(pid);own=identity();request={'op':'GATE_READY','role':role,'identity':own,'invocation':invocation,'manifestDigest':c.digest(m)};record(channel,request);answer=receive_record(channel)
  expected={'op':'RELEASE_PRESTART_GATE_ONLY','role':role,'identity':own,'invocation':invocation,'manifestDigest':c.digest(m),'rootCustodian':peer,'bothReservationsDigest':answer.get('bothReservationsDigest') if type(answer) is dict else None}
  if answer!=expected or not c.HEX(64,expected['bothReservationsDigest']) or identity(pid)!=peer or identity()!=own or custody.check(m,path,cfg,key)!=evidence:raise c.ContractHold('GATE_RELEASE_UNVERIFIED')
  # Exit0 permits systemd to progress. Does not spawn/fork or claim that later
  # manager InvocationID/cgroup must remain unchanged; collector must check it.
  return {'status':'GATE_RELEASED_NOT_HOLDER_STARTED'}
 finally:signal.setitimer(signal.ITIMER_REAL,0);signal.signal(signal.SIGALRM,previous);channel.close()
if __name__=='__main__':
 try:
  if len(sys.argv)!=3 or sys.argv[1]!='--config':raise ValueError()
  run(sys.argv[2])
 except BaseException:raise SystemExit(2) from None
