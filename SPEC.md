# Etymikon, shared spec

Chrome extension (Manifest V3): select an English word on any page and a
popup card shows its definitions and its morpheme breakdown (subterranean
= sub- + terra + -an). Each morpheme opens a root card: the root's form,
source, gloss, and the English words built on it. All data ships inside
the extension, built from Wiktionary via kaikki.org extracts. Offline, no
network requests at runtime.

This repository is a fork of Okpyeon (github.com/jjm4000/okpyeon) at tag
v1.1.0. The Okpyeon SPEC.md this file replaces remains authoritative for
the shell mechanisms carried over (listed in "Carried-over shell"); read
it in the upstream repo or at tag v1.1.0 when a carried-over behavior
needs its full binding detail.

## Product decisions (ratified with Jesse, 2026-08-24/25)

- Name: Etymikon (Greek etymos "true sense" + -ikon, the lexicon
  formation). The K spelling is binding. Tagline (Jesse decision
  2026-08-25, the Okpyeon pattern with a colon): the manifest and
  store name is "Etymikon: Word Roots Popup Dictionary".
- Audience: native speakers building vocabulary (GRE/SAT register).
  Wiktionary definitions ship as harvested, no simplification pass.
- Dictionary scope: general English dictionary. Every shipped word gets
  a definition card. The breakdown row renders when a split exists,
  whatever the split's origin (Latinate and Germanic alike).
- Root node set: English affix entries (sub-, -an) and Latin/Greek
  lemmas (terra, logos). Drill-down stops there. Proto-Indo-European is
  out of scope everywhere, permanently for v1. Extended 2026-09-05:
  Old English lemmas join the root set in phase two of the origin
  subsystem (see "Origin subsystem, source graphs").
- Germanic affixes are IN (Jesse decision 2026-08-25, overriding the
  kickoff default): un-, fore-, -ful, -ness, -ly and their kin ship as
  ordinary en: roots with family lists. No origin filter applies to
  affix cards. Origin chains (`org`) stay Latin/Greek only.
  Superseded 2026-09-05: origin rows render for every attested
  language under the language-role table (see "Origin subsystem,
  source graphs").
- Morpheme chips split by target: a part that is itself a shipped word
  (muse in music, beauty in beautiful) links to that WORD card, not a
  root card. Root cards are for affixes and Latin/Greek lemmas only.
- Dictionary cap, the hybrid rule: every dictionary word ranked in the
  top 50,000 of the frequency list ships unconditionally; beyond rank
  50,000 a word ships only if it carries a morpheme breakdown AND is
  attested anywhere in the frequency corpus. The attestation clause was
  added at build bring-up (2026-08-24, flagged for owner ratification):
  without it Wiktionary's ~270k unattested affix coinages
  (nanovoltmeter, extremistical) ship and words.json is 53 MB; with it
  the dictionary is 76,496 words at 17.9 MB and the tail stays real
  (snarkiness, parapsychological, glucoside).
  Proper-noun-only entries never ship.
- Word tiers, from frequency rank: Everyday (rank 1 to 3,000), Common
  (to 15,000), Advanced (to 50,000), Rare (beyond, and unranked). Roots
  are not tiered; a root card shows how many shipped words it builds.
- v1 non-goals: hover mode, pronunciation (audio and IPA), PIE
  etymology, browse-roots-by-surface (ped as pes vs pais), non-classical
  origin chains (a Hebrew or Old Norse org row is future work, pending a
  measurement of family sizes), any runtime network request.
  The non-classical item was measured and decided 2026-09-05: row-only
  origin rows ship for every attested language, Old English becomes a
  root language in phase two (see "Origin subsystem, source graphs").

## Directory layout and ownership

Unchanged from Okpyeon: extension/ (manifest.json, background.js,
lookup.js, saved.js, content/, sidepanel/, data/, icons/), pipeline/,
test/, test-page/, SPEC.md at root. Pipeline owns extension/data/
contents. The placeholder rule carries over: fixture data files must
carry a top-level `"placeholder": true`; the build overwrites them
unconditionally.

Files dropped from the fork (delete in the purge milestone, with their
spec sections): extension/dubeolsik.js, pipeline/rr.py, data/rr.json,
data/variants.json, data/hanja.json, data/decomp.json, the decomposition
and recomposition features, the reading/homophone browse, romanized
search, QWERTY-to-hangul, the variant note, rare-homograph hedging.

## Data files (produced by pipeline/build.py)

All JSON, UTF-8, no BOM, compact, sort_keys, deterministic across runs.

### words.json

```json
{
  "v": 1,
  "words": {
    "subterranean": {
      "senses": [
        { "pos": "adj",
          "defs": ["Below the ground; underground."] }
      ],
      "morphs": [
        { "f": "sub-", "r": "en:sub-" },
        { "f": "terra", "r": "la:terra" },
        { "f": "-an", "r": "en:-an" }
      ],
      "fr": 61254
    }
  }
}
```

- Keys are lowercase lemmas and may contain apostrophes and internal
  hyphens (don't, x-ray). The frequency-rank parser accepts the same
  character set as word keys; review finding 2026-08-24: a ranks-side
  ^[a-z]+$ filter silently barred every hyphenated word from shipping.
  A word ships when it passes the hybrid cap and has at least one
  non-name English entry with at least one gloss.
- `senses`: one entry per part of speech, source order, max 4 POS
  sections, max 4 defs each, defs in full (the no-truncation rule
  carries over: never emit a cut string; a whole overlong sense may be
  dropped by a ~400 char safety cap).
- `morphs`: the breakdown, present only when the word has an accepted
  English-surface split (acceptance rules under Pipeline). `f` is the
  display form in split order. Exactly one of two link fields, or
  neither: `r` is the root key when the morpheme resolved to a shipped
  root card; `w` is a words.json key when the part is itself a shipped
  word (muse in music). A chip with neither renders inert. A morph
  never carries both.
- Word-part example: music carries
  `[{ "f": "muse", "w": "muse" }, { "f": "-ic", "r": "en:-ic" }]`.
- `fr`: rank in the frequency list; omitted when unranked. Tier is
  derived at runtime from `fr` by one pure function in lookup.js
  (cutoffs 3000/15000/50000); tiers are never stored in data files.
  The worker DOES join the derived `tier` string
  ("everyday" | "common" | "advanced" | "rare") onto every word match
  and family row, because the renderer is a classic script that cannot
  import lookup.js; the cutoffs still live in exactly one place.
- `org`: optional origin, present when the word has no `morphs` but
  its etymology chain reaches Latin or Greek. Two shapes (Jesse
  decision 2026-08-25, the FROM LATIN row):
  - Decomposed, when the chain's source lemma itself decomposes in
    the source-language extract:
    `"org": { "l": "territōrium", "lang": "la", "parts": [
    { "f": "terra", "r": "la:terra" },
    { "f": "-tōrium", "r": "la:-torium" } ] }`. `l` is the source lemma's
    display form, macrons kept. `parts` (2 or more) follow the morphs
    chip contract: `f` display form, `r` root key when that root
    ships, absent for an inert chip. A part may also carry `g`, the
    gloss the parent's own split gives it, which the worker joins
    over the root card's (see "Part senses", 2026-09-06). Parts come
    from the recursive flattening rule below.
  - Single, when the lemma does not decompose:
    `"org": { "r": "la:terra", "f": "terra" }` as before.
  A word never carries both `morphs` and `org`.
- Recursive flattening (supersedes the one-hop unification rule): the
  chain's source lemma is decomposed recursively WITHIN its source
  language, depth capped at 3, expanding a part only when every
  resulting piece still has an entry in that language's extract (the
  all-or-nothing spirit of Okpyeon's dead-end rule: a split that
  introduces an inert fragment teaches less than the whole part).
  ROOT_SKIPS and ROOT_ALIASES apply at every level. Affixes are
  TERMINAL: recursion never decomposes a part that is itself an affix
  (hyphen-bearing form or affix pos), because the affix is the
  teachable unit (field finding 2026-08-25: splitting -ārium into
  -ārius + -um scattered library and calendar onto a card glossed
  "genitive plural ending"). Root families anchor at the deepest
  bases this reaches. Where the source has no
  decomposition templates at all (Latin rememoror and memorō carry
  only prose etymologies, verified 2026-08-25), recursion cannot
  reach the base and ROOT_ALIASES is the stated tool: the memor
  group lands together in la:memor through four curated aliases,
  and remember keeps the SINGLE org shape pointing at la:memor.
  memorial reaches memor by drilling memorial to memory to its FROM
  LATIN row (it carries English morphs, and a word never carries
  both morphs and org).
- Latin and Greek AFFIX entries (la:re-, la:-ari) join the root node
  set through org parts, with kind from their entry pos and the
  composed labels already specced (Latin prefix, Greek suffix). The
  2-distinct-word ship threshold applies to them unchanged, and org
  parts credit families exactly as morphs `r` references do
  (per-word dedupe).
- `fo`: optional, on shipped words that ALSO carry INFLECTION form-of
  senses pointing at a shipped lemma (ran has a marginal noun sense,
  so it ships as a word and shadows run at lookup time): the lemma
  key. Only inflection links qualify, for `fo` and for forms.json
  alike: the sense must be `form_of` (never `alt_of`) and tagged as an
  inflection (plural, past, participle, comparative, superlative,
  person markers). Abbreviation, initialism, misspelling, eye-dialect,
  and alternative-form links never produce a mapping (review finding
  2026-08-24: without this rule "the" carried fo "thee", "a" carried
  "to", and don't hard-redirected to done; 676 of the top 3,000 words
  were affected; measured post-fix as 202 corrected top-3,000 corpus
  tokens).
- Alternative-spelling exception (Jesse decision 2026-08-25): an
  alt_of sense DOES produce a forms.json mapping when its tags mark it
  as an alternative or standard spelling of a shipped lemma AND no
  excluded class applies (misspelling, abbreviation, initialism,
  eye-dialect, pronunciation spelling, obsolete, archaic, dated).
  Rationale: pure alt-spelling pages (favorite, neighbor, e-mail)
  define nothing themselves and were unreachable, 918 keys in the top
  50,000. The exact accepted tag set is enumerated in build.py from
  the real tag distribution, and the surface must itself be a
  non-shipped page (shipped words never redirect).
  Anchors: e-mail resolves to email; okay resolves to ok;
  favorite and neighbor are anchored under the US-primary rule below,
  which inverts their direction.
- Gloss-prefix extension (Jesse decision 2026-08-25): a pure alt-of
  page whose sense gloss BEGINS with an explicit spelling statement
  qualifies even when untagged (the 31-key residue: humor, dialog,
  enquiry, recognise carry the statement in prose only). The accepted
  prefix set is enumerated in build.py from the real gloss
  distribution (the shape "US spelling of", "American standard
  spelling of", "British form of", "Uncommon spelling of" and kin);
  the same exclusions apply, and a gloss stating the page is the US
  spelling of a shipped lemma ALSO qualifies the pair for US-primary
  re-keying below, through the same rename machinery and integrity
  checks. Anchors (verify before asserting): humor is a words.json
  key carrying wik humour; enquiry resolves to inquiry; dialog
  resolves to dialogue.
  the/a/of/yeah map to nothing under this rule.
- US-primary re-keying (Jesse decision 2026-08-25): when a shipped
  lemma's American spelling is a pointer page whose own tags mark it
  as the US or American standard spelling, the emit re-keys the whole
  record to the US form: it becomes the words.json key, the card
  headword, the family-row and omnibox and saved-item and export
  surface. Every internal reference repoints (forms map targets, fo
  fields, morphs `w` chips), and the British form enters forms.json
  mapping to the new key, so both spellings resolve and the
  inflection-note names whichever was selected. Detection is from the
  pointer page's tags only, never a hardcoded word list; pairs where
  both spellings ship full entries are left alone. A re-keyed word
  carries `wik`: the Wiktionary page title that actually holds the
  content (the British form), because the US page is a pointer.
  Definition texts ship as harvested and may contain British
  spellings internally; that is accepted. A re-keyed word's `fr` is
  re-measured as the better (lower) rank between the two spellings,
  and the tier follows (Jesse decision 2026-08-25: the concept's
  frequency is whichever spelling readers actually use; favorite
  ranks 1,237 as itself against 3,326 as favourite and its chip must
  say Everyday).
  Anchors: favorite is a words.json key; favourite maps to favorite
  in forms.json; favorite's card links to the favourite page;
  neighbor is a words.json key with favourite-style behavior
  (verify and pin the exact pair set member during build).
- Mixed-page shadow rows (Jesse decision 2026-08-25): `fo` is also
  harvested PER SENSE, not only from pure form-of entries. A shipped
  word whose page carries lemma senses beside inflection-tagged
  form_of senses (is, had, going, people, teeth: 109 words measured,
  23 inside the top 3,000) gets `fo` from the first inflection-tagged
  form_of sense whose target is a different shipped word, in sense
  order (multi-lemma pages like best keep the first target only).
  The same inflection-tag filter guards this path; alt_of senses
  never feed it. Anchors: is carries fo be; had carries fo have;
  teeth carries fo tooth; people carries fo person.
  Anchors carried from the inflection rule: the/a/of/it carry no fo;
  don't never redirects to
  done; ran keeps fo run. Contractions cannot ship at all on this
  corpus: OpenSubtitles tokenizes don't as don plus 't, so no
  apostrophe-bearing token is ever attested. The apostrophe charset
  stays correct and simply has nothing to match today.
  Rationale: a reader selecting "ran" wants run; the shadow entry must
  hand them a way there. The worker passes it through as `seeAlso` on
  the word match and the renderer shows a quiet nav row (below).
- Inherited origin (Jesse decision 2026-08-25): a word carrying `fo`
  but neither `morphs` nor `org` INHERITS its lemma's `org` on the
  wire: the worker attaches the fo target's org (either shape, glosses
  joined as usual) to the match at lookup time. The row is as true of
  the inflection as of the lemma (appreciated shows FROM LATIN
  appretiō beside its Also-a-form-of row; the English inflection
  suffix is never mixed into the Latin assembly). Morphs are never
  inherited: a MADE OF claim describes the lemma's own English
  assembly. Worker-side only; nothing is stored.

### roots.json

```json
{
  "v": 1,
  "roots": {
    "la:terra": {
      "form": "terra",
      "alt": ["terr-"],
      "lang": "la",
      "gloss": "earth, land",
      "kind": "root"
    },
    "en:sub-": {
      "form": "sub-",
      "lang": "en",
      "src": "la:sub",
      "gloss": "under, beneath",
      "kind": "prefix"
    },
    "la:accedo": {
      "form": "accēdō",
      "lang": "la",
      "gloss": "to go or come toward, approach, reach",
      "kind": "root",
      "parts": [
        { "f": "ad-", "r": "la:ad-" },
        { "f": "cēdō", "r": "la:cedo" }
      ]
    }
  }
}
```

- Key scheme: `<lang>:<form>`. `lang` is one of `en` (English affix or
  combining form), `la` (Latin, including Medieval/Late/New), `grc`
  (Ancient Greek, including Koine).
- `form`: the headword form shown on the card. Greek forms are shown in
  Greek script with a romanization: `"form": "λόγος", "rom": "logos"`.
- `alt`: variant surface forms aliased onto this card (terr-, terra).
  Aliases are how two words split as terr- and terra land on one card.
- `gloss`: short English gloss of the root, from the source-language
  extract entry, falling back to the most common `t=` template arg.
  Card budget: take the FIRST sense at or under 80 characters in
  source order (shortest-wins was tried and degraded terra to "earth"
  and λόγος to "subject matter"; source order keeps the primary
  sense); when none fits, take the first clause of the first sense
  (split at the first semicolon or period, skipping abbreviation
  dots) and only then fall back to the 160 character safety cap. ROOT_GLOSSES overrides win over everything
  (review finding 2026-08-24: 92 shipped roots carried sentence-length
  usage notes into the chip subtext).
- `kind`: `prefix`, `suffix`, `infix`, `circumfix`, or `root`, taken
  from the harvested entry pos, never re-derived from hyphen shape
  (review finding 2026-08-24: shape-guessing labeled 10 interfixes as
  suffixes and the one circumfix as a root). Label lines compose
  language and kind: en affixes say just "Prefix", "Suffix",
  "Interfix", "Circumfix"; classical roots always name their
  language, whatever the kind: "Latin root", "Latin prefix", "Greek
  suffix", "Greek root"; a plain English combining form says "English
  root". Anchor: en:-o- ships with kind infix.
- `src`: for `en:` affixes whose entry derives from a Latin/Greek
  lemma, the key of that lemma's card when shipped. Renders as one line
  on the affix card ("From Latin sub ›") and navigates to it.
- `parts` (owner decision 2026-09-01): on ANCHOR roots only, the
  anchor's own split in the org.parts shape, `[{f, r?}]`, produced by
  the same flatten() the word rows use. Recursion stops at other
  anchors, affixes are terminal, and a part whose root does not ship
  stays inert with `f` alone. Affix roots and plain roots never carry
  the field, and an anchor whose lemma has no split in its extract
  (cēdō, θεός) does not either. See "Anchor cards carry their own
  breakdown".
- A root ships when at least 2 DISTINCT shipped words reference it
  (via `morphs` or `org`); a word whose split repeats a morpheme
  counts once, in the build's threshold and verify exactly as in the
  runtime family index (review finding 2026-08-24: the build counted
  per morph and could ship a root whose family renders one word). A
  reference to an anchor is a reference to every root the anchor's
  `parts` name, recursively, in the threshold as in the index (see
  "Root families credit through anchors"). The family list is never stored; the worker derives the
  root-to-words index from words.json and the `parts` in roots.json at
  runtime, ranked by `fr`
  ascending, unranked last, ties by key. Any pipeline change to morphs
  changes families on the next worker start with no other work
  (Okpyeon's recomposition property, carried over as a binding
  architectural rule).

### forms.json

```json
{ "v": 1, "map": { "territories": "territory", "walked": "walk" } }
```

- Inflected form to lemma, harvested from kaikki form-of entries.
  Contains only forms whose lemma ships, and only forms that are not
  themselves shipped words. Runtime fallback rules live in lookup.js
  (below) for forms the map misses.

## Message protocol (content script and sidepanel to service worker)

`{ "type": "lookup", "text": "subterranean" }` responds:

```json
{
  "ok": true,
  "matches": [
    { "kind": "word", "surface": "Subterranean", "canonical": "subterranean",
      "senses": [ ... ], "fr": 61254,
      "morphs": [
        { "f": "sub-", "r": "en:sub-", "gloss": "under, beneath" },
        { "f": "terra", "r": "la:terra", "gloss": "earth, land" },
        { "f": "-an", "r": "en:-an", "gloss": "forming adjectives" }
      ] }
  ]
}
```

- The worker joins each morph's gloss into the response (the content
  script never reads roots.json): `r` chips get the root gloss, `w`
  chips get the word's first def. Morphs with neither come back as
  `{ "f": "..." }` only. `w` chips keep `w` in the response so the
  renderer navigates them as word lookups.
