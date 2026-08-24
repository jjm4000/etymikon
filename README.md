# Etymikon

Chrome extension (Manifest V3). Select an English word on any page and a
popup card shows its definitions and its morpheme breakdown
(subterranean = sub- + terra + -an). Each morpheme opens a root card:
the root's form, source, gloss, and the English words built on it. A
sidebar adds typed search, saved words with folders, and Anki export.
The whole dictionary ships inside the extension. Offline, no network
requests, no tracking.

The name is Greek: etymos ("true sense") + -ikon, the formation behind
lexicon. The Byzantine etymological dictionaries were titled
Etymologikon.

## Layout

- `SPEC.md`: the binding spec. Behavior is pinned there before it is
  built.
- `extension/`: the unpacked extension (load via chrome://extensions,
  Developer mode, "Load unpacked").
- `pipeline/`: build-time data pipeline. `python pipeline/build.py`
  downloads the Wiktionary extracts from kaikki.org, parses and curates
  them, and emits `extension/data/`. See `pipeline/README.md`.
- `test/`: Node test suite. `test-page/`: browser self-check harness
  pages.

## Provenance

This repository is a fork of [Okpyeon](https://github.com/jjm4000/okpyeon)
(a hanja popup dictionary) at tag v1.1.0. The shell (popup, sidebar,
saved words, navigation, tooling) carries over; the language core is
new. Dictionary content is built from the English, Latin, and Ancient
Greek editions of Wiktionary via kaikki.org extracts (CC BY-SA), with
word frequencies from hermitdave/FrequencyWords (MIT). See
`extension/data/DATA-LICENSE.md`.
