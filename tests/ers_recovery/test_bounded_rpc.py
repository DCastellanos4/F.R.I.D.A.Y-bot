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
