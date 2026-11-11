from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
from pathlib import Path
import sys,threading,time,unittest
ROOT=Path(__file__).resolve().parents[2];sys.path.insert(0,str(ROOT))
from deploy.ers_recovery.bounded_http import bounded_http
from deploy.ers_recovery.observations import Unverifiable

class BoundedHTTP(unittest.TestCase):
    def server(self,kind):
        class Handler(BaseHTTPRequestHandler):
            def log_message(self,*args):pass
            def do_GET(self):
                if kind=='redirect':self.send_response(302);self.send_header('Location','http://example.invalid/');self.end_headers();return
                self.send_response(401);self.end_headers()
                try:
                    if kind=='trickle':
                        for byte in b'{"ok":false,"error":"Unauthorized"}':self.wfile.write(bytes([byte]));self.wfile.flush();time.sleep(.1)
                    elif kind=='oversized':self.wfile.write(b'X'*2048)
                    else:self.wfile.write(b'{"ok":false,"error":"Unauthorized"}')
                except (BrokenPipeError,ConnectionResetError):pass
        server=ThreadingHTTPServer(('127.0.0.1',0),Handler);server.daemon_threads=True
        thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
        self.addCleanup(server.server_close);self.addCleanup(server.shutdown)
        return server.server_port
    def test_real_worker_projection(self):self.assertEqual(bounded_http(self.server('normal')),(401,'Unauthorized'))
    def test_trickle_global_deadline(self):
        port=self.server('trickle');start=time.monotonic()
        with self.assertRaisesRegex(Unverifiable,'GLOBAL_DEADLINE'):bounded_http(port,deadline=.5,socket_timeout=.3)
        self.assertLess(time.monotonic()-start,1.5)
    def test_redirect_rejected(self):
        with self.assertRaises(Unverifiable):bounded_http(self.server('redirect'))
    def test_oversized_rejected(self):
        with self.assertRaises(Unverifiable):bounded_http(self.server('oversized'))
    def test_bad_limits(self):
        for kwargs in [{'port':0},{'port':65536},{'port':1,'deadline':float('nan')},{'port':1,'deadline':100}]:
            with self.assertRaises(Unverifiable):bounded_http(**kwargs)

if __name__=='__main__':unittest.main()
