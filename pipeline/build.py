#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Hanja Hover -- build-time data pipeline (Agent A).

    download-if-missing  ->  stream-parse  ->  emit  ->  verify

Sources
    * kaikki.org postprocessed Korean Wiktionary extract (JSONL, ~190 MB)
    * Unicode Unihan database (Unihan_Variants.txt inside Unihan.zip)

Outputs (UTF-8, no BOM, compact / no indentation)
    extension/data/hanja.json
    extension/data/words.json
    extension/data/variants.json

Usage
    python pipeline/build.py            # download if missing, parse, emit, verify
    python pipeline/build.py --verify   # re-verify existing outputs only
    python pipeline/build.py --force-download

See pipeline/README.md.
"""

from __future__ import annotations

import collections
import gzip
import json
import math
import os
import re
import subprocess
import sys
import time
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
CACHE = os.path.join(HERE, "cache")
OUT = os.path.join(ROOT, "extension", "data")

KAIKKI_URL = "https://kaikki.org/dictionary/Korean/kaikki.org-dictionary-Korean.jsonl"
UNIHAN_URL = "https://www.unicode.org/Public/UCD/latest/ucd/Unihan.zip"
# The Korean extract cannot see Wiktionary's Translingual section, which is
# where shinjitai <-> kyujitai links live (気/氣, 戦/戰). Used ONLY to establish
# variant links; everything displayed still comes from the Korean hanja entry.
TRANSLINGUAL_URL = (
    "https://kaikki.org/dictionary/Translingual/"
    "kaikki.org-dictionary-Translingual.jsonl")
# Japanese-language Wiktionary (ja.wiktionary.org) extract. Its 漢字 sections
# state shinjitai origins as prose ("「圖」の略体。"), which is the only place
# 図 -> 圖 is recorded. Variant links only; nothing from it is displayed.
JAPANESE_URL = "https://kaikki.org/dictionary/downloads/ja/ja-extract.jsonl.gz"
# External Korean word-frequency list, used ONLY to decide the `rare` flag.
# hermitdave/FrequencyWords (MIT), counts derived from the OPUS OpenSubtitles
# 2018 corpus. Nothing from it ships in the extension. See README "Provenance".
EXTFREQ_URL = ("https://raw.githubusercontent.com/hermitdave/FrequencyWords/"
               "master/content/2018/ko/ko_full.txt")

KAIKKI_FILE = os.path.join(CACHE, "kaikki-Korean.jsonl")
UNIHAN_FILE = os.path.join(CACHE, "Unihan.zip")
TRANSLINGUAL_FILE = os.path.join(CACHE, "kaikki-Translingual.jsonl")
JAPANESE_FILE = os.path.join(CACHE, "ja-extract.jsonl.gz")
EXTFREQ_FILE = os.path.join(CACHE, "ko_full_opensubtitles.txt")

# ---------------------------------------------------------------- script ranges

HAN_RANGES = (
    (0x3400, 0x4DBF),    # ext A
    (0x4E00, 0x9FFF),    # URO
    (0xF900, 0xFAFF),    # compatibility ideographs
    (0x20000, 0x2A6DF),  # ext B
    (0x2A700, 0x2B73F),  # ext C
    (0x2B740, 0x2B81F),  # ext D
    (0x2B820, 0x2CEAF),  # ext E
    (0x2CEB0, 0x2EBEF),  # ext F
    (0x2EBF0, 0x2EE5D),  # ext I
    (0x2F800, 0x2FA1F),  # compatibility supplement
    (0x30000, 0x3134A),  # ext G
    (0x31350, 0x323AF),  # ext H
)


def is_han(ch: str) -> bool:
    o = ord(ch)
    for a, b in HAN_RANGES:
        if a <= o <= b:
            return True
    return False


def all_han(s: str) -> bool:
    return bool(s) and all(is_han(c) for c in s)


def one_han(s: str) -> bool:
    return len(s) == 1 and is_han(s)


def is_hangul(s: str) -> bool:
    return bool(s) and all(0xAC00 <= ord(c) <= 0xD7A3 for c in s)


def mb(n: int) -> str:
    return "%.1f MB" % (n / (1024.0 * 1024.0))


def log(*a):
    print(*a, flush=True)


# ---------------------------------------------------------------- download

def _curl(args):
    return subprocess.run(["curl"] + args, capture_output=True, text=True, errors="replace")


def remote_size(url: str) -> int:
    r = _curl(["-sIL", "--max-time", "60", url])
    if r.returncode != 0:
        return -1
    sizes = re.findall(r"^content-length:\s*(\d+)", r.stdout or "", re.I | re.M)
    return int(sizes[-1]) if sizes else -1


def download(url: str, dest: str, force: bool = False) -> str:
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    have = os.path.getsize(dest) if os.path.exists(dest) else 0
    if force and have:
        os.remove(dest)
        have = 0
    want = remote_size(url)
    if have and want > 0 and have == want:
        log("  cached   %s (%s)" % (os.path.basename(dest), mb(have)))
        return dest
    if have and want > 0 and have > want:
        log("  local copy larger than remote; restarting %s" % os.path.basename(dest))
        os.remove(dest)
        have = 0
    log("  fetching %s%s" % (
        os.path.basename(dest),
        (" (resuming at %s of %s)" % (mb(have), mb(want))) if have else "",
    ))
    # -C - resumes a partial download; large files stay cached across reruns.
    rc = subprocess.run(
        ["curl", "-L", "--fail", "--retry", "3", "--retry-delay", "2",
         "-C", "-", "-o", dest, url]
    ).returncode
    now = os.path.getsize(dest) if os.path.exists(dest) else 0
    if rc != 0 and not (want > 0 and now == want):
        raise SystemExit("download failed (curl exit %s): %s" % (rc, url))
    log("  got      %s (%s)" % (os.path.basename(dest), mb(now)))
    return dest


# ---------------------------------------------------------------- text helpers

RE_WS = re.compile(r"\s+")
RE_HANJA_FORM_OF = re.compile(r"^hanja form of\s+\S+\s*", re.I)
RE_ALT_FORM_OF = re.compile(r"^alternative form of\s+\S+\s*", re.I)
# A leading parenthetical is a register label ("(chiefly South Korea)") ONLY
# when it contains no quotation marks: '(“jade”) See there...' carries the
# actual gloss in the quotes, and eating it leaves the boilerplate behind.
RE_LEAD_LABEL = re.compile(r"^\([^()\"“”]{0,40}\)\s*")
# Wiktionary cross-reference boilerplate that sometimes rides along in the
# form-of "extra" text; it is navigation, not meaning.
RE_XREF_TAIL = re.compile(
    r"\s*\bsee (there|its entry)\b[^.]*(\.|$)", re.I)
RE_SKIP_GLOSS = re.compile(
    r"^(romanization|romanisation|alternative form|alternative spelling|"
    r"synonym|obsolete form|archaic form|misspelling) of\b", re.I)
RE_PARENED = re.compile(r"^([^()]+)\((.+)\)$")


def clean_char_gloss(text) -> str:
    """Unwrap wiktextract 'hanja form of X ("gloss")' into just the gloss."""
    s = RE_WS.sub(" ", str(text or "")).strip().rstrip(".")
    s = RE_XREF_TAIL.sub("", s).strip()
    for _ in range(6):
        t = s
        t = RE_HANJA_FORM_OF.sub("", t)
        t = RE_ALT_FORM_OF.sub("", t)
        t = t.strip().rstrip(".")
        if len(t) >= 2 and t[0] == "(" and t[-1] == ")":
            t = t[1:-1].strip()
        if len(t) >= 2 and t[0] in "“\"" and t[-1] in "”\"":
            t = t[1:-1].strip()
        if t == s:
            break
        s = t
    return s


# Glosses are emitted in full (SPEC "No truncation" addendum). Visual
# compactness is the UI's job. The cap is a safety valve against a runaway
# sense and DROPS the whole gloss - it never emits a cut string.
#
# 4,819 "senses" are really wiktextract dumping a reading table into the gloss
# ("More information(eumhun reading: 하나 일 (hana il)) (MC reading: …"); they run
# 728+ chars and are matched by shape, not length. With those gone the longest
# genuine definition is 547 chars (-더-, the retrospective suffix), so the cap
# sits at 600: 400 would have silently dropped real definitions for 世襲巫,
# 降神巫 and -더-, which is the loss this addendum exists to prevent.
GLOSS_MAX_CHARS = 600
RE_GLOSS_ARTIFACT = re.compile(r"^More information\b")

# Regional-variant tags arrive mangled: 'stock^(US)/share<sup>UK</sup> price'
# survives as 'stock^(US)/shareᵁᴷ price'. Only superscript LETTERS are markup;
# superscript digits carry meaning in the numeral glosses (億 '10⁸', 町 'm²',
# 二酸化炭素 'CO₂') and must survive untouched.
SUP_LETTERS = str.maketrans(
    "ᵃᵇᶜᵈᵉᶠᵍʰⁱʲᵏˡᵐⁿᵒᵖʳˢᵗᵘᵛʷˣʸᶻᴬᴮᴰᴱᴳᴴᴵᴶᴷᴸᴹᴺᴼᴾᴿᵀᵁⱽᵂ",
    "abcdefghijklmnopRstuvwxyzABDEGHIJKLMNOPRTUVW",
)
RE_SUP_RUN = re.compile(r"(?<=[A-Za-z])([ᵃ-ᶻᴬ-ᵂⱽ]{2,})")
RE_CARET_TAG = re.compile(r"\^(?=\()")


def clean_gloss(text) -> str:
    s = RE_WS.sub(" ", str(text or "")).strip()
    s = RE_XREF_TAIL.sub("", s).strip()
    s = RE_LEAD_LABEL.sub("", s)           # drop "(chiefly South Korea)" etc.
    s = RE_CARET_TAG.sub(" ", s)           # 'stock^(US)' -> 'stock (US)'
    s = RE_SUP_RUN.sub(lambda m: " (" + m.group(1).translate(SUP_LETTERS) + ")", s)
    s = RE_WS.sub(" ", s).strip()
    if RE_GLOSS_ARTIFACT.match(s) or len(s) > GLOSS_MAX_CHARS:
        return ""
    return s


def push_unique(lst, v, maxlen):
    if v and len(lst) < maxlen and v not in lst:
        lst.append(v)


RE_GLOSS_NOISE = re.compile(r"[^0-9a-z가-힣]+")


def push_gloss(lst, v, maxlen):
    """Like push_unique but ignores punctuation/case when comparing, so
    'salon, hall (in a traditional Korean house)' does not sit next to
    'salon, hall in a traditional Korean house' after two entries merge."""
    if not v or len(lst) >= maxlen:
        return
    key = RE_GLOSS_NOISE.sub("", v.lower())
    if not key:
        return
    for existing in lst:
        if RE_GLOSS_NOISE.sub("", existing.lower()) == key:
            return
    lst.append(v)


# ---------------------------------------------------------------- parse state

chars = {}      # char -> dict(eumhun={key:{hun,eum}}, readings=[], glosses=[], derived=[])
wiki_alt = {}   # variant char -> (target, prio)
words = {}      # hanja spelling -> {hangul: {"glosses": [...], "score": float}}

# --- frequency signals harvested from the whole corpus ----------------------
# ngram_freq: how often a hangul 2..4-gram occurs in Wiktionary example
#   sentences. This is the closest thing to a real corpus frequency count that
#   is available offline, and it is what drives compound ranking.
# inbound: how many entries point at a hangul word through
#   derived / synonyms / related / antonyms / hypernyms / hyponyms.
ngram_freq = collections.Counter()
inbound = collections.Counter()
# alt_inbound is keyed by *hanja spelling*, so unlike the hangul-keyed signals
# above it can tell homographs apart (e.g. 國家 vs 國歌, both 국가).
alt_inbound = collections.Counter()
# (hanja spelling, hangul) -> english gloss (may be "") for words that only
# ever appear inside another entry's derived/related list
rel_pairs = {}
# Hangul headwords that also exist as a Korean entry with NO hanja spelling,
# i.e. a native (or otherwise non-sino) word: 사랑 "love", 우리 "we". For these
# the hangul-keyed frequency signals belong to the native word and must not be
# credited to a sino-Korean homograph like 舍廊 / 牛李.
native_hangul = set()

stats = {"lines": 0, "parsed": 0, "char_senses": 0, "alt_senses": 0,
         "examples": 0, "hanja_headwords": 0}

HANGUL_RUN = re.compile(r"[가-힣]+")
REL_KEYS = ("derived", "synonyms", "related", "antonyms",
            "hypernyms", "hyponyms", "coordinate_terms")


def collect_signals(o):
    """Corpus-frequency and inbound-link counts, gathered over every ko entry."""
    for s in o.get("senses") or []:
        for ex in s.get("examples") or []:
            t = ex.get("text")
            if not t:
                continue
            stats["examples"] += 1
            for run in HANGUL_RUN.findall(t):
                n = len(run)
                for size in (2, 3, 4):
                    for i in range(0, n - size + 1):
                        ngram_freq[run[i:i + size]] += 1
        for key in REL_KEYS:
            for d in s.get(key) or []:
                _note_ref(d)
    for key in REL_KEYS:
        for d in o.get(key) or []:
            _note_ref(d)


def _note_ref(d):
    raw = (d.get("word") or "").strip()
    w = raw.split("(")[0].strip()
    if is_hangul(w) and len(w) >= 2:
        inbound[w] += 1
    alt = (d.get("alt") or "").strip()
    if not (len(alt) >= 2 and all_han(alt)) and "(" in raw:
        m = RE_PARENED.match(raw)                             # "견공(犬公)"
        if m and len(m.group(2)) >= 2 and all_han(m.group(2)):
            alt, w = m.group(2), m.group(1).strip()
    if len(alt) >= 2 and all_han(alt):
        alt_inbound[alt] += 1
        # a (hangul, hanja) pair asserted anywhere in Wiktionary is a real
        # sino-Korean word even when it has no page of its own
        if is_hangul(w):
            gloss = clean_gloss(d.get("english") or d.get("translation") or "")
            prev = rel_pairs.get((alt, w))
            if prev is None or (gloss and not prev):
                rel_pairs[(alt, w)] = gloss


def get_char(c):
    e = chars.get(c)
    if e is None:
        e = {"eumhun": {}, "readings": [], "glosses": [], "derived": []}
        chars[c] = e
    return e


def note_alt(variant: str, target: str, prio: int):
    if not one_han(variant) or not one_han(target) or variant == target:
        return
    cur = wiki_alt.get(variant)
    if cur is None or prio < cur[1]:
        wiki_alt[variant] = (target, prio)


def add_reading(e, eum):
    """A hanja reading is exactly one hangul syllable."""
    eum = strip_markers(eum)
    if len(eum) == 1 and is_hangul(eum):
        push_unique(e["readings"], eum, 8)


# wiktextract passes template markers through verbatim. '^' is a capitalization
# flag, not content: 韓 arrives as both '한국(韓國) 한' and '^한국(韓國) 한', which
# must normalize to one pair. '-' marks a morpheme boundary ('사람-의 성(姓)').
RE_WIKT_MARKER = re.compile(r"^[\^\-\*]+")


def strip_markers(s):
    return RE_WIKT_MARKER.sub("", str(s or "")).strip()


def clean_hun(hun):
    """'^한국(韓國)' -> '한국(韓國)';  '사람-의 성(姓)' -> '사람의 성(姓)'."""
    h = strip_markers(hun).replace("-", "").strip()
    h = re.sub(r"\s+\(", "(", h)
    return RE_WS.sub(" ", h).strip()


# A hangeul/eumhun template arg can pack several values:
#   '설, 세, 열'      three readings
#   '륜>윤'           initial-sound alternation - BOTH are valid readings
#   '벼슬 위; 다리미 울'  two full hun+eum pairs
RE_READING_SEP = re.compile(r"[,、;>/]")


def split_readings(value):
    return [p.strip() for p in RE_READING_SEP.split(str(value or "")) if p.strip()]


def add_eumhun_or_reading(e, chunk):
    """'나라 국' -> hun+eum pair;  '국' -> bare reading."""
    toks = chunk.split()
    if len(toks) >= 2:
        add_eumhun(e, " ".join(toks[:-1]), toks[-1])
    elif toks:
        add_reading(e, toks[0])


def add_eumhun(e, hun, eum):
    hun = clean_hun(hun)
    eum = strip_markers(eum)
    if len(eum) != 1 or not is_hangul(eum):
        return
    if hun and not any(0xAC00 <= ord(ch) <= 0xD7A3 for ch in hun):
        hun = ""
    if hun:
        key = hun + " " + eum
        if key not in e["eumhun"]:
            e["eumhun"][key] = {"hun": hun, "eum": eum}
    add_reading(e, eum)


def handle_character_entry(o):
    c = o.get("word") or ""
    if not one_han(c):
        return
    senses = o.get("senses") or []

    # wiktextract renders "hanja form of <reading>" two different ways:
    #   tags ["form-of","hanja"] + form_of[{word: "국"}]      (國)
    #   tags ["alt-of","hanja"]  + alt_of [{word: "문"}]      (文, 金, 小, 中, 時)
    # Only a pointer whose target is itself a *Han character* is a real
    # variant link ("alternative form of 國"); a hangul target is the
    # character's Korean reading, i.e. a genuine definition sense.
    real = []
    for s in senses:
        tags = s.get("tags") or []
        han_targets = [(a.get("word") or "").strip()
                       for a in (s.get("alt_of") or [])]
        han_targets = [t for t in han_targets if one_han(t)]
        if han_targets and ("alt-of" in tags or "alternative" in tags):
            for t in han_targets:
                note_alt(c, t, PRIO_KO_ALT)
                stats["alt_senses"] += 1
        else:
            real.append(s)

    # canonical pages list their variants under forms tagged "alternative": invert
    for f in o.get("forms") or []:
        tags = f.get("tags") or []
        form = (f.get("form") or "").strip()
        if ("alternative" in tags or "alt-of" in tags) and one_han(form):
            note_alt(form, c, PRIO_KO_FORMS)

    if not real:
        return  # pure alt-form page

    stats["char_senses"] += len(real)
    e = get_char(c)

    # eumhun from forms tagged "eumhun" ("나라 국")
    for f in o.get("forms") or []:
        tags = f.get("tags") or []
        form = str(f.get("form") or "").strip()
        if "eumhun" in tags and form:
            parts = form.split()
            if len(parts) >= 2:
                add_eumhun(e, " ".join(parts[:-1]), parts[-1])
            elif parts:
                add_reading(e, parts[0])
        elif "hangeul" in tags and form:
            # eum-only hanja pages (ko-hanja|복 / ko-hanja/old) expand the
            # reading into forms tagged "hangeul" instead of "eumhun".
            for part in split_readings(form):
                add_eumhun_or_reading(e, part)

    # head templates: ko-hanja|hun|eum, ko-hanja|eum, ko-hanja/old|hangeul=...
    for h in o.get("head_templates") or []:
        if not str(h.get("name") or "").startswith("ko-hanja"):
            continue
        args = h.get("args") or {}
        a1, a2, a3 = args.get("1"), args.get("2"), args.get("3")
        if a1 and a2 and a3:
            add_eumhun(e, a2, a3)          # {dict form, hun, eum} e.g. 小
        elif a1 and a2:
            add_eumhun(e, a1, a2)          # hun + eum
        elif a1:
            add_reading(e, str(a1).strip())  # eum only
        for part in split_readings(args.get("hangeul")):
            add_eumhun_or_reading(e, part)
        for chunk in split_readings(args.get("eumhun")):
            add_eumhun_or_reading(e, chunk)

    # readings from the pronunciation block
    for s in o.get("sounds") or []:
        add_reading(e, s.get("hangeul") or "")

    for s in real:
        got = False
        # both spellings of the same idea: form_of and (hangul-target) alt_of
        for fo in (s.get("form_of") or []) + (s.get("alt_of") or []):
            w = fo.get("word") or ""
            if len(w) == 1 and is_hangul(w):
                push_unique(e["readings"], w, 8)
            g = clean_char_gloss(fo.get("extra"))
            if g and re.search(r"[A-Za-z]", g):
                push_gloss(e["glosses"], clean_gloss(g), 6)
                got = True
        if not got:
            for g in s.get("glosses") or []:
                cg = clean_char_gloss(g)
                if cg and re.search(r"[A-Za-z]", cg):
                    push_gloss(e["glosses"], clean_gloss(cg), 6)

        # curated compound list straight off the Wiktionary hanja page
        for d in s.get("derived") or []:
            hangul = (d.get("word") or "").strip()
            hanja = (d.get("alt") or "").strip()
            gloss = clean_gloss(d.get("english") or d.get("translation") or "")
            if hanja and len(hanja) >= 2 and all_han(hanja) and c in hanja:
                e["derived"].append({
                    "hangul": hangul if is_hangul(hangul) else "",
                    "hanja": hanja,
                    "gloss": gloss,
                })
            elif not hanja and "(" in hangul and hangul.endswith(")"):
                m = RE_PARENED.match(hangul)          # e.g. "견공(犬公)"
                if m and len(m.group(2)) >= 2 and all_han(m.group(2)) and c in m.group(2):
                    e["derived"].append({
                        "hangul": m.group(1) if is_hangul(m.group(1)) else "",
                        "hanja": m.group(2),
                        "gloss": gloss,
                    })


def word_score(o) -> float:
    """Richness proxy for 'how common / well attested is this word'."""
    s = 0.0
    senses = o.get("senses") or []
    s += min(len(senses), 6) * 1.0
    for sn in senses:
        s += min(len(sn.get("examples") or []), 4) * 0.5
        s += min(len(sn.get("synonyms") or []), 6) * 0.25
        s += min(len(sn.get("antonyms") or []), 6) * 0.25
        s += min(len(sn.get("related") or []), 8) * 0.15
        s += min(len(sn.get("derived") or []), 12) * 0.3
        s += min(len(sn.get("hypernyms") or []), 6) * 0.2
    s += min(len(o.get("translations") or []), 20) * 0.5
    s += min(len(o.get("derived") or []), 12) * 0.3
    s += min(len(o.get("related") or []), 8) * 0.15
    if o.get("etymology_text"):
        s += 1.0
    if o.get("sounds"):
        s += 0.5
    if o.get("descendants"):
        s += 0.5
    return s


def handle_word_entry(o):
    if o.get("pos") in ("character", "romanization"):
        return
    hangul = o.get("word") or ""
    if not is_hangul(hangul):
        return

    spellings = set()
    for f in o.get("forms") or []:
        if "hanja" not in (f.get("tags") or []):
            continue
        # a single form may carry several spellings: "美國/米國"
        for part in re.split(r"[,/]", str(f.get("form") or "")):
            form = part.strip()
            if len(form) >= 2 and all_han(form):
                spellings.add(form)
    if not spellings:
        # fall back to the head template arg (ko-noun|hanja=...)
        for h in o.get("head_templates") or []:
            v = (h.get("args") or {}).get("hanja")
            if v:
                for part in re.split(r"[,/]", str(v)):
                    form = part.strip()
                    if len(form) >= 2 and all_han(form):
                        spellings.add(form)
    if not spellings:
        # no hanja at all: a native word competing for this hangul reading
        if any(s.get("glosses") for s in (o.get("senses") or [])):
            native_hangul.add(hangul)
        return

    glosses = []
    fallback = []
    for s in o.get("senses") or []:
        if "no-gloss" in (s.get("tags") or []):
            continue
        gl = s.get("glosses") or []
        if not gl:
            continue
        g = gl[-1]
        if RE_SKIP_GLOSS.match(g or ""):
            push_gloss(fallback, clean_gloss(g), 3)
            continue
        push_gloss(glosses, clean_gloss(g), 3)
    if not glosses:
        glosses = fallback          # better a "form of" pointer than nothing
    # Entries with no usable gloss are still worth keeping: the popup can show
    # the hangul reading and the per-character breakdown.

    score = word_score(o)
    for sp in spellings:
        add_word(sp, hangul, glosses, score)


def add_word(sp, hangul, glosses, score, hanja_page=False):
    """hanja_page marks a ROBUST entry living at the hanja-spelling title
    (大韓民國), as opposed to the usual hangul title (국민) or a mere
    'hanja form of X' soft-redirect stub. The UI uses it to point the word
    card's Wiktionary link at whichever page carries the real entry."""
    bucket = words.setdefault(sp, {})
    cur = bucket.get(hangul)
    if cur is None:
        bucket[hangul] = {"glosses": list(glosses[:3]), "score": score,
                          "hp": bool(hanja_page)}
    else:
        for g in glosses:
            push_gloss(cur["glosses"], g, 3)
        cur["score"] = max(cur["score"], score)
        cur["hp"] = cur.get("hp", False) or bool(hanja_page)


