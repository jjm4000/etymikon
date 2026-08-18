# Dictionary data license and attribution

The JSON files in this directory (`hanja.json`, `words.json`, `variants.json`,
`rr.json`) are a derived database compiled from the following sources by
`pipeline/build.py`:

- **English Wiktionary** (https://en.wiktionary.org), via the machine-readable
  extracts published by **kaikki.org** (https://kaikki.org), themselves
  produced by the wiktextract project. Wiktionary text is dual-licensed under
  the **Creative Commons Attribution-ShareAlike License (CC BY-SA)** and the
  GNU Free Documentation License.
- **The Unicode Unihan Database** (https://www.unicode.org/charts/unihan.html),
  used under the Unicode License (https://www.unicode.org/license.txt) for
  variant mappings, supplementary definitions, and readings.
- **Korean Wikipedia**, article 「대한민국 중고등학교 기초한자 목록」
  (https://ko.wikipedia.org/wiki/대한민국_중고등학교_기초한자_목록), used under
  the **Creative Commons Attribution-ShareAlike 4.0 International License**
  (https://creativecommons.org/licenses/by-sa/4.0/) for the middle-school /
  high-school tier (`eduT`) of the Ministry of Education basic-education hanja
  list. (The underlying 교육부 고시 list is itself excluded from copyright by
  저작권법 제7조.)
- **hermitdave/FrequencyWords** (MIT License, © 2016 Hermit Dave), derived from
  the OPUS OpenSubtitles 2018 corpus — used only as a build-time frequency
  signal: it decides the `rare` flag and the coarse `f` frequency bucket
  (a 0-9 log-scaled rank band), and no word, count or rank from it is copied
  into these files.

`rr.json` adds no source of its own: it is a mechanical Revised Romanization
transform of hangul already present in the files above, so it carries the same
attribution and licence as the rest of this directory.

Accordingly, the derived dictionary data in this directory is distributed
under **CC BY-SA 4.0** (https://creativecommons.org/licenses/by-sa/4.0/).
This is separate from the license of the extension's source code (GPL-3.0;
see /LICENSE at the repository root).

Per-entry attribution: every entry links back to its source page on
en.wiktionary.org via the popup's "Wiktionary" link.
