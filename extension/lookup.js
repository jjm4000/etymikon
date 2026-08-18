/**
 * Hanja Hover — pure lookup logic.
 *
 * This module deliberately contains NO chrome.* API usage so that it can be
 * imported and unit-tested in plain Node (see test/lookup.test.mjs).
 * All chrome glue lives in background.js.
 *
 * Implements SPEC.md "Service worker behavior" rules 1-4 (including 3b).
 */

import { qwertyToHangul, isLatinQuery } from "./dubeolsik.js";

/** Rule 1: cap the input at 20 relevant (Han + Hangul) characters. */
export const MAX_RELEVANT_CHARS = 20;
/**
 * Rule 3: greedy longest-match over Han runs. FALLBACK ONLY — the real cap is
 * words.json's `maxWordLen` (the longest key actually shipped, currently 11:
 * 後天性免疫缺乏症候群). This 6 is what a bundle without the metadata gets, and
 * what the old hardcoded behavior was.
 */
export const MAX_WORD_LEN = 6;
/** words.json only contains hanja spellings of length >= 2. */
export const MIN_WORD_LEN = 2;
/** Rule 3b: hangul spans shorter than 2 syllables are skipped. */
export const MIN_HANGUL_WORD_LEN = 2;
/**
 * Rule 3b: hangul spans. FALLBACK ONLY, same rule as MAX_WORD_LEN — the real
 * cap is words.json's `maxHangulLen`.
 */
export const MAX_HANGUL_WORD_LEN = 6;

/**
 * Length metadata ADDENDUM: read a segmentation cap off words.json, falling
 * back to the documented constant when the bundle predates the field (old
 * fixtures, placeholder data).
 */
function lenMeta(value, fallback) {
  return Number.isInteger(value) && value >= MIN_WORD_LEN ? value : fallback;
}

/** Rule 3 cap for a given words.json object. */
export function maxWordLenOf(words) {
  return lenMeta(words && words.maxWordLen, MAX_WORD_LEN);
}

/** Rule 3b cap for a given words.json object. */
export function maxHangulLenOf(words) {
  return lenMeta(words && words.maxHangulLen, MAX_HANGUL_WORD_LEN);
}
/** Word-parts addendum: sub-word glosses are capped at 2 (first sense). */
export const MAX_PART_GLOSSES = 2;
/**
 * Rule 3: when the selection contains <= 4 *Han* characters, characters that
 * only appeared inside a Han word match still get their own char card.
 * Hangul and other scripts do NOT count toward this threshold, so a selection
 * like 國民이라는 (2 Han + 3 hangul) still yields the 國/民 cards.
 */
export const CHAR_CARD_SELECTION_LIMIT = 4;

/** lvl ADDENDUM: the four character levels, curriculum first, then usage. */
export const LEVELS = ["m", "h", "a", "r"];

/** True for a valid `lvl` value. */
export function isLevel(v) {
  return v === "m" || v === "h" || v === "a" || v === "r";
}

const HAN_CHAR = /\p{Script=Han}/u;
const HANGUL_CHAR = /\p{Script=Hangul}/u;

const hasOwn = (obj, key) =>
  obj != null && Object.prototype.hasOwnProperty.call(obj, key);

/** True for a single Han code point (string of length 1 or a surrogate pair). */
export function isHan(ch) {
  return typeof ch === "string" && ch.length > 0 && HAN_CHAR.test(ch);
}

/** True for a single Hangul code point (syllable or jamo). */
export function isHangul(ch) {
  return typeof ch === "string" && ch.length > 0 && HANGUL_CHAR.test(ch);
}

/** Rule 2: NFC normalization. Non-strings normalize to "". */
export function normalize(text) {
  return typeof text === "string" ? text.normalize("NFC") : "";
}

/**
 * Rule 1: NFC-normalize, then split into runs of contiguous same-script
 * characters, preserving order. Anything that is neither Han nor Hangul breaks
 * a run, and a script change also breaks a run, so segmentation never spans a
 * boundary (e.g. "國A民" cannot match the word 國民, and "國민" yields two runs).
 * The cap applies to the total number of relevant characters across all runs.
 *
 * @returns {Array<{script:"han"|"hangul", chars:string[]}>}
 */
export function extractRuns(text, cap = MAX_RELEVANT_CHARS) {
  const runs = [];
  let current = null;
  let taken = 0;
  for (const ch of normalize(text)) {
    if (taken >= cap) break;
    const script = isHan(ch) ? "han" : isHangul(ch) ? "hangul" : null;
    if (script === null) {
      current = null;
      continue;
    }
    if (current === null || current.script !== script) {
      current = { script, chars: [] };
      runs.push(current);
    }
    current.chars.push(ch);
    taken += 1;
  }
  return runs;
}

/** Rule 2: map one character through variants.map to its canonical form. */
export function toCanonical(ch, variantMap) {
  const mapped = hasOwn(variantMap, ch) ? variantMap[ch] : ch;
  return typeof mapped === "string" && mapped.length > 0 ? mapped : ch;
}

/**
 * Shared greedy longest-match segmentation core. Used three times: rule 3
 * (Han runs), rule 3b (Hangul runs) and the word-parts addendum, which differ
 * only in their key table, length bounds and — for word parts — an exclusion.
 *
 * At each position it tries the longest candidate first and accepts the first
 * one `isWord` approves; a rejected position advances by a single item.
 *
 * @param {Array<{surface:string, canonical:string}>} items
 * @param {(key:string, start:number, len:number) => boolean} isWord
 * @param {number} minLen
 * @param {number} maxLen
 * @returns {Array<{kind:"word"|"char", start:number, length:number,
 *                  surface:string, canonical:string,
 *                  items:Array<{surface:string, canonical:string}>}>}
 */
