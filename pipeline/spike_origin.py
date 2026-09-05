#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Etymikon -- read-only feasibility spike: a source-graph-first origin subsystem.

Measures what the pipeline's template-only reading of the extracts leaves on
the table, against the same normalisation and template sets build.py uses
(imported, never copied). Writes pipeline/spike-origin.md.

    python pipeline/spike_origin.py            # full run, cached reductions
    python pipeline/spike_origin.py --quick    # sample the extracts, for development
    python pipeline/spike_origin.py --rebuild  # ignore the reduced caches
    python pipeline/spike_origin.py --work DIR # where the reductions live

Stage 0 reduces the three extracts to the fields this spike reads and caches
them under --work (default: the session scratchpad). Every later stage reads
the reductions only, so a rerun after the first costs about a minute.

Touches nothing in the repo except spike-origin.md.
"""

from __future__ import annotations

import collections
import gzip
import io
import json
import os
import random
import re
import sys
import time
import unicodedata

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import build                                  # noqa: E402  the pipeline, read-only
import curation                               # noqa: E402

try:
    import orjson

    def loads(b):
        return orjson.loads(b)

    def dumps(o):
        return orjson.dumps(o)
except ImportError:
    def loads(b):
        return json.loads(b)

    def dumps(o):
        return json.dumps(o, ensure_ascii=False).encode("utf-8")

ROOT = os.path.dirname(HERE)
DATA = os.path.join(ROOT, "extension", "data")
REPORT = os.path.join(HERE, "spike-origin.md")
DEFAULT_WORK = (r"C:\Users\Jesse\AppData\Local\Temp\claude\D--Code-English-Etymology"
                r"\6d8f5309-a0f5-4cd6-8d39-7e01347f2d42\scratchpad")

TOP = 10000
QUICK_LINES = {"en": 200000, "la": 120000, "grc": 70000}
SEED = 20260905
ROOT_BYTES = None      # measured from roots.json at load

T0 = time.time()


def log(*a):
    s = " ".join(str(x) for x in a)
    print("[%6.1fs] %s" % (time.time() - T0, s), flush=True)


def pct(n, d):
    return "%.1f%%" % (100.0 * n / d) if d else "-"


def fmt(n):
    return format(n, ",")


# ============================================================ stage 0: reduce

def reduce_sense(s):
    return {"glosses": s.get("glosses") or [],
            "tags": s.get("tags") or [],
            "form_of": s.get("form_of") or None,
            "alt_of": s.get("alt_of") or None}


def reduce_classical(e):
    """The fields parse_classical reads, plus the etymology prose."""
    out = {"word": e.get("word"), "pos": e.get("pos") or "",
           "senses": [reduce_sense(s) for s in e.get("senses") or []]}
    forms = [f for f in e.get("forms") or []
             if "canonical" in (f.get("tags") or []) or "romanization" in (f.get("tags") or [])]
    if forms:
        out["forms"] = [{"form": f.get("form"), "tags": f.get("tags")} for f in forms]
    ht = e.get("head_templates") or []
    if ht:
        out["head_templates"] = [{"args": {"1": (h.get("args") or {}).get("1", "")}} for h in ht[:2]]
    if e.get("etymology_templates"):
        out["etymology_templates"] = [{"name": t.get("name"), "args": t.get("args") or {}}
                                      for t in e["etymology_templates"]]
    if e.get("etymology_text"):
        out["etymology_text"] = e["etymology_text"]
    return out


def reduce_english(e):
    """What the spike needs of an English entry: dominance, chain, split, prose."""
    senses = e.get("senses") or []
    ndef = 0
    for s in senses:
        gl = s.get("glosses") or []
        if gl and gl[0] and not s.get("form_of") and not s.get("alt_of"):
            d = build.clean_def(gl[0])
            if d and len(d) <= build.DEF_MAX_CHARS and not d.endswith("…"):
                ndef += 1
    out = {"word": e.get("word"), "pos": e.get("pos") or "", "ns": len(senses),
           "ndef": ndef, "fo": build.pure_form_of(e)}
    if e.get("etymology_templates"):
        out["etymology_templates"] = [{"name": t.get("name"), "args": t.get("args") or {}}
                                      for t in e["etymology_templates"]]
    if e.get("etymology_text"):
        out["etymology_text"] = e["etymology_text"]
    if out["pos"] in build.AFFIX_POS:
        out["gloss"] = build.best_gloss(e)
    return out


def reduce_all(work, quick, rebuild, interest):
    """Write the reduced extracts into `work`. Returns the paths."""
    os.makedirs(work, exist_ok=True)
    tag = "quick" if quick else "full"
    paths = {lang: os.path.join(work, "red-%s-%s.jsonl.gz" % (lang, tag))
             for lang in ("en", "la", "grc")}
    titles_path = os.path.join(work, "en-titles-%s.txt" % tag)
    srcs = {"en": build.ENGLISH_FILE, "la": build.LATIN_FILE, "grc": build.GREEK_FILE}
    for lang in ("la", "grc", "en"):
        dest = paths[lang]
        if os.path.exists(dest) and not rebuild and (lang != "en" or os.path.exists(titles_path)):
            log("reduced %s cache present: %s" % (lang, dest))
            continue
        log("reducing %s extract -> %s" % (lang, dest))
        n = kept = 0
        titles = set()
        limit = QUICK_LINES[lang] if quick else None
        with gzip.open(srcs[lang], "rb") as f, gzip.open(dest + ".part", "wb", compresslevel=3) as g:
            for line in f:
                n += 1
                if limit and n > limit:
                    break
                if n % 250000 == 0:
                    log("    %s lines ..." % fmt(n))
                e = loads(line)
                w = e.get("word")
                if not w:
                    continue
                if lang == "en":
                    wl = w.lower()
                    titles.add(wl)
                    pos = e.get("pos") or ""
                    if wl not in interest and pos not in build.AFFIX_POS:
                        continue
                    r = reduce_english(e)
                else:
                    r = reduce_classical(e)
                g.write(dumps(r))
                g.write(b"\n")
                kept += 1
        os.replace(dest + ".part", dest)
        if lang == "en":
            with io.open(titles_path, "w", encoding="utf-8") as fh:
                for t in sorted(titles):
                    fh.write(t + "\n")
        log("  %s lines read, %s entries kept" % (fmt(n), fmt(kept)))
    return paths, titles_path


def read_jsonl(path):
    with gzip.open(path, "rb") as f:
        for line in f:
            yield loads(line)


# ================================================ shipped data and the corpus

def load_shipped():
    global ROOT_BYTES
    with io.open(os.path.join(DATA, "words.json"), encoding="utf-8") as f:
        words = json.load(f)["words"]
    rp = os.path.join(DATA, "roots.json")
    with io.open(rp, encoding="utf-8") as f:
        roots = json.load(f)["roots"]
    ROOT_BYTES = os.path.getsize(rp) / max(1, len(roots))
    misses = []
    with io.open(build.MISSES_FILE, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            r, w = line.split("\t") if "\t" in line else line.split(None, 1)
            misses.append((int(r), w))
    return words, roots, misses


def dominant(entries):
    """The entry harvest_english would take the split and chain from."""
    best = None
    for e in entries:
        if e["pos"] == "name" or e["fo"] or not e["ndef"]:
            continue
        if best is None or e["ns"] > best["ns"]:
            best = e
    return best


class Corpus:
    """Everything the stages read: the extracts reduced, the shipped data, the chains."""

    def __init__(self, paths, titles_path, words, roots, misses):
        self.words = words
        self.roots = roots
        self.misses = misses
        self.miss_set = {w for _, w in misses}
        # ---- the classical extracts, through the pipeline's own parser
        self.cl = {}
        self.pages = {}          # lang -> key -> [lemma entries]
        self.titles = {}         # lang -> every page key, form-of pages included
        self.raw = {}            # lang -> key -> the raw page title
        for lang in ("la", "grc"):
            log("parse_classical(%s)" % lang)
            self.cl[lang] = build.parse_classical(paths[lang], lang)
            pages = collections.defaultdict(list)
            titles = set()
            raw = {}
            for e in read_jsonl(paths[lang]):
                k = build.norm_key(lang, e["word"])
                if not k:
                    continue
                titles.add(k)
                raw.setdefault(k, e["word"])
                if build.pure_form_of(e):
                    continue
                pages[k].append(e)
            self.pages[lang] = pages
            self.titles[lang] = titles
            self.raw[lang] = raw
            log("  %s: %s pages, %s lemma pages" % (lang, fmt(len(titles)), fmt(len(pages))))
        self.origin = build.Origin(self.cl)
        # ---- English
        log("loading the English reduction")
        self.en = collections.defaultdict(list)
        self.affixes = {}
        for e in read_jsonl(paths["en"]):
            wl = e["word"].lower()
            if e["pos"] in build.AFFIX_POS:
                g = e.get("gloss") or ""
                cur = self.affixes.get(wl)
                if g and (cur is None or e["ns"] > cur["ns"]):
                    self.affixes[wl] = {"ns": e["ns"], "pos": e["pos"], "gloss": g,
                                        "src": build.entry_chain(e)}
                continue
            self.en[wl].append(e)
        self.en_titles = set()
        with io.open(titles_path, encoding="utf-8") as f:
            for line in f:
                self.en_titles.add(line.rstrip("\n"))
        log("  %s English words with entries, %s affix pages, %s titles"
            % (fmt(len(self.en)), fmt(len(self.affixes)), fmt(len(self.en_titles))))
        # ---- chains, as harvest_english would take them
        self.dom = {}
        self.chain = {}
        for wl, w in words.items():
            d = dominant(self.en.get(w.get("wik") or wl, []))
            if d is None:
                continue
            self.dom[wl] = d
            ch = build.entry_chain(d)
            if ch:
                self.chain[wl] = ch
        # The words whose org row the build would compute, and the anchors.
        pending = [self.chain[wl] for wl, w in words.items()
                   if wl in self.chain and not w.get("morphs")]
        n_anchor = self.origin.find_anchors(pending)
        log("  %s shipped words carry a chain, %s pending org rows, %s anchors"
            % (fmt(len(self.chain)), fmt(len(pending)), fmt(n_anchor)))
        self.top = {wl for wl, w in words.items()
                    if w.get("fr") is not None and w["fr"] <= TOP}

        # ---- fold indexes for the lookup rules
        self.marks_idx = {}
        self.fold_idx = {}
        for lang in ("la", "grc"):
            marks = collections.defaultdict(set)
            fold = collections.defaultdict(set)
            for k in self.titles[lang]:
                marks[strip_marks(k)].add(k)
                fold[fold_spelling(strip_marks(k))].add(k)
            self.marks_idx[lang] = marks
            self.fold_idx[lang] = fold

    def rank(self, wl):
        return self.words[wl].get("fr")

    def found(self, lang, key):
        cl = self.cl[lang]
        return bool(key) and (key in cl["gloss"] or key in cl["split"])

    def deep_settle(self, lang, lemma):
        """(key, rules) : the build's settle plus the spike's proposed rules.

        Rules, in the order tried: trailing punctuation and a//b alternation
        on the arg; Greek length marks stripped; the form-of hop repeated (the
        build takes one); every combining mark stripped; the ae/oe/j/v fold.
        Returns (None, rules) when nothing lands on a glossed or split page.
        """
        t, rules = clean_lemma(lemma)
        key = build.norm_key(lang, t)
        if lang == "grc":
            k2 = gkey(t)
            if k2 != key and not self.found(lang, key) and key not in self.titles[lang]:
                rules.append("Greek length marks")
                key = k2
        curated = curation.LEMMA_STEPS.get(lang + ":" + key)
        if curated:
            key = curated.split(":", 1)[1]
        cl = self.cl[lang]
        hops = 0
        for _ in range(8):
            if self.found(lang, key):
                return key, rules
            if key in cl["fo"] and hops < 3:
                hops += 1
                if hops >= 2:
                    rules.append("form-of hop %d" % hops)
                key = cl["fo"][key]
                continue
            sm = strip_marks(key)
            hit = self.marks_idx[lang].get(sm)
            if hit and key not in hit:
                rules.append("all marks stripped" if lang == "la" else "Greek accent or breathing")
                key = sorted(hit)[0]
                continue
            hit = self.fold_idx[lang].get(fold_spelling(sm))
            if hit and key not in hit:
                rules.append("ae/oe/j/v fold")
                key = sorted(hit)[0]
                continue
            return None, rules
        return None, rules

    def settle(self, lang, lemma):
        return self.origin.settle(lang, lemma)

    def page_exists(self, lang, key):
        if lang == "en":
            return key in self.en_titles
        return key in self.titles.get(lang, ())

    def glossed(self, lang, key):
        """The key the pipeline would put on a card, or None."""
        if lang not in self.cl:
            return None
        cl = self.cl[lang]
        if key in cl["gloss"]:
            return key
        t = cl["fo"].get(key)
        if t and t in cl["gloss"]:
            return t
        return None

    def gloss(self, lang, key):
        return self.cl[lang]["gloss"].get(key, "")

    def form(self, lang, key):
        return self.cl[lang]["form"].get(key) or key


# ============================================================ text helpers

LATIN_NAMES = {"Latin": "la", "Late Latin": "la", "Medieval Latin": "la",
               "New Latin": "la", "Vulgar Latin": "la", "Ecclesiastical Latin": "la",
               "Classical Latin": "la", "Mediaeval Latin": "la", "Renaissance Latin": "la",
               "Modern Latin": "la", "Scientific Latin": "la", "British Latin": "la"}
GREEK_NAMES = {"Ancient Greek": "grc", "Koine Greek": "grc", "Byzantine Greek": "grc",
               "Hellenistic Greek": "grc", "Attic Greek": "grc", "Ionic Greek": "grc",
               "Doric Greek": "grc", "Aeolic Greek": "grc", "Homeric Greek": "grc",
               "Epic Greek": "grc"}
OTHER_NAMES = {"Greek": "el", "Modern Greek": "el", "Old French": "fro", "Middle French": "frm",
               "French": "fr", "Anglo-Norman": "xno", "Old Northern French": "fro",
               "Middle English": "enm", "Old English": "ang", "English": "en",
               "Proto-Indo-European": "ine-pro", "Proto-Italic": "itc-pro",
               "Proto-Hellenic": "grk-pro", "Proto-Germanic": "gem-pro",
               "Proto-West Germanic": "gmw-pro", "Italian": "it", "Spanish": "es",
               "German": "de", "Dutch": "nl", "Old Norse": "non", "Frankish": "frk",
               "Old High German": "goh", "Middle High German": "gmh", "Old Latin": "itc-ola",
               "Hebrew": "he", "Arabic": "ar", "Sanskrit": "sa", "Portuguese": "pt",
               "Old Italian": "it", "Old Spanish": "osp", "Old Occitan": "pro",
               "Middle Dutch": "dum", "Old Dutch": "odt", "Old Irish": "sga",
               "Etruscan": "ett", "Persian": "fa", "Middle Persian": "pal",
               "Old Persian": "peo", "Turkish": "tr", "Ottoman Turkish": "ota",
               "Japanese": "ja", "Mandarin": "cmn", "Russian": "ru", "Egyptian": "egy",
               "Coptic": "cop", "Aramaic": "arc", "Akkadian": "akk", "Gaulish": "cel-gau",
               "Proto-Celtic": "cel-pro", "Proto-Slavic": "sla-pro", "Pre-Greek": "qsb-grc",
               "Phoenician": "phn", "Scots": "sco", "Norman": "nrf", "Occitan": "oc",
               "Catalan": "ca", "Late Middle English": "enm", "Early Modern English": "en",
               "Middle Low German": "gml", "Low German": "nds", "Swedish": "sv",
               "Danish": "da", "Irish": "ga", "Welsh": "cy", "Hindi": "hi",
               "Proto-Semitic": "sem-pro", "Proto-Iranian": "ira-pro",
               "Old Occitan": "pro", "Proto-Balto-Slavic": "ine-bsl-pro"}
LANG_NAMES = {}
LANG_NAMES.update(OTHER_NAMES)
LANG_NAMES.update(LATIN_NAMES)
LANG_NAMES.update(GREEK_NAMES)
LANG_FIRST = {n.split(" ")[0] for n in LANG_NAMES}


def lang_family(code):
    if code in build.LATIN_CODES or code == "la" or code.startswith("la-"):
        return "la"
    if code in build.GREEK_CODES or code.startswith("grc-"):
        return "grc"
    return code


# The spike's proposed normalisation rules, kept beside the build's own.
RE_LENGTH_MARKS = re.compile("[\u0304\u0306]")


def gkey(s):
    """Greek key with vowel-length marks (macron, breve) removed, accents kept.

    Template args write σῠνῐ́στημῐ and περῐ́; page titles write συνίστημι and
    περί. build.grc_key keeps every mark, so the two never meet.
    """
    d = unicodedata.normalize("NFD", s or "")
    return unicodedata.normalize("NFC", RE_LENGTH_MARKS.sub("", d)).lower()


def clean_lemma(s):
    """A template arg as a lemma: trailing punctuation off, one of a//b."""
    rules = []
    t = (s or "").strip()
    u = t.rstrip(",.;:")
    if u != t:
        rules.append("trailing punctuation")
        t = u
    if "//" in t:
        rules.append("a//b alternation")
        t = t.split("//", 1)[0].strip()
    return t, rules


