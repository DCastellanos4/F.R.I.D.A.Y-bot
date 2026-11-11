"""Prepared ENSAYO_OS contract. No installer, effects, or production admission.
The real entrypoint uses RootCustody only. FixtureCustody is an explicit local
mapping with a distinct evidence class; it cannot attest root or OS containment.
"""
import hashlib,json,os,re,stat
from pathlib import Path
from .unit_contract import digest,encode,ContractHold,ROLES,SOURCES,DENIED
STAGING_SOURCES=set(SOURCES)|{'ensayo_os.py','ensayo_os_worker.py','ensayo_os_fixture.py','ensayo_intervention.py','ensayo_prestart_gate.py'}
LIMIT=32768
HEX=lambda n,v:type(v) is str and re.fullmatch('[a-f0-9]{'+str(n)+'}',v) is not None

def reject(label):raise ContractHold(label)
def exact(value,keys,label):
 if type(value) is not dict or set(value)!=set(keys):reject(label)
def intpos(v):return type(v) is int and v>0

def validate_staging(m):
 exact(m,{'schema','mode','productionAdmission','epoch','sourceRoot','sourceFiles','python','uid','gid','groups','resources','deniedPaths','configRoot','runtimeRoot','paths','units','configs','limits','intervention'},'STAGING_EXACT_MANIFEST_REQUIRED')
 if type(m['schema']) is not int or m['schema']!=2 or m['mode']!='ENSAYO_OS_NO_BOT_EFFECTS' or m['productionAdmission'] is not False:reject('STAGING_MODE')
 if not HEX(16,m['epoch']):reject('STAGING_EPOCH')
 if type(m['sourceFiles']) is not dict or set(m['sourceFiles'])!=STAGING_SOURCES or any(not HEX(64,h) for h in m['sourceFiles'].values()):reject('STAGING_SOURCE_SET')
 if m['sourceRoot']!='/opt/ers/'+digest(m['sourceFiles']):reject('STAGING_SOURCE_ROOT_DIGEST')
 if m['configRoot']!='/etc/ers-ensayo/'+m['epoch'] or m['runtimeRoot']!='/run/ers-ensayo-'+m['epoch']:reject('STAGING_FIXED_ROOTS')
 py=m['python'];exact(py,{'command','resolved','dev','ino','size','sha256'},'STAGING_PYTHON_PIN')
 if py['command']!='/usr/bin/python3' or type(py['resolved']) is not str or not re.fullmatch('/usr/bin/python3\\.[0-9]{1,2}',py['resolved']) or any(not intpos(py[k]) for k in ('dev','ino','size')) or not HEX(64,py['sha256']):reject('STAGING_EXACT_EXECUTABLE_REQUIRED')
 if not intpos(m['uid']) or not intpos(m['gid']) or type(m['groups']) is not list or any(not intpos(x) for x in m['groups']) or m['groups']!=sorted(set(m['groups'])):reject('STAGING_EXPLICIT_PRINCIPALS')
 if m['deniedPaths']!=list(DENIED):reject('STAGING_DENIED_PATHS')
 paths={'lock':m['runtimeRoot']+'/ensayo.lock','socket':m['runtimeRoot']+'/holders.sock','journal':m['runtimeRoot']+'/journal.json','journalLock':m['runtimeRoot']+'/journal.lock','controllerReceipt':m['runtimeRoot']+'/controller.receipt.json','watchdogReceipt':m['runtimeRoot']+'/watchdog.receipt.json'}
 if m['paths']!=paths:reject('STAGING_EXACT_FIXTURE_PATHS')
 if m['limits']!={'sourceBytes':1048576,'configBytes':32768,'receiptBytes':4096,'runtimeEntries':8,'runtimeBytes':131072,'deadlineSeconds':10}:reject('STAGING_FIXED_LIMITS')
 if any(type(m[k]) is not dict or set(m[k])!=set(ROLES) for k in ('units','configs','resources')):reject('STAGING_ROLES')
 for role in ROLES:
  if m['units'][role]!='ers-ensayo-'+role+'-'+m['epoch']+'.service' or m['configs'][role]!=m['configRoot']+'/'+role+'.json':reject('STAGING_ROLE_PATHS')
  from .ensayo_intervention import budget
  budget(m['resources'][role])
 from .ensayo_intervention import validate as validate_intervention
 validate_intervention(m)
 return m

