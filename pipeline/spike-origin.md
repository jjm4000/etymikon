# Origin subsystem spike: source graph first

Read-only feasibility measurement, 2026-09-05. Script: pipeline/spike_origin.py
(rerunnable, --quick samples). Runtime of the run that wrote this file:
19 s. Inputs: the cached kaikki extracts and the shipped
extension/data files at commit 7a53876 (82,843 words, 3,021 roots,
1,752 misses).

What a source-graph-first origin subsystem would recover. The design under test
builds the Latin and Greek graphs from templates plus prose, lets an English
word attach through any classical mention, and never stays silent when the
lemma has a gloss. Measured against the 1,752 shipped words that state a
classical origin and show nothing (553 of them inside the top 10k), it
recovers in four layers. Lookup rules reach 147 of the 421 chain
lemmas the build cannot find (Greek vowel-length marks 87, a second
form-of hop 50, accent or breathing 11). Two part rules, the same
length-mark strip on split parts and a step from a form-of part such as sciēns
to its lemma, turn 222 of the 255 refused source splits into
decomposed rows: system, period, vessel, prophecy, present, experience and
science among them. The prose parser adds 57 decomposed rows from source
pages and 129 from English pages, at a hand-checked precision of
55 right, 3 partial and 2 wrong in 60 parses. Dropping
the 2-credit threshold turns every remaining single-root chain into a one-chip
row. Together (scenario C, section 6): 488 of the 1,752 misses render a
decomposed row, 1,039 a single FROM LATIN or FROM GREEK row, 225
nothing; inside the top 10k, 141 decomposed, 359 single, 53
nothing. roots.json grows by about 1,896 cards, 0.21 MB at today's
113 bytes per root, and the root graph consolidates as lemmas that now
decompose hand their credits to shared bases (294 keys named only today,
236 named only under the rules).