function greedySegment(items, isWord, minLen, maxLen) {
  const segments = [];
  let i = 0;
  while (i < items.length) {
    let matchedLen = 0;
    const limit = Math.min(maxLen, items.length - i);
    for (let len = limit; len >= minLen; len -= 1) {
      const key = items.slice(i, i + len).map((it) => it.canonical).join("");
      if (isWord(key, i, len)) {
        matchedLen = len;
        break;
      }
    }
    const length = matchedLen || 1;
    const slice = items.slice(i, i + length);
    segments.push({
      kind: matchedLen ? "word" : "char",
      start: i,
      length,
      surface: slice.map((it) => it.surface).join(""),
      canonical: slice.map((it) => it.canonical).join(""),
      items: slice,
    });
    i += length;
  }
  return segments;
}

/** Wrap a plain char array as segmentation items with surface === canonical. */
const asItems = (chars) => chars.map((ch) => ({ surface: ch, canonical: ch }));

/**
 * Rule 3: greedy longest-match segmentation of a single Han run.
 *
 * Word keys are looked up in their canonical (variant-mapped) form, while each
 * segment also carries the original surface form for display.
 *
 * @param {string[]} run single Han run (array of code points)
 * @param {object} wordTable words.json `words` object
 * @param {object} variantMap variants.json `map` object
 * @param {number} [maxLen] longest span to try (words.json `maxWordLen`)
 */
export function segmentRun(run, wordTable, variantMap, maxLen = MAX_WORD_LEN) {
  const items = run.map((ch) => ({ surface: ch, canonical: toCanonical(ch, variantMap) }));
  return greedySegment(items, (key) => hasOwn(wordTable, key), MIN_WORD_LEN, maxLen);
}

/**
 * Rule 3b: greedy longest-match segmentation of a single Hangul run against
 * `byHangul`. Spans of 1 syllable are never matched; unmatched syllables
 * produce nothing at all (there are no hangul "char" cards).
 *
 * @param {string[]} run single Hangul run (array of syllables)
 * @param {object} byHangul words.json `byHangul` object
 * @param {number} [maxLen] longest span to try (words.json `maxHangulLen`)
 * @returns {Array<{start:number, length:number, surface:string}>} matched spans
 */
export function segmentHangulRun(run, byHangul, maxLen = MAX_HANGUL_WORD_LEN) {
  const isWord = (key) =>
    hasOwn(byHangul, key) && Array.isArray(byHangul[key]) && byHangul[key].length > 0;
  return greedySegment(asItems(run), isWord, MIN_HANGUL_WORD_LEN, maxLen)
    .filter((seg) => seg.kind === "word")
    .map((seg) => ({ start: seg.start, length: seg.length, surface: seg.surface }));
}

/** The first usable sense of a `words` entry (entries are homograph arrays). */
function firstSense(raw) {
  const list = Array.isArray(raw) ? raw : [raw];
  return list.find((e) => e && typeof e === "object") || null;
}

/**
 * Compare two candidate segmentations by the word-parts priority order:
 * (1) most chars covered by gloss-bearing sub-words, (2) most chars covered by
 * any sub-word, (3) fewest segments.
 */
function isBetterSegmentation(a, b) {
  if (a.glossed !== b.glossed) return a.glossed > b.glossed;
  if (a.covered !== b.covered) return a.covered > b.covered;
  return a.segs < b.segs;
}

/**
 * Word-parts addendum: re-segment the interior of a word's canonical spelling.
 *
 * NOT greedy longest-match (unlike rules 3/3b). A small dynamic program over
 * the word picks the segmentation maximizing, in priority order: chars covered
 * by gloss-bearing sub-words, then chars covered by any sub-word, then fewest
 * segments. This prefers 資本 + 主義 over the greedy 資本主 + 義, because the
 * stub entry 資本主 carries no glosses and so explains nothing — while still
 * letting a gloss-less sub-word beat no split at all (priority 2).
 *
 * Only words of >= 3 characters get parts. The full span is excluded from the
 * candidate set so a word is never listed as its own part — the exclusion is by
 * span, not by key: for a 3-char word the length-3 candidate at offset 0 IS the
 * word and is rejected, but the same key appearing as a proper sub-span of a
 * longer word remains valid.
 *
 * Cost is O(n * maxLen) with n <= 20, i.e. negligible.
 *
 * @param {string} canonical the word's canonical hanja spelling
 * @param {object} wordTable words.json `words` object
 * @param {number} [maxLen] longest sub-word to try (words.json `maxWordLen`)
 * @returns {Array<object>|null} parts, or null when no multi-char sub-word exists
 */
