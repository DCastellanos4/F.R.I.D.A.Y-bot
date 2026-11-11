import copy,hashlib,os,stat,subprocess,tempfile,unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
from test_ensayo_os import manifest,ROOT
from deploy.ers_recovery import ensayo_os as c
from deploy.ers_recovery.ensayo_privileged_io import RootIO,Calls,FixedRunner
from deploy.ers_recovery.ensayo_manager_collector import Collector
from deploy.ers_recovery.ensayo_root_custodian import Custodian,CleanupController
class MappedCalls(Calls):
 is_fixture=True
 def __init__(self,root):self.root=Path(root);self.writes=[];self.chowns=[]
 def euid(self):return 0
 def open(self,p,*args,**kw):return os.open(self.root if p=='/' else p,*args,**kw)
 def project(self,s):
  names=('st_dev','st_ino','st_uid','st_gid','st_mode','st_nlink','st_size','st_mtime_ns','st_ctime_ns');v={k:getattr(s,k) for k in names};v['st_uid']=0;v['st_gid']=0;return SimpleNamespace(**v)
 def fstat(self,fd):return self.project(os.fstat(fd))
 def stat(self,*a,**kw):return self.project(os.stat(*a,**kw))
 def fchown(self,fd,uid,gid):self.chowns.append((uid,gid))
 def write(self,fd,b):self.writes.append(len(b));return os.write(fd,b)
class Journal:
 def __init__(self,m):self.data=[{'op':'ROOT_CONTROL_BEGIN','manifestDigest':c.digest(m)}]
 def append(self,row):self.data.append(copy.deepcopy(row))
 def rows(self):return copy.deepcopy(self.data)
class GateCollector:
 def __init__(self,m):
  self.m=m;self.observed={};self.fault=None
  for index,role in enumerate(c.ROLES):
   self.observed[role]={'unit':m['units'][role],'invocation':str(index+1)*32,'cgroup':'/system.slice/'+m['units'][role],'cgroupKey':[27,100+index],'stage':'GATE_ONLY','process':{'identity':{'pid':100+index,'start':'123','boot':'b'*36},'exe':[1,2],'cgroup':'0::/system.slice/'+m['units'][role]+'\n'},'memberPids':[100+index],'manager':{}}
 def scope(self,role,*,stage,reservation=None):
  if self.fault==role:raise c.ContractHold('SYNTHETIC_SECOND_ROLE_DRIFT')
  value=copy.deepcopy(self.observed[role]);value['stage']=stage
  if reservation is not None and any(value[k]!=reservation[k] for k in ('unit','invocation','cgroupKey')):raise c.ContractHold('DRIFT')
  return value
 def manager(self,role):return {'SubState':'start-pre','ActiveState':'activating'}
