# *glisscore*

Create score videos from a PDF and a recording.

**Site:** [glisscore.com](https://glisscore.com) · **Source:** [github.com/franklindhansen/glisscore](https://github.com/franklindhansen/glisscore)

Everything runs in your browser. Your files never leave your device.

## Features

- **Video editor.** Set each page turn, display your score as spreads, single pages, or systems, add credits, fade in and out, and export video.
- **PDF Editor.** Arrange, clean, re-kilter, crop, dim repeats, split spreads, re-size, and watermark pages. No acrobatics required.
- **Audio Editor.** Reduce noise, heal blips, add EQ, adjust stereo width, level, and export audio.

## Feedback

Bug reports and ideas are welcome as [issues](https://github.com/franklindhansen/glisscore/issues). Code changes aren't being accepted yet.

## Support

*glisscore™* was made by composer, conductor, and grad student (who should probably be writing music), [Franklin D. Hansen](https://franklindhansen.com/). It's free and open source. If it's useful to you and you'd like to help cover hosting and upkeep, you can [buy me a coffee on Ko-fi](https://ko-fi.com/franklindhansen). There's no pressure: supporting unlocks nothing, and the app is the same for everyone.

## Development

There is nothing to build. Serve the folder and open it in a current browser:

    python3 -m http.server 8123

Then open <http://localhost:8123>.

The checks in `tests/` need Playwright; `tests/README.md` has the setup.

## License

Copyright © 2026 Franklin Hansen.

The source code is licensed under the [GNU Affero General Public License, version 3 only](LICENSE). If you run a modified version as a public service, the AGPL requires you to offer your users the source of your changes.

The name *glisscore*, its logo, wordmark, and icons, the glisscore.com domain and the "official" designation are **not** covered by that license. See [TRADEMARKS.md](TRADEMARKS.md) for what you may and may not do with them, including how to name a fork.

## Third-party software

*glisscore* bundles PDF.js, pdf-lib, the Hanken Grotesk, Newsreader, and Instrument Sans fonts, and Lucide icons, each under its own license. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