export function buildWordParts(canonical, wordTable, maxLen = MAX_WORD_LEN) {
  const chars = [...canonical];
  const total = chars.length;
  if (total < 3) return null;

  // dp[i] = best segmentation of the suffix starting at i, plus the first
  // segment of that segmentation so the choice can be reconstructed.
  const dp = new Array(total + 1);
  dp[total] = { glossed: 0, covered: 0, segs: 0, len: 0, isWord: false };

  for (let i = total - 1; i >= 0; i -= 1) {
    let best = null;
    const consider = (len, isWord, glossedChars) => {
      const next = dp[i + len];
      const candidate = {
        glossed: glossedChars + next.glossed,
        covered: (isWord ? len : 0) + next.covered,
        segs: 1 + next.segs,
        len,
        isWord,
      };
      if (best === null || isBetterSegmentation(candidate, best)) best = candidate;
    };

    // Leaving the char uncovered is always an option; considered first so that
    // exact ties resolve deterministically toward earlier candidates.
    consider(1, false, 0);

    const limit = Math.min(maxLen, total - i);
    for (let len = MIN_WORD_LEN; len <= limit; len += 1) {
      if (i === 0 && len === total) continue; // never a part of itself
      const key = chars.slice(i, i + len).join("");
      if (!hasOwn(wordTable, key)) continue;
      const sense = firstSense(wordTable[key]);
      if (sense === null) continue;
      const glossBearing = Array.isArray(sense.glosses) && sense.glosses.length > 0;
      consider(len, true, glossBearing ? len : 0);
    }

    dp[i] = best;
  }

  // Reconstruct, and bail out when the winning segmentation is all bare chars.
  const parts = [];
  let sawWord = false;
  for (let i = 0; i < total; ) {
    const step = dp[i];
    const key = chars.slice(i, i + step.len).join("");
    if (step.isWord) {
      sawWord = true;
      const sense = firstSense(wordTable[key]);
      parts.push({
        type: "word",
        hanja: key,
        hangul: typeof sense.hangul === "string" ? sense.hangul : "",
        glosses: Array.isArray(sense.glosses)
          ? sense.glosses.slice(0, MAX_PART_GLOSSES)
          : [],
      });
    } else {
      parts.push({ type: "char", char: key });
    }
    i += step.len;
  }
  return sawWord ? parts : null;
}

function buildWordMatch(
  { surface, canonical, hangul, glosses, rare, hp },
  wordTable,
  charTable,
  maxWordLen = MAX_WORD_LEN
) {
  const match = {
    kind: "word",
    surface,
    canonical,
    hangul: typeof hangul === "string" ? hangul : "",
    glosses: Array.isArray(glosses) ? glosses.slice() : [],
    chars: [...canonical],
  };
  // Rare flag addendum: propagated only when true, like `parts`.
  if (rare === true) match.rare = true;
  // Hanja-page flag addendum: the entry lives at the hanja-spelling title, so
  // the UI's Wiktionary link should target <canonical> instead of <hangul>.
  if (hp === true) match.hp = true;
  // Used-in addendum: how many larger words contain this one (self excluded),
  // so the UI can render the "Used in N larger words" disclosure without
  // requesting the list. Omitted when 0.
  const usedIn = usedInSpellings(canonical, charTable ?? {}, wordTable).length;
  if (usedIn > 0) match.usedInCount = usedIn;
  const parts = buildWordParts(canonical, wordTable, maxWordLen);
  if (parts) match.parts = parts;
  return match;
}

function buildCharMatch(item, entry) {
  const match = {
    kind: "char",
    surface: item.surface,
    canonical: item.canonical,
    eumhun: Array.isArray(entry.eumhun) ? entry.eumhun : [],
    readings: Array.isArray(entry.readings) ? entry.readings : [],
    glosses: Array.isArray(entry.glosses) ? entry.glosses : [],
    compounds: Array.isArray(entry.compounds) ? entry.compounds : [],
  };
  // cw ADDENDUM: total size of the full compound index, so the UI can render
  // "Show 5 more (N)" without requesting the list. Omitted when 0.
  if (Array.isArray(entry.cw) && entry.cw.length > 0) {
    match.cwCount = entry.cw.length;
  }
  // lvl ADDENDUM: character level taxonomy (m/h/a/r), one value per char.
  // Always present in real data; guarded so a placeholder bundle stays safe.
  if (isLevel(entry.lvl)) match.lvl = entry.lvl;
  return match;
}

/**
 * ADDENDUM {type:"compounds"}: join a char's complete `cw` index against
 * words.json. Pure; the chrome glue in background.js calls this. The incoming
 * char is NFC-normalized and variant-mapped like any lookup input. Returns
 * the SPEC response array (order = cw order); unknown char or missing index
 * yields [].
 */
/** Join an ordered list of spellings against words.json into SPEC row shape. */
function joinSpellings(spellings, wordTable) {
  const out = [];
  for (const spelling of spellings) {
    if (typeof spelling !== "string" || !hasOwn(wordTable, spelling)) continue;
    const senses = wordTable[spelling];
    const first = Array.isArray(senses) ? senses[0] : senses;
    if (!first || typeof first !== "object") continue;
    const row = {
      hanja: spelling,
      hangul: typeof first.hangul === "string" ? first.hangul : "",
      gloss:
        Array.isArray(first.glosses) && typeof first.glosses[0] === "string"
          ? first.glosses[0]
          : "",
    };
    // rare propagated only when every sense of the spelling is rare, matching
    // collapseEntries' any-attested-sense-clears-it semantics.
    const all = Array.isArray(senses) ? senses : [senses];
    if (all.length > 0 && all.every((s) => s && s.rare === true)) {
      row.rare = true;
    }
    out.push(row);
  }
  return out;
}

export function buildFullCompounds(char, data) {
  if (typeof char !== "string" || char.length === 0) return [];
  const variantMap = data?.variants?.map ?? {};
  const charTable = data?.hanja?.chars ?? {};
  const wordTable = data?.words?.words ?? {};
  const normalized = char.normalize("NFC");
  const canonical = hasOwn(variantMap, normalized)
    ? variantMap[normalized]
    : normalized;
  if (!hasOwn(charTable, canonical)) return [];
  const cw = charTable[canonical].cw;
  if (!Array.isArray(cw)) return [];
  return joinSpellings(cw, wordTable);
}

