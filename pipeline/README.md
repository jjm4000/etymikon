# Etymikon, data pipeline (Agent A)

Builds the three data files the extension ships with:

```
extension/data/words.json   per-word: definitions, morpheme breakdown, frequency rank
extension/data/roots.json   per-root: form, gloss, kind, aliases
extension/data/forms.json   inflected form or spelling variant -> lemma
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

Three harvests feed the lemma pointers, and they are kept apart:

| harvest              | source page                                   | may produce      |
| -------------------- | --------------------------------------------- | ---------------- |
| inflection           | pure form-of page, inflection-tagged           | `fo` or a row    |
| alternative spelling | pure alt-of page, spelling-tagged              | a row only       |
| mixed page           | lemma senses beside inflection senses          | `fo` only        |

A fourth rule, US-primary re-keying, runs at emit rather than at harvest and
rewrites which spelling owns the record. It is described below.

**Inflection.** A pure form-of page, carrying no `alt_of` sense at all, with
at least one sense **tagged as an inflection**. The lemma comes from the first
such sense. The accepted tags are enumerated in `INFLECTION_TAGS`, read off a
tag census of the extract, and cover number, tense, aspect and mood, person,
and degree.

One qualifying sense is enough rather than all of them, because a plural page
often carries a second sense that is not an inflection. `wives` is the plural
of wife and the obsolete genitive of wife, and the commonest irregular plural
in the language must not be lost to its second line.

An `alt_of` link never counts as inflection, whatever it is tagged. Read as
one, it wires the commonest words in the language to nonsense: `the` to
`thee`, `a` to `to`, `of` to `outfield`, `it` to `intrathecal`, `restarted` to
`retarded`, and `don't` to `done` (review finding 2026-08-24). Landing the
rule removed or corrected 202 mappings inside the top 3,000 corpus tokens and
took the inflection harvest from 105,512 rows to 82,553.

A word that ships **and** inflects something shadows its lemma, because the
runtime finds the key and never reaches its suffix rules. It gets `fo`, the
way back to the lemma, and stays out of `forms.json`. `ran` is the shape of
it: a marginal noun sense about yarn on a winch makes it a word, and `fo`
still points at `run`.

**Alternative spelling** (Jesse decision 2026-08-25). Excluding every
`alt_of` link left a hole: a spelling variant whose page carries `alt_of`
links defines nothing of its own, so it neither shipped as a word nor
resolved, and a lookup of it returned no match. 914 such keys ranked inside
the top 50,000, okay at rank 76 and favorite at 1,237 among them.

So an `alt_of` sense does produce a `forms.json` row, never a `fo`, when its
tags say it is a spelling and no excluded class applies. Both sets are in
`build.py` and both are read off a census of every `alt_of` sense on a pure
form-of page in the extract:

* accepted, `ALT_SPELLING_TAGS`: `alternative` (92,150 senses) and
  `standard` (198). No other tag in the census ever means "this is how the
  word is spelled somewhere else".
* excluded, `ALT_EXCLUDED_TAGS`: misspelling, misconstruction, abbreviation,
  initialism, acronym, clipping, ellipsis, pronunciation-spelling, obsolete,
  archaic, dated. Eye dialect has no tag of its own; wiktextract writes it as
  `pronunciation-spelling`, so that one tag covers both SPEC classes. Acronym,
  clipping, ellipsis and misconstruction never co-occur with an accepted tag,
  so they are listed for the reader rather than for the filter.

**Gloss-prefix extension** (Jesse decision 2026-08-25). wiktextract leaves
the same relation untagged on a good many pages and states it in prose
instead, so a sense also qualifies when its gloss OPENS with a spelling
statement. `ACCEPTED_GLOSS_PREFIXES` is the census of every such opening on
an otherwise unqualified `alt_of` sense: 9 phrases ending in "spelling", all
accepted, and 10 of the 24 ending in "form", the ones naming a country or a
standard. The exclusion classes still apply, and the opening is matched
exactly rather than by pattern, because what is left out is the whole point:

| left out                       | senses | why                                 |
| ------------------------------ | ------ | ----------------------------------- |
| alternative letter-case form   | 2,623  | a case variant is not a spelling    |
| early or late modern form      | 18     | a period statement, and the exact shape that pointed `the` at thee |
| dialect and language forms     | 14     | Geordie, Appalachia, Scotland, Russian: the acrost and fount class |
| symbol, name, romanisation     | 9      | not a spelling relation at all      |

The extension adds 539 rows and recovers 26 of the 30 keys that the tag rule
left stranded with a spelling statement in prose: recognise, apologise,
enquiry, dialog, archeology, criticise, authorise and kin. Four stay out and
should: `homos` points at hommos, which does not ship; `noone` points at "no
one", which is two words and outside the key charset; `ig` reads "Symbol for
immunoglobulin"; `joo` is a letter-case form of Joo and would map to itself.

