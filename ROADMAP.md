# Roadmap

Working list of planned changes. Ordering within a release is not priority
order. The next store upload ships whatever is merged and verified when the
current review clears.

## 1.1: ready, awaiting 1.0 store review

Everything below is merged on `main` and verified. It is one release: 1.0.1
was folded in rather than shipped separately, since nothing goes out until
the 1.0 review clears anyway.

- **Typed search in a sidebar.** Clicking the toolbar icon toggles a
  persistent side panel: a search box over the same cards, drill-downs and
  levels as selection lookup. The omnibox keyword (`hj 국민`) opens the
  panel with the query. The panel survives tab switches and navigation,
  which the earlier toolbar popup structurally could not; that popup was
  built first, shipped to no one, and was replaced by the sidebar before
  release. Both surfaces run on the same documented embed contract, and
  the sidebar page is a small registry-driven shell (views and header
  actions are declarative entries).
- **QWERTY-to-hangul search.** Typing `toddlf` with the keyboard still in
  English finds 생일. A query of nothing but Latin letters is read back
  through the 2-set Korean layout, which is safe because such a query
  matches nothing as it stands. The search box keeps what you typed. The
  omnibox converts on the same rule.
- **Romanized search.** Typing `gukmin`, `gungmin`, or `gugmin` finds
  국민: the three Revised Romanization conventions are indexed at build
  time, and a few common spelling habits (kukmin, guk-min) are accepted
  on top. A query that reads as both a keyboard mistype and a
  romanization (`su`) shows both result sets, most common first, each
  introduced by a small header naming its reading; long homophone lists
  preview five characters with a Show all link. Only typed input is
  interpreted. Navigation inside the dictionary never is.
- **Character decomposition.** Char cards carry a collapsed "Made of 囗 +
  或" row between the definitions and the compounds, expanding in place
  into part rows with readings, each an ordinary drill-down. Data is
  BabelStone IDS (public domain), built into decomp.json with pinned
  anchors: radical forms alias to their parent (亻 opens 人), parts that
  cannot render are skipped through to their own parts, and a card-less
  part whose split is entirely card-bearing shows the split instead
  (雙 = 隹 + 隹 + 又). Pictographs and stroke-soup splits show no row by
  rule. The section is one function behind one predicate, so a settings
  toggle later is a single schema entry.
- **Recomposition.** The upward mirror: "Part of 64 characters" on any
  character used inside others, opening a ranked list (most compounds
  first). Component-only characters like 辶 finally have card content.
  The lists are derived from decomp.json at runtime and stored nowhere,
  so decomposition edits reshape them automatically.
- **Whole-card compounds.** When a character's full compound index fits
  within what a card shows inline, it renders whole; the Show-more
  control only appears when there is a genuine second page. Curated-empty
  cards (又) no longer show a header with nothing under it.
- **Character level taxonomy.** Every character carries exactly one `lvl` of
  m/h/a/r, rendered as one of four level chips on char cards and reading-list
  rows: Middle school and High school (MOE curriculum tiers, from the CC BY-SA
  Korean Wikipedia table), Advanced (outside the curriculum, attested), Rare
  (archaic/specialist/reading-only). This REPLACES the old Basic-1800 badge
  and the edu/eduT tier badge; those labels are retired, and the earlier
  "level badges phase 1/2" plan is closed as delivered.
- **Exploration graph.** Compound lines and component-word rows are clickable,
  each character has a complete paginated compound index ("Show 5 more (N)"),
  word cards offer "Used in N larger words" as a dedicated ranked list, and a
  sticky breadcrumb trail with canonical labels, cycle handling and cached
  scroll positions holds the whole descent together. The trail elides by
  width, not depth: every level shows until the row actually runs out of
  room. Eumhun chips scroll to and flash their component card.
- **Card correctness.** Cards head with the canonical character; variant
  surfaces move to a view-scoped "国 → 國" note. "Wiktionary ↗" source links
  appear on every card and target the hanja-titled page where that page hosts
  the fuller CJK entry (`hp`). Badges became a declarative registry; gloss
  cleaning no longer eats quoted glosses.
- **Hedging is a group verdict.** The "likely native Korean" banner and
  the muted card styling appear only when every hanja spelling of a
  hangul-sourced word is rare. In a mixed group (가장: 家長 beside the
  rare 假裝) the card stays normal on every chip, and the chip's own
  RARE marker carries the rarity. The renderer had drifted to judging
  the selected spelling alone, which claimed a demonstrably Sino-Korean
  word was likely native.
- **Wiki links open in a background tab on every surface.** A foreground
  open would destroy ephemeral surfaces mid-read. Covered by the harness.
- **Resizable popup**: per-page-visit size. Persistence across visits was
  considered once storage existed and declined; the popup starting from
  its default each visit is the intended behavior.
