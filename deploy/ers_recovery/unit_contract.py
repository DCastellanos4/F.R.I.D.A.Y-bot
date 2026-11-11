"""LOCAL proposed two-unit contract. It never installs units or admits production."""
import hashlib,json,re
from pathlib import PurePosixPath
class ContractHold(ValueError):pass
ROLES=('controller','watchdog')
SOURCES=('bootstrap_worker.py', 'bounded_http.py', 'bounded_rpc.py', 'bounded_unit.py', 'campaign.py', 'composition.py', 'lease.py', 'local_runner.py', 'local_unit_launcher.py', 'observations.py', 'paired.py', 'policy.py', 'unit_contract.py', 'unit_read.py')
DENIED=('/home/ubuntu/jarvis-estado','/home/ubuntu/.pm2','/home/ubuntu/backups')
def encode(v):return json.dumps(v,sort_keys=True,separators=(',',':')).encode()
def digest(v):return hashlib.sha256(encode(v)).hexdigest()
def validate(m):
 required={'schema','mode','productionAdmission','epoch','sourceRoot','sourceFiles','python','uid','gid','groups','deniedPaths','resources','units','workerConfig'}
 if type(m) is not dict or set(m)!=required:raise ContractHold('EXACT_MANIFEST_REQUIRED')
 if m['schema']!=1 or m['mode']!='LOCAL_BOOTSTRAP_PROPOSAL' or m['productionAdmission'] is not False:raise ContractHold('NO_PRODUCTION_ADMISSION')
 if type(m['epoch']) is not str or not re.fullmatch('[a-f0-9]{16}',m['epoch']):raise ContractHold('EPOCH_REQUIRED')
 if type(m['sourceRoot']) is not str or not re.fullmatch('/opt/ers/[a-f0-9]{64}',m['sourceRoot']):raise ContractHold('SOURCE_ROOT_REQUIRED')
 if m['python']!='/usr/bin/python3':raise ContractHold('FIXED_INTERPRETER_REQUIRED')
 for k in ('uid','gid'):
  if type(m[k]) is not int or m[k]<1:raise ContractHold('EXPLICIT_NONROOT_ID_REQUIRED')
 if type(m['groups']) is not list or any(type(i) is not int or i<1 for i in m['groups']) or m['groups']!=sorted(set(m['groups'])):raise ContractHold('EXACT_GROUP_SET_REQUIRED')
 if m['deniedPaths']!=list(DENIED):raise ContractHold('EXACT_DENIED_PATHS_REQUIRED')
 if type(m['sourceFiles']) is not dict or set(m['sourceFiles'])!=set(SOURCES) or any(type(h) is not str or not re.fullmatch('[a-f0-9]{64}',h) for h in m['sourceFiles'].values()):raise ContractHold('CLOSED_SOURCE_SET_REQUIRED')
 if m['sourceRoot']!='/opt/ers/'+digest(m['sourceFiles']):raise ContractHold('SOURCE_ROOT_DIGEST_MISMATCH')
 if type(m['resources']) is not dict or set(m['resources'])!=set(ROLES):raise ContractHold('EXACT_ROLE_BUDGETS_REQUIRED')
 if type(m['units']) is not dict or set(m['units'])!=set(ROLES) or type(m['workerConfig']) is not dict or set(m['workerConfig'])!=set(ROLES):raise ContractHold('EXACT_ROLE_CONSUMERS_REQUIRED')
 for role in ROLES:
  unit='ers-'+role+'-'+m['epoch']+'.service';cfg='/run/ers-'+m['epoch']+'/'+role+'.json'
  if m['units'][role]!=unit or m['workerConfig'][role]!=cfg:raise ContractHold('UNIT_CONFIG_CROSSCHECK_FAILED')
  r=m['resources'][role]
  if type(r) is not dict or set(r)!={'memoryMaxBytes','tasksMax','provenance'}:raise ContractHold('EXPLICIT_BUDGET_REQUIRED')
  if type(r['memoryMaxBytes']) is not int or r['memoryMaxBytes']<1 or type(r['tasksMax']) is not int or r['tasksMax']<1:raise ContractHold('UNRESOLVED_RESOURCE_PROPOSAL')
  if r['provenance']!='SYNTHETIC_PROPOSAL_NOT_HOST_SIZING':raise ContractHold('RESOURCE_NOT_MEASURED_PRODUCTION')
 return m

def unit_sources(m):
 validate(m);out={}
 for role in ROLES:
  r=m['resources'][role]
  out[role]='\n'.join(['[Unit]','Description=ERS local preparation '+role,'StartLimitIntervalSec=0','[Service]','Type=simple','User='+str(m['uid']),'Group='+str(m['gid']),'SupplementaryGroups='+' '.join(map(str,m['groups'])),'ExecStart='+m['python']+' -I '+m['sourceRoot']+'/bootstrap_worker.py --config '+m['workerConfig'][role],'Restart=no','KillMode=control-group','OOMPolicy=stop','MemoryMax='+str(r['memoryMaxBytes']),'TasksMax='+str(r['tasksMax']),'RuntimeDirectory=ers-'+m['epoch'],'RuntimeDirectoryMode=0700','RuntimeDirectoryPreserve=yes','UMask=0077','NoNewPrivileges=yes','ProtectSystem=strict','ProtectHome=yes','PrivateTmp=yes','PrivateNetwork=yes','PrivateDevices=yes','RestrictSUIDSGID=yes','LockPersonality=yes','CapabilityBoundingSet=','AmbientCapabilities=','RestrictAddressFamilies=AF_UNIX','ReadWritePaths=/run/ers-'+m['epoch'],'InaccessiblePaths='+' '.join(m['deniedPaths']),'StandardOutput=null','StandardError=null',''])
 return out

