#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Etymikon -- build-time data pipeline (Agent A).

    download-if-missing  ->  parse  ->  curate  ->  cap  ->  emit  ->  verify

Sources
    * kaikki.org English Wiktionary extract (JSONL gzip, ~500 MB):
      definitions, morpheme splits, origin chains, inflected forms
    * kaikki.org Latin and Ancient Greek extracts: root lemma glosses
    * hermitdave/FrequencyWords en_full (OpenSubtitles 2018): ranks

Outputs (UTF-8, no BOM, compact / no indentation)
    extension/data/words.json
    extension/data/roots.json
    extension/data/forms.json

Usage
    python pipeline/build.py            # download if missing, parse, emit, verify
    python pipeline/build.py --verify   # re-verify existing outputs only
    python pipeline/build.py --force-download

See pipeline/README.md.
"""

from __future__ import annotations

import collections
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

# ---------------------------------------------------------------- shape caps

RANK_CAP = 50000        # hybrid cap: everything to here ships unconditionally
MAX_POS = 4             # POS sections per word
MAX_DEFS = 4            # definitions per POS section
DEF_MAX_CHARS = 400     # a longer sense is dropped whole, never cut
ROOT_GLOSS_CARD = 80    # the card budget a root gloss should fit
ROOT_GLOSS_MAX = 160    # safety cap: a longer root gloss is dropped, never cut
MAX_ALT = 8             # alias forms listed on a root card

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


def download(url: str, dest: str, force: bool = False) -> str:
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    have = os.path.getsize(dest) if os.path.exists(dest) else 0
    if force and have:
        os.remove(dest)
        have = 0
    if have and not force:
        # The extracts are hundreds of megabytes and republished on kaikki's
        # own schedule. A HEAD request per build is cheap; skip it when the
        # file is already there and nothing asked for a refresh.
        want = remote_size(url)
        if want <= 0 or have == want:
            log("  cached   %s (%s)" % (os.path.basename(dest), mb(have)))
            return dest
        if have > want:
            log("  local copy larger than remote; restarting %s"
                % os.path.basename(dest))
            os.remove(dest)
            have = 0
    else:
        want = remote_size(url)
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
    """Greek root key: NFC, lowercased. Accents and breathings are kept.

    Greek spelling is meaningful, so nothing is stripped. NFC is what makes
    Μοῦσα from a chain template and μοῦσα from the extract one key.
    """
    return unicodedata.normalize("NFC", s or "").lower()


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
DECOMP_NAMES = frozenset({
    "prefix", "pre", "suffix", "suf", "affix", "af", "confix",
    "compound", "com", "surf", "surface analysis", "univerbation",
})
# The surface-analysis templates. Preferred over the others on one entry:
# a surface analysis is the reader-facing layer by definition.
SURF_NAMES = frozenset({"surf", "surface analysis"})
# Templates that state an origin language without splitting.
ORIGIN_NAMES = frozenset({
    "der", "derived", "bor", "borrowed", "inh", "inherited",
    "lbor", "learned borrowing", "slbor", "semi-learned borrowing",
    "ubor", "uder", "unadapted borrowing",
})
LATIN_CODES = frozenset({
    "la", "la-cla", "la-lat", "la-med", "la-ecc", "la-new", "la-vul",
    "ML", "ML.", "LL", "LL.", "NL", "NL.", "VL", "VL.",
})
GREEK_CODES = frozenset({"grc", "grc-koi", "gkm"})
# A suffix that only inflects. A split ending in one of these is not a
# breakdown, so the word keeps its card and loses its morphs row.
INFLECTIONAL = frozenset({"-s", "-es", "-ed", "-ing", "-est", "-'s", "-s'"})

RE_PART_MOD = re.compile(r"<[^>]*>")
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
    p = RE_PART_SECT.sub("", p)
    p = RE_PART_LANG.sub("", p)
    p = p.strip()
    if p in ("", "-", "*"):
        return ""
    if p.startswith("*"):
        return ""          # a reconstructed proto form is never a morpheme
    return p


def unwrap(t):
    """(kind, lang, args, first-part index, prefer) for a decomposition.

    Three shapes carry the same information in these extracts.
      plain    {{suffix|en|inform|ation}}   lang in arg 1, parts from arg 2
      ety      {{ety|la|:af|terra|-tōrium}} lang in arg 1, parts from arg 3
      surf +   {{surf|+suf|en|be|en}}       lang in arg 2, parts from arg 3
    `prefer` is 1 for a surface analysis and 0 otherwise.
    """
    args = t.get("args") or {}
    name = t.get("name") or ""
    a1 = args.get("1") or ""
    if name == "ety":
        a2 = args.get("2") or ""
        if a2.startswith(":") and a2[1:] in DECOMP_NAMES:
            return a2[1:], a1, args, 3, 0
        return None
    if name in SURF_NAMES and a1.startswith("+"):
        if a1[1:] in DECOMP_NAMES:
            return a1[1:], (args.get("2") or ""), args, 3, 1
        return None
    if name in DECOMP_NAMES:
        return name, a1, args, 2, (1 if name in SURF_NAMES else 0)
    return None


def template_parts(kind, args, base):
    """Positional args of a decomposition template, hyphens restored.

    The prefix and suffix templates leave the hyphen off the affix arg
    ({{suffix|en|inform|ation}} renders "inform + -ation"), so the display
    form has to be rebuilt here.
    """
    parts = []
    i = base
    while str(i) in args:
        p = clean_part(args[str(i)])
        if p:
            parts.append(p)
        i += 1
    if not parts:
        return parts
    if kind in ("prefix", "pre", "confix") and not parts[0].endswith("-"):
        parts[0] = parts[0] + "-"
    if kind in ("suffix", "suf", "confix") and len(parts) >= 2:
        if not parts[-1].startswith("-"):
            parts[-1] = "-" + parts[-1]
    return parts


def entry_split(e, lang):
    """The best decomposition on one entry, or None.

    Among several templates on the same entry the surface analysis wins;
    otherwise the first one in source order does.
    """
    best = None
    for t in e.get("etymology_templates") or []:
        u = unwrap(t)
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
    """
    cand = set()
    forms_raw = {}
    alt_raw = {}
    us_raw = {}
    mixed_raw = {}
    affixes = {}
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

            if pos == "name" or wl in cand:
                continue
            r = ranks.get(wl)
            if r is None:
                # Corpus attestation is the outer edge of the dictionary.
                # See the cap note in main().
                continue
            if r <= RANK_CAP:
                cand.add(wl)
            else:
                # A tail word only earns a card through its breakdown, so a
                # split that suppression will throw away does not make it a
                # candidate. This is a superset test: if the dominant entry
                # ends up carrying a real split, some entry does.
                sp = entry_split(e, "en")
                if sp is not None and sp[-1] not in INFLECTIONAL:
                    cand.add(wl)
                    stats["tail_split"] += 1
    # A forced split has to be harvested even when nothing else would have
    # nominated the word.
    cand |= set(curation.FORCED_SPLITS)
    return cand, forms_raw, alt_raw, us_raw, mixed_raw, affixes, stats


