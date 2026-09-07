# Chrome Web Store listing

The record of what is in the Chrome Web Store dashboard. Updated after
every upload. Where the uploader edits a field in the dashboard, this
file adopts the edit verbatim and the note beside it records the delta
and the reason: the uploaded version is canonical, not the draft.

Written for 1.0.0, against `origin-graphs` at the commit that adds this
file. Every count below is re-verified against `extension/data/` before
each upload, because one data rule change moves several of them at once.

Fenced blocks are pasted as they stand. Inside the detailed description
there is no markdown, because the store renders that field as plain
text, and there is no blank line between a separator and the body under
it.

## Name

Canonical in `extension/manifest.json`. This is a copy, not a second
original.

```
Etymikon: Word Roots and Etymology Popup Dictionary
```

51 characters, inside the manifest's 75-character limit. Set by the
2026-09-07 decision recorded in SPEC "Name", which widened it from 37
characters so the store indexes "etymology". The title names the subject
and does not promise the genre, so the description below says what a card
shows and never claims a complete etymology. Browse-rail cards truncate
long titles, so check how 51 characters read on the store card after the
first upload.

## Short description (dashboard field: Summary)

Canonical in `extension/manifest.json` as `description`. This is a copy,
not a second original.

```
Select an English word on any page to see its definitions and its morpheme breakdown: subterranean = sub- + terra + -an.
```

120 characters. The limit is 132.

## Detailed description (dashboard field: Description)

Plain text. Paste everything between the fences.

```
Etymikon is an offline popup dictionary for English word roots. Select a word on any page and the card shows its definitions and the pieces it is built from.

--- SELECT A WORD, SEE WHAT IT IS MADE OF ---
Highlight any English word and the popup gives its definitions and its parts. subterranean is sub- (under, beneath) plus terra (dry land) plus -an (belonging to).

--- EVERY ROOT HAS A CARD, AND THE CARD LISTS THE WORDS BUILT ON IT ---
A root card gives the root's form, its language, its gloss, and the English words built on it, commonest first. The card for Latin cēdō, "to go", lists 44 words, necessary and access among them.

--- WORDS ENGLISH BORROWED WHOLE SHOW THE SOURCE WORD'S PARTS ---
Some words were assembled before English took them, so the card splits the source word instead. territory reads FROM LATIN territōrium, over terra (dry land) and -tōrium (used to form nouns denoting a place).

--- A WORD CARD ALSO SAYS WHAT IS BUILT ON THE WORD ---
The family runs in both directions, so a card lists the longer words English builds on the one you looked up. absolute reads "Used in 4 words", which opens absolutely, absolutism, absoluteness and absolutist.

--- HOW COMMON THE WORD IS, ON EVERY CARD ---
Every word carries one of four frequency tiers, so a word worth learning is easy to tell from a word almost nobody uses. subterranean reads Advanced.

--- A WORD BUILT ON A NAME REACHES THE NAME ---
An eponym opens the person or place behind it, on a card marked Proper noun. tantalize opens Tantalus, "A Phrygian king who was condemned to remain in Tartarus, chin-deep in water, with fruit-laden branches hanging above his head."

--- WORDS THAT ARE NOT FROM LATIN OR GREEK STILL SAY WHERE THEY CAME FROM ---
Germanic and other vocabulary gets a line of its own rather than nothing. sky reads "From Old Norse ský (cloud)".

--- YOU DO NOT NEED TO READ GREEK ---
Every Greek form on a card carries its romanization beside it. Under ephemeral, the Greek part reads ἡμέρα, romanized hēmérā, glossed "day".

--- DEFINITIONS SAY WHEN A SENSE IS MARKED ---
Where the source marks a sense as archaic, informal or one of fourteen other labels, the marker is printed in front of the definition. The fourth sense of accede reads "archaic To approach; to arrive, to come forward."

--- SEARCH WITHOUT A PAGE ---
The toolbar icon opens the same cards in Chrome's side panel, and the address bar keyword et searches from anywhere. Type et terra and press Enter.

--- KEEP WHAT YOU LOOK UP ---
Cards save into folders you name, and a folder exports to Anki or to CSV.

--- THE WHOLE DICTIONARY IS INSIDE THE EXTENSION ---
84,326 words, 8,068 root cards and 110,719 inflection and spelling mappings, 24.7 MB in all. Etymikon makes no network requests and needs no account. It works with no connection.

--- SOURCES ---
Definitions, morpheme breakdowns and inflected forms: English Wiktionary, through the machine-readable extracts published by kaikki.org, under CC BY-SA.
Root glosses and headword forms on the Latin and Greek cards: Latin Wiktionary and Ancient Greek Wiktionary, from the same kaikki.org extracts, under CC BY-SA.
Word frequencies: hermitdave FrequencyWords, MIT License, (c) 2016 Hermit Dave, derived from the OPUS OpenSubtitles 2018 corpus.
The four frequency tiers, Everyday, Common, Advanced and Uncommon, are Etymikon's own classification. The sources supply a frequency rank, not a tier.

--- LICENSE ---
The dictionary data shipped in the extension is a derived database under CC BY-SA 4.0, an obligation inherited from Wiktionary. The extension's source code is GPL-3.0. Both are at https://github.com/jjm4000/etymikon
```

