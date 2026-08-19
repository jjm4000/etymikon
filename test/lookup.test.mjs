/**
 * Unit tests for the pure lookup logic in extension/lookup.js.
 * Plain Node, no dependencies, no chrome globals.
 *
 *   "C:\Program Files\nodejs\node.exe" test/lookup.test.mjs
 *
 * Fixture data is defined inline below on purpose: extension/data/ holds Agent
 * A's real generated corpus and must not be depended on (or written to) here.
 * The optional smoke test at the bottom only *reads* the real files if present.
 */

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  buildFullCompounds,
  buildMatches,
  buildOmniboxSuggestions,
  buildUsedIn,
  buildInterpretations,
  buildReadingIndex,
  buildWordParts,
  isInterpretableQuery,
  lookup,
  normalizeRomanization,
  romanizationVariants,
  extractRuns,
  segmentRun,
  maxWordLenOf,
  maxHangulLenOf,
  MAX_OMNIBOX_SUGGESTIONS,
  MAX_RR_VARIANTS,
} from "../extension/lookup.js";

import { qwertyToHangul, isLatinQuery } from "../extension/dubeolsik.js";

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
  toggleItem,
  CSV_COLUMNS,
  DEFAULT_SETTINGS,
} from "../extension/saved.js";

// ---------------------------------------------------------------------------
// Inline fixtures (schema-exact per SPEC "Data files")
// ---------------------------------------------------------------------------

const variants = {
  version: 1,
  map: { 国: "國", 学: "學" },
};

const hanja = {
  version: 1,
  chars: {
    國: {
      eumhun: [{ hun: "나라", eum: "국" }],
      readings: ["국"],
      glosses: ["country; state; nation"],
      compounds: [
        { hangul: "국민", hanja: "國民", gloss: "the people of a nation" },
        { hangul: "국가", hanja: "國家", gloss: "state; country" },
      ],
      // cw addendum: complete ranked index — superset of `compounds`, may
      // reference spellings the words fixture lacks (skipped on join).
      cw: ["國民", "國家", "大韓民國", "不在words"],
      // lvl addendum: character level taxonomy. 國 is middle school.
      lvl: "m",
    },
    民: {
      eumhun: [{ hun: "백성", eum: "민" }],
      readings: ["민"],
      glosses: ["people; populace; subject"],
      compounds: [{ hangul: "국민", hanja: "國民", gloss: "the people of a nation" }],
    },
    學: {
      eumhun: [{ hun: "배울", eum: "학" }],
      readings: ["학"],
      glosses: ["to learn; to study", "school; learning"],
      compounds: [{ hangul: "학생", hanja: "學生", gloss: "student" }],
      // ranked index for the used-in tests: 學生 is contained by 學生會 and
      // 民主主義國家 is not; 不明 isn't a words key and must be skipped.
      cw: ["學生", "學生會", "不明學生"],
      lvl: "m",
    },
    生: {
      eumhun: [{ hun: "날", eum: "생" }],
      readings: ["생"],
      glosses: ["to be born; to live", "raw; fresh"],
      compounds: [{ hangul: "학생", hanja: "學生", gloss: "student" }],
    },
    事: {
      eumhun: [{ hun: "일", eum: "사" }],
      readings: ["사"],
      glosses: ["affair; matter; thing"],
      compounds: [{ hangul: "사고", hanja: "事故", gloss: "accident" }],
    },
    故: {
      eumhun: [{ hun: "연고", eum: "고" }],
      readings: ["고"],
      glosses: ["reason; cause", "old; former"],
      compounds: [{ hangul: "사고", hanja: "事故", gloss: "accident" }],
    },
    思: {
      eumhun: [{ hun: "생각", eum: "사" }],
      readings: ["사"],
      glosses: ["to think; to consider"],
      compounds: [{ hangul: "사고", hanja: "思考", gloss: "thought; thinking" }],
    },
    考: {
      eumhun: [{ hun: "생각할", eum: "고" }],
      readings: ["고"],
      glosses: ["to examine; to ponder"],
      compounds: [{ hangul: "사고", hanja: "思考", gloss: "thought; thinking" }],
    },
    // Homophones of 국 with descending compound counts, for rule 3c ranking.
    局: {
      eumhun: [{ hun: "판", eum: "국" }],
      readings: ["국"],
      glosses: ["bureau; office; situation"],
      compounds: [{ hangul: "약국", hanja: "藥局", gloss: "pharmacy" }],
      // lvl addendum: outside the curriculum but attested -> advanced.
      lvl: "a",
    },
    菊: {
      // No eumhun at all: the eum comes from `readings`, so hun must be "".
      eumhun: [],
      readings: ["국"],
      glosses: [],
      compounds: [],
      // lvl addendum: the reading-only dictionary tail -> rare.
      lvl: "r",
    },
    詐: {
      eumhun: [{ hun: "속일", eum: "사" }],
      readings: ["사"],
      glosses: ["to deceive; fraud"],
      compounds: [{ hangul: "사기", hanja: "詐欺", gloss: "fraud; swindle" }],
    },
    欺: {
      eumhun: [{ hun: "속일", eum: "기" }],
      readings: ["기"],
      glosses: ["to cheat; to deceive"],
      compounds: [{ hangul: "사기", hanja: "詐欺", gloss: "fraud; swindle" }],
    },
    // Components of 資本主義, for the word-parts addendum.
    資: {
      eumhun: [{ hun: "재물", eum: "자" }],
      readings: ["자"],
      glosses: ["property; resources"],
      compounds: [{ hangul: "자본", hanja: "資本", gloss: "capital" }],
    },
    本: {
      eumhun: [{ hun: "근본", eum: "본" }],
      readings: ["본"],
      glosses: ["root; origin; basis"],
      compounds: [{ hangul: "자본", hanja: "資本", gloss: "capital" }],
    },
    主: {
      eumhun: [{ hun: "주인", eum: "주" }],
      readings: ["주"],
      glosses: ["master; owner; main"],
      compounds: [{ hangul: "주의", hanja: "主義", gloss: "-ism; doctrine" }],
    },
    義: {
      eumhun: [{ hun: "옳을", eum: "의" }],
      readings: ["의"],
      glosses: ["righteousness; justice"],
      compounds: [{ hangul: "주의", hanja: "主義", gloss: "-ism; doctrine" }],
    },
    // --- rare-flag fixtures: 사랑 (rare 舍廊 vs non-rare 沙羅) ---
    舍: {
      eumhun: [{ hun: "집", eum: "사" }],
      readings: ["사"],
      glosses: ["house; lodging"],
      compounds: [],
    },
    廊: {
      eumhun: [{ hun: "행랑", eum: "랑" }],
      readings: ["랑"],
      glosses: ["corridor; veranda"],
      compounds: [],
    },
    沙: {
      eumhun: [{ hun: "모래", eum: "사" }],
      readings: ["사"],
      glosses: ["sand"],
      compounds: [{ hangul: "사기", hanja: "沙器", gloss: "porcelain" }],
    },
    羅: {
      eumhun: [{ hun: "벌일", eum: "라" }],
      readings: ["라"],
      glosses: ["net; to spread out"],
      compounds: [],
    },
    // --- all-rare fixtures: 우리 (牛李 and 隅籬, both rare) ---
    牛: {
      eumhun: [{ hun: "소", eum: "우" }],
      readings: ["우"],
      glosses: ["cow; ox"],
      compounds: [],
    },
    李: {
      eumhun: [{ hun: "오얏", eum: "리" }],
      readings: ["리"],
      glosses: ["plum; a surname"],
      compounds: [],
    },
    隅: {
      eumhun: [{ hun: "모퉁이", eum: "우" }],
      readings: ["우"],
      glosses: ["corner; nook"],
      compounds: [],
    },
    籬: {
      eumhun: [{ hun: "울타리", eum: "리" }],
      readings: ["리"],
      glosses: ["hedge; fence"],
      compounds: [],
    },
  },
};

const words = {
  version: 1,
  words: {
    // Romanized search ADDENDUM: `f` is the frequency bucket (0 = most
    // frequent, absent = unranked). Only the two words the preference tests
    // compare carry one, so the unranked path is exercised too.
    國民: [{ hangul: "국민", glosses: ["the people; citizens of a nation"], f: 1 }],
    學生: [{ hangul: "학생", glosses: ["student; pupil"], f: 5 }],
    事故: [{ hangul: "사고", glosses: ["accident; mishap"] }],
    思考: [{ hangul: "사고", glosses: ["thought; thinking"] }],
    // 5 homograph spellings of 사기 — exercises the now-uncapped rule 3b.
    詐欺: [{ hangul: "사기", glosses: ["fraud; swindle"] }],
    士氣: [{ hangul: "사기", glosses: ["morale"] }],
    沙器: [{ hangul: "사기", glosses: ["porcelain; chinaware"] }],
    史記: [{ hangul: "사기", glosses: ["historical record"] }],
    射騎: [{ hangul: "사기", glosses: ["mounted archery"] }],
    // --- hanja-page (hp) flag fixtures: one hp sense + one plain sense, so
    // the any-wins collapse rule is actually exercised ---
    安全: [
      { hangul: "안전", glosses: ["safety; security"], hp: true },
      { hangul: "안전", glosses: ["archaic sense"] },
    ],
    // --- word-parts addendum fixtures ---
    資本主義: [
      { hangul: "자본주의", glosses: ["capitalism", "the capitalist system", "third gloss"] },
    ],
    資本: [{ hangul: "자본", glosses: ["capital", "funds", "dropped third gloss"] }],
    主義: [{ hangul: "주의", glosses: ["-ism; doctrine"] }],
    // Gloss-less stub: greedy longest-match would grab this and split
    // 資本主義 as 資本主 + 義. The DP must prefer 資本 + 主義.
    資本主: [{ hangul: "자본주", glosses: [] }],
    // The only sub-word available here is gloss-less — it must still be used,
    // because a gloss-less split beats no split (priority 2).
    原子力: [{ hangul: "원자력", glosses: ["nuclear power"] }],
    原子: [{ hangul: "원자", glosses: [] }],
    // Tie on gloss-covered (6) and covered (6): fewest segments wins, so
    // 民主主義 + 國家 (2 segments) beats 民主 + 主義 + 國家 (3).
    民主主義國家: [{ hangul: "민주주의국가", glosses: ["a democratic state"] }],
    民主主義: [{ hangul: "민주주의", glosses: ["democracy"] }],
    民主: [{ hangul: "민주", glosses: ["democracy; democratic"] }],
    國家: [{ hangul: "국가", glosses: ["state; nation"] }],
    // 3-char word covered by one 2-char sub-word plus a leftover char.
    學生會: [{ hangul: "학생회", glosses: ["student council"] }],
    // 3-char word with no multi-char sub-word at all.
    圖書館: [{ hangul: "도서관", glosses: ["library"] }],
    // Two 3-char homograph spellings, each with a different sub-word.
    詐欺戰: [{ hangul: "사기전", glosses: ["a campaign of fraud"] }],
    士氣戰: [{ hangul: "사기전", glosses: ["a battle of morale"] }],
    // --- rare-flag addendum fixtures ---
    // 사랑 is a native Korean word; 舍廊 is an obscure hanja homograph, so it
    // is flagged rare while 沙羅 is not. byHangul lists the RARE one first, so
    // correct output requires reordering.
    舍廊: [{ hangul: "사랑", glosses: ["a detached guest quarters"], rare: true }],
    沙羅: [{ hangul: "사랑", glosses: ["sal tree"] }],
    // 우리 is likewise native — both hanja spellings are rare.
    牛李: [{ hangul: "우리", glosses: ["the Niu-Li factional strife"], rare: true }],
    隅籬: [{ hangul: "우리", glosses: ["a corner fence"], rare: true }],
    // --- length-metadata addendum: a 7-char headword, longer than the old
    // hardcoded segmentation cap of 6, in both scripts ---
    中華人民共和國: [{ hangul: "중화인민공화국", glosses: ["the People's Republic of China"] }],
    // --- omnibox addendum: a gloss loaded with XML metacharacters, so the
    // description escaping is actually exercised. No chars entry on purpose —
    // adding 特/殊 to `hanja` would perturb the reading-index ordering tests.
    特殊: [{ hangul: "특수", glosses: ['R&D <special> "quoted" \'odd\''] }],
  },
  byHangul: {
    국민: ["國民"],
    학생: ["學生"],
    사고: ["事故", "思考"],
    사기: ["詐欺", "士氣", "沙器", "史記", "射騎"],
    자본주의: ["資本主義"],
    학생회: ["學生會"],
    도서관: ["圖書館"],
    사기전: ["詐欺戰", "士氣戰"],
    사랑: ["舍廊", "沙羅"],
    우리: ["牛李", "隅籬"],
    안전: ["安全"],
    중화인민공화국: ["中華人民共和國"],
    특수: ["特殊"],
  },
  // Length metadata addendum: the real caps for rules 3 / 3b.
  maxWordLen: 7,
  maxHangulLen: 7,
};

/**
 * Romanized search ADDENDUM: a schema-exact rr.json fixture
 * ({v, words:{rr:[hangul]}, syllables:{rr:[syllable]}}).
 *
 * The first keys are honest romanizations. The ones below them are Dubeolsik
 * strings on purpose — a key like `gkrtod` is what a typist produces reaching
 * for 학생 — so one query can drive BOTH generators and the merge/preference
 * rules can be tested without the real corpus.
 */
const rr = {
  v: 1,
  words: {
    gukmin: ["국민"],   // naive RR
    gungmin: ["국민"],  // official RR (nasalization)
    gugmin: ["국민"],   // Article 8 transliteration
    haksaeng: ["학생"],
    gkrtod: ["국민"],   // vs dubeolsik 학생 (f 5) — rr wins on f 1
    rnrals: ["학생"],   // vs dubeolsik 국민 (f 1) — dubeolsik wins on f
    rnr: ["학생"],      // vs dubeolsik 국, a reading list — word wins
    tkrl: ["국민"],     // vs dubeolsik 사기, unranked — ranked wins
  },
  syllables: {
    guk: ["국"],
    sa: ["사"],
    gkr: ["국"],        // vs dubeolsik 학: best cw 4 (國) beats 3 (學)
    tk: ["기"],         // vs dubeolsik 사: neither side has cw — a tie
  },
};

const data = { hanja, words, variants, rr };

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

const wordsOf = (matches) => matches.filter((m) => m.kind === "word");
const charsOf = (matches) => matches.filter((m) => m.kind === "char");
const canonicals = (matches) => matches.map((m) => m.canonical);

console.log("lookup.js");

// --- rule 3: Han-run segmentation ----------------------------------------

test('lookup("國民") → word 국민 + char cards for 國 and 民', () => {
  const { ok, matches } = lookup("國民", data);
  assert.equal(ok, true);

  const w = wordsOf(matches);
  assert.equal(w.length, 1);
  assert.deepEqual(w[0], {
    kind: "word",
    surface: "國民",
    canonical: "國民",
    hangul: "국민",
    glosses: ["the people; citizens of a nation"],
    chars: ["國", "民"],
  });

  const c = charsOf(matches);
  assert.deepEqual(canonicals(c), ["國", "民"]);
  assert.deepEqual(c[0].eumhun, [{ hun: "나라", eum: "국" }]);
  assert.deepEqual(c[0].readings, ["국"]);
  assert.ok(c[0].compounds.length > 0);

  // Words come before chars.
  assert.equal(matches[0].kind, "word");
});

