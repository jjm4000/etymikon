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
it. That spacing rule belongs to this file alone. README.md keeps
ordinary markdown spacing, and applying the listing rule to it was tried
once on Okpyeon and reverted inside a minute.

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
--- SELECT A WORD, SEE WHAT IT IS MADE OF ---
Highlight any English word and the popup gives its definitions and its parts. subterranean is sub- (under, beneath) plus terra (dry land) plus -an (belonging to).

--- EVERY ROOT HAS A CARD ---
A root card gives the root's form, its language, its gloss, and the English words built on it. The card for Latin cēdō, "to go", lists 44 words, necessary and access among them.

--- A BORROWED WORD SHOWS THE SOURCE WORD'S PARTS ---
Some words were assembled before English took them, so the card splits the source word instead. manuscript reads FROM LATIN manūscrīptus, over manus (hand) and scrībō (to write).

--- A WORD CARD SAYS WHAT IS BUILT ON THE WORD ---
The family runs in both directions, so a card lists the longer words English builds on the one you looked up. please is used in five words, and pleasant is one of them.

--- KEEP WHAT YOU LOOK UP ---
Cards save into folders you name, and a folder exports to Anki or to CSV.

--- SEARCH WITHOUT A PAGE ---
The toolbar icon opens the same cards in Chrome's side panel, and the address bar keyword et searches from anywhere. Type et terra and press Enter.

--- A WORD BUILT ON A NAME REACHES THE NAME ---
An eponym opens the person or place behind it, on a card marked Proper noun. tantalize opens Tantalus, the Phrygian king left chin-deep in water he could not drink.

--- NOT EVERY WORD COMES FROM LATIN OR GREEK ---
A word from anywhere else names the language and the word it came from. sky reads "From Old Norse ský (cloud)", and ephemeral reaches Greek ἡμέρα, romanized hēmérā, glossed "day".

--- DEFINITIONS SAY WHEN A SENSE IS MARKED ---
Where the source marks a sense as archaic, informal or one of fourteen other labels, the marker is printed in front of the definition. The fourth sense of accede reads "archaic To approach; to arrive, to come forward."

--- HOW COMMON THE WORD IS ---
Every word carries one of four frequency tiers, counted over a corpus of film subtitles. subterranean reads Uncommon.

--- THE WHOLE DICTIONARY IS INSIDE THE EXTENSION ---
87,161 words, 9,223 root cards and 114,842 inflection and spelling mappings, 25.6 MB of dictionary data. Etymikon works with no connection and makes no network requests.

--- SOURCES ---
Definitions, morpheme breakdowns and inflected forms: English Wiktionary, through the machine-readable extracts published by kaikki.org, under CC BY-SA.
Root glosses and headword forms on the Latin and Greek cards: Latin Wiktionary and Ancient Greek Wiktionary, from the same kaikki.org extracts, under CC BY-SA.
Word frequencies: hermitdave FrequencyWords, MIT License, (c) 2016 Hermit Dave, derived from the OPUS OpenSubtitles 2018 corpus.
The four frequency tiers, Everyday, Common, Uncommon and Rare, are Etymikon's own classification. The sources supply a frequency rank, not a tier.

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

The marquee tile carries two figures, 85,000+ words and 6,000+ Latin and
Greek roots. They are floors rather than counts, for the reason the rule
at the top of this file exists: a tile is uploaded by hand and cannot be
corrected by a rebuild. `make_promo.py` checks both against
`extension/data/` and refuses to render below either, so the tile cannot
be built with a false claim on it. If it ever does refuse, lower the
floor in that file and upload the new tile with the release.

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
| 87,161 | words | `words.json`, length of `words` |
| 9,223 | root cards | `roots.json`, length of `roots` |
| 114,842 | inflection and spelling mappings | `forms.json`, length of `map` |
| 25.6 MB | the three data files | 26,852,983 bytes on disk, which is 25.61 MiB |
| 44 | words on the cēdō card | `buildFamilyIndex` in `extension/lookup.js` over the shipped bundle, key `la:cedo`, which is what the card renders |
| 360 | words on the -ful card | same index, key `en:-ful`, and the number rendered in `2-root-family.png` |
| 4 | words absolute is used in | `buildUsedInIndex` over the shipped bundle, and the number rendered in `8-used-in.png` |
| 4 | frequency tiers | `TIER_CUTOFFS` and `TIER_LABELS` in `extension/lookup.js` |
| 16 | sense markers | `SENSE_LABELS` in `pipeline/build.py` |
| 1,414 | proper-noun cards | `roots.json`, entries with `kind: "name"`, being 1,138 English, 162 Latin and 114 Greek |

Each worked example in the description was rendered from the shipped
bundle before it was written down: the subterranean and territory chips,
the accēdō split, the ephemeral romanization, the sky origin row, the
accede register marker, the Tantalus card and its gloss.

## Open before upload

Both earlier items are done. GitHub Pages is on for `main` at `/ (root)`
and https://jjm4000.github.io/etymikon/privacy-policy.html returns the
policy. That page no longer heads itself with a name the project never
shipped.

What is left is one thing, and it has to be done by hand.

### The clean-profile smoke pass

Four checks, done by hand, once, before submitting. It is short because
almost everything else is already covered, and it is manual by decision
rather than by neglect.

What automation already proves. The package is checked structurally:
forward-slash separators, the manifest name and version, all three data
files parsing at their expected counts, every icon present, package.json
excluded. The code is checked by the two browser self-check suites, 268
and 209 checks, which run the shipped lookup, saved, content and side
panel scripts against the shipped stylesheet and the shipped data, behind
a message-transport stub in place of chrome.runtime.

What no automation here can reach. Chrome 151 headless ignores
--load-extension. That is why the staging pages exist at all, and it is
recorded in cdp.py's header, in make_screenshots.py, and in
pipeline/README.md under "Why there are staging pages". A headed Chrome
would load the extension but joins the running browser's process
singleton, so --user-data-dir and --load-extension are both dropped and
the run silently uses the everyday profile. There is no flag that fixes
that; the running Chrome has to be closed first. Okpyeon reached the same
wall across three releases and its release gate is manual QA for the same
reason. Do not spend another afternoon here.

So the packaging layer is the only gap: whether Chrome accepts the zip,
registers the worker, and resolves the manifest's paths.

1. Unzip etymikon-1.0.0.zip. In a fresh profile or a guest window, go to
   chrome://extensions, enable Developer mode, Load unpacked, choose the
   folder. It must load with no error banner, and the service worker line
   must show no errors.
2. On any article, select `manuscript`. The card reads FROM LATIN
   manuscriptus over manus and scribo.
3. Click the terra chip on `subterranean`. A root card opens listing the
   words built on it.
4. Open the side panel from the toolbar icon. Search, Saved and Settings
   each render.

Two traps, if anyone automates this later. Identify our extension
positively, by its manifest name or by the id Chrome records in the
profile's Preferences. A filter written as "any service worker that is
not this known built-in" matches Chrome's own components, and one run
reported a pass against Google Network Speech. And a tab created through
CDP at a wrong extension id still reports the requested
chrome-extension:// URL as its target url while location.href is
chrome-error://chromewebdata/, so check location.href, never the target
url.
