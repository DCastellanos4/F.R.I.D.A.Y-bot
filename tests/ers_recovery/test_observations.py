import copy,json,os
from http.server import BaseHTTPRequestHandler,HTTPServer
from pathlib import Path
import sys,tempfile,threading,unittest
ROOT=Path(__file__).resolve().parents[2];sys.path.insert(0,str(ROOT))
from deploy.ers_recovery.observations import *
from deploy.ers_recovery.policy import Health, Stability

class Projection(unittest.TestCase):
    def raw(self,i=0):
        config=dict(name='api' if i==0 else 'wa',pm_exec_path='/release/api.js',pm_cwd='/release',exec_interpreter='/usr/bin/node',exec_mode='fork_mode',autorestart=True,watch=False,cron_restart=None,kill_timeout=5000,listen_timeout=8000,restart_delay=4000,exp_backoff_restart_delay=100,max_restarts=10,max_memory_restart='500M')
        config.update(pm_id=i,status='online',restart_time=3,pm_uptime=1000,env={'API_TOKEN':'synthetic-secret-not-exported'},API_TOKEN='synthetic-secret-not-exported')
        return dict(pid=100+i,pm2_env=config,monit={'memory':999})
    def test_project_two_exact_records_no_env(self):
        result=project_processes([self.raw(0),self.raw(1)],{0:'api',1:'wa'})
        self.assertNotIn('synthetic-secret',json.dumps(result));self.assertNotIn('env',result[0]['config'])
    def test_duplicate_id_hold(self):
        with self.assertRaises(Unverifiable):project_processes([self.raw(),self.raw()],{0:'api',1:'wa'})
    def test_extra_process_hold(self):
        with self.assertRaises(Unverifiable):project_processes([self.raw(),self.raw(1),self.raw(2)],{0:'api',1:'wa'})
    def test_online_no_pid_hold(self):
        r=self.raw();r['pid']=0
        with self.assertRaises(Unverifiable):process_record(r,0,'api')
    def test_missing_config_hold(self):
        r=self.raw();del r['pm2_env']['watch']
        with self.assertRaises(Unverifiable):process_record(r,0,'api')
    def test_projection_composes_with_sampled_health_not_rpc_green(self):
        records=project_processes([self.raw(0),self.raw(1)],{0:'api',1:'wa'})
        def health(i,t):
            r=records[i]
            return Health(r['pid'],10+i,r['restart_time'],r['pm_uptime'],100000+int(t*1000),r['status'])
        classifier=classify_http(401,b'{"ok":false,"error":"Unauthorized"}')
        observer=Stability(classifier,health(0,0),health(1,0))
        for t in range(0,75,5):
            self.assertEqual(observer.sample(t,health(0,t),health(1,t),classifier,api_listener_owned=True,wa_connection_confirmed=True),'OBSERVING')
        self.assertEqual(observer.sample(75,health(0,75),health(1,75),classifier,api_listener_owned=True,wa_connection_confirmed=True),'OPERATIONAL_EQUIVALENCE_SAMPLED')
    def test_unknown_status_hold(self):
        r=self.raw();r['pm2_env']['status']='unknown'
        with self.assertRaises(Unverifiable):process_record(r,0,'api')
    def test_errored_rpc_success_not_stop(self):
        r=self.raw();before=process_record(r,0,'api');before['start']=9
        r['pm2_env']['status']='errored';r['pid']=0
        self.assertEqual(reconcile_observation('STOP_PENDING',before,process_record(r,0,'api'),original_absent=True,current_start=0),'HOLD_PROCESS_STATE_UNCERTAIN')
    def test_online_original_not_restarted(self):
        r=process_record(self.raw(),0,'api');b=copy.deepcopy(r);b['start']=9
        self.assertEqual(reconcile_observation('STOP_PENDING',b,r,original_absent=False,current_start=9),'ORIGINAL_RUNNING_NOT_TOUCHED')
    def test_stopped_no_original_verified(self):
        raw=self.raw();b=process_record(raw,0,'api');b['start']=9;raw['pid']=0;raw['pm2_env']['status']='stopped';r=process_record(raw,0,'api')
        self.assertEqual(reconcile_observation('STOP_PENDING',b,r,original_absent=False,current_start=0),'HOLD_PROCESS_STATE_UNCERTAIN')
        self.assertEqual(reconcile_observation('STOP_PENDING',b,r,original_absent=True,current_start=0),'STOP_OBSERVED')
        self.assertEqual(reconcile_observation('START_PENDING',b,r,original_absent=True,current_start=0),'HOLD_START_OR_STOP_UNCERTAIN')

