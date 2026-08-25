#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Spike helper: how large would words.json be at each frequency cap?

Builds mock shipped-format records for every frequency-listed word in
the kaikki extract and prints cumulative JSON bytes by rank bucket.
Record sketch per word: headword, per-POS definitions (max 3 senses,
200 chars each), first en-language morpheme split, frequency rank.

Spike code only. DECOMP_NAMES and load_ranks() below are a frozen copy of an
early revision of what is now build.py, which is the authority for how the
extracts are read. The size table this script prints is pinned to that
superseded parser and to a cap rule with no attestation clause, so it does
not predict the size of a current build.
"""
from __future__ import annotations

import gzip
import io
import json
import os
import re

try:
    from orjson import loads
except ImportError:
    from json import loads

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, "cache")
KAIKKI = os.path.join(CACHE, "kaikki-English.jsonl.gz")
FREQ = os.path.join(CACHE, "en_full_opensubtitles.txt")

DECOMP_NAMES = {
    "prefix", "pre", "suffix", "suf", "affix", "af", "confix",
    "compound", "com", "surf", "surface analysis", "univerbation",
}


def load_ranks():
    ranks = {}
    pat = re.compile(r"^[a-z]+$")
    n = 0
    with io.open(FREQ, encoding="utf-8") as f:
        for line in f:
            w = line.split(" ", 1)[0]
            if pat.match(w) and w not in ranks:
                n += 1
                ranks[w] = n
    return ranks


def split_of(e):
    for t in e.get("etymology_templates") or []:
        if t.get("name") not in DECOMP_NAMES:
            continue
        args = t.get("args") or {}
        if args.get("1") != "en":
            continue
        parts, i = [], 2
        while str(i) in args:
            p = re.sub(r"<[^>]*>|#.*$", "", args[str(i)].strip())
            if p:
                parts.append(p)
            i += 1
        if len(parts) >= 2:
            return parts
    return None


def main():
    ranks = load_ranks()
    print("frequency list words: %d" % len(ranks), flush=True)
    words = {}
    n = 0
    with gzip.open(KAIKKI, "rb") as f:
        for line in f:
            n += 1
            if n % 400000 == 0:
                print("  %d lines ..." % n, flush=True)
            e = loads(line)
            w = e.get("word")
            if not w:
                continue
            wl = w.lower()
            r = ranks.get(wl)
            if r is None:
                continue
            glosses = []
            for s in e.get("senses") or []:
                for g in s.get("glosses") or []:
                    glosses.append(g[:200])
                    break
                if len(glosses) >= 3:
                    break
            rec = words.setdefault(wl, {"w": wl, "r": r, "p": []})
            rec["p"].append({"pos": e.get("pos"), "d": glosses})
            sp = split_of(e)
            if sp and "m" not in rec:
                rec["m"] = sp

    print("dictionary words on frequency list: %d" % len(words), flush=True)
    by_rank = sorted(words.values(), key=lambda x: x["r"])
    buckets = [10000, 20000, 30000, 50000, 100000, 200000, 10**9]
    total, bi, count, n_split = 0, 0, 0, 0
    print("\n   cap      words   with-split   words.json size")
    for rec in by_rank:
        total += len(json.dumps(rec, ensure_ascii=False,
                                separators=(",", ":"))) + 1
        count += 1
        if "m" in rec:
            n_split += 1
        while bi < len(buckets) and rec["r"] >= buckets[bi]:
            print("%7d  %8d   %8d     %6.1f MB" % (
                buckets[bi], count, n_split, total / 1e6), flush=True)
            bi += 1
    print("    all  %8d   %8d     %6.1f MB" % (count, n_split, total / 1e6))


if __name__ == "__main__":
    main()
