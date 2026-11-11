import copy,fcntl,hashlib,importlib.util,json,os,socket,stat,subprocess,tempfile,time,unittest
from pathlib import Path
from unittest.mock import patch
from deploy.ers_recovery.ensayo_os import *
from deploy.ers_recovery.ensayo_os_fixture import FixtureCustody
from deploy.ers_recovery.unit_contract import validate as validate_local,local_namespace
ROOT=Path(__file__).resolve().parents[2]/'deploy/ers_recovery'
PYTHON=Path('/usr/bin/python3').resolve()
def manifest():
 pins={n:hashlib.sha256((ROOT/n).read_bytes()).hexdigest() for n in STAGING_SOURCES};e='a'*16;s=PYTHON.stat();runtime='/run/ers-ensayo-'+e
 return {'schema':1,'mode':'ENSAYO_OS_NO_BOT_EFFECTS','productionAdmission':False,'epoch':e,'sourceRoot':'/opt/ers/'+digest(pins),'sourceFiles':pins,'python':{'command':'/usr/bin/python3','resolved':str(PYTHON),'dev':s.st_dev,'ino':s.st_ino,'size':s.st_size,'sha256':hashlib.sha256(PYTHON.read_bytes()).hexdigest()},'uid':os.getuid(),'gid':os.getgid(),'groups':sorted(set(os.getgroups())),'resources':{r:{'memoryMaxBytes':33554432,'tasksMax':16,'provenance':'UNAPPROVED_SYNTHETIC_PROPOSAL'} for r in ROLES},'deniedPaths':list(DENIED),'configRoot':'/etc/ers-ensayo/'+e,'runtimeRoot':runtime,'paths':{k:runtime+'/'+v for k,v in {'lock':'ensayo.lock','socket':'holders.sock','journal':'journal.json','journalLock':'journal.lock','controllerReceipt':'controller.receipt.json','watchdogReceipt':'watchdog.receipt.json'}.items()},'limits':{'sourceBytes':1048576,'configBytes':32768,'receiptBytes':4096,'runtimeEntries':8,'runtimeBytes':131072,'deadlineSeconds':10},'units':{r:'ers-ensayo-'+r+'-'+e+'.service' for r in ROLES},'configs':{r:'/etc/ers-ensayo/'+e+'/'+r+'.json' for r in ROLES}}

class Fixture:
 def __init__(self):
  self.tmp=tempfile.TemporaryDirectory(prefix='ers-ensayo-fixture-');self.root=Path(self.tmp.name);self.m=manifest();self.processes=[]
  for n in ('source','config','runtime'):(self.root/n).mkdir(mode=0o750 if n=='config' else 0o700)
  for n in STAGING_SOURCES:
   p=self.root/'source'/n;p.write_bytes((ROOT/n).read_bytes());p.chmod(0o400)
  p=self.root/'fixture.json';p.write_bytes(encode(self.m));p.chmod(0o400)
  for role in ROLES:
   p=self.root/'config'/(role+'.json');p.write_bytes(encode({'manifest':self.m,'role':role,'token':'a'*64}));p.chmod(0o440)
  self.custody=FixtureCustody(self.root,self.m)
 def spawn(self,role):
  p=subprocess.Popen(['/usr/bin/python3','-I',str(self.root/'source'/'ensayo_os_fixture.py'),'--fixture',str(self.root),'--config',self.m['configs'][role]],stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,env={'PATH':'/usr/bin:/bin','LANG':'C.UTF-8'},close_fds=True,start_new_session=True);self.processes.append(p);return p
 def wait_path(self,canonical,process):
  p=self.custody.physical(canonical);end=time.monotonic()+5
  while time.monotonic()<end:
   if p.exists() and (p.is_socket() or p.stat().st_size>0):return p
   if process.poll() is not None:raise AssertionError('FIXTURE_CHILD_EXIT_'+str(process.returncode))
   time.sleep(.01)
  raise AssertionError('FIXTURE_DEADLINE')
 def start_pair(self):
  a=self.spawn('controller');self.wait_path(self.m['paths']['socket'],a);b=self.spawn('watchdog')
  self.wait_path(self.m['paths']['controllerReceipt'],a);self.wait_path(self.m['paths']['watchdogReceipt'],b)
  return a,b
 def busy(self):
  fd=os.open(self.custody.physical(self.m['paths']['lock']),os.O_RDONLY|os.O_NOFOLLOW)
  try:
   try:fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB)
   except BlockingIOError:return True
   return False
  finally:os.close(fd)
 def close(self):
  for p in self.processes:
   if p.poll() is None:p.kill()
  for p in self.processes:p.wait(timeout=5)
  self.tmp.cleanup()
 def __enter__(self):return self
 def __exit__(self,*args):self.close()

