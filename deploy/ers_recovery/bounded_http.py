"""Fixed subprocess boundary around anonymous read. No arbitrary command/URL."""
import json
import math
import os
from pathlib import Path
import subprocess
import sys

if __package__ in (None,''):
    sys.path.insert(0,str(Path(__file__).resolve().parents[2]))
from deploy.ers_recovery.observations import Unverifiable, anonymous_http


def bounded_http(port, *, deadline=3, socket_timeout=1):
    if (type(port) is not int or not 1<=port<=65535 or not math.isfinite(deadline)
            or not .1<=deadline<=10 or not math.isfinite(socket_timeout) or not .05<=socket_timeout<=5):
        raise Unverifiable('BAD_HTTP_CALLER_LIMITS')
    command=[sys.executable,'-I',str(Path(__file__).resolve()),'worker',str(port),str(socket_timeout)]
    # No inherited secret environment, shell, credential/helper files or FD lease.
    process=subprocess.Popen(command,stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,
                             env={'PATH':'/usr/bin:/bin','LANG':'C.UTF-8'},close_fds=True)
    try:
        try:output,_=process.communicate(timeout=deadline)
        except subprocess.TimeoutExpired:
            process.kill();process.communicate()
            raise Unverifiable('HTTP_GLOBAL_DEADLINE_NO_VERIFIED_RESPONSE') from None
        if process.returncode!=0 or len(output)>256:raise Unverifiable('HTTP_WORKER_UNVERIFIABLE')
        try:result=json.loads(output)
        except (ValueError,UnicodeError):raise Unverifiable('HTTP_WORKER_PROTOCOL') from None
        if result not in ([401,'Unauthorized'],[503,'API REST deshabilitada']):
            raise Unverifiable('HTTP_WORKER_PROTOCOL')
        return tuple(result)
    finally:
        if process.poll() is None:process.kill();process.wait()


def worker():
    try:
        result=anonymous_http(int(sys.argv[2]),float(sys.argv[3]))
        sys.stdout.write(json.dumps(result)+'\n')
    except BaseException:
        # No raw HTTP body, exceptions or environment escapes this worker.
        raise SystemExit(2) from None


if __name__=='__main__':
    if len(sys.argv)!=4 or sys.argv[1]!='worker':raise SystemExit(2)
    # -I excludes cwd/PYTHONPATH and user site. Import only the source root fixed
    # relative to THIS file, not an argument or an environment value.
    sys.path.insert(0,str(Path(__file__).resolve().parents[2]))
    from deploy.ers_recovery.observations import anonymous_http
    worker()