def strip_marks(s):
    return "".join(ch for ch in unicodedata.normalize("NFD", s)
                   if unicodedata.category(ch) != "Mn")


def fold_spelling(s):
    s = s.replace("æ", "ae").replace("œ", "oe").replace("j", "i").replace("v", "u")
    s = s.replace("ſ", "s")
    return s


def is_greek(s):
    return any("\u0370" <= c <= "\u03ff" or "\u1f00" <= c <= "\u1fff" for c in s)


RE_TREE_LINE = re.compile(r"^([A-Z][\w\-]*(?: [A-Z][\w\-]*)*) (\S.*)$")
PROSE_OPENERS = ("From ", "from ", "Borrowed", "Inherited", "Learned", "Ultimately",
                 "By surface", "Partly", "Probably", "Possibly", "Perhaps", "Uncertain",
                 "Unknown", "Compound", "Univerbation", "Equivalent", "First ", "Attested",
                 "Of ", "Named", "Coined", "Originally", "Either", "Semi-learned",
                 "Unadapted", "Back-formation", "Clipping", "Blend", "Derived", "Related",
                 "See ", "Compare", "The ", "A ", "An ", "Cognate", "Akin", "Formed")


def strip_tree(text, lang, key):
    """The prose of an etymology_text, with a rendered etymology tree removed."""
    if not text or not text.startswith("Etymology tree"):
        return text or ""
    lines = text.split("\n")
    end = None
    for i in range(len(lines) - 1, 0, -1):
        m = RE_TREE_LINE.match(lines[i])
        if not m:
            continue
        term = m.group(2).split(" (")[0]
        term = re.sub(r"((?:[a-z]+\.)+\??|\?)$", "", term)
        if build.norm_key(lang, term) == key and m.group(1).split(" ")[0] in LANG_FIRST:
            end = i
            break
    if end is None:
        for i, ln in enumerate(lines[1:], 1):
            if ln.startswith(PROSE_OPENERS) or ". " in ln or ", " in ln:
                end = i - 1
                break
    if end is None:
        return ""
    return "\n".join(lines[end + 1:])


def has_prose_plus(text):
    return " + " in text


# ============================================================ the prose parser

STEP_WORDS = ("ablative", "genitive", "dative", "accusative", "nominative", "vocative",
              "locative", "participle", "supine", "frequentative", "frequentive",
              "diminutive", "feminine", "neuter", "masculine", "plural", "singular",
              "comparative", "superlative", "stem", "infinitive", "form", "variant",
              "contraction", "augmentative", "iterative", "intensive", "inchoative",
              "denominative", "deverbal", "deverbative", "gerundive", "gerund",
              "imperative", "future", "perfect", "present", "past", "inflection",
              "adverb", "adjective", "noun", "verb", "root", "base", "abbreviation",
              "reduplication", "alternative", "syncopated", "syncopic", "apocopated")
RE_STEP = re.compile(r"\b(" + "|".join(STEP_WORDS) + r")\b[^()]{0,40}?\bof\s+(?:the\s+)?"
                     r"([^\s(),;“”\"]+)")
RE_TRANSLIT = re.compile(r"^[A-Za-zÀ-ɏḀ-ỿ\u0300-\u036f' ,\-‑\.]+?(?:,|$)")
STOP_HEADS = {"the", "a", "an", "of", "from", "and", "or", "suffix", "prefix", "root",
              "stem", "form", "with", "see", "also", "compare", "its", "their", "this",
              "that", "which", "as", "in", "on", "to", "by", "for", "via", "either",
              "both", "same", "second", "first", "element", "elements", "words", "word",
              "verb", "noun", "adjective", "participle", "ending", "sense", "meaning",
              "reduplication", "prefixed", "suffixed", "plus", "genitive", "ablative",
              "accusative", "dative", "nominative", "plural", "singular", "perhaps",
              "possibly", "probably", "later", "earlier", "originally", "ultimately",
              "then", "i.e.", "e.g.", "literally", "roughly", "so", "thus", "hence"}
STRIP_CHARS = ".,;:“”\"'’‘[]{}?!"


def tokenize(sent):
    """[('w', token) | ('p', inner) ...] with parentheses balanced."""
    items = []
    buf = []

    def flush():
        if buf:
            for tok in "".join(buf).split():
                items.append(("w", tok))
            buf.clear()

    i = 0
    n = len(sent)
    while i < n:
        c = sent[i]
        if c == "(":
            depth = 1
            j = i + 1
            while j < n and depth:
                if sent[j] == "(":
                    depth += 1
                elif sent[j] == ")":
                    depth -= 1
                j += 1
            flush()
            items.append(("p", sent[i + 1:j - 1] if depth == 0 else sent[i + 1:j]))
            i = j
        else:
            buf.append(c)
            i += 1
    flush()
    return items


def clean_head(tok):
    h = tok.strip(STRIP_CHARS)
    h = h.replace("\u200b", "")
    if h.endswith(",") or h.endswith("."):
        h = h[:-1]
    return h


def lang_phrase_before(items, i):
    """(code, n_tokens) of a language name ending at token i-1, or (None, 0)."""
    for n in (3, 2, 1):
        if i - n < 0:
            continue
        toks = items[i - n:i]
        if any(t[0] != "w" for t in toks):
            continue
        phrase = " ".join(clean_head(t[1]) for t in toks)
        if phrase in LANG_NAMES:
            return LANG_NAMES[phrase], n
    return None, 0


def lang_phrase_at(items, i):
    """(code, n_tokens) of a language name starting at token i, or (None, 0)."""
    for n in (3, 2, 1):
        toks = items[i:i + n]
        if len(toks) < n or any(t[0] != "w" for t in toks):
            continue
        phrase = " ".join(clean_head(t[1]) for t in toks)
        if phrase in LANG_NAMES:
            return LANG_NAMES[phrase], n
    return None, 0


def recent_lang(items, i):
    """The last language name mentioned at depth 0 before token i, in this sentence."""
    j = i
    while j > 0:
        code, n = lang_phrase_before(items, j)
        if code:
            return code
        j -= 1
    return None


class Term:
    __slots__ = ("head", "lang", "explicit", "step", "target", "parens", "note")

    def __init__(self, head):
        self.head = head
        self.lang = None
        self.explicit = False
        self.step = None
        self.target = None
        self.parens = []
        self.note = ""

    def show(self):
        s = self.head
        if self.target:
            s += "->" + self.target
        return "%s:%s" % (self.lang or "?", s)


def read_parens(term, items, i):
    """Attach the paren groups starting at item i to term. Returns the next index."""
    while i < len(items) and items[i][0] == "p":
        inner = items[i][1].strip()
        term.parens.append(inner)
        if is_greek(term.head):
            m = RE_TRANSLIT.match(inner)
            if m:
                inner = inner[m.end():].strip()
        m = RE_STEP.search(inner)
        if m and not term.target:
            tgt = clean_head(m.group(2))
            if tgt and not tgt.startswith("*"):
                term.step = m.group(1)
                term.target = tgt
        i += 1
    return i


def read_trailing_step(term, items, i):
    """', accusative of mons' after a head: the appositive form of the step."""
    if term.target or i >= len(items):
        return
    if not items[i - 1][1].endswith(",") if items[i - 1][0] == "w" else True:
        # the comma sits on the head token itself or on the last paren
        prev = items[i - 1]
        if prev[0] == "p":
            pass
        elif not prev[1].endswith(","):
            return
    window = []
    for t in items[i:i + 8]:
        if t[0] != "w":
            break
        window.append(t[1])
    m = RE_STEP.search(" ".join(window))
    if m and window and window[0].strip(STRIP_CHARS) in STEP_WORDS + ("the", "perfect", "present", "past"):
        tgt = clean_head(m.group(2))
        if tgt and not tgt.startswith("*"):
            term.step = m.group(1)
            term.target = tgt


