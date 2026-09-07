#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Etymikon -- hand-curated overrides for the build (Agent A).

Data only. No logic lives here. build.py imports this module the same way
the Okpyeon build imported rr.py and decomp.py: a local module, stdlib
only, loaded because sys.path[0] is pipeline/ whenever build.py runs as a
script.

Wiktionary is right about etymology and wrong about what a reader wants to
see. These nine tables are where that gap is recorded, one entry at a
time, each with the reason it exists. They are reviewed in PR diffs.

    BLOCKED_SPLITS   harvested split is true but semantically dead
    FORCED_SPLITS    hand split that overrides the harvest
    ROOT_ALIASES     surface form or chain lemma -> root key
    ROOT_SKIPS       keys never emitted as roots
    ROOT_GLOSSES     hand gloss overriding the harvested one
    BASE_ROUTES      bound base part -> the classical root it really names
    ROOT_STOPS       source lemmas recursion must never split
    LEMMA_STEPS      source-language lemma -> the lemma a chain steps to
    SOURCE_SPLITS    hand decomposition edge in a source graph

An ROOT_ALIASES key is a bare surface form (terra, terr-) when it should
bind wherever that form appears, English morphemes included, and a
language-qualified page key (la:com-) when it must bind only inside its own
language. English words are analysed with English affixes: com- on
compassion belongs on the English prefix card, not on la:con-.

Nothing here is generated. The build adds its own automatic aliases from
the inflection step at run time and never writes back to this file.

EVERY ENTRY MUST FIRE (rule of 2026-09-07). Each of these is a decision
pinned against extract data that moves, so a rule change can retire one
without a word of warning. The build records which entries fired and reports
the sweep. What "fired" means differs per table and is written beside each
table below, because a lookup is not a firing.

- A DEAD entry, one that never fired during the build, is a bug. Two causes:
  the target vanished from the extract, or the rule stopped selecting it. It
  stops the build on the five tables whose dead entry changes what a reader
  sees (BLOCKED_SPLITS, FORCED_SPLITS, ROOT_GLOSSES, BASE_ROUTES,
  LEMMA_STEPS) and is reported on the other four, where the key usually
  stopped appearing at all and aborting would train a maintainer to delete
  entries to get green.
- A REDUNDANT entry, one that the general rule would now decide the same way
  unaided, is reported and never aborts. It is a judgment call for the owner,
  and a signal that a rule improved. Two tables define firing as DIFFERING
  from the harvest (FORCED_SPLITS, ROOT_GLOSSES), so an entry the harvest now
  matches exactly does not fire. It is redundant, not dead: neither named
  cause of death happened, the entry was consulted and applied, and the card
  carries exactly what it states.

