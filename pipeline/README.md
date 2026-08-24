# Etymikon, data pipeline (Agent A)

Builds the three data files the extension ships with:

```
extension/data/words.json   per-word: definitions, morpheme breakdown, frequency rank
extension/data/roots.json   per-root: form, gloss, kind, aliases
extension/data/forms.json   inflected form -> lemma
```

All three are UTF-8 **without BOM** and compact (no indentation, no newlines),
with sorted keys so two runs of the same sources produce byte-identical files.
Schemas are defined in `../SPEC.md`; this pipeline is the only thing that may
write to `extension/data/`.

## Requirements

* **Python 3** (built and verified on 3.12.10). `orjson` is used when present
  and cuts the two English passes to about a third of their stdlib time; the
  build falls back to the standard library when it is missing and produces the
  same bytes either way.
* **curl** on `PATH` (ships with Windows 10/11).

## Run it

```sh
python pipeline/build.py
```

From anywhere. Paths are resolved relative to the script, not the cwd. On
Windows, if `python` still resolves to the Microsoft Store stub:

```powershell
& "C:\Users\Jesse\AppData\Local\Programs\Python\Python312\python.exe" "D:\Code\English Etymology\pipeline\build.py"
```

The script does **download-if-missing → parse → curate → cap → emit → verify**
and takes about 45 seconds once the downloads are cached. Two streaming passes
over the English extract dominate the time. It exits non-zero if any
verification check fails.

Every run prints a build report and writes the same text to
`cache/build-report.txt`: counts, output sizes, the distribution numbers, the
spot-checks, and a fixed-seed sample of ten words from each of the four cap
zones for eyeball review.

### Flags

| flag               | effect                                                          |
| ------------------ | --------------------------------------------------------------- |
| *(none)*           | full build                                                       |
| `--verify`         | re-run the spot-checks against the already-emitted JSON only      |
| `--force-download` | delete and re-fetch the cached sources (e.g. for a data refresh)  |

## Sources

| file                                | URL                                                                                              | size    |
| ----------------------------------- | ------------------------------------------------------------------------------------------------ | ------- |
| `cache/kaikki-English.jsonl.gz`     | `https://kaikki.org/dictionary/English/kaikki.org-dictionary-English.jsonl.gz`                     | ~479 MB |
| `cache/kaikki-Latin.jsonl.gz`       | `https://kaikki.org/dictionary/Latin/kaikki.org-dictionary-Latin.jsonl.gz`                        | ~101 MB |
| `cache/kaikki-AncientGreek.jsonl.gz`| `https://kaikki.org/dictionary/Ancient%20Greek/kaikki.org-dictionary-AncientGreek.jsonl.gz`        | ~40 MB  |
| `cache/en_full_opensubtitles.txt`   | `https://raw.githubusercontent.com/hermitdave/FrequencyWords/master/content/2018/en/en_full.txt`   | ~19 MB  |

The English extract is the only source of definitions, morpheme splits and
inflected forms. The Latin and Ancient Greek extracts supply root-card glosses
and headword forms for `la:` and `grc:` keys, and one decomposition step
described under "Root unification" below. The frequency list supplies the `fr`
rank and nothing else; no wording from it reaches the output. Licences and
attribution are in `../extension/data/DATA-LICENSE.md`.

Files are read straight from gzip and never decompressed to disk. `cache/` is
gitignored.

## What it extracts

### Words

An entry counts toward a word when its `word` field lowercases to the key and
its `pos` is not `name`. A word whose entries are all `name` never ships, so
proper nouns stay out of the dictionary. Entries whose every sense is a form-of
sense contribute to `forms.json` instead of to `senses`.

Definitions are the first gloss line of each sense, grouped by part of speech
in source order, capped at four POS sections and four definitions each. A
definition longer than 400 characters is dropped whole. So is one that trails
off in an ellipsis. Nothing is ever cut mid-string.

Word keys are restricted to the shape the runtime can reach: a lowercase
letter followed by letters, apostrophes and internal hyphens. Affix pages and
multiword phrases fail that test and never become words.

### Splits

