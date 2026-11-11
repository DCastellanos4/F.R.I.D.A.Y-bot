"""Root-to-root original cgroup descriptor handoff. ACK is custody, not OS gate.
The receiver lives before holder release, retaining FDs if supervisor dies.
No arbitrary file descriptor is accepted as a scope; exact root-owned cgroup
inode and both manifest role reservations are required independently.
"""
import array,json,os,socket,stat,struct
from . import ensayo_os as c
from .lease import identity,record,receive_record
from .ensayo_scope_fd import ScopeFD

def root_peer(channel,expected):
 pid,uid,_=struct.unpack('3i',channel.getsockopt(socket.SOL_SOCKET,socket.SO_PEERCRED,12))
 if uid!=0 or identity(pid)!=expected:raise c.ContractHold('ROOT_HANDOFF_EXPECTED_MANAGER_PEER')

def send_scopes(channel,m,reservations,scopes,expected_receiver):
 if set(reservations)!=set(c.ROLES) or set(scopes)!=set(c.ROLES):raise c.ContractHold('ROOT_HANDOFF_BOTH_REQUIRED')
 root_peer(channel,expected_receiver);payload={'op':'ORIGINAL_SCOPE_CUSTODY','manifestDigest':c.digest(m),'reservations':reservations,'sender':identity()};data=c.encode(payload)
 if len(data)>16384:raise c.ContractHold('ROOT_HANDOFF_PACKET_LIMIT')
 fds=[scopes[r].fd for r in c.ROLES]
 if channel.sendmsg([data],[(socket.SOL_SOCKET,socket.SCM_RIGHTS,array.array('i',fds))])!=len(data):raise c.ContractHold('ROOT_HANDOFF_SHORT_SEND')
 answer=receive_record(channel);root_peer(channel,expected_receiver)
 if answer!={'op':'BOTH_ORIGINAL_SCOPE_FDS_RETAINED','manifestDigest':c.digest(m),'reservationsDigest':c.digest(reservations),'receiver':expected_receiver}:raise c.ContractHold('ROOT_HANDOFF_CUSTODY_ACK_UNVERIFIED')
 return answer

def receive_scopes(channel,m,expected_sender,*,verify_reservations=None):
 root_peer(channel,expected_sender);fds=[];scopes={}
 try:
  data,anc,flags,_=channel.recvmsg(16384,socket.CMSG_SPACE(8),socket.MSG_CMSG_CLOEXEC)
  for level,kind,body in anc:
   if level!=socket.SOL_SOCKET or kind!=socket.SCM_RIGHTS:raise c.ContractHold('ROOT_HANDOFF_BAD_ANCILLARY')
   values=array.array('i');values.frombytes(body[:len(body)-len(body)%values.itemsize]);fds.extend(values)
  if flags&(socket.MSG_TRUNC|socket.MSG_CTRUNC) or len(fds)!=2:raise c.ContractHold('ROOT_HANDOFF_EXACT_TWO_FDS')
  payload=c.load_json(data);c.exact(payload,{'op','manifestDigest','reservations','sender'},'ROOT_HANDOFF_SHAPE')
  if payload['op']!='ORIGINAL_SCOPE_CUSTODY' or payload['manifestDigest']!=c.digest(m) or payload['sender']!=expected_sender or set(payload['reservations'])!=set(c.ROLES):raise c.ContractHold('ROOT_HANDOFF_MANIFEST_SENDER')
  reservations=payload['reservations']
  for role,fd in zip(c.ROLES,fds):
   r=reservations[role]
   if r['unit']!=m['units'][role] or r['manifestDigest']!=c.digest(m) or r['sourceDigest']!=c.digest(m['sourceFiles']) or r['reservationStage']!='ONLY_EXACT_CUSTODIED_PRESTART_GATE_NO_HOLDER':raise c.ContractHold('ROOT_HANDOFF_RESERVATION')
   own=os.fstat(fd)
   if not stat.S_ISDIR(own.st_mode) or own.st_uid!=0 or own.st_mode&0o022 or [own.st_dev,own.st_ino]!=r['cgroupKey']:raise c.ContractHold('ROOT_HANDOFF_NOT_ORIGINAL_CGROUP')
   # Reopen events/procs relative to the received original directory, not a path.
   scope=ScopeFD.__new__(ScopeFD);scope.m=m;scope.r=r;scope.fd=fd;scope.procs=None;scope.events=None;scopes[role]=scope
   scope.procs=os.open('cgroup.procs',os.O_RDONLY|os.O_NOFOLLOW|os.O_CLOEXEC,dir_fd=fd);scope.events=os.open('cgroup.events',os.O_RDONLY|os.O_NOFOLLOW|os.O_CLOEXEC,dir_fd=fd)
  if verify_reservations is not None:verify_reservations(reservations)
  root_peer(channel,expected_sender);record(channel,{'op':'BOTH_ORIGINAL_SCOPE_FDS_RETAINED','manifestDigest':c.digest(m),'reservationsDigest':c.digest(reservations),'receiver':identity()})
  return reservations,scopes
 except BaseException:
  owned={s.fd for s in scopes.values()}
  for scope in scopes.values():scope.close()
  for fd in fds:
   if fd not in owned:os.close(fd)
  raise
