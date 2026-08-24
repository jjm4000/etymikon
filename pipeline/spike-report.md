# Feasibility spike report (Step 0)

Date: 2026-08-24. Script: pipeline/spike.py. Sources: kaikki.org English
Wiktionary extract (1,487,639 entries, 1,385,953 distinct words) and the
hermitdave/FrequencyWords en_full list (OpenSubtitles 2018).

## The question

For the top 10,000 English words by frequency, what fraction yields a
decomposition into morphemes that themselves have glossable Wiktionary
entries?

## Numbers

Over the top 10,000 frequency words:

| measure | count | share |
|---|---|---|
| has any dictionary entry | 9,963 | 99.6% |
| no entry at all | 37 | 0.4% |
| entry is inflection only (form-of), lemma link present | 1,315 | 13.2% |
| English-surface morpheme split, direct | 1,941 | 19.4% |
| English-surface split after resolving to lemma | 2,182 | 21.8% |
| split with every part glossable in the extract | 1,801 | 18.0% |
| split recorded only at a source-language stage | 219 | 2.2% |
| Latin or Greek origin marked in templates | 3,465 | 34.6% |
| Latin/Greek origin but no split at all | 2,822 | 28.2% |

The split rate is flat across frequency bands (20.3% in ranks 1 to
1000, 17.0% in ranks 9001 to 10000). Glossability is not the problem:
once a split exists with lang=en, its parts are in the dictionary
almost every time (1,801 of 1,825 emitted splits).

Measurement note: only decomposition templates whose language argument
is `en` count as a split. The first run counted any language stage and
credited "report" with the Latin split re- + porto, then glossed
"porto" against the wrong English homograph (an aperitif). The
corrected run separates those into the source-language row.

## Sample decompositions

Good, the product case:

- information = inform + -ation (Latin; "to instruct" + "action or process")
- security = secure + -ity (Latin)
- terrible = terror + -ible (Latin)
- education = educate + -ion (Latin)
- important = import + -ant (Latin)
- television = tele- + vision (Greek prefix, Latin base)
- impossible = im- + possible (Latin)
- music = muse + -ic (Greek)

Bad, the noise the product must filter:

- had = have + -ed, does = do + -s, going = go + -ing (true, but
  inflection; belongs to lemmatization, not a breakdown row)
- understand = under- + stand (etymologically true, semantically dead;
  the predicted case, confirmed present)
- number = numb + -er (the split belongs to the comparative-of-numb
  homograph, not the count noun; homograph collision)
- little = lout + -le (technically recorded, useless to show)
- no = ne + a, never = ne + ever (Old English function-word etymology,
  not a Latin/Greek story)

## Main noise sources

1. Inflectional splits. The extract records go + -ing as etymology.
   Mitigation: pure-inflection suffixes route through lemmatization.
   The form_of links needed for that are present (13.2% of the top 10k
   resolve this way).
2. Semantically dead splits (understand). Mitigation: curated override
   list, the decomp.py pinned-anchor idea from Okpyeon.
3. Homograph collisions (number = numb + -er). The split attaches to
   one homograph entry, the frequent word is another. Mitigation: pick
   the split from the entry whose sense matches, or curate.
4. Borrowing chains. 28.2% of words carry a Latin/Greek marker with no
   split; the story lives in der/bor chains through Old French. The
   root card for these needs chain traversal that skips intermediate
   stages, and Latin/Greek extracts for glossing the source lemma.
5. Origin undercount. "television" carries no Latin/Greek marker
   because its templates point at French télévision. True Latin/Greek
   share is higher than 34.6%; origin must propagate through the
   morpheme graph.

## Read on feasibility

Structured decomposition data exists. This is not hand-curation of a
morphology database. But the 18% headline is the floor, not the
product: it counts only English-surface splits. The product the brief
describes (subterranean drilling into Latin terra) additionally needs
the der/bor chains (present, 21,732 der templates in the top-10k
entries alone) plus the kaikki Latin and Greek extracts to gloss root
lemmas. Each piece is structured and downloadable. The curation burden
concentrates on a filter list for dead and inflectional splits, which
is bounded work of the decomp.py kind, not open-ended lexicography.

Recommendation: go.