class PrivilegedIOTests(unittest.TestCase):
 def build(self,td):
  m=manifest();root=Path(td)
  for p in ('opt/ers','etc/ers-ensayo','run','etc/systemd/system','var/lib/ers-ensayo-control'):(root/p).mkdir(parents=True,exist_ok=True)
  calls=MappedCalls(root);io=RootIO(m,calls=calls);return m,io,calls
 def test_concrete_noreplace_write_stat_remove_via_fake_syscalls(self):
  with tempfile.TemporaryDirectory() as td:
   m,io,calls=self.build(td);path=m['sourceRoot'];key=io.create_directory(path,uid=0,gid=0,mode=0o755);target=path+'/paired.py';obj=io.create(target,b'PUBLIC_SYNTHETIC',uid=0,gid=0,mode=0o444);self.assertEqual(obj['sha256'],hashlib.sha256(b'PUBLIC_SYNTHETIC').hexdigest());self.assertTrue(calls.chowns)
   with self.assertRaises(FileExistsError):io.create(target,b'REPLACE',uid=0,gid=0,mode=0o444)
   self.assertEqual(io.snapshot(target),obj);io.remove(target,obj);self.assertIsNone(io.snapshot(target));io.remove(path,key);self.assertIsNone(io.snapshot(path))
 def test_concrete_path_and_symlink_ancestor_refused(self):
  with tempfile.TemporaryDirectory() as td:
   m,io,_=self.build(td)
   with self.assertRaises(c.ContractHold):io.create('/etc/passwd',b'WRONG',uid=0,gid=0,mode=0o444)
   parent=Path(td)/'opt'/'ers';parent.rmdir();parent.symlink_to('/tmp')
   with self.assertRaises(OSError):io.create_directory(m['sourceRoot'],uid=0,gid=0,mode=0o755)
 def test_concrete_modified_file_does_not_remove(self):
  with tempfile.TemporaryDirectory() as td:
   m,io,_=self.build(td);io.create_directory(m['sourceRoot'],uid=0,gid=0,mode=0o755);path=m['sourceRoot']+'/paired.py';want=io.create(path,b'FIRST',uid=0,gid=0,mode=0o444);p=Path(td)/path.lstrip('/');p.chmod(0o600);p.write_bytes(b'OTHER');p.chmod(0o444)
   with self.assertRaises(c.ContractHold):io.remove(path,want)
   self.assertTrue(p.exists())
 def test_real_nonroot_cannot_instantiate_privileged_io(self):
  with patch.object(os,'geteuid',return_value=1000),self.assertRaises(c.ContractHold):RootIO(manifest())
 def runner(self,code):
  real=subprocess.Popen;calls=[]
  def spawn(argv,**kw):calls.append((argv,kw));return real(['/usr/bin/python3','-c',code],**kw)
  r=FixedRunner(manifest(),spawn=spawn);return r,calls
 def test_fixed_manager_commands_minenv_no_shell(self):
  r,calls=self.runner('pass')
  with patch.object(r,'binary_custody',return_value={'same':'pin'}):out=r.invoke('start',next(iter(r.m['units'].values())))
  argv,kw=calls[0];self.assertEqual(argv[0],'/usr/bin/systemctl');self.assertIn('--no-block',argv);self.assertEqual(kw['cwd'],'/');self.assertNotIn('shell',kw);self.assertEqual(out['status'],'TRANSPORT_RETURNED_ZERO_EFFECT_REQUIRES_RECONCILIATION')
  with self.assertRaises(c.ContractHold):r.invoke('enable',next(iter(r.units)))
  with self.assertRaises(c.ContractHold):r.invoke('stop','bot.service')
 def test_manager_oversize_exit_and_custody_failure_not_retried(self):
  for code in ["print('x'*17000)","import sys;sys.exit(1)"]:
   r,calls=self.runner(code)
   with patch.object(r,'binary_custody',return_value={'same':'pin'}),self.assertRaises(c.ContractHold):r.invoke('show',r.m['units']['controller'])
   self.assertEqual(len(calls),1)
  r,calls=self.runner('pass')
  with patch.object(r,'binary_custody',side_effect=c.ContractHold('PIN')),self.assertRaises(c.ContractHold):r.invoke('start',r.m['units']['controller'])
  self.assertEqual(calls,[])
 def test_manager_show_all_preserves_249_empty_properties(self):
  values={k:'' for k in FixedRunner.properties};values.update(Id=manifest()['units']['controller'],LoadState='loaded',ActiveState='active',SubState='running')
  r,calls=self.runner('import json;print('+repr('\n'.join(k+'='+v for k,v in values.items()))+')')
  with patch.object(r,'binary_custody',return_value={}):out=r.invoke('show',r.m['units']['controller'])
  self.assertEqual(out,values);self.assertIn('--all',calls[0][0]);self.assertEqual(out['DropInPaths'],'');self.assertEqual(out['ControlGroup'],'')
 def test_show_all_still_rejects_missing_249_property(self):
  r,calls=self.runner('print('+repr('\n'.join(k+'=' for k in FixedRunner.properties if k!='DropInPaths'))+')')
  with patch.object(r,'binary_custody',return_value={}),self.assertRaises(c.ContractHold):r.invoke('show',r.m['units']['controller'])
  self.assertEqual(len(calls),1)
 def test_manager_exact_show_projection_not_raw(self):
  r,calls=self.runner("print('PRIVATE=SECRET')")
  with patch.object(r,'binary_custody',return_value={}),self.assertRaises(c.ContractHold) as error:r.invoke('show',r.m['units']['controller'])
  self.assertNotIn('SECRET',str(error.exception))