def render_staging(m):
 validate_staging(m);sources={}
 for role in ROLES:
  r=m['resources'][role]
  sources[role]='\n'.join(['[Unit]','Description=ERS isolated no-bot staging '+role,'[Service]','Type=simple','User='+str(m['uid']),'Group='+str(m['gid']),'SupplementaryGroups='+' '.join(map(str,m['groups'])),'ExecStartPre='+m['python']['command']+' -I '+m['sourceRoot']+'/ensayo_prestart_gate.py --config '+m['configs'][role],'TimeoutStartSec=12','RuntimeMaxSec=30','ExecStart='+m['python']['command']+' -I '+m['sourceRoot']+'/ensayo_os_worker.py --config '+m['configs'][role],'Restart=no','KillMode=control-group','OOMPolicy=stop','MemoryMax='+str(r['memoryMaxBytes']),'MemorySwapMax=0','CPUQuota='+str(r['cpuQuotaPercent'])+'%','TasksMax='+str(r['tasksMax']),'RuntimeDirectory=ers-ensayo-'+m['epoch'],'RuntimeDirectoryMode=0700','RuntimeDirectoryPreserve=yes','UMask=0077','NoNewPrivileges=yes','ProtectSystem=strict','ProtectHome=yes','PrivateTmp=yes','PrivateNetwork=yes','PrivateDevices=yes','RestrictSUIDSGID=yes','LockPersonality=yes','CapabilityBoundingSet=','AmbientCapabilities=','RestrictAddressFamilies=AF_UNIX','InaccessiblePaths='+' '.join(m['deniedPaths']+[m['intervention']['canaryRoot']]),'ReadOnlyPaths='+m['configRoot']+' '+m['sourceRoot'],'ReadWritePaths='+m['runtimeRoot'],'StandardOutput=null','StandardError=null',''])
 return {'mode':m['mode'],'productionAdmission':False,'manifestDigest':digest(m),'sources':sources,'hashes':{k:hashlib.sha256(v.encode()).hexdigest() for k,v in sources.items()},'readiness':'PREPARED_NOT_INSTALLED_NOT_KERNEL_VERIFIED','kernelContainment':'UNVERIFIED','effectAdapter':'ABSENT'}

def validate_config(cfg,*,path):
 exact(cfg,{'manifest','role','token'},'STAGING_CONFIG_SHAPE')
 if cfg['role'] not in ROLES or not HEX(64,cfg['token']):reject('STAGING_CONFIG_SHAPE')
 m=validate_staging(cfg['manifest']);role=cfg['role']
 if str(path)!=m['configs'][role]:reject('STAGING_CONFIG_ROLE_MISMATCH')
 return m,role

def file_key(s):return {'dev':s.st_dev,'ino':s.st_ino,'uid':s.st_uid,'gid':s.st_gid,'mode':stat.S_IMODE(s.st_mode),'nlink':s.st_nlink,'size':s.st_size,'mtime':s.st_mtime_ns,'ctime':s.st_ctime_ns}
def bounded_file(path,limit,*,uid,gid=None,mode=None):
 p=Path(path);fd=os.open(p,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK|os.O_CLOEXEC)
 try:
  a=os.fstat(fd)
  if not stat.S_ISREG(a.st_mode) or a.st_uid!=uid or a.st_nlink!=1 or a.st_mode&0o022 or (gid is not None and a.st_gid!=gid) or (mode is not None and stat.S_IMODE(a.st_mode)!=mode) or a.st_size>limit:reject('STAGING_FILE_CUSTODY')
  data=b''
  while len(data)<=limit:
   part=os.read(fd,min(65536,limit+1-len(data)))
   if not part:break
   data+=part
  if len(data)>limit or len(data)!=a.st_size or file_key(a)!=file_key(os.fstat(fd)) or file_key(a)!=file_key(p.lstat()):reject('STAGING_FILE_CHANGED_OR_LIMIT')
  return data,dict(file_key(a),sha256=hashlib.sha256(data).hexdigest())
 finally:os.close(fd)

