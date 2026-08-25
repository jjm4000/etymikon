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
 * affix families run to four figures (en:-ly builds about 4,000 shipped
 * words; the exact count moves with each data build), so the list travels
 * in chunks rather than whole.
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
 * Rule 1: normalize, trim, take the first token, cap it. Anything that holds no
 * letter at all yields "", which every caller reads as "no match".
 *
 * The NFC pass runs BEFORE the pattern so a decomposed accented letter cannot
 * masquerade as the bare ASCII letter it starts with: composed, "é" is not a
 * token character at all; decomposed, its "e" would have been one.
 */
export function extractToken(text) {
  if (typeof text !== "string") return "";
  const found = TOKEN_PATTERN.exec(text.normalize("NFC").trim());
  return found === null ? "" : found[0].slice(0, MAX_TOKEN_CHARS);
}

/**
 * Rule 2, THE fold: NFC-normalize, then lowercase. Every boundary runs it, and
 * they all run this one function: token extraction, omnibox input, the root
 * keys arriving in messages, and the saved-item keys in saved.js. NFC is what
 * makes an NFD keyboard reach the 110 Greek root keys, which are stored
 * composed like everything else the pipeline emits.
 *
 * The token keeps its selected casing as the match's `surface`, so the card can
 * say "Subterranean" while the data is keyed "subterranean".
 */
