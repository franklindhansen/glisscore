#!/bin/zsh
# Runs every check in turn and prints one line per script, then any FAIL lines. If nothing is serving port 8123, it serves the app itself for the run.
# Run from the project folder:  zsh tests/run-all.sh        (add names or a prefix to run just those:  zsh tests/run-all.sh audio-editor-disk   or   zsh tests/run-all.sh pdf-editor)
cd "$(dirname "$0")/.." || exit 1
export S=tests/fixtures NODE_PATH=$HOME/keyframes-tests/node_modules
if ! curl -s -o /dev/null http://localhost:8123/index.html; then python3 -m http.server 8123 >/dev/null 2>&1 & srv=$!; trap 'kill $srv 2>/dev/null' EXIT; for i in {1..50}; do curl -s -o /dev/null http://localhost:8123/index.html && break; sleep 0.1; done; fi
missing=0
list=(audio-editor-core audio-editor-controls audio-editor-clip audio-editor-seek-click audio-editor-fades audio-editor-export-window audio-editor-export-isolated audio-editor-disk audio-editor-export-disk audio-editor-spec-disk audio-editor-match-disk audio-editor-reference audio-editor-m4a-guard audio-editor-replace-trim audio-editor-load-stop audio-editor-eq-live audio-editor-eq-bands audio-editor-eq-place audio-editor-eq-dynamic audio-editor-eq-curve audio-editor-play-export audio-editor-limit-wave audio-editor-noise-auto audio-editor-hum audio-editor-emulator flac-disk aiff-disk alac-disk ogg-disk surround-m4a-disk mp3-disk video-audio-disk video-mux-disk pdf-editor-crop pdf-editor-clean pdf-editor-view pdf-editor-tool-switch pdf-editor-view-labels pdf-editor-turns pdf-editor-card-shape intro-fits audio-editor-chain-swap audio-editor-bypass stage-and-controls pdf-editor-history pdf-editor-resize pdf-editor-resize-shape loading-widths audio-editor-trim-play audio-editor-trim-stop pdf-editor-watermark-export pdf-editor-status pdf-editor-ticks pdf-editor-reasons pdf-editor-add-pages pdf-editor-locked pdf-editor-every-edit pdf-editor-rekilter-memory pdf-editor-crop-press pdf-editor-import-loading pdf-editor-loading pdf-editor-crop-manual-wait video-fades video-marker-jump video-turn-nudge waits-audio-export waits-audio-editor waits-video-editor waits-greyed)
skip=(audio-editor-layout long-file-fx long-file-store)          # run by hand: they need arguments, a file or Safari
for f in tests/*.js; do n=${f:t:r}; [[ -z "${list[(r)$n]}" ]] && [[ -z "${skip[(r)$n]}" ]] && { print "not in the list: $n"; missing=$((missing + 1)); }; done
if [ -n "$1" ]; then want=(); for a in "$@"; do if [ -f tests/$a.js ]; then want+=($a); else for f in tests/$a*.js; do [ -f $f ] && want+=(${f:t:r}); done; fi; done; list=($want); fi
fails=$missing
for t in $list; do
  out=$(node tests/$t.js 2>&1); code=$?
  p=$(print -r -- "$out" | grep -c '^PASS'); f=$(print -r -- "$out" | grep -c '^FAIL')
  [ $code -ne 0 ] && f=$((f + 1))
  print "$t: $p PASS, $f FAIL"
  if [ $f -gt 0 ]; then fails=$((fails + f)); print -r -- "$out" | grep -v '^PASS' | head -12 | sed 's/^/    /'; fi
done
[ $fails -eq 0 ] && print "all passed" || print "$fails problem(s)"
exit $((fails > 0))
