"""Runnable root supervisor/cleanup control programs for reviewed installation.
Load only a root-owned config and exact pinned module/source sets before imports.
No code here runs on import. No install/account provisioning mode is exposed.
"""
import hashlib,importlib,json,os,selectors,socket,stat,struct,sys,time,types
from pathlib import Path
sys.dont_write_bytecode=True
CONTROL_MODULES={'ensayo_privileged_io.py','ensayo_manager_collector.py','ensayo_root_journal.py','ensayo_root_custodian.py','ensayo_scope_fd.py','ensayo_scope_handoff.py','ensayo_runtime_cleanup.py','ensayo_root_install.py','ensayo_control_program.py'}

def _read(p,limit,mode):
 for parent in [p.parent,*p.parent.parents]:
  s=parent.lstat()
  if not stat.S_ISDIR(s.st_mode) or parent.resolve()!=parent or s.st_uid!=0 or s.st_mode&0o022:raise ValueError('ROOT_CONFIG_ANCESTORS')
 fd=os.open(p,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK|os.O_CLOEXEC)
 try:
  s=os.fstat(fd)
  if not stat.S_ISREG(s.st_mode) or s.st_uid!=0 or s.st_nlink!=1 or stat.S_IMODE(s.st_mode)!=mode or s.st_size>limit:raise ValueError('ROOT_CONFIG_CUSTODY')
  b=os.read(fd,limit+1);z=os.fstat(fd);q=p.lstat();sig=lambda v:(v.st_dev,v.st_ino,v.st_size,v.st_mtime_ns,v.st_ctime_ns)
  if len(b)!=s.st_size or len(b)>limit or sig(s)!=sig(z) or sig(s)!=sig(q):raise ValueError('ROOT_CONFIG_CHANGED')
  return b
 finally:os.close(fd)

def load(path):
 p=Path(path)
 if p.name not in ('supervisor.json','cleanup.json') or p.parent.parent!=Path('/var/lib/ers-ensayo-control') or len(p.parent.name)!=16:raise ValueError('ROOT_FIXED_CONFIG')
 def unique(pairs):
  d={}
  for k,v in pairs:
   if k in d:raise ValueError('ROOT_CONFIG_DUPLICATE_KEY')
   d[k]=v
  return d
 cfg=json.loads(_read(p,32768,0o400),object_pairs_hook=unique)
 if type(cfg) is not dict or set(cfg)!={'manifest','controlPins','role','bootstrapReceipt','unitSourceHashes'} or cfg['role']!=p.stem or set(cfg['controlPins'])!=CONTROL_MODULES:raise ValueError('ROOT_CONFIG_SHAPE')
 m=cfg['manifest'];root=p.parent
 if m['intervention']['controlRoot']!=str(root):raise ValueError('ROOT_CONFIG_ROOT')
 for name,want in cfg['controlPins'].items():
  if hashlib.sha256(_read(root/name,1048576,0o444)).hexdigest()!=want:raise ValueError('ROOT_CONTROL_SOURCE_PIN')
 source=Path(m['sourceRoot'])
 for name,want in m['sourceFiles'].items():
  if '/' in name or hashlib.sha256(_read(source/name,1048576,0o444)).hexdigest()!=want:raise ValueError('ROOT_HOLDER_SOURCE_PIN')
 if Path(__file__).resolve()!=root/'ensayo_control_program.py':raise ValueError('ROOT_EXECUTABLE_PINNED_PATH')
 package=types.ModuleType('_ers_root_control');package.__path__=[str(root),str(source)];sys.modules['_ers_root_control']=package
 c=importlib.import_module('_ers_root_control.ensayo_os');c.validate_staging(m)
 policy=importlib.import_module('_ers_root_control.ensayo_intervention');pin={'path':str(root/'ensayo_control_program.py'),'sha256':cfg['controlPins']['ensayo_control_program.py']};controls=policy.render_control_units(m,pin,pin)
 expected_units={m['units'][r]:v for r,v in c.render_staging(m)['hashes'].items()}
 expected_units.update({m['intervention'][r+'Unit']:hashlib.sha256(text.encode()).hexdigest() for r,text in controls['units'].items()})
 if cfg['unitSourceHashes']!=expected_units:raise ValueError('ROOT_UNITS_PIN')
 for unit,want in cfg['unitSourceHashes'].items():
  if hashlib.sha256(_read(Path('/etc/systemd/system')/unit,32768,0o444)).hexdigest()!=want:raise ValueError('ROOT_UNIT_FILE_PIN')
 # Bootstrap receipt is pinned original data, not a boolean trusted marker.
 bootstrap=_read(root/'bootstrap-receipt.json',32768,0o400)
 if hashlib.sha256(bootstrap).hexdigest()!=cfg['bootstrapReceipt']:raise ValueError('ROOT_BOOTSTRAP_RECEIPT_PIN')
 if os.geteuid()!=0 or os.getuid()!=0:raise ValueError('ROOT_REQUIRED')
 return cfg,c

