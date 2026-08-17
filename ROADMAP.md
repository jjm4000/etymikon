# Roadmap

Working list of planned changes. Ordering within a release is not priority
order. The next store upload ships whatever is merged and verified when the
current review clears.

## 1.1 — ready, awaiting 1.0 store review

Everything below is merged on `main` and verified. It is one release: 1.0.1
was folded in rather than shipped separately, since nothing goes out until
the 1.0 review clears anyway.

- **Typed search.** The toolbar popup takes a query (hanja, hangul word, or
  syllable) and renders the same cards, drill-downs and chips as selection
  lookup, with a 玉篇 header row (design D) whose `HEADER_ACTIONS` registry
  ships empty as scaffolding. An omnibox keyword (`hj 국민`) reaches the same
  search. Both run through an embed mode of the existing renderer, which is
  now a documented multi-surface contract — the sidebar is meant to reuse it
  verbatim.
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
  scroll positions holds the whole descent together. Eumhun chips scroll to
  and flash their component card.
- **Card correctness.** Cards head with the canonical character; variant
  surfaces move to a view-scoped "国 → 國" note. "Wiktionary ↗" source links
  appear on every card and target the hanja-titled page where that page hosts
  the fuller CJK entry (`hp`). Badges became a declarative registry; gloss
  cleaning no longer eats quoted glosses.
- **Wiki links open in a background tab on every surface**, including the
  popup — where a foreground open destroyed the popup mid-read. Covered by
  the harness.
- **Resizable popup, stage 1**: per-page-visit size, no persistence.
- **Build hygiene**: deterministic data emit (`sort_keys`), canonical words
  keys, data-driven segmentation caps, geometry-derived expander state.
- Listing updates at upload time: privacy policy URL on GitHub Pages,
  homepage field pointing at this repo, and a style pass over
  store-listing.md's newer sections (same rules as the README rewrite:
  no rule-of-three phrasing, no flavor lines).

### Open question in this release

- **Reading-row chip weight.** Level chips on reading-list rows are correct
  but visually heavy in the worst case: an all-Rare homophone list renders a
  column of identical grey pills that carries no information and drowns the
  eumhun. Two mitigations identified — suppress the Rare chip on rows only
  (keep it on card heads), or de-fill row chips generally (text-weight rather
  than pill). Not decided; both are small and can land before or after
  upload.

### Declined

- **Popup state restoration** (reopening the toolbar popup back on the last
  view). Declined: action popups are destroyed on any focus loss by browser
  design, and faking continuity in an ephemeral surface teaches the wrong
  model. Persistent sessions are the sidebar's job (see 1.2).

## 1.2 — sidebar as the anchor

- **Sidebar (sidePanel API)** is the 1.2 anchor and the home for everything
  the popup structurally cannot hold: persistence across tab switches and
  navigation, saved words, settings, and the primary search home. Already
  pre-wired — it reuses the embed contract (popup-boot.js + content.js +
  search-shell.js) verbatim, adding only its own bootstrapper and page
  chrome; see SPEC "Multi-surface contract". The popup's `HEADER_ACTIONS`
  registry gets its "open sidebar" entry when this lands.
- **Romanized SEARCH INPUT** (not display): typing gukmin/gungmin finds 국민 →
  國民 for IME-less learners — the natural completion of typed search for the
  target audience. Approach: dictionary-constrained matching (candidate
  hangul readings of the typed romanization, kept only where they hit
  byHangul / the reading index); index both naive and sound-changed Revised
  Romanization at build time (hangul→RR is deterministic). Also powers the
  omnibox (`hj guk`). Romanized OUTPUT on cards: declined for now (clutter +
  counter-pedagogical; at most a far-future options toggle).

### Options page + storage permission (1.2 cluster)

These share the `storage` permission and an options page, and require a
privacy-policy update ("stores your display preferences locally"):

- Save-word list with Anki/CSV export
- Resizable popup, stage 2: persist the chosen size; explicit size setting
- Per-site disable, hover-mode toggle (hover mode itself is further out)

## Later / unscheduled

- Character decomposition (國 = 囗 + 或) via the openly licensed cjkvi-ids data
- One example sentence per word (already present in the cached kaikki extracts)
- Selection support inside `<textarea>`/`<input>`; `all_frames` for iframes
- 대법원 인명용 badge ("usable in given names", ~8,000 chars from the Supreme
  Court rules annex — Korean law excludes statutes/rules from copyright, so
  likely clean): deliberately deferred; an optional badge long-term, not part
  of the level taxonomy that shipped
- General dictionary mode: include native Korean words, not just Sino-Korean
  (the full Wiktionary Korean extract is already downloaded and parsed at
  build time — this is a filter change plus roughly double words.json, and a
  product-identity decision more than a technical one)
- Japanese and Chinese pronunciations on character cards, as an option
  (Unihan kMandarin / kJapaneseOn / kJapaneseKun — data is nearly free, but
  whether cross-language readings belong in a Korean-first tool is uncertain;
  would ride the options page whenever it exists)
- List views auto-growing taller than card views
- Korean-language store listing

## Non-goals for now

- The 어문회 검정시험 급수 ladder. CLOSED as won't-do: no openly licensed
  source exists (verified — Korean Wiktionary carries no level data; all
  compilations trace to the association unlicensed), and Korean
  database-producer rights (저작권법 제91조–98조, with case law) make
  unlicensed extraction indefensible for a distributed product. The MOE
  curriculum tiers in the level taxonomy are the recognized-ladder substitute.
- Live Wiktionary API fallback (offline-first is the point)
- Anything requiring network permissions or data collection
