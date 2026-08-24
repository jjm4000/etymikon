/**
 * Unit tests for the pure logic in extension/lookup.js and extension/saved.js,
 * plus the worker seams in extension/background.js.
 * Plain Node, no dependencies, no chrome globals.
 *
 *   node test/lookup.test.mjs
 *
 * Fixture data is defined inline below on purpose: extension/data/ holds the
 * generated corpus and must not be depended on (or written to) here. The
 * smoke tests at the bottom only READ the real files if present, and assert
 * nothing but the SPEC's own anchors.
 */

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  buildFamily,
  buildFamilyIndex,
  buildMatches,
  buildOmniboxSuggestions,
  buildRoot,
  extractToken,
  firstDef,
  fold,
  lookup,
  resolve,
  rootLabel,
  tierOf,
  FAMILY_CHUNK,
  FAMILY_PREVIEW,
  MAX_OMNIBOX_SUGGESTIONS,
  MAX_TOKEN_CHARS,
  TIER_CUTOFFS,
} from "../extension/lookup.js";

import {
  buildAnkiTsv,
  buildCsv,
  checkKeys,
  createFolder,
  deleteFolder,
  joinItems,
  moveItems,
  normalizeSavedState,
  normalizeSettings,
  removeItems,
  renameFolder,
  resolveExportSelection,
  savedMapKey,
  toggleItem,
  CSV_COLUMNS,
  DEFAULT_SETTINGS,
} from "../extension/saved.js";

// ---------------------------------------------------------------------------
// Inline fixtures (schema-exact per SPEC "Data files")
// ---------------------------------------------------------------------------

const words = {
  v: 1,
  words: {
    // A one-letter word, so the "no one-letter lemma" guard has something to
    // wrongly resolve to.
    a: { senses: [{ pos: "article", defs: ["The indefinite article."] }], fr: 5 },
    beautiful: {
      senses: [{ pos: "adj", defs: ["Having beauty."] }],
      // "beauty" does not ship here, so that chip must come back inert.
      morphs: [{ f: "beauty", w: "beauty" }, { f: "-ful", r: "en:-ful" }],
      fr: 903,
    },
    big: { senses: [{ pos: "adj", defs: ["Of great size."] }], fr: 1200 },
    box: { senses: [{ pos: "noun", defs: ["A container with a flat base."] }], fr: 2500 },
    dialogue: {
      senses: [{ pos: "noun", defs: ["A conversation between two people."] }],
      org: { r: "grc:λόγος", f: "λόγος" },
      fr: 7100,
    },
    hope: {
      senses: [
        { pos: "noun", defs: ["Expectation of a thing to come."] },
        { pos: "verb", defs: ["To want something to happen."] },
      ],
      fr: 1503,
    },
    hopeful: {
      senses: [{ pos: "adj", defs: ["Feeling or inspiring hope."] }],
      morphs: [{ f: "hope", w: "hope" }, { f: "-ful", r: "en:-ful" }],
      fr: 9512,
    },
    logic: {
      senses: [{ pos: "noun", defs: ["The study of valid reasoning."] }],
      morphs: [{ f: "logos", r: "grc:λόγος" }, { f: "-ic", r: "en:-ic" }],
      fr: 5000,
    },
    muse: { senses: [{ pos: "noun", defs: ["A source of inspiration."] }], fr: 24810 },
    music: {
      senses: [{ pos: "noun", defs: ["Sounds arranged for beauty of form."] }],
      morphs: [{ f: "muse", w: "muse" }, { f: "-ic", r: "en:-ic" }],
      fr: 712,
    },
    nice: { senses: [{ pos: "adj", defs: ["Pleasant."] }], fr: 900 },
    // A shipped word that shadows an inflection: it ships on a marginal sense
    // and points the reader at the lemma it hides.
    ran: {
      senses: [{ pos: "noun", defs: ["A marginal noun sense."] }],
      fo: "run",
      fr: 8400,
    },
    run: {
      senses: [
        { pos: "verb", defs: ["To move at a fast pace on foot.", "To manage a thing."] },
        { pos: "noun", defs: ["An act of running."] },
      ],
      fr: 486,
    },
    // The same shadow shape, pointing at a lemma this bundle does not ship.
    sprang: {
      senses: [{ pos: "noun", defs: ["A woven fabric technique."] }],
      fo: "spring",
      fr: 40000,
    },
    stop: { senses: [{ pos: "verb", defs: ["To cease moving."] }], fr: 902 },
    subterranean: {
      senses: [{ pos: "adj", defs: ["Below the ground; underground."] }],
      morphs: [
        { f: "sub-", r: "en:sub-" },
        { f: "terra", r: "la:terra" },
        { f: "-an", r: "en:-an" },
      ],
      fr: 61254,
    },
    suburban: {
      senses: [{ pos: "adj", defs: ["Of the outlying districts of a city."] }],
      // "urb" carries no root key at all, so its chip renders inert.
      morphs: [{ f: "sub-", r: "en:sub-" }, { f: "urb" }, { f: "-an", r: "en:-an" }],
      fr: 12483,
    },
    subway: {
      senses: [{ pos: "noun", defs: ["An underground railway."] }],
      // "way" names a root that did not ship, so its chip renders inert too.
      morphs: [{ f: "sub-", r: "en:sub-" }, { f: "way", r: "en:way" }],
      fr: 8021,
    },
    teach: { senses: [{ pos: "verb", defs: ["To impart knowledge."] }], fr: 3000 },
    terracotta: {
      senses: [{ pos: "noun", defs: ["A fired brownish-red clay."] }],
      org: { r: "la:terra", f: "terra" },
    },
    terrain: {
      senses: [{ pos: "noun", defs: ["An area of land."] }],
      org: { r: "la:terra", f: "terra" },
      fr: 4712,
    },
    terrarium: {
      senses: [{ pos: "noun", defs: ["A vivarium for land animals."] }],
      org: { r: "la:terra", f: "terra" },
    },
    territory: {
      senses: [
        { pos: "noun", defs: ["A geographic area under the jurisdiction of a state."] },
      ],
      org: { r: "la:terra", f: "terra" },
      fr: 3204,
    },
  },
};

