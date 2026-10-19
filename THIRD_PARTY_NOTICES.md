# Third-party notices

This app includes the following open-source components. Each is used under its own license, and the full license text sits next to the files in the `vendor/` folder.

| Component | Where | License | Text |
| --- | --- | --- | --- |
| PDF.js 3.11.174 (Mozilla) | `vendor/pdf.min.js`, `vendor/pdf.worker.min.js`, `vendor/pdf.worker.src.js` | Apache License 2.0 | `vendor/LICENSE-pdfjs.txt` |
| pdf-lib 1.17.1 (Andrew Dillon) | `vendor/pdf-lib.min.js` | MIT. The bundle also contains tslib helpers (Microsoft, Apache License 2.0; the notice is at the top of the file) and the pako compression library (MIT and zlib) | `vendor/LICENSE-pdflib.txt` |
| Instrument Sans (The Instrument Sans Project Authors) | `vendor/fonts/` | SIL Open Font License 1.1 | `vendor/OFL-instrument-sans.txt` |
| Newsreader (The Newsreader Project Authors) | `vendor/fonts/` | SIL Open Font License 1.1 | `vendor/OFL-newsreader.txt` |
| Lucide icons (some icons are drawn inline) | `index.html` | ISC (some parts MIT) | `vendor/LICENSE-lucide.txt` |

The Apple Lossless (ALAC) decoder in `audio-store-worker.js` is our own JavaScript, but it follows the bitstream that Apple documented by releasing its reference decoder under the Apache License 2.0 (https://github.com/macosforge/alac). Apple's Apache 2.0 license is compatible with MIT; the decoder was checked sample for sample against ffmpeg.

Everything else (audio processing, loudness measuring, the FLAC and MP4/MOV writers, the limiter, and the resampler) is written for this project from public format descriptions and standards.
