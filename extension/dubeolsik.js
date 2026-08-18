/**
 * Okpyeon — QWERTY to hangul (한영타 변환), 2-set Dubeolsik.
 *
 * Typing Korean with the keyboard still in English produces Latin gibberish:
 * `toddlf` for 생일. This module reads that gibberish back as the hangul it
 * was meant to be. Deterministic, no data files.
 *
 * Pure: NO chrome.* API usage, so it imports into plain Node exactly like
 * lookup.js does (see test/lookup.test.mjs). Implements SPEC.md
 * "QWERTY-to-hangul input (ADDENDUM)".
 */

/**
 * The 2-set layout. Unshifted keys first, then the seven shifted ones that
 * carry a jamo of their own. Every other uppercase letter is its lowercase
 * key, which is what a user with caps lock on means.
 */
const KEYS = {
  q: "ㅂ", w: "ㅈ", e: "ㄷ", r: "ㄱ", t: "ㅅ",
  y: "ㅛ", u: "ㅕ", i: "ㅑ", o: "ㅐ", p: "ㅔ",
  a: "ㅁ", s: "ㄴ", d: "ㅇ", f: "ㄹ", g: "ㅎ",
  h: "ㅗ", j: "ㅓ", k: "ㅏ", l: "ㅣ",
  z: "ㅋ", x: "ㅌ", c: "ㅊ", v: "ㅍ", b: "ㅠ", n: "ㅜ", m: "ㅡ",
  Q: "ㅃ", W: "ㅉ", E: "ㄸ", R: "ㄲ", T: "ㅆ", O: "ㅒ", P: "ㅖ",
};

/** Initial consonants, in Unicode order. Index feeds the syllable formula. */
const CHOSEONG = [
  "ㄱ", "ㄲ", "ㄴ", "ㄷ", "ㄸ", "ㄹ", "ㅁ", "ㅂ", "ㅃ", "ㅅ",
  "ㅆ", "ㅇ", "ㅈ", "ㅉ", "ㅊ", "ㅋ", "ㅌ", "ㅍ", "ㅎ",
];

/** Vowels, in Unicode order. */
const JUNGSEONG = [
  "ㅏ", "ㅐ", "ㅑ", "ㅒ", "ㅓ", "ㅔ", "ㅕ", "ㅖ", "ㅗ", "ㅘ",
  "ㅙ", "ㅚ", "ㅛ", "ㅜ", "ㅝ", "ㅞ", "ㅟ", "ㅠ", "ㅡ", "ㅢ", "ㅣ",
];

/**
 * Final consonants, in Unicode order, index 0 being "no final". Note which
 * doubles are here and which are not: ㄲ and ㅆ are legal finals, ㄸ ㅃ ㅉ
 * never are, so a syllable followed by one of those three has to break.
 */
const JONGSEONG = [
  "", "ㄱ", "ㄲ", "ㄳ", "ㄴ", "ㄵ", "ㄶ", "ㄷ", "ㄹ", "ㄺ",
  "ㄻ", "ㄼ", "ㄽ", "ㄾ", "ㄿ", "ㅀ", "ㅁ", "ㅂ", "ㅄ", "ㅅ",
  "ㅆ", "ㅇ", "ㅈ", "ㅊ", "ㅋ", "ㅌ", "ㅍ", "ㅎ",
];

/** Two vowels that fuse into one: ㅗ + ㅏ = ㅘ. */
const VOWEL_PAIRS = {
  "ㅗㅏ": "ㅘ", "ㅗㅐ": "ㅙ", "ㅗㅣ": "ㅚ",
  "ㅜㅓ": "ㅝ", "ㅜㅔ": "ㅞ", "ㅜㅣ": "ㅟ",
  "ㅡㅣ": "ㅢ",
};

/** Two finals that fuse into one: ㄹ + ㄱ = ㄺ. */
const FINAL_PAIRS = {
  "ㄱㅅ": "ㄳ", "ㄴㅈ": "ㄵ", "ㄴㅎ": "ㄶ",
  "ㄹㄱ": "ㄺ", "ㄹㅁ": "ㄻ", "ㄹㅂ": "ㄼ", "ㄹㅅ": "ㄽ",
  "ㄹㅌ": "ㄾ", "ㄹㅍ": "ㄿ", "ㄹㅎ": "ㅀ",
  "ㅂㅅ": "ㅄ",
};

/** The same fusions read backwards, for the handoff split (ㄺ → ㄹ + ㄱ). */
const FINAL_SPLITS = {};
for (const [pair, fused] of Object.entries(FINAL_PAIRS)) {
  FINAL_SPLITS[fused] = [pair[0], pair[1]];
}

const CHOSEONG_INDEX = new Map(CHOSEONG.map((jamo, i) => [jamo, i]));
const JUNGSEONG_INDEX = new Map(JUNGSEONG.map((jamo, i) => [jamo, i]));
const JONGSEONG_INDEX = new Map(JONGSEONG.map((jamo, i) => [jamo, i]));

