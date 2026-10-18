#!/bin/zsh
# Runs the checks and prints one line per script (with its time), then any FAIL lines and a summary. Each run serves the app itself on its own free port (so two runs at once never share or stop each other's server) and stops only that server when it ends.
# Run from the project folder:  zsh tests/run-all.sh        (add names or a prefix to run just those:  zsh tests/run-all.sh audio-editor-disk   or   zsh tests/run-all.sh pdf-editor)
#   -j N    how many scripts run at once (default 8; -j 1 runs them one after another). A check that reads the page a set time after an action and fails on a busy machine runs alone, after the rest (the `serial` list below).
#   -o FILE write every PASS and FAIL line, one per line as "script<TAB>line" and sorted, to FILE (diff two of these to prove two runs checked the same things)
cd "$(dirname "$0")/.." || exit 1
zmodload zsh/datetime
J=8 OUTFILE=
while getopts "j:o:" o; do case $o in j) J=$OPTARG ;; o) OUTFILE=$OPTARG ;; *) exit 2 ;; esac; done; shift $((OPTIND - 1))
export S=tests/fixtures NODE_PATH=$HOME/keyframes-tests/node_modules
PORT=$(python3 -c 'import socket; s = socket.socket(); s.bind(("127.0.0.1", 0)); print(s.getsockname()[1])'); export PORT
RES=$(mktemp -d); export RES
# the stock server queues only 5 waiting connections, so several browsers loading the page at once get resets; this one queues 256
python3 -c 'import sys, http.server as h; h.ThreadingHTTPServer.request_queue_size = 256; h.test(HandlerClass=h.SimpleHTTPRequestHandler, ServerClass=h.ThreadingHTTPServer, port=int(sys.argv[1]), bind="127.0.0.1")' $PORT >/dev/null 2>&1 & srv=$!; trap 'kill $srv 2>/dev/null; rm -rf $RES' EXIT
for i in {1..50}; do curl -s -o /dev/null http://localhost:$PORT/index.html && break; sleep 0.1; done
missing=0
list=(audio-editor-core audio-editor-controls audio-editor-clip audio-editor-seek-click audio-editor-fades audio-editor-export-window audio-editor-export-isolated audio-editor-disk audio-editor-export-disk audio-editor-spec-disk audio-editor-match-disk audio-editor-reference audio-editor-eq-presets audio-editor-eq-match-panel audio-editor-m4a-guard audio-editor-replace-trim audio-editor-load-stop audio-editor-eq-live audio-editor-eq-bands audio-editor-eq-place audio-editor-eq-dynamic audio-editor-eq-curve audio-editor-play-export audio-editor-limit-wave audio-editor-noise-auto audio-editor-hum audio-editor-hum-none audio-editor-state-line-gone audio-editor-tool-ring how-it-works-fixed-height audio-editor-emulator flac-disk aiff-disk alac-disk ogg-disk surround-m4a-disk mp3-disk video-audio-disk video-mux-disk pdf-editor-crop pdf-editor-clean pdf-editor-view pdf-editor-tool-switch pdf-editor-turn-motion pdf-editor-view-labels pdf-editor-turns pdf-editor-card-shape pdf-editor-drop-motion intro-fits audio-editor-chain-swap audio-editor-bypass stage-and-controls pdf-editor-history pdf-editor-resize pdf-editor-resize-shape pdf-editor-blank-pages loading-widths audio-editor-trim-play audio-editor-trim-stop pdf-editor-watermark-export pdf-editor-status pdf-editor-ticks pdf-editor-reasons pdf-editor-large-scan pdf-editor-add-pages pdf-editor-locked pdf-editor-every-edit pdf-editor-rekilter-memory pdf-editor-crop-press pdf-editor-import-loading pdf-editor-loading pdf-editor-crop-manual-wait video-fades slider-reset video-marker-jump video-single-page video-turn-wording video-single-turn video-history-settings video-turn-nudge video-turn-select video-turns-to-end video-turns-glide video-tags-over-playhead timeline-bar-groups timeline-fit-brackets page-window-size keys-dialog about-version dialog-fade-out menu-fade-out color-custom-fold export-dialog-folds font-list-fade site-pages seg-shape audio-editor-fullscreen-motion pdf-editor-one-motion pdf-editor-motion-audit audio-editor-swap-and-state waits-audio-export waits-audio-editor waits-video-editor waits-greyed)
skip=(audio-editor-layout long-file-fx long-file-store make-large-scan)          # run by hand: they need arguments, a file or Safari          # run by hand: they need arguments, a file or Safari
# this one reads the page a set time after an action and fails when the machine is busy, so it runs alone after the rest (add any check that does this)
serial=('*tool-ring')
for f in tests/*.js; do n=${f:t:r}; [[ -z "${list[(r)$n]}" ]] && [[ -z "${skip[(r)$n]}" ]] && { print "not in the list: $n"; missing=$((missing + 1)); }; done
if [ -n "$1" ]; then want=(); for a in "$@"; do if [ -f tests/$a.js ]; then want+=($a); else for f in tests/$a*.js; do [ -f $f ] && want+=(${f:t:r}); done; fi; done; list=($want); fi
# one script: its output goes to $RES/NAME.out, its seconds to $RES/NAME.sec, and one block (line, then any non-PASS lines) is printed in one piece
cat > $RES/one.sh <<'EOS'
zmodload zsh/datetime
t0=$EPOCHREALTIME
out=$(node tests/$1.js 2>&1); code=$?
p=$(print -r -- "$out" | grep -c '^PASS'); f=$(print -r -- "$out" | grep -c '^FAIL')
[ $code -ne 0 ] && f=$((f + 1))
sec=$(printf '%.1f' $((EPOCHREALTIME - t0)))
print -r -- "$out" > $RES/$1.out; print $sec > $RES/$1.sec; print $f > $RES/$1.fail
blk="$1: $p PASS, $f FAIL (${sec}s)"
[ $f -gt 0 ] && blk="$blk"$'\n'"$(print -r -- "$out" | grep -v '^PASS' | head -12 | sed 's/^/    /')"
print -r -- "$blk"
EOS
par=() ser=()
for t in $list; do if [[ $t == (${~${(j:|:)serial}}) ]]; then ser+=($t); else par+=($t); fi; done
t_all=$EPOCHREALTIME
(( ${#par} )) && print -l $par | xargs -P $J -n1 zsh $RES/one.sh
for t in $ser; do zsh $RES/one.sh $t; done
fails=$missing
for t in $list; do fails=$((fails + $(<$RES/$t.fail))); done
if [ -n "$OUTFILE" ]; then for t in $list; do grep -E '^(PASS|FAIL)' $RES/$t.out | sed "s/^/$t\t/"; done | sort > "$OUTFILE"; fi
print "slowest:"; for t in $list; do print "$(<$RES/$t.sec) $t"; done | sort -rn | head -5 | sed 's/^/    /'
print "total $(printf '%.0f' $((EPOCHREALTIME - t_all)))s with -j $J"
[ $fails -eq 0 ] && print "all passed" || print "$fails problem(s)"
exit $((fails > 0))
