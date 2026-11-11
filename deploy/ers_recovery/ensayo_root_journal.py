"""Root-owned control journal, no adoption of unlogged identities or effects.
Only the manifest controlRoot may be used; no command/environment secret values.
"""
import os,stat
from pathlib import Path
from . import ensayo_os as c

class RootJournal:
 def __init__(self,m,*,create=False):
  self.m=c.validate_staging(m);self.path=Path(m['intervention']['controlRoot']);c.ancestors(self.path,0);s=self.path.lstat()
  if stat.S_IMODE(s.st_mode)!=0o700:raise c.ContractHold('ROOT_CONTROL_PRIVATE')
  self.rootkey=(s.st_dev,s.st_ino);self.d=os.open(self.path,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW|os.O_CLOEXEC)
  self.fd=os.open('lifecycle.jsonl',os.O_RDWR|os.O_APPEND|os.O_NOFOLLOW|os.O_CLOEXEC|(os.O_CREAT|os.O_EXCL if create else 0),0o600,dir_fd=self.d);s=os.fstat(self.fd);self.filekey=(s.st_dev,s.st_ino)
  if not stat.S_ISREG(s.st_mode) or s.st_uid!=0 or s.st_nlink!=1 or stat.S_IMODE(s.st_mode)!=0o600:self.close();raise c.ContractHold('ROOT_CONTROL_JOURNAL_CUSTODY')
  if create:os.fsync(self.d);self.append({'op':'ROOT_CONTROL_BEGIN','manifestDigest':c.digest(m)})
  else:self.rows()
 def check(self):
  s=self.path.lstat();f=os.fstat(self.fd);name=os.stat('lifecycle.jsonl',dir_fd=self.d,follow_symlinks=False)
  if (s.st_dev,s.st_ino)!=self.rootkey or s.st_uid!=0 or stat.S_IMODE(s.st_mode)!=0o700 or (f.st_dev,f.st_ino)!=self.filekey or c.file_key(f)!=c.file_key(name) or f.st_uid!=0 or f.st_nlink!=1 or stat.S_IMODE(f.st_mode)!=0o600 or f.st_size>131072:raise c.ContractHold('ROOT_CONTROL_JOURNAL_DRIFT')
 def append(self,row):
  self.check();data=c.encode(row)+b'\n'
  if len(data)>16384 or os.fstat(self.fd).st_size+len(data)>131072:raise c.ContractHold('ROOT_CONTROL_JOURNAL_QUOTA')
  if os.write(self.fd,data)!=len(data):raise c.ContractHold('ROOT_CONTROL_JOURNAL_SHORT_WRITE')
  os.fsync(self.fd);self.check()
 def rows(self):
  self.check();before=os.fstat(self.fd);b=os.pread(self.fd,131073,0)
  if len(b)>131072 or len(b)!=before.st_size or c.file_key(before)!=c.file_key(os.fstat(self.fd)) or not b.endswith(b'\n'):raise c.ContractHold('ROOT_CONTROL_JOURNAL_PARTIAL')
  rows=[c.load_json(v) for v in b.splitlines()]
  if not rows or rows[0]!={'op':'ROOT_CONTROL_BEGIN','manifestDigest':c.digest(self.m)} or len(rows)>256:raise c.ContractHold('ROOT_CONTROL_JOURNAL_BINDING')
  return rows
 def close(self):os.close(self.fd);os.close(self.d)