def ancestors(path,uid,*,stop=None):
 p=Path(path)
 for parent in [p,*p.parents]:
  s=parent.lstat()
  if not stat.S_ISDIR(s.st_mode) or s.st_uid!=uid or s.st_mode&0o022 or parent.resolve()!=parent:reject('STAGING_ANCESTOR_CUSTODY')
  if stop is not None and parent==stop:break

def closed_source_directory(path):
 names=[]
 with os.scandir(path) as entries:
  for row in entries:
   if len(names)>=len(STAGING_SOURCES) or row.name not in STAGING_SOURCES:reject('STAGING_SOURCE_DIRECTORY_SET')
   names.append(row.name)
 if set(names)!=STAGING_SOURCES:reject('STAGING_SOURCE_DIRECTORY_SET')

def load_json(data):
 def unique(rows):
  d={}
  for k,v in rows:
   if k in d:reject('STAGING_DUPLICATE_KEY')
   d[k]=v
  return d
 try:return json.loads(data,object_pairs_hook=unique)
 except (ValueError,UnicodeError):reject('STAGING_JSON_INVALID')

def config_access(m,key,*,owner):
 if key['uid']!=owner or key['gid']!=m['gid'] or key['mode']!=0o440:reject('STAGING_CONFIG_PRIVATE_GROUP_RO_REQUIRED')

def config_directory(path,*,owner,gid):
 s=path.lstat()
 if not stat.S_ISDIR(s.st_mode) or path.resolve()!=path or s.st_uid!=owner or s.st_gid!=gid or stat.S_IMODE(s.st_mode)!=0o750:reject('STAGING_CONFIG_DIRECTORY_PRIVATE_GROUP_REQUIRED')

class RootCustody:
 evidence_class='ROOT_CUSTODY_POINT_IN_TIME_NOT_KERNEL_ATTESTATION'
 def physical(self,canonical):return Path(canonical)
 def read_config(self,path):
  if type(path) is not str or not re.fullmatch('/etc/ers-ensayo/[a-f0-9]{16}/(controller|watchdog)\\.json',path):reject('STAGING_CONFIG_PATH')
  ancestors(Path(path).parent,0)
  data,key=bounded_file(path,LIMIT,uid=0)
  cfg=load_json(data);m,_=validate_config(cfg,path=path)
  config_access(m,key,owner=0)
  config_directory(Path(m['configRoot']),owner=0,gid=m['gid'])
  # Re-read custody after decoding; no token-bearing value is returned on drift.
  again,newkey=bounded_file(path,LIMIT,uid=0,gid=m['gid'],mode=0o440)
  config_directory(Path(m['configRoot']),owner=0,gid=m['gid'])
  if again!=data or newkey!=key:reject('STAGING_CONFIG_CHANGED')
  return cfg,key
 def check_runtime(self,m):
  validate_staging(m);runtime=self.physical(m['runtimeRoot']);s=runtime.lstat();ancestors(runtime.parent,0)
  if not stat.S_ISDIR(s.st_mode) or runtime.resolve()!=runtime or s.st_uid!=m['uid'] or s.st_gid!=m['gid'] or stat.S_IMODE(s.st_mode)!=0o700:reject('STAGING_RUNTIME_CUSTODY')
  return {k:file_key(s)[k] for k in ('dev','ino','uid','gid','mode')}
 def check(self,m,path,cfg,key):
  validate_staging(m)
  fresh,newkey=self.read_config(path)
  if fresh!=cfg or newkey!=key:reject('STAGING_CONFIG_CHANGED')
  if (os.getuid(),os.geteuid(),os.getgid(),os.getegid(),sorted(set(os.getgroups())))!=(m['uid'],m['uid'],m['gid'],m['gid'],m['groups']):reject('STAGING_EFFECTIVE_PRINCIPALS_MISMATCH')
  source=Path(m['sourceRoot']);ancestors(source,0);closed_source_directory(source)
  pins={}
  for name,want in m['sourceFiles'].items():
   _,pins[name]=bounded_file(source/name,m['limits']['sourceBytes'],uid=0)
   if pins[name]['sha256']!=want:reject('STAGING_SOURCE_PIN')
  py=m['python'];command=Path(py['command']);resolved=Path(py['resolved'])
  ancestors(command.parent,0);ancestors(resolved.parent,0)
  if command.resolve()!=resolved or Path('/proc/self/exe').resolve()!=resolved:reject('STAGING_EXECUTABLE_RESOLUTION')
  _,exe=bounded_file(resolved,67108864,uid=0)
  if any(exe[k]!=py[k] for k in ('dev','ino','size','sha256')):reject('STAGING_EXECUTABLE_PIN')
  actual=os.stat('/proc/self/exe')
  if (actual.st_dev,actual.st_ino)!=(exe['dev'],exe['ino']):reject('STAGING_EXECUTABLE_CHANGED')
  runtime=Path(m['runtimeRoot']);s=runtime.lstat();ancestors(runtime.parent,0)
  if not stat.S_ISDIR(s.st_mode) or runtime.resolve()!=runtime or s.st_uid!=m['uid'] or s.st_gid!=m['gid'] or stat.S_IMODE(s.st_mode)!=0o700:reject('STAGING_RUNTIME_CUSTODY')
  return {'class':self.evidence_class,'config':key,'sources':pins,'python':exe,'runtime':{k:file_key(s)[k] for k in ('dev','ino','uid','gid','mode')}}

