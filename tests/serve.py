# Serves the project folder for the checks, sending the headers in _headers on every response so the checks run under the same Content-Security-Policy as the live site. A report-uri is added here only: any violation the browser reports is appended to the file named by CSP_LOG.
# Connections stay open between requests (the browser sends a page's files over a few of them): a new connection for every file left thousands of closed sockets waiting on the system, and on a busy run the system then reset some of the browser's new connections, so a page could lose a script.
# One event loop does the accepting and the sending (no thread per connection). Many browsers open their first connections in the same instant, and a server that has to take turns between accepting and sending lets the kernel's short queue (128) overflow, which resets those connections and leaves a page without some of its files.
import asyncio, os, sys, time, email.utils, http.server as h

root = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
HEADERS = []
for line in open(os.path.join(root, '_headers')):
    if line[:1] in ' \t' and ':' in line:
        k, v = line.strip().split(':', 1)
        HEADERS.append((k, v.strip() + ('; report-uri /__csp' if k == 'Content-Security-Policy' else '')))

class Paths(h.SimpleHTTPRequestHandler):          # only its path and file-type rules are used, so the answers are the same as the stock server's
    def __init__(self): self.directory = os.getcwd()

paths = Paths()
CACHE = {}          # path -> (modified time, size, bytes)

def read(path):
    st = os.stat(path); key = (st.st_mtime_ns, st.st_size); hit = CACHE.get(path)
    if hit and hit[0] == key: return hit[1], st
    with open(path, 'rb') as f: data = f.read()
    CACHE[path] = (key, data); return data, st

def reply(code, reason, body=b'', ctype='text/plain; charset=utf-8', extra=(), head=False):
    lines = ['HTTP/1.1 %d %s' % (code, reason), 'Date: ' + email.utils.formatdate(usegmt=True), 'Content-Type: ' + ctype, 'Content-Length: %d' % len(body)]
    lines += ['%s: %s' % kv for kv in extra] + ['%s: %s' % kv for kv in HEADERS] + ['Connection: keep-alive', '', '']
    return '\r\n'.join(lines).encode('latin-1') + (b'' if head else body)

async def handle(reader, writer):
    try:
        while True:
            head = await asyncio.wait_for(reader.readuntil(b'\r\n\r\n'), 30)
            lines = head.decode('latin-1').split('\r\n'); method, target = lines[0].split(' ')[:2]
            hdr = {l.split(':', 1)[0].strip().lower(): l.split(':', 1)[1].strip() for l in lines[1:] if ':' in l}
            if method == 'POST':
                body = await reader.readexactly(int(hdr.get('content-length', 0)))
                if target == '/__csp' and os.environ.get('CSP_LOG'):
                    with open(os.environ['CSP_LOG'], 'ab') as f: f.write(body + b'\n')
                out = reply(204, 'No Content')
            elif method in ('GET', 'HEAD'):
                path = paths.translate_path(target)
                if os.path.isdir(path):
                    if not target.split('?')[0].endswith('/'):
                        out = reply(301, 'Moved Permanently', extra=[('Location', target.split('?')[0] + '/')])
                    else:
                        path = next((os.path.join(path, i) for i in ('index.html', 'index.htm') if os.path.isfile(os.path.join(path, i))), None)
                        out = None
                else:
                    out = None
                if out is None:
                    if path is None or not os.path.isfile(path): out = reply(404, 'Not Found', b'File not found')
                    else:
                        data, st = read(path)
                        out = reply(200, 'OK', data, paths.guess_type(path), [('Last-Modified', email.utils.formatdate(st.st_mtime, usegmt=True))], head=(method == 'HEAD'))
            else:
                out = reply(501, 'Not Implemented')
            writer.write(out); await writer.drain()
            if hdr.get('connection', '').lower() == 'close' or method not in ('GET', 'HEAD', 'POST'): break
    except (asyncio.IncompleteReadError, ConnectionError, asyncio.LimitOverrunError, asyncio.TimeoutError):
        pass
    finally:
        try: writer.close()
        except Exception: pass

async def main(port):
    server = await asyncio.start_server(handle, '127.0.0.1', port, backlog=1024)
    async with server: await server.serve_forever()

asyncio.run(main(int(sys.argv[1])))
