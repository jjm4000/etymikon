#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Feasibility spike (Step 0 of the kickoff brief).

Question: for the top 10,000 English words by frequency, what fraction
yields a decomposition into morphemes that themselves have glossable
Wiktionary entries?

Sources (cached in pipeline/cache/, download handled outside this script)
    * kaikki.org English Wiktionary extract (kaikki-English.jsonl.gz)
    * hermitdave/FrequencyWords en_full (en_full_opensubtitles.txt)

Outputs
    * printed summary (coverage numbers)
    * cache/spike-decomps.jsonl  one line per top-10k word that has a
      decomposition: parts, part glosses, template, Latin/Greek flag
    * cache/spike-misses.txt     top-10k words with no dictionary entry

Spike code only. Not part of the product pipeline.

The template tables and the parsing helpers below are a frozen copy of an
early revision of what is now build.py, kept so the published numbers stay
reproducible. build.py is the authority for how the extracts are read and
has since moved on: it filters splits by language argument, prefers the
surface analysis, restores affix hyphens on more template shapes, and reads
the frequency list with the full word-key charset. Nothing here is imported
by the build, and these numbers are pinned to the superseded parser.
"""

from __future__ import annotations

import gzip
import io
import json
import os
import re
import sys

try:
    import orjson as _fastjson

    def loads(b):
        return _fastjson.loads(b)
except ImportError:
    def loads(b):
        return json.loads(b)

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, "cache")
KAIKKI = os.path.join(CACHE, "kaikki-English.jsonl.gz")
FREQ = os.path.join(CACHE, "en_full_opensubtitles.txt")
OUT_DECOMPS = os.path.join(CACHE, "spike-decomps.jsonl")
OUT_MISSES = os.path.join(CACHE, "spike-misses.txt")

TOP_N = 10000

# Templates that split a word into morphemes.
DECOMP_NAMES = {
    "prefix", "pre", "suffix", "suf", "affix", "af", "confix",
    "compound", "com", "surf", "surface analysis", "univerbation",
}
# Templates that state an origin language without splitting.
ORIGIN_NAMES = {
    "der", "derived", "bor", "borrowed", "inh", "inherited",
    "lbor", "learned borrowing", "slbor", "semi-learned borrowing",
    "ubor", "uder", "unadapted borrowing",
}
LATIN_CODES = {
    "la", "la-cla", "la-lat", "la-med", "la-ecc", "la-new", "la-vul",
    "ML", "ML.", "LL", "LL.", "NL", "NL.", "VL", "VL.",
}
GREEK_CODES = {"grc", "grc-koi", "gkm", "el"}


def log(*a):
    print(*a, flush=True)


def load_top_words():
    words = []
    seen = set()
    pat = re.compile(r"^[a-z]+$")
    with io.open(FREQ, encoding="utf-8") as f:
        for line in f:
            w = line.split(" ", 1)[0]
            if pat.match(w) and w not in seen:
                seen.add(w)
                words.append(w)
                if len(words) >= TOP_N:
                    break
    return words


def template_parts(t):
    """Positional args 2.. of a decomposition template, cleaned."""
    args = t.get("args") or {}
    parts = []
    i = 2
    while str(i) in args:
        p = args[str(i)].strip()
        # strip a language qualifier like "la:terra"
        p = re.sub(r"^[a-z-]{2,15}:", "", p)
        # strip inline modifiers like "non-<id:not>"
        p = re.sub(r"<[^>]*>", "", p)
        # strip section qualifiers like "to-#Etymology_2" or "new#Noun"
        p = re.sub(r"#.*$", "", p)
        if p:
            parts.append(p)
        i += 1
    name = t.get("name", "")
    # prefix/suffix templates leave the hyphen off the affix arg
    if name in ("prefix", "pre") and parts and not parts[0].endswith("-"):
        parts[0] = parts[0] + "-"
    if name in ("suffix", "suf") and len(parts) >= 2:
        if not parts[-1].startswith("-"):
            parts[-1] = "-" + parts[-1]
    return parts


def part_glosses(t):
    """Per-part gloss args (t1=, t2=, ...) if the template carries them."""
    args = t.get("args") or {}
    out = {}
    for k, v in args.items():
        m = re.match(r"^t(\d+)$", k)
        if m and v:
            out[int(m.group(1))] = v
    return out


def first_gloss(entry):
    for s in entry.get("senses") or []:
        for g in s.get("glosses") or []:
            return g[:80]
    return ""


def formof_target(entry):
    """If every sense is a form-of/alt-of, return the lemma it points to."""
    senses = entry.get("senses") or []
    if not senses:
        return None
    target = None
    for s in senses:
        links = s.get("form_of") or s.get("alt_of")
        if not links:
            return None
        t = links[0].get("word")
        if not t:
            return None
        if target is None:
            target = t
    return target


def is_en_template(t):
    return ((t.get("args") or {}).get("1") == "en")


def origin_class(entry):
    """'latin', 'greek', both, or set() based on origin templates."""
    out = set()
    for t in entry.get("etymology_templates") or []:
        if t.get("name") in ORIGIN_NAMES:
            code = (t.get("args") or {}).get("2", "")
            if code in LATIN_CODES:
                out.add("latin")
            elif code in GREEK_CODES:
                out.add("greek")
    return out


def main():
    log("loading frequency list ...")
    top_words = load_top_words()
    top_set = set(top_words)
    rank = {w: i + 1 for i, w in enumerate(top_words)}
    log("  top %d words (first: %s ... last: %s)" % (
        len(top_words), ", ".join(top_words[:5]), top_words[-1]))

    # Streaming pass over the whole extract.
    # exists: every entry word (exact case) -> short gloss
    # merged: lowercase word -> merged record for coverage checks
    exists = {}
    merged = {}
    top_entries = {}  # lowercase top-10k word -> list of trimmed entries
    tmpl_hist = {}

    log("streaming %s ..." % os.path.basename(KAIKKI))
    n = 0
    with gzip.open(KAIKKI, "rb") as f:
        for line in f:
            n += 1
            if n % 200000 == 0:
                log("  %d lines ..." % n)
            try:
                e = loads(line)
            except Exception:
                continue
            w = e.get("word")
            if not w:
                continue
            g = first_gloss(e)
            if w not in exists or (g and not exists[w]):
                exists[w] = g

            wl = w.lower()
            fo = formof_target(e)
            tmpls = e.get("etymology_templates") or []
            has_decomp = any(
                t.get("name") in DECOMP_NAMES and is_en_template(t)
                for t in tmpls)
            # a split recorded only at a source-language stage (Latin,
            # Old French, ...): no English surface split, but a root
            # story exists
            has_decomp_src = any(
                t.get("name") in DECOMP_NAMES and not is_en_template(t)
                for t in tmpls)
            org = origin_class(e)

            rec = merged.get(wl)
            if rec is None:
                rec = {"decomp": False, "decomp_src": False, "org": set(),
                       "fo": fo, "real": False}
                merged[wl] = rec
            rec["decomp"] = rec["decomp"] or has_decomp
            rec["decomp_src"] = rec["decomp_src"] or has_decomp_src
            rec["org"] |= org
            if fo is None:
                rec["real"] = True  # at least one non-form-of entry
                rec["fo"] = None
            elif not rec["real"] and rec["fo"] is None:
                rec["fo"] = fo

            if wl in top_set:
                for t in tmpls:
                    nm = t.get("name", "?")
                    tmpl_hist[nm] = tmpl_hist.get(nm, 0) + 1
                top_entries.setdefault(wl, []).append({
                    "word": w,
                    "pos": e.get("pos"),
                    "gloss": g,
                    "templates": [
                        {"name": t.get("name"),
                         "args": t.get("args"),
                         "expansion": (t.get("expansion") or "")[:200]}
                        for t in tmpls],
                    "form_of": fo,
                })
    log("  %d lines total, %d distinct entry words" % (n, len(exists)))

    def resolve(wl, hops=2):
        """Follow form-of pointers to a lemma record."""
        rec = merged.get(wl)
        seen_l = wl
        while rec and not rec["real"] and rec["fo"] and hops > 0:
            nxt = rec["fo"].lower()
            if nxt == seen_l:
                break
            seen_l = nxt
            rec = merged.get(nxt)
            hops -= 1
        return seen_l, rec

    def glossable(part):
        return part in exists or part.lower() in exists

    # Analysis over the top 10k.
    n_found = 0
    n_formof = 0
    n_decomp_direct = 0
    n_decomp_lemma = 0
    n_decomp_glossable = 0
    n_decomp_src_only = 0
    n_latgrk = 0
    n_latgrk_no_decomp = 0
    misses = []
    out = io.open(OUT_DECOMPS, "w", encoding="utf-8")

    for w in top_words:
        entries = top_entries.get(w)
        rec = merged.get(w)
        if not entries and not rec:
            misses.append(w)
            continue
        n_found += 1

        lemma, lrec = resolve(w)
        is_formof = rec is not None and not rec["real"]
        if is_formof:
            n_formof += 1

        direct_decomp = rec["decomp"] if rec else False
        lemma_decomp = direct_decomp or (lrec["decomp"] if lrec else False)
        if direct_decomp:
            n_decomp_direct += 1
        if lemma_decomp:
            n_decomp_lemma += 1
        src_decomp = (rec["decomp_src"] if rec else False) or (
            lrec["decomp_src"] if lrec else False)
        if src_decomp and not lemma_decomp:
            n_decomp_src_only += 1

        org = set(rec["org"]) if rec else set()
        if lrec:
            org |= lrec["org"]
        if org:
            n_latgrk += 1
            if not lemma_decomp:
                n_latgrk_no_decomp += 1

        # glossability + sample emission uses the word's own entries
        best = None
        for entry in entries or []:
            for t in entry["templates"]:
                if t["name"] not in DECOMP_NAMES:
                    continue
                if (t["args"] or {}).get("1") != "en":
                    continue
                parts = template_parts(t)
                if len(parts) < 2:
                    continue
                pg = part_glosses(t)
                info = {
                    "word": w,
                    "rank": rank[w],
                    "template": t["name"],
                    "expansion": t["expansion"],
                    "parts": [
                        {"form": p,
                         "in_dict": bool(glossable(p)),
                         "dict_gloss": exists.get(p) or exists.get(p.lower()) or "",
                         "arg_gloss": pg.get(i + 1, "")}
                        for i, p in enumerate(parts)],
                    "origin": sorted(org),
                }
                info["all_glossable"] = all(
                    x["in_dict"] or x["arg_gloss"] for x in info["parts"])
                if best is None or (info["all_glossable"] and not best["all_glossable"]):
                    best = info
        if best:
            if best["all_glossable"]:
                n_decomp_glossable += 1
            out.write(json.dumps(best, ensure_ascii=False) + "\n")

    out.close()
    with io.open(OUT_MISSES, "w", encoding="utf-8") as f:
        f.write("\n".join(misses))

    def pct(x):
        return "%5.1f%%" % (100.0 * x / TOP_N)

    log("")
    log("=== spike results (top %d frequency words) ===" % TOP_N)
    log("found in extract:            %6d  %s" % (n_found, pct(n_found)))
    log("no entry at all:             %6d  %s" % (len(misses), pct(len(misses))))
    log("form-of only (inflections):  %6d  %s" % (n_formof, pct(n_formof)))
    log("decomp template, direct:     %6d  %s" % (n_decomp_direct, pct(n_decomp_direct)))
    log("decomp, after lemma resolve: %6d  %s" % (n_decomp_lemma, pct(n_decomp_lemma)))
    log("decomp, all parts glossable: %6d  %s" % (n_decomp_glossable, pct(n_decomp_glossable)))
    log("source-lang split only:      %6d  %s" % (n_decomp_src_only, pct(n_decomp_src_only)))
    log("Latin/Greek origin marked:   %6d  %s" % (n_latgrk, pct(n_latgrk)))
    log("  of those, no decomp:       %6d  %s" % (n_latgrk_no_decomp, pct(n_latgrk_no_decomp)))
    log("")
    log("etymology template histogram over top-10k entries (top 30):")
    for nm, c in sorted(tmpl_hist.items(), key=lambda kv: -kv[1])[:30]:
        log("  %6d  %s" % (c, nm))
    log("")
    log("samples: %s" % OUT_DECOMPS)
    log("misses:  %s" % OUT_MISSES)


if __name__ == "__main__":
    main()
