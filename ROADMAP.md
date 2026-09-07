# Roadmap

A release ledger. One block holds everything merged and not yet released,
and every bullet in it states the numbers as measured on this commit and
names the SPEC section holding its contract. Ordering within a block is
not priority order. Work in flight has no heading of its own; it becomes
a bullet in the top block on the day it merges.

## 1.0.0: merged and verified, ready for the first store submission

The manifest reads 1.0.0, so `pipeline/make_zip.ps1` writes
etymikon-1.0.0.zip and the sidebar footer reads "Etymikon 1.0.0". This is
the first store submission, so this block is the whole product and there
is no earlier release to compare against. It is written against this
commit on `origin-graphs`, which is the tree that merges to `main`;
`main` on its own still holds the data the costs section below measures
against. The work runs from 2026-08-24 to 2026-09-07. Suite counts on
this commit: 120 spot checks in a full build and 114 under `--verify`,
gold 305 of 305, 181 Node checks, 268 index-harness checks, 209
embed-harness checks, and 8 screenshots with their scene checks. The
counts in the bullets come from `extension/data/` and
`pipeline/cache/build-report.txt`, and are re-measured before every
upload, because one data rule change moves several of them at once. The
upload has an order of its own: declutter the README, write the store
listing from it, build the zip, smoke it in a clean Chrome profile, then
submit. The rest of the collateral is ready: the icon set and the promo
tiles.

- **The core loop.** Select a word, read its definitions and its morpheme
  breakdown, click any morpheme to its root card, walk the root's family,
  and come back on the breadcrumb trail. 61,137 words carry a breakdown
  and 14,733 carry an origin row. SPEC "UI, in-page popup and sidebar".
- **The origin subsystem, built from source graphs.** Latin and Greek are
  built as standalone graphs from templates and etymology prose, English
  attaches by any classical mention, the French group is walked as
  pass-through, and no origin is silenced. 14,733 origin rows: 7,134
  decomposed, 2,247 single, 5,352 naming a language that has no cards.
  Of the decomposed rows, 2,291 were answered by a template, 4,153 by an
  etymon field, 207 by prose, and 483 by parts the English page supplied.
  A gold set of 305 hand-verified rows scores every build and the score
  may not drop. Of the 1,752 words that named a classical origin and
  showed nothing under the old machinery, 553 now decompose, 1,016 show
  a single row, and 183 still show nothing. SPEC "Origin subsystem,
  source graphs".
- **Root cards.** 8,068 of them, 3,060 English, 3,542 Latin, 1,466 Greek.
  1,178 carry their own breakdown, 3,190 are anchors that recursion stops
  at, and 4,160 hold a one-word family. SPEC "Root card".
- **Proper nouns get cards.** A word built on a name reaches the name:
  darwinism opens Darwin. 1,141 English name cards ship, and 197 Latin
  and Greek cards are labelled names rather than roots. SPEC "A proper
  noun a word is built on is a card".
- **Register labels.** A definition states its register where the page
  marks one. 27,291 of the 185,487 shipped definitions carry a marker,
  spread over 17,567 words, and 136 root cards carry one. SPEC "Sense
  register labels".
- **Bidirectional families.** Word cards carry "Used in N words", the
  reverse of the morpheme graph, so the list of what English builds on a
  word is on the card instead of being something the reader has to guess
  exists. SPEC "Word card".
- **Lemmatization.** Inflected selections resolve to their lemma through
  110,719 mappings, 97,818 of them inflections and 12,901 alternative
  spellings. 5,612 shipped words shadow a lemma (ran, running) and carry
  an "Also a form of" row plus their lemma's origin row. SPEC "Data
  files (produced by pipeline/build.py)".
- **A general dictionary under the etymology.** 84,326 words in 24.7 MB
  of data, under the hybrid cap: everything attested in the top 50,000
  ranks, plus every rarer word carrying a breakdown, whether that
  breakdown is an English split or a classical origin chain that
  decomposes. American spellings are primary and British spellings
  resolve to them. SPEC "Product decisions".
- **Tier chips.** Everyday 2,649, Common 8,419, Advanced 18,190,
  Uncommon 55,068, nothing unranked. The cutoffs live in one function,
  and the build asserts every tier holds a word and that both label
  tables agree. SPEC "Tier chips" and "The fourth tier is Uncommon".
- **The sidebar shell.** Typed search, the `et` omnibox keyword, saved
  words in folders, Anki and CSV export, dark mode, the ἐτυμικόν corner
  seal, terracotta chrome matching the epsilon seal icon. The saved view
  draws every folder as a band, empty ones included, which is where a
  live defect was fixed. SPEC "The saved view's folder bands".