/**
 * Used-in ADDENDUM: every words.json spelling that STRICTLY contains `word`
 * (self excluded), in ranked order. Derived from the first char's `cw` index,
 * which is already frequency-sorted; falls back to a wordTable scan when that
 * char has no entry (order unranked there — acceptable for the rare case).
 */
function usedInSpellings(word, charTable, wordTable) {
  if (typeof word !== "string" || word.length < 2) return [];
  const first = [...word][0];
  const cw = hasOwn(charTable, first) ? charTable[first].cw : null;
  const pool = Array.isArray(cw) ? cw : Object.keys(wordTable ?? {});
  return pool.filter(
    (sp) =>
      typeof sp === "string" &&
      sp !== word &&
      sp.includes(word) &&
      hasOwn(wordTable, sp)
  );
}

export function buildUsedIn(word, data) {
  if (typeof word !== "string" || word.length === 0) return [];
  const charTable = data?.hanja?.chars ?? {};
  const wordTable = data?.words?.words ?? {};
  const normalized = word.normalize("NFC");
  return joinSpellings(
    usedInSpellings(normalized, charTable, wordTable),
    wordTable
  );
}

/**
 * Collapse the homograph entries of one hanja spelling down to a single sense
 * set for a hangul-sourced match. Entries whose `hangul` matches the selected
 * span win; if none do, all entries are used. Glosses are merged and deduped.
 */
function collapseEntries(entries, hangulSpan) {
  const list = (Array.isArray(entries) ? entries : [entries]).filter(
    (e) => e && typeof e === "object"
  );
  if (list.length === 0) return null;
  const preferred = list.filter((e) => e.hangul === hangulSpan);
  const chosen = preferred.length > 0 ? preferred : list;
  const glosses = [];
  for (const entry of chosen) {
    if (!Array.isArray(entry.glosses)) continue;
    for (const gloss of entry.glosses) {
      if (!glosses.includes(gloss)) glosses.push(gloss);
    }
  }
  return {
    hangul: typeof chosen[0].hangul === "string" ? chosen[0].hangul : hangulSpan,
    glosses,
    // Rare only when every contributing sense-set is flagged rare: a single
    // attested sense is enough to make the spelling a confident match.
    rare: chosen.every((e) => e.rare === true),
    // hp when ANY contributing sense came from the hanja-spelling page: the
    // page's existence is what the link cares about, not which sense won.
    hp: chosen.some((e) => e.hp === true),
  };
}

/**
 * Rule 3c: derive the eum -> hanja index from hanja.json at runtime. This is
 * NOT a data file; callers should build it once and cache it (background.js
 * memoizes it module-level alongside the parsed data).
 *
 * Eums come from both `readings` and the `eum` of each `eumhun` entry. Each
 * candidate carries the `hun` of the eumhun entry that produced the eum (""
 * when the eum only appears in `readings`). Candidate lists are ranked by
 * compound count descending — a rough frequency proxy — with ties left in
 * hanja.json key order (Array#sort is stable).
 *
 * @param {object} hanjaData parsed hanja.json
 * @returns {Record<string, Array<{char:string, hun:string, eum:string, gloss:string}>>}
 */
export function buildReadingIndex(hanjaData) {
  const charTable = (hanjaData && hanjaData.chars) || {};
  /** @type {Record<string, Array<object>>} */
  const index = Object.create(null);
  const ranks = new Map();

  for (const char of Object.keys(charTable)) {
    const entry = charTable[char];
    if (!entry || typeof entry !== "object") continue;

    // eum -> hun, preferring the first eumhun entry that supplies a hun.
    const eums = new Map();
    if (Array.isArray(entry.eumhun)) {
      for (const pair of entry.eumhun) {
        if (!pair || typeof pair.eum !== "string" || pair.eum === "") continue;
        const hun = typeof pair.hun === "string" ? pair.hun : "";
        if (!eums.has(pair.eum) || (eums.get(pair.eum) === "" && hun !== "")) {
          eums.set(pair.eum, hun);
        }
      }
    }
    if (Array.isArray(entry.readings)) {
      for (const eum of entry.readings) {
        if (typeof eum !== "string" || eum === "") continue;
        if (!eums.has(eum)) eums.set(eum, "");
      }
    }
    if (eums.size === 0) continue;

    const gloss =
      Array.isArray(entry.glosses) && typeof entry.glosses[0] === "string"
        ? entry.glosses[0]
        : "";
    ranks.set(char, Array.isArray(entry.compounds) ? entry.compounds.length : 0);

    for (const [eum, hun] of eums) {
      if (index[eum] === undefined) index[eum] = [];
      const candidate = { char, hun, eum, gloss };
      // lvl ADDENDUM: the level chip renders on browse rows too.
      if (isLevel(entry.lvl)) candidate.lvl = entry.lvl;
      index[eum].push(candidate);
    }
  }

  for (const eum of Object.keys(index)) {
    index[eum].sort((a, b) => (ranks.get(b.char) || 0) - (ranks.get(a.char) || 0));
  }
  return index;
}

/**
 * Resolve the reading index for a bundle, preferring a caller-supplied cache.
 * Only called on the rule 3c path, so the index is never built unnecessarily.
 */
function resolveReadingIndex(bundle) {
  if (typeof bundle.getReadingIndex === "function") return bundle.getReadingIndex();
  if (bundle.readingIndex) return bundle.readingIndex;
  return buildReadingIndex(bundle.hanja);
}

/**
 * Build the `matches` array for a selection. Words first, then char cards.
 *
 * @param {string} text raw selected text
 * @param {{hanja?:object, words?:object, variants?:object}} data parsed data files
 * @returns {Array<object>} matches (possibly empty)
 */
