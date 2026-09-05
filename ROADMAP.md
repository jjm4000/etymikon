# Roadmap

Working list of planned changes. Ordering within a release is not priority
order. The next store upload ships whatever is merged and verified when
the submission clears.

## 1.0: merged and verified, awaiting store submission

Everything below is on `main`, adversarially reviewed, and covered by the
suites (Node, two browser harnesses, pipeline anchors, screenshot scene
checks).

- **The core loop.** Select a word, read its definitions and its morpheme
  breakdown, click any morpheme to its root card, walk the root's family,
  and come back on the breadcrumb trail. Words that English borrowed
  already assembled show the assembly under a FROM LATIN or FROM GREEK
  label naming the source word (territory reads territōrium, terra +
  -tōrium). A source word that is itself assembled carries its own
  breakdown on its root card (accēdō reads ad- + cēdō), and the base
  card's family counts through it.
- **Bidirectional families.** Word cards carry "Used in N words", the
  reverse of the morpheme graph, so absolute lists absolutely without
  the reader having to guess it exists.
- **Lemmatization.** Inflected selections resolve to their lemma, and
  shipped inflections that shadow one (ran, appreciated) carry an "Also
  a form of" row plus their lemma's origin row.
- **A general dictionary under the etymology.** 82,843 words with the
  hybrid cap: everything attested in the top 50,000 ranks, plus every
  rarer word carrying a breakdown, whether that breakdown is an English
  split or a classical origin chain that decomposes. American spellings
  are primary; British spellings resolve to them.
- **The sidebar shell.** Typed search, the `et` omnibox keyword, saved
  words in folders, Anki and CSV export, dark mode, the ἐτυμικόν corner
  seal, terracotta chrome matching the epsilon seal icon.
- **Curation as data.** Dead splits, hand glosses, root aliases, base
  routing, and skip lists live in pipeline/curation.py, each entry with
  its reason, so field reports become one-line fixes.

## Next: origin subsystem, source graphs (decided 2026-09-05)

The origin machinery is being replaced, not patched. SPEC.md "Origin
subsystem, source graphs" holds the ratified design: Latin and Greek
built as standalone graphs from templates and etymology prose, English
attaching by any classical mention, the French group walked as
pass-through, no origin ever silenced, a gold set scoring every build.
Phase two adds Old English as a root language with Middle English as
pass-through. A feasibility spike (pipeline/spike-origin.md) sizes the
prose parser before the build starts.

## Then: store release

- Write the store listing and submit. Collateral is ready: icon set,
  promo tiles, eight screenshot scenes with wording checks.
- A final smoke pass of the packed zip in a clean Chrome profile.

## Under consideration, in rough order of pull

- **Root gloss polish.** Around 130 root glosses still run long after the
  first-fitting-sense ladder; the fix is more curation or a smarter
  clause picker.
- **Hover mode.** Okpyeon deferred it too. A hover surface changes the
  performance profile of every page, so it wants its own spike.
- **Pronunciation.** IPA text ships in the extracts and would cost only
  bytes; audio would not. Deferred from v1 by decision.
- **Old Norse as a root language.** Decided 2026-09-05: every attested
  language gets an origin row, and Old English becomes a root language
  in phase two. Old Norse (139 top-10k words: sky, die, odd) is the one
  row-only language worth re-measuring for cards after that.
- **Browse roots by surface form.** One view for "ped" listing Latin pes
  beside Greek pais. Deferred from v1 by decision.
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