def manager_peer(m,runner,role,identity):
 unit=m['intervention'][role+'Unit'];o=runner.invoke('show',unit)
 if o['Id']!=unit or o['User']!='0' or o['Group']!='0' or o['LoadState']!='loaded' or o['NeedDaemonReload']!='no' or o['DropInPaths'] or int(o['MainPID'])!=identity['pid'] or o['SubState']!='running':raise ValueError('ROOT_MANAGER_PEER')
 if o['FragmentPath']!='/etc/systemd/system/'+unit or o['ControlGroup']!='/system.slice/'+unit or len(o['InvocationID'])!=32 or any(ch not in 'abcdef0123456789' for ch in o['InvocationID']) or o['Restart']!='no' or o['Delegate']!='no':raise ValueError('ROOT_MANAGER_CUSTODY')
 b=m['intervention']['budgets'][role]
 quota_usec=importlib.import_module('_ers_root_control.ensayo_privileged_io').quota_usec
 if quota_usec(o['CPUQuotaPerSecUSec'])!=b['cpuQuotaPercent']*10000:raise ValueError('ROOT_MANAGER_CPU_LIMIT')
 if o['MemoryMax']!=str(b['memoryMaxBytes']) or o['MemorySwapMax']!='0' or o['TasksMax']!=str(b['tasksMax']):raise ValueError('ROOT_MANAGER_RESOURCE_LIMITS')
 return o

def cleanup_files(m,journal,scopes,mod,*,io=None):
 # One composed boundary: all epoch roots and runtime census validated before
 # the first runtime unlink, not only before the later immutable-file cleanup.
 death=lambda:{r:s.empty() for r,s in scopes.items()}
 created={r['path']:r['key'] for r in journal.rows() if r['op']=='INSTALL_CREATED'}
 if m['runtimeRoot'] not in created:raise ValueError('ROOT_RUNTIME_ORIGINAL_INVENTORY_REQUIRED')
 runtime=mod('ensayo_runtime_cleanup').PinnedRuntime(m,created[m['runtimeRoot']])
 remover=mod('ensayo_root_install').ExactRemover(m,journal,io=io)
 try:
  def global_preflight():return remover.preflight(scope_empty_evidence=death(),runtime_objects=runtime.census())
  global_preflight()
  # Repeat the complete preflight immediately before every runtime removal.
  # This is still a sequence of snapshots, never an atomic privileged transaction.
  runtime.remove(journal,death_check=global_preflight)
  global_preflight()
 finally:runtime.close()
 return remover.remove_installed(scope_empty_evidence=death())