def runtime_quota(m,custody):
 root=custody.physical(m['runtimeRoot']);allowed={Path(v).name for v in m['paths'].values()};total=0;entries=[]
 with os.scandir(root) as it:
  for row in it:
   if len(entries)>=m['limits']['runtimeEntries']:reject('STAGING_RUNTIME_ENTRY_QUOTA')
   if row.name not in allowed and not re.fullmatch('\\.journal-[a-f0-9]{32}',row.name):reject('STAGING_RUNTIME_UNKNOWN_ENTRY')
   s=row.stat(follow_symlinks=False)
   if (not stat.S_ISREG(s.st_mode) and not (row.name=='holders.sock' and stat.S_ISSOCK(s.st_mode))) or s.st_uid!=m['uid'] or s.st_gid!=m['gid'] or stat.S_IMODE(s.st_mode)!=0o600 or s.st_nlink!=1:reject('STAGING_RUNTIME_ENTRY_CUSTODY')
   total+=s.st_size;entries.append(row.name)
   if total>m['limits']['runtimeBytes']:reject('STAGING_RUNTIME_BYTE_QUOTA')
 return {'entries':sorted(entries),'bytes':total}

def write_receipt(m,role,custody,value):
 validate_receipt(m,role,value);data=encode(value)
 if len(data)>m['limits']['receiptBytes']:reject('STAGING_RECEIPT_LIMIT')
 path=custody.physical(m['paths'][role+'Receipt']);fd=os.open(path,os.O_CREAT|os.O_EXCL|os.O_WRONLY|os.O_NOFOLLOW|os.O_CLOEXEC,0o600)
 try:
  if os.write(fd,data)!=len(data):reject('STAGING_RECEIPT_SHORT_WRITE')
  os.fsync(fd)
 finally:os.close(fd)
 d=os.open(path.parent,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW|os.O_CLOEXEC)
 try:os.fsync(d)
 finally:os.close(d)

def validate_receipt(m,role,value):
 validate_staging(m)
 if role not in ROLES:reject('STAGING_RECEIPT_ROLE')
 exact(value,{'status','role','process','manifestDigest','sourceDigest','epoch','invocation','cgroup','leaseKey','productionAdmission','osContainment','effectAdapter','custodyClass'},'STAGING_RECEIPT_SHAPE')
 if value['status']!='ENSAYO_HOLDER_ORIGINAL_COMMITTED' or value['role']!=role or value['productionAdmission'] is not False or value['osContainment']!='UNVERIFIED' or value['effectAdapter']!='ABSENT' or value['manifestDigest']!=digest(m) or value['sourceDigest']!=digest(m['sourceFiles']) or value['epoch']!=m['epoch']:reject('STAGING_RECEIPT_CONTRACT')
 exact(value['process'],{'pid','start','boot'},'STAGING_RECEIPT_IDENTITY')
 p=value['process']
 if not intpos(p['pid']) or type(p['start']) is not str or not re.fullmatch('[0-9]{1,24}',p['start']) or type(p['boot']) is not str or not re.fullmatch('[a-f0-9-]{36}',p['boot']):reject('STAGING_RECEIPT_IDENTITY')
 if not HEX(32,value['invocation']) or type(value['cgroup']) is not str or len(value['cgroup'])>1024 or '\x00' in value['cgroup'] or value['custodyClass'] not in (RootCustody.evidence_class,'LOCAL_MAPPED_FIXTURE_NOT_ROOT_NOT_OS'):reject('STAGING_RECEIPT_CLAIMS')
 key=value['leaseKey']
 if type(key) is not list or len(key)!=5 or any(type(x) is not int or x<0 for x in key) or key[2:]!=[m['uid'],m['gid'],0o600]:reject('STAGING_RECEIPT_LOCK')
 return value