class CustodianTests(unittest.TestCase):
 def setup_gate(self):
  m=manifest();collector=GateCollector(m);journal=Journal(m);cust=Custodian(m,runner=object(),collector=collector,journal=journal);requests={}
  for role,o in collector.observed.items():
   req={'op':'GATE_READY','role':role,'identity':o['process']['identity'],'invocation':o['invocation'],'manifestDigest':c.digest(m)};requests[role]={'request':req,'peer':{'uid':m['uid'],'identity':req['identity']},'channel':object()}
  return m,collector,journal,cust,requests
 def test_both_reservations_durable_before_release_intent(self):
  m,col,j,cust,req=self.setup_gate();sent=[];cust.reserve_both(req);cust.cleanup_ack={'reservationsDigest':c.digest(cust.reservations)};self.assertFalse(any(r['op']=='RELEASE_INTENT' for r in j.rows()));cust.release_both(req,wait_controller=lambda:None,send=lambda channel,packet:sent.append(packet));self.assertEqual(len(sent),2);rows=j.rows();self.assertLess(max(i for i,v in enumerate(rows) if v['op']=='GATE_RESERVATION'),next(i for i,v in enumerate(rows) if v['op']=='RELEASE_INTENT'));self.assertTrue(all(v['op']=='RELEASE_PRESTART_GATE_ONLY' for v in sent))
 def test_second_gate_drift_no_release_no_reservation(self):
  m,col,j,cust,req=self.setup_gate();col.fault='watchdog'
  with self.assertRaises(c.ContractHold):cust.reserve_both(req)
  self.assertEqual(len(j.rows()),1)
 def test_drift_after_reserve_before_release_no_first_send(self):
  m,col,j,cust,req=self.setup_gate();cust.reserve_both(req);cust.cleanup_ack={'reservationsDigest':c.digest(cust.reservations)};col.fault='watchdog';sent=[]
  with self.assertRaises(c.ContractHold):cust.release_both(req,wait_controller=lambda:None,send=lambda *a:sent.append(a))
  self.assertEqual(sent,[]);self.assertFalse(any(r['op']=='RELEASE_INTENT' for r in j.rows()))
 def test_wrong_peer_or_manifest_rejected(self):
  for fault in ('peer','manifest'):
   m,col,j,cust,req=self.setup_gate()
   if fault=='peer':req['watchdog']['peer']['uid']=999
   else:req['watchdog']['request']['manifestDigest']='f'*64
   with self.assertRaises(c.ContractHold):cust.reserve_both(req)
   self.assertEqual(len(j.rows()),1)
 def test_cleanup_no_durable_reservation_does_not_adopt_manager(self):
  m,col,j,cust,req=self.setup_gate();cleanup=CleanupController(m,runner=object(),collector=col,journal=j)
  with self.assertRaises(c.ContractHold):cleanup.original_reservations()
 def test_contract_gate_only_not_empty_and_pre_timeout(self):
  m=manifest();text=c.render_staging(m)['sources']['controller'];self.assertIn('ExecStartPre=',text);self.assertIn('ensayo_prestart_gate.py',text);self.assertIn('TimeoutStartSec=12',text);self.assertIn('RuntimeMaxSec=30',text);self.assertEqual(m['intervention']['reservationStage'],'ONLY_EXACT_CUSTODIED_PRESTART_GATE_NO_HOLDER');self.assertIn('PRIOR_GATE_ONLY',m['intervention']['cleanupAuthority'])
 def test_gate_is_unprivileged_no_holder_or_background(self):
  s=(ROOT/'ensayo_prestart_gate.py').read_text();self.assertNotIn('subprocess',s);self.assertNotIn('fork(',s);self.assertNotIn('Lease.acquire',s);self.assertIn('uid!=0',s);self.assertIn('custody.check',s)