def parse_chains(sent):
    """Every 'X + Y (+ Z)' chain in one sentence, as lists of Term."""
    items = tokenize(sent)
    chains = []
    i = 0
    n = len(items)
    while i < n:
        if not (items[i][0] == "w" and items[i][1] == "+"):
            i += 1
            continue
        # ---- left term: back over parens to the head
        j = i - 1
        while j >= 0 and items[j][0] == "p":
            j -= 1
        if j < 0 or items[j][0] != "w":
            i += 1
            continue
        left = Term(clean_head(items[j][1]))
        code, nl = lang_phrase_before(items, j)
        if code:
            left.lang, left.explicit = code, True
        else:
            left.lang = recent_lang(items, j)
        read_parens(left, items, j + 1)
        chain = [left]
        # ---- right terms, chained on further pluses
        k = i + 1
        while True:
            code, nl = lang_phrase_at(items, k)
            if code:
                k += nl
            if k >= n or items[k][0] != "w":
                break
            head = clean_head(items[k][1])
            term = Term(head)
            if code:
                term.lang, term.explicit = code, True
            else:
                term.lang = chain[-1].lang
            k2 = read_parens(term, items, k + 1)
            read_trailing_step(term, items, k2)
            chain.append(term)
            if k2 < n and items[k2][0] == "w" and items[k2][1] == "+":
                k = k2 + 1
                continue
            break
        chains.append(chain)
        i = k
    return chains


RE_SENT = re.compile(r"(?<=[.;])\s+(?=[A-Z“(])")


def sentences(prose):
    out = []
    for para in prose.split("\n"):
        para = para.strip()
        if not para:
            continue
        for s in RE_SENT.split(para):
            if s:
                out.append(s)
    return out


def template_langs(entries):
    """norm key -> language family, from the mention-shaped templates on a page."""
    out = {}
    for e in entries:
        for t in e.get("etymology_templates") or []:
            name = t.get("name") or ""
            args = t.get("args") or {}
            pairs = []
            if name in ("m", "m+", "l", "l+", "noncog", "ncog", "cog", "mention", "link"):
                pairs.append((args.get("1", ""), args.get("2", "")))
            elif name in build.ORIGIN_NAMES:
                pairs.append((args.get("2", ""), args.get("3", "")))
            elif name in build.DECOMP_NAMES or name in build.SURF_NAMES or name in build.ETY_NAMES:
                u = build.unwrap(t)
                if u:
                    kind, tlang, targs, base, _ = u
                    for part in build.template_parts(kind, targs, base):
                        pairs.append((tlang, part))
            for code, term in pairs:
                term = build.clean_part(term)
                if not term or not code:
                    continue
                fam = lang_family(code)
                for k in (build.la_key(term), build.grc_key(term)):
                    out.setdefault(k, fam)
    return out


class Parse:
    """One page's best prose split."""
    __slots__ = ("page", "lang", "sent", "terms", "resolved", "ok", "why")

    def __init__(self, page, lang, sent, terms):
        self.page = page
        self.lang = lang
        self.sent = sent
        self.terms = terms
        self.resolved = []
        self.ok = False
        self.why = ""

    def split_text(self):
        return " + ".join(t.show() for t in self.terms)


def resolve_term(corpus, term, page_lang, tl):
    """(lang, key, ok, why) for one prose term."""
    head = term.head
    if not head or head.lower() in STOP_HEADS or not any(c.isalpha() for c in head):
        return None, None, False, "stop-word head"
    if head.startswith("*"):
        return term.lang or "proto", None, False, "reconstructed"
    lang = term.lang
    if lang is None:
        k = tl.get(build.la_key(head)) or tl.get(build.grc_key(head))
        if k:
            lang = k
        elif is_greek(head):
            lang = "grc"
        elif page_lang in ("la", "grc"):
            lang = page_lang
        else:
            lang = "en"
    lang = lang_family(lang)
    if is_greek(head) and lang != "el":
        lang = "grc"
    if lang not in ("la", "grc", "en"):
        return lang, None, False, "language %s, no extract" % lang
    target = term.target or head
    if lang == "en":
        key = target.lower()
        if key in corpus.en_titles:
            return lang, key, True, ""
        return lang, key, False, "no English page"
    key, rules = corpus.deep_settle(lang, target)
    if key:
        return lang, key, True, ("via " + ", ".join(rules)) if rules else ""
    if term.target:
        # The step named a page that is not there; the head itself may be.
        key, rules = corpus.deep_settle(lang, head)
        if key:
            return lang, key, True, "step target missing, head used"
    return lang, build.norm_key(lang, target), False, "no %s page" % lang


def parse_page(corpus, page, lang, entries, text):
    """The best plus-chain on a page, or None when the prose has none."""
    prose = strip_tree(text, lang, page)
    if " + " not in prose:
        return None
    tl = template_langs(entries)
    best = None
    for sent in sentences(prose):
        if " + " not in sent:
            continue
        for chain in parse_chains(sent):
            if len(chain) < 2:
                continue
            p = Parse(page, lang, sent, chain)
            for t in chain:
                p.resolved.append(resolve_term(corpus, t, lang, tl))
            p.ok = all(r[2] for r in p.resolved)
            p.why = "; ".join(r[3] for r in p.resolved if r[3] and not r[2])
            if p.ok and best is None or (p.ok and best is not None and not best.ok):
                best = p
                if p.ok:
                    return best
            if best is None:
                best = p
    return best


# ============================================================ the etymon tree

class ETerm:
    __slots__ = ("lang", "head", "children")

    def __init__(self, lang, head, children):
        self.lang = lang
        self.head = head
        self.children = children      # [(kind, [ETerm])]


def match_angle(s, i):
    """Index just past the '>' that closes the '<' at i."""
    depth = 0
    j = i
    while j < len(s):
        if s[j] == "<":
            depth += 1
        elif s[j] == ">":
            depth -= 1
            if depth == 0:
                return j + 1
        j += 1
    return len(s)


RE_LANG_PREFIX = re.compile(r"^([a-z][a-z0-9\-]{1,14}):(.*)$")


def parse_eterm(s, default_lang):
    s = s.strip()
    i = s.find("<")
    core = s if i < 0 else s[:i]
    mods = "" if i < 0 else s[i:]
    lang, head = default_lang, core
    m = RE_LANG_PREFIX.match(core)
    if m:
        lang, head = m.group(1), m.group(2)
    children = []
    j = 0
    while j < len(mods):
        if mods[j] != "<":
            j += 1
            continue
        k = match_angle(mods, j)
        inner = mods[j + 1:k - 1]
        name, _, value = inner.partition(":")
        if name == "ety":
            q = value.find("<")
            kind = (value if q < 0 else value[:q]).strip().lstrip(":")
            rest = "" if q < 0 else value[q:]
            terms = []
            r = 0
            while r < len(rest):
                if rest[r] != "<":
                    r += 1
                    continue
                e = match_angle(rest, r)
                terms.append(parse_eterm(rest[r + 1:e - 1], lang))
                r = e
            children.append((kind, terms))
        j = k
    return ETerm(lang, head.strip(), children)


def etymon_analyses(t, page_lang):
    """[(kind, [ETerm])] for one etymon/ety template."""
    args = t.get("args") or {}
    lang = args.get("1") or page_lang
    out = []
    cur = None
    i = 2
    while str(i) in args:
        a = (args[str(i)] or "").strip()
        i += 1
        if not a:
            continue
        if a.startswith(":"):
            cur = (a[1:].split("<")[0], [])
            out.append(cur)
        else:
            if cur is None:
                cur = ("from", [])
                out.append(cur)
            cur[1].append(parse_eterm(a, lang))
    return lang, out


DECOMP_KINDS = {"af", "affix", "afeq", "suf", "suffix", "pre", "prefix", "com",
                "compound", "con", "confix", "univ", "univerbation", "surf"}
LINEAR_KINDS = {"bor", "der", "inh", "lbor", "uder", "ubor", "slbor", "from", "calque",
                "clq", "clip", "clipping", "deverbal", "bf", "influence", "abbr"}


class Node:
    __slots__ = ("lang", "key", "head", "kind", "children")

    def __init__(self, lang, key, head):
        self.lang = lang
        self.key = key
        self.head = head
        self.kind = None
        self.children = []

    def classical(self):
        return (self.lang in ("la", "grc") and bool(self.key)
                and not self.head.startswith("*") and self.head not in ("+", ""))

    def show(self, depth=0):
        s = "%s:%s" % (self.lang, self.head)
        if self.children:
            s += " = " + ("(" if depth else "") + (" + " if self.kind in DECOMP_KINDS else " < ").join(
                c.show(depth + 1) for c in self.children) + (")" if depth else "")
        return s


def page_analyses(corpus, lang, key):
    """The etymon analyses on a classical page: decomposition first, then linear."""
    best_dec = None
    best_lin = None
    for e in corpus.pages[lang].get(key, ()):
        for t in e.get("etymology_templates") or []:
            if t.get("name") not in build.ETY_NAMES:
                continue
            plang, ans = etymon_analyses(t, lang)
            if lang_family(plang) != lang:
                continue
            for kind, terms in ans:
                if kind in DECOMP_KINDS and len(terms) >= 2 and best_dec is None:
                    best_dec = (kind, terms)
                elif kind in LINEAR_KINDS and len(terms) == 1 and best_lin is None:
                    best_lin = (kind, terms)
    return best_dec or best_lin


def expand(corpus, term, depth, seen):
    fam = lang_family(term.lang)
    head = build.clean_part(term.head) or term.head
    key = build.norm_key(fam, head) if fam in ("la", "grc") else head.lower()
    node = Node(fam, key, head)
    if head.startswith("*") or depth <= 0:
        return node
    analysis = None
    if term.children:
        for kind, terms in term.children:
            if kind in DECOMP_KINDS and len(terms) >= 2:
                analysis = (kind, terms)
                break
        if analysis is None:
            for kind, terms in term.children:
                if len(terms) >= 1:
                    analysis = (kind, terms)
                    break
    elif fam in ("la", "grc") and key not in seen:
        k2 = corpus.settle(fam, head) or key
        analysis = page_analyses(corpus, fam, k2)
        if analysis is None and k2 != key:
            analysis = page_analyses(corpus, fam, key)
    if analysis is None:
        return node
    kind, terms = analysis
    node.kind = kind
    for t in terms:
        node.children.append(expand(corpus, t, depth - 1, seen | {key}))
    return node


def tree_leaves(node, out, decomposes, inside=False):
    """Classical leaves of an expanded tree; flags a classical node that splits.

    A decomposition is followed when at least two of its parts carry
    classical content, else the node stays whole (flatten's all-or-nothing).
    A linear parent is followed when it carries classical content; inside a
    split the follow stops at a language change, as flatten never crosses
    one.
    """
    kids = [c for c in node.children if any_classical(c)]
    if node.kind in DECOMP_KINDS and len(node.children) >= 2:
        if node.classical() and len(kids) >= 2:
            decomposes.add(node.lang + ":" + node.key)
        if len(kids) >= 2 or not node.classical():
            for c in kids:
                tree_leaves(c, out, decomposes, True)
            return
        if node.classical():
            out.add(node.lang + ":" + node.key)
        return
    if node.children and node.kind in LINEAR_KINDS and kids:
        c = kids[0]
        if inside and node.classical() and c.lang != node.lang:
            out.add(node.lang + ":" + node.key)
            return
        tree_leaves(c, out, decomposes, inside)
        return
    if node.classical():
        out.add(node.lang + ":" + node.key)


def any_classical(node):
    if node.classical():
        return True
    return any(any_classical(c) for c in node.children)


def english_tree(corpus, wl):
    """[(analysis root Node)] for every etymon analysis on the word's page."""
    w = corpus.words[wl]
    roots = []
    for e in corpus.en.get(w.get("wik") or wl, ()):
        for t in e.get("etymology_templates") or []:
            if t.get("name") not in build.ETY_NAMES:
                continue
            plang, ans = etymon_analyses(t, "en")
            if plang != "en":
                continue
            for kind, terms in ans:
                if not terms:
                    continue
                top = Node("en", wl, wl)
                top.kind = kind
                for term in terms:
                    top.children.append(expand(corpus, term, 8, {wl}))
                roots.append(top)
    return roots


# ============================================================ the sections