- **Curation as data.** Dead splits, hand glosses, root aliases, base
  routing, and skip lists live in pipeline/curation.py, each entry with
  its reason, so a field report becomes a one-line fix. 54 entries over
  nine tables, every one of them firing; an entry that stops firing fails
  the build on five of the nine tables. SPEC "Every curated entry must
  fire".
- **A headless check runner.** `python pipeline/run_selfchecks.py --page
  both` drives both browser harnesses over CDP and exits non-zero on a
  failure, so the browser suites run without a human pressing a button.
  SPEC "The headless self-check runner".

### What this release costs a reader

Measured against `main`, which holds 82,843 words and 3,021 roots. 1,526
words are new. 5,097 root cards are new. 6,744 words that main already
had gain a working chip. Against that:

- 43 words lose their card. The commonest of them ranks 52,222
  (fondant) and the rest are rarer. Several were wrong on main:
  portcullis read Latin colō, a card glossed "to cultivate the land,
  till", and falciparum read pariō split into pār and -iō.
- 30 words keep their card and lose their origin row. The row is
  withheld because the card's first senses come from more than one
  etymology section and a later section supplies more of them than the
  first. These are common words: found at rank 237, then polish, drake,
  cape, pose and boil.
- 596 words show fewer working chips. 483 of them are the ratified rule
  that a row stops at a lemma English already reaches and never runs past
  three chips, which moves the deeper split onto the card a chip opens,
  one click away; that card carries the split in 471 of the 483. 35 name
  a source language that has no cards until Old English lands, and the
  row is right where main was wrong: long, beer and offer read Old
  English where main read Latin. 30 are the withheld rows above. 28 show
  a single lemma where main showed a split, and several of those splits
  were wrong, as pizza reading Latin pictus was. 20 are an English
  breakdown whose chip lost its target, 10 of them a capitalised chip
  that was opening a page it does not name.

## Under consideration, in rough order of pull

- **Old English as a root language, phase two.** Middle English walked as
  pass-through beside it. 1,751 origin rows name Old English and cannot
  be clicked, 1,109 of them inside the top 10,000 ranks, which is the
  largest single hole left in the origin subsystem. SPEC "Origin
  subsystem, source graphs" holds the phasing.
- **The section-clash words.** 56 words state a classical origin and show
  nothing, because the card's first senses come from more than one
  etymology section and a later section supplies more of them than the
  first. Every one of them ranks inside the top 50,000 and 19 inside the
  top 10,000, so each is a reader selecting an ordinary word and getting
  no origin at all. The list with reasons is in
  `pipeline/cache/misses-report.txt`.
- **Cards that render nothing under the definitions.** 8,456 words carry
  neither a breakdown nor an origin row. 3,361 of those inherit a row
  from the lemma they shadow, which leaves 5,095 cards saying nothing
  about where the word came from, 198 of them inside the top 3,000 ranks.
  None are tail words: a word ships beyond rank 50,000 only by carrying a
  breakdown, so the whole set is inside the cap. The fix is more origin
  coverage rather than a new surface.
- **The homograph gap on chips.** A chip opens the right page at a minor
  sense, because a proper-noun page with many senses gives the card
  budget a small town or a surname before the famous referent. Darwin
  reads "A municipality of Río Negro province, Argentina." Measured at 9
  of 30 hand-checked chips in SPEC "Measured after the register round".
- **Pages that lead with section headings.** cat's noun senses read
  "Terms relating to animals" and the like, which is Wiktionary's page
  structure rather than a definition. The sense picker takes the first
  senses it finds and cannot yet tell a heading from a gloss.
- **Root gloss polish.** 192 of the 8,068 root glosses run past 100
  characters and 91 run past 120. The fix is more curation or a smarter
  clause picker.
- **Hover mode.** Okpyeon deferred it too. A hover surface changes the
  performance profile of every page, so it wants its own spike.
- **Pronunciation.** IPA text ships in the extracts and would cost only
  bytes; audio would not. Deferred from the first release by decision.
- **Old Norse as a root language.** Decided 2026-09-05: every attested
  language gets an origin row, and Old English becomes a root language
  first. 95 words inside the top 10,000 ranks read an Old Norse row (sky,
  die, odd) and 247 do in all, which makes it the one row-only language
  worth re-measuring for cards after that.
- **Browse roots by surface form.** One view for "ped" listing Latin pes
  beside Greek pais. Deferred from the first release by decision.
- **Selection lookups into an open sidebar.** The embed contract was
  built not to preclude it; it needs one worker message and a searchFor
  call.

## Not planned

- Proto-Indo-European. The drill-down stops at Latin and Greek by
  design; PIE is scaffolding, not vocabulary.
- Network features of any kind. The dictionary ships whole, and lookups
  stay offline.
- ESL-oriented definition rewriting. The audience decision is native
  vocabulary builders reading Wiktionary register.