export function buildMatches(text, data) {
  const bundle = data || {};
  const charTable = (bundle.hanja && bundle.hanja.chars) || {};
  const wordTable = (bundle.words && bundle.words.words) || {};
  const byHangul = (bundle.words && bundle.words.byHangul) || {};
  const variantMap = (bundle.variants && bundle.variants.map) || {};
  // Length metadata ADDENDUM: segmentation reaches as far as the data goes.
  const maxWordLen = maxWordLenOf(bundle.words);
  const maxHangulLen = maxHangulLenOf(bundle.words);

  const runs = extractRuns(text);
  const totalChars = runs.reduce((n, run) => n + run.chars.length, 0);
  if (totalChars === 0) return [];

  // Rule 3c: the entire extracted selection is exactly one hangul syllable →
  // homophone browse. No word or char matches are possible in this case.
  if (totalChars === 1 && runs[0].script === "hangul") {
    const eum = runs[0].chars[0];
    const candidates = resolveReadingIndex(bundle)[eum];
    if (!Array.isArray(candidates) || candidates.length === 0) return [];
    return [
      {
        kind: "reading",
        surface: eum,
        eum,
        candidates: candidates.map((c) => {
          const out = { char: c.char, hun: c.hun, eum: c.eum, gloss: c.gloss };
          if (isLevel(c.lvl)) out.lvl = c.lvl;
          return out;
        }),
      },
    ];
  }

  // Rule 3: the threshold counts Han characters ONLY — hangul (and anything
  // else) is excluded, so 國民이라는 still shows the 國/民 char cards.
  const hanCharCount = runs.reduce(
    (n, run) => (run.script === "han" ? n + run.chars.length : n),
    0
  );
  const showAllChars = hanCharCount <= CHAR_CARD_SELECTION_LIMIT;

  const wordMatches = [];
  /** @type {Map<string, object>} key -> the emitted match, for rare merging */
  const seenWords = new Map();
  /** @type {Array<{surface:string, canonical:string}>} */
  const charCandidates = [];

  const pushWord = (match) => {
    const key = `${match.canonical}|${match.hangul}|${match.surface}`;
    const existing = seenWords.get(key);
    if (existing !== undefined) {
      // Same headword reached twice (e.g. two Han-sourced homograph senses
      // sharing a hangul reading). Keep one card, but a single non-rare sense
      // clears the flag — matching collapseEntries' semantics on the hangul
      // path, so both paths agree on what "rare" means.
      if (existing.rare === true && match.rare !== true) delete existing.rare;
      // hp is any-wins on both paths: one sense living at the hanja page is
      // enough to make that page the better link target.
      if (existing.hp !== true && match.hp === true) existing.hp = true;
      return false;
    }
    seenWords.set(key, match);
    wordMatches.push(match);
    return true;
  };

  for (const run of runs) {
    if (run.script === "han") {
      for (const segment of segmentRun(run.chars, wordTable, variantMap, maxWordLen)) {
        if (segment.kind === "word") {
          const raw = wordTable[segment.canonical];
          const entries = (Array.isArray(raw) ? raw : [raw]).filter(
            (e) => e && typeof e === "object"
          );
          for (const entry of entries) {
            pushWord(
              buildWordMatch(
                {
                  surface: segment.surface,
                  canonical: segment.canonical,
                  hangul: entry.hangul,
                  glosses: entry.glosses,
                  rare: entry.rare,
                  hp: entry.hp,
                },
                wordTable,
                charTable,
                maxWordLen
              )
            );
          }
          // Rule 3: chars covered only by a word match still get a card when
          // the selection is short (<= 4 Han chars).
          if (showAllChars) charCandidates.push(...segment.items);
        } else {
          // Unmatched char — always a candidate for a char card.
          charCandidates.push(...segment.items);
        }
      }
    } else {
      // Rule 3b: hangul reverse lookup.
      for (const span of segmentHangulRun(run.chars, byHangul, maxHangulLen)) {
        // Rule 3b: ALL spellings, no cap — the UI renders a selector.
        const resolved = [];
        for (const spelling of byHangul[span.surface]) {
          if (typeof spelling !== "string" || spelling.length === 0) continue;
          const sense = collapseEntries(wordTable[spelling], span.surface);
          if (sense === null) continue;
          resolved.push({ spelling, sense });
        }
        if (resolved.length === 0) continue;

        // Rare flag addendum: non-rare spellings order FIRST, byHangul order
        // preserved within each group. `ordered[0]` is therefore the first
        // non-rare spelling, or the first spelling when every one is rare.
        const ordered = [
          ...resolved.filter((r) => !r.sense.rare),
          ...resolved.filter((r) => r.sense.rare),
        ];

        for (const { spelling, sense } of ordered) {
          pushWord(
            buildWordMatch(
              {
                surface: span.surface,
                canonical: spelling,
                hangul: sense.hangul,
                glosses: sense.glosses,
                rare: sense.rare,
                hp: sense.hp,
              },
              wordTable,
              charTable,
              maxWordLen
            )
          );
        }

        // Component hanja cards are ALWAYS emitted for hangul-sourced matches,
        // regardless of selection length, but only for one spelling.
        for (const ch of ordered[0].spelling) {
          charCandidates.push({ surface: ch, canonical: ch });
        }
      }
    }
  }

  const charMatches = [];
  const seenChars = new Set();
  for (const item of charCandidates) {
    if (seenChars.has(item.canonical)) continue;
    if (!hasOwn(charTable, item.canonical)) continue; // Rule 4: skip unknown chars
    const entry = charTable[item.canonical];
    if (!entry || typeof entry !== "object") continue;
    seenChars.add(item.canonical);
    charMatches.push(buildCharMatch(item, entry));
  }

  return [...wordMatches, ...charMatches];
}