class GateWiringRegressions(unittest.TestCase):
 def test_controller_ready_barrier_between_both_releases(self):
  m,col,j,cust,req=CustodianTests().setup_gate();cust.reserve_both(req);cust.cleanup_ack={'reservationsDigest':c.digest(cust.reservations)};events=[]
  cust.release_both(req,send=lambda channel,packet:events.append(packet['role']),wait_controller=lambda:events.append('EXACT_CONTROLLER_SOCKET_READY'))
  self.assertEqual(events,['controller','EXACT_CONTROLLER_SOCKET_READY','watchdog'])
 def test_controller_ready_failure_prevents_watchdog_release(self):
  m,col,j,cust,req=CustodianTests().setup_gate();cust.reserve_both(req);cust.cleanup_ack={'reservationsDigest':c.digest(cust.reservations)};sent=[]
  def fail():raise c.ContractHold('ROOT_CONTROLLER_SOCKET_CUSTODY')
  with self.assertRaises(c.ContractHold):cust.release_both(req,send=lambda channel,packet:sent.append(packet['role']),wait_controller=fail)
  self.assertEqual(sent,['controller']);self.assertFalse(any(r['op']=='RELEASE_INTENT' and r['role']=='watchdog' for r in j.rows()))
 def test_real_local_socket_barrier_through_fake_path_and_original_dir(self):
  import socket
  from deploy.ers_recovery import ensayo_root_custodian as module
  from deploy.ers_recovery.ensayo_privileged_io import identity as key
  with tempfile.TemporaryDirectory() as td:
   m,col,j,cust,req=CustodianTests().setup_gate();cust.reserve_both(req);root=Path(td)/'runtime';root.mkdir(mode=0o700);sockpath=root/'holders.sock';sock=socket.socket(socket.AF_UNIX,socket.SOCK_SEQPACKET);sock.bind(str(sockpath));sockpath.chmod(0o600);j.append({'op':'INSTALL_CREATED','path':m['runtimeRoot'],'key':key(root.lstat())});col.manager=lambda role:{'SubState':'running'};realpath=Path
   def mapped(path):return root if str(path)==m['runtimeRoot'] else sockpath if str(path)==m['paths']['socket'] else realpath(path)
   try:
    with patch.object(module,'Path',side_effect=mapped):cust.wait_controller_ready()
    sockpath.unlink();sockpath.write_text('NOT_A_SOCKET');sockpath.chmod(0o600)
    with patch.object(module,'Path',side_effect=mapped),self.assertRaisesRegex(c.ContractHold,'ROOT_CONTROLLER_SOCKET_CUSTODY'):cust.wait_controller_ready()
   finally:sock.close()
 def test_both_commit_receipts_independently_match_manager_process(self):
  m,col,j,cust,req=CustodianTests().setup_gate();cust.reserve_both(req);receipts={}
  for role,o in col.observed.items():receipts[role]={'process':copy.deepcopy(o['process']['identity']),'invocation':o['invocation'],'cgroup':o['process']['cgroup'],'custodyClass':c.RootCustody.evidence_class,'leaseKey':[1,2,m['uid'],m['gid'],0o600]}
  with patch.object(c,'read_receipt',side_effect=lambda m,r,custody:(copy.deepcopy(receipts[r]),{})):out=cust.validate_holders()
  self.assertEqual(out['status'],'ROOT_MANAGER_PROC_TRANSITION_OBSERVED_NOT_KERNEL_GATE');receipts['watchdog']['process']['start']='DIFFERENT'
  with patch.object(c,'read_receipt',side_effect=lambda m,r,custody:(copy.deepcopy(receipts[r]),{})),self.assertRaisesRegex(c.ContractHold,'ROOT_COMMIT_RECEIPT_PROCESS_MISMATCH'):cust.validate_holders()

