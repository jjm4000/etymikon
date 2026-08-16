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
- `edu` (ADDENDUM — 급 levels phase 1): `"edu": true` when the character is in
  the South Korean MOE basic-education hanja list (1,800 chars; source:
  Unihan kKoreanEducationHanja, Unicode license). Omitted when false.
  Propagated onto `kind:"char"` matches and reading-list candidates so the UI
  can badge school-curriculum characters.
- `eduT` (ADDENDUM — 급 levels phase 2, MOE tier): `"eduT": "m"` (middle
  school, 중학교용) or `"h"` (high school, 고등학교용) on edu-flagged chars
  whose tier is known. Source: the CC BY-SA wikitable at Korean Wikipedia
  「대한민국 중고등학교 기초한자 목록」 (extraction validated in the level-source
  research report), intersected with the Unihan membership set; a small
  glyph-variant map bridges the wiki's pre-2007 forms (戱→戲 etc.).
  Membership (edu) remains Unihan-authoritative: eduT never appears without
  edu. Emitted only when known; propagated wherever edu is. Attribution for
  the wiki source goes in extension/data/DATA-LICENSE.md.
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
- Edu badge (ADDENDUM — 급 levels phase 1): char cards whose match carries
  `edu: true`, and reading-list rows whose candidate does, render a small
  quiet badge near the eumhun — informative, not loud; muted colors in both
  themes. Label: "Basic-1800 (기초)" everywhere (title/aria "MOE basic
  education hanja (1,800)"); one label, no compact variant (user decision —
  re-assess later if it crowds narrow layouts). No badge anywhere when the
  flag is absent.
  Tier badge (ADDENDUM — phase 2): when the match carries `eduT`, a SECOND
  badge in the same style renders next to the Basic-1800 badge (Naver-style
  separate badges per classification): label "Middle school" for m,
  "High school" for h (plain English, user decision); tooltip/aria
  "MOE tier: middle school (중학교용)" / "MOE tier: high school (고등학교용)".
  The tier badge REPLACES the Basic-1800 badge when eduT is present (user
  decision: tier strictly implies membership, and two badges saying one
  thing is clutter) — so Basic-1800 renders only on edu chars with no known
  tier (the small variant-gap set). Rendered everywhere badges render (card
  heads, nested cards, reading rows).
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
  with the nav stack and any retained scroll offsets cleared. Long trails middle-truncate. Clickable rows carry a
  subtle chevron (›) affordance and a hover state; view changes use a fast,
  subtle transition (~120ms fade or slide — no jank, no layout pop), and the
  popup stays anchored to the original selection throughout. The bare "← back"
  control is superseded by the breadcrumb (crumb before last = back).

## Verification expectations

- A: after build, spot-check in the output: 國 has eumhun 나라/국 and compounds;
  variants map 国→國 and 学→學; words.json has 國民 → 국민. Print counts
  (expect roughly: chars ≥ 5000, words ≥ 20000, variants ≥ 1000).
- B: unit-test lookup logic with a tiny fixture (e.g. node script importing the
  pure functions); verify segmentation of "國民" and variant lookup of "国".
- C: test popup on a local HTML file with mixed Korean/hanja text.
