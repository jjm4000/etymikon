# Okpyeon: Hanja Popup Dictionary

A study tool for Korean learners. Highlight hanja, hanzi, or kanji on any page
to read them in Korean, or highlight a Korean (hangul) word to see its hanja.
The toolbar button opens a sidebar for typed search, and typing `hj` in the
address bar searches from there.

옥편 (玉篇) is the traditional Korean word for a hanja dictionary.

![Character lookup](screenshots/1-character-lookup.png)

## What it does

- **Characters into Korean.** Select a hanja to see its eumhun (나라 국 for
  國), its readings, English definitions, and the compounds it appears in.
  Simplified and shinjitai forms resolve to the same entries, so Chinese and
  Japanese pages work too.
- **Korean words into hanja.** Highlight a Sino-Korean word written in hangul
  to see the hanja behind it, its meaning, and its component characters.
  Grammatical endings are handled: 자본주의는 still finds 자본주의.
- **Word breakdown.** Long compounds split into component words (자본주의 →
  資本 + 主義). Every entry is clickable, and a breadcrumb trail takes you back
  to any earlier step.
- **Browse by sound.** Highlight a single hangul syllable to list every hanja
  with that reading. Readings on cards are clickable too: a character's eum
  opens that list, and a word's hangul shows its other hanja spellings.
- **Character levels.** Every character is marked Middle school, High school,
  Advanced, or Rare. The first two follow the Korean Ministry of Education
  curriculum lists; Advanced and Rare are Okpyeon's own classification, and
  the tooltips state that.
- **Search.** The sidebar shows the same cards as highlighting does, and it
  stays open as you switch tabs and follow links.
- **Saved words.** The star on any card saves the entry, and a bubble lets you
  pick or create a folder for it. The sidebar's Saved view holds the folders,
  and items can be moved or deleted in batches.
- **Export.** Saved words export as an Anki text file or as CSV, with folder
  names carried over as Anki tags. Settings chooses the Anki card fields and
  the folder new saves go to.
- **Wiktionary links.** Each card links to its Wiktionary entry. Links open in
  a background tab, so the card you are reading stays open.
- **Resizable.** Drag the in-page popup's corner to resize it. The size is
  kept for the rest of the page visit.
- **Native words.** Native Korean words show nothing rather than a forced
  match. When a common native word shares its sound with an obscure hanja
  spelling (사랑 and 舍廊), the entry is labelled a rare homograph rather than
  the word's origin.
- **Private and offline.** The whole dictionary ships inside the extension. It
  makes no network requests and collects no data, and saved words stay on the
  device. See [privacy-policy.html](privacy-policy.html).

![Sidebar search](screenshots/5-sidebar-search.png)

*Typed search in the sidebar.*

![Saved words](screenshots/6-saved-words.png)

*Saved words, grouped into folders.*

## Install

From the Chrome Web Store: (pending review)

From source: clone this repo, open `chrome://extensions`, enable Developer
mode, and use **Load unpacked** on the `extension/` folder. The dictionary
data is committed, so no build step is needed just to run it.

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
  English Wiktionary (via kaikki.org), the Unicode Unihan database, and the
  Korean Wikipedia curriculum table. See
  [extension/data/DATA-LICENSE.md](extension/data/DATA-LICENSE.md) for full
  attribution.
