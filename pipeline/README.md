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
inflected forms. The Latin and Ancient Greek extracts supply the gloss, the
headword form and the entry pos behind every `la:` and `grc:` card, plus one
decomposition step described under "Root unification" below. The frequency
list supplies the `fr` rank and nothing else; no wording from it reaches the
output. Licences and attribution are in
`../extension/data/DATA-LICENSE.md`.

Files are read straight from gzip and never decompressed to disk. `cache/` is
gitignored.

## What it extracts

### Words

An entry counts toward a word when its `word` field lowercases to the key and
its `pos` is not `name`. A word whose entries are all `name` never ships, so
proper nouns stay out of the dictionary. An entry whose every sense is a
form-of sense defines nothing of its own and contributes no `senses`.

Definitions are the first gloss line of each sense, grouped by part of speech
in source order, capped at four POS sections and four definitions each. A
definition longer than 400 characters is dropped whole. So is one that trails
off in an ellipsis. Nothing is ever cut mid-string.

Word keys are restricted to the shape the runtime can reach: a lowercase
letter followed by letters, apostrophes and internal hyphens. Affix pages and
multiword phrases fail that test and never become words.

### Inflected forms

`forms.json` and the `fo` field on a word are the same harvest, split by
whether the form itself ships. Both accept exactly one relation: a pure
form-of page, carrying no `alt_of` sense at all, with at least one sense
**tagged as an inflection**. The lemma comes from the first such sense. The
accepted tags are enumerated in `INFLECTION_TAGS`, read off a tag census of
the extract, and cover number, tense, aspect and mood, person, and degree.

One qualifying sense is enough rather than all of them, because a plural page
often carries a second sense that is not an inflection. `wives` is the plural
of wife and the obsolete genitive of wife, and the commonest irregular plural
in the language must not be lost to its second line.

An `alt_of` link never qualifies, whatever it is tagged. That is the whole
abbreviation, initialism, misspelling, eye-dialect, pronunciation-spelling and
alternative-spelling vocabulary of Wiktionary, and it is not inflection. Read
as one, it wires the commonest words in the language to nonsense: `the` to
`thee`, `a` to `to`, `of` to `outfield`, `it` to `intrathecal`, `restarted` to
`retarded`, and `don't` to `done` (review finding 2026-08-24). Landing the
rule removed or corrected 202 mappings inside the top 3,000 corpus tokens and
took `forms.json` from 105,512 rows to 82,553.

A page that mixes inflection senses with lemma senses on ONE entry is not a
pure form-of page, so it yields no mapping. `had` and `teeth` are that shape:
both ship as words, and neither carries `fo` back to have or tooth. Whether
the `fo` harvest should read senses instead of entries is an open question for
the owner, not a pipeline decision.

A word that ships **and** has inflection senses shadows its lemma, because the
runtime finds the key and never reaches its suffix rules. It gets `fo`, the
way back to the lemma, and stays out of `forms.json`. `ran` is the shape of
it: a marginal noun sense about yarn on a winch makes it a word, and `fo`
still points at `run`.

