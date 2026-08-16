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

## 1.1 — options page + storage permission

These share the `storage` permission and an options page, and require a
privacy-policy update ("stores your display preferences locally"):

- Japanese and Chinese pronunciations on character cards (Unihan
  kMandarin / kJapaneseOn / kJapaneseKun; default on/off undecided)
- Save-word list with Anki/CSV export
- Resizable popup, stage 2: persist the chosen size; explicit size setting
- Per-site disable, hover-mode toggle (hover mode itself is further out)

## Later / unscheduled

- Character decomposition (國 = 囗 + 或) via the openly licensed cjkvi-ids data
- One example sentence per word (already present in the cached kaikki extracts)
- Selection support inside `<textarea>`/`<input>`; `all_frames` for iframes
- Omnibox lookup (`hj 국민` from the address bar)
- 급수 proficiency-level badges (blocked on a cleanly licensed source)
- General dictionary mode: include native Korean words, not just Sino-Korean
  (the full Wiktionary Korean extract is already downloaded and parsed at
  build time — this is a filter change plus roughly double words.json, and a
  product-identity decision more than a technical one)
- Sidebar lookup: a typeable dictionary panel via Chrome's sidePanel API,
  complementing selection lookup — pairs naturally with general dictionary
  mode and the omnibox idea
- List views auto-growing taller than card views
- Korean-language store listing

## Non-goals for now

- Live Wiktionary API fallback (offline-first is the point)
- Anything requiring network permissions or data collection