def receipt(m,role,pid=200):
 return {'status':'ENSAYO_HOLDER_ORIGINAL_COMMITTED','role':role,'process':{'pid':pid,'start':'123','boot':'a'*8+'-'+'a'*4+'-'+'a'*4+'-'+'a'*4+'-'+'a'*12},'manifestDigest':digest(m),'sourceDigest':digest(m['sourceFiles']),'epoch':m['epoch'],'invocation':('1' if role=='controller' else '2')*32,'cgroup':'0::/system.slice/'+m['units'][role]+'\n','leaseKey':[1,2,m['uid'],m['gid'],0o600],'productionAdmission':False,'osContainment':'UNVERIFIED','effectAdapter':'ABSENT','custodyClass':'LOCAL_MAPPED_FIXTURE_NOT_ROOT_NOT_OS'}

def projections(m):
 result={};proposal=render_staging(m)
 for i,role in enumerate(ROLES):
  r=receipt(m,role,200+i);unit=m['units'][role];result[role]={'receipt':r,'manager':{'Id':unit,'MainPID':200+i,'InvocationID':r['invocation'],'ControlGroup':'/system.slice/'+unit,'FragmentPath':'/etc/systemd/system/'+unit,'DropInPaths':[],'NeedDaemonReload':False,'User':m['uid'],'Group':m['gid'],'SupplementaryGroups':m['groups'],'MemoryMax':m['resources'][role]['memoryMaxBytes'],'TasksMax':m['resources'][role]['tasksMax'],'ActiveState':'active','SubState':'running','Restart':'no','PartOf':[],'BindsTo':[]},'process':{'identity':r['process'],'exe':[m['python']['dev'],m['python']['ino']],'uid':m['uid'],'gid':m['gid'],'groups':m['groups'],'cgroup':r['cgroup']},'fd':{'key':r['leaseKey'],'exclusiveFlock':True,'originalHolder':r['process']},'unitFileHash':proposal['hashes'][role]}
 return result

