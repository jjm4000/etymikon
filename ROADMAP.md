# Roadmap

Working list of planned changes. Ordering within a release is not priority
order. The next store upload ships whatever is merged and verified when the
current review clears.

## 1.0.1 — queued, awaiting 1.0.0 store approval

All merged on `main` and verified:

- Char cards head with the canonical character; variant surfaces (highlighting
  国) move to the "国 → 國" note
- "Wiktionary ↗" source links on every card; word links target the hanja-titled
  page when that page hosts the fuller CJK entry (`hp` flag)
- Compound lines are clickable (drill into the word's card, breadcrumb back)
- Complete per-character compound index with "Show 5 more (N)" pagination
- "Used in N larger words" disclosure on word cards → dedicated ranked list
  view (학생 → 대학생, 중학생, …)
- Breadcrumb "…" expands in place; intermediate levels always reachable
- Resizable popup, stage 1 (per-page-visit size, no persistence) — in progress
- Listing updates at upload time: privacy policy URL moves to GitHub Pages,
  homepage field points at this repo

## 1.1 — in progress

The queued release absorbed everything since 1.0 (see git history). Now also
in progress for it:

- Toolbar-popup search: type a query (hanja, hangul word, or syllable) into
  the extension's popup and get the same cards, drill-downs and badges as
  selection lookup — via an embed mode of the existing renderer
- Omnibox keyword (`hj 국민` from the address bar) opening the search page

## Options page + storage permission (1.2 candidates)

These share the `storage` permission and an options page, and require a
privacy-policy update ("stores your display preferences locally"):

- Save-word list with Anki/CSV export
- Resizable popup, stage 2: persist the chosen size; explicit size setting
- Per-site disable, hover-mode toggle (hover mode itself is further out)

## Later / unscheduled

- Character decomposition (國 = 囗 + 或) via the openly licensed cjkvi-ids data
- One example sentence per word (already present in the cached kaikki extracts)
- Selection support inside `<textarea>`/`<input>`; `all_frames` for iframes
- Level badges: phase 1 (MOE Basic-1800 badge, Unihan) shipped; phase 2 (MOE
  middle/high tier badges from the CC BY-SA Korean Wikipedia table) in
  progress. The 어문회 검정시험 급수 ladder is CLOSED as won't-do: no openly
  licensed source exists (verified — Korean Wiktionary carries no level data;
  all compilations trace to the association unlicensed), and Korean
  database-producer rights (저작권법 제91조–98조, with case law) make
  unlicensed extraction indefensible for a distributed product. MOE tiers
  are the recognized-ladder substitute.
- 대법원 인명용 badge ("usable in given names", ~8,000 chars from the Supreme
  Court rules annex — Korean law excludes statutes/rules from copyright, so
  likely clean): deliberately deferred; investigate as an optional badge
  long-term, not part of the current levels work
- General dictionary mode: include native Korean words, not just Sino-Korean
  (the full Wiktionary Korean extract is already downloaded and parsed at
  build time — this is a filter change plus roughly double words.json, and a
  product-identity decision more than a technical one)
- Sidebar (sidePanel API): the future home for settings + saved words +
  persistent search. Deliberately pre-wired: it will reuse the embed
  contract (popup-boot.js + content.js + search-shell.js) verbatim, adding
  only its own bootstrapper and page chrome — see SPEC "Multi-surface
  contract"
- Japanese and Chinese pronunciations on character cards, as an option
  (Unihan kMandarin / kJapaneseOn / kJapaneseKun — data is nearly free, but
  whether cross-language readings belong in a Korean-first tool is uncertain;
  would ride the options page whenever it exists)
- List views auto-growing taller than card views
- Korean-language store listing

## Non-goals for now

- Live Wiktionary API fallback (offline-first is the point)
- Anything requiring network permissions or data collection