def read_receipt(m,role,custody):
 validate_staging(m)
 if role not in ROLES:reject('STAGING_RECEIPT_ROLE')
 before=custody.check_runtime(m);runtime_quota(m,custody)
 data,key=bounded_file(custody.physical(m['paths'][role+'Receipt']),m['limits']['receiptBytes'],uid=m['uid'],gid=m['gid'],mode=0o600)
 if custody.check_runtime(m)!=before:reject('STAGING_RECEIPT_PARENT_CHANGED')
 return validate_receipt(m,role,load_json(data)),key

def match_staging(m,records):
 """Independent manager/proc/FD projection. Receipt cannot supply these reads.
 Inputs must come from a separate bounded read collector; no collector here is
 granted HOST access. Fixtures demonstrate shape/contrast, not kernel truth.
 """
 proposal=render_staging(m);exact(records,ROLES,'STAGING_MATCH_ROLES');pids=[];invs=[];locks=[]
 for role in ROLES:
  row=records[role];exact(row,{'receipt','manager','process','fd','unitFileHash'},'STAGING_MATCH_SHAPE');r=validate_receipt(m,role,row['receipt']);manager=row['manager'];p=row['process'];fd=row['fd'];unit=m['units'][role]
  expected={'Id':unit,'MainPID':r['process']['pid'],'InvocationID':r['invocation'],'ControlGroup':'/system.slice/'+unit,'FragmentPath':'/etc/systemd/system/'+unit,'DropInPaths':[],'NeedDaemonReload':False,'User':m['uid'],'Group':m['gid'],'SupplementaryGroups':m['groups'],'MemoryMax':m['resources'][role]['memoryMaxBytes'],'TasksMax':m['resources'][role]['tasksMax'],'CPUQuotaPercent':m['resources'][role]['cpuQuotaPercent'],'MemorySwapMax':0,'InaccessiblePaths':m['deniedPaths']+[m['intervention']['canaryRoot']],'ActiveState':'active','SubState':'running','Restart':'no','PartOf':[],'BindsTo':[]}
  if manager!=expected or row['unitFileHash']!=proposal['hashes'][role]:reject('STAGING_MATCH_MANAGER')
  exact(p,{'identity','exe','uid','gid','groups','cgroup'},'STAGING_MATCH_PROCESS')
  if p['identity']!=r['process'] or p['exe']!=[m['python']['dev'],m['python']['ino']] or (p['uid'],p['gid'],p['groups'])!=(m['uid'],m['gid'],m['groups']) or p['cgroup']!='0::'+manager['ControlGroup']+'\n' or r['cgroup']!=p['cgroup']:reject('STAGING_MATCH_PROCESS')
  exact(fd,{'key','exclusiveFlock','originalHolder'},'STAGING_MATCH_FD')
  if fd['key']!=r['leaseKey'] or fd['exclusiveFlock'] is not True or fd['originalHolder']!=r['process']:reject('STAGING_MATCH_FD')
  # Both roots and fixtures remain a projection, never kernel attestation.
  pids.append(p['identity']['pid']);invs.append(r['invocation']);locks.append(fd['key'])
 if len(set(pids))!=2 or len(set(invs))!=2 or locks[0]!=locks[1]:reject('STAGING_MATCH_DISTINCT_ORIGINAL_HOLDERS')
 return {'status':'STAGING_INDEPENDENT_PROJECTIONS_MATCHED_NOT_KERNEL_ATTESTED','productionAdmission':False,'kernelContainment':'UNVERIFIED','effectAdapter':'ABSENT','manifestDigest':proposal['manifestDigest']}

