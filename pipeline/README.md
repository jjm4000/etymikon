# Etymikon, data pipeline (Agent A)

Builds the three data files the extension ships with:

```
extension/data/words.json   per-word: definitions, morpheme breakdown, origin row, frequency rank
extension/data/roots.json   per-root: form, gloss, kind, romanization, aliases, the anchor's own split
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

The script does **download-if-missing → graphs → parse → curate → cap →
emit → verify** and takes about 60 seconds once the downloads are cached. Two
streaming passes over the English extract dominate the time. It exits
non-zero if any verification check fails or the gold score drops.

Every run prints a build report and writes the same text to
`cache/build-report.txt`: counts, output sizes, the distribution numbers, the
spot-checks, and a fixed-seed sample of ten words from each of the four cap
zones for eyeball review.

### Flags

| flag               | effect                                                          |
| ------------------ | --------------------------------------------------------------- |
| *(none)*           | full build                                                       |
| `--verify`         | re-run the spot-checks against the already-emitted JSON only      |
| `--offline`        | build from the cached sources only, no network at all             |
| `--force-download` | delete and re-fetch the cached sources (e.g. for a data refresh)  |

`--offline` skips the remote size check and uses whatever is in `cache/`,
failing loudly when a source file is missing. Use it when a run has to be
comparable to the run before it: kaikki republishes the extracts on its own
schedule, and a refresh mid-task moves every number in the report.

## Sources

| file                                | URL                                                                                              | size    |
| ----------------------------------- | ------------------------------------------------------------------------------------------------ | ------- |
| `cache/kaikki-English.jsonl.gz`     | `https://kaikki.org/dictionary/English/kaikki.org-dictionary-English.jsonl.gz`                     | ~479 MB |
| `cache/kaikki-Latin.jsonl.gz`       | `https://kaikki.org/dictionary/Latin/kaikki.org-dictionary-Latin.jsonl.gz`                        | ~101 MB |
| `cache/kaikki-AncientGreek.jsonl.gz`| `https://kaikki.org/dictionary/Ancient%20Greek/kaikki.org-dictionary-AncientGreek.jsonl.gz`        | ~40 MB  |
| `cache/kaikki-OldFrench.jsonl.gz`   | `https://kaikki.org/dictionary/Old%20French/kaikki.org-dictionary-OldFrench.jsonl.gz`              | ~3.3 MB |
| `cache/kaikki-MiddleFrench.jsonl.gz`| `https://kaikki.org/dictionary/Middle%20French/kaikki.org-dictionary-MiddleFrench.jsonl.gz`        | ~1.3 MB |
| `cache/kaikki-French.jsonl.gz`      | `https://kaikki.org/dictionary/French/kaikki.org-dictionary-French.jsonl.gz`                      | ~54 MB  |
| `cache/kaikki-MiddleEnglish.jsonl.gz`| `https://kaikki.org/dictionary/Middle%20English/kaikki.org-dictionary-MiddleEnglish.jsonl.gz`    | ~7.1 MB |
| `cache/kaikki-OldEnglish.jsonl.gz`  | `https://kaikki.org/dictionary/Old%20English/kaikki.org-dictionary-OldEnglish.jsonl.gz`           | ~13.2 MB|
| `cache/kaikki-OldNorse.jsonl.gz`    | `https://kaikki.org/dictionary/Old%20Norse/kaikki.org-dictionary-OldNorse.jsonl.gz`               | ~4.0 MB |
| `cache/kaikki-MiddleDutch.jsonl.gz` | `https://kaikki.org/dictionary/Middle%20Dutch/kaikki.org-dictionary-MiddleDutch.jsonl.gz`         | ~0.6 MB |
| `cache/kaikki-OldHighGerman.jsonl.gz`| `https://kaikki.org/dictionary/Old%20High%20German/kaikki.org-dictionary-OldHighGerman.jsonl.gz` | ~0.9 MB |
| `cache/kaikki-OldDutch.jsonl.gz`    | `https://kaikki.org/dictionary/Old%20Dutch/kaikki.org-dictionary-OldDutch.jsonl.gz`               | ~0.7 MB |
| `cache/kaikki-OldSaxon.jsonl.gz`    | `https://kaikki.org/dictionary/Old%20Saxon/kaikki.org-dictionary-OldSaxon.jsonl.gz`               | ~0.7 MB |
| `cache/en_full_opensubtitles.txt`   | `https://raw.githubusercontent.com/hermitdave/FrequencyWords/master/content/2018/en/en_full.txt`   | ~19 MB  |

The English extract is the only source of definitions, morpheme splits and
inflected forms. The Latin and Ancient Greek extracts are the source graphs:
every `la:` and `grc:` card, every decomposition edge and every step edge
below comes from them. The three French-family extracts (added 2026-09-05;
the sizes are the 2026-09-05 publication) are pass-through pages, read for
the terms they name so a chain that stops at Old French can continue to
Latin, and they never ship a card. The frequency list supplies the `fr`
rank and nothing else; no wording from it reaches the output. Licences and attribution are in
`../extension/data/DATA-LICENSE.md`.

The seven Germanic extracts were added 2026-09-06 (sizes are that day's
publication). They supply the gloss a row-only row prints, looked up in the
extract of the row's own language, and Middle English is walked as well: it
joined the pass-through group so a chain that stops there continues toward
Old English, Old French, Old Norse and Latin. Old English does NOT become a
root language in this round: it stays row-only, gains glosses, and ships no
card and no family. kaikki publishes no Middle Low German and no Anglo-Norman
extract (both 404, checked 2026-09-06), so the 104 `gml` and `xno` rows keep
whatever gloss the English page wrote. The modern languages (Italian,
Spanish, German, Japanese, Arabic and the rest) have no extract here: they
cost 352 MB for 482 glosses, which the owner declined 2026-09-06.

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
`suf`, `affix`, `af`, `confix`, `compound`, `com`, `compound+`, `com+`,
`surf`, `surface analysis` or `univerbation`, whose language argument is
exactly `en`. `com+` and `compound+` are the category-adding variants of the
plain names and carry an identical arg layout (owner decision 2026-09-01);
they are the only `+` variants of a decomposition name the extract carries. The language
argument matters more than it looks: without it the same template names pick
up Latin-stage and Old-French-stage analyses, and the split you get belongs to
a different word.

Each positional argument is cleaned three ways before it becomes a display
form. Inline modifiers (`terra<t:land>`) go first, because the language-prefix
rule would otherwise fire on the colon inside one. Then section suffixes
(`to-#Etymology_2`), then language prefixes (`la:terra`). The `prefix` and
`suffix` templates leave the hyphen off the affix argument, so it is put back.

