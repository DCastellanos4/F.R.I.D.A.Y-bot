"""Direct existing-daemon read boundary. No PM2 CLI/client or mutation interface."""
import json
import math
from pathlib import Path
import subprocess

from .observations import Unverifiable, project_processes


def bounded_rpc(config, *, node='/usr/bin/node', deadline=7):
    # This path is source-anchored to the production Node interpreter already
    # inspected in this deployment. Changing it requires a new contract review.
    if node!='/usr/bin/node' or not math.isfinite(deadline) or not .1<=deadline<=10:
        raise Unverifiable('BAD_RPC_CALLER_LIMITS')
    try:encoded=json.dumps(config).encode()
    except (ValueError,TypeError):raise Unverifiable('BAD_RPC_CONFIG') from None
    if len(encoded)>16384:raise Unverifiable('RPC_CONFIG_TOO_LARGE')
    script=Path(__file__).with_name('pm2_read.cjs')
    p=subprocess.Popen([node,str(script)],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,
                       env={'PATH':'/usr/bin:/bin','LANG':'C.UTF-8'},close_fds=True)
    try:
        try:out,_=p.communicate(encoded,timeout=deadline)
        except subprocess.TimeoutExpired:
            p.kill();p.communicate();raise Unverifiable('RPC_GLOBAL_DEADLINE_NO_VERIFIED_RESPONSE') from None
        if p.returncode!=0 or len(out)>32768:raise Unverifiable('RPC_READ_UNVERIFIABLE')
        try:
            data=json.loads(out)
            # A second pure projection validates stdout before returning facts.
            expected={int(k):v for k,v in config['expected'].items()}
            selected=project_processes(data['selected'],expected)
            version=data['version']
            if type(version) is not str or len(version)>32:raise ValueError()
            for row in data['selected']:
                selected[row['pm2_env']['pm_id']]['start']=row['processStart']
            return {'version':version,'selected':selected}
        except (KeyError,ValueError,TypeError):raise Unverifiable('RPC_PROTOCOL_UNVERIFIABLE') from None
    finally:
        if p.poll() is None:p.kill();p.wait()