test("greedy longest-match prefers the 2-char word over single chars", () => {
  const segs = segmentRun([..."國民"], data.words.words, data.variants.map);
  assert.equal(segs.length, 1);
  assert.equal(segs[0].kind, "word");
  assert.equal(segs[0].length, 2);
});

test("segmentation never spans a non-Han boundary", () => {
  const { matches } = lookup("國x民", data);
  assert.equal(wordsOf(matches).length, 0);
  assert.deepEqual(canonicals(charsOf(matches)), ["國", "民"]);
});

test("single-char selection returns just the char match", () => {
  const { matches } = lookup("學", data);
  assert.equal(wordsOf(matches).length, 0);
  assert.equal(matches.length, 1);
  assert.equal(matches[0].kind, "char");
  assert.equal(matches[0].canonical, "學");
});

// --- rule 3: the <= 4 threshold counts HAN CHARS ONLY --------------------

test('lookup("國民이라는") → word 國民 + char cards for 國 and 民', () => {
  // 2 Han + 3 hangul. Hangul must NOT count toward the <= 4 Han-char
  // threshold, so the per-character eumhun cards still appear.
  const { ok, matches } = lookup("國民이라는", data);
  assert.equal(ok, true);
  assert.deepEqual(canonicals(wordsOf(matches)), ["國民"]);
  assert.deepEqual(canonicals(charsOf(matches)), ["國", "民"]);
});

test("hangul beyond the threshold never suppresses Han char cards", () => {
  // 2 Han + 12 hangul = 14 relevant chars, but still only 2 Han chars.
  const { matches } = lookup("國民은 나라의 사람들을 뜻하는 말", data);
  assert.deepEqual(canonicals(wordsOf(matches)), ["國民"]);
  assert.deepEqual(canonicals(charsOf(matches)), ["國", "民"]);
});

test("exactly 4 Han chars still shows word-covered char cards", () => {
  const { matches } = lookup("國民學生", data);
  assert.deepEqual(canonicals(wordsOf(matches)), ["國民", "學生"]);
  assert.deepEqual(canonicals(charsOf(matches)), ["國", "民", "學", "生"]);
});

test("5+ Han chars fully covered by words omits the covered-char cards", () => {
  // 6 Han chars, every one inside a word match (國民 / 學生 / 事故).
  const { matches } = lookup("國民學生事故", data);
  assert.deepEqual(canonicals(wordsOf(matches)), ["國民", "學生", "事故"]);
  assert.deepEqual(canonicals(charsOf(matches)), []);
});

test("5 Han chars: unmatched chars still get cards, covered ones do not", () => {
  const { matches } = lookup("學生國民事", data);
  assert.deepEqual(canonicals(wordsOf(matches)), ["學生", "國民"]);
  assert.deepEqual(canonicals(charsOf(matches)), ["事"]);
});

// --- rule 2: variants -----------------------------------------------------

test('lookup("国") resolves to the 國 entry via variants.map', () => {
  const { ok, matches } = lookup("国", data);
  assert.equal(ok, true);
  assert.equal(matches.length, 1);
  assert.equal(matches[0].kind, "char");
  assert.equal(matches[0].surface, "国"); // original glyph preserved
  assert.equal(matches[0].canonical, "國");
  assert.deepEqual(matches[0].eumhun, [{ hun: "나라", eum: "국" }]);
});

test("variant chars segment into words too (学生 → 學生)", () => {
  const { matches } = lookup("学生", data);
  const w = wordsOf(matches);
  assert.equal(w.length, 1);
  assert.equal(w[0].surface, "学生");
  assert.equal(w[0].canonical, "學生");
  assert.equal(w[0].hangul, "학생");
  assert.deepEqual(w[0].chars, ["學", "生"]);
  assert.deepEqual(canonicals(charsOf(matches)), ["學", "生"]);
});

// --- rule 3b: hangul reverse lookup --------------------------------------

test('lookup("국민") → word 國民 + char cards for 國 and 民', () => {
  const { ok, matches } = lookup("국민", data);
  assert.equal(ok, true);

  const w = wordsOf(matches);
  assert.equal(w.length, 1);
  assert.deepEqual(w[0], {
    kind: "word",
    surface: "국민",
    canonical: "國民",
    hangul: "국민",
    glosses: ["the people; citizens of a nation"],
    chars: ["國", "民"],
  });
  assert.deepEqual(canonicals(charsOf(matches)), ["國", "民"]);
});

test("hangul-sourced matches always emit component chars, even when long", () => {
  const { matches } = lookup("국민 학생 사고", data);
  assert.deepEqual(canonicals(wordsOf(matches)), ["國民", "學生", "事故", "思考"]);
  // 사고 has two spellings: only the first (事故) contributes char cards.
  assert.deepEqual(canonicals(charsOf(matches)), ["國", "民", "學", "生", "事", "故"]);
});

test("one hangul span with multiple spellings → one word match each", () => {
  const { matches } = lookup("사고", data);
  const w = wordsOf(matches);
  assert.equal(w.length, 2);
  assert.deepEqual(canonicals(w), ["事故", "思考"]);
  assert.ok(w.every((m) => m.surface === "사고" && m.hangul === "사고"));
  assert.deepEqual(canonicals(charsOf(matches)), ["事", "故"]);
});

test("multi-spelling hangul word emits ALL spellings, no cap", () => {
  const { matches } = lookup("사기", data);
  const w = wordsOf(matches);
  assert.equal(w.length, 5, "no cap of 4 on hanja spellings");
  assert.deepEqual(canonicals(w), ["詐欺", "士氣", "沙器", "史記", "射騎"]);
  assert.ok(w.every((m) => m.surface === "사기" && m.hangul === "사기"));
  assert.deepEqual(w[1].glosses, ["morale"]);
  // Component char cards still only for the first spelling (詐欺).
  assert.deepEqual(canonicals(charsOf(matches)), ["詐", "欺"]);
});

// --- rare flag addendum ---------------------------------------------------

test("absent rare flag emits no key at all", () => {
  for (const text of ["國民", "국민", "資本主義"]) {
    for (const m of wordsOf(lookup(text, data).matches)) {
      assert.equal("rare" in m, false, `${text} → ${m.canonical} should have no rare key`);
    }
  }
});

test("Han-sourced lookup of 舍廊 carries rare: true", () => {
  // The UI ignores the flag for Han-sourced matches, but the protocol still
  // reports it — the decision belongs to the renderer, not the worker.
  const { matches } = lookup("舍廊", data);
  const w = wordsOf(matches);
  assert.equal(w.length, 1);
  assert.equal(w[0].canonical, "舍廊");
  assert.equal(w[0].rare, true);
  // 2 Han chars, so the component cards appear as usual.
  assert.deepEqual(canonicals(charsOf(matches)), ["舍", "廊"]);
});

test("hangul 사랑: non-rare orders first and owns the char cards", () => {
  assert.deepEqual(words.byHangul["사랑"], ["舍廊", "沙羅"], "rare is listed first");
  const { matches } = lookup("사랑", data);
  const w = wordsOf(matches);
  assert.equal(w.length, 2);

  // Reordered: non-rare 沙羅 first, rare 舍廊 second.
  assert.deepEqual(canonicals(w), ["沙羅", "舍廊"]);
  assert.equal("rare" in w[0], false);
  assert.equal(w[1].rare, true);

  // Char cards come from the first NON-RARE spelling, not byHangul[0].
  assert.deepEqual(canonicals(charsOf(matches)), ["沙", "羅"]);
});

test("all-rare hangul span still matches, flagged, cards from the first", () => {
  const { ok, matches } = lookup("우리", data);
  assert.equal(ok, true);
  const w = wordsOf(matches);
  assert.equal(w.length, 2);
  // No non-rare spelling exists, so byHangul order is preserved as-is.
  assert.deepEqual(canonicals(w), ["牛李", "隅籬"]);
  assert.ok(w.every((m) => m.rare === true));
  // Fallback: char cards from the first spelling.
  assert.deepEqual(canonicals(charsOf(matches)), ["牛", "李"]);
});

test("byHangul relative order is preserved within each rare group", () => {
  // All five 사기 spellings are non-rare, so the order is untouched.
  assert.deepEqual(canonicals(wordsOf(lookup("사기", data).matches)), [
    "詐欺",
    "士氣",
    "沙器",
    "史記",
    "射騎",
  ]);
});

test("a spelling is rare only when every contributing sense-set is rare", () => {
  const mixed = {
    ...data,
    words: {
      ...words,
      words: {
        ...words.words,
        舍廊: [
          { hangul: "사랑", glosses: ["obscure sense"], rare: true },
          { hangul: "사랑", glosses: ["an attested sense"] },
        ],
      },
    },
  };
  const w = wordsOf(lookup("사랑", mixed).matches);
  const saranng = w.find((m) => m.canonical === "舍廊");
  assert.equal("rare" in saranng, false, "one attested sense clears the flag");
  assert.deepEqual(saranng.glosses, ["obscure sense", "an attested sense"]);
});

test("lvl: propagated onto char matches, one value per char", () => {
  const guk = charsOf(lookup("國", data).matches)[0];
  assert.equal(guk.lvl, "m");
  const hak = charsOf(lookup("學", data).matches)[0];
  assert.equal(hak.lvl, "m");
  const guk2 = charsOf(lookup("局", data).matches)[0];
  assert.equal(guk2.lvl, "a");
  const guk3 = charsOf(lookup("菊", data).matches)[0];
  assert.equal(guk3.lvl, "r");
  // the legacy fields are gone for good
  assert.equal("edu" in guk, false);
  assert.equal("eduT" in guk, false);
  // a fixture char without lvl (placeholder data) simply carries none
  const min = charsOf(lookup("民", data).matches)[0];
  assert.equal("lvl" in min, false);
});

test("lvl: survives the kind:\"reading\" candidate rebuild", () => {
  // The reading path rebuilds candidates through an explicit field list —
  // the site that silently dropped the level field once before.
  const reading = lookup("국", data).matches[0];
  assert.equal(reading.kind, "reading");
  assert.equal(reading.candidates.find((c) => c.char === "國").lvl, "m");
  assert.equal(reading.candidates.find((c) => c.char === "局").lvl, "a");
  assert.equal(reading.candidates.find((c) => c.char === "菊").lvl, "r");
  const hak = lookup("학", data).matches[0].candidates.find((c) => c.char === "學");
  assert.equal(hak.lvl, "m");
});

test("lvl: junk values are not propagated", () => {
  const junk = {
    ...data,
    hanja: {
      version: 1,
      chars: { 國: { ...hanja.chars.國, lvl: "x" } },
    },
  };
  const m = charsOf(lookup("國", junk).matches)[0];
  assert.equal("lvl" in m, false);
});

// --- length metadata: segmentation caps come from the data ---------------

test("7-char hanja selection returns the whole word, not fragments", () => {
  const w = wordsOf(lookup("中華人民共和國", data).matches);
  assert.equal(w.length, 1);
  assert.equal(w[0].canonical, "中華人民共和國");
  assert.equal(w[0].hangul, "중화인민공화국");
});

test("7-syllable hangul reverse lookup resolves the whole word", () => {
  const w = wordsOf(lookup("중화인민공화국", data).matches);
  assert.equal(w.length, 1);
  assert.equal(w[0].surface, "중화인민공화국");
  assert.equal(w[0].canonical, "中華人民共和國");
});

test("without the meta fields, segmentation falls back to 6 (old behavior)", () => {
  assert.equal(maxWordLenOf(undefined), 6);
  assert.equal(maxWordLenOf({}), 6);
  assert.equal(maxHangulLenOf({}), 6);
  assert.equal(maxWordLenOf({ maxWordLen: 11 }), 11);
  // junk values fall back rather than breaking segmentation
  assert.equal(maxWordLenOf({ maxWordLen: 0 }), 6);
  assert.equal(maxHangulLenOf({ maxHangulLen: "11" }), 6);

  const noMeta = {
    hanja,
    words: { version: 1, words: words.words, byHangul: words.byHangul },
    variants,
  };
  const w = wordsOf(lookup("中華人民共和國", noMeta).matches);
  assert.ok(
    !w.some((m) => m.canonical === "中華人民共和國"),
    "a 7-char span is out of reach when the cap falls back to 6"
  );
  assert.equal(wordsOf(lookup("중화인민공화국", noMeta).matches).length, 0);
  // and the 6-char word is still reachable on the fallback path
  assert.equal(wordsOf(lookup("民主主義國家", noMeta).matches)[0].canonical, "民主主義國家");
});

test("word parts respect the data-driven cap", () => {
  // 7-char sub-span 中華人民共和國 inside an 8-char word is only visible when
  // buildWordParts is allowed to look past 6.
  const parts = buildWordParts("大中華人民共和國", words.words, 7);
  assert.deepEqual(
    parts.map((p) => (p.type === "word" ? p.hanja : p.char)),
    ["大", "中華人民共和國"]
  );
  assert.equal(
    (buildWordParts("大中華人民共和國", words.words) || []).some(
      (p) => p.hanja === "中華人民共和國"
    ),
    false,
    "default cap of 6 cannot see the 7-char sub-word"
  );
});

test("cwCount: present on chars with a cw index, absent otherwise", () => {
  const guk = charsOf(lookup("國", data).matches)[0];
  assert.equal(guk.cwCount, 4, "counts the whole index, not just joinable rows");
  const min = charsOf(lookup("民", data).matches)[0];
  assert.equal("cwCount" in min, false);
});

test("buildFullCompounds joins cw against words in order, skipping unknowns", () => {
  const rows = buildFullCompounds("國", data);
  assert.deepEqual(rows, [
    { hanja: "國民", hangul: "국민", gloss: "the people; citizens of a nation" },
    { hanja: "國家", hangul: "국가", gloss: "state; nation" },
  ]);
});

test("buildFullCompounds normalizes variants and handles unknown chars", () => {
  assert.deepEqual(buildFullCompounds("国", data), buildFullCompounds("國", data));
  assert.deepEqual(buildFullCompounds("𠀀", data), []);
  assert.deepEqual(buildFullCompounds("", data), []);
});

test("buildFullCompounds: rare only when every sense of a spelling is rare", () => {
  const patched = {
    ...data,
    hanja: {
      ...hanja,
      chars: { ...hanja.chars, 國: { ...hanja.chars.國, cw: ["舍廊", "沙羅"] } },
    },
  };
  const rows = buildFullCompounds("國", patched);
  assert.equal(rows[0].rare, true, "舍廊 is rare in the fixture");
  assert.equal("rare" in rows[1], false, "沙羅 is not");
});

test("usedInCount: present when larger words exist, absent otherwise", () => {
  const student = wordsOf(lookup("學生", data).matches)[0];
  assert.equal(student.usedInCount, 1, "學生會 contains 學生; 不明學生 not a word");
  const hangulSourced = wordsOf(lookup("학생", data).matches)[0];
  assert.equal(hangulSourced.usedInCount, 1, "hangul path carries it too");
  const nation = wordsOf(lookup("民主主義國家", data).matches)[0];
  assert.equal("usedInCount" in nation, false, "nothing contains the longest word");
});

test("buildUsedIn: ranked rows, self excluded, unknowns skipped", () => {
  assert.deepEqual(buildUsedIn("學生", data), [
    { hanja: "學生會", hangul: "학생회", gloss: "student council" },
  ]);
  assert.deepEqual(buildUsedIn("nope", data), []);
  assert.deepEqual(buildUsedIn("", data), []);
});

test("buildUsedIn falls back to a wordTable scan when the char lacks cw", () => {
  // 民 has no cw in the fixture; 民主 is contained by 民主主義 and 民主主義國家.
  const rows = buildUsedIn("民主", data);
  const spellings = rows.map((r) => r.hanja).sort();
  assert.deepEqual(spellings, ["民主主義", "民主主義國家"]);
});

