#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Etymikon -- hand-curated overrides for the build (Agent A).

Data only. No logic lives here. build.py imports this module the same way
the Okpyeon build imported rr.py and decomp.py: a local module, stdlib
only, loaded because sys.path[0] is pipeline/ whenever build.py runs as a
script.

Wiktionary is right about etymology and wrong about what a reader wants to
see. These five tables are where that gap is recorded, one entry at a
time, each with the reason it exists. They are reviewed in PR diffs.

    BLOCKED_SPLITS   harvested split is true but semantically dead
    FORCED_SPLITS    hand split that overrides the harvest
    ROOT_ALIASES     surface form or chain lemma -> root key
    ROOT_SKIPS       keys never emitted as roots
    ROOT_GLOSSES     hand gloss overriding the harvested one

An ROOT_ALIASES key is a bare surface form (terra, terr-) when it should
bind wherever that form appears, English morphemes included, and a
language-qualified page key (la:com-) when it must bind only inside its own
language. English words are analysed with English affixes: com- on
compassion belongs on the English prefix card, not on la:con-.

Nothing here is generated. The build adds its own automatic aliases from
the inflection step at run time and never writes back to this file.
"""

from __future__ import annotations

# ------------------------------------------------------------- blocked splits
# Words whose harvested split is etymologically correct and useless to a
# reader building vocabulary. The word keeps its card and loses its
# breakdown row. Keys are lowercase word keys.

BLOCKED_SPLITS = frozenset({
    # under- + stand: the modern sense has no relation to standing under.
    "understand",
    # be- + out: opaque Old English contraction, no live morphemes.
    "but",
    # be + -en: an inflection of be that also has lemma senses.
    "been",
    # lout + -le: lout is not a live English morpheme in this sense.
    "little",
    # ne + aye: a fused Old English negation, invisible to a modern reader.
    "no",
    # ne + one: same fused negation, and one is not felt as a part here.
    "none",
    # ne + ever: same fused negation.
    "never",
    # yes + h: a spelling variant recorded as a suffixation.
    "yeah",
})

# -------------------------------------------------------------- forced splits
# Hand splits that override whatever the extract carries. Values are the
# display forms in split order, hyphens included exactly as they should
# render on the chips.

FORCED_SPLITS = {
    # Wiktionary analyses this as the Latin adjective subterraneus plus -an,
    # which puts a macronised Latin word on a chip. The three-part English
    # reading is the one the product is built around.
    "subterranean": ["sub-", "terra", "-an"],
}

# --------------------------------------------------------------- root aliases
# Surface form or chain lemma -> root key. Applied before every other
# resolution rule, to morpheme parts and to origin-chain lemmas alike.
# The build adds more of these automatically from the root-unification hop;
# this table is for the cases the hop cannot reach.

ROOT_ALIASES = {
    # The English noun terra exists, so an unaliased part would resolve to
    # en:terra and split the family off the Latin card.
    "terra": "la:terra",
    # Combining form used in terr-aqueous and friends.
    "terr-": "la:terra",
    # terrain reaches Latin terrenum, an inflection page for terrenus, whose
    # own split Wiktionary records at the Italic stage rather than the Latin
    # one. The hop stops at the source language, so the link is made here.
    "terrenum": "la:terra",
    "terrenus": "la:terra",
    # terrestrial reaches terrestris, whose split is also recorded at the
    # Italic stage (*terzos + *-tris).
    "terrestris": "la:terra",
    # The memor verbs. Recursive flattening consolidates memoria as memor +
    # -ia, but it cannot reach the verbs: Wiktionary records memorō as "From
    # memor" in prose and rememoror as "From memoror", neither of them a
    # decomposition template, so the family fragments one card per lemma and
    # the 2-word threshold then prunes every one of them. These four links
    # are what the flattening rule would find if the source recorded them.
    # remember reaches rememoror, memorandum reaches memorandum itself.
    "memoro": "la:memor",
    "memoror": "la:memor",
    "rememoror": "la:memor",
    "memorandum": "la:memor",
    # Classical affix pages whose own gloss is a relation note pointing at
    # another page. Wiktionary writes the note instead of a meaning, so the
    # card would ship reading "allomorph of con-" and split a family that
    # belongs on one card. Each line quotes the note that justifies it
    # (owner field audit 2026-08-25).
    # "allomorph of con-"
    "la:com-": "la:con-",
    # "Primarily ante-vocalic or poetic variant of re-"
    "la:red-": "la:re-",
    # "alternative form of -ulus"
    "la:-culus": "la:-ulus",
    # "Enlargement of -ō (suffix forming regular first-conjugation verbs)"
    "la:-igo": "la:-o",
    # "syncopic form of calidus"; calidus glosses "warm, hot" and ships once
    # caldera, cauldron and chowder land on it.
    "la:caldus": "la:calidus",
    # "oxytone form of -ης (-ēs, adjective-forming suffix)"
    "grc:-ής": "grc:-ης",
    # Judgment call, not a quoted note: neither page calls itself a form of
    # the other, but -ικός glosses "of or pertaining to, in the manner of"
    # and -κός glosses "of or pertaining to, in the manner of". They are the
    # same suffix with and without its connecting vowel, and two identical
    # cards 14 words apart is the fragmentation this table exists to fix.
    "grc:-κός": "grc:-ικός",
}

# ----------------------------------------------------------------- root skips
# Keys that must never become root cards even when enough words reference
# them. Chain walking already stops at Latin and Greek, so this list only
# has to catch nodes that are the wrong kind of thing.

ROOT_SKIPS = frozenset({
    # Wiktionary records an infix entry for the expletive in
    # abso-fucking-lutely. It is a real affix page and it would put a second
    # card on a word that already has one.
    "en:fucking",
    # Latin case and stem markers. These are real suffix pages, and source
    # splits do name them, but a card reading "suffix marking the nominative
    # singular" teaches a reader nothing about the word they selected
    # (owner field audit 2026-08-25). Each line names the family that
    # exposed it.
    # dux = dūcō + -s, index = in + dīcō + -s: the nominative marker.
    "la:-s",
    # ēnōrmis = ex- + nōrma + -is: the third-declension adjective ending,
    # and the page that wins the gloss is a Greek-borrowing noun suffix.
    "la:-is",
    # asserō = ad- + serō + -a + -ō: a stem vowel between two real parts.
    "la:-a",
})

# ---------------------------------------------------------------- root glosses
# Hand glosses for root keys where Wiktionary's sense ordering hands the card
# a usage note instead of a gloss. The build takes the first usable sense of
# the entry with the most senses, which is right almost everywhere and wrong
# on these. Each gloss is written from the senses actually on the page, not
# invented. Keys are root keys, values ship verbatim.

ROOT_GLOSSES = {
    # Harvested: "Appended in general, often informally, stylistically, or
    # jocularly, for reification of an attribute." That is sense 1 and a
    # usage note; sense 2 is the suffix (state or quality of an adjective).
    "en:-ness": "forming nouns of state or quality",
    # Harvested: the adjectival -ly entry (friendly, yearly), which has more
    # senses than the adverbial one and so wins the dominance rule. Both
    # entries are real, so the gloss names both.
    "en:-ly": "forming adverbs from adjectives, and adjectives from nouns",
    # Harvested: "Forming diminutive nouns.", the first sense of the
    # diminutive entry (doggy). The adjectival entry (rainy, sticky) builds
    # most of the family, so the gloss leads with it.
    "en:-y": "forming adjectives (having the quality of) and diminutive nouns",
    # ---- classical affixes, audited against their families 2026-08-25 ----
    # Every gloss below is written from a sense on the page itself; the
    # build picked a different sense, and the family shows which one is
    # right. The families are derived the runtime way, from words.json.
    # Harvested: "Used to form country names". Family: memory, grace,
    # evidence, distance, arrogance. Sense 1 of the same page reads "Used to
    # form an abstract noun, usually from an adjective ending in -us".
    "la:-ia": "forming abstract nouns, usually from an adjective",
    # Harvested: "Used to form masculine nouns with various meanings".
    # Family: change (cambium + -ō), condense (densus + -ō), incorporate
    # (corpus + -ō): denominative verbs, every one. A separate -ō page reads
    # "suffixed to nouns or adjectives ... Forms regular first-conjugation
    # verbs", which is the family's sense.
    "la:-o": "suffixed to nouns or adjectives, forming regular "
             "first-conjugation verbs",
    # Harvested: "forms animate nouns of various meanings, often colloquial
    # or pejorative". Family: punish (poena + -iō), unite (ūnus + -iō),
    # depart. A separate -iō page reads "Used to form fourth conjugation
    # verbs".
    "la:-io": "used to form fourth-conjugation verbs",
    # Harvested: "used as a derivational suffix to form compound agent
    # nouns". Family: conscious, magnanimous, elegant, envious, all
    # adjectives. A separate -us page reads "used to derive adjectives from
    # other parts of speech".
    "la:-us": "used to derive adjectives from other parts of speech",
    # Harvested: "from materials", which reads like a cut string. The
    # fullest sense on the page reads as below.
    "la:-eus": "derives relational adjectives from nouns, used chiefly to "
               "indicate material composition",
}
