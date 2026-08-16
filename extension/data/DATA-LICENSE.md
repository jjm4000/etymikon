# Dictionary data license and attribution

The JSON files in this directory (`hanja.json`, `words.json`, `variants.json`)
are a derived database compiled from the following sources by
`pipeline/build.py`:

- **English Wiktionary** (https://en.wiktionary.org), via the machine-readable
  extracts published by **kaikki.org** (https://kaikki.org), themselves
  produced by the wiktextract project. Wiktionary text is dual-licensed under
  the **Creative Commons Attribution-ShareAlike License (CC BY-SA)** and the
  GNU Free Documentation License.
- **The Unicode Unihan Database** (https://www.unicode.org/charts/unihan.html),
  used under the Unicode License (https://www.unicode.org/license.txt) for
  variant mappings, supplementary definitions, and readings.
- **hermitdave/FrequencyWords** (MIT License, © 2016 Hermit Dave), derived from
  the OPUS OpenSubtitles 2018 corpus — used only as a build-time frequency
  signal; no data from it is included in these files.

Accordingly, the derived dictionary data in this directory is distributed
under **CC BY-SA 4.0** (https://creativecommons.org/licenses/by-sa/4.0/).
This is separate from the license of the extension's source code (GPL-3.0;
see /LICENSE at the repository root).

Per-entry attribution: every entry links back to its source page on
en.wiktionary.org via the popup's "Wiktionary" link.
