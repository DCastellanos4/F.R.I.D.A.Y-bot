"""Concrete approved-bootstrap sequence, deliberately without auto-execution.
One root-owned external seed journal precedes account or install changes. The
seed itself is O_EXCL0600 and may remain an empty orphan on crash; never adopted.
No IDs, approval, capacity or account disposition are inferred from this code.
"""
import hashlib,json,os,stat
from pathlib import Path
from . import ensayo_os as c
from .ensayo_root_journal import RootJournal
from .ensayo_privileged_io import RootIO
from .ensayo_principal_bootstrap import PrincipalBootstrap
from .ensayo_root_install import Installer
from .ensayo_intervention import render_control_units
CONTROL={'ensayo_privileged_io.py','ensayo_manager_collector.py','ensayo_root_journal.py','ensayo_root_custodian.py','ensayo_scope_fd.py','ensayo_scope_handoff.py','ensayo_runtime_cleanup.py','ensayo_root_install.py','ensayo_control_program.py'}

class SeedJournal:
 def __init__(self,m):
  if os.geteuid()!=0:raise c.ContractHold('BOOTSTRAP_ROOT_REQUIRED')
  self.m=c.validate_staging(m);self.path=Path('/var/lib')/('ers-ensayo-bootstrap-'+m['epoch']+'.jsonl');c.ancestors(self.path.parent,0);self.fd=os.open(self.path,os.O_CREAT|os.O_EXCL|os.O_RDWR|os.O_APPEND|os.O_NOFOLLOW|os.O_CLOEXEC,0o600);s=os.fstat(self.fd);self.key=(s.st_dev,s.st_ino);parent=os.open(self.path.parent,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW|os.O_CLOEXEC)
  try:os.fsync(parent)
  finally:os.close(parent)
  self.append({'op':'ROOT_CONTROL_BEGIN','manifestDigest':c.digest(m)})
 def check(self):
  s=os.fstat(self.fd);name=self.path.lstat()
  if (s.st_dev,s.st_ino)!=self.key or c.file_key(s)!=c.file_key(name) or s.st_uid!=0 or s.st_nlink!=1 or stat.S_IMODE(s.st_mode)!=0o600 or s.st_size>131072:raise c.ContractHold('BOOTSTRAP_SEED_CUSTODY')
 def append(self,row):
  self.check();b=c.encode(row)+b'\n'
  if os.fstat(self.fd).st_size+len(b)>131072:raise c.ContractHold('BOOTSTRAP_SEED_LIMIT')
  if os.write(self.fd,b)!=len(b):raise c.ContractHold('BOOTSTRAP_SEED_PARTIAL')
  os.fsync(self.fd)
 def rows(self):
  self.check();s=os.fstat(self.fd);b=os.pread(self.fd,131073,0)
  if len(b)!=s.st_size or len(b)>131072 or not b.endswith(b'\n') or c.file_key(os.fstat(self.fd))!=c.file_key(s):raise c.ContractHold('BOOTSTRAP_SEED_READ_PARTIAL')
  return [c.load_json(v) for v in b.splitlines()]
 def close(self):os.close(self.fd)

