# Serves the project folder for the checks, sending the headers in _headers on every response so the checks run under the same Content-Security-Policy as the live site. A report-uri is added here only: any violation the browser reports is appended to the file named by CSP_LOG.
import os, sys, http.server as h

root = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
HEADERS = []
for line in open(os.path.join(root, '_headers')):
    if line[:1] in ' \t' and ':' in line:
        k, v = line.strip().split(':', 1)
        HEADERS.append((k, v.strip() + ('; report-uri /__csp' if k == 'Content-Security-Policy' else '')))

class Handler(h.SimpleHTTPRequestHandler):
    def end_headers(self):
        for k, v in HEADERS:
            self.send_header(k, v)
        super().end_headers()

    def do_POST(self):
        body = self.rfile.read(int(self.headers.get('Content-Length', 0)))
        if self.path == '/__csp' and os.environ.get('CSP_LOG'):
            with open(os.environ['CSP_LOG'], 'ab') as f:
                f.write(body + b'\n')
        self.send_response(204)
        self.end_headers()

    def log_message(self, *a):
        pass

# the stock server queues only 5 waiting connections, so several browsers loading the page at once get resets; this one queues 256
h.ThreadingHTTPServer.request_queue_size = 256
h.test(HandlerClass=Handler, ServerClass=h.ThreadingHTTPServer, port=int(sys.argv[1]), bind='127.0.0.1')