test("hp flag: propagates on both paths, any-wins, absent otherwise", () => {
  // Han-sourced: 安全's first sense is hp, second is not — any-wins.
  const han = wordsOf(lookup("安全", data).matches);
  assert.equal(han[0].hp, true, "Han-sourced hp");
  // Hangul-sourced reverse lookup carries it too.
  const hang = wordsOf(lookup("안전", data).matches);
  assert.equal(hang[0].hp, true, "hangul-sourced hp");
  // Words harvested from hangul-headword pages emit no key at all.
  const plain = wordsOf(lookup("國民", data).matches);
  assert.equal("hp" in plain[0], false, "no hp key on hangul-page words");
});

test("Han-sourced: a non-rare sense clears the flag on a deduped headword", () => {
  // Two homograph senses share canonical+hangul, so they collapse to one card;
  // the non-rare one must win, as it does on the hangul path.
  const mixed = {
    ...data,
    words: {
      ...words,
      words: {
        ...words.words,
        舍廊: [
          { hangul: "사랑", glosses: ["obscure sense"], rare: true },
          { hangul: "사랑", glosses: ["an attested sense"] },
        ],
      },
    },
  };
  const w = wordsOf(lookup("舍廊", mixed).matches);
  assert.equal(w.length, 1, "same canonical+hangul collapses to one card");
  assert.equal("rare" in w[0], false);
});

// --- word parts addendum --------------------------------------------------

test("資本主義 → parts [資本, 主義] despite the greedier 資本主 stub", () => {
  assert.ok(words.words["資本主"], "the gloss-less stub must be in the fixture");
  const { ok, matches } = lookup("資本主義", data);
  assert.equal(ok, true);
  const w = wordsOf(matches);
  assert.equal(w.length, 1);
  assert.equal(w[0].canonical, "資本主義");
  assert.deepEqual(w[0].parts, [
    { type: "word", hanja: "資本", hangul: "자본", glosses: ["capital", "funds"] },
    { type: "word", hanja: "主義", hangul: "주의", glosses: ["-ism; doctrine"] },
  ]);
});

test("a gloss-less sub-word is still used when it is the only one", () => {
  // Priority 2: covering 2 of 3 chars beats covering none, glosses or not.
  const parts = buildWordParts("原子力", words.words);
  assert.deepEqual(parts, [
    { type: "word", hanja: "原子", hangul: "원자", glosses: [] },
    { type: "char", char: "力" },
  ]);
});

test("ties on coverage are broken by fewest segments", () => {
  // 民主主義+國家 and 民主+主義+國家 both cover 6/6 chars with glossed
  // sub-words; the 2-segment split must win.
  const parts = buildWordParts("民主主義國家", words.words);
  assert.equal(parts.length, 2);
  assert.deepEqual(
    parts.map((p) => p.hanja),
    ["民主主義", "國家"]
  );
});

test("sub-word glosses are capped at 2 and taken from the first sense", () => {
  const { matches } = lookup("資本主義", data);
  assert.equal(wordsOf(matches)[0].parts[0].glosses.length, 2);
  // The word's own glosses are NOT capped — only its parts' are.
  assert.equal(wordsOf(matches)[0].glosses.length, 3);
});

test("hangul lookup 자본주의 yields the same parts", () => {
  const { matches } = lookup("자본주의", data);
  const w = wordsOf(matches);
  assert.equal(w.length, 1);
  assert.equal(w[0].surface, "자본주의");
  assert.equal(w[0].canonical, "資本主義");
  assert.deepEqual(w[0].parts, lookup("資本主義", data).matches[0].parts);
});

test("3-char word with one 2-char sub-word → parts [word, char]", () => {
  const { matches } = lookup("學生會", data);
  const w = wordsOf(matches);
  assert.equal(w.length, 1);
  assert.deepEqual(w[0].parts, [
    { type: "word", hanja: "學生", hangul: "학생", glosses: ["student; pupil"] },
    { type: "char", char: "會" },
  ]);
});

test("a word is never its own part (full-span exclusion)", () => {
  // 學生會 is itself a key in `words`; the length-3 candidate at offset 0 must
  // be rejected so segmentation falls through to 學生 + 會.
  const parts = buildWordParts("學生會", words.words);
  assert.equal(parts[0].hanja, "學生");
  assert.notEqual(parts[0].hanja, "學生會");
  // The exclusion is by span, not by key: 圖書館 has no usable sub-word.
  assert.equal(buildWordParts("圖書館", words.words), null);
});

test("word with no multi-char sub-word omits the parts key entirely", () => {
  const { matches } = lookup("圖書館", data);
  const w = wordsOf(matches);
  assert.equal(w.length, 1);
  assert.equal("parts" in w[0], false);
});

test("2-char words never get a parts key", () => {
  for (const text of ["國民", "국민", "学生"]) {
    for (const m of wordsOf(lookup(text, data).matches)) {
      assert.equal("parts" in m, false, `${text} → ${m.canonical} should have no parts`);
    }
  }
  assert.equal(buildWordParts("國民", words.words), null);
});

test("each homograph spelling gets its own parts", () => {
  const w = wordsOf(lookup("사기전", data).matches);
  assert.equal(w.length, 2);
  assert.deepEqual(canonicals(w), ["詐欺戰", "士氣戰"]);
  assert.deepEqual(w[0].parts, [
    { type: "word", hanja: "詐欺", hangul: "사기", glosses: ["fraud; swindle"] },
    { type: "char", char: "戰" },
  ]);
  assert.deepEqual(w[1].parts, [
    { type: "word", hanja: "士氣", hangul: "사기", glosses: ["morale"] },
    { type: "char", char: "戰" },
  ]);
});

test("parts cover the word in order, with no gaps", () => {
  for (const text of ["資本主義", "學生會", "사기전", "民主主義國家", "原子力"]) {
    for (const m of wordsOf(lookup(text, data).matches)) {
      if (!m.parts) continue;
      const covered = m.parts
        .map((p) => (p.type === "word" ? p.hanja : p.char))
        .join("");
      assert.equal(covered, m.canonical, `${m.canonical} parts must cover the word`);
    }
  }
});

// --- rule 3c: single hangul syllable → homophone browse ------------------

test('lookup("국") returns a reading match including 國 with hun 나라', () => {
  const { ok, matches } = lookup("국", data);
  assert.equal(ok, true);
  assert.equal(matches.length, 1);

  const m = matches[0];
  assert.equal(m.kind, "reading");
  assert.equal(m.surface, "국");
  assert.equal(m.eum, "국");

  const guk = m.candidates.find((c) => c.char === "國");
  assert.ok(guk, "candidates should include 國");
  assert.deepEqual(guk, {
    char: "國",
    hun: "나라",
    eum: "국",
    gloss: "country; state; nation",
    lvl: "m",
  });
});

test("reading candidates are ranked by compound count, descending", () => {
  const { matches } = lookup("국", data);
  // 國 has 2 compounds, 局 has 1, 菊 has 0.
  assert.deepEqual(
    matches[0].candidates.map((c) => c.char),
    ["國", "局", "菊"]
  );
});

test("reading candidates are uncapped and expose hun \"\" when readings-only", () => {
  const { matches } = lookup("국", data);
  const guk = matches[0].candidates.find((c) => c.char === "菊");
  assert.deepEqual(guk, { char: "菊", hun: "", eum: "국", gloss: "", lvl: "r" });
  assert.equal(matches[0].candidates.length, 3, "every homophone is listed");
});

test("a syllable with no matching hanja returns empty matches", () => {
  assert.deepEqual(lookup("늘", data), { ok: true, matches: [] });
});

test("rule 3c only fires when the WHOLE selection is one syllable", () => {
  // Punctuation/latin around a lone syllable still counts as one syllable.
  assert.equal(lookup("  국!  ", data).matches[0].kind, "reading");
  // Two syllables, or a syllable plus a Han char, do not.
  assert.deepEqual(lookup("하늘", data), { ok: true, matches: [] });
  assert.equal(lookup("국民", data).matches[0].kind, "char");
});

test("buildReadingIndex is a pure function over hanja.json", () => {
  const index = buildReadingIndex(hanja);
  assert.deepEqual(index["국"].map((c) => c.char), ["國", "局", "菊"]);
  // 事/思/詐/沙 all have 1 compound (stable, so hanja.json key order); 舍 has 0.
  assert.deepEqual(index["사"].map((c) => c.char), ["事", "思", "詐", "沙", "舍"]);
  assert.equal(index["없"], undefined);
  // A precomputed index is used in preference to rebuilding.
  const stub = { "국": [{ char: "X", hun: "h", eum: "국", gloss: "g" }] };
  const viaCache = lookup("국", { ...data, readingIndex: stub });
  assert.deepEqual(viaCache.matches[0].candidates, stub["국"]);
});

test("getReadingIndex is only invoked on the rule 3c path", () => {
  let calls = 0;
  const bundle = {
    ...data,
    getReadingIndex: () => {
      calls += 1;
      return buildReadingIndex(hanja);
    },
  };
  lookup("國民", bundle);
  lookup("국민", bundle);
  assert.equal(calls, 0, "index must not be built for word/char lookups");
  lookup("국", bundle);
  assert.equal(calls, 1);
});

test("empty hanja data yields no reading match", () => {
  assert.deepEqual(lookup("국", { ...data, hanja: { chars: {} } }), {
    ok: true,
    matches: [],
  });
});

test("hangul with no sino-Korean match returns empty matches", () => {
  assert.deepEqual(lookup("하늘이 파랗다", data), { ok: true, matches: [] });
});

test("particle-suffixed hangul word still matches the full word", () => {
  // 자본주의는 = 자본주의 + topic marker; the particle must fall away and the
  // largest available word must still match, parts intact.
  const { ok, matches } = lookup("자본주의는", data);
  assert.equal(ok, true);
  const [word] = wordsOf(matches);
  assert.equal(word.canonical, "資本主義");
  assert.deepEqual(word.parts.map((p) => p.hanja), ["資本", "主義"]);
  // Same with a two-syllable tail.
  const two = lookup("국민은요", data);
  assert.deepEqual(canonicals(wordsOf(two.matches)), ["國民"]);
});

test("mixed Han + hangul selection works end to end", () => {
  const { ok, matches } = lookup("國民과 학생", data);
  assert.equal(ok, true);
  assert.deepEqual(canonicals(wordsOf(matches)), ["國民", "學生"]);
  // Only 2 Han chars, so 國/民 keep their cards; 學生 is hangul-sourced and
  // always contributes its components.
  assert.deepEqual(canonicals(charsOf(matches)), ["國", "民", "學", "生"]);
});

// --- rules 1 & 4: caps, non-CJK, unknown chars ---------------------------

test('lookup("abc") returns empty matches', () => {
  // Latin finds nothing literally, and interpreting it finds nothing either
  // (뮻 is in no dictionary, and "abc" is in no rr index), so no
  // `interpretations` field appears on either call.
  assert.deepEqual(lookup("abc", data), { ok: true, matches: [] });
  assert.deepEqual(lookup("abc", data, { interpret: true }), { ok: true, matches: [] });
});

test("empty / non-string input is safe", () => {
  assert.deepEqual(lookup("", data), { ok: true, matches: [] });
  assert.deepEqual(lookup(null, data), { ok: true, matches: [] });
  assert.deepEqual(lookup(undefined, data), { ok: true, matches: [] });
});

test("unknown Han chars are silently skipped", () => {
  assert.deepEqual(lookup("龘", data), { ok: true, matches: [] });
});

test("input longer than 20 Han chars is capped without error", () => {
  const long = "國民".repeat(30); // 60 Han chars
  const runs = extractRuns(long);
  assert.equal(
    runs.reduce((n, r) => n + r.chars.length, 0),
    20,
    "cap should be 20 relevant chars"
  );

  const { ok, matches } = lookup(long, data);
  assert.equal(ok, true);
  // 10 x 國民 word spans collapse to one deduped word card; 20 Han chars > 4 so
  // no char cards for chars that only appeared inside words.
  assert.deepEqual(canonicals(wordsOf(matches)), ["國民"]);
  assert.deepEqual(canonicals(charsOf(matches)), []);
});

test("the 20-char input cap counts Han and Hangul together (rule 1)", () => {
  const mixed = "國民".repeat(6) + "국민".repeat(6); // 12 Han + 12 hangul
  const runs = extractRuns(mixed);
  assert.equal(
    runs.reduce((n, r) => n + r.chars.length, 0),
    20
  );
  assert.equal(lookup(mixed, data).ok, true);
});

// --- rule 4 / error envelope ---------------------------------------------

test("missing or malformed data yields empty matches, not a throw", () => {
  assert.deepEqual(lookup("國民", {}), { ok: true, matches: [] });
  assert.deepEqual(lookup("國民", null), { ok: true, matches: [] });
  assert.deepEqual(lookup("國民", { hanja: {}, words: {}, variants: {} }), {
    ok: true,
    matches: [],
  });
});

test("exceptions are reported as { ok:false, error }", () => {
  const exploding = {
    get hanja() {
      throw new Error("boom");
    },
  };
  const res = lookup("國民", exploding);
  assert.equal(res.ok, false);
  assert.equal(res.error, "boom");
});

test("prototype keys are not treated as data", () => {
  assert.ok(buildMatches("國民", data).length > 0);
  const empty = { hanja: { chars: {} }, words: { words: {} }, variants: { map: {} } };
  assert.deepEqual(buildMatches("國民", empty), []);
  assert.deepEqual(buildMatches("constructor", empty), []);
});

// --- search popup addendum: omnibox suggestions --------------------------

const contentsOf = (rows) => rows.map((r) => r.content);
/** Strip the two markup tags we emit; whatever is left must be escaped text. */
const stripTags = (d) => d.replace(/<\/?(?:match|dim)>/g, "");

test("hanja word query puts the word first, with an escaped description", () => {
  const rows = buildOmniboxSuggestions("國民", data);
  assert.equal(rows[0].content, "國民");
  assert.equal(
    rows[0].description,
    "<match>國民</match> 국민 <dim>the people; citizens of a nation</dim>"
  );
  // Word first, then the component char rows.
  assert.deepEqual(contentsOf(rows), ["國民", "國", "民"]);
  assert.equal(
    rows[1].description,
    "<match>國</match> 나라 국 <dim>country; state; nation · 중학</dim>"
  );
});

test("content is the canonical searchable string, never escaped", () => {
  // A variant spelling resolves to the canonical one, so re-entering the
  // suggestion finds the same record.
  assert.deepEqual(contentsOf(buildOmniboxSuggestions("国民", data)), ["國民", "國", "民"]);
  // Raw hanja, no entities anywhere in any content.
  for (const query of ["國民", "특수", "사기", "국"]) {
    for (const row of buildOmniboxSuggestions(query, data)) {
      assert.ok(!/[&<>]/.test(row.content), `${query}: content must be plain text`);
    }
  }
  assert.equal(buildOmniboxSuggestions("특수", data)[0].content, "特殊");
});

test("descriptions XML-escape every dynamic fragment", () => {
  const [row] = buildOmniboxSuggestions("特殊", data);
  assert.equal(
    row.description,
    "<match>特殊</match> 특수 " +
      "<dim>R&amp;D &lt;special&gt; &quot;quoted&quot; &apos;odd&apos;</dim>"
  );
  // Only <match>/<dim> may be real markup.
  assert.ok(!/[<>]/.test(stripTags(row.description)));
  assert.ok(!/&(?!amp;|lt;|gt;|quot;|apos;)/.test(row.description));
});

