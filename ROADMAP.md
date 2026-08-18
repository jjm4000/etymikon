# Roadmap

Working list of planned changes. Ordering within a release is not priority
order. The next store upload ships whatever is merged and verified when the
current review clears.

## 1.1 — ready, awaiting 1.0 store review

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
- **Wiki links open in a background tab on every surface.** A foreground
  open would destroy ephemeral surfaces mid-read. Covered by the harness.
- **Resizable popup, stage 1**: per-page-visit size, no persistence.
- **Build hygiene**: deterministic data emit (`sort_keys`), canonical words
  keys, data-driven segmentation caps, geometry-derived expander state.
- Listing updates at upload time: privacy policy URL on GitHub Pages,
  homepage field pointing at this repo, a style pass over
  store-listing.md's newer sections (same rules as the README rewrite:
  no rule-of-three phrasing, no flavor lines), and a screenshots, README
  and store-listing refresh covering the sidebar and saved words (the
  current screenshot 5 and search copy show the removed toolbar popup).

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
  model. The question later resolved itself when the toolbar popup was
  replaced by the sidebar, which persists for real.

## 1.2 — romanized search

The sidebar, saved words and settings were planned here and moved up (see
above). What remains:

- **Romanized SEARCH INPUT** (not display): typing gukmin/gungmin finds 국민 →
  國民 for IME-less learners — the natural completion of typed search for the
  target audience. Approach: dictionary-constrained matching (candidate
  hangul readings of the typed romanization, kept only where they hit
  byHangul / the reading index); index both naive and sound-changed Revised
  Romanization at build time (hangul→RR is deterministic). Also powers the
  omnibox (`hj guk`). Romanized OUTPUT on cards: declined for now (clutter +
  counter-pedagogical; at most a far-future options toggle).

### Future settings entries

The settings page and `storage` permission now exist, so each of these is
one schema entry plus its feature code:

- In-page popup resize persistence (per-page-visit sizing shipped in 1.1)
- Per-site disable, hover-mode toggle (hover mode itself is further out)
- Japanese and Chinese pronunciations on character cards (see Later)

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
