# Revised Romanization (국어의 로마자 표기법) for the build-time search index.
#
# Two forms per hangul string, both indexed, per the SPEC "Romanized search"
# addendum:
#
#   NAIVE    letter-for-letter, positional, no cross-syllable interaction.
#            국민 -> gukmin.  This is what a learner types.
#   OFFICIAL the standard's sound changes applied at jamo level ACROSS
#            syllable boundaries first, then romanized.  국민 -> gungmin.
#
# Tensification (된소리) is deliberately NOT marked, per the standard:
# 국가 stays gukga, 값이 stays gapsi.
#
# Stdlib only; no data files. Everything is Unicode arithmetic over the
# 11,172 precomposed syllables.

# ------------------------------------------------------------------ jamo

SBASE = 0xAC00
SLAST = 0xD7A3

CHO = "ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ"
JUNG = "ㅏㅐㅑㅒㅓㅔㅕㅖㅗㅘㅙㅚㅛㅜㅝㅞㅟㅠㅡㅢㅣ"
JONG = ("", "ㄱ", "ㄲ", "ㄳ", "ㄴ", "ㄵ", "ㄶ", "ㄷ", "ㄹ", "ㄺ", "ㄻ", "ㄼ",
        "ㄽ", "ㄾ", "ㄿ", "ㅀ", "ㅁ", "ㅂ", "ㅄ", "ㅅ", "ㅆ", "ㅇ", "ㅈ",
        "ㅊ", "ㅋ", "ㅌ", "ㅍ", "ㅎ")

# Consonant clusters in the coda, as (kept, moved) — the second element is
# what resyllabifies onto a following vowel (읽어 -> 일거, 값이 -> 갑시).
SPLIT = {
    "ㄳ": ("ㄱ", "ㅅ"), "ㄵ": ("ㄴ", "ㅈ"), "ㄶ": ("ㄴ", "ㅎ"),
    "ㄺ": ("ㄹ", "ㄱ"), "ㄻ": ("ㄹ", "ㅁ"), "ㄼ": ("ㄹ", "ㅂ"),
    "ㄽ": ("ㄹ", "ㅅ"), "ㄾ": ("ㄹ", "ㅌ"), "ㄿ": ("ㄹ", "ㅍ"),
    "ㅀ": ("ㄹ", "ㅎ"), "ㅄ": ("ㅂ", "ㅅ"),
}

# 평파열음화 + 자음군 단순화: what a coda is actually pronounced as when it is
# NOT carried over to a following vowel. Seven-consonant inventory.
REP = {
    "ㄲ": "ㄱ", "ㅋ": "ㄱ", "ㄳ": "ㄱ", "ㄺ": "ㄱ",
    "ㅅ": "ㄷ", "ㅆ": "ㄷ", "ㅈ": "ㄷ", "ㅊ": "ㄷ", "ㅌ": "ㄷ", "ㅎ": "ㄷ",
    "ㄵ": "ㄴ", "ㄶ": "ㄴ",
    "ㄻ": "ㅁ",
    "ㄼ": "ㄹ", "ㄽ": "ㄹ", "ㄾ": "ㄹ", "ㅀ": "ㄹ",
    "ㅍ": "ㅂ", "ㄿ": "ㅂ", "ㅄ": "ㅂ",
}

# ------------------------------------------------------------------ letters

ONSET_ROM = {
    "ㄱ": "g", "ㄲ": "kk", "ㄴ": "n", "ㄷ": "d", "ㄸ": "tt", "ㄹ": "r",
    "ㅁ": "m", "ㅂ": "b", "ㅃ": "pp", "ㅅ": "s", "ㅆ": "ss", "ㅇ": "",
    "ㅈ": "j", "ㅉ": "jj", "ㅊ": "ch", "ㅋ": "k", "ㅌ": "t", "ㅍ": "p",
    "ㅎ": "h",
}

# Coda values, including the clusters (they romanize as their representative
# sound — this is what makes the NAIVE form usable without any rule engine).
CODA_ROM = {
    "": "", "ㄱ": "k", "ㄲ": "k", "ㄳ": "k", "ㄴ": "n", "ㄵ": "n", "ㄶ": "n",
    "ㄷ": "t", "ㄹ": "l", "ㄺ": "k", "ㄻ": "m", "ㄼ": "l", "ㄽ": "l",
    "ㄾ": "l", "ㄿ": "p", "ㅀ": "l", "ㅁ": "m", "ㅂ": "p", "ㅄ": "p",
    "ㅅ": "t", "ㅆ": "t", "ㅇ": "ng", "ㅈ": "t", "ㅊ": "t", "ㅋ": "k",
    "ㅌ": "t", "ㅍ": "p", "ㅎ": "t",
}