An argument opening with a colon is a template selector, not a morpheme:
`:af`, `:der`, `:calque`. It marks the start of a NESTED etymon, so what
follows is a second analysis of the word rather than more parts of this one,
and collection stops there. Without that stop mammy harvested as "mam + -y +
:af + mamma + -y" and confidential as "cōnfīdentia + -al + :calque +
confidentiel". Nested markup also defeats the balanced `<...>` strip and
leaves a bracket behind, so anything from a surviving bracket on is dropped
too: "milk<...<...>>" was reaching the chip as "milk>".

Four template shapes carry the same information and all four are handled:

```
{{suffix|en|inform|ation}}      language in arg 1, parts from arg 2
{{ety|la|:af|terra|-tōrium}}    language in arg 1, parts from arg 3
{{etymon|en|:af|absent|-ee}}    the ety shape under another name
{{surf|+suf|en|be|en}}          language in arg 2, parts from arg 3
```

**Precedence.** When one entry carries several of these, the highest
preference wins and source order breaks a tie: a surface analysis first, then
a plain decomposition, then the etymology tree (`ety`, `etymon`). The order
is a statement about what each template is for. A surface analysis is the
reader-facing layer by definition, a plain decomposition is what an editor
wrote for a human, and the tree is a derivation history that happens to carry
the same shape. Ranking the tree last makes reading it strictly additive: it
gives a split to an entry that had none and can never overrule one written by
hand. Enabling the tree for English (owner ruling 2026-08-25) therefore
withdrew no split at all.

**Split selection.** A word usually has several entries, one per part of
speech and one per etymology, and they disagree. The split is taken from the
dominant entry, meaning the non-name, non-form-of entry with the most senses.
(The origin row follows a different entry, the one supplying the card's
first senses; see "Attachment".)
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

A root ships when any shipped word references it, through a `morphs[].r`
chip, an `org` row, or an anchor's `parts` (SPEC "Origin subsystem, source
graphs", Principle 4, owner decision 2026-09-05). There is no credit
threshold: a one-word family is a valid card and its gloss is the value.
2,395 cards build one word at 2026-09-05. A key is left out only when it
has no gloss to carry a card or sits in `ROOT_SKIPS`, and a reference to it
renders inert. Verify asserts the converse, that no card ships with an
empty family.

The family index is still derived at runtime by `lookup.js`
`buildFamilyIndex`, which the build mirrors for its report and its checks. A
reference to an anchor is also a reference to every root the anchor's own
split names, recursively (owner decision 2026-09-01): access names accēdō,
accēdō names cēdō, so access counts for cēdō on the card.

Anchor cards carry their own split (owner decision 2026-09-01). Every anchor
whose lemma decomposes gets `parts` in roots.json, the org.parts shape,
from the same flatten() the word rows use: recursion stops at other
anchors, affixes stay terminal, a part whose root did not ship stays inert
with its form alone. A node the chip cap kept whole carries `parts` the
same way (review finding 4, 2026-09-05). 1,172 cards carry parts at
2026-09-06; the other anchors are base lemmas (cēdō, θεός) with no split
in their graph and carry no field. The card renders the row under MADE OF.

