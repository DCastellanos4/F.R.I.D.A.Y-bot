"""Fixed systemd manager/process observation, prepared only; no unit mutations."""
import hashlib
import math
import os
from pathlib import Path
import re
import stat
import subprocess
from .observations import Unverifiable,domain_errors,unit_custody

PROPERTIES=('Id','LoadState','ActiveState','SubState','MainPID','InvocationID',
            'ControlGroup','FragmentPath','DropInPaths','NeedDaemonReload',
            'User','Group','SupplementaryGroups','KillMode','OOMPolicy',
            'MemoryMax','TasksMax','PartOf','BindsTo','RuntimeDirectory')

@domain_errors
def manager_unit(unit, *, deadline=3):
    if type(unit) is not str or not re.fullmatch(r'ers-(controller|watchdog)-[a-f0-9]{16}\.service',unit):
        raise Unverifiable('FIXED_ERS_UNIT_NAME_REQUIRED')
    if type(deadline) not in (int,float) or not math.isfinite(deadline) or not .1<=deadline<=5:
        raise Unverifiable('BAD_UNIT_READ_DEADLINE')
    command=['/usr/bin/systemctl','show','--all','--no-pager','--property='+','.join(PROPERTIES),'--',unit]
    p=subprocess.Popen(command,stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,
                       env={'PATH':'/usr/bin:/bin','LANG':'C.UTF-8','SYSTEMD_PAGER':''},close_fds=True)
    try:
        try:out,_=p.communicate(timeout=deadline)
        except subprocess.TimeoutExpired:
            p.kill();p.communicate();raise Unverifiable('UNIT_READ_DEADLINE_UNVERIFIABLE') from None
        if p.returncode or len(out)>16384:raise Unverifiable('UNIT_READ_UNVERIFIABLE')
        lines=out.decode('utf-8').splitlines();result={}
        for line in lines:
            key,separator,value=line.partition('=')
            if not separator or key not in PROPERTIES or key in result:raise Unverifiable('UNIT_MANAGER_PROTOCOL')
            result[key]=value
        if set(result)!=set(PROPERTIES):raise Unverifiable('UNIT_MANAGER_PROTOCOL')
        if (result['Id']!=unit or result['LoadState']!='loaded' or result['NeedDaemonReload']!='no'
                or result['DropInPaths'] or result['FragmentPath']!='/etc/systemd/system/'+unit):
            raise Unverifiable('UNIT_SOURCE_LAYOUT_OR_RELOAD_UNCERTAIN')
        return result
    finally:
        if p.poll() is None:p.kill();p.wait()

@domain_errors
def pinned_fragment(unit, expected_hash):
    if type(unit) is not str or not re.fullmatch(r'ers-(controller|watchdog)-[a-f0-9]{16}\.service',unit):raise Unverifiable('FIXED_ERS_UNIT_NAME_REQUIRED')
    if type(expected_hash) is not str or not re.fullmatch(r'[a-f0-9]{64}',expected_hash):raise Unverifiable('UNIT_SOURCE_PIN_REQUIRED')
    path=Path('/etc/systemd/system')/unit
    for parent in [Path('/'),Path('/etc'),Path('/etc/systemd'),Path('/etc/systemd/system')]:
        s=parent.lstat()
        if not stat.S_ISDIR(s.st_mode) or s.st_uid!=0 or s.st_mode&0o022 or parent.resolve(strict=True)!=parent:raise Unverifiable('UNIT_SOURCE_ANCESTOR_CUSTODY')
    fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK|os.O_CLOEXEC)
    try:
        s=os.fstat(fd);a=path.lstat()
        if (not stat.S_ISREG(s.st_mode) or s.st_uid!=0 or s.st_nlink!=1 or s.st_mode&0o022
                or s.st_size>16384 or (s.st_dev,s.st_ino)!=(a.st_dev,a.st_ino)):
            raise Unverifiable('UNIT_SOURCE_FILE_CUSTODY')
        body=os.read(fd,16385);z=os.fstat(fd);q=path.lstat()
        if (len(body)!=s.st_size or len(body)>16384
                or (s.st_dev,s.st_ino,s.st_mtime_ns,s.st_ctime_ns,s.st_size)!=(z.st_dev,z.st_ino,z.st_mtime_ns,z.st_ctime_ns,z.st_size)
                or (q.st_dev,q.st_ino)!=(s.st_dev,s.st_ino)
                or hashlib.sha256(body).hexdigest()!=expected_hash):raise Unverifiable('UNIT_SOURCE_CHANGED_OR_WRONG_PIN')
        return expected_hash
    finally:os.close(fd)

@domain_errors
def process_identity(pid):
    if type(pid) is not int or pid<=0:raise Unverifiable('INVALID_UNIT_PID')
    p=Path('/proc')/str(pid)
    def ident():
        raw=(p/'stat').read_text();start=raw[raw.rfind(')')+2:].split()[19]
        if not re.fullmatch(r'[0-9]+',start):raise Unverifiable('INVALID_PROC_START')
        return {'pid':pid,'start':start,'boot':Path('/proc/sys/kernel/random/boot_id').read_text().strip()}
    initial=ident();exe=os.stat(p/'exe');cgroup=(p/'cgroup').read_text()
    if len(cgroup)>4096 or ident()!=initial:raise Unverifiable('UNIT_PROCESS_CHANGED')
    return {'identity':initial,'exe':[exe.st_dev,exe.st_ino],'cgroup':cgroup}

@domain_errors
def collect_unit(unit,expected_pid,expected_hash,expected_cgroup,*,deadline=3):
    # These are already chosen source-grounded expectations, not discovered
    # values promoted into expectations from the very observation checked.
    first=manager_unit(unit,deadline=deadline)
    source=pinned_fragment(unit,expected_hash)
    process=process_identity(expected_pid)
    if first['MainPID']!=str(expected_pid):raise Unverifiable('UNIT_MAINPID_MISMATCH')
    if not re.fullmatch(r'[0-9]+',first['MainPID']):raise Unverifiable('UNIT_MAINPID_PROTOCOL')
    manager={k:first[k] for k in ('Id','LoadState','ActiveState','SubState','MainPID','InvocationID','ControlGroup')}
    manager['MainPID']=int(first['MainPID']);manager['SourceDigest']=source
    attestation=unit_custody(manager,process['identity'],process['cgroup'],expected_unit=unit,expected_source=expected_hash,expected_cgroup=expected_cgroup)
    last=manager_unit(unit,deadline=deadline)
    if last!=first or pinned_fragment(unit,expected_hash)!=source or process_identity(expected_pid)!=process:
        raise Unverifiable('UNIT_CHANGED_DURING_READ')
    return {'manager':first,'process':process,'attestation':attestation}