Requiring an accepted tag or an accepted opening is what holds the old
negatives. `the` points at thee on a sense tagged Early Modern under the
gloss "Early Modern form of thee", which is neither a spelling tag nor an
accepted opening; `a` is a pronunciation spelling of to and `of` an
abbreviation of outfield, both excluded outright. Exclusions beat acceptance,
so an alternative spelling also tagged obsolete or archaic stays out.

An inflection outranks a spelling on the same surface, and 83 surfaces carry
both: `canceled` is the past of cancel before it is the American spelling of
cancelled, `flier` a form of fly before it is a spelling of flyer. A shipped
word is never a forms.json key either, so a variant that earned its own card
keeps it. Tags and gloss openings together add 12,126 rows, taking
`forms.json` to 103,731, and recover most of the keys the inflection-only
rule had stranded.

What stays unreachable is the classes the rules exclude on purpose, plus one
they cannot see. By count: 98 obsolete spellings (mostly given-name pages), 76
abbreviations, 48 pronunciation spellings (goin, doin, comin), 35 clippings,
33 initialisms, 23 misspellings, 21 archaic, 10 dated, and 24 keys with no
pure alt-of page at all.

**One hop through a spelling.** An inflection often lands on a lemma that is
itself only a spelling: `recognises` inflects `recognise`, which is a row
rather than a word. The shipped map is single hop, so the plural would
resolve to nothing while the singular resolved. The chase happens at build
time instead, and the form is emitted pointing at the final shipped word
(`recognises` to `recognize`). One hop only; a chase that does not land on a
shipped word drops the form. That adds **9,067 rows**, taking the inflection
half to 91,605.

The mirror case needs no chase. When an inflection's lemma is re-keyed to its
US spelling, the rename map repoints the row on its way out, which is why
`favourites` resolves to `favorite`. Both classes are anchored.

### Mixed page

(Jesse decision 2026-08-25.) `fo` is harvested per sense as well.
A page that carries lemma senses beside inflection-tagged `form_of`
senses is not a pure form-of page, so the first harvest refuses it, and the
commonest shadow words in the language sat in that gap. The word takes `fo`
from the first inflection-tagged `form_of` sense whose target is a different
shipped word, in sense order, so a page inflecting two lemmas keeps the first:
`best` is the superlative of good and of well, and it points at good. Same
`INFLECTION_TAGS` filter, and `alt_of` senses never feed it. 109 shipped words
gain a shadow row this way, 23 of them inside the top 3,000: is to be, had to
have, were to be, going to go, could to can, people to person, teeth to
tooth. A pure form-of page wins when a word has both, since such a page is
about nothing else.

### US-primary re-keying

(Jesse decision 2026-08-25.) Wiktionary writes the content on the British
page and leaves a pointer on the American one, so the harvest keys
`favourite` and calls `favorite` a redirect. For this dictionary's reader
that is backwards. When a shipped lemma's American spelling is a pointer page
whose tags mark it as the US standard spelling, the emit moves the whole
record onto the US key. The British spelling becomes a `forms.json` row
pointing at it, so both spellings still resolve, and the record carries `wik`,
the page title that actually holds the text, so the Wiktionary link still
lands somewhere real.