- A lookup resolved through lemmatization carries
  `"formOf": { "surface": "territories", "lemma": "territory" }` and
  the match body is the lemma's.
- Word matches pass through `wik` when the entry carries it (the
  US-primary re-key case): the Wiktionary page title the card must
  link to instead of the canonical key.
- Used-in (Jesse decision 2026-08-25, the Okpyeon "Used in N larger
  words" analog): word matches carry `usedInCount` (omitted when 0),
  the number of shipped words whose `morphs` reference this word by
  `w`. `{ "type": "usedIn", "key": "absolute", "offset": 0 }` answers
  `{ "ok": true, "rows": [...], "total": N, "offset": 0 }` in the
  family chunk shape and size, rows ranked by `fr` ascending,
  unranked last, ties by key. The index derives at runtime from
  words.json exactly like the family index (never stored; the
  recomposition property applies) and is cleared with the data cache.
- `org` words carry their shape with glosses joined: decomposed
  `"org": { "l": "territōrium", "lang": "la", "parts": [ { "f": "terra",
  "r": "la:terra", "gloss": "dry land" }, ... ] }` (parts follow the
  morphs join rules: `r` chips get the root gloss, partless chips get
  `f` only); single `"org": { "r": "la:terra", "f": "terra",
  "gloss": "earth, land" }`.
- On failure: `{ "ok": false, "error": "message" }`. No match:
  `{ "ok": true, "matches": [] }`.

`{ "type": "root", "key": "la:terra" }` responds:

```json
{
  "ok": true,
  "root": { "key": "la:terra", "form": "terra", "lang": "la",
            "gloss": "earth, land", "kind": "root",
            "familyCount": 23,
            "family": [
              { "word": "terrain", "def": "An area of land.", "fr": 4712 }
            ] }
}
```

- `family`: the first 8 of the derived index (ranked as specified under
  roots.json), each with the word's first def, `fr`, and `tier`.
- `parts`: on an anchor root, its `parts` joined exactly as a word's
  org parts are (`r` chips get the root gloss, partless chips come
  back as `f` only): `"parts": [ { "f": "ad-", "r": "la:ad-", "gloss":
  "to, toward" }, { "f": "cēdō", "r": "la:cedo", "gloss": "to go, move,
  proceed" } ]`. Absent on every other root.
- `{ "type": "family", "key": "la:terra", "offset": 0 }` returns ONE
  CHUNK of the ranked list: `{ "ok": true, "rows": [...], "total": N,
  "offset": 0 }`, chunk size 200, same row shape. Rationale (found in
  build bring-up, 2026-08-24): Germanic affix families run to
  thousands of rows (en:-ly builds about 4,000 shipped words under
  the attested cap, roughly 350 KB serialized; pre-attestation it was
  14,335), so the old fetch-once contract is replaced by chunks. The UI's "Show
  5 more (N)" pages locally within fetched chunks and requests the
  next chunk only when its local rows are exhausted. The whole-card
  rule keys on `total` against the inline cap. `offset` defaults to 0.
- Unknown key: `{ "ok": true, "root": null }`.

`{ "type": "openTab", "url" }` carries over unchanged, validating the
url against the Wiktionary base.

Service worker lookup behavior:

1. Extract the word from `text`: trim, take the first token of letters,
   apostrophes, and internal hyphens (`/[A-Za-z][A-Za-z'-]*/`), cap 40
   chars. No token: empty matches.
2. Fold for lookup: NFC-normalize, then lowercase. The same fold
   applies at every boundary: token extraction, omnibox input, root
   keys arriving in messages, and saved-item keys (review finding
   2026-08-24: the rewrite dropped NFC everywhere and NFD keyboard
   input could not reach the 110 Greek root keys). `surface` preserves
   the selected casing, `canonical` is the matched key (the Okpyeon
   surface/canonical pattern, reused for case and inflection instead
   of variants).
3. Resolve: exact key in words.json; else forms.json; else suffix rules
   in order (s, es, ies to y, ed, ing with doubled-consonant and
   dropped-e repair, er, est), first rule whose result is a shipped
   word wins; else empty matches.
4. Data files load lazily on first use and cache in module variables,
   Okpyeon's getData pattern, three files: words.json, roots.json,
   forms.json. The root-family index builds lazily on first root or
   family request and clears with the data cache.

## UI, in-page popup and sidebar

The shell carries over whole (see Carried-over shell). This section
specs the English cards. Every section follows the card section
convention: one `appendX(card, m)` function, one call site, reads only
its slice of the match, first act is its enabled-predicate (all return
true until a settings toggle ships).

### Word card

Sections in order:

- `appendWordHead`: the headword (canonical) as the big text, the tier
  chip, the star (save action registry), the Wiktionary link top-right
  (`https://en.wiktionary.org/wiki/<canonical>#English`, background
  open rules carried over; a match carrying `wik` links to that title
  instead, since a re-keyed US headword's own page is a pointer).
  When `surface` differs from canonical by
  more than case, a small note in the head meta box: "territories →
  territory" (the variant-note slot, repurposed for inflection; same
  stale-surface rule: the note renders only in the view looked up from
  that surface).
- `appendGlosses`: per POS section, a small uppercase POS label (NOUN,
  VERB, ADJECTIVE, ADVERB, other tags as harvested), then the numbered
  sense list. Numbering, 2-line clamp, geometry-derived "more" expander
  all carried over.
- `appendBreakdown`: the morpheme row, label "MADE OF" in the house
  label style. Chips joined by "+": each chip shows `f` on top and the
  root gloss beneath in small muted text (gloss absent: form only).
  Chips with `r` are nav chips (hover, chevron-free, keyboard
  activation) opening that root card as an ordinary drill-down with
  breadcrumbs. Chips with `w` are nav chips opening that word's card
  via an ordinary lookup drill-down. Chips with neither are inert and
  render without the hover affordance; an inert chip carrying `g`
  states that gloss, which is how a proper noun says what it names.
  Chip gloss text is cut to its first clause past 90 characters and
  then clamps to 2 lines with a bounded chip width; the chip is the one
  place a long root gloss must never dominate the card, and the card
  the chip opens keeps the gloss whole. Section absent when no
  `morphs`.
- Navigation selection guard: a nav activation is suppressed only when
  the current selection lies INSIDE the panel's shadow root (the
  text-copy affordance). The page selection that opened the popup does
  not suppress navigation (review finding 2026-08-24: Chrome's closed
  shadow getSelection reflects the page selection, and the guard as
  written killed every nav row in the select-then-click flow).
- `appendOrigin`: for `org` words, by shape. Decomposed org renders a
  chip row exactly like appendBreakdown's, under the label
  "FROM LATIN territōrium" (or FROM GREEK): the label word is in the
  house uppercase label style, the lemma beside it italic in normal
  case, macrons kept. Chips are the morphs chip anatomy verbatim:
  form over gloss, `r` chips navigate to root cards, chips without
  `r` inert. Single org keeps the quiet nav row: "From Latin terra
  (earth, land) ›", navigating to the root card. Absent when no
  `org`. A word card never renders both this and the breakdown (data
  invariant).
- `appendSeeAlso`: for matches carrying `seeAlso`, one quiet nav row
  last in the word body: "Also a form of run ›", an ordinary lookup
  drill-down to the lemma. Absent otherwise.
- `appendUsedIn`: for matches carrying `usedInCount`, one quiet nav
  row after the breakdown or origin section and before appendSeeAlso:
  "Used in N words ›". Tapping navigates (Okpyeon's usedIn pattern:
  a list view, not in-place expansion) to a `usedin:<key>` view
  titled by the word, rows in the family-row format (word, first def,
  tier chip), each an ordinary lookup drill-down, cached per view.
  The view shows the COMPLETE ranked list, scroll-fed by chunks
  exactly like the "Built on" drill view: chunk 0 on open, the next
  chunk whenever the last rendered row approaches the viewport, no
  pager buttons inside the view (Jesse decision 2026-08-25: a pushed
  list view always shows the full index; the earlier preview-plus-
  Show-5-more inside this view contradicted the drill contract).
  The crumb is labeled "Used in" (Jesse decision 2026-08-25,
  mirroring Okpyeon's "Part of" crumb; labeling it with the word
  stuttered the trail: appreciated then appreciated). Absent when no
  `usedInCount`.

### Root card

- `appendRootHead`: the form as the big text (Greek script keeps the
  romanization beside it in muted text), the star, the Wiktionary link
  top-right (en: keys link to
  `https://en.wiktionary.org/wiki/<form>#English`; la: to `#Latin`;
  grc: to `#Ancient_Greek`, all encodeURIComponent). A label line under
  the form: "Latin root", "Greek root", "Prefix", "Suffix" (kind and
  lang joined in plain English; en affixes say just "Prefix"/"Suffix").
- `appendRootGloss`: the gloss as a single sense line ("earth, land"),
  same clamp rules.
- `appendRootParts` (owner decision 2026-09-01): for anchor roots
  carrying `parts`, the chip row under the label "MADE OF", the same
  buildChipRow and the same label the word card uses. Chips with `r`
  open that root card as an ordinary drill-down, root to root, with
  breadcrumbs; partless chips are inert. Absent when no `parts`. Both
  surfaces render it through the one content.js renderer the sidepanel
  embeds.
- `appendRootSource`: for en: affixes with `src`, one quiet nav row in
  the appendOrigin style, gloss included when the source lemma has
  one: "From Latin sub (under, beneath) ›". Absent otherwise.
- `appendFamily`: label "BUILDS N WORDS". The first 8 family rows
  inline: word, first def, tier chip, nav rows drilling into word
  cards. Below them the carried-over pagination contract verbatim:
  "Show 5 more (N)" requests `{type:"family"}` once, pages locally,
  whole-card rule included (if inline rows plus remainder fit the
  inline cap, fetch up front and render whole).

### Show all

Ported 2026-08-25 from Okpyeon commit a5e95e4 per the owner's porting
note; the fork base predates it. Wherever a card section paginates in
place over a long index (the family section is the one such section
today), a second control "Show all (N)" sits beside "Show 5 more (N)"
and opens the COMPLETE ranked list as its own view. Contracts, from
the note: the two controls appear and disappear together, only when a
genuine second page exists (the whole-card rule hides both;
exhausting in-place reveal removes both); the pushed view always
shows the full index regardless of inline reveals; the click is
sequence-guarded and never read as a row click; on failure nothing
navigates and the control stays pressable as the retry path; N
starts from the match's familyCount and corrects to the fetched
total. The view: key namespace `family:<root key>` (distinct from
usedin:, since a root form can equal a word), title "N words built
on terra" (English words do not literally contain their roots, so
Okpyeon's containment wording is not portable), crumb label "Built
on", rows in the family-row format through the SAME row builder as
the inline section and the used-in view. Adaptation to the chunked
family protocol: the view loads chunk 0 on open and fetches the next
chunk whenever the last rendered row approaches the viewport, until
total; no pager buttons inside the view; a quiet loading row shows
while a chunk is in flight. Consistency guard (the note's b65b804
lesson): a harness check diffs one card's inline rows against its
view rows field by field; both must come from the one familyRow
join.

### Tier chips

The badge registry carries over. Four mutually exclusive entries keyed
off the derived tier:

- Everyday: green tint; title "Rank in the 3,000 most frequent English
  words (OpenSubtitles corpus)"
