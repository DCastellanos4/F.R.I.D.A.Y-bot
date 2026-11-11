from pathlib import Path
import sys,unittest
from unittest.mock import patch
ROOT=Path(__file__).resolve().parents[2];sys.path.insert(0,str(ROOT))
from deploy.ers_recovery.bounded_rpc import bounded_rpc
from deploy.ers_recovery.observations import Unverifiable

class RPCBoundary(unittest.TestCase):
    def test_invalid_configuration_cannot_load_pm2(self):
        with self.assertRaises(Unverifiable):bounded_rpc({},deadline=1)
    def test_nonfixed_node_rejected(self):
        with self.assertRaises(Unverifiable):bounded_rpc({},node='/bin/sh')
    def test_large_config_rejected(self):
        with self.assertRaises(Unverifiable):bounded_rpc({'x':'x'*17000})
    def test_bad_stdout_fails_closed(self):
        import json
        def run(out):
            class Process:
                returncode=0
                def communicate(inner,*a,**kw):return out,None
                def poll(inner):return 0
            with patch('deploy.ers_recovery.bounded_rpc.subprocess.Popen',return_value=Process()):
                with self.assertRaises(Unverifiable):bounded_rpc({'expected':{'0':'a','1':'b'}})
        for out in [b'x'*32769,b'{broken',b'{"version":"7.1.1","selected":[]}']:
            with self.subTest(outlen=len(out)):run(out)
    def test_start_type_and_reprojection(self):
        import json
        # Pure projection is mocked here to isolate the new stdout-start boundary.
        for bad in [123,True,{},[],"1a","",None]:
            out=json.dumps({'version':'7.1.1','selected':[{'pid':1,'pm2_env':{'pm_id':0},'processStart':bad}]}).encode()
            class Process:
                returncode=0
                def communicate(inner,*a,**kw):return out,None
                def poll(inner):return 0
            with self.subTest(start=bad),patch('deploy.ers_recovery.bounded_rpc.subprocess.Popen',return_value=Process()),patch('deploy.ers_recovery.bounded_rpc.project_processes',return_value={0:{}}):
                with self.assertRaisesRegex(Unverifiable,'RPC_PROTOCOL'):bounded_rpc({'expected':{'0':'a','1':'b'}})
    def test_wall_timeout_kills_exact_child(self):
        import subprocess
        class Process:
            killed=False;calls=0;returncode=None
            def communicate(inner,*args,**kwargs):
                inner.calls+=1
                if inner.calls==1:raise subprocess.TimeoutExpired('fixed-worker',.1)
                inner.returncode=-9;return b'',None
            def kill(inner):inner.killed=True
            def poll(inner):return inner.returncode
        p=Process()
        with patch('deploy.ers_recovery.bounded_rpc.subprocess.Popen',return_value=p):
            with self.assertRaisesRegex(Unverifiable,'GLOBAL_DEADLINE'):bounded_rpc({},deadline=.1)
        self.assertTrue(p.killed);self.assertEqual(p.calls,2)

if __name__=='__main__':unittest.main()