test("hangul homograph query yields every spelling, capped at 5", () => {
  const rows = buildOmniboxSuggestions("사기", data);
  assert.equal(MAX_OMNIBOX_SUGGESTIONS, 5);
  assert.equal(rows.length, 5, "7 candidates exist (5 words + 2 chars); cap applies");
  assert.deepEqual(contentsOf(rows), ["詐欺", "士氣", "沙器", "史記", "射騎"]);
  assert.equal(rows[1].description, "<match>士氣</match> 사기 <dim>morale</dim>");
});

test("rare-flagged words rank last across the whole query", () => {
  // 우리 → 牛李/隅籬 (both rare) comes first in buildMatches order; the
  // non-rare 國民 from the later span must still lead.
  const rows = buildOmniboxSuggestions("우리 국민", data);
  assert.deepEqual(contentsOf(rows), ["國民", "牛李", "隅籬", "牛", "李"]);
  assert.equal(
    rows[1].description,
    "<match>牛李</match> 우리 <dim>the Niu-Li factional strife · rare</dim>"
  );
  // Within one span the non-rare spelling still leads.
  assert.deepEqual(contentsOf(buildOmniboxSuggestions("사랑", data)).slice(0, 2), [
    "沙羅",
    "舍廊",
  ]);
});

test("a single syllable yields its reading-browse candidates", () => {
  const rows = buildOmniboxSuggestions("국", data);
  assert.deepEqual(contentsOf(rows), ["國", "局", "菊"]);
  assert.equal(
    rows[0].description,
    "<match>國</match> 나라 국 <dim>country; state; nation · 중학</dim>"
  );
  assert.equal(rows[1].description, "<match>局</match> 판 국 <dim>bureau; office; situation</dim>");
  // 菊 has no hun and no gloss: no empty dim block, no stray separator.
  assert.equal(rows[2].description, "<match>菊</match> 국");
});

test("omnibox input is trimmed and NFC-normalized", () => {
  assert.deepEqual(
    buildOmniboxSuggestions("  國民  ", data),
    buildOmniboxSuggestions("國民", data)
  );
  // Decomposed hangul jamo normalize to the composed syllable (and only then
  // does rule 3c see a single syllable at all).
  const decomposed = "국";
  assert.notEqual(decomposed, "국");
  assert.deepEqual(
    buildOmniboxSuggestions(decomposed, data),
    buildOmniboxSuggestions("국", data)
  );
  assert.equal(buildOmniboxSuggestions(decomposed, data).length, 3);
  // The same, written inline rather than through a variable.
  assert.deepEqual(
    buildOmniboxSuggestions("국", data),
    buildOmniboxSuggestions("국", data)
  );
});

test("empty, whitespace and no-match omnibox input yields no rows", () => {
  for (const query of ["", "   ", "\t\n", "abc", "龘", "하늘이 파랗다", null, undefined, 42]) {
    assert.deepEqual(buildOmniboxSuggestions(query, data), [], `query ${String(query)}`);
  }
});

test("junk data is tolerated: no throw, just no suggestions", () => {
  assert.deepEqual(buildOmniboxSuggestions("國民", null), []);
  assert.deepEqual(buildOmniboxSuggestions("國民", {}), []);
  assert.deepEqual(buildOmniboxSuggestions("國民", { words: { words: null } }), []);
  const exploding = {
    get hanja() {
      throw new Error("boom");
    },
  };
  assert.deepEqual(buildOmniboxSuggestions("國民", exploding), []);
});

// ---------------------------------------------------------------------------
// saved.js — saved words + settings (ADDENDUM). Pure, no chrome, no storage.
// ---------------------------------------------------------------------------

console.log("\nsaved.js");

/** A saved state holding one word and one char, both in f0. */
function seedState() {
  let state = normalizeSavedState(null);
  state = toggleItem(state, "word", "國民", "f0", 1000).state;
  state = toggleItem(state, "char", "國", "f0", 2000).state;
  return state;
}

// --- normalize / migration -----------------------------------------------

test("normalizeSavedState turns nothing at all into a valid v1 state", () => {
  for (const junk of [undefined, null, 42, "nope", [], {}]) {
    const state = normalizeSavedState(junk);
    assert.equal(state.v, 1);
    assert.deepEqual(state.folders, [{ id: "f0", name: "Saved" }]);
    assert.deepEqual(state.items, []);
    assert.equal(state.nextFolder, 1);
    assert.equal(state.nextItem, 0);
  }
});

test("normalizeSavedState scrubs junk folders and items, keeping the good ones", () => {
  const state = normalizeSavedState({
    v: 1,
    folders: [
      { id: "f0", name: "" }, // f0 with no name falls back to "Saved"
      { id: "f2", name: "  Verbs  " }, // trimmed
      { id: "f3", name: "   " }, // nameless non-default folder: dropped
      { id: "f2", name: "dupe id" }, // duplicate id: dropped
      null,
      "nope",
    ],
    items: [
      { id: "i1", kind: "word", key: "國民", folderId: "f2", addedAt: 5 },
      { id: "i1", kind: "char", key: "國", folderId: "f9", addedAt: 6 }, // dup id + dead folder
      { kind: "word", key: "學生" }, // no id, no addedAt
      { id: "i7", kind: "word", key: "國民" }, // duplicate identity: dropped
      { id: "i8", kind: "verb", key: "x" }, // bad kind
      { id: "i9", kind: "word", key: "" }, // bad key
      null,
    ],
  });

  assert.deepEqual(state.folders, [
    { id: "f0", name: "Saved" },
    { id: "f2", name: "Verbs" },
  ]);
  assert.deepEqual(
    state.items.map((i) => [i.id, i.kind, i.key, i.folderId, i.addedAt]),
    [
      ["i1", "word", "國民", "f2", 5],
      ["i2", "char", "國", "f0", 6], // fresh id, item rehomed to f0
      ["i3", "word", "學生", "f0", 0],
    ]
  );
  // Counters clear every id in use, so nothing can ever collide.
  assert.equal(state.nextFolder, 3);
  assert.equal(state.nextItem, 4);
});

test("normalizeSavedState never mutates its input", () => {
  const raw = { folders: [], items: [{ id: "i0", kind: "word", key: "國民" }] };
  const snapshot = JSON.stringify(raw);
  normalizeSavedState(raw);
  assert.equal(JSON.stringify(raw), snapshot);
});

// --- toggle identity round-trip ------------------------------------------

test("toggleItem saves, then the same identity toggles back off", () => {
  const empty = normalizeSavedState(null);

  const saved = toggleItem(empty, "char", "國", "f0", 1234);
  assert.equal(saved.saved, true);
  assert.deepEqual(saved.item, {
    id: "i0",
    kind: "char",
    key: "國",
    folderId: "f0",
    addedAt: 1234,
  });
  assert.equal(saved.state.items.length, 1);
  assert.equal(empty.items.length, 0, "input state must not be mutated");

  const off = toggleItem(saved.state, "char", "國", "f0", 5678);
  assert.equal(off.saved, false);
  assert.equal(off.item, undefined);
  assert.deepEqual(off.state.items, []);
  // Ids stay monotonic: re-saving does not reuse i0.
  assert.equal(toggleItem(off.state, "char", "國", "f0", 9).item.id, "i1");
});

test("toggleItem keeps word and char identities apart, and refuses junk", () => {
  let state = normalizeSavedState(null);
  state = toggleItem(state, "word", "國", "f0", 1).state;
  const both = toggleItem(state, "char", "國", "f0", 2);
  assert.equal(both.saved, true);
  assert.equal(both.state.items.length, 2);

  const bad = toggleItem(both.state, "verb", "國", "f0", 3);
  assert.equal(bad.saved, false);
  assert.equal(bad.state.items.length, 2);
  assert.equal(toggleItem(both.state, "char", "", "f0", 3).saved, false);
});

test("toggleItem drops a new item in the default folder, falling back to f0", () => {
  const withFolder = createFolder(normalizeSavedState(null), "Verbs");
  assert.equal(withFolder.folder.id, "f1");
  assert.equal(toggleItem(withFolder.state, "word", "國民", "f1", 1).item.folderId, "f1");
  // A default folder that no longer exists must not strand the item.
  assert.equal(toggleItem(withFolder.state, "word", "國民", "f9", 1).item.folderId, "f0");
});

// --- checkKeys ------------------------------------------------------------

test("checkKeys answers every requested identity with a boolean", () => {
  const state = seedState();
  assert.deepEqual(
    checkKeys(state, [
      { kind: "char", key: "國" },
      { kind: "word", key: "國民" },
      { kind: "char", key: "民" },
      { kind: "word", key: "國" }, // same key, other kind: not saved
      null,
      { kind: "char" },
    ]),
    { "c:國": true, "w:國民": true, "c:民": false, "w:國": false }
  );
  assert.deepEqual(checkKeys(state, undefined), {});
});

// --- folder CRUD ----------------------------------------------------------

test("createFolder mints monotonic ids and refuses an empty name", () => {
  const first = createFolder(normalizeSavedState(null), "Verbs");
  assert.equal(first.error, null);
  assert.deepEqual(first.folder, { id: "f1", name: "Verbs" });

  const second = createFolder(first.state, "  Idioms  ");
  assert.deepEqual(second.folder, { id: "f2", name: "Idioms" });
  assert.deepEqual(second.state.folders, [
    { id: "f0", name: "Saved" },
    { id: "f1", name: "Verbs" },
    { id: "f2", name: "Idioms" },
  ]);

  const bad = createFolder(second.state, "   ");
  assert.equal(bad.folder, null);
  assert.equal(bad.error, "folder name required");
  assert.equal(bad.state.folders.length, 3);
});

test("renameFolder renames f0 too, but never to empty", () => {
  const state = createFolder(normalizeSavedState(null), "Verbs").state;

  const renamed = renameFolder(state, "f0", " Bookmarks ");
  assert.deepEqual(renamed.folder, { id: "f0", name: "Bookmarks" });
  assert.equal(renamed.error, null);
  assert.equal(state.folders[0].name, "Saved", "input state must not be mutated");

  assert.equal(renameFolder(state, "f0", "  ").error, "folder name required");
  assert.equal(renameFolder(state, "f9", "Nope").error, "no such folder");
  assert.equal(renameFolder(state, "f9", "Nope").folder, null);
});

test("deleteFolder refuses f0 and moves a deleted folder's items to f0", () => {
  let state = createFolder(seedState(), "Verbs").state; // f1
  state = moveItems(state, ["i0"], "f1").state;

  const refused = deleteFolder(state, "f0");
  assert.equal(refused.error, "the default folder cannot be deleted");
  assert.equal(refused.state.folders.length, 2);
  assert.equal(deleteFolder(state, "f9").error, "no such folder");

  const gone = deleteFolder(state, "f1");
  assert.equal(gone.error, null);
  assert.equal(gone.moved, 1);
  assert.deepEqual(gone.state.folders, [{ id: "f0", name: "Saved" }]);
  assert.ok(gone.state.items.every((i) => i.folderId === "f0"));
  assert.equal(gone.state.items.length, 2, "items survive their folder");
  // Deleting a folder never recycles its id.
  assert.equal(createFolder(gone.state, "Later").folder.id, "f2");
});

test("deleting the default folder resets the setting to f0", () => {
  const made = createFolder(normalizeSavedState(null), "Verbs");
  const settings = normalizeSettings({ defaultFolderId: "f1" }, made.state);
  assert.equal(settings.defaultFolderId, "f1", "a live folder stands");

  const gone = deleteFolder(made.state, "f1");
  assert.equal(normalizeSettings(settings, gone.state).defaultFolderId, "f0");
  // Without a state to check against, the stored value is taken at face value.
  assert.equal(normalizeSettings(settings).defaultFolderId, "f1");
});

// --- move / remove --------------------------------------------------------

test("moveItems re-homes only the named items, and only into a real folder", () => {
  const state = createFolder(seedState(), "Verbs").state; // f1

  const moved = moveItems(state, ["i0", "i9"], "f1");
  assert.equal(moved.error, null);
  assert.equal(moved.moved, 1);
  assert.deepEqual(
    moved.state.items.map((i) => [i.id, i.folderId]),
    [
      ["i0", "f1"],
      ["i1", "f0"],
    ]
  );
  // A move into the folder the item is already in changes nothing.
  assert.equal(moveItems(moved.state, ["i0"], "f1").moved, 0);

  const nowhere = moveItems(state, ["i0"], "f9");
  assert.equal(nowhere.error, "no such folder");
  assert.equal(nowhere.moved, 0);
  assert.deepEqual(nowhere.state.items[0].folderId, "f0");
});

test("removeItems drops the named ids and reports the count", () => {
  const state = seedState();
  const removed = removeItems(state, ["i1", "i9"]);
  assert.equal(removed.removed, 1);
  assert.deepEqual(removed.state.items.map((i) => i.id), ["i0"]);
  assert.equal(removeItems(state, []).removed, 0);
  assert.equal(removeItems(state, undefined).removed, 0);
  assert.equal(state.items.length, 2, "input state must not be mutated");
});

// --- export selection -----------------------------------------------------

test("resolveExportSelection takes ids, then folders, then all", () => {
  let state = createFolder(seedState(), "Verbs").state; // f1
  state = moveItems(state, ["i1"], "f1").state;
  const ids = (items) => items.map((i) => i.id);

  assert.deepEqual(ids(resolveExportSelection(state, { ids: ["i1"] })), ["i1"]);
  assert.deepEqual(ids(resolveExportSelection(state, { folderIds: ["f1"] })), ["i1"]);
  assert.deepEqual(ids(resolveExportSelection(state, { folderIds: ["f0", "f1"] })), [
    "i0",
    "i1",
  ]);
  assert.deepEqual(ids(resolveExportSelection(state, { all: true })), ["i0", "i1"]);
  // Explicit ids win over everything else.
  assert.deepEqual(
    ids(resolveExportSelection(state, { ids: ["i0"], folderIds: ["f1"], all: true })),
    ["i0"]
  );
  // Nothing asked for is nothing exported; the caller decides what a bare
  // "export" means.
  assert.deepEqual(resolveExportSelection(state, {}), []);
  assert.deepEqual(resolveExportSelection(state, undefined), []);
});

// --- join against live data ----------------------------------------------

test("joinItems joins words, chars, and marks entries the data no longer has", () => {
  const items = [
    { id: "i0", kind: "word", key: "國民", folderId: "f0", addedAt: 1 },
    { id: "i1", kind: "char", key: "國", folderId: "f0", addedAt: 2 },
    { id: "i2", kind: "word", key: "沒有", folderId: "f0", addedAt: 3 },
    { id: "i3", kind: "char", key: "沒", folderId: "f0", addedAt: 4 },
  ];
  const [word, char, deadWord, deadChar] = joinItems(items, data);

  assert.equal(word.hangul, "국민");
  assert.deepEqual(word.glosses, ["the people; citizens of a nation"]);
  assert.equal(word.rare, undefined);
  assert.equal(word.missing, undefined);
  assert.equal(word.id, "i0", "item fields ride along for the saved view");
  assert.equal(word.folderId, "f0");

  assert.deepEqual(char.eumhun, [{ hun: "나라", eum: "국" }]);
  assert.deepEqual(char.readings, ["국"]);
  assert.deepEqual(char.glosses, ["country; state; nation"]);
  assert.equal(char.lvl, "m");

  assert.equal(deadWord.missing, true);
  assert.equal(deadWord.key, "沒有");
  assert.equal(deadChar.missing, true);
});