const roots = {
  v: 1,
  roots: {
    "en:-an": { form: "-an", lang: "en", gloss: "forming adjectives", kind: "suffix" },
    // A Germanic affix: an ordinary en: root, with no src row.
    "en:-ful": { form: "-ful", lang: "en", gloss: "full of", kind: "suffix" },
    "en:-ic": { form: "-ic", lang: "en", gloss: "forming adjectives", kind: "suffix" },
    "en:sub-": {
      form: "sub-",
      lang: "en",
      src: "la:sub",
      gloss: "under, beneath",
      kind: "prefix",
    },
    "grc:λόγος": {
      form: "λόγος",
      rom: "logos",
      lang: "grc",
      gloss: "word, reason",
      kind: "root",
    },
    "la:sub": { form: "sub", lang: "la", gloss: "under", kind: "root" },
    "la:terra": {
      form: "terra",
      alt: ["terr-"],
      lang: "la",
      gloss: "earth, land",
      kind: "root",
    },
  },
};

const forms = {
  v: 1,
  map: {
    // A form whose lemma ships, and which no suffix rule reaches.
    taught: "teach",
    // A form the map still carries although the surface ships as a word of
    // its own: the exact rule must win over the map.
    ran: "run",
    // A form whose lemma does NOT ship: the map entry must be ignored.
    children: "child",
  },
};

const data = { words, roots, forms };
const familyIndex = buildFamilyIndex(words);
const joinData = { ...data, familyIndex };

