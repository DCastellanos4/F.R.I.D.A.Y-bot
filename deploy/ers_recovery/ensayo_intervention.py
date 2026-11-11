"""Closed proposed intervention policy. Values are not approval or capacity proof."""
import re
from .unit_contract import ContractHold,ROLES

def reject():raise ContractHold('INTERVENTION_EXACT_PROPOSAL_REQUIRED')
def budget(b):
 if type(b) is not dict or set(b)!={'memoryMaxBytes','tasksMax','cpuQuotaPercent','memorySwapMaxBytes','provenance'}:reject()
 if any(type(b[k]) is not int or b[k]<=0 for k in ('memoryMaxBytes','tasksMax','cpuQuotaPercent')) or b['cpuQuotaPercent']>100 or type(b['memorySwapMaxBytes']) is not int or b['memorySwapMaxBytes']!=0 or b['provenance']!='UNAPPROVED_PROPOSAL_NOT_CAPACITY_EVIDENCE':reject()

def validate(m):
 i=m['intervention'];e=m['epoch']
 if type(i) is not dict or set(i)!={'status','principal','canaryRoot','controlRoot','supervisorUnit','cleanupUnit','budgets','timing','headroom','retention','accountDisposition','daemonReloadScope','cleanupAuthority','gateRoot','reservationStage'}:reject()
 if i['gateRoot']!='/run/ers-ensayo-gates-'+e or i['reservationStage']!='ONLY_EXACT_CUSTODIED_PRESTART_GATE_NO_HOLDER':reject()
 if i['cleanupAuthority']!='PROPOSED_TERMINATE_ALL_DESCENDANTS_OF_PRIOR_GATE_ONLY_EXCLUSIVE_CUSTODIED_SCOPES_NOT_ORIGINAL_PID_ONLY':reject()
 if i['status']!='PROPOSAL_NO_EXECUTION_AUTHORITY' or i['principal']!={'user':'ers-ensayo','group':'ers-ensayo','selection':'UNAPPROVED_RESERVE_FREE_SYSTEM_IDS_BEFORE_FINAL_MANIFEST','login':False,'home':False}:reject()
 if i['canaryRoot']!='/var/lib/ers-ensayo-deny-'+e or i['controlRoot']!='/var/lib/ers-ensayo-control/'+e or i['supervisorUnit']!='ers-ensayo-supervisor-'+e+'.service' or i['cleanupUnit']!='ers-ensayo-cleanup-'+e+'.service':reject()
 if type(i['budgets']) is not dict or set(i['budgets'])!={'supervisor','cleanup'}:reject()
 for b in i['budgets'].values():budget(b)
 if i['timing']!={'handshakeSeconds':10,'validationSeconds':30,'cleanupDeadlineSeconds':60,'cleanupRuntimeSeconds':70}:reject()
 if i['headroom']!={'status':'PROPOSED_NOT_MEASURED_NOT_APPROVED','memoryAvailableMinBytes':536870912,'parentPidsFreeMin':128}:reject()
 if i['retention']!={'seconds':86400,'status':'PROPOSED_NOT_APPROVED'} or i['accountDisposition']!='OWNER_DECISION_REQUIRED_NO_SILENT_RESIDUAL' or i['daemonReloadScope']!='GLOBAL_MANAGER_RELOAD_REQUIRES_EXPLICIT_APPROVAL':reject()
 return i

def render_control_units(m,supervisor_source,cleanup_source):
 # Executable source hashes are explicit inputs, not inferred from service text.
 i=validate(m);sources={}
 for role,pin in [('supervisor',supervisor_source),('cleanup',cleanup_source)]:
  if type(pin) is not dict or set(pin)!={'path','sha256'} or type(pin['path']) is not str or pin['path']!=i['controlRoot']+'/ensayo_control_program.py' or type(pin['sha256']) is not str or not re.fullmatch('[a-f0-9]{64}',pin['sha256']):reject()
  b=i['budgets'][role];limit=60 if role=='supervisor' else 70
  sources[role]='\n'.join(['[Unit]','Description=ERS proposed external '+role,'[Service]','Type=exec','User=0','Group=0','ExecStart='+m['python']['command']+' -I '+pin['path']+' --config '+i['controlRoot']+'/'+role+'.json','Restart=no','RuntimeMaxSec='+str(limit),'TimeoutStopSec=2','KillMode=control-group','MemoryMax='+str(b['memoryMaxBytes']),'MemorySwapMax=0','TasksMax='+str(b['tasksMax']),'CPUQuota='+str(b['cpuQuotaPercent'])+'%','UMask=0077','NoNewPrivileges=yes','ProtectSystem=strict','ProtectHome=yes','PrivateTmp=yes','PrivateNetwork=yes','InaccessiblePaths='+' '.join(m['deniedPaths']),'ReadWritePaths='+i['controlRoot']+' '+i['gateRoot']+(' '+m['runtimeRoot']+' '+m['sourceRoot']+' '+m['configRoot']+' '+i['canaryRoot'] if role=='cleanup' else ''),'StandardOutput=null','StandardError=null',''])
 # Historical semantic-fixture timer only. The concrete bootstrap does not
 # install or arm this artifact: a late timer cannot recover original scope FDs.
 timer='\n'.join(['[Unit]','Description=ERS proposed independent cleanup deadline','[Timer]','OnActiveSec=60s','AccuracySec=1s','Unit='+i['cleanupUnit'],'RemainAfterElapse=yes',''])
 return {'units':sources,'cleanupTimer':timer,'cleanupTimerScope':'HISTORICAL_SEMANTIC_FIXTURE_ONLY_NEVER_CONCRETE_INSTALL_OR_ARM','productionAdmission':False,'rootExecution':'LOCAL_CONCRETE_BACKEND_NOT_HOST_VALIDATED','kernelContainment':'UNVERIFIED'}