def handle_hanja_headword_entry(o):
    """Entries whose *headword* is the hanja spelling (安全, 明日, 大韓民國).

    These are ordinary sino-Korean words written the other way round: the
    hangul reading sits in a form tagged "hangeul" and the sense reads
    'hanja form of 안전 (“safety”)'. They are a large slice of the dictionary
    and are missed entirely if you only look at hangul-headword entries.
    """
    sp = (o.get("word") or "").strip()
    if len(sp) < 2 or not all_han(sp):
        return

    hangul = ""
    for f in o.get("forms") or []:
        if "hangeul" in (f.get("tags") or []):
            cand = str(f.get("form") or "").strip()
            if is_hangul(cand):
                hangul = cand
                break
    if not hangul:
        for h in o.get("head_templates") or []:
            cand = str((h.get("args") or {}).get("hangeul") or "").strip()
            if is_hangul(cand):
                hangul = cand
                break
    if not hangul:
        return

    glosses = []
    for s in o.get("senses") or []:
        if "no-gloss" in (s.get("tags") or []):
            continue
        hit = False
        for fo in (s.get("form_of") or []) + (s.get("alt_of") or []):
            g = clean_char_gloss(fo.get("extra"))
            if g and re.search(r"[A-Za-z]", g):
                push_gloss(glosses, clean_gloss(g), 3)
                hit = True
        if not hit:
            for g in s.get("glosses") or []:
                cg = clean_char_gloss(g)
                if cg and re.search(r"[A-Za-z]", cg):
                    push_gloss(glosses, clean_gloss(cg), 3)

    stats["hanja_headwords"] += 1
    # hanja_page unconditionally: even when the Korean section is only a
    # "hanja form of X" stub, the hanja-titled page carries the Chinese and
    # Japanese entries for the same spelling — the cross-language content is
    # the point of linking there (user decision, 2026-08-16). Words only ever
    # seen via hangul headwords keep hangul links: their hanja page may not
    # exist at all.
    add_word(sp, hangul, glosses, word_score(o), hanja_page=True)