/* ---------------------------------------------------------------------------
 * Romanized search ADDENDUM — the two interpreters.
 *
 * A pure-Latin query has two plausible readings: hangul typed with the
 * keyboard in the wrong mode (`toddlf` → 생일) and romanized Korean
 * (`gukmin` → 국민). Both are tried, both may survive, and the merge orders
 * them by frequency. This supersedes the QWERTY addendum's `converted` field:
 * the response now carries `interpretations`.
 *
 * THE INPUT-CHANNEL RULE: none of this runs unless the caller asks for it.
 * Interpretation belongs to free-typed input (the search shell, the omnibox,
 * `?q=` deep links, the pending query); every internal navigation looks up
 * literally, and a literal lookup of Latin text finds nothing, as it always
 * did. Interpretation must never depend on string shape alone.
 * ------------------------------------------------------------------------- */

/** Variant rule (b): a leading tense/aspirate spelling for a lax initial. */
const DEVOICE_LEADING = { k: "g", t: "d", p: "b" };

/** Variant expansion is deliberately bounded; v1 caps the set at 8. */
export const MAX_RR_VARIANTS = 8;

/**
 * Romanization normalization: case, and the punctuation romanizations use to
 * mark syllable boundaries (`guk-min`, `han'gul`), are all noise against an
 * index built from unpunctuated forms.
 */