`python pipeline/build.py --offline --curation-report-only` reports every
dead entry in all nine tables instead of stopping at the first table that
aborts.
"""

from __future__ import annotations

# ------------------------------------------------------------- blocked splits
# Words whose harvested split is etymologically correct and useless to a
# reader building vocabulary. The word keeps its card and loses its
# breakdown row. Keys are lowercase word keys.
#
# FIRED: a harvested split was actually suppressed. An entry for a word that
# no longer harvests a split is dead, and its reason line is now wrong.
# ABORTS on a dead entry: the reader gets the bad breakdown back.
# REDUNDANT: the general rules would drop the split anyway (fewer than two
# parts, or a final part that is inflectional).

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
    # The etymon tree lists the historical forms this contracted through, so
    # the split harvests as "of + on + upon + in + un- + less". True as
    # history, unreadable as a breakdown (owner ruling 2026-08-25 enabled the
    # etymon source; this is the one common word it reads badly).
    "unless",
})

# -------------------------------------------------------------- forced splits
# Hand splits that override whatever the extract carries. Values are the
# display forms in split order, hyphens included exactly as they should
# render on the chips.
#
# FIRED: it overrode a DIFFERENT harvested split.
# ABORTS on a dead entry: the hand split is the reading the product is built
# around, and losing it silently changes the card. Dead here means the word
# stopped being harvested at all.
# REDUNDANT: the harvest now produces the same split, so the entry is a
# no-op. That is not a dead entry and does not abort: it was consulted, it
# was applied, and the card carries exactly what it states.

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
#
# FIRED: it redirected a resolution that would have landed elsewhere. Only
# this hand table is subject to the rule; the emit concatenates it with the
# aliases the build adds at run time to list alt forms, and that consultation
# is not a redirect.
# REPORTED, never aborts: a dead entry here usually means the key stopped
# appearing at all, which changes nothing that ships.
# REDUNDANT: the run-time alias hop already lands the same source on the
# same card.

ROOT_ALIASES = {
    # The English noun terra exists, so an unaliased part would resolve to
    # en:terra and split the family off the Latin card.
    "terra": "la:terra",
    # terrenus records its own split at the Italic stage rather than the
    # Latin one. The hop stops at the source language, so the link is made
    # here.
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
    # remember reaches rememoror.
    "memoro": "la:memor",
    "memoror": "la:memor",
    "rememoror": "la:memor",
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
#
# FIRED: a key that met the root threshold was refused. Six consultation
# sites record it: the reach count, both flatten arms, the morph chip and
# the org row.
# REPORTED, never aborts: a dead entry here usually means the key stopped
# appearing at all, which changes nothing that ships.

ROOT_SKIPS = frozenset({
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
#
# FIRED: it REPLACED a harvested gloss.
# ABORTS on a dead entry: the card is the only thing the product says about
# the root. Dead here means the key stopped being referenced, so the gloss
# ships nowhere and the entry documents a decision the build no longer makes.
# REDUNDANT: the key still ships and the harvested gloss now reads exactly
# what the entry says, so the sense ordering the entry was written against
# improved under it. That is a judgment call for the owner, not an abort.
# la:-us reached this state on 2026-09-07, after the homograph rule started
# reading a pos or form an English page states.

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
    # Harvested: "from materials", which reads like a cut string. The
    # fullest sense on the page reads as below.
    "la:-eus": "derives relational adjectives from nouns, used chiefly to "
               "indicate material composition",
    # Harvested: "alternative form of -nus, used to form some distributive
    # numerals", the page's only entry. Family: alien (alius + -ēnus),
    # terrene, egregious: adjectives, not numerals. The -nus page it points
    # at opens with the adjective-forming sense, which is the family's
    # (review 2, cause 1, 2026-09-06).
    "la:-enus": "adjective-forming suffix, an alternative form of -nus",
}

# ----------------------------------------------------------------- base routes
# Bound base parts that name a classical root rather than the English
# homograph they are spelled like. A morph chip on this list links to the
# root card instead of to the English word card (owner ruling 2026-08-25,
# from the alignment measurement).
#
# GATED, and the gate is the whole safety of this table: a route fires only
# when the word's OWN etymology chain reaches that root. The part alone is
# not enough evidence. `port` is a morph in 34 shipped words and in most of
# them it is the harbour: airport, carport, seaport, jetport, lakeport,
# moonport. Only transport, whose chain runs through Latin trānsportō,
# routes. The same guard keeps view out of lakeview and overview (23 words),
# sound out of soundboard and soundcheck (21), current out of undercurrent,
# claim out of claimant, flex out of flexible, scribe out of scribble.
#
# Keys are lowercase English morph forms, values are root keys.
#
# FIRED: the gate opened on at least one word. Per-word coverage is noise,
# because one routed word is the whole outcome the entry buys.
# ABORTS on a dead entry: a dead route means the chip went back to the wrong
# homograph or back to being inert.

BASE_ROUTES = {
    # relax: the English card leads "A salmon". laxō is "to extend, expand".
    "lax": "la:laxo",
    # resound: the English card leads "Healthy", the wrong homograph twice
    # over. sonō is "to sound, make a noise".
    "sound": "la:sono",
    # protract, tractotomy: the English noun is "an area or expanse",
    # trahō is "to drag, pull".
    "tract": "la:traho",
    # transport: the English noun is a harbour, portō is "to carry".
    "port": "la:porto",
    # subscribe, circumscribe, superscribe: the English noun is a
    # draughtsperson, scrībō is "to write".
    "scribe": "la:scribo",
    # lupulus: the English card is the autoimmune disease, lupus is "wolf".
    "lupus": "la:lupus",
    # review: the English noun is "visual perception", videō is "to see".
    "view": "la:video",
    # intercurrent: the English noun is the movement of a fluid, currō is
    # "to run".
    "current": "la:curro",
    # electrix: the English noun is a voter, ēligō is "to choose".
    "elector": "la:eligo",
    # victrix: the English noun is the winner, vincō is "to win", and the
    # -trīx forms are Latin morphology throughout.
    "victor": "la:vinco",
    # append: `pend` is not an English word at all, so the chip is inert
    # today. pendō is "to weigh, weigh out".
    "pend": "la:pendo",
    # reclaim: the English noun is a demand of ownership, clāmō is "to cry
    # out". Ratified with flex as a knowingly debatable pair.
    "claim": "la:clamo",
    # reflex: the English noun is "flexibility, pliancy", flectō is "to
    # bend, curve".
    "flex": "la:flecto",
}

# ------------------------------------------------------------------ root stops
# Source lemmas recursion must never split, beyond the ones the anchor rule
# finds on its own (a lemma reached by ORG_ANCHOR_MIN or more words is an
# anchor already). This list is for the remainder: a lemma too thinly
# referenced to qualify, whose split still teaches less than it costs.
# Empty is the healthy state, and it is empty; add a key only with the
# family that exposed it.
#
# FIRED: recursion stopped at a lemma it would otherwise have split.
# REPORTED, never aborts. An empty table sweeps clean by construction.

ROOT_STOPS = frozenset({
    # la:laxō and la:ēligō sat here while ORG_ANCHOR_MIN was 3: each has
    # exactly two part-reaches, enough to ship a card and one short of an
    # anchor, so without a stop the pair flattened away and took its
    # BASE_ROUTES target with it. ORG_ANCHOR_MIN went to 2 on 2026-09-01
    # (owner decision) and both became anchors on their own, so both left.
})

# ---------------------------------------------------------------- lemma steps
# Source-language lemma -> the lemma a chain steps to before it is judged.
# The build already steps an INFLECTION page to its lemma, because such a
# page carries no gloss and no split of its own. This table is for the pages
# that step in the same way but do not look like inflections to the parser:
# a participle Wiktionary made a lemma page, with a gloss of its own and no
# form-of link. Applied in Origin.settle ahead of the automatic step, so an
# entry here wins over what the extract says about the page. Keys and values
# are language-qualified page keys, macrons stripped.
#
# FIRED: it stepped ahead of the automatic step, meaning a walk really moved
# through the key. The build writes the step into the graph unconditionally
# and never checks that the key names anything, so a dead entry here was
# completely silent before 2026-09-07.
# ABORTS on a dead entry: a dead step leaves the chain stopped on a
# participle or a grammatical term, which is the card the reader sees.
# REDUNDANT: the form-of or participle step already reaches the same lemma.

LEMMA_STEPS = {
    # dēpōnēns is a Latin lemma page ("deponent", a grammatical term) rather
    # than a form-of page for dēpōnō, so settle() stopped on it, the chain
    # strictus is the past participle of stringō, written as a lemma page
    # with an adjective's gloss ("tightened, compressed") and no form-of
    # link, so district read dis- + strictus and stopped at the participle
    # (review 2, cause 1, 2026-09-06). The page's own head calls it a
    # participle; the step is the one the parser makes for every participle
    # that carries a form-of link. Reported redundant on 2026-09-07 and
    # proved load-bearing: removing it put district back on the participle.
    "la:strictus": "la:stringo",
    # vīsus the participle of videō and vīsus the fourth-declension noun
    # share a page, and the noun's senses carry it, so vision read vīsus +
    # -tiō with the noun's gloss. vīsiō is built on the participle, so the
    # page steps to videō the way any participle page does. Reported
    # redundant on 2026-09-07 and proved load-bearing the same way.
    "la:visus": "la:video",
    # cocus carries two entries: an alternative form of coquus ("cook") and
    # a New Latin noun for the coconut. The lemma entry makes the page a
    # node, so the alternative-form step never runs and cook read
    # "coconut" (second review, cause 3, 2026-09-06, after the row moved to
    # the noun section that names cocus).
    "la:cocus": "la:coquus",
    # precāre is an inflection page kaikki left untagged: its one sense
    # reads "second-person singular present active imperative/indicative of
    # precor" with no form-of link, so the page counted as a lemma with that
    # statement for a gloss and pray printed it. The step is the one the
    # parser makes for every inflection page that carries the link
    # (2026-09-06, the prose-ancestry pass, which first reached the page).
    "la:precare": "la:precor",
}

# --------------------------------------------------------------- source splits
# Hand decomposition edges in a source graph, the FORCED_SPLITS of the root
# languages. Keys are language-qualified page keys, macrons stripped; values
# are the parts as the source page spells them, resolved through the same
# lookup rules as a template part. An entry overrides whatever the page's
# templates and prose say, so each one carries the reason the page's own
# account is not the one to show.
#
# FIRED: always, by construction. The build writes the edge unconditionally
# for every entry whose node exists, and it already raises SystemExit at the
# point of use when the node does not exist or a part names no page, so this
# table cannot fail a firing sweep.
# REDUNDANT: the page's own template split now resolves to the same parts.

SOURCE_SPLITS = {
    # The Latin page records cūriōsus as a back-formation from incūriōsus
    # (incūria + -ōsus), which is a history, not an assembly: no row could
    # show it, and curious shipped "From Latin cūriōsus" with nothing to
    # click. The standard analysis, and the one the owner's mockup shows, is
    # cūra ("care") + -ōsus ("full of") (SPEC row shape 5, 2026-09-05).
    "la:curiosus": ["cūra", "-ōsus"],
    # mentālis carries two adjective entries, both glossed "mental": one
    # reads mēns + -ālis and one reads mentum ("the chin") + -ālis. The
    # first is the word English took; the second belongs to the anatomical
    # term. The node followed the second, so mental read "the chin"
    # (review 2, cause 1, 2026-09-06). Reported redundant on 2026-09-07 and
    # proved load-bearing: removing it put the chin back on the card.
    "la:mentalis": ["mēns", "-ālis"],
    # diurnus is written "diūs + -nus" on its page. diūs is no page of its
    # own; the lookup steps it through dīus, an alternative form of dīvus,
    # so journey read "god, deity". The standard analysis is diēs + -nus,
    # which is the word the page's own gloss ("of the day") describes.
    "la:diurnus": ["diēs", "-nus"],
}