def staging_launch_plan(m,absence=None):
 """Planner only. Absence evidence is point-in-time, never execution authority."""
 proposal=render_staging(m)
 targets=[m['sourceRoot'],m['configRoot'],m['runtimeRoot']]+['/etc/systemd/system/'+m['units'][r] for r in ROLES]
 if absence is not None and (type(absence) is not dict or set(absence)!=set(targets) or any(v!={'status':'ABSENT_LSTAT'} for v in absence.values())):reject('STAGING_INSTALL_REFUSE_EXISTING')
 return {'mode':m['mode'],'productionAdmission':False,'manifestDigest':proposal['manifestDigest'],'sourceHashes':proposal['hashes'],'targetsRequireAbsence':targets,'preflight': 'POINT_IN_TIME_ABSENCE_ONLY' if absence is not None else 'MISSING','orderedOperations':['owner_scope_and_external_deadline_cleanup_ready','exclusive_create_root_sources_configs_units_no_replace','root_install_and_runtime_identity_inventory','start_controller_only','verify_controller_socket_before_deadline','start_watchdog_once','independent_manager_proc_fd_receipt_cotejo','external_deadline_exact_identity_termination','cleanup_reconcile_inventory_or_hold'],'unitTargets':[m['units'][r] for r in ROLES],'syntheticLock':m['paths']['lock'],'forbidden':['systemd_enable','real_deploy_lock','pm2','bot_data','model_calls','automatic_restart','automatic_cleanup'],'missingBeforeExecution':['owner_install_and_start_scope','exclusive_installer_executor','kernel_containment_probes','resource_measurements','external_deadline_and_cleanup_executor'],'readiness':'PREPARED_PLAN_NO_EXECUTOR'}

def cleanup_plan(m,inventory,current,*,original_holders,death_observations):
 """Exact identity reconciliation, no unlink/kill/systemctl. All-or-hold.
 Inventory must be kept outside both holder processes; no recursive or prefix
 deletion is emitted. An incomplete/changed inventory blocks automatic cleanup.
 """
 validate_staging(m)
 allowed={m['sourceRoot'],m['configRoot'],m['runtimeRoot']}|{m['sourceRoot']+'/'+n for n in STAGING_SOURCES}|set(m['configs'].values())|set(m['paths'].values())|{'/etc/systemd/system/'+u for u in m['units'].values()}
 exact(original_holders,ROLES,'STAGING_CLEANUP_ORIGINAL_IDENTITIES')
 exact(death_observations,ROLES,'STAGING_CLEANUP_DEATH_OBSERVATIONS')
 for role in ROLES:
  original=original_holders[role];exact(original,{'pid','start','boot'},'STAGING_CLEANUP_ORIGINAL_IDENTITY')
  if not intpos(original['pid']) or type(original['start']) is not str or not re.fullmatch('[0-9]{1,24}',original['start']) or type(original['boot']) is not str or not re.fullmatch('[a-f0-9-]{36}',original['boot']):reject('STAGING_CLEANUP_ORIGINAL_IDENTITY')
  death=death_observations[role];exact(death,{'expected','source','result'},'STAGING_CLEANUP_DEATH_OBSERVATION')
  if death['expected']!=original or death['source']!='/proc/'+str(original['pid'])+'/stat' or death['result']!='ENOENT_INDEPENDENT_READ':reject('STAGING_CLEANUP_HOLDERS_UNVERIFIED')
 if original_holders['controller']['pid']==original_holders['watchdog']['pid']:reject('STAGING_CLEANUP_DISTINCT_ORIGINAL_HOLDERS')
 if type(inventory) is not dict or not inventory or type(current) is not dict or set(inventory)!=set(current) or not set(inventory)<=allowed:reject('STAGING_CLEANUP_EXACT_INVENTORY')
 for path,key in inventory.items():
  exact(key,{'dev','ino','kind','sha256','uid','gid','mode','nlink'},'STAGING_CLEANUP_IDENTITY')
  if any(type(key[k]) is not int or key[k]<0 for k in ('dev','ino','uid','gid','mode','nlink')) or key['kind'] not in ('file','directory','socket') or (key['kind']=='file' and not HEX(64,key['sha256'])) or (key['kind']!='file' and key['sha256'] is not None) or current[path]!=key:reject('STAGING_CLEANUP_DRIFT')
 return {'status':'EXACT_CLEANUP_PLAN_ONLY','productionAdmission':False,'removeFiles':[p for p in sorted(inventory) if inventory[p]['kind']!='directory'],'removeEmptyDirectories':sorted((p for p in inventory if inventory[p]['kind']=='directory'),key=lambda p:(-p.count('/'),p)),'recursive':False,'externalExecutorRequired':True,'remainingUnknownEntries':'HOLD_NOT_DELETE'}

