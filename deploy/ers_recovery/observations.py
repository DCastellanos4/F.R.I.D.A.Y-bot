"""Bounded read/normalization helpers. No PM2 client, mutation or production paths.

Provider payloads and caller-supplied baselines are not authority. Never log raw
payloads. These helpers return allowlisted facts only and reject ambiguity.
"""
import hashlib
import http.client
import json
import os
import re
import stat
from dataclasses import dataclass


class Unverifiable(RuntimeError):
    pass


def integer(value, low=0):
    if type(value) is not int or value < low: raise Unverifiable('BAD_INTEGER')
    return value


CONFIG_FIELDS = ('name','pm_exec_path','pm_cwd','exec_interpreter','exec_mode',
                 'autorestart','watch','cron_restart','kill_timeout','listen_timeout',
                 'restart_delay','exp_backoff_restart_delay','max_restarts','max_memory_restart')


def process_record(raw, expected_id, expected_name):
    # getMonitorData returns the full process/env. Project IN MEMORY, do not
    # stringify/hash/log its env or include it in errors or journal.
    if type(raw) is not dict or type(raw.get('pm2_env')) is not dict:
        raise Unverifiable('BAD_PM2_RECORD')
    env=raw['pm2_env']
    if integer(env.get('pm_id'))!=expected_id or env.get('name')!=expected_name:
        raise Unverifiable('PM2_IDENTITY_MISMATCH')
    pid=integer(raw.get('pid'))
    status=env.get('status')
    if status not in ('online','stopped','stopping','launching','errored'):
        raise Unverifiable('UNKNOWN_PM2_STATUS')
    projected={}
    for key in CONFIG_FIELDS:
        if key not in env:raise Unverifiable('INCOMPLETE_OPERATIONAL_CONFIG')
        value=env[key]
        if value is not None and type(value) not in (str,int,bool):raise Unverifiable('UNEXPECTED_CONFIG_TYPE')
        if isinstance(value,str) and len(value)>4096:raise Unverifiable('CONFIG_TOO_LONG')
        projected[key]=value
    for key in ('pm_exec_path','pm_cwd','exec_interpreter'):
        if not isinstance(projected[key],str) or not projected[key].startswith('/'):
            raise Unverifiable('ABSOLUTE_CONFIG_PATH_REQUIRED')
    if status=='online' and pid==0:raise Unverifiable('ONLINE_WITHOUT_PID')
    return {'id':expected_id,'name':expected_name,'pid':pid,'status':status,
            'restart_time':integer(env.get('restart_time')),'pm_uptime':integer(env.get('pm_uptime')),
            'config':projected,
            'configDigest':hashlib.sha256(json.dumps(projected,sort_keys=True).encode()).hexdigest()}


def project_processes(payload, expected):
    if type(payload) is not list or len(payload)!=len(expected) or len(expected)!=2:
        raise Unverifiable('EXACT_PROCESS_SET_REQUIRED')
    found={}
    for raw in payload:
        env=raw.get('pm2_env',{}) if type(raw) is dict else {}
        key=env.get('pm_id')
        if type(key) is not int or key not in expected or key in found:
            raise Unverifiable('AMBIGUOUS_PROCESS_SET')
        found[key]=process_record(raw,key,expected[key])
    return found


def classify_http(status, body):
    if type(status) is not int or type(body) is not bytes or len(body)>1024:raise Unverifiable('HTTP_BODY_UNBOUNDED')
    try:
        def unique(pairs):
            d={}
            for k,v in pairs:
                if k in d:raise ValueError('duplicate')
                d[k]=v
            return d
        data=json.loads(body.decode('utf-8'),object_pairs_hook=unique)
    except (ValueError,UnicodeError):raise Unverifiable('HTTP_RESPONSE_NOT_EXPECTED_JSON') from None
    if type(data) is not dict or data.get('ok') is not False or type(data.get('error')) is not str:
        raise Unverifiable('HTTP_RESPONSE_NOT_EXPECTED_CLASS')
    # Normalize the exact known contract, not arbitrary 503 text, HTML or a
    # response body copied into a status report. Discard the body on return.
    if status==401 and data['error']=='Unauthorized':return (401,'Unauthorized')
    if status==503 and data['error']=='API REST deshabilitada: define API_TOKEN en el entorno para habilitarla.':
        return (503,'API REST deshabilitada')
    raise Unverifiable('HTTP_RESPONSE_NOT_EXPECTED_CLASS')


def anonymous_http(port, timeout=2):
    integer(port,1)
    if port>65535 or not 0<timeout<=5:raise Unverifiable('BAD_HTTP_LIMITS')
    # Fixed literal loopback. No hostname, redirect, proxy, auth or configurable
    # request path. It is a read-only endpoint in the inspected source contract.
    c=http.client.HTTPConnection('127.0.0.1',port,timeout=timeout)
    try:
        c.request('GET','/api/salud',headers={'Connection':'close'})
        r=c.getresponse();body=r.read(1025)
        return classify_http(r.status,body)
    finally:c.close()


@dataclass(frozen=True)
class FileMark:
    device:int
    inode:int
    size:int