class Staging(unittest.TestCase):
 def test_distinct_namespace_no_local_repurpose(self):
  m=manifest();o=render_staging(m);self.assertFalse(o['productionAdmission'])
  for r,s in o['sources'].items():
   self.assertIn('ensayo_os_worker.py',s);self.assertIn(m['configs'][r],s);self.assertIn('ReadWritePaths='+m['runtimeRoot'],s);self.assertIn('ReadOnlyPaths='+m['configRoot'],s);self.assertIn('PrivateTmp=yes',s);self.assertIn('RuntimeDirectoryPreserve=yes',s);self.assertNotIn('/tmp/ers-local',s);self.assertNotIn('bootstrap_worker.py',s);self.assertNotIn('BindsTo=',s);self.assertNotIn('PartOf=',s)
 def test_all_consumers_source_root_equal(self):
  m=manifest();m['sourceRoot']='/opt/ers/'+'0'*64
  for f in [validate_staging,render_staging,staging_launch_plan,lambda x:match_staging(x,{})]:
   with self.assertRaises(ContractHold):f(m)
 def test_no_production_switch(self):
  for value in [True,0,None]:
   m=manifest();m['productionAdmission']=value
   with self.assertRaises(ContractHold):render_staging(m)
 def test_no_cross_local_os_schema(self):
  with self.assertRaises(ContractHold):validate_local(manifest())
  with self.assertRaises(ContractHold):validate_config({'mode':'LOCAL_SYNTHETIC_ONLY'},path='/tmp/x')
  m=manifest();m['mode']='LOCAL_BOOTSTRAP_PROPOSAL'
  with self.assertRaises(ContractHold):validate_staging(m)
 def test_config_role_path_and_token(self):
  m=manifest();c={'manifest':m,'role':'controller','token':'a'*64};self.assertEqual(validate_config(c,path=m['configs']['controller'])[1],'controller')
  with self.assertRaises(ContractHold):validate_config(c,path=m['configs']['watchdog'])
  c['token']='PRIVATE_SENTINEL'
  with self.assertRaisesRegex(ContractHold,'^STAGING_CONFIG_SHAPE$'):validate_config(c,path=m['configs']['controller'])
 def test_root_route_rejects_fixture_before_open(self):
  for p in ['/tmp/ers-local-unit-x/controller.json','/run/x','/etc/ers-ensayo/'+'a'*16+'/../controller.json']:
   with patch.object(os,'open',side_effect=AssertionError('NO_OPEN')),self.assertRaises(ContractHold):RootCustody().read_config(p)
 def test_closed_paths_no_deploylock_botpath(self):
  for field,value in [('runtimeRoot','/home/ubuntu/jarvis-estado'),('configRoot','/run/ers-ensayo-'+'a'*16),('deniedPaths',[])]:
   m=manifest();m[field]=value
   with self.assertRaises(ContractHold):validate_staging(m)
  m=manifest();m['paths']['lock']='/run/real-deploy.lock'
  with self.assertRaises(ContractHold):validate_staging(m)
 def test_cross_role_config_or_budget(self):
  m=manifest();m['configs']['watchdog']=m['configs']['controller']
  with self.assertRaises(ContractHold):validate_staging(m)
  m=manifest();m['resources']['controller']['provenance']='MEASURED_APPROVED'
  with self.assertRaises(ContractHold):validate_staging(m)
 def test_exec_pin_required(self):
  for value in ['/usr/bin/python3',{},dict(manifest()['python'],ino=0)]:
   m=manifest();m['python']=value
   with self.assertRaises(ContractHold):validate_staging(m)
 def test_plan_no_effects_and_missing_authority(self):
  m=manifest();p=staging_launch_plan(m);self.assertFalse(p['productionAdmission']);self.assertIn('owner_install_and_start_scope',p['missingBeforeExecution']);self.assertIn('real_deploy_lock',p['forbidden']);self.assertEqual(p['syntheticLock'],m['paths']['lock']);self.assertEqual(p['readiness'],'PREPARED_PLAN_NO_EXECUTOR')
 def test_install_refuse_existing(self):
  m=manifest();p=staging_launch_plan(m);absence={x:{'status':'ABSENT_LSTAT'} for x in p['targetsRequireAbsence']};self.assertEqual(staging_launch_plan(m,absence)['preflight'],'POINT_IN_TIME_ABSENCE_ONLY');absence[m['runtimeRoot']]={'status':'EXISTS'}
  with self.assertRaises(ContractHold):staging_launch_plan(m,absence)
 def test_worker_exposes_no_stdin_or_fixture_bypass(self):
  s=(ROOT/'ensayo_os_worker.py').read_text();self.assertNotIn('--stdin-config',s);self.assertIn('contract.RootCustody()',s);self.assertIn('signal.pause()',s);self.assertNotIn('--fixture',s);self.assertNotIn('subprocess',s);self.assertNotIn('pm2_read',s)