def validate_journal_origin(m,rows):
 """One frozen numeric identity, including the exact native-allocation prefix.
 Shared by root lifecycle and external seed retirement; no reader treats a
 pre-freeze account intent as installation/start authority.
 """
 validate_staging(m)
 begin={'op':'ROOT_CONTROL_BEGIN','manifestDigest':digest(m)}
 if type(rows) is not list or not rows or any(type(r) is not dict for r in rows) or [r for r in rows if r.get('op')=='ROOT_CONTROL_BEGIN']!=[begin]:reject('JOURNAL_ONE_FROZEN_CONTROL_ORIGIN')
 if rows[0]==begin:
  if any(r.get('op') in ('ROOT_ALLOCATION_BEGIN','ALLOCATION_MANIFEST_FROZEN') or r.get('allocation')=='SYSTEM' for r in rows):reject('JOURNAL_ALLOCATION_CANNOT_BYPASS_FREEZE')
  return
 template={k:v for k,v in m.items() if k not in ('uid','gid','groups')}
 plan={'allocation':'NATIVE_SHADOW_SYSTEM_NO_NUMERIC_SELECTION','manifestTemplate':template}
 uid=m['uid'];gid=m['gid'];name='ers-ensayo'
 receipt={'op':'PRINCIPAL_RESERVED','user':name,'group':name,'uid':uid,'gid':gid,'home':'/nonexistent','shell':'/usr/sbin/nologin','groups':[gid]}
 if len(rows)<8 or m['groups']!=[gid]:reject('JOURNAL_ALLOCATION_PREFIX')
 g=rows[2].get('nss');u=rows[4].get('nss')
 if type(g) is not list or len(g)!=4 or g[0]!=name or g[1] not in ('x','!','*','!!') or g[2:]!=[gid,[]]:reject('JOURNAL_ALLOCATION_GROUP_RECEIPT')
 if type(u) is not list or len(u)!=7 or u[0]!=name or u[1] not in ('x','!','*','!!') or u[4]!='' or u[2:4]!=[uid,gid] or u[5:]!=['/nonexistent','/usr/sbin/nologin']:reject('JOURNAL_ALLOCATION_USER_RECEIPT')
 expected=[{'op':'ROOT_ALLOCATION_BEGIN','planDigest':digest(plan)},
 {'op':'PRINCIPAL_GROUP_INTENT','name':name,'allocation':'SYSTEM'},
 {'op':'PRINCIPAL_GROUP_CREATED','name':name,'gid':gid,'nss':g},
 {'op':'PRINCIPAL_USER_INTENT','name':name,'gid':gid,'allocation':'SYSTEM'},
 {'op':'PRINCIPAL_USER_CREATED','name':name,'uid':uid,'gid':gid,'nss':u},receipt,
 {'op':'ALLOCATION_MANIFEST_FROZEN','manifestDigest':digest(m),'receiptDigest':digest(receipt),'planDigest':digest(plan)},begin]
 if rows[:8]!=expected or any(len([r for r in rows if r.get('op')==op])!=1 for op in ('ROOT_ALLOCATION_BEGIN','ALLOCATION_MANIFEST_FROZEN','PRINCIPAL_RESERVED','PRINCIPAL_GROUP_CREATED','PRINCIPAL_USER_CREATED')):reject('JOURNAL_ALLOCATION_FREEZE_CHAIN')
