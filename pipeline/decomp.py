#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Character decomposition (SPEC "Character decomposition" ADDENDUM).

Turns BabelStone IDS into extension/data/decomp.json: for each dictionary
character, the one-level part list its card shows (依 = 亻 + 衣).

Local module of pipeline/build.py, stdlib only. Every step is a pure
function so a test can drive it with an inline fixture.
"""

from __future__ import annotations

import re
import unicodedata

# Ideographic Description Characters (layout, not content) plus the two
# unary operators that live in the same block.
IDC_LO, IDC_HI = 0x2FF0, 0x2FFF
MIRROR = "⿾"        # ⿾
ROTATION = "⿿"      # ⿿
SUBTRACTION = "㇯"   # ㇯ (CJK Strokes, not the IDC block)
VARIATION = "〾"     # 〾
UNREPRESENTABLE = "？"  # ？

# A decomposition built from these cannot be read off the glyph: the mirror
# and rotation operators describe a transform, the subtraction operator
# describes an absence, and neither survives being flattened to a part list.
DROP_OPERATORS = MIRROR + ROTATION + SUBTRACTION

RE_PLACEHOLDER_ROW = re.compile(r"^#\t\{(\d+)\}\t[^\t]*(?:\t(.*))?$")
RE_PLACEHOLDER = re.compile(r"\{(\d+)\}")
RE_SEQ = re.compile(r"^\^(.*?)\$(?:\((.*)\))?$")
RE_TAG_LETTERS = re.compile(r"[A-Z]")

# Radical display forms whose target is not recoverable by NFKD: these are
# encoded as ordinary ideographs (or as unencoded-in-the-BMP shapes), so
# normalization has nothing to undo. Pinned in the SPEC addendum.
RADICAL_ALIASES = {
    "亻": "人", "訁": "言", "釒": "金", "𥫗": "竹", "𤣩": "王",
    "氵": "水", "忄": "心", "扌": "手", "犭": "犬", "衤": "衣",
    "礻": "示", "刂": "刀", "灬": "火", "⺌": "小", "艹": "艸",
    "⺼": "肉", "⺝": "月", "罒": "网", "⻏": "邑", "阝": "阜",
    "糹": "糸", "飠": "食", "牜": "牛",
    # Above the BMP, so without an alias the whole decomposition would be
    # dropped by the skip-through rule: 𩙿 is the food radical the K forms
    # use (57 chars, 飯 館 飮), 𠆢 the 人 top (39 chars, 今 全 余 食), 𦥑 the
    # two-hands form filed under radical 134 (11 chars, 學 覺 興).
    "𩙿": "食", "𠆢": "人", "𦥑": "臼",
}

# Skip-through recursion cap (SPEC). Real chains are 1-2 deep; the cap only
# stops a cycle in the source data.
MAX_DEPTH = 6


def is_bmp(ch: str) -> bool:
    return ord(ch) <= 0xFFFF


# ---------------------------------------------------------------- parse

def parse_ids(text: str):
    """(sequences, placeholders) from the IDS file text.

    sequences: char -> [(ids body, tag letters), ...] in file order.
    placeholders: "12" -> IDS fragment (the file's own header table).
    """
    seqs, placeholders = {}, {}
    for raw in text.splitlines():
        if raw.startswith("#"):
            m = RE_PLACEHOLDER_ROW.match(raw)
            if m:
                placeholders[m.group(1)] = (m.group(2) or "").strip()
            continue
        fields = raw.split("\t")
        if len(fields) < 3 or len(fields[1]) != 1:
            continue
        rows = []
        for f in fields[2:]:
            m = RE_SEQ.match(f)
            if m:
                rows.append((m.group(1), "".join(
                    RE_TAG_LETTERS.findall(m.group(2) or ""))))
        if rows:
            seqs[fields[1]] = rows
    return seqs, placeholders


def pick(rows):
    """A K (ROKorea) sequence if there is one, else G or untagged, else the
    first. 克 is ⿱十兄(GHTJKPV) and ⿱古儿(X): the K rule picks 十+兄."""
    if not rows:
        return None
    for body, tags in rows:
        if "K" in tags:
            return body
    for body, tags in rows:
        if "G" in tags or not tags:
            return body
    return rows[0][0]


def substitute(body: str, placeholders) -> str:
    """Replace {n} with the header table's IDS fragment, recursively. An
    unknown or empty entry becomes ？, which the caller drops on."""
    for _ in range(MAX_DEPTH):
        if "{" not in body:
            break
        body = RE_PLACEHOLDER.sub(
            lambda m: placeholders.get(m.group(1)) or UNREPRESENTABLE, body)
    return body


def flatten(body: str):
    """Sequence order, layout removed. What the card shows is the glyph
    itself, so the arrangement carries no information here."""
    return [c for c in body
            if not (IDC_LO <= ord(c) <= IDC_HI)
            and c != VARIATION and ord(c) > 0x7F]


# ---------------------------------------------------------------- alias

def alias(g: str):
    """The dictionary character a display glyph stands for, or None.

    NFKD covers the Kangxi Radicals and CJK Radicals Supplement blocks
    (⺊ -> 卜); the pinned table covers the forms that are encoded as
    ordinary ideographs and so have nothing to normalize (亻 -> 人).
    """
    o = ord(g)
    if 0x2F00 <= o <= 0x2FD5 or 0x2E80 <= o <= 0x2EFF:
        d = unicodedata.normalize("NFKD", g)
        if len(d) == 1 and d != g:
            return d
    return RADICAL_ALIASES.get(g)


# ---------------------------------------------------------------- decompose

def raw_parts(ch: str, seqs, placeholders):
    """One level of parts for ch, or (None, reason)."""
    rows = seqs.get(ch)
    if not rows:
        return None, "nosource"
    body = pick(rows)
    if any(c in DROP_OPERATORS for c in body):
        return None, "operator"
    body = substitute(body, placeholders)
    if UNREPRESENTABLE in body:
        return None, "placeholder"
    if any(c in DROP_OPERATORS for c in body):
        return None, "operator"
    return flatten(body), None


def resolve(ch: str, seqs, placeholders):
    """Display glyphs for ch after skip-through, or (None, reason).

    A part above the BMP cannot be trusted to render, so it is replaced by
    its own decomposition (乾 = 𠦝 + 乞 becomes 十 + 早 + 乞). An aliased
    part is the exception: 𥫗 IS the bamboo radical and decomposes to
    nothing, so the alias target replaces it as the display glyph.
    """
    parts, reason = raw_parts(ch, seqs, placeholders)
    if parts is None:
        return None, reason

    def expand(glyphs, depth):
        out = []
        for g in glyphs:
            if not is_bmp(g):
                t = alias(g)
                if t and is_bmp(t):
                    out.append(t)
                    continue
                if depth >= MAX_DEPTH:
                    return None
                sub, _ = raw_parts(g, seqs, placeholders)
                if not sub or sub == [g]:
                    return None
                sub = expand(sub, depth + 1)
                if sub is None:
                    return None
                out.extend(sub)
            else:
                out.append(g)
        return out

    out = expand(parts, 0)
    if out is None:
        return None, "skipthrough"
    return out, None


# ---------------------------------------------------------------- names

RE_DEF_CLAUSE = re.compile(r"[;,](?![^(]*\))")
# A kDefinition often opens with an editorial note about another character
# ("(same as 筄) last name"); the gloss is what follows it.
RE_DEF_LEAD_NOTE = re.compile(r"^\([^()]*\)\s*")


def short_name(defn: str) -> str:
    """First clause of a Unihan kDefinition, for parts that have no reading
    of their own. '(same as 又) again; also' -> 'again'."""
    s = re.sub(r"\s+", " ", defn or "").strip()
    stripped = RE_DEF_LEAD_NOTE.sub("", s)
    if stripped:
        s = stripped
    s = RE_DEF_CLAUSE.split(s)[0].strip().rstrip(".")
    if len(s) > 40 or not s:
        return ""
    return s


# ---------------------------------------------------------------- build

def build(ids_text: str, dict_chars, unihan_defs):
    """decomp.json object plus a counts dict.

    Emitted only for characters the dictionary has a card for; the runtime
    never asks about anything else.
    """
    seqs, placeholders = parse_ids(ids_text)
    parts_out = {}
    stats = {"considered": 0, "nosource": 0,
             "operator": 0, "placeholder": 0, "skipthrough": 0,
             "visibility": 0, "emitted": 0, "rows": 0, "aliased": 0,
             "named": 0, "unnamed": 0, "deadend": 0}

    def expand_dead(g, depth):
        """Dead-end rule (SPEC): a card-less part is replaced by its own
        parts when EVERY resulting piece carries a card (雔 -> 隹 + 隹 on
        雙). All-or-nothing: a split that would introduce even one new
        inert piece teaches less than the whole glyph (虫 must not become
        中 plus strokes), so the part stays as it is. Returns (g, t) pairs
        or None."""
        if depth >= MAX_DEPTH:
            return None
        sub, _ = resolve(g, seqs, placeholders)
        if not sub or sub == [g] or len(sub) < 2:
            return None
        out = []
        for s in sub:
            t = alias(s) or s
            if t in dict_chars:
                out.append((s, t))
                continue
            deeper = expand_dead(s, depth + 1)
            if deeper is None:
                return None
            out.extend(deeper)
        return out

    for ch in dict_chars:
        stats["considered"] += 1
        glyphs, reason = resolve(ch, seqs, placeholders)
        if glyphs is None:
            stats[reason] += 1
            continue
        pairs = []
        for g in glyphs:
            t = alias(g) or g
            if t in dict_chars:
                pairs.append((g, t))
                continue
            expanded = expand_dead(g, 0)
            if expanded:
                stats["deadend"] += 1
                pairs.extend(expanded)
            else:
                pairs.append((g, t))
        # Visibility: a two-part split with nothing clickable in it is
        # stroke soup (匕 = 乚 + ㇒), and the card is better with no row.
        if len(pairs) < 2 or not any(t in dict_chars for _, t in pairs):
            stats["visibility"] += 1
            continue
        rows = []
        for g, t in pairs:
            stats["rows"] += 1
            if t != g:
                stats["aliased"] += 1
            if t in dict_chars:
                rows.append([g] if t == g else [g, t])
                continue
            name = short_name(unihan_defs.get(g) or unihan_defs.get(t) or "")
            if name:
                stats["named"] += 1
                rows.append([g, None, name])
            else:
                stats["unnamed"] += 1
                rows.append([g, None])
        parts_out[ch] = rows
        stats["emitted"] += 1
    return {"v": 1, "parts": parts_out}, stats
