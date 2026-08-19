# Hanja Hover — Shared Spec

Chrome extension (Manifest V3): highlight (select) CJK text on any page → popup shows
Korean pronunciation, eumhun (e.g. "나라 국"), definitions, and common compounds,
sourced from Wiktionary (via kaikki.org build-time extract).

## Directory layout & ownership

```
D:\Code\Hanja\
  SPEC.md                 # this file (do not edit)
  pipeline\               # Agent A owns everything here
    cache\                # downloaded raw data (gitignored-style scratch; large)
    *.py / *.mjs          # build scripts
  extension\
    manifest.json         # Agent B owns
    background.js         # Agent B owns (MV3 service worker)
    data\                 # Agent A owns final contents (see "Placeholder rule")
      hanja.json
      words.json
      variants.json
    content\              # Agent C owns
      content.js
      content.css
    options\              # Agent C owns (optional, keep minimal)
    icons\                # Agent B owns (simple generated PNGs are fine)
```

**Placeholder rule:** Agent B may create small fixture versions of the three data
files ONLY if they don't exist yet, and each must contain a top-level
`"placeholder": true` key. Agent A overwrites them unconditionally with real data
(real files have no `placeholder` key). Nobody else touches `extension\data\`.

**Manifest rule:** Only Agent B edits `manifest.json`. It MUST register
`content/content.js` + `content/content.css` as content scripts on `<all_urls>`
(run_at `document_idle`), declare `extension/data/*` as web-accessible/fetchable by
the service worker, and use `background.service_worker: "background.js"`.
No host permissions needed (all data is bundled). Permissions: none required
beyond defaults; add `storage` only if options page needs it.

## Data files (produced by Agent A)

All JSON, UTF-8, no BOM. Top-level shape:

### variants.json
```json
{ "version": 1, "map": { "国": "國", "学": "學" } }
```
`map`: variant codepoint → canonical (traditional, as used by Korean hanja) form.
Sources: Unihan kTraditionalVariant/kZVariant/kSemanticVariant + Wiktionary
"alternative/simplified form of" links. Only include entries whose canonical form
exists in hanja.json. Self-mappings omitted.

### hanja.json
```json
{
  "version": 1,
  "chars": {
    "國": {
      "eumhun": [ { "hun": "나라", "eum": "국" } ],
      "readings": ["국"],
      "glosses": ["country; state; nation"],
      "compounds": [
        { "hangul": "국민", "hanja": "國民", "gloss": "people of a nation" }
      ]
    }
  }
}
```
- `eumhun`: may have multiple entries (multiple readings). `hun` is the native
  Korean gloss word, `eum` the sound. If only a reading is known, `hun` may be "".
  Normalization (ADDENDUM): strip wiktextract markers (leading `^` — a
  capitalization flag, not content) from hun/eum, THEN dedupe pairs (韓 must
  come out as exactly [한국(韓國) 한, 나라 이름 한]).
- `glosses`: short English definitions, deduped, max ~6.
- `compounds`: top compounds containing this character, ranked most-common first,
  max 8. `gloss` is a single short English gloss.
- `lvl` (ADDENDUM — character level taxonomy, REPLACES the earlier edu/eduT
  fields; nothing shipped them, migrate cleanly): EVERY char entry carries
  exactly one of `"m" | "h" | "a" | "r"`:
  - `m` / `h`: MOE curriculum middle/high tier — same sources and invariants
    as before (Unihan kKoreanEducationHanja membership is authoritative; the
    CC BY-SA Korean-Wikipedia tier table with the glyph-variant bridge
    assigns m vs h; an in-membership char with no tier falls back to `m`?
    NO — there are zero such chars today; if the sources ever diverge, emit
    the char as `a` and FAIL a verify anchor so the divergence is looked at).
  - `a` (Advanced): outside the curriculum but genuinely attested in use.
  - `r` (Rare): archaic/specialist/reading-only tail.
  The a/r boundary is a calibrated build-time predicate in the spirit of the
  word-rare flag: corpus-frequency signals, compound-index depth, native-hun
  presence, and gloss provenance (the build must now TRACK which glosses came
  from Unihan kDefinition gap-fill — a strong rare signal — even though
  provenance itself is not emitted). Anchors + a 10+10 random sample per zone
  in the report; naive hun/cw-count predicates admit dead Ext-A chars into
  `a` and are insufficient. Distribution sanity: m≈899, h≈895, a in the low
  thousands, r the remainder; every char has exactly one lvl (verified).
  `lvl` propagates wherever edu did: char matches, reading-index candidates,
  AND the reading-match candidate rebuild (the known trap site). The omnibox
  dim tail replaces "기초" with the school levels only (short forms 중학/고교;
  a/r add nothing there).
- `cw` (ADDENDUM — complete compound index): EVERY words.json spelling that
  contains this character, as a bare array of spellings pre-sorted by the
  build-time frequency score, best first (ranking is baked into array order —
  no scores are shipped). Superset of the spellings in `compounds`. Omitted
  when empty. Glosses/hangul are NOT duplicated here; the service worker joins
  them from words.json on request.
- No truncation (ADDENDUM): gloss strings anywhere in the data (char glosses,
  word glosses, compound glosses, part glosses) are emitted in full — never cut
  with `…`. A generous safety cap (~400 chars) may drop a whole overlong sense,
  but must never emit a cut string. Visual compactness is the UI's job (clamp +
  expander), not the data's.

### words.json
```json
{
  "version": 1,
  "words": {
    "國民": [ { "hangul": "국민", "glosses": ["the people; citizens of a nation"] } ]
  },
  "byHangul": {
    "국민": ["國民"]
  }
}
```
`words`: keyed by hanja spelling; value is an array (homograph spellings possible).
Include Korean entries (any pos) that have a hanja form of length ≥ 2.
Max ~3 glosses per sense-set.

Canonical keys (ADDENDUM — fix): every `words` key is VARIANT-CANONICAL —
each character already mapped through variants.map, using the same map the
runtime applies before lookup. Source spellings that canonicalize to the
same key merge into one bucket (glosses deduped, hp any-wins, rare
all-wins, scores max). byHangul values and the per-char `cw` indexes use
the canonical keys. Invariant (build-verified): canonicalizing any words
key is a no-op — no shipped record can be unreachable or shadowed at
lookup time.

Length metadata (ADDENDUM — fix): words.json carries top-level
`"maxWordLen"` and `"maxHangulLen"` — the actual longest hanja key and
byHangul key (data has headwords up to 11 chars, e.g. 中華人民共和國;
the old hardcoded 6 made them unreachable as whole words). Rules 3/3b and
parts segmentation use these (falling back to 6 when absent). The rule 1
input cap (20 relevant chars) is unchanged and still bounds everything.

Hanja-page flag (ADDENDUM): a sense-set gets `"hp": true` when its Wiktionary
entry was harvested from the hanja-spelling page (大韓民國, 安全) rather than
the hangul page (국민). Even stub Korean sections qualify: the hanja-titled
page carries the Chinese/Japanese entries for the same spelling, which is
where the cross-language value lives. Omitted when false. Propagated onto
word matches like `rare`; the UI uses it to pick the Wiktionary link target.

Rare flag (ADDENDUM): a sense-set gets `"rare": true` when the build-time
frequency proxy shows no attestation for it (no example-sentence n-gram hits,
no inbound links — pipeline calibrates and reports the flagged fraction).
Sanity anchors: 국민/학교/자본주의 NOT rare; 舍廊 (사랑) and 牛李 (우리) rare.
Purpose: hangul reverse lookups that hit only obscure homographs of common
native words must not present as confident matches. The flag is omitted when
false.

`byHangul` (ADDENDUM — reverse lookup): hangul spelling → array of hanja spellings
that appear as keys in `words`. One entry per sino-Korean word; multiple hanja
spellings for the same hangul are ALL listed, no cap, more common ones first if
a ranking signal exists. This powers highlighting 국민 and getting 國民 plus its
component hanja.

## Message protocol (content script ↔ service worker)

Content script sends via `chrome.runtime.sendMessage`:
```json
{ "type": "lookup", "text": "國民이" }
```

Service worker responds:
```json
{
  "ok": true,
  "matches": [
    { "kind": "word", "surface": "國民", "canonical": "國民",
      "hangul": "국민", "glosses": ["the people; citizens"],
      "chars": ["國", "民"] },
    { "kind": "char", "surface": "国", "canonical": "國",
      "eumhun": [{ "hun": "나라", "eum": "국" }], "readings": ["국"],
      "glosses": ["country; state; nation"],
      "compounds": [{ "hangul": "국민", "hanja": "國民", "gloss": "..." }] }
  ]
}
```
On failure: `{ "ok": false, "error": "message" }`.

ADDENDUM — `kind:"char"` matches carry `"cwCount": N` (total entries in the
char's `cw` index; omitted when 0), so the UI can render "Show 5 more (N)"
before ever requesting the full list.

ADDENDUM — used-in (larger words containing a word): `kind:"word"` matches
carry `"usedInCount": N` — the number of words.json spellings that strictly
contain the match's canonical spelling (self excluded; omitted when 0).
Derived from the first character's `cw` index (already ranked), falling back
to a wordTable scan if that char has no entry. A new request returns the full
ranked list:
```json
{ "type": "usedIn", "word": "學生" }
```
Response: `{ "ok": true, "words": [ { "hanja": "大學生", "hangul": "대학생",
"gloss": "university student", "rare": true? } ] }` — same row shape and join
rules as the compounds response. Unknown word or empty result →
`{ ok: true, words: [] }`. Pure logic in lookup.js (`buildUsedIn`), glue in
background.js.

ADDENDUM — full compound list request (powers the "show more" compounds UI):
```json
{ "type": "compounds", "char": "學" }
```
Response: `{ "ok": true, "compounds": [ { "hanja": "大學", "hangul": "대학",
"gloss": "university", "rare": true? } ] }` — every entry of the char's `cw`
index joined against words.json (first sense: hangul, first gloss or "",
`rare` propagated only when true), preserving `cw` order. NFC-normalize and
variant-map the incoming char first. Unknown char or empty index →
`{ ok: true, compounds: [] }`. Pure join logic lives in lookup.js
(`buildFullCompounds`), chrome glue in background.js.

ADDENDUM — word parts: every `kind:"word"` match whose canonical spelling is
≥ 3 chars gets a `parts` field: the word's interior re-segmented against
`words` (the full span itself excluded), covering the word in order. Parts
segmentation is NOT greedy longest-match: it picks the segmentation that
maximizes, in order of priority, (1) chars covered by gloss-bearing sub-words,
(2) chars covered by any sub-word, (3) fewest segments. (Rationale: greedy
grabs stub entries like gloss-less 資本主 and splits 資本主義 as 資本主+義;
the correct explanatory split is 資本+主義. Run segmentation in rules 3/3b
stays greedy — this applies to parts only.)
```json
"parts": [
  { "type": "word", "hanja": "資本", "hangul": "자본", "glosses": ["capital"] },
  { "type": "word", "hanja": "主義", "hangul": "주의", "glosses": ["-ism; doctrine"] }
]
```
Single characters not covered by a sub-word appear as `{ "type": "char",
"char": "資" }`. Omit `parts` entirely when no multi-char sub-word is found.
Sub-word `glosses` capped at 2 (first sense). This applies to Han-sourced and
hangul-sourced word matches alike, per homograph spelling.

ADDENDUM — a third match kind, `"reading"`, returned when the entire extracted
selection is a single hangul syllable:
```json
{ "kind": "reading", "surface": "국", "eum": "국",
  "candidates": [
    { "char": "國", "hun": "나라", "eum": "국", "gloss": "country; state; nation" }
  ] }
```
`candidates`: every hanja whose readings include that eum — ALL of them, no cap
(the UI list scrolls) — ranked by how many compounds its entry has (descending —
a rough frequency proxy). `gloss` is the entry's first gloss ("" if none). The
index (eum → chars) is derived lazily at runtime from hanja.json
readings/eumhun; it is NOT a data file.

Service worker behavior:
1. Extract Han runs (`/\p{Script=Han}/u`) AND Hangul runs
   (`/\p{Script=Hangul}/u`) from `text`, preserving order. Cap input at 20
   relevant chars total.
2. NFC-normalize, then apply `variants.map` per Han character → canonical string.
3. Han-run segmentation: greedy longest-match against `words` (max word length 6).
   Matched spans → `kind:"word"` match. Every unmatched char, AND every char that
   only appeared inside word matches when the selection contains ≤ 4 **Han**
   chars (hangul and other scripts don't count toward this threshold — the char
   cards are the educational payload, and selecting 國民이라는 must still show
   the 國/民 cards), gets a `kind:"char"` match appended after the word matches
   (deduped). A single-char selection returns just the char match.
3b. Hangul-run segmentation (ADDENDUM — reverse lookup): greedy longest-match
   against `byHangul` (min length 2, max 6). Each matched hangul span resolves
   to its hanja spelling(s) in `words` → `kind:"word"` match with `surface` =
   the hangul span, `canonical` = the hanja spelling, plus `chars`. For
   hangul-sourced word matches ALWAYS append `kind:"char"` matches for the
   component hanja (that is the educational point), regardless of selection
   length; dedupe across the whole response. If one hangul span has multiple
   hanja spellings, emit a word match per spelling — ALL spellings, no cap (the
   UI renders a selector) — component char cards only for the first.
   Rare flag (ADDENDUM): word matches carry `"rare": true` when their sense-set
   is flagged rare in words.json (omitted when false; Han- and hangul-sourced
   alike). When a hangul span has both rare and non-rare spellings, non-rare
   spellings order FIRST, and the first non-rare spelling contributes the
   component char cards.
3c. Single hangul syllable (ADDENDUM — homophone browse): when the entire
   extracted selection is exactly one hangul syllable, return a
   `kind:"reading"` match (see protocol addendum) listing every hanja with that
   eum. The UI drills into individual chars via ordinary follow-up lookups
   (`{type:"lookup", text:"國"}`), so no new request type is needed.
4. Unknown chars (no entry after variant mapping) are silently skipped; if nothing
   matches, return `{ ok: true, matches: [] }`.
5. Data files are fetched from `chrome.runtime.getURL("data/…")` lazily on first
   lookup and cached in a module-level variable (service worker may restart;
   that's fine).

## UI behavior (Agent C)

- Trigger: `mouseup` (and `keyup` for keyboard selection). If
  `window.getSelection()` text contains ≥ 1 Han char OR ≥ 1 Hangul syllable
  (and ≤ ~30 chars total), send lookup; else ensure popup hidden.
  (Hangul-only selections may return empty matches for native words — that's
  normal, just don't show a popup.)
- Reading match (ADDENDUM — homophone browse): render `kind:"reading"` as a
  scrollable list titled with the syllable (e.g. "국 — N hanja"); each row shows
  the glyph, its eumhun ("나라 국"), and the short gloss. Clicking a row sends a
  follow-up `{type:"lookup", text: "<char>"}` and replaces the popup content
  with that char card, plus a "← back" control that restores the list (cache
  the list response in-memory; don't re-query). Rows are click targets — this
  is the one place popup clicks navigate rather than just allowing text copy.
- Homograph words (ADDENDUM): when a response contains multiple word matches
  sharing the same `surface` (e.g. 사기 → 詐欺/士氣/沙器…), render ONE word
  card with a selector row of hanja-spelling chips instead of stacked cards;
  clicking a chip swaps the card body from data already in the response. The
  first spelling is selected by default. Word matches with distinct surfaces
  still stack as separate cards.
  The response only carries component char matches for the FIRST spelling
  (rule 3b), so on chip swap the UI must also refresh the char cards below:
  send follow-up `{type:"lookup", text: "<char>"}` for each character of the
  newly selected spelling (these single-char lookups return the char card
  data), replace the displayed char cards (and the word card's chips) with the
  results, and cache per spelling in-memory so revisiting a chip never
  re-queries. Char cards belonging to OTHER word/char matches in the popup
  (distinct surfaces, unmatched chars) are untouched by a chip swap.
- Word cards: display `canonical` (hanja) as the big text with `hangul` beside
  it — `surface` may be either script depending on what was highlighted.
- Rare homographs (ADDENDUM): a HANGUL-sourced word match with `rare: true`
  renders hedged — muted styling under a small label in the house label style,
  e.g. "RARE HANJA HOMOGRAPH", communicating "the word you selected is likely
  native Korean; an obscure hanja spelling happens to exist." When a hangul
  span yields ONLY rare matches, the whole card group gets this treatment; when
  rare and non-rare spellings mix in a homograph selector, rare chips are muted
  and marked (e.g. superscript "rare") while the card stays normal. Component
  char cards nested under a hedged card inherit nothing special — the label
  reframes the whole card. Han-sourced matches (user selected the hanja
  characters themselves) IGNORE the flag and render normally.
- Popup: single host `<div>` appended to `document.documentElement` with a closed
  shadow root; all styles inside the shadow root (content.css is injected as a
  <style> tag inside shadow root — fetch its text via
  `chrome.runtime.getURL`, or inline the CSS string in JS; content.css is still
  registered in the manifest but may be a comment-only stub if styles are inlined).
- Card layout, word match: big hanja surface, hangul + glosses, then a row of small
  per-character eumhun chips (from `chars`, looked up in the same response only if
  provided — otherwise chips omitted).
- Gloss presentation (ADDENDUM): everywhere multiple senses render (word cards,
  char cards), show them as a NUMBERED sense list (1. 2. 3.) with hanging
  indent so sense boundaries are unambiguous. Capitalize the first letter of
  each sense at display time (data stays faithful to the source). Long senses
  clamp to 2 lines with an inline "more" expander that reveals the full text in
  place (popup may grow within its max-height; re-anchor after expand).
  Single-gloss lines (compounds, component-word rows) clamp to one line with
  the same expander affordance when overlong. No `…` may hide content the user
  cannot reach.
  Expander state is GEOMETRY-DERIVED (ADDENDUM — fix): whenever layout
  re-measures (panel resize, width change, content growth), each clampable
  element's control is re-derived from actual overflow: if the content now
  fits within its clamp lines un-expanded, the control disappears entirely
  and any expanded state resets; if it still overflows, the control shows
  "more"/"less" per current state. A stale "less" on text that no longer
  needs clamping (shrink → expand → widen) must be impossible.
- Card layout, char match: big glyph, "나라 국"-style eumhun line, readings if no
  eumhun, glosses line, then up to 5 compounds as "국민 (國民) — gloss" lines.
  The big glyph is ALWAYS the canonical character (same rule as word cards);
  a variant surface (highlighting 国) appears only in the "国 → 國" note.
  Variant-note scope (ADDENDUM — fix): the note renders ONLY when the variant
  surface actually occurs in the CURRENT view's source text (the text that
  view was looked up from). Cached char data reused in drill-down views must
  not drag a stale surface along: selecting 学生 shows "学 → 學" on the root
  view's 學 card, but after drilling to 文學, its 學 component card renders
  plain 學 with no note. Same rule for word cards' surface → canonical note.
- Compound navigation + pagination (ADDENDUM):
  - Compound lines on char cards are NAV ROWS, exactly like component-word
    rows: chevron affordance, hover state, click → follow-up
    `{type:"lookup", text: "<compound hanja>"}` replacing the popup content
    with that word's card, breadcrumb grows, cached per target. The gloss
    "more" expander on a row must still not trigger navigation.
  - After the inline compounds (5 shown), when the char's full index holds
    more, render a "Show 5 more (N)" control (N = remaining count). First
    press sends ONE `{type:"compounds", char}` request, caches the joined
    list for the popup session, and reveals the next 5 (skipping spellings
    already displayed, comparing by hanja spelling); each further press
    reveals 5 more locally. The control shows the updated remaining count,
    disappears when exhausted, must not be swallowed by row navigation,
    keeps itself in view (no scroll jump), and re-anchors the popup after
    growth. Revealed rows are nav rows identical to the inline five; rows
    for `rare` words render with the muted rare treatment.
  - Whole-card rule (user-directed 2026-08-18): when the inline rows plus
    the remaining count fit within the inline display cap (MAX_COMPOUNDS,
    NOT the page size — the rule tracks "what a card normally shows" and
    must follow that cap if it ever changes), fetch the index up front
    and render the section whole, no control. A curated-empty card (又:
    inline 0, index 3) must never show a Compounds header with nothing
    under it. On fetch failure the control reappears as the retry path;
    if the fetched index exceeds the estimate, the control surfaces with
    the corrected count.
  - Applies to char cards everywhere they appear (top-level, nested
    component cards, drill-down views).
- Wiktionary links (ADDENDUM): every word card and char card carries a small
  "Wiktionary ↗" link in the card's TOP-RIGHT CORNER (option A: labelled text
  link, muted color, hover reveals link color + underline; a step smaller on
  nested component cards to match their reduced scale), opening in a new tab. URLs are derived at runtime, no data changes:
  char cards → https://en.wiktionary.org/wiki/<canonical>#Korean ; word cards →
  the HANGUL headword page https://en.wiktionary.org/wiki/<hangul>#Korean
  (Korean word entries live at the hangul title; fall back to <canonical> if
  hangul is missing) — EXCEPT when the match carries `hp: true`, in which case
  the link targets the hanja-spelling page <canonical>, which hosts the
  fuller CJK entry. Keep the #Korean anchor in both cases — hp pages have a
  Korean section too, and the reader can scroll up to Chinese/Japanese. Encode with encodeURIComponent. target="_blank" with
  rel="noopener noreferrer". Clicking the link must not be swallowed by popup
  click handling (and naturally ends the popup session when the tab opens).
  Reading-list rows get no link (their drill-down char card has one).
- Position near the selection rect (`getRangeAt(0).getBoundingClientRect()`),
  below by default, flip above near viewport bottom, clamp horizontally.
- Dismiss on: click outside popup, Escape, scroll, or new selection. Clicking
  inside the popup must not dismiss it (allow text copy).
- Max height ~360px with internal scroll; width ~340px. System font stack; support
  dark mode via `prefers-color-scheme`. z-index high (2147483646).
- Resizable (ADDENDUM, stage 1 — no persistence): the panel is user-resizable
  via a native drag handle (CSS `resize: both` on the panel or equivalent),
  bounded to min ~280×220 and max ~90vw × ~85vh. A user-chosen size survives
  for the lifetime of the page visit (the reused host element), across popup
  dismiss/reopen and drill-down navigation; a page reload returns to the
  default. Positioning/re-anchoring must RESPECT the current panel size
  (clamp and flip with actual dimensions, never snap back to defaults
  mid-session). Resizing must not dismiss the popup or trigger row clicks;
  re-anchor after a resize ends. (Stage 2, persisting the size via
  chrome.storage, is deferred to the options-page release.)
- Multiple matches stack vertically in one popup, words first.
- Component grouping (ADDENDUM): char cards that are components of a word match
  must be visually nested under that word's card rather than stacked as peers —
  indented with a left accent rail (or equivalent containment), under a small
  uppercase label in the style of the COMPOUNDS label (e.g. "COMPONENT HANJA"),
  so the hierarchy word → its characters is legible at a glance. Each word card
  groups its own components; char cards for unmatched/independent characters
  remain top-level peers with the current styling. This grouping is the same
  ownership relation already tracked for homograph chip swaps, and swaps must
  replace cards within the group. Component char cards keep their full content
  (eumhun, glosses, compounds).
- Component words (ADDENDUM): when a word match carries `parts` with ≥ 1
  multi-char sub-word, render a "COMPONENT WORDS" section (same label style)
  ABOVE the component-hanja section: one row per `type:"word"` part — hanja,
  hangul, first gloss — clickable exactly like a reading-list row: follow-up
  `{type:"lookup", text: "<part hanja>"}`, popup content replaced by that
  word's own card (which may itself have parts — recursion via navigation),
  "← back" restores, results cached per part. `type:"char"` parts get no row
  (they're already in the component-hanja section). Homograph chip swaps swap
  the parts section along with the rest of the card body.
- Level chips (ADDENDUM — REPLACES the Basic-1800/tier badge design; the
  taxonomy makes the field universal): every char card head and reading-list
  row renders EXACTLY ONE level chip from `lvl`, via four mutually exclusive
  badge-registry entries (exclusivity expressed in their when() conditions):
  - m → "Middle school", jade tint; title "MOE curriculum, middle school
    (중학교용)"
  - h → "High school", blue tint; title "MOE curriculum, high school
    (고등학교용)"
  - a → "Advanced", amber tint; title "Beyond the school curriculum;
    attested in real vocabulary (Okpyeon's classification)"
  - r → "Rare", grey tint; title "Archaic, specialist, or reading-only
    (Okpyeon's classification)"
  Quiet tints per zone (school zones slightly more saturated so they still
  pop); nested-card scaling as before. The a/r titles own that the boundary
  is our editorial judgment. The char-level "Rare" chip is DISTINCT from the
  word-level RARE homograph marker — both may appear in one popup; keep
  their styles distinguishable. The Basic-1800 label is retired.
- Badge registry (ADDENDUM — infrastructure, user-requested): classification
  badges are DECLARATIVE. One registry array defines them — each entry:
  { key, when(match-or-candidate) -> false | {label, title} } — and one
  renderer (appendBadges(container, m)) walks the registry in order at every
  badge site (card heads, nested component cards, reading rows). Adding or
  changing a badge must mean editing ONLY a registry entry: no per-badge
  render code, no per-site wiring, styling shared via the .edu-badge class
  family (a per-key modifier class is emitted for optional overrides). The
  Basic-1800 and tier badges are registry entries #1 and #2. Badge ORDER is
  the registry order. The registry is MULTI-BADGE by design: every matching
  entry renders, and future badges co-render freely beside existing ones;
  mutual exclusions (like basic1800 vs moeTier) are expressed inside the
  entries' own when() conditions, never as a global badge cap. This covers
  classification badges; inline semantic markers (RARE) stay as they are.
- Clickable eumhun chips (ADDENDUM): the per-character eumhun chips on word
  cards are click targets. Primary behavior: smooth-scroll the popup to that
  character's nested COMPONENT HANJA card and flash-highlight it briefly
  (~600ms tint fade) for orientation — no view push, since the full card is
  already on screen. Fallback when the char's nested card is NOT rendered in
  the current view: ordinary drill-down lookup of the character (new view,
  breadcrumb). Chips get the standard hover affordance (they may keep their
  pill look — hover + cursor signal clickability); keyboard accessible.
  Respect prefers-reduced-motion (jump instead of smooth scroll, no flash).
- Used-in disclosure (ADDENDUM — design option C, user-chosen): word cards
  whose match carries `usedInCount` render ONE collapsed nav row at the end of
  the word body (after chips, before COMPONENT WORDS): "Used in N larger
  words" with the standard chevron. Clicking navigates to a dedicated list
  view (same pattern as the homophone browser): title row, then every entry
  of the `{type:"usedIn"}` response as nav rows (hangul, hanja, gloss; rare
  entries muted) drilling into their word cards; breadcrumb back; response
  cached per word per popup session. No inline rows on the card itself — the
  single line keeps word cards focused on components, per the user's intent.
  Applies to word cards everywhere (top-level, drill-down views); homograph
  chip swaps update the row's count and target word.
- Breadcrumb ellipsis (ADDENDUM — fix): the "…" in a middle-truncated trail
  must be a BUTTON, not decoration. Pressing it expands the trail in place to
  show every crumb (wrapping to extra lines as needed), each clickable as
  usual; the trail re-collapses to the truncated form after the next
  navigation. Intermediate levels must never be unreachable.
- Cycle navigation (ADDENDUM — fix, REVISED per user): only the CURRENT view
  is protected from duplication. Target == current view → no push; scroll to
  top and flash the card head (chips-style orientation cue, reduced-motion
  respected). Target == an ANCESTOR view → push forward NORMALLY like any
  other navigation (學生 › 學校 › 學生 is a legitimate trail — forward
  navigation to a previously visited place is still forward, as in browser
  history; do NOT collapse to the ancestor crumb). Identity is the view's
  lookup key (canonical spelling / char / syllable), so 학생 vs 學生 both
  mean the 學生 view. Applies to every nav-row kind (compounds, parts,
  used-in, reading rows, chip fallbacks).
- Crumb labels are CANONICAL (ADDENDUM — fix): a crumb names the view's
  canonical identity, not the gesture that opened it — selecting 学生 roots
  the trail as 學生 (the card's "学生 → 學生" note already records what was
  selected). Word/char views label with the canonical spelling/glyph;
  reading-list views keep the syllable (국 › 國 is correct — the 국 view IS
  the homophone list, a different thing, not a variant spelling); list views
  keep their own labels; a multi-match root view keeps its surface text
  (no single canonical exists).
- Drill-down navigation polish (ADDENDUM): all click-through navigation
  (reading-list rows, component-word rows, any future drill-down) shares ONE
  sticky nav bar rendered as a clickable breadcrumb trail of the descent, e.g.
  `국 › 國` or `자본주의 › 資本 › 資本`-card views — each crumb jumps directly
  back to its cached view (scroll position restored), the current level is the
  non-clickable last crumb. Scroll restoration applies ONLY to navigation
  within a popup session: a NEW selection always opens scrolled to the top,
  with the nav stack and any retained scroll offsets cleared.
  Trail truncation is WIDTH-BASED (REVISED 2026-08-18, user-directed —
  the old fixed depth cap of 3 wasted the row): the trail renders every
  crumb and elides only on genuine overflow of the nav row, collapsing
  middle crumbs (keeping the root and as many trailing crumbs as fit,
  never fewer than the last two) behind the one "…" button, whose
  existing click behavior (expand the full trail) is unchanged.
  Re-measured on every render, on window resize (the sidebar edge drag),
  and after the in-page popup's resize gesture. Clickable rows carry a
  subtle chevron (›) affordance and a hover state; view changes use a fast,
  subtle transition (~120ms fade or slide — no jank, no layout pop), and the
  popup stays anchored to the original selection throughout. The bare "← back"
  control is superseded by the breadcrumb (crumb before last = back).

## Search popup (1.1 ADDENDUM)

A typed-search surface reusing the selection popup's renderer end to end.

- Embed mode (content.js): a host document sets `globalThis.__okpyeonEmbed =
  true` BEFORE content.js loads (a gate orthogonal to the test-hook IS_STUB
  gate — popup pages HAVE chrome.runtime). In embed mode content.js installs
  NO selection or dismissal listeners (mousedown/scroll/Escape etc. are inert
  for the popup lifecycle), and `ensureHost` mounts the host IN-FLOW (static
  position, 100% width, no floating anchor, no resize handle; the closed
  shadow root stays for style isolation) into a container supplied through
  the embed API. Skips positionAt entirely.
- Embed API (exposed as `globalThis.__okpyeonEmbedApi` when the flag is set —
  a separate gate from the IS_STUB test hooks; a page may have both):
  `mount(container)` (container must be document-connected; single mount),
  `searchFor(text) -> Promise<{ok, count}>` — structurally the selection
  handler's path (request-sequence bump, stale-response guard, then the
  normal render with an inert rect), NOT the drill-down fetch cache — and
  `clear()`. Drill-downs, breadcrumbs, show-more, used-in and badges behave
  identically to the selection popup. Normal mode must be behaviorally
  unchanged.
- Embed layout rules (from design review): installResize() must NOT be called
  in embed (its corner hit-test is geometric, not CSS-gated); the panel gets
  an `.embed` class overriding width:100%, max-height:none, overflow:visible,
  resize:none — the popup page's results area is the ONLY scroll container
  (no nested scrollbars); reposition() no-ops in embed.
- Popup page (extension/popup/): popup.html loads, in order, popup-boot.js
  (sets the embed flag, nothing else), ../content/content.js, popup.js — all
  CLASSIC scripts via src (no type=module/defer/async: modules defer and
  would break the flag-before-script ordering; MV3 extension-page CSP
  forbids inline script), placed AFTER the results-container markup so
  mount() sees a laid-out container. popup.js wires the search input:
  debounced (~200ms) search-as-you-type using InputEvent.isComposing
  (`if (e.isComposing) return` on input; compositionend as a fallback
  trigger into the same debounce; Enter forces immediate BUT no-ops while
  composing / keyCode 229), reads `?q=` for deep links (auto-search after
  mount, skipping the empty-state flash), autofocuses, and shows quiet
  empty-state / no-results states driven by searchFor's {ok, count}.
  Popup header (ADDENDUM — design D, user-chosen): above the input sits ONE
  slim header row: the brand wordmark ("玉篇", small, Batang/serif, jade
  accent, aria-label "Okpyeon") left, and a right-aligned ACTIONS container.
  Actions are declarative, mirroring the badge-registry pattern: popup.js
  holds a HEADER_ACTIONS registry ({key, label/icon, title, onClick,
  enabled}) rendered into the container by one function — adding "saved
  words" or "settings" later must mean adding ONE registry entry (a disabled
  entry renders dimmed with a title, an absent entry renders nothing). The
  registry ships EMPTY today: search's input is always visible below, so no
  search icon; no dead placeholder icons. Header adds ≤ 26px; empty popup
  stays ≤ ~105px.
  Popup sizing (REVISED per user — the popup is the SECONDARY search surface;
  a future sidebar is the primary one): compact and unobtrusive. Width
  ~340px. Height is CONTENT-DRIVEN (Chrome auto-sizes popups to the
  document): empty state is just the slim input plus ONE short hint line
  (whole popup ≈ 80px tall — no reserved empty results area); the popup
  grows with results and only caps (~480px) with internal scroll when
  genuinely tall. The input itself is slim (compact padding, ~13px font, no
  heavy chrome). The results area remains the single scroll container when
  capped. popup.css must carry its OWN prefers-color-scheme rules matching
  the panel palette (the shadow root's tokens don't reach the outer page). The page must also work opened as a
  normal tab (the omnibox target). Known limitation (document, don't fix):
  in default_popup mode the BROWSER closes the popup on Escape, which some
  IME cancel flows may trigger — tab mode is unaffected.
- Wiktionary links open in the background on EVERY surface (ADDENDUM —
  REVISED for consistency, user-reported): plain left- and middle-clicks on
  wiki links never switch tabs. Embed surfaces intercept and call
  chrome.tabs.create({active:false}) directly (also the popup-survival fix:
  browser-level link activation dismisses action popups even for background
  tabs, while API-created ones do not — verified on real Chrome 2026-08-17).
  The in-page selection popup cannot touch chrome.tabs (content script), so
  it sends a new worker message `{type:"openTab", url}` and the worker calls
  tabs.create({url, active:false}) — same UX. Both paths flash "Opened ↗".
  Modified clicks (ctrl/cmd/shift) keep native browser behavior everywhere.
  The openTab handler must validate the url starts with the Wiktionary base
  (never open arbitrary urls on a content script's say-so).
  Second known limitation (browser design, unfixable): the action popup is
  destroyed on ANY focus loss including tab switches — the future sidePanel
  is the persistence answer, not the popup.
- Manifest: `"action": {"default_popup": "popup/popup.html", "default_icon":
  <existing icons>}` and `"omnibox": {"keyword": "hj"}`. NO new permissions;
  web_accessible_resources stays absent (anti-fingerprinting stance).
- Multi-surface contract (ADDENDUM — future-proofing, user-directed): the
  embed flag + __okpyeonEmbedApi IS the official interface for every current
  and future non-content-script surface (action popup now; a sidePanel page
  with settings/saved-words later; any other extension page). To keep the
  search UI itself reusable across those surfaces, the input wiring lives in
  a standalone classic script `popup/search-shell.js` exposing ONE
  initializer (e.g. `__okpyeonSearchShell.init({input, results, status,
  autofocus, initialQuery})`) that owns debounce/IME handling, deep-link
  auto-search, and empty/no-result/error states by driving the embed API.
  popup.js is a thin bootstrapper: find the popup page's elements, read ?q=,
  call init. A future sidepanel.html reuses popup-boot.js + content.js +
  search-shell.js unchanged and writes only its own bootstrapper and page
  chrome. Nothing in search-shell.js may reference popup-specific layout,
  ids beyond what init receives, or window-close behavior.
  onInputChanged → up to 5 suggestions from a pure `buildOmniboxSuggestions
  (text, data)` in lookup.js. Each suggestion: `content` = the candidate's
  own canonical spelling/syllable, PLAIN text (never escaped — it round-trips
  into onInputEntered); `description` = the rendered label, XML-escaped.
  setDefaultSuggestion called once at wiring time. onInputEntered(text,
  disposition) respects disposition: currentTab → tabs.update, otherwise
  tabs.create (active only for newForegroundTab), with url =
  chrome.runtime.getURL("popup/popup.html") + "?q=" +
  encodeURIComponent(text).

## Sidebar (ADDENDUM — supersedes the action popup)

User decision (2026-08-17): the sidebar (chrome.sidePanel) REPLACES the
toolbar action popup. Clicking the extension icon toggles the sidebar. The
popup rendered the same cards through the same embed contract and its one
structural property (destruction on focus loss) was a liability for typed
search; quick lookups are already served by the in-page selection popup.
End state: exactly two user-facing surfaces — the in-page selection popup
and the sidebar. Everything in the "Search popup (1.1 ADDENDUM)" section
that is popup-page-specific (popup.html/popup.js/popup.css, popup sizing,
default_popup manifest wiring, the Escape-closes-popup limitation, the
searchUrl target) is superseded by this section. The embed contract, embed
layout rules, search-shell contract, omnibox suggestion rules, and
wiki-link background-open rules all stand unchanged.

- Manifest: add `"permissions": ["sidePanel"]` and
  `"side_panel": {"default_path": "sidepanel/sidepanel.html"}`. The
  `action` key KEEPS `default_icon` but DROPS `default_popup` (the icon
  must remain so it can toggle the panel). web_accessible_resources stays
  absent (anti-fingerprinting stance). No other permissions.
- Panel behavior: background.js calls
  `chrome.sidePanel.setPanelBehavior({openPanelOnActionClick: true})` at
  top level inside a capability guard (same pattern as the omnibox block:
  the file must stay importable in plain Node) and again on
  `chrome.runtime.onInstalled` — the call is idempotent and persisted by
  Chrome, belt and suspenders.
- File moves (the "popup/" name is retired): `popup/popup-boot.js` →
  `sidepanel/boot.js` (still exactly one line: the embed flag);
  `popup/search-shell.js` → `sidepanel/search-shell.js` (content
  unchanged — its contract already forbids surface-specific references).
  popup.html, popup.js, popup.css are DELETED and `extension/popup/` is
  removed. Wherever earlier addenda say "popup-boot.js" or
  "popup/search-shell.js", read the new paths.
- sidepanel.html (extension/sidepanel/): page chrome only — header row
  (brand wordmark "玉篇", small, Batang/serif, jade accent, aria-label
  "Okpyeon"; right-aligned `#okp-actions` container; a nav slot for view
  tabs), searchbar with `#okp-input`, a view container holding one child
  container per registered view, with `#okp-results` + `#okp-status`
  inside the search view's container. Classic scripts via src, AFTER the
  markup, in load-bearing order: `boot.js` → `../content/content.js` →
  `search-shell.js` → `sidepanel.js`. No inline script (extension-page
  CSP), no type=module/defer/async (ordering).
- sidepanel.css: full-height flex column (html/body/app at 100% height).
  The search view's results area is the ONE scroll container
  (`flex: 1; overflow-y: auto; overscroll-behavior: contain`) — the
  no-nested-scrollbars rule from the embed layout addendum applies to the
  panel page. Width is FLUID (the user drags the panel edge; no fixed
  340px, no max-width on the app column). Carries its OWN
  prefers-color-scheme rules with the same variable names as the panel
  palette (the shadow root's tokens don't reach the outer page) — same
  approach popup.css used.
- sidepanel.js (the surface bootstrapper — the popup.js equivalent the
  multi-surface contract reserves for each surface) owns two declarative
  registries, mirroring the badge-registry philosophy:
  - `SIDEBAR_VIEWS`: array of `{key, label, title, mount(container, ctx),
    onShow(), onHide()}` (mount required; lifecycle hooks optional; `key`
    unique, becomes a CSS modifier). Each view gets a dedicated container
    created once; switching views hides/shows containers (display toggle)
    and fires onHide/onShow — views are NEVER destroyed/rebuilt on switch,
    so search state (input, results, breadcrumb trail, scroll) survives
    visiting another view. `ctx` passes `{embedApi, shell}` so future
    views can drive lookups. Ships with EXACTLY ONE entry, `search`, whose
    mount wires `__okpyeonSearchShell.init` (respecting the shell's
    per-page singleton: init once, never re-init on view switches).
  - Nav tabs for the views render ONLY when the registry holds two or
    more entries — with one view there is NO visible nav, and adding
    "saved" or "settings" later means adding ONE registry entry, which
    makes the nav appear by itself. A disabled entry renders dimmed with
    a title; an absent entry renders nothing.
  - `HEADER_ACTIONS`: carried over from popup.js verbatim — same entry
    shape `{key, label, title, enabled (bool or () => bool), onClick}`,
    same render-into-`#okp-actions` function, ships EMPTY with the
    commented "saved" example updated to sidebar context.
  - Boot sequence: determine the initial query as `?q=` (tab mode) OR the
    worker's pending query (panel mode, see below) — `?q=` wins if both
    exist — then `init({input, results, status, autofocus: true,
    initialQuery})`. Exposes `globalThis.__okpyeonSidebar =
    {viewRegistry, actionRegistry, renderNav, renderActions, showView}`
    for the harness.
- Pending-query handshake (omnibox → panel, race-free pull model, no
  storage permission): background.js keeps a module-level `pendingQuery`
  (string or null). New message type `{type: "getPendingQuery"}` returns
  `{ok: true, query}` and CLEARS it (read-once). The sidepanel
  bootstrapper sends it once at boot before shell init. The handler is a
  pure-ish exported function like the others so Node tests can drive it.
- Omnibox retarget: `onInputEntered(text, disposition)` now (1) sets
  `pendingQuery = text`, (2) calls `chrome.sidePanel.open({windowId})`
  SYNCHRONOUSLY in the handler. The Enter gesture does NOT survive an
  awaited `chrome.windows.getCurrent()` (verified on real Chrome
  2026-08-17: open() rejects and the fallback fires) — so open() must be
  the first async call in the handler, and the worker must already hold
  the window id: a module-level `focusedWindowId`, seeded via
  `chrome.windows.getLastFocused` at module evaluation (the worker
  re-evaluates on every wake, and omnibox keystrokes wake it well before
  Enter) and kept fresh by `chrome.windows.onFocusChanged` (ignoring
  WINDOW_ID_NONE, which means focus left Chrome). chrome.windows needs
  no permission. If the panel API is missing, the id is still null, or
  open() rejects, fall back to the previous tab behavior with url =
  getURL("sidepanel/sidepanel.html") + "?q=..." respecting disposition
  (currentTab → tabs.update; otherwise tabs.create, active only for
  newForegroundTab) — and clear pendingQuery first (the tab path carries
  the query in the URL; a stale pending query must not leak into a later
  panel open). `searchUrl()` retargets to the sidepanel path. The
  sidepanel page must work opened as a normal tab (this fallback and dev
  convenience).
- Repeat omnibox searches while the panel is OPEN (ADDENDUM fix,
  user-reported 2026-08-17): the boot pull only covers a cold panel — an
  already-open panel never re-asks, so a second `hj` query sat unread
  (and, being read-once storage, would have re-run on the NEXT panel
  open). The handshake gains a push half; read-once stays central
  (pendingQuery is only ever cleared by getPendingQuery):
  - Worker: after open() RESOLVES, poke live panel pages with
    `chrome.runtime.sendMessage({type: "pendingQueryChanged", windowId:
    focusedWindowId})`, errors swallowed — the rejection when no page is
    listening IS the cold-open case, where the boot pull takes over.
  - Panel: installs a `chrome.runtime.onMessage` listener (guarded,
    real-runtime only). On pendingQueryChanged: if the message carries a
    windowId, the page knows its own (cached from
    `chrome.windows.getCurrent` at boot, guarded), and they differ →
    ignore (the poke was for a panel in another window). Else pull
    getPendingQuery again; null/empty → no-op (another panel won the
    read-once race, or the poke was stale); non-empty → write the query
    into the input AND drive the shell's immediate search (the shell's
    search does not write input.value itself).
  - The panel's message handler must be reachable on `__okpyeonSidebar`
    (e.g. `handleWorkerMessage(msg)`) so the harness can drive it
    without a real chrome.runtime. Harness checks: poke with a primed
    query updates input + results; poke with nothing pending changes
    nothing; a windowId mismatch is ignored.
- Focus rules (ADDENDUM fix, user-reported 2026-08-17): the panel input
  autofocuses ONLY when the panel boots with NO initial query — the
  icon-click open, where the user's next act is typing into the panel.
  When the initial query came from anywhere else (the worker's pending
  query after an omnibox search, or a ?q= deep link) the input must NOT
  be focused: the user just typed elsewhere and a focus grab hijacks
  their next keystrokes (observed: typing meant for the address bar
  landing in the panel input). The poke path (pendingQueryChanged on an
  already-open panel) must never focus or select the input either — it
  updates value and runs the search, nothing more. In short: autofocus
  iff the resolved initial query is empty, and no other code path
  focuses the input.
- Escape: the panel is NOT closed by the browser on Escape — the old
  popup limitation is retired with the popup. Escape during IME
  composition must still not trigger a search (existing search-shell
  behavior, unchanged).
- Wiki links: no change needed — `WIKI_TABS_DIRECT` keys off IS_EMBED,
  so the sidepanel page gets direct `chrome.tabs.create({active:false})`
  automatically.
- Harness: test-page/embed.html is REWORKED into the sidebar harness
  (same fake-worker fixture block, inlined verbatim from index.html;
  replicated sidepanel markup; real boot chain at the new paths; fake
  runtime additionally answers `getPendingQuery`). All existing embed
  checks are kept or ported; new checks cover: views registry (register
  a dummy second view → nav appears; switching hides/shows containers
  and fires onShow/onHide; search state survives a switch away and
  back), header actions on the sidepanel page, pending-query boot pull,
  `?q=` deep link still working, and the single-scroll-container
  invariant. index.html (selection popup) must stay untouched and green.
- Future-proofing (noted, NOT built): rendering in-page selection lookups
  into an open sidebar is a later feature and needs only a new worker
  message plus a `searchFor()` call on this page — nothing in this
  section may be built in a way that precludes it.

## Reading navigation (ADDENDUM)

User-directed (2026-08-18): the accent-colored readings on card heads look
clickable and must be. Two navigations, both pushed as ordinary drill-down
views (crumbs, cached scroll, cycle handling all standard):

- On CHAR card heads, every eum syllable in the eumhun line (구슬 옥 → the
  옥) and every syllable on a readings-only line becomes a nav chip
  opening the READING VIEW for that syllable — the same homophone list a
  single-syllable selection opens, crumb labeled with the syllable. The
  hun part (구슬) is NOT clickable.
- On WORD card heads, the hangul (옥편) becomes a nav chip opening the
  hangul lookup of that word — the multi-spelling selector view when
  homographs exist, the word view otherwise. Crumb label follows the
  canonical-crumb rules (the hangul is the view's identity here).
  (REVISED, user-reported 2026-08-18): when MULTIPLE spellings exist the
  chip must always land on the selector view, even clicked from one of
  those spellings' own cards — the selector is the point of the click,
  so neither the orient-in-place rule nor the drill-down path's
  single-word resolution may swallow it. The pushed view's identity is
  the hangul (e.g. `hangul:사과`), distinct from any single spelling's
  word view; re-clicking while already ON that selector view orients as
  usual. Single-spelling words keep the plain word view and the orient
  rule.
- Eumhun display (REVISED, user-chosen): the hun is NOT accent-colored —
  it renders in the normal foreground, and only the clickable eum keeps
  the accent. One color rule everywhere the eumhun pairing appears on
  card heads; the word-body eumhun chips and reading rows keep their
  existing styling.
- One shared internal primitive does both: fetchLookup(text) (the cached
  drill-down path) + the normal view push; no new worker traffic types.
- Affordance: keep the accent color, add the nav hover treatment
  (underline) and keyboard activation (role=button/tabindex, Enter/Space
  — the makeNavRow idiom). Identical in normal and embed modes.
- Reading-list ROWS are unchanged (the whole row already navigates to
  the char). Eumhun chips on word bodies are unchanged (they scroll to
  the component card).
- The sidebar's 玉篇 brand wordmark is also clickable (user-directed —
  the name is itself an entry, Yupian): click fills the search input
  with 玉篇, runs the search, and shows the search view — the saved-row
  openInSearch primitive. It becomes a real button (plain-styled, focus
  ring, Enter/Space native), aria-label "Okpyeon: look up 玉篇". Applies
  to the sidepanel page only (the in-page popup has no wordmark).
- Harness: checks in BOTH harnesses — eum click opens the reading list
  with the right candidates and crumb, back returns with scroll restored;
  readings-only syllable click works; word-head hangul click opens the
  hangul view (spelling selector where applicable); keyboard activation;
  a chip for a syllable with no homophones still renders a sane view
  (the reading view handles empty candidate lists already).

## QWERTY-to-hangul input (ADDENDUM)

User-directed (2026-08-18): typing Latin letters as if on the 2-set Korean
(Dubeolsik) layout finds the hangul — `toddlf` finds 생일. 한영타 변환,
deterministic, no data files.

- New pure ES module `extension/dubeolsik.js` (no chrome.*, like
  lookup.js): `qwertyToHangul(text)` → the composed hangul string. Key
  map: the standard Dubeolsik layout (q=ㅂ w=ㅈ e=ㄷ r=ㄱ t=ㅅ y=ㅛ u=ㅕ
  i=ㅑ o=ㅐ p=ㅔ a=ㅁ s=ㄴ d=ㅇ f=ㄹ g=ㅎ h=ㅗ j=ㅓ k=ㅏ l=ㅣ z=ㅋ x=ㅌ
  c=ㅊ v=ㅍ b=ㅠ n=ㅜ m=ㅡ; shifted Q=ㅃ W=ㅉ E=ㄸ R=ㄲ T=ㅆ O=ㅒ P=ㅖ;
  any other uppercase letter behaves as its lowercase key). Composition
  is the standard IME automaton: choseong/jungseong/jongseong assembly
  via the Unicode syllable formula, compound vowels (ㅗ+ㅏ=ㅘ etc.),
  compound finals (ㄹ+ㄱ=ㄺ etc.), and final-consonant handoff when a
  vowel follows (toddlf → 생일, not 샹딜). Jamo that never complete a
  syllable emit as bare jamo characters.
- Applied in `lookup(text, data)`: when the trimmed text matches
  /^[A-Za-z]+$/ (within the existing length cap), convert and run the
  NORMAL lookup on the conversion. The ok response then carries
  `converted: {from, to}`. A Latin query matches nothing by construction
  today, so the conversion is unconditional for pure-Latin input — no
  ambiguity handling needed.
- Surfaces: the user's typed input is NEVER rewritten. The renderer uses
  `converted.to` as the search context (srcText) when present, so the
  root view and crumbs show 생일, which is the visible cue for what the
  conversion produced. `buildOmniboxSuggestions` applies the same rule,
  so `hj toddlf` suggests 생일's entries (suggestion `content` stays the
  canonical searchable string).
- Tests: Node coverage of the automaton (table spot checks, compound
  vowels and finals, final handoff, shifted doubles, bare-jamo tails,
  mixed/non-Latin input NOT converted) plus a real-data smoke
  (lookup("toddlf") → the 생일 word match) and omnibox coverage. The
  shared harness fixture blocks (kept byte-identical) answer ONE canned
  conversion (e.g. "gkrtod" → the 학생 fixture response with
  `converted`) so the embed harness can assert the renderer's srcText
  swap; everything else stays Node-side.

## Corner seal (ADDENDUM)

The jade 玉篇 seal (낙관 style: vertical-rl, bordered, slightly rotated,
--seal color tokens, 68px) marks EMPTY PAPER in the sidebar, bottom-right
of the view. Evolved through user iterations; binding rules as of
2026-08-18:

- ONE RULE, all three views (.view--sealed set at mount; REVISED
  2026-08-18, user-directed — the earlier empty-state-only .view--blank
  mechanism on search is RETIRED): the seal is shown only when it FITS.
  After every render, and on window resize (debounced), each view
  measures the space between its content's bottom edge and the view
  bottom and toggles .view--roomy at a ~230px threshold. The seal is
  visible only on .view--sealed.view--roomy, fading via an opacity
  transition. Content can therefore never overlap it (the original
  user-reported failure: folder bands striped it and row text sat on top
  of it), and an empty view shows it by construction.
- Measurement measures CONTENT, not stretched containers: the saved view
  takes the max bottom of its in-flow children (its list is
  content-sized); the settings view takes the max bottom of the
  settings-body's CHILDREN (the body itself is a stretched flex
  scroller, whose own box always reaches the view bottom); the search
  view takes the max bottom of the results container's children (the
  shadow host and the status line). The search view has no render hook
  into the renderer, so it watches the host: a ResizeObserver on the
  results container's children (a childList MutationObserver enrolls the
  host when mount creates it) plus the shell's onState callback, both
  funneled through one debounced update.
- Layering: each .view is position:relative + isolation:isolate; the seal
  is the view's ::after at z-index -1 (behind content, above the page
  background — isolation is what keeps the page background from covering
  it). pointer-events none, no selection, not announced by screen
  readers.

## Saved words + settings (ADDENDUM)

User-directed (2026-08-17): a saved-words list with folders and Anki
export, plus the settings view arriving with its first real settings.
Decisions: one folder per item; Chrome-bookmarks save UX (instant save +
an anchored bubble to move/remove); clicking a saved row opens the full
card in the search view; saved items are IDENTITY-ONLY references joined
against live data at read time (no snapshots — duplicates structurally
impossible; every saved item corresponds to exactly one data entry).

### Storage

- chrome.storage.local; manifest permissions become
  `["sidePanel", "storage"]`. Nothing else; no unlimitedStorage, no sync.
- The WORKER is the single writer. Every surface uses worker messages;
  worker writes go through one serialized promise queue (read-modify-write
  races are impossible by construction).
- Key `okpSaved`, schema v1:
  `{v:1, folders:[{id, name}], items:[{id, kind:"word"|"char", key,
  folderId, addedAt}]}` — `key` is the canonical spelling/glyph. Folder
  `f0` "Saved" always exists and cannot be deleted or renamed to empty;
  deleting another folder moves its items to `f0`. Item identity is
  (kind, key); toggling an existing identity removes it. Ids: `f<n>` /
  `i<n>` from monotonic counters stored in the state.
- Key `okpSettings`, schema v1:
  `{v:1, defaultFolderId, anki:{wordFront, wordBack[], charFront,
  charBack[]}}`. Field tokens — word: "hanja" | "hangul" | "defs";
  char: "char" | "eumhun" | "readings" | "defs" | "lvl". Defaults:
  defaultFolderId "f0"; wordFront "hanja"; wordBack ["hangul","defs"];
  charFront "char"; charBack ["eumhun","defs"]. If the default folder is
  deleted the setting resets to "f0".

### Pure module extension/saved.js (ES module, no chrome.*, like lookup.js)

All logic lives here, Node-testable; background.js is read-state → pure
fn → write-state glue. Exports (state in, new state out, never mutate):
`normalizeSavedState(raw)`, `normalizeSettings(raw)` (defaults +
version fill), `toggleItem(state, kind, key, defaultFolderId, now)` →
`{state, saved, item?}`, `checkKeys(state, keys)` → map keyed
`"c:<key>"` / `"w:<key>"`, `createFolder(state, name)` / `renameFolder` /
`deleteFolder` (refuses f0; moves items to f0) / `moveItems(state, ids,
folderId)` / `removeItems(state, ids)`, `resolveExportSelection(state,
{ids?, folderIds?, all?})` → item list, `joinItems(items, data)` →
display rows (word: hangul, glosses, rare; char: eumhun, readings,
glosses, lvl; an entry missing from data → `{missing:true}` row), and
`buildAnkiTsv(joinedRows, settings)` → string, and
`buildCsv(joinedRows, folders)` → string (Export formats below).

### Export formats (ADDENDUM — user-directed: offer both)

- ANKI (`.txt`): header directives `#separator:tab`, `#html:false`, and
  `#tags column:3` (ADDENDUM — user-approved: folders carry into Anki as
  tags), then Front TAB Back TAB Tag per item. Front/back shaped by the
  anki settings; back fields joined with " · "; definitions rendered as
  a numbered "1. …; 2. …" string over ALL glosses. The tag is the item's
  folder name with every whitespace run replaced by "_" (Anki tags
  cannot contain spaces); buildAnkiTsv therefore takes the folders list
  (`buildAnkiTsv(joinedRows, settings, folders)`). Any field containing
  tab, newline or double quote is CSV-style quoted with doubled quotes;
  missing rows are skipped and counted.
- CSV (`.csv`): a full-data spreadsheet, independent of the anki
  settings. Header row + RFC-4180 quoting. Fixed columns: kind, key,
  hangul, eumhun (joined "하늘 천, …"), readings, definitions, level,
  folder (name), added (ISO date). Missing rows are skipped and counted
  the same way.

### Worker messages (join the existing router; handlers exported for Node)

`savedGet` → `{ok, folders, items}` with items PRE-JOINED via joinItems
(worker data cache; same join pattern as buildFullCompounds).
`savedToggle {kind, key}` → `{ok, saved, item?, folderId?, folders}` —
folders ride along so the save bubble needs no second round-trip.
`savedCheck {keys:[{kind,key}]}` → `{ok, saved:{"c:國":true, ...}}`.
`savedRemove {ids}` / `savedMove {ids, folderId}` / `folderCreate {name}`
→ `{ok, folder}` / `folderRename {id, name}` / `folderDelete {id}` /
`settingsGet` → `{ok, settings}` / `settingsSet {patch}` → `{ok,
settings}` (shallow-merge patch, then normalize) / `savedExport {ids? |
folderIds? | all?, format:"anki"|"csv"}` → `{ok, tsv, count, skipped,
filename}` (`tsv` carries the file body for either format; filename ends
`.txt` for anki, `.csv` for csv; format defaults to "anki"). Without
chrome.storage every handler answers `{ok:false, error:"storage
unavailable"}` — surfaces treat that as "feature absent", never as an
error to display. addedAt = Date.now() in the worker.

### Save affordance (content.js, every surface)

- New declarative CARD_ACTIONS registry (BADGES philosophy): entries
  `{key, when(m) → false|true, build(m) → element}`; exposed as
  `__hanjaHover.cardActionRegistry`. First entry: "save".
- A star button (☆ resting / ★ saved; classes `.save` / `.save--on`,
  `aria-pressed`) on char card heads (buildCharCard) and word card bodies
  (fillWordBody — the ACTIVE spelling's m). Placed in the `.head` flex row
  before the Wiktionary link; house interaction pattern (own listeners,
  stopPropagation on mousedown/click, Enter/Space activation).
- Saved-state: stars render HIDDEN, then one BATCHED `savedCheck` per
  render pass (all keys in the rendered view, one message) reveals and
  sets them. A `{ok:false}` answer leaves every star hidden for that
  render — graceful on old workers and bare harnesses.
- Click: optimistic flip, then `savedToggle {kind, key}`; revert on a
  failed response. kind/key: char → canonical glyph; word → canonical
  spelling of the active body.
- SAVE BUBBLE (Chrome-bookmarks UX): a successful SAVE (not unsave) opens
  one bubble anchored to that star, inside the shadow root: "Saved to"
  + a folder `<select>` (options from the toggle response's folders;
  change = `savedMove` immediately) + a Remove link (toggle off; star
  reverts; bubble closes). The select's LAST option is "New folder…"
  (ADDENDUM — user-directed): choosing it swaps the select for an inline
  name input with create/cancel; create sends `folderCreate {name}` then
  `savedMove {ids:[item.id], folderId}` to the new folder, and the select
  returns showing the new folder selected (append the created folder to
  the local options); cancel restores the select to the previous folder.
  A failed create shows the worker's error inline and keeps the input. Dismissed by clicking anywhere outside it,
  by Escape, or by starting another card interaction; one bubble at a
  time; unsaving never shows a bubble. Escape rule: while a bubble is
  open, Escape closes ONLY the bubble — the normal-mode popup-hide
  Escape handler must check bubble state first; in embed mode Escape
  does nothing else anyway.
- Star sync (REVISED, user-reported 2026-08-18 — supersedes the earlier
  "no storage.onChanged in content.js" line): stars must stay true across
  surfaces. A stale star inverts the toggle's meaning (clicking ☆ on an
  already-saved word unsaves it, and re-saving loses the folder), so
  content.js installs ONE guarded `chrome.storage.onChanged` listener
  (real chrome.storage present; area "local"; key okpSaved) that
  re-checks the identities of currently rendered stars (the existing
  batched savedCheck path, debounced ~100ms) and applies the results.
  Covers the in-page popup and the sidebar's cards alike. Bare harness
  pages have no chrome.storage, so the handler must be exposed for
  tests (e.g. `__hanjaHover.applySavedChange()`) and the listener wiring
  skipped; harness checks drive the handler directly: toggle an identity
  through the fake store, fire the handler, and the rendered star flips
  without a re-render.

### Sidebar: saved view (extension/sidepanel/saved-view.js, view 2)

Classic script loaded after sidepanel.js; self-registers via
`__okpyeonSidebar.registerView({key:"saved", label:"Saved", ...})` — the
nav appears by itself. Page-chrome DOM styled by sidepanel.css (NOT the
shadow renderer; no level chips in rows — secondary text carries the
eumhun/hangul instead).
- Top bar: folder filter select ("All" + each folder with counts), New
  folder (inline name input), Rename/Delete controls for the selected
  folder (Delete confirms and moves items to f0; f0 offers no delete).
- List, GROUPED BY FOLDER (ADDENDUM — user-directed): with the filter on
  "All", items render under folder header rows; a header row carries a
  CHECKBOX + disclosure triangle + folder name + count, and its checkbox
  selects/deselects every item in that folder (indeterminate when
  partially selected — batch selection works at both the folder and the
  item level). Folders COLLAPSE/EXPAND (user-directed): clicking the
  header outside its checkbox toggles the folder; collapsed folders hide
  their item rows but keep their count visible and their checkbox fully
  functional (batch actions on a collapsed folder work unchanged).
  Collapse state is page-session-local: default expanded, held while the
  panel stays open, reset on a fresh open. A single-folder filter renders
  a flat list (no headers). A global select-all checkbox operates on the
  current filter either way.
- Item rows = checkbox + primary text (word spelling / char glyph) +
  secondary (hangul or eumhun) + first gloss, `.missing` styling and a
  "no longer in the dictionary" note for missing rows.
- Row click (outside the checkbox) → set `#okp-input.value` to the key,
  `controller.search(key)`, `showView("search")`.
- Actions bar: "Move to…" folder select, Delete, Export — all act on the
  checked set; nothing checked = the current filter (All = everything).
  Delete requires an INLINE two-step confirmation ("Delete N items?" →
  confirm/cancel buttons in place; no window.confirm). (Verbiage ADDENDUM,
  user-directed: the batch action says "Delete"; the save bubble's link
  keeps "Remove" since it unsaves rather than deletes. Internal
  ids/classes keep the remove naming.) Export opens an
  inline FORMAT choice: "Anki" or "CSV" (see Export formats). Download:
  Blob + `<a download>` click, filename from the worker, then revoke.
- `onShow` refreshes via `savedGet`; a guarded `chrome.storage.onChanged`
  listener (real runtime only) refreshes while visible, so saves made
  from pages appear live.
- Empty state: one short line pointing at the star on cards.

### Sidebar: settings view (extension/sidepanel/settings-view.js, view 3)

- `SETTINGS_SCHEMA`: declarative array rendered generically — a future
  setting is ONE entry, and the page is EXPECTED TO GROW (user-directed):
  entries carry a `group` string and the renderer emits a heading per
  group in schema order, so new settings slot into existing sections or
  open new ones with zero renderer changes. Entry: `{key (dot-path into
  settings), group, type: "select" | "checkset" | "folder-select",
  label, options:[{value, label}], default}`. folder-select resolves its
  options from `savedGet` folders at render time. New setting TYPES (a
  future toggle, text field, etc.) are added by extending the one
  control-builder switch — nothing else may special-case a setting.
- Rendered controls write through `settingsSet` immediately (no save
  button); `onShow` re-reads settings and folders.
- Shipping entries — group "Saving": "By default, save new items to"
  (wording user-directed: the bubble can override per save) (folder-select,
  key defaultFolderId); group "Anki export": "Word cards: front" (select
  hanja/hangul), "Word cards: back" (checkset hanja/hangul/defs),
  "Character cards: front" (select char/eumhun), "Character cards: back"
  (checkset char/eumhun/readings/defs/lvl).

### Searchbar + omnibox while on another view

Typing in the global searchbar (any input event) while the active view is
not "search" switches to the search view first. `applyPendingQuery` (the
omnibox poke path) also calls `showView("search")` — an omnibox search
must never land invisibly behind the saved or settings view.

### Harness + tests

- BOTH fixture blocks (test-page/index.html and embed.html, kept
  byte-identical to each other) gain the same minimal in-memory saved
  store answering every new message type against fixture data (join
  simplified to fixture fields; savedExport returns a real TSV built from
  the fixture store so the download check has content to assert on).
- embed.html checks: stars render + batched single savedCheck + toggle +
  revert-on-failure; bubble (opens on save only, folder select moves,
  Remove unsaves, outside-click and Escape dismiss, one at a time);
  saved view (grouped list render incl. folder-header checkboxes with
  indeterminate state and missing-row note, collapse/expand — item rows
  hidden, count visible, folder checkbox still selects the collapsed
  folder's items — folder create/filter/
  rename/delete-moves-to-f0, select-all on filter, move, remove with the
  two-step inline confirm (first click arms, cancel disarms, confirm
  removes), row click lands in search view with the card rendered,
  export format chooser with both file bodies asserted via the download
  anchor, live refresh on a simulated change); settings view
  (group headings, schema-rendered controls, immediate persist,
  folder-select options, defaults); nav shows 3 tabs; search state
  survives visiting both views; searchbar auto-switch.
- index.html: a small set of star checks in normal (selection popup)
  mode, including bubble-Escape-leaves-popup-open.
- Node: saved.js pure coverage (normalize/migration, toggle identity,
  folder CRUD incl. f0 protection and default-folder reset, move/remove,
  selection resolution, join incl. missing, TSV format + quoting,
  settings normalize/patch) and worker handler seams (storage-absent
  answers; exported handler shapes).

## Romanized search (ADDENDUM)

User-directed (2026-08-18): typing romanized Korean finds the hangul —
`gukmin` OR `gungmin` finds 국민. Architecture: forward-generate at build
time (hangul → RR is deterministic), never invert at runtime. Pure-Latin
typed queries run BOTH interpreters (Dubeolsik and romanization); when
both survive, BOTH result sets render, preferred first by frequency.
This section supersedes the QWERTY addendum's `converted` response field:
`interpretations` (below) replaces it everywhere.

### Data (pipeline/build.py)

- New RR module: decompose hangul to jamo, then THREE forms per string
  (ADDENDUM — user-raised: the per-jamo form is RR's own Article 8):
  - NAIVE: RR letter rules per syllable, positional (initial ㄱ=g, final
    ㄱ=k; initial ㄹ=r, final ㄹ=l), no cross-syllable changes: 국민 →
    gukmin.
  - TRANSLITERATION (Article 8): one fixed letter per jamo regardless of
    position (ㄱ=g, ㄷ=d, ㅂ=b, ㄹ=l, ㅅ=s always; no sound changes; no
    positional logic): 국민 → gugmin, 좋다 → johda, 먹는 → meogneun,
    값 → gabs. These four are additional BINDING anchors.
  - OFFICIAL: apply the standard's sound-change rules across syllable
    boundaries FIRST, then romanize: nasalization, liquid assimilation
    (ㄴㄹ adjacency → ll), palatalization (ㄷㅌ before 이/히), the ㅎ
    rules (aspiration merger; ㅎ before a vowel drops), and linking
    (연음). Tensification is NOT marked (per the standard).
  - BINDING anchor pairs, asserted in the build's verify step (all from
    the standard's own examples): 백마 baengma, 신문로 sinmunno, 종로
    jongno, 왕십리 wangsimni, 별내 byeollae, 신라 silla, 학여울
    hangnyeoul, 알약 allyak, 해돋이 haedoji, 같이 gachi, 좋고 joko,
    놓다 nota, 잡혀 japyeo, 낳지 nachi, 국민 gungmin (naive gukmin).
- Emit `extension/data/rr.json`:
  `{v:1, words: {rr: [hangul...]}, syllables: {rr: [syllable...]}}` —
  every byHangul key and every reading-index syllable under ALL THREE
  forms, deduped (identical forms collapse), word values sorted
  most-frequent first, sort_keys, deterministic across runs.
- Frequency bucket: words.json entries gain `f` (integer 0-9, 0 = most
  frequent, log-scaled from the hermitdave ranks the build already
  loads; absent = unranked). Deterministic; the ONLY change to existing
  data files (hanja.json and variants.json must emerge byte-identical).
- DATA-LICENSE.md: rr.json is a transform of existing sources, no new
  attribution.

### Runtime: interpreters and the input-channel rule

- Interpretation runs ONLY for free-typed user input: the search shell's
  typed path, the omnibox, `?q=` deep links, and the pending query. Every
  internal navigation (reading/homophone clicks, eum chips, saved-row
  opens, drill-downs, crumb jumps, the wordmark) requests a LITERAL
  lookup. Mechanically: the lookup path takes an `interpret` flag set
  only by the typed entry points; content.js's navigateTo/fetchLookup
  and all programmatic searches stay literal. Interpretation must never
  depend on string shape alone.
- Two generators for an interpreted Latin query. Gate (REVISED — the
  original letters-only gate made separator stripping unreachable):
  after trimming, the query must contain at least one A-Z letter and
  consist only of letters, hyphens, apostrophes, and internal spaces
  (/^[A-Za-z][A-Za-z' -]*$/ with a letter present); existing length cap.
  The Dubeolsik generator receives the RAW text (separators are not
  Dubeolsik keys and simply break composition, which the dictionary
  filter absorbs); the romanization generator receives the normalized
  form:
  1. DUBEOLSIK: qwertyToHangul → normal lookup. Validity = the
     dictionary filter (no composition gate).
  2. ROMANIZATION: normalize (lowercase; strip hyphens, apostrophes,
     spaces), expand a BOUNDED variant set — v1 list, deliberately
     short: (a) as normalized; (b) leading consonant devoiced (k→g,
     t→d, p→b, one variant each when applicable); (c) oo→u; (d) "sh"
     before a vowel → "s". Combinations capped at 8 variants total.
     Look each up in rr.words and rr.syllables; every candidate hangul
     runs the NORMAL lookup (word path or single-syllable reading path).
- Merge: interpretations that yield zero matches are dropped. One left →
  render as today. Two left → matches of both, preferred group first.
  PREFERENCE: best (lowest) `f` among each side's word matches wins;
  reading-list vs reading-list compares each side's BEST candidate
  cwCount (the max over its candidates — the index's first slot is
  arbitrary among compound-saturated chars, so "top candidate" is not
  meaningful);
  a word interpretation beats a syllable-only one; remaining ties →
  Dubeolsik first. The response carries
  `interpretations: [{kind: "dubeolsik"|"rr", from, to, start}]` where
  `start` is the index in `matches` where that group begins; present
  whenever interpretation produced the results (single or dual).
- buildOmniboxSuggestions: same generators and ordering; suggestions
  deduped by canonical content; suggestion `content` stays the canonical
  searchable string.

### Rendering and labeling (no menu may assert an unchosen reading)

- ONE interpretation: root identity and crumbs use the converted hangul
  (unchanged from the QWERTY addendum's behavior).
- TWO: the root view's identity and crumb label are the TYPED TEXT (the
  multi-match-root rule: no single canonical exists), so the trail reads
  `su › 女` whichever group was entered. Each group is introduced by a
  slim divider naming its mapping: `su → 수` for rr, `su → 녀 (keyboard)`
  for dubeolsik (the "(keyboard)" suffix appears only in the dual case).
  Inside a group, cards and list headers keep their normal labels
  ("15 hanja read 수"). No divider in the single case.
- renderCurrentView must support TWO reading-list matches in one view
  (today it assumes at most one); generalize before wiring dividers.
  Drill-downs from either group are ordinary navigation with standard
  crumbs, cache, and cycle handling.
- Group PREVIEW cap (ADDENDUM, user-reported: 수's 102 rows buried the
  녀 group): in MULTI-GROUP views only, a reading-list group renders its
  top 5 candidates plus one nav row `Show all N ›` (house nav-row
  affordance) that pushes the syllable's FULL reading view as an
  ordinary drill-down (crumb typed › syllable; back restores both
  groups). Groups at or under 5 candidates render whole, no row.
  Single-group views and every directly reached reading view stay
  complete and uncapped (the homophone browser's contract is
  unchanged).

### Tests

- Build verify: the binding anchor pairs; a determinism double-run;
  hanja.json/variants.json byte-identical to before.
- Node: rr-map consumption over schema-exact inline fixtures; variant
  expansion (bounded, each rule, cap honored); the merge matrix
  (dubeolsik-only, rr-only, both, neither); preference rule (f compare,
  cwCount compare, word-beats-syllable, dubeolsik tiebreak);
  interpretations shape incl. `start`; literal flag (interpret absent →
  Latin query returns empty as before the QWERTY feature? NO — literal
  means no interpretation: a Latin literal lookup returns empty);
  omnibox merge and dedupe. Real-data smokes: gukmin AND gungmin →
  국민; kukmin → 국민 (variant); toddlf → 생일 (unchanged); su → both
  수 and 녀 with 수 first; a literal navigateTo-style lookup of "su" →
  empty.
- Harness: shared fixture blocks (byte-identical) gain a mini rr map and
  a canned dual response; embed checks: dual groups render with dividers
  in preference order, root label = typed text, drill from the SECOND
  group and the crumb reads typed › entity, back restores both groups,
  single-interpretation rendering and labels unchanged, internal
  navigation (a homophone click) never re-interprets. index.html:
  fixture parity only (selections are never Latin).

## Card section convention (binding, all features)

User-directed (2026-08-18): every card section — existing and future —
is ONE self-contained unit: a single `appendX(card, m)` function with a
single call site in the card build, reading only its slice of the match
(plus settings through one enabled-predicate). No other code may know a
section exists. Moving a section is moving its call; removing it is
deleting its call; disabling it is one predicate. Rationale: the shell
(surfaces, saved words, settings, navigation, harness) should stay
reusable for a possible future app around a different language, without
building a speculative language-abstraction layer now. New sections MUST
follow this; existing sections are brought into line opportunistically
when touched, never in a big rewrite.

Normative section inventory (user-directed 2026-08-18, the "sections"
refactor): char cards are exactly appendCharHead (big glyph +
eumhun/readings line + badges + card actions + wiki link),
appendVariantNote, appendGlosses, appendMadeOf, appendFoundIn,
appendCompounds. Word cards are exactly their head section, glosses,
component-character list, homograph chips, and appendUsedInRow, each as
one named appendX. Reading cards, group dividers, and list views are
view-level, NOT card sections, and stay outside this convention.
Predicates: every section calls its enabled-predicate with settings from
ONE shared sectionSettings() accessor, which returns null until the
first real toggle ships (predicates return true on null); populating
that accessor is the entire plumbing left for the first toggle. The
refactor that established this was behavior-zero by contract: no CSS
renames, no DOM changes, byte-identical rendered card HTML.

## Character decomposition (ADDENDUM)

User-directed (2026-08-18): character cards show what a character is made
of (依 = 亻 + 衣), one level deep, behind a collapsed row. Source:
BabelStone IDS (public domain per its file header; chosen over
CHISE/cjkvi-ids for license, maintenance — cjkvi-ids has been static
since 2019 — and fidelity to modern glyph forms). Decisions ratified
with Jesse: expandable not always-present; the row sits AFTER the
definitions and BEFORE the compounds section; trigger styled like the
word-card used-in row (quiet, no accent color on the words, glyphs at
full text color); radical variant forms alias to their parent character;
character cards only; no level chips on part rows.

### Data source (pipeline)

- `https://www.babelstone.co.uk/IDS.TXT` alias
  `https://www.babelstone.co.uk/CJK/IDS.TXT`, cached as
  `pipeline/cache/babelstone-ids.txt` (UTF-8 with BOM, CRLF, ~3.3 MB).
  Format: `U+xxxx<TAB>char<TAB>seq...` where each sequence is
  `^IDS$` optionally followed by `(SOURCETAGS)`; a line may carry
  several tab-separated sequences for different regional forms, and a
  final `*note` field. Tag letters may be bracketed (`(G[V][B])`,
  `([G][T])`) for the virtual source forms the file's section 9
  describes; a bracketed letter counts as that tag.
- Decompositions are emitted for hanja.json characters only. The
  runtime never asks about anything else, and the other 88k IDS entries
  would be dead weight in the file.
- Sequence pick per character: prefer a sequence whose tags include K;
  else one whose tags include G or with no tag; else the first. (克 has
  `⿱十兄$(GHTJKPV)` and `⿱古儿$(X)`: pick 十+兄.)
- License: the file's header explicitly waives copyright and permits any
  use. DATA-LICENSE.md gains a decomp.json section quoting that basis
  and crediting Andrew West / BabelStone. No copyleft admixture: this
  was the deciding reason BabelStone won over the GPLv2 CHISE data.

### Build rules (binding)

- Flatten: strip IDC layout characters (U+2FF0–U+2FFF), the variation
  indicator 〾, and ASCII; what remains, in sequence order, is the part
  list. Layout/bracketing is NOT stored; the card's own glyph shows the
  arrangement.
- Sequences containing the mirror ⿾, rotation ⿿, or subtraction ㇯
  operators: drop the decomposition (affects 2 chars in our set).
- Placeholders `{n}` (unencoded components): substitute the IDS fragment
  from the file's own header table, recursively. If a `？`
  (unrepresentable) remains anywhere after substitution, drop the
  decomposition for that character.
- Skip-through (renderability): any part above the BMP (codepoint >
  U+FFFF) is replaced by its own picked decomposition, recursively,
  depth-capped at 6; if it cannot be fully reduced to BMP parts, drop
  the decomposition. BMP parts (including CJK Strokes block and radical
  blocks) are considered displayable.
- Dead-end expansion (user-directed 2026-08-18): a part with no card of
  its own (after aliasing) is replaced by its OWN parts when every
  resulting piece carries a card, recursively, same depth cap: 雔 has no
  card and splits into 隹 + 隹, so 雙 shows 隹 + 隹 + 又. All-or-nothing
  by design: a split that would introduce even one new inert piece
  teaches less than the whole glyph (虫 must never become 中 plus
  strokes), so such parts stay as they are. Graphically-true splits into
  single-stroke characters (罒 as 囗 + 丨 + 丨) are accepted; a curated
  blocklist was considered and deferred until a real card annoys.
- Radical aliasing: a display glyph maps to a TARGET dictionary
  character when one exists: NFKD over the Kangxi Radicals and CJK
  Radicals Supplement blocks, plus a pinned hand table for
  non-normalizing forms (at minimum 亻→人, 訁→言, 釒→金, 𥫗→竹,
  𤣩→王, 氵→水, 忄→心, 扌→手, 犭→犬, 衤→衣, 礻→示, 刂→刀, 灬→火,
  ⺌→小, 艹→艸, ⺼→肉, ⺝→月, 罒→网, ⻏→邑, 阝→阜, and the three the IDS
  file's own section 7 names: 糹→糸, 飠→食, 牜→牛). The DISPLAY glyph
  stays as written in the IDS (the card shows 亻, not 人); the alias
  affects only the reading/click target.
- Aliasing runs BEFORE skip-through, and an aliased part above the BMP
  takes its TARGET as the display glyph. Correction (Agent A, verified
  against the source): 𥫗 and 𤣩 are above the BMP and are their own
  whole IDS (`^𥫗$`), so under skip-through-first every bamboo and jade
  character would have been dropped instead of showing 竹 and 王. The
  same case pins three more aliases, without which their characters
  drop: 𩙿→食 (57 chars: 飯 館 飮), 𠆢→人 (38: 今 全 余 食), 𦥑→臼
  (11: 學 覺 興). The remaining above-BMP blockers are stroke shapes
  (𠃌 𠃊 𠃍 𠄌) and 𧘇, the bottom of 衣, which have no parent character
  to alias to, so their characters still drop.
- Visibility rule: a character's decomposition is emitted only if it has
  ≥ 2 parts AND at least one part resolves (directly or via alias) to a
  dictionary character. Stroke-soup splits of simple characters (匕 =
  乚 + ㇒) and fully-opaque splits are suppressed; the card then simply
  has no Made of row, exactly like an atomic character.
- Emit `extension/data/decomp.json`:
  `{v:1, parts: {char: [[g], [g,t], [g,null,n], [g,null], ...]}}` where
  `g` is the display glyph, `t` the dictionary character its row opens
  (omitted when g itself is the target and is in the dictionary), and
  `n` a short English name (first clause of Unihan kDefinition) present
  only for reading-less parts that have one. Slot 2 is null for every
  reading-less part; the row is 2 long when Unihan has no definition to
  name it with (correction, Agent A: 455 of the 1,215 reading-less rows,
  e.g. the strokes ㇒ ㇂ and shapes like 龴, have no kDefinition at all,
  so `[g,null,n]` alone could not express them, and `[g]` already means
  "clickable, target is g"). A row is therefore clickable if and only if
  its length is 1 or its slot 2 is a string. Only characters passing the
  visibility rule appear. sort_keys, deterministic across runs.

### Binding anchors (build verify step)

- 依 → [亻(→人), 衣]; 國 → [囗, 或]; 明 → [日, 月]; 或 → [戈, 口, 一];
  克 → [十, 兄] (K-form pick); 誨 → [訁(→言), 每] (alias);
  乾 → [十, 早, 乞] (skip-through of 𠦝 = ⿱十早);
  疑 → [匕, 矢, 龴, 疋] (skip-through of 𠤕 = ⿱匕矢; 龴 is a
  reading-less shape row);
  飮 → [食, 欠] and 學 → [臼, 爻, 冖, 子] (above-BMP aliases 𩙿 and 𦥑
  supplying the display glyph).
- ABSENT (no entry): 無 (placeholder {56} substitutes to ？), 乙 and 一
  (atomic). Verified against the file: 無 is `^⿱{56}灬$` with `{56}` =
  ？ in the header table, 乙 is `^乙$` and 一 is `^一$`, so both flatten
  to a single part and fail the visibility rule. Agent A verifies each absence reason against the source
  before asserting, and extends the anchor set if a rule above turns
  out to bind differently than expected — SPEC updated to match, never
  silently diverged from.
- Negative invariants over the whole emit: no part above the BMP, no
  `{`, `？`, IDC, or operator character in any list, no entry with
  fewer than 2 parts, no entry violating the visibility rule.

### Runtime

- background.js getData loads decomp.json as the FIFTH file, same lazy
  cache, with a guard (shape check; on failure the feature is absent,
  lookups still work). Char lookup responses gain `parts` when the
  character has an entry.
- `parts` row shape (Agent B, recorded here because the emitted rows are
  not what the renderer receives): the worker JOINS each row against
  hanja.json, because the content script has no access to it and there is
  no message type that would give it one. A clickable row becomes
  `{g, t, hun, eum, gloss}` (`g` display glyph, `t` the character the row
  opens, the rest the TARGET's first eumhun pair and first gloss); a
  reading-less row becomes `{g}` or `{g, name}`. A row whose target has no
  hanja.json entry degrades to `{g}`, so a click can never land nowhere. The
  reading falls back to `readings[0]` when the target's `eumhun` list is empty
  (或 reads 혹 with no hun recorded), so such a row is never a bare gloss.
  Char `parts` and word `parts` (component words) are disjoint by kind and
  read by different sections.
- Part clicks are ordinary LITERAL navigation to the target character
  (input-channel rule: never interpreted), with normal breadcrumbs and
  view caching. Reading-less parts are not clickable.

### Renderer (content.js, both surfaces, char cards only)

- Placement: after the definition list, before the Compounds label.
- Collapsed (default on every card build, no persistence): one row,
  `Made of 亻 + 衣 ›` — "Made of" and the chevron in the quiet
  used-in-row style, the glyphs at full text color, plus-signs between.
  The row lists the DISPLAY glyphs in IDS order.
- Expanded (tap anywhere on the row; chevron flips): part rows in the
  compound-row format directly under the trigger, pushing the compounds
  down. A part with a target renders glyph + the target's eumhun +
  short gloss + chevron and navigates on tap. A reading-less part
  renders greyed: glyph + its `n` name when present, no chevron, inert.
- Word cards are unchanged. Characters without an entry show no row.
- MODULARITY (user-directed): the whole section is ONE self-contained
  unit — a single `appendMadeOf(card, m)` in the appendCompounds style,
  called from exactly one place in the char-card build, reading `parts`
  off the match and nothing else. No other code knows the feature
  exists. Moving the section is changing the one call site; removing it
  is deleting the one call. The function's first act is a single
  enabled-predicate check (`decompEnabled(settings)`, default true, no
  UI in this release); surfacing a settings toggle later is ONE
  SETTINGS_SCHEMA entry plus nothing — the predicate already reads it.
  The harness asserts the single-call-site property (grep-level check:
  one call, one definition).

### Tests

- Node: parse/pick/substitute/skip-through/alias/visibility as pure
  functions with inline fixtures; anchor assertions against the real
  emitted decomp.json; determinism (double build byte-identical).
- Harness (both fixture blocks, byte-identical): char card shows the
  collapsed row with correct glyph sum; expand reveals rows; alias row
  (亻) navigates to 人 with crumb; reading-less row inert; atomic char
  has no row; word card unchanged; collapsed again after re-navigation.
  The fixture character is 靴 (`[["革"],["亻","人"],["乚",null,"hidden"],
  ["㇒",null]]`), the one shape that carries all four row kinds. The
  single-call-site check reads content.js over fetch, so it needs the
  repo served over http:// and reports itself skipped on file://.

## Recomposition (ADDENDUM)

User-directed (2026-08-18): the upward mirror of decomposition. A
character used as a part in other characters gets a "Part of N
characters" row; component-only characters (辶: no compounds, no words)
finally have card content. Binding architectural property, user-raised:
recomposition is DERIVED, never stored. There is no reverse list in any
data file and no build step; the worker computes the index from
decomp.json at runtime, so any change to a decomposition (pipeline edit,
dead-end rule change, alias change) changes the Part-of lists on the
next worker start with no other work. A test pins the derivation (the
index is a pure function of the decomp table it was built from).

### Worker

- Lazily built, module-cached index in the readingIndex style: scan
  decomp.parts once, crediting each row's TARGET (the aliased character:
  an 亻 row credits 人), deduped per containing char. Cleared with the
  data cache.
- Char matches gain `foundInCount` (omitted when 0, usedInCount style).
- New message type `{type:"foundIn", char}` returns the full list as
  `{ok:true, chars:[...]}`, ranked: by each containing character's
  cwCount descending (the existing "how much Korean this unlocks"
  signal), ties by codepoint for determinism. Each entry carries what
  the reading-list rows need (char, hun, eum, gloss, lvl when known).
  The incoming char is NFC-normalized and variant-mapped like any lookup
  input. Ranking and the hanja.json join happen per query, so the cached
  index itself stays a function of decomp.json alone.
- The character itself never appears in its own list; a char containing
  the same part twice (雙 contains 隹 twice) appears ONCE in that part's
  list.

### Renderer (char cards only, both surfaces)

- One self-contained `appendFoundIn(card, m)` per the card section
  convention: single call site, reads `foundInCount` plus its predicate.
- Placement: directly after the Made of row (identity block), before
  Compounds.
- Collapsed row: "Part of N characters ›" in the used-in row's quiet
  style. Tap navigates (usedIn style, NOT in-place expansion: lists run
  to hundreds for common radicals) to a `foundin:<char>` view titled by
  the part, rows in the homophone-browser format (glyph, eumhun, level
  chip, muted rare), each an ordinary literal drill-down. Crumb label
  "Part of". Cached per view, scroll restored, no re-query on back.
- Long lists use the reading-view pagination/preview conventions, which
  for this view means UNCAPPED: the cap exists only where several lists
  share one view, and a Part-of view always shows exactly one list.

### Tests

- Node: index derivation from an inline decomp fixture (incl. alias
  crediting, dedupe of twice-used parts, self-exclusion, ranking rule);
  DERIVATION pin: rebuild the index from a mutated copy of the table and
  assert the lists follow the mutation; real-data smokes: 人's list
  contains 依; 辶's list is non-empty and contains 道; 隹's list
  contains 雙 once.
- Harness (fixture blocks byte-identical): row renders with the count;
  tap opens the view with ranked rows and crumb; drill-down from a row;
  back restores without re-query; a char used nowhere shows no row;
  word cards unchanged; single-call-site check for appendFoundIn.

## Verification expectations

- A: after build, spot-check in the output: 國 has eumhun 나라/국 and compounds;
  variants map 国→國 and 学→學; words.json has 國民 → 국민. Print counts
  (expect roughly: chars ≥ 5000, words ≥ 20000, variants ≥ 1000).
- B: unit-test lookup logic with a tiny fixture (e.g. node script importing the
  pure functions); verify segmentation of "國民" and variant lookup of "国".
- C: test popup on a local HTML file with mixed Korean/hanja text.
