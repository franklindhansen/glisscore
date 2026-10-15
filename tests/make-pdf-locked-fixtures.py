# Writes the encrypted PDFs the locked-PDF check uses into tests/fixtures (git-ignored). Standard security handler, 128-bit RC4, no extra tools needed.
# Run once: python3 tests/make-pdf-locked-fixtures.py
import os, hashlib, struct
out = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'fixtures'); os.makedirs(out, exist_ok=True)
PAD = bytes.fromhex('28BF4E5E4E758A4164004E56FFFA01082E2E00B6D0683E802F0CA9FE6453697A')
def rc4(key, data):
    s = list(range(256)); j = 0
    for i in range(256): j = (j + s[i] + key[i % len(key)]) % 256; s[i], s[j] = s[j], s[i]
    i = j = 0; o = bytearray()
    for b in data: i = (i + 1) % 256; j = (j + s[i]) % 256; s[i], s[j] = s[j], s[i]; o.append(b ^ s[(s[i] + s[j]) % 256])
    return bytes(o)
pad = lambda p: (p.encode() + PAD)[:32]
ID0 = bytes(range(16))
def keys(user, owner, P):
    k = hashlib.md5(pad(owner)).digest()
    for _ in range(50): k = hashlib.md5(k).digest()
    k = k[:16]; O = rc4(k, pad(user))
    for i in range(1, 20): O = rc4(bytes(b ^ i for b in k), O)
    fk = hashlib.md5(pad(user) + O + struct.pack('<i', P) + ID0).digest()
    for _ in range(50): fk = hashlib.md5(fk[:16]).digest()
    fk = fk[:16]; U = rc4(fk, hashlib.md5(PAD + ID0).digest())
    for i in range(1, 20): U = rc4(bytes(b ^ i for b in fk), U)
    return fk, O, U + bytes(16)
def pdf(path, user, owner, P, pages=3):
    fk, O, U = keys(user, owner, P)
    objs = [None, '<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [%s] /Count %d >>' % (' '.join('%d 0 R' % (3 + 2 * i) for i in range(pages)), pages)]
    for i in range(pages):
        objs.append('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 560] /Contents %d 0 R /Resources << /Font << /F1 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> >> >> >>' % (4 + 2 * i))
        objs.append(('BT /F1 48 Tf 100 300 Td (Page %d) Tj ET' % (i + 1)).encode())
    eo = len(objs); objs.append('<< /Filter /Standard /V 2 /R 3 /Length 128 /P %d /O <%s> /U <%s> >>' % (P, O.hex(), U.hex()))
    body = b'%PDF-1.6\n'; offs = [0]
    for n in range(1, len(objs)):
        offs.append(len(body)); o = objs[n]
        if isinstance(o, bytes):
            ok = hashlib.md5(fk + struct.pack('<I', n)[:3] + b'\0\0').digest()[:16]; d = rc4(ok, o)
            body += b'%d 0 obj\n<< /Length %d >>\nstream\n' % (n, len(d)) + d + b'\nendstream\nendobj\n'
        else: body += ('%d 0 obj\n%s\nendobj\n' % (n, o)).encode()
    x = len(body); body += ('xref\n0 %d\n0000000000 65535 f \n' % len(objs)).encode() + b''.join(b'%010d 00000 n \n' % o for o in offs[1:])
    body += ('trailer\n<< /Size %d /Root 1 0 R /Encrypt %d 0 R /ID [<%s> <%s>] >>\nstartxref\n%d\n%%%%EOF\n' % (len(objs), eo, ID0.hex(), ID0.hex(), x)).encode()
    open(os.path.join(out, path), 'wb').write(body)
ALL, VIEW_ONLY = -4, -3904 + 0      # all permissions; print and copy only (no editing, no assembling)
pdf('pdf-user-password.pdf', 'open', 'boss', ALL)             # needs "open" to open
pdf('pdf-restricted.pdf', '', 'boss', VIEW_ONLY)              # opens freely; owner password is "boss"
# a certificate-encrypted file: a handler that is not the standard password one
s = open(os.path.join(out, 'score.pdf'), 'rb').read().decode('latin1')
i = s.index('trailer'); j = s.index('>>', i)
open(os.path.join(out, 'pdf-certificate.pdf'), 'wb').write((s[:i] + 'trailer\n' + s[i + 8:j].strip() + ' /Encrypt << /Filter /Adobe.PubSec /SubFilter /adbe.pkcs7.s4 /V 4 >> /ID [<00> <00>] ' + s[j:]).encode('latin1'))