def prepared(m):
 sources=unit_sources(m)
 return {'manifestDigest':digest(m),'unitSourceHashes':{r:hashlib.sha256(s.encode()).hexdigest() for r,s in sources.items()},'units':sources,'productionAdmission':False,'unresolved':['unit_install_and_loaded_properties','kernel_containment','host_resource_measurements','controller_effect_adapter','recovery_authority','pm2_and_session_access_intentionally_denied','python_executable_custody','root_owned_manifest_and_config_custody']}


def match_loaded_units(m,observed):
 """Checks proposed manager/process projections; never grants effects.
 Expected source/cgroup/resources come from manifest, not observed self-labels.
 """
 proposal=prepared(m)
 if type(observed) is not dict or set(observed)!=set(ROLES):raise ContractHold('EXACT_ROLE_OBSERVATIONS_REQUIRED')
 from .observations import unit_custody
 identities=[];invocations=[]
 for role in ROLES:
  o=observed[role]
  if type(o) is not dict or set(o)!={'manager','process','attestation'}:raise ContractHold('EXACT_UNIT_PROJECTION_REQUIRED')
  manager=o['manager'];process=o['process'];unit=m['units'][role];expected_cgroup='/system.slice/'+unit
  if type(manager) is not dict or type(process) is not dict or set(process)!={'identity','exe','cgroup'}:raise ContractHold('UNIT_PROJECTION_SHAPE')
  identity=process['identity'];exe=process['exe']
  if type(identity) is not dict or set(identity)!={'pid','start','boot'} or type(identity['pid']) is not int or identity['pid']<=0 or type(identity['start']) is not str or not re.fullmatch('[0-9]+',identity['start']) or type(identity['boot']) is not str or len(identity['boot'])>64 or type(exe) is not list or len(exe)!=2 or any(type(x) is not int or x<0 for x in exe):raise ContractHold('UNIT_PROCESS_IDENTITY_SHAPE')
  requirements={'Id':unit,'LoadState':'loaded','ActiveState':'active','SubState':'running','FragmentPath':'/etc/systemd/system/'+unit,'DropInPaths':'','NeedDaemonReload':'no','User':str(m['uid']),'Group':str(m['gid']),'SupplementaryGroups':' '.join(map(str,m['groups'])),'KillMode':'control-group','OOMPolicy':'stop','MemoryMax':str(m['resources'][role]['memoryMaxBytes']),'TasksMax':str(m['resources'][role]['tasksMax']),'PartOf':'','BindsTo':'','RuntimeDirectory':'ers-'+m['epoch'],'ControlGroup':expected_cgroup}
  if set(manager)!=set(requirements)|{'MainPID','InvocationID'} or any(manager[k]!=v for k,v in requirements.items()):raise ContractHold('LOADED_UNIT_CONTRACT_MISMATCH')
  projection={k:manager[k] for k in ('Id','LoadState','ActiveState','SubState','MainPID','InvocationID','ControlGroup')}
  try:projection['MainPID']=int(projection['MainPID'])
  except (ValueError,TypeError):raise ContractHold('INVALID_UNIT_MAINPID') from None
  projection['SourceDigest']=proposal['unitSourceHashes'][role]
  att=unit_custody(projection,process['identity'],process['cgroup'],expected_unit=unit,expected_source=proposal['unitSourceHashes'][role],expected_cgroup=expected_cgroup)
  if o['attestation']!=att:raise ContractHold('UNIT_ATTESTATION_REPROJECTION_MISMATCH')
  identities.append((process['identity']['pid'],process['identity']['start']));invocations.append(manager['InvocationID'])
 if identities[0][0]==identities[1][0] or invocations[0]==invocations[1]:raise ContractHold('TWO_DISTINCT_LOADED_UNITS_REQUIRED')
 return {'status':'PROPOSED_UNIT_PROJECTIONS_MATCHED','manifestDigest':proposal['manifestDigest'],'productionAdmission':False,'kernelContainment':'UNVERIFIED','effectAdapter':'ABSENT'}


def local_namespace(directory,*,empty=False):
 """Shared LOCAL boundary. No lock/socket/Store operation precedes this."""
 from pathlib import Path
 import os,stat
 p=Path(directory)
 if p.parent!=Path('/tmp') or not p.name.startswith('ers-local-unit-') or p.resolve()!=p:raise ContractHold('LOCAL_TEST_NAMESPACE_REQUIRED')
 s=p.lstat()
 if not stat.S_ISDIR(s.st_mode) or s.st_uid!=os.getuid() or stat.S_IMODE(s.st_mode)!=0o700:raise ContractHold('PRIVATE_LOCAL_DIRECTORY_REQUIRED')
 if empty and any(p.iterdir()):raise ContractHold('EMPTY_PRIVATE_TEST_DIRECTORY_REQUIRED')
 return p