export function fold(token) {
  return typeof token === "string" ? token.normalize("NFC").toLowerCase() : "";
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
 * The tier fields every word row carries: the derived tier and its display
 * label. Both are joined here because the cutoffs and the label map live in
 * this module alone and the renderer is a classic script that cannot import
 * them. A surface reads `tierLabel` and never holds a copy of the map.
 */
function tierFields(fr) {
  const tier = tierOf(fr);
  return { tier, tierLabel: TIER_LABELS[tier] };
}

/** The word match for a resolved key. */
function buildWordMatch(resolved, data) {
  const table = wordTableOf(data);
  const entry = table[resolved.canonical];
  const roots = rootTableOf(data);
  const match = {
    kind: "word",
    surface: resolved.surface,
    canonical: resolved.canonical,
    senses: sensesOf(entry),
    ...tierFields(entry.fr),
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
 * The root keys one entry credits, each at most once. Both reference kinds
 * count: a `morphs[].r` chip and an `org.r` chain. A `morphs[].w` chip names
 * another word rather than a root, so it credits nothing. A word credits a root
 * once even when two of its morphs name it, which is the same rule the build's
 * threshold applies.
 */
function creditedRoots(entry) {
  const keys = new Set();
  for (const morph of Array.isArray(entry.morphs) ? entry.morphs : []) {
    if (morph === null || typeof morph !== "object") continue;
    const key = str(morph.r);
    if (key !== "") keys.add(key);
  }
  if (entry.org !== null && typeof entry.org === "object") {
    const key = str(entry.org.r);
    if (key !== "") keys.add(key);
  }
  return keys;
}

/**
 * Derive the root-to-words index from words.json, ranked by `fr` ascending,
 * unranked last, ties by key.
 *
 * This is the expensive one (31 ms and 65 MB of allocation over 76,496 words,
 * measured 2026-08-24), so it builds only where a ranked LIST is rendered: a
 * root card, a family chunk, a saved root row. Anything that needs only the
 * sizes takes buildFamilyCounts instead.
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
    for (const key of creditedRoots(entry)) {
      if (index[key] === undefined) index[key] = [];
      index[key].push(word);
    }
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

/**
 * How many words each root builds, with no ranked lists behind it: one pass,
 * one number per key, no per-root array and no sort. The omnibox rows rank by
 * family SIZE, so this is all they ever needed.
 *
 * Counts the same way buildFamilyIndex does, so a size read here and a
 * `familyCount` read from the index can never disagree.
 *
 * @param {object} wordsFile parsed words.json
 * @returns {Record<string, number>} root key -> family size
 */
export function buildFamilyCounts(wordsFile) {
  const table = (wordsFile && wordsFile.words) || {};
  /** @type {Record<string, number>} */
  const counts = Object.create(null);
  for (const word of Object.keys(table)) {
    const entry = table[word];
    if (entry === null || typeof entry !== "object") continue;
    for (const key of creditedRoots(entry)) {
      counts[key] = (counts[key] || 0) + 1;
    }
  }
  return counts;
}

/** One family row: the word, its first def, its rank and its tier fields. */
function familyRow(word, table) {
  const found = table[word];
  const entry = found !== null && typeof found === "object" ? found : {};
  const row = { word, def: firstDef(entry), ...tierFields(entry.fr) };
  if (Number.isInteger(entry.fr) && entry.fr > 0) row.fr = entry.fr;
  return row;
}

/**
 * The ranked family of a root key: the index entry itself, never a copy. The
 * index derives from the same word table the rows are read from, so a filter
 * against that table dropped 0 of 53,229 entries (measured 2026-08-24) and
 * copied the whole family on every chunk request to do it.
 */
function familyOf(key, familyIndex) {
  const list = familyIndex !== null && typeof familyIndex === "object"
    ? familyIndex[key]
    : undefined;
  return Array.isArray(list) ? list : [];
}

/**
 * Rule 2 at the root-card boundary: the key a surface sends is folded exactly
 * like a word, so an NFD key typed at a keyboard reaches the composed key the
 * pipeline emitted. The raw key is tried first, so a bundle whose keys are not
 * themselves fold-stable still answers for its own keys.
 *
 * @returns {string} the shipped key, or "" when nothing matches
 */
function rootKeyOf(key, roots) {
  if (typeof key !== "string" || key === "") return "";
  if (hasOwn(roots, key)) return key;
  const folded = fold(key);
  return hasOwn(roots, folded) ? folded : "";
}

/** The language of a root card: its own field, else the key's prefix. */
function rootLangOf(key, entry) {
  return str(entry.lang) || String(key).split(":")[0];
}

/**
 * The `{type:"root"}` response body: the card's own fields plus the first
 * FAMILY_PREVIEW family rows and the full count behind them. `label` is the
 * joined label line, so no surface holds a second copy of the label rules.
 *
 * @returns {object|null} null for an unknown key
 */
export function buildRoot(key, data, familyIndex) {
  const roots = rootTableOf(data);
  const rootKey = rootKeyOf(key, roots);
  if (rootKey === "") return null;
  const entry = roots[rootKey];
  const table = wordTableOf(data);
  const words = familyOf(rootKey, familyIndex);
  const lang = rootLangOf(rootKey, entry);
  const kind = str(entry.kind) || "root";

  const root = {
    key: rootKey,
    form: str(entry.form),
    lang,
    gloss: str(entry.gloss),
    kind,
    label: rootLabel(lang, kind),
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
  const rootKey = rootKeyOf(key, rootTableOf(data));
  if (rootKey === "") return { rows: [], total: 0, offset: start };
  const table = wordTableOf(data);
  const words = familyOf(rootKey, familyIndex);
  return {
    rows: words.slice(start, start + FAMILY_CHUNK).map((word) => familyRow(word, table)),
    total: words.length,
    offset: start,
  };
}

/**
 * A root's label line in plain English, one entry per `kind` in the SPEC's
 * enum plus the language fallback for a plain root. THE definition: the worker
 * joins it onto the root response as `label` and into the Anki `source` field,
 * so neither the card nor the export holds a copy of these rules.
 */
export function rootLabel(lang, kind) {
  // The harvested pos is "infix"; English calls the thing an interfix, and the
  // card says what a reader would look up.
  const kindWord =
    kind === "prefix" ? "prefix" :
    kind === "suffix" ? "suffix" :
    kind === "infix" ? "interfix" :
    kind === "circumfix" ? "circumfix" : "root";
  // Classical roots keep their language on the label whatever the kind: a
  // Greek suffix card says "Greek suffix", never a bare "Suffix" that could
  // be mistaken for an English affix.
  if (lang === "la") return "Latin " + kindWord;
  if (lang === "grc") return "Greek " + kindWord;
  if (kindWord === "root") return "English root";
  return kindWord.charAt(0).toUpperCase() + kindWord.slice(1);
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
 * Escape dynamic text for the omnibox description's XML mini-format. Chrome
 * PARSES a description as XML, so the only unescaped angle brackets in one are
 * the <match>/<dim> tags this module emits itself. Every word, gloss and
 * definition goes through here, and so does the typed input that background.js
 * echoes back in the default suggestion.
 * `content` is NEVER escaped, since it round-trips into onInputEntered as typed.
 */
export function escapeXml(text) {
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

/**
 * The prefix an omnibox query matches on: folded as typed, then capped at the
 * token length. A query longer than a word is a query for nothing, and without
 * the cap every keystroke of a pasted paragraph walked the whole index.
 */
function omniboxPrefix(text) {
  if (typeof text !== "string") return "";
  return fold(text.trim()).slice(0, MAX_TOKEN_CHARS);
}

/**
 * The omnibox index: everything a keystroke needs, built once and cached beside
 * the family index. Rebuilding it per keystroke cost 8.5 to 13.2 ms (measured
 * 2026-08-24), since it materialized all 76,496 word keys, filtered them and
 * fully sorted the hits for five rows.
 *
 * `keys` is every word key in ascending order with `ranks` parallel to it, so a
 * prefix is a binary search plus a walk of that one range. `roots` is
 * pre-ranked by family size then key, which is the order root rows come back
 * in, so a prefix scan there stops as soon as it has enough rows; each row
 * carries its whole suggestion, so the pass never reads roots.json again.
 *
 * @param {object} data parsed data bundle
 * @returns {{keys:string[], ranks:Float64Array, roots:object[]}}
 */
export function buildSearchIndex(data) {
  const table = wordTableOf(data);
  const keys = Object.keys(table).sort();
  const ranks = new Float64Array(keys.length);
  for (let i = 0; i < keys.length; i += 1) ranks[i] = rankOf(table[keys[i]]);

  // Sizes, not lists: the rows rank by how many words a root builds and never
  // name one of them.
  const counts = buildFamilyCounts(data && data.words);
  const rootTable = rootTableOf(data);
  const roots = [];
  for (const key of Object.keys(rootTable)) {
    const entry = rootTable[key];
    if (entry === null || typeof entry !== "object") continue;
    // `alt` forms match too, since they are the same card under another surface.
    const forms = [entry.form, ...(Array.isArray(entry.alt) ? entry.alt : [])]
      .filter((form) => typeof form === "string" && form !== "")
      .map((form) => fold(form));
    if (forms.length === 0) continue;
    roots.push({
      key,
      forms,
      size: counts[key] || 0,
      form: str(entry.form) || key,
      label: rootLabel(rootLangOf(key, entry), str(entry.kind)),
      gloss: str(entry.gloss),
    });
  }
  roots.sort((a, b) => {
    const diff = b.size - a.size;
    if (diff !== 0) return diff;
    return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
  });
  return { keys, ranks, roots };
}

/** The cached index when the caller has one, else a fresh one for this call. */
function searchIndexOf(data) {
  const index = data && data.searchIndex;
  return index !== null && typeof index === "object" &&
    Array.isArray(index.keys) && Array.isArray(index.roots)
    ? index
    : buildSearchIndex(data);
}

/** The first position in `keys` at or after `prefix`. */
function lowerBound(keys, prefix) {
  let lo = 0;
  let hi = keys.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (keys[mid] < prefix) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * The best MAX_OMNIBOX_SUGGESTIONS word keys under the prefix, ranked by `fr`
 * then key. The keys carrying a prefix are one contiguous run of the sorted
 * array, and the winners are picked by bounded insertion into a five-slot list,
 * so a keystroke sorts nothing. The run is walked in ascending key order, which
 * is why an equal rank never displaces the row already held.
 */
function wordPrefixMatches(prefix, index) {
  const { keys, ranks } = index;
  const best = [];
  for (let i = lowerBound(keys, prefix); i < keys.length; i += 1) {
    const key = keys[i];
    if (!key.startsWith(prefix)) break;
    const rank = ranks[i];
    if (best.length === MAX_OMNIBOX_SUGGESTIONS) {
      if (rank >= best[best.length - 1].rank) continue;
      best.pop();
    }
    let at = best.length;
    while (at > 0 && best[at - 1].rank > rank) at -= 1;
    best.splice(at, 0, { key, rank });
  }
  return best;
}

/** The first `room` pre-ranked root rows whose form or alt starts with the prefix. */
function rootPrefixMatches(prefix, index, room) {
  const hits = [];
  if (room <= 0) return hits;
  for (const root of index.roots) {
    if (root.forms.some((form) => form.startsWith(prefix))) {
      hits.push(root);
      if (hits.length === room) break;
    }
  }
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
 * @param {{words?:object, roots?:object, searchIndex?:object}} data parsed bundle
 * @returns {Array<{content:string, description:string}>}
 */
export function buildOmniboxSuggestions(text, data) {
  try {
    const prefix = omniboxPrefix(text);
    if (prefix === "") return [];
    const index = searchIndexOf(data);
    const table = wordTableOf(data);

    const rows = [];
    for (const hit of wordPrefixMatches(prefix, index)) {
      rows.push({
        content: hit.key,
        description: describe(hit.key, "", [firstDef(table[hit.key])]),
      });
    }
    const room = MAX_OMNIBOX_SUGGESTIONS - rows.length;
    for (const root of rootPrefixMatches(prefix, index, room)) {
      rows.push({
        content: root.key,
        description: describe(root.form, root.label, [root.gloss]),
      });
    }
    return rows;
  } catch {
    return [];
  }
}
