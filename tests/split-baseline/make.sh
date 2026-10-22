#!/bin/zsh
# Rebuilds tests/split-baseline/app-script.js: the app's inline script exactly as index.html held it before the split
# (the lines between the app's <script> tag, the one after audio-fx.js, and its </script>). Removed when the split is accepted.
cd "${0:A:h}/../.." || exit 1
COMMIT=6294c99
git show $COMMIT:index.html | awk '/^<script src="audio-fx.js"><\/script>$/ {f=1; next} f && /^<script>$/ {g=1; next} g && /^<\/script>$/ {exit} g {print}' > tests/split-baseline/app-script.js
echo "Wrote tests/split-baseline/app-script.js ($(wc -l < tests/split-baseline/app-script.js) lines)"
