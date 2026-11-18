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
# serve.py sends the headers in _headers (the Content-Security-Policy) and logs any violation the browser reports to $RES/csp.log
export CSP_LOG=$RES/csp.log
python3 tests/serve.py $PORT >/dev/null 2>&1 & srv=$!; trap 'kill $srv 2>/dev/null; rm -rf $RES' EXIT
for i in {1..50}; do curl -s -o /dev/null http://localhost:$PORT/index.html && break; sleep 0.1; done
missing=0
list=(intro-hover csp-policy no-scroll-flash phone-layout layout-sweep audio-editor-grid-lines audio-editor-approved audio-editor-tool-list audio-editor-measure audio-editor-stylesheet style-tokens video-timeline-pinch video-system-turns video-system-placed-turns video-view-glide video-system-short-window video-system-selector-turn video-system-layout video-system-canvas video-system-marks video-system-edits video-system-progress video-system-sheet video-system-letterbox video-system-credits video-system-timeline system-detect system-detect-dense system-detect-source system-detect-real sweep-bars scrollbar-thin video-thumb-peek video-credits-font-wait split-order ui-buttons control-pixels text-spacing audio-editor-core audio-editor-controls audio-editor-clip audio-editor-seek-click audio-editor-fades audio-editor-export-window audio-editor-export-isolated audio-editor-disk audio-editor-export-disk audio-editor-spec-disk audio-editor-match-disk audio-editor-reference audio-editor-eq-presets audio-editor-eq-match-panel audio-editor-eq-match-steady audio-editor-layout audio-editor-theme audio-editor-edge-space pdf-editor-fit pdf-editor-grid-lines video-fullscreen-motion press-and-drop-motion video-stage-zoom audio-editor-m4a-guard audio-editor-m4a-length audio-editor-spec-tones audio-editor-replace-trim audio-editor-load-stop audio-editor-eq-live audio-editor-eq-bands audio-editor-eq-place audio-editor-eq-dynamic audio-editor-eq-curve audio-editor-play-export audio-editor-limit-wave audio-editor-level-numbers audio-editor-noise-auto audio-editor-noise-graph audio-editor-noise-busy audio-editor-hum audio-editor-hum-none audio-editor-state-line-gone audio-editor-new-file audio-editor-first-open slider-steady audio-editor-tool-ring how-it-works-fixed-height audio-editor-emulator flac-disk aiff-disk alac-disk ogg-disk surround-m4a-disk mp3-disk video-audio-disk video-mux-disk pdf-editor-crop pdf-editor-clean pdf-editor-view pdf-editor-tool-switch pdf-editor-turn-motion pdf-editor-view-labels pdf-editor-turns pdf-editor-card-shape pdf-editor-drop-motion intro-fits audio-editor-chain-swap audio-editor-bypass stage-and-controls pdf-editor-history pdf-editor-resize pdf-editor-resize-shape pdf-editor-blank-pages loading-widths audio-editor-trim-play audio-editor-trim-stop pdf-editor-watermark-export pdf-editor-dim pdf-editor-status pdf-editor-ticks pdf-editor-page-range pdf-editor-widths pdf-editor-reasons pdf-editor-large-scan pdf-editor-add-pages pdf-editor-locked pdf-editor-every-edit pdf-editor-rekilter-memory pdf-editor-crop-press pdf-editor-import-loading pdf-editor-loading pdf-editor-crop-manual-wait pdf-editor-crop-start keys-own-controls shared-format-zoom video-fades-render video-fades-preview-rules video-export-last-frame video-shadows-off video-audio-fades-apart timeline-drag-layouts pdf-editor-zoom-cost pdf-editor-number-chip pdf-editor-swap-motion pdf-editor-edge-margin file-chips video-fades video-widths video-panel-lines video-page-not-ready video-credits-at video-credits-fonts start-over-warning video-timeline-loudness video-thumbnail slider-reset video-marker-jump video-single-page video-transport-steady timeline-resize-flash timeline-resize-cost video-turn-wording video-single-turn video-history-settings video-turn-nudge video-playhead-grab video-turn-select video-turns-to-end video-turns-glide video-tags-over-playhead timeline-bar-groups timeline-fit-brackets timeline-bracket-release-glide timeline-bracket-drag ruler-labels page-window-size keys-dialog about-version site-icons dialog-fade-out menu-fade-out video-color-select video-panel-shadows pdf-editor-cards start-phone export-dialog-folds font-list-fade site-pages seg-shape seg-custom audio-editor-fullscreen-motion pdf-editor-one-motion pdf-editor-motion-audit audio-editor-swap-and-state waits-audio-export waits-audio-editor waits-video-editor waits-greyed glass-switch)
skip=(probe sweep-capture long-file-fx long-file-store make-large-scan csp-walkthrough)          # run by hand: they need arguments, a file or Safari          # run by hand: they need arguments, a file or Safari
# this one reads the page a set time after an action and fails when the machine is busy, so it runs alone after the rest (add any check that does this)
serial=('*tool-ring' menu-fade-out audio-editor-play-export timeline-fit-brackets pdf-editor-tool-switch pdf-editor-swap-motion)
for f in tests/*.js; do n=${f:t:r}; [[ -z "${list[(r)$n]}" ]] && [[ -z "${skip[(r)$n]}" ]] && { print "not in the list: $n"; missing=$((missing + 1)); }; done
if [ -n "$1" ]; then want=(); for a in "$@"; do if [ -f tests/$a.js ]; then want+=($a); else for f in tests/$a*.js; do [ -f $f ] && want+=(${f:t:r}); done; fi; done; list=($want); fi
# one script: its output goes to $RES/NAME.out, its seconds to $RES/NAME.sec, and one block (line, then any non-PASS lines) is printed in one piece
cat > $RES/one.sh <<'EOS'
zmodload zsh/datetime
t0=$EPOCHREALTIME
out=$(nice -n 10 node tests/$1.js 2>&1); code=$?          # the checks (and their browsers) run at a lower priority than the server, so it always has time to accept the browsers' first connections when many start at once
p=$(print -r -- "$out" | grep -c '^PASS'); f=$(print -r -- "$out" | grep -c '^FAIL')
[ $code -ne 0 ] && f=$((f + 1))
sec=$(printf '%.1f' $((EPOCHREALTIME - t0)))
print -r -- "$out" > $RES/$1.out; print $sec > $RES/$1.sec; print $f > $RES/$1.fail
# a check that only ran out of time (a browser wait of 60 or 90 seconds expired on a busy machine: every FAIL line, if any, says so) is not a wrong result: it is run again, alone, once the busy part of the run is over. A wrong value or a check that fails twice is reported as a failure.
if [ $f -gt 0 ] && [ "$2" != retry ] && print -r -- "$out" | grep -q 'Timeout [0-9]*ms exceeded' && ! print -r -- "$out" | grep '^FAIL' | grep -qv 'Timeout [0-9]*ms exceeded'; then
  print $1 >> $RES/retry; print $f > $RES/$1.fail; print -r -- "$1: timed out on a busy machine, will run again (${sec}s)"; exit 0
fi
blk="$1: $p PASS, $f FAIL (${sec}s)"; [ "$2" = retry ] && blk="$blk, run again after a timeout"
[ $f -gt 0 ] && blk="$blk"$'\n'"$(print -r -- "$out" | grep -v '^PASS' | head -12 | sed 's/^/    /')"
print -r -- "$blk"
EOS
par=() ser=()
for t in $list; do if [[ $t == (${~${(j:|:)serial}}) ]]; then ser+=($t); else par+=($t); fi; done
t_all=$EPOCHREALTIME
(( ${#par} )) && print -l $par | xargs -P $J -n1 zsh $RES/one.sh
for t in $ser; do zsh $RES/one.sh $t; done
[ -s $RES/retry ] && for t in $(<$RES/retry); do zsh $RES/one.sh $t retry; done
fails=$missing
for t in $list; do fails=$((fails + $(<$RES/$t.fail))); done
if [ -n "$OUTFILE" ]; then for t in $list; do grep -E '^(PASS|FAIL)' $RES/$t.out | sed "s/^/$t\t/"; done | sort > "$OUTFILE"; fi
grep -v 'upload-test.invalid' $CSP_LOG > $CSP_LOG.real 2>/dev/null     # csp-policy.js posts there on purpose, to see the browser refuse
if [ -s $CSP_LOG.real ]; then print "Content-Security-Policy violations the browser reported:"; sort $CSP_LOG.real | uniq -c | cut -c1-300 | sed 's/^/    /'; fails=$((fails + 1)); fi
print "slowest:"; for t in $list; do print "$(<$RES/$t.sec) $t"; done | sort -rn | head -5 | sed 's/^/    /'
print "total $(printf '%.0f' $((EPOCHREALTIME - t_all)))s with -j $J"
[ $fails -eq 0 ] && print "all passed" || print "$fails problem(s)"
exit $((fails > 0))