const SYLLABLE_BASE = 0xac00;
const JUNG_COUNT = JUNGSEONG.length;   // 21
const JONG_COUNT = JONGSEONG.length;   // 28

/** True for a vowel jamo. Everything else the key map produces is a consonant. */
function isVowel(jamo) {
  return JUNGSEONG_INDEX.has(jamo);
}

/** True for a consonant that may stand as a final. Excludes ㄸ ㅃ ㅉ. */
function canBeFinal(jamo) {
  return jamo !== "" && JONGSEONG_INDEX.has(jamo);
}

/**
 * Compose one syllable from its parts via the Unicode formula. Returns the
 * loose jamo instead when the parts do not make a syllable, so nothing the
 * user typed is ever silently dropped.
 */
function compose(cho, jung, jong) {
  if (cho === null || jung === null) {
    return (cho || "") + (jung || "") + (jong || "");
  }
  const c = CHOSEONG_INDEX.get(cho);
  const v = JUNGSEONG_INDEX.get(jung);
  const t = jong === null ? 0 : JONGSEONG_INDEX.get(jong);
  if (c === undefined || v === undefined || t === undefined) {
    return (cho || "") + (jung || "") + (jong || "");
  }
  return String.fromCharCode(SYLLABLE_BASE + (c * JUNG_COUNT + v) * JONG_COUNT + t);
}

/**
 * Read a Latin string as if it had been typed on a Korean keyboard.
 *
 * The composition is the ordinary IME automaton: letters accumulate into
 * choseong / jungseong / jongseong, vowels and finals fuse where the layout
 * says they do, and a final hands itself to the next syllable when a vowel
 * arrives after it. That handoff is what makes `toddlf` 생일 rather than
 * 샹딜, and it splits a fused final in half on the way (`ekfrl` → 달기).
 *
 * Characters the layout has no key for (digits, spaces, punctuation) end the
 * syllable in progress and pass through unchanged, so the function is total.
 *
 * @param {string} text raw Latin input
 * @returns {string} the composed hangul
 */
export function qwertyToHangul(text) {
  if (typeof text !== "string" || text === "") return "";

  let out = "";
  // The syllable under construction. `jong` is only ever set once `jung` is.
  let cho = null;
  let jung = null;
  let jong = null;

  const flush = () => {
    if (cho !== null || jung !== null || jong !== null) {
      out += compose(cho, jung, jong);
    }
    cho = null;
    jung = null;
    jong = null;
  };

  for (const ch of text) {
    const jamo = Object.prototype.hasOwnProperty.call(KEYS, ch)
      ? KEYS[ch]
      // Any other uppercase letter is its lowercase key; caps lock is not a
      // different layout.
      : Object.prototype.hasOwnProperty.call(KEYS, ch.toLowerCase())
        ? KEYS[ch.toLowerCase()]
        : null;

    if (jamo === null) {
      flush();
      out += ch;
      continue;
    }

    if (isVowel(jamo)) {
      if (jong !== null) {
        // HANDOFF. The final was never a final: it begins the next syllable.
        // A fused final gives up only its second half.
        const split = FINAL_SPLITS[jong];
        const moved = split ? split[1] : jong;
        jong = split ? split[0] : null;
        flush();
        cho = moved;
        jung = jamo;
      } else if (jung !== null) {
        // Two vowels running: fuse them if the layout allows, otherwise the
        // syllable is finished and this vowel starts something new.
        const fused = VOWEL_PAIRS[jung + jamo];
        if (fused) {
          jung = fused;
        } else {
          flush();
          jung = jamo;
        }
      } else {
        // cho may be null here: a vowel with nothing before it is a bare jamo,
        // which compose() emits as itself.
        jung = jamo;
      }
      continue;
    }

    // A consonant.
    if (jung === null) {
      // Nothing for it to close, so it can only be an initial. Any consonant
      // already sitting there had no vowel and stays a bare jamo.
      if (cho !== null) flush();
      cho = jamo;
      continue;
    }
    if (cho === null) {
      // A bare vowel cannot take a final; end it and start fresh.
      flush();
      cho = jamo;
      continue;
    }
    if (jong === null) {
      if (canBeFinal(jamo)) jong = jamo;
      else {
        flush();
        cho = jamo;
      }
      continue;
    }
    const fused = FINAL_PAIRS[jong + jamo];
    if (fused) {
      jong = fused;
    } else {
      flush();
      cho = jamo;
    }
  }

  flush();
  return out;
}

/** Pure-Latin input is what the conversion applies to; see lookup(). */
export const LATIN_QUERY = /^[A-Za-z]+$/;

/**
 * True when `text` is the kind of query that should be read as mistyped
 * hangul: Latin letters and nothing else. A Latin query matches nothing in
 * the dictionary by construction, so there is no ambiguity to weigh.
 */
export function isLatinQuery(text) {
  return typeof text === "string" && LATIN_QUERY.test(text);
}