test("joinItems merges homograph glosses, flags all-rare, and follows variants", () => {
  const rows = joinItems(
    [
      { id: "i0", kind: "word", key: "우리", folderId: "f0", addedAt: 1 },
      { id: "i1", kind: "word", key: "牛李", folderId: "f0", addedAt: 2 },
      { id: "i2", kind: "word", key: "安全", folderId: "f0", addedAt: 3 },
      { id: "i3", kind: "char", key: "国", folderId: "f0", addedAt: 4 },
    ],
    data
  );
  assert.equal(rows[0].missing, true, "a hangul spelling is not a words key");
  assert.equal(rows[1].rare, true);
  // 安全 has two senses; both glosses show, the hangul comes from the first.
  assert.deepEqual(rows[2].glosses, ["safety; security", "archaic sense"]);
  assert.equal(rows[2].hangul, "안전");
  assert.equal(rows[2].rare, undefined);
  // A variant glyph still resolves rather than reading as missing.
  assert.equal(rows[3].missing, undefined);
  assert.deepEqual(rows[3].readings, ["국"]);
});

// --- settings -------------------------------------------------------------

test("normalizeSettings fills the SPEC defaults and drops unknown tokens", () => {
  for (const junk of [undefined, null, 7, {}, { anki: "nope" }]) {
    assert.deepEqual(normalizeSettings(junk), {
      v: 1,
      defaultFolderId: "f0",
      anki: {
        wordFront: "hanja",
        wordBack: ["hangul", "defs"],
        charFront: "char",
        charBack: ["eumhun", "defs"],
      },
    });
  }

  const scrubbed = normalizeSettings({
    v: 99,
    defaultFolderId: "",
    anki: {
      wordFront: "lvl", // a char token: not valid on a word front
      wordBack: ["defs", "defs", "lvl", 7, "hanja"],
      charFront: "eumhun",
      charBack: "not an array",
    },
  });
  assert.equal(scrubbed.v, 1);
  assert.equal(scrubbed.defaultFolderId, "f0");
  assert.equal(scrubbed.anki.wordFront, "hanja");
  assert.deepEqual(scrubbed.anki.wordBack, ["defs", "hanja"]);
  assert.equal(scrubbed.anki.charFront, "eumhun");
  assert.deepEqual(scrubbed.anki.charBack, ["eumhun", "defs"]);
  // An emptied checkset is a real user choice and survives normalization.
  assert.deepEqual(normalizeSettings({ anki: { charBack: [] } }).anki.charBack, []);
});

test("a settings patch merges over the current record, one level into anki", () => {
  const current = normalizeSettings(null);
  // The shape background.js's settingsSet merge produces.
  const merged = normalizeSettings(
    {
      ...current,
      defaultFolderId: "f1",
      anki: { ...current.anki, wordFront: "hangul" },
    },
    { folders: [{ id: "f1", name: "Verbs" }] }
  );
  assert.equal(merged.defaultFolderId, "f1");
  assert.equal(merged.anki.wordFront, "hangul");
  assert.deepEqual(merged.anki.wordBack, ["hangul", "defs"], "siblings survive");
  assert.equal(merged.anki.charFront, "char");
  assert.equal(DEFAULT_SETTINGS.anki.wordFront, "hanja", "defaults stay defaults");
});

// --- Anki TSV -------------------------------------------------------------

const tsvLines = (tsv) => tsv.replace(/\n$/, "").split("\n");

test("buildAnkiTsv writes the directives, then Front TAB Back TAB Tag per item", () => {
  const rows = joinItems(
    [
      { id: "i0", kind: "word", key: "國民", folderId: "f0", addedAt: 1 },
      { id: "i1", kind: "char", key: "學", folderId: "f0", addedAt: 2 },
    ],
    data
  );
  const lines = tsvLines(buildAnkiTsv(rows, null, [{ id: "f0", name: "Saved" }]));

  assert.deepEqual(lines.slice(0, 3), [
    "#separator:tab",
    "#html:false",
    "#tags column:3",
  ]);
  // Word defaults: front hanja, back hangul + numbered defs, tag = folder.
  assert.equal(lines[3], "國民\t국민 · 1. the people; citizens of a nation\tSaved");
  // Char defaults: front char, back eumhun + numbered defs over ALL glosses.
  assert.equal(lines[4], "學\t배울 학 · 1. to learn; to study; 2. school; learning\tSaved");
  assert.equal(lines.length, 5);
  assert.ok(buildAnkiTsv(rows, null, []).endsWith("\n"));
});

test("the anki tag is the folder name, with whitespace runs as underscores", () => {
  const rows = joinItems(
    [
      { id: "i0", kind: "word", key: "國民", folderId: "f1", addedAt: 1 },
      { id: "i1", kind: "word", key: "學生", folderId: "f2", addedAt: 2 },
      { id: "i2", kind: "word", key: "國家", folderId: "f9", addedAt: 3 },
    ],
    data
  );
  const tags = tsvLines(
    buildAnkiTsv(rows, null, [
      { id: "f1", name: "HSK words  2" },
      { id: "f2", name: "  spaced\tout  " },
    ])
  )
    .slice(3)
    .map((line) => line.split("\t")[2]);

  // Anki splits tags on whitespace, so a multi-word folder must be one token.
  assert.deepEqual(tags, ["HSK_words_2", "spaced_out", "f9"]);
  // Front and back are untouched by the tag column.
  const line = tsvLines(buildAnkiTsv(rows, null, [{ id: "f1", name: "HSK words  2" }]))[3];
  assert.equal(line, "國民\t국민 · 1. the people; citizens of a nation\tHSK_words_2");
  // No folder list at all: the id stands in, like the CSV's folder column.
  assert.equal(tsvLines(buildAnkiTsv(rows, null))[3].split("\t")[2], "f1");
});

test("buildAnkiTsv renders the fields the settings ask for", () => {
  const rows = joinItems(
    [
      { id: "i0", kind: "word", key: "國民", folderId: "f0", addedAt: 1 },
      { id: "i1", kind: "char", key: "國", folderId: "f0", addedAt: 2 },
    ],
    data
  );
  const folders = [{ id: "f0", name: "Saved" }];
  const lines = tsvLines(
    buildAnkiTsv(
      rows,
      {
        anki: {
          wordFront: "hangul",
          wordBack: ["hanja", "defs"],
          charFront: "eumhun",
          charBack: ["char", "readings", "lvl"],
        },
      },
      folders
    )
  );
  assert.equal(lines[3], "국민\t國民 · 1. the people; citizens of a nation\tSaved");
  assert.equal(lines[4], "나라 국\t國 · 국 · m\tSaved");

  // A back set that renders nothing at all leaves an empty back field.
  const bare = tsvLines(buildAnkiTsv(rows, { anki: { wordBack: [] } }, folders));
  assert.equal(bare[3], "國民\t\tSaved");
});

test("buildAnkiTsv quotes tabs, quotes and newlines CSV-style, and skips missing rows", () => {
  const odd = {
    variants: { map: {} },
    hanja: { chars: {} },
    words: {
      words: {
        特殊: [{ hangul: "특수", glosses: ['R&D <special> "quoted" \'odd\''] }],
        分野: [{ hangul: "분야", glosses: ["field\ttabbed", "line\nbroken"] }],
      },
    },
  };
  const rows = joinItems(
    [
      { id: "i0", kind: "word", key: "特殊", folderId: "f0", addedAt: 1 },
      { id: "i1", kind: "word", key: "分野", folderId: "f0", addedAt: 2 },
      { id: "i2", kind: "word", key: "沒有", folderId: "f0", addedAt: 3 },
    ],
    odd
  );
  const tsv = buildAnkiTsv(rows, null, [{ id: "f0", name: 'a "tag"\there' }]);

  assert.ok(
    tsv.includes('特殊\t"특수 · 1. R&D <special> ""quoted"" \'odd\'"'),
    "an embedded double quote is doubled and the field is wrapped"
  );
  assert.ok(
    tsv.includes('分野\t"분야 · 1. field\ttabbed; 2. line\nbroken"'),
    "tab and newline force quoting too"
  );
  // The tag column obeys the same quoting rules; its whitespace (the space and
  // the tab) has already collapsed into underscores, so only the quotes are
  // left to escape.
  assert.ok(tsv.includes('\t"a_""tag""_here"'), "the tag is quoted like any field");
  // The missing row is skipped; the caller counts it (background.js reports it
  // as `skipped`). Asserted whole, since a quoted field may itself hold a
  // newline and line counting would lie.
  assert.equal(
    tsv,
    [
      "#separator:tab",
      "#html:false",
      "#tags column:3",
      '特殊\t"특수 · 1. R&D <special> ""quoted"" \'odd\'"\t"a_""tag""_here"',
      '分野\t"분야 · 1. field\ttabbed; 2. line\nbroken"\t"a_""tag""_here"',
    ].join("\n") + "\n"
  );
  assert.equal(rows.filter((r) => r.missing === true).length, 1);
  const directives = "#separator:tab\n#html:false\n#tags column:3\n";
  assert.deepEqual(buildAnkiTsv([], null, []), directives);
  assert.deepEqual(buildAnkiTsv(undefined, null, undefined), directives);
});

// --- CSV export ----------------------------------------------------------

test("buildCsv writes the header and every column, whatever the anki settings", () => {
  const folders = [
    { id: "f0", name: "Saved" },
    { id: "f1", name: "Verbs" },
  ];
  const rows = joinItems(
    [
      { id: "i0", kind: "word", key: "國民", folderId: "f1", addedAt: Date.UTC(2026, 7, 17) },
      { id: "i1", kind: "char", key: "學", folderId: "f0", addedAt: Date.UTC(2025, 0, 2) },
    ],
    data
  );
  const lines = buildCsv(rows, folders).replace(/\n$/, "").split("\n");

  assert.deepEqual(CSV_COLUMNS, [
    "kind",
    "key",
    "hangul",
    "eumhun",
    "readings",
    "definitions",
    "level",
    "folder",
    "added",
  ]);
  assert.equal(lines[0], "kind,key,hangul,eumhun,readings,definitions,level,folder,added");
  // A word has no eumhun/readings/level; the columns stay in place, empty.
  assert.equal(
    lines[1],
    "word,國民,국민,,,1. the people; citizens of a nation,,Verbs,2026-08-17"
  );
  // A char has no hangul; the folder name is resolved, not the id.
  assert.equal(
    lines[2],
    "char,學,,배울 학,학,1. to learn; to study; 2. school; learning,m,Saved,2025-01-02"
  );
  assert.equal(lines.length, 3);
});

test("buildCsv quotes commas, quotes and newlines RFC-4180 style", () => {
  const odd = {
    variants: { map: {} },
    hanja: { chars: {} },
    words: {
      words: {
        特殊: [{ hangul: "특수", glosses: ['R&D <special> "quoted" \'odd\''] }],
        分野: [{ hangul: "분야", glosses: ["field, comma'd", "line\nbroken"] }],
        沒有: [{ hangul: "몰유", glosses: ["gone"] }],
      },
    },
  };
  const csv = buildCsv(
    joinItems(
      [
        { id: "i0", kind: "word", key: "特殊", folderId: "f0", addedAt: 0 },
        { id: "i1", kind: "word", key: "分野", folderId: "f2", addedAt: 0 },
        { id: "i2", kind: "word", key: "沒有", folderId: "f0", addedAt: 0 },
      ],
      odd
    ),
    [{ id: "f0", name: 'The "big" list, part 2' }]
  );

  const lines = csv.replace(/\n$/, "").split("\n");
  assert.equal(
    lines[1],
    'word,特殊,특수,,,"1. R&D <special> ""quoted"" \'odd\'",,"The ""big"" list, part 2",'
  );
  // An embedded newline lives inside the quoted field, so this row spans two
  // physical lines; the unresolved folder falls back to its id.
  assert.equal(lines[2], 'word,分野,분야,,,"1. field, comma\'d; 2. line');
  assert.equal(lines[3], 'broken",,f2,');
  assert.equal(lines[4], "word,沒有,몰유,,,1. gone,,\"The \"\"big\"\" list, part 2\",");
  // addedAt 0 (an item normalized from junk) leaves the date column empty.
  assert.ok(lines[1].endsWith(","));
});

test("buildCsv skips missing rows and survives junk input", () => {
  const rows = joinItems(
    [
      { id: "i0", kind: "word", key: "國民", folderId: "f0", addedAt: 1 },
      { id: "i1", kind: "word", key: "沒有", folderId: "f0", addedAt: 2 },
      { id: "i2", kind: "char", key: "沒", folderId: "f0", addedAt: 3 },
    ],
    data
  );
  const csv = buildCsv(rows, [{ id: "f0", name: "Saved" }]);
  assert.equal(csv.replace(/\n$/, "").split("\n").length, 2, "header + the one live row");
  assert.ok(!csv.includes("沒"));
  assert.equal(rows.filter((r) => r.missing === true).length, 2);

  const header = `${CSV_COLUMNS.join(",")}\n`;
  assert.equal(buildCsv([], []), header);
  assert.equal(buildCsv(undefined, undefined), header);
  // No folder list at all: the id stands in for the name.
  assert.ok(buildCsv(rows, undefined).includes(",f0,"));
});

// --- background.js: still importable without chrome globals --------------

await testAsync("background.js imports cleanly in Node (guards hold)", async () => {
  assert.equal(typeof globalThis.chrome, "undefined", "no chrome shim in the test env");
  const bg = await import("../extension/background.js");
  const exported = [
    "handleLookup",
    "handleCompounds",
    "handleUsedIn",
    "handleOpenTab",
    "handleGetPendingQuery",
    "setPendingQuery",
    "handleSavedGet",
    "handleSavedToggle",
    "handleSavedCheck",
    "handleSavedRemove",
    "handleSavedMove",
    "handleFolderCreate",
    "handleFolderRename",
    "handleFolderDelete",
    "handleSettingsGet",
    "handleSettingsSet",
    "handleSavedExport",
  ];
  for (const fn of exported) {
    assert.equal(typeof bg[fn], "function", `background.js should export ${fn}`);
  }
});

// --- decomposition: the worker's guard and its join ----------------------

await testAsync("decomp: a missing or wrong-version file leaves an empty table", async () => {
  const { guardDecomp } = await import("../extension/background.js");
  assert.deepEqual(guardDecomp(null), { v: 1, parts: {} });
  assert.deepEqual(guardDecomp("nonsense"), { v: 1, parts: {} });
  assert.deepEqual(guardDecomp({ v: 2, parts: { "依": [["衣"]] } }), { v: 1, parts: {} });
  assert.deepEqual(guardDecomp({ v: 1 }), { v: 1, parts: {} });
});