def section1(corpus, R):
    R.h("## 1. Source-graph census")
    R.p("A lemma page is a page with at least one entry that is not a pure form-of "
        "entry. Template split means entry_split() returns two or more parts on the "
        "page's own language, the read parse_classical makes. Prose plus means the "
        "etymology_text, with any rendered etymology tree removed, contains ' + '. "
        "Structured single parent means an ety/etymon template whose second arg is a "
        "bare term (ety|la|memor), a link the pipeline does not read.")
    census = {}
    prose_only = {"la": [], "grc": []}
    for lang in ("la", "grc"):
        c = collections.Counter()
        for key, entries in corpus.pages[lang].items():
            c["pages"] += 1
            has_split = key in corpus.cl[lang]["split"]
            has_plus = False
            single = False
            for e in entries:
                if has_prose_plus(strip_tree(e.get("etymology_text") or "", lang, key)):
                    has_plus = True
                for t in e.get("etymology_templates") or []:
                    if t.get("name") in build.ETY_NAMES:
                        a2 = ((t.get("args") or {}).get("2") or "").strip()
                        if a2 and not a2.startswith(":"):
                            single = True
            if has_split:
                c["split"] += 1
            elif has_plus:
                c["prose_only"] += 1
                prose_only[lang].append(key)
            else:
                c["neither"] += 1
                if single:
                    c["neither_single_parent"] += 1
        census[lang] = c
    R.p("### 1a. Every lemma page")
    R.table(["extract", "lemma pages", "template split", "prose plus only", "neither",
             "of neither: structured single parent"],
            [[lang, fmt(c["pages"]), "%s (%s)" % (fmt(c["split"]), pct(c["split"], c["pages"])),
              "%s (%s)" % (fmt(c["prose_only"]), pct(c["prose_only"], c["pages"])),
              "%s (%s)" % (fmt(c["neither"]), pct(c["neither"], c["pages"])),
              fmt(c["neither_single_parent"])]
             for lang, c in census.items()])

    # ---- restricted to what shipped chains resolve to
    def classify(lang, key):
        if key not in corpus.pages[lang]:
            return "no lemma page"
        if key in corpus.cl[lang]["split"]:
            return "template split"
        if key in prose_set[lang]:
            return "prose plus only"
        return "neither"
    prose_set = {lang: set(v) for lang, v in prose_only.items()}
    sets = collections.OrderedDict()
    s = set()
    for wl, w in corpus.words.items():
        org = w.get("org")
        if not org:
            continue
        if "parts" in org:
            s.add((org["lang"], build.norm_key(org["lang"], org["l"])))
        else:
            lang, k = org["r"].split(":", 1)
            if lang in ("la", "grc"):
                s.add((lang, k))
    sets["words.json org lemmas (org.l and org.r)"] = s
    s = set()
    for _, wl in corpus.misses:
        ch = corpus.chain.get(wl)
        if ch:
            k = corpus.settle(ch[0], ch[1])
            if k:
                s.add((ch[0], k))
    sets["misses-report chain lemmas, settled"] = s
    s = set()
    for wl, ch in corpus.chain.items():
        k = corpus.settle(ch[0], ch[1])
        if k:
            s.add((ch[0], k))
    sets["every shipped word's chain lemma, settled"] = s
    s = set()
    for wl in corpus.top:
        ch = corpus.chain.get(wl)
        if ch:
            k = corpus.settle(ch[0], ch[1])
            if k:
                s.add((ch[0], k))
    sets["top-10k shipped words' chain lemmas, settled"] = s
    R.p("### 1b. Restricted to the lemmas shipped words reach")
    R.p("Chains recomputed with entry_chain() on the dominant entry and settled with "
        "Origin.settle(), so the keys are the ones the build judged.")
    rows = []
    examples = []
    for name, s in sets.items():
        c = collections.Counter()
        for lang, key in s:
            c[(lang, classify(lang, key))] += 1
        for lang in ("la", "grc"):
            tot = sum(v for (l, _), v in c.items() if l == lang)
            rows.append([name, lang, fmt(tot),
                         "%s (%s)" % (fmt(c[(lang, "template split")]), pct(c[(lang, "template split")], tot)),
                         "%s (%s)" % (fmt(c[(lang, "prose plus only")]), pct(c[(lang, "prose plus only")], tot)),
                         "%s (%s)" % (fmt(c[(lang, "neither")]), pct(c[(lang, "neither")], tot)),
                         fmt(c[(lang, "no lemma page")])])
    R.table(["lemma set", "lang", "lemmas", "template split", "prose plus only", "neither",
             "no lemma page"], rows)
    # examples of prose-only among the chain lemmas
    ex = sorted((lang, k) for lang, k in sets["every shipped word's chain lemma, settled"]
                if classify(lang, k) == "prose plus only")
    rng = random.Random(SEED)
    pick = rng.sample(ex, min(16, len(ex)))
    R.p("Prose-only chain lemmas, 16 at random (%s in the set):" % fmt(len(ex)))
    rows = []
    for lang, k in sorted(pick):
        e = corpus.pages[lang][k][0]
        txt = strip_tree(e.get("etymology_text") or "", lang, k).replace("\n", " ")
        rows.append(["%s:%s" % (lang, corpus.form(lang, k)), R.cut(txt, 140)])
    R.table(["lemma", "etymology_text (prose)"], rows)
    return prose_only, census


def section2(corpus, R, prose_only, verdicts):
    R.h("## 2. Prose decomposition parser")
    R.p("The grammar. A sentence is tokenised into words and balanced parenthesis "
        "groups, so a plus inside a gloss never splits. Every ' + ' at depth zero "
        "joins the word before it (skipping its parentheses) to the word after it, "
        "and pluses chain. A term's language is the language name written before "
        "it (Latin, Medieval Latin, Ancient Greek, Old French and 80 more), else the "
        "last language name at depth zero earlier in the sentence, else the page's "
        "mention templates (m, m+, l, noncog, cog, af, bor, der), else Greek script "
        "means Ancient Greek, else the page's own language. A parenthesis after the "
        "head is scanned for a step ('ablative of X', 'past participle of X', "
        "'frequentative of X', 'diminutive of X', 'feminine of X', 'plural of X' and "
        "kin, 30 keywords), and so is a trailing appositive (', accusative of mons'). "
        "A Greek head's transliteration is skipped. The step target, else the head, "
        "is looked up in the extract of the term's language, every page counted, and "
        "settled through the form-of hop. A page's parse is the first chain whose "
        "every part resolves, else its first chain.")

    # ---- (a) source pages with prose-only decomposition
    results = {"la": [], "grc": []}
    for lang in ("la", "grc"):
        for key in prose_only[lang]:
            entries = corpus.pages[lang][key]
            best = None
            for e in entries:
                p = parse_page(corpus, key, lang, entries, e.get("etymology_text") or "")
                if p and (best is None or (p.ok and not best.ok)):
                    best = p
            results[lang].append((key, best))
    rows = []
    stats = {}
    for lang in ("la", "grc"):
        c = collections.Counter()
        why = collections.Counter()
        for key, p in results[lang]:
            c["pages"] += 1
            if p is None:
                c["no chain parsed"] += 1
                continue
            if len(p.terms) < 2:
                c["no chain parsed"] += 1
                continue
            c["chain parsed"] += 1
            if p.ok:
                c["captured"] += 1
                c["parts_%d" % min(len(p.terms), 4)] += 1
                if all(r[0] == lang for r in p.resolved):
                    c["all same language"] += 1
            else:
                for r in p.resolved:
                    if not r[2]:
                        why[r[3].split(",")[0] if r[3].startswith("no ") else r[3]] += 1
        stats[lang] = (c, why)
        rows.append([lang, fmt(c["pages"]), fmt(c["chain parsed"]),
                     "%s (%s)" % (fmt(c["captured"]), pct(c["captured"], c["pages"])),
                     fmt(c["all same language"]), fmt(c["parts_2"]), fmt(c["parts_3"]),
                     fmt(c["parts_4"])])
    R.p("### 2a. Latin and Greek pages with prose-only decomposition")
    R.table(["extract", "pages", "a chain parsed", "captured (2+ parts, all resolve)",
             "captured, all parts same language", "2 parts", "3 parts", "4+ parts"], rows)
    for lang in ("la", "grc"):
        c, why = stats[lang]
        R.p("Why %s parses failed (one count per failing part):" % lang)
        R.table(["reason", "parts"], [[k, fmt(v)] for k, v in why.most_common(8)])
    # examples of failures
    fails = [(lang, key, p) for lang in ("la", "grc") for key, p in results[lang]
             if p is not None and not p.ok]
    rng = random.Random(SEED + 1)
    R.p("Failed parses, 12 at random:")
    rows = []
    for lang, key, p in rng.sample(fails, min(12, len(fails))):
        rows.append(["%s:%s" % (lang, corpus.form(lang, key)), R.cut(p.sent, 110),
                     p.split_text(), p.why])
    R.table(["page", "sentence", "parsed", "why"], rows)

    # ---- (b) English pages: top-10k shipped words with a classical chain
    en_results = []
    for wl in sorted(corpus.top, key=lambda k: corpus.rank(k)):
        ch = corpus.chain.get(wl)
        if not ch:
            continue
        d = corpus.dom[wl]
        entries = corpus.en.get(corpus.words[wl].get("wik") or wl, [])
        p = parse_page(corpus, wl, "en", entries, d.get("etymology_text") or "")
        en_results.append((wl, p))
    c = collections.Counter()
    why = collections.Counter()
    mix = collections.Counter()
    for wl, p in en_results:
        w = corpus.words[wl]
        bucket = "morphs" if w.get("morphs") else ("org" if w.get("org") else "silent")
        c[("words", bucket)] += 1
        if p is None or len(p.terms) < 2:
            continue
        c[("parsed", bucket)] += 1
        if p.ok:
            c[("captured", bucket)] += 1
            langs = tuple(sorted({r[0] for r in p.resolved}))
            mix[langs] += 1
            if all(r[0] in ("la", "grc") for r in p.resolved):
                c[("classical", bucket)] += 1
        else:
            for r in p.resolved:
                if not r[2]:
                    why[r[3]] += 1
    R.p("### 2b. English pages: top-10k shipped words with a classical chain")
    R.p("Split by what the word ships today. 'classical' means every part resolved "
        "to a Latin or Greek page: the row a source-graph origin subsystem would show.")
    rows = []
    for bucket in ("silent", "org", "morphs"):
        n = c[("words", bucket)]
        rows.append([bucket, fmt(n), fmt(c[("parsed", bucket)]),
                     "%s (%s)" % (fmt(c[("captured", bucket)]), pct(c[("captured", bucket)], n)),
                     "%s (%s)" % (fmt(c[("classical", bucket)]), pct(c[("classical", bucket)], n))])
    tot = sum(c[("words", b)] for b in ("silent", "org", "morphs"))
    rows.append(["all", fmt(tot), fmt(sum(c[("parsed", b)] for b in ("silent", "org", "morphs"))),
                 fmt(sum(c[("captured", b)] for b in ("silent", "org", "morphs"))),
                 fmt(sum(c[("classical", b)] for b in ("silent", "org", "morphs")))])
    R.table(["ships today", "words", "a chain parsed", "captured", "captured, all classical"], rows)
    R.p("Language mix of captured English parses:")
    R.table(["languages", "parses"], [[" + ".join(k), fmt(v)] for k, v in mix.most_common(8)])
    R.p("Why English parses failed (one count per failing part):")
    R.table(["reason", "parts"], [[k, fmt(v)] for k, v in why.most_common(8)])
    # the silent + classical ones are the prize: list 20
    prize = [(wl, p) for wl, p in en_results
             if p and p.ok and not corpus.words[wl].get("morphs") and not corpus.words[wl].get("org")
             and all(r[0] in ("la", "grc") for r in p.resolved)]
    R.p("The English parse reads the dominant entry only, as the harvest does. The "
        "owner's example manuscript shows the limit: its plus clause ('equivalent to "
        "Latin manū + Latin scrīptus') sits on the adjective entry, the dominant noun "
        "entry has none, so the English side yields nothing, while the Latin page "
        "manuscriptus parses to manus + scribere through both steps (2a) and that is "
        "the row scenario C gives it.")
    R.p("Silent top-10k words whose English prose yields an all-classical split, "
        "first 20 by rank (%s in all):" % fmt(len(prize)))
    rows = []
    for wl, p in prize[:20]:
        rows.append([wl, str(corpus.rank(wl)), R.cut(p.sent, 100), p.split_text()])
    R.table(["word", "rank", "sentence", "parsed"], rows)

    # ---- every miss, for scenario C in section 6
    en_ok_miss = set()
    parsed_top = dict(en_results)
    for _, wl in corpus.misses:
        if wl in parsed_top:
            p = parsed_top[wl]
        else:
            d = corpus.dom.get(wl)
            if d is None:
                continue
            entries = corpus.en.get(corpus.words[wl].get("wik") or wl, [])
            p = parse_page(corpus, wl, "en", entries, d.get("etymology_text") or "")
        if p and p.ok and all(r[0] in ("la", "grc") for r in p.resolved):
            en_ok_miss.add(wl)
    R.p("Across all %s misses, the English prose yields an all-classical split for %s."
        % (fmt(len(corpus.misses)), fmt(len(en_ok_miss))))

    # ---- the manual precision sample
    pool_a = [("%s:%s" % (lang, key), lang, key, p) for lang in ("la", "grc")
              for key, p in results[lang] if p and p.ok]
    pool_b = [("en:%s" % wl, "en", wl, p) for wl, p in en_results if p and p.ok]
    rng = random.Random(SEED + 2)
    sample = rng.sample(pool_a, min(40, len(pool_a))) + rng.sample(pool_b, min(20, len(pool_b)))
    R.p("### 2c. Manual precision check, 60 captured parses")
    R.p("40 from the source pages of 2a, 20 from the English pages of 2b, seeded "
        "random. The verdict column is a hand judgement of the parsed split against "
        "the sentence: right means the parts and steps are the ones the sentence "
        "states; partial means the parts are right but a step or a language is "
        "wrong, or one part resolved to the wrong page; wrong means the split is not "
        "what the sentence says.")
    rows = []
    counts = collections.Counter()
    for pid, lang, key, p in sample:
        v = verdicts.get(pid, ("unjudged", ""))
        counts[v[0]] += 1
        rows.append([pid, R.cut(p.sent, 120), p.split_text(), v[0], v[1]])
    R.table(["page", "sentence", "parsed split", "verdict", "reason"], rows)
    R.p("Verdicts: " + ", ".join("%s %d" % (k, v) for k, v in sorted(counts.items())) + ".")
    return results, en_results, stats, c, counts, en_ok_miss