class CustodyTests(unittest.TestCase):
 def test_fixture_config_custody_is_not_root(self):
  with Fixture() as f:
   path=f.m['configs']['controller'];cfg,key=f.custody.read_config(path)
   self.assertEqual(f.custody.evidence_class,'LOCAL_MAPPED_FIXTURE_NOT_ROOT_NOT_OS');self.assertEqual(cfg['manifest'],f.m)
   with self.assertRaises(ContractHold):local_namespace(f.root)
 def test_config_mutable_or_replaced(self):
  with Fixture() as f:
   path=f.m['configs']['controller'];cfg,key=f.custody.read_config(path);p=f.custody.physical(path);p.chmod(0o600)
   with self.assertRaises(ContractHold):f.custody.read_config(path)
   p.chmod(0o440);old=os.open(p,os.O_RDONLY);p.unlink();p.write_bytes(encode(cfg));p.chmod(0o440)
   try:
    with self.assertRaises(ContractHold):f.custody.check(f.m,path,cfg,key)
   finally:os.close(old)
 def test_sources_and_groups_custody(self):
  with Fixture() as f:
   path=f.m['configs']['controller'];cfg,key=f.custody.read_config(path);p=f.root/'source'/'paired.py';p.chmod(0o600)
   with self.assertRaises(ContractHold):f.custody.check(f.m,path,cfg,key)
  with Fixture() as f:
   cfg,key=f.custody.read_config(f.m['configs']['controller']);f.m['groups']=[999999]
   with self.assertRaises(ContractHold):f.custody.check(f.m,f.m['configs']['controller'],cfg,key)
 def test_no_symlink_or_hardlink_config(self):
  for hard in (False,True):
   with Fixture() as f:
    p=f.root/'config'/'controller.json';p.unlink();target=f.root/'config'/'watchdog.json'
    if hard:os.link(target,p)
    else:p.symlink_to(target)
    with self.assertRaises((ContractHold,OSError)):f.custody.read_config(f.m['configs']['controller'])
 def test_private_ancestors_required(self):
  with Fixture() as f:
   (f.root/'config').chmod(0o755)
   with self.assertRaises(ContractHold):f.custody.read_config(f.m['configs']['controller'])
 def test_fixture_namespace_mapping_exact(self):
  with Fixture() as f:
   for p in ['/home/ubuntu/jarvis-estado','/run/other',f.m['sourceRoot']+'/../bot.py']:
    with self.assertRaises(ContractHold):f.custody.physical(p)
 def test_config_duplicate_keys_and_limit(self):
  with self.assertRaises(ContractHold):load_json(b'{"role":1,"role":2}')
  with Fixture() as f:
   p=f.root/'config'/'controller.json';p.chmod(0o600);p.write_bytes(b'x'*32769);p.chmod(0o440)
   with self.assertRaises(ContractHold):f.custody.read_config(f.m['configs']['controller'])

class ReceiptTests(unittest.TestCase):
 def test_independent_match_never_kernel_pass(self):
  m=manifest();a=match_staging(m,projections(m));self.assertFalse(a['productionAdmission']);self.assertEqual(a['kernelContainment'],'UNVERIFIED');self.assertEqual(a['effectAdapter'],'ABSENT')
 def test_false_receipt_fields_closed(self):
  m=manifest()
  for k,v in [('epoch','b'*16),('role','watchdog'),('sourceDigest','b'*64),('manifestDigest','b'*64),('productionAdmission',True),('osContainment','VERIFIED'),('extra','bad')]:
   r=receipt(m,'controller');r[k]=v
   with self.assertRaises(ContractHold):validate_receipt(m,'controller',r)
 def test_claims_cannot_replace_independent_manager_or_proc(self):
  for target,key,val in [('manager','MainPID',999),('manager','User',0),('manager','SupplementaryGroups',[999]),('manager','BindsTo',['other.service']),('manager','DropInPaths',['evil.conf']),('manager','MemoryMax',999),('process','exe',[1,2]),('process','cgroup','0::/\n'),('fd','exclusiveFlock',False)]:
   m=manifest();o=projections(m);o['controller'][target][key]=val
   with self.assertRaises(ContractHold):match_staging(m,o)
 def test_mutable_receipt_not_attestation(self):
  with Fixture() as f:
   r=receipt(f.m,'controller');write_receipt(f.m,'controller',f.custody,r);read,key=read_receipt(f.m,'controller',f.custody);self.assertEqual(read,r)
   p=f.custody.physical(f.m['paths']['controllerReceipt']);r['process']['pid']=999;p.write_bytes(encode(r))
   read,_=read_receipt(f.m,'controller',f.custody);o=projections(f.m);o['controller']['receipt']=read
   with self.assertRaises(ContractHold):match_staging(f.m,o)
 def test_receipt_partial_oversize_symlink(self):
  for data in [b'{',b'x'*4097]:
   with Fixture() as f:
    p=f.custody.physical(f.m['paths']['controllerReceipt']);p.write_bytes(data);p.chmod(0o600)
    with self.assertRaises(ContractHold):read_receipt(f.m,'controller',f.custody)
  with Fixture() as f:
   p=f.custody.physical(f.m['paths']['controllerReceipt']);p.symlink_to(f.root/'fixture.json')
   with self.assertRaises((ContractHold,OSError)):read_receipt(f.m,'controller',f.custody)
 def test_quota_unknown_and_bytes(self):
  with Fixture() as f:
   (f.root/'runtime'/'unrelated').write_text('x')
   with self.assertRaises(ContractHold):runtime_quota(f.m,f.custody)
  with Fixture() as f:
   p=f.root/'runtime'/'journal.json';p.write_bytes(b'x'*131073);p.chmod(0o600)
   with self.assertRaises(ContractHold):runtime_quota(f.m,f.custody)