`kind` comes from the harvested entry `pos`, never from the shape of the form.
An `interfix` page becomes kind `infix`, because the SPEC enum has no
interfix member. A `circumfix` page becomes `circumfix`. A combining form is a
root unless its own page is written with a hyphen. Latin and Greek pages carry
a pos as well, so `la:re-` stays a prefix instead of becoming a Latin root.
Shape-guessing labeled ten interfix cards as suffixes and the one circumfix
card as a root (review finding 2026-08-24). A hyphen-free affix page that is
also a shipped word (a combining form recorded on the word's own page)
links to the word card, never to a root card of its own.

### Source graphs

The origin subsystem is source-graph first (SPEC "Origin subsystem, source
graphs", owner decisions 2026-09-05; the design replaces the origin-chain
walk and the flattener of 2026-08-25). Each root language is built as a
standalone graph before any English page is read, in `parse_classical` and
`build_graph`:

* A **node** is a glossed lemma page: the display form (Latin with its
  macrons from the canonical form; Greek as the page title, never the
  canonical form with its vowel-length marks), the card gloss, the entry
  pos that decides `kind`, and for Greek the romanization. A page with
  several lemma entries keeps every entry as a candidate, each with its
  own split, forms and sense words; the entry with the most senses is the
  default until the English pages have attached, and then the node is
  fixed on one entry by evidence (see "Homographs"). The split, the
  label and the gloss of a node all come from that one entry, never from
  a homograph beside it: cēdō ("to go") shares its page with cedo ("hand
  it over!"), and only the second is ce- + dō.
* A **decomposition edge** comes from the decomposition templates, from
  the `etymon` tree, or from the etymology prose, in that order, and one
  edge per node. Every part is resolved through the lookup rules below and
  has to be a node; a split with a reconstructed part, a part that is no
  page, a part with no usable gloss, or a part naming the lemma itself is
  refused whole, and the refusal carries its reason (la 1,939, grc 1,040
  refused splits at 2026-09-06, prose chains the parser could not accept
  included). `SOURCE_SPLITS` in curation.py is a hand
  edge that overrides the page.
* A **step edge** takes an inflection or participle page to its lemma:
  from `form_of` links (every sense a form-of sense), from a participle
  head (`la-part`, `grc-part`) whose etymon reads ":from<text:... participle
  of>" or whose prose opens "Perfect passive participle of X", and from
  `LEMMA_STEPS`, curation winning at every hop. An alternative-form page
  (`alt_of`, no inflection) is recorded apart and stepped only where the
  lookup says so.

The graph is verified before English attaches. Every edge lands on a node
(the build stops otherwise), a depth-first walk refuses the split that
closes a cycle and records it as a refusal, and the coverage table goes to
the report:

| lang | nodes | decomposed | template | etymon | prose | prose unread | neither |
|------|-------|------------|----------|--------|-------|--------------|---------|
| la   | 46,012 | 18,016 | 3,272 | 13,876 | 853 | 1,376 | 26,620 |
| grc  | 20,182 | 9,290 | 8,909 | 48 | 335 | 437 | 10,455 |

"prose unread" is a node whose etymology carries a plus the parser could
not read into an accepted split. The table is tracked build over build.

### Lookup rules

Every chain lemma and every split part goes through `Graph.lookup` before
any other rule (SPEC Principle 1, measured in spike-origin.md section 3):

1. the template arg is cleaned: inline modifiers, a section suffix,
   trailing punctuation, and one side of an `a//b` alternation;
2. the key is normalised: Latin macrons and breves off and lowercased;
   Greek vowel-length marks (macron, breve) off, accents and breathings
   kept, NFC, lowercased. Templates write σῠνῐ́στημῐ and περῐ́, page titles
   write συνίστημι and περί, and the two meet on the key;
3. a key that is no page at all matches loosely, every combining mark
   stripped, preferring a glossed lemma among the pages that share the
   loose spelling (πάπας reaches πάππας, coërceō reaches coerceō);
4. a form-of page steps to its lemma, and the step repeats when the target
   is itself a form-of page (sciēns to sciō, expectāre to exspectō),
   `LEMMA_STEPS` winning at every hop.

An alternative-form page is not a node and is not stepped through by the
strict lookup: it exists as a spelling, and a word that names one attaches
through some other mention. Split parts always step through it (prendere
is an inflection of prendō, a spelling of prehendō, and the chip wants
prehendō). The attachment steps through it in a fallback pass, which wins
only when it reaches a node that decomposes: μονάρχης is a spelling of
μόναρχος, which splits, so monarch reads Greek; σύκχος is a spelling of
συγχίς, which does not, so sock stays on Latin soccus.

### The prose parser

The grammar the spike measured (spike-origin.md, section 2; 55 right, 3
partial, 2 wrong in a hand-checked 60). A sentence is tokenised into words
and balanced parenthesis groups, so a plus inside a gloss never splits.
Every " + " at depth zero joins the word before it, skipping its
parentheses, to the word after it, and pluses chain. A term's language is
the language name written before it (Latin, Medieval Latin, Ancient Greek,
Old French and about eighty more), else the last language name at depth
zero earlier in the sentence, else the page's own mention templates, else
Greek script means Ancient Greek, else the page's own language. A
parenthesis after the head is scanned for a step ("ablative of X", "past
participle of X", "frequentative of X", "diminutive of X") and so is a
trailing appositive (", accusative of mons"); a Greek head's
transliteration is skipped.

On a source page the parse is accepted only when every part resolves to a
node of the same graph (the same-extract rule), none is reconstructed, none
is the page itself, and the sentence carries no rejection stance ("not
from", "rather than", "unrelated to", "folk etymology", "problematic"),
parentheses aside. A decomposition template answers to the same stance
(review finding 8, 2026-09-05): it is refused when a rejection cue sits
before its expansion in the sentence, and whole when the entry carries an
`unk` or `unc` template, since the page's own etymology is then unknown or
uncertain and the split beside it a proposal. A calque-type cue names a
model, and the word's own chain resumes at the next "from". A node whose
own page refused its split for stance takes no parts from an English
page that repeats them (squirrel).
manuscript's row is the shape of it: the Latin page manūscrīptus reads
"From manu (ablative of manus) + scriptus (past participle of scribere)",
and the chips are manus and scrībō.

Sentences are split with abbreviations respected ("e.g. Spanish por" does
not end one), and each sentence takes a role: rejection, cognate ("cognate
with", "compare", "akin", "related", "see also", "whence", "doublet",
"displaced", "eclipsed", "calque", "semantic loan" and kin), or origin
("from", "borrowed", "inherited"). A sentence with no cue continues the
role of the sentence before it inside its paragraph, and a list-item
paragraph continues the paragraph above it, which is how "Cognates"
followed by one bullet per language reads. The role is what decides
whether a mention is an origin; the template name never does (Wiktionary
writes ordinary mentions with `noncog` and cognates with `m+`).

### Language roles

Every language code the extracts use is in exactly one role (SPEC
Principle 2), as data in build.py with a reason per row, under the census
gate: a code at or above `CENSUS_MIN` (1,000) uses on origin and mention
templates that is in no role fails the build. 43 codes stand above the
threshold at 2026-09-05, all in a role.

| role | codes | what happens |
|------|-------|--------------|
| root | Latin period codes (`la`, `la-lat`, `la-med`, `la-ecc`, `la-new`, `la-vul`, `la-cla`, `la-eme`, `la-ren`, `ML`, `LL`, `NL`, `VL`); `grc`, `grc-koi`, `gkm` | nodes ship as root cards with families |
| pass-through | `fro`, `fro-nor`, `xno`, `xno-law`, `frm`, `fr`, `fr-CA`, `fr-aca`, `frc`, `enm` | pages are walked to continue a chain toward a root language; never a card, and a row only where the walk reaches nothing deeper |
| row-only | every other attested language, `ROW_ONLY_LANGS`, about 300 codes (Middle English left the table for the pass-through group 2026-09-06) with the name the row prints (131 under the census threshold surfaced by review finding 7, named off the template expansions) | one inert origin row, no card, no family |
| ignored | `en`, `mul`, the Chinese romanization schemes, undetermined and substrate codes, proto-language codes, a comma-joined list of codes | no origin language |

A reconstructed term (starting with `*`) ends the walk whatever its code.
The extension's `LANG_NAME` table is the one copy of the names the rows
print; verify reads it out of content.js and fails when the build emits a
code it lacks (the loud-failure pattern of the census gate), and the Node
suite checks the same thing from the other side.

The pass-through extracts (Old French, Middle French, French, and Middle
English since 2026-09-06) are read for their mentions, into a per-page table
of the terms each page names, and for their glosses. kaikki publishes no
Anglo-Norman extract (checked 2026-09-05), so an `xno` mention is walked only
through what the English page itself says.

Middle English joined the group on 2026-09-06 (owner decision): 643 rows
stopped there and the Middle English page usually names the Old English, Old
Norse or Old French word behind them. `ROW_PASS_LANGS` holds the pass-through
languages a ROW is read through as well as a card, and Middle English is the
only member. Two rules follow the membership. A row whose chain ends at a
Middle English term continues through that page to the term it names. And the
two spelling rules a row-only language gets, the comma-joined list and the
attested form beside a reconstruction, are read for it too, since a chain
ends at Middle English as often as in a row-only language (print reads "Middle
English *printen, prenten" and shows prenten).

Three guards keep the Middle English walk on the word English took. A
spelling that STATES two etymologies is two words, and neither the walk nor
the row reads it: the Middle English male is masculine, a bag and an apple,
and mail read Latin masculus off the first of them. Two stated accounts, not
two entries, since a lemma page beside a silent participle is one word. A
page whose own etymology carries an `unk` or `unc` template states a proposal
rather than an origin (core writes "Unknown; derivation from either Old French
cuer or cors has been suggested, though both possibilities pose serious
problems"). And a term the English page names only as a cognate is refused in
the walk as it is on the page itself.

The three guards are on Middle English alone. Applying the ambiguity test to
the French extracts, which have been walked since 2026-09-05, shallows 36 rows
and drops 17: menu, coupe, ville and sac would read a French word glossed with
itself. Walking French rows the way Middle English ones are walked moved 108
rows and read most of them worse, since a French page's own chain runs on past
the word English borrowed (swiss read Old High German Suittes over Middle
French Suisse).

Old English does NOT become a root language in this round. It stays row-only
and gains glosses; the root role with cards and families is phase two of the
SPEC and is not built here.

### Attachment

An English page contributes the ordered terms it names (SPEC Principle 3),
read by `page_mentions` from the entry that supplies the card's first
senses (second review, cause 3, 2026-09-06; it used to be the dominant
entry, so can read "To know how to" over "From Old English canne (glass,
container, cup, jar)"). A section owns those senses when it supplies the
first one and no disagreeing section supplies more of the first sense list
than it does (2026-09-06; the test used to ask for more than half, which
two sections of two senses each can never meet, and 268 words showed no
row for it). A tie goes to the section the card opens with, so bowl reads
Old English bolla over the lawn-bowls Latin and row reads rǣw over the
rowing rōwan. The row is withheld with that reason in the misses report
only where a LATER section supplies more of the list: robot opens with the
Central European serfdom from German Robot and fills the other three slots
with the machine from Czech robot. Only a section that names a DIFFERENT
origin makes the list ambiguous, so cotton keeps its Hebrew row though
"A liking." from another section fills a slot. A section that names no
origin gives no row (shot opens with "Tired, weary", whose section names
only English shoot; found reads "See find."), and nothing falls through to
the next section. The split still follows the dominant entry, and the
homograph vote follows the entry the row comes from. The terms are
read from: origin templates (`der`,
`bor`, `inh` and their `+` variants), mention templates in a sentence whose
role is origin, the nodes of the `etymon` tree in chain order, the parts of
decomposition templates, and the prose parser's plus-chains. A term a
sentence steps ("Latin appreciātus, past participle of appretiō") names the
stepped lemma as the next term. A pass-through mention is walked: the
French page's own terms come after the English page's, in walk order, up
to three pages deep and cycle-safe (3,220 pages walked at 2026-09-06, since
a French term the page's own clause continues past is not walked).

The root-language terms fall into **runs** by language. The first term of a
run is the lemma English borrowed; the rest of the run is that lemma's own
ancestry inside its language. The word attaches to the entry lemma of the
deepest run, preferring a run whose entry decomposes (in the graph, or
through parts the page itself supplies) and, inside a run whose entry does
not, a later term of the same run that does. Without the run rule access
would attach to accēdō instead of accessus and every anchor above a base
verb would lose its reaches.

A plus-chain in the English prose belongs to the last root or pass-through
term named before it. When that owner is a node with no split, the chain
supplies its parts (dīvortium = dī- + vertō); when it is a term Wiktionary
never wrote, the row reads the term as written over the parts (ad montem =
ad + mōns); when it is a reconstruction, the starred form labels the row
(*manizāre = manus + -izō); when it is a pass-through word and no root
lemma is named at all, the French word labels the row and the chips stay
Latin (`lang` fro, frm or fr on a decomposed row). A chain with no term
before it ("From Latin spectāculum + -ar") is the English word's own
analysis, and its first term is the lemma. A mention that is a term of an
owned chain is a part, not a lemma, so "from super- + prendere" written
with mention templates never attaches a word to la:super-; only a mention
written at or after the chain counts as one of its terms.

A decomposition template's parts are owned the same way (review finding
5, 2026-09-05): the template's expansion ("de- + portāre") gives it a
prose position, and the parts belong to the last root or pass-through
term named before it. A template with no prose position belongs to the
term the template itself names, the etymon head it nests under or the
origin template written just before it, and to no term at all when none
precedes it; never to any term of the run. An origin template whose
expansion is not in the prose is located by its term. A trailing suffix
the page's own templates give as English ("funereus + -al" beside a
{{suffix|en|3=al}}) comes off a chain, and a chain left with one term is
no chain. When a French word owns the parts and its own page continues
to a Latin lemma that decomposes, that lemma is the row (ancestor reads
antecessor through ancessor's page).

When no root-language term resolves, the deepest term of the page's own
origin clause renders the row-only row (review finding 7, 2026-09-05):
read in template order, a reconstruction in a proto language ends the
walk, an alternative at the same depth (no step cue between two terms,
or "or" between them, or a "via" term after a "from" term) is skipped in
favour of the first, a term after an aside cue in its sentence
("influenced by", "whence also", "compare X", "see also X") or after a
doubt cue ("a connection has been suggested with", and since 2026-09-06
"Watkins proposes" and "Some propose that") was never an origin, and a
comma-joined spelling list gives its first form. A bare "propose" counts
only where it takes a clause, since euro writes "a contest open to the
general public to propose names" and its Greek row is right. A walked French
page is read only when the page itself settles nothing, and a French
term the page's own clause continues past to an attested origin is not
walked at all (the page's own "from Italian razza, of uncertain origin"
stands over the French page's Latin). A code under the census threshold
in no role renders a row like any other; the build fails until
ROW_ONLY_LANGS and the extension's LANG_NAME name it. A word whose chain
ends in a pass-through language with nothing deeper renders no row and
goes to the misses file with that reason (dessert at Middle French,
quite at Anglo-Norman). A root-language term that is no page at all is a
miss too, with the term in the reason (madam names mea domina).

Five more rules keep the walk from stopping short or stepping sideways
(second review, cause 2, 2026-09-06). A term in a language the walk has
already left starts a second chain rather than going deeper, tested on
positioned terms only since the etymon tree repeats a chain's head with
no position: about ends "Middle English about (adverb)" after its Old
English abūtan and now stops at abūtan, and or stops at āþor. A
comma-joined list whose first form is a reconstruction gives the first
attested spelling beside it (not writes "*nōht, nāht"). A grammatical
label is no term: `STOP_HEADS` refuses "demonstrative" and its kin as
prose step targets, so they reads Old Norse þeir. A term of an accepted
plus-chain is a component of the word before it in any language, not only
in Latin and Greek, when the chain explains a word of its own language
named before it: ever stops at ǣfre rather than the ā of "ǣfre, from ā +
in feore", while caffeine keeps Italian caffè, which no earlier Italian
word owns. A row-only row prints the template's display argument when it
has one (`{{inh|en|ang|don|dōn}}` reads dōn), since the row is inert text;
a root or pass-through term is looked up and keeps the page title.

### Origin rows

An `org` row takes one of three shapes (SPEC "Row shapes", ratified from
mockups 2026-09-05), 14,247 rows at 2026-09-06:

* **decomposed**, `{l, lang, parts}`: the attached node decomposes, or the
  page supplied parts for it. `parts` follow the morphs chip contract, `f`
  to display and `r` when that root ships, plus `g` where the parent's own
  split names a sense the root card does not carry (see "Part senses").
  7,073 rows.
* **single**, `{r, f}`: the node does not decompose ("From Latin soccus").
  2,218 rows. The worker joins the root's gloss and romanization.
* **row-only**, `{lang, f, gloss?, rom?}` with no `r`: the deepest named
  origin is a row-only language ("From Old Norse ský (cloud)"). The gloss
  comes from the template's own `t` arg; the romanization from `tr`, else
  from the transliteration kaikki writes into the template's expansion,
  else from the parenthesis the prose writes right after it (review
  finding 6, 2026-09-05; 472 of 740 non-Latin rows lacked one before,
  122 after). Where the English page wrote no gloss, the row looks its own
  term up in the extract of its own language and takes the gloss there
  (2026-09-06, see "Row glosses"). The worker passes it through unjoined
  and the card renders it inert. 5,190
  rows, Old English 1,703 and Middle English 578 the largest groups until
  phase two makes Old English a root language.

### Row glosses

A row-only row names a source language and a term and ships no card, so
until 2026-09-06 its gloss existed only where the English page happened to
write one into a mention template: 3,281 of 5,201 rows, 63%, read "From Old
English tō" and stopped, 526 of them inside the top 3,000 ranks. The row now
looks its term up in the extract of its own language and takes the gloss
written there, and the romanization for a form outside the Latin script. A
gloss the English page states keeps priority, since that is what the page
says the word meant when English took it.

`ROW_EXTRACT` names the extract a row's language is looked up in and
`PASS_EXTRACT` the French group's; a code in neither takes whatever the
English page wrote. The lookup is the graph's: the term is cleaned of inline
modifiers, a section suffix and trailing punctuation, the strict key is
tried, and the loose key with every combining mark stripped answers when the
strict key is no page. That loose pass is what reaches an Old English page
title, which carries no macron, from a template that writes one. Where two
page titles share one loose key the row stays silent.

A page that holds no gloss of its own steps to the page it names, and the
step repeats, the way the graph's lookup steps through a form-of page and an
alternative-form one (2026-09-06). Old English cumende is the present
participle of cuman and reht an alternative form of riht, so coming reads
"to come" and right reads "right". An alternative spelling is read the way
`alt_spelling_of` reads one, so an abbreviation or a pronunciation spelling
is refused here as it is for English. A spelling that names two different
pages is two words and steps nowhere: the Middle English fond is an
alternative form of fend, of fonned and of fonden. The step is taken only
where the spelling is no glossed page of its own, so nothing that already
carried a gloss moves. Not built: following the forms table of a page that
states nothing, which would reach 87 more rows and read Old French trope as
the adverb trop "excessively" where English troop wants the noun "herd".

The gloss is chosen the way a root card's is: `best_gloss` over the page's
lemma entries, name entries weighted last, form-of pages left out. Where a
page has several lemma entries the English word decides between them, the way
the homograph vote decides a root card's entry: the entry whose senses share
the most content words with the English word and its first definition wins,
so good reads Old English gōd "good" and god reads god "god" off one page
title, and loathe reads lāþian "to loathe" over the same page's "to invite".
With no overlap and two stated etymologies the row carries no gloss rather
than guess: Old English is is the noun "ice" beside the verb form of wesan,
and the row on English is stays bare.

A row-only row with no romanization takes one from another template of its
own etymology section that names the same term in the same language, else
from the prose written after the term (2026-09-06). A romanization is a
reading of the form, so a page that names one spelling twice reads it the
same way both times. The gloss is not filled that way: a gloss is a reading
of the sense and the second template is often about another word (pooling a
page's sections would read been as Old English bēon "bees" and over as ofer
"riverbank, seashore"). Non-Latin row-only rows without a reading: 83 to 75.

Outcome (2026-09-06): rows without a gloss 3,281 to 2,098, and 526 to 222
inside the top 3,000. 1,181 rows gained one: Old English 674, French 197,
Middle English 145, Old French 83, Old Norse 45, Middle French 10, Middle
Dutch 6, and a tail across the Old Dutch, Old High German and Old Saxon
extracts. A hand read of twenty at random: 18 right, 2 degraded (bracelet
reads fro bracelet "diminutive of bras", the page's only sense; erie reads
fr Érié "Lake Erie" where the English sense is the tribe), 0 wrong.

Outcome of the glossless-page step (2026-09-06): 234 lookups stepped and 122
rows gained a gloss, none lost or reworded one. The thirty highest ranked
read against the extracts: 27 right, 2 degraded (worse and worst read wiersa
and wierrest glossed "bad", the positive degree their pages step to), 1
wrong (tiny reads Middle English tine glossed "thine, your", the only tine
page the extract carries). Rows without a gloss overall: 2,098 to 2,052 and
222 to 194 inside the top 3,000, against a base that gained 209 rows in the
same build. The causes of what is left, with counts and examples and each
one marked a rule gap or a source gap, are in `cache/gloss-gap-report.txt`,
written once on 2026-09-06 rather than by the build.

A word never carries both morphs and org. Nothing is dropped for a
threshold. What is dropped carries a stated reason: a refused split in the
graph (self-part, missing part page, cycle), a `BLOCKED_SPLITS` entry, a
`ROOT_SKIPS` key, a lemma never written, a chain ending in a pass-through
language. Every reason goes to `cache/misses-report.txt`: one line per
silent word with its rank and reason, then every refused split of both
graphs.

**Flattening** is the 2026-08-25 rule over the graph's edges. A lemma is
decomposed recursively inside its language, capped at `ORG_DEPTH` (3), so
memoriālis reads memor + -ia + -ālis. Affixes are terminal (a reader
drilling a suffix wants the suffix, not the case ending inside it). Anchors
are terminal: a word reaches the lemma it attaches to and the immediate
parts of that lemma's split, each once, and a lemma `ORG_ANCHOR_MIN` (2)
or more words reach is a card the reader wants, so recursion stops at it
and its card carries the split (owner decisions 2026-09-01; the reach
rule widened to the attached lemma under review finding 4, 2026-09-05,
after justice flattened through iūstus while just attached to it).
3,158 anchors at 2026-09-06. A chain-only tail word whose row will not
decompose is dropped, so its attachment is no reach. `ROOT_ALIASES` and
`ROOT_SKIPS` apply at every level, and a curated alias stops the recursion
where it lands.

Two limits on a row (review finding 4). No row may carry a duplicate
root: a split naming one twice keeps the lemma whole. A row that would run
to four or more chips falls back to the page's own parts, and every part
that stayed whole because of that (`Origin.carry`, 116 nodes at
2026-09-06) ships a root card carrying its own `parts`, exactly as an
anchor's does: energy reads ἐνέργεια = ἐνεργός + -ης + -ια rather than
five chips, and the ἐνεργός card reads ἐν- + ἔργον + -ος.

**Homographs.** A key with several lemma entries (fundō "to pour" and
fundō "to found", dēcidō "to fall" and dēcīdō "to cut off") is fixed on
one entry after the harvest, in `Origin.choose_homographs`, and the
split, the label and the gloss follow that entry (review findings 2 and
3, 2026-09-05). Every English page that names the key votes, weighted
by the word's rank (a rank 1,000 word counts as seven words at the cap,
since one card serves the whole family and the words a reader meets
most decide), and the rules are read in order:

1. a form, pos or gloss the English page states beside the term: the
   `t=`, `gloss=` and `pos=` args, the alt form (`fundāre` against
   `fundere`, matched against the entries' canonical, infinitive and
   supine forms), and the quoted parenthesis the prose writes after the
   term ("iūs (“right”)"), with or without a template;
2. the glosses source pages give the term as a part of their own lemma
   (iūsculum = iūs<t:broth> + -culum), one vote per page;
3. a part of the entry's own split the English page names (decide names
   caedō);
4. a content word the English word's first definition shares with the
   entry's senses (impact: "collision");
5. the entry with the most senses.

Only a distinguishing match counts: a form or gloss word every entry
shares says nothing, and a name entry never wins on evidence. A written
verb form no entry of the node carries, on a node with no verb entry,
skips the node for that page (catch writes Late Latin captiāre under the
noun page captio). The build report prints how many nodes each rule
decided. One card still serves every word that reaches the key, so a
family split across two homographs (legacy on lēgō "to bequeath" beside
college on legō "to gather") follows the majority. `ROOT_GLOSSES` still
overrides the gloss.

**Part senses.** One card serves every parent and follows one entry, so a
chip used to show whatever gloss won the part's own card whatever sense the
parent's split meant: la:in- read "un-, non-, not" on incident, intend,
insist and noise, and la:-tus read the action-noun entry on defense and
expert (second review, cause 1, 2026-09-06). A chip now carries its own
gloss, `g` on the part, chosen from the sense the parent's split states for
it: the parent's `t`, `tN` or `glossN` argument, its inline `<t:...>` and
`<id:...>` modifiers, or the parenthetical beside the term in the parent's
prose. The candidates are every card-sized sense line of every lemma entry
of the part's page, name entries excluded, so the rule reaches a homograph
entry and a further sense of a single entry (grc:κρίνω "to decide or judge"
under κρίσις) alike. A stated sense matches a line on an equal
comma-joined piece or an equal content word (plural -s off, or a shared
five-letter prefix), and a line wins only by naming MORE of the stated
sense than the card's own gloss does, so ūnus under ūnus<t:one> keeps
"one, single" and only a card that answers the parent's sense poorly is
overridden. `Origin.part_sense` picks it, `link_and_prune` drops a `g`
that repeats the card, and the worker joins `g` over the root gloss.
1,088 word rows and 216 root cards carry one at 2026-09-06.

A gloss that is only a grammatical note is not a gloss: a whole line in
square brackets is refused in `gloss_line`, so period and episode stopped
reading "[with genitive]" for περί and ἐπί.

### Keys and forms

Latin root keys are macron-stripped and lowercased. Latin page titles have no
macrons but chain templates quote the macronised spelling
(`{{der|en|la|territōrium}}`), so both have to arrive at the same key. The
macronised spelling is kept for display, taken from the `canonical` form or
the head template.

Greek root keys are the NFC form of the lemma, lowercased, with accents and
breathings intact and the vowel-length marks stripped (see "Lookup rules").
Lowercasing is what makes Μοῦσα from a chain template and μοῦσα from the
extract one key. Greek cards carry `rom`, the romanization kaikki records
on the entry, and the worker joins it onto every chip and single row that
names the root, so the card can print a reading under a form in Greek
script. The spelling a word named (haesitātiōnem, absolūtus) is listed on
the card it landed on as `alt`.

### The gold set

`gold.json` holds hand-verified expectations, one row per word (SPEC
Principle 5): the kind (morphs, decomposed, single, rowonly, none), the
language, the lemma, the ordered part forms, and the reason the row is a
fact, read off the extract pages. The build scores every run as an exact
match of kind, language, lemma and ordered part forms, prints precision per
kind, and fails when the score drops under the number in
`gold-score.json` (71 of 71 at 2026-09-06). The Node suite applies the same
rule to the shipped data. A field report becomes a row here before it
becomes a fix.

`misses-2026-09-01.txt` is the list of 1,752 words that stated a classical
origin and shipped nothing before the source graphs. The report counts what
each renders now, so the outcome the SPEC expects is checked, not assumed:
552 decomposed, 1,029 single, 171 nothing at 2026-09-06 (the spike sized
488, 1,039 and 225); inside the top 10,000 ranks, 171, 343 and 39.

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

`curation.py` is data only, nine tables, every entry carrying the reason it
exists:

| table            | what it holds                                                    |
| ---------------- | ---------------------------------------------------------------- |
| `BLOCKED_SPLITS` | splits that are etymologically true and semantically dead         |
| `FORCED_SPLITS`  | hand splits that override the harvest                             |
| `ROOT_ALIASES`   | surface form or chain lemma -> root key                           |
| `ROOT_SKIPS`     | keys that must never become root cards                            |
| `ROOT_GLOSSES`   | hand glosses overriding the harvested one                         |
| `BASE_ROUTES`    | bound base part -> the classical root it really names             |
| `ROOT_STOPS`     | source lemmas recursion must never split (empty)                  |
| `LEMMA_STEPS`    | source-language lemma -> the lemma a chain steps to               |
| `SOURCE_SPLITS`  | hand decomposition edge in a source graph (cūriōsus = cūra + -ōsus) |

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
ships only if it carries a breakdown **and** the frequency corpus attests it
at all.

A breakdown is either an English-surface split or a classical origin that
decomposes (owner decision 2026-09-01). The origin half is provisional at
survey time: whether an attachment flattens depends on the dominant entry,
on the source graphs and on the anchor set, none of which pass 1 has. So a
word naming a root or pass-through language becomes a candidate and emit
drops it again unless its final org row decomposes. 9,474 candidates, 3,713
ship, 5,761 dropped at 2026-09-05. A rank floor for these candidates was
considered and decided against (owner decision 2026-09-01): attestation is
the edge, the same edge the split half has.

That second condition is not in the original cap wording and it is the single
largest shape decision in the build, so here are the numbers. Wiktionary
carries about 270,000 English words with an affix split. Nearly all of them
are unattested technical coinages: nanovoltmeter, nonradiometric,
bigluconate, extremistical. Shipping them measured 289,811 words and a 53 MB
`words.json` at bring-up (2026-08-24, before the rank charset fix). Requiring
a frequency rank produces 84,307 words and a 20.6 MB `words.json`. The tail
that survives is the readable half: snarkiness, ringbearer,
parapsychological, glucoside.

The chain half of the tail runs rarer than the split half. It reaches useful
words at the top (excerpt, cursive, succinct, inflection, benediction) and
archaic or technical ones at the bottom (jocose, funest, astrict, tentorium,
rejectamenta). All of them are corpus-attested; a rank near 1.4 million means
one occurrence in OpenSubtitles.

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

Every run ends with counts, the graph coverage table, distribution numbers,
output sizes, a sample of each cap zone, the spot-checks and the gold score.
A failed check or a gold score under the committed one exits non-zero.

Source-graph anchors (2026-09-05): manuscript carries manūscrīptus = manus +
scrībō, both linked; idea carries a single row naming grc:ἰδέα, that root
ships and carries a romanization; system carries σύστημα = συν- + ἵστημι +
-μα; period carries περίοδος = περί + ὁδός, both linked; curious carries
cūriōsus = cūra + -ōsus; sock carries a single row naming la:soccus, shipped
with a family of at least one; sky carries a row-only row with lang non and
no r; hesitation carries haesitātiō = haesitō + -tiō with la:haesito
carrying haereō + -titō; every row-only org is `{lang, f, gloss?, rom?}`
and its code is in `ROW_ONLY_LANGS` and in the extension's LANG_NAME table;
every root card has a family of at least one word; no word with a
classified origin ships with neither morphs nor org except through a drop
in the misses file; the graphs have no cycle and no dangling edge (the
build stops before English is read otherwise).

Etymon anchors: abolitionism = abolition + -ism and absentee = absent + -ee,
both split by the etymology tree where no plain template offers one.

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

Participle-hop anchors: absolute carries a decomposed org reading absolvō =
ab- + solvō, and la:solvo ships with absolute, absolve and solution in its
family. dissolve and resolve are not in it and cannot be: they carry English
morphs, so they take no org row, and their base chip is the English word
solve, ratified as a free base.

Origin anchors: memory carries a decomposed org reading memoria = memor +
-ia with the memor part linked; territory upgrades to territōrium = terra +
-tōrium; la:memor ships with memory and remember in its family; la:re- ships
as a prefix node and la:-tōrium as a suffix node; every decomposed org row
keeps at least one navigable part.

Anchor anchors (2026-09-01, restated 2026-09-05): every anchor lemma a row
or a card names as a part ships as a root card (an anchor two words attach
to and nothing names as a part gates nothing and needs no card), and no
org part naming an anchor is inert. Both are skipped on a `--verify` run,
which reads the JSON and has no anchor set to check against.

Root-parts anchors (2026-09-01, widened 2026-09-05): every `r` inside a
root's `parts` exists in roots.json and every part has a form; only
anchors and the nodes the chip cap kept whole carry `parts`; every anchor
or carried node whose lemma decomposes carries `parts` and no other root
does (the last two need the anchor set, so `--verify` skips them); la:accedo carries
parts reading ad- + cēdō, both linked; la:cedo's family reaches access,
concede and precede through their anchors; deponent carries dēpōnō = dē- +
pōnō; fornicate links its fornix part and tactic its τάσσω part; no org row
names its own lemma as a part.

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
r and w, no root ships with an empty family, every root
kind is in the SPEC enum, every referenced root key and every word chip target
exists, en: root keys are affixes only, no key outside en/la/grc and no
reconstructed form anywhere, every root has a gloss, no output carries a
`placeholder` key, every output carries `v: 1`, every forms.json key is absent
from words.json and every target is present.

Tier anchors (2026-09-07): every one of the four tiers holds at least one
shipped word, so a boundary typo that empties a bucket fails instead of
passing; the last cutoff equals the shipping cap, because 50,000 is both;
lookup.js labels all four tiers; and content.js's `TIER_LABEL` says the same
words as lookup.js's `TIER_LABELS`, since content.js cannot import it and
holds a documented second copy. The build reads both tables off the extension
source, the way it already reads `LANG_NAME`.

Distribution numbers are printed next to the SPEC's expectation rather than
asserted. They move with the corpus.

Determinism is checked by hand rather than by the build: run it twice and
compare hashes (byte-identical at 2026-09-05, misses file included).

```sh
python pipeline/build.py --offline && sha256sum extension/data/*.json > /tmp/h1
python pipeline/build.py --offline && sha256sum extension/data/*.json | diff /tmp/h1 -
```

## Spike artifacts

`spike.py` and `spike_size.py` answered the feasibility questions before this
pipeline existed: what fraction of common words decompose, and how large
`words.json` would be at each frequency cap. `spike-report.md` records what
they found. `spike_origin.py` and `spike-origin.md` sized the source-graph
design (the lookup rules, the prose grammar, the drop census) before it was
built; the build reimplements what the spike measured and never imports it.
None are part of the build and none are extended.

Each holds a frozen copy of an early revision of the template tables and the
parsing helpers. `build.py` is the authority for how the extracts are read and
has moved on from those copies, so the spike numbers are pinned to a
superseded parser and do not describe a current build. The copies are not
replaced by an import: a spike that changes when the pipeline changes no
longer reproduces what it published.

## Browser tooling: cdp.py, run_selfchecks.py, make_screenshots.py

Three files, one headless Chrome driver. None of them is part of the data
build and none reads `cache/`. Both scripts are run as
`python pipeline/<name>.py`, which puts `pipeline/` on `sys.path` so
`from cdp import Chrome, Tab, serve_root` resolves.

### cdp.py

A websocket client, a synchronous JSON-RPC loop, a static file server, a
Chrome launcher and a Tab wrapper. Python 3.12 standard library only; PIL is
imported inside `Tab.screenshot`, so a caller that never captures pixels needs
nothing else.

    server, port = serve_root()          # the repo root over http, free port
    chrome = Chrome(window=(1280, 800))  # one headless Chrome per run
    tab = Tab(chrome, 1280, 800)         # one tab per page, viewport preset
    tab.navigate(f"http://127.0.0.1:{port}/some/page.html")
    tab.evaluate("document.title")
    tab.close(); chrome.close(); server.shutdown()

`ROOT` comes from cdp.py's own `__file__`, so `serve_root` serves the repo and
not whichever tree the importing script sits in. The handler pins its own
`extensions_map`, because the Windows registry maps `.js` to `text/plain` and
that kills ES module loading. `serve_root(port)` returns the chosen port, so a
caller can pin one instead of taking a free one. `Chrome` kills the process
and removes the temp profile if the websocket connect fails, and
`Chrome.close` tolerates a socket `Browser.close` has already torn down. `Tab`
takes the device scale factor.

Chrome 151 headless needs `--headless=new` on this machine, and it ignores
`--load-extension`, which is why every caller loads the extension code into
plain pages behind the `__etymikonTestRuntime` stub instead.

### run_selfchecks.py

    python pipeline/run_selfchecks.py [--page index|embed|both] [--port N]
                                      [--timeout S] [--keep]

test-page/index.html and test-page/embed.html each carry hundreds of `check()`
assertions behind a "Run self-checks" button. Opening them in a browser is the
manual route; this is the unattended one. It serves the repo root, launches
one headless Chrome, and per page opens a tab at 1280x1000 at device scale 1,
waits for readyState and for `#run` and `#out`, reads `#out`, clicks `#run`
once, then polls until the text changes. It prints the counts, then every
failing line verbatim. Exit status is 0 only when every requested page
completed with no failing line.

What is asserted. The page's closing line and this parser are one contract,
written out in SPEC under "The headless self-check runner". A page writes its
whole transcript in one assignment to `#out`:

    PASS  <name>[   [detail]]     one line per passing check
    FAIL  <name>[   [detail]]     one line per failing check
    FAIL  threw: <stack>          an uncaught error inside the suite
    SKIP  <name>   [why]          one line per skipped check
    <blank>
    <n> passed, <m> failed[, <k> skipped]

A thrown error carries no prefix of its own: "FAIL  threw: " starts with
"FAIL  ", so the fail counter and the failing-line filter already hold it. A
transcript with no closing line is reported as DID NOT COMPLETE with the
page's own words printed, which is what both pages' early-return paths produce
when their test hooks are missing or when extension/lookup.js did not load.

The runner also checks itself against the page. If the closing line's numbers
disagree with the PASS, FAIL and SKIP lines it counted, it prints a warning,
because that means the transcript was not read the way the page wrote it.

1280x1000 is part of the contract. index.html sizes the panel from the
viewport (`wide = min(760, floor(vw * 0.85))`) and skips two clamp checks when
that lands under 560; at 1280 it is 760 and both run. Downloads are denied at
the browser level with `Browser.setDownloadBehavior`, independent of the
pages' own `__etymikonSuppressDownload` guard. stdout is reconfigured to
utf-8, since check names carry macrons.

The pages have to be served rather than opened from disk: they dynamic-import
extension/lookup.js, and the fake worker resolves and tiers through it.

### make_screenshots.py

    python pipeline/make_screenshots.py [--only 3,8] [--keep-temp]

Drives the staging pages in `screenshots/` through a headless Chrome and
writes the store screenshot set to the repo-root `screenshots/` directory:
`shots-page.html` for the in-page selection popup, `shots-panel.html` for the
side panel. Both load the REAL extension code against the REAL
`extension/data/*.json` behind `__etymikonTestRuntime`, so every pixel is the
product's own rendering and only the message transport is local. Each staging
page documents its query parameters in the comment at the top of the file.

A composite shot captures the page narrower and docks a panel capture beside
it, with the 1px separator Chrome draws between them: 919 + 1 + 360 = 1280.
Nothing lands in `screenshots/` until every shot has passed every check, so a
failed run leaves the committed set exactly as it was.

Adding a scene. A scene is one entry in the `SHOTS` list:

    {
      "n": 9,
      "name": "9-something.png",
      "kind": "page",              # or "composite" for page plus side panel
      "page": {"scene": "origin", "w": 420},
      "panel": {"view": "saved"},  # composite only
      "dark": True,                # optional, drives prefers-color-scheme
      "panel_w": 360,              # optional, overrides the 919/360 split
      "pixels": "seal",            # optional, adds the terracotta pixel test
      "checks": [POPUP_UP, head_is("territory"), IN_FRAME],
    }

`page` and `panel` are query strings for the staging pages. If the scene you
want does not exist yet, add it to the switch at the bottom of the staging
page rather than parameterising the shot further. The scene is where the
staging belongs, and the shot entry stays a description of what to capture.

What is asserted, per shot:

- Every expression in `checks` evaluates to `true` after the page signals
  ready and before anything is captured. The check helpers at the top of the
  file read through the content script's own test hook rather than poking at
  the DOM blind, and every string they look for is the SPEC's own wording:
  MADE OF, BUILDS N WORDS, FROM LATIN, "Used in N words", "Show 5 more (N)".
  A shot that no longer says what the SPEC says is not a shot worth shipping.
- `IN_FRAME` and `CHIPS_IN_VIEW` are geometry rather than text. A claim that
  reached the DOM but sits past the viewport edge, or below its own row, is
  invisible, and a shot that advertises a signal has to prove it reached the
  pixels.
- The image itself: exactly 1280x800, mode RGB, no transparency key.
- `"pixels": "seal"` adds a count of terracotta pixels in the panel's
  lower-right corner box, which is how a shot whose point is the corner seal
  proves the seal rendered. The predicate holds in both schemes.

## Other tooling in this directory

`make_icons.py` renders the epsilon seal icon set from the geometry in its
tuning table. `make_promo.py` builds the store promo tiles from the same
geometry, so the tile is the icon enlarged. `make_zip.ps1` packs
etymikon-<version>.zip. The mechanisms carry over from Okpyeon; the content is
Etymikon's. Neither is part of the data build and neither reads `cache/`.