- **Build hygiene**: deterministic data emit (`sort_keys`), canonical words
  keys, data-driven segmentation caps, geometry-derived expander state.
- **Card section convention** (internal): every card section is one
  function with one call site behind one settings predicate, verified by
  a byte-identical DOM snapshot refactor. Groundwork for reusing the
  shell in a possible future app around a different language; each
  future per-section toggle is now a single settings schema entry.
- Listing updates: DONE ahead of upload. store-listing.md rewritten to
  cover the sidebar, keyboard-free search, decomposition, saved words,
  export and settings; the privacy policy URL is live on GitHub Pages
  and the homepage field points at this repo. The store set is five of
  the nine committed shots (1, 2, 5, 6, 9): shot 2 is captured dark and
  the composites carry a 560px panel, both supported per-shot by
  pipeline/make_screenshots.py. Screenshot rule for future scenes: vary
  the featured characters across the set (the set once fronted 學 in
  three shots; shots 1 and 9 now feature 天 and 樂, and 學生 stays only
  in the Japanese shot, where the variant note is the point).

### Saved words and settings (merged and verified)

Merged to `main` after manual QA and an adversarial pass; ships with the
release:

- **Saved words.** A star on every card (selection popup and sidebar)
  saves the entry, with a bookmark-style bubble to pick or create a folder
  on the spot. Saved items are references into the dictionary, so the list
  always shows current data and duplicates cannot exist.
- **Folders.** Create, rename and delete (contents return to the default
  folder), collapse and expand, batch selection at the folder and item
  level, and batch move, delete (with confirmation) and export.
- **Export.** Anki (tab-separated, front and back shaped by settings, the
  folder carried as an Anki tag) or CSV (a full-data spreadsheet).
- **Settings page.** Schema-driven so each future setting is one entry:
  default save folder plus the Anki card layout for word and character
  cards.
- **Storage.** First use of the `storage` permission; everything stays in
  `chrome.storage.local` on the device. The privacy policy is updated to
  match (it also corrects the older "no permissions" wording that
  `sidePanel` had already outdated).

### Open question in this release

- **Reading-row chip weight.** RESOLVED: keep the chips as they are. The
  worst case (an all-Rare homophone list rendering a column of identical
  grey pills) was reviewed against two mitigations, suppressing the Rare
  chip on rows and de-filling row chips to plain text. Explicit labels on
  every row won; no change ships.

### Declined

- **Popup state restoration** (reopening the toolbar popup back on the last
  view). Declined: action popups are destroyed on any focus loss by browser
  design, and faking continuity in an ephemeral surface teaches the wrong
  model. The question later resolved itself when the toolbar popup was
  replaced by the sidebar, which persists for real.
- **One example sentence per word.** Declined after a mockup and a coverage
  measurement: the cached kaikki extracts carry sentences for only 7.8% of
  words, and a sentence on the card duplicates what one click into
  Wiktionary already gives. Simplicity won. If it ever returns, the natural
  home is Anki-export enrichment, not the card.

## Future settings entries

The settings page and `storage` permission now exist, so each of these is
one schema entry plus its feature code:

- Per-site disable, hover-mode toggle (hover mode itself is further out)
- Japanese and Chinese pronunciations on character cards (see Later)

## Later / unscheduled

- Selection support inside `<textarea>`/`<input>`; `all_frames` for iframes
- 대법원 인명용 badge ("usable in given names", ~8,000 chars from the Supreme
  Court rules annex; Korean law excludes statutes/rules from copyright, so
  likely clean): deliberately deferred; an optional badge long-term, not part
  of the level taxonomy that shipped
- General dictionary mode: include native Korean words, not just Sino-Korean
  (the full Wiktionary Korean extract is already downloaded and parsed at
  build time, so this is a filter change plus roughly double words.json, and a
  product-identity decision more than a technical one)
- Japanese and Chinese pronunciations on character cards, as an option
  (Unihan kMandarin / kJapaneseOn / kJapaneseKun: data is nearly free, but
  whether cross-language readings belong in a Korean-first tool is uncertain;
  would ride the options page whenever it exists)
- List views auto-growing taller than card views
- Korean-language store listing

## Non-goals for now

- The 어문회 검정시험 급수 ladder. CLOSED as won't-do: no openly licensed
  source exists (verified: Korean Wiktionary carries no level data; all
  compilations trace to the association unlicensed), and Korean
  database-producer rights (저작권법 제91조–98조, with case law) make
  unlicensed extraction indefensible for a distributed product. The MOE
  curriculum tiers in the level taxonomy are the recognized-ladder substitute.
- Live Wiktionary API fallback (offline-first is the point)
- Anything requiring network permissions or data collection