export function normalizeRomanization(text) {
  return typeof text === "string"
    ? text.toLowerCase().replace(/[-'’\s]/g, "")
    : "";
}

/**
 * The bounded variant set for a romanized query: the normalized form, plus
 * the three v1 spelling rules applied in combination. Rules are applied to
 * everything produced so far, so `kooksu` reaches `guksu`, and the total is
 * capped at MAX_RR_VARIANTS (three binary rules cannot exceed it, but the cap
 * is enforced anyway so no future rule can make this unbounded).
 *
 * @param {string} text raw (or already normalized) query
 * @returns {string[]} variants, normalized form first, deduped
 */
export function romanizationVariants(text) {
  const base = normalizeRomanization(text);
  if (base === "") return [];
  const out = [base];
  const rules = [
    // (b) a leading k/t/p is often the lax initial the index spells g/d/b.
    (s) => (hasOwn(DEVOICE_LEADING, s[0]) ? DEVOICE_LEADING[s[0]] + s.slice(1) : null),
    // (c) McCune-style `oo` for RR's `u`.
    (s) => (s.includes("oo") ? s.replace(/oo/g, "u") : null),
    // (d) `sh` before a vowel is RR's plain `s`.
    (s) => (/sh[aeiou]/.test(s) ? s.replace(/sh(?=[aeiou])/g, "s") : null),
  ];
  for (const rule of rules) {
    for (const seed of out.slice()) {
      if (out.length >= MAX_RR_VARIANTS) break;
      const next = rule(seed);
      if (typeof next === "string" && next !== "" && !out.includes(next)) out.push(next);
    }
  }
  return out;
}

/**
 * Every hangul string the rr index offers for a variant set: words first, then
 * single syllables, in rr.json's own order (which is frequency-sorted for
 * words). Deduped across variants.
 */
function rrCandidates(variants, rr) {
  const words = (rr && rr.words) || {};
  const syllables = (rr && rr.syllables) || {};
  const out = [];
  const seen = new Set();
  const take = (list) => {
    if (!Array.isArray(list)) return;
    for (const hangul of list) {
      if (typeof hangul !== "string" || hangul === "" || seen.has(hangul)) continue;
      seen.add(hangul);
      out.push(hangul);
    }
  };
  for (const variant of variants) {
    if (hasOwn(words, variant)) take(words[variant]);
    if (hasOwn(syllables, variant)) take(syllables[variant]);
  }
  return out;
}

/** Identity of a match for dedupe purposes, per kind. */
function matchKey(match) {
  if (match.kind === "word") return `w|${match.canonical}|${match.hangul}|${match.surface}`;
  if (match.kind === "reading") return `r|${match.eum}`;
  return `c|${match.canonical}`;
}

/** Interpretation 1: the Dubeolsik reading of the typed letters. */
function dubeolsikInterpretation(raw, data) {
  const to = qwertyToHangul(raw);
  if (to === "" || to === raw) return null;
  const matches = buildMatches(to, data);
  return matches.length === 0 ? null : { kind: "dubeolsik", from: raw, to, matches };
}

/**
 * Interpretation 2: the romanization reading. Every candidate hangul the rr
 * index offers runs the NORMAL lookup — a word candidate takes the word path,
 * a single syllable takes the reading path — and the results merge in
 * candidate order (i.e. rr.json's frequency order), deduped.
 */
function rrInterpretation(raw, data) {
  const candidates = rrCandidates(romanizationVariants(raw), data && data.rr);
  const matches = [];
  const seen = new Set();
  let to = "";
  for (const candidate of candidates) {
    let contributed = false;
    for (const match of buildMatches(candidate, data)) {
      const key = matchKey(match);
      if (seen.has(key)) continue;
      seen.add(key);
      matches.push(match);
      contributed = true;
    }
    // `to` names the mapping the UI shows ("su → 수"), so it is the first
    // candidate that actually explained something, not merely the first key.
    if (contributed && to === "") to = candidate;
  }
  return matches.length === 0 ? null : { kind: "rr", from: raw, to, matches };
}

/** True when an interpretation found real words (not just a reading list). */
function hasWordMatches(interp) {
  return interp.matches.some((m) => m.kind === "word");
}

/**
 * The best (lowest) frequency bucket among an interpretation's word matches.
 * `f` lives on the words.json entry, not on the match, so it is read back
 * here; unranked entries sort last.
 */
function bestFrequency(interp, wordTable) {
  let best = Infinity;
  for (const match of interp.matches) {
    if (match.kind !== "word" || !hasOwn(wordTable, match.canonical)) continue;
    const entries = wordTable[match.canonical];
    for (const entry of Array.isArray(entries) ? entries : [entries]) {
      if (entry && Number.isInteger(entry.f) && entry.f < best) best = entry.f;
    }
  }
  return best;
}

/**
 * The prominence of a reading-only interpretation: the best compound count
 * among its candidates. Read as the parallel of the `f` rule above — the best
 * value the side has to offer — because the reading list's own order is
 * ranked by a saturating proxy (the truncated `compounds` array) and so says
 * little about which reading a typist meant.
 */
function bestCompoundCount(interp, charTable) {
  let best = -1;
  for (const match of interp.matches) {
    if (match.kind !== "reading" || !Array.isArray(match.candidates)) continue;
    for (const candidate of match.candidates) {
      const entry = hasOwn(charTable, candidate.char) ? charTable[candidate.char] : null;
      const count = entry && Array.isArray(entry.cw) ? entry.cw.length : 0;
      if (count > best) best = count;
    }
  }
  return best;
}

/**
 * Two surviving interpretations, ordered preferred-first. A word
 * interpretation beats a syllable-only one; word vs word compares the best
 * `f`; reading vs reading compares the best compound count; a remaining tie
 * goes to Dubeolsik, which is the older, more deliberate gesture.
 */
function orderPair(dubeolsik, rr, data) {
  const wordTable = (data && data.words && data.words.words) || {};
  const charTable = (data && data.hanja && data.hanja.chars) || {};
  const dw = hasWordMatches(dubeolsik);
  const rw = hasWordMatches(rr);
  if (dw !== rw) return dw ? [dubeolsik, rr] : [rr, dubeolsik];
  if (dw) {
    const df = bestFrequency(dubeolsik, wordTable);
    const rf = bestFrequency(rr, wordTable);
    if (df !== rf) return df < rf ? [dubeolsik, rr] : [rr, dubeolsik];
  } else {
    const dc = bestCompoundCount(dubeolsik, charTable);
    const rc = bestCompoundCount(rr, charTable);
    if (dc !== rc) return dc > rc ? [dubeolsik, rr] : [rr, dubeolsik];
  }
  return [dubeolsik, rr];
}

/**
 * Run both interpreters over a query, dropping the ones that found nothing.
 *
 * @param {string} text raw query (trimming/NFC handled here)
 * @param {object} data parsed data bundle, including `rr`
 * @returns {Array<{kind:string, from:string, to:string, matches:object[]}>}
 *          zero, one or two interpretations, preferred first
 */
export function buildInterpretations(text, data) {
  const raw = normalize(text).trim();
  if (!isLatinQuery(raw)) return [];
  const dubeolsik = dubeolsikInterpretation(raw, data);
  const rr = rrInterpretation(raw, data);
  if (dubeolsik === null) return rr === null ? [] : [rr];
  if (rr === null) return [dubeolsik];
  return orderPair(dubeolsik, rr, data);
}

/**
 * Flatten interpretations into the response's `matches` plus the
 * `interpretations` descriptor, where `start` is the index in `matches` at
 * which each group begins.
 */
function flattenInterpretations(interps) {
  const matches = [];
  const descriptors = [];
  for (const interp of interps) {
    descriptors.push({
      kind: interp.kind,
      from: interp.from,
      to: interp.to,
      start: matches.length,
    });
    matches.push(...interp.matches);
  }
  return { matches, interpretations: descriptors };
}

/**
 * Full lookup, returning the SPEC "Message protocol" response envelope.
 * Never throws.
 *
 * @param {string} text raw query or selection
 * @param {object} data parsed data bundle
 * @param {{interpret?:boolean}} [options] `interpret: true` opts the call into
 *        the two interpreters above. Absent (every internal navigation) means
 *        a literal lookup, so Latin text matches nothing.
 */
export function lookup(text, data, options) {
  try {
    const interpret = options !== null && typeof options === "object" && options.interpret === true;
    if (interpret) {
      const interps = buildInterpretations(text, data);
      if (interps.length > 0) return { ok: true, ...flattenInterpretations(interps) };
    }
    return { ok: true, matches: buildMatches(text, data) };
  } catch (err) {
    return { ok: false, error: toErrorMessage(err) };
  }
}

/** Normalize any thrown value into a message string. */
export function toErrorMessage(err) {
  if (err && typeof err.message === "string" && err.message) return err.message;
  return String(err);
}

/* ---------------------------------------------------------------------------
 * Search popup ADDENDUM (1.1) — omnibox suggestions.
 *
 * Pure: background.js supplies the parsed data and hands the result straight to
 * chrome.omnibox's suggest(). Nothing here touches chrome.*.
 * ------------------------------------------------------------------------- */

/** Omnibox shows a handful of rows; SPEC caps us at 5. */
export const MAX_OMNIBOX_SUGGESTIONS = 5;

/** Separator between the pieces of a suggestion's dimmed tail. */
const DIM_SEPARATOR = " · ";

const XML_ESCAPES = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&apos;",
};

/**
 * Escape dynamic text for the omnibox description's XML mini-format. The only
 * unescaped angle brackets in a description are the <match>/<dim> tags this
 * module emits itself; every gloss, hun, eum and spelling goes through here.
 * `content` is NEVER escaped — it round-trips into onInputEntered as typed.
 */
function escapeXml(text) {
  return typeof text === "string" ? text.replace(/[&<>"']/g, (ch) => XML_ESCAPES[ch]) : "";
}

/** ` <dim>a · b</dim>` for the non-empty pieces, or "" when there are none. */
function dimTail(pieces) {
  const kept = pieces.filter((p) => typeof p === "string" && p !== "");
  return kept.length === 0 ? "" : ` <dim>${escapeXml(kept.join(DIM_SEPARATOR))}</dim>`;
}

/** `<match>頭</match> plain <dim>tail</dim>` with everything dynamic escaped. */
function describe(head, plain, dimPieces) {
  const mid = typeof plain === "string" && plain !== "" ? ` ${escapeXml(plain)}` : "";
  return `<match>${escapeXml(head)}</match>${mid}${dimTail(dimPieces)}`;
}

/**
 * lvl ADDENDUM: short school-level labels for the dimmed omnibox tail. Only
 * the curriculum levels say anything useful in one word here; `a` and `r`
 * contribute nothing (the popup's level chip carries the full taxonomy).
 */
const OMNIBOX_LEVEL_LABEL = { m: "중학", h: "고교" };

/** One row for a hanja character (char match or reading-browse candidate). */
function charSuggestion(char, hun, eum, gloss, lvl) {
  const reading = [hun, eum].filter((s) => typeof s === "string" && s !== "").join(" ");
  return {
    content: char,
    description: describe(char, reading, [gloss, OMNIBOX_LEVEL_LABEL[lvl] || ""]),
  };
}

/**
 * Up to 5 omnibox suggestions for a typed query, reusing buildMatches so the
 * omnibox and the popup always agree on what the input means.
 *
 * Order: word matches (non-rare first, rare last), then the reading-browse
 * candidates of a single hangul syllable, then character matches. Each row's
 * `content` is the candidate's own canonical searchable string — the canonical
 * hanja spelling for a word, the canonical character for a char/reading row —
 * so re-entering it through onInputEntered lands on the same result.
 *
 * Never throws: junk data yields [].
 *
 * @param {string} text raw omnibox input
 * @param {{hanja?:object, words?:object, variants?:object, rr?:object}} data parsed data files
 * @param {{interpret?:boolean}} [options] same input-channel rule as lookup();
 *        the omnibox IS a typed channel, so background.js passes it.
 * @returns {Array<{content:string, description:string}>}
 */
export function buildOmniboxSuggestions(text, data, options) {
  try {
    // Same generators and ordering as lookup(): `hj toddlf` suggests 생일's
    // entries, `hj gukmin` suggests 국민's. Each row's `content` stays the
    // candidate's canonical searchable string, so the suggestion the user
    // picks re-enters as hanja, not as what they typed.
    const interpret =
      options !== null && typeof options === "object" && options.interpret === true;
    const interps = interpret ? buildInterpretations(text, data) : [];
    const groups =
      interps.length > 0
        ? interps.map((i) => i.matches)
        : [buildMatches(text, data)];

    // Ordering applies WITHIN a group, so the preferred interpretation's rows
    // stay ahead of the other's.
    const rows = [];
    for (const matches of groups) {
      const words = matches.filter((m) => m.kind === "word");
      rows.push(
        // Rare-flagged spellings rank last across the whole query, not just
        // within one hangul span (buildMatches only orders within a span).
        ...words.filter((m) => m.rare !== true),
        ...words.filter((m) => m.rare === true),
        ...matches.filter((m) => m.kind === "reading"),
        ...matches.filter((m) => m.kind === "char")
      );
    }

    const suggestions = [];
    const seen = new Set();
    const push = (suggestion) => {
      if (suggestion === null || seen.has(suggestion.content)) return;
      seen.add(suggestion.content);
      suggestions.push(suggestion);
    };

    for (const match of rows) {
      if (suggestions.length >= MAX_OMNIBOX_SUGGESTIONS) break;
      if (match.kind === "word") {
        const gloss = Array.isArray(match.glosses) ? match.glosses[0] : "";
        push({
          content: match.canonical,
          description: describe(match.canonical, match.hangul, [
            gloss,
            match.rare === true ? "rare" : "",
          ]),
        });
      } else if (match.kind === "char") {
        const pair = Array.isArray(match.eumhun) ? match.eumhun[0] : null;
        const gloss = Array.isArray(match.glosses) ? match.glosses[0] : "";
        push(
          charSuggestion(
            match.canonical,
            pair && typeof pair.hun === "string" ? pair.hun : "",
            pair && typeof pair.eum === "string" ? pair.eum : "",
            gloss,
            match.lvl
          )
        );
      } else if (match.kind === "reading" && Array.isArray(match.candidates)) {
        // The syllable itself is already the default suggestion ("search for
        // %s" opens the browse), so the rows here are the individual hanja.
        for (const c of match.candidates) {
          if (suggestions.length >= MAX_OMNIBOX_SUGGESTIONS) break;
          if (!c || typeof c.char !== "string" || c.char === "") continue;
          push(charSuggestion(c.char, c.hun, c.eum, c.gloss, c.lvl));
        }
      }
    }

    return suggestions.slice(0, MAX_OMNIBOX_SUGGESTIONS);
  } catch {
    return [];
  }
}
