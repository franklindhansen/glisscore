Accuracy checks (not part of run-all). Each needs the app on port 8123 and ffmpeg; run with
NODE_PATH=$HOME/keyframes-tests/node_modules node tests/accuracy/<name>.js <work folder> [1|0 for the disk store]
The work folder must hold the test sounds the script opens (mix.wav, mixloud.wav, t1k.wav, t100.wav, st.wav, s15k.wav, s21k.wav, b60.wav, imd.wav) and an o/ folder for outputs. Make them with ffmpeg lavfi sine and noise sources. settings-roundtrip.js and noise-reduction.js need no files.
limiter-direct.js, noise-direct.js and eq-direct.js need neither the app nor any files: node tests/accuracy/limiter-direct.js
noise-floor.js (the noise tool's Auto against noise that was really put in), noise-hits.js (Natural on sharp high hits; prints readings), hum-direct.js (the hum finder and its notches) and eq-dynamic-clean.js (what a dynamic band adds, steady and while its gain moves) also need neither the app nor any files.
