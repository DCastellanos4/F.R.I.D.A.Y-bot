"""Explicit LOCAL mapped fixture for the ENSAYO_OS contract, never root attestation.
This entrypoint cannot install or use /etc, /opt or /run. The service entrypoint
has no option to select it. Only direct private /tmp/ers-ensayo-fixture-* roots.
"""
import hashlib,importlib,json,os,stat,sys,types
from pathlib import Path
sys.dont_write_bytecode=True
if __package__:
 from . import ensayo_os as contract
else:
 root=Path(__file__).resolve().parent;pkg=types.ModuleType('_ers_ensayo_fixture');pkg.__path__=[str(root)];sys.modules['_ers_ensayo_fixture']=pkg
 contract=importlib.import_module('_ers_ensayo_fixture.ensayo_os')

class FixtureCustody:
 evidence_class='LOCAL_MAPPED_FIXTURE_NOT_ROOT_NOT_OS'
 def __init__(self,root,manifest):
  self.root=Path(root);self.m=contract.validate_staging(manifest);self.uid=os.getuid();self.gid=os.getgid()
  if self.root.parent!=Path('/tmp') or not self.root.name.startswith('ers-ensayo-fixture-') or self.root.resolve()!=self.root:contract.reject('FIXTURE_NAMESPACE')
  self._private(self.root)
 def _private(self,p):
  s=p.lstat()
  if not stat.S_ISDIR(s.st_mode) or p.resolve()!=p or s.st_uid!=self.uid or s.st_gid!=self.gid or stat.S_IMODE(s.st_mode)!=0o700:contract.reject('FIXTURE_DIRECTORY_CUSTODY')
  return s
 def physical(self,canonical):
  # No arbitrary namespace escape and no canonical HOST opens in this fixture.
  m=self.m
  if canonical in (m['sourceRoot'],m['configRoot'],m['runtimeRoot']):return self.root/{m['sourceRoot']:'source',m['configRoot']:'config',m['runtimeRoot']:'runtime'}[canonical]
  table={m['sourceRoot']+'/'+n:self.root/'source'/n for n in contract.STAGING_SOURCES};table.update({p:self.root/'config'/Path(p).name for p in m['configs'].values()});table.update({p:self.root/'runtime'/Path(p).name for p in m['paths'].values()})
  if canonical not in table:contract.reject('FIXTURE_EXACT_MAPPING_ONLY')
  return table[canonical]
 def read_config(self,path):
  if path not in self.m['configs'].values():contract.reject('FIXTURE_CONFIG_PATH')
  self._private(self.root);contract.config_directory(self.root/'config',owner=self.uid,gid=self.m['gid'])
  data,key=contract.bounded_file(self.physical(path),contract.LIMIT,uid=self.uid)
  cfg=contract.load_json(data);m,_=contract.validate_config(cfg,path=path)
  if m!=self.m:contract.reject('FIXTURE_MANIFEST_CHANGED')
  contract.config_access(m,key,owner=self.uid)
  again,newkey=contract.bounded_file(self.physical(path),contract.LIMIT,uid=self.uid,gid=m['gid'],mode=0o440)
  contract.config_directory(self.root/'config',owner=self.uid,gid=m['gid'])
  if again!=data or newkey!=key:contract.reject('FIXTURE_CONFIG_CHANGED')
  return cfg,key
 def check_runtime(self,m):
  if m!=self.m:contract.reject('FIXTURE_MANIFEST_CHANGED')
  self._private(self.root);s=self._private(self.physical(m['runtimeRoot']))
  return {k:contract.file_key(s)[k] for k in ('dev','ino','uid','gid','mode')}
 def check(self,m,path,cfg,key):
  if m!=self.m:contract.reject('FIXTURE_MANIFEST_CHANGED')
  fresh,newkey=self.read_config(path)
  if fresh!=cfg or key!=newkey:contract.reject('FIXTURE_CONFIG_CHANGED')
  if (os.getuid(),os.geteuid(),os.getgid(),os.getegid(),sorted(set(os.getgroups())))!=(m['uid'],m['uid'],m['gid'],m['gid'],m['groups']):contract.reject('STAGING_EFFECTIVE_PRINCIPALS_MISMATCH')
  self._private(self.root/'source');contract.closed_source_directory(self.root/'source');pins={}
  for name,want in m['sourceFiles'].items():
   _,pins[name]=contract.bounded_file(self.physical(m['sourceRoot']+'/'+name),m['limits']['sourceBytes'],uid=self.uid,gid=self.gid,mode=0o400)
   if pins[name]['sha256']!=want:contract.reject('FIXTURE_SOURCE_PIN')
  # Actual local executable identity, never a fake kernel/root pass.
  py=m['python'];resolved=Path(py['resolved'])
  if Path(py['command']).resolve()!=resolved or Path('/proc/self/exe').resolve()!=resolved:contract.reject('FIXTURE_EXECUTABLE_RESOLUTION')
  _,exe=contract.bounded_file(resolved,67108864,uid=resolved.stat().st_uid)
  if any(exe[k]!=py[k] for k in ('dev','ino','size','sha256')):contract.reject('FIXTURE_EXECUTABLE_PIN')
  return {'class':self.evidence_class,'config':key,'sources':pins,'python':exe,'runtime':self.check_runtime(m)}

if __name__=='__main__':
 try:
  if len(sys.argv)!=5 or sys.argv[1]!='--fixture' or sys.argv[3]!='--config':raise ValueError('FIXTURE_ROUTE')
  # Fixture bootstrap file is not root authority; read only under private root.
  root=Path(sys.argv[2])
  if root.parent!=Path('/tmp') or not root.name.startswith('ers-ensayo-fixture-') or root.resolve()!=root:raise ValueError('FIXTURE_ROOT')
  s=root.lstat()
  if not stat.S_ISDIR(s.st_mode) or s.st_uid!=os.getuid() or stat.S_IMODE(s.st_mode)!=0o700:raise ValueError('FIXTURE_CUSTODY')
  b,_=contract.bounded_file(root/'fixture.json',contract.LIMIT,uid=os.getuid(),gid=os.getgid(),mode=0o400)
  m=contract.load_json(b);custody=FixtureCustody(root,m)
  worker=importlib.import_module((__package__ or '_ers_ensayo_fixture')+'.ensayo_os_worker')
  role=next(r for r,p in m['configs'].items() if p==sys.argv[4]);worker.session(sys.argv[4],custody,fixture_invocation=('1' if role=='controller' else '2')*32)
 except BaseException:raise SystemExit(2) from None