A split comes from an etymology template named `prefix`, `pre`, `suffix`,
`suf`, `affix`, `af`, `confix`, `compound`, `com`, `surf`, `surface analysis`
or `univerbation`, whose language argument is exactly `en`. The language
argument matters more than it looks: without it the same template names pick
up Latin-stage and Old-French-stage analyses, and the split you get belongs to
a different word.

Each positional argument is cleaned three ways before it becomes a display
form. Inline modifiers (`terra<t:land>`) go first, because the language-prefix
rule would otherwise fire on the colon inside one. Then section suffixes
(`to-#Etymology_2`), then language prefixes (`la:terra`). The `prefix` and
`suffix` templates leave the hyphen off the affix argument, so it is put back.

Three template shapes carry the same information and all three are handled:

```
{{suffix|en|inform|ation}}      language in arg 1, parts from arg 2
{{ety|la|:af|terra|-tōrium}}    language in arg 1, parts from arg 3
{{surf|+suf|en|be|en}}          language in arg 2, parts from arg 3
```

**Split selection.** A word usually has several entries, one per part of
speech and one per etymology, and they disagree. The split is taken from the
dominant entry, meaning the non-name, non-form-of entry with the most senses.
That is what keeps `number` a count noun: its 17-sense noun entry carries no
split at all, while a separate one-sense entry analyses it as numb + -er.
Among several templates on one entry the surface analysis wins, because a
surface analysis is the reader-facing layer by definition.

**Inflectional suppression.** A split whose last part is -s, -es, -ed, -ing,
-est, -'s or -s' is not a breakdown. The word keeps its card and loses its
morphs row. `-er` survives; the dominant-entry rule handles the comparatives.

### Morpheme links

A morpheme chip carries at most one link field.

* A curated alias in `ROOT_ALIASES` overrides everything.
* A part with an English affix entry links to that affix root: `r`.
* A hyphen-free part that is itself a shipped word links to that word: `w`.
* Anything else stays inert.

Origin plays no part. `un-` and `-ness` resolve exactly as `sub-` and `-ation`
do, and Germanic affixes get root cards on the same terms as Latinate ones.

`roots.json` en: keys are affix and combining-form pages only. An ordinary
English word never becomes a root card, because it already has a word card.

### Origin chains

A word with no accepted split gets an `org` row instead, when its etymology
reaches Latin or Greek. The walk goes through `der`, `bor`, `inh` and the
learned-borrowing templates of the dominant entry, and the chain's root is the
**last** template whose language argument is Latin or Greek. Last, not first:
`music` passes through Latin mūsica on its way to Greek μουσική, and the Greek
step is the one that means something. A chain that reaches only a
reconstructed proto form yields no `org`.

### Root unification

Chains stop where Wiktionary stops, which is at the derived lemma rather than
the base one. `territory` reaches Latin territōrium, `terrestrial` reaches
terrestris, `terrain` reaches terrenum. Three cards where the reader wants
one.

So a chain-derived lemma gets one hop inside its own language. If the lemma's
entry in the Latin or Greek extract carries a decomposition template of its
own, and that template's base part has an entry in the same extract, the root
anchors at the base lemma and the intermediate is recorded as an alias on the
resulting card. One hop, never recursive, never past the source language. A
lemma with no such split anchors as itself.

An inflection page is stepped through first: terrenum is an inflection of
terrenus and carries no gloss of its own, so it is normalised to its lemma
before the hop is considered. That is not always enough. Wiktionary records
the split of terrenus at the Italic stage rather than the Latin one, so the
hop cannot see it, and the link is made by hand in `curation.py` instead.

### Keys and forms

Latin root keys are macron-stripped and lowercased. Latin page titles have no
macrons but chain templates quote the macronised spelling
(`{{der|en|la|territōrium}}`), so both have to arrive at the same key. The
macronised spelling is kept for display, taken from the `canonical` form or
the head template.

Greek root keys are the NFC form of the lemma, lowercased, with accents and
breathings intact. Lowercasing is what makes Μοῦσα from a chain template and
μοῦσα from the extract one key. Greek cards also carry `rom`, the
romanization kaikki records on the entry.

### Frequency ranks

