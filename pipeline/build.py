#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Etymikon -- build-time data pipeline (Agent A).

    download-if-missing  ->  graphs  ->  parse  ->  curate  ->  cap  ->  emit  ->  verify

Sources
    * kaikki.org English Wiktionary extract (JSONL gzip, ~500 MB):
      definitions, morpheme splits, origin mentions, inflected forms
    * kaikki.org Latin and Ancient Greek extracts: the source graphs
      (lemma nodes, decomposition edges, step edges)
    * kaikki.org Old French, Middle French and French extracts: the
      pass-through pages a chain walks on its way to a root language
    * hermitdave/FrequencyWords en_full (OpenSubtitles 2018): ranks

Outputs (UTF-8, no BOM, compact / no indentation)
    extension/data/words.json
    extension/data/roots.json
    extension/data/forms.json

Usage
    python pipeline/build.py            # download if missing, parse, emit, verify
    python pipeline/build.py --verify   # re-verify existing outputs only
    python pipeline/build.py --offline  # build from the cache, contact nobody
    python pipeline/build.py --force-download

See pipeline/README.md.
"""

from __future__ import annotations

import collections
import math
import copy
import gzip
import io
import json
import os
import random
import re
import subprocess
import sys
import time
import unicodedata

# Hand-curated overrides (pipeline/curation.py). Local module, stdlib only;
# sys.path[0] is this directory whenever build.py runs as a script, which is
# the only supported way to run it.
import curation

# orjson decodes the 1.5 M-line English extract about three times faster than
# the stdlib. It is not a hard requirement: the fallback is exact.
try:
    import orjson as _fastjson

    def loads(b):
        return _fastjson.loads(b)
except ImportError:
    def loads(b):
        return json.loads(b)

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
CACHE = os.path.join(HERE, "cache")
OUT = os.path.join(ROOT, "extension", "data")
REPORT_FILE = os.path.join(CACHE, "build-report.txt")
VERIFY_REPORT_FILE = os.path.join(CACHE, "verify-report.txt")
# The words a field report is most likely to be about: a classical origin in
# the source and nothing to show for it on the card. See the coverage lines.
MISSES_FILE = os.path.join(CACHE, "misses-report.txt")

ENGLISH_URL = ("https://kaikki.org/dictionary/English/"
               "kaikki.org-dictionary-English.jsonl.gz")
# Latin and Ancient Greek supply root-card glosses and the one decomposition
# hop that lands a family on its base lemma. Nothing English is read here.
LATIN_URL = ("https://kaikki.org/dictionary/Latin/"
             "kaikki.org-dictionary-Latin.jsonl.gz")
GREEK_URL = ("https://kaikki.org/dictionary/Ancient%20Greek/"
             "kaikki.org-dictionary-AncientGreek.jsonl.gz")
# External English word-frequency list, used ONLY for the `fr` rank, which
# drives the hybrid cap and the runtime tier chip. hermitdave/FrequencyWords
# (MIT), counts derived from the OPUS OpenSubtitles 2018 corpus. See
# extension/data/DATA-LICENSE.md.
EXTFREQ_URL = ("https://raw.githubusercontent.com/hermitdave/FrequencyWords/"
               "master/content/2018/en/en_full.txt")

ENGLISH_FILE = os.path.join(CACHE, "kaikki-English.jsonl.gz")
LATIN_FILE = os.path.join(CACHE, "kaikki-Latin.jsonl.gz")
GREEK_FILE = os.path.join(CACHE, "kaikki-AncientGreek.jsonl.gz")
EXTFREQ_FILE = os.path.join(CACHE, "en_full_opensubtitles.txt")
# The pass-through extracts (owner decision 2026-09-05). A chain that stops
# at Old French continues to Latin when the French page names it, so the
# French-group pages are read for their mentions and never ship as cards.
# kaikki publishes no Anglo-Norman extract (checked 2026-09-05), so an xno
# mention is walked only through what the English page itself says.
PASS_FILES = {
    "fro": ("https://kaikki.org/dictionary/Old%20French/"
            "kaikki.org-dictionary-OldFrench.jsonl.gz",
            os.path.join(CACHE, "kaikki-OldFrench.jsonl.gz")),
    "frm": ("https://kaikki.org/dictionary/Middle%20French/"
            "kaikki.org-dictionary-MiddleFrench.jsonl.gz",
            os.path.join(CACHE, "kaikki-MiddleFrench.jsonl.gz")),
    "fr": ("https://kaikki.org/dictionary/French/"
           "kaikki.org-dictionary-French.jsonl.gz",
           os.path.join(CACHE, "kaikki-French.jsonl.gz")),
}
# The gold set and its committed score (SPEC "Principle 5"). The build scores
# itself against the rows on every run and fails when it scores under the
# committed number.
GOLD_FILE = os.path.join(HERE, "gold.json")
GOLD_SCORE_FILE = os.path.join(HERE, "gold-score.json")
# The 1,752 words that stated a classical origin and shipped nothing at
# 2026-09-01. The report counts what each of them renders now, so the
# expected outcome of the source-graph design is checked, not assumed.
MISSES_BASELINE_FILE = os.path.join(HERE, "misses-2026-09-01.txt")

# ---------------------------------------------------------------- shape caps

RANK_CAP = 50000        # hybrid cap: everything to here ships unconditionally
MAX_POS = 4             # POS sections per word
MAX_DEFS = 4            # definitions per POS section
DEF_MAX_CHARS = 400     # a longer sense is dropped whole, never cut
ROOT_GLOSS_CARD = 80    # the card budget a root gloss should fit
ROOT_GLOSS_MAX = 160    # safety cap: a longer root gloss is dropped, never cut
MAX_ALT = 8             # alias forms listed on a root card
# The band the coverage lines measure. The commonest ten thousand words are
# the ones a reader meets, so a breakdown gap there is a gap that gets seen.
COVERAGE_TOP = 10000

# Word keys the runtime can actually reach. lookup.js takes the first token of
# letters, apostrophes and internal hyphens, so anything outside that shape is
# unreachable and must not ship. This also keeps affix pages (-an, sub-) and
# multiword phrases out of words.json.
RE_WORD_KEY = re.compile(r"^[a-z](?:[a-z'-]*[a-z'])?$")

# Entry kinds that make a page an affix rather than a word. These are the
# only English pages that become root cards. Origin plays no part: un- and
# -ness are affix entries exactly as sub- and -ation are.
AFFIX_POS = frozenset({"prefix", "suffix", "infix", "interfix", "circumfix",
                       "combining form", "combining_form"})
# Harvested pos -> the SPEC's `kind` enum. The enum has no interfix member, so
# an interfix page is an infix card (-o- in speedometer). A combining form is
# not in this table: it is a root unless its page is hyphen-shaped, which is
# what root_kind() falls through to.
AFFIX_KIND = {"prefix": "prefix", "suffix": "suffix", "infix": "infix",
              "interfix": "infix", "circumfix": "circumfix"}
COMBINING_POS = frozenset({"combining form", "combining_form"})


def mb(n: int) -> str:
    return "%.1f MB" % (n / (1024.0 * 1024.0))


REPORT = []

# The report prints Greek script and Latin macrons. The Windows console
# defaults to cp1252, which cannot encode either.
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")


def log(*a):
    line = " ".join(str(x) for x in a)
    REPORT.append(line)
    print(line, flush=True)


# ---------------------------------------------------------------- download

def _curl(args):
    return subprocess.run(["curl"] + args, capture_output=True, text=True,
                          errors="replace")


def remote_size(url: str) -> int:
    r = _curl(["-sIL", "--max-time", "60", url])
    if r.returncode != 0:
        return -1
    sizes = re.findall(r"^content-length:\s*(\d+)", r.stdout or "", re.I | re.M)
    return int(sizes[-1]) if sizes else -1


def download(url: str, dest: str, force: bool = False,
             offline: bool = False) -> str:
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    have = os.path.getsize(dest) if os.path.exists(dest) else 0
    if offline:
        # No HEAD request, no size comparison, no fetch. The cache is the
        # corpus. kaikki republishes on its own schedule, and a republish
        # mid-task moves every number in the report, so a run that has to
        # be comparable to the run before it uses this.
        if not have:
            raise SystemExit("--offline: %s is not in the cache" % dest)
        log("  offline  %s (%s)" % (os.path.basename(dest), mb(have)))
        return dest
    if force and have:
        os.remove(dest)
        have = 0
    want = -1
    if have and not force:
        # The extracts are hundreds of megabytes and republished on kaikki's
        # own schedule. A HEAD request per build is cheap; skip it when the
        # file is already there and nothing asked for a refresh.
        want = remote_size(url)
        if want <= 0 or have == want:
            log("  cached   %s (%s)" % (os.path.basename(dest), mb(have)))
            return dest
        # Any size mismatch means kaikki republished. A completed file from
        # the old publication looks exactly like an interrupted download of
        # the new one, so it must never be a resume target: curl -C - would
        # append the new remote's tail to the old file and corrupt it
        # (agent finding 2026-09-01, both English and Latin caches).
        log("  remote republished; restarting %s" % os.path.basename(dest))
        os.remove(dest)
    else:
        want = remote_size(url)
    # Resume only ever applies to a .part file, and only when the remote is
    # still the same size the interrupted attempt was fetching.
    part = dest + ".part"
    wantf = dest + ".want"
    partial = os.path.getsize(part) if os.path.exists(part) else 0
    recorded = ""
    if os.path.exists(wantf):
        with open(wantf) as f:
            recorded = f.read().strip()
    if partial and (want <= 0 or recorded != str(want)):
        os.remove(part)
        partial = 0
    with open(wantf, "w") as f:
        f.write(str(want))
    log("  fetching %s%s" % (
        os.path.basename(dest),
        (" (resuming at %s of %s)" % (mb(partial), mb(want))) if partial
        else "",
    ))
    rc = subprocess.run(
        ["curl", "-L", "--fail", "--retry", "3", "--retry-delay", "2",
         "-C", "-", "-o", part, url]
    ).returncode
    now = os.path.getsize(part) if os.path.exists(part) else 0
    if rc != 0 and not (want > 0 and now == want):
        raise SystemExit("download failed (curl exit %s): %s" % (rc, url))
    os.replace(part, dest)
    os.remove(wantf)
    log("  got      %s (%s)" % (os.path.basename(dest), mb(now)))
    return dest


# ---------------------------------------------------------------- key shapes

RE_MACRON = re.compile("[̄̆]")


def la_key(s: str) -> str:
    """Latin root key: macrons and breves stripped, lowercased.

    Latin page titles are already unmacronised, but chain templates quote
    the macronised form (der|en|la|territōrium), so both spellings have to
    arrive at the same key.
    """
    d = unicodedata.normalize("NFD", s or "")
    return unicodedata.normalize("NFC", RE_MACRON.sub("", d)).lower()


def grc_key(s: str) -> str:
    """Greek root key: vowel-length marks stripped, NFC, lowercased.

    Accents and breathings are kept, because Greek spelling is meaningful.
    The macron and breve are not spelling: templates write σῠνῐ́στημῐ and
    περῐ́ to show vowel length, and page titles never carry them, so the
    length marks are dropped from the key (SPEC lookup rules, 2026-09-05;
    the rule alone reached 87 of 421 missing chain lemmas in the spike).
    NFC is what makes Μοῦσα from a template and μοῦσα from the extract one
    key.
    """
    d = unicodedata.normalize("NFD", s or "")
    return unicodedata.normalize("NFC", RE_MACRON.sub("", d)).lower()


def strip_marks(s: str) -> str:
    """Every combining mark removed: the loose key behind the accent and
    breathing fallback (πάπας reaches πάππας, coërceō reaches coerceo)."""
    return "".join(ch for ch in unicodedata.normalize("NFD", s or "")
                   if unicodedata.category(ch) != "Mn").lower()


def norm_key(lang: str, s: str) -> str:
    return la_key(s) if lang == "la" else grc_key(s)


# ---------------------------------------------------------------- text

RE_WS = re.compile(r"\s+")
# A leading usage label that wiktextract left in the gloss line.
RE_LEAD_LABEL = re.compile(r"^\((?:[^()]{0,40})\)\s*")
# A trailing clarifier: "music (art form)", "territory (particularly, ...)".
RE_TAIL_PAREN = re.compile(r"\s*\([^()]*\)\s*$")


def clean_text(s) -> str:
    return RE_WS.sub(" ", (s or "").replace("\n", " ")).strip()


def clean_def(s) -> str:
    """A definition line as it ships. Whitespace only; wording is untouched."""
    return clean_text(s)


# A clause end: a semicolon or a full stop that closes a word rather than an
# abbreviation, so "U.S. Army" is not cut at the U.
RE_CLAUSE_END = re.compile(r"[;.](?=\s|$)")
CLAUSE_MIN = 12         # below this a first clause is a fragment, not a gloss


def gloss_line(s) -> str:
    """One sense line, normalised for a root card. Nothing is cut here.

    Wiktionary root senses are usually a gloss followed by a parenthesised
    clarifier, and wiktextract sometimes leaves a usage label in front.
    Dropping both is selection, not truncation: what survives is a whole
    clause from the source.
    """
    g = clean_text(s)
    if not g:
        return ""
    g = RE_LEAD_LABEL.sub("", g)
    prev = None
    while prev != g:
        prev = g
        g = RE_TAIL_PAREN.sub("", g).strip()
    return g.rstrip(":").strip()


def abbrev_dot(g: str, i: int) -> bool:
    """True when the full stop at i closes an abbreviation, not a sentence."""
    word = g[:i].rsplit(" ", 1)[-1]
    return len(word) < 2 or "." in word


def first_clause(g: str) -> str:
    """The first clause of a sense line, split at a semicolon or full stop."""
    for m in RE_CLAUSE_END.finditer(g):
        if m.start() < CLAUSE_MIN:
            continue
        if g[m.start()] == "." and abbrev_dot(g, m.start()):
            continue
        return g[:m.start()].strip()
    return g.rstrip(".").strip()


# ------------------------------------------------------------- template sets
#
# These five tables are the authority for how the extracts are read. spike.py
# and spike_size.py hold frozen copies of an older revision of them; those are
# spike artifacts pinned to the numbers they published and are never a source
# for this file.

# Templates that split a word into morphemes.
#
# `com+` and `compound+` are the category-adding variants of `com` and
# `compound`, the same relation the `+` origin names carry (owner decision
# 2026-09-01). The census found them at 631 and 45 uses, both under
# CENSUS_MIN, so the gate never spoke up. Their arg layout is identical to
# the plain names, verified against the extract: arg 1 is the language code
# and the parts run from arg 2 (com+ on homeworld is home + world, compound+
# on elderberry is elder + berry). These two are the only `+` variants of a
# decomposition name the extract carries.
DECOMP_NAMES = frozenset({
    "prefix", "pre", "suffix", "suf", "affix", "af", "confix",
    "compound", "com", "compound+", "com+",
    "surf", "surface analysis", "univerbation",
})
# The surface-analysis templates. Preferred over the others on one entry:
# a surface analysis is the reader-facing layer by definition.
SURF_NAMES = frozenset({"surf", "surface analysis"})
# Templates that state an origin language without splitting.
#
# The `+` names are the same templates with the category-adding variant
# Wiktionary now writes ({{bor+|en|la|compōnēns}}). They carry an identical
# arg layout and only the name differs. Missing them cost 294 shipped words
# their whole chain, component among them: its only classical template is a
# bor+, so the FROM LATIN row was absent while compose beside it decomposed
# (owner field report 2026-09-01). A census of the extract has bor+ on 2,285
# classical targets and der+ on 98. lbor+, slbor+, ubor+ and uder+ do not
# appear yet; they are listed because the plain names are, and a name that
# never fires costs nothing.
ORIGIN_NAMES = frozenset({
    "der", "derived", "bor", "borrowed", "inh", "inherited",
    "lbor", "learned borrowing", "slbor", "semi-learned borrowing",
    "ubor", "uder", "unadapted borrowing",
    "der+", "bor+", "inh+", "lbor+", "slbor+", "ubor+", "uder+",
})
LATIN_CODES = frozenset({
    "la", "la-cla", "la-lat", "la-med", "la-ecc", "la-new", "la-vul",
    "ML", "ML.", "LL", "LL.", "NL", "NL.", "VL", "VL.",
})
GREEK_CODES = frozenset({"grc", "grc-koi", "gkm"})
# A suffix that only inflects. A split ending in one of these is not a
# breakdown, so the word keeps its card and loses its morphs row.
INFLECTIONAL = frozenset({"-s", "-es", "-ed", "-ing", "-est", "-'s", "-s'"})

# ------------------------------------------------------- language roles
#
# Every language code the extracts use falls into exactly one role (SPEC
# "Origin subsystem, source graphs", Principle 2, owner decision
# 2026-09-05). The tables are data with a reason per row and sit under the
# census gate: a code at or above CENSUS_MIN uses in no role fails the build,
# the same loud-failure pattern as an unclassified template name.
#
#   root          nodes ship as root cards with families; phase one is Latin
#                 (every period code) and Ancient Greek (grc, grc-koi, gkm)
#   pass-through  pages are walked to continue a chain toward a root language
#                 and never ship as cards; phase one is the French group
#   row-only      every other attested language; the word renders one inert
#                 origin row ("From Old Norse ský (cloud)") and nothing else
#   ignored       codes that name no origin language at all
#
# A reconstructed term (starting with `*`) ends the walk whatever its code, so
# the proto-language codes need no row: they never carry an attested term.
ROOT_LANGS = {}
for _c in LATIN_CODES:
    ROOT_LANGS[_c] = "la"
for _c in GREEK_CODES:
    ROOT_LANGS[_c] = "grc"
# Old Northern French is an etymology-only variant of Old French and its
# terms live on the Old French pages.
PASS_LANGS = {"fro": "Old French", "fro-nor": "Old French", "xno": "Anglo-Norman",
              "frm": "Middle French", "fr": "French"}
PASS_EXTRACT = {"fro": "fro", "fro-nor": "fro", "frm": "frm", "fr": "fr"}
# Row-only languages with the name the row prints, read off the language
# census of the English extract (2026-09-05, every code down to about 60
# uses). The name is what Wiktionary prints for the code; the extension's
# LANG_NAME table has to carry every code that reaches a row, and verify
# checks it does.
ROW_ONLY_LANGS = {
    "enm": "Middle English", "ang": "Old English", "de": "German",
    "nl": "Dutch", "es": "Spanish", "it": "Italian", "sv": "Swedish",
    "cmn": "Mandarin", "non": "Old Norse", "da": "Danish", "ja": "Japanese",
    "sa": "Sanskrit", "is": "Icelandic", "ar": "Arabic", "ru": "Russian",
    "fy": "West Frisian", "sco": "Scots", "pl": "Polish", "ga": "Irish",
    "ro": "Romanian", "stq": "Saterland Frisian", "cy": "Welsh",
    "he": "Hebrew", "uk": "Ukrainian", "pt": "Portuguese",
    "dum": "Middle Dutch", "no": "Norwegian", "nds": "Low German",
    "goh": "Old High German", "hi": "Hindi", "gml": "Middle Low German",
    "nds-de": "German Low German", "yi": "Yiddish", "fa": "Persian",
    "gd": "Scottish Gaelic", "gmh": "Middle High German", "got": "Gothic",
    "cs": "Czech", "nn": "Norwegian Nynorsk", "fo": "Faroese",
    "lt": "Lithuanian", "el": "Greek", "hy": "Armenian", "frr": "North Frisian",
    "sq": "Albanian", "sh": "Serbo-Croatian", "nb": "Norwegian Bokmål",
    "fa-cls": "Classical Persian", "ko": "Korean", "ms": "Malay",
    "lb": "Luxembourgish", "nan-hbl": "Hokkien", "yue": "Cantonese",
    "zh": "Chinese", "af": "Afrikaans", "tr": "Turkish", "mi": "Māori",
    "osx": "Old Saxon", "sk": "Slovak", "tl": "Tagalog", "eu": "Basque",
    "ca": "Catalan", "ota": "Ottoman Turkish", "sga": "Old Irish",
    "sl": "Slovene", "ofs": "Old Frisian", "mni": "Manipuri",
    "gsw": "Alemannic German", "wym": "Vilamovian", "hu": "Hungarian",
    "ur": "Urdu", "ta": "Tamil", "cim": "Cimbrian", "oc": "Occitan",
    "nrf": "Norman", "bg": "Bulgarian", "yol": "Yola", "be": "Belarusian",
    "kw": "Cornish", "hbo": "Biblical Hebrew", "fi": "Finnish",
    "lv": "Latvian", "bn": "Bengali", "vi": "Vietnamese", "egy": "Egyptian",
    "bar": "Bavarian", "haw": "Hawaiian", "br": "Breton", "th": "Thai",
    "ae": "Avestan", "id": "Indonesian", "pa": "Punjabi",
    "nci": "Classical Nahuatl", "pro": "Old Occitan", "ka": "Georgian",
    "my": "Burmese", "gl": "Galician", "scn": "Sicilian", "li": "Limburgish",
    "arc": "Aramaic", "mk": "Macedonian", "ml": "Malayalam", "gv": "Manx",
    "cu": "Old Church Slavonic", "bo": "Tibetan", "txb": "Tocharian B",
    "ltc": "Middle Chinese", "dz": "Dzongkha", "ovd": "Elfdalian",
    "ug": "Uyghur", "gmw-cfr": "Central Franconian", "mhn": "Mòcheno",
    "mn": "Mongolian", "akk": "Akkadian", "mr": "Marathi", "oj": "Ojibwe",
    "ceb": "Cebuano", "vls": "West Flemish", "te": "Telugu", "km": "Khmer",
    "gmq-osw": "Old Swedish", "pal": "Middle Persian", "xcl": "Old Armenian",
    "kmr": "Northern Kurdish", "mga": "Middle Irish", "hop": "Hopi",
    "yo": "Yoruba", "gu": "Gujarati", "ne": "Nepali", "xto": "Tocharian A",
    "fa-ira": "Iranian Persian", "hit": "Hittite", "pt-BR": "Brazilian Portuguese",
    "tpw": "Old Tupi", "odt": "Old Dutch", "qu": "Quechua", "am": "Amharic",
    "peo": "Old Persian", "roa-oit": "Old Italian", "os": "Ossetian",
    "enm-nor": "Northern Middle English", "syc": "Classical Syriac",
    "nah": "Nahuatl", "rom": "Romani", "ps": "Pashto", "sw": "Swahili",
    "phn": "Phoenician", "sux": "Sumerian", "ett": "Etruscan",
    "nan-tws": "Teochew", "si": "Sinhalese", "nrn": "Norn", "et": "Estonian",
    "cr": "Cree", "kk": "Kazakh", "orv": "Old East Slavic", "kn": "Kannada",
    "iu": "Inuktitut", "zu": "Zulu", "prg": "Old Prussian",
    "es-MX": "Mexican Spanish", "osp": "Old Spanish", "gmq-oda": "Old Danish",
    "cop": "Coptic", "ibl": "Ibaloi", "gmw-msc": "Middle Scots",
    "az": "Azerbaijani", "xpg": "Phrygian", "frk": "Frankish",
    "lad": "Ladino", "grk-pro": "Proto-Hellenic",
}
# Codes that name no origin language, each with the reason.
IGNORED_LANGS = {
    "en": "the page's own language; an English term is a word, not an origin",
    "mul": "translingual, a taxonomic or symbolic name rather than a language",
    "mul-tax": "a taxonomic name",
    "cmn-pinyin": "a romanization scheme, printed beside the Mandarin term",
    "cmn-wadegiles": "a romanization scheme",
    "cmn-tongyong": "a romanization scheme",
    "zh-postal": "a romanization scheme",
    "und": "an undetermined language",
    "qfa-sub": "an unnamed substrate language",
    "qfa-und": "an undetermined language",
}
RE_MULTI_CODE = re.compile(r",")


def lang_role(code: str) -> str:
    """One of root, pass, row, ignored, or "" for a code in no role."""
    if code in ROOT_LANGS:
        return "root"
    if code in PASS_LANGS:
        return "pass"
    if code in ROW_ONLY_LANGS:
        return "row"
    if code in IGNORED_LANGS or RE_MULTI_CODE.search(code):
        # "da,nb,nn,sv" is several codes in one argument, the shape of a
        # cognate list. A proto-language code names nothing attested.
        return "ignored"
    if code.endswith("-pro") or code in ("gem", "gmq", "gmw", "cel", "sla",
                                          "inc", "ira", "sem", "ine-ana",
                                          "roa", "itc", "grk", "inc-hnd"):
        return "ignored"
    return ""


def language_gate(counts):
    """Fail the build on a high-count language code in no role.

    `counts` is the census of language codes on origin and mention templates
    carrying an attested term. Returns the top table for the report.
    """
    top = [(c, n, lang_role(c) or "UNCLASSIFIED") for c, n in counts.most_common(40)]
    unknown = sorted(((n, c) for c, n in counts.items()
                      if n >= CENSUS_MIN and not lang_role(c)), reverse=True)
    if unknown:
        log("=========== LANGUAGE CENSUS FAILED =========")
        for n, c in unknown:
            log("  %8s  %s" % (format(n, ","), c))
        log("Every language code at or above %s uses must be a root, pass-"
            "through, row-only or ignored language in build.py. Classify the "
            "codes above, then rebuild." % format(CENSUS_MIN, ","))
        write_report()
        raise SystemExit("language census: %d unclassified code(s) at or "
                         "above %d uses" % (len(unknown), CENSUS_MIN))
    return top

RE_PART_MOD = re.compile(r"<[^>]*>")
RE_PART_BRACKET = re.compile(r"[<>]")
RE_PART_SECT = re.compile(r"#.*$")
RE_PART_LANG = re.compile(r"^[A-Za-z-]{2,15}:")


def clean_part(raw) -> str:
    """One positional arg of a decomposition template, as a display form.

    Three kinds of decoration ride along on these args and all three are
    real: inline modifiers (`terra<t:land>`), a section suffix
    (`to-#Etymology_2`), and a language prefix (`la:terra`). Modifiers are
    stripped first, because the language prefix regex would otherwise fire
    on the colon inside one.
    """
    p = (raw or "").strip()
    p = RE_PART_MOD.sub("", p)
    # Nested markup defeats the balanced strip above and leaves a bracket
    # behind ("milk<...<...>>" came through as "milk>"), so anything from the
    # first surviving bracket on is dropped. Markup, never source wording.
    p = RE_PART_BRACKET.split(p, 1)[0].strip()
    p = RE_PART_SECT.sub("", p)
    p = RE_PART_LANG.sub("", p)
    p = p.strip()
    if p in ("", "-", "*"):
        return ""
    if p.startswith("*"):
        return ""          # a reconstructed proto form is never a morpheme
    return p


# The etymology-tree wrappers. `ety` and `etymon` carry an identical arg
# layout, and Wiktionary uses them interchangeably: exportō records its split
# under `ety` while absolvō and resolvō record theirs under `etymon`. Reading
# only `ety` left absolvō looking undecomposable, so absolute shipped a single
# "From Latin absolvō" row while absolution beside it decomposed (owner field
# report 2026-08-25). Both are read on every pass, English included (owner
# ruling 2026-08-25).
ETY_NAMES = frozenset({"ety", "etymon"})

# ------------------------------------------------------- the census gate
#
# Every template name above CENSUS_MIN uses in the English extract has to be
# classified, either as one the pipeline reads or as one it deliberately
# ignores. A name in neither table fails the build. This exists because the
# `bor+` variant appeared in the source, nothing noticed, and 294 words lost
# their origin row silently. A new high-count name is now loud.
CENSUS_MIN = 1000       # uses of a name below this are not the build's problem

# The names the pipeline actually reads. Not a list: the union of the tables
# above, so it can never drift from them.
HARVESTED = DECOMP_NAMES | SURF_NAMES | ORIGIN_NAMES | ETY_NAMES

# The names the pipeline sees and passes over, each with the reason. Read off
# the census of the English extract (2026-09-01). Nothing here is a gap: every
# one states something this dictionary does not carry, or is markup. Two
# entries name templates the extract does not currently carry, `m` and `l`:
# only their `+` variants appear, and the plain names are listed beside them
# for the same reason the plain origin names are.
IGNORED = {
    "cog": "lists a cognate in a sister language, not an origin",
    "ncog": "a cognate again, in a language with no shared descent claim",
    "noncog": "an explicitly non-cognate lookalike, listed for contrast",
    "col-top": "opens the collapsible column the cognate list sits in",
    "glossary": "links a term to Wiktionary's glossary; the word is prose",
    "root": "states a PIE root, reconstructed, out of scope",
    "dercat": "adds derivation categories, carries no lemma of its own",
    "doublet": "names a word from the same source, a sibling not a parent",
    "dbt": "the short name of doublet",
    "piecewise doublet": "a doublet stated part by part, still a sibling",
    "blend": "two English words fused; the pieces are not morphemes",
    "clipping": "a shortening of one English word, no morpheme boundary",
    "calque": "a loan translation; the parts are the other language's",
    "coin": "names the person who invented the word",
    "coinage": "the long name of coin",
    "named-after": "names a person the word honours",
    "named-after/list": "the list form of named-after",
    "unk": "says the origin is unknown",
    "unc": "says the origin is uncertain",
    "onomatopoeic": "says the word imitates a sound; there is no source word",
    "back-form": "a word cut down from a longer one, not built from parts",
    "m": "a formatting link to a mention of a term",
    "m+": "the same link with the language name written out",
    "l": "a formatting link to an entry",
    "l+": "the same link with the language name written out",
    "lang": "prints a language-tagged string, usually a title or a name",
    "lg": "prints a language-tagged word inside another template's prose",
    "zh-l": "a formatting link to a Chinese entry",
    "translit": "prints a romanisation of a foreign spelling",
    "wp": "links the Wikipedia article",
    "taxlink": "links a taxonomic name",
    "taxfmt": "italicises a taxonomic name",
    "sense": "labels which sense the etymology paragraph is about",
    "senseno": "the same label written as a sense number",
    "etymid": "an internal id for one etymology section",
    "etydate": "the year of first attestation, not a source word",
    "sup": "renders a superscript character",
    "yesno": "normalises a yes/no parameter for another template",
    "nb...": "renders an ellipsis marking omitted quotation text",
    "!": "escapes a pipe character inside another template's markup",
    "nonlemma": "marks the page as a non-lemma form",
    "PIE word": "names the PIE word a root belongs to, reconstructed",
}


def census_gate(counts):
    """Fail the build on a high-count template name nobody has classified.

    Returns the top-30 table for the report. Raises when a name at or above
    CENSUS_MIN is in neither HARVESTED nor IGNORED, which means the source
    grew a template the pipeline has never been told what to do with.
    """
    def klass(name):
        if name in HARVESTED:
            return "HARVESTED"
        if name in IGNORED:
            return "ignored: " + IGNORED[name]
        return "UNCLASSIFIED"

    top = [(n, c, klass(n)) for n, c in counts.most_common(30)]
    unknown = sorted(((c, n) for n, c in counts.items()
                      if c >= CENSUS_MIN and n not in HARVESTED
                      and n not in IGNORED), reverse=True)
    if unknown:
        log("=========== TEMPLATE CENSUS FAILED =========")
        for c, n in unknown:
            log("  %8s  %s" % (format(c, ","), n))
        log("Every etymology template name at or above %s uses must be listed "
            "in HARVESTED or IGNORED in build.py. Classify the names above, "
            "then rebuild." % format(CENSUS_MIN, ","))
        write_report()
        raise SystemExit("template census: %d unclassified name(s) at or "
                         "above %d uses" % (len(unknown), CENSUS_MIN))
    return top


# Preference between templates on ONE entry, highest wins, first in source
# order breaks a tie. The order is a statement about what each template is
# for: a surface analysis is the reader-facing layer by definition, a plain
# decomposition is the analysis Wiktionary writes for a human, and the
# etymology tree is a derivation history that happens to carry the same
# shape. Ranking the tree last makes reading it strictly additive: it can
# give a split to an entry that had none, and it can never overrule one an
# editor wrote by hand.
PREFER_SURF = 2
PREFER_PLAIN = 1
PREFER_TREE = 0


def unwrap(t, wrappers=ETY_NAMES):
    """(kind, lang, args, first-part index, prefer) for a decomposition.

    Three shapes carry the same information in these extracts.
      plain    {{suffix|en|inform|ation}}   lang in arg 1, parts from arg 2
      ety      {{ety|la|:af|terra|-tōrium}} lang in arg 1, parts from arg 3
      surf +   {{surf|+suf|en|be|en}}       lang in arg 2, parts from arg 3
    `etymon` is the `ety` shape under another name; both are in ETY_NAMES.
    `prefer` is one of PREFER_SURF, PREFER_PLAIN, PREFER_TREE.
    """
    args = t.get("args") or {}
    name = t.get("name") or ""
    a1 = args.get("1") or ""
    if name in wrappers:
        a2 = args.get("2") or ""
        if a2.startswith(":") and a2[1:] in DECOMP_NAMES:
            return a2[1:], a1, args, 3, PREFER_TREE
        return None
    if name in SURF_NAMES and a1.startswith("+"):
        if a1[1:] in DECOMP_NAMES:
            return a1[1:], (args.get("2") or ""), args, 3, PREFER_SURF
        return None
    if name in DECOMP_NAMES:
        return name, a1, args, 2, (PREFER_SURF if name in SURF_NAMES
                                   else PREFER_PLAIN)
    return None


def template_parts(kind, args, base):
    """Positional args of a decomposition template, hyphens restored.

    The prefix and suffix templates leave the hyphen off the affix arg
    ({{suffix|en|inform|ation}} renders "inform + -ation"), so the display
    form has to be rebuilt here.
    """
    parts = []
    at = []
    i = base
    # A suffix template may leave the base out ({{suffix|en|3=al}} on
    # funereal renders "+ -al"): the affix arg still sits at its own index,
    # so the walk continues past a missing position (review finding 5).
    last = max((int(k) for k in args if k.isdigit()), default=0)
    while i <= last:
        raw = args.get(str(i)) or ""
        # An arg opening with a colon is a template selector (":af", ":der",
        # ":calque"), which means a nested etymon starts here: what follows
        # is a SECOND analysis of the word, not more parts of this one.
        # Without this stop, mammy read "mam + -y + :af + mamma + -y" and
        # confidential read "cōnfīdentia + -al + :calque + confidentiel".
        # Predates the English etymon ruling: 119 shipped splits carried the
        # artifact through the `ety` wrapper alone.
        if raw.strip().startswith(":"):
            break
        p = clean_part(raw)
        if p:
            parts.append(p)
            at.append(i)
        i += 1
    if not parts:
        return parts
    if kind in ("prefix", "pre", "confix") and not parts[0].endswith("-"):
        parts[0] = parts[0] + "-"
    # The suffix is any part past the base position, so an omitted base
    # still yields "-al" rather than "al".
    if kind in ("suffix", "suf", "confix") and at[-1] > base:
        if not parts[-1].startswith("-"):
            parts[-1] = "-" + parts[-1]
    return parts


def entry_split(e, lang, wrappers=ETY_NAMES):
    """The best decomposition on one entry, or None.

    Among several templates on the same entry the surface analysis wins;
    otherwise the first one in source order does.
    """
    best = None
    for t in e.get("etymology_templates") or []:
        u = unwrap(t, wrappers)
        if u is None:
            continue
        kind, tlang, args, base, prefer = u
        if tlang != lang:
            continue
        parts = template_parts(kind, args, base)
        if len(parts) < 2:
            continue
        if best is None or prefer > best[0]:
            best = (prefer, parts)
    return best[1] if best else None


def entry_chain(e):
    """(lang, lemma) of the LAST Latin or Greek origin template on an entry.

    Walking to the last one is what makes music reach Greek rather than
    stopping at the Latin step it passed through. Reconstructed forms are
    skipped, so a chain that only reaches Proto-Indo-European yields
    nothing.
    """
    hit = None
    for t in e.get("etymology_templates") or []:
        if t.get("name") not in ORIGIN_NAMES:
            continue
        args = t.get("args") or {}
        code = args.get("2") or ""
        lemma = (args.get("3") or "").strip()
        if not lemma or lemma in ("-", "*") or lemma.startswith("*"):
            continue
        lemma = RE_PART_MOD.sub("", lemma)
        lemma = RE_PART_SECT.sub("", lemma).strip()
        if not lemma:
            continue
        if code in LATIN_CODES:
            hit = ("la", lemma)
        elif code in GREEK_CODES:
            hit = ("grc", lemma)
    return hit


RE_ETY_ROOT_CODE = re.compile(r"(?:^|[<:\s|])(la|la-[a-z]+|grc|grc-koi|gkm|fro|fro-nor|frm|fr|xno):")


def names_classical(e):
    """True when an entry names a root or pass-through language term.

    The candidacy test for the tail (owner decision 2026-09-01, widened
    2026-09-05 to every mention): a superset of what attaches, since emit
    keeps only the words whose row decomposes. Cheap on purpose, it runs on
    every entry of pass 1.
    """
    for t in e.get("etymology_templates") or ():
        name = t.get("name") or ""
        args = t.get("args") or {}
        if name in ORIGIN_NAMES:
            code, term = args.get("2") or "", args.get("3") or ""
        elif name in MENTION_NAMES:
            code, term = args.get("1") or "", args.get("2") or ""
        elif name in ETY_NAMES or name in DECOMP_NAMES or name in SURF_NAMES:
            for v in args.values():
                if isinstance(v, str) and RE_ETY_ROOT_CODE.search(v):
                    return True
            continue
        else:
            continue
        term = term.strip()
        if term and term != "-" and not term.startswith("*") \
                and (code in ROOT_LANGS or code in PASS_LANGS):
            return True
    return False


def language_codes(e, counts):
    """Count the language codes on origin and mention templates that carry
    an attested term, for the language census."""
    for t in e.get("etymology_templates") or ():
        name = t.get("name") or ""
        args = t.get("args") or {}
        if name in ORIGIN_NAMES:
            code, term = args.get("2") or "", args.get("3") or ""
        elif name in MENTION_NAMES:
            code, term = args.get("1") or "", args.get("2") or ""
        else:
            continue
        term = term.strip()
        if code and term and term != "-" and not term.startswith("*"):
            counts[code] += 1


def pure_form_of(e):
    """The lemma this entry points at, when every sense is a form-of sense.

    Structural only: it answers "does this page define anything of its
    own", which is what decides whether the entry contributes senses. It
    does NOT decide a forms.json mapping. See inflection_form_of.
    """
    senses = e.get("senses") or []
    if not senses:
        return None
    target = None
    for s in senses:
        links = s.get("form_of") or s.get("alt_of")
        if not links:
            return None
        w = (links[0] or {}).get("word")
        if not w:
            return None
        if target is None:
            target = w
    return target


# The wiktextract tags that mark a sense as an INFLECTION of its lemma:
# number, tense, aspect and mood, person, degree. Enumerated from a tag census
# of the English extract (2026-08-24): every tagset above 1,000 senses is
# covered here. The tags left out are the ones that mark a derivation or a
# spelling relation rather than an inflection: agent, diminutive, feminine,
# attributive, morpheme, and the whole alt_of vocabulary (abbreviation,
# initialism, misspelling, pronunciation-spelling, alternative).
INFLECTION_TAGS = frozenset({
    "plural", "singular",
    "past", "present", "future",
    "participle", "gerund", "infinitive", "imperative", "subjunctive",
    "indicative", "perfect", "imperfect", "pluperfect",
    "first-person", "second-person", "third-person",
    "comparative", "superlative",
})


def inflection_form_of(e):
    """The lemma this entry inflects, or None.

    The only relation that may produce a forms.json row or a `fo` field.
    The page has to be a pure form-of page, no sense on it may be an
    `alt_of` link, and at least one sense has to be tagged as an
    inflection. The lemma comes from the first sense that is.

    An alt_of link never qualifies, whatever it is tagged. Without that
    test the abbreviation, initialism, eye-dialect and alternative-form
    pages of the extract all read as inflections, and they are the common
    short words: "the" pointed at thee, "a" at to, "of" at outfield, "it"
    at intrathecal, and "don't" redirected to done (review finding
    2026-08-24; 202 of the top 3,000 corpus tokens carried a mapping that
    this rule removed or corrected).

    One qualifying sense is enough, rather than all of them, because a
    plural page often carries a second sense that is not an inflection:
    "wives" is the plural of wife and the obsolete genitive of wife, and
    the commonest irregular plural in the language must not be lost to the
    second line.
    """
    senses = e.get("senses") or []
    if not senses:
        return None
    target = None
    for s in senses:
        links = s.get("form_of")
        if not links or s.get("alt_of"):
            return None
        if target is None and any(t in INFLECTION_TAGS
                                  for t in (s.get("tags") or ())):
            target = (links[0] or {}).get("word") or None
    return target


def mixed_inflections(e):
    """Inflection targets on a page that also defines lemma senses.

    The `fo` harvest reads senses here, not whole entries (SPEC, Jesse
    decision 2026-08-25). A page that mixes its own senses with
    inflection-tagged form_of senses is not a pure form-of page, so
    inflection_form_of refuses it, and the commonest shadow words in the
    language sat in that gap: is, had, going, people, teeth. 109 shipped
    words, 23 of them inside the top 3,000.

    Returns the targets in sense order. The caller takes the first one that
    is a different shipped word, so a page inflecting two lemmas (best is
    the superlative of good and of well) keeps the first. The same
    INFLECTION_TAGS filter guards this path, and an alt_of sense never
    feeds it.
    """
    senses = e.get("senses") or []
    if not senses:
        return ()
    if not any(not (s.get("form_of") or s.get("alt_of")) for s in senses):
        return ()          # a pure form-of page; the other harvest owns it
    out = []
    for s in senses:
        links = s.get("form_of")
        if not links or s.get("alt_of"):
            continue
        if not any(t in INFLECTION_TAGS for t in (s.get("tags") or ())):
            continue
        w = ((links[0] or {}).get("word") or "").lower()
        if w and w not in out and RE_WORD_KEY.match(w):
            out.append(w)
    return out


# The alternative-spelling exception (SPEC, Jesse decision 2026-08-25). An
# alt_of page reaches its lemma through forms.json when a sense says it is a
# spelling of that lemma and no excluded class applies. Both sets are read off
# a census of every alt_of sense on a pure form-of page in the English extract
# (2026-08-24): 92,150 senses carry `alternative`, 198 carry `standard`, and
# those are the only two tags that ever mean "this is how the word is spelled
# somewhere else".
ALT_SPELLING_TAGS = frozenset({"alternative", "standard"})
# The excluded classes, SPEC's list translated into the tags that carry them.
# Two notes from the census. Eye dialect has no tag of its own: wiktextract
# writes it as pronunciation-spelling ("of" is an eye-dialect page for have),
# so that one tag covers both SPEC classes. And acronym, clipping, ellipsis
# and misconstruction never co-occur with an accepted tag, so requiring one
# already excludes them; they are listed for the reader, not for the filter.
ALT_EXCLUDED_TAGS = frozenset({
    "misspelling", "misconstruction",
    "abbreviation", "initialism", "acronym", "clipping", "ellipsis",
    "pronunciation-spelling",
    "obsolete", "archaic", "dated",
})

# The gloss-prefix extension (SPEC, Jesse decision 2026-08-25). Wiktionary
# states the same relation in prose on pages wiktextract left untagged, so a
# gloss that OPENS with an explicit spelling statement qualifies on its own.
# The set below is the census of every such opening on an otherwise
# unqualified alt_of sense (2026-08-24): 9 phrases ending in "spelling", all
# accepted, and 10 of the 24 ending in "form", the ones naming a country or a
# standard.
#
# What is left out is the point of enumerating rather than pattern-matching:
#   letter-case (2,623 senses)  a case variant is not a spelling variant
#   early/late modern (18)      a period statement, and the exact shape that
#                               pointed "the" at thee before the review
#   dialect and language (14)   Geordie, Appalachia, Scotland, Russian, MLE:
#                               the same class as the acrost and fount pages
#                               that must never re-key a word
#   symbol, name, romanisation  not a spelling relation at all
ACCEPTED_GLOSS_PREFIXES = frozenset({
    "us spelling", "chiefly us spelling", "uk and us spelling",
    "non-oxford british english standard spelling",
    "rare spelling", "nonstandard spelling", "uncommon spelling",
    "now uncommon spelling", "informal spelling",
    "british form", "british english form", "uk form", "us form",
    "commonwealth form", "standard form", "nonstandard form",
    "north american english form", "oxford british english form",
    "non-oxford british english form",
})
# The openings that say a page is the AMERICAN spelling, which qualifies the
# pair for re-keying below. The head noun has to be "spelling", per the SPEC
# wording, and a phrase naming the other side too ("uk and us spelling") is
# not distinctly American. The census has only the first two; the rest are
# listed because the SPEC wording names them.
US_GLOSS_PREFIXES = frozenset({
    "us spelling", "chiefly us spelling", "us standard spelling",
    "american spelling", "american standard spelling",
})
RE_GLOSS_PREFIX = re.compile(r"^(.{0,70}?)\s+of\s")


def gloss_prefix(s) -> str:
    """The opening phrase of a sense gloss, up to its first " of "."""
    m = RE_GLOSS_PREFIX.match(clean_text((s.get("glosses") or [""])[0]))
    return m.group(1).lower() if m else ""


# US-primary re-keying (SPEC, Jesse decision 2026-08-25). A pointer page is
# the American form of its lemma when the same accepted spelling sense carries
# a US marker and Wiktionary's own `standard` tag. `standard` is what does the
# work: it is the tag the source uses for "this is the spelling in that
# country", and requiring it is the difference between 39 real pairs
# (favorite, catalog, traveler) and 126 that include Southern dialect and
# name spellings (fount for found, marshall for marshal). A page tagged for
# the other side of the Atlantic as well is not distinctly American.
# The census has no `American` tag, only `US`; both are named because the SPEC
# wording does.
US_TAGS = frozenset({"US", "American"})
US_STANDARD_TAG = "standard"
NON_US_TAGS = frozenset({"UK", "British", "Commonwealth", "Australia",
                         "New-Zealand", "Ireland", "India", "South-Africa"})


def is_us_standard(tags, prefix="") -> bool:
    """True when this sense marks the US standard spelling of its lemma.

    Either the tags say so, or the gloss opens by saying so in prose. A page
    tagged for the other side of the Atlantic is never distinctly American,
    whichever way it reads.
    """
    ts = set(tags or ())
    if ts & NON_US_TAGS:
        return False
    if US_STANDARD_TAG in ts and (ts & US_TAGS):
        return True
    return prefix in US_GLOSS_PREFIXES


def alt_spelling_of(e):
    """(lemma, tags, gloss prefix) of the first accepted spelling sense.

    A sense qualifies two ways: its tags say it is a spelling, or its gloss
    opens with a spelling statement in prose. The exclusion classes apply to
    both. The tags and the prefix come back with the lemma because the US
    re-key reads them.

    A forms.json row only, never a `fo` field: `fo` stays inflection-only.
    The page has to define nothing of its own, and one of its alt_of senses
    has to be tagged as a spelling without an excluded class. The lemma
    comes from the first sense that is.

    The tag test is what separates this from the wiring the inflection rule
    threw out. "the" is an alt_of page pointing at thee, but its sense is
    tagged Early Modern rather than alternative, so it is not a spelling of
    thee by this rule; "a" is a pronunciation spelling of to, "of" an
    abbreviation of outfield, and both classes are excluded outright.
    """
    senses = e.get("senses") or []
    if not senses:
        return None
    for s in senses:
        if not (s.get("alt_of") or s.get("form_of")):
            return None
    for s in senses:
        links = s.get("alt_of")
        if not links:
            continue
        tags = set(s.get("tags") or ())
        if tags & ALT_EXCLUDED_TAGS:
            continue
        prefix = gloss_prefix(s)
        if not (tags & ALT_SPELLING_TAGS) \
                and prefix not in ACCEPTED_GLOSS_PREFIXES:
            continue
        w = (links[0] or {}).get("word")
        if w:
            return w, tags, prefix
    return None


def best_gloss(e) -> str:
    """A root-card gloss for one entry, inside the card budget.

    The chip subtext is one short line, so the budget decides which sense
    gets the card. A sense that fits 80 characters wins outright; walking
    past the first sense matters, because nano- opens with a metric-prefix
    definition far too long for a card and -ite with a sentence about
    followers of a doctrine, while a later sense of each is a clean line.
    When no sense fits, a sense keeps its first clause instead, again in
    source order, and the 160 character safety cap decides which clause is
    usable rather than cutting one. Four suffixes (-ese, -or, pico- and the
    curated -ly) have no clause of the first sense inside the cap, so the
    walk continues past it or the card would be lost outright.
    ROOT_GLOSSES in curation.py overrides all of this.

    SPEC reads "the shortest sense at or under 80 characters". Source order
    is used instead of length (review 2026-08-24, reported to the owner):
    the shortest sense is a marginal one often enough to matter, and it
    contradicts the pinned la:terra anchor, whose gloss is sense 1 ("dry
    land", 8 characters) while the shortest is sense 5 ("earth").
    """
    lines = []
    for s in e.get("senses") or []:
        for raw in s.get("glosses") or []:
            g = gloss_line(raw)
            if g:
                lines.append(g)
    for g in lines:
        if len(g) <= ROOT_GLOSS_CARD:
            return g
    for g in lines:
        head = first_clause(g)
        if head and len(head) <= ROOT_GLOSS_MAX:
            return head
    return ""


# ---------------------------------------------------------------- frequency

def parse_ranks(path):
    """Word -> rank. First occurrence of each word-shaped token, 1-based.

    The token test is RE_WORD_KEY, the same shape words.json keys take. A
    narrower one here is not a filter, it is a hole: the rank drives the
    attestation gate, so a token the rank table cannot hold is a word that
    can never ship. This read ^[a-z]+$ until 2026-08-24, which barred every
    hyphenated word in the language: x-ray and t-shirt among 1,850 such
    tokens inside the top 50,000.
    """
    ranks = {}
    n = 0
    with io.open(path, encoding="utf-8", errors="replace") as f:
        for line in f:
            w = line.split(" ", 1)[0]
            if RE_WORD_KEY.match(w) and w not in ranks:
                n += 1
                ranks[w] = n
    return ranks


# ------------------------------------------------------- English pass 1

def survey_english(path, ranks):
    """First pass: who is a candidate, which forms map where, what affixes exist.

    Two things force two passes over this file. Entries for one word are
    not always contiguous (about 32 k words are interleaved with others),
    and the dominant-homograph rule needs to see every entry of a word
    before it can pick a split. So this pass only decides candidacy and
    harvests the tables that do not depend on it.

    The template-name census rides along here rather than in a pass of its
    own. It counts every etymology template name on every English entry,
    including the ones no rule reads, which is the point: census_gate needs
    the names the pipeline has never heard of.

    Returns the chain-only candidates beside the candidate set. Those are
    the words past RANK_CAP that no English-surface split nominates and a
    classical origin chain does. They are provisional: emit keeps the ones
    whose org row decomposes and drops the rest, and the set is what tells
    emit which words that rule may touch.
    """
    cand = set()
    chain_only = set()      # candidates nominated by a chain and nothing else
    forms_raw = {}
    alt_raw = {}
    us_raw = {}
    mixed_raw = {}
    affixes = {}
    tnames = collections.Counter()
    lcodes = collections.Counter()
    stats = collections.Counter()
    with gzip.open(path, "rb") as f:
        for line in f:
            stats["lines"] += 1
            if stats["lines"] % 250000 == 0:
                log("    %s lines ..." % format(stats["lines"], ","))
            e = loads(line)
            w = e.get("word")
            if not w:
                continue
            for t in e.get("etymology_templates") or ():
                n = t.get("name")
                if n:
                    tnames[n] += 1
            language_codes(e, lcodes)
            wl = w.lower()
            pos = e.get("pos") or ""
            fo = inflection_form_of(e)

            if pos in AFFIX_POS:
                # Form-of senses are not a reason to skip an affix page. A
                # combining form defines itself that way: every sense of
                # electro- reads "Combining form of electricity".
                ns = len(e.get("senses") or [])
                g = best_gloss(e)
                cur = affixes.get(wl)
                if g and (cur is None or ns > cur["ns"]):
                    affixes[wl] = {"ns": ns, "pos": pos, "gloss": g,
                                   "src": entry_chain(e)}
                continue

            if not RE_WORD_KEY.match(wl):
                continue

            # Three relations reach a lemma, and they are kept apart. An
            # inflection on a pure form-of page may become `fo` or a
            # forms.json row. An alternative spelling may only become a row.
            # An inflection sense on a page that also defines lemma senses
            # may only become `fo`, since the surface has a card of its own.
            # Nothing else maps at all.
            alt = None if fo else alt_spelling_of(e)
            if fo:
                t = fo.lower()
                if t != wl and RE_WORD_KEY.match(t) and wl not in forms_raw:
                    forms_raw[wl] = t
                    stats["formof"] += 1
            elif alt:
                lemma, tags, prefix = alt
                t = lemma.lower()
                if t != wl and RE_WORD_KEY.match(t) and wl not in alt_raw:
                    alt_raw[wl] = t
                    stats["altspell"] += 1
                    if not (tags & ALT_SPELLING_TAGS):
                        stats["altspell_gloss"] += 1
                    if is_us_standard(tags, prefix):
                        us_raw[wl] = t
                        stats["us_primary"] += 1
            else:
                for t in mixed_inflections(e):
                    if t == wl:
                        continue
                    seen = mixed_raw.setdefault(wl, [])
                    if t not in seen:
                        seen.append(t)
                        stats["mixed"] += 1

            # A word already nominated by a split, or by its rank, is
            # settled. A chain-only nomination is provisional, so a later
            # entry may still upgrade it to a split.
            if pos == "name" or (wl in cand and wl not in chain_only):
                continue
            r = ranks.get(wl)
            if r is None:
                # Corpus attestation is the outer edge of the dictionary.
                # See the cap note in main().
                continue
            if r <= RANK_CAP:
                cand.add(wl)
                chain_only.discard(wl)
                continue
            # A tail word only earns a card through its breakdown, so a
            # split that suppression will throw away does not make it a
            # candidate. This is a superset test: if the dominant entry
            # ends up carrying a real split, some entry does.
            sp = entry_split(e, "en")
            if sp is not None and sp[-1] not in INFLECTIONAL:
                if wl not in cand:
                    stats["tail_split"] += 1
                cand.add(wl)
                chain_only.discard(wl)
            elif wl not in cand and names_classical(e):
                # A flattenable classical origin is a breakdown too (owner
                # decision 2026-09-01). Whether this one flattens is not
                # knowable here: it depends on the dominant entry, on the
                # source graphs and on the anchor set, none of which pass 1
                # has. So the word becomes a candidate and emit drops it
                # again unless its org row decomposes.
                cand.add(wl)
                chain_only.add(wl)
                stats["tail_chain"] += 1
    # A forced split has to be harvested even when nothing else would have
    # nominated the word.
    cand |= set(curation.FORCED_SPLITS)
    chain_only -= set(curation.FORCED_SPLITS)
    return (cand, chain_only, forms_raw, alt_raw, us_raw, mixed_raw, affixes,
            tnames, lcodes, stats)


# ------------------------------------------------------- English pass 2

def harvest_english(path, cand, origin):
    """Second pass: senses, split and attachment for every candidate word.

    The split and the attachment both come from the dominant entry, meaning
    the non-name, non-form-of entry with the most senses. That is the rule
    that keeps `number` a count noun instead of numb + -er: the 17-sense
    entry wins and it carries no split at all. The attachment is computed
    here, while the entry is in hand, so the harvest keeps one small record
    per word rather than the entry's templates and prose.
    """
    out = {}
    stats = collections.Counter()
    with gzip.open(path, "rb") as f:
        for line in f:
            stats["lines"] += 1
            if stats["lines"] % 250000 == 0:
                log("    %s lines ..." % format(stats["lines"], ","))
            e = loads(line)
            w = e.get("word")
            if not w:
                continue
            wl = w.lower()
            if wl not in cand:
                continue
            if (e.get("pos") or "") == "name":
                continue
            if pure_form_of(e):
                continue
            defs = []
            for s in e.get("senses") or []:
                gl = s.get("glosses") or []
                if not gl or not gl[0]:
                    continue
                if s.get("form_of") or s.get("alt_of"):
                    continue
                d = clean_def(gl[0])
                if not d:
                    continue
                if len(d) > DEF_MAX_CHARS:
                    stats["dropped_long"] += 1
                    continue
                if d.endswith("…"):
                    # A handful of source glosses trail off mid-sentence.
                    # They read as truncation on a card, so they go.
                    stats["dropped_elided"] += 1
                    continue
                defs.append(d)
            if not defs:
                continue

            rec = out.get(wl)
            if rec is None:
                rec = {"pos": [], "defs": {}, "ns": -1, "sp": None,
                       "att": None}
                out[wl] = rec
            pos = e.get("pos") or "other"
            if pos not in rec["defs"]:
                if len(rec["pos"]) >= MAX_POS:
                    pos = None
                else:
                    rec["pos"].append(pos)
                    rec["defs"][pos] = []
            if pos is not None:
                bucket = rec["defs"][pos]
                for d in defs:
                    if len(bucket) >= MAX_DEFS:
                        break
                    if d not in bucket:
                        bucket.append(d)

            ns = len(e.get("senses") or [])
            if ns > rec["ns"]:
                rec["ns"] = ns
                rec["sp"] = entry_split(e, "en")
                mentions, chains = page_mentions(
                    e.get("etymology_templates") or [],
                    e.get("etymology_text") or "", "en", wl)
                # The page's homograph evidence: read once, used for this
                # attachment now and merged for the node's pick later.
                terms = page_evidence(e.get("etymology_templates") or [],
                                      e.get("etymology_text") or "", "en", wl)
                ev = origin.evidence_of(terms, mentions, def_words(defs[0]))
                origin.merge_evidence(ev, origin.ranks.get(wl))
                rec["att"] = origin.attach(mentions, chains, wl, ev)
                rec["cogonly"] = origin.cognate_only(mentions)
                if rec["att"] is not None:
                    stats["attached" if "key" in rec["att"] else
                          "rowonly" if "row" in rec["att"] else "missed"] += 1
    return out, stats


# ------------------------------------------------------- source graphs
#
# The origin subsystem is source-graph first (SPEC "Origin subsystem, source
# graphs", owner decisions 2026-09-05). Each root language is built as a
# standalone graph before any English page is read: a node is a glossed
# lemma with a display form and, for Greek, a romanization; a decomposition
# edge comes from the decomposition templates, from the etymon tree, or from
# the etymology prose; a step edge takes an inflection or participle page to
# its lemma. English words attach to the graph afterwards, by any mention.
#
# Everything below this banner up to the Origin class is the graph: the key
# lookup rules, the prose parser, the mention reader shared with the English
# and pass-through pages, and the graph builder with its own verification.

# The mention-shaped templates: a language code in arg 1 and a term in arg 2.
# `noncog` and `cog` are here so their terms are read at all: a cognate is
# still evidence about which homograph a page means, and Wiktionary editors
# write the odd ordinary mention with {{noncog}} ("equivalent to Latin manū +
# Latin scrīptus" on manuscript). The template's own name states its role
# (review finding 1, 2026-09-05): a term in one of COGNATE_NAMES is a
# cognate unless the prose writes "from" or "via" right before it and the
# sentence is an origin sentence. know, ride, straight, bush, soap and nut
# shipped a Latin or Greek row off their cognate lists before this rule.
MENTION_NAMES = frozenset({"m", "m+", "l", "l+", "mention", "link",
                           "cog", "ncog", "noncog", "cognate"})
COGNATE_NAMES = frozenset({"cog", "ncog", "noncog", "cognate"})

# A sentence that names a term as a relative rather than a source. The role
# of a mention is read off the sentence around it, never off the template
# name, and a term in one of these clauses is not an origin.
RE_STANCE_COGNATE = re.compile(
    r"\b(cognate\w*|compar\w*|cf\.?|akin|related|see also|more at|"
    r"whence|doublet\w*|displac\w*|replac\w*|supersed\w*|reinforc\w*|"
    r"influenc\w*|confus\w*|contaminat\w*|analog\w*|parallel\w*|"
    r"same source|correspond\w*|descendants?|also the source|"
    r"semantic loan|calque\w*|loan translation|eclips\w*|also from|"
    r"conflat\w*|associat\w*|modell?ed (?:after|on)|interpretation of|"
    r"translat(?:ion|ing) of|imitation of|rendering of|"
    r"equivalent to (?:the )?(?:modern|later|earlier))\b", re.I)
# A cue that rejects the term named AFTER it in the same sentence: "not from
# X", "rather than X", "by folk etymology from X", "a calque of X". Read
# positionally, because the sentence usually carries the real origin before
# the cue ("from Old Norse kaka, of disputed origin"; "from Latin commūnis,
# reinforced as a calque of ..."). Parentheses are blanked before the search,
# so a cue inside a gloss never fires (doubt: "to be uncertain").
RE_STANCE_HARD = re.compile(
    r"\b(not\s+from|not\s+derived\s+from|not\s+related\s+to|unrelated\s+to|"
    r"rather\s+than|instead\s+of|(?:by\s+|a\s+|the\s+)?folk[-\s]etymolog\w*|"
    r"false\s+etymolog\w*|mistaken\w*|erroneous\w*|incorrect\w*|wrongly|"
    r"corruption\s+of|no\s+relation\s+to|calque\w*\s+of|loan\s+translation\s+of|"
    r"semantic\s+loan\s+of|modell?ed\s+(?:after|on)|translation\s+of|"
    r"interpretation\s+of|imitation\s+of|rendering\s+of)\b", re.I)
# A short heading paragraph followed by bullets. "Cognates" keeps every
# bullet under it a cognate list however the bullets are worded ("from
# Proto-Germanic: Scots knaw"), and "theories" or "etymology" makes every
# bullet a rejected proposal rather than a stated origin (race).
RE_HEADING_REJECT = re.compile(r"\b(theor\w*|hypothes\w*|propos\w*|suggest\w*|"
                               r"etymolog\w*|origin\w*)\b", re.I)
# A sentence that states a source, which ends a cognate list's reach.
RE_STANCE_ORIGIN = re.compile(
    r"\b(from|borrow\w*|inherit\w*|deriv\w*|via|ultimately|calque\w*|"
    r"of \w+ origin)\b", re.I)
# A full stop that closes an abbreviation rather than a sentence.
RE_ABBREV = re.compile(
    r"(?:\b(?:e\.g|i\.e|cf|c|ca|etc|vs|viz|St|Mt|Dr|No|fl|al|ibid|op|cit|"
    r"s\.v|q\.v|approx|esp|lit|pl|sg|masc|fem|neut|nom|gen|acc|dat|abl|"
    r"[A-Z])|\d)\.$")
# A sentence that rejects the derivation it names. A prose split inside one
# is refused (SPEC Principle 1) and a mention inside one is no origin.
RE_STANCE_REJECT = re.compile(
    r"\b(not from|not derived|not related|unrelated|rather than|instead of|"
    r"folk etymolog\w*|false etymolog\w*|has been (?:wrongly|erroneously)|"
    r"mistakenly|incorrectly|no relation|is not|are not|does not derive|"
    r"problematic|doubtful|dubious|rejected|discredited|disputed|unlikely|"
    r"untenable|improbable)\b", re.I)

# Language names as the prose writes them, to the family a graph is keyed by
# or the code a row prints. Read off the spike's census of language names in
# etymology prose (2026-09-05).
LATIN_NAMES = {"Latin": "la", "Late Latin": "la", "Medieval Latin": "la",
               "New Latin": "la", "Vulgar Latin": "la", "Ecclesiastical Latin": "la",
               "Classical Latin": "la", "Mediaeval Latin": "la", "Renaissance Latin": "la",
               "Modern Latin": "la", "Scientific Latin": "la", "British Latin": "la",
               "Old Latin": "la"}
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
               "Old High German": "goh", "Middle High German": "gmh",
               "Hebrew": "he", "Arabic": "ar", "Sanskrit": "sa", "Portuguese": "pt",
               "Old Italian": "roa-oit", "Old Spanish": "osp", "Old Occitan": "pro",
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
               "Proto-Balto-Slavic": "ine-bsl-pro", "Gothic": "got", "Old Saxon": "osx",
               "Old Frisian": "ofs", "West Frisian": "fy", "Icelandic": "is",
               "Norwegian": "no", "Yiddish": "yi", "Polish": "pl", "Czech": "cs"}
LANG_NAMES = {}
# The longest language name a template expansion writes ahead of its term.
LANG_NAME_SPAN = 32
LANG_NAMES.update(OTHER_NAMES)
LANG_NAMES.update(LATIN_NAMES)
LANG_NAMES.update(GREEK_NAMES)
LANG_FIRST = {n.split(" ")[0] for n in LANG_NAMES}


def lang_family(code: str) -> str:
    """The graph a code belongs to (la, grc) or the code itself."""
    return ROOT_LANGS.get(code) or code


def row_key(code: str, term: str) -> str:
    """The key a term is compared under: the graph key for a root language,
    the lowercased form under its own code for any other."""
    fam = ROOT_LANGS.get(code)
    if fam:
        return fam + ":" + norm_for(fam, term)
    return code + ":" + (term or "").strip().lower()


def org_row_key(org) -> str:
    """The lemma key an emitted org row names, in the row_key shape."""
    if "parts" in org:
        return row_key(org["lang"], org["l"])
    if org.get("r"):
        return org["r"]
    return row_key(org.get("lang") or "", org.get("f") or "")


def norm_for(lang: str, s: str) -> str:
    if lang == "la":
        return la_key(s)
    if lang == "grc":
        return grc_key(s)
    return unicodedata.normalize("NFC", s or "").lower()


def is_greek(s: str) -> bool:
    return any("\u0370" <= c <= "\u03ff" or "\u1f00" <= c <= "\u1fff" for c in s)


RE_NON_LATIN = re.compile("[^\u0020-\u024f\u1e00-\u1eff\u2000-\u206f\u02b0-\u02ff\u0300-\u036f]")


def non_latin_script(s: str) -> bool:
    """True when the form carries a letter outside the Latin ranges."""
    return bool(RE_NON_LATIN.search(s or ""))


# ---- the etymology prose, with a rendered etymology tree removed ----------

RE_TREE_LINE = re.compile(r"^([A-Z][\w\-]*(?: [A-Z][\w\-]*)*) (\S.*)$")
PROSE_OPENERS = ("From ", "from ", "Borrowed", "Inherited", "Learned", "Ultimately",
                 "By surface", "Partly", "Probably", "Possibly", "Perhaps", "Uncertain",
                 "Unknown", "Compound", "Univerbation", "Equivalent", "First ", "Attested",
                 "Of ", "Named", "Coined", "Originally", "Either", "Semi-learned",
                 "Unadapted", "Back-formation", "Clipping", "Blend", "Derived", "Related",
                 "See ", "Compare", "The ", "A ", "An ", "Cognate", "Akin", "Formed")


def strip_tree(text, lang, key):
    """The prose of an etymology_text, with a rendered etymology tree removed.

    wiktextract renders the tree as one line per node ahead of the prose.
    The prose starts after the line naming the page itself, else after the
    last tree-shaped line.
    """
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
        if norm_for(lang, term) == key and m.group(1).split(" ")[0] in LANG_FIRST:
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


RE_SENT = re.compile(r"(?<=[.;])\s+(?=[A-Z“(])")


def sentence_spans(prose):
    """[(start, end, bullet)] of every sentence in the prose, paragraph by
    paragraph. A full stop closing an abbreviation ("e.g. Spanish por") does
    not end a sentence. `bullet` marks a list-item paragraph."""
    out = []
    pos = 0
    for para in prose.split("\n"):
        bullet = para.lstrip().startswith("*")
        seg = 0
        for m in RE_SENT.finditer(para):
            if RE_ABBREV.search(para[max(0, m.start() - 12):m.start()]):
                continue
            if m.start() > seg:
                out.append((pos + seg, pos + m.start(), bullet))
            seg = m.end()
        if len(para) > seg:
            out.append((pos + seg, pos + len(para), bullet))
        pos += len(para) + 1
    return out


def sentence_roles(prose, spans):
    """The stance of every sentence, in order.

    A sentence with a rejection or a cognate cue takes that role; a sentence
    with a source cue ("from", "borrowed") is an origin; any other sentence
    continues the role of the sentence before it inside its paragraph, so a
    cognate list that runs on for several sentences stays a cognate list.
    A list-item paragraph continues the paragraph above it, which is how
    "Cognates" followed by one bullet per language reads; any other new
    paragraph starts as an origin.
    """
    roles = []
    prev = "origin"
    last_end = 0
    heading = ""            # the role a heading fixes for the bullets under it
    for a, b, bullet in spans:
        new_para = prose[last_end:a].count("\n") > 0 if roles else False
        if new_para and not bullet:
            prev = "origin"
            heading = ""
        sent = prose[a:b]
        if not bullet and new_para or not roles:
            # A heading is a short paragraph with no full stop whose next
            # paragraph is a bullet.
            para_end = prose.find("\n", a)
            para = prose[a:para_end if para_end >= 0 else len(prose)].strip()
            nxt = prose[para_end + 1:para_end + 3] if para_end >= 0 else ""
            if len(para) <= 40 and "." not in para and nxt.lstrip().startswith("*"):
                if RE_STANCE_COGNATE.search(para):
                    heading = "cognate"
                elif RE_HEADING_REJECT.search(para):
                    heading = "reject"
        if RE_STANCE_REJECT.search(sent):
            r = "reject"
        elif bullet and heading:
            r = heading
        elif RE_STANCE_COGNATE.search(sent):
            r = "cognate"
        elif RE_STANCE_ORIGIN.search(sent):
            r = "origin"
        else:
            r = prev
        roles.append(r)
        prev = r
        last_end = b
    return roles


RE_PAREN_SPAN = re.compile(r"\([^()]*\)")


def blank_parens(s):
    """The text with every parenthesis group replaced by spaces, positions kept."""
    prev = None
    while prev != s:
        prev = s
        s = RE_PAREN_SPAN.sub(lambda m: " " * len(m.group(0)), s)
    return s


def hard_cue_before(sent, at):
    """True when a rejection or calque cue sits before offset `at` in the
    sentence, outside any parenthesis."""
    flat = blank_parens(sent[:at])
    return RE_STANCE_HARD.search(flat) is not None


RE_ORIGIN_CUE = re.compile(r"(?:\bfrom|\bvia|<|\bof|\bborrow(?:ed|ing) from|"
                           r"\bderived from|\bultimately from)\s*$", re.I)


def origin_cue_before(prose, at):
    """True when the text right before `at` is an origin cue ("from ", "via ")."""
    head = prose[max(0, at - 24):at]
    return RE_ORIGIN_CUE.search(head) is not None


def find_term(prose, raw, cursor):
    """Where a template's term sits in the prose as a whole word, from
    `cursor` on, or -1. The arg is taken as written, modifiers off."""
    t = RE_PART_MOD.sub("", (raw or "").strip()).strip()
    if len(t) < 3:
        return -1
    m = re.compile(r"(?<![\w\-])" + re.escape(t) + r"(?![\w\-])").search(prose, cursor)
    return m.start() if m else -1


# ---- the prose decomposition parser --------------------------------------
#
# The grammar the spike measured (pipeline/spike-origin.md, section 2). A
# sentence is tokenised into words and balanced parenthesis groups, so a plus
# inside a gloss never splits. Every " + " at depth zero joins the word before
# it (skipping its parentheses) to the word after it, and pluses chain. A
# term's language is the language name written before it, else the last
# language name at depth zero earlier in the sentence, else the page's
# mention templates, else Greek script means Ancient Greek, else the page's
# own language. A parenthesis after the head is scanned for a step ("ablative
# of X", "past participle of X", "frequentative of X", "diminutive of X") and
# so is a trailing appositive (", accusative of mons"). A Greek head's
# transliteration is skipped.

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
# The inflectional shapes only: the step EDGES of the graph come from these
# (SPEC Principle 1, "past participle of X", "ablative of X"), never from a
# frequentative or diminutive statement, which relates two lemmas.
RE_STEP_INFLECTION = re.compile(
    r"\b(participle|ablative|genitive|dative|accusative|nominative|vocative|"
    r"locative|plural|singular|infinitive|supine|gerundive|gerund|comparative|"
    r"superlative|inflection)\b[^()]{0,40}?\bof\s+(?:the\s+)?([^\s(),;“”\"]+)")
RE_TRANSLIT = re.compile(r"^[A-Za-zÀ-ɏḀ-ỿ̀-ͯ' ,\-‑\.]+?(?:,|$)")
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
    """The last language name mentioned at depth 0 before token i."""
    j = i
    while j > 0:
        code, n = lang_phrase_before(items, j)
        if code:
            return code
        j -= 1
    return None


class Term:
    """One term of a prose plus-chain: its head, language, step target and
    the gloss its parenthesis carries."""
    __slots__ = ("head", "lang", "explicit", "step", "target", "gloss")

    def __init__(self, head):
        self.head = head
        self.lang = None
        self.explicit = False
        self.step = None
        self.target = None
        self.gloss = ""


RE_QUOTED_GLOSS = re.compile(r"[“\"]([^”\"]{1,120})[”\"]")


def quoted_gloss(inner):
    """The quoted gloss inside a parenthesis, or ""."""
    m = RE_QUOTED_GLOSS.search(inner or "")
    return m.group(1).strip() if m else ""


def read_parens(term, items, i):
    """Attach the paren groups starting at item i to term. Returns the next index."""
    while i < len(items) and items[i][0] == "p":
        inner = items[i][1].strip()
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
        if not term.gloss:
            term.gloss = quoted_gloss(inner)
        i += 1
    return i


def read_trailing_step(term, items, i):
    """', accusative of mons' after a head: the appositive form of the step.

    Only the inflectional shapes count here. An appositive after the last
    term of a chain usually glosses the whole chain, not the term before
    the comma: ossuārium reads "from ossua + -ārius, alternative form of os",
    and stepping -ārius to os made the split ōs + ōs (review finding 4).
    """
    if term.target or i >= len(items):
        return
    prev = items[i - 1]
    if prev[0] == "w" and not prev[1].endswith(","):
        return
    window = []
    for t in items[i:i + 8]:
        if t[0] != "w":
            break
        window.append(t[1])
    m = RE_STEP_INFLECTION.search(" ".join(window))
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


# ---- the mention reader ---------------------------------------------------
#
# One reader for three kinds of page: the English page that attaches, the
# pass-through page a chain walks, and the source page whose prose the graph
# reads. It returns the ordered mentions of the page and the plus-chains of
# its prose.
#
# A mention is (kind, code, term, gloss, rom, role, pos):
#   kind   origin   an origin template (der, bor, inh and kin)
#          mention  a mention-shaped template (m+, l+, noncog, cog)
#          tree     a node of the etymon tree
#          part     a part of a decomposition template, or a chain term
#   role   origin, cognate or reject, read off the sentence the template
#          expands into; origin templates and tree nodes are origins by
#          construction, since the template itself is the claim.
#   pos    where the template expands in the prose, or -1 when unknown. A
#          plus-chain belongs to the last term named before it, and this is
#          how that term is found.

RE_LANG_PREFIX = re.compile(r"^([a-z][a-z0-9\-]{1,14}):(.*)$")


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


def parse_eterm(s, default_lang):
    """(lang, head, [(kind, [terms])]) for one etymon term with its nested tree."""
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
    return (lang, head.strip(), children)


ETY_DECOMP_KINDS = frozenset({"af", "affix", "afeq", "suf", "suffix", "pre", "prefix",
                              "com", "compound", "con", "confix", "univ",
                              "univerbation", "surf"})


def etymon_analyses(t, page_lang):
    """[(kind, [eterm])] for one ety/etymon template."""
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


def tree_mentions(eterm, out, kind="tree"):
    """Walk one etymon term depth first, appending mentions in chain order."""
    lang, head, children = eterm
    head = clean_part(head) or ""
    if head and head not in ("+", "-"):
        out.append((kind, lang, head, "", "", "origin", -1))
    for ckind, terms in children:
        if ckind in ETY_DECOMP_KINDS and len(terms) >= 2:
            for term in terms:
                tree_mentions(term, out, "part")
        else:
            for term in terms:
                tree_mentions(term, out, "tree")


def clean_gloss_arg(s) -> str:
    return clean_text(s).strip("“”\"' ")


RE_STEP_AFTER = re.compile(r"^[,;]?\s*(?:\(|the\s+)?(?:perfect |present |past |passive |active )*"
                           r"(participle|ablative|genitive|dative|accusative|nominative|"
                           r"vocative|infinitive|supine|plural|singular)\b[^()]{0,30}?"
                           r"\bof\s+(?:the\s+)?([^\s(),;“”\"]+)")


def prose_step(prose, pos, exp):
    """The lemma the prose steps a term to right after its mention.

    "from Latin appreciātus, past participle of appretiō" names appretiō as
    the next term of the chain, and the English page writes it with no
    template of its own. The step shapes are the inflectional ones only.
    """
    if pos < 0 or not exp:
        return ""
    tail = prose[pos + len(exp):pos + len(exp) + 90]
    m = RE_STEP_AFTER.match(tail)
    if not m:
        return ""
    tgt = clean_head(m.group(2))
    if not tgt or tgt.startswith("*") or tgt.lower() in STOP_HEADS:
        return ""
    return tgt


def paren_role(prose, at):
    """The stance of the parenthesis a position sits in, or ""."""
    depth = 0
    j = at - 1
    while j >= 0 and at - j < 400:
        c = prose[j]
        if c == ")":
            depth += 1
        elif c == "(":
            if depth == 0:
                inner = prose[j + 1:at]
                if RE_STANCE_REJECT.search(inner):
                    return "reject"
                if RE_STANCE_COGNATE.search(inner):
                    return "cognate"
                return ""
            depth -= 1
        elif c == "\n":
            return ""
        j -= 1
    return ""


def page_mentions(templates, text, page_lang, key):
    """(mentions, chains) for one page. See the banner above for the shapes.

    `chains` is the prose parser's output, [[Term, ...], ...], in sentence
    order, with each chain's sentence stance attached as the list's last
    element ("origin" or "reject").
    """
    prose = strip_tree(text or "", page_lang, key)
    spans = sentence_spans(prose)
    roles = sentence_roles(prose, spans)

    def role_at(pos):
        for (a, b, _), r in zip(spans, roles):
            if a <= pos < b:
                inner = paren_role(prose, pos)
                if inner:
                    return inner
                if hard_cue_before(prose[a:b], pos - a):
                    return "reject"
                return r
        return "origin"

    def rejected_at(pos):
        """The positional stance only: a hard cue before the term in its
        sentence, or a rejection or cognate paren around it. This is what an
        origin template answers to, since the template itself is the claim
        and only an explicit rejection or calque cue can undo it."""
        for (a, b, bullet), r in zip(spans, roles):
            if a <= pos < b:
                if paren_role(prose, pos):
                    return True
                if bullet and r == "reject":
                    # A bullet that rejects, or sits under a "theories"
                    # heading, is a listed proposal, not a stated origin.
                    return True
                return hard_cue_before(prose[a:b], pos - a)
        return False

    mentions = []
    cursor = 0
    for t in templates or ():
        name = t.get("name") or ""
        args = t.get("args") or {}
        if name in ORIGIN_NAMES:
            code = args.get("2") or ""
            term = clean_part(args.get("3") or "")
            raw = (args.get("3") or "").strip()
            if raw.startswith("*"):
                term = "*" + (clean_part(raw[1:]) or "")
            if not code or not term or term == "-":
                continue
            gloss = clean_gloss_arg(args.get("t") or args.get("5") or args.get("gloss") or "")
            rom = clean_text(args.get("tr") or "")
            exp = t.get("expansion") or ""
            pos = -1
            role = "origin"
            if exp:
                at = prose.find(exp, cursor)
                if at < 0:
                    # The expansion misses when the gloss quotes differ
                    # from the prose (mediocris) or the alt form carries a
                    # hyphen (compāniōn-); the term itself, as written, is
                    # still there, and its position is what decides which
                    # chain it owns (review finding 5).
                    at = find_term(prose, args.get("4") or raw, cursor)
                    if at < 0:
                        at = find_term(prose, args.get("4") or raw, 0)
                if at >= 0:
                    cursor = at
                    pos = at
                    if rejected_at(at):
                        role = "reject"
            mentions.append(("origin", code, term, gloss, rom, role, pos))
            stepped = prose_step(prose, pos, exp) if role == "origin" else ""
            if stepped:
                mentions.append(("mention", code, stepped, "", "", "origin", pos + 1))
            continue
        if name in MENTION_NAMES:
            code = args.get("1") or ""
            term = clean_part(args.get("2") or "")
            raw = (args.get("2") or "").strip()
            if raw.startswith("*"):
                term = "*" + (clean_part(raw[1:]) or "")
            if not code or not term or term == "-":
                continue
            gloss = clean_gloss_arg(args.get("t") or args.get("4") or args.get("gloss") or "")
            rom = clean_text(args.get("tr") or "")
            role = "cognate" if name in COGNATE_NAMES else "origin"
            exp = t.get("expansion") or ""
            pos = -1
            if exp:
                at = prose.find(exp, cursor)
                if at < 0:
                    at = prose.find(exp)
                if at >= 0:
                    cursor = at
                    pos = at
                    if name in COGNATE_NAMES:
                        # The template name is the role. The one exception is
                        # a cognate-family template written where the prose
                        # states a source ("from Latin strictus"), and only
                        # in a sentence that is itself an origin sentence.
                        if origin_cue_before(prose, at) and role_at(at) == "origin":
                            role = "origin"
                    else:
                        role = role_at(at)
            mentions.append(("mention", code, term, gloss, rom, role, pos))
            if role == "origin":
                stepped = prose_step(prose, pos, exp)
                if stepped:
                    mentions.append(("mention", code, stepped, "", "", "origin", pos + 1))
            continue
        u = unwrap(t)
        if u is not None:
            kind, tlang, targs, base, prefer = u
            # The template's expansion ("de- + portāre") sits in the prose
            # like any other, and the position is what says which term the
            # parts belong to (review finding 5, 2026-09-05): sport writes
            # "from Latin deportāre, from de- + portāre".
            exp = t.get("expansion") or ""
            pos = -1
            if exp and not exp.startswith("Etymology tree"):
                at = prose.find(exp, cursor)
                if at < 0:
                    at = prose.find(exp)
                if at >= 0:
                    cursor = at
                    pos = at
            for p in template_parts(kind, targs, base):
                mentions.append(("part", tlang, p, "", "", "origin", pos))
            continue
        if name in ETY_NAMES:
            tlang, analyses = etymon_analyses(t, page_lang)
            for akind, terms in analyses:
                if akind in ETY_DECOMP_KINDS and len(terms) >= 2:
                    for term in terms:
                        tree_mentions(term, mentions, "part")
                else:
                    for term in terms:
                        tree_mentions(term, mentions, "tree")

    chains = []
    if " + " in prose:
        for (a, b, _), r in zip(spans, roles):
            sent = prose[a:b]
            if " + " not in sent:
                continue
            for chain in parse_chains(sent):
                if len(chain) >= 2:
                    at = sent.find(chain[0].head)
                    chains.append((chain, r, a + (at if at >= 0 else 0)))
    return mentions, chains


# ---- homograph evidence on an English page --------------------------------
#
# What an English page says about WHICH homograph of a source lemma it means
# (review findings 2 and 3, 2026-09-05). Four kinds of evidence, in the
# order the rules read them: the gloss, pos or alt form a template or the
# prose writes beside the term (rule a); the parts the page itself names
# (rule b); the word's first definition (rule c). Sense count decides only
# when none of these does (rule d).

RE_AFTER_GLOSS = re.compile(r"^\s*\((?:[^()“\"]{0,40}[,;]\s*)?[“\"]([^”\"]{1,120})[”\"]")
RE_LA_INFINITIVE = re.compile(r"(āre|ēre|ere|īre|ārī|ērī|īrī|ī)$")
POS_NAMES = {"adjective": "adj", "adj": "adj", "noun": "noun", "verb": "verb",
             "adverb": "adv", "adv": "adv", "participle": "verb", "pronoun": "pron",
             "proper noun": "name", "name": "name", "numeral": "num", "particle": "particle",
             "preposition": "prep", "conjunction": "conj", "interjection": "intj"}


def gloss_after(prose, pos, exp):
    """The quoted gloss the prose writes right after a template's expansion,
    when the template itself carries none ("Latin iūstus (“just, lawful”)")."""
    if pos < 0 or not exp:
        return ""
    m = RE_AFTER_GLOSS.match(prose[pos + len(exp):pos + len(exp) + 160])
    return m.group(1).strip() if m else ""


def page_evidence(templates, text, page_lang, key):
    """[(code, term, alt, gloss, pos)] for every term a page names with a
    root-language code, plus [(code, term)] for the plain-prose terms the
    page glosses ("from iūs (“right”)" with no template)."""
    prose = strip_tree(text or "", page_lang, key)
    out = []
    cursor = 0
    for t in templates or ():
        name = t.get("name") or ""
        args = t.get("args") or {}
        exp = t.get("expansion") or ""
        if name in ORIGIN_NAMES:
            code, term, alt = args.get("2") or "", args.get("3") or "", args.get("4") or ""
            gloss = args.get("t") or args.get("5") or args.get("gloss") or ""
        elif name in MENTION_NAMES:
            code, term, alt = args.get("1") or "", args.get("2") or "", args.get("3") or ""
            gloss = args.get("t") or args.get("4") or args.get("gloss") or ""
        else:
            u = unwrap(t)
            if u is not None:
                kind, tlang, targs, base, prefer = u
                if tlang in ROOT_LANGS:
                    i = base
                    n = 1
                    while str(i) in targs:
                        raw = targs[str(i)] or ""
                        if raw.strip().startswith(":"):
                            break
                        p = clean_part(raw)
                        if p:
                            out.append((tlang, p, "", part_gloss(raw, targs, n), ""))
                            n += 1
                        i += 1
            continue
        if code not in ROOT_LANGS:
            continue
        term = clean_part(term)
        if not term or term == "-" or term.startswith("*"):
            continue
        pos = -1
        if exp:
            at = prose.find(exp, cursor)
            if at >= 0:
                cursor = at
                pos = at
        gloss = clean_gloss_arg(gloss) or gloss_after(prose, pos, exp)
        out.append((code, term, clean_part(alt), gloss, (args.get("pos") or "").strip().lower()))
    # Plain-prose terms with a gloss: a word token followed by a quoted
    # parenthesis, its language the name before it or the last name at
    # depth zero ("from Latin iūstitia (“righteousness”), from iūstus
    # (“just”), from iūs (“right”)" glosses all three).
    if "(“" in prose or '("' in prose:
        for a, b, _ in sentence_spans(prose):
            items = tokenize(prose[a:b])
            for i in range(len(items) - 1):
                if items[i][0] != "w" or items[i + 1][0] != "p":
                    continue
                head = clean_head(items[i][1])
                if not head or head.lower() in STOP_HEADS or not any(c.isalpha() for c in head):
                    continue
                if head.startswith("*") or head[0].isupper() and not is_greek(head):
                    continue
                gl = quoted_gloss(items[i + 1][1])
                if not gl:
                    continue
                code, _ = lang_phrase_before(items, i)
                if code is None:
                    code = recent_lang(items, i)
                if code is None and is_greek(head):
                    code = "grc"
                if code in ROOT_LANGS:
                    out.append((code, head, "", gl, ""))
    return out


# ---- the graph ------------------------------------------------------------

class Graph:
    """One root language: nodes, decomposition edges, step edges, lookups.

    Built by parse_classical and verified there. The lookup rules (SPEC
    Principle 1, measured in the spike's section 3) apply to every chain
    lemma and every split part before any other rule:
      1. the template arg is cleaned: trailing punctuation, one of a//b,
         inline modifiers and section suffixes;
      2. the key is normalised (Latin: macrons off; Greek: vowel-length
         marks off, accents and breathings kept);
      3. a key that is no page at all matches loosely, every combining mark
         stripped, preferring a glossed lemma among the pages that share the
         loose spelling;
      4. a form-of page steps to its lemma, and the step repeats when the
         target is itself a form-of page, LEMMA_STEPS winning over the
         extract at every hop.
    An alternative-form page (alt_of, no inflection) is not a lemma and is
    not stepped through by default: it exists as a spelling, not as a node,
    and a word that names one attaches through some other mention (sock
    names Greek σύκχος, a spelling of συγχίς, and attaches to Latin soccus).
    The alt_ok flag turns the step on: for every split part, and for the
    fallback pass of the attachment when the strict pass finds nothing.
    """

    def __init__(self, lang):
        self.lang = lang
        self.gloss = {}          # key -> gloss (the card's)
        self.cands = {}          # key -> [Entry], the lemma entries of the page
        self.esplit = {}         # key -> [split or None], one per entry
        self.part_hints = {}     # key -> Counter of gloss words pages give it as a part
        self.form = {}
        self.pos = {}
        self.rom = {}
        self.titles = set()
        self.fo = {}             # inflection and participle steps
        self.alt = {}            # alternative-form pages
        self.step = {}           # the merged step edges, curation winning
        self.split = {}          # key -> [(form, part key)], resolved
        self.split_src = {}      # key -> template | etymon | prose
        self.refused = {}        # key -> reason a split was refused
        self.prose_unread = set()
        self.marks_idx = {}
        self.stats = collections.Counter()

    # -- lookups -----------------------------------------------------------

    def is_node(self, key):
        return key in self.gloss

    def clean_term(self, s):
        t = (s or "").strip()
        t = RE_PART_MOD.sub("", t)
        t = RE_PART_SECT.sub("", t).strip()
        t = t.rstrip(",.;:")
        if "//" in t:
            t = t.split("//", 1)[0].strip()
        return t

    def loose(self, key):
        """A page sharing the key's loose spelling, glossed ones first."""
        hits = self.marks_idx.get(strip_marks(key))
        if not hits:
            return None
        for h in hits:
            if h in self.gloss:
                return h
        return hits[0]

    def lookup(self, term, alt_ok=False):
        """(key, first key) for a term, or (None, first key) when nothing lands.

        The first key is the strict key of the term as written, recorded as
        an alias on the card the lookup lands on when the two differ.
        """
        t = self.clean_term(term)
        if not t or t.startswith("*"):
            return None, ""
        key = norm_for(self.lang, t)
        first = key
        if not key:
            return None, ""
        if key not in self.titles:
            alt = self.loose(key)
            if alt is None:
                return None, first
            key = alt
        for _ in range(4):
            if self.is_node(key) or key in self.split:
                curated = curation.LEMMA_STEPS.get(self.lang + ":" + key)
                if curated:
                    key = curated.split(":", 1)[1]
                    continue
                return key, first
            nxt = curation.LEMMA_STEPS.get(self.lang + ":" + key)
            if nxt:
                key = nxt.split(":", 1)[1]
                continue
            nxt = self.step.get(key)
            if nxt is None and alt_ok:
                nxt = self.alt.get(key)
            if nxt is None or nxt == key:
                return None, first
            key = nxt
        return None, first

    def decomposes(self, key):
        return key in self.split


RE_PARTICIPLE_HEAD = re.compile(r"^(la-part|grc-part)")
DISTINCT_FORM_TAGS = frozenset({"canonical", "infinitive", "supine"})


class Entry:
    """One lemma entry of a source page, a candidate for the page's node.

    A page with several lemma entries (fundō "to pour" and fundō "to
    found") keeps every one, and the node picks one entry by evidence
    after the English pages have attached (review findings 2 and 3,
    2026-09-05): the split, the label and the gloss come from that one
    entry. `forms` holds the distinguishing forms (canonical, infinitive,
    supine) a mention can name, "fundāre" against "fundere".
    """
    __slots__ = ("weight", "gloss", "form", "pos", "rom", "words", "forms",
                 "parts", "src", "prose", "pglosses", "order")

    def __init__(self, weight, gloss, form, pos, rom, words, forms, parts, src,
                 prose, pglosses, order):
        self.weight = weight
        self.gloss = gloss
        self.form = form
        self.pos = pos
        self.rom = rom
        self.words = words
        self.forms = forms
        self.parts = parts
        self.src = src
        self.prose = prose
        self.pglosses = pglosses
        self.order = order


RE_INLINE_GLOSS = re.compile(r"<t:([^<>]*)>")
RE_INLINE_ID = re.compile(r"<id:([^<>]*)>")


def part_gloss(raw, args, n):
    """The gloss a decomposition template gives its n-th part: the inline
    <t:...> modifier, the tN or glossN arg, and the <id:...> sense id, which
    names the sense in a word or two ("pure", "to collect")."""
    bits = []
    m = RE_INLINE_GLOSS.search(raw)
    if m:
        bits.append(m.group(1))
    else:
        bits.append(args.get("t%d" % n) or args.get("gloss%d" % n) or "")
    m = RE_INLINE_ID.search(raw)
    if m:
        bits.append(m.group(1))
    return clean_gloss_arg(" ".join(b for b in bits if b))


def entry_part_glosses(e, lang, wrappers=ETY_NAMES):
    """[(part, gloss)] of the decomposition template entry_split picks,
    with the glosses the entry's other templates give the same parts
    merged in (putō: the plain template says <t:clean>, the etymon
    <id:pure>)."""
    best = None
    others = {}
    for t in e.get("etymology_templates") or []:
        u = unwrap(t, wrappers)
        if u is None:
            continue
        kind, tlang, args, base, prefer = u
        if tlang != lang:
            continue
        out = []
        i = base
        n = 1
        while str(i) in args:
            raw = args[str(i)] or ""
            if raw.strip().startswith(":"):
                break
            p = clean_part(raw)
            if p:
                out.append((p, part_gloss(raw, args, n)))
                n += 1
            i += 1
        if len(out) < 2:
            continue
        for p, gl in out:
            if gl:
                others[p] = (others.get(p, "") + " " + gl).strip()
        if best is None or prefer > best[0]:
            best = (prefer, out)
    if not best:
        return []
    return [(p, others.get(p, gl)) for p, gl in best[1]]


def entry_forms(e):
    """The distinguishing forms of an entry, lowercased NFC."""
    out = set()
    for f in e.get("forms") or []:
        tags = f.get("tags") or []
        if any(t in DISTINCT_FORM_TAGS for t in tags):
            v = (f.get("form") or "").strip()
            if v and " " not in v and v != "-":
                out.add(unicodedata.normalize("NFC", v).lower())
    return out


def parse_classical(path, lang):
    """One streaming pass over the Latin or Ancient Greek extract, then the graph.

    Streaming collects, per page key: the glossed lemma entries (every
    candidate gloss, since a homograph's card gloss is chosen later with
    the attaching words' own glosses as support), the inflection step, the
    alternative-form step, the participle step from the etymon or the
    prose, the first template split, and the prose of a page that has a
    plus and no template split. The graph is assembled afterwards, when
    every title is known and the lookup rules can resolve a part.
    """
    g = Graph(lang)
    part_steps = {}
    order = 0
    with gzip.open(path, "rb") as f:
        for line in f:
            g.stats["lines"] += 1
            e = loads(line)
            w = e.get("word")
            if not w:
                continue
            k = norm_key(lang, w)
            if not k:
                continue
            g.titles.add(k)
            pos = e.get("pos") or ""
            senses = e.get("senses") or []
            t = pure_form_of(e)
            if t:
                tk = norm_key(lang, t)
                has_form = any(s.get("form_of") for s in senses)
                if tk and tk != k:
                    if has_form:
                        if k not in g.fo:
                            g.fo[k] = tk
                    elif k not in g.alt:
                        g.alt[k] = tk
                continue
            ns = len(senses)
            gl = best_gloss(e)
            head = ((e.get("head_templates") or [{}])[0].get("name") or "")
            weight = ns if pos != "name" else -1000 + ns
            if gl:
                # A proper-noun entry only supplies a gloss when nothing else
                # does. Μοῦσα is a name page and the only gloss Greek has.
                # Every entry keeps its own split and prose: the node picks
                # one entry later, by evidence (review findings 2 and 3).
                words = set()
                for s in senses:
                    for raw in s.get("glosses") or []:
                        words.update(RE_GLOSS_WORD.findall((raw or "").lower()))
                r = tagged_form(e, "romanization") if lang == "grc" else ""
                parts = entry_split(e, lang)
                src = "etymon"
                for tt in e.get("etymology_templates") or ():
                    if tt.get("name") in DECOMP_NAMES or tt.get("name") in SURF_NAMES:
                        src = "template"
                        break
                text = e.get("etymology_text") or ""
                prose = strip_tree(text, lang, k) if " + " in text else ""
                order += 1
                g.cands.setdefault(k, []).append(Entry(
                    weight, gl, display_form(e, w, lang, k), pos, r, words,
                    entry_forms(e), parts if parts and len(parts) >= 2 else None,
                    src, (e.get("etymology_templates") or [], text)
                    if " + " in prose else None,
                    entry_part_glosses(e, lang) if parts else [], order))
            # A participle page with a gloss of its own is a lemma page to
            # the parser; its step comes from the etymon's ":from" text or
            # from the prose ("Present active participle of dēpōnō").
            if RE_PARTICIPLE_HEAD.match(head) and k not in part_steps:
                tgt = participle_step(e)
                if tgt:
                    tk = norm_key(lang, tgt)
                    if tk and tk != k:
                        part_steps[k] = tk
    build_graph(g, part_steps)
    return g


RE_GLOSS_WORD = re.compile(r"[a-z]{3,}")


def participle_step(e):
    """The lemma a participle page names, from its etymon or its prose."""
    for t in e.get("etymology_templates") or ():
        if t.get("name") not in ETY_NAMES:
            continue
        args = t.get("args") or {}
        a2 = (args.get("2") or "")
        if a2.startswith(":from<text:") and "articiple of" in a2:
            tgt = clean_part(args.get("3") or "")
            if tgt:
                return tgt
    text = e.get("etymology_text") or ""
    if text.startswith("Etymology tree"):
        text = strip_tree(text, "la", "")
    m = RE_STEP_INFLECTION.search(text[:200])
    if m and "participle" in m.group(1):
        tgt = clean_head(m.group(2))
        if tgt and not tgt.startswith("*"):
            return tgt
    return ""


def build_graph(g, part_steps):
    """Assemble and verify one graph from what the streaming pass collected."""
    lang = g.lang
    # ---- nodes: the default entry is the one with the most senses ---------
    # Ties keep extract order. The default stands until the English pages
    # have attached and apply_entry() picks an entry by evidence.
    for k, cands in g.cands.items():
        cands.sort(key=lambda c: (-c.weight, c.order))
        c = cands[0]
        g.gloss[k] = c.gloss
        g.form[k] = c.form
        g.pos[k] = c.pos
        if c.rom:
            g.rom[k] = c.rom
    # ---- the loose index ---------------------------------------------------
    idx = collections.defaultdict(list)
    for k in g.titles:
        idx[strip_marks(k)].append(k)
    g.marks_idx = {m: sorted(ks) for m, ks in idx.items()}
    # ---- step edges: form_of, then participle heads, then LEMMA_STEPS ------
    for k, tk in g.fo.items():
        g.step[k] = tk
    for k, tk in part_steps.items():
        if k not in g.step:
            g.step[k] = tk
    for src, dst in curation.LEMMA_STEPS.items():
        sl, sk = src.split(":", 1)
        if sl == lang:
            g.step[sk] = dst.split(":", 1)[1]
    g.stats["steps"] = len(g.step)
    g.stats["alt_pages"] = len(g.alt)

    # ---- decomposition edges from templates and the etymon tree -----------
    def resolve_parts(k, raw_parts):
        """[(form, key)] or a refusal reason string."""
        out = []
        for p in raw_parts:
            if p.startswith("*"):
                return "reconstructed part %s" % p
            pk, _ = g.lookup(p, alt_ok=True)
            if pk is None:
                first = norm_for(lang, g.clean_term(p))
                if first in g.titles:
                    return "part %s has a page with no usable gloss" % p
                return "part %s has no page" % p
            if pk == k:
                return "self-part split (%s names itself)" % p
            out.append((g.form.get(pk) or g.clean_term(p), pk))
        return out

    # A curated edge wins over the page (SOURCE_SPLITS, the root languages'
    # FORCED_SPLITS). It is resolved through the same lookup as a template
    # part, so a curated part that names no page is as loud as any other.
    curated = set()
    for src_key, parts in curation.SOURCE_SPLITS.items():
        sl, sk = src_key.split(":", 1)
        if sl != lang:
            continue
        if sk not in g.gloss:
            raise SystemExit("SOURCE_SPLITS names %s, which is no node" % src_key)
        res = resolve_parts(sk, parts)
        if isinstance(res, str):
            raise SystemExit("SOURCE_SPLITS %s: %s" % (src_key, res))
        g.split[sk] = res
        g.split_src[sk] = "template"
        g.esplit[sk] = [res] * len(g.cands[sk])
        curated.add(sk)
        g.stats["split_curated"] += 1

    def prose_split(k, templates, text):
        """(split or None, refusal reason) from one entry's prose."""
        mentions, chains = page_mentions(templates, text, lang, k)
        tl = {}
        for kind, code, term, _, _, _, _ in mentions:
            fam = lang_family(code)
            tk = norm_for(lang, term)
            if tk:
                tl.setdefault(tk, fam)
        why = ""
        for chain, stance, _ in chains:
            if stance == "reject":
                why = why or "rejection stance"
                continue
            res = resolve_chain(g, chain, lang, tl, k)
            if isinstance(res, str):
                why = why or res
                continue
            # A part's gloss in the prose ("manu (ablative of manus)" says
            # nothing, "iūs (“law, right”) + -tus" does) is evidence about
            # which homograph the part names.
            for term, (_, pk) in zip(chain, res):
                if term.gloss:
                    add_hint(g.part_hints, pk, term.gloss)
            return res, ""
        return None, why

    # Every entry of every node resolves its own split, template first and
    # prose after, so the entry the node picks later carries its split with
    # it. The default entry's outcome is the graph's until then.
    for k in sorted(g.cands):
        if k in curated:
            continue
        cands = g.cands[k]
        splits = []
        for i, c in enumerate(cands):
            res = None
            why = ""
            src = c.src
            if c.parts:
                r = resolve_parts(k, c.parts)
                if isinstance(r, str):
                    why = r
                else:
                    res = r
                    for (p, gl), (_, pk) in zip(c.pglosses, r):
                        if gl:
                            add_hint(g.part_hints, pk, gl)
            if res is None and c.prose:
                r, w2 = prose_split(k, c.prose[0], c.prose[1])
                if r:
                    res = r
                    src = "prose"
                else:
                    why = why or (("prose: " + w2) if w2 else "")
            splits.append(res)
            if i == 0:
                if res:
                    g.split[k] = res
                    g.split_src[k] = src
                    g.stats["split_" + src] += 1
                else:
                    if c.parts:
                        g.refused[k] = why
                        g.stats["refused_" + c.src] += 1
                    elif c.prose:
                        g.prose_unread.add(k)
                        if why:
                            g.refused.setdefault(k, why)
        g.esplit[k] = splits

    # ---- verification: no cycles, no dangling edge -------------------------
    dangling = [(k, pk) for k, ps in g.split.items() for _, pk in ps
                if pk not in g.gloss]
    if dangling:
        raise SystemExit("%s graph: %d dangling edges, e.g. %s"
                         % (lang, len(dangling), dangling[:3]))
    refuse_cycles(g)
    g.stats["nodes"] = len(g.gloss)
    g.stats["decomposed"] = len(g.split)
    g.stats["prose_unread"] = len(g.prose_unread)
    return g


def add_hint(table, key, gloss):
    """Record one source page's gloss of `key` as a part: one vote, a set
    of content words."""
    words = {w for w in RE_GLOSS_WORD.findall((gloss or "").lower())
             if w not in GLOSS_STOP}
    if words:
        table.setdefault(key, []).append(words)


def def_words(d):
    """The content words of a definition, for rule c."""
    return {w for w in RE_GLOSS_WORD.findall((d or "").lower()) if w not in GLOSS_STOP}


def refuse_cycles(g):
    """Refuse the split that closes each cycle, depth first, and say so."""
    colour = {}

    def visit(start):
        stack = [(start, iter(g.split.get(start, ())))]
        colour[start] = 1
        while stack:
            node, it = stack[-1]
            nxt = None
            for _, pk in it:
                if colour.get(pk, 0) == 1:
                    # A back edge closes a cycle: the split that closes it is
                    # refused, and the refusal is a stated reason.
                    g.refused[node] = "cycle through %s" % pk
                    del g.split[node]
                    g.split_src.pop(node, None)
                    g.stats["refused_cycle"] += 1
                    stack.pop()
                    colour[node] = 2
                    nxt = "cut"
                    break
                if colour.get(pk, 0) == 0:
                    nxt = pk
                    break
            if nxt == "cut":
                continue
            if nxt is None:
                colour[node] = 2
                stack.pop()
            else:
                colour[nxt] = 1
                stack.append((nxt, iter(g.split.get(nxt, ()))))

    for k in sorted(g.split):
        if colour.get(k, 0) == 0:
            visit(k)


# Words a gloss overlap never counts: function words and the framing nouns
# Latin glosses share ("the act of", "state of", "a person who").
GLOSS_STOP = frozenset("""
the and with from for that this into out one who which used form sense also
not any all its his her their they them are was were has have had being been
upon over under off away down about after before between through something
someone person thing things especially usually often act state quality manner
way make made making give given take taken put set get let what when where
while than then there here such very more most some other another each
both either neither can could may might shall should will would does did
doing done own same only just too also still yet ever never how why whose
whom having become becoming came come coming going gone went cause causing
caused against upon toward towards without within along among around above
below across behind beside beyond during except near since until unto via per
onto amid amidst besides throughout underneath
""".split())


def resolve_chain(g, chain, page_lang, tl, key):
    """[(form, key)] for a prose chain, or a reason it is refused.

    Accepted only when every part resolves to a node in this graph (the
    same-extract rule), none is reconstructed, and none is the page itself.
    A term with no language cue takes the page's mention templates' word
    for it, else Greek script means Greek, else the page's own language:
    on an English page that is English, and the chain is refused.
    """
    lang = g.lang
    out = []
    for term in chain:
        head = term.head
        if not head or head.lower() in STOP_HEADS or not any(c.isalpha() for c in head):
            return "stop-word head %s" % head
        if head.startswith("*"):
            return "reconstructed part %s" % head
        tlang = term.lang
        if tlang is None:
            tlang = tl.get(norm_for(lang, head))
            if tlang is None:
                tlang = "grc" if is_greek(head) else page_lang
        fam = lang_family(tlang)
        if is_greek(head) and fam != "el":
            fam = "grc"
        if fam != lang:
            return "part %s is %s, not %s" % (head, fam, lang)
        target = term.target or head
        pk, _ = g.lookup(target, alt_ok=True)
        if pk is None and term.target:
            pk, _ = g.lookup(head, alt_ok=True)
        if pk is None:
            return "part %s has no page" % head
        if pk == key:
            return "self-part split (%s names itself)" % head
        out.append((g.form.get(pk) or head, pk))
    return out


def read_passthrough(path, code):
    """key -> (mentions, chains) for every page of a pass-through extract that
    says anything about its origin. Pages with no etymology are skipped."""
    pages = {}
    n = 0
    with gzip.open(path, "rb") as f:
        for line in f:
            n += 1
            e = loads(line)
            w = e.get("word")
            if not w:
                continue
            k = norm_for(code, w)
            if k in pages:
                continue
            templates = e.get("etymology_templates") or []
            text = e.get("etymology_text") or ""
            if not templates and " + " not in text:
                continue
            mentions, chains = page_mentions(templates, text, code, k)
            if mentions or chains:
                pages[k] = (mentions, chains)
    return pages, n


def tagged_form(e, tag):
    for f in e.get("forms") or []:
        if tag in (f.get("tags") or []):
            v = (f.get("form") or "").strip()
            if v:
                return v
    return ""


RE_HEAD_MOD = re.compile(r"<.*$")


def display_form(e, word, lang, key):
    """The headword as the card shows it, macrons kept.

    Latin page titles drop macrons. The macronised spelling lives either in
    a form tagged canonical or in the head template's first arg.
    """
    if lang == "grc":
        # Greek titles are the spelling; the canonical form adds the vowel-
        # length marks that the key strips and no card should print.
        return word
    c = tagged_form(e, "canonical")
    if c and norm_key(lang, c) == key:
        return c
    for h in e.get("head_templates") or []:
        a = ((h.get("args") or {}).get("1") or "").strip()
        a = RE_HEAD_MOD.sub("", a).strip()
        if a and norm_key(lang, a) == key:
            return a
    return word


# ---------------------------------------------------------------- assembly

def accepted_split(wl, rec):
    """The morphs of one word, after curation and inflection suppression."""
    forced = curation.FORCED_SPLITS.get(wl)
    if forced:
        return list(forced)
    if wl in curation.BLOCKED_SPLITS:
        return None
    parts = rec["sp"]
    if not parts or len(parts) < 2:
        return None
    if parts[-1] in INFLECTIONAL:
        return None
    return list(parts)


ORG_DEPTH = 3           # levels of source-language splitting, SPEC cap
# Words that must reach a source lemma before recursion treats it as a card
# of its own and stops there. Measured both candidates on the full bundle
# (2026-08-25): 2 keeps 38 more mid-level cards, every one of them a derived
# compound with a family of exactly two (la:contraho for contract and
# contractor, grc:ἀναλύω for analysis and analyze), and leaves 11.5% of org
# parts inert. 3 drills through those to the base the family shares, so
# analysis, analyze, palsy and paralytic all land on grc:λύω, and leaves
# 8.5% inert. Both keep solvō, pōnō and mittō, which is what the rule is for.
#
# Set to 2 on 2026-09-01 (owner decision). The cost of a shallower row went
# away once an anchor's card carries the anchor's own split (`parts` in
# roots.json) and the family index credits through it: contract stops at
# contrahō, the contrahō card reads con- + trahō, and trahō still lists
# contract. What 2 buys is that a lemma two words reach, which is enough to
# ship a card, is also enough to keep it from flattening away. la:laxō and
# la:ēligō needed ROOT_STOPS entries for exactly that gap at 3.
ORG_ANCHOR_MIN = 2


class Origin:
    """English attaches to the source graphs, and rows are read off them.

    Attachment (SPEC Principle 3): an English page contributes the ordered
    terms it names, from origin templates, mention templates in a sentence
    that is not a cognate or a rejection, the etymon tree, decomposition
    parts and the prose parser. Pass-through pages are walked in place, so
    a chain that stops at Old French continues to Latin when the French
    page names it. The root-language terms fall into runs by language, and
    the entry lemma of a run is the first term of it that resolves: the
    lemma English borrowed, with the rest of the run being that lemma's
    own ancestry inside its language. The word attaches to the deepest
    run's entry lemma, preferring a run whose entry decomposes (in the
    graph, or through parts the English page itself supplies) and, inside
    a run whose entry does not, a later term of the same run that does.

    Rows (SPEC Principle 4): an attached word renders a decomposed row when
    the node decomposes and a single row when it does not; a word whose
    deepest named origin is a row-only language renders the row-only shape;
    every referenced node ships as a root card. Nothing is dropped for a
    threshold. What is dropped carries a stated reason into the misses
    report.

    Flattening is the 2026-08-25 rule over the graph's edges: recursion
    capped at ORG_DEPTH, affixes terminal, anchors terminal, aliases and
    skips honoured at every level.
    """

    def __init__(self, graphs, pages):
        self.g = graphs
        self.pages = pages
        self.alias = {}          # inflected or variant spelling -> root key
        self.anchors = set()
        self.carry = set()       # non-anchors kept whole by the chip cap; cards carry parts
        self.card_parts = {}     # anchor or carried key -> its flattened split, from linking
        self.stats = collections.Counter()
        self.ev = {}             # fam:key -> merged homograph evidence
        self.ctx = None          # the attaching page's own evidence, during attach
        self.ranks = {}          # word -> rank, for the weight of its vote

    # -- homographs ----------------------------------------------------------
    #
    # A node with several lemma entries picks one, and the split, the label
    # and the gloss all come from it (review findings 2 and 3, 2026-09-05).
    # The pick is by evidence, in this order, sense count last:
    #   a  a mention states the entry's gloss, pos or a distinguishing form
    #      (fundāre against fundere), on the English page or as a glossed
    #      part on a source page;
    #   b  the English page names a part of the entry's own split (decide
    #      names caedō, so dēcīdō "cut off" wins over dēcidō "fall");
    #   c  the entry's senses share a content word with the English word's
    #      first definition (impact: "collision");
    #   d  the entry with the most senses.
    # At attach time a page's own evidence answers whether the node it is
    # about to attach to decomposes; after the harvest the merged evidence of
    # every page fixes each node once, and the rows read the fixed split.

    def evidence_of(self, terms, mentions, defwords):
        """{fam:key -> one page's evidence} for the multi-entry keys the page
        names: {"gloss": set, "pos": set, "forms": set, "named": set,
        "defs": set}. One page is one vote, however much it says."""
        ev = {}
        named = {fam: set() for fam in self.g}
        for code, term, alt, gloss, pos in terms:
            fam = ROOT_LANGS.get(code)
            if not fam:
                continue
            g = self.g[fam]
            key, _ = g.lookup(term, alt_ok=True)
            if key is None:
                continue
            named[fam].add(key)
            if len(g.cands.get(key) or ()) < 2:
                continue
            k = fam + ":" + key
            r = ev.get(k)
            if r is None:
                r = ev[k] = {"gloss": set(), "pos": set(), "forms": set(),
                             "named": None, "defs": defwords}
            if gloss:
                r["gloss"].update(w for w in RE_GLOSS_WORD.findall(gloss.lower())
                                  if w not in GLOSS_STOP)
            if pos:
                r["pos"].add(POS_NAMES.get(pos, pos))
            for f in (term, alt):
                if f:
                    r["forms"].add(unicodedata.normalize("NFC", f).lower())
        for kind, code, term, _, _, _, _ in mentions:
            fam = ROOT_LANGS.get(code)
            if not fam or term.startswith("*"):
                continue
            key, _ = self.g[fam].lookup(term, alt_ok=True)
            if key:
                named[fam].add(key)
        for k, r in ev.items():
            r["named"] = named[k.split(":", 1)[0]]
        # A written verb form no entry of the node carries, on a node with no
        # verb entry, names a lemma Wiktionary has no page for: catch writes
        # Late Latin captiāre under the page captio, whose only entry is the
        # noun "deception". The page is skipped for this attachment.
        skip = set()
        for code, term, alt, gloss, pos in terms:
            fam = ROOT_LANGS.get(code)
            if not fam or not alt or not RE_LA_INFINITIVE.search(alt):
                continue
            g = self.g[fam]
            key, _ = g.lookup(term, alt_ok=True)
            cands = g.cands.get(key) if key else None
            if not cands:
                continue
            a = unicodedata.normalize("NFC", alt).lower()
            if not any(c.pos == "verb" or a in c.forms for c in cands):
                skip.add(fam + ":" + key)
        if skip:
            ev["skip"] = skip
        return ev

    @staticmethod
    def vote_weight(rank):
        """How much one page's vote counts.

        One card serves every word that reaches the node and can follow
        only one entry, so the words a reader meets most decide: a rank
        1,000 word counts as seven words at the cap, and decide with
        decision outvote decay, decadent and deciduous on dēcīdō. A word
        past the cap or unranked counts a third of a word at the cap; a
        source page's part gloss counts as one.
        """
        if not rank:
            return 0.3
        return max(0.3, math.sqrt(RANK_CAP / float(rank)))

    def merge_evidence(self, ev, rank=None):
        w = self.vote_weight(rank)
        for k, r in ev.items():
            if k != "skip":
                self.ev.setdefault(k, []).append((r, w))

    def choose(self, fam, key, votes):
        """(entry index, rule) for a node, by the rules in the class note.

        `votes` is [(evidence, weight)], one per page. Each page votes for
        the entries its evidence matches, and only a distinguishing match
        counts: a form, pos or gloss word every entry shares says nothing.
        """
        g = self.g[fam]
        cands = g.cands[key]
        n = len(cands)
        if n < 2:
            return 0, "d"
        # A name entry never wins on evidence: its gloss is the name itself.
        idx = [i for i in range(n) if cands[i].pos != "name"] or list(range(n))

        def unique_max(scores):
            best = max(scores[i] for i in idx)
            if best <= 0:
                return None
            hits = [i for i in idx if scores[i] == best]
            return hits[0] if len(hits) == 1 else None

        def distinct(match):
            """Per-entry 0/1 for a predicate, zeroed when every entry matches."""
            flags = [1 if i in idx and match(cands[i]) else 0 for i in range(n)]
            return flags if 0 < sum(flags) < len(idx) else [0] * n

        def gloss_flags(words):
            out = [0] * n
            for w in words:
                for i, f in enumerate(distinct(lambda c, w=w: w in c.words)):
                    out[i] += f
            return out

        # rule a: a form, pos or gloss the English pages state
        scores = [0.0] * n
        for r, w in votes or ():
            per = [0] * n
            for f in r["forms"]:
                flags = distinct(lambda c, f=f: f in c.forms)
                if sum(flags) == 1:
                    per = [p + 2 * x for p, x in zip(per, flags)]
            for p in r["pos"]:
                per = [q + x for q, x in zip(per, distinct(lambda c, p=p: c.pos == p))]
            per = [q + min(x, 1) for q, x in zip(per, gloss_flags(r["gloss"]))]
            for i, x in enumerate(per):
                scores[i] += w * x
        best = unique_max(scores)
        if best is not None:
            return best, "a"
        # rule s: the source pages that gloss the term as a part of their
        # own lemma (iūsculum = iūs<t:broth> + -culum), one vote per page
        scores = [0.0] * n
        for words in g.part_hints.get(key) or ():
            for i, x in enumerate(gloss_flags(words)):
                scores[i] += min(x, 1)
        best = unique_max(scores)
        if best is not None:
            return best, "s"
        if not votes:
            return 0, "d"
        # rule b: the page names a part of the entry's own split
        splits = g.esplit.get(key) or []
        partsets = [set(pk for _, pk in (splits[i] or ())) if i < len(splits) else set()
                    for i in range(n)]
        filled = [ps for ps in partsets if ps]
        shared = set.intersection(*filled) if len(filled) > 1 else set()
        scores = [0.0] * n
        for r, w in votes:
            for i in idx:
                if (partsets[i] - shared) & r["named"]:
                    scores[i] += w
        best = unique_max(scores)
        if best is not None:
            return best, "b"
        # rule c: the word's first definition shares a content word
        scores = [0.0] * n
        for r, w in votes:
            flags = gloss_flags(r["defs"])
            top = max(flags)
            if top > 0 and flags.count(top) == 1:
                scores[flags.index(top)] += w
        best = unique_max(scores)
        if best is not None:
            return best, "c"
        return 0, "d"

    def decomposes(self, fam, key):
        """Whether a node decomposes, under the attaching page's evidence."""
        if key is None:
            return False
        g = self.g[fam]
        if self.ctx is not None and len(g.cands.get(key) or ()) >= 2:
            r = self.ctx.get(fam + ":" + key)
            if r:
                i, rule = self.choose(fam, key, [(r, 1.0)])
                if rule != "d":
                    sp = g.esplit.get(key) or ()
                    return bool(i < len(sp) and sp[i])
        return g.decomposes(key)

    def choose_homographs(self):
        """Fix every multi-entry node on one entry, after the harvest."""
        for fam, g in self.g.items():
            for key, cands in g.cands.items():
                if len(cands) < 2:
                    continue
                r = self.ev.get(fam + ":" + key)
                i, rule = self.choose(fam, key, r)
                self.stats["homograph_" + rule] += 1
                if i == 0:
                    continue
                self.stats["homograph_changed"] += 1
                c = cands[i]
                g.gloss[key] = c.gloss
                g.form[key] = c.form
                g.pos[key] = c.pos
                if c.rom:
                    g.rom[key] = c.rom
                else:
                    g.rom.pop(key, None)
                sp = g.esplit.get(key) or ()
                s = sp[i] if i < len(sp) else None
                if s:
                    g.split[key] = s
                    g.split_src[key] = c.src if c.parts else "prose"
                    g.refused.pop(key, None)
                else:
                    g.split.pop(key, None)
                    g.split_src.pop(key, None)
            refuse_cycles(g)
            g.stats["decomposed"] = len(g.split)

    # -- lookups shared with the affix `src` path --------------------------

    def settle(self, lang, lemma):
        """The key a lemma settles on, or None. Records the spelling alias."""
        key, first = self.g[lang].lookup(lemma, alt_ok=True)
        if key and first and first != key:
            self.alias[first] = lang + ":" + key
        return key

    def term_keys(self, code, term):
        """The keys a term is known under: as written, and settled."""
        keys = {row_key(code, term)}
        fam = ROOT_LANGS.get(code)
        if fam and not term.startswith("*"):
            k, _ = self.g[fam].lookup(term, alt_ok=True)
            if k:
                keys.add(fam + ":" + k)
        return keys

    def cognate_only(self, mentions):
        """The keys a page names only in a cognate role (review finding 1).

        A term the page states as a cognate is not its origin, whatever a
        walked pass-through page says about it, and no row may name it. A
        term the page also names in an origin role (or settles on through
        one, fruitus to fruor) is not in the set.
        """
        cog, orig = set(), set()
        for kind, code, term, _, _, role, _ in mentions:
            if term.startswith("*"):
                continue
            (cog if role == "cognate" else orig).update(self.term_keys(code, term))
        return cog - orig

    # -- attachment ----------------------------------------------------------

    def expand(self, mentions, depth, seen):
        """The mentions with every pass-through page walked.

        A walked page's mentions come after the page's own, in walk order,
        and carry position -2: the page's own statement is read first, and
        the French page only continues the chain past it.
        """
        own = list(mentions) if depth == 3 else [m[:6] + (-2,) for m in mentions]
        walked = []
        for m in mentions:
            kind, code, term, gloss, rom, role, _ = m
            if kind == "part" or role != "origin" or term.startswith("*"):
                continue
            ex = PASS_EXTRACT.get(code)
            if not ex or depth <= 0:
                continue
            k = norm_for(ex, self.g["la"].clean_term(term))
            if (ex, k) in seen:
                continue
            page = self.pages.get(ex, {}).get(k)
            if page:
                self.stats["walked_" + ex] += 1
                walked.extend(self.expand(page[0], depth - 1, seen | {(ex, k)}))
        return own + walked

    def english_parts(self, ms, chains):
        """fam -> (parts, pos, heads, before): the parts the English page
        supplies itself.

        From a decomposition template whose language is a root language,
        from the parts of an etymon analysis, and from the prose parser,
        the first accepted set per language wins. `pos` is where the parts
        sit in the prose (-1 when unknown), `heads` the spellings of the
        parts, and `before` the last origin term named ahead of a template
        run in template order: the head the etymon tree nests the parts
        under, or the origin template written just before a plain one. A
        run with no prose position belongs to that term and to no other
        (review finding 5, 2026-09-05).
        """
        parts_by = {}
        tl = {}
        for kind, code, term, _, _, _, pos in ms:
            if pos == -2:
                # A walked page's word for a term's language is not the
                # page's own: the Old French page delivrer writes līberō
                # inside a French template.
                continue
            fam = lang_family(code)
            for f in ("la", "grc"):
                tk = norm_for(f, term)
                if tk:
                    tl.setdefault(tk, fam)
        run = []
        before = [None]

        def flush():
            if len(run) >= 2:
                fam = lang_family(run[0][1])
                if fam in self.g and fam not in parts_by:
                    g = self.g[fam]
                    resolved = []
                    heads = set()
                    for _, code, term, _, _, _, _ in run:
                        pk, _ = g.lookup(term, alt_ok=True)
                        if pk is None or lang_family(code) != fam:
                            resolved = None
                            break
                        resolved.append((g.form.get(pk) or g.clean_term(term), pk))
                        heads.add(strip_marks(term))
                    if resolved:
                        parts_by[fam] = (resolved, run[0][6], heads, before[0])
            del run[:]

        for m in ms:
            if m[0] == "part" and lang_family(m[1]) in self.g:
                if run and (run[-1][1] != m[1] or run[-1][6] != m[6]):
                    flush()
                run.append(m)
            else:
                flush()
                kind, code, term, gloss, rom, role, mpos = m
                if (kind != "part" and role == "origin"
                        and lang_role(code) in ("root", "pass")
                        and not term.startswith("*")):
                    before[0] = (code, term, gloss, mpos)
        flush()
        for chain, stance, pos in chains:
            if stance == "reject":
                continue
            # A trailing suffix the page's own templates give as English
            # ("from Latin funereus + -al", "cohaereō, + -ive") is the
            # English word's suffix, not a part of the lemma (review
            # finding 5): it comes off the chain, and a chain left with
            # one term is no chain.
            while (len(chain) >= 2 and chain[-1].head.startswith("-")
                   and not chain[-1].explicit
                   and tl.get(norm_for("la", chain[-1].head)) == "en"):
                chain = chain[:-1]
            if len(chain) < 2:
                continue
            for fam in ("la", "grc"):
                if fam in parts_by:
                    continue
                res = resolve_chain(self.g[fam], chain, "en", tl, None)
                if not isinstance(res, str):
                    heads = set()
                    for t in chain:
                        heads.add(strip_marks(t.head))
                        if t.target:
                            heads.add(strip_marks(t.target))
                    parts_by[fam] = (res, pos, heads, None)
        return parts_by

    def attach(self, mentions, chains, word="", ctx=None):
        """The attachment of one English page.

        Returns {"lang", "key", "first", "extra"} for a root-language
        attachment, {"row": {...}} for a row-only origin, {"miss": reason}
        when a root or pass-through term was named and nothing attaches, and
        None when the page names no origin this dictionary classifies.
        `ctx` is the page's own homograph evidence (evidence_of), read
        whenever the attachment asks whether a node decomposes.
        """
        self.ctx = ctx
        try:
            return self._attach(mentions, chains, word)
        finally:
            self.ctx = None

    def _attach(self, mentions, chains, word):
        ms = self.expand(mentions, 3, set())
        # A term the page itself calls a cognate is vetoed wherever a walked
        # page names it as an origin (flat names French plat, whose page
        # continues to Greek πλατύς, which flat lists as a cognate).
        veto = self.cognate_only(mentions)
        if veto:
            ms = [m if m[6] != -2 or not (self.term_keys(m[1], m[2]) & veto)
                  else m[:5] + ("cognate", -2) for m in ms]
        parts_by = self.english_parts(ms, chains)
        # The parts the page supplies belong to the last term named before
        # the plus-chain, whatever its language: "from Latin dīvortium, from
        # dī- + vertere" splits dīvortium; "from Vulgar Latin *disiūnō, from
        # dis- + iēiūnō" splits the reconstruction; "from Old French
        # sorprendre, from super- + prendere" splits the French verb. That
        # owner labels the row when it is no node of the graph.
        owner = {}
        for fam, (parts, pos, hs, before) in list(parts_by.items()):
            if pos < 0:
                # No prose position: the parts belong to the term the
                # template itself names (the etymon head, or the origin
                # template written just before it), never to any term of
                # the run (review finding 5: persecute's per- + sequor
                # landed on persecūtor, sport's de- + portāre on portō).
                if before is not None and strip_marks(before[1]) not in hs:
                    owner[fam] = before
                else:
                    del parts_by[fam]
                continue
            best = None
            for kind, code, term, gloss, rom, role, mpos in ms:
                if kind == "part" or role != "origin" or mpos < 0 or mpos >= pos:
                    continue
                if strip_marks(term) in hs:
                    continue
                if lang_role(code) not in ("root", "pass"):
                    continue
                if best is None or mpos > best[3]:
                    best = (code, term, gloss, mpos)
            if best is not None:
                owner[fam] = best
            else:
                # No root or pass-through term is named before the chain:
                # "From Latin spectāculum + -ar" is the English word's own
                # analysis, and its first term is the lemma English
                # borrowed, not a part.
                del parts_by[fam]
        # A mention that is a term of an owned chain is a part of the lemma
        # the chain explains, not a lemma of its own: "from super- +
        # prendere" written with mention templates must not attach a word
        # to la:super-. The parser's role decides, never the template name.
        # Only a mention written at or after the chain is one of its terms:
        # infirm names infirmus as its origin two sentences before the verb's
        # "īnfirmus + -ō", and that mention stays the origin. A mention's
        # position is where its expansion starts, which puts the language
        # name ("Latin dis-") a few characters ahead of the chain's head.
        head_pos = {}
        for parts, pos, hs, _ in parts_by.values():
            if pos >= 0:
                for h in hs:
                    head_pos[h] = min(head_pos.get(h, pos), pos)
        if head_pos:
            ms = [(("part",) + m[1:]) if m[0] in ("mention", "origin")
                  and strip_marks(m[2]) in head_pos
                  and (m[6] < 0 or m[6] + LANG_NAME_SPAN >= head_pos[strip_marks(m[2])])
                  else m for m in ms]

        own = []
        named = []
        skip = (self.ctx or {}).get("skip") or ()
        for kind, code, term, gloss, rom, role, pos in ms:
            if kind == "part" or role != "origin" or term.startswith("*"):
                continue
            fam = ROOT_LANGS.get(code)
            if fam:
                if skip and pos != -2 and (self.term_keys(code, term) & skip):
                    continue
                named.append((fam, term, gloss))
                if pos != -2:
                    own.append(named[-1])
        if not named:
            for kind, code, term, gloss, rom, role, pos in ms:
                if kind == "part" or role != "origin" or term.startswith("*"):
                    continue
                r = lang_role(code)
                if r in ("row", "pass"):
                    named.append((None, term, gloss))
            if not named and not owner:
                return None
        # The page's own terms decide first; a walked French page only
        # continues the chain when the page itself settles nothing. The
        # strict pass wins unless only the alternative-form pass reaches a
        # node that decomposes (μονάρχης is a spelling of μόναρχος, which
        # splits; σύκχος is a spelling of συγχίς, which does not, so sock
        # stays on Latin soccus).
        hit = self.pick_both(own, parts_by, owner)
        if hit is not None:
            return hit
        for fam in ("la", "grc"):
            own_fam = any(f == fam for f, _, _ in own)
            if fam in parts_by and owner.get(fam) is None and not own_fam:
                continue
            if own_fam or owner.get(fam) is None:
                continue
            code, term, gloss, _ = owner[fam]
            if ROOT_LANGS.get(code) == fam and term.startswith("*"):
                return {"lang": fam, "key": None, "first": "", "hint": "",
                        "label": "*" + self.g[fam].clean_term(term[1:]),
                        "extra": parts_by[fam][0]}
            if lang_role(code) == "pass" and not term.startswith("*"):
                # The French word owns the parts, but when its own page
                # continues to a Latin lemma that decomposes, that lemma is
                # the row (ancestor: ancessor's page names antecessor).
                deeper = self.pick([c for c in named if c[0] == fam], {}, False, {})
                if deeper and deeper.get("key") and self.decomposes(fam, deeper["key"]):
                    return deeper
                return {"lang": code, "key": None, "first": "", "hint": "",
                        "label": self.g[fam].clean_term(term),
                        "extra": parts_by[fam][0], "fam": fam}
            other = ROOT_LANGS.get(code)
            if other and other != fam and not term.startswith("*") \
                    and self.g[other].lookup(term, True)[0] is None:
                # New Latin parametrum, split as Greek παρα- + μέτρον: the
                # unwritten Latin term labels the row and the chips are Greek.
                return {"lang": other, "key": None, "first": "", "hint": "",
                        "label": self.g[other].clean_term(term),
                        "extra": parts_by[fam][0], "fam": fam}
        hit = self.pick_both(named, parts_by, owner)
        if hit is not None:
            return hit
        for fam in ("la", "grc"):
            own = owner.get(fam)
            if own is None or any(f == fam for f, _, _ in named):
                continue
            code, term, gloss, _ = own
            if ROOT_LANGS.get(code) == fam and term.startswith("*"):
                # A reconstructed form ends the walk and is never a node. It
                # still labels the row whose parts the page gives ("FROM
                # LATIN *disiūnō: dis- + iēiūnō", the Vulgar Latin shape the
                # spike judged right on manage).
                return {"lang": fam, "key": None, "first": "", "hint": "",
                        "label": "*" + self.g[fam].clean_term(term[1:]),
                        "extra": parts_by[fam][0]}
            if lang_role(code) == "pass" and not term.startswith("*"):
                # The parts assemble a pass-through word and the page names
                # no lemma of their language: the French verb labels the
                # row and the chips stay Latin.
                return {"lang": code, "key": None, "first": "", "hint": "",
                        "label": self.g[fam].clean_term(term),
                        "extra": parts_by[fam][0], "fam": fam}
        # ---- row-only: the deepest named origin is not a root language ----
        if not any(fam for fam, _, _ in named):
            row = None
            stop = ""
            for kind, code, term, gloss, rom, role, _ in ms:
                if kind == "part" or role != "origin" or term.startswith("*"):
                    continue
                r = lang_role(code)
                if r == "row":
                    row = {"lang": code, "f": self.g["la"].clean_term(term)}
                    if gloss:
                        row["gloss"] = gloss
                    if rom:
                        row["rom"] = rom
                    stop = ""
                elif r == "pass":
                    stop = code + ":" + term
            if row:
                return {"row": row}
            if stop:
                return {"miss": "chain stops in a pass-through language (%s)" % stop}
            return None
        reasons = []
        for fam, term, _ in named:
            if fam:
                reasons.append("%s:%s never written" % (fam, term))
        if not reasons:
            reasons.append("parts named with no lemma to carry them")
        return {"miss": "; ".join(reasons[:3])}

    def splits(self, att):
        """True when an attachment renders a decomposed row."""
        if not att or "key" not in att:
            return False
        if att.get("extra"):
            return True
        return att["key"] is not None and self.decomposes(att["lang"], att["key"])

    def pick_both(self, named, parts_by, owner):
        """The strict pick, unless only the alternative-form pick splits."""
        strict = self.pick(named, parts_by, False, owner)
        if strict is not None and self.splits(strict):
            return strict
        loose = self.pick(named, parts_by, True, owner)
        if loose is not None and self.splits(loose):
            return loose
        return strict if strict is not None else loose

    def pick(self, named, parts_by, alt_ok, owner):
        """The attachment among the named root-language terms, or None."""
        def owns(fam, term):
            """True when the page's parts in `fam` belong to this term.
            Parts with no owner belong to no term (review finding 5)."""
            own = owner.get(fam)
            if own is None:
                return False
            return strip_marks(own[1]) == strip_marks(term)

        runs = []
        for fam, term, gloss in named:
            if not fam:
                continue
            key, first = self.g[fam].lookup(term, alt_ok)
            c = (fam, key, term, gloss)
            if runs and runs[-1][0][0] == fam:
                runs[-1].append(c)
            else:
                runs.append([c])

        def found(c, extra):
            fam, key, term, gloss = c
            return {"lang": fam, "key": key,
                    "first": norm_for(fam, self.g[fam].clean_term(term)),
                    "hint": gloss, "extra": extra}

        best = None
        for run in reversed(runs):
            fam = run[0][0]
            if run[0][1] is None and not alt_ok:
                continue
            entry = None
            for c in run:
                if c[1] is not None:
                    entry = c
                    break
                if alt_ok and fam in parts_by and owns(fam, c[2]):
                    # A term Wiktionary never wrote (ad montem, dēcadēns) that
                    # the English page splits itself. The row reads the term
                    # as written over the parts, the row the spike counted as
                    # decomposed from English prose.
                    return {"lang": fam, "key": None, "first": "", "hint": "",
                            "label": self.g[fam].clean_term(c[2]),
                            "extra": parts_by[fam][0]}
            if entry is None:
                continue
            fam, key = entry[0], entry[1]
            if self.decomposes(fam, key):
                return found(entry, None)
            if fam in parts_by and owns(fam, entry[2]) and not self.is_affix(fam, key):
                return found(entry, parts_by[fam][0])
            for c in run[run.index(entry) + 1:]:
                if c[1] is not None and self.decomposes(c[0], c[1]):
                    return found(c, None)
                if c[1] is not None and fam in parts_by and owns(fam, c[2]):
                    return found(c, parts_by[fam][0])
            if best is None:
                best = entry
        return found(best, None) if best else None

    # -- anchors and flattening ---------------------------------------------

    def is_affix(self, lang, key, form=""):
        """True when this source-language page is an affix, not a lemma."""
        g = self.g[lang]
        for f in (form, g.form.get(key) or key):
            if f and (f.startswith("-") or f.endswith("-")):
                return True
        return g.pos.get(key, "") in AFFIX_POS

    def parts_of(self, lang, key, extra=None):
        """The top-level parts a lemma splits into: the graph's edge, else
        the parts the English page supplied for it."""
        return self.g[lang].split.get(key) or extra

    def top_reaches(self, lang, key, extra=None):
        """The root keys one lemma's own split credits at its top level.

        Mirrors flatten's piece loop, since the point is to count what a
        row will really name. Affixes, aliases and skips are left out:
        flatten never splits an affix or an alias, and a skip never ships.
        """
        if self.is_affix(lang, key):
            return ()
        parts = self.parts_of(lang, key, extra)
        if not parts:
            return ()
        out = []
        for form, pk in parts:
            if pk == key:
                return ()
            if (curation.ROOT_ALIASES.get(lang + ":" + pk)
                    or curation.ROOT_ALIASES.get(form)
                    or curation.ROOT_ALIASES.get(pk)):
                continue
            rkey = lang + ":" + pk
            if rkey in curation.ROOT_SKIPS or self.is_affix(lang, pk, form):
                continue
            out.append(rkey)
        return out

    def find_anchors(self, attachments):
        """Mark the source lemmas ORG_ANCHOR_MIN or more words reach.

        A word reaches the lemma it attaches to and the immediate parts of
        that lemma's split, each once (review finding 4, 2026-09-05; the
        2026-09-01 rule counted parts only, so a lemma two words attached
        to was still expanded away under a third word: just attaches to
        iūstus and justice flattened through it to iūs + -tus + -itia).
        """
        seen = collections.Counter()
        for att in attachments:
            if not att or "key" not in att:
                continue
            lang = att.get("fam") or att["lang"]
            # A lemma Wiktionary never wrote (medicālis) is no node, but the
            # parts the page gives it are reached like any other split's.
            reached = set(self.top_reaches(lang, att["key"], att.get("extra")))
            if att["key"] is None:
                for r in reached:
                    seen[r] += 1
                continue
            aliased = (curation.ROOT_ALIASES.get(lang + ":" + att["key"])
                       or curation.ROOT_ALIASES.get(att["key"]))
            if not self.is_affix(lang, att["key"]) and not aliased:
                reached.add(lang + ":" + att["key"])
            for r in reached:
                seen[r] += 1
        self.anchors = {k for k, n in seen.items() if n >= ORG_ANCHOR_MIN}
        return len(self.anchors)

    def flatten(self, lang, key, depth, seen, extra=None):
        """[(display form, root key or None)] for a lemma, or None.

        None means the lemma does not decompose and stays whole. A part in
        ROOT_SKIPS keeps its form and loses its link. Affixes are terminal
        (owner field finding 2026-08-25): -ārium splits as -ārius + -um in
        the source, and a reader drilling a suffix wants the suffix. A split
        naming the lemma or a lemma above it is refused (owner decision
        2026-09-01), which the graph's cycle check already guarantees for
        its own edges and `seen` guarantees for parts the English page
        supplied.

        Two limits on the row (review finding 4, 2026-09-05). No row may
        carry a duplicate root: a split that names one twice keeps the
        lemma whole. A row that would run to four or more chips falls back
        to the page's own parts, and every part that stayed whole because
        of that goes into `carry`, so its card carries its own split the
        way an anchor's does.
        """
        if self.is_affix(lang, key):
            return None
        g = self.g[lang]
        parts = g.split.get(key)
        if parts is None and extra and depth == ORG_DEPTH:
            parts = extra
        if not parts or len(parts) < 2 or depth <= 0:
            return None
        pieces = []
        for form, pk in parts:
            if pk in seen:
                return None
            a = (curation.ROOT_ALIASES.get(lang + ":" + pk)
                 or curation.ROOT_ALIASES.get(form)
                 or curation.ROOT_ALIASES.get(pk))
            if a:
                pieces.append((form, a, None))
                continue
            pieces.append((g.form.get(pk) or form, lang + ":" + pk, pk))
        whole = [(form, None if rkey in curation.ROOT_SKIPS else rkey)
                 for form, rkey, pk in pieces]
        linked = [r for _, r in whole if r]
        if len(set(linked)) < len(linked):
            # The page's own split names a part twice: no row may carry a
            # duplicate part (review finding 4), so the lemma stays whole.
            return None
        out = []
        expanded = []
        for form, rkey, pk in pieces:
            if rkey in curation.ROOT_SKIPS:
                out.append((form, None))
                continue
            sub = None
            if (pk is not None
                    and rkey not in self.anchors
                    and rkey not in curation.ROOT_STOPS):
                sub = self.flatten(lang, pk, depth - 1, seen | {pk})
            if sub:
                out.extend(sub)
                expanded.append(rkey)
            else:
                out.append((form, rkey))
        if expanded:
            linked = [r for _, r in out if r]
            if len(set(linked)) < len(linked) or len(out) >= 4:
                # Expanding a part duplicated a root or ran the row to four
                # chips or more (review finding 4: ossuārium read ōs + ōs,
                # energy read five chips). The row falls back to the page's
                # own parts, and each part kept whole carries its split on
                # its card instead, like an anchor.
                self.carry.update(expanded)
                return whole
        return out

    def chain_roots(self, att):
        """Every root key a word's attachment reaches, decomposed or whole.

        Used by the base-route gate in resolve_part. A word carrying morphs
        ships no org row, but its attachment is still the evidence for
        whether a base part names a classical root.
        """
        if not att or "key" not in att:
            return ()
        # A morph word ships no org row, so the parts its chain would have
        # kept whole are nobody's card: the carry set is left as it was.
        carry = set(self.carry)
        try:
            org = self.resolve(att, count=False)
        finally:
            self.carry = carry
        if not org:
            return ()
        if "parts" in org:
            return {p["r"] for p in org["parts"] if p.get("r")}
        return {org["r"]} if org.get("r") else ()

    def resolve(self, att, count=True):
        """The `org` value for an attachment: decomposed, single, row-only."""
        if not att:
            return None
        if "row" in att:
            if count:
                self.stats["rowonly"] += 1
            return dict(att["row"])
        if "key" not in att:
            return None
        lang, key = att["lang"], att["key"]
        if key is None:
            flat = self.flatten(att.get("fam") or lang, None, ORG_DEPTH, set(),
                                att.get("extra"))
            if not flat or len(flat) < 2:
                return None
            if count:
                self.stats["decomposed"] += 1
                self.stats["unwritten"] += 1
            return {"l": att["label"], "lang": lang,
                    "parts": [({"f": f, "r": r} if r else {"f": f}) for f, r in flat]}
        if att.get("first") and att["first"] != key:
            self.alias[att["first"]] = lang + ":" + key
        a = (curation.ROOT_ALIASES.get(lang + ":" + key)
             or curation.ROOT_ALIASES.get(key))
        if a:
            # A curated alias is a decision about where the family belongs,
            # so it wins over anything the extract would decompose.
            if count:
                self.stats["single"] += 1
            return {"r": a}
        flat = self.flatten(lang, key, ORG_DEPTH, {key}, att.get("extra"))
        if flat and len(flat) >= 2:
            if count:
                self.stats["decomposed"] += 1
                self.stats["parts_%d" % min(len(flat), 6)] += 1
            disp = self.g[lang].form.get(key) or key
            parts = []
            for form, rkey in flat:
                part = {"f": form}
                if rkey:
                    part["r"] = rkey
                parts.append(part)
            return {"l": disp, "lang": lang, "parts": parts}
        if count:
            self.stats["single"] += 1
        return {"r": lang + ":" + key}


def resolve_part(part, word, affixes, shipped, chain_roots=()):
    """Link target for one morpheme: ("r", key), ("w", key), or (None, None).

    A curated alias overrides everything. After that an affix part takes the
    affix root card, a curated base route takes the classical root that the
    part really names, and a hyphen-free part that is itself a shipped word
    takes that word card. Anything else leaves the chip inert. Origin is
    never consulted for affixes: un- resolves the same way sub- does.

    `chain_roots` is the set of root keys this word's own etymology chain
    reaches. It gates BASE_ROUTES and nothing else.
    """
    p = part.lower()
    a = curation.ROOT_ALIASES.get(part) or curation.ROOT_ALIASES.get(p)
    if a:
        return "r", a
    if p in affixes and ("-" in p or p not in shipped):
        # A hyphen-free affix page that is also a shipped word (a combining
        # form recorded on the word's own page) links to the word card; an
        # ordinary English word never becomes a root card.
        return "r", "en:" + p
    # A curated base route, and only when this word's own chain reaches the
    # root it names. See BASE_ROUTES for why the gate carries the safety.
    routed = curation.BASE_ROUTES.get(p)
    if routed and routed in chain_roots:
        return "r", routed
    if "-" not in p and p != word and p in shipped:
        return "w", p
    return None, None


def shape_kind(form):
    """Prefix or suffix by hyphen shape, root when neither. Last resort."""
    if form.endswith("-") and not form.startswith("-"):
        return "prefix"
    if form.startswith("-"):
        return "suffix"
    return "root"


def root_kind(pos, form):
    """The card's `kind`, from the harvested entry pos.

    The pos is the only thing that knows what an affix is. Hyphen shape
    guesses, and it guessed wrong on both ends of the extract: -o- and its
    kin are interfixes that read as suffixes, and "en- -en" is a circumfix
    that reads as a root (review finding 2026-08-24; 10 interfix cards and
    the one circumfix card were mislabeled). Latin and Greek pages carry a
    pos too, so la:re- stays a prefix rather than becoming a Latin root.
    Shape survives for the one pos that does not settle the question: a
    combining form is a root unless its own page is written with a hyphen
    (electro-, -phile).
    """
    kind = AFFIX_KIND.get(pos)
    if kind:
        return kind
    if pos in COMBINING_POS:
        return shape_kind(form)
    return "root"


def rekey_us_primary(shipped, fmap, us_raw, ranks):
    """Move each British-keyed record onto its US spelling. Returns the pairs.

    Wiktionary writes the content on the British page and leaves a pointer on
    the American one, so the harvest keys favourite and calls favorite a
    redirect. For this dictionary's reader that is backwards. The record moves
    whole: the US spelling becomes the key, the card headword, the family row,
    the omnibox row, the saved item; `wik` records the page that actually
    holds the text so the Wiktionary link still lands somewhere real; and the
    British spelling becomes a forms.json row pointing at the new key, so both
    spellings still resolve.

    This runs LAST, after every harvest and after forms.json is assembled, so
    one rename map covers every reference at once: forms targets, `fo` fields
    on other words, and `w` chips naming the old key. The root family index is
    derived from the records themselves and moves with them.

    A pair only forms when the US spelling has no card of its own. Where both
    spellings carry full entries (color and colour, practice and practise) the
    two are left alone, because neither is a pointer.
    """
    pairs = []
    taken = set()
    for us in sorted(us_raw):
        brit = us_raw[us]
        # The US page must be a pointer, its lemma must ship, and the row
        # between them must be the one this rule is about: an inflection
        # outranks a spelling and keeps the surface pointed elsewhere.
        if us in shipped or brit not in shipped or brit in taken:
            continue
        if fmap.get(us) != brit:
            continue
        taken.add(brit)
        pairs.append((us, brit))

    rename = {brit: us for us, brit in pairs}
    for us, brit in pairs:
        rec = shipped.pop(brit)
        rec["wik"] = brit
        # The rank follows the headword. A card titled favorite reporting the
        # rank of favourite understates the word the reader selected, so the
        # pair keeps the better of the two ranks and the tier follows it
        # (SPEC, Jesse decision 2026-08-25). Every shipped word is ranked, so
        # there is always one to compare against.
        r = ranks.get(us)
        if r is not None and (rec.get("fr") is None or r < rec["fr"]):
            rec["fr"] = r
        shipped[us] = rec
        del fmap[us]
        fmap[brit] = us
    for k in list(fmap):
        if fmap[k] in rename:
            fmap[k] = rename[fmap[k]]
    for w in shipped.values():
        if w.get("fo") in rename:
            w["fo"] = rename[w["fo"]]
        for m in w.get("morphs") or ():
            if m.get("w") in rename:
                m["w"] = rename[m["w"]]
    return pairs


def link_and_prune(shipped, org_rows, harvest, origin, affixes, graphs):
    """Resolve every chip, build the root set, link what ships.

    Re-runnable, and it has to be. Dropping a word changes who credits what,
    so the chain-only rule calls this again on the smaller word set. Each
    pass rebuilds every chip from its own form and re-takes every org row
    from `org_rows`, so no pass inherits the edits of the one before it.

    There is no credit threshold (SPEC Principle 4, owner decision
    2026-09-05): every root key a shipped word references ships as a card,
    a one-word family included. A key is left out only when it has no gloss
    to carry a card (an English affix page with no usable sense) or is in
    ROOT_SKIPS, and a reference to it renders inert.

    Returns (roots, counters).
    """
    c = collections.Counter()
    for wl, w in shipped.items():
        for m in w.get("morphs") or ():
            m.pop("r", None)
            m.pop("w", None)
        org = org_rows.get(wl)
        if org is None:
            w.pop("org", None)
        else:
            w["org"] = copy.deepcopy(org)

    # ---- the card-carrying lemmas' own splits, raw --------------------------
    # Every anchor's split as flatten() names it, root keys and all, before
    # anyone knows which of those roots ship, and the same for every node
    # the chip cap kept whole (Origin.carry, review finding 4). Two things
    # read it: the credit count below, and the `parts` field the card
    # carries. Flattening a carried node can keep further nodes whole, so
    # the loop runs until the carry set stops growing.
    card_parts = {}
    while True:
        want = (origin.anchors | origin.carry) - set(card_parts)
        if not want:
            break
        for key in sorted(want):
            lang, pk = key.split(":", 1)
            flat = origin.flatten(lang, pk, ORG_DEPTH, {pk})
            card_parts[key] = flat if flat and len(flat) >= 2 else None
    card_parts = {k: v for k, v in card_parts.items() if v}
    origin.card_parts = card_parts
    through = root_closure({
        k: {"parts": [{"f": f, "r": r} for f, r in flat if r]}
        for k, flat in card_parts.items()})

    # ---- resolve morphemes to roots, count references -------------------
    # One word credits a root once, however many of its morphs name it, and
    # the org row counts in the same tally. A credit to an anchor is also a
    # credit to every root the anchor's split names, recursively (owner
    # decision 2026-09-01): access names accēdō, accēdō names cēdō, so
    # access counts for cēdō. This is the runtime's rule (lookup.js
    # buildFamilyIndex), mirrored here for the report and for the family
    # checks; nothing is pruned by it any more.
    refs = collections.Counter()
    for wl, w in shipped.items():
        credited = set()
        # The roots this word's own attachment reaches, for the base-route
        # gate. A word with morphs keeps its attachment in the harvest even
        # though the schema gives it no org row, and that is the evidence a
        # route needs: transport runs through trānsportō, airport runs
        # through nothing at all.
        chain_roots = origin.chain_roots(harvest.get(wl, {}).get("att")) \
            if w.get("morphs") else ()
        for m in w.get("morphs") or ():
            field, k = resolve_part(m["f"], wl, affixes, shipped, chain_roots)
            if field == "r" and curation.BASE_ROUTES.get(m["f"].lower()) == k:
                c["routed"] += 1
            if field == "r" and k not in curation.ROOT_SKIPS:
                m["r"] = k
                if k in credited:
                    c["repeat"] += 1
                credited.add(k)
            elif field == "w":
                m["w"] = k
                c["wchip"] += 1
        # An org row credits its roots exactly as morph chips do, once per
        # word, whether it is a single lemma or a decomposed one. A row-only
        # row names no root and credits nothing.
        org = w.get("org")
        if org and "parts" in org:
            for p in org["parts"]:
                if p.get("r"):
                    credited.add(p["r"])
        elif org and org.get("r"):
            if org["r"] in curation.ROOT_SKIPS:
                del w["org"]
                c["orgskip"] += 1
            else:
                credited.add(org["r"])
        reached = set()
        for k in credited:
            reached |= through(k)
        for k in reached:
            refs[k] += 1

    # ---- build the root set: every referenced key with a gloss -----------
    roots = {}
    for key in refs:
        lang, form = key.split(":", 1)
        if lang == "en":
            a = affixes.get(form)
            if not a:
                continue
            gloss, disp, rom, pos = a["gloss"], form, "", a["pos"]
        else:
            g = graphs[lang]
            # The node's entry was fixed by choose_homographs: gloss, form,
            # pos and romanization all come from that one entry.
            gloss = g.gloss.get(form)
            disp = g.form.get(form) or form
            rom = g.rom.get(form, "")
            pos = g.pos.get(form, "")
        # A hand gloss overrides the harvest and can carry a card on its own.
        gloss = curation.ROOT_GLOSSES.get(key) or gloss
        if not gloss:
            c["noglossroot"] += 1
            continue
        r = {"form": disp, "lang": lang, "gloss": gloss,
             "kind": root_kind(pos, disp)}
        if rom:
            r["rom"] = rom
        roots[key] = r

    # Alias forms, from curation and from the lookup steps, listed on the
    # card they were folded into. Flattening produces no aliases of its own:
    # an intermediate lemma is decomposed rather than folded away.
    alt = collections.defaultdict(set)
    for src, dst in list(curation.ROOT_ALIASES.items()) + list(origin.alias.items()):
        # A language-qualified alias key names a page, not a surface form.
        src = src.split(":", 1)[1] if ":" in src else src
        if dst in roots and src != roots[dst]["form"] \
                and src != norm_key(dst.split(":", 1)[0], roots[dst]["form"]):
            alt[dst].add(src)
    for key, forms in alt.items():
        roots[key]["alt"] = sorted(forms)[:MAX_ALT]

    # ---- the anchor's own breakdown (owner decision 2026-09-01) ---------
    # Recursion stops at an anchor, so every row naming one reads shallower
    # than the source: access reads accēdō + -tus, and ad- + cēdō appeared
    # nowhere. The anchor's card carries that split itself, as `parts` in
    # the org.parts shape, produced by the same flatten() the word rows use:
    # recursion stops at other anchors, affixes stay terminal, and a part
    # whose root does not ship stays inert with its form alone. A node the
    # chip cap kept whole carries its parts the same way (review finding 4,
    # 2026-09-05). Nothing else carries the field, and the runtime family
    # index credits a root through the cards that name it (lookup.js
    # buildFamilyIndex), so cēdō still lists access.
    for key, r in roots.items():
        flat = card_parts.get(key)
        if not flat:
            continue
        parts = []
        for form, rkey in flat:
            part = {"f": form}
            if rkey and rkey in roots:
                part["r"] = rkey
            parts.append(part)
        r["parts"] = parts
        c["rootparts"] += 1

    # `src` on an English affix: the Latin or Greek lemma its own chain
    # reaches, when that lemma ships a card of its own.
    for key, r in roots.items():
        if r["lang"] != "en":
            continue
        a = affixes.get(key.split(":", 1)[1])
        if not a or not a["src"]:
            continue
        # src names one lemma card, so it takes the settled key rather than
        # a decomposition.
        s = origin.settle(a["src"][0], a["src"][1])
        s = curation.ROOT_ALIASES.get(s) or (a["src"][0] + ":" + s if s else None)
        if s and s in roots and s != key:
            r["src"] = s
            c["src"] += 1

    # ---- references to keys that carry no card render inert ---------------
    for wl, w in shipped.items():
        for m in w.get("morphs") or ():
            if m.get("r") and m["r"] not in roots:
                del m["r"]
                c["inert"] += 1
        org = w.get("org")
        if org and "parts" in org:
            for p in org["parts"]:
                if p.get("r") and p["r"] not in roots:
                    del p["r"]
                    c["inertpart"] += 1
            if not any(p.get("r") for p in org["parts"]):
                # Every part is a skip: the lemma stays whole instead.
                key = org["lang"] + ":" + norm_key(org["lang"], org["l"])
                if key in roots:
                    w["org"] = {"r": key, "f": roots[key]["form"]}
                    c["orgwhole"] += 1
                else:
                    del w["org"]
                    c["orgdrop"] += 1
        elif org and org.get("r"):
            if org["r"] not in roots:
                del w["org"]
                c["orgdrop"] += 1
            else:
                org["f"] = roots[org["r"]]["form"]
    return roots, c


# ---------------------------------------------------------------- emit

def write_json(name, obj):
    path = os.path.join(OUT, name)
    # sort_keys makes the build byte-deterministic: every object here is a
    # lookup table whose key order is meaningless, while the one piece of
    # ORDER-BEARING data (a word's senses and morphs) lives in arrays, which
    # sort_keys never touches. Without it, set-iteration order (randomized
    # per run) leaks into dict insertion order and rebuilds produce noisy git
    # diffs of reordered-but-identical data.
    data = json.dumps(obj, ensure_ascii=False, separators=(",", ":"),
                      sort_keys=True)
    with open(path, "w", encoding="utf-8", newline="") as fh:   # utf-8, no BOM
        fh.write(data)
    return os.path.getsize(path)


# ---------------------------------------------------------------- verify

def show_fo(k, words):
    w = words.get(k)
    if not w:
        return "MISSING"
    return "fo=%s, first def %r" % (w.get("fo"), w["senses"][0]["defs"][0][:60])


def show_org(org):
    """An org row as one readable line, for the build report."""
    if not org:
        return "-"
    if "parts" in org:
        return "%s = %s" % (org["l"], " + ".join(
            p["f"] + ("[" + p["r"] + "]" if p.get("r") else "")
            for p in org["parts"]))
    if org.get("r"):
        return org["r"]
    return "%s:%s (row-only)" % (org.get("lang"), org.get("f"))


def org_roots(org):
    """Root keys an org row references, whichever shape it takes."""
    if not org:
        return ()
    if "parts" in org:
        return [p["r"] for p in org["parts"] if p.get("r")]
    return [org["r"]] if org.get("r") else []


def root_closure(roots):
    """key -> the set of root keys a credit to `key` also credits.

    A root, plus every root its `parts` name, recursively through nested
    anchors. Cycle-safe: a key is visited once. Memoised per call site,
    since verify asks for the same few thousand keys many times over.
    """
    memo = {}

    def closure(key):
        found = memo.get(key)
        if found is not None:
            return found
        out = set()
        stack = [key]
        while stack:
            k = stack.pop()
            if k in out:
                continue
            out.add(k)
            for p in (roots.get(k) or {}).get("parts") or ():
                if p.get("r"):
                    stack.append(p["r"])
        memo[key] = out
        return out
    return closure


def family_index(words, roots):
    """root key -> word keys, the index the service worker derives at runtime.

    A mirror, not a second implementation: lookup.js buildFamilyIndex is the
    authority for this shape and this counting rule. A word credits a root
    once, however many of its morphs name it, and an org row credits it the
    same way. A credit to an anchor is also a credit to every root the
    anchor's `parts` name, recursively (owner decision 2026-09-01): access
    names accēdō, accēdō names cēdō, so access is in cēdō's family. Verify
    has to see the families the reader will see.

    The ship threshold in link_and_prune stays on DIRECT credits and does
    not read this.
    """
    through = root_closure(roots)
    idx = collections.defaultdict(list)
    for k, w in words.items():
        credited = set()
        for m in w.get("morphs") or ():
            if m.get("r"):
                credited |= through(m["r"])
        for r in org_roots(w.get("org")):
            credited |= through(r)
        for r in sorted(credited):
            idx[r].append(k)
    return idx


RE_LANG_NAME_TABLE = re.compile(r"var LANG_NAME = \{(.*?)\};", re.S)
RE_LANG_NAME_KEY = re.compile(r"(?:\"([^\"]+)\"|([A-Za-z_][\w]*))\s*:")
CONTENT_JS = os.path.join(ROOT, "extension", "content", "content.js")


def extension_lang_names():
    """The codes the extension's LANG_NAME table covers, read off content.js.

    The extension holds the one copy of the table (the content script is a
    classic script and cannot import it), and the build checks every code
    it emits against that copy, the loud-failure pattern of the census gate.
    """
    if not os.path.exists(CONTENT_JS):
        return None
    with open(CONTENT_JS, encoding="utf-8") as fh:
        m = RE_LANG_NAME_TABLE.search(fh.read())
    if not m:
        return None
    return {a or b for a, b in RE_LANG_NAME_KEY.findall(m.group(1))}


def verify(words_obj, roots_obj, forms_obj, anchors=None, splits=None,
           harvest=None, carry=None):
    """Spot-check the emitted data. Returns the number of failed checks.

    `anchors` is the source-lemma anchor set the build computed, `carry`
    the nodes the chip cap kept whole, and `splits` the subset of both
    whose lemma decomposes in its own extract. A `--verify` run reads the
    JSON and nothing else, so it has none of these and the anchor checks
    are not run there. `harvest` carries the attachments, for the
    never-silent check.
    """
    words = words_obj["words"]
    roots = roots_obj["roots"]
    fmap = forms_obj["map"]
    idx = family_index(words, roots)
    checks = []

    def add(name, ok, detail):
        checks.append((name, bool(ok), detail))

    def morphs_of(k):
        w = words.get(k)
        return [m["f"] for m in (w.get("morphs") or ())] if w else None

    def show(k):
        w = words.get(k)
        if not w:
            return "MISSING"
        return json.dumps({"morphs": w.get("morphs"), "fr": w.get("fr"),
                           "org": w.get("org")}, ensure_ascii=False)

    # ---- split anchors -------------------------------------------------
    for k, want in (("information", ["inform", "-ation"]),
                    ("security", ["secure", "-ity"]),
                    ("television", ["tele-", "vision"]),
                    ("impossible", ["im-", "possible"]),
                    ("music", ["muse", "-ic"])):
        add("%s = %s" % (k, " + ".join(want)), morphs_of(k) == want, show(k))

    add("subterranean breakdown contains a terra-rooted morpheme",
        any(m.get("r") == "la:terra"
            for m in (words.get("subterranean") or {}).get("morphs") or ()),
        show("subterranean"))

    mu = [m for m in (words.get("music") or {}).get("morphs") or ()
          if m["f"] == "muse"]
    add("music links muse as a word chip", bool(mu) and mu[0].get("w") == "muse",
        show("music"))

    # Splits the etymon tree supplies and no plain template does (owner
    # ruling 2026-08-25).
    for k, want in (("abolitionism", ["abolition", "-ism"]),
                    ("absentee", ["absent", "-ee"])):
        add("%s = %s (etymon-sourced)" % (k, " + ".join(want)),
            morphs_of(k) == want, show(k))

    add("beautiful = beauty + -ful with en:-ful shipping",
        morphs_of("beautiful") == ["beauty", "-ful"] and "en:-ful" in roots,
        "%s | en:-ful=%s" % (show("beautiful"),
                             json.dumps(roots.get("en:-ful"), ensure_ascii=False)))

    unfam = idx.get("en:un-") or ()
    add("en:un- ships with a family of 5 or more",
        "en:un-" in roots and len(unfam) >= 5,
        "family %d, e.g. %s" % (len(unfam), ", ".join(sorted(unfam)[:8])))

    # ---- root anchors --------------------------------------------------
    terra = roots.get("la:terra")
    fam = set(idx.get("la:terra") or ())
    add("la:terra ships with a land gloss",
        terra is not None and "land" in (terra.get("gloss") or "").lower(),
        json.dumps(terra, ensure_ascii=False) if terra else "MISSING")
    # ---- base routing ---------------------------------------------------
    def chip(k, form):
        for m in (words.get(k) or {}).get("morphs") or ():
            if m["f"].lower() == form:
                return m
        return None

    sc = chip("subscribe", "scribe")
    scfam = set(idx.get("la:scribo") or ())
    add("subscribe routes its scribe chip to la:scribo",
        sc is not None and sc.get("r") == "la:scribo" and not sc.get("w"),
        json.dumps(sc, ensure_ascii=False))
    add("la:scribo family holds subscribe and describe",
        "subscribe" in scfam and "describe" in scfam,
        "family %d: %s" % (len(scfam), ", ".join(sorted(scfam)[:10])))

    lx = chip("relax", "lax")
    add("relax routes its lax chip to la:laxo",
        lx is not None and lx.get("r") == "la:laxo" and not lx.get("w"),
        json.dumps(lx, ensure_ascii=False))

    pd = chip("append", "pend")
    add("append routes its pend chip to la:pendo (was inert)",
        pd is not None and pd.get("r") == "la:pendo",
        json.dumps(pd, ensure_ascii=False))

    # The gate. These four spell a routed base and mean the English word:
    # the harbour, the lake view, the noise, the flow. None has a chain
    # reaching the Latin verb, so none routes. Verified 2026-08-25:
    # claimant, flexible and scribble DO route, because their own chains run
    # through clāmō, flectō and scribillāre.
    guards = ("airport", "lakeview", "soundboard", "undercurrent")
    kept = [k for k in guards
            if any(m.get("w") for m in (words.get(k) or {}).get("morphs") or ())]
    add("base routes stay off words whose chain does not reach the root",
        len(kept) == len(guards),
        "%d of %d keep their word chip: %s"
        % (len(kept), len(guards), ", ".join(kept)))

    missing = sorted(v for v in set(curation.BASE_ROUTES.values())
                     if v not in roots)
    add("every BASE_ROUTES target ships as a root", not missing,
        "%d missing%s" % (len(missing),
                          (": " + ", ".join(missing)) if missing else ""))

    # ---- the FROM LATIN row --------------------------------------------
    def org_of(k):
        return (words.get(k) or {}).get("org")

    mem = org_of("memory")
    add("memory carries a decomposed org: memoria = memor + -ia",
        bool(mem) and mem.get("l") == "memoria" and mem.get("lang") == "la"
        and [p["f"] for p in mem["parts"]] == ["memor", "-ia"]
        and mem["parts"][0].get("r") == "la:memor",
        json.dumps(mem, ensure_ascii=False))

    # absolvō records its split under `etymon` rather than `ety`, so absolute
    # shipped a single "From Latin absolvō" row while absolution beside it
    # decomposed (owner field report 2026-08-25).
    ab = org_of("absolute")
    add("absolute carries a decomposed org on an absolv- lemma",
        bool(ab) and "parts" in ab and ab.get("lang") == "la"
        and "absolv" in ab.get("l", "")
        and any(p["f"].startswith("ab") for p in ab["parts"])
        and any(p.get("r") == "la:solvo" for p in ab["parts"]),
        json.dumps(ab, ensure_ascii=False))

    # dissolve and resolve are NOT here and cannot be: they carry English
    # morphs (dis- + solve), so they take no org row, and their base chip is
    # the English word solve, which the base-routing measurement classified
    # as a free base and the owner ratified as one. Verified 2026-08-25.
    solfam = set(idx.get("la:solvo") or ())
    add("la:solvo ships with absolute, absolve and solution in its family",
        "la:solvo" in roots and {"absolute", "absolve", "solution"} <= solfam,
        "family %d: %s" % (len(solfam), ", ".join(sorted(solfam)[:10])))

    terr = org_of("territory")
    add("territory upgrades to a decomposed org: territōrium = terra + -tōrium",
        bool(terr) and "parts" in terr
        and [p.get("r") for p in terr["parts"]] == ["la:terra", "la:-torium"],
        json.dumps(terr, ensure_ascii=False))

    memfam = set(idx.get("la:memor") or ())
    add("la:memor ships with memory and remember in its family",
        "la:memor" in roots and "memory" in memfam and "remember" in memfam,
        "family %d: %s" % (len(memfam), ", ".join(sorted(memfam)[:10])))

    # Latin and Greek affix pages are root nodes now, reached through org
    # parts, with their kind from the entry pos exactly as en: affixes take
    # theirs.
    for key, kind in (("la:re-", "prefix"), ("la:-torium", "suffix")):
        r = roots.get(key)
        add("%s ships as a %s root node" % (key, kind),
            r is not None and r.get("kind") == kind,
            json.dumps(r, ensure_ascii=False) if r else "MISSING")

    # ---- anchors ship, and nothing that names one is inert --------------
    # The invariant the parts-only reach rule buys (owner decision
    # 2026-09-01). An anchor has ORG_ANCHOR_MIN part-reaches, every one of
    # which credits it, so it clears the 2-word root threshold; recursion
    # stopping at a lemma that never ships is what left hesitation with a
    # dead haesitō chip.
    if anchors is not None:
        # A word reaches the lemma it attaches to as well as that lemma's
        # parts (review finding 4, 2026-09-05), so an anchor two words
        # attach to and no row names as a part (basilica and basilic on
        # βασιλικός, whose rows read βασιλεύς + -ικός) gates nothing and
        # needs no card. The invariant is on the anchors a row or a card
        # names.
        skipped = set(curation.ROOT_SKIPS)
        named_parts = set()
        for w in words.values():
            org = w.get("org") or {}
            for p in org.get("parts") or ():
                named_parts.add(p.get("r") or
                                (org.get("lang") + ":" + norm_key(org["lang"], p["f"])))
        for r in roots.values():
            for p in r.get("parts") or ():
                named_parts.add(p.get("r") or (r["lang"] + ":" + norm_key(r["lang"], p["f"])))
        want = sorted(k for k in anchors if k not in skipped
                      and k not in curation.ROOT_ALIASES and k in named_parts)
        unshipped = [k for k in want if k not in roots]
        add("every anchor lemma a row or a card names as a part ships as a "
            "root card", not unshipped,
            "%d anchors, %d named as a part, %d unshipped%s"
            % (len(anchors), len(want), len(unshipped),
               (": " + ", ".join(unshipped[:8])) if unshipped else ""))

        # Only an org part can name an anchor by spelling: it carries the
        # source-language headword flattening put there. A morph chip is an
        # English surface string, and it names a root only through `r`,
        # which the dangling-root check already covers. Reading a chip's
        # spelling instead would call bulla, carō and fīnis references to
        # the Latin cards they are not.
        dead = []
        for k, w in sorted(words.items()):
            org = w.get("org") or {}
            lang = org.get("lang")
            for p in org.get("parts") or ():
                if p.get("r"):
                    continue
                if lang + ":" + norm_key(lang, p["f"]) in anchors:
                    dead.append("%s org part %s" % (k, p["f"]))
        chipped = {m["r"] for w in words.values()
                   for m in (w.get("morphs") or ()) if m.get("r")}
        dead += ["morph chip root %s" % r for r in sorted(chipped & anchors)
                 if r not in roots]
        add("no org part or morph chip naming an anchor is inert", not dead,
            "%d inert anchor references%s"
            % (len(dead), (": " + "; ".join(dead[:8])) if dead else ""))

    # ---- anchor root cards carry their own breakdown -------------------
    # (owner decision 2026-09-01.) `parts` on a root is the org.parts shape
    # and follows its contract: every `r` is a shipped root, and only an
    # anchor or a node the chip cap kept whole carries the field (review
    # finding 4, 2026-09-05), since only those stop recursion and hide a
    # split from the rows above them. Most anchors are base lemmas with no
    # split of their own (cēdō, θεός), and those carry no parts.
    badpart = sorted(
        k for k, r in roots.items()
        for p in r.get("parts") or ()
        if not isinstance(p, dict) or not p.get("f")
        or (p.get("r") and p["r"] not in roots))
    withparts = sorted(k for k, r in roots.items() if r.get("parts"))
    add("every r inside a root's parts exists in roots.json, every part has an f",
        not badpart and all(len(roots[k]["parts"]) >= 2 for k in withparts),
        "%d roots carry parts, %d bad%s"
        % (len(withparts), len(badpart),
           (": " + ", ".join(badpart[:5])) if badpart else ""))
    if anchors is not None:
        carriers = set(anchors) | set(carry or ())
        stray = sorted(k for k in withparts if k not in carriers)
        add("only anchors and nodes the chip cap kept whole carry parts", not stray,
            "%d anchors, %d carried; %d other roots with parts%s"
            % (len(anchors), len(carry or ()), len(stray),
               (": " + ", ".join(stray[:5])) if stray else ""))
        want = sorted(k for k in (splits or ()) if k in roots)
        bare = [k for k in want if not roots[k].get("parts")]
        extra = sorted(k for k in withparts if k not in (splits or ()))
        add("every anchor or carried node whose lemma decomposes carries "
            "parts, and no other",
            not bare and not extra,
            "%d anchors and carried nodes, %d decompose, %d of those bare, "
            "%d carry parts without a split%s"
            % (len(carriers), len(want), len(bare), len(extra),
               (": " + ", ".join((bare + extra)[:5])) if bare or extra else ""))

    acc = roots.get("la:accedo") or {}
    add("la:accedo carries parts reading ad- + cēdō, both linked",
        [p.get("r") for p in acc.get("parts") or ()] == ["la:ad-", "la:cedo"],
        json.dumps(acc, ensure_ascii=False))
    cedfam = set(idx.get("la:cedo") or ())
    add("la:cedo's family reaches access, concede and precede through "
        "their anchors",
        {"access", "concede", "precede"} <= cedfam,
        "family %d: %s" % (len(cedfam), ", ".join(sorted(cedfam)[:10])))

    # The curated lemma step (LEMMA_STEPS): dēpōnēns steps to dēpōnō.
    dep = org_of("deponent")
    add("deponent carries a decomposed org: dēpōnō = dē- + pōnō",
        bool(dep) and dep.get("l") == "dēpōnō"
        and [p.get("r") for p in dep["parts"]] == ["la:de-", "la:pono"],
        json.dumps(dep, ensure_ascii=False))

    # Two rows the parts-only reach rule left with a dead first chip at
    # ORG_ANCHOR_MIN 3, restored at 2: fornix and τάσσω are anchors now.
    for k, form, key in (("fornicate", "fornix", "la:fornix"),
                         ("tactic", "τάσσω", "grc:τάσσω")):
        o = org_of(k) or {}
        hit = [p for p in o.get("parts") or () if p["f"] == form]
        add("%s links its %s part" % (k, form),
            bool(hit) and hit[0].get("r") == key,
            json.dumps(o, ensure_ascii=False))

    # A split naming the lemma itself is no split (owner decision
    # 2026-09-01): errō = errō + -ō stays whole.
    selfpart = sorted(
        k for k, w in words.items()
        if any(la_key(p["f"]) == la_key(w["org"]["l"])
               for p in (w.get("org") or {}).get("parts") or ()))
    add("no org row names its own lemma as a part", not selfpart,
        "%d offenders%s" % (len(selfpart),
                            (": " + ", ".join(selfpart[:5])) if selfpart else ""))

    orgparts = [k for k, w in words.items()
                if (w.get("org") or {}).get("parts")]
    add("every decomposed org keeps at least one navigable part",
        all(any(p.get("r") for p in words[k]["org"]["parts"])
            for k in orgparts),
        "%d decomposed org rows" % len(orgparts))

    add("la:terra family contains terrain and territory",
        "terrain" in fam and "territory" in fam,
        "family %d words, terrain=%s territory=%s, e.g. %s"
        % (len(fam), "terrain" in fam, "territory" in fam,
           ", ".join(sorted(fam)[:8])))

    # ---- curation and suppression --------------------------------------
    add("understand ships with no morphs (BLOCKED_SPLITS)",
        "understand" in words and not words["understand"].get("morphs"),
        show("understand"))
    # had ships. Its -ed split is inflectional and its auxiliary senses are
    # its own, so it is a word and not a forms.json row. Which of the two it
    # is has to be asserted: a check reading "ships or resolves" passes
    # either way and pins nothing (review finding 2026-08-24).
    add("had ships as a word with no morphs, and is no forms.json key",
        "had" in words and not words["had"].get("morphs")
        and "had" not in fmap,
        "forms[had]=%s words[had]=%s fo=%s"
        % (fmap.get("had"), show("had"), (words.get("had") or {}).get("fo")))
    add("running ships as a word with no morphs (inflectional -ing)",
        "running" in words and not words["running"].get("morphs"),
        show("running"))
    add("ran ships as a word and carries fo run",
        "ran" in words and words["ran"].get("fo") == "run" and "run" in words,
        show_fo("ran", words))
    add("running carries fo run as well (it ships, so forms.json cannot)",
        (words.get("running") or {}).get("fo") == "run",
        show_fo("running", words))

    # ---- fo from a mixed page -------------------------------------------
    # Pages that define lemma senses beside inflection senses. The per-entry
    # harvest cannot see these, and they are the commonest shadow words in
    # the language.
    for form, lemma in (("is", "be"), ("had", "have"), ("teeth", "tooth"),
                        ("people", "person")):
        add("%s carries fo %s (mixed page)" % (form, lemma),
            (words.get(form) or {}).get("fo") == lemma and lemma in words,
            show_fo(form, words))

    # ---- form-of is inflection only ------------------------------------
    # The short words the extract hands an alt_of link: an Early Modern
    # spelling (the -> thee), a pronunciation spelling (a -> to), and two
    # initialisms (of -> outfield, it -> intrathecal). None is an
    # inflection, so none is a mapping.
    for k in ("the", "a", "of", "it"):
        add("%s carries no fo" % k,
            k in words and not words[k].get("fo"), show_fo(k, words))

    # don't is a contraction, and its one form-of-shaped sense is an alt_of
    # ("Contraction of done + it"), so nothing may redirect it to done. It
    # does not ship: the frequency corpus splits contractions into don + 't,
    # so no apostrophe token is attested anywhere in it and the attestation
    # gate keeps every contraction out of the dictionary.
    add("don't never redirects to done",
        fmap.get("don't") is None
        and (words.get("don't") or {}).get("fo") is None,
        "forms[don't]=%s words[don't]=%s"
        % (fmap.get("don't"), "shipped" if "don't" in words else "not shipped"))

    for key in ("en:-ness", "en:-ly", "en:-y"):
        r = roots.get(key)
        add("%s carries its curated gloss" % key,
            r is not None and r.get("gloss") == curation.ROOT_GLOSSES.get(key),
            json.dumps(r, ensure_ascii=False) if r else "MISSING")

    for form, lemma in (("territories", "territory"), ("walked", "walk"),
                        ("children", "child")):
        add("%s resolves to %s via forms.json" % (form, lemma),
            fmap.get(form) == lemma and lemma in words,
            "forms[%s]=%s, %s shipped=%s"
            % (form, fmap.get(form), lemma, lemma in words))

    # ---- the alternative-spelling exception -----------------------------
    # SPEC pins favorite and neighbor here, but the US-primary rule ratified
    # after it re-keys both, so those two now anchor in the other direction
    # (below) and the exception is pinned on pairs the re-key leaves alone.
    # e-mail is the SPEC's own rationale example; okay is the commonest key
    # the exception recovers, at rank 76.
    for form, lemma in (("e-mail", "email"), ("okay", "ok")):
        add("%s resolves to %s via forms.json" % (form, lemma),
            fmap.get(form) == lemma and lemma in words,
            "forms[%s]=%s, %s shipped=%s"
            % (form, fmap.get(form), lemma, lemma in words))

    # The negatives the exception must not reopen. Each is an alt_of page
    # whose relation is not a spelling: an Early Modern form (the), a
    # pronunciation spelling (a), an abbreviation (of), a suffixation
    # recorded as a variant (yeah).
    for k in ("the", "a", "of", "yeah"):
        add("%s maps to nothing" % k, fmap.get(k) is None,
            "forms[%s]=%s, shipped=%s" % (k, fmap.get(k), k in words))

    # An inflection outranks a spelling on the same surface.
    for form, lemma, other in (("canceled", "cancel", "cancelled"),
                               ("flier", "fly", "flyer")):
        add("%s resolves to %s, not to %s (inflection outranks spelling)"
            % (form, lemma, other),
            fmap.get(form) == lemma,
            "forms[%s]=%s" % (form, fmap.get(form)))

    # ---- US-primary re-keying -------------------------------------------
    for us, brit in (("favorite", "favourite"), ("neighbor", "neighbour")):
        w = words.get(us)
        add("%s is a words.json key carrying wik %s" % (us, brit),
            w is not None and w.get("wik") == brit and brit not in words,
            "words[%s] wik=%s, %s shipped=%s"
            % (us, (w or {}).get("wik"), brit, brit in words))
        add("%s maps to %s in forms.json" % (brit, us),
            fmap.get(brit) == us,
            "forms[%s]=%s" % (brit, fmap.get(brit)))

    # The gloss-prefix extension: pages whose spelling statement lives in
    # prose only. humor reads "US spelling of humour" under a bare US tag.
    for form, lemma in (("enquiry", "inquiry"), ("dialog", "dialogue")):
        add("%s resolves to %s (gloss-prefix extension)" % (form, lemma),
            fmap.get(form) == lemma and lemma in words,
            "forms[%s]=%s, %s shipped=%s"
            % (form, fmap.get(form), lemma, lemma in words))

    # An inflection whose lemma is itself only a spelling, chased one hop at
    # build time so the shipped map stays single hop.
    for form, lemma in (("recognises", "recognize"),
                        ("apologised", "apologize"),
                        ("criticising", "criticize")):
        add("%s resolves to %s (chased through a spelling)" % (form, lemma),
            fmap.get(form) == lemma and lemma in words,
            "forms[%s]=%s, %s shipped=%s"
            % (form, fmap.get(form), lemma, lemma in words))

    # The mirror class: an inflection whose lemma was re-keyed to its US
    # spelling. The rename map repoints these, it does not chase them.
    add("favourites resolves to favorite (lemma re-keyed under it)",
        fmap.get("favourites") == "favorite" and "favorite" in words,
        "forms[favourites]=%s" % fmap.get("favourites"))

    hu = words.get("humor")
    add("humor is a words.json key carrying wik humour",
        hu is not None and hu.get("wik") == "humour" and "humour" not in words,
        "words[humor] wik=%s, forms[humour]=%s"
        % ((hu or {}).get("wik"), fmap.get("humour")))

    # The rank follows the headword after a re-key.
    fav = words.get("favorite") or {}
    add("favorite carries an Everyday rank (fr at or under 3,000)",
        fav.get("fr") is not None and fav["fr"] <= 3000,
        "favorite fr=%s" % fav.get("fr"))

    rekeyed = sorted(k for k, w in words.items() if w.get("wik"))
    badwik = [k for k in rekeyed
              if words[k]["wik"] in words or fmap.get(words[k]["wik"]) != k]
    add("every re-keyed word owns its Wiktionary page and its old spelling",
        not badwik,
        "%d re-keyed, %d broken%s"
        % (len(rekeyed), len(badwik),
           (": " + ", ".join(badwik[:5])) if badwik else ""))

    # ---- rank charset ---------------------------------------------------
    hyphenated = sorted(k for k in words if "-" in k)
    xr = words.get("x-ray")
    add("x-ray ships (the rank table admits hyphenated words)",
        xr is not None and xr.get("fr") is not None and xr["fr"] <= RANK_CAP,
        "x-ray fr=%s; %d hyphenated words ship, e.g. %s"
        % ((xr or {}).get("fr"), len(hyphenated), ", ".join(hyphenated[:6])))

    # ---- root kind ------------------------------------------------------
    o = roots.get("en:-o-")
    add("en:-o- ships with kind infix (an interfix page, not a suffix)",
        o is not None and o.get("kind") == "infix",
        json.dumps(o, ensure_ascii=False) if o else "MISSING")

    # ---- data invariants -----------------------------------------------
    both = [k for k, w in words.items() if w.get("morphs") and w.get("org")]
    add("no words.json entry carries both morphs and org", not both,
        "%d offenders%s" % (len(both), (": " + ", ".join(both[:5])) if both else ""))

    rw = [k for k, w in words.items()
          if any(m.get("r") and m.get("w") for m in (w.get("morphs") or ()))]
    add("no morph carries both r and w", not rw,
        "%d offenders%s" % (len(rw), (": " + ", ".join(rw[:5])) if rw else ""))

    # Never silent (owner decision 2026-09-05): there is no credit threshold,
    # so every referenced root ships and a one-word family is a valid card.
    # The old "no root under 2 distinct referencing words" line is
    # superseded; what is asserted instead is that no root ships unreferenced.
    orphan = [k for k in roots if not idx.get(k)]
    add("every root card has a family of at least one word", not orphan,
        "%d orphans%s; %d one-word families"
        % (len(orphan), (": " + ", ".join(sorted(orphan)[:5])) if orphan else "",
           sum(1 for k in roots if len(idx.get(k) or ()) == 1)))

    # ---- the source-graph anchors (2026-09-05) --------------------------
    def parts_of(k):
        o = org_of(k) or {}
        return [p["f"] for p in o.get("parts") or ()]

    def linked_of(k):
        o = org_of(k) or {}
        return [p.get("r") for p in o.get("parts") or ()]

    ms = org_of("manuscript")
    add("manuscript carries manūscrīptus = manus + scrībō, both linked",
        bool(ms) and ms.get("l") == "manūscrīptus"
        and parts_of("manuscript") == ["manus", "scrībō"]
        and linked_of("manuscript") == ["la:manus", "la:scribo"],
        json.dumps(ms, ensure_ascii=False))

    ida = org_of("idea")
    add("idea carries a single row naming grc:ἰδέα, and that root ships",
        bool(ida) and ida.get("r") == "grc:ἰδέα" and "grc:ἰδέα" in roots,
        "%s | root=%s" % (json.dumps(ida, ensure_ascii=False),
                          json.dumps(roots.get("grc:ἰδέα"), ensure_ascii=False)))
    add("grc:ἰδέα carries a romanization",
        bool((roots.get("grc:ἰδέα") or {}).get("rom")),
        json.dumps(roots.get("grc:ἰδέα"), ensure_ascii=False))

    sy = org_of("system")
    add("system carries σύστημα decomposed: συν- + ἵστημι + -μα",
        bool(sy) and sy.get("l") == "σύστημα" and sy.get("lang") == "grc"
        and parts_of("system") == ["συν-", "ἵστημι", "-μα"],
        json.dumps(sy, ensure_ascii=False))

    # The Greek page splits περίοδος as περῐ́ + ὁδός: the preposition περί,
    # reached through the length-mark rule, not the prefix page περι-.
    pe = org_of("period")
    add("period carries περίοδος = περί + ὁδός",
        bool(pe) and pe.get("l") == "περίοδος"
        and parts_of("period") == ["περί", "ὁδός"]
        and all(linked_of("period")),
        json.dumps(pe, ensure_ascii=False))

    cu = org_of("curious")
    add("curious carries cūriōsus = cūra + -ōsus",
        bool(cu) and cu.get("l") == "cūriōsus"
        and parts_of("curious") == ["cūra", "-ōsus"],
        json.dumps(cu, ensure_ascii=False))

    so = org_of("sock")
    sofam = idx.get("la:soccus") or ()
    add("sock carries a single row naming la:soccus, shipped with a family "
        "of at least one",
        bool(so) and so.get("r") == "la:soccus" and "la:soccus" in roots
        and len(sofam) >= 1,
        "%s | family %s" % (json.dumps(so, ensure_ascii=False), list(sofam)[:4]))

    sk = org_of("sky")
    add("sky carries a row-only single row with lang non and no r",
        bool(sk) and sk.get("lang") == "non" and "r" not in sk
        and "parts" not in sk and sk.get("f") == "ský",
        json.dumps(sk, ensure_ascii=False))

    # hesitance attaches now as well, so haesitō is reached by two words and
    # is an anchor: the row stops at it and its card carries haereō + -titō.
    hs = org_of("hesitation")
    ha = roots.get("la:haesito") or {}
    add("hesitation carries haesitātiō = haesitō + -tiō, both linked, and "
        "la:haesito carries parts haereō + -titō",
        bool(hs) and hs.get("l") == "haesitātiō"
        and parts_of("hesitation") == ["haesitō", "-tiō"]
        and all(linked_of("hesitation"))
        and [p.get("r") for p in ha.get("parts") or ()] == ["la:haereo", "la:-tito"],
        "%s | %s" % (json.dumps(hs, ensure_ascii=False),
                     json.dumps(ha, ensure_ascii=False)))

    # ---- row-only rows: the shape and the language names ----------------
    rowonly = {k: w["org"] for k, w in words.items()
               if w.get("org") and "parts" not in w["org"]
               and not w["org"].get("r")}
    badrow = sorted(k for k, o in rowonly.items()
                    if not o.get("lang") or not o.get("f")
                    or set(o) - {"lang", "f", "gloss", "rom"})
    add("every row-only org is {lang, f, gloss?, rom?} with no r", not badrow,
        "%d row-only rows, %d malformed%s"
        % (len(rowonly), len(badrow), (": " + ", ".join(badrow[:5])) if badrow else ""))
    rowcodes = sorted({o["lang"] for o in rowonly.values() if o.get("lang")})
    notrow = [c for c in rowcodes if c not in ROW_ONLY_LANGS]
    add("every row-only code is in the ROW_ONLY_LANGS table", not notrow,
        "%d codes emitted%s" % (len(rowcodes),
                                (", not in the table: " + ", ".join(notrow)) if notrow else ""))
    ext = extension_lang_names()
    if ext is None:
        add("the extension's LANG_NAME table was read", False, "content.js not parsed")
    else:
        need = set(rowcodes) | {"la", "grc", "en"}
        lacking = sorted(need - ext)
        add("the extension's LANG_NAME table covers every emitted code",
            not lacking,
            "%d codes in content.js, %d needed%s"
            % (len(ext), len(need), (", lacking: " + ", ".join(lacking)) if lacking else ""))

    # ---- never silent: every classified origin shows, or is reported -----
    if harvest is not None:
        silent = []
        for k, w in words.items():
            if w.get("morphs") or w.get("org"):
                continue
            att = harvest.get(w.get("wik") or k, {}).get("att")
            if att and "miss" not in att:
                silent.append(k)
        add("no word with a classified origin ships with neither morphs nor "
            "org, except through a drop reported in the misses file",
            not silent,
            "%d silent%s" % (len(silent), (": " + ", ".join(silent[:8])) if silent else ""))

        # A term the page names only in a cognate-family template is never
        # the row (review finding 1, 2026-09-05): know read cognōscō off
        # its cognate list.
        cogrows = []
        for k, w in words.items():
            org = w.get("org")
            if not org:
                continue
            only = harvest.get(w.get("wik") or k, {}).get("cogonly") or ()
            if only and org_row_key(org) in only:
                cogrows.append("%s (%s)" % (k, org_row_key(org)))
        add("no shipped row names a lemma the page carries only in a cognate "
            "template", not cogrows,
            "%d rows%s" % (len(cogrows), (": " + ", ".join(cogrows[:8])) if cogrows else ""))

    KINDS = ("prefix", "suffix", "infix", "circumfix", "root")
    badkind = sorted(k for k, r in roots.items() if r.get("kind") not in KINDS)
    add("every root kind is one of the SPEC enum", not badkind,
        "%d offenders%s" % (len(badkind),
                            (": " + ", ".join(badkind[:5])) if badkind else ""))

    referenced = {m["r"] for w in words.values()
                  for m in (w.get("morphs") or ()) if m.get("r")}
    referenced |= {r for w in words.values() for r in org_roots(w.get("org"))}
    dangling = sorted(referenced - set(roots))
    add("every referenced root key exists in roots.json", not dangling,
        "%d dangling%s" % (len(dangling), (": " + ", ".join(dangling[:5])) if dangling else ""))

    badw = sorted({m["w"] for w in words.values()
                   for m in (w.get("morphs") or ()) if m.get("w")} - set(words))
    add("every word chip points at a shipped word", not badw,
        "%d dangling%s" % (len(badw), (": " + ", ".join(badw[:5])) if badw else ""))

    enroots = [k for k, r in roots.items()
               if r["lang"] == "en" and "-" not in r["form"]
               and r["form"] in words]
    add("roots.json en: keys are affixes and combining forms only",
        not enroots,
        "%d ordinary words as roots%s"
        % (len(enroots), (": " + ", ".join(enroots[:5])) if enroots else ""))

    bad_lang = sorted({k for k in roots if k.split(":", 1)[0]
                       not in ("en", "la", "grc")})
    star = sorted({k for k in roots if "*" in k or "pro" == k.split(":", 1)[0]})
    add("no PIE or reconstructed key anywhere (en/la/grc only)",
        not bad_lang and not star,
        "%d foreign-lang keys, %d starred keys" % (len(bad_lang), len(star)))

    noglos = [k for k, r in roots.items() if not r.get("gloss")]
    add("every root carries a gloss", not noglos,
        "%d without%s" % (len(noglos), (": " + ", ".join(noglos[:5])) if noglos else ""))

    ph = [n for n, o in (("words.json", words_obj), ("roots.json", roots_obj),
                         ("forms.json", forms_obj)) if "placeholder" in o]
    add("no placeholder key on any output", not ph, "offenders: %s" % ph)

    ver = [n for n, o in (("words.json", words_obj), ("roots.json", roots_obj),
                          ("forms.json", forms_obj)) if o.get("v") != 1]
    add("every output carries v=1", not ver, "offenders: %s" % ver)

    self_map = [k for k, v in fmap.items() if k == v or v not in words]
    add("every forms.json target is a shipped word and not itself",
        not self_map,
        "%d offenders%s" % (len(self_map),
                            (": " + ", ".join(self_map[:5])) if self_map else ""))
    shadow = [k for k in fmap if k in words]
    add("no forms.json key is itself a shipped word", not shadow,
        "%d offenders%s" % (len(shadow), (": " + ", ".join(shadow[:5])) if shadow else ""))

    fobad = [k for k, w in words.items()
             if w.get("fo") and (w["fo"] not in words or w["fo"] == k)]
    add("every fo target is a different shipped word", not fobad,
        "%d offenders%s" % (len(fobad), (": " + ", ".join(fobad[:5])) if fobad else ""))

    # ---- no truncation (the rule carries over from Okpyeon) -------------
    cut = []
    for k, w in words.items():
        for sec in w["senses"]:
            for d in sec["defs"]:
                if d.rstrip().endswith("…"):
                    cut.append("words[%s] %r" % (k, d))
    for k, r in roots.items():
        if (r.get("gloss") or "").rstrip().endswith("…"):
            cut.append("roots[%s] %r" % (k, r["gloss"]))
    add("no truncated string anywhere (none ends with U+2026)", not cut,
        ("%d offenders, e.g. %s" % (len(cut), cut[:3])) if cut else
        "checked every def and root gloss; 0 cut")

    # ---- distribution sanity -------------------------------------------
    # The SPEC prints these rather than asserting them: the numbers move
    # with the corpus. The three lines above (morphs+org, thin roots, PIE)
    # are the invariants, and they are asserted.
    capped = [k for k, w in words.items()
              if w.get("fr") is not None and w["fr"] <= RANK_CAP]
    with_morphs = [k for k, w in words.items() if w.get("morphs")]
    capped_morphs = sum(1 for k in capped if words[k].get("morphs"))
    langs = collections.Counter(k.split(":", 1)[0] for k in roots)
    dist = [
        ("total words", format(len(words), ","), "SPEC says around 83k"),
        ("words inside rank 50,000", format(len(capped), ","),
         "SPEC says around 29k"),
        ("breakdown-bearing tail", format(len(words) - len(capped), ","), ""),
        ("words with morphs", format(len(with_morphs), ","), ""),
        ("morphs coverage of capped words",
         "%.1f%% (%s of %s)" % (100.0 * capped_morphs / max(1, len(capped)),
                                format(capped_morphs, ","),
                                format(len(capped), ",")),
         "SPEC says 18 to 25%"),
        ("roots", "%s (en=%s la=%s grc=%s)"
         % (format(len(roots), ","), format(langs["en"], ","),
            format(langs["la"], ","), format(langs["grc"], ",")),
         "SPEC says low thousands, en over la"),
        ("forms", format(len(fmap), ","), ""),
        ("shipped words carrying fo",
         format(sum(1 for w in words.values() if w.get("fo")), ","),
         "shadow lemmas: ran, running"),
        ("root kinds", " ".join(
            "%s=%s" % (k, format(v, ","))
            for k, v in sorted(collections.Counter(
                r["kind"] for r in roots.values()).items())), ""),
        ("hyphenated words", format(sum(1 for k in words if "-" in k), ","),
         "0 before the rank charset fix"),
        ("US-keyed records",
         format(sum(1 for w in words.values() if w.get("wik")), ","),
         "British spelling moved to forms.json"),
    ]

    failed = 0
    log("============= DISTRIBUTION =================")
    for name, value, note in dist:
        log("%-32s %-28s %s" % (name, value, note))
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
    w, r, f = rd("words.json"), rd("roots.json"), rd("forms.json")
    log("words %s | roots %s | forms %s" % (
        format(len(w["words"]), ","), format(len(r["roots"]), ","),
        format(len(f["map"]), ",")))
    return verify(w, r, f)


# ---------------------------------------------------------------- report

def sample_zones(words, seed=20260824):
    """A fixed-seed eyeball sample of the four cap zones.

    The zones are the two halves of the hybrid cap crossed with the split
    that decides the tail: ranked/unranked and split/no-split. Ten words
    from each, printed every build, so a rule change can be judged without
    extra tooling.
    """
    zones = {("ranked", "split"): [], ("ranked", "no-split"): [],
             ("unranked", "split"): [], ("unranked", "no-split"): []}
    for k, w in words.items():
        a = "ranked" if w.get("fr") is not None and w["fr"] <= RANK_CAP else "unranked"
        b = "split" if w.get("morphs") else "no-split"
        zones[(a, b)].append(k)
    rng = random.Random(seed)
    out = []
    for key in sorted(zones):
        pool = sorted(zones[key])
        pick = rng.sample(pool, min(10, len(pool)))
        out.append((key, len(pool), pick))
    return out


def write_report(path=None):
    os.makedirs(CACHE, exist_ok=True)
    with open(path or REPORT_FILE, "w", encoding="utf-8", newline="\n") as fh:
        fh.write("\n".join(REPORT) + "\n")


# ---------------------------------------------------------------- gold set

def load_gold():
    """The gold rows, or [] when the file is absent."""
    if not os.path.exists(GOLD_FILE):
        return []
    with open(GOLD_FILE, encoding="utf-8") as fh:
        return json.load(fh).get("rows") or []


def gold_actual(word, words):
    """What the shipped data says about a gold word, in the gold row shape."""
    w = words.get(word)
    if not w:
        return {"kind": "none"}
    if w.get("morphs"):
        return {"kind": "morphs", "parts": [m["f"] for m in w["morphs"]],
                "inert": [m["f"] for m in w["morphs"]
                          if not m.get("r") and not m.get("w")]}
    org = w.get("org")
    if not org:
        return {"kind": "none"}
    if "parts" in org:
        return {"kind": "decomposed", "lang": org["lang"], "lemma": org["l"],
                "parts": [p["f"] for p in org["parts"]]}
    if org.get("r"):
        return {"kind": "single", "lang": org["r"].split(":", 1)[0],
                "lemma": org.get("f") or org["r"].split(":", 1)[1]}
    return {"kind": "rowonly", "lang": org.get("lang"), "lemma": org.get("f")}


def gold_match(row, actual):
    """Exact match of kind, language, lemma and the ordered part forms."""
    if row.get("kind") != actual.get("kind"):
        return False
    kind = row["kind"]
    if kind == "none":
        return True
    if kind == "morphs":
        return (list(row.get("parts") or []) == list(actual.get("parts") or [])
                and sorted(row.get("inert") or []) == sorted(actual.get("inert") or []))
    if row.get("lang") != actual.get("lang") or row.get("lemma") != actual.get("lemma"):
        return False
    if kind == "decomposed":
        return list(row.get("parts") or []) == list(actual.get("parts") or [])
    return True


def score_gold(words):
    """(matched, total, per-class table, failures) against pipeline/gold.json."""
    rows = load_gold()
    per = collections.OrderedDict()
    failures = []
    matched = 0
    for row in rows:
        kind = row.get("kind", "?")
        actual = gold_actual(row["word"], words)
        ok = gold_match(row, actual)
        n, m = per.get(kind, (0, 0))
        per[kind] = (n + 1, m + (1 if ok else 0))
        if ok:
            matched += 1
        else:
            failures.append((row["word"], row, actual))
    return matched, len(rows), per, failures


def committed_gold_score():
    if not os.path.exists(GOLD_SCORE_FILE):
        return None
    with open(GOLD_SCORE_FILE, encoding="utf-8") as fh:
        return json.load(fh)


def gold_report(words):
    """Print the gold score and return the number of failed gates (0 or 1)."""
    matched, total, per, failures = score_gold(words)
    committed = committed_gold_score()
    log("================ GOLD SET ==================")
    if not total:
        log("no gold rows (pipeline/gold.json absent)")
        return 0
    for kind, (n, m) in per.items():
        log("  %-12s %3d of %3d  (%.0f%% precision)" % (kind, m, n, 100.0 * m / n))
    log("score %d of %d; committed %s"
        % (matched, total, committed.get("score") if committed else "none"))
    for word, row, actual in failures:
        log("  FAIL %-14s expected %s\n                      got      %s"
            % (word, json.dumps(row, ensure_ascii=False),
               json.dumps(actual, ensure_ascii=False)))
    if committed and matched < int(committed.get("score", 0)):
        log("GOLD GATE FAILED: %d under the committed %d"
            % (matched, committed["score"]))
        return 1
    return 0


# ------------------------------------------------ the 2026-09-01 misses

def misses_outcome(words):
    """What each word of the 2026-09-01 misses list renders now.

    Returns ((decomposed, single, nothing), (top10k decomposed, single,
    nothing)) or None when the baseline file is absent. A single here is a
    root-language single row or a row-only row; a decomposed row counts as
    decomposed; a missing card or a card with neither counts as nothing.
    """
    if not os.path.exists(MISSES_BASELINE_FILE):
        return None
    rows = []
    with open(MISSES_BASELINE_FILE, encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            r, w = line.split("\t") if "\t" in line else line.split(None, 1)
            rows.append((int(r), w))
    out = {"all": [0, 0, 0], "top": [0, 0, 0]}
    for r, wl in rows:
        w = words.get(wl)
        org = (w or {}).get("org")
        if w and w.get("morphs"):
            i = 0
        elif org and "parts" in org:
            i = 0
        elif org:
            i = 1
        else:
            i = 2
        out["all"][i] += 1
        if r <= COVERAGE_TOP:
            out["top"][i] += 1
    return tuple(out["all"]), tuple(out["top"]), len(rows)


# ---------------------------------------------------------------- main

def main(argv):
    if "--verify" in argv:
        failed = verify_only()
        # A re-verify must not overwrite the report of the build it checks.
        write_report(VERIFY_REPORT_FILE)
        raise SystemExit(1 if failed else 0)
    force = "--force-download" in argv
    offline = "--offline" in argv
    if force and offline:
        raise SystemExit("--force-download and --offline contradict each other")
    t0 = time.time()
    os.makedirs(CACHE, exist_ok=True)
    os.makedirs(OUT, exist_ok=True)

    log("[1/7] %s"
        % ("reading sources from pipeline/cache (--offline)" if offline
           else "downloading sources into pipeline/cache"))
    download(ENGLISH_URL, ENGLISH_FILE, force, offline)
    download(LATIN_URL, LATIN_FILE, force, offline)
    download(GREEK_URL, GREEK_FILE, force, offline)
    for code in ("fro", "frm", "fr"):
        download(PASS_FILES[code][0], PASS_FILES[code][1], force, offline)
    download(EXTFREQ_URL, EXTFREQ_FILE, force, offline)

    log("[2/7] reading the frequency list")
    ranks = parse_ranks(EXTFREQ_FILE)
    log("  %s ranked tokens (rank 1 = %s)"
        % (format(len(ranks), ","),
           min(ranks, key=ranks.get) if ranks else "-"))

    log("[3/7] surveying the English extract (candidacy, forms, affixes)")
    (cand, chain_only, forms_raw, alt_raw, us_raw, mixed_raw, affixes, tnames,
     lcodes, s1) = survey_english(ENGLISH_FILE, ranks)
    log("  %s lines read; %s candidate words (%s of them tail splits, "
        "%s tail chains still to prove they flatten)"
        % (format(s1["lines"], ","), format(len(cand), ","),
           format(s1["tail_split"], ","), format(len(chain_only), ",")))
    log("  %s inflection pages, %s alternative-spelling pages, %s mixed pages, "
        "%s affix entries"
        % (format(len(forms_raw), ","), format(len(alt_raw), ","),
           format(len(mixed_raw), ","), format(len(affixes), ",")))

    # The gates run here, before the expensive passes: an unclassified
    # template name or language code is a question about how to read the
    # source, and the answer changes what the rest of the build produces.
    census_top = census_gate(tnames)
    n_high = sum(1 for c in tnames.values() if c >= CENSUS_MIN)
    log("  %s distinct template names, %s at or above %s uses, all classified"
        % (format(len(tnames), ","), format(n_high, ","),
           format(CENSUS_MIN, ",")))
    lang_top = language_gate(lcodes)
    n_lhigh = sum(1 for c in lcodes.values() if c >= CENSUS_MIN)
    log("  %s distinct language codes, %s at or above %s uses, all in a role"
        % (format(len(lcodes), ","), format(n_lhigh, ","),
           format(CENSUS_MIN, ",")))

    log("[4/7] building the source graphs and the pass-through tables")
    graphs = {"la": parse_classical(LATIN_FILE, "la"),
              "grc": parse_classical(GREEK_FILE, "grc")}
    for lang in ("la", "grc"):
        st = graphs[lang].stats
        log("  %-3s %s lines, %s nodes, %s step edges, %s alternative-form "
            "pages; splits: %s template, %s etymon, %s prose; refused: %s "
            "template, %s etymon, %s cycle; prose unread %s"
            % (lang, format(st["lines"], ","), format(st["nodes"], ","),
               format(st["steps"], ","), format(st["alt_pages"], ","),
               format(st["split_template"], ","), format(st["split_etymon"], ","),
               format(st["split_prose"], ","), format(st["refused_template"], ","),
               format(st["refused_etymon"], ","), format(st["refused_cycle"], ","),
               format(st["prose_unread"], ",")))
    pages = {}
    for code in ("fro", "frm", "fr"):
        pages[code], n_lines = read_passthrough(PASS_FILES[code][1], code)
        log("  %-3s %s lines, %s pages with an origin" % (
            code, format(n_lines, ","), format(len(pages[code]), ",")))
    origin = Origin(graphs, pages)
    origin.ranks = ranks

    log("[5/7] harvesting senses, splits and attachments")
    harvest, s2 = harvest_english(ENGLISH_FILE, cand, origin)
    log("  %s words with at least one shippable sense (%s senses dropped "
        "over %d chars); %s attach to a root graph, %s row-only, %s name a "
        "classical origin nothing reaches"
        % (format(len(harvest), ","), format(s2["dropped_long"], ","),
           DEF_MAX_CHARS, format(s2["attached"], ","),
           format(s2["rowonly"], ","), format(s2["missed"], ",")))
    for code in ("fro", "frm", "fr"):
        log("  %s %s pass-through pages walked" % (
            format(origin.stats["walked_" + code], ","), code))
    origin.choose_homographs()
    st = origin.stats
    log("  homograph nodes (two or more lemma entries): %s decided by a gloss, "
        "pos or form an English page states, %s by a source page's part gloss, "
        "%s by a named part, %s by the first definition, %s by sense count; "
        "%s changed entry"
        % (format(st["homograph_a"], ","), format(st["homograph_s"], ","),
           format(st["homograph_b"], ","), format(st["homograph_c"], ","),
           format(st["homograph_d"], ","), format(st["homograph_changed"], ",")))

    # ---- curate and cap -----------------------------------------------
    log("[6/7] curating, capping and resolving roots")
    shipped = {}
    pending = {}
    n_forced = n_blocked = n_infl = 0
    for wl, rec in harvest.items():
        raw = rec["sp"]
        parts = accepted_split(wl, rec)
        if wl in curation.FORCED_SPLITS:
            n_forced += 1
        elif raw and not parts:
            if wl in curation.BLOCKED_SPLITS:
                n_blocked += 1
            else:
                n_infl += 1
        # The hybrid cap. Everything inside rank 50,000 ships. Past it a word
        # needs a breakdown to earn a card, and it needs the frequency corpus
        # to have seen it at all: Wiktionary carries about 270,000 affixed
        # coinages (nanovoltmeter, nonradiometric) that no corpus attests,
        # and they are 45 MB of dictionary nobody looks up. Attestation is
        # what lands the total on the size the SPEC predicts.
        rank = ranks.get(wl)
        if rank is None or (rank > RANK_CAP and not parts
                            and wl not in chain_only):
            continue
        senses = [{"pos": p, "defs": rec["defs"][p]} for p in rec["pos"]
                  if rec["defs"][p]]
        if not senses:
            continue
        w = {"senses": senses}
        if rank is not None:
            w["fr"] = rank
        if parts:
            w["morphs"] = [{"f": p} for p in parts]
        elif rec["att"] and "miss" not in rec["att"]:
            pending[wl] = rec["att"]
        shipped[wl] = w
    log("  %s words ship (%s forced splits, %s blocked, %s inflectional "
        "splits suppressed)"
        % (format(len(shipped), ","), format(n_forced, ","),
           format(n_blocked, ","), format(n_infl, ",")))

    # ---- which source lemmas are anchors in their own right --------------
    # A chain-only candidate whose row will not decompose is dropped below,
    # so its attachment is no reach: counting it made 863 anchors that no
    # shipped word names (review finding 4 rebuild, 2026-09-05).
    n_anchor = origin.find_anchors(
        att for wl, att in pending.items()
        if wl not in chain_only or origin.splits(att))
    log("  %s source lemmas are anchors (reached by %d or more words), so "
        "recursion stops at them" % (format(n_anchor, ","), ORG_ANCHOR_MIN))

    org_rows = {}
    for wl, att in pending.items():
        org = origin.resolve(att)
        if org:
            org_rows[wl] = org
    log("  origin rows: %s decomposed, %s single, %s row-only"
        % (format(origin.stats["decomposed"], ","),
           format(origin.stats["single"], ","),
           format(origin.stats["rowonly"], ",")))

    # ---- the chain-only rule, and the linking it feeds -------------------
    # A chain-only candidate earns its card with a DECOMPOSED org row and
    # nothing else (owner decision 2026-09-01). A single "From Latin x" row
    # past the cap is a card with no breakdown on it, which is what the cap
    # exists to keep out. The row that decides is the row as EMITTED, so the
    # test runs after linking as well as before it.
    #
    # Dropping a word changes who credits what, so linking runs again on the
    # smaller set. It terminates because every extra pass removes at least
    # one word from a finite set. A dropped word takes nothing with it: all
    # of this happens before forms.json is assembled, so it credits no root,
    # it is no form target, and it cannot be a forms.json row.
    n_chaindrop = 0
    for wl in list(chain_only):
        if wl in shipped and not (org_rows.get(wl) or {}).get("parts"):
            del shipped[wl]
            n_chaindrop += 1
    passes = 0
    while True:
        passes += 1
        roots, lp = link_and_prune(shipped, org_rows, harvest, origin,
                                   affixes, graphs)
        stale = [wl for wl in chain_only if wl in shipped
                 and not (shipped[wl].get("org") or {}).get("parts")]
        if not stale:
            break
        for wl in stale:
            del shipped[wl]
        n_chaindrop += len(stale)
    log("  chain-only candidates: %s ship on a decomposed org, %s dropped "
        "for want of one (%d linking pass%s)"
        % (format(sum(1 for wl in chain_only if wl in shipped), ","),
           format(n_chaindrop, ","), passes, "" if passes == 1 else "es"))
    log("  %s roots ship (%s src links, %s anchor cards carrying parts); "
        "%s word chips, %s morph chips left inert, %s org parts inert, %s "
        "org rows kept whole, %s org rows dropped, %s repeated morphs "
        "credited once, %s base chips routed to a classical root"
        % (format(len(roots), ","), format(lp["src"], ","),
           format(lp["rootparts"], ","),
           format(lp["wchip"], ","), format(lp["inert"], ","),
           format(lp["inertpart"], ","), format(lp["orgwhole"], ","),
           format(lp["orgdrop"], ","), format(lp["repeat"], ","),
           format(lp["routed"], ",")))

    # ---- forms.json and the shadow-lemma pointer ------------------------
    # A word that ships AND inflects something shadows its lemma: a reader
    # selecting "ran" gets the noun about yarn on a winch, because the key
    # exists and the runtime never reaches its suffix rules. `fo` is the way
    # back to run. Such a word is a shipped word, so it stays out of
    # forms.json by rule; the two fields divide one harvest between them,
    # and inflection_form_of is what admits anything to that harvest.
    # One hop through the spelling map when an inflection lands on a lemma
    # that is itself only a spelling. "recognises" inflects "recognise",
    # which is a row rather than a word, and the shipped map is single hop,
    # so the plural would resolve to nothing while the singular resolved.
    # Chasing here keeps the emitted map single hop and the runtime
    # untouched. One hop only: a chase that does not land on a shipped word
    # drops the form.
    fmap = {}
    n_fo = 0
    n_chased = 0
    for k, v in forms_raw.items():
        if k == v:
            continue
        if v not in shipped:
            v = alt_raw.get(v)
            if v is None or v not in shipped or v == k:
                continue
            n_chased += 1
        if k in shipped:
            shipped[k]["fo"] = v
            n_fo += 1
        else:
            fmap[k] = v
    n_infl = len(fmap)

    # Alternative spellings fill in behind the inflections, and never over
    # them. The two relations collide on 83 surfaces and the inflection is
    # the one the reader means every time: "canceled" is the past of cancel
    # before it is the American spelling of cancelled, and "flier" is a form
    # of fly before it is a spelling of flyer. A shipped word is never a
    # forms.json key, so a spelling that earned its own card keeps it.
    n_alt = 0
    for k, v in alt_raw.items():
        if v not in shipped or k == v or k in shipped or k in fmap:
            continue
        fmap[k] = v
        n_alt += 1

    # Mixed pages, the per-sense half of the fo harvest. These surfaces have
    # cards of their own, so they never reach forms.json: the shadow row on
    # the card is the whole point. A pure form-of page wins when a word has
    # both, since that page is about nothing else.
    n_mixed = 0
    for k, targets in mixed_raw.items():
        if k not in shipped or shipped[k].get("fo"):
            continue
        for t in targets:
            if t != k and t in shipped:
                shipped[k]["fo"] = t
                n_mixed += 1
                break
    log("  %s inflected forms and %s alternative spellings map to a shipped "
        "lemma (%s chased one hop through a spelling), %s shipped words carry "
        "fo (%s from a pure page, %s from a mixed one)"
        % (format(n_infl, ","), format(n_alt, ","), format(n_chased, ","),
           format(n_fo + n_mixed, ","), format(n_fo, ","),
           format(n_mixed, ",")))

    # ---- US-primary re-keying, last of all ------------------------------
    before = {b: shipped[b].get("fr") for u, b in
              [(u, b) for u, b in us_raw.items() if b in shipped]}
    us_pairs = rekey_us_primary(shipped, fmap, us_raw, ranks)
    n_refr = sum(1 for u, b in us_pairs
                 if shipped[u].get("fr") != before.get(b))
    log("  %s records re-keyed to their US spelling (%s pages qualify), "
        "%s took the better rank"
        % (format(len(us_pairs), ","), format(len(us_raw), ","),
           format(n_refr, ",")))
    for us, brit in us_pairs:
        log("      %-18s <- %-18s fr %s -> %s"
            % (us, brit, before.get(brit), shipped[us].get("fr")))

    # ---- emit -----------------------------------------------------------
    log("[7/7] emitting extension/data")
    words_obj = {"v": 1, "words": shipped}
    roots_obj = {"v": 1, "roots": roots}
    forms_obj = {"v": 1, "map": fmap}
    s_w = write_json("words.json", words_obj)
    s_r = write_json("roots.json", roots_obj)
    s_f = write_json("forms.json", forms_obj)

    # ---- report ---------------------------------------------------------
    ranked = [k for k, w in shipped.items() if w.get("fr") is not None
              and w["fr"] <= RANK_CAP]
    n_morphs = sum(1 for w in shipped.values() if w.get("morphs"))
    n_org = sum(1 for w in shipped.values() if w.get("org"))
    n_dec = sum(1 for w in shipped.values() if (w.get("org") or {}).get("parts"))
    n_row = sum(1 for w in shipped.values()
                if w.get("org") and "parts" not in w["org"] and not w["org"].get("r"))
    n_rmorphs = sum(1 for k in ranked if shipped[k].get("morphs"))
    langs = collections.Counter(k.split(":", 1)[0] for k in roots)
    idx = family_index(shipped, roots)
    log("\n================= COUNTS ===================")
    log("words         : %s" % format(len(shipped), ","))
    log("  ranked <=%d: %s" % (RANK_CAP, format(len(ranked), ",")))
    log("  tail (split): %s" % format(len(shipped) - len(ranked), ","))
    log("morphs        : %s words (%.1f%% of all, %.1f%% of ranked)"
        % (format(n_morphs, ","), 100.0 * n_morphs / max(1, len(shipped)),
           100.0 * n_rmorphs / max(1, len(ranked))))
    log("org           : %s words (%.1f%% of all): %s decomposed, %s single, "
        "%s row-only"
        % (format(n_org, ","), 100.0 * n_org / max(1, len(shipped)),
           format(n_dec, ","), format(n_org - n_dec - n_row, ","),
           format(n_row, ",")))
    log("roots         : %s (en=%s la=%s grc=%s); %s anchors; %s nodes the "
        "chip cap kept whole; %s one-word families"
        % (format(len(roots), ","), format(langs["en"], ","),
           format(langs["la"], ","), format(langs["grc"], ","),
           format(len(origin.anchors), ","), format(len(origin.carry), ","),
           format(sum(1 for k in roots if len(idx.get(k) or ()) == 1), ",")))
    kinds = collections.Counter(r["kind"] for r in roots.values())
    log("  by kind     : %s"
        % " ".join("%s=%s" % (k, format(v, ","))
                   for k, v in sorted(kinds.items())))
    log("forms         : %s (%s inflections, %s alternative spellings)"
        % (format(len(fmap), ","), format(n_infl, ","), format(n_alt, ",")))
    log("fo fields     : %s (%s pure pages, %s mixed pages)"
        % (format(n_fo + n_mixed, ","), format(n_fo, ","),
           format(n_mixed, ",")))
    row_langs = collections.Counter(
        w["org"]["lang"] for w in shipped.values()
        if w.get("org") and "parts" not in w["org"] and not w["org"].get("r"))
    log("row-only langs: %s"
        % " ".join("%s=%s" % (k, format(v, ","))
                   for k, v in row_langs.most_common(20)))

    # ---- the graphs, tracked build over build ----------------------------
    log("============ GRAPH COVERAGE ================")
    log("  %-4s %8s %10s %8s %8s %8s %10s %8s" % (
        "lang", "nodes", "decomposed", "template", "etymon", "prose",
        "prose-unread", "neither"))
    for lang in ("la", "grc"):
        g = graphs[lang]
        st = g.stats
        neither = st["nodes"] - st["decomposed"] - st["prose_unread"]
        log("  %-4s %8s %10s %8s %8s %8s %10s %8s" % (
            lang, format(st["nodes"], ","), format(st["decomposed"], ","),
            format(st["split_template"], ","), format(st["split_etymon"], ","),
            format(st["split_prose"], ","), format(st["prose_unread"], ","),
            format(neither, ",")))
    log("  cycles 0, dangling edges 0 (the graph build fails otherwise); "
        "refused splits: la %s, grc %s"
        % (format(len(graphs["la"].refused), ","),
           format(len(graphs["grc"].refused), ",")))

    # ---- coverage, tracked build over build ------------------------------
    # The first line says how much of the band a reader actually meets
    # carries a breakdown of some kind. The second counts the words whose
    # source states a classical origin and whose card shows nothing for it,
    # the shape every breakdown field report has taken. Every one of them
    # goes to the misses file with the reason it shows nothing (SPEC
    # Principle 4), and so does every split the graph refused.
    top_band = [k for k, w in shipped.items()
                if w.get("fr") is not None and w["fr"] <= COVERAGE_TOP]
    covered = [k for k in top_band
               if shipped[k].get("morphs")
               or (shipped[k].get("org") or {}).get("parts")]
    # A re-keyed record was harvested under its British spelling, so the
    # attachment is looked up by the page the record came from.
    misses = []
    for k, w in shipped.items():
        if w.get("morphs") or w.get("org"):
            continue
        att = harvest.get(w.get("wik") or k, {}).get("att")
        if not att:
            continue
        if "miss" in att:
            reason = att["miss"]
        elif "key" in att:
            reason = ("row dropped for %s:%s" % (att["lang"], att["key"]))
        else:
            reason = "row-only row dropped"
        misses.append((w["fr"], k, reason))
    misses.sort()
    with open(MISSES_FILE, "w", encoding="utf-8", newline="\n") as fh:
        for r, k, reason in misses:
            fh.write("%d\t%s\t%s\n" % (r, k, reason))
        fh.write("\n# splits the graphs refused, with the reason\n")
        for lang in ("la", "grc"):
            for k in sorted(graphs[lang].refused):
                fh.write("%s:%s\t%s\n" % (lang, k, graphs[lang].refused[k]))
    reasons = collections.Counter(
        r.split(":", 1)[0] if r.startswith(("la:", "grc:")) else r.split(" (")[0]
        for _, _, r in misses)
    log("=============== COVERAGE ===================")
    log("breakdown coverage, top %s ranks : %.1f%% (%s of %s carry morphs or "
        "a decomposed org)"
        % (format(COVERAGE_TOP, ","),
           100.0 * len(covered) / max(1, len(top_band)),
           format(len(covered), ","), format(len(top_band), ",")))
    log("classical origin, nothing shipped: %s words (list with reasons in %s)"
        % (format(len(misses), ","), os.path.basename(MISSES_FILE)))
    for reason, n in reasons.most_common(8):
        log("    %6s  %s" % (format(n, ","), reason))
    outcome = misses_outcome(shipped)
    if outcome:
        (a_d, a_s, a_n), (t_d, t_s, t_n), n_base = outcome
        log("the %s misses of 2026-09-01 now render: decomposed %s, single %s, "
            "nothing %s (top %s ranks: %s / %s / %s); the spike expected "
            "488 / 1,039 / 225 and 141 / 359 / 53"
            % (format(n_base, ","), format(a_d, ","), format(a_s, ","),
               format(a_n, ","), format(COVERAGE_TOP, ","), format(t_d, ","),
               format(t_s, ","), format(t_n, ",")))
    log("=========== TEMPLATE CENSUS (top 30) =======")
    for name, count, kind in census_top:
        log("  %8s  %-22s %s" % (format(count, ","), name, kind))
    log("=========== LANGUAGE CENSUS (top 40) =======")
    for code, count, role in lang_top:
        log("  %8s  %-12s %s" % (format(count, ","), code, role))
    log("================= SIZES ====================")
    log("words.json    : %s" % mb(s_w))
    log("roots.json    : %s" % mb(s_r))
    log("forms.json    : %s" % mb(s_f))
    log("total         : %s" % mb(s_w + s_r + s_f))
    log("================= SAMPLES ==================")
    for (zone, split), size, pick in sample_zones(shipped):
        log("%s / %s (%s words)" % (zone, split, format(size, ",")))
        for k in pick:
            w = shipped[k]
            bits = " + ".join(
                m["f"] + ("[r " + m["r"] + "]" if m.get("r")
                          else "[w " + m["w"] + "]" if m.get("w") else "")
                for m in w.get("morphs") or ()) or "-"
            log("    %-22s fr=%-7s org=%-28s %s\n        %s"
                % (k, w.get("fr", "-"), show_org(w.get("org")), bits,
                   w["senses"][0]["defs"][0][:70]))

    # The anchors and carried nodes whose lemma decomposes, for the
    # root-parts check: the splits the linking pass computed with the same
    # flatten() the emit used, so the check asks the build what it should
    # have written.
    splits = set(origin.card_parts)
    failed = verify(words_obj, roots_obj, forms_obj, origin.anchors, splits,
                    harvest=harvest, carry=origin.carry)
    failed += gold_report(shipped)
    log("============================================")
    log("done in %.1fs; %d failed check(s)" % (time.time() - t0, failed))
    write_report()
    raise SystemExit(1 if failed else 0)


if __name__ == "__main__":
    main(sys.argv[1:])