class CollectorRegressions(unittest.TestCase):
 def fixture(self):
  m=manifest();unit=m['units']['controller'];ident={'pid':321,'start':'123','boot':'b'*36};manager={k:'' for k in FixedRunner.properties};manager.update(MemoryMax=str(m['resources']['controller']['memoryMaxBytes']),MemorySwapMax='0',TasksMax=str(m['resources']['controller']['tasksMax']),CPUQuotaPerSecUSec=str(m['resources']['controller']['cpuQuotaPercent']*10)+'ms',Id=unit,LoadState='loaded',FragmentPath='/etc/systemd/system/'+unit,DropInPaths='',NeedDaemonReload='no',User=str(m['uid']),Group=str(m['gid']),SupplementaryGroups=' '.join(map(str,m['groups'])),ControlGroup='/system.slice/'+unit,Delegate='no',Restart='no',InvocationID='a'*32,MainPID='0',ControlPID='321',SubState='start-pre')
  status=('Uid:\t'+' '.join([str(m['uid'])]*4)+'\nGid:\t'+' '.join([str(m['gid'])]*4)+'\nGroups:\t'+' '.join(map(str,m['groups']))+'\n').encode();argv='\0'.join([m['python']['command'],'-I',m['sourceRoot']+'/ensayo_prestart_gate.py','--config',m['configs']['controller'],'']).encode();files={'/proc/321/status':status,'/proc/321/cgroup':('0::/system.slice/'+unit+'\n').encode(),'/proc/321/cmdline':argv,'/sys/fs/cgroup/system.slice/'+unit+'/cgroup.procs':b'321\n'}
  runner=SimpleNamespace(invoke=lambda *a:copy.deepcopy(manager));statfn=lambda p,**kw:SimpleNamespace(st_mode=stat.S_IFDIR|0o755,st_uid=0,st_dev=27,st_ino=987) if p.startswith('/sys') else SimpleNamespace(st_dev=m['python']['dev'],st_ino=m['python']['ino']);col=Collector(m,runner,read=lambda p,cap:files[p],statfn=statfn,identityfn=lambda pid:dict(ident));return m,col,manager,files
 def test_exact_gate_argv_and_proc_cgroup_independent(self):
  m,col,manager,files=self.fixture();out=col.scope('controller',stage='GATE_ONLY');self.assertEqual(out['process']['identity']['pid'],321);self.assertLessEqual(col.bytes,131072)
 def test_other_python_script_or_extra_process_not_gate(self):
  for fault in ('argv','member','delegate','invocation'):
   m,col,manager,files=self.fixture()
   if fault=='argv':files['/proc/321/cmdline']=b'/usr/bin/python3\x00-I\x00/PRIVATE_OTHER_SCRIPT\x00'
   elif fault=='member':files['/sys/fs/cgroup/system.slice/'+m['units']['controller']+'/cgroup.procs']=b'321\n999\n'
   elif fault=='delegate':manager['Delegate']='yes'
   else:manager['InvocationID']='bad'
   with self.assertRaises(c.ContractHold):col.scope('controller',stage='GATE_ONLY')
 def test_transition_no_assumed_cgroup_inode_or_invocation(self):
  m,col,manager,files=self.fixture();reservation=col.scope('controller',stage='GATE_ONLY');manager.update(MainPID='321',ControlPID='0',SubState='running',InvocationID='b'*32);files['/proc/321/cmdline']='\0'.join([m['python']['command'],'-I',m['sourceRoot']+'/ensayo_os_worker.py','--config',m['configs']['controller'],'']).encode()
  with self.assertRaises(c.ContractHold):col.scope('controller',stage='HOLDER',reservation=reservation)
 def test_collector_caps_fail_before_unbounded_reads(self):
  m,col,manager,files=self.fixture();col.reads=64
  with self.assertRaises(c.ContractHold):col.scope('controller',stage='GATE_ONLY')