await testAsync("decomp: rows are joined onto char matches, targets resolved", async () => {
  const { attachDecomp, guardDecomp } = await import("../extension/background.js");
  const decomp = guardDecomp({
    v: 1,
    parts: {
      "依": [["亻", "人"], ["衣"]],
      "疑": [["匕"], ["龴", null], ["㇒", null, "downward stroke"]],
      "乁": [["丿", "丿"]],            // target with no dictionary entry
    },
  });
  // The real hanja.json shape: chars under a `chars` key, version beside it.
  // A bare table here once hid a join bug that degraded every part to an
  // inert glyph in the shipped extension.
  const hanja = {
    version: 1,
    chars: {
      "人": { eumhun: [{ hun: "사람", eum: "인" }], glosses: ["person; human"] },
      "衣": { eumhun: [{ hun: "옷", eum: "의" }], glosses: ["clothing"] },
      "匕": { eumhun: [], glosses: [] },
    },
  };
  const matches = [
    { kind: "char", canonical: "依" },
    { kind: "char", canonical: "疑" },
    { kind: "char", canonical: "乁" },
    { kind: "char", canonical: "一" },                       // no entry
    { kind: "word", canonical: "依存", parts: [{ type: "word" }] },
  ];
  const out = attachDecomp({ ok: true, matches }, { decomp, hanja });
  const [uy, ui, ye, il, word] = out.matches;

  // Alias: the display glyph stays 亻, the reading comes from 人.
  assert.deepEqual(uy.parts, [
    { g: "亻", t: "人", hun: "사람", eum: "인", gloss: "person; human" },
    { g: "衣", t: "衣", hun: "옷", eum: "의", gloss: "clothing" },
  ]);
  // Reading-less rows carry no target, and a name only when the data has one.
  assert.deepEqual(ui.parts, [
    { g: "匕", t: "匕", hun: "", eum: "", gloss: "" },
    { g: "龴" },
    { g: "㇒", name: "downward stroke" },
  ]);
  // A target outside the dictionary degrades to an inert row.
  assert.deepEqual(ye.parts, [{ g: "丿" }]);
  assert.equal("parts" in il, false);
  // Word `parts` (component words) are a different field on a different kind.
  assert.deepEqual(word.parts, [{ type: "word" }]);
});

// --- saved words: every handler answers when there is no chrome.storage ---

await testAsync("without chrome.storage every saved handler answers 'unavailable'", async () => {
  const bg = await import("../extension/background.js");
  const unavailable = { ok: false, error: "storage unavailable" };

  assert.deepEqual(await bg.handleSavedGet(), unavailable);
  assert.deepEqual(await bg.handleSavedToggle("char", "國"), unavailable);
  assert.deepEqual(await bg.handleSavedCheck([{ kind: "char", key: "國" }]), unavailable);
  assert.deepEqual(await bg.handleSavedRemove(["i0"]), unavailable);
  assert.deepEqual(await bg.handleSavedMove(["i0"], "f1"), unavailable);
  assert.deepEqual(await bg.handleFolderCreate("Verbs"), unavailable);
  assert.deepEqual(await bg.handleFolderRename("f1", "Verbs"), unavailable);
  assert.deepEqual(await bg.handleFolderDelete("f1"), unavailable);
  assert.deepEqual(await bg.handleSettingsGet(), unavailable);
  assert.deepEqual(await bg.handleSettingsSet({ defaultFolderId: "f1" }), unavailable);
  assert.deepEqual(await bg.handleSavedExport({ all: true }), unavailable);
  // Both export formats stop at the same guard.
  assert.deepEqual(await bg.handleSavedExport({ all: true }, "csv"), unavailable);
  assert.deepEqual(await bg.handleSavedExport({ all: true }, "anki"), unavailable);
});

await testAsync("the router carries every SPEC message type", async () => {
  const { MESSAGE_HANDLERS } = await import("../extension/background.js");
  const types = [
    "lookup",
    "compounds",
    "usedIn",
    "openTab",
    "getPendingQuery",
    "savedGet",
    "savedToggle",
    "savedCheck",
    "savedRemove",
    "savedMove",
    "folderCreate",
    "folderRename",
    "folderDelete",
    "settingsGet",
    "settingsSet",
    "savedExport",
  ];
  assert.deepEqual(Object.keys(MESSAGE_HANDLERS).sort(), types.slice().sort());
  // Routed saved messages reach the storage guard, not a crash.
  for (const type of types.filter((t) => t.startsWith("saved") || t.startsWith("folder") ||
    t.startsWith("settings"))) {
    assert.deepEqual(await MESSAGE_HANDLERS[type]({ type }), {
      ok: false,
      error: "storage unavailable",
    });
  }
  // The export format rides on the message; an absent one means "anki".
  assert.deepEqual(
    await MESSAGE_HANDLERS.savedExport({ type: "savedExport", all: true, format: "csv" }),
    { ok: false, error: "storage unavailable" }
  );
});

// --- sidebar addendum: the omnibox -> panel pending query is read-once -----

await testAsync("pending query is handed over once, then cleared", async () => {
  const { setPendingQuery, handleGetPendingQuery } = await import("../extension/background.js");

  assert.deepEqual(await handleGetPendingQuery(), { ok: true, query: null });

  setPendingQuery("國民");
  assert.deepEqual(await handleGetPendingQuery(), { ok: true, query: "國民" });
  // Read-once: a second panel open must not re-run the old search.
  assert.deepEqual(await handleGetPendingQuery(), { ok: true, query: null });

  // The omnibox fallback path clears it the same way.
  setPendingQuery("國");
  setPendingQuery(null);
  assert.deepEqual(await handleGetPendingQuery(), { ok: true, query: null });
});

/* ---------------------------------------------------------------------------
 * QWERTY-to-hangul (한영타 변환) — extension/dubeolsik.js
 * ------------------------------------------------------------------------- */

test("the key map covers the layout, unshifted and shifted", () => {
  // One syllable per key, so a wrong cell shows up as a wrong glyph rather
  // than as a plausible-looking neighbour.
  assert.equal(qwertyToHangul("rk"), "가");
  assert.equal(qwertyToHangul("sk"), "나");
  assert.equal(qwertyToHangul("ek"), "다");
  assert.equal(qwertyToHangul("fk"), "라");
  assert.equal(qwertyToHangul("ak"), "마");
  assert.equal(qwertyToHangul("qk"), "바");
  assert.equal(qwertyToHangul("tk"), "사");
  assert.equal(qwertyToHangul("dk"), "아");
  assert.equal(qwertyToHangul("wk"), "자");
  assert.equal(qwertyToHangul("ck"), "차");
  assert.equal(qwertyToHangul("zk"), "카");
  assert.equal(qwertyToHangul("xk"), "타");
  assert.equal(qwertyToHangul("vk"), "파");
  assert.equal(qwertyToHangul("gk"), "하");
  // Every vowel key, against the same initial.
  assert.equal(
    qwertyToHangul("rk ro ri rO rj rp ru rP rh ry rn rb rm rl"),
    "가 개 갸 걔 거 게 겨 계 고 교 구 규 그 기"
  );
  // The seven shifted keys are their own jamo, not their lowercase twins.
  assert.equal(qwertyToHangul("Qk Wk Ek Rk Tk"), "빠 짜 따 까 싸");
  assert.equal(qwertyToHangul("rO rP"), "걔 계");
});

test("any other uppercase letter is just its lowercase key", () => {
  // 하늘 uses none of the seven shifted keys, so caps lock changes nothing.
  assert.equal(qwertyToHangul("gksmf"), "하늘");
  assert.equal(qwertyToHangul("GKSMF"), "하늘");
  assert.equal(qwertyToHangul("GkSmF"), "하늘");
  // Where a letter IS a shifted key, the two cases genuinely differ: the R of
  // 한국 is ㄱ, but a capital R is ㄲ.
  assert.equal(qwertyToHangul("gksrnr"), "한국");
  assert.equal(qwertyToHangul("GKSRNR"), "한꾺");
  assert.equal(qwertyToHangul("gkrtod"), "학생");
  assert.equal(qwertyToHangul("GKRTOD"), "핚썡");
});

test("compound vowels fuse", () => {
  assert.equal(qwertyToHangul("rhk"), "과");   // ㅗ + ㅏ = ㅘ
  assert.equal(qwertyToHangul("rho"), "괘");   // ㅗ + ㅐ = ㅙ
  assert.equal(qwertyToHangul("rhl"), "괴");   // ㅗ + ㅣ = ㅚ
  assert.equal(qwertyToHangul("rnj"), "궈");   // ㅜ + ㅓ = ㅝ
  assert.equal(qwertyToHangul("rnp"), "궤");   // ㅜ + ㅔ = ㅞ
  assert.equal(qwertyToHangul("rnl"), "귀");   // ㅜ + ㅣ = ㅟ
  assert.equal(qwertyToHangul("rml"), "긔");   // ㅡ + ㅣ = ㅢ
  // A pair the layout does NOT fuse simply starts a new syllable.
  assert.equal(qwertyToHangul("rkl"), "가ㅣ");
});

test("compound finals fuse", () => {
  assert.equal(qwertyToHangul("rkrt"), "갃");
  assert.equal(qwertyToHangul("rksw"), "갅");
  assert.equal(qwertyToHangul("rksg"), "갆");
  assert.equal(qwertyToHangul("rkfr"), "갉");
  assert.equal(qwertyToHangul("rkfa"), "갊");
  assert.equal(qwertyToHangul("rkfq"), "갋");
  assert.equal(qwertyToHangul("rkft"), "갌");
  assert.equal(qwertyToHangul("rkfx"), "갍");
  assert.equal(qwertyToHangul("rkfv"), "갎");
  assert.equal(qwertyToHangul("rkfg"), "갏");
  assert.equal(qwertyToHangul("rkqt"), "값");
});

test("ㄲ and ㅆ are legal finals; ㄸ ㅃ ㅉ never are", () => {
  assert.equal(qwertyToHangul("dlT"), "있");
  assert.equal(qwertyToHangul("qkR"), "밖");
  // A double that cannot close a syllable opens the next one instead.
  assert.equal(qwertyToHangul("rkE"), "가ㄸ");
  assert.equal(qwertyToHangul("rkEk"), "가따");
});

test("a final hands itself to the next syllable when a vowel follows", () => {
  // The headline case: 생일, not 샹딜.
  assert.equal(qwertyToHangul("toddlf"), "생일");
  assert.equal(qwertyToHangul("tkfka"), "사람");
  assert.equal(qwertyToHangul("dkssudgktpdy"), "안녕하세요");
  // A DOUBLED final moves whole, since it is one jamo.
  assert.equal(qwertyToHangul("dlTj"), "이써");
  // A COMPOUND final splits: ㄺ leaves ㄹ behind and sends ㄱ on.
  assert.equal(qwertyToHangul("ekfr"), "닭");
  assert.equal(qwertyToHangul("ekfrl"), "달기");
  assert.equal(qwertyToHangul("Qkfrka"), "빨감");
  // No vowel follows, so nothing is handed off and the syllable just ends.
  assert.equal(qwertyToHangul("dlTdj"), "있어");
});

test("jamo that never complete a syllable emit as themselves", () => {
  assert.equal(qwertyToHangul("r"), "ㄱ");
  assert.equal(qwertyToHangul("k"), "ㅏ");
  assert.equal(qwertyToHangul("rt"), "ㄱㅅ");
  assert.equal(qwertyToHangul("rr"), "ㄱㄱ");
  assert.equal(qwertyToHangul("kk"), "ㅏㅏ");
  // A bare pair still fuses where the layout fuses it.
  assert.equal(qwertyToHangul("ml"), "ㅢ");
  assert.equal(qwertyToHangul("hk"), "ㅘ");
  // A trailing consonant after a finished syllable is a tail, not a loss.
  assert.equal(qwertyToHangul("rkr"), "각");
  assert.equal(qwertyToHangul("rkrr"), "각ㄱ");
});

test("characters the layout has no key for pass straight through", () => {
  assert.equal(qwertyToHangul("rk rk"), "가 가");
  assert.equal(qwertyToHangul("rk1"), "가1");
  assert.equal(qwertyToHangul(""), "");
  assert.equal(qwertyToHangul(null), "");
  assert.equal(qwertyToHangul(undefined), "");
  assert.equal(qwertyToHangul(42), "");
});

test("only pure-Latin queries are read as mistyped hangul", () => {
  assert.equal(isLatinQuery("toddlf"), true);
  assert.equal(isLatinQuery("GKRTOD"), true);
  assert.equal(isLatinQuery("생일"), false);
  assert.equal(isLatinQuery("國民"), false);
  assert.equal(isLatinQuery("hj toddlf"), false);   // a space disqualifies it
  assert.equal(isLatinQuery("toddlf1"), false);
  assert.equal(isLatinQuery("國民abc"), false);
  assert.equal(isLatinQuery(""), false);
  assert.equal(isLatinQuery(null), false);
});

// --- romanized search ADDENDUM: the two interpreters -----------------------

const interpreted = (text) => lookup(text, data, { interpret: true });
const kinds = (response) => (response.interpretations || []).map((i) => i.kind);

test("the input-channel rule: interpretation only happens when asked", () => {
  // A literal lookup of Latin text finds nothing, exactly as it did before the
  // QWERTY feature. This is what every internal navigation gets.
  assert.deepEqual(lookup("tkrl", data), { ok: true, matches: [] });
  assert.deepEqual(lookup("gukmin", data), { ok: true, matches: [] });
  assert.equal("interpretations" in lookup("tkrl", data), false);
  // Absent, null and non-object options are all literal.
  assert.deepEqual(lookup("tkrl", data, null).matches, []);
  assert.deepEqual(lookup("tkrl", data, {}).matches, []);
  assert.deepEqual(lookup("tkrl", data, { interpret: false }).matches, []);
  // And the flag changes the answer, so the tests above prove something.
  assert.ok(interpreted("tkrl").matches.length > 0);
  // The separator-bearing spellings are literal-empty too.
  for (const written of ["guk-min", "guk min", "han'gul"]) {
    assert.deepEqual(lookup(written, data), { ok: true, matches: [] }, written);
  }
  // Non-Latin input is never interpreted, flag or no flag.
  assert.equal("interpretations" in interpreted("國民"), false);
  assert.equal("interpretations" in interpreted("국민"), false);
  assert.equal("interpretations" in interpreted("國民abc"), false);
  assert.deepEqual(interpreted("國民").matches, lookup("國民", data).matches);
});

test("the interpreted-query gate: letters plus syllable separators", () => {
  assert.equal(isInterpretableQuery("gukmin"), true);
  assert.equal(isInterpretableQuery("guk-min"), true);
  assert.equal(isInterpretableQuery("guk min"), true);
  assert.equal(isInterpretableQuery("han'gul"), true);
  assert.equal(isInterpretableQuery("Seoul-Dae Hak-Kyo"), true);
  assert.equal(isInterpretableQuery("a"), true);
  // At least one letter, and it has to lead: separators alone are not a query.
  assert.equal(isInterpretableQuery("- -"), false);
  assert.equal(isInterpretableQuery("-"), false);
  assert.equal(isInterpretableQuery("'"), false);
  assert.equal(isInterpretableQuery(" "), false);
  assert.equal(isInterpretableQuery("-guk"), false);
  assert.equal(isInterpretableQuery(""), false);
  // Anything else still disqualifies the query.
  assert.equal(isInterpretableQuery("guk1"), false);
  assert.equal(isInterpretableQuery("國民"), false);
  assert.equal(isInterpretableQuery("國民abc"), false);
  assert.equal(isInterpretableQuery("guk.min"), false);
  assert.equal(isInterpretableQuery(null), false);
  // A separators-only query is not interpreted even with the flag set, and
  // the Dubeolsik generator never throws on separator-bearing input.
  for (const junk of ["- -", "-", "  '  ", "---"]) {
    assert.deepEqual(lookup(junk, data, { interpret: true }), { ok: true, matches: [] }, junk);
  }
  assert.deepEqual(buildInterpretations("- -", data), []);
  assert.deepEqual(buildInterpretations("zz-zz z'z", data), []);
});

test("romanization normalization strips case, hyphens, apostrophes, spaces", () => {
  assert.equal(normalizeRomanization("Guk-Min"), "gukmin");
  assert.equal(normalizeRomanization("han'gul"), "hangul");
  assert.equal(normalizeRomanization("han’gul"), "hangul");
  assert.equal(normalizeRomanization("  GUK MIN "), "gukmin");
  assert.equal(normalizeRomanization(""), "");
  assert.equal(normalizeRomanization(null), "");
});