3,655 characters. The limit is 16,000.

## Category

**Education.**

The dashboard takes one category. Education is where the store files
study tools, and that is what the product is: the reader is building
vocabulary, not getting a browsing job done faster. The saved folders
and the Anki export exist to be revised from, which is study apparatus
and nothing else.

Two were considered and rejected. **Tools** is the generic bucket for
utilities that serve a browsing task; it would fit a lookup popup on its
own, but it drops the study half of the product and puts Etymikon
against ad blockers and tab managers rather than against the other
dictionaries. **Functionality & UI** is for extensions that change how
Chrome itself behaves, which this does not.

## Screenshots

The store accepts five. Eight are built. The five uploaded, in this
order:

1. `screenshots/1-word-breakdown.png` - the popup on subterranean, with
   the morpheme chips
2. `screenshots/2-root-family.png` - the -ful root card, 360 words
3. `screenshots/3-latin-origin.png` - territory, FROM LATIN territōrium
4. `screenshots/4-sidebar-search.png` - typed search in the side panel
5. `screenshots/7-dark-mode.png` - the same popup in dark mode

Dropped: `5-saved-words.png` and `6-settings.png`. Both show features
rather than the core loop, and with five slots the core loop takes
priority. `8-used-in.png` is also unused; it shows the reverse family,
which shot 2 already demonstrates in the forward direction.

`README.md` embeds the same five, so the gallery and the store set do
not diverge on what they demonstrate. Changing one changes both.

All eight are 1280x800, which is the larger of the two sizes the store
accepts. Both promo tiles are built at the required dimensions:
`screenshots/promo-440x280.png` and `screenshots/promo-1400x560.png`.

## Dashboard form answers

### Store listing tab

- Product name: as above, from the manifest.
- Summary: as above, from the manifest.
- Description: as above.
- Category: Education.
- Language: English (United States).
- Store icon: `extension/icons/icon128.png`.
- Screenshots: the five listed above.
- Small promo tile: `screenshots/promo-440x280.png`.
- Marquee promo tile: `screenshots/promo-1400x560.png`.
- Official URL, Homepage URL: `https://github.com/jjm4000/etymikon`
- Support URL: `https://github.com/jjm4000/etymikon/issues`
- Mature content: no.
- Google Analytics: not used.

### Privacy tab

**Single purpose.** Etymikon is a dictionary. It looks up an English
word the user selects on a page or types into the extension, and shows
that word's definitions and the roots it is built from, out of a
dictionary bundled inside the extension package.

**Permission justifications.**

- `storage`: saved entries, the folders the user files them in, and the
  display settings are kept with `chrome.storage.local` on the user's
  own machine. Nothing else is stored and nothing is transmitted.
- `sidePanel`: the toolbar icon and the omnibox keyword open the
  dictionary in Chrome's side panel, which is where typed search and the
  saved list live.