def section3(corpus, R):
    R.h("## 3. Lookup failures")
    R.p("The chain lemmas of the misses-report words and of the top-10k shipped "
        "words with a chain, settled with Origin.settle(). Not found means the "
        "settled key is in neither the gloss table nor the split table of its "
        "extract, the condition under which the build ships nothing. Every failure "
        "is then retried with the spike's lookup rules, applied in this order and "
        "repeated until a glossed or split page is reached or nothing applies: "
        "trailing punctuation and a//b alternation on the template arg; Greek "
        "vowel-length marks (macron, breve) removed, accents and breathings kept; "
        "the form-of hop repeated (settle takes one); every combining mark removed; "
        "the ae/oe/j/v fold. What no rule reaches is classified by where the lemma "
        "does exist.")

    def residual(lang, lemma):
        t, _ = clean_lemma(lemma)
        key = gkey(t) if lang == "grc" else build.norm_key(lang, t)
        other = "grc" if lang == "la" else "la"
        if key in corpus.titles[lang]:
            if key in corpus.cl[lang]["fo"]:
                return "page exists: form-of chain ends on a glossless page"
            return "page exists: lemma page with no usable gloss"
        ok = gkey(t) if other == "grc" else build.norm_key(other, t)
        if ok in corpus.titles[other]:
            return "exists in the other classical extract"
        if " " in key:
            return "multiword lemma"
        if key in corpus.en_titles:
            return "exists only as an English page"
        return "no page anywhere"

    def run(wls):
        c = collections.Counter()
        per_rule = collections.Counter()
        combos = collections.Counter()
        ex = collections.defaultdict(list)
        n_chain = n_missing = n_rec = 0
        for wl in wls:
            ch = corpus.chain.get(wl)
            if not ch:
                continue
            n_chain += 1
            lang, lemma = ch
            key = corpus.settle(lang, lemma)
            if corpus.found(lang, key):
                continue
            n_missing += 1
            k2, rules = corpus.deep_settle(lang, lemma)
            if k2:
                n_rec += 1
                combo = " + ".join(rules) if rules else "settle re-run"
                combos[combo] += 1
                for r in set(rules):
                    per_rule[r] += 1
                    ex[r].append((wl, lang, lemma, k2))
            else:
                reason = residual(lang, lemma)
                c[reason] += 1
                ex[reason].append((wl, lang, lemma, None))
        return n_chain, n_missing, n_rec, c, per_rule, combos, ex

    sets = [("misses-report words", [w for _, w in corpus.misses]),
            ("top-10k shipped words with a chain", sorted(corpus.top, key=lambda k: corpus.rank(k)))]
    union_ex = collections.defaultdict(list)
    out = {}
    for name, wls in sets:
        n_chain, n_missing, n_rec, c, per_rule, combos, ex = run(wls)
        out[name] = (n_missing, n_rec, per_rule, c)
        R.p("### %s: %s chains, %s not found (%s), %s recovered by a rule (%s of the failures)"
            % (name, fmt(n_chain), fmt(n_missing), pct(n_missing, n_chain), fmt(n_rec), pct(n_rec, n_missing)))
        R.p("Recovered, by the rules a chain needed:")
        R.table(["rule combination", "chains"], [[k, fmt(v)] for k, v in combos.most_common()])
        R.p("Per rule (a chain needing two rules counts under both):")
        R.table(["rule", "chains"], [[k, fmt(v)] for k, v in per_rule.most_common()])
        R.p("Not recovered:")
        R.table(["where the lemma is", "chains", "share of failures"],
                [[k, fmt(v), pct(v, n_missing)] for k, v in c.most_common()])
        for k, v in ex.items():
            union_ex[k].extend(v)
    R.p("Examples per rule and per residual class, up to 8 each, both sets:")
    rows = []
    for reason, lst in union_ex.items():
        seen = set()
        for wl, lang, lemma, hit in lst:
            if wl in seen or len(seen) >= 8:
                continue
            seen.add(wl)
            rows.append([reason, wl, "%s:%s" % (lang, lemma), str(hit or "-")])
    R.table(["rule or class", "word", "chain lemma", "page reached"], rows)
    return out


def emitted_set(org):
    if not org:
        return set()
    if "parts" in org:
        out = set()
        for p in org["parts"]:
            if p.get("r"):
                out.add(p["r"])
            else:
                out.add(org["lang"] + ":" + build.norm_key(org["lang"], p["f"]))
        return out
    return {org["r"]}


def section4(corpus, R):
    R.h("## 4. Etymology tree coverage")
    R.p("The tree is walked from the templates, not from the rendered text: every "
        "ety/etymon template on the English page gives its analyses (':inh "
        "enm:x<ety:der<la:y>>', ':af a b', a bare parent), a Latin or Greek node is "
        "expanded through the ety/etymon templates on its own page (a decomposition "
        "analysis first, else the single linear parent), and reconstructed forms stop. "
        "Depth cap 8, cycle-safe. A tree decomposes when a Latin or Greek node has a "
        "decomposition analysis with two or more parts. Its leaf set is the classical "
        "nodes at the bottom of that expansion, which is what a source-graph origin "
        "subsystem would show before any anchor rule. The emitted set is the org row "
        "in words.json (part root keys, or the single root key).")
    rows = []
    disagreements = []
    per = {}
    for name, wls in (("top-10k shipped", sorted(corpus.top, key=lambda k: corpus.rank(k))),
                      ("all shipped", sorted(corpus.words))):
        c = collections.Counter()
        cmp = collections.Counter()
        for wl in wls:
            trees = english_tree(corpus, wl)
            if not trees:
                continue
            c["etymon"] += 1
            leaves = set()
            decomposes = set()
            reach = False
            for t in trees:
                if any_classical(t):
                    reach = True
                tree_leaves(t, leaves, decomposes)
            if reach:
                c["reach classical"] += 1
            if decomposes:
                c["classical decomposes"] += 1
            w = corpus.words[wl]
            E = emitted_set(w.get("org"))
            if not reach:
                continue
            stops_short = (len(leaves) == 1 and not decomposes and all(
                page_analyses(corpus, *k.split(":", 1)) is None for k in leaves))
            if w.get("morphs"):
                verdict = "pipeline shows morphs (English split)"
            elif not E:
                verdict = "pipeline silent, tree decomposes" if decomposes else "pipeline silent, tree single"
            elif leaves == E:
                verdict = "agree"
            elif stops_short:
                verdict = "tree stops short (source page has no etymon template)"
            elif E < leaves:
                verdict = "tree deeper"
            elif leaves < E:
                verdict = "tree shallower"
            else:
                verdict = "different"
            cmp[verdict] += 1
            if verdict in ("tree deeper", "tree shallower", "different",
                           "pipeline silent, tree decomposes") and name == "top-10k shipped":
                disagreements.append((wl, verdict, trees, E, leaves))
        rows.append([name, fmt(len(wls)), "%s (%s)" % (fmt(c["etymon"]), pct(c["etymon"], len(wls))),
                     "%s (%s)" % (fmt(c["reach classical"]), pct(c["reach classical"], c["etymon"])),
                     "%s (%s)" % (fmt(c["classical decomposes"]), pct(c["classical decomposes"], c["etymon"]))])
        per[name] = cmp
    R.table(["word set", "words", "page carries etymon/ety", "tree reaches Latin or Greek",
             "tree reaches a classical node that decomposes"], rows)
    R.p("Tree against what the pipeline emits, among words whose tree reaches a "
        "classical node:")
    keys = ["agree", "tree deeper", "tree shallower", "different",
            "tree stops short (source page has no etymon template)",
            "pipeline silent, tree decomposes", "pipeline silent, tree single",
            "pipeline shows morphs (English split)"]
    R.table(["comparison", "top-10k shipped", "all shipped"],
            [[k, fmt(per["top-10k shipped"][k]), fmt(per["all shipped"][k])] for k in keys])
    R.p("Notes. 'tree deeper': the pipeline stops recursion at anchors "
        "(ORG_ANCHOR_MIN 2) and at ORG_DEPTH 3, and the tree walk does neither, so a "
        "deeper tree is often the same split the anchor's card carries. 'tree stops "
        "short': the walk reached one classical page that carries no etymon template "
        "at all, while the pipeline's af/suffix read of that page, or its last-template "
        "chain rule, went further; that is a gap in Wiktionary's etymon coverage, not "
        "a disagreement. 'different' and 'pipeline silent, tree decomposes' are the "
        "rows to read.")
    rng = random.Random(SEED + 3)
    order = {"pipeline silent, tree decomposes": 0, "different": 1, "tree deeper": 2, "tree shallower": 3}
    disagreements.sort(key=lambda x: (order[x[1]], corpus.rank(x[0])))
    pick = disagreements[:10] + rng.sample(disagreements[10:], min(10, max(0, len(disagreements) - 10)))
    R.p("20 disagreements (the 10 highest-ranked silent-or-different, then 10 at random):")
    rows = []
    for wl, verdict, trees, E, leaves in pick:
        rows.append([wl, str(corpus.rank(wl)), verdict,
                     R.cut(" | ".join(t.show() for t in trees), 150),
                     ", ".join(sorted(E)) or "-", ", ".join(sorted(leaves)) or "-"])
    R.table(["word", "rank", "verdict", "tree", "emitted", "tree leaves"], rows)
    return per


def flatten_reason(corpus, lang, key, cl=None):
    """Why flatten() refuses this lemma's split, mirroring its checks in order."""
    o = corpus.origin
    cl = cl or corpus.cl[lang]
    if o.is_affix(lang, key):
        return "affix-terminal (the lemma page is an affix)"
    raw = cl["split"].get(key)
    if not raw or len(raw) < 2:
        return "no split"
    for p in raw:
        pk = build.norm_key(lang, p)
        if not pk:
            return "empty part"
        if pk == key:
            return "self-part split (%s names itself)" % p
        if (curation.ROOT_ALIASES.get(lang + ":" + pk) or curation.ROOT_ALIASES.get(p)
                or curation.ROOT_ALIASES.get(pk)):
            continue
        if pk not in cl["gloss"]:
            if pk in cl["fo"]:
                return "form-of part (part %s is a form-of page, flatten does not step it)" % p
            if pk in corpus.titles[lang]:
                return "all-or-nothing gloss refusal (part %s has a page, no usable gloss)" % p
            k2, rules = corpus.deep_settle(lang, p)
            if k2:
                return "dead-end part, lookup rule reaches it (part %s -> %s via %s)" % (
                    p, k2, ", ".join(rules) or "form-of hop")
            return "dead-end part (part %s has no page)" % p
    return "split accepted"