def _regular(path):
    fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW|os.O_CLOEXEC|os.O_NONBLOCK)
    try:
        s=os.fstat(fd);p=os.lstat(path)
        if not stat.S_ISREG(s.st_mode) or s.st_nlink!=1 or (s.st_dev,s.st_ino)!=(p.st_dev,p.st_ino):
            raise Unverifiable('LOG_NOT_BOUND_REGULAR_FILE')
        return fd,s
    except BaseException:os.close(fd);raise


def mark_log(path):
    fd,s=_regular(path)
    try:return FileMark(s.st_dev,s.st_ino,s.st_size)
    finally:os.close(fd)


def marker_events(path, before, *, limit=262144):
    # Only a previously observed inode is supported. Rotation, truncation or
    # excess bytes are uncertainty, never permission to read a whole log.
    if not isinstance(before,FileMark) or not 0<limit<=262144:
        raise Unverifiable('BAD_MARK_OR_LIMIT')
    fd,s=_regular(path)
    try:
        if (s.st_dev,s.st_ino)!=(before.device,before.inode) or s.st_size<before.size:
            raise Unverifiable('LOG_ROTATED_OR_TRUNCATED')
        length=s.st_size-before.size
        if length>limit:raise Unverifiable('LOG_DELTA_TOO_LARGE')
        # If old file ends with a partial line, do not attribute a continuation
        # of its historical marker to the new process.
        boundary=before.size==0 or os.pread(fd,1,before.size-1)==b'\n'
        data=os.pread(fd,length,before.size)
        after=os.fstat(fd);current=os.lstat(path)
        if (after.st_dev,after.st_ino,after.st_size)!=(s.st_dev,s.st_ino,s.st_size) or (current.st_dev,current.st_ino)!=(s.st_dev,s.st_ino):
            raise Unverifiable('LOG_CHANGED_DURING_READ')
        if not boundary:raise Unverifiable('LOG_BASELINE_PARTIAL_LINE')
        if data and not data.endswith(b'\n'):raise Unverifiable('LOG_DELTA_PARTIAL_LINE')
        events=[]
        for line in data.splitlines():
            # Exact source console output, not markers quoted inside user text.
            # Timestamp-prefixed/wrapped logs require a separately reviewed
            # normalization adapter; do not guess stripping arbitrary prefixes.
            if line==b'D.A.V.I.S. CONECTADO Y EN LINEA':events.append('open')
            elif line.startswith('Conexión de WhatsApp cerrada. Razón:'.encode('utf-8')):events.append('close')
            elif line==b'ESCANEA ESTE CODIGO QR CON EL WHATSAPP DEL BOT:':events.append('qr')
            elif line.startswith(b'CODIGO DE VINCULACION PARA LA SIM ('):events.append('qr')
        # Never include raw lines, payload text, identifiers or log offsets beyond
        # a file identity/size mark. A marker alone cannot authenticate its author.
        return {'events':events,'connected':bool(events) and events[-1]=='open' and 'qr' not in events,
                'mark':FileMark(s.st_dev,s.st_ino,s.st_size)}
    finally:os.close(fd)


def unit_custody(manager, proc_identity, proc_cgroup, *, expected_unit, expected_source):
    # manager is a deliberately projected systemctl show result, not arbitrary
    # event text or the process's self-asserted environment.
    required={'Id','LoadState','ActiveState','SubState','MainPID','InvocationID','ControlGroup','SourceDigest'}
    if set(manager)!=required or manager['Id']!=expected_unit or manager['LoadState']!='loaded':
        raise Unverifiable('UNIT_NOT_EXPECTED')
    if manager['ActiveState']!='active' or manager['SubState']!='running':raise Unverifiable('UNIT_NOT_RUNNING')
    if integer(manager['MainPID'],1)!=proc_identity['pid'] or not re.fullmatch('[a-f0-9]{32}',manager['InvocationID']):
        raise Unverifiable('UNIT_PROCESS_IDENTITY_MISMATCH')
    if manager['SourceDigest']!=expected_source or not manager['ControlGroup'].startswith('/'):
        raise Unverifiable('UNIT_SOURCE_OR_GROUP_MISMATCH')
    if proc_cgroup != '0::'+manager['ControlGroup']+'\n':raise Unverifiable('PROCESS_NOT_EXACT_UNIT_CGROUP')
    return {'unit':expected_unit,'invocation':manager['InvocationID'],'process':proc_identity.copy(),
            'cgroup':manager['ControlGroup'],'source':expected_source}


def reconcile_observation(intent, baseline, current, *, original_absent, current_start):
    if (baseline['id'],baseline['configDigest'])!=(current['id'],current['configDigest']):
        return 'HOLD_CHANGED_RECORD'
    if current['status']=='online':
        if (current['pid'],current_start)==(baseline['pid'],baseline['start']):return 'ORIGINAL_RUNNING_NOT_TOUCHED'
        return 'START_OBSERVED_NEEDS_STABILITY' if intent=='START_PENDING' else 'HOLD_UNEXPECTED_INSTANCE'
    if current['status']=='stopped' and current['pid']==0 and original_absent:
        return 'STOP_OBSERVED' if intent in ('STOP_PENDING','STOP_CONFIRMED') else 'HOLD_START_OR_STOP_UNCERTAIN'
    return 'HOLD_PROCESS_STATE_UNCERTAIN'