`fr` is the 1-based position of the first occurrence of each `^[a-z]+$` token
in the frequency list. It is stored raw. The tier a word displays is derived
from it at runtime by one function in `lookup.js`; no tier is ever stored.

## Curation

`curation.py` is data only, four tables, every entry carrying the reason it
exists:

| table            | what it holds                                                    |
| ---------------- | ---------------------------------------------------------------- |
| `BLOCKED_SPLITS` | splits that are etymologically true and semantically dead         |
| `FORCED_SPLITS`  | hand splits that override the harvest                             |
| `ROOT_ALIASES`   | surface form or chain lemma -> root key                           |
| `ROOT_SKIPS`     | keys that must never become root cards                            |

`understand` is the shape of a blocked split: under- + stand is correct and
tells a reader nothing. `subterranean` is the shape of a forced split: the
extract analyses it as Latin subterrāneus + -an, which would put a macronised
Latin word on a chip.

The build adds its own aliases at run time from the unification hop and never
writes back to this file.

## The dictionary cap

Every word ranked in the top 50,000 ships unconditionally. Past that a word
ships only if it carries a morpheme breakdown **and** the frequency corpus
attests it at all.

That second condition is not in the original cap wording and it is the single
largest shape decision in the build, so here are the numbers. Wiktionary
carries about 270,000 English words with an affix split. Nearly all of them
are unattested technical coinages: nanovoltmeter, nonradiometric,
bigluconate, extremistical. Shipping them produces 289,811 words and a 53 MB
`words.json`. Requiring a frequency rank produces 76,496 words and a 17.9 MB
`words.json`, which is the size the SPEC's distribution note predicts. The
tail that survives is the readable half: snarkiness, ringbearer,
parapsychological, glucoside.

## Nothing is ever truncated

The no-truncation rule carries over from Okpyeon. No string in any output file
is a cut string. An overlong definition is dropped whole rather than shortened,
and so is one that trails off in a source ellipsis. Root glosses are selected
rather than cut: a gloss keeps its first clause and loses a trailing
parenthetical clarifier, so `terra` reads "dry land" instead of "dry land (as
opposed to watery parts of the Earth)", and every surviving string is a whole
clause from the source. A gloss that is still too long is not used at all; the
next sense of the entry is tried instead.

The verify step asserts this over every definition and every root gloss.

## Verification

Every run ends with counts, distribution numbers, output sizes, a sample of
each cap zone, and the spot-checks. A failed check exits non-zero.

Split anchors: information = inform + -ation, security = secure + -ity,
television = tele- + vision, impossible = im- + possible, music = muse + -ic
with muse as a word chip, beautiful = beauty + -ful with en:-ful shipping.

Root anchors: subterranean's breakdown contains a terra-rooted morpheme,
la:terra ships with a gloss containing "land" and a family containing terrain
and territory, en:un- ships with a family of five or more.

Curation anchors: understand ships with no morphs, had and running ship with
no morphs because their splits are inflectional, territories resolves to
territory, walked to walk, children to child.

Data invariants: no entry carries both morphs and org, no morph carries both
r and w, no root has fewer than two referencing words, every referenced root
key and every word chip target exists, en: root keys are affixes only, no key
outside en/la/grc and no reconstructed form anywhere, every root has a gloss,
no output carries a `placeholder` key, every output carries `v: 1`, every
forms.json key is absent from words.json and every target is present.

Distribution numbers are printed next to the SPEC's expectation rather than
asserted. They move with the corpus.

Determinism is checked by hand rather than by the build: run it twice and
compare hashes.

```sh
python pipeline/build.py && sha256sum extension/data/*.json > /tmp/h1
python pipeline/build.py && sha256sum extension/data/*.json | diff /tmp/h1 -
```

## Spike artifacts

`spike.py` and `spike_size.py` answered the feasibility questions before this
pipeline existed: what fraction of common words decompose, and how large
`words.json` would be at each frequency cap. `spike-report.md` records what
they found. They are kept as reference for how the extracts parse. They are
not part of the build and they are not extended.

## Other tooling in this directory

`make_icons.py`, `make_promo.py`, `make_screenshots.py` and `make_zip.ps1`
carry over from Okpyeon unchanged in mechanism. They are not part of the data
build and do not read `cache/`.