- Common: blue tint; title "Rank 3,001 to 15,000 by frequency"
- Advanced: amber tint; title "Rank 15,001 to 50,000 by frequency"
- Rare: grey tint; title "Beyond the 50,000 most frequent words, or
  unranked (Etymikon's classification)"

Word cards and family rows render exactly one. Root cards render no
tier chip; the family count line is the root's weight signal.

### Search, omnibox, saved, settings

- Sidebar search accepts typed words; the interpretation machinery
  (Dubeolsik, romanization) is deleted, every query is a literal lookup
  after the same token extraction. Search-as-you-type debounce, IME
  guards, deep links, empty states carry over.
- Omnibox keyword: `et`. Suggestions from a pure
  `buildOmniboxSuggestions(text, data)`: prefix matches on word keys
  first (ranked by `fr`), then root forms (ranked by family count),
  max 5, description shows the first gloss, content is the canonical
  key. For root rows the canonical key IS the root key (la:terra,
  en:-ful), so the search shell detects `^(en|la|grc):` on any typed
  or handed-off query (typed input, ?q= deep link, pending query) and
  requests `{type:"root", key}` instead of a lookup; all other queries
  stay ordinary lookups. The pending-query handshake and sidebar retarget carry over
  unchanged.
- Saved items: `kind` is `"word"` or `"root"`, `key` is the word key or
  root key. The bubble, folders, grouped saved view, live star sync all
  carry over. Saved row secondary text: word rows show the first def;
  root rows show the gloss.
- Anki settings schema, replacing the Korean fields. Word cards: front
  `word` | `defs`; back checkset `word`, `defs`, `breakdown` (the
  morphs joined "sub- + terra + -an"), `tier`. Root cards: front
  `root` | `gloss`; back checkset `root`, `source` (the label line),
  `gloss`, `family` (top 5 family words joined ", "). Defaults: word
  front `word`, back [`defs`, `breakdown`]; root front `root`, back
  [`gloss`, `family`]. CSV columns: kind, key, defs/gloss, breakdown,
  tier, folder, added.
- Brand: the sidebar wordmark is "Etymikon" (plain text, no CJK font
  stack), aria-label "Etymikon: back to search". Clicking it is HOME
  (Jesse decision 2026-08-25, replacing the Okpyeon self-lookup,
  which read as a bug here because Etymikon is not an entry): it
  shows the search view, clears the input and results to the empty
  state, and resets the view stack; it never runs a lookup. The
  attribution that has no surface today moves to the settings view:
  a static muted footer block under the schema-rendered controls
  reading "Etymikon <version>. Definitions from Wiktionary,
  CC BY-SA." with the version read from the manifest and a link to
  the GitHub repository (background-open rules apply). The corner
  seal keeps its
  mechanism (fit-gated, z-index rules) with new artwork: the Greek word
  "ἐτυμικόν", the app's name in its native Greek shape, in the seal
  frame (Jesse decision 2026-08-25, replacing the earlier ἔτυμον).
  Brand color (Jesse decision 2026-08-25, mirroring Okpyeon's jade
  wordmark and seal): the sidebar wordmark and the seal render in the
  icon's primary terracotta (#C0552B) in light mode, with a lightened
  warm variant in dark mode chosen to clear contrast against the dark
  ground, the same treatment the jade had. The Aegean ring blue stays
  the icon's secondary and is not used for page chrome.
  Fonts: system stack everywhere; the
  Batang/serif rules are deleted.
- Icon (chosen 2026-08-25, rendered by pipeline/make_icons.py): a bare
  lowercase epsilon in Georgia Bold, cream (#FFF7F0) on a terracotta
  clay ground (#C0552B) inside an Aegean blue ring (#9FC3E8), rounded
  seal corners, the glyph at em 1.20 of the canvas so it reaches the
  ring without crossing it. Reference geometry in the tool's
  docstring. The 16px asset drops the ring and enlarges the glyph.
  The bare epsilon is binding: no diacritics at icon size.

## Pipeline (build.py rewrite)

Skeleton carries over: download-if-missing with curl resume and remote
size check, cached corpus files in pipeline/cache/, stream-parse, emit,
verify, `--verify` and `--force-download` flags.

`--offline` (2026-09-01) skips the remote size check and builds from
whatever is in pipeline/cache/, failing loudly when a source file is
missing. kaikki republishes the extracts on its own schedule, and the
size check restarts a download whenever the remote differs, so an
ordinary build can swap the corpus out mid-task and move every number in
the report. A run that has to be comparable to the run before it uses
this flag. It contradicts `--force-download`, and saying both fails.

Sources:

- kaikki.org English extract (jsonl.gz, ~500 MB): entries, splits,
  chains, forms.
- kaikki.org Latin extract and Ancient Greek extract (jsonl.gz): root
  lemma glosses only.
- hermitdave/FrequencyWords en_full (OpenSubtitles 2018): ranks. Rank
  assignment: first occurrence of each token matching the word-key
  charset (lowercase letters, apostrophes, internal hyphens),
  1-based. The spike's `^[a-z]+$` rule is superseded; it barred every
  hyphenated word.

Parsing rules, English extract:

- An entry counts toward a word when `word` lowercases to the key and
  `pos` is not `name`. A word whose entries are all `name` never ships.
  Senses harvest: first gloss line of each sense, per POS, caps as in
  the schema. Entries that are pure form-of (every sense carries
  form_of/alt_of) contribute to forms.json, not senses.
- Split harvest: etymology_templates with name in {prefix, pre, suffix,
  suf, affix, af, confix, compound, com, surf, "surface analysis",
  univerbation} and arg 1 exactly `en`, plus the structured `etymon`
  template's affix records (Jesse decision 2026-08-25: Wiktionary is
  migrating to etymon, the source-language pass already reads it, and
  7,758 English splits lived only there, abolitionism and absentee
  among them; every acceptance rule below applies to etymon-sourced
  splits identically). Parts are positional args 2
  onward: strip inline modifiers (`<...>`), section suffixes (`#...`),
  and language prefixes (`xx:`); drop empties; prefix/suffix templates
  get their hyphens restored on the affix arg. A split needs 2 or more
  parts.
- Split selection when a word has several entries or templates: prefer
  the split from the entry with the most senses (the dominant
  homograph, the rule that keeps number = numb + -er off the count
  noun); among templates on one entry prefer surf over the others
  (surface analysis is the reader-facing layer); curated overrides win
  over everything.
- Inflectional-split suppression: a suffix-type split whose suffix is
  one of -s, -es, -ed, -ing, -est, -'s is not a breakdown; the word
  keeps its card with no morphs. (-er splits survive; the dominant
  homograph rule handles the comparative cases.)
- Curation module pipeline/curation.py (the decomp.py pinned-anchor
  idea): `BLOCKED_SPLITS`, words whose harvested split is
  etymologically true but semantically dead, seeded with understand,
  but, been, little, no, none, never, yeah; `FORCED_SPLITS`, hand
  splits that override harvest; `ROOT_ALIASES`, surface form to root
  key (terr- to la:terra); `ROOT_SKIPS`, chain nodes never emitted as
  roots (Old French steps, Middle English steps); `ROOT_GLOSSES`,
  hand glosses overriding the harvested one where Wiktionary's sense
  ordering picks a bad card gloss, seeded with en:-ness, en:-ly, and
  en:-y (their harvested first senses are usage notes, not glosses);
  `BASE_ROUTES` (below); `ROOT_STOPS`, source lemmas recursion must
  never split, empty in the healthy state; `LEMMA_STEPS`, source-
  language lemma to the lemma a chain steps to before it is judged,
  language-qualified keys (see "Lemma steps and self-part splits").
  Every list is data,
  reviewed in PR diffs, and each entry carries a one-line reason
  comment.
- Origin chains: for words without an accepted split, walk der/bor/inh
  and learned-borrowing templates in entry order; the chain's root is
  the LAST template whose lang arg is Latin ({la, la-cla, la-lat,
  la-med, la-ecc, la-new, la-vul, ML, ML., LL, LL., NL, NL., VL, VL.})
  or Greek ({grc, grc-koi, gkm}), taking that template's lemma arg.
  Chains that reach only ine-pro or nothing yield no org. The `etymon`
  template's structured tree may replace this walk if it proves more
  reliable; the anchors decide, not preference.
- The `+` template variants are harvested too (2026-09-01, owner field
  report: component showed no breakdown). Wiktionary now also writes
  der+, bor+, inh+ and their kin, which are the same templates with an
  identical arg layout and a category added. Reading only the plain
  names cost 294 shipped words their whole chain: component's only
  classical template is a bor+, so it shipped no FROM LATIN row while
  compose beside it decomposed on the same lemma. A census of the
  English extract has bor+ on 2,285 classical targets and der+ on 98.
  lbor+, slbor+, ubor+ and uder+ are in the set as well; they do not
  appear in the extract yet, and a name that never fires costs
  nothing. Nothing downstream changed: component's compōnēns steps to
  compōnō through the form-of hop and flattens to con- + pōnō, the
  same row compose already carried.
- The `+` decomposition variants are harvested too (owner decision
  2026-09-01). `com+` and `compound+` are the category-adding variants
  of `com` and `compound`, and the census found them at 631 and 45 uses
  in the English extract, both under CENSUS_MIN, so the gate never
  spoke up. Their arg layout is identical to the plain names, verified
  against the extract: arg 1 is the language code and the parts run
  from arg 2 (com+ on homeworld is home + world, compound+ on
  elderberry is elder + berry). They are the only `+` variants of a
  decomposition name the extract carries; the whole `+` census is
  bor+, m+, inh+, com+, der+, compound+, l+. Reading them gave 84 words
  past the cap a card they had no other route to and 35 already-shipped
  words their first morphs row, bankroll, chainsaw, doghouse and
  skyscraper among them.
- Root unification hop (validated 2026-08-24: chains stop at the
  derived lemma, terrain reaches la:terrenum, territory reaches
  la:territōrium, terrestrial reaches la:terrestris, three cards where
  the reader wants one): when a chain-derived Latin/Greek lemma's own
  entry in the source-language extract carries a decomposition template
  (same template set, lang arg `la`/`grc`) whose base part has an entry
  in that extract, anchor the root at the BASE lemma (terra) and record
  the intermediate in ROOT_ALIASES automatically. One hop only, never
  recursive, and never past the source language. A lemma with no such
  split anchors as itself. Words whose story lives in their morphs
  (television = tele- + vision) need no chain at all; org is only for
  split-less words, per the schema invariant.
- Morpheme resolution, `morphs[].r` and `morphs[].w`, in order: a part
  carrying a hyphen (or whose entry pos is prefix, suffix, infix, or
  "combining form") maps to `en:<part>` when that affix entry exists;
  a hyphen-free part that is a shipped words.json key maps to `w`;
  ROOT_ALIASES override either (terr- to la:terra); else the chip is
  inert. Germanic affixes resolve exactly like Latinate ones; there is
  no origin filter on `r`. en: affix roots get `src` when their own
  etymology chain reaches a Latin/Greek lemma by the chain rule; a
  Germanic affix simply has no src row.
- Base routing (Jesse decision 2026-08-25, the shape inverted from
  the first ratification after measurement): a curated route-list,
  `BASE_ROUTES` in curation.py, maps an English base part to a
  classical root key, and morph resolution honors it ahead of the
  `w` rule, GATED on the word's own chain reaching that root
  (build-verified 2026-08-25: ungated, the port entry alone would
  have rerouted airport and 33 other harbor words to a Latin verb;
  transport routes through trānsportō, airport never routes).
  It fails closed: no English word card is ever traded for
  a classical one without a signed-off entry carrying its reason.
  Guard anchors: airport, lakeview, soundboard, and undercurrent
  keep their word chips.
  Rationale: subscribe's surface split paired the scribe chip with
  the English noun (a draughtsperson) when the operative unit is
  la:scrībō, and the measurement showed the class is 43 aligned
  words, 13 wanting routing against 15 wanting their English card
  kept, with siblings like describe and export already on the
  classical cards via FROM LATIN rows; routing the 13 makes families
  agree. Seed entries (owner-ratified, including the two flagged
  debatable): lax to la:laxō, sound to la:sonō, tract to la:trahō,
  port to la:portō, scribe to la:scrībō, lupus to la:lupus, view to
  la:videō, current to la:currō, elector to la:ēligō, victor to
  la:vincō, pend to la:pendō, claim to la:clāmō, flex to la:flectō.
  Anchor: subscribe's scribe chip is `r` to la:scrībō and la:scrībō's
  family contains subscribe and describe.
- Root emission: collect every referenced root key; keep those with 2
  or more referencing words; gloss la:/grc: keys from the Latin/Greek
  extracts (first gloss of the lemma entry, macrons preserved for
  display, keys are macron-stripped and lowercased), falling back to
  the most frequent `t=` arg among referencing templates; a root with
  no gloss from either source is dropped and its references lose `r`.
- Hybrid cap, applied after all harvesting: ship words with fr <=
  50000; ship deeper words only when they carry morphs or a decomposed
  org row (see the chain-candidacy section); never ship an unranked
  word; then drop roots that fell under 2 references, then drop
  forms.json entries whose lemma dropped.

### Template census gate (2026-09-01)

The process fix behind the `+` variants. The bor+ name was in the
source for months, nothing in the build knew it existed, and 294 words
lost their origin row in silence. A missing template name now fails the
build the way a broken anchor does.

Pass 1 counts every etymology template name on every English entry, at
no extra cost: it already reads the file. Two tables in build.py then
classify what the census found. `HARVESTED` is the union of the tables
the pipeline reads (DECOMP_NAMES, SURF_NAMES, ORIGIN_NAMES, ETY_NAMES),
so it can never drift from them. `IGNORED` is a dict of name to a
one-line reason: "root" states a PIE root, reconstructed and out of
scope; "cog" lists a cognate, not an origin; "m", "l" and "lang" are
formatting links. A name with `CENSUS_MIN` uses or more (1,000) in
neither table fails the build, which prints the offending names with
their counts and stops before the expensive passes. Names under the
threshold are not the build's problem.

The build report prints the top 30 names with their counts and their
classification, so the shape of the source is visible every run. At
2026-09-01 the extract has 447 distinct names, 49 of them at or above
the threshold, all classified.

### Anchor reach counts parts only (2026-09-01)

An owner decision, from a field report on hesitation. The word read
"haesitātiō = haesitō + -tiō" with the first chip dead.

Recursion stops at an anchor, a source lemma `ORG_ANCHOR_MIN` (3) or
more English words reach. Reaching used to be counted two ways per
word: the lemma the word's chain SETTLES on, and the immediate parts of
that lemma's split. Settle hits are the bug. Credits are derived at
runtime from the chips in morphs and org.parts, and a word that settles
on a lemma flattens THROUGH it and never names it, so a settle hit
credits nothing. haesitō collected three of them, became an anchor,
appeared as a part in one row, carried one credit, missed the 2-word
root threshold and rendered inert. Recursion had stopped at a card that
never shipped.

Reaching is now counted through parts only. A part is also only counted
when the split it belongs to would really be emitted: flatten refuses a
split whole when any piece has no card of its own, so a part of a
refused split credits nothing either. Affixes and curated aliases are
left out, since flatten never splits either one. With that, an anchor
has three part-reaches, three rows name it, it clears the 2-word
threshold, and it ships. Two verify checks assert it: every anchor
lemma ships as a root card, and no org part naming an anchor is inert.
A morph chip names a root only through `r`, which the dangling-root
check already covers; reading a chip's English spelling instead would
call bulla, carō and fīnis references to Latin cards they are not.

`ORG_ANCHOR_MIN` stayed 3 at this decision. hesitation now reads
haereō + -titō + -tiō
with three live links, solvō stays an anchor, and absolute still reads
ab- + solvō. Of the 139 org rows the rule changed, 135 drilled deeper
and every one of the 50 inert parts among them became a link.

The rule left one gap, and it was the reason `ROOT_STOPS` stopped being
empty: a lemma with exactly two part-reaches would ship as a root on
two credits but is one short of being an anchor, so it flattens away
and takes its card with it. la:laxō and la:ēligō were both that shape
and both are `BASE_ROUTES` targets, so they carried entries in
`ROOT_STOPS` with their reasons. `ORG_ANCHOR_MIN` of 2 closes the gap
generally; it was measured at 249 more anchors and 160 shallower rows
and not taken then. It was taken later the same day, once anchor cards
carried their own split, and both entries left (see "ORG_ANCHOR_MIN is
2").

### Anchor cards carry their own breakdown (2026-09-01)

An owner decision. Recursion stops at an anchor, so every row naming
one reads shallower than the source: access read accēdō + -tus, and
ad- + cēdō appeared nowhere, because the accēdō card was terminal
(gloss, language, kind, family, and nothing about the anchor's own
assembly).

Rule: at build, every anchor's entry in roots.json gains `parts`, the
same shape as org.parts, produced by the same flatten() the word rows
use. Recursion stops at other anchors, affixes stay terminal, and a
part whose root does not ship stays inert with `f` alone. Only anchors
get the field; affix roots and plain roots do not, and an anchor whose
lemma has no split in its extract carries none either, which is most
of them: at 2026-09-01, 279 of 884 anchors decompose. The anchor's
split starts with a fresh depth budget of ORG_DEPTH from its own card,
so it can read deeper than the rows above it did; that is the
recursion doing from the card what it could not do from the row.

Runtime: the root card renders a MADE OF section from `parts`, the
word card's own buildChipRow under the word card's own label, after
the gloss block and before the family section. Chips link to root
cards and the breadcrumb trail works root to root (access › accēdō ›
cēdō). One renderer serves both surfaces, since the sidepanel embeds
content.js. Badge and tier conventions are untouched: a root card
still renders no tier chip.

Three verify checks pin the field: every `r` inside a root's `parts`
exists in roots.json; only anchors carry `parts`; every anchor whose
lemma decomposes carries `parts`, and no other root does. The last two
run only on a full build, since a `--verify` run has no anchor set.
(Widened 2026-09-05, review finding 4: a node the chip cap kept whole
carries `parts` the same way, so both checks read "anchors and carried
nodes"; see the review notes under "Origin subsystem, source graphs".)
Anchor: la:accedo carries parts reading ad- + cēdō, both linked.

### Root families credit through anchors (2026-09-01)

An owner decision. The family index (lookup.js buildFamilyIndex, and
buildFamilyCounts beside it) counts a word for a root when the word
credits the root directly OR credits an anchor whose `parts` credit
the root, recursively through nested anchors, cycle-safe. The effect
is that the cēdō card still lists access, concede and precede after
those rows stop at accēdō, concēdō and praecēdō, and "BUILDS N WORDS"
on the root card reflects the same count (cēdō builds 39 at
2026-09-01, access at the head of the list). Used-in on WORD cards is
unchanged: it reverses the w-chip graph, not roots. The index now reads
roots.json as well as words.json; nothing is stored, and the
recomposition property holds.

The build's ship threshold counts the same way, and this deviates from
the letter of the owner's instruction, which said the threshold stays
on direct credits (flagged for owner ratification 2026-09-01). It was
measured at `ORG_ANCHOR_MIN` 2 with direct credits only: 43 base cards
HEAD shipped went under the threshold once the rows above them stopped
at an anchor (grc:λύω, la:anima, la:sciō, la:senex among them), 19
word rows and 64 anchor cards got a dead chip for it, and fornix and
τάσσω, each named by one row and one anchor's split, never shipped,
which the same decision expected to see restored. The SPEC's own older
rule, that the threshold and the runtime index count identically or a
card ships with a family it does not have, decides it: a credit
through an anchor counts in both places. With that count no HEAD root
is lost except the three noted under "ORG_ANCHOR_MIN is 2".
The count is not circular: an anchor's split is read raw from
flatten() before anyone knows which roots ship, and `r` is written on
a part only afterwards.

### ORG_ANCHOR_MIN is 2 (2026-09-01)

An owner decision, taken after the two sections above landed. A lemma
two words reach is enough to ship a card, and it is now enough to be
an anchor. The rows above it stop there, the card carries the split,
and the family below still credits through. Anchors went from 434 to
884. Of the 5,906 org rows, 395 changed: 380 read shallower (contract
reads contrahō + -tus, and the contrahō card reads con- + trahō),
14 relinked at the same depth, 1 gained a row. No row read deeper.

The two `ROOT_STOPS` entries left. la:laxō and la:ēligō have exactly
two part-reaches, so at 2 they are anchors on their own; relax still
routes its lax chip to la:laxō, and every BASE_ROUTES target ships.
`ROOT_STOPS` is empty, its documented healthy state. fornicate links
its fornix part and tactic its τάσσω part, through the crediting rule
above rather than through the minimum.

Three roots HEAD shipped are gone, all intermediates the depth cap
used to stop on: la:avidus (the audeō card now drills to aveō + -idus,
so audacious credits aveō rather than avidus, and adulatory's avidus
chip is inert), la:gestus (gesticulor drills to gerō + -tus) and
la:invideō (invidia drills to in- + videō). Each is the flatten rule
reaching the base from the anchor's card.

### Lemma steps and self-part splits (2026-09-01)

Two owner decisions.

`LEMMA_STEPS` in curation.py maps a source-language lemma to the lemma
a chain steps to before it is judged, language-qualified keys, each
with a reason. settle() reads it ahead of the automatic form-of step,
which only fires on a page that looks like an inflection to the parser
(no gloss, no split, a form-of link). Seeded with la:deponens to
la:depono: dēpōnēns is a Latin lemma page with a gloss of its own, so
the chain settled on it and deponent shipped nothing, while prōpōnēns
beside it is a form-of page and steps on its own. Anchor: deponent
ships with dēpōnō = dē- + pōnō, both parts linked.

A split whose part is the lemma itself, macrons aside, is no split:
errō = errō + -ō is Wiktionary recording the conjugation ending, and
the lemma stays whole. 8 rows carried one (arrant, caligo, err, palp,
palpate, pigeon, seraglio, uncus). The same refusal covers a cycle two
pages long (serō = sera + -ō and sera = serō + -a), where the inner
split is refused and seraglio reads sera + -ō. Effects under the
chain-only drop rule: arrant, caligo, palpate and uncus are past the
cap and their only row was the self-split, so they no longer ship;
err and palp are inside the cap and keep their cards with a single
"From Latin" row; pigeon keeps its card and loses its row (pīpiō is
credited by nothing else). Verify asserts no org row names its own
lemma as a part.

### Chain candidacy past the cap (2026-09-01)

An owner decision. Past `RANK_CAP` a word earned a card only through an
English-surface split. A flattenable classical origin chain is a
breakdown too, and it is the same breakdown the card would show.

Rule: a corpus-attested word above `RANK_CAP` carrying a classical
origin template becomes a candidate. Every other candidacy rule is
unchanged: no rank, no card; proper nouns are excluded; the hyphen and
character rules stand. At emit the word ships only if its final org row
is DECOMPOSED (`l`, `lang`, `parts`), and it is dropped otherwise. A
single "From Latin x" row past the cap is a card with no breakdown on
it, which is what the cap exists to keep out.

Two details carry the rule.

- The candidates are tracked in a set of their own, so the emit-stage
  drop can never touch a rank-attested or split-nominated word. A
  chain-only nomination is provisional: a later entry carrying a real
  split upgrades the word out of the set.
- The row that decides is the row as EMITTED, so the test runs after
  root pruning as well as before it. A decomposed row whose every part
  missed the 2-word threshold is deleted there, and 24 words shipped
  bare when the test ran only before it. Dropping a word changes who
  credits what, so linking runs again on the smaller set; it terminates
  because every extra pass removes at least one word from a finite set.
  Two passes at 2026-09-01.

A dropped word takes nothing with it. The drop happens before
forms.json is assembled, so it credits no root, it is no form target,
and it cannot be a forms.json row. That is the path the tail-split
suppression already takes, one stage earlier.

At 2026-09-01: 6,615 chain-only candidates, 2,303 ship, 4,181 dropped.
proponent and exponent gain FROM LATIN rows on prōpōnō and expōnō.
deponent did not ship at first, and the reason was in the source rather
than the rule: dēpōnēns is a Latin lemma page with a gloss of its own,
so the chain settled there and did not step to dēpōnō, while prōpōnēns
is a form-of page and does step. A `LEMMA_STEPS` entry closes it (see
"Lemma steps and self-part splits").

No rank floor for chain-only candidates (owner decision 2026-09-01).
The tail of the chain half runs rarer than the split half, down to
words attested once in the corpus, and a floor was considered and
decided against: attestation is the outer edge of the dictionary, the
same edge the split half has, and a decomposed row is the breakdown
the cap exists to admit.

### Coverage report lines (2026-09-01)

Two numbers in the build report, tracked build over build. They are
report only, never a gate: they move with the corpus, and the thing
they measure is the harvest getting better rather than a rule holding.

- Breakdown coverage of the top `COVERAGE_TOP` ranks (10,000): the
  percent of shipped words in that band carrying either a morphs split
  or a decomposed org row. The commonest ten thousand words are the
  ones a reader meets, so a gap there is a gap that gets seen. 33.8% at
  2026-09-01, up from 33.5% before the `+` variants were read.
- Words whose raw entry states a classical origin and which shipped
  with neither morphs nor org: 1,752 at 2026-09-01. Every breakdown
  field report so far has been about a word in this class. The list
  goes to pipeline/cache/misses-report.txt, sorted by rank, one word
  per line with its rank, so the next report can be checked against it
  before anyone goes looking.

Verification (the anchor pattern carries over: the build fails loudly
when an anchor breaks; anchors are verified against the source before
being asserted here, and this list is corrected to match reality, never
silently diverged from):

- Anchors, verified against the extracts and pinned 2026-08-24:
  information = inform + -ation; security = secure + -ity; television =
  tele- + vision; impossible = im- + possible; music = muse + -ic with
  muse as a `w` chip; subterranean resolves a breakdown containing a
  terra-rooted morpheme (via FORCED_SPLITS: the extract analyses the
  word as Latin subterrāneus + -an, which puts a macronised Latin word
  on a chip); beautiful = beauty + -ful with en:-ful shipping as a
  root; en:un- ships with a family of 5 or more; la:terra ships with
  gloss containing "land" (the Latin extract's first sense reads "dry
  land", verified 2026-08-24) and family containing terrain and
  territory; remember carries a single org referencing la:memor (via
  ROOT_ALIASES; its Latin chain has no decomposition templates);
  memory carries a decomposed org with a memor part; territory
  carries a decomposed org (terra + -tōrium); la:memor's family
  contains memory, remember, and memorandum; la:re- ships as a Latin
  prefix node and la:-tōrium as a Latin suffix node; absolute's
  usedIn contains absolutely; understand ships with no morphs
  (BLOCKED); had ships with
  no morphs (its -ed split is inflectional, and it carries auxiliary
  senses of its own so it is a word, not a forms.json entry); "running"
  ships as a word with no morphs (same reason: it carries adjective,
  adverb and noun senses, so it is not in forms.json either);
  "territories" resolves to territory via forms.json, "walked" to walk,
  "children" to child. Added 2026-09-01: la:accedo carries parts
  reading ad- + cēdō, both linked; la:cedo's family reaches access,
  concede and precede through their anchors; deponent carries dēpōnō =
  dē- + pōnō; fornicate links its fornix part and tactic its τάσσω
  part; no org row names its own lemma as a part; every `r` inside a
  root's `parts` exists in roots.json; only anchors carry `parts`;
  every anchor whose lemma decomposes carries `parts`, and no other
  (both widened 2026-09-05 to anchors and the nodes the chip cap kept
  whole, review finding 4).
- Distribution sanity, printed in the build report: total words around
  83k (29k ranked lemma pages inside the top 50,000, since inflection
  pages live in forms.json, plus the attested tail that carries a split
  or a decomposed chain; all moving with the corpus), morphs coverage
  around a third of capped
  words with Germanic affixes in, roots in the low thousands, en:
  roots outnumber la:, no words.json entry with both morphs and org,
  no root under 2 distinct referencing words (superseded 2026-09-05
  by never-silent: every referenced root ships), no PIE key anywhere.
- A 10 plus 10 random sample per zone (ranked/unranked, split/no-split)
  in the build report for eyeball review.

## Origin subsystem, source graphs (Jesse decisions 2026-09-05)

This section replaces the origin-chain machinery described under
"Pipeline" (origin_chain, the Flattener, the emit-stage drops) with a
design the owner ratified after a week of field reports. Every earlier
origin rule that conflicts with this section is superseded by it; the
anchor rules of 2026-09-01 carry over where this section says so.

### Why

A census on 2026-09-05 of the top 10,000 shipped words that name a
Latin or Greek source found 1,857 with a breakdown and about 1,190
without. The misses sorted into causes:

| cause | top 10k | all 1,752 misses |
|---|---|---|
| source lemma has no split; the single root was dropped by the 2-credit threshold | 378 | 843 |
| source lemma has a structured split; our rules dropped the row | 102 | 284 |
| chain names a lemma not found in the source extract | 96 | 263 |
| decomposition exists only as prose on the source page (manuscript) | 76 | 138 |
| decomposition exists only as prose on the English page (curious) | 65 | 137 |
| English page has a split template the pipeline did not use | 40 | 84 |

Two thirds of the silence is policy: the origin was known and not
shown. The rest is that both Wiktionary and the pipeline treated
decomposition as something only templates carry. The old design was
English-first and template-only, and each stage that failed was
silent. This section inverts it.

### Principle 1: source graphs first

Each root language is built as a standalone graph before any English
page is read. A node is a lemma with a gloss and, for a non-Latin
script, a romanization. Edges are of two kinds:

- Decomposition: from the decomposition templates, from the `etymon`
  tree, and from the etymology prose. The prose grammar (measured in
  pipeline/spike-origin.md, 2026-09-05) reads "From X (…) + Y (…)",
  "equivalent to X + Y" and bare "X + Y" sequences, with the page's
  mention templates supplying each term's language and form, nested
  parentheses skipped, and a parenthetical of the shape "ablative of
  Z", "past participle of Z", "genitive of Z", "frequentative of Z",
  "diminutive of Z" stepping the term to Z. A parse is accepted only
  when every part resolves to a page in the same extract and the
  sentence carries no rejection stance ("not from", "rather than",
  "unrelated to"). Measured: 813 of 2,165 prose-only Latin lemma pages
  and 223 of 652 Greek captured within the same extract; 55 right, 3
  partial, 2 wrong in a hand-checked 60. The uncaptured remainder is
  mostly reconstructed parts, which the walk stops at anyway.
- Lookup rules, applied to every chain lemma and every split part
  before any other rule (spike section 3): Greek keys drop the
  vowel-length marks (breve and macron) that page titles never carry,
  and match accent and breathing loosely when the strict key misses;
  a form-of page steps to its lemma and the step repeats once more
  when the target is itself a form-of page (sciēns to sciō). The Greek
  length-mark rule alone reached 87 of 421 missing chain lemmas and
  129 of 255 refused structured splits (system, period, prophecy,
  type, energy). Stepping form-of parts reached 83 more of the 255.
- Step: an inflection or participle page steps to its lemma, from
  form_of links, from participle head templates, from prose of the
  shape "past participle of X" or "ablative of X", and from the
  LEMMA_STEPS curation table, in that order of precedence with
  curation winning.

The graph is verified on its own before English attaches: no cycles,
no dangling edge, and a coverage table (nodes with a decomposition,
nodes with prose the parser could not read, nodes with neither)
printed in the build report and tracked build over build.

### Principle 2: language roles

Every language code the extracts use falls into exactly one role. The
table lives in build.py as data with a reason per row, under the census
gate: a code above the census threshold that is in no role fails the
build.

- Root languages: nodes ship as root cards with families and, where
  the node decomposes, a MADE OF row. Phase one: Latin (all period
  codes) and Ancient Greek (grc, grc-koi, gkm). Phase two: Old English
  (ang). Census 2026-09-05, deepest named language of the top 10,000:
  Latin 1,852, Old English 1,323, Greek 349.
- Pass-through languages: pages are walked to continue a chain toward
  a root language and never ship as cards. Phase one: Old French,
  Anglo-Norman, Middle French, French. Phase two: Middle English. The
  census found 388 top-10k words whose chain stops in the French group
  and 535 whose chain stops at Middle English; most of the first group
  are Latin words and most of the second are Old English words.
- Row-only languages: every other attested language (Old Norse, Dutch
  and Low German, Italian, Spanish, Arabic, Hebrew, Sanskrit, Japanese,
  and the rest). A word whose deepest named origin is in this group
  renders the single origin row and nothing else: no card, no family.
  Old Norse (139 words) is the one to re-measure after phase two.
- Reconstructed forms (a lemma starting with `*`) end the walk. No
  Proto-Germanic or Proto-Indo-European node exists anywhere. The
  ROADMAP decision stands.

### Principle 3: English attaches by any mention

An English page contributes the set of source-language terms it names,
from any template that carries a language and a term (origin
templates, mention templates, the parts of a decomposition template,
the etymon tree) and from the prose parser. A term inside a cognate
clause ("cognate with", "compare") is not an origin and is excluded by
the parser's role, never by template name. The word attaches to the
deepest term that exists in a root-language graph, preferring a term
that decomposes over one that does not. Pass-through pages are walked
first, so a chain that stops at Old French continues to Latin when the
French page names it. No template name is load-bearing: the census
gate still classifies names, but a new name can only add terms, never
silence a word.

### Principle 4: never silent

If a source names an origin, the card shows it.

- A word attached to a root-language node renders the decomposed row
  (FROM LATIN lemma, chips) when the node decomposes, and the single
  row ("From Latin soccus (a light low-heeled shoe)") when it does not.
- Every root-language node that any word attaches to or any row names
  ships as a root card. There is no credit threshold. A one-word family
  is a valid card; its gloss is the value. The "no root under 2
  distinct referencing words" sanity line under Verification is
  superseded.
- A word whose deepest origin is a row-only language renders the
  single row with no link and no card. The row is inert but present.
- The 2026-09-01 anchor rules carry over: reach counts through parts,
  ORG_ANCHOR_MIN is 2, anchors carry `parts`, families credit through
  anchors at build and at runtime. The emit-stage drops that removed
  rows for threshold reasons are gone. A row is dropped only for a
  stated reason (self-part split, a BLOCKED_SPLITS entry, a part page
  that does not exist), and every drop writes its reason to the misses
  report.

### Row shapes (ratified from mockups 2026-09-05)

Five cases, each rendered with the shipped stylesheet and approved:

1. Prose-only decomposition on the source page: manuscript reads FROM
   LATIN manūscrīptus with chips manus (hand) + scrībō (to write,
   compose). Inflected and participial parts step to their lemma before
   they become chips.
2. Known origin with nothing to decompose: idea reads a single row
   "From Greek ἰδέα (idéa; form, appearance, kind; idea)". sock and
   pepper render the same shape.
3. Structured split the old rules refused: system reads FROM GREEK
   σύστημα with συν- + ἵστημι + -μα; period reads περι- + ὁδός.
4. Root cards under never-silent: soccus ships with a one-word family
   (sock); ἰδέα lists idea, ideal and ideology through anchor credit.
5. Prose-only decomposition on the English page: curious reads FROM
   LATIN cūriōsus with cūra + -ōsus.

Romanization (Jesse decision 2026-09-05): a chip whose form is in a
non-Latin script carries its romanization as a line between the form
and the gloss, in the muted style the root card uses for its `rom`.
The single origin row places the romanization first inside the
parentheses, before the gloss, separated by a semicolon. Latin-script
forms carry no romanization line. One rule covers Greek, Arabic,
Hebrew and any script the row-only languages bring.

### Principle 5: a gold set drives the build

pipeline/gold.json holds hand-verified expectations, one row per word:
the language, the lemma, and the ordered parts of the expected row (or
"single" with the lemma, or "none"). The build scores itself against
it on every run and prints precision per failure class; a build whose
score falls below the committed score fails. The seed set covers every
class this section names and every field report so far: component,
manuscript, absolute, absolution, press, impress, system, period, idea,
sock, curious, deponent, hesitation, access, concede, territory,
remember, memory, subterranean, korean (expected: Korea + -an, Korea
inert). A field report becomes a gold row before it becomes a fix.

### Data and protocol changes

- roots.json: `rom` on every non-Latin-script node (already present on
  Greek roots); `parts` as specified 2026-09-01. Old English nodes
  arrive in phase two under the `ang:` key prefix.
- words.json `org`, single shape, gains a row-only form: `{lang, f,
  gloss, rom?}` with no `r`. The worker passes it through unjoined,
  since no root entry exists to join from. The decomposed shape is
  unchanged; each part may carry `rom`.
- The langName table in the extension grows to cover every row-only
  language the build emits; the build fails when it emits a code the
  table lacks (the same loud-failure pattern as the census gate).
- The extension's card code needs only the romanization line on chips
  and the inert single row. Everything else this section changes is
  data.

### Phases

Phase one: Latin and Greek graphs with the lookup rules and the prose
parser, the French pass-through group, never-silent rows and cards,
row-only rows with romanization, the gold set, the misses report with
reasons. Phase two: the Old English graph with Middle English as
pass-through. After phase two: re-measure Old Norse for a root role.

Expected outcome of phase one against the 1,752 misses of 2026-09-01
(spike scenario C): 488 render decomposed, 1,039 render a single row,
225 render nothing because Wiktionary never wrote the lemma (turbula,
petia, ad montem). Inside the top 10,000: 141, 359 and 53. roots.json
grows by about 1,900 cards, 0.21 MB. The build report prints the same
three counts so the outcome is checked, not assumed.

Single-row gloss quality (spike section 7): a minority of one-chip rows
pick a homograph's gloss (cave from cava read as "jackdaw"). The step
rules take most of these to the right lemma (cava is a form of cavus).
The rest are gold rows and ROOT_GLOSSES entries, found by the gold set
and the eyeball sample, never by a reader first.

### Verification additions

- Graph checks: no cycles, no dangling edge, every node reachable from
  at least one English word ships.
- Anchors added 2026-09-05: manuscript carries manūscrīptus = manus +
  scrībō, both linked; idea carries a single row naming grc:ἰδέα and
  that root ships; system carries σύστημα decomposed; period carries
  περίοδος = περί + ὁδός (corrected 2026-09-05, see the build notes
  below: the extract splits it on the preposition, not the prefix);
  curious carries cūriōsus = cūra + -ōsus;
  sock carries a single row naming la:soccus and that root ships with
  a family of at least one; sky carries a row-only single row with
  lang non and no `r`; no word with an origin template to a classified
  language ships with neither morphs nor org, except through a drop
  whose reason is in the misses report.
- The gold score is printed and gated as specified in Principle 5.

### Phase one as built (dated notes, 2026-09-05, build agent)

Each note records where the build had to read this section against the
extracts and what it did. None of them is a silent divergence; the
owner rules on each.

- period reads περίοδος = περί + ὁδός, not περι- + ὁδός. The Greek page
  splits it as περῐ́ + ὁδός, the preposition περί reached through the
  length-mark rule; the prefix page περι- is a different node. The
  anchor and the gold row pin περί.
- hesitation reads haesitātiō = haesitō + -tiō, with the haesitō card
  carrying haereō + -titō. Under never-silent hesitance attaches as well
  and both reach haesitō, so it is an anchor by the 2026-09-01 rule and
  the row stops there. The 2026-09-01 wording (haereō + -titō + -tiō)
  described the build before hesitance attached.
- curious reads cūriōsus = cūra + -ōsus from a curated source edge
  (`SOURCE_SPLITS` in curation.py), not from prose. The Latin page
  records cūriōsus as a back-formation from incūriōsus, and no English
  entry of curious names cūra; the only English split template on the
  page belongs to the curium sense. The mockup's row is the standard
  analysis, so it is data with its reason.
- sock reads soccus because an alternative-form page is not a node.
  σύκχος, which the sock page names, is a spelling of συγχίς (a glossed
  Greek lemma). The lookup steps through form-of pages but through an
  alternative-form page only in a fallback pass, and the fallback pass
  wins only when it reaches a node that decomposes (μονάρχης is a
  spelling of μόναρχος, which splits, so monarch reads Greek). idea
  reads ἰδέα by the plain deepest rule.
- Deepest term is read per language run: the terms an English page
  names fall into runs by language, the first term of a run is the
  lemma English borrowed, and the rest of the run is that lemma's own
  ancestry. The word attaches to the deepest run's entry lemma, or to a
  run whose entry decomposes when the deepest does not. Without the run
  rule access attached to accēdō instead of accessus and every anchor
  above a base verb lost its reaches.
- A plus-chain in English prose belongs to the last root or
  pass-through term named before it. When that term is a node without
  a split, the chain supplies its parts (dīvortium = dī- + vertō); when
  it is a term Wiktionary never wrote, the row reads the term as written
  over the parts (ad montem = ad + mōns); when it is a reconstruction,
  the starred form labels the row (*manizāre = manus + -izō); when it is
  a pass-through word and no root lemma is named, the French word
  labels the row and the chips stay Latin (lang fro, frm or fr on a
  decomposed row). A chain with no term before it ("From Latin
  spectāculum + -ar") is the English word's own analysis and its first
  term is the lemma.
- A word whose chain ends in a pass-through language with nothing
  deeper (dessert at Middle French, quite at Anglo-Norman) renders no
  row and goes to the misses file with that reason, since pass-through
  pages never ship. kaikki publishes no Anglo-Norman extract, so an xno
  page is never walked.
- A homograph's card gloss is picked with support from the attaching
  words (the template gloss and the English word itself): cava reads
  "a hollow, hole, cave" for cave rather than the jackdaw. A name entry
  never wins on support. ROOT_GLOSSES still overrides.
- Greek forms print the page title, never the canonical form with its
  vowel-length marks; the romanization keeps kaikki's marks as before.
- Root cards grew by about 3,000, not 1,900: attachment by any mention
  reaches more lemmas than the spike's chain set did. The outcome
  against the 1,752 misses is 546 decomposed, 1,027 single and 179
  nothing (the spike sized 488, 1,039 and 225); inside the top 10,000,
  172, 340 and 41 (141, 359 and 53). The build report prints the line
  every run, from pipeline/misses-2026-09-01.txt.

### Review fixes as built (dated notes, 2026-09-05, fix agent)

The adversarial review of the branch (findings 1 to 16) forced these
corrections. Each note records the rule as built and the words that
pinned it; the gold set carries a row for each.

- Reach and anchors (finding 4). A word reaches the lemma it attaches to
  and the immediate parts of that lemma's split, each once; a lemma
  reached by ORG_ANCHOR_MIN or more words is an anchor. The 2026-09-01
  wording counted parts only, so a lemma two words attached to was
  still expanded away under a third: just attached to iūstus and
  justice flattened through it to iūs + -tus + -itia. Now justice reads
  iūstus + -itia and the iūstus card carries iūs + -tus. An anchor that
  two words attach to and no row names as a part (βασιλικός under
  basilica and basilic, whose rows read βασιλεύς + -ικός) gates nothing
  and needs no card; the "every anchor ships" check is stated on the
  anchors a row or a card names. A chain-only tail word whose row will
  not decompose is dropped, so its attachment is no reach. Rows the
  rule changed against the 2026-09-05 gold set: absolution reads
  absolvō + -tiō (absolute attaches to absolvō) and impact reads
  impingō + -tus (impinge attaches to impingō); both cards carry the
  split the row no longer shows. Anchors 1,353 to 3,082.
- Row limits (finding 4). No row may carry a duplicate root: a split
  that names one twice keeps the lemma whole (ossuārium read ōs + ōs;
  the cause was the trailing appositive ", alternative form of os"
  read as a step on -ārius, and the trailing-appositive step now takes
  the inflectional shapes only, so ossuary reads ōs + -ārius). A row
  that would run to four or more chips falls back to the page's own
  parts, and every part that stayed whole because of that ships a root
  card carrying its own `parts`, exactly as an anchor's does (energy
  read five chips; it reads ἐνεργός + -ης + -ια with the ἐνεργός card
  carrying ἐν- + ἔργον + -ος). The verify checks "only anchors carry
  parts" and "every anchor whose lemma decomposes carries parts" are
  widened to anchors and carried nodes. Rows with four or more chips
  211 to 2 (both the page's own four-part split), rows with two or more
  suffix chips 552 to 204, duplicate parts 6 to 0, root cards lost
  against main 81 to 45. automatic reads αὐτόματον = αὐτός + μέμαα,
  identity reads identitās = īdem + -tās (the Greek ταὐτότης is a
  calque on that page, rejected under finding 1), access still reads
  accēdō + -tus with accēdō carrying ad- + cēdō.
- Template parts and their owner (finding 5). A decomposition template
  on an English page takes its prose position from its expansion ("de-
  + portāre" on sport), so its parts belong to the last root or
  pass-through term named before it, as a prose chain's do. A template
  with no prose position belongs to the term the template itself names:
  the head the etymon tree nests it under, or the origin template
  written just before it; never to any term of the run, and to no term
  at all when none precedes it. An origin template whose expansion is
  not in the prose (a gloss quoted differently, an alt stem such as
  compāniōn-) is located by its term. A trailing suffix the page's own
  templates give as English ("from Latin funereus + -al" with a
  {{suffix|en|3=al}}) comes off the chain, and a chain left with one
  term is no chain; a suffix template with the base omitted still yields
  its affix. A mention is one of a chain's terms only when it is written
  at or after the chain (infirm names infirmus two sentences before the
  verb's īnfirmus + -ō). When a French word owns the parts and its own
  page continues to a Latin lemma that decomposes, that lemma is the
  row (ancestor reads antecessor). Outcomes: sport reads dēportō = dē-
  + portō, persecute reads persequor = per- + sequor, funereal reads
  fūnereus = fūnus + -eus, advise reads advisō = ad- + vīsō, cohesive
  reads cohaereō = con- + haereō, mediocre reads mediocris = medius +
  ocris; 60 words gained a decomposed row, none lost one to a single.
  accolade still reads *accollō = ad- + collum + -āta (the page's own
  chain; the -āta is Occitan in truth) and byssinosis still reads
  byssinus = byssus + -ōsis (the page writes "byssinum via byssus +
  -osis", a chain no positional rule separates from the legitimate
  "from X, from Y + Z"); both are left as the page states them.
- Row-only romanization (finding 6). kaikki writes the automatic
  transliteration into the template's expansion ("Sanskrit आरात्रिक
  (ārātrika)") and not into `tr`, and a hand-written one sometimes sits
  in the prose right after the expansion ("Hebrew כֻּתֹּנֶת (kuttṓnĕṯ)").
  A row-only row (and any mention in another script) takes its `rom`
  from `tr`, else from the expansion, else from the prose after it; a
  transliteration is Latin letters with diacritics, IPA letters (ʔ, ʕ)
  included. Non-Latin row-only rows without rom: 472 of 740 before, 122
  after this rule alone (the review's measure over its sampled entries,
  rows lacking rom though the expansion carries one: 371 to 64). aarti,
  avatar, assassin, bolshevik and cotton all print their reading.
- The row-only origin (finding 7). The row is the deepest term of the
  page's own origin clause, read in template order: a reconstruction in
  a proto language ends the walk (an unattested form in an attested
  language, *bangen in Middle English, is a step the chain continues
  past); a term with no step cue between it and the term before it in
  the same sentence, or joined to it by "or" or "/", is an alternative
  at the same depth and the first is shown ("Hindi गोरा / Urdu گورا",
  "from Middle Dutch scoep ... and Middle Dutch schoppe"); a "via" term
  after a "from" term is a stage between the borrower and that term,
  not a deeper one (mango reads Malayalam, not Malay); a term after an
  aside cue in its sentence was never an origin ("influenced also by
  Punjabi X", "whence also", "reinforced by"; the one-object cues
  "compare", "see also", "replaced" and "doublet of" mark the next term
  only, and the chain resumes at the next "from", so contrary keeps
  contrārius and ambulance keeps ambulō; "both from" and "all from"
  resume the chain after any cue, so rose keeps rosa). A comma-joined
  spelling list gives its first form, the rest being alternatives. A
  walked French page is read only when the page itself settles nothing,
  and a French term the page's own clause continues past to an attested
  origin that exists is not walked at all (race reads "From Italian
  razza", the page's own statement, not the French page's Latin
  generātiō; a semicolon starts a new clause, so gin still walks engin
  to ingenium). A term after a doubt cue ("a connection has also been
  suggested with", "this suggests a derivation from", "disputedly") is a
  proposal and no origin; "suggested by Berzelius" is a coinage and a
  hedged origin ("of uncertain origin, but probably from") stands. A
  code under CENSUS_MIN in no role is a row like any other, and the
  build fails until ROW_ONLY_LANGS and the extension name it: 131 codes
  surfaced (Old Turkic for cossack among them), read off the template
  expansions; la-eme and la-ren joined the Latin period codes; fr-CA,
  fr-aca, frc and xno-law joined the pass-through group. scoop reads
  Middle Dutch scoep, swamp Old English swamm, creek Old Norse kriki,
  avant-garde Middle English advaunte-garde, cossack Old Turkic
  𐰴𐰔𐰍𐰸, gora Hindi गोरा, steppe Russian степь with its gloss and
  reading; comma-joined forms 18 to 0.
- The stance rule on template splits and calques (finding 8). A
  decomposition template on a source page is refused like a prose chain
  when a rejection cue sits before its expansion in the sentence, and
  whole when the entry carries an `unk` or `unc` template: the page's
  own etymology is unknown or uncertain and the split beside it is a
  proposal (ἀνθόλοψ "the word superficially resembles ἄνθος + ὤψ ...
  a corruption", λύσσα "disputedly", μηχανή "Unknown. Traditionally
  derived from", vehemēns "Disputed"). A cue after the split says
  nothing against it (sōbrius "instead of sēbrius"), and a stance
  inside a parenthesis is an aside, not the sentence's (rebellis). A
  node whose own page refused its split for stance takes no parts from
  an English page that repeats them as fact (squirrel: the Greek page
  calls σκιά + οὐρά a folk etymology, so σκίουρος stays whole). A
  calque-type cue names the model, and the word's own chain resumes at
  the next "from" ("Coined by Cicero as a calque of Greek ποιότης, from
  quālis + -tās" keeps quālitās split; "a calque of Latin diēs
  Mercuriī" still rejects the Latin). Outcomes: antelope and squirrel
  read a single Greek row; lyssa, a tail word whose only split is
  refused, ships no card; race reads "From Italian razza", the page's
  own statement (the walk rule of finding 7); tuesday reads Old English
  tīwesdæġ and wednesday Middle English Wednesday (its Old English is
  unattested). Refused template splits la 205 to 238, grc 575 to 608;
  49 rows changed.
- The 40 shape regressions of the review (finding 9), re-read against
  the extracts: 17 better than main (serious, control, difficult,
  decide, criminal, funeral, material, attitude, reverse, intellectual,
  demonstrate, sally, sport, minor, genuine, minus, vent), 21 the same
  or an anchor-shallowed equivalent, 2 worse (salad reads the shared
  saliō card glossed "to leap", legacy the shared legō card glossed "to
  gather"; both are the one-card-per-key majority rule of finding 2).
  The review counted 16, 14 and 10.
- Minors (findings 10 to 15). A row-only gloss is one short line like
  a root gloss: whole when it fits the card budget, else its first
  clause, else nothing (moloch); the private-use characters kaikki
  writes for a gloss's square brackets are stripped (Abdul "servant
  [of]"); a sense written as a heading and a child glosses with the
  child (la:pes "a foot"); a breve stacked on a macron prints the
  macron alone (citō); the English affix src row carries the source
  root's romanization; grk-pro left the row-only table, since no proto
  language is one. Left as they were, with the reason: the breadcrumb
  cycle guard (finding 13) is the carried-over Okpyeon crumb rule and
  changing it is a shell decision, not a data fix; the etymon tree's
  nested ancestry (finding 15: dinero, pray, violence, violin, shower)
  lives only in the rendered tree lines, a graph flattened one node per
  line with marker suffixes, and reading it needs a parser of its own.
- Measured after the fixes (2026-09-06, seed 20260906). 150 random
  decomposed rows read against the extracts: 135 right, 10 degraded
  (right parts, a shallow or odd gloss), 5 wrong (3.3%; the review
  measured 3.3%): diamante and facete ship an etymology their source
  page leans against, percolate, aureola and iode land on the wrong
  homograph card. The 100 highest-ranked rows that differ from main:
  84 right, 6 degraded, 3 questionable (blue, risk, notice), 7 wrong
  (7%; the review measured 11%): are (the verb page is a form-of entry,
  so the noun "are" wins and reads Latin ārea), mine and fell (the
  card picks the wrong homograph), list (the Latin extract carries the
  city Lista only), park (the enclosure entry is an alternative form),
  camera (labelled camera obscūra), doubt (a stated theory shipped).
  Determinism holds (two builds byte-identical), verify 0 failed, gold
  71 of 71, Node 169, index harness 246, embed harness 181, 8
  screenshots regenerated. Data: 84,307 words, 6,737 roots, 14,247
  origin rows (7,073 decomposed, 2,218 single, 4,956 row-only), 23.9
  MB; breakdown coverage of the top 10,000 ranks 37.9%; the 1,752
  misses of 2026-09-01 render 552 decomposed, 1,029 single, 171
  nothing (top 10,000: 171 / 343 / 39).

### Part senses (dated note, 2026-09-06, second review, cause 1)

The second adversarial pass measured that findings 2 and 3 fixed which
entry supplies a NODE's split, label and gloss, and that nothing applied
the same rule to the PARTS of a split. A chip showed whatever gloss won
its own root card, so la:in- read "un-, non-, not" on incident, intend,
insist and noise, and la:-tus read the action-noun entry on defense and
expert. Fourteen roots of that shape touched 847 shipped words.

- A part chip carries its own gloss, chosen from the sense the PARENT's
  split states for it: the `t`, `tN` or `glossN` argument of the parent's
  decomposition template, its inline `<t:...>` and `<id:...>` modifiers,
  or the parenthetical beside the term in the parent's prose chain. The
  same evidence already fed the homograph vote as a hint; now it also
  picks the wording.
- The candidates are every card-sized sense line of every lemma entry of
  the part's page, name entries excluded, so one rule reaches a homograph
  entry (la:in-) and a further sense of a single entry (grc:κρίνω "to
  decide or judge" under κρίσις) alike.
- A stated sense matches a line when a comma-joined piece of the two is
  the same, or when a content word of the two is: equal, equal once a
  plural -s comes off, or sharing a five-letter prefix ("adjectival" and
  "adjectives"). Five, not four: four makes "action" match "active".
- A line wins only by naming MORE of the stated sense than the card's own
  gloss does, curated ROOT_GLOSSES included. Sharing a word with it is not
  enough, which keeps the rule to the homographs it is about: ūnus states
  "one" and its card already says "one, single", so nothing changes, while
  la:-iō states "abstract noun" against a card about fourth-conjugation
  verbs and the chip carries the noun suffix (union).
- The winning line ships as `g` on the part and the worker joins it over
  the root card's gloss. The card keeps its own gloss for its own page.
  A `g` equal to the card's is dropped at emit.
- A gloss that is only a grammatical note is not a gloss. The Greek
  preposition pages write their case headings as senses of their own, so
  period read "περί ([with genitive])" and episode the same of ἐπί. A
  whole line in square brackets is refused and the next sense carries the
  card.
- A gold row may now pin `glosses`, the chip subtext a reader sees, joined
  the way lookup.js joins it. Rows without the field are unaffected.
- Five curated entries cover parts no evidence on the page reaches:
  LEMMA_STEPS la:strictus to la:stringō and la:visus to la:videō (both
  participles written as lemma pages, so district stopped at strictus and
  vision at the noun vīsus); SOURCE_SPLITS la:mentālis = mēns + -ālis (the
  page's two adjective entries both gloss "mental" and the node followed
  the anatomical mentum) and la:diurnus = diēs + -nus (the page writes
  diūs, which steps through dīus to dīvus "god, deity", so journey read a
  deity); ROOT_GLOSSES la:-ēnus (the page's only entry glosses the
  distributive numerals, while the family is adjectives).
- Outcome: 1,088 word rows and 216 root cards carry an explicit part
  gloss (1,136 and 223 parts), 1,119 rows changed wording, no row changed
  its parts except the five curated ones. Not reached, with the reason:
  suggest and county read what their pages state (suggestus writes
  -tus<t:action noun>, comitātus writes comitor + -tus); command reads
  la:commandō, whose only entry is "to chew"; suspicious states no sense
  for suspiciō; divorce reads the la:di- page, whose only entry is the
  Greek-derived "two".
- series was reported as a regression of this rule, reading serō "to sow,
  plant". It does not: the Latin seriēs page writes serō<id:link><t:to
  bind>, the rule reads it, and the chip carries "to link together; to
  entwine; to interlace". The report describes the build before this rule
  landed, when the chip fell back to the la:serō card. desert reads the
  same homograph for the same reason (the dēserō page writes serō#Etymology
  2 2<t:to bind, join>), and season keeps "to sow, plant" from satiō's
  serō<id:sow><t:to sow>. All three are gold rows with their glosses
  pinned, so the wording cannot move without the gate saying so.

### The Germanic walk (dated note, 2026-09-06, second review, cause 2)

The row-only walk of finding 7 took the last row-language origin term in
template order. That stopped one step short or stepped sideways on the
commonest Germanic words. Five rules, each pinned by the word that found
it:

- A term in a language the walk has already left starts a second chain
  rather than going a step deeper. The test is on positioned terms only,
  since the etymon tree repeats a chain's head with no position of its
  own. about ends "Middle English about (adverb)" after its Old English
  abūtan, and or reads "Old English āþor ... Middle English oththe, from
  Old English oþþe"; both now stop at the Old English of the first chain.
- A comma-joined spelling list whose first form is a reconstruction gives
  the first attested spelling beside it. not writes Old English "*nōht,
  nāht" and reads nāht.
- A grammatical label is no term. STOP_HEADS, which already refused
  "participle" and "genitive" as prose step targets, now refuses
  "demonstrative", "pronoun", "determiner" and their kin: they read "Old
  Norse demonstrative" off "þeir, plural of the demonstrative sá", and
  pulley read a Latin row assembled out of "the feminine of neuter
  polidium".
- A term of an accepted plus-chain is a component of the word before it,
  not an origin, in any language rather than only in Latin and Greek. The
  chain must explain a word of its own language named before it, so ever
  stops at ǣfre rather than the ā of "ǣfre, from ā + in feore", while
  caffeine keeps Italian caffè, which no earlier Italian word owns.
- A row-only row prints the template's display argument when it has one
  ({{inh|en|ang|don|dōn}}), since the row is inert text and shows the form
  the page shows. A root or pass-through term is looked up and keeps the
  page title. do reads dōn, a and an read ān.

Outcome: 47 rows changed, 15 of them inside the top 1,000 ranks. Not
reached: wait, whose page names no attested term under Middle English
waiten (Anglo-Norman waiter has no extract and the Frankish forms are
reconstructions), and won, which is cause 3.

### The English side's section (dated note, 2026-09-06, second review, cause 3)

A card shows the senses of every part of speech a word has, and the origin
row came from one etymology section: the entry with the most senses. can
read "To know how to" over "From Old English canne (glass, container, cup,
jar)". The review measured 451 words of this shape, 99 inside the top
3,000.

- The origin row follows the etymology section that supplies the card's
  FIRST senses, meaning the first sense list the card prints. The split
  still follows the entry with the most senses, which is what keeps number
  a count noun rather than numb + -er.
- A section owns those senses when it supplies the first one and more than
  half of that list. Below that no section supplies them, the row is
  withheld, and the reason goes to the misses report: found opens with
  "Food and lodging" from one section, a furnace interval from another and
  a comb-maker's file from a third; deal opens with two senses from ang
  dǣl and two from ang dǣlan.
- A second section only makes the list ambiguous when it names an origin
  of its own that differs. A section with nothing to say leaves the first
  one speaking alone (cotton keeps its Hebrew row though "A liking." from
  another section fills the fourth slot).
- A section that names no origin at all gives no row, so shot reads
  nothing rather than the noun's Old English sceot: the card opens with
  "Tired, weary", whose section names only English shoot.
- The homograph vote follows the same entry, since the vote is about the
  origin the row shows.
- One curated entry followed: LEMMA_STEPS la:cocus to la:coquus. cocus
  carries an alternative-form entry for coquus beside a New Latin noun for
  the coconut, and the lemma entry makes the page a node, so cook read
  "coconut" once its row moved to the noun section.
- Outcome: 728 rows changed, 110 of them inside the top 3,000 ranks. 268
  moved section, 129 words gained a row their dominant section never gave
  them (please, own, live, account, support), and 331 lost one, 268 of
  those withheld with the reason in the misses report. Rows: 7,034
  decomposed, 4,980 single, 5,540 row-only.
- Not reached: won. Its past-participle entry ships only a form-of sense,
  so the archaic verb "to live, remain" supplies the card's first senses
  and the row reads its Old English wunian. The lemma pointer to win sits
  at the foot of the card, under the senses, so the rule cannot read it as
  what the reader sees first.

### Prose ancestry (dated note, 2026-09-06, third pass)

The second review left 106 rows wrong or degraded whose row no fix round
had moved. The largest cause is one gap: kaikki writes many pages as a
single etymon template whose expansion is the rendered tree, and that
template's arguments carry the first step only. The rest of the chain is
spelled out in the prose and belongs to no template, so the mention reader
never saw it. father read Middle English fader with "from Old English
fæder" in the prose beside it; country, store and jail named Latin in
prose and shipped a Middle English row.

- An English page's prose contributes its origin terms. A "<Language name>
  <term>" written after an origin cue is a step of the chain, positioned
  where the prose writes it, and the sentence's role decides it exactly as
  a template's does. Only the English page is read this way: a source
  page's prose is the graph's own business and a walked pass-through page
  states one chain the walk already reads.
- Five limits keep the reader on the page's own chain, each pinned by the
  word that found it: only inside the sentence that states the page's own
  origin (she ends "similar to the derivation of sure from Old French
  seur" and read the Latin behind that French word; luck read fortūna out
  of a closing paragraph); only where no template expansion covers the
  text; never a term that is a word of a language name or is followed by
  one (avocado writes "Latin American Spanish avocado", wu "the Mandarin
  pronunciation of Chinese 吳"); never a term with a capitalised word
  straight after it and no punctuation between (einstein writes "German
  ein Stein"); never a head of a plus-chain, which the chain parser owns
  (madonna writes "Italian madonna, from Old Italian ma + donna"). A
  bracket or a quote in the term is markup and ends the match (drinking
  writes "Middle English [Term?]"). A grammatical label between the name
  and the term is stepped over (reverend writes "from Latin future passive
  participle reverendus").
- A term the page says is a SPELLING of a lemma the same run names after
  it is a step, not the lemma English borrowed. chief runs "Old French
  chief, from Vulgar Latin capus, from Latin caput" and the capus page
  carries "Late Latin form of caput" beside an unrelated bird of prey,
  which is the entry that won its card. An inflection is not a spelling:
  a participle noun English really borrowed stays the lemma of its run
  (strātus under street, respectus under respect, agēntia under agency).
  kaikki writes the gender letter into the link's word ("form of caput n"),
  so a form-of target that is no page title is retried without it.
- The section test compares the ORIGIN two sections name, not the wording.
  vega reads "Borrowed from Spanish vega (meadow, fertile lowland)" in one
  section and "From Spanish vega" in another, and the row was withheld for
  a difference of gloss.
- One curated entry followed: LEMMA_STEPS la:precare to la:precor. The
  page's one sense reads "second-person singular present active
  imperative/indicative of precor" with no form-of link, so it counted as a
  lemma and pray printed the statement as its gloss.
- Outcome: 203 rows changed, 87 words gained a row and 4 lost one (each of
  the four to the section rule, a second section that now names an origin
  of its own). father reads Old English fæder, sister sweostor, town tūn,
  red rēad, brain bræġn, steal stelan, meat mete, pride prūd, mouse mūs,
  tide tīd, shade sċeadu; store reads Latin īnstaurō, jail caveola = cavea
  + -ulus, popular populāris = populus + -āris, violence violentia =
  violēns + -ia, authority auctōritās = auctor + -tās, chief and chef
  caput, pray precor, command commendō = con- + mandō "to order, command"
  (the "to chew" homograph the part-sense note could not reach), secretary
  sēcrētārius = sēcernō + -ārius, theory Greek θεωρία, suicide suīcīdium =
  suī + -cīdium. country reads Old French contree = contrā + -āta: the
  Latin chips are right and the label is the French word, because the term
  the prose names between them is written "*(terra) contrāta" and the
  bracket rule refuses it.

### A pass-through term is still a row (dated note, 2026-09-06, third pass)

Phase one's pass-through group exists so a chain that stops at Old French
continues to Latin when the French page names it. Where no root language
is ever reached, the walk fell back to the Middle English term above the
French one, or reported "chain stops in a pass-through language" and
showed nothing. Both are wrong about what the page says: the French term
is the deepest attested origin the page states.

- The pass-through role governs CARDS, not rows. A word whose walk reaches
  no root language renders the deepest term of its chain, in whatever
  language the chain ends, inert like any other row-only row. try reads
  Anglo-Norman trier, hurt Old Northern French hurter, touch Old French
  tochier, department French département. The 2026-09-05 statement that
  such a word renders no row and goes to the misses file is superseded;
  dessert and quite render their French rows now.
- ROW_ONLY_LANGS does not name the French codes, so verify accepts a row
  code named by either table and the extension's LANG_NAME table gains
  fr-CA, fr-aca and frc.
- A plus-chain's ownership test treats the whole pass-through group as one
  language, since a chain in Old French explains the Anglo-Norman word
  named before it: lieutenant reads "Anglo-Norman lieutenant ... from Old
  French lieu + tenant" and the row read lieu.
- Outcome: 766 rows changed against the prose-ancestry build, 398 words
  gained a row, 12 lost one (each to the section rule, a second section
  that now names an origin of its own). wait, which the Germanic-walk note
  recorded as not reached, reads Anglo-Norman waiter.

### The spelling beside a reconstruction (dated note, 2026-09-06)

The comma-joined rule of the Germanic walk reads a template's own argument
list ("*nōht, nāht" on not) and shows the attested spelling. A page often
writes the attested form in the prose instead, with no template of its own:
shit reads "from Old English *sċite (“dung”) and sċitte (“diarrhoea”)",
pick "from Old English *piccian, *pīcian (attested in pīcung), and pīcan,
pȳcan", tall "*tæl, ġetæl", mix "*mixian, miscian", hey "*hē, ēa".

The forms a page lists after a reconstruction, joined by a comma or by
"and", are alternatives at the same depth, and the walk shows the first
attested one. Two limits keep the reader inside the list: a parenthetical
between two forms is skipped, and a form ends the way a list item does,
with a comma, a full stop or its own parenthesis. An ordinary English word
is followed by another word, which is where the list stopped being one
("and cognate with", "and derivative of", "and akin to"). Only a row-only
language is read this way, since the rule is the row's.

Outcome: 20 rows changed, 2 words gained a row, 1 lost one to the section
rule (tick, whose second section now names an origin of its own).

### Glosses carry no markup and end in no separator (2026-09-06)

Two shapes the source writes into a template's gloss argument reached the
card as they were. Straight double quotes that survived the templating:
black read Old English blæc glossed 'black, dark", also "ink' and learn
read leornian glossed 'to learn", rarely also, "to teach'. And a trailing
separator: win read winnan glossed "to labour, swink, toil," and range
read rengier glossed "to range, to rank, to order,". The quotes come off
a template gloss and a trailing comma, semicolon or colon comes off every
gloss, template or card. Nothing else is cut.

### Measured after the second review's three fixes (2026-09-06)

Two --offline builds byte-identical, verify 104 checks 0 failed, gold 130
of 130 (59 rows added, found and race rewritten to follow the section
rule), Node 170, index harness 246, embed harness 181, 8 screenshots
regenerated with their scene checks passing and byte-identical to the
ones before. Data: 84,283 words (84,307 before), 6,704 roots (6,737),
14,020 origin rows (14,247): 7,034 decomposed, 2,200 single, 4,786
row-only; 23.9 MB. Breakdown coverage of the top 10,000 ranks 37.9%,
unchanged. The 1,752 misses of 2026-09-01 render 547 decomposed, 1,002
single, 203 nothing (top 10,000: 171 / 337 / 45), against 552 / 1,029 /
171 before: the 32 that stopped rendering are rows the section rule
withheld.

60 random decomposed rows read against the extracts (seed 20260906): 55
right, 3 degraded, 2 wrong (3.3%, the same rate the first pass measured).
Wrong: endue reads indūcō where its first sense comes from induō, and
predict reads praedicō "to proclaim" where English took the homograph
praedīcō "to foretell". Degraded: bipennis carries an inert -is chip,
officīna reads -īna as the female-noun suffix, perdita reads per- as the
intensive prefix where its page says "through".

### The silent section stays silent (measured 2026-09-06)

The section rule withholds a row when the section supplying the card's
first senses names no origin. Eleven words were reported as losing a
correct row that way (bowl, gang, mass, robin, row, oh, sam, ya, eating,
billy, ben). The fall-through was built and measured: a section that names
no origin passes the row to the next section of the same sense list that
does.

It restores none of the eleven. They are withheld for a different reason:
two sections name DIFFERENT origins and neither supplies most of the sense
list, which is the clash rule, not the silent-section rule (bowl opens
with the vessel senses from Old English bolla and the lawn-bowls senses
from Latin bulla). The change gains 171 rows elsewhere, and a hand read of
the twenty highest-ranked finds about half of them wrong: a reads the
Latin letter, ok a Mandarin karaoke compound, bike Old English būc
"belly", bars a Russian acronym. It also breaks two gold rows that state
the rule deliberately (found, a). It is not kept, and the eleven stay
withheld.

The silent half of this note stands: a section that names no origin still
passes the row to nobody, and found, a, bike and bars are still silent.
The clash half is superseded by "The leading section keeps the row" below,
which withholds only where a later section supplies MORE of the first
sense list than the section the card opens with. bowl, gang, mass, robin,
row, ya and ben are read there.

### Measured after the third pass (2026-09-06)

Two --offline builds byte-identical, verify 104 checks 0 failed, gold 189
of 189 (59 rows added), Node 170, index harness 246, embed harness 181, 8
screenshots regenerated with their scene checks passing and byte-identical
to the ones before. Data: 84,300 words (84,283 before), 6,713 roots
(6,704), 14,488 origin rows (14,020): 7,078 decomposed (7,034), 2,209
single (2,200), 5,201 row-only (4,786); 23.9 MB. Breakdown coverage of the
top 10,000 ranks 38.1% (37.9%). The 1,752 misses of 2026-09-01 render 547
decomposed, 1,004 single, 201 nothing (top 10,000: 171 / 338 / 44),
against 547 / 1,002 / 203 before.

40 random decomposed rows read against the extracts (seed 20260906): 33
right, 5 degraded, 2 wrong (5.0%; the two passes before measured 3.3% over
150 and 60 rows). Wrong: diamante ships the derivation its Greek page
leans against (already recorded 2026-09-06), and volatile reads volō "to
wish" where the volātilis page writes "supine stem of volō (to fly)". The
degraded rows are all one shape, a suffix chip carrying the sense a
sibling entry of the suffix page has: assumptive and gelati read -tus as
the action-noun suffix where the parent is a participle, conventicle reads
-culum as the instrument suffix where the page says diminutive, sagittary
reads -ārius as the adjective suffix where the word is an agent noun,
phantasia reads a chip gloss that is a relation note. Both the wrong row
and the degraded ones are the same gap: the part-sense rule of 2026-09-06
reads the sense a PROSE split states beside a part, and a TEMPLATE split
states its parts' senses in the prose around it, which nothing reads.

Of the 106 rows the second review left wrong or degraded and no fix round
had moved, 60 moved and 46 did not; none was newly withheld.

### A row looks its own term up (dated note, 2026-09-06, source glosses)

A census on 2026-09-06 of the 5,201 row-only rows found 3,281 of them, 63%,
carrying no gloss at all, 526 inside the top 3,000 ranks. The card read "From
Old English tō" and stopped. By language: Old English 887, Middle English 526,
Old French 210, French 210, Italian 130, Spanish 115, Japanese 95, German 85,
Old Norse 81, Arabic 57, and a tail.

The cause was a rule gap, not only a missing extract. The French group's three
extracts were already downloaded and 420 of their rows still had no gloss.
Nothing ever looked a row-only term up in its own source extract. A gloss
reached a row only where the English page happened to write one into a mention
template.

- A row-only row looks its term up in the extract of its own language and
  takes the gloss written there. An explicit gloss from the English page keeps
  priority: it is what that page says the word meant when English took it, and
  the extract's is the source page's own headline sense. A form outside the
  Latin script takes its romanization the same way, after the row's own.
- The gloss is chosen the way a root card's is. One page, one gloss: the
  entry with the most senses wins, a name entry is weighted last, and
  `best_gloss` picks the line inside the card budget. A page that is only a
  form-of entry holds no gloss of its own, since "past tense of wesan" is a
  statement rather than a sense, so it is not in the table.
- The lookup is the graph's lookup. The term is cleaned of inline modifiers,
  a section suffix and trailing punctuation, the strict key is tried first,
  and the loose key with every combining mark stripped answers when the strict
  key is no page. Where two pages share one loose key the source is marking a
  distinction the row cannot choose between (Old English god and gōd), so the
  row stays silent. The table is not a graph: no edges, no cards, no splits.
- `ROW_EXTRACT` names the extract a row's language is looked up in, and
  `PASS_EXTRACT` already named the French group's. A code in neither table
  takes whatever gloss the English page wrote and nothing more.

Outcome on the French group, with nothing downloaded: 287 rows gained a gloss
(fr 189, fro 83, frm 10, and 5 across the French variant codes), none lost
one, none was reworded, and no row changed language. The French group's rows
without a gloss fall from 485 to 203. Row-only rows without a gloss overall:
3,281 to 2,994, and 526 to 515 inside the top 3,000. Lookups: 1,148 strict,
4 loose, 0 ambiguous, 598 no page.

Fifteen rows hand read against the extracts, all right: hurt (fro hurter "to
crash into; to clatter into"), view (veue "sight"), attorney (atorner),
jacket (jaque), button (bouter), guarantee (guarantie), supper (soper),
random (randon), piss (pissier), perfume (frm parfum), swiss (Suisse, the
noun over the country name), fiance (fiancer), colin (fr colin, the fish over
the given name), chauffeur (the first sense, "stoker; fireman"), gadget
(gâchette "latch"). Each is a gold row with its gloss pinned.

Two rows read a gloss that is a derivational note, because the source page
writes one as its only sense: bracelet reads fro bracelet "diminutive of
bras" and tartare reads fr tartare "ellipsis of steak tartare". Both are what
the page says, so no rule refuses them.

### The Germanic extracts (dated note, 2026-09-06, owner decision)

Seven extracts joined the download list, all verified present at kaikki on
2026-09-06: Old English 13.2 MB, Middle English 7.1 MB, Old Norse 4.0 MB,
Middle Dutch 0.6 MB, Old High German 0.9 MB, Old Dutch 0.7 MB, Old Saxon
0.7 MB. They go through the existing download machinery, honouring --offline
and the .part resume, and pipeline/README.md carries their URLs and sizes.
Middle Low German and Anglo-Norman return 404 and no extract exists; the 104
gml and xno rows they would have covered are unreachable and keep whatever
gloss the English page wrote.

Old English does NOT become a root language in this round. It stays row-only,
gains glosses, and ships no card and no family. No ang: root key exists. The
root role is phase two of this section and is not built here.

Six of the seven are read for glosses alone, by the rule above. Middle English
is also read as a pass-through language, since 643 rows stopped there and the
Middle English page usually names the word behind them.

- Middle English left ROW_ONLY_LANGS for PASS_LANGS. The pass-through role
  governs cards, so a chain that reaches nothing deeper still renders its
  Middle English row, as the 2026-09-06 note on pass-through rows says.
- A row whose chain ends at a Middle English term continues through that
  page to the term it names, one page at a time. The English page's own
  statement still decides first: a page is walked only where the English
  page's own clause does not continue past the term to something attested.
- ROW_PASS_LANGS names the pass-through languages a ROW is read through as
  well as a card. Middle English is the only member. The two spelling rules
  a row-only language gets, the comma-joined list and the attested form
  beside a reconstruction, are read for it too, since a chain ends at Middle
  English as often as in a row-only language: print reads "Middle English
  *printen, prenten, preenten" and shows prenten.
- Three guards keep the walk on the word English took, each pinned by the
  word that found it. A spelling that STATES two etymologies is two words and
  is not walked or glossed (the Middle English male is masculine, a bag and
  an apple, and mail read Latin masculus = mās + -culus off the first). Two
  stated accounts, not two entries: counting a silent participle beside a
  lemma page cost crude, duty, git and gage their Latin. A page whose own
  etymology carries an unk or unc template states a proposal, not an origin
  (core writes "Unknown; derivation from either Old French cuer or cors has
  been suggested, though both possibilities pose serious problems", and walet
  the same shape). And a term the English page names only as a cognate is
  refused in the walk as it is on the page itself.
- The guards are on Middle English alone. Applying the ambiguity test to the
  French extracts, walked since 2026-09-05, shallows 36 rows and drops 17
  (menu, coupe, ville and sac would read a French word glossed with itself).
  Walking French rows the way Middle English ones are walked moved 108 rows
  and read most of them worse, since a French page's own chain runs on past
  the word English borrowed (swiss read Old High German Suittes over Middle
  French Suisse, department read Old French departement with no gloss over
  French département with one).
- A row is a word and never an affix. A page that says where its suffix came
  from is explaining a component: the Middle English burned page names Old
  English -ed, fidget's page -ettan and thrice's -es. The chain stops at the
  last whole word instead, so thrice reads þriwa, and where nothing is left
  the word goes to the misses report with that reason (fidget).
- A walked page settles nothing with a root lemma Wiktionary never wrote.
  Such a term used to outrank the English page's own row and leave the card
  silent. The row-only chain is read instead, and the word still goes to the
  misses report when the chain has nothing either. The test is on a page that
  names no root term of its own, so madam keeps its "la:mea domina never
  written" drop. 13 words gained a row: tan, pot, patent, marla, gurgle,
  madeleine, encore, putty, cabernet, decapitation, bisque, compote, valise.

Outcome of the extracts and the walk together, against the French-group build:
1,181 rows carry a gloss they did not have, 53 rows moved to a different term,
21 gained a row and 1 lost one (fidget, to the affix rule). Rows without a
gloss: 3,281 before this round, 2,098 after, and 526 to 222 inside the top
3,000. By language the remainder is Middle English 341, Old English 205,
Italian 130, Old French 125, Spanish 115, Japanese 95, German 85 and a tail.

The 53 moved rows, read against the extracts: 12 continue to Latin (married
reads marītō, launch lanceō, jelly gelāta, duty dēbeō, perversion perversiō,
conceit concipiō), 8 to Old English (rid geryd, hearing gehēring, buck bucca,
peek cēpan, snort fnora, building bytling), 5 to Old Norse (gasp geispa, slug
slókr, clint klettr, lad ladd, gun Gunnhildr), and the rest to Old French,
Anglo-Norman or a Middle English step. Twenty hand read: 18 right, 1 degraded
(building reads Old English bytling where its page offers it as one of two
accounts, "either formed anew or a continuation of"), 1 questionable (tore and
bound now read a Middle English word because the Old Norse and Old English
terms the page named are bare stems ending in a hyphen).

Two known misses left, with the reason. poll reads Old English pōl "pool":
the Middle English extract has no page for the head sense of pol, and nothing
distinguishes the two. tick loses its row to the section rule, because its
second etymology section now names an attested Middle English form and the
two sections state different origins; the same shape was recorded on 2026-09-06
for the spelling-beside-a-reconstruction rule.

Not reached, with the reason: 584 rows still stop at Middle English. 360 name
a spelling the Middle English extract has no page for (abandoned, awakenen,
babelen), 55 name a page with no etymology at all, and 22 name a page whose
etymology the reader could not use. That is a source gap, not a rule gap.

### Reading the English page harder (dated note, 2026-09-06)

Italian, Spanish, German, Japanese, Arabic and the rest are terminal
row-only origins with no extract here: they cost 352 MB for 482 glosses,
which the owner declined on 2026-09-06. 1,039 rows without a gloss are in
one of those languages, 39 of them inside the top 3,000. The question was
whether the English page's own templates, read harder, close any of it.

Measured over those rows, the page still carries two things a row was not
taking: a `tr` argument on another template naming the same term, and a
transliteration the prose writes after the term with no expansion to anchor
it. Both are readings of the FORM, so a page that names one spelling twice
reads it the same way both times and no homograph can spoil it.

- Kept: the romanization. A row-only row with no romanization takes it from
  another template of its own section that names the same term in the same
  language, else from the prose after the term. 8 rows gained one, none lost
  or changed one, and all 8 are right: magazine مَخْزَن (maḵzan), muslim
  أَسْلَمَ (ʔaslama), buddha बोधति (bodhati), macabre مَقْبَرَة (maqbara),
  nawab نَائِب (nāʔib), masala مصلحت (maṣlaḥat), schmooze שְׁמוּעָה
  (sh'mu'á), boyar боя́рин (bojárin). Non-Latin row-only rows without a
  reading: 83 to 75.
- Dropped: the gloss. A gloss is a reading of the SENSE, and a second
  template naming the same spelling is often about another word. Inside one
  etymology section, which is all the section rule of 2026-09-06 allows, it
  reaches 2 rows and rewords 3 (freak, bird, fun, each to a longer wording of
  the same sense). Pooling the sections of a page would reach 19 and read 3
  of them wrong, and the wrong ones are the commonest words of the set: been
  would read Old English bēon "bees", which is the plural of bēo, and over
  would read ofer "riverbank, seashore, brink", which is the other ofer. bak
  would read a hanja as its gloss. Two rows do not pay for that, and pooling
  sections contradicts the section rule, so the gloss half is not built. The
  extract lookup is what closes this gap, and for these languages there is no
  extract.

### Measured after the source-gloss round (2026-09-06)

Two --offline builds byte-identical, verify 104 checks 0 failed, gold 244 of
244 (55 rows added, 7 amended to pin a gloss the extract supplies), Node 170,
index harness 246, embed harness 181, 8 screenshots regenerated with their
scene checks passing and byte-identical to the ones before. Data: 84,306
words (84,300 before), 6,723 roots (6,713), 14,506 origin rows (14,488):
7,098 decomposed (7,078), 2,218 single (2,209), 5,190 row-only (5,201); 24.0
MB (23.9). Breakdown coverage of the top 10,000 ranks 38.2% (38.1%). The
1,752 misses of 2026-09-01 render 551 decomposed, 1,004 single, 197 nothing
(top 10,000: 173 / 337 / 43), against 547 / 1,004 / 201 before.

The headline. Row-only rows with no gloss at all: 3,281 of 5,201 before, 63%,
and 2,098 of 5,190 after, 40%. Inside the top 3,000 ranks, 526 before and 222
after. Inside the top 10,000, 1,173 and 569. 1,172 rows gained a gloss and 8
gained a romanization.

By language, rows without a gloss before and after: Old English 887 to 228,
Middle English 526 to 344, Old French 210 to 126, French 210 to 21, Italian
130 to 130, Spanish 115 to 115, Japanese 95 to 95, German 85 to 85, Old Norse
81 to 34, Middle French 65 to 55, Anglo-Norman 61 to 64, Arabic 57 to 57,
Sanskrit 54 to 54, Middle Dutch 49 to 44. The languages that do not move are
the ones with no extract here, which is the owner's 352 MB decision.

The regression check against the build before this round: 0 rows lost a
romanization, 1 row lost its row (fidget, to the affix rule, with the reason
in the misses report), and 9 rows lost a row gloss, each because the row
itself moved. Every one of the nine is listed: married, launch and git now
link a Latin card and read its gloss; nick reads Old French niche and the Old
French extract glosses no such page; bacon reads Anglo-Norman, which has no
extract; subpoena and twill became decomposed rows with Latin chips; tore and
sunder moved off a bare stem ending in a hyphen to the Middle English word.
50 rows changed language or shape, 9 of them inside the top 3,000, all
accounted for in the Germanic note above.

No curation entry was added in this round. Every change is a rule.

### The leading section keeps the row (dated note, 2026-09-06)

268 shipped words showed no origin row because two etymology sections
disagreed and neither supplied more than half of the card's first sense
list. bowl opens with the vessel senses from Old English bolla and fills
the rest of the list with the lawn-bowls senses from Latin bulla, so both
sections held two of four and the row was withheld. A held-out audit read
eleven of thirteen sampled words as a coverage loss: the page does state
an origin for the section the card leads with.

- A section owns the card's first senses when it supplies the first one
  and no disagreeing section supplies more of that list than it does. The
  old test asked for more than half, which two sections of two senses each
  can never meet. A tie goes to the section the card opens with, since
  that is the one the reader is looking at.
- The row is withheld where a later section supplies MORE of the list.
  robot opens with the Central European serfdom from German Robot and
  fills the other three slots with the machine from Czech robot; seal
  opens with the animal and fills the rest with the stamp; ben, groom,
  gum, coma and drake are the same shape.
- Nothing falls through to a section the reader is not looking at. A
  section that names no origin still passes the row to nobody, so found,
  a, bike and bars stay silent. The 2026-09-06 fall-through experiment
  stays refused.
- Outcome: 209 of the 268 render a row, 56 stay withheld with the reason,
  and 3 now report the reason their own section carries (san, bay and
  macon name a lemma Wiktionary never wrote). 15 more words past the rank
  cap ship a card, because their row now decomposes. No word lost a row.
- The thirty highest-ranked words that gained a row, read against the
  extracts: 26 right, 3 degraded, 1 wrong. Degraded: robin takes the
  "Also from Middle English robynet" of a page whose headline is "short
  for robin redbreast"; li takes the Korean 리 of the second clause where
  the first names Mandarin 里; lit takes līhtte, which its own page calls
  the preterite of līhtan. The wrong one was ah, and it is fixed below.

### A proposal is not a statement, in the present tense too (2026-09-06)

Unmasking the withheld rows showed ah reading Latin ad. Its page writes
"Some propose that the Middle English is borrowed from Old French a", and
the walk went through that French page to Latin. RE_STANCE_HARD already
refuses a term after "suggested", "proposed" and "suggests", so the gap
was the plural present tense alone. It now refuses "proposes" and a bare
"propose" that takes a clause. The clause test is what keeps euro, whose
page writes "a contest open to the general public to propose names" and
whose Greek row is right. Two rows moved: ah reads Middle English ah, and
spree moves off the Scots-to-Latin chain of "Watkins proposes a possible
origin" onto the French esprit of the page's own first guess.

### A glossless page steps to the page it names (2026-09-06)

A row-only row looks its term up in its own extract (2026-09-06). A page
that is only a form-of entry holds no gloss of its own, so the lookup
stopped there and the row read "From Old English cumende" with nothing
after it. The page is not silent: it says which page has the sense.

- A page with no gloss of its own steps to the page it names, and the
  step repeats, exactly as the source graph's lookup steps through a
  form-of page and an alternative-form one. An alternative spelling is
  read the way `alt_spelling_of` reads one, so an abbreviation or a
  pronunciation spelling is refused here as it is for English; any other
  form-of page names its lemma in the link of its first form-of sense.
- A spelling that names two different pages is two words and steps
  nowhere. The Middle English fond is an alternative form of fend, of
  fonned and of fonden, and the row cannot choose.
- The step is only taken where the spelling is no glossed page of its
  own, so nothing that already had a gloss changed.
- Outcome: 234 lookups stepped and 122 rows gained a gloss, none lost or
  reworded one and no row moved. right reads Old English reht "right"
  through riht, coming cumende "to come" through cuman, had hæfde "to
  have, possess" through habban, waste Old Northern French wast
  "destruction" through gast, quiche Old High German kuocho "cake; pie"
  through kuohho, thwart Old Norse þvert through þverr.
- The thirty highest ranked, read against the extracts: 27 right, 2
  degraded, 1 wrong. Degraded: worse and worst read wiersa and wierrest
  glossed "bad", which is the positive degree their pages step to. Wrong:
  tiny reads Middle English tine glossed "thine, your", because the only
  tine page the extract carries is a spelling of þin. Four more of that
  shape are in the full 122: tore (tor, a spelling of tour "tower"),
  munch (monchen, a spelling of mynchene "nun"), jakes (Jake, a spelling
  of jakke "a padded coat") and peat (pete, a spelling of pety). Where
  the extract carries one word under a spelling and the English page
  means another, no evidence on either page separates them.
- Not built: following the forms table of a page that never states
  anything. It would reach 87 more rows and read Old French trope as the
  adverb trop "excessively" where English troop wants the noun "herd".
  The count and the reason are in pipeline/cache/gloss-gap-report.txt.

### Measured after the leading-section round (2026-09-06)

Two --offline builds byte-identical, verify 110 spot checks 0 failed (the
104 the earlier notes give is stale; the build printed 110 before this
round too), gold 284 of 284 (40 rows added and 5 amended: deal and ah
state the new rule, found's reason is corrected to the one it is actually
withheld for, and coming and release pin the gloss their step supplies),
Node 170, index harness 246, embed harness 181, 8 screenshots regenerated
with their scene checks passing and byte-identical to the ones before.
Data: 84,321 words (84,306 before), 6,743 roots (6,723), 14,730 origin
rows (14,506): 7,130 decomposed (7,098), 2,248 single (2,218), 5,352
row-only (5,190); 24.0 MB. Breakdown coverage of the top 10,000 ranks
38.3% (38.2%). The 1,752 misses of 2026-09-01 render 552 decomposed,
1,017 single, 183 nothing (top 10,000: 173 / 339 / 41), against 551 /
1,004 / 197 before.

Row-only rows with no gloss: 2,098 of 5,190 before, 40%, and 2,052 of
5,352 after, 38%. Inside the top 3,000 ranks, 222 before and 194 after;
inside the top 10,000, 569 and 516. By language: Middle English 344 to
327, Old English 228 to 165, Old French 126 to 121, Italian 130 to 131,
Spanish 115 to 122, Japanese 95 to 100, German 85 to 87. The languages
that rise are the ones with no extract here, and they rise because 209
words gained a row.

The regression check against the build before this round: 0 rows lost a
row, 0 lost a gloss, 0 lost a romanization and no gloss was reworded. One
row moved, spree, to the proposal rule.

What is left is characterised in pipeline/cache/gloss-gap-report.txt,
written once on this date rather than by the build. Of the 2,052 rows
with no gloss, 1,266 are in a language with no extract here, which is the
owner's 352 MB decision and the two extracts kaikki does not publish, and
786 are in one that has an extract: 577 name a spelling the extract has
no entry for at all, 156 name one it carries only in another page's forms
table, 26 sit on a spelling the row will not guess between, and 27 end at
a page the extract never glossed. Of the 183 words rendering nothing, 160
name a lemma Wiktionary never wrote, 13 open with a section that states
no origin, and 10 are withheld by the section rule above.

No curation entry was added in this round. Every change is a rule.

### A proper-noun chip says what it names (2026-09-06)

7,172 morph chips render inert, meaning they look like a chip and open
nothing. 1,525 of them name a proper noun, and on korean an empty box
labelled Korea sat beside a filled, glossed, clickable -an, which reads
as broken rather than as out of scope.

The scope decision does not change. A proper noun gets no card, no
family, no search presence and no clickable chip. What it gets is a
gloss.

- Pass 1 harvests one line per proper-noun page, from the entry with
  the most senses, through best_gloss and the same 80-character card
  budget and 160-character safety cap every other gloss runs through.
  A page that is only a form-of entry states no sense and is skipped.
- The table is keyed by the page TITLE, not by the folded key.
  Wiktionary titles are case sensitive and a chip has to name the page
  it is glossed from: spangle splits as spang + -le and the only page
  the extract carries is the surname Spang, ghastly as gast + -ly and
  Gast is a surname too. Folding the key first glossed 326 chips off a
  page their own word never names, every one of them lower case.
- The gloss travels in `g` on the chip, the field a decomposed org part
  already uses for a stated sense, and lookup.js reads it wherever a
  chip has no card and no word to read one from.
- Outcome: 1,084 chips over 958 distinct forms gain a gloss. No chip
  gained a target, no chip lost one, and no row changed. korean reads
  Korea "A geographic region in East Asia" beside -an.
- The twenty highest, read against the extracts: 13 right, 6 degraded,
  1 wrong. The degraded ones are the card budget walking past a long
  headline sense, which the single-row note above already records for
  root cards: Lapland takes "A region in northern Finland" where sense
  1 runs to 124 characters, and Samson, Tirana, Norland and Enceladus
  are the same shape. Caspar reads "one of the Magi" where casparian
  means the botanist Caspary, whom the page never mentions. The wrong
  one is Mahdi, which reads "A male given name from Arabic" because
  both senses above it run past the cap with no clause to stop at.

### A chip shows one clause, its card shows the gloss (2026-09-06)

22,040 chip joins carried a gloss over 90 characters and clamped
mid-thought. The -μα chip on system read "Added to verbal stems to
form neuter nouns denoting the effect or result of an action..." and
stopped. 158 distinct forms did it through a root gloss and 3,937
through a word's first definition.

- The cut lives in the RENDERER, in content.js buildChipRow, beside the
  width cap and the two-line clamp it belongs with. Three things reach a
  chip gloss and only one of them is in the data: a root card's gloss, a
  parent's stated part sense, and the first definition of a word a `w`
  chip names, which is joined at runtime out of that word's senses. A
  build-side cut would have to ship a second copy of the first two and
  could not reach the third at all, and the two copies could drift from
  the card. One function at the one call site all three chip rows pass
  through covers every chip and costs no bytes.
- A clause ends at a comma, semicolon, colon or full stop that closes a
  word, outside any bracket and outside a quoted run, so "1,000" and
  "(i.e., to whom)" are not clause ends and neither is the stop in "U.S.
  Army". A boundary under 12 characters leaves a fragment rather than a
  clause, so the cut moves on: -men reads "forms nouns, usually from
  verbs" and not "forms nouns". Nothing is cut inside a word, and the
  boundary punctuation goes with the tail.
- A gloss at or under 90 characters is left exactly as written, clause
  punctuation included, so ἵστημι still reads "to stand; to set".
- A gloss the source wrote with no clause to stop at is left whole and
  the clamp holds it. 49 root-gloss forms and 797 word-definition forms
  are in that state, against 158 and 3,937 before.
- Outcome: 21,407 chip joins are cut, and chip joins over 90 characters
  fall from 22,040 to 3,987. system reads -μα "Added to verbal stems
  to form neuter nouns denoting the effect or result of an action" and
  the grc:-μα card still carries the whole line.
- The trim is a rendering rule, so the gold set cannot pin it. Both
  harness pages pin it instead, on a fixture root whose gloss runs to
  the safety cap: the chip shows the clause, the card shows the line.

### A row gloss is a fragment, not a sentence (2026-09-06)

218 of 3,300 row glosses arrived as sentences, with a capital, a full
stop or both, because the source wrote them in a definition field. Side
by side bowl read "(bowl)" and girl "(A child; a young person of either
sex.)".

- At emit, a row-only gloss loses a trailing full stop that closes no
  abbreviation and has its first letter lowered. Only the row-only shape
  is touched: a single row and a chip read their wording off a root
  card, which is a card's own line.
- The test for a name is the dictionary's own definition text, which is
  English prose in the same register. A word the definitions write in
  lower case INSIDE a sentence at least as often as they capitalise it
  there is an ordinary word and is lowered. Anything else is left alone,
  so a word the definitions never use keeps its capital and the test
  errs toward names. Definition-initial words are not counted, since
  their case is the question being asked. Evidence: 185,476
  definitions, 59,197 lower-case types and 9,268 capitalised ones.
- An initialism is never lowered: a token whose letters are all capitals
  once its stops are removed, so POW camp keeps POW.
- A name PHRASE keeps its capital through its second word: lake and king
  are ordinary words, Erie and Philip are not, so "Lake Erie" and "King
  Philip II of Spain" stay as they are. The rule fires on exactly those
  two rows and no others.
- Outcome: 151 rows are reworded, 141 of them by lowering the first
  letter and 10 by dropping a full stop alone. 68 keep their capital:
  Navajos, Arabs, Algonquin language, Latin American, British, Norse,
  Friday, Boche, POW camp, Dittrichia viscosa and the pronoun I among
  them. No row ends in a full stop now, and no row lost a gloss.
- All 141 rows whose capital was lowered were read back. Four are
  wrong, and all four are homographs: moloch reads "ammonite god" where
  Ammonite is the people, winnebago "winnebago person", moro "moor"
  where Moor is the demonym, and pagoda "holy One". The definitions
  write ammonite of the fossil, winnebago of the motorhome and moor of
  the heath, so the lower-case evidence is real and says the wrong
  thing.
- One row keeps a capital it should not have: enamored, whose
  Anglo-Norman row reads "Enamoured, lovestruck; deep in love". The
  definitions spell the word the American way, so the British spelling
  has no lower-case evidence at all.
- An evidence floor was measured and refused. Requiring two lower-case
  uses rather than one rescues Ammonite and Winnebago and capitalises
  "Purifying; removal of impurities" wrongly; a floor of three adds
  Cheddar and Yelling; four adds Idiocy, Gibbon and Gnawing. The best
  of them trades three wrong rows for two, which is a tuned constant
  bought with one row, so the rule stays as written and the five rows
  are recorded here instead.

### A chip takes a recorded form and refuses a guessed one (2026-09-06)

resolve_part asks one question of a chip that is no affix: is this
spelling itself a shipped word. A reader selecting the same text is
asked more, because the runtime resolver falls through to forms.json and
then to the suffix rules. So a selection of "struck" reached strike
while the struck chip on awestruck opened nothing.

Measured over the 7,172 inert chips: 1,525 name a proper noun and the
rule above glosses them; of the 5,647 that do not, the recorded steps
reach 1,119 and the suffix rules 60 more.

- The RECORDED steps are taken: the shipped key and the forms.json map,
  both of which are Wiktionary saying that this spelling is a form of
  that word. Thirty read against the extracts: 30 right. seemeth reaches
  seem, pence reaches penny, haemoglobin reaches hemoglobin, sung
  reaches sing, learnt reaches learn.
- The suffix rules are REFUSED. A selection may guess, because the
  reader chose the text and gets an answer or none; a chip is the
  dictionary stating what a word is made of, and a guess there is a
  wrong statement. All 60 read against the extracts: 39 right, 21 wrong.
  The wrong ones are the -er, -ed and -est strips landing on a short
  stem that happens to ship: adulterer's adulter to adult, attercop's
  atter to att, yammerer's yammer to yam, juddery's judder to jud,
  natterer's natter to nat, dickerer's dicker to dick, congestive's
  congest to cong, divestment's divest to div, tetterwort's tetter to
  tet, tabid's tabes to tab, multihued's hued to hu, bilobed's lobed to
  lob, addlepated's pated to pat, twitterpated the same, brilliant's
  briller to brill, aniseedy's aniseed to anise, stockbroking's broking
  to broke, and the plurals of adulteress and attery and rose-hued.
  There is no length or shape that separates them from the 39; the
  difference is that the source recorded one relation and not the other.
- A chip written with a capital is refused as well. forms.json is keyed
  by the folded spelling, so folding a capitalised chip changes which
  page it names: Ares lands on are, Aten on eat, Yeats on gate, Paris on
  peri and Mary on marry. All 30 of those are proper nouns whose own
  gloss the chip already carries.
- The step runs at emit, after forms.json is assembled and after the
  US-primary re-keying, so both tables are the ones that ship. That is
  also what reaches the 20 chips whose spelling only became a shipped
  key when the record moved to it: distill, humor, favorable, somber.
- Outcome: 1,202 chips gain a word card and 5,970 stay inert, 1,084 of
  them glossed. No chip lost a target and no row changed. awestruck
  reads awe + struck with struck opening strike, and thoroughbred reads
  thorough + bred with bred opening breed.

### Measured after the reading round (2026-09-06)

Two --offline builds byte-identical, verify 110 spot checks 0 failed,
gold 293 of 293 (9 rows added and 3 amended), Node 172, index harness
254, embed harness 185, 8 screenshots regenerated with their scene
checks passing and byte-identical to the ones before. Data: 84,321
words, 6,743 roots, 110,717 forms rows, 14,730 origin rows unchanged;
20.8 MB, 0.8 MB and 2.5 MB, 24.1 MB total (24.0 before). Breakdown
coverage of the top 10,000 ranks 38.3%, and the 1,752 misses of
2026-09-01 render 552 decomposed, 1,017 single, 183 nothing, all
unchanged: this round moved no row and no card, only their wording and
their links.

What moved. 1,084 inert chips gained a gloss, 1,202 inert chips gained a
word card, 151 row glosses were put in the fragment register, and 21,748
chip joins are cut to a clause at render. Chips over 90 characters fall
from 22,384 to 4,045. Words carrying a used-in list rise from 17,867 to
18,006 and used-in rows from 61,688 to 62,890.

The regression check against the build before this round: 0 words, roots
or forms rows lost, 0 chips lost a target, 0 chips changed target, 0 rows
lost, 0 rows lost a gloss or a romanization, 0 org rows changed shape and
0 root glosses changed. There are no exceptions to list. No word lost a
used-in row either, and the lists grow from 17,867 words to 18,006.

The hand checks. Twenty proper-noun chips: 13 right, 6 degraded, 1
wrong. Thirty recorded chip targets: 30 right, and the 60 the suffix
rules would have added were all read, 39 right and 21 wrong. All 141
lowered row glosses: 137 right, 4 wrong, each of the four a homograph
whose lower-case sense is a different word.

What is left. The two-line clamp still bites on a first clause longer
than about 44 characters, which is what a chip 120 pixels wide can show.
Cutting to the clause takes chip joins over that width from 74,389 to
64,791; a budget of 44 rather than 90 would take it to 39,808 but would
cut 68,008 joins, half of every chip in the dictionary, including the
ones that render whole today. The -μα chip on system is in the residue:
its first clause is 84 characters and the source wrote no earlier one.

No curation entry was added in this round. Every change is a rule.

### A modifier opens at "<" (2026-09-06)

A parsing defect, found while reading the inert chips. `clean_part` swept
inline modifiers with a single `<[^>]*>` pass, which closes on the INNER
tag of a modifier that holds markup of its own and then reads the note's
prose as part of the form. worldwide's `world` chip shipped as 90
characters of the OED entry for it, Honolulu's `hono` as "honowhanga" out
of a cognate note, pedestrian's as "pedesterpedestri-". 434 args across the
three extracts were affected.

- One depth counter reads every modifier, nesting and all; an unclosed
  `<` correctly eats the rest, since markup is what follows it.
- An arg that is nothing but modifiers states its form in `alt`, which is
  how a bound stem is written. Reading it keeps me = m + -e and κλέπτης =
  κλεπ- + -της on the card at all. Where the arg names a term of its own
  that term is the form: `alt` is a display Wiktionary substitutes and the
  chip has to name a page. Three rows now show the lemma the source links
  rather than the form it displays (curtain and cortina read -īnus for
  -īna, keds -ēs), which is the cost of having one field do both jobs.
- A prefix naming where a term lives is stripped whether it is a language
  code, one of the dotted Latin-period abbreviations the origin tables
  already carry, or the `w:` interwiki: chemical shipped `NL.:chēmicus`
  and alevism `w:Alevi`.
- The `a//b` alternation takes the first form, which is clean_term's rule
  on the same args for the source-language lookups. The two callers had
  drifted and kiwifruit rendered `Kiwi//kiwi`.

Outcome: 30 words read a different breakdown, every one of them a
correction; 5 words gain a card and none loses one; 6 origin rows change,
phase reading φάσις = φαίνω + -σις where it read a single row before.

## Naming (Jesse decision 2026-08-25)

The Korean-era internal names are renamed wholesale: globals
`__hanjaHover` to `__etymikon`, `__hanjaHoverTestRuntime` to
`__etymikonTestRuntime`, `__okpyeonSidebar` to `__etymikonSidebar`,
`__okpyeonEmbed` to `__etymikonEmbed`, `__okpyeonEmbedApi` to
`__etymikonEmbedApi`, `__okpyeonSearchShell` to
`__etymikonSearchShell`, `__okpyeonSuppressDownload` to
`__etymikonSuppressDownload`; element id prefix `okp-` to `ety-`;
storage keys `okpSaved` and `okpSettings` to `etySaved` and
`etySettings` WITH one-time migration: on first read, when the new
key is absent and the old key holds data, the old value is adopted
under the new key and the old key removed. Wherever the carried-over
Okpyeon spec sections name the old identifiers, read the new ones.

## Carried-over shell (binding by reference to Okpyeon SPEC @ v1.1.0)

These mechanisms carry over with only naming and content changes, and
their Okpyeon spec sections remain binding: popup shell (shadow root,
positioning, dismissal, resize, dark mode, z-index), breadcrumb
navigation whole (canonical crumbs, cycle rule, width-based truncation,
ellipsis button, scroll restoration), gloss presentation (numbered
senses, clamp, geometry-derived expander), nav-row affordances and
whole-card pagination, the badge registry, the card actions registry,
save bubble and saved/settings views and their schemas, the sidepanel
registry (views, header actions, pending-query handshake, focus rules,
Escape rules), omnibox plumbing, Wiktionary background-open, the corner
seal mechanism, the embed contract and search shell, the test harness
pattern (Node suite plus browser self-check pages with byte-identical
fixture blocks), make_zip/make_icons/make_promo/make_screenshots
tooling. Where those sections say hanja/hangul/eumhun, read
word/root/gloss per this spec; where they name data files or message
types that no longer exist, the feature is deleted.

## Verification expectations

- Pipeline: build report with counts, anchors green, determinism
  double-run byte-identical, no truncated strings, license file updated
  (English/Latin/Greek Wiktionary CC BY-SA attribution; hermitdave MIT;
  BabelStone and Unihan sections deleted).
- lookup.js: Node suite over schema-exact inline fixtures: token
  extraction, case folding, forms map, each suffix rule and its repair
  cases, morphs join, root/family requests, family ranking, omnibox
  suggestions, tier function cutoffs, root `parts` passthrough, and
  transitive family crediting (a word crediting an anchor whose parts
  credit a base root, a nested anchor, a cycle guard, once-per-word).
- Harness pages: fixture blocks rewritten to English fixtures
  (byte-identical across the two pages, the carried-over rule): word
  card sections render and order correctly, breakdown chips navigate,
  inert chips do not, org row navigates, root card family paginates
  with the whole-card rule, formOf note scoping, saved/star/bubble and
  settings against English fields, sidebar views and handshake, tier
  chips exclusive, the root card MADE OF row (renders on an anchor
  root between gloss and family, absent on an affix root and a plain
  root, a chip pushes the part's root card root to root, the crumb
  returns), on both pages.
- Real-app pass: test-page/index.html rewritten with English staging
  content (paragraphs containing anchor words), screenshots via the
  carried-over CDP harness with English scenes.