Detection is from the pointer page, never from a word list, and it reads two
things. Either the tags carry a US marker (`US`; the census has no `American`
tag) with Wiktionary's own `standard` tag, or the gloss opens with a phrase
in `US_GLOSS_PREFIXES` saying the page is the American spelling ("US spelling
of humour"). Neither fires when the page is also tagged for the other side of
the Atlantic.

The `standard` tag and the "spelling" head noun are what do the work.
Requiring them yields 53 pairs, all real: favorite, catalog, traveler,
humor, kilometer, omelet, valor. Accepting `alternative` or a bare "form"
instead yields 126 and pulls in Southern dialect and name spellings, which
would re-key `found` to `fount`, `across` to `acrost` and `marshal` to
`marshall`. Those three stay ordinary forms.json rows, pointing the American
surface at the word, which is the correct treatment for a dialect spelling.
Wiktionary applies `standard` unevenly, so `labor` and `ameba` read
`alternative` with no spelling statement in prose and stay redirects rather
than becoming keys.

Pairs where both spellings carry full entries are left alone, because neither
is a pointer: color and colour, practice and practise, story and storey, 12
pairs in all.

The re-key runs **last**, after every harvest and after `forms.json` is
assembled, so one rename map covers every reference at once: forms targets
(`favourites` now points at `favorite`), `fo` fields on other words, and `w`
chips naming the old key. The root family index is derived from the records
themselves and moves with them. Verify asserts the result: every `wik` page
is absent from words.json and present in forms.json pointing back, no
words.json key is a forms.json key, and nothing dangles.

The rank follows the headword (Jesse decision 2026-08-25): a re-keyed record
keeps the better of the two spellings' ranks, and the tier chip follows it. A
card titled favorite reporting the rank of favourite understates the word the
reader selected. 36 of the 53 pairs take the American rank, and 13 of the
original 39 change tier as a result: favorite and neighbor become Everyday,
cozy and traveler and somber and omelet become Common, and seven rare cards
become Advanced. The re-measure also moves 7 words inside the rank cap, which
is why the ranked count reads 29,257 rather than 29,250.

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
* A curated base route in `BASE_ROUTES` links to a classical root, **when
  this word's own chain reaches it**: `r`.
* A hyphen-free part that is itself a shipped word links to that word: `w`.
* Anything else stays inert.

### Base routing

(Owner ruling 2026-08-25, from the alignment measurement.) Some base parts
are spelled like an English word and mean a Latin verb. `subscribe` split as
sub- + scribe, and the chip pointed at the English noun for a draughtsperson
when the operative unit is scrībō, to write. Same class: transport's `port`
went to the harbour rather than portō, relax's `lax` to a card whose first
definition is "A salmon", resound's `sound` to one that opens "Healthy".

`BASE_ROUTES` names those bases, thirteen of them, each with the reason it is
there. **The gate is what makes the table safe**: a route fires only when the
word's own etymology chain reaches that root. The part alone is not evidence.
`port` is a morph in 34 shipped words and in most of them it really is the
harbour, so airport, carport, seaport and jetport keep their word chip while
transport routes. The same guard keeps `view` out of lakeview and overview,
`sound` out of soundboard and soundcheck, `current` out of undercurrent.

The gate also earns more than the thirteen measured words: any word whose own
chain runs through the root routes too, which is how ascribe, scribble and
portable joined their families. 22 chips route in all, and the thirteen
families they join grew from 80 words to 102.

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

### The FROM LATIN row

(Jesse decision 2026-08-25.) An `org` row takes one of two shapes. When the
chain's source lemma decomposes inside its own language it ships decomposed,
`{l, lang, parts}`, where `parts` follow the morphs chip contract: `f` to
display, `r` when that root ships, absent for an inert chip. When it does not
decompose it keeps the single `{r, f}` shape. 2,065 of the 3,233 org rows are
decomposed.

**Recursive flattening** replaces the one-hop unification rule. A chain lemma
is decomposed inside its source language, recursively, capped at
`ORG_DEPTH` = 3 levels, so `memoriālis` reads memor + -ia + -ālis rather than
anchoring on memoria, and every English word built on the family lands on the
same deepest bases. Fragmentation was not only ugly: a card referenced by one
word is pruned by the 2-word threshold, so those rows were vanishing.

A split is taken **all or nothing**. If any piece of it has no glossable
entry of its own, the whole split is refused and the part stays whole. That
is Okpyeon's dead-end rule, and the extract needs it: `recordor` "splits" as
re- + `corcord->` + -ō, whose middle piece is a wiktextract artifact with no
page behind it. `ROOT_SKIPS` and `ROOT_ALIASES` apply at every level, and a
curated alias stops the recursion where it lands.

**Affixes are terminal.** Recursion never decomposes a part that is itself an
affix, by hyphen shape or by entry pos. Wiktionary records splits for affixes
too, and following them is how `-ārium` became -ārius + -um and put library,
calendar and rosary in a la:-um card glossed "genitive plural ending" (owner
field finding 2026-08-25). A reader drilling a suffix wants the suffix, not
the case ending inside it.

**Latin and Greek affix pages are root nodes** now, reached through org
parts, with `kind` from their entry pos. 131 of them ship: la:re-, la:-tōrium,
grc:-ισμός. The 2-distinct-word threshold applies unchanged, and org parts
credit families exactly as morphs `r` chips do, once per word.

Recursion is honest about what it cannot see. The extract records `memorō` as
"From memor" and `rememoror` as "From memoror", in prose, with no
decomposition template, so flattening cannot reach memor from either. Four
`ROOT_ALIASES` entries supply the links the source omits, which is what that
table is for, and la:memor then carries memory, remember and memorandum
instead of fragmenting into three pruned cards.

### Inflection pages and curated links

Chains stop where Wiktionary stops, which is at the derived lemma rather than
the base one, and often at an inflection of it. An inflection page carries no
gloss and no split of its own, so it is stepped through to its lemma first:
`territōriī` is judged as territōrium, and the inflected surface is recorded
as an alias on the resulting card.

That is not always enough, and where the source records a split at a stage
flattening cannot reach, the link is made by hand in `curation.py`.
Wiktionary records the split of `terrēnus` at the Italic stage rather than
the Latin one, so `terrain` reaches terra by a curated alias rather than by
decomposition. Flattening itself produces no aliases: an intermediate lemma
is decomposed now rather than folded away.

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

`curation.py` is data only, six tables, every entry carrying the reason it
exists:

| table            | what it holds                                                    |
| ---------------- | ---------------------------------------------------------------- |
| `BLOCKED_SPLITS` | splits that are etymologically true and semantically dead         |
| `FORCED_SPLITS`  | hand splits that override the harvest                             |
| `ROOT_ALIASES`   | surface form or chain lemma -> root key                           |
| `ROOT_SKIPS`     | keys that must never become root cards                            |
| `ROOT_GLOSSES`   | hand glosses overriding the harvested one                         |
| `BASE_ROUTES`    | bound base part -> the classical root it really names             |

An alias key is a bare surface form (`terra`, `terr-`) when it should bind
wherever that form appears, English morphemes included, and a
language-qualified page key (`la:com-`) when it must bind only inside its own
language. That distinction is load-bearing: English words are analysed with
English affixes, so `com-` on compassion belongs on the English prefix card
and only the Latin page belongs on la:con-.

Three kinds of classical card were audited out of the root set on
2026-08-25, after the owner reviewed them in the live extension:

* **Relation notes.** A page whose own gloss points at another page ("allomorph
  of con-", "alternative form of -ulus", "oxytone form of -ης") becomes an
  alias onto the page it names, so the two families share one card. Seven
  entries, each quoting the note that justifies it.
* **Case and stem markers.** la:-s, la:-is and la:-a are real suffix pages
  that source splits do name (`dux` = dūcō + -s), but a card reading "suffix
  marking the nominative singular" teaches nothing. They are skipped.
* **Wrong-sense glosses.** Where the picked sense plainly does not describe
  the family, `ROOT_GLOSSES` carries a sense from the same page that does.
  la:-ia was glossed "Used to form country names" over a family of memory,
  grace and evidence; la:-o was glossed "masculine nouns" over a family of
  denominative verbs. The test is the family, derived the runtime way, not
  the wording: grc:-ώ keeps "suffix forming female given names" because its
  family really is echo and clio.

`understand` is the shape of a blocked split: under- + stand is correct and
tells a reader nothing. `subterranean` is the shape of a forced split: the
extract analyses it as Latin subterrāneus + -an, which would put a macronised
Latin word on a chip.

The build adds its own aliases at run time from the inflection step and never
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

Base-routing anchors: subscribe routes its scribe chip to la:scribo and that
family holds subscribe and describe; relax routes lax to la:laxo; append
routes pend to la:pendo, where the chip was inert; airport, lakeview,
soundboard and undercurrent keep their word chips, because no chain of theirs
reaches the Latin verb; every BASE_ROUTES target ships as a root.

Origin anchors: memory carries a decomposed org reading memoria = memor +
-ia with the memor part linked; territory upgrades to territōrium = terra +
-tōrium; la:memor ships with memory and remember in its family; la:re- ships
as a prefix node and la:-tōrium as a suffix node; every decomposed org row
keeps at least one navigable part.

Curation anchors: understand ships with no morphs; had ships as a word with no
morphs and no forms.json row; running ships with no morphs because its split
is inflectional; ran and running both carry fo run; territories resolves to
territory, walked to walk, children to child.

Form-of anchors: the, a, of and it carry no fo; nothing redirects don't to
done.

Chain anchors: recognises resolves to recognize, apologised to apologize and
criticising to criticize, each chased one hop through a spelling; favourites
resolves to favorite, whose lemma was re-keyed under it.

Alternative-spelling anchors: e-mail resolves to email, okay to ok; the, a,
of and yeah map to nothing; canceled resolves to cancel rather than cancelled
and flier to fly rather than flyer, because an inflection outranks a
spelling. The SPEC pins favorite and neighbor here, but the US-primary rule
ratified after it re-keys both, so those two anchor in the other direction
and the exception is pinned on pairs the re-key leaves alone.

Mixed-page anchors: is carries fo be, had carries fo have, teeth carries fo
tooth, people carries fo person.

Gloss-prefix anchors: enquiry resolves to inquiry and dialog to dialogue on
a prose statement alone; humor is a words.json key carrying wik humour.

US-primary anchors: favorite and neighbor are words.json keys carrying wik
favourite and wik neighbour; favourite maps to favorite and neighbour to
neighbor; favorite carries an Everyday rank, since the rank follows the
headword; every re-keyed word owns a Wiktionary page absent from words.json
and present in forms.json pointing back at it.

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