What it would not recover. No lookup rule reaches 274 of the chain
lemmas: 212 name a lemma Wiktionary never wrote (turbula, petia, rollāre,
Byzantine Greek cited under gkm), 40 are multiword (ad montem, per
centum), 19 exist only as English pages. The English-page prose still
gives 49 of those words a row, and 225 misses end with nothing. The prose parser
captures 813 of 2,165 prose-only Latin pages and 223 of
652 Greek ones inside the same extract; what it misses is mostly a
reconstructed part (753 Latin parts, 286 Greek), and it has no
stance detection, so a sentence that rejects a split parses like one that
asserts it (ἀφάρκη). Wiktionary's etymon tree is not a coverage source on its
own: 2,111 top-10k words carry an etymon template, 254 trees reach a
Latin or Greek node, 28 of those are words the pipeline leaves silent
while the tree decomposes, and where both speak they agree 51 times and
differ 46, because the tree follows a different analysis (identity:
idem + -tās against the calque's ταὐτότης) or the source page carries no etymon
template at all (10). The one-chip rows the no-silence rule adds are
mostly sound (idea from ἰδέα "form, shape", table from tabula) with a visible
minority of homograph glosses (cave from cava "jackdaw", coop from cōpa "tavern-
keeper") that a gloss audit would have to catch; section 7 lists 40 of the
449 top-10k cases for that judgement.

## Headline table

| measure | value |
|---|---|
| Latin lemma pages: template split / prose only / neither | 17,946 / 2,165 / 26,015 |
| Greek lemma pages: template split / prose only / neither | 9,723 / 652 / 9,852 |
| prose parser capture on prose-only Latin pages (any extract / same extract) | 1,280 / 813 of 2,165 (59.1% / 37.6%) |
| prose parser capture on prose-only Greek pages (any extract / same extract) | 230 / 223 of 652 (35.3% / 34.2%) |
| manual precision, 60 parses (right / partial / wrong / unjudged) | 55 / 3 / 2 / 0 |
| top-10k shipped words with a classical chain | 2,391 |
| of those, silent today (no morphs, no org) | 553 |
| silent: single root under the 2-credit threshold | 320 |
| silent: structured split dropped by rules | 83 |
| silent: chain lemma reached only by a lookup rule | 42 |
| silent: chain lemma not found, no rule reaches it | 60 |
| silent: prose-only on source page, parser captures | 20 |
| silent: prose-only on English page, parser captures | 17 |
| silent: unused English split template | 11 |
| misses rendering under scenario C, all 1,752: decomposed / single / nothing | 488 / 1,039 / 225 |
| misses rendering under scenario C, top 10k: decomposed / single / nothing | 141 / 359 / 53 |
| roots.json with no threshold, build rules: roots / added bytes | 4,933 / 0.22 MB |
| roots.json with no threshold, proposed rules: roots / added bytes | 4,917 / 0.21 MB |

## 0. Top-10k classification, recomputed

Shipped words with fr <= 10,000 whose dominant entry carries a classical chain, and which ship neither morphs nor org. One class per word, first match in this order.

553 words in the class.

| class | words | share | examples |
|---|---|---|---|
| single root silenced by the 2-credit threshold | 320 | 57.9% | idea, use, turn, mine, close, cause, hour, sex |
| source lemma has a structured split, rules dropped it | 83 | 15.0% | jesus, system, present, honest, experience, type, energy, level |
| chain lemma not found, no rule reaches it | 60 | 10.8% | trouble, piece, madam, race, risk, apart, roll, san |
| chain lemma reached only by a lookup rule (section 3) | 42 | 7.6% | story, expect, george, history, david, surprise, christ, search |
| prose-only decomposition on the source page (parser captures) | 20 | 3.6% | pay, park, camera, violent, channel, equal, cage, whiskey |
| prose-only decomposition on the English page (parser captures) | 17 | 3.1% | promise, success, divorce, desire, collect, episode, response, remote |
| an English split template the build did not use | 11 | 2.0% | curious, mummy, electric, moron, tender, graduate, butcher, deceased |


## 1. Source-graph census

A lemma page is a page with at least one entry that is not a pure form-of entry. Template split means entry_split() returns two or more parts on the page's own language, the read parse_classical makes. Prose plus means the etymology_text, with any rendered etymology tree removed, contains ' + '. Structured single parent means an ety/etymon template whose second arg is a bare term (ety|la|memor), a link the pipeline does not read.

### 1a. Every lemma page

| extract | lemma pages | template split | prose plus only | neither | of neither: structured single parent |
|---|---|---|---|---|---|
| la | 46,126 | 17,946 (38.9%) | 2,165 (4.7%) | 26,015 (56.4%) | 245 |
| grc | 20,227 | 9,723 (48.1%) | 652 (3.2%) | 9,852 (48.7%) | 87 |

### 1b. Restricted to the lemmas shipped words reach

Chains recomputed with entry_chain() on the dominant entry and settled with Origin.settle(), so the keys are the ones the build judged.

| lemma set | lang | lemmas | template split | prose plus only | neither | no lemma page |
|---|---|---|---|---|---|---|
| words.json org lemmas (org.l and org.r) | la | 3,849 | 3,229 (83.9%) | 78 (2.0%) | 542 (14.1%) | 0 |
| words.json org lemmas (org.l and org.r) | grc | 516 | 441 (85.5%) | 5 (1.0%) | 70 (13.6%) | 0 |
| misses-report chain lemmas, settled | la | 1,087 | 87 (8.0%) | 99 (9.1%) | 624 (57.4%) | 277 |
| misses-report chain lemmas, settled | grc | 654 | 168 (25.7%) | 29 (4.4%) | 325 (49.7%) | 132 |
| every shipped word's chain lemma, settled | la | 6,644 | 4,401 (66.2%) | 221 (3.3%) | 1,359 (20.5%) | 663 |
| every shipped word's chain lemma, settled | grc | 1,832 | 915 (49.9%) | 58 (3.2%) | 536 (29.3%) | 323 |
| top-10k shipped words' chain lemmas, settled | la | 1,742 | 1,002 (57.5%) | 88 (5.1%) | 564 (32.4%) | 88 |
| top-10k shipped words' chain lemmas, settled | grc | 373 | 153 (41.0%) | 18 (4.8%) | 155 (41.6%) | 47 |

Prose-only chain lemmas, 16 at random (279 in the set):

| lemma | etymology_text (prose) |
|---|---|
| grc:δεινός | From Proto-Indo-European *dweynós, from *dwey- (“fear”); equivalent to δει- (dei-), the root of δείδω (deídō), + -νος (-nos). Compare δέος … |
| grc:νέκταρ | Of uncertain origin. Traditionally taken as a poetic compound, from Proto-Indo-European *neḱ- (“to perish; to disappear”) + *-tr̥h₂ (“overc… |
| grc:νόσος | Of uncertain origin. Willi's derivation from a putative Proto-Indo-European *n-h₁osu-o-s (“not good”), from *n̥- (“not, un-”) + a u-stem of… |
| grc:Σίβυλλα | Possibly from Doric Greek Σίοβολλα (Síobolla), akin to Attic Θεοβούλη (Theoboúlē, “divine will”), derived from θεός (theós, “god”) + βουλή … |
| grc:ἀλκυών | Unknown, apparently from Pre-Greek. The variant ᾰ̔λκῠών (hălkŭṓn) arose by folk etymology as ᾰ̔́λς (hắls, “salt”) + κῠέω (kŭéō, “to conceiv… |
| grc:ἔντερον | Neuter substantive of *ἔντερος (*énteros, “inside”), from Proto-Indo-European *h₁énteros, from *h₁én (whence also ἐν (en, “in”)) + *-teros … |
| la:aestimō | From Old Latin aestumō, whose origin is uncertain. Usually explained as aes (“copper, bronze”) + *temos (“cut”), so “one who cuts copper”, … |
| la:concussiō | From concutiō (“shake violently”), from con- + quatiō (“shake, hit”). |
| la:cynocephalus | From Ancient Greek κυνοκέφαλος (kunoképhalos), a compound of κύων (kúōn, “dog”) + κέφαλος (képhalos, “head”). |
| la:decimō | From decimus (“tenth”) + -ō. |
| la:dēlicātus | Judging from the meaning, from the root of dēliciae + -ātus. |
| la:ferōx | From Proto-Italic *ferōks, from earlier *xʷerōks, from Proto-Indo-European *ǵʰweroh₃kʷs (“having the appearance of a wild animal”), from *ǵ… |
| la:impatiēns | From im- (“without, not”) + patiēns (“suffering, patient”). |
| la:inveniō | From in- (“after”) + veniō (“come”). |
| la:satelles | Unexplained. Four possibilities are: * From Etruscan 𐌆𐌀𐌕𐌋𐌀𐌈 (zatlaθ) "follower, guard", maybe connected with Camunian zaθalas and zaθaú "st… |
| la:terrestris | Perhaps from Proto-Italic *terzestris, from *terzos + *-tris, the first of which would also be the base of terrēnus. The suffix -tris is po… |


## 2. Prose decomposition parser

The grammar. A sentence is tokenised into words and balanced parenthesis groups, so a plus inside a gloss never splits. Every ' + ' at depth zero joins the word before it (skipping its parentheses) to the word after it, and pluses chain. A term's language is the language name written before it (Latin, Medieval Latin, Ancient Greek, Old French and 80 more), else the last language name at depth zero earlier in the sentence, else the page's mention templates (m, m+, l, noncog, cog, af, bor, der), else Greek script means Ancient Greek, else the page's own language. A parenthesis after the head is scanned for a step ('ablative of X', 'past participle of X', 'frequentative of X', 'diminutive of X', 'feminine of X', 'plural of X' and kin, 30 keywords), and so is a trailing appositive (', accusative of mons'). A Greek head's transliteration is skipped. The step target, else the head, is looked up in the extract of the term's language, every page counted, and settled through the form-of hop. A page's parse is the first chain whose every part resolves, else its first chain.

### 2a. Latin and Greek pages with prose-only decomposition

| extract | pages | a chain parsed | captured (2+ parts, all resolve) | captured, all parts same language | 2 parts | 3 parts | 4+ parts |
|---|---|---|---|---|---|---|---|
| la | 2,165 | 2,132 | 1,280 (59.1%) | 813 | 1,186 | 92 | 2 |
| grc | 652 | 642 | 230 (35.3%) | 223 | 219 | 11 | 0 |

Why la parses failed (one count per failing part):

| reason | parts |
|---|---|
| reconstructed | 753 |
| no la page | 108 |
| stop-word head | 108 |
| no grc page | 69 |
| language ine-pro, no extract | 27 |
| language itc-pro, no extract | 25 |
| language he, no extract | 13 |
| language pl, no extract | 12 |

Why grc parses failed (one count per failing part):

| reason | parts |
|---|---|
| reconstructed | 286 |
| stop-word head | 124 |
| no grc page | 95 |
| language egy, no extract | 18 |
| language peo, no extract | 9 |
| language sa, no extract | 8 |
| language ine-pro, no extract | 6 |
| language el, no extract | 5 |

Failed parses, 12 at random:

| page | sentence | parsed | why |
|---|---|---|---|
| la:praestinō | From prae- + *stanō, the latter an unattested verb from Proto-Italic *stanō, from Proto-Indo-European *stnéh₂… | ?:prae- + ?:*stanō | reconstructed |
| la:Morinī | Celtic/Gaulish name, from Proto-Celtic *mori (“sea”) + common suffix -ni- found in other tribe names such as … | cel-pro:*mori + cel-pro:common | reconstructed; language cel-pro, no extract |
| grc:μάντις | Hoffman perhaps reflecting earlier *μάτις (*mátis) with analogical restoration of the nasal (similar to that … | ine-pro:*men- + ine-pro:*-tis | reconstructed; reconstructed |
| grc:ἀπηνής | From ἀπο- (apo-) + the root -η(ν)- (-ē(n)-) found in πρᾱνής (prānḗs, “prone”) and ἐνηής (enēḗs, “gentle, amia… | ?:ἀπο- + ?:the | stop-word head |
| la:iū̆xtā | * from Proto-Italic *jugistos (“closest”), equivalent to *(H)yug- + *-istHos (“superlative suffix”); however,… | itc-pro:yug- + itc-pro:*-istHos | language itc-pro, no extract; reconstructed |
| la:Vī̆stula | Often explained as from the Proto-Indo-European root *weys- (“to flow”) as in Proto-Germanic *waisǭ (“mire”),… | gem-pro:suffixed + gem-pro:*-lo + gem-pro:*-a | stop-word head; reconstructed; reconstructed |
| grc:πελεμίζω | Perhaps from a derivative of Proto-Indo-European *pel- (“drive”) + -ίζω (-ízō) | ine-pro:*pel- + ine-pro:-ίζω | reconstructed |
| grc:ἥκιστος | Superlative, possibly from *ἧκᾰ (*hêkă, “slightly”, attested as Epic ἦκᾰ (êkă)) + -ῐστος (-ĭstos). | ?:*ἧκᾰ + ?:-ῐστος | reconstructed |
| la:natoriēnsis | From Natori + -ēnsis. | ?:Natori + ?:-ēnsis | no la page |
| grc:-αλέος | Perhaps from *-ᾰλος (*-ălos) + -εος (-eos), but the second element is semantically problematic, and further e… | ?:*-ᾰλος + ?:-εος | reconstructed |
| grc:πολιοφυλακέω | From πόλις (pólis, “a city”) + *φυλακέω (*phulakéō, “to guard”) | ?:πόλις + ?:*φυλακέω | reconstructed |
| la:līber | Inherited from Old Latin loeber, from Proto-Italic *louðeros, from Proto-Indo-European *h₁léwdʰeros, from *h₁… | ine-pro:*h₁lewdʰ- + ine-pro:*-teros | reconstructed; reconstructed |

### 2b. English pages: top-10k shipped words with a classical chain

Split by what the word ships today. 'classical' means every part resolved to a Latin or Greek page: the row a source-graph origin subsystem would show.

| ships today | words | a chain parsed | captured | captured, all classical |
|---|---|---|---|---|
| silent | 553 | 100 | 65 (11.8%) | 60 (10.8%) |
| org | 1,389 | 388 | 319 (23.0%) | 311 (22.4%) |
| morphs | 449 | 447 | 365 (81.3%) | 99 (22.0%) |
| all | 2,391 | 935 | 749 | 470 |

Language mix of captured English parses:

| languages | parses |
|---|---|
| la | 405 |
| en | 272 |
| grc | 64 |
| en + la | 7 |
| grc + la | 1 |

Why English parses failed (one count per failing part):

| reason | parts |
|---|---|
| no la page | 87 |
| language fro, no extract | 40 |
| reconstructed | 30 |
| stop-word head | 29 |
| language enm, no extract | 22 |
| no grc page | 18 |
| no English page | 15 |
| language xno, no extract | 8 |

The English parse reads the dominant entry only, as the harvest does. The owner's example manuscript shows the limit: its plus clause ('equivalent to Latin manū + Latin scrīptus') sits on the adjective entry, the dominant noun entry has none, so the English side yields nothing, while the Latin page manuscriptus parses to manus + scribere through both steps (2a) and that is the row scenario C gives it.

Silent top-10k words whose English prose yields an all-classical split, first 20 by rank (60 in all):

| word | rank | sentence | parsed |
|---|---|---|---|
| promise | 558 | From Middle English promis, promisse, borrowed from Old French promesse, from Medieval Latin prōmis… | la:pro + la:mittere |
| system | 752 | Partly borrowed from Middle French sisteme, systeme, partly directly from its etymon Late Latin sys… | grc:σῠνίστημῐ + grc:-μᾰ |
| expect | 785 | From Latin expectāre, infinitive form of exspectō (“look out for, await, expect”), from ex (“out”) … | la:ex + la:spectō |
| george | 788 | Name of an early saint, from Middle English George, from Latin Geōrgius, from Ancient Greek Γεώργῐο… | grc:γῆ + grc:ἔργον |
| surprise | 869 | From Middle English surprise, borrowed from Middle French surprise (“an overtake”), nominal use of … | la:super- + la:prendere |
| experience | 1083 | From Middle English experience, from Old French, from Latin experientia (“a trial, proof, experimen… | la:ex + la:peritus |
| energy | 1232 | From Middle French énergie, from Late Latin energia, from Ancient Greek ἐνέργεια (enérgeia, “activi… | grc:ἐν + grc:ἔργον |
| surgery | 1714 | From Middle English surgerie, from Old French surgerie, from Latin chirurgia, from Ancient Greek χε… | grc:χείρ + grc:ἔργον |
| silence | 1792 | From Middle English silence, from Old French silence, from Latin silentium (“silence”), from silēns… | la:silēns->silēre + la:-ium |
| success | 1796 | Learned borrowing from Latin successus, from succēdō (“succeed”), from sub- (“next to”) + cēdō (“go… | la:sub- + la:cēdō |
| amount | 1799 | From Middle English amounten (“to mount up to, come up to, signify”), from Old French amonter (“to … | la:ad + la:montem->mons |
| divorce | 1825 | Derived from Old French divorce, from Latin dīvortium, from dīvertere (“to turn aside”), from dī- (… | la:dī- + la:vertere |
| period | 1988 | From Middle English periode, from Middle French periode, from Medieval Latin periodus, from Ancient… | grc:περι- + grc:ὁδός |
| request | 2026 | From Middle English request, from Old French requeste (French requête), from Vulgar Latin *requaesi… | la:re- + la:quaerō |
| desire | 2198 | From Middle English desir, desire (noun) and desiren (verb), from Old French desirer, desirrer, fro… | la:de- + la:sidus |
| intelligence | 2311 | From Middle English intelligence, from Old French intelligence, from Latin intelligentia, which is … | la:inter- + la:legere |
| collect | 2526 | From Middle English collecten, a borrowing from Old French collecter, from Medieval Latin collectar… | la:com- + la:legere |
| object | 2551 | From Old French object, from Medieval Latin obiectum (“object”, literally “thrown against”), from o… | la:ob- + la:iaciō |
| episode | 2570 | From French épisode, from New Latin *epīsodium, from Ancient Greek ἐπεισόδιον (epeisódion, “a paren… | grc:ἐπί + grc:εἰς + grc:ὁδός |
| response | 3123 | From Middle English respounse, respons, from Old French respons, respuns, responce, ultimately from… | la:re + la:spondeō |

Across all 1,752 misses, the English prose yields an all-classical split for 241.

### 2c. Manual precision check, 60 captured parses

40 from the source pages of 2a, 20 from the English pages of 2b, seeded random. The verdict column is a hand judgement of the parsed split against the sentence: right means the parts and steps are the ones the sentence states; partial means the parts are right but a step or a language is wrong, or one part resolved to the wrong page; wrong means the split is not what the sentence says.

| page | sentence | parsed split | verdict | reason |
|---|---|---|---|---|
| la:quadrigamus | Macaronic compound of Latin quattuor (“four”) + Ancient Greek γάμος (gámos, “marriage”). | la:quattuor + grc:γάμος | right | two languages, both named in the sentence |
| la:tumide | From tumidus (“swollen; pompous, bombastic”), from tumeō (“to swell”) + idus. | ?:tumeō + ?:idus | partial | the split is tumidus's, the parent; idus resolves to the noun īdūs, not the suffix -idus |
| la:etiamtunc | Univerbation of etiam (“yet”) + tunc (“then”). | ?:etiam + ?:tunc | right |  |
| la:panicoctarius | From pānis (“bread”) + coquō (“cook”). | ?:pānis + ?:coquō | right |  |
| grc:αἰσχροποιός | From αἰσχρός (aiskhrós, “shameful, obscene”) + ποιέω (poiéō, “to do, make”). | ?:αἰσχρός + ?:ποιέω | right |  |
| la:brabantia vallonica | Compound of Brabantia + vallonica, calque of French Brabant wallon. | ?:Brabantia + ?:vallonica | right |  |
| la:imparatus | From im- (“without, not”) + paratus (“prepared, ready”). | ?:im- + ?:paratus | right |  |
| la:cosariticus | Cosar + Ancient Greek -τῐκός (-tĭkós). | ?:Cosar + grc:-τῐκός | right | Greek suffix reached through the length-mark rule |
| la:antehac | From ante + hāc. | ?:ante + ?:hāc | right | hāc settles to hic through the form-of hop |
| la:antiphona | From Ancient Greek ἀντίφωνᾰ (antíphōnă, “responses, musical accords”), neuter plural substantive of ἀντίφωνος (antíphōn… | grc:ἀντί + grc:φωνή | right | the split of the Greek source, as the sentence states it |
| la:decapolis | Borrowed from Ancient Greek Δεκάπολις (Dekápolis), from δέκα (déka, “ten”) + πόλις (pólis, “city”). | grc:δέκα + grc:πόλις | right |  |
| la:bacchanal | Substantivation of apocopated Bacchānāle, nominative neuter singular of Bacchānālis (“pertaining to Bacchus”), perhaps … | ?:Bacchus + ?:-ānus | partial | the sentence's own split is Bacchānus + -ālis (Bacchānus has no page); the parse took the inner split of the intermediate |
| la:ablocatus | Perfect passive participle from ablocō (“lease; hire, contract”), from ab (“from, away from”) + locō (“place; lease”), … | ?:ab + ?:locō | right | the split of the parent verb, which is what flatten would show |
| la:crucigaster | From crux (“cross”) + gaster (“belly”). | ?:crux + ?:gaster | right |  |
| la:vernicomus | From vernus ("spring") + coma ("hair"). | ?:vernus + ?:coma | right |  |
| la:decemvir | From decem (“ten”) + vir (“man”). | ?:decem + ?:vir | right |  |
| la:nova anglia | Calque of English New England, from nova (“new”) + Anglia (“England”). | en:nova + en:Anglia | partial | parts right, language wrong: 'English' from the calque phrase was inherited, the parts are Latin |
| la:oxymorus | First attested in the 5th century, from Ancient Greek ὀξύμωρος (oxúmōros), from Ancient Greek ὀξύς (oxús, “sharp, keen”… | grc:ὀξύς + grc:μωρός | right |  |
| la:syllaba | From Ancient Greek συλλαβή (sullabḗ), from σύν (sún, “with, together”) + λαμβάνω (lambánō, “to take”). | grc:σύν + grc:λαμβάνω | right |  |
| la:nonnumquam | Univerbation of nōn (“not”) + numquam (“never”). | ?:nōn + ?:numquam | right |  |
| la:hepatites | Borrowed from Ancient Greek ἡπατίτης (hēpatítēs), from ἧπαρ (hêpar, “liver”) + -ῑ́της (-ī́tēs). | grc:ἧπαρ + grc:-ῑ́της | right | length-mark rule on the suffix |
| grc:ἀφάρκη | The derivation from ἀπό (apó, “from”) + ἄρκυς (árkus, “net”) suggested by Strömberg is probably just folk-etymological. | ?:ἀπό + ?:ἄρκυς | wrong | the sentence rejects this split as folk etymology; the parser has no stance |
| grc:δίπλωσις | From διπλόω (diplóō, “to double”) + -σις (-sis, “-sis”). | ?:διπλόω + ?:-σις | right |  |
| la:patefacio | From pateō (“be open”) + faciō (“make, construct”). | ?:pateō + ?:faciō | right |  |
| la:fortuitus | From *fortu- (“chance, luck, fortune”) + -ītus (suffix forming adjectives). *Fortu- is derived from an unattested u-ste… | ?:fors + ?:-tus | wrong | the page's split is *fortu- + -ītus; the parse is the split of an unattested stem inside the explanation |
| la:augur | * From avis (“bird”) + garrire (“to talk”), as augurs were known to observe the behavior of birds. | ?:avis + ?:garrire | right | one of several listed hypotheses, stated as such |
| la:pater familias | From pater (“father”) + familiās, an archaic genitive of familia (“family", "household”), literally meaning "father of … | ?:pater + ?:familiās | right | familiās settles to familia through the form-of hop; the appositive step was not read |
| la:brabantia septentrionalis | Compound of Brabantia + septentriōnālis, calque of Dutch Noord-Brabant. | ?:Brabantia + ?:septentriōnālis | right |  |
| la:analysis | From Ancient Greek ἀνάλυσις (análusis), from ἀναλύω (analúō, “to unravel, investigate”), from ἀνά (aná, “on, up”) + λύω… | grc:ἀνά + grc:λύω | right |  |
| la:derogatorius | From dērogō (“repeal or modify part of a law; remove; disparage”), from de (“of; from, away from”) + rogō (“ask; reques… | ?:de + ?:rogō | right | the sentence gives the parent's split only; -tōrius is not in the prose |
| la:coronilla | From Spanish coronilla, from Latin corona (“crown”) + -illa. | la:corona + la:-illa | right |  |
| la:naepor | Probably contracted from the assumed *Naevīpor, from Naevī (early genitive form of Naevius) + -por (forms names of male… | ?:Naevī->Naevius + ?:-por | right | genitive step read |
| la:pater noster | From pater (“father”) + noster (“our”). | ?:pater + ?:noster | right |  |
| la:lanterna magica | New Latin, from lanterna + magica | la:lanterna + la:magica | right |  |
| la:acca | Sheldon instead sees here a fusion of ha + ka (“the letter K”). | ?:ha + ?:ka | right | a speculative fusion of two letter names, stated as such; the parts resolve to the letter pages |
| la:zygostasium | Learned borrowing from Ancient Greek ζυγοστάσιον (zugostásion), from ζυγόν (zugón) + στάσις (stásis) + -ιον (-ion). | grc:ζυγόν + grc:στάσις + grc:-ιον | right |  |
| la:insanabilis | From in- + sānō + -abīlis. | ?:in- + ?:sānō + ?:-abīlis | right |  |
| la:duoetvicesimus | Formally from duo (“two”) + et (“and”) + vīcēsimus (“twentieth”), ordinal form of vīgintī duo (“twenty-two”). | ?:duo + ?:et + ?:vīcēsimus | right |  |
| la:pars pro toto | From pars (“part”) + prō (“for”) + tōtō, ablative singular of tōtus (“whole, entire”). | ?:pars + ?:prō + ?:tōtō->tōtus | right | ablative step read |
| la:cenotaphium | Borrowed from Ancient Greek κενοτᾰ́φῐον (kenotắphĭon, “empty tomb”), from κενός (kenós, “empty”) + τᾰ́φος (tắphos, “gra… | grc:κενός + grc:τᾰ́φος + grc:-ῐον | right |  |
| en:manage | From Early Modern English manage, menage, from Middle English *manage, *menage, from Old French manege (“the handling o… | la:manus + la:-izāre | right | the Vulgar Latin reconstruction's parts, both Latin pages |
| en:proceed | From Middle English proceden, from Old French proceder, from Latin prōcēdō (“to go forth, go forward, advance”), from p… | la:prō + la:cēdō | right |  |
| en:photographer | From photograph + -er, from Ancient Greek φωτός (phōtós), genitive singular of φῶς (phôs, “light”) (fōs) and γράφω (grá… | ?:photograph + ?:-er | right | English surface split, the sentence's first chain |
| en:education | Morphologically educate + -ion. | ?:educate + ?:-ion | right |  |
| en:conscience | From Middle English conscience, from Old French conscience, from Latin conscientia (“knowledge within oneself”) (a calq… | la:com- + la:scire | right |  |
| en:republic | From Middle French republique (“republic”), from Latin rēspūblicā, from rēs (“thing”) + pūblica (“public”); hence liter… | la:rēs + la:pūblica | right |  |
| en:decide | From Middle English deciden, from Old French decider, from Latin dēcīdere, infinitive of dēcīdō (“cut off, decide”), fr… | la:dē + la:caedō | right |  |
| en:astronaut | From astro- + -naut. | ?:astro- + ?:-naut | right |  |
| en:adore | From Middle English *adoren, aouren, from Old French adorer, aorer, from Latin adōrō (“to pray to”), from ad (“to”) + ō… | la:ad + la:ōrō | right |  |
| en:musical | From Middle English musical, from Old French [Term?], from Medieval Latin mūsicālis, from Latin mūsica (“music”) + -āli… | la:mūsica + la:-ālis | right |  |
| en:insane | From Latin īnsānus (“unsound in mind; mad, insane”), from in- + sānus (“sound, sane”), equivalent to in- + sane. | la:in- + la:sānus | right |  |
| en:combat | 16th century, borrowed from Middle French combat, deverbal from Old French combatre, from Vulgar Latin *combattere, fro… | la:com- + la:battuere | right |  |
| en:perimeter | Equivalent to peri- + meter. | ?:peri- + ?:meter | right |  |
| en:majority | Morphologically major + -ity. | ?:major + ?:-ity | right |  |
| en:capital | From Middle English capital, borrowed partly from Old French capital and partly from Latin capitālis (“of the head”) (i… | la:caput + la:-ālis | right |  |
| en:apology | From French apologie, from Late Latin apologia, from Ancient Greek ἀπολογία (apología, “a speech in defence”), from ἀπο… | grc:ἀπό + grc:λόγος | right |  |
| en:anniversary | From Middle English anniversary, from Medieval Latin anniversāria (diēs), anniversārium, from anniversārius (“yearly”),… | la:annus + la:versus->vertere | right | participle step read |
| en:candidate | From Latin candidātus (“a person who is standing for public office”, noun), from candidus (“dazzling white, shining, cl… | la:candidus + la:-ātus | right |  |
| en:excuse | From Middle English excusen (verb) and excuse (noun), borrowed from Old French escuser (verb) and excuse (noun), from L… | la:ex + la:causa | right |  |
| en:detect | From Latin detectus, perfect passive participle of detegere (“to uncover or disclose”), from de- + tegere (“to cover”);… | la:de- + la:tegere | right |  |

Verdicts: partial 3, right 55, wrong 2.


## 3. Lookup failures

The chain lemmas of the misses-report words and of the top-10k shipped words with a chain, settled with Origin.settle(). Not found means the settled key is in neither the gloss table nor the split table of its extract, the condition under which the build ships nothing. Every failure is then retried with the spike's lookup rules, applied in this order and repeated until a glossed or split page is reached or nothing applies: trailing punctuation and a//b alternation on the template arg; Greek vowel-length marks (macron, breve) removed, accents and breathings kept; the form-of hop repeated (settle takes one); every combining mark removed; the ae/oe/j/v fold. What no rule reaches is classified by where the lemma does exist.

### misses-report words: 1,752 chains, 421 not found (24.0%), 147 recovered by a rule (34.9% of the failures)

Recovered, by the rules a chain needed:

| rule combination | chains |
|---|---|
| Greek length marks | 84 |
| form-of hop 2 | 49 |
| Greek accent or breathing | 7 |
| Greek length marks + Greek accent or breathing | 3 |
| all marks stripped | 2 |
| trailing punctuation | 1 |
| Greek accent or breathing + form-of hop 2 | 1 |

Per rule (a chain needing two rules counts under both):

| rule | chains |
|---|---|
| Greek length marks | 87 |
| form-of hop 2 | 50 |
| Greek accent or breathing | 11 |
| all marks stripped | 2 |
| trailing punctuation | 1 |

Not recovered:

| where the lemma is | chains | share of failures |
|---|---|---|
| no page anywhere | 212 | 50.4% |
| multiword lemma | 40 | 9.5% |
| exists only as an English page | 19 | 4.5% |
| page exists: form-of chain ends on a glossless page | 2 | 0.5% |
| page exists: lemma page with no usable gloss | 1 | 0.2% |

### top-10k shipped words with a chain: 2,391 chains, 136 not found (5.7%), 52 recovered by a rule (38.2% of the failures)

Recovered, by the rules a chain needed:

| rule combination | chains |
|---|---|
| Greek length marks | 31 |
| form-of hop 2 | 15 |
| Greek accent or breathing | 3 |
| trailing punctuation | 1 |
| form-of hop 2 + Greek accent or breathing | 1 |
| Greek length marks + Greek accent or breathing | 1 |

Per rule (a chain needing two rules counts under both):

| rule | chains |
|---|---|
| Greek length marks | 32 |
| form-of hop 2 | 16 |
| Greek accent or breathing | 5 |
| trailing punctuation | 1 |

Not recovered:

| where the lemma is | chains | share of failures |
|---|---|---|
| no page anywhere | 62 | 45.6% |
| multiword lemma | 17 | 12.5% |
| exists only as an English page | 5 | 3.7% |

Examples per rule and per residual class, up to 8 each, both sets:

| rule or class | word | chain lemma | page reached |
|---|---|---|---|
| Greek length marks | story | grc:ῐ̔στορῐ́ᾱ | ἱστορία |
| Greek length marks | george | grc:Γεώργῐος | γεώργιος |
| Greek length marks | history | grc:ἱστορίᾱ | ἱστορία |
| Greek length marks | david | grc:Δαυῑ̈́δ | δαυΐδ |
| Greek length marks | christ | grc:Χρῑστός | χριστός |
| Greek length marks | daniel | grc:Δᾱνῑήλ | δανιήλ |
| Greek length marks | theater | grc:θέᾱτρον | θέατρον |
| Greek length marks | guitar | grc:κῐθᾰ́ρᾱ | κιθάρα |
| no page anywhere | trouble | la:turbula | - |
| no page anywhere | piece | la:petia | - |
| no page anywhere | risk | grc:ῥιζικό | - |
| no page anywhere | roll | la:rollāre | - |
| no page anywhere | san | grc:σάν | - |
| no page anywhere | gordon | la:Gordus | - |
| no page anywhere | object | grc:ἀντικείμενον | - |
| no page anywhere | jordan | la:jurdanus | - |
| form-of hop 2 | expect | la:expectāre | exspecto |
| form-of hop 2 | surprise | la:prendere | prehendo |
| form-of hop 2 | request | la:requīsīta | requiro |
| form-of hop 2 | junior | la:junior | iuvenis |
| form-of hop 2 | ann | la:annata | adnato |
| form-of hop 2 | intelligent | la:intelligens | intellego |
| form-of hop 2 | signature | la:signātūra | signo |
| form-of hop 2 | minimum | la:minimum | parvus |
| multiword lemma | madam | la:mea domina | - |
| multiword lemma | race | la:linea sanguinis | - |
| multiword lemma | apart | la:ad partem | - |
| multiword lemma | amount | la:ad montem | - |
| multiword lemma | percent | la:per centum | - |
| multiword lemma | marco | la:Marcus Paulus | - |
| multiword lemma | lincoln | la:Lindum Colōnia | - |
| multiword lemma | si | la:Sāncte Iohannēs | - |
| trailing punctuation | search | la:circō, | circo |
| Greek accent or breathing | pope | grc:πάπας | πάππας |
| Greek accent or breathing | circus | grc:κρίκος | κίρκος |
| Greek accent or breathing | antidote | grc:ἀντίδοτον | ἀντίδοτος |
| Greek accent or breathing | practise | grc:πρᾱκτική | πρακτικός |
| Greek accent or breathing | martyr | grc:μάρτυρ | μάρτυς |
| Greek accent or breathing | palestine | grc:Παλαιστινὸς | παλαιστινός |
| Greek accent or breathing | tian | grc:τήγανον | τάγηνον |
| Greek accent or breathing | ion | grc:ἰόν | εἶμι |
| exists only as an English page | pan | la:panna | - |
| exists only as an English page | advise | la:advisō | - |
| exists only as an English page | ordeal | la:ordālium | - |
| exists only as an English page | conclusive | la:conclūsīvē | - |
| exists only as an English page | conservatory | la:cōnservātōrium | - |
| exists only as an English page | sarcophagus | la:sarcophagī | - |
| exists only as an English page | leviathan | la:leviathan | - |
| exists only as an English page | cabal | la:cabbala | - |
| page exists: lemma page with no usable gloss | contradict | la:contrādictus | - |
| page exists: form-of chain ends on a glossless page | odyssey | grc:Ὀδυσσεία | - |
| page exists: form-of chain ends on a glossless page | flotsam | la:-atio | - |
| all marks stripped | coercion | la:coërcitiō | coercitio |
| all marks stripped | coerce | la:coërceō | coerceo |


## 4. Etymology tree coverage

The tree is walked from the templates, not from the rendered text: every ety/etymon template on the English page gives its analyses (':inh enm:x<ety:der<la:y>>', ':af a b', a bare parent), a Latin or Greek node is expanded through the ety/etymon templates on its own page (a decomposition analysis first, else the single linear parent), and reconstructed forms stop. Depth cap 8, cycle-safe. A tree decomposes when a Latin or Greek node has a decomposition analysis with two or more parts. Its leaf set is the classical nodes at the bottom of that expansion, which is what a source-graph origin subsystem would show before any anchor rule. The emitted set is the org row in words.json (part root keys, or the single root key).

| word set | words | page carries etymon/ety | tree reaches Latin or Greek | tree reaches a classical node that decomposes |
|---|---|---|---|---|
| top-10k shipped | 7,745 | 2,111 (27.3%) | 254 (12.0%) | 134 (6.3%) |
| all shipped | 82,843 | 26,352 (31.8%) | 997 (3.8%) | 496 (1.9%) |

Tree against what the pipeline emits, among words whose tree reaches a classical node:

| comparison | top-10k shipped | all shipped |
|---|---|---|
| agree | 51 | 141 |
| tree deeper | 5 | 15 |
| tree shallower | 2 | 3 |
| different | 46 | 147 |
| tree stops short (source page has no etymon template) | 10 | 23 |
| pipeline silent, tree decomposes | 28 | 107 |
| pipeline silent, tree single | 64 | 215 |
| pipeline shows morphs (English split) | 48 | 346 |

Notes. 'tree deeper': the pipeline stops recursion at anchors (ORG_ANCHOR_MIN 2) and at ORG_DEPTH 3, and the tree walk does neither, so a deeper tree is often the same split the anchor's card carries. 'tree stops short': the walk reached one classical page that carries no etymon template at all, while the pipeline's af/suffix read of that page, or its last-template chain rule, went further; that is a gap in Wiktionary's etymon coverage, not a disagreement. 'different' and 'pipeline silent, tree decomposes' are the rows to read.

20 disagreements (the 10 highest-ranked silent-or-different, then 10 at random):

| word | rank | verdict | tree | emitted | tree leaves |
|---|---|---|---|---|---|
| energy | 1232 | pipeline silent, tree decomposes | en:energy = frm:énergie = (la:energīa = (grc:ἐνέργεια = (grc:ἐνεργής = (grc:ἐνεργός = (grc:ἐν- = (grc:ἐν = (ine-pro:*h₁én)) + grc:ἔργον = (grk-pro:*w… | - | grc:-ής, grc:-ιᾰ, grc:-ος, grc:ἐν, grc:ἔργον |
| level | 1286 | pipeline silent, tree decomposes | en:level = enm:level = (fro:livel = (la:libella = (la:lībra = (itc-pro:*līðrā) + la:-lus = (itc-pro:*-elos)))) \| en:level = enm:level = (fro:livel = … | - | la:-lus, la:libra |
| success | 1796 | pipeline silent, tree decomposes | en:success = la:successus = (la:succēdō = (la:sub- = (la:sub = (itc-pro:*supo)) + la:cēdō = (itc-pro:*kezdō))) | - | la:cedo, la:sub |
| theory | 1830 | pipeline silent, tree decomposes | en:theory = frm:théorie = (la:theōria = (grc:θεωρία = (grc:θεωρός = (grc: = (grc:θέᾱ + grc:ὁράω)) + grc:-ῐ́ᾱ))) | - | grc:-ῐ́ᾱ, grc:θέᾱ, grc:ὁράω |
| object | 2551 | pipeline silent, tree decomposes | en:object = fro:object = (la:obiectum = (la:obiectus = (la:obiciō = (la:ob- = (la:ob = (itc-pro:*op)) + la:iaciō = (ine-pro:*(H)yéh₁kt))))) \| en:obje… | - | la:iacio, la:ob |
| salt | 2621 | pipeline silent, tree decomposes | en:salt = la:saltus = (la:saliō = (la:sāl = (itc-pro:*sāls) + la:-iō = (la:-ō = (itc-pro:*-ōd))) + la:-tus = (itc-pro:*-tos)) | - | la:-o, la:-tus, la:sal |
| turkey | 3127 | pipeline silent, tree decomposes | en:turkey = en:Turkey \| en:turkey = enm:Turkye = (xno:Turkye = (la:Turcia = (grc:Τουρκίᾱ = (grc:Τοῦρκος = (fa-cls:ترک) + grc:-ίᾱ)))) \| en:turkey = en… | - | grc:-ίᾱ, grc:τοῦρκος |
| electric | 3232 | pipeline silent, tree decomposes | en:electric = la:ēlectricus = (la:ēlectrum = (grc:ἤλεκτρον) + la:-icus = (itc-pro:*-ikos)) \| en:electric = la:ēlectricus = (la:ēlectrum = (grc:ἤλεκτρ… | - | la:-icus, la:electrum |
| scientific | 3540 | pipeline silent, tree decomposes | en:scientific = frm:scientifique = (la:scientificus = (la:scientia = (la:sciēns = (ine-pro:*skey-) + la:-ia = (la:-ius = (itc-ola:-ios))) + la:-ficus… | - | la:-ficus, la:-ius, la:sciens |
| strategy | 3682 | pipeline silent, tree decomposes | en:strategy = la:stratēgia = (grc:στρατηγία = (grc:στρᾰτηγός + grc:-ία = (grk-pro:*-íā))) | - | grc:-ία, grc:στρᾰτηγός |
| therapy | 3008 | different | en:therapy = la:therapīa = (grc:θεραπεία = (grc:θεραπεύω = (grc:θερᾰ́πων + grc:-εύω = (grc:-εύς = (qsb-grc:-))) + grc:-ία = (grk-pro:*-íā))) \| en:the… | grc:-ία, grc:θεραπεύω | grc:-ία, grc:-εύς, grc:θερᾰ́πων |
| series | 2395 | different | en:series = la:seriēs | la:-ies, la:sero | la:series |
| colony | 5711 | different | en:colony = enm:colane = (la:colōnia = (la:colōnus = (la:colō = (la:cōlum + la:-ō = (itc-pro:*-ōd))) + la:-ia = (la:-ius = (itc-ola:-ios)))) \| en:col… | la:-ia, la:colonus | la:-ius, la:-o, la:colum |
| spontaneous | 9687 | pipeline silent, tree decomposes | en:spontaneous = la:spontāneus = (la:sponte + la:-āneus = (la:-ānus = (itc-pro:*-ānos) + la:-eus = (itc-pro:*-eos))) | - | la:-anus, la:-eus, la:sponte |
| order | 532 | tree shallower | en:order = enm:ordre = (fro:ordne = (la:ōrdō = (itc-pro:*ordō))) \| en:order = enm:ordre = (fro:ordne = (la:ōrdō = (itc-pro:*ordō))) | la:-o, la:ordo | la:ordo |
| abort | 9046 | different | en:abort = enm: = (la:abortus = (la:aborior = (la:ab- = (la:ab = (itc-pro:*ap)) + la:orior = (itc-pro:*oriōr)) + la:-tus = (itc-pro:*-tos))) \| en:abo… | la:ab-, la:orior | la:-tus, la:ab, la:orior |
| phoenix | 5499 | different | en:phoenix = la:phoenīx < la:Phoenīx \| en:phoenix = la:phoenīx < la:Phoenīx | grc:φοῖνιξ | la:phoenix |
| exercise | 3058 | different | en:exercise = enm:exercise = (fro:exercise = (la:exercitium = (la:exerceō = (la:ex- = (la:ex = (itc-pro:*eks)) + la:arceō = (itc-pro:*arkeō))))) \| en… | la:-ium, la:arceo, la:ex- | la:arceo, la:ex |
| advise | 4594 | pipeline silent, tree decomposes | en:advise = enm:avisen \| en:advise = la:advisō = (la:ad- = (itc-pro:*ad-) + la:visō = (itc-pro:*weidsō)) \| en:advise = enm:avisen \| en:advise = la:ad… | - | la:ad-, la:viso |
| collective | 8397 | pipeline silent, tree decomposes | en:collective = frm:collectif = (la:collēctīvus = (la:collēctus = (la:con- = (itc-pro:*kom-) + la:legō = (la:lēx = (itc-pro:*lēks) + la:-ō = (itc-pro… | - | la:-ivus, la:-o, la:con-, la:lex |


## 5. Rule drops

Every misses-report word, its chain settled and resolved through the build's own Origin (same anchors, same flatten). The class in question is the words whose settled lemma carries a structured split in its extract. The reason is the first check that stops the row: flatten's refusal when the row ships single, then the 2-credit threshold against the shipped roots.json. Credits are recomputed the way link_and_prune counts them. A dead-end part is reported with the lookup rule that would reach it, when one does.

All 1,752 misses by class:

| class | words | share |
|---|---|---|
| found, no structured split: single root under threshold | 1,076 | 61.4% |
| chain lemma not found (section 3) | 421 | 24.0% |
| found, structured split (this section) | 255 | 14.6% |

Drop reason for the 255 words whose lemma has a structured split:

| reason | words | share |
|---|---|---|
| dead-end part, lookup rule reaches it, then 2-credit threshold on the single root | 129 | 50.6% |
| form-of part, then 2-credit threshold on the single root | 83 | 32.5% |
| dead-end part, then 2-credit threshold on the single root | 28 | 11.0% |
| 2-credit threshold: decomposed, every part's root under 2 credits | 13 | 5.1% |
| self-part split, then 2-credit threshold on the single root | 1 | 0.4% |
| affix-terminal, then 2-credit threshold on the single root | 1 | 0.4% |

Examples (the named words first, then 4 per reason):

| word | rank | reason | detail |
|---|---|---|---|
| system | 752 | dead-end part, lookup rule reaches it, then 2-credit threshold on the single root | σύστημα -> grc:σύστημα \| dead-end part, lookup rule reaches it (part σῠνῐ́στημῐ -> συνίστημι via Greek length marks) \| credits 1 |
| period | 1988 | dead-end part, lookup rule reaches it, then 2-credit threshold on the single root | περίοδος -> grc:περίοδος \| dead-end part, lookup rule reaches it (part περῐ́ -> περί via Greek length marks) \| credits 1 |
| prophecy | 8448 | dead-end part, lookup rule reaches it, then 2-credit threshold on the single root | προφητεία -> grc:προφητεία \| dead-end part, lookup rule reaches it (part -ίᾱ -> -ία via Greek length marks) \| credits 1 |
| vessel | 4566 | form-of part, then 2-credit threshold on the single root | vāscellum -> la:vascellum \| form-of part (part -lus is a form-of page, flatten does not step it) \| credits 1 |
| bachelor | 5326 | dead-end part, then 2-credit threshold on the single root | baccalārius -> la:baccalarius \| dead-end part (part baccalia has no page) \| credits 1 |
| jesus | 645 | dead-end part, lookup rule reaches it, then 2-credit threshold on the single root | Ἰησοῦς -> grc:ἰησοῦς \| dead-end part, lookup rule reaches it (part Ῐ̓ησοῦ -> ἰησοῦς via Greek length marks, Greek accent or breathing) \| credits 1 |
| honest | 959 | dead-end part, lookup rule reaches it, then 2-credit threshold on the single root | honestus -> la:honestus \| dead-end part, lookup rule reaches it (part honor//honōs -> honor via a//b alternation) \| credits 1 |
| type | 1150 | dead-end part, lookup rule reaches it, then 2-credit threshold on the single root | τύπος -> grc:τύπος \| dead-end part, lookup rule reaches it (part τῠ́πτω -> τύπτω via Greek length marks) \| credits 1 |
| energy | 1232 | dead-end part, lookup rule reaches it, then 2-credit threshold on the single root | ἐνέργεια -> grc:ἐνέργεια \| dead-end part, lookup rule reaches it (part -ιᾰ -> -ια via Greek length marks) \| credits 1 |
| present | 853 | form-of part, then 2-credit threshold on the single root | praesentō -> la:praesento \| form-of part (part praesens is a form-of page, flatten does not step it) \| credits 1 |
| experience | 1083 | form-of part, then 2-credit threshold on the single root | experientia -> la:experientia \| form-of part (part experiēns is a form-of page, flatten does not step it) \| credits 1 |
| level | 1286 | form-of part, then 2-credit threshold on the single root | libella -> la:libella \| form-of part (part -lus is a form-of page, flatten does not step it) \| credits 1 |
| science | 1531 | form-of part, then 2-credit threshold on the single root | scientia -> la:scientia \| form-of part (part sciēns is a form-of page, flatten does not step it) \| credits 1 |
| consider | 1353 | dead-end part, then 2-credit threshold on the single root | considero -> la:considero \| dead-end part (part sīder- has no page) \| credits 1 |
| instance | 3635 | dead-end part, then 2-credit threshold on the single root | īnstantia -> la:instantia \| dead-end part (part īnstānsīnstō has no page) \| credits 1 |
| catholic | 4087 | dead-end part, then 2-credit threshold on the single root | καθολικός -> grc:καθολικός \| dead-end part (part κᾰθόλου has no page) \| credits 1 |
| phase | 4183 | dead-end part, then 2-credit threshold on the single root | φάσις -> grc:φάσις \| dead-end part (part φαίνωφαίνω (phaínō, “to bring to light; to appear”) has no page) \| credits 1 |
| pigeon | 6635 | self-part split, then 2-credit threshold on the single root | pipio -> la:pipio \| self-part split (pīpiō names itself) \| credits 1 |
| sponge | 8836 | 2-credit threshold: decomposed, every part's root under 2 credits | σπογγιά = σπόγγος[grc:σπόγγος] + -ιά[grc:-ιά] \| credits σπόγγος=1, -ιά=1 |
| marathon | 8876 | 2-credit threshold: decomposed, every part's root under 2 credits | Μαραθών = μάραθον[grc:μάραθον] + -ών[grc:-ών] \| credits μάραθον=1, -ών=1 |
| moor | 13754 | 2-credit threshold: decomposed, every part's root under 2 credits | Μαυρούσιος = Μαῦρος[grc:μαῦρος] + -ούσιος[grc:-ούσιος] \| credits μαῦρος=1, -ούσιος=1 |
| ruckus | 14292 | 2-credit threshold: decomposed, every part's root under 2 credits | raucus = ravis[la:ravis] + -cus[la:-cus] \| credits ravis=1, -cus=1 |
| terminology | 29346 | affix-terminal, then 2-credit threshold on the single root | -λογία -> grc:-λογία \| affix-terminal (the lemma page is an affix) \| credits 1 |

The same 255 words re-run with the proposed part rules (Greek length marks stripped, form-of parts stepped to their lemma, a//b cleaned), threshold not applied:

| outcome | words | share |
|---|---|---|
| decomposes | 222 | 87.1% |
| still single: dead-end part | 28 | 11.0% |
| still single: form-of part | 2 | 0.8% |
| still single: self-part split | 1 | 0.4% |
| still single: all-or-nothing gloss refusal | 1 | 0.4% |
| still single: affix-terminal | 1 | 0.4% |

| word | rank | outcome | row or reason |
|---|---|---|---|
| system | 752 | decomposes | σύστημα = συν-[grc:συν-] + ἵστημι[grc:ἵστημι] + -μα[grc:-μα] |
| period | 1988 | decomposes | περίοδος = περί[grc:περί] + ὁδός[grc:ὁδός] |
| vessel | 4566 | decomposes | vāscellum = vās[la:vas] + -culus[la:-ulus] + -ulus[la:-ulus] |
| bachelor | 5326 | still single: dead-end part | dead-end part (part baccalia has no page) |
| prophecy | 8448 | decomposes | προφητεία = προ-[grc:προ-] + φημί[grc:φημί] + -της[grc:-της] + -ία[grc:-ία] |
| jesus | 645 | still single: form-of part | form-of part (part Ῐ̓ησοῦ is a form-of page, flatten does not step it) |
| precocious | 32262 | still single: form-of part | form-of part (part praecoquō is a form-of page, flatten does not step it) |
| present | 853 | decomposes | praesentō = praesum[la:praesum] + -ō[la:-o] |
| honest | 959 | decomposes | honestus = honor[la:honor] + -tus[la:-tus] |
| experience | 1083 | decomposes | experientia = experior[la:experior] + -ia[la:-ia] |
| consider | 1353 | still single: dead-end part | dead-end part (part sīder- has no page) |
| instance | 3635 | still single: dead-end part | dead-end part (part īnstānsīnstō has no page) |
| catholic | 4087 | still single: dead-end part | dead-end part (part κᾰθόλου has no page) |
| pigeon | 6635 | still single: self-part split | self-part split (pīpiō names itself) |
| sigma | 21264 | still single: all-or-nothing gloss refusal | all-or-nothing gloss refusal (part σῐ́ζω has a page, no usable gloss) |
| terminology | 29346 | still single: affix-terminal | affix-terminal (the lemma page is an affix) |


## 6. Threshold silence cost

Scenario A: every root key any shipped word references before the 2-credit threshold, the build's own Origin: morph chips as words.json resolved them, plus the org row each pending word would carry, plus anchor closure. A key ships only with a gloss, exactly as link_and_prune requires, so glossless keys are counted separately. Scenario B: the same with the proposed lookup and part rules (sections 3 and 5) applied to every chain.

| measure | scenario A (build rules) | scenario B (proposed rules) |
|---|---|---|
| roots shipped today | 3,021 | 3,021 |
| root keys referenced, with a gloss, before the threshold | 4,933 | 4,875 |
| of those, under 2 credits | 1,912 | 1,741 |
| referenced keys with no gloss (never shippable) | 410 | 0 |
| roots.json would carry | 4,933 | 4,917 |
| extra roots over today | 1,912 | 1,896 |
| bytes per root today (roots.json / roots) | 113 | 113 |
| added bytes at that size | 216,676 (0.22 MB) | 214,863 (0.21 MB) |

Scenario B recomputes the anchors under the patched tables (955 against 884) and credits through them the way link_and_prune does. Its key set is not a superset of A's: 294 keys are referenced only under A and 236 only under B, because lemmas that now decompose stop being roots and their bases take over (A names grc:βάσις and grc:γένεσις, B names grc:βαίνω, grc:γίγνομαι and grc:-σις). Examples only under A: grc:αἱμορραγία, grc:αὐτός, grc:βάσις, grc:βαπτίζω, grc:βαρύτονος, grc:βλασφημία, grc:βλῆμα, grc:βοτάνη. Only under B: grc:-άνη, grc:-άρχης, grc:-ήθρα, grc:-ίας, grc:-ίς, grc:-ίσκος, grc:-ίων, grc:-α.

Of the 1,752 misses, with every glossed root shipping:

| outcome | scenario A | scenario B |
|---|---|---|
| decomposed row | 13 (0.7%) | 302 (17.2%) |
| single row | 1,318 (75.2%) | 1,176 (67.1%) |
| no row (chain lemma not found in the extract) | 421 (24.0%) | 274 (15.6%) |

Scenario C: scenario B, then the source-page prose parser where the settled lemma is a prose-only page it captures, then the English-page prose parser where its split is all classical. What each miss would render:

| outcome | all 1,752 misses | the 553 misses inside the top 10k |
|---|---|---|
| decomposed (templates, proposed rules) | 302 (17.2%) | 93 (16.8%) |
| decomposed (source-page prose) | 57 (3.3%) | 20 (3.6%) |
| decomposed (English-page prose) | 129 (7.4%) | 28 (5.1%) |
| single row | 1,039 (59.3%) | 359 (64.9%) |
| nothing | 225 (12.8%) | 53 (9.6%) |


## 7. Never-silent sanity

Top-10k shipped words with no morphs and no org whose chain resolves to a single glossed root that did not ship. 40 examples spread evenly across the rank order, with the lemma and the gloss the card would carry.

449 such words in the top 10k. This is wider than the single-root class of section 0 (320), because a word whose source split was refused also resolves to a single root today and is counted here as well.

| word | rank | lemma | first gloss | credits |
|---|---|---|---|---|
| idea | 285 | grc:ἰδέα | form, shape | 1 |
| secret | 657 | la:sēcrētum | withdrawal, loneliness, secluded place | 1 |
| table | 804 | la:tabula | tablet, sometimes a tablet covered with wax for writing | 1 |
| church | 943 | grc:κυριακόν | church | 1 |
| sergeant | 1228 | la:serviēns | a sergeant | 1 |
| practice | 1461 | grc:πρακτικός | of, pertaining to, or appropriate for action | 1 |
| thomas | 1720 | grc:Θωμᾶς | Thomas | 1 |
| divorce | 1825 | la:dīvortium | separation | 1 |
| period | 1988 | grc:περίοδος | going round in a circle, flank march | 1 |
| desire | 2198 | la:dēsīderō | to want, desire, wish for, long for | 1 |
| intelligence | 2311 | la:intellegentia | intelligence, the power of discernment | 1 |
| valley | 2567 | la:vallis | a valley, vale | 1 |
| channel | 2779 | la:canālis | a pipe, spout, channel, conduit | 1 |
| cave | 2976 | la:cava | species of crow, jackdaw, jay, rook | 1 |
| lucas | 3128 | grc:Λουκᾶς | Luke, Lucas | 1 |
| individual | 3388 | la:indīviduum | atom | 1 |
| chamber | 3632 | grc:καμάρα | anything with an arched cover such as a covered carriage or boat, a vaulted chamber | 1 |
| diana | 3820 | la:Dī̆āna | Diana, the daughter of Latona and Jupiter, and twin sister of Apollo | 1 |
| badge | 4027 | la:baga | bag, especially for official documents | 1 |
| towel | 4263 | la:toallia | towel, washcloth | 1 |
| galaxy | 4476 | grc:γαλαξίας | the Milky Way galaxy (with implied κύκλος (kúklos, “circle, sphere”)) | 1 |
| jew | 4703 | grc:Ἰουδαῖος | Jew or Judean | 1 |
| rhythm | 4816 | grc:ῥυθμός | a repeating, regular motion, vibration | 1 |
| organ | 5084 | grc:ὄργανον | instrument, implement, tool | 1 |
| pirate | 5278 | grc:πειρατής | brigand, robber; especially a sea-raider, pirate | 1 |
| ego | 5497 | la:egō̆ | I; first person singular personal pronoun, nominative case | 1 |
| torch | 5859 | la:torquis | chaplet | 1 |
| puppet | 6201 | la:pūpa | girl, little girl | 1 |
| triumph | 6485 | grc:θρίαμβος | thriambus | 1 |
| gown | 6742 | la:gunna | a kind of leather garment | 1 |
| spaghetti | 6917 | grc:σφάκος | apple sage | 1 |
| percy | 7351 | la:Persius | a Roman nomen gentile, gens or "family name" famously held by | 1 |
| dinosaur | 7585 | grc:δεινός | terrible; horrible; fearful; astounding | 1 |
| sage | 7906 | la:salvia | sage | 1 |
| compartment | 8195 | la:compartior | to share | 1 |
| collective | 8397 | la:collēctīvus | collected or gathered together | 1 |
| ecstasy | 8567 | grc:ἔκστασις | displacement from proper place | 1 |
| coop | 8842 | la:cōpa | a female tavern-keeper | 1 |
| crocodile | 9302 | grc:κροκόδειλος | lizard | 1 |
| manuscript | 9497 | la:manūscrīptus | manuscript, hand-written | 1 |
