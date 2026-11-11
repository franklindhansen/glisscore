#!/usr/bin/env python3
"""Search the code and print a window of characters around each match.

Some lines here are thousands of characters long, so a plain search prints too much or nothing useful.

    python3 tests/find.py 'aeGainBig' js/audio-editor.js
    python3 tests/find.py -b 100 -a 300 'lv-sum' style.css index.html

PATTERN is a regular expression. With no files it searches js/*.js, style.css, and index.html.
-b and -a set the characters shown before and after a match (150 and 350); -m sets the most matches printed (40).
"""
import argparse
import glob
import os
import re

os.chdir(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
ap.add_argument('pattern')
ap.add_argument('files', nargs='*')
ap.add_argument('-b', type=int, default=150)
ap.add_argument('-a', type=int, default=350)
ap.add_argument('-m', type=int, default=40)
args = ap.parse_args()
files = args.files or sorted(glob.glob('js/*.js')) + ['style.css', 'index.html']
rx, shown = re.compile(args.pattern), 0
for name in files:
    with open(name, encoding='utf8') as fh:
        for no, line in enumerate(fh, 1):
            for m in rx.finditer(line):
                if shown >= args.m:
                    raise SystemExit('stopped at %d matches (-m for more)' % args.m)
                shown += 1
                start, end = max(0, m.start() - args.b), min(len(line), m.end() + args.a)
                print('%s:%d:%d  %s%s%s\n' % (name, no, m.start() + 1, '…' if start else '', line[start:end].strip(), '…' if end < len(line.rstrip('\n')) else ''))
if not shown:
    print('no match')