The rule has a cost worth knowing. An alternative spelling whose page carries
`alt_of` links defines nothing of its own, so it neither ships as a word nor
resolves through `forms.json`, and a lookup of it returns no match. 918 such
keys rank inside the top 50,000, and 22 of those inside the top 3,000: okay
at rank 76, mr at 450, tv at 762, favorite at 1,237, neighbor at 2,949, with
labor, humor and e-mail just past the line. Wiktionary is inconsistent
here, which is why `colour` and `theater` are unaffected: their pages write
the relation as a plain gloss ("Commonwealth and Ireland standard spelling of
color") rather than as a link, so they ship as ordinary words. Closing that
hole means a spelling-variant relation of its own, which is an owner
decision, not a pipeline one.

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

### Root cards

A root ships when **two or more distinct shipped words** reference it, through
a `morphs[].r` chip or an `org` row. A word whose split repeats a morpheme
counts once, exactly as `lookup.js` `buildFamilyIndex` counts it at runtime.
That function is the authority for the family index; the build only mirrors
it, in the ship threshold and in verify, so that the number on a card and the
number in the threshold are the same number. Nineteen shipped words repeat a
morpheme today (great-great-grandson, ununoctium, fixer-upper).

`kind` comes from the harvested entry `pos`, never from the shape of the form.
An `interfix` page becomes kind `infix`, because the SPEC enum has no
interfix member. A `circumfix` page becomes `circumfix`. A combining form is a
root unless its own page is written with a hyphen. Latin and Greek pages carry
a pos as well, so `la:re-` stays a prefix instead of becoming a Latin root.
Shape-guessing labeled ten interfix cards as suffixes and the one circumfix
card as a root (review finding 2026-08-24).

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

`fr` is the 1-based position of the first occurrence of each word-shaped token
in the frequency list, where word-shaped means the same `RE_WORD_KEY` charset
a `words.json` key uses. It is stored raw. The tier a word displays is derived
from it at runtime by one function in `lookup.js`; no tier is ever stored.

The charset has to match. The rank is what the attestation gate reads, so a
token the rank table cannot hold is a word that can never ship, whatever else
is true of it. This test read `^[a-z]+$` until 2026-08-24, which silently
barred every hyphenated word in the language: 1,850 of them rank inside the
top 50,000, and 3,316 now ship (x-ray, t-shirt, hip-hop, brother-in-law).

The corpus tokenizer splits contractions into `don` + `'t`, so no
apostrophe-bearing token is attested anywhere in the frequency list and the
attestation gate keeps every contraction out of the dictionary. `don't`,
`isn't` and `can't` have real Wiktionary entries and do not ship. Nothing in
the pipeline can fix that; it is a cap-rule question for the owner.

## Curation

`curation.py` is data only, five tables, every entry carrying the reason it
exists:

| table            | what it holds                                                    |
| ---------------- | ---------------------------------------------------------------- |
| `BLOCKED_SPLITS` | splits that are etymologically true and semantically dead         |
| `FORCED_SPLITS`  | hand splits that override the harvest                             |
| `ROOT_ALIASES`   | surface form or chain lemma -> root key                           |
| `ROOT_SKIPS`     | keys that must never become root cards                            |
| `ROOT_GLOSSES`   | hand glosses overriding the harvested one                         |

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
bigluconate, extremistical. Shipping them measured 289,811 words and a 53 MB
`words.json` at bring-up (2026-08-24, before the rank charset fix). Requiring
a frequency rank produces 79,380 words and an 18.6 MB `words.json`. The tail
that survives is the readable half: snarkiness, ringbearer,
parapsychological, glucoside.

## Nothing is ever truncated

The no-truncation rule carries over from Okpyeon. No string in any output file
is a cut string. An overlong definition is dropped whole rather than shortened,
and so is one that trails off in a source ellipsis.

Root glosses are selected rather than cut. The chip subtext is one short line,
so a budget decides which sense gets the card:

1. the first sense at or under **80 characters**, in source order, wins;
2. otherwise a sense keeps its first clause, split at a semicolon or a full
   stop that closes a word rather than an abbreviation;
3. the **160 character** safety cap decides which clause is usable. A gloss
   over it is not used at all, and the walk moves to the next sense.

A trailing parenthetical clarifier and a leading usage label are dropped
before any of this, so `terra` reads "dry land" instead of "dry land (as
opposed to watery parts of the Earth)". Every surviving string is a whole
clause from the source. A hand gloss in `ROOT_GLOSSES` overrides the whole
ladder.

The SPEC bullet reads "the shortest sense at or under 80 characters". Source
order is used instead of length, and the deviation is reported to the owner:
the shortest sense is a marginal one often enough to matter (`terra` would
read "earth", `λόγος` "subject matter"), and it contradicts the pinned
la:terra anchor, whose gloss is sense 1.

The verify step asserts the no-truncation rule over every definition and every
root gloss.

## Verification

Every run ends with counts, distribution numbers, output sizes, a sample of
each cap zone, and the spot-checks. A failed check exits non-zero.

Split anchors: information = inform + -ation, security = secure + -ity,
television = tele- + vision, impossible = im- + possible, music = muse + -ic
with muse as a word chip, beautiful = beauty + -ful with en:-ful shipping.

Root anchors: subterranean's breakdown contains a terra-rooted morpheme,
la:terra ships with a gloss containing "land" and a family containing terrain
and territory, en:un- ships with a family of five or more.

Curation anchors: understand ships with no morphs; had ships as a word with no
morphs, no fo and no forms.json row; running ships with no morphs because its
split is inflectional; ran and running both carry fo run; territories resolves
to territory, walked to walk, children to child.

Form-of anchors: the, a, of and it carry no fo; nothing redirects don't to
done.

Charset anchor: x-ray ships, inside rank 50,000.

Root-kind anchor: en:-o- ships with kind infix, since its page is an interfix
rather than a suffix.

Every anchor asserts one reality. A check written as a disjunction ("ships or
resolves") is not an anchor, because it passes either way and pins nothing;
the had anchor was rewritten for that reason on 2026-08-24.

Data invariants: no entry carries both morphs and org, no morph carries both
r and w, no root has fewer than two distinct referencing words, every root
kind is in the SPEC enum, every referenced root key and every word chip target
exists, en: root keys are affixes only, no key outside en/la/grc and no
reconstructed form anywhere, every root has a gloss, no output carries a
`placeholder` key, every output carries `v: 1`, every forms.json key is absent
from words.json and every target is present.

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
they found. They are not part of the build and they are not extended.

Each holds a frozen copy of an early revision of the template tables and the
parsing helpers. `build.py` is the authority for how the extracts are read and
has moved on from those copies, so the spike numbers are pinned to a
superseded parser and do not describe a current build. The copies are not
replaced by an import: a spike that changes when the pipeline changes no
longer reproduces what it published.

## Other tooling in this directory

`make_icons.py`, `make_promo.py`, `make_screenshots.py` and `make_zip.ps1`
carry over from Okpyeon unchanged in mechanism. They are not part of the data
build and do not read `cache/`.
