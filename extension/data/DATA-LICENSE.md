# Dictionary data license and attribution

The JSON files in this directory (`words.json`, `roots.json`, `forms.json`)
are a derived database compiled from the following sources by
`pipeline/build.py`:

- **English Wiktionary** (https://en.wiktionary.org), via the machine-readable
  extracts published by **kaikki.org** (https://kaikki.org), themselves
  produced by the wiktextract project. Source of every definition, every
  morpheme breakdown, and every inflected form in `forms.json`. Wiktionary
  text is dual-licensed under the **Creative Commons Attribution-ShareAlike
  License (CC BY-SA)** and the GNU Free Documentation License.
- **Latin Wiktionary entries** and **Ancient Greek Wiktionary entries**, from
  the same kaikki.org extracts and under the same CC BY-SA license. Source of
  the root-card glosses and headword forms for `la:` and `grc:` keys in
  `roots.json`, and of the one decomposition step that lands a word family on
  its base lemma.
- **hermitdave/FrequencyWords** (MIT License, © 2016 Hermit Dave), derived
  from the OPUS OpenSubtitles 2018 corpus. Source of the `fr` rank on each
  word, which decides the dictionary cap and the tier chip shown at runtime.
  No definition or wording from that project is copied into these files.

Accordingly, the derived dictionary data in this directory is distributed
under **CC BY-SA 4.0** (https://creativecommons.org/licenses/by-sa/4.0/).
This is separate from the license of the extension's source code (GPL-3.0;
see /LICENSE at the repository root).

Per-entry attribution: every entry links back to its source page on
en.wiktionary.org via the popup's "Wiktionary" link.
