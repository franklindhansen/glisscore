# Audio Editor checks

These run the Audio Editor in Chromium with Playwright. They check values, labels, layout (grid placement, widths, two columns, no page scroll) and the phone layout.

Setup, once (outside the project, so no package files are added to it):

    mkdir -p ~/keyframes-tests && cd ~/keyframes-tests && npm init -y && npm i playwright-core@1.47.2 && npx playwright-core install chromium
    python3 tests/make-fixtures.py

Run, with the app served on port 8123 (for example `python3 -m http.server 8123` from the project folder):

    S=tests/fixtures NODE_PATH=~/keyframes-tests/node_modules node tests/audio-editor-core.js
    S=tests/fixtures NODE_PATH=~/keyframes-tests/node_modules node tests/audio-editor-controls.js
    S=tests/fixtures NODE_PATH=~/keyframes-tests/node_modules node tests/audio-editor-layout.js 700 900 w700

Every check prints PASS or FAIL. The layout script also writes screenshots: look at them, because the numbers do not catch everything.

## PDF Editor checks

`tests/pdf-editor-*.js` run the PDF Editor in Chromium, with the app served on port 8123:

    NODE_PATH=~/keyframes-tests/node_modules node tests/pdf-editor-locked.js

Most make their own PDFs, with `require('../vendor/pdf-lib.min.js')`; a new check also goes in the `list` in `run-all.sh`. `pdf-editor-locked.js` needs fixtures first: `python3 tests/make-fixtures.py` (it writes `score.pdf` and runs `tests/make-pdf-locked-fixtures.py` for the encrypted PDFs; no `qpdf` or `pypdf` is installed, so the script writes them by hand).

Pixel checks on the page grid and the large view: Crop dims everything outside its frame, so sample inside the frame; a leveled page leaves white corners, so sample away from them. To read a short-lived state such as the dim, hold the work with a stub (`pdfCleanCanvas` that sleeps) and read it while it waits. `pdf-editor-every-edit.js` has examples.

`zsh tests/run-all.sh pdf-editor` runs just the PDF Editor checks; it also names any check missing from the list.

Run a check once and read its PASS and FAIL lines together. A full run takes minutes: start it in the background. Never pipe it through `tail` or `head`: they hold back every line until the run ends. `run-all.sh` prints each check's line as it finishes, and it serves the app itself on its own free port (the `PORT` variable, which the checks read; 8123 when it is not set) and stops only that server when it ends, so never start one by hand and runs at the same time do not disturb each other.

## Run everything

    zsh tests/run-all.sh

Runs every check below, eight at a time (`-j N` sets how many; `-j 1` runs them one after another), and prints one line each with its time, any FAIL lines, the five slowest scripts and the total (about 3.5 minutes). It serves the app itself. A check that reads the page a set time after an action and fails when the machine is busy goes in the `serial` list in `run-all.sh`, which runs it alone after the rest (today only `tool-ring`). `-o FILE` writes every PASS and FAIL line, sorted, to FILE; diff two of them to show two runs checked the same things.

Test tones that peak above 0dB (`Test tone +3.3dB.mp3` and `.m4a`) go in the same local folder.

## Disk store check

`long-file-store.html` reads a WAV or M4A into the disk store the app will use for long recordings (`audio-store-worker.js`), reads it back, checks the waveform peaks and the peak pyramid against the samples, and compares the result with today's import sample for sample. It runs the app in a hidden frame, so it tests the app's own code.

In Chromium, with the app served on port 8123:

    S=tests/fixtures NODE_PATH=$HOME/keyframes-tests/node_modules node tests/long-file-store.js

This covers every kind of WAV (8, 16, 24 and 32-bit, 32 and 64-bit float, mono, surround, RF64, a data size of 0 or 0xFFFFFFFF) with small pieces, so reads cross many piece edges. Chromium scales 8 and 16-bit samples its own way, so those compare to within one step. This Chromium has no AAC, so the M4A decoder is stood in for there.

In Safari, for M4A and for real long recordings: open http://localhost:8123/tests/long-file-store.html, choose a file, then press Copy results. Files over 20 minutes skip the comparison with today's import, which would hold the whole recording in memory. Delete frees the disk space.

The Playback joins row plays ~35s from a random place into a silent render through the same player Play uses (the player in `index.html`) and compares it with the stored samples. Play and the slider are for listening.

## Tools on the disk store

`audio-fx.js` works out noise reduction, Spectra, EQ and Imager for any stretch of a stored recording, in the disk store's worker. `long-file-fx.js` makes a recording, loads it the usual way and into the store, and checks the result two ways for a set of tool settings:

    S=tests/fixtures NODE_PATH=$HOME/keyframes-tests/node_modules node tests/long-file-fx.js

Against today's whole-file result: noise reduction and Spectra must give every sample the same. EQ and Imager come within a stated distance (−80dB with the hardest EQ bands, −110dB for the Imager): today's are the browser's own filters, which round their memory as they go, and these keep full precision. Against itself: read in order in uneven blocks, and at far-off places from the start and then from checkpoints, every sample must be the same as one pass over the whole recording.

Level, fades, the limiter, the loudness measurement and the waveform heights (highest sample and true peak of every 10ms) also run on the store. The script sets them against the app's own whole-file code run on the very same processed sound, so every number and every final sample must be the same. One exception: when the limiter only has work in places, the volume for a loudness target is found by running the limiter over those stretches alone; that must land within 0.01 LU of the app's whole run.

`long-file-store.html` runs the same on the chosen file (rows starting with Tools or Loudness, and the two rows ending "against today's"), so it can be tried on real recordings in Safari. The comparison with today's EQ and Imager only means something where the row Browser's silent render says untouched.