def execute_prepared_bundle(m,holder_bytes,control_bytes,*,account_disposition,seed_factory=SeedJournal,principal_factory=PrincipalBootstrap,io_factory=RootIO):
 """The trusted root operator must bind this exact code+inputs to the approved
 intervention before calling. An agent-created bundle is not that approval.
 All material is validated before creating the single external seed journal.
 """
 c.validate_staging(m);c.exact(holder_bytes,c.STAGING_SOURCES,'BOOTSTRAP_HOLDER_SET');c.exact(control_bytes,CONTROL,'BOOTSTRAP_CONTROL_SET')
 for name,b in holder_bytes.items():
  if type(b) is not bytes or len(b)>1048576 or hashlib.sha256(b).hexdigest()!=m['sourceFiles'][name]:raise c.ContractHold('BOOTSTRAP_HOLDER_PIN')
 if any(type(b) is not bytes or len(b)>1048576 for b in control_bytes.values()) or account_disposition not in ('REMOVE_IF_EXACT_UNUSED','RETAIN_EXPLICIT_OWNER_ACCEPTED'):raise c.ContractHold('BOOTSTRAP_MATERIAL_OR_ACCOUNT_DECISION')
 seed=seed_factory(m);io=io_factory(m);i=m['intervention'];created=[]
 def put(path,b,*,mode=0o444,uid=0,gid=0,directory=False):
  if io.snapshot(path) is not None:raise c.ContractHold('BOOTSTRAP_NO_REPLACE')
  seed.append({'op':'INSTALL_INTENT','path':path,'kind':'directory' if directory else 'file'})
  key=io.create_directory(path,uid=uid,gid=gid,mode=mode) if directory else io.create(path,b,uid=uid,gid=gid,mode=mode)
  seed.append({'op':'INSTALL_CREATED','path':path,'key':key});created.append(path);return key
 try:
  seed.append({'op':'ACCOUNT_DISPOSITION','decision':account_disposition,'status':'EXECUTION_INPUT_NOT_APPROVAL_EVIDENCE'})
  # Shared parents are never chowned/repaired. Newly created parents are exact
  # inventoried objects; existing safe parents are recorded as NOT_OWNED.
  for parent in ('/opt/ers','/etc/ers-ensayo','/var/lib/ers-ensayo-control'):
   existing=io.snapshot(parent)
   if existing is None:put(parent,None,mode=0o755,directory=True)
   elif existing['uid']!=0 or existing['gid']!=0 or existing['mode']!=0o755 or existing['type']!=stat.S_IFDIR:raise c.ContractHold('BOOTSTRAP_PARENT_CUSTODY')
   else:seed.append({'op':'EXISTING_PARENT_NOT_OWNED','path':parent,'key':existing})
  # Final roots absent before first account mutation.
  for p in (m['sourceRoot'],m['configRoot'],m['runtimeRoot'],i['controlRoot'],i['canaryRoot'],i['gateRoot']):
   if io.snapshot(p) is not None:raise c.ContractHold('BOOTSTRAP_FINAL_ROOT_COLLISION')
  receipt=principal_factory(m,seed).reserve();receipt_digest=c.digest(receipt)
  put(i['controlRoot'],None,mode=0o700,directory=True)
  # Holder install uses the same original principal receipt from this journal.
  # Its no-second-attempt check distinguishes HOLDER_INSTALL from bootstrap ops.
  installer=Installer(m,seed,io=io);installer.install_holders(holder_bytes,principal_receipt=receipt,bootstrap_digest=receipt_digest)
  for name,b in control_bytes.items():put(i['controlRoot']+'/'+name,b)
  put(i['controlRoot']+'/bootstrap-receipt.json',c.encode(receipt),mode=0o400)
  pin={'path':i['controlRoot']+'/ensayo_control_program.py','sha256':hashlib.sha256(control_bytes['ensayo_control_program.py']).hexdigest()};controls=render_control_units(m,pin,pin);unit_hashes={m['units'][r]:v for r,v in c.render_staging(m)['hashes'].items()}
  for role,text in controls['units'].items():
   unit=i[role+'Unit'];put('/etc/systemd/system/'+unit,text.encode());unit_hashes[unit]=hashlib.sha256(text.encode()).hexdigest()
  # No late activation timer: it cannot recover original FDs and could restart
  # a completed cleanup invocation. Independent cleanup is already alive.
  for role in ('supervisor','cleanup'):
   cfg={'manifest':m,'controlPins':{n:hashlib.sha256(b).hexdigest() for n,b in control_bytes.items()},'role':role,'bootstrapReceipt':hashlib.sha256(c.encode(receipt)).hexdigest(),'unitSourceHashes':unit_hashes};put(i['controlRoot']+'/'+role+'.json',c.encode(cfg),mode=0o400)
  # Lifecycle is copied only after bootstrap finished. No root program can start
  # from a partial bootstrap; the seed remains independent and retained.
  for role in ('supervisor','cleanup'):
   if len(c.encode({'manifest':m,'controlPins':{n:hashlib.sha256(b).hexdigest() for n,b in control_bytes.items()},'role':role,'bootstrapReceipt':receipt_digest,'unitSourceHashes':unit_hashes}))>32768:raise c.ContractHold('BOOTSTRAP_CONFIG_QUOTA')
  data=b''.join(c.encode(r)+b'\n' for r in seed.rows());path=i['controlRoot']+'/lifecycle.jsonl'
  if io.snapshot(path) is not None:raise c.ContractHold('BOOTSTRAP_LIFECYCLE_COLLISION')
  key=io.create(path,data,uid=0,gid=0,mode=0o600);seed.append({'op':'LIFECYCLE_SEALED','path':path,'key':key})
  return {'status':'ROOT_FILES_AND_ACCOUNT_PREPARED_NOT_STARTED','seedJournal':str(seed.path),'productionAdmission':False,'accountDisposition':account_disposition,'next':'CAPACITY_RECHECK_GLOBAL_RELOAD_AND_START_REQUIRE_APPROVED_SCOPE'}
 finally:seed.close()
