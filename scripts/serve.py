"""Serve the tool folder for development with caching switched off, so a rebuilt index.html is always the one the browser shows.
    python scripts/serve.py            (http://127.0.0.1:8766/index.html)
"""
import http.server, pathlib, sys
root = pathlib.Path(__file__).resolve().parent.parent
port = int(sys.argv[1]) if len(sys.argv) > 1 else 8766
class H(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k): super().__init__(*a, directory=str(root), **k)
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, must-revalidate'); self.send_header('Expires', '0'); super().end_headers()
    def log_message(self, *a): pass
print('serving', root, 'on http://127.0.0.1:%d/index.html (no-cache)' % port)
http.server.ThreadingHTTPServer(('127.0.0.1', port), H).serve_forever()