class GreekLengthRule:
    """Scope in which build.norm_key strips Greek vowel-length marks."""

    def __enter__(self):
        self.old = build.grc_key
        build.grc_key = gkey
        return self

    def __exit__(self, *a):
        build.grc_key = self.old


def patched_classical(corpus):
    """The classical tables with the spike's part rules applied to every split.

    A part is cleaned (trailing punctuation, a//b), a Greek part loses its
    length marks, and a part that is a form-of page is replaced by the display
    form of the lemma it steps to, so flatten judges the lemma. Everything
    else is the build's own table.
    """
    cl2 = {}
    n = collections.Counter()
    for lang in ("la", "grc"):
        cl = corpus.cl[lang]
        c2 = dict(cl)
        split2 = {}
        for k, parts in cl["split"].items():
            out = []
            for p in parts:
                q, rules = clean_lemma(p)
                pk = gkey(q) if lang == "grc" else build.la_key(q)
                if pk not in cl["gloss"] and pk != k:
                    k2, rules2 = corpus.deep_settle(lang, q)
                    if k2 and k2 in cl["gloss"] and k2 != k:
                        q = cl["form"].get(k2) or k2
                        n["parts stepped"] += 1
                out.append(q)
            split2[k] = out
        c2["split"] = split2
        cl2[lang] = c2
    return cl2, n


def credits(corpus):
    """Root key -> number of shipped words crediting it, recomputed before pruning.

    Morph chips as words.json resolved them, plus the org row each pending word
    would carry under the build's own Origin, plus anchor closure.
    """
    refs = collections.Counter()
    through = build.root_closure(corpus.roots)
    org_rows = {}
    for wl, w in corpus.words.items():
        credited = set()
        for m in w.get("morphs") or ():
            if m.get("r"):
                credited.add(m["r"])
        if not w.get("morphs") and wl in corpus.chain:
            ch = corpus.chain[wl]
            org = corpus.origin.resolve(ch[0], ch[1], count=False)
            if org:
                org_rows[wl] = org
                for r in build.org_roots(org):
                    credited.add(r)
        reached = set()
        for k in credited:
            reached |= through(k)
        for k in reached:
            refs[k] += 1
    return refs, org_rows



def section5(corpus, R, refs, org_rows, cl2, origin2):
    R.h("## 5. Rule drops")
    R.p("Every misses-report word, its chain settled and resolved through the build's "
        "own Origin (same anchors, same flatten). The class in question is the words "
        "whose settled lemma carries a structured split in its extract. The reason "
        "is the first check that stops the row: flatten's refusal when the row "
        "ships single, then the 2-credit threshold against the shipped roots.json. "
        "Credits are recomputed the way link_and_prune counts them. A dead-end part "
        "is reported with the lookup rule that would reach it, when one does.")
    c = collections.Counter()
    ex = collections.defaultdict(list)
    cls = collections.Counter()
    retry = collections.Counter()
    retry_ex = collections.defaultdict(list)
    class_words = []
    for rank, wl in corpus.misses:
        ch = corpus.chain.get(wl)
        if not ch:
            cls["no chain on the dominant entry (re-keyed or harvest differs)"] += 1
            continue
        lang, lemma = ch
        key = corpus.settle(lang, lemma)
        cl = corpus.cl[lang]
        if not corpus.found(lang, key):
            cls["chain lemma not found (section 3)"] += 1
            continue
        if key not in cl["split"]:
            cls["found, no structured split: single root under threshold"] += 1
            continue
        cls["found, structured split (this section)"] += 1
        class_words.append((wl, rank, lang, lemma, key))
        org = org_rows.get(wl) or corpus.origin.resolve(lang, lemma, count=False)
        if org and "parts" in org:
            live = [p["r"] for p in org["parts"] if p.get("r") and p["r"] in corpus.roots]
            if live:
                reason = "other: decomposed row with a live part (build differs from this re-run)"
            else:
                reason = "2-credit threshold: decomposed, every part's root under 2 credits"
            detail = build.show_org(org) + " | credits " + ", ".join(
                "%s=%d" % (p["r"].split(":", 1)[1], refs.get(p["r"], 0)) for p in org["parts"] if p.get("r"))
        else:
            fr = flatten_reason(corpus, lang, key)
            r = (org or {}).get("r", lang + ":" + key)
            if r in curation.ROOT_SKIPS:
                reason = "ROOT_SKIPS"
            elif r in corpus.roots:
                reason = "other: single root that ships (build differs from this re-run)"
            elif fr.startswith("split accepted"):
                reason = "other: split accepted by flatten yet row single"
            else:
                reason = fr.split(" (")[0] + ", then 2-credit threshold on the single root"
            detail = "%s -> %s | %s | credits %d" % (lemma, r, fr, refs.get(r, 0))
        c[reason] += 1
        ex[reason].append((wl, rank, detail))
        # ---- the retry under the proposed rules
        with GreekLengthRule():
            org2 = origin2.resolve(lang, lemma, count=False)
            fr2 = flatten_reason(corpus, lang, corpus.settle(lang, lemma) or key, cl2[lang])
        if org2 and "parts" in org2:
            retry["decomposes"] += 1
            retry_ex["decomposes"].append((wl, rank, build.show_org(org2)))
        else:
            retry["still single: " + fr2.split(" (")[0]] += 1
            retry_ex["still single: " + fr2.split(" (")[0]].append((wl, rank, fr2))
    R.p("All %s misses by class:" % fmt(len(corpus.misses)))
    R.table(["class", "words", "share"], [[k, fmt(v), pct(v, len(corpus.misses))] for k, v in cls.most_common()])
    n = cls["found, structured split (this section)"]
    R.p("Drop reason for the %s words whose lemma has a structured split:" % fmt(n))
    R.table(["reason", "words", "share"], [[k, fmt(v), pct(v, n)] for k, v in c.most_common()])
    R.p("Examples (the named words first, then 4 per reason):")
    named = ["system", "period", "vessel", "bachelor", "prophecy"]
    rows = []
    shown = set()
    for reason, lst in ex.items():
        for wl, rank, detail in lst:
            if wl in named:
                rows.append([wl, str(rank), reason, detail])
                shown.add(wl)
    for wl in named:
        if wl not in shown:
            rows.append([wl, str(corpus.rank(wl)), "not in this class", trace_word(corpus, wl, refs)])
    for reason, lst in ex.items():
        k = 0
        for wl, rank, detail in lst:
            if wl in shown or k >= 4:
                continue
            rows.append([wl, str(rank), reason, detail])
            shown.add(wl)
            k += 1
    R.table(["word", "rank", "reason", "detail"], rows)
    R.p("The same %s words re-run with the proposed part rules (Greek length marks "
        "stripped, form-of parts stepped to their lemma, a//b cleaned), threshold "
        "not applied:" % fmt(n))
    R.table(["outcome", "words", "share"], [[k, fmt(v), pct(v, n)] for k, v in retry.most_common()])
    rows = []
    for wl in named:
        for k, lst in retry_ex.items():
            for w2, rank, d in lst:
                if w2 == wl:
                    rows.append([wl, str(rank), k, d])
    for k, lst in retry_ex.items():
        j = 0
        for wl, rank, d in lst:
            if wl in named or j >= 3:
                continue
            rows.append([wl, str(rank), k, d])
            j += 1
    R.table(["word", "rank", "outcome", "row or reason"], rows)
    return n, retry


def trace_word(corpus, wl, refs):
    ch = corpus.chain.get(wl)
    if not ch:
        return "no chain"
    lang, lemma = ch
    key = corpus.settle(lang, lemma)
    cl = corpus.cl[lang]
    found = key in cl["gloss"] or key in cl["split"]
    if not found:
        return "%s:%s settles to %s, not found in the extract" % (lang, lemma, key)
    org = corpus.origin.resolve(lang, lemma, count=False)
    return "%s:%s -> %s | %s | credits %s" % (
        lang, lemma, build.show_org(org), flatten_reason(corpus, lang, key),
        ", ".join("%s=%d" % (r.split(":", 1)[1], refs.get(r, 0)) for r in build.org_roots(org)))



def section6(corpus, R, refs, org_rows, origin2, results_a, en_ok_miss):
    R.h("## 6. Threshold silence cost")
    R.p("Scenario A: every root key any shipped word references before the 2-credit "
        "threshold, the build's own Origin: morph chips as words.json resolved them, "
        "plus the org row each pending word would carry, plus anchor closure. A key "
        "ships only with a gloss, exactly as link_and_prune requires, so glossless "
        "keys are counted separately. Scenario B: the same with the proposed lookup "
        "and part rules (sections 3 and 5) applied to every chain.")

    def glossed_keys(keys):
        glossed = set()
        glossless = set()
        for k in keys:
            lang, form = k.split(":", 1)
            if lang == "en":
                g = (corpus.affixes.get(form) or {}).get("gloss")
            else:
                g = corpus.cl[lang]["gloss"].get(form) if lang in corpus.cl else None
            g = curation.ROOT_GLOSSES.get(k) or g
            if k in curation.ROOT_SKIPS:
                continue
            (glossed if g else glossless).add(k)
        return glossed, glossless

    glossed, glossless = glossed_keys(refs)
    one = {k for k in glossed if refs[k] < 2}
    extra = glossed - set(corpus.roots)
    # ---- scenario B
    refs_b = collections.Counter()
    org_b = {}
    # The closure link_and_prune builds: every anchor's split, raw, before
    # anyone knows which roots ship. Here from the patched Origin's anchors.
    closure_roots = {}
    with GreekLengthRule():
        for key in origin2.anchors:
            lang, pk = key.split(":", 1)
            flat = origin2.flatten(lang, pk, build.ORG_DEPTH, {pk})
            if flat and len(flat) >= 2:
                closure_roots[key] = {"parts": [{"f": f, "r": r} for f, r in flat if r]}
    through = build.root_closure(closure_roots)
    with GreekLengthRule():
        for wl, w in corpus.words.items():
            credited = set()
            for m in w.get("morphs") or ():
                if m.get("r"):
                    credited.add(m["r"])
            if not w.get("morphs") and wl in corpus.chain:
                lang, lemma = corpus.chain[wl]
                k2, _ = corpus.deep_settle(lang, lemma)
                if k2:
                    org = origin2.resolve(lang, corpus.cl[lang]["form"].get(k2) or k2, count=False)
                    if org:
                        org_b[wl] = org
                        credited |= set(build.org_roots(org))
            reached = set()
            for k in credited:
                reached |= through(k)
            for k in reached:
                refs_b[k] += 1
    glossed_b, glossless_b = glossed_keys(refs_b)
    extra_b = glossed_b - set(corpus.roots)
    R.table(["measure", "scenario A (build rules)", "scenario B (proposed rules)"], [
        ["roots shipped today", fmt(len(corpus.roots)), fmt(len(corpus.roots))],
        ["root keys referenced, with a gloss, before the threshold", fmt(len(glossed)), fmt(len(glossed_b))],
        ["of those, under 2 credits", fmt(len(one)), fmt(len({k for k in glossed_b if refs_b[k] < 2}))],
        ["referenced keys with no gloss (never shippable)", fmt(len(glossless)), fmt(len(glossless_b))],
        ["roots.json would carry", fmt(len(glossed | set(corpus.roots))), fmt(len(glossed_b | set(corpus.roots)))],
        ["extra roots over today", fmt(len(extra)), fmt(len(extra_b))],
        ["bytes per root today (roots.json / roots)", "%.0f" % ROOT_BYTES, "%.0f" % ROOT_BYTES],
        ["added bytes at that size", "%s (%.2f MB)" % (fmt(int(len(extra) * ROOT_BYTES)), len(extra) * ROOT_BYTES / 1e6),
         "%s (%.2f MB)" % (fmt(int(len(extra_b) * ROOT_BYTES)), len(extra_b) * ROOT_BYTES / 1e6)],
    ])
    only_a = sorted(k for k in glossed - glossed_b if k.split(":")[0] != "en")
    only_b = sorted(k for k in glossed_b - glossed if k.split(":")[0] != "en")
    R.p("Scenario B recomputes the anchors under the patched tables (%s against %s) "
        "and credits through them the way link_and_prune does. Its key set is not a "
        "superset of A's: %s keys are referenced only under A and %s only under B, "
        "because lemmas that now decompose stop being roots and their bases take "
        "over (A names grc:βάσις and grc:γένεσις, B names grc:βαίνω, grc:γίγνομαι "
        "and grc:-σις). Examples only under A: %s. Only under B: %s."
        % (fmt(len(origin2.anchors)), fmt(len(corpus.origin.anchors)),
           fmt(len(only_a)), fmt(len(only_b)),
           ", ".join(only_a[:8]), ", ".join(only_b[:8])))

    def outcomes(rows, glossed):
        c = collections.Counter()
        for rank, wl in corpus.misses:
            org = rows.get(wl)
            if not org:
                c["no row (chain lemma not found in the extract)"] += 1
                continue
            keys = build.org_roots(org)
            live = [k for k in keys if k in glossed]
            if not live:
                c["no row (chain lemma not found in the extract)"] += 1
            elif "parts" in org:
                c["decomposed row"] += 1
            else:
                c["single row"] += 1
        return c
    ca = outcomes(org_rows, glossed)
    cb = outcomes(org_b, glossed_b)
    keys = ["decomposed row", "single row", "no row (chain lemma not found in the extract)"]
    R.p("Of the %s misses, with every glossed root shipping:" % fmt(len(corpus.misses)))
    R.table(["outcome", "scenario A", "scenario B"],
            [[k, "%s (%s)" % (fmt(ca[k]), pct(ca[k], len(corpus.misses))),
              "%s (%s)" % (fmt(cb[k]), pct(cb[k], len(corpus.misses)))] for k in keys])
    # ---- scenario C: B plus the two prose parsers
    prose_ok = {lang: {k for k, p in results_a[lang] if p and p.ok} for lang in ("la", "grc")}

    def scenario_c(rows):
        c = collections.Counter()
        for r, wl in rows:
            org = org_b.get(wl)
            live = org and any(k in glossed_b for k in build.org_roots(org))
            if org and live and "parts" in org:
                c["decomposed (templates, proposed rules)"] += 1
                continue
            ch = corpus.chain.get(wl)
            k2 = corpus.deep_settle(ch[0], ch[1])[0] if ch else None
            if ch and k2 and k2 in prose_ok[ch[0]]:
                c["decomposed (source-page prose)"] += 1
            elif wl in en_ok_miss:
                c["decomposed (English-page prose)"] += 1
            elif org and live:
                c["single row"] += 1
            else:
                c["nothing"] += 1
        return c
    keys = ["decomposed (templates, proposed rules)", "decomposed (source-page prose)",
            "decomposed (English-page prose)", "single row", "nothing"]
    top_miss = [(r, w) for r, w in corpus.misses if r <= TOP]
    ca_all = scenario_c(corpus.misses)
    ca_top = scenario_c(top_miss)
    R.p("Scenario C: scenario B, then the source-page prose parser where the settled "
        "lemma is a prose-only page it captures, then the English-page prose parser "
        "where its split is all classical. What each miss would render:")
    R.table(["outcome", "all %s misses" % fmt(len(corpus.misses)), "the %s misses inside the top 10k" % fmt(len(top_miss))],
            [[k, "%s (%s)" % (fmt(ca_all[k]), pct(ca_all[k], len(corpus.misses))),
              "%s (%s)" % (fmt(ca_top[k]), pct(ca_top[k], len(top_miss)))] for k in keys])
    return glossed, glossed_b, org_b, len(extra_b), ca_all, ca_top, len(only_a), len(only_b)