def parse_kaikki(path):
    """Stream the JSONL line by line; the file is never loaded whole."""
    with open(path, "rb", buffering=1 << 20) as fh:
        for line in fh:
            stats["lines"] += 1
            if stats["lines"] % 20000 == 0:
                log("  ... %s lines" % format(stats["lines"], ","))
            if not line.startswith(b"{"):
                continue
            try:
                o = json.loads(line)
            except ValueError:
                continue
            if o.get("lang_code") != "ko":
                continue
            stats["parsed"] += 1
            collect_signals(o)
            pos = o.get("pos")
            if pos == "character":
                handle_character_entry(o)
            elif pos != "romanization":
                word = (o.get("word") or "").strip()
                if len(word) >= 2 and all_han(word):
                    handle_hanja_headword_entry(o)
                else:
                    handle_word_entry(o)


# ---------------------------------------------------------------- Unihan

# Variant-source priorities: lower wins when several sources disagree.
#
# Ordering was tuned against the 12 cases where Translingual and Unihan both
# name a canonical that exists in hanja.json. Translingual's explicit "Han simp"
# etymology is right every time (歴→歷, 関→關, where Unihan's kSemanticVariant
# says 曆/闗), so it outranks Unihan. Its looser related[] links lose more often
# than they win (卫→衞 vs 衛, 发→髮 vs 發, 团→糰 vs 團, 宽→寛 vs 寬, 须→鬚 vs 須),
# so kTraditionalVariant outranks those. Shinjitai coverage is unaffected either
# way: Unihan has no opinion at all on 気/実/楽/戦/続.
PRIO_KO_ALT = 0          # Korean Wiktionary "alternative form of"
PRIO_KO_FORMS = 1        # Korean Wiktionary forms tagged "alternative", inverted
PRIO_MUL_SIMP = 2        # Translingual "Han simp" etymology template
PRIO_UNI_TRAD = 3        # Unihan kTraditionalVariant
PRIO_JA_SIMP = 4         # ja.wiktionary "「X」の略体/略字/新字体/俗字/変形"
PRIO_MUL_REL_TAG = 5     # Translingual related[], tagged shinjitai/Simplified
PRIO_MUL_REL_LABEL = 6   # Translingual related[], labelled orthodox/kyujitai
PRIO_JA_VAR = 7          # ja.wiktionary "「X」の異体字" (direction less certain)
PRIO_UNI_SIMP = 8        # Unihan kSimplifiedVariant, inverted
PRIO_UNI_Z = 9           # Unihan kZVariant
PRIO_UNI_SEM = 10        # Unihan kSemanticVariant

