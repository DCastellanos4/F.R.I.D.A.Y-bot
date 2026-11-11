"""Fixed independent wall-deadline worker for prepared unit collection."""
import json
import math
from pathlib import Path
import subprocess
import sys
if __package__ in (None,''):
    sys.path.insert(0,str(Path(__file__).resolve().parents[2]))
from deploy.ers_recovery.observations import Unverifiable,domain_errors

@domain_errors
def bounded_unit(unit,pid,source,cgroup,*,deadline=7):
    if type(deadline) not in (int,float) or not math.isfinite(deadline) or not .1<=deadline<=10:
        raise Unverifiable('BAD_UNIT_PARENT_DEADLINE')
    config={'unit':unit,'pid':pid,'source':source,'cgroup':cgroup}
    data=json.dumps(config).encode()
    if len(data)>2048:raise Unverifiable('UNIT_CONFIG_TOO_LARGE')
    p=subprocess.Popen([sys.executable,'-I',str(Path(__file__).resolve()),'worker'],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,
                       env={'PATH':'/usr/bin:/bin','LANG':'C.UTF-8'},close_fds=True)
    try:
        try:out,_=p.communicate(data,timeout=deadline)
        except subprocess.TimeoutExpired:
            p.kill();p.communicate();raise Unverifiable('UNIT_GLOBAL_DEADLINE_UNVERIFIABLE') from None
        if p.returncode or len(out)>32768:raise Unverifiable('UNIT_WORKER_UNVERIFIABLE')
        result=json.loads(out)
        if type(result) is not dict or set(result)!={'manager','process','attestation'}:raise Unverifiable('UNIT_WORKER_PROTOCOL')
        # Revalidate exact expected identity/cgroup/source via the existing pure
        # helper instead of trusting a JSON label from the worker alone.
        from deploy.ers_recovery.observations import unit_custody
        m=result['manager'];pinfo=result['process']
        if set(m)!={'Id','LoadState','ActiveState','SubState','MainPID','InvocationID','ControlGroup','FragmentPath','DropInPaths','NeedDaemonReload','User','Group','SupplementaryGroups','KillMode','OOMPolicy','MemoryMax','TasksMax','PartOf','BindsTo','RuntimeDirectory'}:raise Unverifiable('UNIT_WORKER_PROTOCOL')
        if any(type(v) is not str or len(v)>4096 for v in m.values()):raise Unverifiable('UNIT_WORKER_PROTOCOL')
        if (type(pinfo) is not dict or set(pinfo)!={'identity','exe','cgroup'}
                or type(pinfo['identity']) is not dict or set(pinfo['identity'])!={'pid','start','boot'}
                or type(pinfo['identity']['start']) is not str or not pinfo['identity']['start'].isascii() or not pinfo['identity']['start'].isdigit()
                or type(pinfo['identity']['boot']) is not str or len(pinfo['identity']['boot'])>64
                or type(pinfo['exe']) is not list or len(pinfo['exe'])!=2 or any(type(n) is not int or n<0 for n in pinfo['exe'])
                or type(pinfo['cgroup']) is not str or len(pinfo['cgroup'])>4096):raise Unverifiable('UNIT_WORKER_PROTOCOL')
        if m['MainPID']!=str(pid) or m['NeedDaemonReload']!='no' or m['DropInPaths'] or m['FragmentPath']!='/etc/systemd/system/'+unit:raise Unverifiable('UNIT_WORKER_PROTOCOL')
        projected={k:m[k] for k in ('Id','LoadState','ActiveState','SubState','MainPID','InvocationID','ControlGroup')};projected['MainPID']=pid;projected['SourceDigest']=source
        normalized=unit_custody(projected,pinfo['identity'],pinfo['cgroup'],expected_unit=unit,expected_source=source,expected_cgroup=cgroup)
        if normalized!=result['attestation']:raise Unverifiable('UNIT_WORKER_PROTOCOL')
        return result
    finally:
        if p.poll() is None:p.kill();p.wait()

def worker():
    from deploy.ers_recovery.unit_read import collect_unit
    try:
        data=sys.stdin.buffer.read(2049)
        if len(data)>2048:raise ValueError()
        config=json.loads(data)
        if type(config) is not dict or set(config)!={'unit','pid','source','cgroup'}:raise ValueError()
        print(json.dumps(collect_unit(config['unit'],config['pid'],config['source'],config['cgroup'],deadline=2)))
    except BaseException:raise SystemExit(2) from None

if __name__=='__main__':
    if sys.argv[1:]!=['worker']:raise SystemExit(2)
    worker()