# ------------------------------------------------------- English pass 2

def harvest_english(path, cand):
    """Second pass: senses, split and chain for every candidate word.

    The split and the chain both come from the dominant entry, meaning the
    non-name, non-form-of entry with the most senses. That is the rule that
    keeps `number` a count noun instead of numb + -er: the 17-sense entry
    wins and it carries no split at all.
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
                       "org": None}
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
                rec["org"] = entry_chain(e)
    return out, stats


# ------------------------------------------------- Latin and Greek extracts

def parse_classical(path, lang):
    """One streaming pass over the Latin or Ancient Greek extract.

    A root card needs a display form with its macrons, a gloss, the entry
    pos that decides its kind, the lemma an inflection page points at, and
    the entry's own decomposition. The last one drives recursive flattening:
    territōrium splits as terra + -tōrium inside Latin and memoriālis as
    memoria + -ālis, whose first part splits again as memor + -ia, so the
    English words built on them land on the deepest bases instead of
    fragmenting one card per intermediate lemma.
    """
    gloss = {}
    form = {}
    kind_pos = {}
    rom = {}
    fo = {}
    split = {}
    stats = collections.Counter()
    with gzip.open(path, "rb") as f:
        for line in f:
            stats["lines"] += 1
            e = loads(line)
            w = e.get("word")
            if not w:
                continue
            k = norm_key(lang, w)
            if not k:
                continue
            pos = e.get("pos") or ""
            t = pure_form_of(e)
            if t:
                tk = norm_key(lang, t)
                if tk and tk != k and k not in fo:
                    fo[k] = tk
                continue
            ns = len(e.get("senses") or [])
            g = best_gloss(e)
            if g:
                # A proper-noun entry only supplies a gloss when nothing else
                # does. Μοῦσα is a name page and the only gloss Greek has.
                weight = ns if pos != "name" else -1000 + ns
                cur = gloss.get(k)
                if cur is None or weight > cur[0]:
                    gloss[k] = (weight, g)
                    form[k] = display_form(e, w, lang, k)
                    # Latin and Greek have affix pages of their own (la:re-,
                    # grc:-ος), and their pos says so.
                    kind_pos[k] = pos
                    r = tagged_form(e, "romanization")
                    if lang == "grc" and r:
                        rom[k] = r
            if k not in split:
                parts = entry_split(e, lang)
                if parts and len(parts) >= 2:
                    split[k] = parts
    stats["lemmas"] = len(gloss)
    return {"gloss": {k: v[1] for k, v in gloss.items()}, "form": form,
            "pos": kind_pos, "rom": rom, "fo": fo, "split": split,
            "stats": stats}


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


class Origin:
    """Where an origin chain settles: a decomposed source lemma, or a lemma.

    Supersedes the one-hop unification rule (SPEC, Jesse decision
    2026-08-25). A chain lemma is decomposed recursively inside its own
    language, so memoriālis reads memor + -ia + -ālis rather than anchoring
    on memoria, and every English word built on the family lands on the same
    deepest bases instead of fragmenting one card per intermediate lemma.
    The fragmentation was not only ugly: a card referenced by one word is
    pruned by the 2-word threshold, so those org rows were disappearing.

    Two rules keep the recursion honest. Depth is capped at ORG_DEPTH. And a
    split is taken all or nothing: if any piece of it has no glossable entry
    of its own, the whole split is refused and the part stays whole. That is
    Okpyeon's dead-end rule, and the extract needs it. recordor "splits" as
    re- + corcord-> + -ō, where the middle piece is a wiktextract artifact
    with no page behind it, and the whole split is rightly refused.
    """

    def __init__(self, classical):
        self.cl = classical
        self.alias = {}          # inflected lemma -> root key, for card alt
        self.stats = collections.Counter()

    def settle(self, lang, lemma):
        """The source-language key a chain lemma settles on, or None.

        An inflection page carries no gloss and no split of its own, so it
        steps to its lemma first: territōriī is judged as territōrium.
        """
        key = norm_key(lang, lemma)
        if not key:
            return None
        cl = self.cl[lang]
        if key not in cl["gloss"] and key not in cl["split"] and key in cl["fo"]:
            stepped = cl["fo"][key]
            if stepped:
                self.alias[key] = lang + ":" + stepped
                key = stepped
        return key

    def is_affix(self, lang, key, form=""):
        """True when this source-language page is an affix, not a lemma.

        Either the written form carries a hyphen or the entry pos says so.
        """
        for f in (form, self.cl[lang]["form"].get(key) or key):
            if f and (f.startswith("-") or f.endswith("-")):
                return True
        return self.cl[lang]["pos"].get(key, "") in AFFIX_POS

    def flatten(self, lang, key, depth, seen):
        """[(display form, root key or None)] for a lemma, or None.

        None means the lemma does not decompose and should stay whole. A
        part whose key is a ROOT_SKIPS entry keeps its display form and
        loses its link, exactly as an inert morph chip does.

        Affixes are TERMINAL (SPEC, owner field finding 2026-08-25). An
        affix page is the end of the road even when Wiktionary records a
        split for it: -ārium splits as -ārius + -um, which put library,
        calendar and rosary in a la:-um card glossed "genitive plural
        ending". A reader drilling a suffix wants the suffix, not the case
        ending inside it.
        """
        if self.is_affix(lang, key):
            return None
        cl = self.cl[lang]
        raw = cl["split"].get(key)
        if not raw or len(raw) < 2 or depth <= 0:
            return None
        pieces = []
        for p in raw:
            pk = norm_key(lang, p)
            if not pk:
                return None
            a = (curation.ROOT_ALIASES.get(lang + ":" + pk)
                 or curation.ROOT_ALIASES.get(p)
                 or curation.ROOT_ALIASES.get(pk))
            if a:
                pieces.append((p, a, None))
                continue
            # All or nothing: a piece with no card of its own would ship as
            # an inert fragment, which teaches less than the whole part.
            if pk not in cl["gloss"]:
                return None
            # One page, one spelling. Source templates write the same lemma
            # both ways (creō in creātrīx, creo in prōcreātus), so the chip
            # takes the headword form the page itself carries.
            pieces.append((cl["form"].get(pk) or p, lang + ":" + pk, pk))
        out = []
        for form, rkey, pk in pieces:
            if rkey in curation.ROOT_SKIPS:
                out.append((form, None))
                continue
            sub = None
            if pk is not None and pk not in seen:
                sub = self.flatten(lang, pk, depth - 1, seen | {pk})
            if sub:
                out.extend(sub)
            else:
                out.append((form, rkey))
        return out

    def chain_roots(self, chain):
        """Every root key a word's chain reaches, decomposed or whole.

        Used by the base-route gate in resolve_part. A word carrying morphs
        ships no org row, but its chain is still the evidence for whether a
        base part names a classical root.
        """
        if not chain:
            return ()
        org = self.resolve(chain[0], chain[1], count=False)
        if not org:
            return ()
        if "parts" in org:
            return {p["r"] for p in org["parts"] if p.get("r")}
        return {org["r"]} if org.get("r") else ()

    def resolve(self, lang, lemma, count=True):
        """The `org` value for a chain lemma: decomposed, single, or None."""
        key = self.settle(lang, lemma)
        if not key:
            return None
        a = (curation.ROOT_ALIASES.get(lang + ":" + key)
             or curation.ROOT_ALIASES.get(key))
        if a:
            # A curated alias is a decision about where the family belongs,
            # so it wins over anything the extract would decompose.
            if count:
                self.stats["single"] += 1
            return {"r": a}
        flat = self.flatten(lang, key, ORG_DEPTH, {key})
        if flat and len(flat) >= 2:
            if count:
                self.stats["decomposed"] += 1
                self.stats["parts_%d" % min(len(flat), 6)] += 1
            disp = self.cl[lang]["form"].get(key) or lemma
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
    if p in affixes:
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
    return org.get("r") or "-"


def org_roots(org):
    """Root keys an org row references, whichever shape it takes."""
    if not org:
        return ()
    if "parts" in org:
        return [p["r"] for p in org["parts"] if p.get("r")]
    return [org["r"]] if org.get("r") else []


def family_index(words):
    """root key -> word keys, the index the service worker derives at runtime.

    A mirror, not a second implementation: lookup.js buildFamilyIndex is the
    authority for this shape and this counting rule. A word credits a root
    once, however many of its morphs name it, and an org row credits it the
    same way. Verify has to see the families the reader will see.
    """
    idx = collections.defaultdict(list)
    for k, w in words.items():
        credited = set()
        for m in w.get("morphs") or ():
            if m.get("r"):
                credited.add(m["r"])
        for r in org_roots(w.get("org")):
            credited.add(r)
        for r in sorted(credited):
            idx[r].append(k)
    return idx


def verify(words_obj, roots_obj, forms_obj):
    words = words_obj["words"]
    roots = roots_obj["roots"]
    fmap = forms_obj["map"]
    idx = family_index(words)
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

    thin = [k for k in roots if len(idx.get(k) or ()) < 2]
    add("no root under 2 distinct referencing words", not thin,
        "%d offenders%s" % (len(thin), (": " + ", ".join(sorted(thin)[:5])) if thin else ""))

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
        ("total words", format(len(words), ","), "SPEC says around 81k"),
        ("words inside rank 50,000", format(len(capped), ","),
         "SPEC says around 46k"),
        ("split-bearing tail", format(len(words) - len(capped), ","), ""),
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


# ---------------------------------------------------------------- main

def main(argv):
    if "--verify" in argv:
        failed = verify_only()
        # A re-verify must not overwrite the report of the build it checks.
        write_report(VERIFY_REPORT_FILE)
        raise SystemExit(1 if failed else 0)
    force = "--force-download" in argv
    t0 = time.time()
    os.makedirs(CACHE, exist_ok=True)
    os.makedirs(OUT, exist_ok=True)

    log("[1/7] downloading sources into pipeline/cache")
    download(ENGLISH_URL, ENGLISH_FILE, force)
    download(LATIN_URL, LATIN_FILE, force)
    download(GREEK_URL, GREEK_FILE, force)
    download(EXTFREQ_URL, EXTFREQ_FILE, force)

    log("[2/7] reading the frequency list")
    ranks = parse_ranks(EXTFREQ_FILE)
    log("  %s ranked tokens (rank 1 = %s)"
        % (format(len(ranks), ","),
           min(ranks, key=ranks.get) if ranks else "-"))

    log("[3/7] surveying the English extract (candidacy, forms, affixes)")
    cand, forms_raw, alt_raw, us_raw, mixed_raw, affixes, s1 = survey_english(
        ENGLISH_FILE, ranks)
    log("  %s lines read; %s candidate words (%s of them tail splits)"
        % (format(s1["lines"], ","), format(len(cand), ","),
           format(s1["tail_split"], ",")))
    log("  %s inflection pages, %s alternative-spelling pages, %s mixed pages, "
        "%s affix entries"
        % (format(len(forms_raw), ","), format(len(alt_raw), ","),
           format(len(mixed_raw), ","), format(len(affixes), ",")))

    log("[4/7] harvesting senses, splits and chains")
    harvest, s2 = harvest_english(ENGLISH_FILE, cand)
    log("  %s words with at least one shippable sense (%s senses dropped "
        "over %d chars)" % (format(len(harvest), ","),
                            format(s2["dropped_long"], ","), DEF_MAX_CHARS))

    log("[5/7] reading the Latin and Ancient Greek extracts")
    classical = {"la": parse_classical(LATIN_FILE, "la"),
                 "grc": parse_classical(GREEK_FILE, "grc")}
    for lang in ("la", "grc"):
        c = classical[lang]
        log("  %-3s %s lines, %s glossed lemmas, %s inflection pages, "
            "%s lemmas with an in-language split"
            % (lang, format(c["stats"]["lines"], ","),
               format(len(c["gloss"]), ","), format(len(c["fo"]), ","),
               format(len(c["split"]), ",")))

    # ---- curate and cap -----------------------------------------------
    log("[6/7] curating, capping and resolving roots")
    origin = Origin(classical)
    shipped = {}
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
        if rank is None or (rank > RANK_CAP and not parts):
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
        elif rec["org"]:
            org = origin.resolve(rec["org"][0], rec["org"][1])
            if org:
                w["org"] = org
        shipped[wl] = w
    log("  %s words ship (%s forced splits, %s blocked, %s inflectional "
        "splits suppressed)"
        % (format(len(shipped), ","), format(n_forced, ","),
           format(n_blocked, ","), format(n_infl, ",")))
    log("  origin chains: %s decomposed, %s single"
        % (format(origin.stats["decomposed"], ","),
           format(origin.stats["single"], ",")))

    # ---- resolve morphemes to roots, count references -------------------
    # One word credits a root once, however many of its morphs name it, and
    # the org row counts in the same tally. This is the runtime's rule:
    # lookup.js buildFamilyIndex is the authority, and the ship threshold has
    # to agree with it or a root ships whose card renders a family of one
    # (review finding 2026-08-24, 12 shipped words double-credited).
    refs = collections.Counter()
    n_wchip = n_repeat = n_routed = 0
    for wl, w in shipped.items():
        credited = set()
        # The roots this word's own chain reaches, for the base-route gate.
        # A word with morphs keeps its chain in the harvest even though the
        # schema gives it no org row, and that chain is the evidence a route
        # needs: transport runs through trānsportō, airport runs through
        # nothing at all.
        chain_roots = origin.chain_roots(harvest.get(wl, {}).get("org")) \
            if w.get("morphs") else ()
        for m in w.get("morphs") or ():
            field, k = resolve_part(m["f"], wl, affixes, shipped, chain_roots)
            if field == "r" and curation.BASE_ROUTES.get(m["f"].lower()) == k:
                n_routed += 1
            if field == "r" and k not in curation.ROOT_SKIPS:
                m["r"] = k
                if k in credited:
                    n_repeat += 1
                credited.add(k)
            elif field == "w":
                m["w"] = k
                n_wchip += 1
        # An org row credits its roots exactly as morph chips do, once per
        # word, whether it is a single lemma or a decomposed one.
        org = w.get("org")
        if org and "parts" in org:
            for p in org["parts"]:
                if p.get("r"):
                    credited.add(p["r"])
        elif org:
            if org["r"] in curation.ROOT_SKIPS:
                del w["org"]
            else:
                credited.add(org["r"])
        for k in credited:
            refs[k] += 1

    # ---- build the root set --------------------------------------------
    roots = {}
    for key, n in refs.items():
        if n < 2:
            continue
        lang, form = key.split(":", 1)
        if lang == "en":
            a = affixes.get(form)
            if not a:
                continue
            gloss, disp, rom, pos = a["gloss"], form, "", a["pos"]
        else:
            cl = classical[lang]
            gloss = cl["gloss"].get(form)
            disp = cl["form"].get(form) or form
            rom = cl["rom"].get(form, "")
            pos = cl["pos"].get(form, "")
        # A hand gloss overrides the harvest and can carry a card on its own.
        gloss = curation.ROOT_GLOSSES.get(key) or gloss
        if not gloss:
            continue
        r = {"form": disp, "lang": lang, "gloss": gloss,
             "kind": root_kind(pos, disp)}
        if rom:
            r["rom"] = rom
        roots[key] = r

    # Alias forms, from curation and from the inflection step, listed on the
    # card they were folded into. Flattening produces no aliases of its own:
    # an intermediate lemma is now decomposed rather than folded away.
    alt = collections.defaultdict(set)
    for src, dst in list(curation.ROOT_ALIASES.items()) + list(origin.alias.items()):
        # A language-qualified alias key names a page, not a surface form.
        src = src.split(":", 1)[1] if ":" in src else src
        if dst in roots and src != roots[dst]["form"]:
            alt[dst].add(src)
    for key, forms in alt.items():
        roots[key]["alt"] = sorted(forms)[:MAX_ALT]

    # `src` on an English affix: the Latin or Greek lemma its own chain
    # reaches, when that lemma ships a card of its own.
    n_src = 0
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
            n_src += 1

    # ---- drop references to roots that did not make it ------------------
    n_inert = n_orgdrop = n_inertpart = 0
    for wl, w in shipped.items():
        for m in w.get("morphs") or ():
            if m.get("r") and m["r"] not in roots:
                del m["r"]
                n_inert += 1
        org = w.get("org")
        if org and "parts" in org:
            # A part whose root missed the threshold renders inert. A row
            # where every part did teaches nothing navigable, so it goes.
            for p in org["parts"]:
                if p.get("r") and p["r"] not in roots:
                    del p["r"]
                    n_inertpart += 1
            if not any(p.get("r") for p in org["parts"]):
                del w["org"]
                n_orgdrop += 1
        elif org and org["r"] not in roots:
            del w["org"]
            n_orgdrop += 1
        elif org:
            org["f"] = roots[org["r"]]["form"]
    log("  %s roots kept (%s src links); %s word chips, %s morph chips left "
        "inert, %s org parts inert, %s org rows dropped, %s repeated morphs "
        "credited once, %s base chips routed to a classical root"
        % (format(len(roots), ","), format(n_src, ","), format(n_wchip, ","),
           format(n_inert, ","), format(n_inertpart, ","),
           format(n_orgdrop, ","), format(n_repeat, ","),
           format(n_routed, ",")))

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
    n_rmorphs = sum(1 for k in ranked if shipped[k].get("morphs"))
    langs = collections.Counter(k.split(":", 1)[0] for k in roots)
    log("\n================= COUNTS ===================")
    log("words         : %s" % format(len(shipped), ","))
    log("  ranked <=%d: %s" % (RANK_CAP, format(len(ranked), ",")))
    log("  tail (split): %s" % format(len(shipped) - len(ranked), ","))
    log("morphs        : %s words (%.1f%% of all, %.1f%% of ranked)"
        % (format(n_morphs, ","), 100.0 * n_morphs / max(1, len(shipped)),
           100.0 * n_rmorphs / max(1, len(ranked))))
    log("org           : %s words (%.1f%% of all)"
        % (format(n_org, ","), 100.0 * n_org / max(1, len(shipped))))
    log("roots         : %s (en=%s la=%s grc=%s)"
        % (format(len(roots), ","), format(langs["en"], ","),
           format(langs["la"], ","), format(langs["grc"], ",")))
    kinds = collections.Counter(r["kind"] for r in roots.values())
    log("  by kind     : %s"
        % " ".join("%s=%s" % (k, format(v, ","))
                   for k, v in sorted(kinds.items())))
    log("forms         : %s (%s inflections, %s alternative spellings)"
        % (format(len(fmap), ","), format(n_infl, ","), format(n_alt, ",")))
    log("fo fields     : %s (%s pure pages, %s mixed pages)"
        % (format(n_fo + n_mixed, ","), format(n_fo, ","),
           format(n_mixed, ",")))
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

    failed = verify(words_obj, roots_obj, forms_obj)
    log("============================================")
    log("done in %.1fs; %d failed check(s)" % (time.time() - t0, failed))
    write_report()
    raise SystemExit(1 if failed else 0)


if __name__ == "__main__":
    main(sys.argv[1:])