class HTTP(unittest.TestCase):
    def test_protected(self):self.assertEqual(classify_http(401,b'{"ok":false,"error":"Unauthorized"}'),(401,'Unauthorized'))
    def test_disabled_normalized(self):
        body=json.dumps(dict(ok=False,error='API REST deshabilitada: define API_TOKEN en el entorno para habilitarla.')).encode()
        self.assertEqual(classify_http(503,body),(503,'API REST deshabilitada'))
    def test_other_503_not_health(self):
        with self.assertRaises(Unverifiable):classify_http(503,b'{"ok":false,"error":"database broken"}')
    def test_200_not_equivalent(self):
        with self.assertRaises(Unverifiable):classify_http(200,b'{"ok":true}')
    def test_duplicate_keys_rejected(self):
        with self.assertRaises(Unverifiable):classify_http(401,b'{"ok":true,"ok":false,"error":"Unauthorized"}')
    def test_too_large(self):
        with self.assertRaises(Unverifiable):classify_http(401,b' '*1025)
    def test_real_loopback_get_no_auth(self):
        seen=[]
        class Handler(BaseHTTPRequestHandler):
            def log_message(self,*args):pass
            def do_GET(self):
                seen.append((self.path,dict(self.headers)));self.send_response(401);self.end_headers();self.wfile.write(b'{"ok":false,"error":"Unauthorized"}')
        server=HTTPServer(('127.0.0.1',0),Handler);thread=threading.Thread(target=server.handle_request);thread.start()
        try:self.assertEqual(anonymous_http(server.server_port),(401,'Unauthorized'))
        finally:thread.join(timeout=3);server.server_close()
        self.assertEqual(seen[0][0],'/api/salud');self.assertFalse(any(k.lower() in ('authorization','x-api-token') for k in seen[0][1]))

class Marker(unittest.TestCase):
    def setUp(self):self.tmp=tempfile.TemporaryDirectory();self.p=Path(self.tmp.name)/'log';self.p.write_bytes(b'historical\n');self.mark=mark_log(self.p)
    def tearDown(self):self.tmp.cleanup()
    def append(self,data):
        with self.p.open('ab') as f:f.write(data)
    def test_new_open_no_raw_lines(self):
        self.append(b'D.A.V.I.S. CONECTADO Y EN LINEA\n');r=marker_events(self.p,self.mark)
        self.assertEqual(r['events'],['open']);self.assertTrue(r['connected']);self.assertNotIn('private',str(r))
    def test_open_then_close_not_connected(self):
        self.append('D.A.V.I.S. CONECTADO Y EN LINEA\nConexión de WhatsApp cerrada. Razón: synthetic\n'.encode());self.assertFalse(marker_events(self.p,self.mark)['connected'])
    def test_qr_then_open_still_not_certified(self):
        self.append(b'ESCANEA ESTE CODIGO QR CON EL WHATSAPP DEL BOT:\nD.A.V.I.S. CONECTADO Y EN LINEA\n');self.assertFalse(marker_events(self.p,self.mark)['connected'])
    def test_old_open_not_fresh(self):
        self.p.write_bytes(b'D.A.V.I.S. CONECTADO Y EN LINEA\n');m=mark_log(self.p);self.assertFalse(marker_events(self.p,m)['connected'])
    def test_quoted_marker_not_evidence(self):
        self.append(b'user says D.A.V.I.S. CONECTADO Y EN LINEA\n')
        self.assertFalse(marker_events(self.p,self.mark)['connected'])
    def test_rotation_hold(self):
        self.p.rename(self.p.with_suffix('.old'));self.p.write_bytes(b'D.A.V.I.S. CONECTADO Y EN LINEA\n')
        with self.assertRaises(Unverifiable):marker_events(self.p,self.mark)
    def test_truncation_hold(self):
        self.p.write_bytes(b'')
        with self.assertRaises(Unverifiable):marker_events(self.p,self.mark)
    def test_partial_line_hold(self):
        self.append(b'D.A.V.I.S. CONECTADO Y EN LINEA')
        with self.assertRaises(Unverifiable):marker_events(self.p,self.mark)
    def test_excess_hold(self):
        self.append(b'X'*100)
        with self.assertRaises(Unverifiable):marker_events(self.p,self.mark,limit=50)

class Unit(unittest.TestCase):
    def manager(self):return dict(Id='synthetic.service',LoadState='loaded',ActiveState='active',SubState='running',MainPID=100,InvocationID='a'*32,ControlGroup='/synthetic',SourceDigest='code-sha')
    def verify(self,m):return unit_custody(m,dict(pid=100,start='9',boot='syntheticboot'),'0::/synthetic\n',expected_unit='synthetic.service',expected_source='code-sha')
    def test_exact_unit(self):self.assertEqual(self.verify(self.manager())['invocation'],'a'*32)
    def test_changed_mainpid(self):
        m=self.manager();m['MainPID']=101
        with self.assertRaises(Unverifiable):self.verify(m)
    def test_changed_source(self):
        m=self.manager();m['SourceDigest']='other'
        with self.assertRaises(Unverifiable):self.verify(m)
    def test_child_cgroup_not_exact(self):
        m=self.manager();m['ControlGroup']='/synthetic/child'
        with self.assertRaises(Unverifiable):self.verify(m)
    def test_not_running(self):
        m=self.manager();m['SubState']='exited'
        with self.assertRaises(Unverifiable):self.verify(m)

if __name__=='__main__':unittest.main()