Playback can run through the tools too (`DISK.play` with `fx`), and a change of setting while it plays takes over after a quarter of a second with a short ease (`refresh`). The script checks both in a silent render. On the check page, tick Play through the tools, press Play, and press Change the EQ to listen for it.

## The app on the disk store (switch, off by default)

The Audio Editor and the video player can keep a WAV (or a stereo AAC M4A) on the disk store instead of in memory. It is off unless asked for: open the app with `?disk=1` to turn it on (the browser remembers), `?disk=0` to turn it off. Every other kind of file, and every browser without the store, loads as before.

    S=tests/fixtures NODE_PATH=$HOME/keyframes-tests/node_modules node tests/audio-editor-disk.js

Run `python3 tests/make-fixtures.py` first (it also writes `score.pdf`, a three-page score for the video player). The check loads the same 24-bit WAV both ways and compares: the waveform peaks, the editor's picture, the level numbers (peak, loudness, loudness through the limiter), the waveform with an EQ band and with noise reduction, noise learned from a stretch, and the stereo picture. It plays in the editor (a change of settings and Bypass while it plays), plays the video, jumps, starts before the audio, and checks that what is not on the store yet (EQ match) says so instead of failing. Chromium scales 16-bit samples its own way, so a 16-bit file is not used for the exact comparisons.

Everything the editor and the video export do now works on the store; `diskNot` is no longer used.

## Audio export from the store

WAV (16, 24 and 32-bit; RF64 over 4GB), FLAC and M4A export read the final samples from the store a stretch at a time (`aeMasterDisk`; the worker does the sample-rate conversion, fades, volume and limiter). WAV and FLAC are written into the store's folder and handed to the page as a file on disk, so a long recording never sits in memory; M4A is small enough to be built in memory as before.

    S=tests/fixtures NODE_PATH=$HOME/keyframes-tests/node_modules node tests/audio-editor-export-disk.js

Each file from the store must be byte for byte the file memory gives (WAV 16, 24 and 32-bit, trimmed, peak and loudness targets, with the limiter, at 44.1kHz and 96kHz, FLAC); 16-bit files carry random dither, so those are compared within 2 steps. With an EQ band the samples are within the filters' own rounding. The RF64 header is checked from `wavHead`. M4A is not covered (headless Chromium has no AAC encoder): try it in Safari.

## Video export from the store

With a long recording the video export reads the sound from the store (lossless 24-bit) and writes the MP4 or MOV straight into the store's folder as it is made (`Mp4Writer` with a sink: the media data first, the table of where everything is after it, 64-bit places over 4GB), then saves it from there. It needs the fast export (WebCodecs with an H.264 or HEVC encoder); real-time recording needs the whole sound in memory and is not offered for a stored recording.

    S=tests/fixtures NODE_PATH=$HOME/keyframes-tests/node_modules node tests/video-audio-disk.js
    S=tests/fixtures NODE_PATH=$HOME/keyframes-tests/node_modules node tests/video-mux-disk.js

The first sets the video's sound from the store against memory (every sample). The second cuts a small H.264 clip with ffmpeg (must be installed) and checks that the file written into the store has the same streams, picture and sound as the one built in memory, including 64-bit places. The Chromium that Playwright installs has no H.264 encoder, so a whole video export can only be tried in Safari or Chrome.

## Spectrogram from the store

For a stored recording the Spec view is made for the stretch on screen (1200 columns across it, each the average of up to four slices), in the store's worker, after noise reduction and Spectra's rectangles. It is made again when you zoom or move, or when those change; the picture that was there stays, stretched, until the new one is in.

    S=tests/fixtures NODE_PATH=$HOME/keyframes-tests/node_modules node tests/audio-editor-spec-disk.js

Set against memory: with the slices placed the same way, every decibel is the same. Also checks the picture is painted, that zooming and a Spectra rectangle each make a new one.

## EQ match, Match gain on Bypass, Noise only from the store

EQ match reads its slices from the store (`avgCurveDisk`, at most about 400), Match gain on Bypass is measured in the worker (`rmsScan`, with a chain of its own so playback is not disturbed), and Noise only is a recipe flag (`listen`) that makes the chain give what the noise stage took away.

    S=tests/fixtures NODE_PATH=$HOME/keyframes-tests/node_modules node tests/audio-editor-match-disk.js

Against memory: your own average curve, the bands EQ match fits, and the Bypass gain are the same. The Noise only samples are checked in audio-editor-disk.js.

## FLAC and MP3 into the store

FLAC is decoded by our own decoder inside the store's worker (`importFlac`, written from the published format; every frame is checked against its two checksums; more than two channels or any damage gives null and the page decodes it as before). MP3 is cut into frames here and decoded by the browser's own WebCodecs decoder a piece at a time (`DISK.importMp3`); the encoder padding is trimmed from the LAME/Xing header, and a file with none is left whole, as the one-shot decoder leaves it. Without a decoder for MP3 in the browser the file loads in memory as before.

    NODE_PATH=$HOME/keyframes-tests/node_modules node tests/flac-disk.js
    NODE_PATH=$HOME/keyframes-tests/node_modules node tests/mp3-disk.js

Both need ffmpeg. The FLAC check encodes 15 kinds of file (16 and 24-bit, mono and stereo, every channel mode, block sizes from 192 to 4608, silence, 8 to 96kHz) and every sample must be the one ffmpeg decodes. The MP3 check compares rate, channels, length and samples with the browser's one-shot decoder for six kinds of file, plus a tag after the last frame and a file cut short.