PRIO_NAMES = {
    PRIO_KO_ALT: "wiktionary-ko alt-of",
    PRIO_KO_FORMS: "wiktionary-ko forms",
    PRIO_MUL_SIMP: "translingual Han-simp",
    PRIO_UNI_TRAD: "kTraditionalVariant",
    PRIO_JA_SIMP: "ja-wiktionary ryakutai",
    PRIO_MUL_REL_TAG: "translingual related(tag)",
    PRIO_MUL_REL_LABEL: "translingual related(label)",
    PRIO_JA_VAR: "ja-wiktionary itaiji",
    PRIO_UNI_SIMP: "kSimplifiedVariant(inv)",
    PRIO_UNI_Z: "kZVariant",
    PRIO_UNI_SEM: "kSemanticVariant",
}

# related[] tag vocabulary. "the linked character is the SIMPLER one" vs
# "the linked character is the ORTHODOX one".
TAGS_LINKED_IS_VARIANT = {"shinjitai", "Simplified", "simplified"}
TAGS_LINKED_IS_CANONICAL = {"Traditional", "traditional", "kyūjitai", "kyujitai"}
RE_LABEL_LINKED_IS_CANONICAL = re.compile(
    r"orthodox|traditional form|ky[uū]jitai", re.I)
RE_LABEL_LINKED_IS_VARIANT = re.compile(r"^simplified form|shinjitai", re.I)


def parse_translingual(path):
    """Harvest variant -> canonical links from the Translingual extract.

    Two shapes carry the information:
      1. etymology_templates {"name": "Han simp", "args": {"1": "戰"}} on the
         simplified/shinjitai page  ->  (戦, 戰)
      2. related[] entries, either tagged (實 -> {tags:[Japanese,shinjitai],
         word:実}  =>  実 is the variant) or labelled (気 -> {alt:"Kyūjitai
         form of 気", word:氣}  =>  氣 is the canonical).
    Direction is resolved per shape; ambiguous labels ("Variant form") are
    skipped rather than guessed.
    """
    out = []
    lines = 0
    with open(path, "rb", buffering=1 << 20) as fh:
        for line in fh:
            lines += 1
            if not line.startswith(b"{"):
                continue
            try:
                o = json.loads(line)
            except ValueError:
                continue
            if o.get("pos") != "character":
                continue
            w = (o.get("word") or "").strip()
            if not one_han(w):
                continue

            # 1. "Han simp": this page IS the simplified form of args["1"]
            for t in o.get("etymology_templates") or []:
                if (t.get("name") or "") != "Han simp":
                    continue
                src = str((t.get("args") or {}).get("1") or "").strip()
                if one_han(src):
                    out.append((w, src, PRIO_MUL_SIMP))

            # 2. related[] links, top level and per sense
            rels = list(o.get("related") or [])
            for s in o.get("senses") or []:
                rels.extend(s.get("related") or [])
            for r in rels:
                v = (r.get("word") or "").strip()
                if not one_han(v):
                    continue
                tags = set(r.get("tags") or [])
                if tags & TAGS_LINKED_IS_VARIANT:
                    out.append((v, w, PRIO_MUL_REL_TAG))
                elif tags & TAGS_LINKED_IS_CANONICAL:
                    out.append((w, v, PRIO_MUL_REL_TAG))
                elif not tags:
                    label = " ".join(str(r.get(k) or "") for k in
                                     ("alt", "english", "translation", "roman"))
                    if RE_LABEL_LINKED_IS_VARIANT.search(label):
                        out.append((v, w, PRIO_MUL_REL_LABEL))
                    elif RE_LABEL_LINKED_IS_CANONICAL.search(label):
                        out.append((w, v, PRIO_MUL_REL_LABEL))
    log("  translingual: %s lines, %s candidate variant links"
        % (format(lines, ","), format(len(out), ",")))
    return out