test("variant expansion is bounded and applies each rule", () => {
  // (a) the normalized form is always first and always present.
  assert.deepEqual(romanizationVariants("gukmin"), ["gukmin"]);
  // (b) a leading k/t/p devoices, one variant each.
  assert.deepEqual(romanizationVariants("kukmin"), ["kukmin", "gukmin"]);
  assert.deepEqual(romanizationVariants("taehan"), ["taehan", "daehan"]);
  assert.deepEqual(romanizationVariants("pusan"), ["pusan", "busan"]);
  // A non-leading k is untouched.
  assert.deepEqual(romanizationVariants("hanguk"), ["hanguk"]);
  // (c) oo → u, every occurrence at once.
  assert.deepEqual(romanizationVariants("moo"), ["moo", "mu"]);
  assert.deepEqual(romanizationVariants("mooboo"), ["mooboo", "mubu"]);
  // (d) sh before a vowel → s; sh elsewhere is left alone.
  assert.deepEqual(romanizationVariants("shin"), ["shin", "sin"]);
  assert.deepEqual(romanizationVariants("shhh"), ["shhh"]);
  // Rules combine, and the combination stays inside the cap.
  assert.deepEqual(romanizationVariants("kooshi"), [
    "kooshi",
    "gooshi",
    "kushi",
    "gushi",
    "koosi",
    "goosi",
    "kusi",
    "gusi",
  ]);
  assert.equal(romanizationVariants("kooshi").length, MAX_RR_VARIANTS);
  // Pathological input does not blow up: three binary rules, cap honored.
  const long = "koo".repeat(50) + "shi".repeat(50);
  assert.ok(romanizationVariants(long).length <= MAX_RR_VARIANTS);
  assert.equal(romanizationVariants("").length, 0);
  assert.equal(romanizationVariants(null).length, 0);
});

test("the rr map drives the romanization interpreter", () => {
  // All three RR forms of 국민 are index keys and all three land on 국민.
  for (const form of ["gukmin", "gungmin", "gugmin"]) {
    const r = interpreted(form);
    assert.deepEqual(kinds(r), ["rr"], form);
    assert.deepEqual(r.interpretations[0], {
      kind: "rr",
      from: form,
      to: "국민",
      start: 0,
    });
    // The candidate ran the NORMAL lookup, so it is the ordinary word answer.
    assert.deepEqual(r.matches, lookup("국민", data).matches);
  }
  // Case and the syllable-boundary punctuation all normalize into one key.
  assert.deepEqual(interpreted("GukMin").matches, interpreted("gukmin").matches);
  for (const written of ["guk-min", "guk min", "Guk-Min", "guk'min", "GUK MIN"]) {
    assert.deepEqual(
      interpreted(written).matches,
      interpreted("gukmin").matches,
      `${written} should read like gukmin`
    );
    assert.deepEqual(kinds(interpreted(written)), ["rr"], written);
    assert.equal(interpreted(written).interpretations[0].from, written.trim());
  }
  // Trailing separators are trimmed away before the gate sees them.
  assert.deepEqual(interpreted("  gukmin  ").matches, interpreted("gukmin").matches);
  // A variant reaches the index: kukmin → gukmin → 국민.
  const k = interpreted("kukmin");
  assert.deepEqual(kinds(k), ["rr"]);
  assert.deepEqual(k.matches, lookup("국민", data).matches);
  // A syllable key takes the reading path, not the word path.
  const syllable = interpreted("guk");
  assert.deepEqual(kinds(syllable), ["rr"]);
  assert.equal(syllable.matches[0].kind, "reading");
  assert.equal(syllable.matches[0].eum, "국");
  assert.deepEqual(syllable.matches, lookup("국", data).matches);
  // An rr map with nothing to say (or no rr map at all) simply drops out.
  assert.equal("interpretations" in lookup("gukmin", { hanja, words, variants }, { interpret: true }), false);
});

test("merge matrix: dubeolsik-only, rr-only, both, neither", () => {
  // dubeolsik only — 사기전 is in the fixture, "tkrlwjs" is in no rr map.
  const d = interpreted("tkrlwjs");
  assert.deepEqual(kinds(d), ["dubeolsik"]);
  assert.deepEqual(d.interpretations[0], {
    kind: "dubeolsik",
    from: "tkrlwjs",
    to: "사기전",
    start: 0,
  });
  assert.deepEqual(d.matches, lookup("사기전", data).matches);

  // rr only — "gungmin" is jamo soup on the Dubeolsik side.
  assert.deepEqual(kinds(interpreted("gungmin")), ["rr"]);

  // both — one group after the other, `start` pointing at the seam.
  const both = interpreted("gkrtod");
  assert.equal(both.interpretations.length, 2);
  assert.equal(both.interpretations[0].start, 0);
  assert.equal(
    both.interpretations[1].start,
    both.interpretations[0].kind === "rr"
      ? lookup("국민", data).matches.length
      : lookup("학생", data).matches.length
  );
  assert.equal(both.matches.length, both.interpretations[1].start +
    (both.interpretations[1].kind === "rr"
      ? lookup("국민", data).matches.length
      : lookup("학생", data).matches.length));

  // neither
  assert.deepEqual(interpreted("zzz"), { ok: true, matches: [] });
  assert.deepEqual(interpreted("abcdefg"), { ok: true, matches: [] });
});

test("preference: lowest f wins between two word interpretations", () => {
  // gkrtod → 학생 (f 5) on the keyboard, 국민 (f 1) romanized.
  const rrFirst = interpreted("gkrtod");
  assert.deepEqual(kinds(rrFirst), ["rr", "dubeolsik"]);
  assert.deepEqual(rrFirst.interpretations, [
    { kind: "rr", from: "gkrtod", to: "국민", start: 0 },
    {
      kind: "dubeolsik",
      from: "gkrtod",
      to: "학생",
      start: lookup("국민", data).matches.length,
    },
  ]);
  assert.deepEqual(rrFirst.matches, [
    ...lookup("국민", data).matches,
    ...lookup("학생", data).matches,
  ]);

  // The mirror image: rnrals → 국민 on the keyboard, 학생 romanized.
  const dubeolsikFirst = interpreted("rnrals");
  assert.deepEqual(kinds(dubeolsikFirst), ["dubeolsik", "rr"]);
  assert.deepEqual(dubeolsikFirst.matches, [
    ...lookup("국민", data).matches,
    ...lookup("학생", data).matches,
  ]);

  // A ranked word beats an unranked one: tkrl → 사기 (no f) vs 국민 (f 1).
  assert.deepEqual(kinds(interpreted("tkrl")), ["rr", "dubeolsik"]);
});

test("preference: a word interpretation beats a syllable-only one", () => {
  // rnr → 국, a reading list, on the keyboard; 학생, a word, romanized.
  const r = interpreted("rnr");
  assert.deepEqual(kinds(r), ["rr", "dubeolsik"]);
  assert.equal(r.matches[0].kind, "word");
  assert.equal(r.matches[r.interpretations[1].start].kind, "reading");
});

test("preference: reading vs reading compares compound counts", () => {
  // gkr → 학 (學, cw 3) on the keyboard; 국 (國, cw 4) romanized.
  const r = interpreted("gkr");
  assert.deepEqual(kinds(r), ["rr", "dubeolsik"]);
  assert.deepEqual(r.matches, [...lookup("국", data).matches, ...lookup("학", data).matches]);
});

test("preference: a remaining tie goes to Dubeolsik", () => {
  // tk → 사 on the keyboard, 기 romanized. Both are reading lists and neither
  // side's candidates carry a cw index, so nothing separates them.
  const r = interpreted("tk");
  assert.deepEqual(kinds(r), ["dubeolsik", "rr"]);
  assert.deepEqual(r.matches, [...lookup("사", data).matches, ...lookup("기", data).matches]);
});

test("buildInterpretations returns the groups the response is built from", () => {
  assert.deepEqual(buildInterpretations("國民", data), []);
  assert.deepEqual(buildInterpretations("", data), []);
  const two = buildInterpretations("gkrtod", data);
  assert.deepEqual(two.map((i) => [i.kind, i.to]), [["rr", "국민"], ["dubeolsik", "학생"]]);
  // Trimming and NFC happen here, so surrounding whitespace is invisible.
  assert.deepEqual(
    buildInterpretations("  gkrtod  ", data).map((i) => i.from),
    ["gkrtod", "gkrtod"]
  );
  assert.deepEqual(interpreted("  gkrtod  ").matches, interpreted("gkrtod").matches);
});

test("omnibox suggestions run the same generators, deduped and capped", () => {
  const omni = (text) => buildOmniboxSuggestions(text, data, { interpret: true });
  // Single interpretation: byte for byte the hangul query's rows.
  assert.deepEqual(omni("tkrlwjs"), buildOmniboxSuggestions("사기전", data));
  assert.deepEqual(omni("gukmin"), buildOmniboxSuggestions("국민", data));
  // `content` stays the canonical searchable string, never what was typed.
  const rows = omni("gukmin");
  assert.ok(rows.length > 0);
  assert.equal(rows[0].content, "國民");
  assert.ok(rows.every((r) => !/[A-Za-z]/.test(r.content)));
  // Dual: the preferred group's rows come first, and the cap still holds.
  const dual = omni("gkrtod");
  assert.equal(dual[0].content, "國民");
  assert.ok(dual.some((r) => r.content === "學生"));
  assert.ok(dual.length <= MAX_OMNIBOX_SUGGESTIONS);
  // Dedupe by content: 국민 romanized and 국민 typed on the keyboard produce
  // one row, not two. (rnr's rr side is 학생; tkrl's is 국민.)
  const contents = omni("tkrl").map((r) => r.content);
  assert.deepEqual(contents, [...new Set(contents)]);
  // The omnibox shares the widened gate.
  assert.deepEqual(omni("guk-min"), buildOmniboxSuggestions("국민", data));
  assert.deepEqual(omni("guk min"), buildOmniboxSuggestions("국민", data));
  // The channel rule applies here too.
  assert.deepEqual(buildOmniboxSuggestions("gukmin", data), []);
  assert.deepEqual(buildOmniboxSuggestions("guk-min", data), []);
  assert.deepEqual(omni("zzz"), []);
  assert.deepEqual(omni("- -"), []);
});

// --- optional smoke test against Agent A's real corpus -------------------
// Read-only, and skipped (not failed) if the files are absent.

const dataDir = join(dirname(fileURLToPath(import.meta.url)), "..", "extension", "data");

