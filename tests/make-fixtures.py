# Writes the small test sounds the Audio Editor checks use into tests/fixtures (git-ignored).
# Needs ffmpeg for the MP3 files. Run once: python3 tests/make-fixtures.py
import os, struct, math, subprocess
here = os.path.dirname(os.path.abspath(__file__)); out = os.path.join(here, 'fixtures'); os.makedirs(out, exist_ok=True)
def wav(path, frames, ch=1, rate=44100):
    data = b''.join(struct.pack('<' + 'h' * ch, *f) for f in frames)
    hdr = b'RIFF' + struct.pack('<I', 36 + len(data)) + b'WAVE' + b'fmt ' + struct.pack('<IHHIIHH', 16, 1, ch, rate, rate * 2 * ch, 2 * ch, 16) + b'data' + struct.pack('<I', len(data))
    open(path, 'wb').write(hdr + data)
n = 44100 * 4
wav(os.path.join(out, 'stereo.wav'), [(int(0.4 * math.sin(2 * math.pi * 330 * i / 44100) * (0.6 + 0.4 * math.sin(i / 7000)) * 32767), int(0.4 * 0.63 * math.sin(2 * math.pi * 330 * i / 44100) * (0.6 + 0.4 * math.sin(i / 7000)) * 32767)) for i in range(n)], ch=2)
wav(os.path.join(out, 'clamp.mp3'), [(-32768,)] * 2000)      # lossy-named, decodes to exact -1.0
wav(os.path.join(out, 'noclamp.mp3'), [(-32767,)] * 2000)
subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3', '-af', 'volume=0.99', '-c:a', 'libmp3lame', '-b:a', '192k', os.path.join(out, 'loud.mp3')], check=True)
# for the disk store check: every kind of WAV the store reads by hand
ff = lambda *a: subprocess.run(['ffmpeg', '-y', '-loglevel', 'error'] + list(a), check=True)
tone = ['-f', 'lavfi', '-i', "aevalsrc=exprs='0.5*sin(2*PI*330*t)+0.2*sin(2*PI*1870*t)|0.4*sin(2*PI*441*t)*sin(2*PI*0.7*t)':s=48000:d=5"]
for name, codec in [('u8', 'pcm_u8'), ('s24', 'pcm_s24le'), ('s32', 'pcm_s32le'), ('f64', 'pcm_f64le')]: ff(*tone, '-c:a', codec, os.path.join(out, name + '.wav'))
ff(*tone, '-af', 'volume=1.6', '-c:a', 'pcm_f32le', os.path.join(out, 'f32over.wav'))      # float, peaks above full scale
ff(*tone, '-ac', '1', '-c:a', 'pcm_s16le', os.path.join(out, 'mono.wav'))
ff('-f', 'lavfi', '-i', "aevalsrc=exprs='0.3*sin(2*PI*300*t)|0.3*sin(2*PI*410*t)|0.3*sin(2*PI*520*t)|0.3*sin(2*PI*60*t)|0.3*sin(2*PI*700*t)|0.3*sin(2*PI*810*t)':c=5.1:s=48000:d=3", '-c:a', 'pcm_s16le', os.path.join(out, 'surround.wav'))
ff('-i', os.path.join(out, 'stereo.wav'), '-rf64', 'always', '-c:a', 'pcm_s16le', os.path.join(out, 'rf64.wav'))
raw = open(os.path.join(out, 'stereo.wav'), 'rb').read()      # a recorder that never filled in the data size: 0, and 0xFFFFFFFF
open(os.path.join(out, 'size0.wav'), 'wb').write(raw[:40] + struct.pack('<I', 0) + raw[44:])
open(os.path.join(out, 'sizeff.wav'), 'wb').write(raw[:4] + struct.pack('<I', 0xFFFFFFFF) + raw[8:40] + struct.pack('<I', 0xFFFFFFFF) + raw[44:])
# a three-page score for the checks that play the video
objs = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R 5 0 R 7 0 R] /Count 3 >>']
for i in range(3):
    c = 'BT /F1 48 Tf 100 300 Td (Page %d) Tj ET' % (i + 1)
    objs.append('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 560] /Contents %d 0 R /Resources << /Font << /F1 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> >> >> >>' % (4 + 2 * i))
    objs.append('<< /Length %d >>\nstream\n%s\nendstream' % (len(c), c))
pdf = b'%PDF-1.4\n'; offs = []
for i, o in enumerate(objs): offs.append(len(pdf)); pdf += ('%d 0 obj\n%s\nendobj\n' % (i + 1, o)).encode()
xr = len(pdf); pdf += ('xref\n0 %d\n0000000000 65535 f \n' % (len(objs) + 1)).encode() + b''.join(('%010d 00000 n \n' % o).encode() for o in offs)
pdf += ('trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n' % (len(objs) + 1, xr)).encode()
open(os.path.join(out, 'score.pdf'), 'wb').write(pdf)
print('fixtures written to', out)
# the encrypted PDFs for the locked-PDF check
subprocess.run(['python3', os.path.join(here, 'make-pdf-locked-fixtures.py')], check=True)