class HandoffRegressions(unittest.TestCase):
 def test_real_scmrights_original_dirs_with_fake_root_and_cleanup_retention(self):
  import socket,threading
  from deploy.ers_recovery import ensayo_scope_handoff as h
  from deploy.ers_recovery.lease import identity
  m=manifest();left,right=socket.socketpair(socket.AF_UNIX,socket.SOCK_SEQPACKET);left.settimeout(2);right.settimeout(2);scopes={};reservations={};dirs=[];received={};errors=[]
  realfstat=os.fstat
  def projected(fd):
   s=realfstat(fd)
   if stat.S_ISDIR(s.st_mode):return SimpleNamespace(st_mode=s.st_mode,st_uid=0,st_dev=s.st_dev,st_ino=s.st_ino)
   return s
  try:
   for role in c.ROLES:
    td=tempfile.TemporaryDirectory();dirs.append(td);path=Path(td.name);(path/'cgroup.procs').write_text('321\n');(path/'cgroup.events').write_text('populated 1\nfrozen 0\n');fd=os.open(path,os.O_RDONLY|os.O_DIRECTORY);scopes[role]=SimpleNamespace(fd=fd);s=os.fstat(fd);reservations[role]={'unit':m['units'][role],'manifestDigest':c.digest(m),'sourceDigest':c.digest(m['sourceFiles']),'reservationStage':m['intervention']['reservationStage'],'cgroupKey':[s.st_dev,s.st_ino]}
   def receiver():
    try:received['value']=h.receive_scopes(right,m,identity())
    except BaseException as error:errors.append(type(error).__name__)
   with patch.object(h,'root_peer',side_effect=lambda channel,expected:None),patch.object(h.os,'fstat',side_effect=projected):
    thread=threading.Thread(target=receiver);thread.start();ack=h.send_scopes(left,m,reservations,scopes,identity());thread.join(timeout=3)
   self.assertEqual(errors,[]);self.assertEqual(ack['op'],'BOTH_ORIGINAL_SCOPE_FDS_RETAINED');self.assertIn('value',received)
   # Sender drops all originals; independent receiver still owns two dir FDs.
   for scope in scopes.values():os.close(scope.fd)
   scopes={};r,held=received['value'];self.assertEqual(set(held),set(c.ROLES));self.assertTrue(all(os.fstat(s.fd).st_ino==r[role]['cgroupKey'][1] for role,s in held.items()))
   for scope in held.values():scope.close()
  finally:
   left.close();right.close()
   for scope in scopes.values():os.close(scope.fd)
   for td in dirs:td.cleanup()
 def test_no_cleanup_ack_blocks_all_release(self):
  base=CustodianTests();m,col,j,cust,req=base.setup_gate();cust.reserve_both(req);sent=[]
  with self.assertRaisesRegex(c.ContractHold,'ROOT_GATE_INDEPENDENT_SCOPE_CUSTODY_ACK_REQUIRED'):cust.release_both(req,wait_controller=lambda:None,send=lambda *a:sent.append(a))
  self.assertEqual(sent,[]);self.assertFalse(any(r['op']=='RELEASE_INTENT' for r in j.rows()))
 def test_scope_unreadable_does_not_mean_dead(self):
  from deploy.ers_recovery.ensayo_scope_fd import ScopeFD
  scope=ScopeFD.__new__(ScopeFD)
  with patch.object(os,'lseek',side_effect=OSError('PRIVATE')),self.assertRaisesRegex(c.ContractHold,'SCOPE_FD_ORIGINAL_UNREADABLE_NO_DEATH_PROOF'):scope._field(999)