def section7(corpus, R, refs, org_rows):
    R.h("## 7. Never-silent sanity")
    R.p("Top-10k shipped words with no morphs and no org whose chain resolves to a "
        "single glossed root that did not ship. 40 examples spread evenly across the "
        "rank order, with the lemma and the gloss the card would carry.")
    lst = []
    for wl in sorted(corpus.top, key=lambda k: corpus.rank(k)):
        w = corpus.words[wl]
        if w.get("morphs") or w.get("org"):
            continue
        org = org_rows.get(wl)
        if not org or "parts" in org:
            continue
        r = org["r"]
        if r in corpus.roots:
            continue
        lang, key = r.split(":", 1)
        g = curation.ROOT_GLOSSES.get(r) or corpus.gloss(lang, key)
        if not g:
            continue
        lst.append((wl, corpus.rank(wl), lang, corpus.form(lang, key), g, refs.get(r, 0)))
    R.p("%s such words in the top 10k. This is wider than the single-root class of "
        "section 0 (%s), because a word whose source split was refused also resolves "
        "to a single root today and is counted here as well." % (fmt(len(lst)), "320"))
    step = max(1, len(lst) // 40)
    rows = [[wl, str(rank), "%s:%s" % (lang, form), R.cut(g, 90), str(n)]
            for wl, rank, lang, form, g, n in lst[::step][:40]]
    R.table(["word", "rank", "lemma", "first gloss", "credits"], rows)
    return len(lst)


def section0(corpus, R, results_a, en_results):
    """The top-10k classification, the cross-check against the owner's numbers."""
    R.h("## 0. Top-10k classification, recomputed")
    R.p("Shipped words with fr <= 10,000 whose dominant entry carries a classical "
        "chain, and which ship neither morphs nor org. One class per word, first "
        "match in this order.")
    prose_src = {lang: {k for k, p in results_a[lang] if p and p.ok} for lang in ("la", "grc")}
    en_ok = {wl for wl, p in en_results if p and p.ok and all(r[0] in ("la", "grc") for r in p.resolved)}
    c = collections.Counter()
    ex = collections.defaultdict(list)
    n = 0
    for wl in sorted(corpus.top, key=lambda k: corpus.rank(k)):
        w = corpus.words[wl]
        ch = corpus.chain.get(wl)
        if not ch or w.get("morphs") or w.get("org"):
            continue
        n += 1
        lang, lemma = ch
        key = corpus.settle(lang, lemma)
        cl = corpus.cl[lang]
        if not corpus.found(lang, key):
            k2, rules = corpus.deep_settle(lang, lemma)
            if k2:
                k = "chain lemma reached only by a lookup rule (section 3)"
            else:
                k = "chain lemma not found, no rule reaches it"
        elif key in cl["split"]:
            k = "source lemma has a structured split, rules dropped it"
        elif key in prose_src.get(lang, ()):
            k = "prose-only decomposition on the source page (parser captures)"
        elif wl in en_ok:
            k = "prose-only decomposition on the English page (parser captures)"
        else:
            other_split = False
            for e in corpus.en.get(w.get("wik") or wl, ()):
                for t in e.get("etymology_templates") or []:
                    u = build.unwrap(t)
                    if u and len(build.template_parts(u[0], u[2], u[3])) >= 2:
                        other_split = True
            if other_split:
                k = "an English split template the build did not use"
            else:
                k = "single root silenced by the 2-credit threshold"
        c[k] += 1
        ex[k].append(wl)
    R.p("%s words in the class." % fmt(n))
    R.table(["class", "words", "share", "examples"],
            [[k, fmt(v), pct(v, n), ", ".join(ex[k][:8])] for k, v in c.most_common()])
    return c


# ============================================================ the report

class Report:
    def __init__(self):
        self.lines = []

    def h(self, s):
        self.lines += ["", s, ""]

    def p(self, s):
        self.lines += [s, ""]

    def table(self, head, rows):
        esc = lambda s: str(s).replace("|", "\\|").replace("\n", " ")
        self.lines.append("| " + " | ".join(esc(h) for h in head) + " |")
        self.lines.append("|" + "|".join("---" for _ in head) + "|")
        for r in rows:
            self.lines.append("| " + " | ".join(esc(x) for x in r) + " |")
        self.lines.append("")

    @staticmethod
    def cut(s, n):
        s = (s or "").replace("\n", " ")
        return s if len(s) <= n else s[:n - 1] + "…"

    def write(self, path, head):
        with io.open(path, "w", encoding="utf-8", newline="\n") as f:
            f.write(head.rstrip("\n") + "\n")
            f.write("\n".join(self.lines).rstrip("\n") + "\n")


# The hand verdicts for section 2c, keyed by page id. Filled after reading the
# sample the first full run printed; a rerun with the same seed draws the same
# 60 pages. An unlisted page prints as unjudged.
VERDICTS = {
    # ---- 2a, source pages
    "la:quadrigamus": ("right", "two languages, both named in the sentence"),
    "la:tumide": ("partial", "the split is tumidus's, the parent; idus resolves to the noun īdūs, not the suffix -idus"),
    "la:etiamtunc": ("right", ""),
    "la:panicoctarius": ("right", ""),
    "grc:αἰσχροποιός": ("right", ""),
    "la:brabantia vallonica": ("right", ""),
    "la:imparatus": ("right", ""),
    "la:cosariticus": ("right", "Greek suffix reached through the length-mark rule"),
    "la:antehac": ("right", "hāc settles to hic through the form-of hop"),
    "la:antiphona": ("right", "the split of the Greek source, as the sentence states it"),
    "la:decapolis": ("right", ""),
    "la:bacchanal": ("partial", "the sentence's own split is Bacchānus + -ālis (Bacchānus has no page); the parse took the inner split of the intermediate"),
    "la:ablocatus": ("right", "the split of the parent verb, which is what flatten would show"),
    "la:crucigaster": ("right", ""),
    "la:vernicomus": ("right", ""),
    "la:decemvir": ("right", ""),
    "la:nova anglia": ("partial", "parts right, language wrong: 'English' from the calque phrase was inherited, the parts are Latin"),
    "la:oxymorus": ("right", ""),
    "la:syllaba": ("right", ""),
    "la:nonnumquam": ("right", ""),
    "la:hepatites": ("right", "length-mark rule on the suffix"),
    "grc:ἀφάρκη": ("wrong", "the sentence rejects this split as folk etymology; the parser has no stance"),
    "grc:δίπλωσις": ("right", ""),
    "la:patefacio": ("right", ""),
    "la:fortuitus": ("wrong", "the page's split is *fortu- + -ītus; the parse is the split of an unattested stem inside the explanation"),
    "la:augur": ("right", "one of several listed hypotheses, stated as such"),
    "la:pater familias": ("right", "familiās settles to familia through the form-of hop; the appositive step was not read"),
    "la:brabantia septentrionalis": ("right", ""),
    "la:analysis": ("right", ""),
    "la:derogatorius": ("right", "the sentence gives the parent's split only; -tōrius is not in the prose"),
    "la:coronilla": ("right", ""),
    "la:naepor": ("right", "genitive step read"),
    "la:pater noster": ("right", ""),
    "la:lanterna magica": ("right", ""),
    "la:acca": ("right", "a speculative fusion of two letter names, stated as such; the parts resolve to the letter pages"),
    "la:zygostasium": ("right", ""),
    "la:insanabilis": ("right", ""),
    "la:duoetvicesimus": ("right", ""),
    "la:pars pro toto": ("right", "ablative step read"),
    "la:cenotaphium": ("right", ""),
    # ---- 2b, English pages
    "en:manage": ("right", "the Vulgar Latin reconstruction's parts, both Latin pages"),
    "en:proceed": ("right", ""),
    "en:photographer": ("right", "English surface split, the sentence's first chain"),
    "en:education": ("right", ""),
    "en:conscience": ("right", ""),
    "en:republic": ("right", ""),
    "en:decide": ("right", ""),
    "en:astronaut": ("right", ""),
    "en:adore": ("right", ""),
    "en:musical": ("right", ""),
    "en:insane": ("right", ""),
    "en:combat": ("right", ""),
    "en:perimeter": ("right", ""),
    "en:majority": ("right", ""),
    "en:capital": ("right", ""),
    "en:apology": ("right", ""),
    "en:anniversary": ("right", "participle step read"),
    "en:candidate": ("right", ""),
    "en:excuse": ("right", ""),
    "en:detect": ("right", ""),
}

SUMMARY = """# Origin subsystem spike: source graph first

Read-only feasibility measurement, %(date)s. Script: pipeline/spike_origin.py
(rerunnable, --quick samples). Runtime of the run that wrote this file:
%(runtime)s. Inputs: the cached kaikki extracts and the shipped
extension/data files at commit 7a53876 (%(nwords)s words, %(nroots)s roots,
%(nmisses)s misses).

%(summary1)s

%(summary2)s

## Headline table

%(headline)s
"""


def main(argv):
    quick = "--quick" in argv
    rebuild = "--rebuild" in argv
    work = DEFAULT_WORK
    if "--work" in argv:
        work = argv[argv.index("--work") + 1]
    words, roots, misses = load_shipped()
    log("shipped: %s words, %s roots, %s misses" % (fmt(len(words)), fmt(len(roots)), fmt(len(misses))))
    interest = set(words) | {w.get("wik") for w in words.values() if w.get("wik")} \
        | {m for _, m in misses}
    paths, titles_path = reduce_all(work, quick, rebuild, interest)
    corpus = Corpus(paths, titles_path, words, roots, misses)
    R = Report()

    log("section 1")
    prose_only, census = section1(corpus, R)
    log("section 2")
    results_a, en_results, stats2, c2, verdict_counts, en_ok_miss = section2(corpus, R, prose_only, VERDICTS)
    log("section 0 (cross-check)")
    R0 = Report()
    cls = section0(corpus, R0, results_a, en_results)
    log("section 3")
    s3 = section3(corpus, R)
    log("section 4")
    s4 = section4(corpus, R)
    log("credits")
    refs, org_rows = credits(corpus)
    log("patched classical tables")
    cl2, n_patch = patched_classical(corpus)
    origin2 = build.Origin(cl2)
    pending = [corpus.chain[wl] for wl, w in words.items()
               if wl in corpus.chain and not w.get("morphs")]
    with GreekLengthRule():
        n_anchor2 = origin2.find_anchors(pending)
    log("  %s parts stepped, %s anchors under the proposed rules" % (fmt(n_patch["parts stepped"]), fmt(n_anchor2)))
    log("section 5")
    n_split_class, retry5 = section5(corpus, R, refs, org_rows, cl2, origin2)
    log("section 6")
    (glossed, glossed_b, org_b, n_extra_b, c_all, c_top,
     n_only_a, n_only_b) = section6(corpus, R, refs, org_rows, origin2, results_a, en_ok_miss)
    log("section 7")
    n_single = section7(corpus, R, refs, org_rows)

    # ---- headline numbers
    la, grc = census["la"], census["grc"]
    cap_la = stats2["la"][0]
    cap_grc = stats2["grc"][0]
    n_top_chain = sum(1 for wl in corpus.top if wl in corpus.chain)
    n_silent = sum(1 for wl in corpus.top if wl in corpus.chain
                   and not words[wl].get("morphs") and not words[wl].get("org"))
    headline = [
        ["Latin lemma pages: template split / prose only / neither",
         "%s / %s / %s" % (fmt(la["split"]), fmt(la["prose_only"]), fmt(la["neither"]))],
        ["Greek lemma pages: template split / prose only / neither",
         "%s / %s / %s" % (fmt(grc["split"]), fmt(grc["prose_only"]), fmt(grc["neither"]))],
        ["prose parser capture on prose-only Latin pages (any extract / same extract)",
         "%s / %s of %s (%s / %s)" % (fmt(cap_la["captured"]), fmt(cap_la["all same language"]), fmt(cap_la["pages"]),
                                      pct(cap_la["captured"], cap_la["pages"]), pct(cap_la["all same language"], cap_la["pages"]))],
        ["prose parser capture on prose-only Greek pages (any extract / same extract)",
         "%s / %s of %s (%s / %s)" % (fmt(cap_grc["captured"]), fmt(cap_grc["all same language"]), fmt(cap_grc["pages"]),
                                      pct(cap_grc["captured"], cap_grc["pages"]), pct(cap_grc["all same language"], cap_grc["pages"]))],
        ["manual precision, 60 parses (right / partial / wrong / unjudged)",
         "%d / %d / %d / %d" % (verdict_counts["right"], verdict_counts["partial"],
                                verdict_counts["wrong"], verdict_counts["unjudged"])],
        ["top-10k shipped words with a classical chain", fmt(n_top_chain)],
        ["of those, silent today (no morphs, no org)", fmt(n_silent)],
        ["silent: single root under the 2-credit threshold", fmt(cls["single root silenced by the 2-credit threshold"])],
        ["silent: structured split dropped by rules", fmt(cls["source lemma has a structured split, rules dropped it"])],
        ["silent: chain lemma reached only by a lookup rule", fmt(cls["chain lemma reached only by a lookup rule (section 3)"])],
        ["silent: chain lemma not found, no rule reaches it", fmt(cls["chain lemma not found, no rule reaches it"])],
        ["silent: prose-only on source page, parser captures", fmt(cls["prose-only decomposition on the source page (parser captures)"])],
        ["silent: prose-only on English page, parser captures", fmt(cls["prose-only decomposition on the English page (parser captures)"])],
        ["silent: unused English split template", fmt(cls["an English split template the build did not use"])],
        ["misses rendering under scenario C, all 1,752: decomposed / single / nothing",
         "%s / %s / %s" % (fmt(c_all["decomposed (templates, proposed rules)"] + c_all["decomposed (source-page prose)"]
                               + c_all["decomposed (English-page prose)"]), fmt(c_all["single row"]), fmt(c_all["nothing"]))],
        ["misses rendering under scenario C, top 10k: decomposed / single / nothing",
         "%s / %s / %s" % (fmt(c_top["decomposed (templates, proposed rules)"] + c_top["decomposed (source-page prose)"]
                               + c_top["decomposed (English-page prose)"]), fmt(c_top["single row"]), fmt(c_top["nothing"]))],
        ["roots.json with no threshold, build rules: roots / added bytes",
         "%s / %.2f MB" % (fmt(len(glossed | set(roots))), (len(glossed - set(roots))) * ROOT_BYTES / 1e6)],
        ["roots.json with no threshold, proposed rules: roots / added bytes",
         "%s / %.2f MB" % (fmt(len(glossed_b | set(roots))), n_extra_b * ROOT_BYTES / 1e6)],
    ]
    hl = Report()
    hl.table(["measure", "value"], headline)
    runtime = "%.0f s" % (time.time() - T0)
    m_missing, m_rec, m_rules, m_res = s3["misses-report words"]
    N = {
        "nmisses": fmt(len(misses)), "ntopmiss": fmt(n_silent),
        "m_missing": fmt(m_missing), "m_rec": fmt(m_rec),
        "r_len": fmt(m_rules.get("Greek length marks", 0)),
        "r_hop": fmt(m_rules.get("form-of hop 2", 0)),
        "r_acc": fmt(m_rules.get("Greek accent or breathing", 0)),
        "n_split": fmt(n_split_class), "n_split_ok": fmt(retry5.get("decomposes", 0)),
        "c_src": fmt(c_all["decomposed (source-page prose)"]),
        "c_en": fmt(c_all["decomposed (English-page prose)"]),
        "v_right": verdict_counts["right"], "v_partial": verdict_counts["partial"],
        "v_wrong": verdict_counts["wrong"],
        "c_dec": fmt(c_all["decomposed (templates, proposed rules)"] + c_all["decomposed (source-page prose)"]
                     + c_all["decomposed (English-page prose)"]),
        "c_single": fmt(c_all["single row"]), "c_none": fmt(c_all["nothing"]),
        "t_dec": fmt(c_top["decomposed (templates, proposed rules)"] + c_top["decomposed (source-page prose)"]
                     + c_top["decomposed (English-page prose)"]),
        "t_single": fmt(c_top["single row"]), "t_none": fmt(c_top["nothing"]),
        "extra_b": fmt(n_extra_b), "mb_b": "%.2f" % (n_extra_b * ROOT_BYTES / 1e6),
        "root_bytes": "%.0f" % ROOT_BYTES, "only_a": fmt(n_only_a), "only_b": fmt(n_only_b),
        "res_total": fmt(m_missing - m_rec), "res_prose": fmt(m_missing - m_rec - c_all["nothing"]),
        "res_none": fmt(m_res.get("no page anywhere", 0)), "res_multi": fmt(m_res.get("multiword lemma", 0)),
        "res_en": fmt(m_res.get("exists only as an English page", 0)),
        "cap_la": fmt(cap_la["all same language"]), "cap_la_n": fmt(cap_la["pages"]),
        "cap_grc": fmt(cap_grc["all same language"]), "cap_grc_n": fmt(cap_grc["pages"]),
        "recon_la": fmt(stats2["la"][1].get("reconstructed", 0)),
        "recon_grc": fmt(stats2["grc"][1].get("reconstructed", 0)),
        "n_ety": fmt(sum(1 for wl in corpus.top if english_tree(corpus, wl))),
        "n_reach": fmt(sum(s4["top-10k shipped"].values())),
        "n_treedec": fmt(s4["top-10k shipped"]["pipeline silent, tree decomposes"]),
        "t_agree": fmt(s4["top-10k shipped"]["agree"]), "t_diff": fmt(s4["top-10k shipped"]["different"]),
        "t_short": fmt(s4["top-10k shipped"]["tree stops short (source page has no etymon template)"]),
        "n_single7": fmt(n_single),
    }
    head = SUMMARY % {
        "date": time.strftime("%Y-%m-%d"), "runtime": runtime,
        "nwords": fmt(len(words)), "nroots": fmt(len(roots)), "nmisses": fmt(len(misses)),
        "summary1": SUMMARY1 % N, "summary2": SUMMARY2 % N,
        "headline": "\n".join(hl.lines).strip(),
    }
    final = Report()
    final.lines = R0.lines + R.lines
    # A sampled run never overwrites the report the full run wrote.
    dest = REPORT if not quick else os.path.join(work, "spike-origin-quick.md")
    final.write(dest, head)
    log("wrote %s (%s)" % (dest, runtime))
    return 0


SUMMARY1 = """\
What a source-graph-first origin subsystem would recover. The design under test
builds the Latin and Greek graphs from templates plus prose, lets an English
word attach through any classical mention, and never stays silent when the
lemma has a gloss. Measured against the %(nmisses)s shipped words that state a
classical origin and show nothing (%(ntopmiss)s of them inside the top 10k), it
recovers in four layers. Lookup rules reach %(m_rec)s of the %(m_missing)s chain
lemmas the build cannot find (Greek vowel-length marks %(r_len)s, a second
form-of hop %(r_hop)s, accent or breathing %(r_acc)s). Two part rules, the same
length-mark strip on split parts and a step from a form-of part such as sciēns
to its lemma, turn %(n_split_ok)s of the %(n_split)s refused source splits into
decomposed rows: system, period, vessel, prophecy, present, experience and
science among them. The prose parser adds %(c_src)s decomposed rows from source
pages and %(c_en)s from English pages, at a hand-checked precision of
%(v_right)d right, %(v_partial)d partial and %(v_wrong)d wrong in 60 parses. Dropping
the 2-credit threshold turns every remaining single-root chain into a one-chip
row. Together (scenario C, section 6): %(c_dec)s of the %(nmisses)s misses render a
decomposed row, %(c_single)s a single FROM LATIN or FROM GREEK row, %(c_none)s
nothing; inside the top 10k, %(t_dec)s decomposed, %(t_single)s single, %(t_none)s
nothing. roots.json grows by about %(extra_b)s cards, %(mb_b)s MB at today's
%(root_bytes)s bytes per root, and the root graph consolidates as lemmas that now
decompose hand their credits to shared bases (%(only_a)s keys named only today,
%(only_b)s named only under the rules)."""

SUMMARY2 = """\
What it would not recover. No lookup rule reaches %(res_total)s of the chain
lemmas: %(res_none)s name a lemma Wiktionary never wrote (turbula, petia, rollāre,
Byzantine Greek cited under gkm), %(res_multi)s are multiword (ad montem, per
centum), %(res_en)s exist only as English pages. The English-page prose still
gives %(res_prose)s of those words a row, and %(c_none)s misses end with nothing. The prose parser
captures %(cap_la)s of %(cap_la_n)s prose-only Latin pages and %(cap_grc)s of
%(cap_grc_n)s Greek ones inside the same extract; what it misses is mostly a
reconstructed part (%(recon_la)s Latin parts, %(recon_grc)s Greek), and it has no
stance detection, so a sentence that rejects a split parses like one that
asserts it (ἀφάρκη). Wiktionary's etymon tree is not a coverage source on its
own: %(n_ety)s top-10k words carry an etymon template, %(n_reach)s trees reach a
Latin or Greek node, %(n_treedec)s of those are words the pipeline leaves silent
while the tree decomposes, and where both speak they agree %(t_agree)s times and
differ %(t_diff)s, because the tree follows a different analysis (identity:
idem + -tās against the calque's ταὐτότης) or the source page carries no etymon
template at all (%(t_short)s). The one-chip rows the no-silence rule adds are
mostly sound (idea from ἰδέα "form, shape", table from tabula) with a visible
minority of homograph glosses (cave from cava "jackdaw", coop from cōpa "tavern-
keeper") that a gloss audit would have to catch; section 7 lists 40 of the
%(n_single7)s top-10k cases for that judgement."""


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