class ProtocolTests(unittest.TestCase):
 def test_two_original_holders_and_external_lifetime(self):
  with Fixture() as f:
   a,b=f.start_pair();self.assertTrue(f.busy());receipts=[read_receipt(f.m,r,f.custody)[0] for r in ROLES]
   self.assertEqual([r['process']['pid'] for r in receipts],[a.pid,b.pid]);self.assertTrue(all(r['custodyClass']=='LOCAL_MAPPED_FIXTURE_NOT_ROOT_NOT_OS' for r in receipts));self.assertEqual(receipts[0]['leaseKey'],receipts[1]['leaseKey'])
   a.kill();a.wait(timeout=3);self.assertIsNone(b.poll());self.assertTrue(f.busy());b.kill();b.wait(timeout=3);self.assertFalse(f.busy());self.assertTrue((f.root/'runtime'/'journal.json').exists())
 def test_bad_peer_token_no_receipt(self):
  with Fixture() as f:
   p=f.root/'config'/'watchdog.json';cfg=load_json(p.read_bytes());cfg['token']='b'*64;p.chmod(0o600);p.write_bytes(encode(cfg));p.chmod(0o440)
   a=f.spawn('controller');f.wait_path(f.m['paths']['socket'],a);b=f.spawn('watchdog');a.wait(timeout=5);b.wait(timeout=5)
   self.assertNotEqual(a.returncode,0);self.assertNotEqual(b.returncode,0);self.assertFalse(f.custody.physical(f.m['paths']['controllerReceipt']).exists())
 def test_partial_fd_ack_loss_no_receipt(self):
  from deploy.ers_recovery.lease import identity,record,receive_record
  import array
  with Fixture() as f:
   a=f.spawn('controller');f.wait_path(f.m['paths']['socket'],a);c=socket.socket(socket.AF_UNIX,socket.SOCK_SEQPACKET);c.settimeout(3);c.connect(str(f.custody.physical(f.m['paths']['socket'])));record(c,{'token':'a'*64,'identity':identity(),'manifestDigest':digest(f.m)});hello=receive_record(c)
   data,anc,flags,_=c.recvmsg(4096,socket.CMSG_SPACE(16),socket.MSG_CMSG_CLOEXEC)
   for level,kind,payload in anc:
    if kind==socket.SCM_RIGHTS:
     fds=array.array('i');fds.frombytes(payload[:len(payload)-len(payload)%fds.itemsize])
     for fd in fds:os.close(fd)
   c.close();a.wait(timeout=5);self.assertNotEqual(a.returncode,0);self.assertFalse(f.custody.physical(f.m['paths']['controllerReceipt']).exists())
 def test_python_pin_fault_precedes_mutable_state(self):
  with Fixture() as f:
   f.m['python']['sha256']='0'*64
   p=f.root/'fixture.json';p.chmod(0o600);p.write_bytes(encode(f.m));p.chmod(0o400)
   for role in ROLES:
    p=f.root/'config'/(role+'.json');cfg=load_json(p.read_bytes());cfg['manifest']=f.m;p.chmod(0o600);p.write_bytes(encode(cfg));p.chmod(0o440)
   a=f.spawn('controller');a.wait(timeout=5);self.assertNotEqual(a.returncode,0);self.assertEqual(list((f.root/'runtime').iterdir()),[])