await testAsync("smoke: real extension/data corpus resolves 國民 / 国 / 국민", async () => {
  let real;
  try {
    const [h, w, v, r] = await Promise.all([
      readFile(join(dataDir, "hanja.json"), "utf8"),
      readFile(join(dataDir, "words.json"), "utf8"),
      readFile(join(dataDir, "variants.json"), "utf8"),
      readFile(join(dataDir, "rr.json"), "utf8"),
    ]);
    real = {
      hanja: JSON.parse(h),
      words: JSON.parse(w),
      variants: JSON.parse(v),
      rr: JSON.parse(r),
    };
  } catch (err) {
    // Absent, or Agent A is mid-rebuild (truncated/partial JSON). Neither is a
    // failure of the lookup logic — the inline-fixture tests above cover that.
    console.log(`      (skipped — extension/data unreadable: ${err.code || err.name})`);
    return;
  }

  const kind = real.hanja.placeholder ? "fixture" : "real";
  const wordMatch = lookup("國民", real).matches.find((m) => m.kind === "word");
  assert.ok(wordMatch, `${kind} data: 國民 should produce a word match`);
  assert.equal(wordMatch.hangul, "국민");
  assert.deepEqual(wordMatch.chars, ["國", "民"]);

  const variantMatch = lookup("国", real).matches[0];
  assert.ok(variantMatch, `${kind} data: 国 should resolve via variants.map`);
  assert.equal(variantMatch.canonical, "國");

  // Han-char threshold correction, verified against whatever data is shipped.
  const withParticle = lookup("國民이라는", real);
  assert.deepEqual(
    canonicals(charsOf(withParticle.matches)).slice(0, 2),
    ["國", "民"],
    `${kind} data: 國民이라는 must still return the 國/民 char cards`
  );

  // QWERTY + romanized ADDENDA against the real corpus: the headline cases
  // only work if the interpreters and the dictionary agree, which no fixture
  // can prove.
  const say = (text) => lookup(text, real, { interpret: true });

  // toddlf → 생일: Dubeolsik alone, no romanization collision.
  const typed = say("toddlf");
  assert.deepEqual(
    typed.interpretations,
    [{ kind: "dubeolsik", from: "toddlf", to: "생일", start: 0 }],
    `${kind} data: toddlf should be read as 생일 and nothing else`
  );
  const birthday = typed.matches.find((m) => m.kind === "word");
  assert.ok(birthday, `${kind} data: toddlf should find a word match`);
  assert.equal(birthday.hangul, "생일");
  assert.deepEqual(lookup("생일", real).matches, typed.matches);
  const typedRows = buildOmniboxSuggestions("toddlf", real, { interpret: true });
  assert.ok(typedRows.length > 0, `${kind} data: toddlf should suggest something`);
  assert.deepEqual(
    typedRows,
    buildOmniboxSuggestions("생일", real),
    `${kind} data: the omnibox reads the input on the same rule`
  );
  assert.ok(
    typedRows.every((r) => !/[A-Za-z]/.test(r.content)),
    `${kind} data: suggestion content stays the canonical searchable string`
  );
  // The project's own name, typed the same way.
  assert.equal(say("dhrvus").interpretations[0].to, "옥편");
  assert.ok(
    say("dhrvus").matches.some((m) => m.canonical === "玉篇"),
    `${kind} data: dhrvus should find 玉篇`
  );

  // All three RR forms of 국민 are index keys, and the leading-devoice variant
  // reaches the naive one.
  let rrNote = "no rr index in corpus yet";
  if (real.rr && real.rr.words && Object.keys(real.rr.words).length > 0) {
    for (const form of ["gukmin", "gungmin", "gugmin", "kukmin"]) {
      const r = say(form);
      assert.deepEqual(
        (r.interpretations || []).map((i) => i.kind),
        ["rr"],
        `${kind} data: ${form} should be read as romanization only`
      );
      assert.equal(r.interpretations[0].to, "국민", `${kind} data: ${form} → 국민`);
      const w = r.matches.find((m) => m.kind === "word");
      assert.ok(w, `${kind} data: ${form} should find a word match`);
      assert.equal(w.canonical, "國民", `${kind} data: ${form} → 國民`);
    }

    // The widened gate on real data: the hyphenated spelling of the same
    // query lands on 국민, while the literal channel still finds nothing.
    for (const written of ["guk-min", "guk min", "Guk-Min"]) {
      const r = say(written);
      assert.deepEqual(
        (r.interpretations || []).map((i) => i.kind),
        ["rr"],
        `${kind} data: ${written} should be read as romanization only`
      );
      assert.equal(r.interpretations[0].to, "국민", `${kind} data: ${written} → 국민`);
      assert.deepEqual(r.matches, say("gukmin").matches, `${kind} data: ${written} = gukmin`);
      assert.deepEqual(lookup(written, real), { ok: true, matches: [] }, written);
    }

    // su: both interpreters survive — 수 romanized, 녀 on the keyboard — and
    // 수 comes first. Both are reading lists, so the compound-count rule
    // decides it.
    const su = say("su");
    assert.deepEqual(
      su.interpretations.map((i) => [i.kind, i.to]),
      [["rr", "수"], ["dubeolsik", "녀"]],
      `${kind} data: su should read 수 first, then 녀`
    );
    assert.equal(su.matches[0].kind, "reading");
    assert.equal(su.matches[0].eum, "수");
    assert.equal(su.matches[su.interpretations[1].start].eum, "녀");
    assert.deepEqual(
      su.matches,
      [...lookup("수", real).matches, ...lookup("녀", real).matches],
      `${kind} data: su's groups are the ordinary 수 and 녀 lookups`
    );
    // The channel rule on real data: a navigateTo-style literal lookup of the
    // same string finds nothing at all.
    assert.deepEqual(lookup("su", real), { ok: true, matches: [] });
    assert.deepEqual(lookup("gukmin", real), { ok: true, matches: [] });

    const cw = (ch) => ((real.hanja.chars[ch] || {}).cw || []).length;
    const bestCw = (eum) =>
      Math.max(...lookup(eum, real).matches[0].candidates.map((c) => cw(c.char)));
    rrNote =
      `rr ${Object.keys(real.rr.words).length} words + ` +
      `${Object.keys(real.rr.syllables).length} syllables; ` +
      `국민 f=${(real.words.words["國民"][0] || {}).f}; ` +
      `su → 수 (best cw ${bestCw("수")}) over 녀 (best cw ${bestCw("녀")})`;
  }

  // Rule 3c against the real corpus.
  const reading = lookup("국", real).matches[0];
  assert.ok(reading && reading.kind === "reading", `${kind} data: 국 → reading match`);
  assert.ok(
    reading.candidates.some((c) => c.char === "國"),
    `${kind} data: 국 candidates should include 國`
  );
  const counts = reading.candidates.map(
    (c) => (real.hanja.chars[c.char].compounds || []).length
  );
  assert.deepEqual(
    counts,
    [...counts].sort((a, b) => b - a),
    `${kind} data: candidates must be ranked by compound count descending`
  );

  // Rare-flag addendum. Agent A may not have shipped the flag yet, so probe
  // for any occurrence before asserting anything about it.
  let rareNote = "no rare flag in corpus yet";
  const corpusHasRare = Object.values(real.words.words).some(
    (senses) => Array.isArray(senses) && senses.some((s) => s && s.rare === true)
  );
  if (corpusHasRare) {
    const flagged = Object.entries(real.words.words).filter(
      ([, senses]) => Array.isArray(senses) && senses.every((s) => s && s.rare === true)
    );
    rareNote = `${flagged.length} fully-rare spellings`;

    // Sanity anchors from SPEC: 국민/자본주의 not rare.
    for (const notRare of ["國民", "資本主義"]) {
      const m = lookup(notRare, real).matches.find((x) => x.kind === "word");
      if (m) assert.equal("rare" in m, false, `${kind} data: ${notRare} must not be rare`);
    }

    // Any hangul span mixing rare and non-rare spellings must order non-rare
    // first and take its char cards from a non-rare spelling.
    for (const [hangul, spellings] of Object.entries(real.words.byHangul)) {
      if (!Array.isArray(spellings) || spellings.length < 2) continue;
      const rareness = spellings.map((sp) => {
        const senses = real.words.words[sp];
        return Array.isArray(senses) && senses.every((s) => s && s.rare === true);
      });
      if (!rareness.includes(true) || !rareness.includes(false)) continue;

      const ms = lookup(hangul, real).matches.filter((m) => m.kind === "word");
      const flags = ms.map((m) => m.rare === true);
      assert.deepEqual(
        flags,
        [...flags].sort((a, b) => Number(a) - Number(b)),
        `${kind} data: ${hangul} — non-rare spellings must order first`
      );
      assert.equal(ms[0].rare, undefined, `${kind} data: ${hangul} leads with a non-rare`);
      rareNote += `; e.g. ${hangul} → ${ms.map((m) => m.canonical).join("/")}`;
      break;
    }
  }

  // lvl addendum: EVERY char carries exactly one valid level, the zones sit
  // in their expected bands, and the boundary anchors hold.
  let eduNote = "no lvl in corpus yet";
  const levelled = Object.entries(real.hanja.chars).filter(([, e]) => e && e.lvl);
  if (levelled.length > 0) {
    const zones = { m: 0, h: 0, a: 0, r: 0 };
    const bad = [];
    for (const [c, e] of Object.entries(real.hanja.chars)) {
      if (e && (e.lvl === "m" || e.lvl === "h" || e.lvl === "a" || e.lvl === "r")) {
        zones[e.lvl] += 1;
      } else {
        bad.push(c);
      }
      if (e && ("edu" in e || "eduT" in e)) bad.push(c);
    }
    assert.deepEqual(bad.slice(0, 5), [], `${kind} data: ${bad.length} chars without exactly one lvl`);
    assert.equal(
      zones.m + zones.h + zones.a + zones.r,
      Object.keys(real.hanja.chars).length
    );
    assert.ok(zones.m > 700 && zones.m <= 900, `${kind} data: m=${zones.m}`);
    assert.ok(zones.h > 700 && zones.h <= 900, `${kind} data: h=${zones.h}`);
    assert.ok(zones.a >= 1000 && zones.a <= 3500, `${kind} data: a=${zones.a}`);
    assert.ok(zones.r > zones.a, `${kind} data: r=${zones.r} should be the largest zone`);
    eduNote = `lvl ${zones.m}m/${zones.h}h/${zones.a}a/${zones.r}r`;

    // Boundary anchors: curriculum, attested, and dictionary-tail.
    for (const [ch, want] of [
      ["學", "m"], ["國", "m"], ["民", "m"],
      ["雰", "a"], ["癌", "a"], ["膵", "a"],
      ["㔏", "r"], ["朞", "r"],
    ]) {
      const e = real.hanja.chars[ch];
      if (e) assert.equal(e.lvl, want, `${kind} data: ${ch} should be lvl ${want}`);
    }

    // and it must reach the matches: char cards and reading rows alike
    const [sample, sampleEntry] = levelled[0];
    const card = charsOf(lookup(sample, real).matches)[0];
    assert.equal(card.lvl, sampleEntry.lvl, `${kind} data: ${sample} card carries lvl`);
    const row = lookup(sampleEntry.readings[0], real).matches[0];
    if (row && row.kind === "reading") {
      const c = row.candidates.find((x) => x.char === sample);
      if (c) assert.equal(c.lvl, sampleEntry.lvl, `${kind} data: reading row carries lvl`);
    }
  }

  // ROUND TRIP (regression net for the canonical-keys + length-metadata
  // fixes): every shipped key must be reachable by looking up the key itself.
  // Before the fix, 131 words keys resolved to nothing (中腦 → 中匘, no such
  // key), 130 more silently answered from a different record, and every key
  // longer than 6 chars came back as fragments.
  const wordKeys = Object.keys(real.words.words);
  const unreachable = [];
  const redirected = [];
  for (const key of wordKeys) {
    const ms = lookup(key, real).matches.filter((m) => m.kind === "word");
    if (ms.length === 0) unreachable.push(key);
    else if (!ms.some((m) => m.canonical === key)) redirected.push(`${key}->${ms[0].canonical}`);
  }
  assert.deepEqual(unreachable.slice(0, 5), [], `${kind} data: ${unreachable.length} unreachable words keys`);
  assert.deepEqual(redirected.slice(0, 5), [], `${kind} data: ${redirected.length} words keys redirect elsewhere`);

  const hangulKeys = Object.keys(real.words.byHangul);
  const deadHangul = [];
  for (const key of hangulKeys) {
    if (lookup(key, real).matches.some((m) => m.kind === "word")) continue;
    deadHangul.push(key);
  }
  assert.deepEqual(deadHangul.slice(0, 5), [], `${kind} data: ${deadHangul.length} byHangul keys resolve to nothing`);

  // The declared caps must be the real ones, and long keys must survive the
  // whole pipeline as single word matches.
  assert.equal(maxWordLenOf(real.words), Math.max(...wordKeys.map((k) => k.length)));
  assert.equal(maxHangulLenOf(real.words), Math.max(...hangulKeys.map((k) => k.length)));
  const longest = wordKeys.reduce((a, b) => (b.length > a.length ? b : a), "");
  const longMatch = lookup(longest, real).matches.find((m) => m.kind === "word");
  assert.equal(longMatch.canonical, longest, `${kind} data: longest key resolves whole`);
  const roundTripNote =
    `round-trip ${wordKeys.length} words + ${hangulKeys.length} byHangul keys, ` +
    `0 unreachable, 0 redirects, longest ${longest} (${longest.length})`;

  // Word-parts addendum against the real corpus (skipped if 資本主義 absent).
  let partsNote = "資本主義 absent";
  if (Object.prototype.hasOwnProperty.call(real.words.words, "資本主義")) {
    const w = lookup("資本主義", real).matches.find((m) => m.kind === "word");
    assert.ok(w, `${kind} data: 資本主義 should produce a word match`);
    assert.ok(Array.isArray(w.parts) && w.parts.length > 0, `${kind} data: expected parts`);
    assert.ok(
      w.parts.some((p) => p.type === "word"),
      `${kind} data: parts should contain at least one sub-word`
    );
    assert.equal(
      w.parts.map((p) => (p.type === "word" ? p.hanja : p.char)).join(""),
      "資本主義",
      `${kind} data: parts must cover the word`
    );
    assert.ok(
      w.parts.every((p) => p.type !== "word" || p.hanja !== "資本主義"),
      `${kind} data: a word must not be its own part`
    );
    assert.ok(
      w.parts.every((p) => p.type !== "word" || p.glosses.length <= 2),
      `${kind} data: sub-word glosses capped at 2`
    );
    partsNote =
      "資本主義 parts " + w.parts.map((p) => (p.type === "word" ? p.hanja : p.char)).join("+");
  }

  console.log(
    `      (${roundTripNote}; ${partsNote}; ${rareNote}; ${eduNote}; ${rrNote}; ` +
      `${kind} data: ${Object.keys(real.hanja.chars).length} chars, ` +
      `${Object.keys(real.words.words).length} words, ` +
      `${Object.keys(real.variants.map).length} variants, ` +
      `${reading.candidates.length} hanja read 국)`
  );
});

// --- decomposition against the real emitted decomp.json ------------------
// No harness covers the shipped file: both pages run on a hand-written fixture.
// Read-only, and skipped (not failed) if the file is absent.

await testAsync("smoke: real decomp.json decomposes 依 / 學 / 疑 and stays clickable", async () => {
  let decomp, chars;
  try {
    const [d, h] = await Promise.all([
      readFile(join(dataDir, "decomp.json"), "utf8"),
      readFile(join(dataDir, "hanja.json"), "utf8"),
    ]);
    decomp = JSON.parse(d);
    chars = JSON.parse(h).chars;
  } catch (err) {
    console.log(`      (skipped — decomp.json unreadable: ${err.code || err.name})`);
    return;
  }

  assert.equal(decomp.v, 1);
  const parts = decomp.parts;
  assert.ok(parts && typeof parts === "object", "decomp.json must carry a parts map");

  // A row is clickable iff its length is 1 or its slot 2 is a string. The
  // target is slot 2 when present, else the display glyph itself.
  const clickable = (row) => row.length === 1 || typeof row[1] === "string";
  const targetOf = (row) => (typeof row[1] === "string" ? row[1] : row[0]);
  const glyphs = (ch) => (parts[ch] || []).map((r) => r[0]).join("+");

  // SPEC binding anchors, including the two the above-BMP aliases exist for.
  assert.equal(glyphs("依"), "亻+衣", "依 = 亻 + 衣");
  assert.equal(parts["依"][0][1], "人", "亻 aliases to 人");
  assert.equal(glyphs("學"), "臼+爻+冖+子", "學 = 臼 + 爻 + 冖 + 子");
  assert.equal(glyphs("疑"), "匕+矢+龴+疋", "疑 = 匕 + 矢 + 龴 + 疋");
  // 龴 is a reading-less shape row, so it must not be clickable.
  assert.equal(clickable(parts["疑"][2]), false, "龴 is a reading-less row");

  // ABSENT by rule: 無 substitutes to ？, 乙 is atomic.
  for (const absent of ["無", "乙"]) {
    assert.equal(absent in parts, false, `${absent} must have no entry`);
  }

  // Whole-file invariants. A click can never land nowhere, and nothing the
  // card renders may be unrenderable.
  const badTarget = [];
  const aboveBmp = [];
  const tooShort = [];
  const opaque = [];
  const illegal = [];
  const ILLEGAL = /[\u2ff0-\u2fff\u303e{}？]/;
  for (const [ch, rows] of Object.entries(parts)) {
    if (rows.length < 2) tooShort.push(ch);
    let anyResolves = false;
    for (const row of rows) {
      const g = row[0];
      if ([...g].some((c) => c.codePointAt(0) > 0xffff)) aboveBmp.push(`${ch}:${g}`);
      if (ILLEGAL.test(g)) illegal.push(`${ch}:${g}`);
      if (!clickable(row)) continue;
      const t = targetOf(row);
      if (Object.prototype.hasOwnProperty.call(chars, t)) anyResolves = true;
      else badTarget.push(`${ch}:${g}->${t}`);
    }
    if (!anyResolves) opaque.push(ch);
  }
  assert.deepEqual(aboveBmp.slice(0, 5), [], `${aboveBmp.length} parts above the BMP`);
  assert.deepEqual(illegal.slice(0, 5), [], `${illegal.length} parts carry IDC or placeholder characters`);
  assert.deepEqual(tooShort.slice(0, 5), [], `${tooShort.length} entries with fewer than 2 parts`);
  assert.deepEqual(badTarget.slice(0, 5), [], `${badTarget.length} clickable parts miss hanja.json`);
  assert.deepEqual(opaque.slice(0, 5), [], `${opaque.length} entries resolve to no dictionary character`);

  // The emit is restricted to hanja.json characters: the runtime never asks
  // about anything else.
  const stray = Object.keys(parts).filter(
    (ch) => !Object.prototype.hasOwnProperty.call(chars, ch)
  );
  assert.deepEqual(stray.slice(0, 5), [], `${stray.length} decomposed chars are not in hanja.json`);

  const rowCount = Object.values(parts).reduce((n, r) => n + r.length, 0);
  const clicky = Object.values(parts).reduce((n, r) => n + r.filter(clickable).length, 0);
  console.log(
    `      (decomp ${Object.keys(parts).length} chars, ${rowCount} part rows, ` +
      `${clicky} clickable, ${rowCount - clicky} reading-less; ` +
      `every target in hanja.json; every glyph BMP)`
  );

  // End-to-end join over the REAL files, exactly as the worker holds them:
  // whole hanja.json, guarded decomp.json. This is the seam the unit fixture
  // cannot cover, and where the chars-wrapper bug lived.
  const { attachDecomp, guardDecomp } = await import("../extension/background.js");
  const hanjaFile = JSON.parse(await readFile(join(dataDir, "hanja.json"), "utf8"));
  const joined = attachDecomp(
    { ok: true, matches: [{ kind: "char", canonical: "依" }] },
    { decomp: guardDecomp(decomp), hanja: hanjaFile }
  );
  const uy = joined.matches[0].parts;
  assert.equal(uy.length, 2);
  assert.equal(uy[0].g, "亻");
  assert.equal(uy[0].t, "人");
  assert.equal(uy[0].eum, "인", "the 亻 row must carry 人's reading after the real-file join");
  assert.equal(uy[1].t, "衣");
  assert.equal(uy[1].eum, "의");
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