# ja.wiktionary states shinjitai origins as prose in etymology_texts:
#   図 -> "「圖」の略体。"          (abbreviated form of 圖)
#   楽 -> "「樂」の行書体に由来する略体。"
#   礼 -> "形声。…。「禮」の音符を入れ替えた略体。"
# The match is anchored to the start of a sentence and may not step over any
# other bracketed character, because relation phrases also occur mid-sentence
# about *other* characters -- 親's etymology contains "（「新」の略字）", which
# an unanchored regex would happily turn into 親 -> 新.
RE_JA_SIMP = re.compile(
    r"^[「『](.)[」』]の[^。「」『』]{0,16}?(?:略体|略字|新字体|俗字|変形)")
RE_JA_VAR = re.compile(
    r"^[「『](.)[」』]の[^。「」『』]{0,16}?異体字")


# Korean is agglutinative, so a noun rarely appears bare in running text:
# 의중 has 0 occurrences as a token but 의중을 / 의중에 / 의중대로 do occur.
# Counts are folded back onto the stem when the tail is a known particle or
# light suffix. The tail list is deliberately closed - prefix matching would
# credit 인도 for every occurrence of 인도네시아.
KO_PARTICLES = frozenset("""
은 는 이 가 을 를 에 의 도 로 으로 와 과 만 부터 까지 에서 에게 께 한테
라 이라 라고 이라고 나 이나 든 이든 야 이야 여 이여 들 들이 들을 들은 들과
적 적인 적으로 성 화 한 할 하는 하다 해 했다 하고 하며 하지 하나
이다 입니다 이었다 였다 인 인데 이지 지 요 죠 이죠 대로 처럼 보다 마다
조차 밖에 뿐 째 씩 이나마 라도 이라도 에는 에도 에서는 으로는 로는 께서
""".split())


def parse_ext_freq(path):
    """hangul stem -> external corpus frequency (0 when unattested)."""
    freq = collections.Counter()
    tokens = 0
    with open(path, "r", encoding="utf-8", errors="replace") as fh:
        for line in fh:
            parts = line.split()
            if len(parts) != 2:
                continue
            word, count = parts[0], parts[1]
            if not is_hangul(word) or len(word) < 2:
                continue
            try:
                n = int(count)
            except ValueError:
                continue
            tokens += 1
            freq[word] += n
            for k in range(2, len(word)):
                if word[k:] in KO_PARTICLES:
                    freq[word[:k]] += n
    log("  external frequency: %s tokens -> %s stems (OpenSubtitles 2018)"
        % (format(tokens, ","), format(len(freq), ",")))
    return freq


def parse_japanese(path):
    """Harvest variant -> canonical links from the ja.wiktionary extract."""
    out = []
    lines = 0
    with gzip.open(path, "rb") as fh:
        for line in fh:
            lines += 1
            if not line.startswith(b"{"):
                continue
            try:
                o = json.loads(line)
            except ValueError:
                continue
            w = (o.get("word") or "").strip()
            if not one_han(w):
                continue
            ety = o.get("etymology_texts") or o.get("etymology_text") or []
            if isinstance(ety, str):
                ety = [ety]
            for text in ety:
                for sentence in str(text).split("。"):
                    s = sentence.strip()
                    if not s:
                        continue
                    m = RE_JA_SIMP.match(s)
                    if m and one_han(m.group(1)):
                        out.append((w, m.group(1), PRIO_JA_SIMP))
                        continue
                    m = RE_JA_VAR.match(s)
                    if m and one_han(m.group(1)):
                        out.append((w, m.group(1), PRIO_JA_VAR))
    log("  japanese: %s lines, %s candidate variant links"
        % (format(lines, ","), format(len(out), ",")))
    return out


def parse_unihan_readings(text):
    """char -> (kDefinition, [kHangul readings]) for gap-filling."""
    defs, hangul = {}, {}
    for raw in text.split("\n"):
        if not raw or raw[0] == "#":
            continue
        parts = raw.rstrip("\r").split("\t")
        if len(parts) < 3:
            continue
        src_u, field, value = parts[0], parts[1], parts[2]
        if field not in ("kDefinition", "kHangul"):
            continue
        if not re.match(r"^U\+[0-9A-F]+$", src_u):
            continue
        try:
            ch = chr(int(src_u[2:], 16))
        except ValueError:
            continue
        if field == "kDefinition":
            defs[ch] = value
        else:
            # "일:0E" / "일:0E 항:0N" -> readings before the colon
            rs = []
            for tok in value.split():
                r = tok.split(":")[0]
                if len(r) == 1 and is_hangul(r):
                    rs.append(r)
            if rs:
                hangul[ch] = rs
    return defs, hangul


def parse_unihan_variants(text):
    """Yield (variant, canonical, priority); lower priority number wins."""
    out = []
    for raw in text.split("\n"):
        if not raw or raw[0] == "#":
            continue
        parts = raw.rstrip("\r").split("\t")
        if len(parts) < 3:
            continue
        src_u, field, values = parts[0], parts[1], parts[2]
        if not re.match(r"^U\+[0-9A-F]+$", src_u):
            continue
        try:
            src = chr(int(src_u[2:], 16))
        except ValueError:
            continue
        for tok in values.split():
            m = re.match(r"^U\+([0-9A-F]+)", tok)
            if not m:
                continue
            val = chr(int(m.group(1), 16))
            if field == "kTraditionalVariant":
                # source (simplified / shinjitai) -> its traditional form
                out.append((src, val, PRIO_UNI_TRAD))
            elif field == "kSimplifiedVariant":
                # source is traditional, value is the simplified form: invert
                out.append((val, src, PRIO_UNI_SIMP))
            elif field == "kZVariant":
                out.append((src, val, PRIO_UNI_Z))
            elif field == "kSemanticVariant":
                out.append((src, val, PRIO_UNI_SEM))
    return out


# ---------------------------------------------------------------- emit

def write_json(name, obj):
    path = os.path.join(OUT, name)
    data = json.dumps(obj, ensure_ascii=False, separators=(",", ":"))
    with open(path, "w", encoding="utf-8", newline="") as fh:   # utf-8, no BOM
        fh.write(data)
    return os.path.getsize(path)