def run(path):
 cfg,c=load(path);m=cfg['manifest'];role=cfg['role'];mod=lambda n:importlib.import_module('_ers_root_control.'+n)
 journalmod=mod('ensayo_root_journal');cust=mod('ensayo_root_custodian');handoff=mod('ensayo_scope_handoff');lease=mod('lease');runner=mod('ensayo_privileged_io').FixedRunner(m)
 own=lease.identity();ownmanager=manager_peer(m,runner,role,own);root=Path(m['intervention']['controlRoot']);socketpath=root/'custody.sock'
 if role=='supervisor':
  journal=journalmod.RootJournal(m);journal.append({'op':'ROOT_CUSTODIAN_ORIGINAL','role':role,'identity':own,'invocation':ownmanager['InvocationID']});supervisor=cust.Custodian(m,runner=runner,journal=journal)
  if any(r['op'] in ('START_PRE_INTENT','GATE_RESERVATION','RELEASE_INTENT') for r in journal.rows()):raise ValueError('ROOT_NO_RELAUNCH_OR_ADOPTION')
  try:
   peer=runner.invoke('show',m['intervention']['cleanupUnit']);expected=lease.identity(int(peer['MainPID']));manager_peer(m,runner,'cleanup',expected)
   channel=socket.socket(socket.AF_UNIX,socket.SOCK_SEQPACKET);channel.settimeout(10);channel.connect(str(socketpath))
   try:
    def transfer(reservations,scopes):
     manager_peer(m,runner,'cleanup',expected);return handoff.send_scopes(channel,m,reservations,scopes,expected)
    result=supervisor.serve_gates(handoff=transfer);journal.append({'op':'SUPERVISOR_COMPLETE_NO_KERNEL_ADMISSION','status':result['status']})
   finally:channel.close()
  finally:journal.close()
 else:
  # Cleanup service is started first and waits with its own deadline. It does
  # not rely on the supervisor's event loop, timers or continued liveness.
  journal=journalmod.RootJournal(m);journal.append({'op':'ROOT_CUSTODIAN_ORIGINAL','role':role,'identity':own,'invocation':ownmanager['InvocationID']});server=socket.socket(socket.AF_UNIX,socket.SOCK_SEQPACKET);server.settimeout(12);journal.append({'op':'ROOT_SOCKET_INTENT','path':str(socketpath)});server.bind(str(socketpath));os.chmod(socketpath,0o600);journal.append({'op':'ROOT_SOCKET_BOUND','path':str(socketpath),'key':mod('ensayo_privileged_io').RootIO(m).snapshot(str(socketpath))});server.listen(1);scopes={}
  try:
   ch,_=server.accept();ch.settimeout(12)
   try:
    pid,uid,_=struct.unpack('3i',ch.getsockopt(socket.SOL_SOCKET,socket.SO_PEERCRED,12));expected=lease.identity(pid)
    if uid!=0:raise ValueError('ROOT_CLEANUP_PEER')
    manager_peer(m,runner,'supervisor',expected);pidfd=os.pidfd_open(expected['pid'])
    def verify_reservations(received):
     if cust.CleanupController(m,runner=runner,journal=journal).original_reservations()!=received:raise ValueError('ROOT_CLEANUP_FD_LEDGER_BINDING')
     journal.append({'op':'CLEANUP_BOTH_ORIGINAL_FDS_ACK_INTENT','reservationsDigest':c.digest(received)})
    reservations,scopes=handoff.receive_scopes(ch,m,expected,verify_reservations=verify_reservations)
   finally:ch.close()
   journal.append({'op':'CLEANUP_RETAINED_BOTH_ORIGINAL_FDS','reservationsDigest':c.digest(reservations),'identity':own})
   sel=selectors.DefaultSelector();sel.register(pidfd,selectors.EVENT_READ)
   try:
    # Trigger immediately on supervisor death or at30s; never restart holders.
    sel.select(30)
   finally:sel.close();os.close(pidfd)
   controller=cust.CleanupController(m,runner=runner,journal=journal);controller.stop(scopes)
   result=cleanup_files(m,journal,scopes,mod);journal.append({'op':'ROOT_CONTROL_COMPLETE','status':result['status'],'accountDisposition':'BOOTSTRAP_CUSTODIAN_FOLLOWUP_REQUIRED','productionAdmission':False})
  finally:
   server.close()
   for scope in scopes.values():scope.close()
   if journal is not None:journal.close()
if __name__=='__main__':
 try:
  if len(sys.argv)!=3 or sys.argv[1]!='--config':raise ValueError('FIXED_ROUTE')
  run(sys.argv[2])
 except BaseException:raise SystemExit(2) from None
