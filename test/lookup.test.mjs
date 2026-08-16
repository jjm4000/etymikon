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
  buildUsedIn,
  buildReadingIndex,
  buildWordParts,
  lookup,
  extractRuns,
  segmentRun,
} from "../extension/lookup.js";

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
      // edu addendum: MOE basic-education list membership.
      edu: true,
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
    },
    菊: {
      // No eumhun at all: the eum comes from `readings`, so hun must be "".
      eumhun: [],
      readings: ["국"],
      glosses: [],
      compounds: [],
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
    國民: [{ hangul: "국민", glosses: ["the people; citizens of a nation"] }],
    學生: [{ hangul: "학생", glosses: ["student; pupil"] }],
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
  },
};

const data = { hanja, words, variants };

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

test("edu flag: on char matches and reading candidates, absent otherwise", () => {
  const guk = charsOf(lookup("國", data).matches)[0];
  assert.equal(guk.edu, true);
  const min = charsOf(lookup("民", data).matches)[0];
  assert.equal("edu" in min, false);
  const reading = lookup("국", data).matches[0];
  const cGuk = reading.candidates.find((c) => c.char === "國");
  const cGug = reading.candidates.find((c) => c.char === "局");
  assert.equal(cGuk.edu, true);
  assert.equal("edu" in cGug, false);
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
    edu: true,
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
  assert.deepEqual(guk, { char: "菊", hun: "", eum: "국", gloss: "" });
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
  assert.deepEqual(lookup("abc", data), { ok: true, matches: [] });
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

// --- optional smoke test against Agent A's real corpus -------------------
// Read-only, and skipped (not failed) if the files are absent.

const dataDir = join(dirname(fileURLToPath(import.meta.url)), "..", "extension", "data");

await testAsync("smoke: real extension/data corpus resolves 國民 / 国 / 국민", async () => {
  let real;
  try {
    const [h, w, v] = await Promise.all([
      readFile(join(dataDir, "hanja.json"), "utf8"),
      readFile(join(dataDir, "words.json"), "utf8"),
      readFile(join(dataDir, "variants.json"), "utf8"),
    ]);
    real = { hanja: JSON.parse(h), words: JSON.parse(w), variants: JSON.parse(v) };
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
    `      (${partsNote}; ${rareNote}; ` +
      `${kind} data: ${Object.keys(real.hanja.chars).length} chars, ` +
      `${Object.keys(real.words.words).length} words, ` +
      `${Object.keys(real.variants.map).length} variants, ` +
      `${reading.candidates.length} hanja read 국)`
  );
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