def verify(hanja_obj, words_obj, variants_obj):
    chars_out = hanja_obj["chars"]
    words_out = words_obj["words"]
    by_hangul = words_obj["byHangul"]
    vmap = variants_obj["map"]

    guk = chars_out.get("國")  # 國
    checks = []

    def add(name, ok, detail):
        checks.append((name, bool(ok), detail))

    add("國 present in hanja.json", guk is not None,
        json.dumps(guk, ensure_ascii=False) if guk else "MISSING")
    add("國 eumhun 나라/국",
        guk and any(x["hun"] == "나라" and x["eum"] == "국" for x in guk["eumhun"]),
        json.dumps(guk["eumhun"], ensure_ascii=False) if guk else "MISSING")
    add("國 glosses mention 'country'",
        guk and any(re.search("country", g, re.I) for g in guk["glosses"]),
        json.dumps(guk["glosses"], ensure_ascii=False) if guk else "MISSING")
    add("國 compounds include 국민/國民",
        guk and any(x["hanja"] == "國民" and x["hangul"] == "국민"
                    for x in guk["compounds"]),
        json.dumps(guk["compounds"], ensure_ascii=False) if guk else "MISSING")
    # common characters that a naive "alt-of means variant" filter drops
    common = ["文", "金", "小", "中", "時", "字", "人", "水", "民", "學",
              "日", "山", "大", "母", "食", "心", "生", "年", "手", "天"]
    missing = [c for c in common if c not in chars_out]
    add("20 very common hanja all present", not missing,
        "missing: %s" % (" ".join(missing) if missing else "(none)"))
    for c in ("文", "金", "小", "中", "時"):
        v = chars_out.get(c)
        add("  %s entry" % c, v is not None,
            (", ".join("%s %s" % (x["hun"], x["eum"]) for x in v["eumhun"])
             + " | readings " + ",".join(v["readings"])
             + " | " + "; ".join(v["glosses"][:2])
             + " | compounds " + ", ".join("%s(%s)" % (x["hangul"], x["hanja"])
                                           for x in v["compounds"][:4]))
            if v else "MISSING")

    # SPEC "No truncation": nothing anywhere may be a cut string. The build
    # emits no truncation marker at all now (overlong senses are dropped
    # whole), so the signature to look for is a TRAILING ellipsis. A few
    # glosses legitimately contain '…' mid-string - Wiktionary's '[…]' elision
    # and 點點點, which literally means "ellipsis" - so those are counted and
    # reported rather than failed.
    def all_glosses():
        for c, e in chars_out.items():
            for g in e["glosses"]:
                yield "hanja[%s]" % c, g
            for x in e["compounds"]:
                yield "hanja[%s].compound[%s]" % (c, x["hanja"]), x["gloss"]
        for sp, lst in words_out.items():
            for s in lst:
                for g in s["glosses"]:
                    yield "words[%s]" % sp, g

    # The marker this build ever emitted was U+2026 '…'. A trailing '...' is
    # source text (一色 "all, totally, nothing but..."), so it is counted, not
    # failed - the build never produced three dots.
    cut, inline, dots = [], 0, 0
    for where, g in all_glosses():
        if g.rstrip().endswith("…"):
            cut.append("%s %r" % (where, g))
        else:
            if "…" in g:
                inline += 1
            if g.rstrip().endswith("..."):
                dots += 1
    add("no truncated gloss anywhere (none ends with U+2026 '…')", not cut,
        ("%d offenders, e.g. %s" % (len(cut), cut[:3])) if cut else
        "checked every char/compound/word gloss; 0 cut. %d contain a source "
        "ellipsis mid-string (e.g. 點點點 'dot dot dot'), %d end in a source "
        "'...' (e.g. 一色)" % (inline, dots))

    # SPEC eumhun normalization addendum
    han_eumhun = [(x["hun"], x["eum"]) for x in (chars_out.get("韓") or {}).get("eumhun", [])]
    edu_n = sum(1 for e in chars_out.values() if e.get("edu"))
    add("edu flag: 國/學 marked, sane coverage of the MOE 1800",
        (chars_out.get("國") or {}).get("edu") is True
        and (chars_out.get("學") or {}).get("edu") is True
        and 1500 <= edu_n <= 1800
        and edu_n < len(chars_out),
        "%d edu chars in corpus (of %d)" % (edu_n, len(chars_out)))
    ok_glosses = (chars_out.get("玉") or {}).get("glosses", [])
    xref = [g for e in chars_out.values() for g in e["glosses"]
            if "see there for further compounds" in g.lower()]
    add("玉 gloss recovered; no cross-ref boilerplate anywhere",
        any("jade" in g.lower() for g in ok_glosses) and not xref,
        "玉=%s | %d boilerplate glosses" % (
            json.dumps(ok_glosses, ensure_ascii=False), len(xref)))
    add("韓 eumhun normalized + deduped",
        han_eumhun == [("한국(韓國)", "한"), ("나라 이름", "한")],
        json.dumps(han_eumhun, ensure_ascii=False))
    marked = [(c, x) for c, e in chars_out.items() for x in e["eumhun"]
              if x["hun"].startswith(("^", "-", "*")) or x["eum"].startswith(("^", "-", "*"))]
    add("no wiktextract markers left in eumhun", not marked,
        "%d offenders, e.g. %s" % (len(marked), marked[:3]) if marked
        else "no leading ^ / - / * in any hun or eum")

    add("variants 国 -> 國", vmap.get("国") == "國", repr(vmap.get("国")))
    add("variants 学 -> 學", vmap.get("学") == "學", repr(vmap.get("学")))

    # Japanese shinjitai, only linked in Wiktionary's Translingual section
    shinjitai = {"気": "氣", "実": "實", "戦": "戰", "続": "續",
                 "楽": "樂", "広": "廣", "図": "圖", "県": "縣"}
    mapped, unmapped = [], []
    for var, canon in sorted(shinjitai.items()):
        if vmap.get(var) == canon:
            mapped.append("%s->%s" % (var, canon))
        else:
            why = ("has its own Korean hanja entry (readings %s) - not shadowed"
                   % ",".join(chars_out[var]["readings"])) if var in chars_out \
                  else ("no link in any source; got %r" % vmap.get(var))
            unmapped.append("%s: %s" % (var, why))
    add("shinjitai 気/実/図/戦/続/楽/広 mapped",
        all(vmap.get(v) == c for v, c in
            [("気", "氣"), ("実", "實"), ("図", "圖"), ("戦", "戰"),
             ("続", "續"), ("楽", "樂"), ("広", "廣")]),
        "mapped: " + ", ".join(mapped)
        + ("\n        unmapped: " + " | ".join(unmapped) if unmapped else ""))

    # Regression: a variant that has its own Korean entry must never be
    # remapped, or the popup would show the wrong character's data.
    for var, gloss in (("医", "동개 예"), ("県", "현"), ("缶", "부")):
        add("  %s keeps its own entry, stays unmapped (%s)" % (var, gloss),
            var in chars_out and var not in vmap,
            "in hanja.json=%s, variants[%s]=%r"
            % (var in chars_out, var, vmap.get(var)))
    # rare flag (SPEC addendum)
    def sense_of(sp, hangul):
        for s in words_out.get(sp, []):
            if s["hangul"] == hangul:
                return s
        return None

    # 士氣/史記/監査/修道 are common *secondary* homographs: an earlier draft of
    # the predicate flagged them because alt_inbound is sparse. Guarded here.
    not_rare = [("國民", "국민"), ("學校", "학교"),
                ("資本主義", "자본주의"), ("感謝", "감사"),
                ("士氣", "사기"), ("史記", "사기"),
                ("監査", "감사"), ("修道", "수도"),
                # real words with no Wiktionary attestation, rescued by the
                # external corpus
                ("意中", "의중"), ("正史", "정사"), ("療養院", "요양원")]
    rare_anchors = [("舍廊", "사랑"), ("牛李", "우리")]
    bad = []
    for sp, hg in not_rare:
        s = sense_of(sp, hg)
        if s is None or s.get("rare"):
            bad.append("%s(%s) should NOT be rare" % (sp, hg))
    for sp, hg in rare_anchors:
        s = sense_of(sp, hg)
        if s is None or not s.get("rare"):
            bad.append("%s(%s) SHOULD be rare" % (sp, hg))
    add("rare-flag anchors", not bad,
        "; ".join(bad) if bad else
        "not rare: 國民 學校 資本主義 感謝 士氣 史記 監査 修道 意中 正史 療養院"
        " | rare: 舍廊 牛李")
    add("byHangul puts non-rare first",
        all(not any(all(x.get("rare") for x in words_out[a])
                    and not all(x.get("rare") for x in words_out[b])
                    for a, b in zip(l, l[1:]))
            for l in by_hangul.values()),
        "e.g. 사랑 -> %s, 우리 -> %s"
        % (json.dumps(by_hangul.get("사랑"), ensure_ascii=False),
           json.dumps(by_hangul.get("우리"), ensure_ascii=False)))

    add("words.json 國民 -> 국민",
        any(x["hangul"] == "국민" for x in words_out.get("國民", [])),
        json.dumps(words_out.get("國民"), ensure_ascii=False))
    hp_count = sum(1 for lst in words_out.values()
                   for x in lst if x.get("hp"))
    add("hp flag: 大韓民國 marked, and flag is neither empty nor universal",
        any(x.get("hp") for x in words_out.get("大韓民國", []))
        and 0 < hp_count < sum(len(l) for l in words_out.values()),
        "大韓民國=%s | %s hp senses total" % (
            json.dumps(words_out.get("大韓民國"), ensure_ascii=False),
            format(hp_count, ",")))
    add("byHangul[국민] includes 國民",
        "國民" in (by_hangul.get("국민") or []),
        json.dumps(by_hangul.get("국민"), ensure_ascii=False))

    failed = 0
    log("=============== SPOT CHECKS ================")
    for name, ok, detail in checks:
        if not ok:
            failed += 1
        log("%s  %s\n        %s" % ("PASS" if ok else "FAIL", name, detail))
    return failed