def death_fixture(m):
 original={r:receipt(m,r,200+i)['process'] for i,r in enumerate(ROLES)}
 death={r:{'expected':v,'source':'/proc/'+str(v['pid'])+'/stat','result':'ENOENT_INDEPENDENT_READ'} for r,v in original.items()}
 return {'original_holders':original,'death_observations':death}

class CleanupTests(unittest.TestCase):
 def fixture(self):
  m=manifest();inv={m['paths']['lock']:{'dev':1,'ino':2,'kind':'file','sha256':'a'*64,'uid':m['uid'],'gid':m['gid'],'mode':0o600,'nlink':1}};return m,inv
 def test_exact_cleanup_no_executor(self):
  m,inv=self.fixture();p=cleanup_plan(m,inv,copy.deepcopy(inv),**death_fixture(m));self.assertFalse(p['recursive']);self.assertTrue(p['externalExecutorRequired']);self.assertEqual(p['removeFiles'],list(inv))
 def test_drift_or_liveholder_hold(self):
  m,inv=self.fixture();current=copy.deepcopy(inv);current[m['paths']['lock']]['ino']=3
  with self.assertRaises(ContractHold):cleanup_plan(m,inv,current,**death_fixture(m))
  with self.assertRaises(ContractHold):cleanup_plan(m,inv,inv,original_holders={},death_observations={})
 def test_unrelated_prefix_path_no_delete(self):
  m,inv=self.fixture();inv[m['runtimeRoot']+'-other']=next(iter(inv.values()))
  with self.assertRaises(ContractHold):cleanup_plan(m,inv,inv,**death_fixture(m))

class AdditionalAdmissionTests(unittest.TestCase):
 def test_source_directory_extra_not_covered_by_pinmap(self):
  with Fixture() as f:
   p=f.root/'source'/'bot.py';p.write_text('SYNTHETIC');p.chmod(0o400);cfg,key=f.custody.read_config(f.m['configs']['controller'])
   with self.assertRaises(ContractHold):f.custody.check(f.m,f.m['configs']['controller'],cfg,key)
 def test_effective_uid_gid_groups_are_not_replaced_by_config(self):
  for field in ('uid','gid','groups'):
   with Fixture() as f:
    cfg,key=f.custody.read_config(f.m['configs']['controller'])
    real_uid=os.getuid;real_gid=os.getgid;real_groups=os.getgroups
    target={'uid':'getuid','gid':'getgid','groups':'getgroups'}[field]
    value=[999999] if field=='groups' else 999999
    with patch.object(os,target,return_value=value),self.assertRaises(ContractHold):f.custody.check(f.m,f.m['configs']['controller'],cfg,key)
 def test_read_receipt_checks_parent_projection(self):
  with Fixture() as f:
   write_receipt(f.m,'controller',f.custody,receipt(f.m,'controller'));(f.root/'runtime').chmod(0o755)
   with self.assertRaises(ContractHold):read_receipt(f.m,'controller',f.custody)
 def test_preexisting_runtime_is_not_adopted(self):
  with Fixture() as f:
   p=f.root/'runtime'/'ensayo.lock';p.write_bytes(b'');p.chmod(0o600);a=f.spawn('controller');a.wait(timeout=5);self.assertNotEqual(a.returncode,0);self.assertEqual(p.read_bytes(),b'');self.assertFalse((f.root/'runtime'/'holders.sock').exists())
 def test_cleanup_original_identity_must_match_independent_death(self):
  m=manifest();key={'dev':1,'ino':2,'kind':'file','sha256':'a'*64,'uid':m['uid'],'gid':m['gid'],'mode':0o600,'nlink':1};inv={m['paths']['lock']:key};args=death_fixture(m);args['death_observations']['controller']['expected']=dict(args['original_holders']['controller'],start='456')
  with self.assertRaises(ContractHold):cleanup_plan(m,inv,inv,**args)
 def test_unknown_quota_not_hidden_as_empty(self):
  with Fixture() as f:
   p=f.root/'runtime'/'ensayo.lock';p.symlink_to('/dev/null')
   with self.assertRaises(ContractHold):runtime_quota(f.m,f.custody)