# Article 8 (전자법): one fixed letter per jamo, whatever its position, no
# sound changes at all. ㄱ=g, ㄷ=d, ㅂ=b, ㄹ=l, ㅅ=s everywhere; clusters are
# spelled out letter by letter (값 gabs, 밖 bakk, 없 eobs); ㅎ is written even
# where transcription drops it (좋다 johda). The standard also writes a hyphen
# for the silent ㅇ in a non-initial syllable (물엿 mul-yeos); the index omits
# it, since the runtime strips hyphens from typed queries anyway.
TRANSLIT_ONSET = {
    "ㄱ": "g", "ㄲ": "kk", "ㄴ": "n", "ㄷ": "d", "ㄸ": "tt", "ㄹ": "l",
    "ㅁ": "m", "ㅂ": "b", "ㅃ": "pp", "ㅅ": "s", "ㅆ": "ss", "ㅇ": "",
    "ㅈ": "j", "ㅉ": "jj", "ㅊ": "ch", "ㅋ": "k", "ㅌ": "t", "ㅍ": "p",
    "ㅎ": "h",
}
TRANSLIT_CODA = dict(
    {"": "", "ㅇ": "ng"},
    **{k: v for k, v in TRANSLIT_ONSET.items() if k not in ("ㅇ",)})
TRANSLIT_CODA.update({
    "ㄳ": "gs", "ㄵ": "nj", "ㄶ": "nh", "ㄺ": "lg", "ㄻ": "lm", "ㄼ": "lb",
    "ㄽ": "ls", "ㄾ": "lt", "ㄿ": "lp", "ㅀ": "lh", "ㅄ": "bs",
})

VOWEL_ROM = {
    "ㅏ": "a", "ㅐ": "ae", "ㅑ": "ya", "ㅒ": "yae", "ㅓ": "eo", "ㅔ": "e",
    "ㅕ": "yeo", "ㅖ": "ye", "ㅗ": "o", "ㅘ": "wa", "ㅙ": "wae", "ㅚ": "oe",
    "ㅛ": "yo", "ㅜ": "u", "ㅝ": "wo", "ㅞ": "we", "ㅟ": "wi", "ㅠ": "yu",
    "ㅡ": "eu", "ㅢ": "ui", "ㅣ": "i",
}

# ㅎ + ㄱ/ㄷ/ㅈ/ㅅ  ->  ㅋ/ㅌ/ㅊ/ㅆ  (좋고 조코, 놓다 노타, 낳지 나치, 좋소 조쏘)
H_AFTER = {"ㄱ": "ㅋ", "ㄷ": "ㅌ", "ㅈ": "ㅊ", "ㅅ": "ㅆ"}
# ㄱ/ㄷ/ㅂ/ㅈ + ㅎ  ->  ㅋ/ㅌ/ㅍ/ㅊ  (잡혀 자펴, 축하 추카, 앉히 안치)
H_BEFORE = {"ㄱ": "ㅋ", "ㄷ": "ㅌ", "ㅂ": "ㅍ", "ㅈ": "ㅊ"}
# obstruent coda -> nasal, before ㄴ/ㅁ (백마 뱅마, 국민 궁민)
NASALIZE = {"ㄱ": "ㅇ", "ㄷ": "ㄴ", "ㅂ": "ㅁ"}
# ㄴ-insertion fires only before a GLIDE vowel; see _insert_n below.
Y_VOWELS = frozenset("ㅑㅒㅕㅖㅛㅠ")


def is_syllable(ch):
    return SBASE <= ord(ch) <= SLAST


