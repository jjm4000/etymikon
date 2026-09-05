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
    ships, absent for an inert chip. Parts come from the recursive
    flattening rule below.
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
  render without the hover affordance. Chip gloss text clamps to 2
  lines with a bounded chip width; the chip is the one place a long
  root gloss must never dominate the card. Section absent when no
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
  every anchor whose lemma decomposes carries `parts`, and no other.
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
  tree, and from the etymology prose (PENDING SPIKE: the prose grammar
  and its acceptance numbers are specified in a follow-up amendment
  once pipeline/spike-origin.md reports; the rule shape is "From X (…)
  + Y (…)" and "equivalent to X + Y" with mention templates supplying
  each term's language).
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

Phase one: Latin and Greek graphs with the prose parser, the French
pass-through group, never-silent rows and cards, row-only rows with
romanization, the gold set, the misses report with reasons. Phase two:
the Old English graph with Middle English as pass-through. After phase
two: re-measure Old Norse for a root role.

### Verification additions

- Graph checks: no cycles, no dangling edge, every node reachable from
  at least one English word ships.
- Anchors added 2026-09-05: manuscript carries manūscrīptus = manus +
  scrībō, both linked; idea carries a single row naming grc:ἰδέα and
  that root ships; system carries σύστημα decomposed; period carries
  περίοδος = περι- + ὁδός; curious carries cūriōsus = cūra + -ōsus;
  sock carries a single row naming la:soccus and that root ships with
  a family of at least one; sky carries a row-only single row with
  lang non and no `r`; no word with an origin template to a classified
  language ships with neither morphs nor org, except through a drop
  whose reason is in the misses report.
- The gold score is printed and gated as specified in Principle 5.

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