class RootConfigPrivacyTests(unittest.TestCase):
 def record(self,mode=0o440,gid=None):
  m=manifest();cfg={'manifest':m,'role':'controller','token':'a'*64};key={'uid':0,'gid':m['gid'] if gid is None else gid,'mode':mode,'dev':1,'ino':2};return m,cfg,key
 def test_root0644_rejected_without_token_in_failure(self):
  m,cfg,key=self.record(mode=0o644)
  with patch('deploy.ers_recovery.ensayo_os.ancestors'),patch('deploy.ers_recovery.ensayo_os.bounded_file',return_value=(encode(cfg),key)):
   with self.assertRaises(ContractHold) as cm:RootCustody().read_config(m['configs']['controller'])
   self.assertEqual(str(cm.exception),'STAGING_CONFIG_PRIVATE_GROUP_RO_REQUIRED');self.assertNotIn(cfg['token'],str(cm.exception))
 def test_root0640_or0440_wronggid_rejected(self):
  for mode in (0o640,0o440):
   m,cfg,key=self.record(mode=mode,gid=999999)
   with patch('deploy.ers_recovery.ensayo_os.ancestors'),patch('deploy.ers_recovery.ensayo_os.bounded_file',return_value=(encode(cfg),key)),self.assertRaises(ContractHold):RootCustody().read_config(m['configs']['controller'])
 def test_root0440_manifestgid_accepts_after_recheck(self):
  m,cfg,key=self.record()
  with patch('deploy.ers_recovery.ensayo_os.ancestors'),patch('deploy.ers_recovery.ensayo_os.bounded_file',return_value=(encode(cfg),key)) as read,patch('deploy.ers_recovery.ensayo_os.config_directory') as directory:
   self.assertEqual(RootCustody().read_config(m['configs']['controller']),(cfg,key));self.assertEqual(read.call_count,2);self.assertEqual(directory.call_count,2);self.assertEqual(read.call_args.kwargs,{'uid':0,'gid':m['gid'],'mode':0o440});self.assertEqual(directory.call_args.kwargs,{'owner':0,'gid':m['gid']})
 def test_root_config_identity_drift_after_decode_rejected(self):
  m,cfg,key=self.record()
  with patch('deploy.ers_recovery.ensayo_os.ancestors'),patch('deploy.ers_recovery.ensayo_os.config_directory'),patch('deploy.ers_recovery.ensayo_os.bounded_file',side_effect=[(encode(cfg),key),(encode(cfg),dict(key,ino=3))]),self.assertRaisesRegex(ContractHold,'^STAGING_CONFIG_CHANGED$'):RootCustody().read_config(m['configs']['controller'])
 def test_config_directory_group_and_other_traversal_policy(self):
  from types import SimpleNamespace
  p=Path('/etc/ers-ensayo/'+'a'*16);gid=manifest()['gid']
  for owner,group,mode,valid in [(0,gid,0o750,True),(0,gid,0o755,False),(0,gid+1,0o750,False),(1,gid,0o750,False)]:
   st=SimpleNamespace(st_mode=stat.S_IFDIR|mode,st_uid=owner,st_gid=group)
   with patch.object(Path,'lstat',return_value=st),patch.object(Path,'resolve',return_value=p):
    if valid:config_directory(p,owner=0,gid=gid)
    else:
     with self.assertRaises(ContractHold):config_directory(p,owner=0,gid=gid)
 def test_fixture_same0440_group_policy_rejects0644(self):
  with Fixture() as f:
   path=f.m['configs']['controller'];p=f.custody.physical(path);p.chmod(0o644)
   with self.assertRaisesRegex(ContractHold,'^STAGING_CONFIG_PRIVATE_GROUP_RO_REQUIRED$'):f.custody.read_config(path)