def verify_only():
    def rd(n):
        with open(os.path.join(OUT, n), "r", encoding="utf-8") as fh:
            return json.load(fh)
    h, w, v = rd("hanja.json"), rd("words.json"), rd("variants.json")
    log("chars %s | words %s | byHangul %s | variants %s" % (
        format(len(h["chars"]), ","), format(len(w["words"]), ","),
        format(len(w["byHangul"]), ","), format(len(v["map"]), ",")))
    return verify(h, w, v)


# ---------------------------------------------------------------- main

def main(argv):
    if "--verify" in argv:
        raise SystemExit(1 if verify_only() else 0)
    force = "--force-download" in argv
    t0 = time.time()
    os.makedirs(CACHE, exist_ok=True)
    os.makedirs(OUT, exist_ok=True)

    log("[1/5] downloading sources into pipeline/cache")
    download(UNIHAN_URL, UNIHAN_FILE, force)
    download(KAIKKI_URL, KAIKKI_FILE, force)
    download(TRANSLINGUAL_URL, TRANSLINGUAL_FILE, force)
    download(JAPANESE_URL, JAPANESE_FILE, force)
    download(EXTFREQ_URL, EXTFREQ_FILE, force)

    log("[2/5] streaming kaikki Korean JSONL (line by line)")
    parse_kaikki(KAIKKI_FILE)
    log("  %s lines read, %s Korean entries parsed" % (
        format(stats["lines"], ","), format(stats["parsed"], ",")))
    log("  %s hanja chars (%s senses), %s alt-form senses" % (
        format(len(chars), ","), format(stats["char_senses"], ","),
        format(stats["alt_senses"], ",")))
    log("  %s hanja spellings (%s from hanja-headword entries)" % (
        format(len(words), ","), format(stats["hanja_headwords"], ",")))

    # Sino-Korean compounds that only exist inside a hanja page's "derived"
    # list (no standalone Wiktionary entry) still carry hangul + an English
    # translation, so they are worth keeping as low-ranked word entries.
    harvested = 0
    for (sp, hangul), gloss in rel_pairs.items():
        if sp in words:
            continue
        words[sp] = {hangul: {"glosses": [gloss] if gloss else [], "score": 0.4}}
        harvested += 1
    for e in chars.values():
        for d in e["derived"]:
            sp, hangul, gloss = d["hanja"], d["hangul"], d["gloss"]
            if not hangul or sp in words:
                continue
            words[sp] = {hangul: {"glosses": [gloss] if gloss else [], "score": 0.4}}
            harvested += 1
    log("  harvested %s reference-only words from derived/related lists"
        % format(harvested, ","))

    # Unihan gap-fill: thousands of rare hanja pages on Wiktionary are
    # reading-only ("no-gloss" senses). Unihan kDefinition supplies a short
    # English definition for them, and kHangul a reading where we have none.
    with zipfile.ZipFile(UNIHAN_FILE) as z:
        uni_defs, uni_hangul = parse_unihan_readings(
            z.read("Unihan_Readings.txt").decode("utf-8"))
    filled_g = filled_r = 0
    for c, e in chars.items():
        if not e["glosses"]:
            d = uni_defs.get(c)
            if d:
                for piece in re.split(r"\s*;\s*", d)[:3]:
                    push_gloss(e["glosses"], clean_gloss(piece), 6)
                if e["glosses"]:
                    filled_g += 1
        if not e["readings"]:
            for r in uni_hangul.get(c, ())[:4]:
                push_unique(e["readings"], r, 8)
            if e["readings"]:
                filled_r += 1
    log("  Unihan gap-fill: %s glosses, %s readings"
        % (format(filled_g, ","), format(filled_r, ",")))

    # Education-hanja flag (급 levels phase 1): kKoreanEducationHanja marks the
    # South Korean Ministry of Education "basic hanja for educational use"
    # list (1,800 chars, 2007 revision). Membership only — the field carries
    # no middle/high tier and no 급수. Unicode license; already cached.
    edu_set = set()
    with zipfile.ZipFile(UNIHAN_FILE) as z:
        for line in z.read("Unihan_OtherMappings.txt").decode("utf-8").splitlines():
            if "\tkKoreanEducationHanja\t" in line:
                edu_set.add(chr(int(line.split("\t")[0][2:], 16)))
    log("  kKoreanEducationHanja: %s chars" % format(len(edu_set), ","))

    # ---- words.json -------------------------------------------------
    log("[3/5] building words.json")
    log("  frequency signal: %s example sentences, %s distinct hangul n-grams"
        % (format(stats["examples"], ","), format(len(ngram_freq), ",")))
    ext_freq = parse_ext_freq(EXTFREQ_FILE)

    def final_score(sp, hangul, base):
        """Entry richness + corpus frequency + inbound links.

        ngram_freq/inbound are keyed by hangul and so are identical for
        homographs; alt_inbound is keyed by the hanja spelling and is what
        separates e.g. 國家 from 國歌.
        """
        return (base
                + 2.5 * math.log1p(ngram_freq.get(hangul, 0))
                + 1.2 * math.log1p(inbound.get(hangul, 0))
                + 2.0 * math.log1p(alt_inbound.get(sp, 0)))

    words_out = {}
    best_score = {}
    by_hangul_tmp = {}
    for sp, bucket in words.items():
        lst = sorted(
            ({"hangul": h, "glosses": v["glosses"][:3], "hp": v.get("hp", False),
              "score": final_score(sp, h, v["score"])}
             for h, v in bucket.items()),
            key=lambda x: -x["score"])[:3]
        best_score[sp] = max((x["score"] for x in lst), default=0.0)
        words_out[sp] = [
            dict({"hangul": x["hangul"], "glosses": x["glosses"]},
                 **({"hp": True} if x["hp"] else {}))
            for x in lst]
        for x in lst:
            by_hangul_tmp.setdefault(x["hangul"], []).append((sp, x["score"]))

    # ---- hanja.json -------------------------------------------------
    log("[4/5] building hanja.json (reverse index + compound ranking)")
    char_to_words = {}
    for sp in words_out:
        for ch in set(sp):
            if ch in chars:
                char_to_words.setdefault(ch, []).append(sp)

    def first_gloss(sp):
        l = words_out.get(sp)
        return l[0]["glosses"][0] if l and l[0]["glosses"] else ""

    def first_hangul(sp):
        l = words_out.get(sp)
        return l[0]["hangul"] if l else ""

    # how many different hanja pages list a given compound as a derived term
    cross_derived = collections.Counter()
    for e in chars.values():
        for sp in {d["hanja"] for d in e["derived"]}:
            cross_derived[sp] += 1

    def compound_score(sp, curated):
        # Frequency-first ranking. The curated bonus is deliberately modest so
        # that a very common compound missing from a Wiktionary "derived terms"
        # list (e.g. 學校 on the 學 page) can still outrank a rare curated one.
        return (best_score.get(sp, 0.0)
                + (3.0 if curated else 0.0)
                + 1.0 * cross_derived.get(sp, 0)
                - 2.0 * (len(sp) - 2))

    chars_out = {}
    for c, e in chars.items():
        cand = {}
        # (a) curated Wiktionary "derived terms" for this hanja
        for d in e["derived"]:
            hanja = d["hanja"]
            gloss = d["gloss"] or first_gloss(hanja)
            hangul = d["hangul"] or first_hangul(hanja)
            if not hangul or not gloss:
                continue
            cand[hanja] = (hangul, gloss, compound_score(hanja, True))
        # (b) everything else that contains this char, from words.json
        for sp in char_to_words.get(c, ()):
            if sp in cand:
                continue
            gloss = first_gloss(sp)
            hangul = first_hangul(sp)
            if not hangul or not gloss:
                continue
            cand[sp] = (hangul, gloss, compound_score(sp, False))

        # one compound per hangul reading: 美國 and 米國 are both 미국 with the
        # same gloss, and two identical-looking rows waste popup space.
        compounds = []
        seen_hangul = set()
        for k, v in sorted(cand.items(), key=lambda kv: (-kv[1][2], len(kv[0]), kv[0])):
            if v[0] in seen_hangul:
                continue
            seen_hangul.add(v[0])
            compounds.append({"hangul": v[0], "hanja": k, "gloss": v[1]})
            if len(compounds) == 8:
                break
        eumhun = list(e["eumhun"].values())
        if not eumhun and not e["readings"] and not e["glosses"]:
            continue
        chars_out[c] = {
            "eumhun": eumhun,
            "readings": e["readings"][:8],
            "glosses": e["glosses"][:6],
            "compounds": compounds,
        }
        if c in edu_set:
            chars_out[c]["edu"] = True
        # cw ADDENDUM: the COMPLETE compound index, spellings only, ranked by
        # the same score as the curated list (ranking baked into array order —
        # no scores shipped). Unlike the curated list, gloss-less words are
        # kept: the SW joins hangul/glosses from words.json when the UI asks
        # for the tail, and an empty gloss renders fine there.
        cw_scores = {sp: v[2] for sp, v in cand.items()}
        for sp in char_to_words.get(c, ()):
            if sp not in cw_scores and first_hangul(sp):
                cw_scores[sp] = compound_score(sp, False)
        cw = sorted(cw_scores, key=lambda sp: (-cw_scores[sp], len(sp), sp))
        if cw:
            chars_out[c]["cw"] = cw

    # ---- variants.json ----------------------------------------------
    log("[5/5] building variants.json")
    with zipfile.ZipFile(UNIHAN_FILE) as z:
        unihan_text = z.read("Unihan_Variants.txt").decode("utf-8")
    cands = parse_unihan_variants(unihan_text)
    cands.extend(parse_translingual(TRANSLINGUAL_FILE))
    ja_cands = parse_japanese(JAPANESE_FILE)
    cands.extend(ja_cands)
    src_counts = {}
    for variant, (target, prio) in wiki_alt.items():
        cands.append((variant, target, prio))

    def canon_rank(c):
        """Tie-break within one source: Unihan fields are multi-valued
        (药 kTraditionalVariant = 葯 藥) and the first token is not always the
        form Korean actually uses. Rank by how many sino-Korean words actually
        contain the character - an uncapped, direct usage count."""
        e = chars_out.get(c) or {}
        return (len(char_to_words.get(c, ())),
                len(e.get("eumhun") or []),
                len(e.get("glosses") or []))

    chosen = {}
    for variant, canonical, prio in cands:
        if variant == canonical:
            continue                      # self-mapping
        if canonical not in chars_out:
            continue                      # canonical must exist in hanja.json
        if variant in chars_out:
            continue                      # never shadow a real hanja entry
        rank = canon_rank(canonical)
        cur = chosen.get(variant)
        if cur is None or prio < cur[1] or (prio == cur[1] and rank > cur[2]):
            chosen[variant] = (canonical, prio, rank)
    variant_map = {}
    for k in sorted(chosen):
        variant_map[k] = chosen[k][0]
        src_counts[chosen[k][1]] = src_counts.get(chosen[k][1], 0) + 1

    # Report, never hide, where the Japanese extract disagrees with the winner.
    ja_best = {}
    for variant, canonical, prio in ja_cands:
        if variant == canonical or canonical not in chars_out or variant in chars_out:
            continue
        cur = ja_best.get(variant)
        if cur is None or prio < cur[1]:
            ja_best[variant] = (canonical, prio)
    ja_new = sorted(v for v in ja_best if chosen.get(v, (None,))[0] == ja_best[v][0]
                    and chosen[v][1] in (PRIO_JA_SIMP, PRIO_JA_VAR))
    ja_conflict = sorted(v for v in ja_best
                         if v in chosen and chosen[v][0] != ja_best[v][0])
    non_ja = {v for v, c, p in cands
              if p not in (PRIO_JA_SIMP, PRIO_JA_VAR)
              and v != c and c in chars_out and v not in chars_out}
    ja_unique = [v for v in ja_new if v not in non_ja]
    log("  japanese extract: %s mappings won (%s of them provided by no other "
        "source), %s conflicts with a higher-priority source"
        % (format(len(ja_new), ","), format(len(ja_unique), ","),
           format(len(ja_conflict), ",")))
    for v in ja_conflict[:15]:
        log("    conflict %s: kept %s (%s), japanese said %s (%s)"
            % (v, chosen[v][0], PRIO_NAMES[chosen[v][1]],
               ja_best[v][0], PRIO_NAMES[ja_best[v][1]]))
    if len(ja_conflict) > 15:
        log("    ... and %d more" % (len(ja_conflict) - 15))

    # ---- byHangul ----------------------------------------------------
    # Exhaustive per SPEC addendum: every hanja spelling for a hangul word,
    # no cap, most common first.
    by_hangul = {}
    for hangul, lst in by_hangul_tmp.items():
        seen, picked = set(), []
        for sp, _ in sorted(lst, key=lambda t: (-t[1], len(t[0]), t[0])):
            if sp not in seen:
                seen.add(sp)
                picked.append(sp)
        if picked:
            by_hangul[hangul] = picked

    # ---- rare flag (SPEC addendum) -----------------------------------
    # A sense-set is rare when the frequency proxy shows no attestation that
    # can be credited to THIS hanja spelling. ngram_freq/inbound are keyed by
    # hangul, so they are only usable when the hangul is not shared with a
    # native word and this spelling is the dominant one for that reading;
    # alt_inbound is keyed by the spelling itself and is always usable.
    # Deliberately conservative: a false positive (hedging a correct, common
    # match) is worse than a false negative. An earlier draft also flagged any
    # minority homograph lacking its own alt_inbound, which wrongly caught
    # common secondary readings - 監査 "audit", 士氣 "morale", 修道 - because
    # alt_inbound is sparse. Only the two unambiguous cases are flagged now.
    def is_rare(sp, hangul):
        a = alt_inbound.get(sp, 0)
        if hangul in native_hangul:
            # 사랑/우리: the hangul's counts belong to the native word, so a
            # lone passing mention is not enough to call the spelling attested.
            # The external list is hangul-keyed and so is useless here for the
            # same reason - it is deliberately NOT consulted on this branch.
            return a < 2
        # nothing at all, from any signal, including the external corpus
        return (a == 0
                and ngram_freq.get(hangul, 0) == 0
                and inbound.get(hangul, 0) == 0
                and ext_freq.get(hangul, 0) == 0)

    n_rare = 0
    for sp, lst in words_out.items():
        for sense in lst:
            if is_rare(sp, sense["hangul"]):
                sense["rare"] = True
                n_rare += 1
    n_sets = sum(len(l) for l in words_out.values())
    log("  rare flag: %s of %s sense-sets (%.1f%%), %s native-contested hangul"
        % (format(n_rare, ","), format(n_sets, ","),
           100.0 * n_rare / max(n_sets, 1), format(len(native_hangul), ",")))

    # non-rare spellings first in byHangul, so a reverse lookup leads with a
    # confident match; ordering within each group is unchanged.
    rare_sp = {sp for sp, lst in words_out.items()
               if all(s.get("rare") for s in lst)}
    for hangul, picked in by_hangul.items():
        if any(sp in rare_sp for sp in picked):
            by_hangul[hangul] = ([sp for sp in picked if sp not in rare_sp]
                                 + [sp for sp in picked if sp in rare_sp])

    # ---- emit ---------------------------------------------------------
    hanja_obj = {"version": 1, "chars": chars_out}
    words_obj = {"version": 1, "words": words_out, "byHangul": by_hangul}
    variants_obj = {"version": 1, "map": variant_map}
    s_h = write_json("hanja.json", hanja_obj)
    s_w = write_json("words.json", words_obj)
    s_v = write_json("variants.json", variants_obj)

    # ---- report -------------------------------------------------------
    log("\n================= COUNTS ===================")
    log("chars      : %-9s (expect >= 5000)" % format(len(chars_out), ","))
    log("words      : %-9s (expect >= 20000)" % format(len(words_out), ","))
    log("byHangul   : %-9s" % format(len(by_hangul), ","))
    log("variants   : %-9s (expect >= 1000)" % format(len(variant_map), ","))
    log("  variant sources: " + ", ".join(
        "%s=%d" % (PRIO_NAMES[k], v) for k, v in sorted(src_counts.items())))
    log("================= SIZES ====================")
    log("hanja.json    : %s" % mb(s_h))
    log("words.json    : %s" % mb(s_w))
    log("variants.json : %s" % mb(s_v))
    log("total         : %s" % mb(s_h + s_w + s_v))

    failed = verify(hanja_obj, words_obj, variants_obj)
    log("============================================")
    log("done in %.1fs; %d failed check(s)" % (time.time() - t0, failed))
    raise SystemExit(1 if failed else 0)


if __name__ == "__main__":
    main(sys.argv[1:])