// ---------------------------------------------------------------------------
// Tiny test harness
// ---------------------------------------------------------------------------

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  ok  ${name}`);
  } catch (err) {
    failed += 1;
    console.log(`FAIL  ${name}`);
    console.log(`      ${err.message.split("\n").join("\n      ")}`);
  }
}

async function testAsync(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`  ok  ${name}`);
  } catch (err) {
    failed += 1;
    console.log(`FAIL  ${name}`);
    console.log(`      ${err.message.split("\n").join("\n      ")}`);
  }
}

/** The single match of a query, or null when nothing resolved. */
const one = (text) => {
  const { ok, matches } = lookup(text, data);
  assert.equal(ok, true);
  return matches.length === 0 ? null : matches[0];
};

const canonicalOf = (text) => {
  const match = one(text);
  return match === null ? null : match.canonical;
};

console.log("lookup.js");

// --- rule 1: token extraction --------------------------------------------

test("token extraction takes the first run of letters", () => {
  assert.equal(extractToken("  Hello, world"), "Hello");
  assert.equal(extractToken("terrain."), "terrain");
  assert.equal(extractToken("123abc"), "abc");
});

test("token extraction keeps apostrophes and internal hyphens", () => {
  assert.equal(extractToken("don't stop"), "don't");
  assert.equal(extractToken("co-operate now"), "co-operate");
});

test("token extraction yields nothing for text with no letters", () => {
  assert.equal(extractToken("   "), "");
  assert.equal(extractToken("123 456"), "");
  assert.equal(extractToken("…"), "");
  assert.equal(extractToken(null), "");
  assert.equal(extractToken(undefined), "");
});

test(`token extraction caps at ${MAX_TOKEN_CHARS} characters`, () => {
  const long = "a".repeat(60);
  assert.equal(extractToken(long).length, MAX_TOKEN_CHARS);
});

test("no token means no matches", () => {
  assert.deepEqual(lookup("!!!", data), { ok: true, matches: [] });
  assert.deepEqual(buildMatches("", data), []);
});

// --- rule 2: case folding, surface and canonical --------------------------

test("case folds for lookup while surface keeps the selected casing", () => {
  const match = one("Subterranean");
  assert.equal(match.surface, "Subterranean");
  assert.equal(match.canonical, "subterranean");
  assert.equal(match.formOf, undefined, "case alone is not an inflection");
});

test("an all-caps selection resolves to the same key", () => {
  assert.equal(canonicalOf("TERRAIN"), "terrain");
  assert.equal(fold("TERRAIN"), "terrain");
});

test("surrounding punctuation and whitespace never reach the key", () => {
  const match = one("  (terrain), ");
  assert.equal(match.surface, "terrain");
  assert.equal(match.canonical, "terrain");
});

// --- rule 3: resolution order --------------------------------------------

test("an exact key wins before anything else runs", () => {
  const resolved = resolve("run", data);
  assert.deepEqual(resolved, { surface: "run", canonical: "run" });
});

test("forms.json resolves an inflection the suffix rules would miss", () => {
  const match = one("taught");
  assert.equal(match.canonical, "teach");
  assert.deepEqual(match.formOf, { surface: "taught", lemma: "teach" });
  assert.equal(match.senses[0].defs[0], "To impart knowledge.");
});

test("a forms.json entry whose lemma is gone resolves nothing", () => {
  assert.equal(one("children"), null);
});

test("suffix rule s: runs → run", () => {
  const match = one("runs");
  assert.equal(match.canonical, "run");
  assert.deepEqual(match.formOf, { surface: "runs", lemma: "run" });
});

test("suffix rule es: boxes → box (the s rule missed first)", () => {
  assert.equal(canonicalOf("boxes"), "box");
});

test("suffix rule ies: territories → territory", () => {
  const match = one("territories");
  assert.equal(match.canonical, "territory");
  assert.deepEqual(match.formOf, { surface: "territories", lemma: "territory" });
});

test("suffix rule ing with doubled-consonant repair: running → run", () => {
  assert.equal(canonicalOf("running"), "run");
});

test("suffix rule ed with doubled-consonant repair: stopped → stop", () => {
  assert.equal(canonicalOf("stopped"), "stop");
});

test("suffix rule ing with dropped-e repair: hoping → hope", () => {
  assert.equal(canonicalOf("hoping"), "hope");
});

test("suffix rule ed with dropped-e repair: hoped → hope", () => {
  assert.equal(canonicalOf("hoped"), "hope");
});

test("suffix rule er and est repair both ways", () => {
  assert.equal(canonicalOf("bigger"), "big");
  assert.equal(canonicalOf("biggest"), "big");
  assert.equal(canonicalOf("nicer"), "nice");
  assert.equal(canonicalOf("nicest"), "nice");
});

test("a plain stem beats both repairs: teacher → teach", () => {
  assert.equal(canonicalOf("teacher"), "teach");
  assert.equal(canonicalOf("teaching"), "teach");
});

test("no suffix rule proposes a one-letter lemma", () => {
  assert.equal(one("as"), null, '"as" must not resolve to "a"');
  assert.equal(canonicalOf("a"), "a", "the exact key still works");
});

test("an unknown word resolves to no matches", () => {
  assert.deepEqual(lookup("zzzyzx", data), { ok: true, matches: [] });
  assert.equal(resolve("zzzyzx", data), null);
});

// --- the tier function ----------------------------------------------------

test("tier cutoffs live in one place and read 3000/15000/50000", () => {
  assert.deepEqual(TIER_CUTOFFS, { everyday: 3000, common: 15000, advanced: 50000 });
});

test("tier boundaries fall on the documented side", () => {
  assert.equal(tierOf(1), "everyday");
  assert.equal(tierOf(3000), "everyday");
  assert.equal(tierOf(3001), "common");
  assert.equal(tierOf(15000), "common");
  assert.equal(tierOf(15001), "advanced");
  assert.equal(tierOf(50000), "advanced");
  assert.equal(tierOf(50001), "rare");
});

test("an unranked or unusable rank is Rare", () => {
  assert.equal(tierOf(undefined), "rare");
  assert.equal(tierOf(null), "rare");
  assert.equal(tierOf(0), "rare");
  assert.equal(tierOf(-3), "rare");
  assert.equal(tierOf("1200"), "rare");
  assert.equal(tierOf(1.5), "rare");
});

test("the match carries both fr and the derived tier", () => {
  assert.equal(one("teach").tier, "everyday");
  assert.equal(one("territory").tier, "common");
  assert.equal(one("subterranean").tier, "rare");
  assert.equal(one("subterranean").fr, 61254);
});

test("an unranked word carries a tier and no fr", () => {
  const match = one("terrarium");
  assert.equal(match.tier, "rare");
  assert.equal("fr" in match, false);
});

// --- the morphs join ------------------------------------------------------

test("morph chips carry their root gloss", () => {
  const match = one("subterranean");
  assert.deepEqual(match.morphs, [
    { f: "sub-", r: "en:sub-", gloss: "under, beneath" },
    { f: "terra", r: "la:terra", gloss: "earth, land" },
    { f: "-an", r: "en:-an", gloss: "forming adjectives" },
  ]);
});

test("a morph with no root key comes back as the form alone", () => {
  const match = one("suburban");
  assert.deepEqual(match.morphs[1], { f: "urb" });
});

test("a morph naming an unshipped root loses its key, so the chip is inert", () => {
  const match = one("subway");
  assert.deepEqual(match.morphs[1], { f: "way" });
});

test("a w chip carries the word key and that word's first definition", () => {
  const match = one("music");
  assert.deepEqual(match.morphs, [
    { f: "muse", w: "muse", gloss: "A source of inspiration." },
    { f: "-ic", r: "en:-ic", gloss: "forming adjectives" },
  ]);
});

test("a w chip naming an unshipped word loses its key, so the chip is inert", () => {
  const match = one("beautiful");
  assert.deepEqual(match.morphs[0], { f: "beauty" });
  assert.deepEqual(match.morphs[1], { f: "-ful", gloss: "full of", r: "en:-ful" });
});

test("a word with no split carries no morphs key", () => {
  assert.equal("morphs" in one("run"), false);
});

test("senses come through per POS, in source order", () => {
  const match = one("run");
  assert.deepEqual(
    match.senses.map((s) => s.pos),
    ["verb", "noun"]
  );
  assert.equal(match.senses[0].defs.length, 2);
});

// --- the origin row -------------------------------------------------------

test("an org word carries the joined origin row and no morphs", () => {
  const match = one("terrain");
  assert.deepEqual(match.org, { r: "la:terra", f: "terra", gloss: "earth, land" });
  assert.equal("morphs" in match, false);
});

test("a morph word carries no org row", () => {
  assert.equal("org" in one("subterranean"), false);
});

// --- the shadow-entry row -------------------------------------------------

test("a shipped word that shadows an inflection points at its lemma", () => {
  const match = one("ran");
  assert.equal(match.canonical, "ran", "the exact key wins over forms.json");
  assert.equal(match.seeAlso, "run");
  assert.equal("formOf" in match, false, "nothing was lemmatized here");
});

test("seeAlso is dropped when the lemma is gone from the bundle", () => {
  const match = one("sprang");
  assert.equal(match.canonical, "sprang");
  assert.equal("seeAlso" in match, false);
});

test("seeAlso is dropped when a bundle points a word at itself", () => {
  const selfish = {
    words: {
      v: 1,
      words: { ran: { senses: [{ pos: "noun", defs: ["A sense."] }], fo: "ran" } },
    },
  };
  assert.equal("seeAlso" in buildMatches("ran", selfish)[0], false);
});

test("an ordinary word carries no seeAlso", () => {
  assert.equal("seeAlso" in one("run"), false);
  assert.equal("seeAlso" in one("terrain"), false);
});

// --- roots and families ---------------------------------------------------

test("the family index is derived from words.json alone", () => {
  assert.deepEqual(familyIndex["en:-an"], ["suburban", "subterranean"]);
  // The index credits every referenced key. roots.json decides which of them
  // has a card, and buildRoot is where an unshipped key stops.
  assert.deepEqual(familyIndex["en:way"], ["subway"]);
  assert.equal(buildRoot("en:way", data, familyIndex), null);
});

test("families rank by fr ascending, unranked last, ties by key", () => {
  assert.deepEqual(familyIndex["la:terra"], [
    "territory",
    "terrain",
    "subterranean",
    "terracotta",
    "terrarium",
  ]);
});

test("a w chip credits no root family", () => {
  assert.equal(familyIndex["muse"], undefined);
  assert.equal(familyIndex["w:muse"], undefined);
  assert.deepEqual(familyIndex["en:-ic"], ["music", "logic"]);
});

test("a Germanic affix builds like any other en: root", () => {
  const root = buildRoot("en:-ful", data, familyIndex);
  assert.equal(root.kind, "suffix");
  assert.equal(root.gloss, "full of");
  assert.equal("src" in root, false, "a Germanic affix has no source lemma");
  assert.equal(root.familyCount, 2);
  assert.deepEqual(root.family.map((r) => r.word), ["beautiful", "hopeful"]);
});

test("a word credits a root once even when two morphs name it", () => {
  const twice = buildFamilyIndex({
    v: 1,
    words: {
      transterrestrial: {
        senses: [{ pos: "adj", defs: ["Across the earth."] }],
        morphs: [{ f: "terra", r: "la:terra" }, { f: "terr-", r: "la:terra" }],
        fr: 90000,
      },
    },
  });
  assert.deepEqual(twice["la:terra"], ["transterrestrial"]);
});

test("a root card carries its own fields plus the family preview", () => {
  const root = buildRoot("la:terra", data, familyIndex);
  assert.equal(root.key, "la:terra");
  assert.equal(root.form, "terra");
  assert.equal(root.lang, "la");
  assert.equal(root.gloss, "earth, land");
  assert.equal(root.kind, "root");
  assert.equal(root.familyCount, 5);
  assert.deepEqual(root.family[0], {
    word: "territory",
    def: "A geographic area under the jurisdiction of a state.",
    tier: "common",
    fr: 3204,
  });
});

test("an unranked family row carries a tier and no fr", () => {
  const root = buildRoot("la:terra", data, familyIndex);
  const row = root.family.find((r) => r.word === "terracotta");
  assert.equal(row.tier, "rare");
  assert.equal("fr" in row, false);
});

// A family two and a bit chunks deep, for the offset math.
const bigFamilyWords = { v: 1, words: {} };
const BIG_FAMILY = FAMILY_CHUNK * 2 + 45;
for (let i = 0; i < BIG_FAMILY; i += 1) {
  bigFamilyWords.words[`terra${String(i).padStart(4, "0")}`] = {
    senses: [{ pos: "noun", defs: [`Word ${i}.`] }],
    morphs: [{ f: "terra", r: "la:terra" }],
    fr: 100 + i,
  };
}
const bigFamilyData = { words: bigFamilyWords, roots };
const bigFamilyIndex = buildFamilyIndex(bigFamilyWords);

test(`the preview stops at ${FAMILY_PREVIEW} rows while familyCount counts all`, () => {
  const root = buildRoot("la:terra", bigFamilyData, bigFamilyIndex);
  assert.equal(root.familyCount, BIG_FAMILY);
  assert.equal(root.family.length, FAMILY_PREVIEW);
  assert.equal(root.family[0].word, "terra0000");
});

test("a family chunk is the same row shape as the preview", () => {
  const root = buildRoot("la:terra", data, familyIndex);
  const chunk = buildFamily("la:terra", data, familyIndex);
  assert.deepEqual(chunk, { rows: root.family, total: 5, offset: 0 });
});

test(`a family answers at most ${FAMILY_CHUNK} rows, with the total behind them`, () => {
  const first = buildFamily("la:terra", bigFamilyData, bigFamilyIndex);
  assert.equal(first.rows.length, FAMILY_CHUNK);
  assert.equal(first.total, BIG_FAMILY);
  assert.equal(first.offset, 0);
  assert.equal(first.rows[0].word, "terra0000");
  assert.equal(first.rows[FAMILY_CHUNK - 1].word, `terra0${FAMILY_CHUNK - 1}`);
});

test("later chunks continue the ranked order at their offset", () => {
  const second = buildFamily("la:terra", bigFamilyData, bigFamilyIndex, FAMILY_CHUNK);
  assert.equal(second.offset, FAMILY_CHUNK);
  assert.equal(second.total, BIG_FAMILY);
  assert.equal(second.rows.length, FAMILY_CHUNK);
  assert.equal(second.rows[0].word, `terra0${FAMILY_CHUNK}`);

  const third = buildFamily("la:terra", bigFamilyData, bigFamilyIndex, FAMILY_CHUNK * 2);
  assert.equal(third.rows.length, BIG_FAMILY - FAMILY_CHUNK * 2);
  assert.equal(third.rows.at(-1).word, `terra0${BIG_FAMILY - 1}`);

  // Every chunk together is the whole ranked list, once.
  const walked = [];
  for (let offset = 0; offset < BIG_FAMILY; offset += FAMILY_CHUNK) {
    walked.push(...buildFamily("la:terra", bigFamilyData, bigFamilyIndex, offset).rows);
  }
  assert.equal(walked.length, BIG_FAMILY);
  assert.deepEqual(new Set(walked.map((r) => r.word)).size, BIG_FAMILY);
});

test("an offset past the end answers with no rows and the same total", () => {
  const past = buildFamily("la:terra", bigFamilyData, bigFamilyIndex, BIG_FAMILY + 10);
  assert.deepEqual(past, { rows: [], total: BIG_FAMILY, offset: BIG_FAMILY + 10 });
});

test("an unusable offset reads as 0", () => {
  for (const offset of [undefined, null, -5, 1.5, "200"]) {
    const chunk = buildFamily("la:terra", data, familyIndex, offset);
    assert.equal(chunk.offset, 0, `offset ${String(offset)} must read as 0`);
    assert.equal(chunk.rows.length, 5);
  }
});

test("an affix card joins its source lemma, and a Greek card its romanization", () => {
  const sub = buildRoot("en:sub-", data, familyIndex);
  assert.deepEqual(sub.src, { r: "la:sub", f: "sub", gloss: "under" });
  assert.equal(sub.kind, "prefix");
  const logos = buildRoot("grc:λόγος", data, familyIndex);
  assert.equal(logos.rom, "logos");
  assert.deepEqual(logos.family.map((r) => r.word), ["logic", "dialogue"]);
});

test("a root nothing references still builds, with an empty family", () => {
  const root = buildRoot("la:sub", data, familyIndex);
  assert.equal(root.familyCount, 0);
  assert.deepEqual(root.family, []);
});

test("an unknown root key builds nothing", () => {
  assert.equal(buildRoot("la:nope", data, familyIndex), null);
  assert.equal(buildRoot(undefined, data, familyIndex), null);
  assert.deepEqual(buildFamily("la:nope", data, familyIndex), {
    rows: [],
    total: 0,
    offset: 0,
  });
});

test("a family row whose word left the bundle is dropped", () => {
  const stale = { "la:terra": ["terrain", "ghost", "territory"] };
  assert.deepEqual(
    buildFamily("la:terra", data, stale).rows.map((r) => r.word),
    ["terrain", "territory"]
  );
});

test("root label lines read in plain English", () => {
  assert.equal(rootLabel("en", "prefix"), "Prefix");
  assert.equal(rootLabel("en", "suffix"), "Suffix");
  assert.equal(rootLabel("la", "root"), "Latin root");
  assert.equal(rootLabel("grc", "root"), "Greek root");
  assert.equal(rootLabel("en", "root"), "English root");
});

// --- omnibox --------------------------------------------------------------

test("omnibox suggests word prefixes first, ranked by fr", () => {
  const rows = buildOmniboxSuggestions("terr", joinData);
  assert.deepEqual(
    rows.map((r) => r.content),
    ["territory", "terrain", "terracotta", "terrarium", "la:terra"]
  );
});

test("omnibox descriptions carry the first definition", () => {
  const [first] = buildOmniboxSuggestions("terrain", joinData);
  assert.equal(
    first.description,
    "<match>terrain</match> <dim>An area of land.</dim>"
  );
});

test("omnibox root rows carry the root key as content and the gloss as tail", () => {
  const rows = buildOmniboxSuggestions("sub-", joinData);
  assert.deepEqual(rows.map((r) => r.content), ["en:sub-"]);
  assert.equal(
    rows[0].description,
    "<match>sub-</match> Prefix <dim>under, beneath</dim>"
  );
});

test("omnibox matches an alt form onto its card", () => {
  const rows = buildOmniboxSuggestions("terr-", joinData);
  assert.deepEqual(rows.map((r) => r.content), ["la:terra"]);
});

test("omnibox roots come after the words and rank by family size", () => {
  const rows = buildOmniboxSuggestions("sub", joinData).map((r) => r.content);
  assert.deepEqual(rows, ["subway", "suburban", "subterranean", "en:sub-", "la:sub"]);
});

test(`omnibox never returns more than ${MAX_OMNIBOX_SUGGESTIONS} rows`, () => {
  assert.ok(buildOmniboxSuggestions("t", joinData).length <= MAX_OMNIBOX_SUGGESTIONS);
});

test("omnibox is case insensitive and ignores surrounding space", () => {
  assert.deepEqual(
    buildOmniboxSuggestions("  TERRAIN ", joinData).map((r) => r.content),
    ["terrain"]
  );
});

test("omnibox returns nothing for an empty query or junk data", () => {
  assert.deepEqual(buildOmniboxSuggestions("", joinData), []);
  assert.deepEqual(buildOmniboxSuggestions("   ", joinData), []);
  assert.deepEqual(buildOmniboxSuggestions("terr", null), []);
  assert.deepEqual(buildOmniboxSuggestions(null, joinData), []);
});

test("omnibox escapes the description and leaves content raw", () => {
  const angled = {
    words: {
      v: 1,
      words: { "a&b": { senses: [{ pos: "noun", defs: ['A <b> "thing"'] }], fr: 1 } },
    },
    roots: { v: 1, roots: {} },
  };
  const [row] = buildOmniboxSuggestions("a&", angled);
  assert.equal(row.content, "a&b");
  assert.equal(
    row.description,
    "<match>a&amp;b</match> <dim>A &lt;b&gt; &quot;thing&quot;</dim>"
  );
});

// --- the response envelope ------------------------------------------------

test("lookup never throws on junk data", () => {
  assert.deepEqual(lookup("terrain", null), { ok: true, matches: [] });
  assert.deepEqual(lookup("terrain", { words: 5 }), { ok: true, matches: [] });
  assert.deepEqual(lookup(42, data), { ok: true, matches: [] });
});

test("firstDef reads the first definition of the first POS section", () => {
  assert.equal(firstDef(words.words.run), "To move at a fast pace on foot.");
  assert.equal(firstDef({ senses: [{ pos: "noun", defs: [] }] }), "");
  assert.equal(firstDef(null), "");
});

console.log("\nsaved.js");

// --- saved state ----------------------------------------------------------

const savedKeys = (state) => state.items.map((i) => savedMapKey(i.kind, i.key));

test("the saved map key distinguishes roots from words", () => {
  assert.equal(savedMapKey("word", "terrain"), "w:terrain");
  assert.equal(savedMapKey("root", "la:terra"), "r:la:terra");
});

test("an empty state normalizes to the default folder and no items", () => {
  const state = normalizeSavedState(undefined);
  assert.deepEqual(state.folders, [{ id: "f0", name: "Saved" }]);
  assert.deepEqual(state.items, []);
});

test("junk items are dropped and unknown folders fall back to f0", () => {
  const state = normalizeSavedState({
    folders: [{ id: "f0", name: "Saved" }],
    items: [
      { id: "i1", kind: "word", key: "terrain", folderId: "f9", addedAt: 1 },
      { id: "i2", kind: "char", key: "國", folderId: "f0", addedAt: 2 },
      { id: "i3", kind: "root", key: "", folderId: "f0", addedAt: 3 },
      { id: "i4", kind: "root", key: "la:terra", folderId: "f0", addedAt: 4 },
    ],
  });
  assert.deepEqual(savedKeys(state), ["w:terrain", "r:la:terra"]);
  assert.equal(state.items[0].folderId, "f0");
});

test("a duplicate identity collapses to the first item", () => {
  const state = normalizeSavedState({
    items: [
      { id: "i1", kind: "root", key: "la:terra", folderId: "f0", addedAt: 1 },
      { id: "i2", kind: "root", key: "la:terra", folderId: "f0", addedAt: 2 },
    ],
  });
  assert.equal(state.items.length, 1);
  assert.equal(state.items[0].id, "i1");
});

test("toggling an identity saves it, toggling again removes it", () => {
  const first = toggleItem(undefined, "word", "terrain", "f0", 1000);
  assert.equal(first.saved, true);
  assert.equal(first.item.folderId, "f0");
  const second = toggleItem(first.state, "word", "terrain", "f0", 2000);
  assert.equal(second.saved, false);
  assert.deepEqual(second.state.items, []);
});

test("word and root identities never collide", () => {
  const a = toggleItem(undefined, "word", "terra", "f0", 1);
  const b = toggleItem(a.state, "root", "terra", "f0", 2);
  assert.deepEqual(savedKeys(b.state), ["w:terra", "r:terra"]);
});

test("an unusable kind saves nothing", () => {
  const result = toggleItem(undefined, "char", "國", "f0", 1);
  assert.equal(result.saved, false);
  assert.deepEqual(result.state.items, []);
});

test("checkKeys answers every requested identity", () => {
  const { state } = toggleItem(undefined, "root", "la:terra", "f0", 1);
  assert.deepEqual(
    checkKeys(state, [
      { kind: "root", key: "la:terra" },
      { kind: "word", key: "la:terra" },
      { kind: "word", key: "terrain" },
    ]),
    { "r:la:terra": true, "w:la:terra": false, "w:terrain": false }
  );
});

// --- folders --------------------------------------------------------------

test("folders are created with monotonic ids", () => {
  const first = createFolder(undefined, " GRE list ");
  assert.deepEqual(first.folder, { id: "f1", name: "GRE list" });
  const second = createFolder(first.state, "Roots");
  assert.equal(second.folder.id, "f2");
  assert.equal(createFolder(second.state, "  ").error, "folder name required");
});

test("f0 may be renamed but never emptied, and never deleted", () => {
  const renamed = renameFolder(undefined, "f0", "Word bank");
  assert.deepEqual(renamed.folder, { id: "f0", name: "Word bank" });
  assert.equal(renameFolder(renamed.state, "f0", "   ").error, "folder name required");
  assert.equal(
    deleteFolder(renamed.state, "f0").error,
    "the default folder cannot be deleted"
  );
  assert.equal(renameFolder(renamed.state, "f7", "x").error, "no such folder");
});

test("deleting a folder rehomes its items to f0", () => {
  const made = createFolder(undefined, "Latin");
  const saved = toggleItem(made.state, "root", "la:terra", "f1", 1);
  assert.equal(saved.item.folderId, "f1");
  const gone = deleteFolder(saved.state, "f1");
  assert.equal(gone.moved, 1);
  assert.equal(gone.state.items[0].folderId, "f0");
  assert.deepEqual(gone.state.folders, [{ id: "f0", name: "Saved" }]);
});

test("moves count only the items whose folder actually changed", () => {
  const made = createFolder(undefined, "Latin");
  const a = toggleItem(made.state, "root", "la:terra", "f0", 1);
  const b = toggleItem(a.state, "word", "terrain", "f1", 2);
  const moved = moveItems(b.state, [a.item.id, b.item.id], "f1");
  assert.equal(moved.moved, 1);
  assert.equal(moveItems(b.state, [a.item.id], "f9").error, "no such folder");
});

test("removals report how many items went", () => {
  const a = toggleItem(undefined, "word", "terrain", "f0", 1);
  const b = toggleItem(a.state, "word", "territory", "f0", 2);
  const gone = removeItems(b.state, [a.item.id, "i99"]);
  assert.equal(gone.removed, 1);
  assert.deepEqual(savedKeys(gone.state), ["w:territory"]);
});

test("an export selection prefers ids, then folders, then all", () => {
  const made = createFolder(undefined, "Latin");
  const a = toggleItem(made.state, "word", "terrain", "f0", 1);
  const b = toggleItem(a.state, "root", "la:terra", "f1", 2);
  const state = b.state;
  assert.deepEqual(
    resolveExportSelection(state, { ids: [b.item.id], folderIds: ["f0"], all: true }),
    [b.item]
  );
  assert.deepEqual(resolveExportSelection(state, { folderIds: ["f1"], all: true }), [b.item]);
  assert.equal(resolveExportSelection(state, { all: true }).length, 2);
  assert.deepEqual(resolveExportSelection(state, {}), []);
});

// --- settings -------------------------------------------------------------

test("settings default to the SPEC's word and root field sets", () => {
  const settings = normalizeSettings(undefined);
  assert.equal(settings.v, 1);
  assert.equal(settings.defaultFolderId, "f0");
  assert.deepEqual(settings.anki, {
    wordFront: "word",
    wordBack: ["defs", "breakdown"],
    rootFront: "root",
    rootBack: ["gloss", "family"],
  });
  assert.deepEqual(settings.anki.wordBack, [...DEFAULT_SETTINGS.anki.wordBack]);
});

test("unknown field tokens fall back and unknown checkset tokens are dropped", () => {
  const settings = normalizeSettings({
    anki: {
      wordFront: "hanja",
      wordBack: ["breakdown", "breakdown", "eumhun", "tier"],
      rootFront: "family",
      rootBack: ["source"],
    },
  });
  assert.equal(settings.anki.wordFront, "word");
  assert.deepEqual(settings.anki.wordBack, ["breakdown", "tier"]);
  assert.equal(settings.anki.rootFront, "root", "family is a back field only");
  assert.deepEqual(settings.anki.rootBack, ["source"]);
});

test("an emptied checkset is kept, and a deleted default folder resets to f0", () => {
  assert.deepEqual(normalizeSettings({ anki: { wordBack: [] } }).anki.wordBack, []);
  const settings = normalizeSettings({ defaultFolderId: "f4" }, { folders: [] });
  assert.equal(settings.defaultFolderId, "f0");
});

// --- joining saved items against live data --------------------------------

const savedRows = (items) => joinItems(items, joinData);

test("a saved word row carries its definitions, breakdown and tier", () => {
  const [row] = savedRows([
    { id: "i1", kind: "word", key: "subterranean", folderId: "f0", addedAt: 0 },
  ]);
  assert.deepEqual(row.defs, ["Below the ground; underground."]);
  assert.equal(row.breakdown, "sub- + terra + -an");
  assert.equal(row.tier, "rare");
  assert.equal(row.fr, 61254);
});

test("a saved root row carries its gloss, label line and family", () => {
  const [row] = savedRows([
    { id: "i1", kind: "root", key: "la:terra", folderId: "f0", addedAt: 0 },
  ]);
  assert.equal(row.form, "terra");
  assert.equal(row.gloss, "earth, land");
  assert.equal(row.rootKind, "root");
  assert.equal(row.source, "Latin root");
  assert.equal(row.familyCount, 5);
  assert.deepEqual(row.family.slice(0, 2), ["territory", "terrain"]);
});

test("a row whose entry left the bundle is marked missing", () => {
  const rows = savedRows([
    { id: "i1", kind: "word", key: "ghost", folderId: "f0", addedAt: 0 },
    { id: "i2", kind: "root", key: "la:ghost", folderId: "f0", addedAt: 0 },
  ]);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].missing, true);
  assert.equal(rows[1].missing, true);
});

// --- exports --------------------------------------------------------------

const exportItems = [
  { id: "i1", kind: "word", key: "subterranean", folderId: "f1", addedAt: 1700000000000 },
  { id: "i2", kind: "root", key: "la:terra", folderId: "f0", addedAt: 1700000000000 },
  { id: "i3", kind: "word", key: "ghost", folderId: "f0", addedAt: 1700000000000 },
];
const exportFolders = [
  { id: "f0", name: "Saved" },
  { id: "f1", name: "GRE words 2" },
];

test("the Anki file writes the default fields per kind, tagged by folder", () => {
  const tsv = buildAnkiTsv(savedRows(exportItems), undefined, exportFolders);
  const lines = tsv.split("\n");
  assert.deepEqual(lines.slice(0, 3), ["#separator:tab", "#html:false", "#tags column:3"]);
  assert.equal(
    lines[3],
    "subterranean\t1. Below the ground; underground. · sub- + terra + -an\tGRE_words_2"
  );
  assert.equal(lines[4], "terra\tearth, land · territory, terrain, subterranean, terracotta, terrarium\tSaved");
  assert.equal(lines[5], "", "the missing row is skipped and the file ends with LF");
});

test("the Anki file follows the field settings", () => {
  const settings = {
    anki: {
      wordFront: "defs",
      wordBack: ["word", "tier"],
      rootFront: "gloss",
      rootBack: ["root", "source"],
    },
  };
  const lines = buildAnkiTsv(savedRows(exportItems), settings, exportFolders).split("\n");
  assert.equal(lines[3], "1. Below the ground; underground.\tsubterranean · Rare\tGRE_words_2");
  assert.equal(lines[4], "earth, land\tterra · Latin root\tSaved");
});

test("Anki fields quote tabs and quotes, and numbered defs cover every sense", () => {
  const rows = savedRows([
    { id: "i1", kind: "word", key: "run", folderId: "f0", addedAt: 0 },
  ]);
  const line = buildAnkiTsv(rows, undefined, exportFolders).split("\n")[3];
  assert.equal(
    line,
    "run\t1. To move at a fast pace on foot.; 2. To manage a thing.; 3. An act of running.\tSaved"
  );
  const quoted = buildAnkiTsv(
    [
      {
        kind: "word",
        key: 'a"b\tc',
        folderId: "f0",
        defs: ['A "quoted" def'],
        breakdown: "a + b",
        tier: "rare",
      },
    ],
    undefined,
    exportFolders
  ).split("\n")[3];
  assert.equal(quoted, '"a""b\tc"\t"1. A ""quoted"" def · a + b"\tSaved');
});

test("the CSV writes every column, with the gloss in the text column for roots", () => {
  const csv = buildCsv(savedRows(exportItems), exportFolders);
  const lines = csv.split("\n");
  assert.equal(lines[0], "kind,key,defs,breakdown,tier,folder,added");
  assert.deepEqual(CSV_COLUMNS, ["kind", "key", "defs", "breakdown", "tier", "folder", "added"]);
  assert.equal(
    lines[1],
    'word,subterranean,1. Below the ground; underground.,sub- + terra + -an,Rare,GRE words 2,2023-11-14'
  );
  assert.equal(lines[2], 'root,la:terra,"earth, land",,,Saved,2023-11-14');
  assert.equal(lines[3], "", "the missing row is skipped");
});

console.log("\nbackground.js");

const worker = await import("../extension/background.js");

// --- worker seams ---------------------------------------------------------

await testAsync("the router carries exactly the SPEC's message types", async () => {
  assert.deepEqual(Object.keys(worker.MESSAGE_HANDLERS).sort(), [
    "family",
    "folderCreate",
    "folderDelete",
    "folderRename",
    "getPendingQuery",
    "lookup",
    "openTab",
    "root",
    "savedCheck",
    "savedExport",
    "savedGet",
    "savedMove",
    "savedRemove",
    "savedToggle",
    "settingsGet",
    "settingsSet",
  ]);
});

await testAsync("every saved and settings handler answers 'storage unavailable'", async () => {
  const answers = await Promise.all([
    worker.handleSavedGet(),
    worker.handleSavedToggle("word", "terrain"),
    worker.handleSavedCheck([{ kind: "word", key: "terrain" }]),
    worker.handleSavedRemove(["i1"]),
    worker.handleSavedMove(["i1"], "f0"),
    worker.handleFolderCreate("Latin"),
    worker.handleFolderRename("f0", "Latin"),
    worker.handleFolderDelete("f1"),
    worker.handleSettingsGet(),
    worker.handleSettingsSet({}),
    worker.handleSavedExport({ all: true }, "csv"),
  ]);
  for (const answer of answers) {
    assert.deepEqual(answer, { ok: false, error: "storage unavailable" });
  }
});

await testAsync("data-backed handlers answer with an error, never a throw", async () => {
  // No chrome in Node, so getData() rejects. The envelope must survive it,
  // twice, since the failed cache is cleared for a retry.
  for (let i = 0; i < 2; i += 1) {
    const answer = await worker.handleLookup("terrain");
    assert.equal(answer.ok, false);
    assert.equal(typeof answer.error, "string");
  }
  assert.equal((await worker.handleRoot("la:terra")).ok, false);
  assert.equal((await worker.handleFamily("la:terra")).ok, false);
});

await testAsync("openTab refuses anything that is not a Wiktionary article", async () => {
  assert.equal(worker.isAllowedTabUrl("https://en.wiktionary.org/wiki/terrain"), true);
  assert.equal(worker.isAllowedTabUrl("https://evil.example/wiki/terrain"), false);
  assert.equal(worker.isAllowedTabUrl("http://en.wiktionary.org/wiki/terrain"), false);
  assert.equal(worker.isAllowedTabUrl(undefined), false);
  assert.deepEqual(await worker.handleOpenTab("https://evil.example/x"), {
    ok: false,
    error: "refused: not a Wiktionary URL",
  });
  // Allowed, but there is no chrome.tabs in Node.
  assert.deepEqual(await worker.handleOpenTab("https://en.wiktionary.org/wiki/terrain"), {
    ok: false,
    error: "tabs unavailable",
  });
});

await testAsync("the pending query is read once", async () => {
  worker.setPendingQuery("terrain");
  assert.deepEqual(await worker.handleGetPendingQuery(), { ok: true, query: "terrain" });
  assert.deepEqual(await worker.handleGetPendingQuery(), { ok: true, query: null });
  worker.setPendingQuery("");
  assert.deepEqual(await worker.handleGetPendingQuery(), { ok: true, query: null });
});

console.log("\nshipped data (skipped when extension/data is empty)");

// --- smoke tests over the real files, asserting only SPEC anchors ---------

const dataDir = join(dirname(fileURLToPath(import.meta.url)), "..", "extension", "data");

async function readBundle() {
  const [w, r, f] = await Promise.all([
    readFile(join(dataDir, "words.json"), "utf8"),
    readFile(join(dataDir, "roots.json"), "utf8"),
    readFile(join(dataDir, "forms.json"), "utf8"),
  ]);
  return { words: JSON.parse(w), roots: JSON.parse(r), forms: JSON.parse(f) };
}

await testAsync("smoke: the shipped bundle resolves the SPEC's anchor words", async () => {
  let bundle;
  try {
    bundle = await readBundle();
  } catch (err) {
    console.log(`      (skipped, data unreadable: ${err.code || err.name})`);
    return;
  }
  const placeholder = bundle.words.placeholder === true;
  const index = buildFamilyIndex(bundle.words);

  const sub = lookup("Subterranean", bundle).matches[0];
  assert.ok(sub, "subterranean must ship");
  assert.equal(sub.canonical, "subterranean");
  assert.ok(sub.senses.length > 0, "every shipped word has a definition");
  assert.ok(Array.isArray(sub.morphs) && sub.morphs.length >= 2, "subterranean splits");
  assert.ok(
    sub.morphs.some((m) => typeof m.r === "string" && m.r.startsWith("la:")),
    "the split reaches a Latin root"
  );

  // Lemmatization: territories reaches its lemma and says so in formOf.
  assert.equal(lookup("territories", bundle).matches[0].canonical, "territory");
  assert.deepEqual(lookup("territories", bundle).matches[0].formOf, {
    surface: "territories",
    lemma: "territory",
  });

  // The Latin anchor card and its family.
  const terra = buildRoot("la:terra", bundle, index);
  assert.ok(terra, "la:terra must ship");
  // The amended anchor: the shipped extract glosses la:terra "dry land".
  assert.ok(terra.gloss.includes("land"), "la:terra glosses as land");
  const family = buildFamily("la:terra", bundle, index).rows.map((r) => r.word);
  assert.ok(family.includes("terrain"), "terrain is in the terra family");
  assert.ok(family.includes("territory"), "territory is in the terra family");

  // The w-chip anchor: music links its first part to the muse WORD card.
  const music = lookup("music", bundle).matches[0];
  if (music && Array.isArray(music.morphs)) {
    const chip = music.morphs.find((m) => m.f === "muse");
    assert.ok(chip, "music splits on muse");
    assert.equal(chip.w, "muse", "the muse chip links to a word, not a root");
    assert.ok(chip.gloss.length > 0, "a w chip carries the word's first def");
  }

  // The Germanic affix anchor: -ful is an ordinary en: root card.
  const ful = buildRoot("en:-ful", bundle, index);
  if (ful) {
    assert.equal(ful.kind, "suffix");
    assert.ok(ful.familyCount >= 2, "a shipped root builds 2 or more words");
  }

  // Every chip carries at most one link field.
  const doubled = Object.keys(bundle.words.words).filter((key) =>
    (bundle.words.words[key].morphs || []).some((m) => m.r && m.w)
  );
  assert.deepEqual(doubled.slice(0, 5), [], `${doubled.length} chips carry both r and w`);

  // The shadow-entry anchor: a word carrying `fo` hands the reader its lemma.
  const table = bundle.words.words;
  const shadows = Object.keys(table).filter((key) => typeof table[key].fo === "string");
  if (shadows.length === 0) {
    console.log("      (no fo field in this build yet, shadow rows unverified)");
  } else {
    // The SPEC's own invariant: fo points at a shipped lemma.
    const dangling = shadows.filter((key) => !(table[key].fo in table));
    assert.deepEqual(dangling.slice(0, 5), [], `${dangling.length} fo targets do not ship`);
    const sample = shadows[0];
    assert.equal(
      lookup(sample, bundle).matches[0].seeAlso,
      table[sample].fo,
      `${sample} must carry seeAlso`
    );
    if (typeof table.ran?.fo === "string") {
      assert.equal(lookup("ran", bundle).matches[0].seeAlso, "run");
    }
    console.log(`      (${shadows.length} words carry a shadow row)`);
  }

  // A word never carries both a split and an origin chain.
  const both = Object.keys(bundle.words.words).filter((key) => {
    const entry = bundle.words.words[key];
    return Array.isArray(entry.morphs) && entry.morphs.length > 0 && entry.org;
  });
  assert.deepEqual(both.slice(0, 5), [], `${both.length} words carry morphs and org`);

  console.log(
    `      (${Object.keys(bundle.words.words).length} words, ` +
      `${Object.keys(bundle.roots.roots).length} roots, ` +
      `${Object.keys(bundle.forms.map).length} forms` +
      `${placeholder ? ", placeholder" : ""})`
  );
});

await testAsync("smoke: the shipped bundle obeys the resolution precedence", async () => {
  let bundle;
  try {
    bundle = await readBundle();
  } catch (err) {
    console.log(`      (skipped, data unreadable: ${err.code || err.name})`);
    return;
  }
  const table = bundle.words.words;
  const map = bundle.forms.map;
  const has = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);
  const canonical = (surface) => lookup(surface, bundle).matches[0]?.canonical;

  // The corpus decides which path an anchor takes. A dictionary this size
  // ships "running" and "runs" as entries of their own, so the exact rule
  // wins there and the fallbacks never see them.
  const paths = { exact: 0, map: 0, rule: 0 };
  for (const surface of ["running", "runs", "stopped", "hoping", "ran", "territories"]) {
    if (has(table, surface)) {
      paths.exact += 1;
      assert.equal(canonical(surface), surface, `${surface} is a shipped word`);
    } else if (has(map, surface)) {
      paths.map += 1;
      assert.equal(canonical(surface), map[surface], `${surface} follows forms.json`);
    } else {
      paths.rule += 1;
      assert.ok(canonical(surface), `${surface} must resolve by rule`);
    }
  }

  // The s rule at scale: a plural the map never recorded still reaches its
  // lemma. Surfaces the token rule would rewrite are skipped, since they are
  // not what a reader can select in the first place.
  let ruleHits = 0;
  for (const word of Object.keys(table).slice(0, 500)) {
    const surface = `${word}s`;
    if (word.length < 2 || extractToken(surface) !== surface) continue;
    if (has(table, surface) || has(map, surface)) continue;
    assert.equal(canonical(surface), word, `${surface} must reach ${word} by rule`);
    ruleHits += 1;
  }
  assert.ok(ruleHits > 0, "the sample must exercise the s rule at least once");
  console.log(
    `      (anchors: ${paths.exact} exact, ${paths.map} mapped, ${paths.rule} by rule; ` +
      `${ruleHits} plurals resolved by rule)`
  );
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
