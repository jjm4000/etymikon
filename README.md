# Okpyeon — Hanja Popup Dictionary

A study tool for Korean learners. Highlight hanja, hanzi, or kanji on any page
to read them in Korean, or highlight a Korean (hangul) word to see its hanja.

옥편 (玉篇) is the traditional Korean word for a hanja dictionary.

![Character lookup](screenshots/1-character-lookup.png)

## What it does

- **Characters into Korean** — select a hanja to get its eumhun (나라 국 for
  國), readings, English definitions, and its most common compounds.
  Simplified Chinese forms and Japanese shinjitai (国, 学, 気, 図) resolve to
  the same entries, so Chinese and Japanese pages work as well as Korean ones.
- **Korean words into hanja** — highlight a Sino-Korean word written in hangul
  (국민) to see the hanja behind it (國民), its meaning, and each component
  character. Grammatical endings are handled: 자본주의는 still finds 자본주의.
- **Recursive breakdown** — long compounds split into component words
  (자본주의 → 資本 + 主義), each clickable, with breadcrumb navigation.
- **Browse by sound** — highlight a single hangul syllable (국) to list every
  hanja read that way, ranked by frequency.
- **Honest edges** — native Korean words show nothing rather than a forced
  match; obscure hanja homographs of common native words (사랑 → 舍廊) are
  labelled as rare instead of being presented as etymology.
- **Private and offline** — the whole dictionary ships inside the extension.
  No network requests, no data collection, no permissions beyond the content
  script itself. See [privacy-policy.html](privacy-policy.html).

## Install

From the Chrome Web Store: (pending review)

From source: clone this repo, open `chrome://extensions`, enable Developer
mode, and **Load unpacked** → the `extension/` folder. The dictionary data is
committed, so no build step is needed just to run it.

## Repository layout

```
extension/     the extension itself (MV3); data/ holds the built dictionary
pipeline/      build tooling: dictionary build, icons, promo tiles, store zip
test/          Node unit tests for the lookup logic
test-page/     standalone browser test page with self-checks (no build needed)
screenshots/   store listing assets
SPEC.md        the internal spec the implementation follows
```

## Building the dictionary

```
python pipeline/build.py
```

Downloads the source corpora into `pipeline/cache/` on first run (~412 MB:
kaikki.org Wiktionary extracts for Korean/Translingual/Japanese, Unicode
Unihan, a subtitle-derived frequency list), then builds
`extension/data/*.json` in about 11 seconds from a warm cache and verifies the
output against a set of anchor entries. See `pipeline/README.md` for details.

Tests:

```
node test/lookup.test.mjs
```

UI self-checks: open `test-page/index.html` in a browser and press
"Run self-checks".

## Licenses

- **Code**: [GPL-3.0](LICENSE).
- **Dictionary data** (`extension/data/*.json`): CC BY-SA 4.0, derived from
  English Wiktionary (via kaikki.org) and the Unicode Unihan database — see
  [extension/data/DATA-LICENSE.md](extension/data/DATA-LICENSE.md) for full
  attribution.