def decompose(s):
    """'국민' -> [['ㄱ','ㅜ','ㄱ'], ['ㅁ','ㅣ','ㄴ']]; None if not all syllables."""
    out = []
    for ch in s:
        if not is_syllable(ch):
            return None
        i = ord(ch) - SBASE
        out.append([CHO[i // 588], JUNG[(i % 588) // 28], JONG[i % 28]])
    return out


def compose(syls):
    """Inverse of decompose — used by the build's debug output and tests."""
    return "".join(
        chr(SBASE + (CHO.index(c) * 588) + (JUNG.index(v) * 28) + JONG.index(t))
        for c, v, t in syls)


# ------------------------------------------------------------------ romanize

def _romanize(syls, liaison):
    """Jamo triples -> latin. `liaison` writes ㄹㄹ as 'll' (official only)."""
    out = []
    prev_coda = ""
    for cho, jung, jong in syls:
        onset = ONSET_ROM[cho]
        if liaison and cho == "ㄹ" and prev_coda == "ㄹ":
            onset = "l"          # 신라 silla, 별내 byeollae — never 'lr'
        out.append(onset + VOWEL_ROM[jung] + CODA_ROM[jong])
        prev_coda = jong
    return "".join(out)


# ------------------------------------------------------------------ rules

def _insert_n(syls):
    """ㄴ 첨가 (표준 발음법 29): a closed syllable followed by ㅇ + glide gains
    ㄴ on the second syllable — 학여울 항녀울, 알약 알략, 서울역 서울력.

    The standard's own trigger list is 이/야/여/요/유, but bare 이 is excluded
    here on purpose: an 이 after ㄷ/ㅌ is overwhelmingly the derivational
    suffix, which palatalizes instead (해돋이 해도지, 같이 가치) — both of
    which are binding anchors. Whether insertion applies at all is a morpheme
    -boundary question no jamo-level rule can settle (학여울 항녀울 but 금요일
    그묘일), so `forms()` indexes the no-insertion reading as well rather than
    betting on one.
    """
    changed = False
    for i in range(1, len(syls)):
        if (syls[i][0] == "ㅇ" and syls[i][1] in Y_VOWELS
                and syls[i - 1][2]):
            syls[i][0] = "ㄴ"
            changed = True
    return changed


def _link(cur, nxt):
    """Boundary where the next syllable starts with a vowel: 연음 + the ㅎ and
    palatalization rules that only apply there."""
    coda = cur[2]
    if coda == "ㅎ":                       # 좋아 조아 — ㅎ just drops
        cur[2] = ""
    elif coda in ("ㄶ", "ㅀ"):             # 많아 마나, 싫어 시러
        cur[2] = ""
        nxt[0] = SPLIT[coda][0]
    elif coda == "ㅇ":                     # 강아지 — ㅇ never moves
        pass
    elif coda in SPLIT:                    # 값이 갑시, 읽어 일거
        keep, move = SPLIT[coda]
        if move == "ㅌ" and nxt[1] == "ㅣ":  # 훑이 훌치
            move = "ㅊ"
        cur[2] = keep
        nxt[0] = move
    elif coda in ("ㄷ", "ㅌ") and nxt[1] == "ㅣ":   # 구개음화: 해돋이 해도지, 같이 가치
        nxt[0] = "ㅈ" if coda == "ㄷ" else "ㅊ"
        cur[2] = ""
    else:                                  # 옷이 오시, 부엌에 부어케
        nxt[0] = coda
        cur[2] = ""


def _apply(syls, insert_n, nl):
    """Run the sound changes left to right. `nl` picks the reading for a
    ㄴ+ㄹ boundary: 'auto' | 'll' | 'nn' (see forms())."""
    s = [list(x) for x in syls]
    if insert_n:
        _insert_n(s)

    for i in range(len(s) - 1):
        cur, nxt = s[i], s[i + 1]
        coda, onset = cur[2], nxt[0]
        if not coda:
            continue

        if onset == "ㅇ":
            _link(cur, nxt)
            continue

        # 구개음화 before 히: 굳히다 구치다
        if coda == "ㄷ" and onset == "ㅎ" and nxt[1] == "ㅣ":
            cur[2] = ""
            nxt[0] = "ㅊ"
            continue

        # ㅎ + 예사소리 -> 거센소리 (coda carries the ㅎ)
        if coda in ("ㅎ", "ㄶ", "ㅀ") and onset in H_AFTER:
            cur[2] = "" if coda == "ㅎ" else SPLIT[coda][0]
            nxt[0] = H_AFTER[onset]
            coda, onset = cur[2], nxt[0]
            if not coda:
                continue
        # 예사소리 + ㅎ -> 거센소리 (the ㅎ is the onset)
        elif onset == "ㅎ":
            # ㅈ merges as ㅈ+ㅎ -> ㅊ (맞히다 마치다), so it is looked up before
            # neutralization would turn it into ㄷ; ㅅ/ㅊ/ㅋ etc. go through
            # their representative sound (옷 한벌 -> 오탄벌).
            def _merge(j):
                return H_BEFORE.get(j) or H_BEFORE.get(REP.get(j, j))

            if coda in SPLIT and _merge(SPLIT[coda][1]):
                keep, move = SPLIT[coda]      # 읽히 일키, 앉히 안치, 밟히 발피
                cur[2] = keep
                nxt[0] = _merge(move)
                continue
            if _merge(coda):                  # 잡혀 자펴, 축하 추카, 맏형 마텽
                cur[2] = ""
                nxt[0] = _merge(coda)
                continue

        # everything below sees the neutralized coda
        coda = REP.get(coda, coda)
        cur[2] = coda

        if onset == "ㄹ":
            if coda in ("ㄱ", "ㄷ", "ㅂ", "ㅁ", "ㅇ"):
                # 왕십리 왕심니, 백로 뱅노, 종로 종노, 담력 담녁
                nxt[0] = onset = "ㄴ"
            elif coda == "ㄴ":
                # 유음화 vs 비음화. Both are in the standard's example set —
                # 신라 실라 but 신문로 신문노 — and the split is lexical, not
                # phonological. 'auto' uses the mainstream heuristic for
                # Sino-Korean: a ㄹ-initial syllable hanging off a base of two
                # or more syllables assimilates the OTHER way (의견란 의견난,
                # 생산량 생산냥, 공권력 공권녁, 신문로 신문노), while a
                # two-syllable word takes 유음화 (신라, 난로, 권력). forms()
                # indexes both readings regardless.
                if nl == "ll" or (nl == "auto" and i < 1):
                    cur[2] = coda = "ㄹ"
                else:
                    nxt[0] = onset = "ㄴ"
            # coda ㄹ + onset ㄹ: already ll

        if onset in ("ㄴ", "ㅁ"):
            if coda in NASALIZE:              # 백마 뱅마, 국민 궁민, 십리 심니
                cur[2] = NASALIZE[coda]
            elif coda == "ㄹ" and onset == "ㄴ":   # 별내 별래, 알약 알략
                nxt[0] = "ㄹ"

    s[-1][2] = REP.get(s[-1][2], s[-1][2])
    return s


# ------------------------------------------------------------------ public

def translit(text):
    """Article 8: one fixed letter per jamo, no positional logic, no rules."""
    syls = decompose(text)
    if syls is None:
        return None
    return "".join(TRANSLIT_ONSET[c] + VOWEL_ROM[v] + TRANSLIT_CODA[t]
                   for c, v, t in syls)


def naive(text):
    """RR letter rules per syllable, positional, no cross-syllable changes."""
    syls = decompose(text)
    if syls is None:
        return None
    return _romanize(syls, liaison=False)


def official(text, insert_n=None, nl="auto"):
    """Sound changes first, then romanize. `insert_n` defaults to applying
    ㄴ-insertion wherever it can fire."""
    syls = decompose(text)
    if syls is None:
        return None
    if insert_n is None:
        insert_n = True
    return _romanize(_apply(syls, insert_n, nl), liaison=True)


def candidates(text):
    """Every romanization generated for `text`, primary first, WITH the
    duplicates — `forms()` is this list deduped. The build reports the
    difference so the collapse rate stays visible."""
    syls = decompose(text)
    if syls is None:
        return []
    out = [
        _romanize(syls, liaison=False),
        "".join(TRANSLIT_ONSET[c] + VOWEL_ROM[v] + TRANSLIT_CODA[t]
                for c, v, t in syls),
    ]
    probe = [list(x) for x in syls]
    can_insert = _insert_n(probe)
    has_nl = any(syls[i][2] == "ㄴ" and syls[i + 1][0] == "ㄹ"
                 for i in range(len(syls) - 1))
    inserts = (True, False) if can_insert else (False,)
    nls = ("auto", "ll", "nn") if has_nl else ("auto",)
    for insert_n in inserts:
        for nl in nls:
            out.append(_romanize(_apply(syls, insert_n, nl), liaison=True))
    return out


def forms(text):
    """Every romanization to index for `text`, primary first, deduped.

    naive, the Article 8 transliteration, then the official reading. Where
    the standard is genuinely ambiguous for an unanalyzed common noun —
    ㄴ-insertion, and the ㄴ+ㄹ boundary — BOTH readings are indexed rather
    than guessed at: a spurious key costs a few bytes, a missing one costs a
    search hit. The extra readings only appear for strings that hit one of
    those two switches, so the usual word contributes one to three forms.
    """
    out = []
    for v in candidates(text):
        if v not in out:
            out.append(v)
    return out