- Host permission (`<all_urls>`, from the content script's `matches`):
  the popup has to work on whatever page the user is reading, so the
  content script runs everywhere. It reads the current text selection,
  matches it against the bundled dictionary, and renders a card in the
  page. It sends nothing anywhere and reads no other page content.

**Remote code.** No. Every line of code that runs ships in the package.

**Data usage.** Etymikon collects none of the listed categories:
personally identifiable information, health information, financial and
payment information, authentication information, personal
communications, location, web history, and user activity. All three
certifications apply: the data is not sold or transferred to third
parties, it is not used or transferred for any purpose unrelated to the
item's single purpose, and it is not used or transferred to determine
creditworthiness or for lending purposes. There is no data to do any of
those things with.

**Privacy policy URL.**

```
https://jjm4000.github.io/etymikon/privacy-policy.html
```

`privacy-policy.html` sits at the repo root and is already on `main`.
The URL above is what GitHub Pages serves for a project site built from
the `main` branch at `/ (root)`. It is not live yet: Pages has to be
turned on in the repository settings first, and until it is the URL
returns 404 and the review will reject the field.

### Distribution tab

- Visibility: public.
- Distribution: all regions.
- Pricing: free.

## Phrasings rejected

The Name and the Summary are canonical in the manifest. These are the
alternatives that lost, kept so the next release does not re-derive
them.

### Summary (limit 132)

| Chars | Phrasing | Why it lost |
| --- | --- | --- |
| 133 | Select an English word on any page for its definitions, its morpheme breakdown, and every other English word built on the same roots. | One character over the limit. |
| 130 | A popup dictionary that breaks an English word into its Latin and Greek roots and lists the other English words built on each one. | Fits, but describes the product instead of showing it, and carries no example. |
| 129 | Select a word on any page: definitions, morpheme breakdown (subterranean = sub- + terra + -an), and the root's whole word family. | Fits, but the example inside parentheses inside a list reads as a fragment. |
| 128 | Select an English word on any page to see its definitions, the roots it is built from, and the other words built on those roots. | Fits, but "roots" three times in one line, and no example. |
| 126 | Select an English word on any page to see its definitions, its morpheme breakdown, and the family of words built on each root. | Fits, and the closest runner-up. Lost because the shipped line spends its last 34 characters on a worked example rather than on a third clause. |
| 124 | Select an English word on any page to see its definitions and the roots it is built from: subterranean = sub- + terra + -an. | Fits. "morpheme breakdown" is the term the product uses on the card and in the spec, so the shipped line uses it. |

### Name (limit 75)

| Chars | Phrasing | Why it lost |
| --- | --- | --- |
| 37 | Etymikon: Word Roots Popup Dictionary | The shipped name until 2026-09-07. Superseded: the store indexes the title, and this one carried no term a reader searches for except "dictionary". |
| 45 | Etymikon: English Word Roots Popup Dictionary | "English" is redundant beside "Word Roots" in an English-language store, and it adds no search term the 37-character name lacked. |
| 40 | Etymikon: Popup Dictionary of Word Roots | Puts the weakest word, "Popup", ahead of the subject. |
| 36 | Etymikon: Word Roots and Definitions | Loses "Dictionary", which is the search term. |
| 8 | Etymikon | Says nothing to a reader who has not heard of it. |

The four below the current name were drafted against the superseded
37-character title and are kept so they are not re-derived. None of them
carries "etymology", which is the term the current name exists to hold.

## Numbers, and where each came from

Read on 2026-09-07 off `extension/data/` at this commit, cross-checked
against `pipeline/cache/build-report.txt`. The build report's COUNTS
block agrees with all of them.

| Number | Claim | Source |
| --- | --- | --- |
| 84,326 | words | `words.json`, length of `words` |
| 8,068 | root cards | `roots.json`, length of `roots` |
| 110,719 | inflection and spelling mappings | `forms.json`, length of `map` |
| 24.7 MB | the three data files | 25,931,083 bytes on disk, which is 24.73 MiB |
| 44 | words on the cēdō card | `buildFamilyIndex` in `extension/lookup.js` over the shipped bundle, key `la:cedo`, which is what the card renders |
| 360 | words on the -ful card | same index, key `en:-ful`, and the number rendered in `2-root-family.png` |
| 4 | words absolute is used in | `buildUsedInIndex` over the shipped bundle, and the number rendered in `8-used-in.png` |
| 4 | frequency tiers | `TIER_CUTOFFS` and `TIER_LABELS` in `extension/lookup.js` |
| 16 | sense markers | `SENSE_LABELS` in `pipeline/build.py` |
| 1,338 | proper-noun cards | `roots.json`, entries with `kind: "name"`, being 1,141 English, 109 Latin and 88 Greek |

Each worked example in the description was rendered from the shipped
bundle before it was written down: the subterranean and territory chips,
the accēdō split, the ephemeral romanization, the sky origin row, the
accede register marker, the Tantalus card and its gloss.

## Open before upload

- GitHub Pages is off. Turn it on for `main` at `/ (root)` and confirm
  the privacy policy URL loads before submitting; the field is rejected
  otherwise.
- `privacy-policy.html` heads itself "Etymikon: English Root Dictionary",
  which is not the name in the manifest or on this page. Worth aligning
  in the same pass that turns Pages on.
