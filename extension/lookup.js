/**
 * Etymikon: pure lookup logic.
 *
 * This module deliberately contains NO chrome.* API usage so that it can be
 * imported and unit-tested in plain Node (see test/lookup.test.mjs).
 * All chrome glue lives in background.js.
 *
 * Implements SPEC.md "Service worker lookup behavior" rules 1-4, the tier
 * function, the root/family builders and the omnibox suggestions.
 */

/** Rule 1: the selected text is cut to this many characters before lookup. */
export const MAX_TOKEN_CHARS = 40;

/**
 * Rule 1: the first token of letters, apostrophes and hyphens. Anchored
 * nowhere, so a selection that starts with punctuation or a space still finds
 * its word. A trailing hyphen or apostrophe is kept: the pattern is the SPEC's
 * verbatim, and a key that ends in one simply never matches words.json.
 */
export const TOKEN_PATTERN = /[A-Za-z][A-Za-z'-]*/;

/**
 * Rule 3: a suffix rule never proposes a one-letter lemma. Stripping the s of
 * "as" would otherwise land on "a", which is a shipped word and a wrong answer.
 */
export const MIN_LEMMA_CHARS = 2;

/** Root cards render this many family rows before the pagination row. */
export const FAMILY_PREVIEW = 8;

/**
 * One `{type:"family"}` request answers with at most this many rows. Germanic
 * affix families run to five figures (en:-ly builds 14,335 shipped words,
 * about 1 MB serialized), so the list travels in chunks rather than whole.
 */
export const FAMILY_CHUNK = 200;

/** Omnibox shows a handful of rows; SPEC caps us at 5. */
export const MAX_OMNIBOX_SUGGESTIONS = 5;

/**
 * The word tiers, by frequency rank. THE ONE PLACE these cutoffs exist: the
 * response carries the derived tier so no surface has to hold a copy of them.
 * A rank is Everyday up to and including 3000, Common up to 15000, Advanced up
 * to 50000, Rare beyond that and when the word is unranked.
 */
export const TIER_CUTOFFS = Object.freeze({
  everyday: 3000,
  common: 15000,
  advanced: 50000,
});

/** Display names of the four tiers, for the exporters and the chips. */
export const TIER_LABELS = Object.freeze({
  everyday: "Everyday",
  common: "Common",
  advanced: "Advanced",
  rare: "Rare",
});

const hasOwn = (obj, key) =>
  obj !== null && obj !== undefined &&
  Object.prototype.hasOwnProperty.call(obj, key);

/** words.json `words` table of a parsed bundle. */
function wordTableOf(data) {
  return (data && data.words && data.words.words) || {};
}

/** roots.json `roots` table of a parsed bundle. */
function rootTableOf(data) {
  return (data && data.roots && data.roots.roots) || {};
}

/** forms.json `map` table of a parsed bundle. */
function formMapOf(data) {
  return (data && data.forms && data.forms.map) || {};
}

/** A string field of an entry, or "" when the field is missing or junk. */
function str(value) {
  return typeof value === "string" ? value : "";
}

/**
 * Rule 1: trim, take the first token, cap it. Anything that holds no letter at
 * all yields "", which every caller reads as "no match".
 */
export function extractToken(text) {
  if (typeof text !== "string") return "";
  const found = TOKEN_PATTERN.exec(text.trim());
  return found === null ? "" : found[0].slice(0, MAX_TOKEN_CHARS);
}

/**
 * Rule 2: lookup keys are lowercase. The token keeps its selected casing as
 * the match's `surface`, so the card can say "Subterranean" while the data is
 * keyed "subterranean".
 */
export function fold(token) {
  return typeof token === "string" ? token.toLowerCase() : "";
}

/**
 * The tier for a frequency rank. Unranked words (no `fr`) and anything past
 * the last cutoff are Rare. Reads TIER_CUTOFFS, which is the only copy.
 */
export function tierOf(fr) {
  if (!Number.isInteger(fr) || fr <= 0) return "rare";
  if (fr <= TIER_CUTOFFS.everyday) return "everyday";
  if (fr <= TIER_CUTOFFS.common) return "common";
  if (fr <= TIER_CUTOFFS.advanced) return "advanced";
  return "rare";
}

/** Consonants for the doubled-consonant repair. */
const CONSONANT = /[bcdfghjklmnpqrstvwxz]/;

/**
 * Doubled-consonant repair: "runn" from "running" becomes "run", "stopp" from
 * "stopped" becomes "stop". Returns null when the stem does not end in a
 * doubled consonant, so the caller can skip the candidate.
 */
function undouble(stem) {
  if (stem.length < 3) return null;
  const last = stem[stem.length - 1];
  return last === stem[stem.length - 2] && CONSONANT.test(last)
    ? stem.slice(0, -1)
    : null;
}

/**
 * Dropped-e repair: "hop" from "hoping" becomes "hope". Always proposed, and
 * always last, so a stem that is itself a shipped word wins first.
 */
function restoreE(stem) {
  return `${stem}e`;
}

/** The candidate lemmas of a verbal or comparative suffix, in trial order. */
function stemCandidates(word, cut) {
  const stem = word.slice(0, -cut);
  return [stem, undouble(stem), restoreE(stem)];
}

/**
 * Rule 3: the suffix rules, in SPEC order. The first rule whose candidates
 * reach a shipped word wins, and within a rule the candidates are tried in
 * order: the plain stem, then the doubled-consonant repair, then the
 * dropped-e repair. The repairs fire only where the plain stem missed, which
 * is what "repair" means here.
 *
 * These are the fallback for forms.json misses, not a lemmatizer. The map
 * carries every harvested inflection, so a rule only ever sees what Wiktionary
 * did not record.
 */
export const SUFFIX_RULES = [
  { name: "s", apply: (w) => (w.endsWith("s") ? [w.slice(0, -1)] : []) },
  { name: "es", apply: (w) => (w.endsWith("es") ? [w.slice(0, -2)] : []) },
  { name: "ies", apply: (w) => (w.endsWith("ies") ? [`${w.slice(0, -3)}y`] : []) },
  { name: "ed", apply: (w) => (w.endsWith("ed") ? stemCandidates(w, 2) : []) },
  { name: "ing", apply: (w) => (w.endsWith("ing") ? stemCandidates(w, 3) : []) },
  { name: "er", apply: (w) => (w.endsWith("er") ? stemCandidates(w, 2) : []) },
  { name: "est", apply: (w) => (w.endsWith("est") ? stemCandidates(w, 3) : []) },
];

/**
 * Rules 1 to 3, the ONE resolve function. Everything that needs to turn text
 * into a words.json key goes through here, so the token rule, the case rule
 * and the inflection rules can never drift apart between callers.
 *
 * @param {string} text raw selection or typed query
 * @param {object} data parsed data bundle
 * @returns {{surface:string, canonical:string, formOf?:{surface:string, lemma:string}}|null}
 */
export function resolve(text, data) {
  const surface = extractToken(text);
  if (surface === "") return null;
  const folded = fold(surface);
  const words = wordTableOf(data);

  if (hasOwn(words, folded)) return { surface, canonical: folded };

  const mapped = formMapOf(data)[folded];
  if (typeof mapped === "string" && hasOwn(words, mapped)) {
    return { surface, canonical: mapped, formOf: { surface: folded, lemma: mapped } };
  }

  for (const rule of SUFFIX_RULES) {
    for (const candidate of rule.apply(folded)) {
      if (typeof candidate !== "string" || candidate.length < MIN_LEMMA_CHARS) continue;
      if (!hasOwn(words, candidate)) continue;
      return {
        surface,
        canonical: candidate,
        formOf: { surface: folded, lemma: candidate },
      };
    }
  }

  return null;
}

/** One POS section, copied field by field so junk data cannot reach the card. */
function senseRow(sense) {
  const defs = (Array.isArray(sense.defs) ? sense.defs : []).filter(
    (def) => typeof def === "string" && def !== ""
  );
  return { pos: str(sense.pos), defs };
}

/** The senses of a words.json entry, as the response carries them. */
function sensesOf(entry) {
  return (Array.isArray(entry.senses) ? entry.senses : [])
    .filter((sense) => sense !== null && typeof sense === "object")
    .map(senseRow);
}

/** The first definition of a words.json entry, or "" when it has none. */
export function firstDef(entry) {
  for (const sense of Array.isArray(entry && entry.senses) ? entry.senses : []) {
    if (sense === null || typeof sense !== "object") continue;
    for (const def of Array.isArray(sense.defs) ? sense.defs : []) {
      if (typeof def === "string" && def !== "") return def;
    }
  }
  return "";
}

/**
 * Join one morpheme against the data. The content script reads neither
 * roots.json nor the rest of words.json, so the gloss travels with the chip:
 * an `r` chip carries its root's gloss, a `w` chip carries that word's first
 * definition. The link field passes through so the renderer knows which card
 * the chip opens.
 *
 * A morph whose target did not ship comes back as `{f}` alone and renders
 * inert, which is also what a morph with no link field at all gets. `r` is
 * checked first: the data never carries both, and a bundle that does gets the
 * root card rather than two link fields on one chip.
 */
function morphRow(morph, roots, wordTable) {
  const row = { f: str(morph.f) };
  const rootKey = str(morph.r);
  if (rootKey !== "" && hasOwn(roots, rootKey)) {
    row.r = rootKey;
    const gloss = str(roots[rootKey].gloss);
    if (gloss !== "") row.gloss = gloss;
    return row;
  }
  const wordKey = str(morph.w);
  if (wordKey !== "" && hasOwn(wordTable, wordKey)) {
    row.w = wordKey;
    const gloss = firstDef(wordTable[wordKey]);
    if (gloss !== "") row.gloss = gloss;
  }
  return row;
}

/** The origin row of an `org` word, joined the same way a morph chip is. */
function originRow(org, roots) {
  const key = str(org.r);
  if (key === "" || !hasOwn(roots, key)) return null;
  const row = { r: key, f: str(org.f) || str(roots[key].form) };
  const gloss = str(roots[key].gloss);
  if (gloss !== "") row.gloss = gloss;
  return row;
}

/**
 * The word match for a resolved key. `tier` rides along with `fr` because the
 * cutoffs live in this module alone and the renderer is a classic script that
 * cannot import them.
 */
function buildWordMatch(resolved, data) {
  const table = wordTableOf(data);
  const entry = table[resolved.canonical];
  const roots = rootTableOf(data);
  const match = {
    kind: "word",
    surface: resolved.surface,
    canonical: resolved.canonical,
    senses: sensesOf(entry),
    tier: tierOf(entry.fr),
  };
  if (resolved.formOf) match.formOf = resolved.formOf;
  if (Number.isInteger(entry.fr) && entry.fr > 0) match.fr = entry.fr;

  const morphs = (Array.isArray(entry.morphs) ? entry.morphs : [])
    .filter((morph) => morph !== null && typeof morph === "object")
    .map((morph) => morphRow(morph, roots, table))
    .filter((row) => row.f !== "");
  if (morphs.length > 0) match.morphs = morphs;

  // A word never carries both morphs and org (data invariant), so the guard
  // costs nothing and keeps a bad bundle from rendering two breakdowns.
  if (morphs.length === 0 && entry.org !== null && typeof entry.org === "object") {
    const org = originRow(entry.org, roots);
    if (org !== null) match.org = org;
  }

  // The shadow-entry row: "ran" ships as a word on a marginal noun sense and
  // shadows "run" at lookup time, so the card hands the reader a way to the
  // lemma. Dropped when that lemma is gone from the bundle, and when a bad
  // bundle points a word at itself, since either would render a row leading
  // nowhere useful.
  const seeAlso = str(entry.fo);
  if (seeAlso !== "" && seeAlso !== resolved.canonical && hasOwn(table, seeAlso)) {
    match.seeAlso = seeAlso;
  }
  return match;
}

/**
 * Build the `matches` array for a selection. At most one word match exists,
 * but the array shape is what every surface consumes, so it stays an array.
 *
 * @param {string} text raw selected text or typed query
 * @param {object} data parsed data files
 * @returns {Array<object>} matches (possibly empty)
 */
export function buildMatches(text, data) {
  const resolved = resolve(text, data);
  if (resolved === null) return [];
  return [buildWordMatch(resolved, data)];
}

/**
 * Full lookup, returning the SPEC "Message protocol" response envelope.
 * Never throws.
 */
export function lookup(text, data) {
  try {
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
 * Roots and families.
 *
 * The family list is DERIVED from words.json and stored nowhere. A pipeline
 * change to a word's morphs changes the families on the next worker start with
 * no other work, which is the binding architectural rule carried over from
 * Okpyeon's recomposition index.
 * ------------------------------------------------------------------------- */

/** The rank a word sorts by: its `fr`, with unranked words sorting last. */
function rankOf(entry) {
  return entry && Number.isInteger(entry.fr) && entry.fr > 0 ? entry.fr : Infinity;
}

/**
 * Derive the root-to-words index from words.json. Both reference kinds count:
 * a `morphs[].r` chip and an `org.r` chain. A `morphs[].w` chip names another
 * word rather than a root, so it credits nothing here. A word credits a root
 * once even when two of its morphs name it.
 *
 * Ranked by `fr` ascending, unranked last, ties by key.
 *
 * @param {object} wordsFile parsed words.json
 * @returns {Record<string, string[]>} root key -> word keys, ranked
 */
export function buildFamilyIndex(wordsFile) {
  const table = (wordsFile && wordsFile.words) || {};
  /** @type {Record<string, string[]>} */
  const index = Object.create(null);

  for (const word of Object.keys(table)) {
    const entry = table[word];
    if (entry === null || typeof entry !== "object") continue;
    const credited = new Set();
    const credit = (value) => {
      const key = str(value);
      if (key === "" || credited.has(key)) return;
      credited.add(key);
      if (index[key] === undefined) index[key] = [];
      index[key].push(word);
    };
    for (const morph of Array.isArray(entry.morphs) ? entry.morphs : []) {
      if (morph !== null && typeof morph === "object") credit(morph.r);
    }
    if (entry.org !== null && typeof entry.org === "object") credit(entry.org.r);
  }

  for (const key of Object.keys(index)) {
    index[key].sort((a, b) => {
      const diff = rankOf(table[a]) - rankOf(table[b]);
      if (diff !== 0) return diff;
      return a < b ? -1 : a > b ? 1 : 0;
    });
  }
  return index;
}

/** One family row: the word, its first def, its rank and its tier. */
function familyRow(word, table) {
  const entry = table[word];
  const row = { word, def: firstDef(entry), tier: tierOf(entry.fr) };
  if (Number.isInteger(entry.fr) && entry.fr > 0) row.fr = entry.fr;
  return row;
}

/** The ranked family of a root key, skipping words the bundle no longer has. */
function familyOf(key, data, familyIndex) {
  const table = wordTableOf(data);
  const list = hasOwn(familyIndex, key) ? familyIndex[key] : [];
  return (Array.isArray(list) ? list : []).filter((word) => hasOwn(table, word));
}

/**
 * The `{type:"root"}` response body: the card's own fields plus the first
 * FAMILY_PREVIEW family rows and the full count behind them.
 *
 * @returns {object|null} null for an unknown key
 */
export function buildRoot(key, data, familyIndex) {
  const roots = rootTableOf(data);
  if (typeof key !== "string" || !hasOwn(roots, key)) return null;
  const entry = roots[key];
  const table = wordTableOf(data);
  const words = familyOf(key, data, familyIndex || {});

  const root = {
    key,
    form: str(entry.form),
    lang: str(entry.lang) || key.split(":")[0],
    gloss: str(entry.gloss),
    kind: str(entry.kind) || "root",
    familyCount: words.length,
    family: words.slice(0, FAMILY_PREVIEW).map((word) => familyRow(word, table)),
  };
  // Greek forms show their romanization beside the form.
  const rom = str(entry.rom);
  if (rom !== "") root.rom = rom;
  // The source lemma of an English affix, joined like a morph chip so the row
  // never navigates to a card that did not ship.
  const src = str(entry.src);
  if (src !== "" && hasOwn(roots, src)) {
    root.src = { r: src, f: str(roots[src].form) };
    const gloss = str(roots[src].gloss);
    if (gloss !== "") root.src.gloss = gloss;
  }
  return root;
}

/**
 * The `{type:"family"}` response body: ONE CHUNK of the ranked list, in the
 * row shape the preview uses, plus the full `total` behind it and the offset
 * the chunk starts at. The card pages locally inside a chunk and asks for the
 * next one only when its local rows run out.
 *
 * An offset past the end is not an error: it answers with no rows and the
 * same total, which is what a card that paged to the end sees.
 *
 * @returns {{rows:object[], total:number, offset:number}}
 */
export function buildFamily(key, data, familyIndex, offset) {
  const start = Number.isInteger(offset) && offset > 0 ? offset : 0;
  const roots = rootTableOf(data);
  if (typeof key !== "string" || !hasOwn(roots, key)) {
    return { rows: [], total: 0, offset: start };
  }
  const table = wordTableOf(data);
  const words = familyOf(key, data, familyIndex || {});
  return {
    rows: words.slice(start, start + FAMILY_CHUNK).map((word) => familyRow(word, table)),
    total: words.length,
    offset: start,
  };
}

/**
 * A root's label line in plain English: "Latin root", "Greek root", "Prefix",
 * "Suffix". Lives here so the card and the Anki export cannot disagree.
 */
export function rootLabel(lang, kind) {
  if (kind === "prefix") return "Prefix";
  if (kind === "suffix") return "Suffix";
  if (lang === "la") return "Latin root";
  if (lang === "grc") return "Greek root";
  return "English root";
}

/* ---------------------------------------------------------------------------
 * Omnibox suggestions.
 *
 * Pure: background.js supplies the parsed data and hands the result straight to
 * chrome.omnibox's suggest(). Nothing here touches chrome.*.
 * ------------------------------------------------------------------------- */

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
 * module emits itself; every word, gloss and definition goes through here.
 * `content` is NEVER escaped, since it round-trips into onInputEntered as typed.
 */
function escapeXml(text) {
  return typeof text === "string" ? text.replace(/[&<>"']/g, (ch) => XML_ESCAPES[ch]) : "";
}

/** ` <dim>a · b</dim>` for the non-empty pieces, or "" when there are none. */
function dimTail(pieces) {
  const kept = pieces.filter((p) => typeof p === "string" && p !== "");
  return kept.length === 0 ? "" : ` <dim>${escapeXml(kept.join(DIM_SEPARATOR))}</dim>`;
}

/** `<match>terra</match> plain <dim>tail</dim>` with everything dynamic escaped. */
function describe(head, plain, dimPieces) {
  const mid = typeof plain === "string" && plain !== "" ? ` ${escapeXml(plain)}` : "";
  return `<match>${escapeXml(head)}</match>${mid}${dimTail(dimPieces)}`;
}

/** The prefix an omnibox query matches on: trimmed and case folded, as typed. */
function omniboxPrefix(text) {
  return typeof text === "string" ? fold(text.trim()) : "";
}

/** Word keys starting with the prefix, ranked by `fr` then key. */
function wordPrefixMatches(prefix, table) {
  const hits = Object.keys(table).filter((word) => word.startsWith(prefix));
  hits.sort((a, b) => {
    const diff = rankOf(table[a]) - rankOf(table[b]);
    if (diff !== 0) return diff;
    return a < b ? -1 : a > b ? 1 : 0;
  });
  return hits;
}

/**
 * Root keys whose form starts with the prefix, ranked by family size then key.
 * `alt` forms match too, since they are the same card under another surface.
 */
function rootPrefixMatches(prefix, roots, familyIndex) {
  const size = (key) => (hasOwn(familyIndex, key) ? familyIndex[key].length : 0);
  const hits = Object.keys(roots).filter((key) => {
    const entry = roots[key];
    if (entry === null || typeof entry !== "object") return false;
    const forms = [entry.form, ...(Array.isArray(entry.alt) ? entry.alt : [])];
    return forms.some((form) => typeof form === "string" && fold(form).startsWith(prefix));
  });
  hits.sort((a, b) => {
    const diff = size(b) - size(a);
    if (diff !== 0) return diff;
    return a < b ? -1 : a > b ? 1 : 0;
  });
  return hits;
}

/**
 * Up to 5 omnibox suggestions for a typed query: word keys first, then root
 * forms. Each row's `content` is the canonical key of the thing it names, so
 * re-entering it through onInputEntered lands on the same card. Word rows
 * therefore carry a word key and root rows carry a `<lang>:<form>` root key.
 *
 * The query is matched as a raw prefix rather than through the token rule, so
 * an affix form such as "-an" or "sub-" still finds its card.
 *
 * Never throws: junk data yields [].
 *
 * @param {string} text raw omnibox input
 * @param {{words?:object, roots?:object, familyIndex?:object}} data parsed bundle
 * @returns {Array<{content:string, description:string}>}
 */
export function buildOmniboxSuggestions(text, data) {
  try {
    const prefix = omniboxPrefix(text);
    if (prefix === "") return [];
    const table = wordTableOf(data);
    const roots = rootTableOf(data);
    const familyIndex =
      (data && data.familyIndex) || buildFamilyIndex(data && data.words);

    const rows = [];
    for (const word of wordPrefixMatches(prefix, table)) {
      if (rows.length >= MAX_OMNIBOX_SUGGESTIONS) break;
      rows.push({
        content: word,
        description: describe(word, "", [firstDef(table[word])]),
      });
    }
    for (const key of rootPrefixMatches(prefix, roots, familyIndex)) {
      if (rows.length >= MAX_OMNIBOX_SUGGESTIONS) break;
      const entry = roots[key];
      rows.push({
        content: key,
        description: describe(str(entry.form) || key, rootLabel(str(entry.lang), str(entry.kind)), [
          str(entry.gloss),
        ]),
      });
    }
    return rows.slice(0, MAX_OMNIBOX_SUGGESTIONS);
  } catch {
    return [];
  }
}
