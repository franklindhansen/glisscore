# *glisscore™*

Create score videos from a PDF and a recording.

**Official site:** [glisscore.com](https://glisscore.com) · **Official repository:** [github.com/franklindhansen/glisscore](https://github.com/franklindhansen/glisscore)

Everything runs in your browser. Your files never leave your device.

## Features

- **Video editor.** Set when each page turns, add credits, fade in and out, and export the video.
- **PDF Editor.** Arrange, rotate, crop, clean, re-kilter and re-size pages.
- **Audio Editor.** Noise reduction, spectrogram, EQ, imager, level and limiter.

## Run it yourself

There is nothing to build. Serve the folder and open it in a current browser:

    python3 -m http.server 8123

Then open <http://localhost:8123>.

The checks in `tests/` need Playwright; `tests/README.md` has the setup.

## Feedback

Bug reports and ideas are welcome as [issues](https://github.com/franklindhansen/glisscore/issues). Code changes aren't being accepted yet.

## Support

*glisscore* is free and open source. If it's useful to you, you can help cover hosting and upkeep at [glisscore.com/support](https://glisscore.com/support).

## License

Copyright © 2026 Franklin Hansen.

The source code is licensed under the [GNU Affero General Public License, version 3 only](LICENSE). If you run a modified version as a public service, the AGPL requires you to offer your users the source of your changes.

The name *glisscore*, its logo, wordmark and icons, the glisscore.com domain and the "official" designation are **not** covered by that license. See [TRADEMARKS.md](TRADEMARKS.md) for what you may and may not do with them, including how to name a fork.

## Third-party software

*glisscore* bundles PDF.js, pdf-lib, the Instrument Sans and Newsreader fonts, and Lucide icons, each under its own license. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
