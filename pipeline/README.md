# Hanja Hover — data pipeline (Agent A)

Builds the three data files the extension ships with:

```
extension/data/hanja.json      per-character: eumhun, readings, glosses, compounds
extension/data/words.json      per-hanja-spelling words + byHangul reverse index
extension/data/variants.json   variant character -> canonical (traditional) form
```

All three are UTF-8 **without BOM** and compact (no indentation, no newlines).
Schemas are defined in `../SPEC.md`; this pipeline is the only thing that may
write to `extension/data/`.

## Requirements

* **Python 3** (built and verified on 3.12.10 — standard library only, no pip
  installs). On this machine the interpreter is at
  `C:\Users\Jesse\AppData\Local\Programs\Python\Python312\python.exe`.
* **curl** on `PATH` (ships with Windows 10/11).

## Run it

```sh
python build.py
```

From anywhere — paths are resolved relative to the script, not the cwd. On
Windows, if `python` still resolves to the Microsoft Store stub:

```powershell
& "C:\Users\Jesse\AppData\Local\Programs\Python\Python312\python.exe" D:\Code\Hanja\pipeline\build.py
```

The script does **download-if-missing → parse → emit → verify** in one pass and
takes roughly 30 seconds once the downloads are cached. It exits non-zero if any
verification check fails.

### Flags

| flag               | effect                                                        |
| ------------------ | ------------------------------------------------------------- |
| *(none)*           | full build                                                     |
| `--verify`         | re-run the spot-checks against the already-emitted JSON only    |
| `--force-download` | delete and re-fetch the cached sources (e.g. for a data refresh)|

## Sources

| file                             | URL                                                                  | size    |
| -------------------------------- | -------------------------------------------------------------------- | ------- |
| `cache/kaikki-Korean.jsonl`      | `https://kaikki.org/dictionary/Korean/kaikki.org-dictionary-Korean.jsonl` | ~190 MB |
| `cache/Unihan.zip`               | `https://www.unicode.org/Public/UCD/latest/ucd/Unihan.zip`           | ~8 MB   |
| `cache/kaikki-Translingual.jsonl`| `https://kaikki.org/dictionary/Translingual/kaikki.org-dictionary-Translingual.jsonl` | ~136 MB |
| `cache/ja-extract.jsonl.gz`      | `https://kaikki.org/dictionary/downloads/ja/ja-extract.jsonl.gz` | ~62 MB (gz) |
| `cache/ko_full_opensubtitles.txt`| `https://raw.githubusercontent.com/hermitdave/FrequencyWords/master/content/2018/ko/ko_full.txt` | ~11 MB |

The Translingual and Japanese extracts are used **only to establish variant
links**. Nothing from them is ever displayed: every gloss, reading and eumhun
the extension shows comes from the Korean hanja entry of the *canonical*
character, which the "canonical must exist in hanja.json" rule guarantees. The
Japanese file is read with `gzip` and never decompressed to disk.

### Provenance of the external frequency list

`ko_full.txt` comes from **hermitdave/FrequencyWords**, which is published under
the **MIT License** (Copyright (c) 2016 Hermit Dave). Its counts are derived
from the **OPUS OpenSubtitles 2018** corpus (opensubtitles.org), distributed by
the OPUS project for research use; OPUS asks that the corpus be cited rather
than restricting reuse, and the derived frequency counts here are plain
word/count pairs, not subtitle text.

It is a **build-time signal only**. It decides one boolean — the `rare` flag on
a words.json sense-set — and **no data from it is copied into any shipped
file**: not a word, not a count. Deleting `cache/` and rebuilding without
network access would change only which entries carry `"rare": true`.

Rejected alternatives: the Leipzig Corpora Collection Korean news set covers the
formal register better (it is the one corpus that would attest 익월) but ships
as a 255 MB archive under a non-commercial licence, which fails the
open/redistributable bar; `wordfreq`'s Korean data is msgpack inside a pip
package rather than a fetchable file; the NIKL (국립국어원) list needs
registration.

`cache/` is scratch — safe to delete, it just costs a re-download. Downloads use
`curl -C -` so an interrupted fetch resumes instead of starting over, and a file
whose size already matches the remote `Content-Length` is skipped entirely. The
190 MB JSONL is **streamed line by line** and never loaded into memory whole.
The Unihan zip is read in-place; nothing is extracted to disk.

## What it extracts

**Characters** — `lang_code: "ko"`, `pos: "character"`.

* *eumhun* from forms tagged `eumhun` (`"나라 국"` → hun `나라`, eum `국`) and from
  `ko-hanja` head templates (`{1: hun, 2: eum}`, or `{1: dict-form, 2: hun,
  3: eum}` as on 小, or `{1: eum}` alone on reading-only pages).
  **Normalized then deduped** per the SPEC addendum: wiktextract passes
  template markers through verbatim, so 韓 arrives as both `한국(韓國) 한` and
  `^한국(韓國) 한` — `^` is a capitalization flag, not content. `strip_markers`
  removes a leading `^`, `-` or `*` from hun and eum before the pair is keyed,
  so the duplicate collapses and 韓 comes out as exactly
  `[한국(韓國) 한, 나라 이름 한]`. Only 韓 and 漢 carry `^` today; the build asserts
  no marker survives anywhere.
* *readings* from forms tagged `hangeul`, `ko-hanja/old` `hangeul=` args, and the
  `sounds[].hangeul` pronunciation block. A single arg can pack several values
  and is split on `, 、 ; > /`: `설, 세, 열` is three readings, `벼슬 위; 다리미 울`
  is two full hun+eum pairs, and `륜>윤` is an initial-sound alternation where
  **both** are valid readings (580 args use `>`; before this split their
  readings were being dropped on the floor).
* *glosses* from `senses[].form_of[].extra` / `senses[].alt_of[].extra`
  (`"hanja form of 국 (“country; state; nation”)"` → `country; state; nation`),
  falling back to Unihan `kDefinition` for the ~5,300 reading-only pages that
  Wiktionary leaves undefined.

**Words** — three separate shapes, all of which matter:

1. hangul headword with a form tagged `hanja` (국민 → `國民`); a single form may
   carry several spellings (`美國/米國`).
2. **hanja headword** with the hangul in a form tagged `hangeul` (安全 → 안전).
   This is ~12,000 entries and is easy to miss entirely.
3. (hangul, hanja) pairs asserted in any entry's `derived` / `related` /
   `synonyms` list (`{word: "국민", alt: "國民"}`), for words with no page of
   their own.

**Variants** — merged from three sources.

*Korean Wiktionary*: "alternative form of" senses, and forms tagged
`alternative` on the canonical page (inverted).

*Unihan*: `kTraditionalVariant` (source → traditional), `kSimplifiedVariant`
*inverted* (value → source), `kZVariant`, `kSemanticVariant`.

*Translingual* (kaikki `mul` extract): Japanese shinjitai are **not** in Unihan
— it records PRC simplifications, not Japanese ones — and have no Korean
Wiktionary page, so 気/実/戦/続/楽 were unmappable without this source. English
Wiktionary does state the relationship, but on the Translingual section, which
the Korean-only extract cannot see. Two shapes carry it:

* `etymology_templates` `{"name": "Han simp", "args": {"1": "戰"}}` on the
  simplified page → 戦 → 戰.
* `related[]`, either tagged (實 → `{tags:[Japanese,shinjitai], word:実}`, so 実
  is the variant) or labelled (気 → `{alt:"Kyūjitai form of 気", word:氣}`, so 氣
  is the canonical). Ambiguous labels like "Variant form" are skipped rather
  than guessed at.

*Japanese* (ja.wiktionary `ja-extract.jsonl.gz`): the last source, needed for
characters Wiktionary classes as "simplified differently in Japan and China" —
図 among them — where no English-Wiktionary section states the link. ja
.wiktionary's 漢字 sections state it as prose in `etymology_texts`:
`図 → 「圖」の略体` ("abbreviated form of 圖"). Two shapes are read, `略体/略字/
新字体/俗字/変形` and the lower-confidence `異体字`. The match is **anchored to
the start of a sentence** and may not step over another bracketed character:
relation phrases also occur mid-sentence about *other* characters — 親's
etymology contains `（「新」の略字）`, which an unanchored regex would turn into
親 → 新. It contributes 95 winning mappings, 64 of which no other source
provides (亜→亞, 剣→劍, 単→單, 図→圖, 売→賣, 徳→德, 桜→櫻, 薬→藥, 覚→覺 …).

**Invariants** (all asserted every run). A mapping is kept only when the
canonical exists in `hanja.json`, the variant does **not** have its own
`hanja.json` entry, and the two differ. The never-shadow rule is deliberate and
load-bearing: 医 has a real Korean entry (동개 예, "quiver") that has nothing to
do with 醫, and 県 and 缶 likewise, so those stay unmapped even though a
shinjitai link exists. The output is also chain-free — no canonical is itself a
variant key — so the service worker's single-pass mapping is sufficient.

**Conflict resolution.** Sources are ranked (see `PRIO_*` in `build.py`):
Korean Wiktionary → Translingual `Han simp` → Unihan `kTraditionalVariant` →
ja `略体` → Translingual `related[]` → ja `異体字` → the remaining Unihan
fields. This order was tuned against the characters where two sources both name
a viable canonical. Within one source, ties are broken by how many sino-Korean
words in `words.json` actually contain the candidate — Unihan fields are
multi-valued (药 `kTraditionalVariant` = 葯 藥) and the first token is often not
the form Korean uses.

Every build prints the cases where the Japanese extract disagreed with the
winning source rather than letting them pass silently. No hand-curated mapping
table is used anywhere in this pipeline.

## Glosses are never truncated

Per the SPEC "No truncation" addendum, every gloss — char, compound and word —
is emitted in full. The build produces **no truncation marker at all**; visual
compactness is the UI's job (clamp + expander). An overlong sense is dropped
whole rather than cut.

Two filters sit in `clean_gloss`:

* **`GLOSS_MAX_CHARS = 600`** — a safety valve, not a style rule. The SPEC
  suggests ~400, but 400 silently dropped genuine definitions for 世襲巫 (407),
  降神巫 (418) and `-더-` (547), which is exactly the loss the addendum exists to
  prevent. 600 keeps every real definition; the longest surviving gloss in the
  shipped data is 418 chars.
* **`RE_GLOSS_ARTIFACT`** — 4,819 "senses" are really wiktextract dumping a
  reading table into the gloss field (`More information(eumhun reading: 하나 일
  (hana il)) (MC reading: …`, 728+ chars). These are matched by shape, not
  length, so the cap never has to do that job. Before this change they were
  being cut to 74 chars and shipped as junk.

A few glosses legitimately contain `…` from the source (Wiktionary's `[…]`
elision, and 點點點 which literally means "dot dot dot"), and four end in a
source `...` (一色, "all, totally, nothing but..."). The verify check therefore
tests for a **trailing U+2026**, the only marker this build ever emitted, and
reports the source ellipses separately instead of failing on them.

## The `rare` flag on words.json sense-sets

`"rare": true` marks a sense-set the frequency proxy cannot attest, so the UI
can hedge it. The key is omitted when false. It exists for the reverse-lookup
case: highlighting 사랑 ("love") should not surface 舍廊 ("hall in a traditional
house") as a confident match.

The hard part is that `ngram_freq` and `inbound` are keyed by **hangul**, so
homographs share them — 舍廊 inherits all 72 example-sentence hits belonging to
사랑 "love", and 牛李 inherits 우리's 313 hits from the native pronoun "we".
Only `alt_inbound` is keyed by the hanja spelling itself. So the build also
records `native_hangul`: every hangul that has a Korean entry with **no** hanja
spelling, i.e. a native word competing for that reading. Then:

```
rare = alt_inbound[spelling] < 2                        if hangul is native-contested
       alt_inbound == 0 and ngram == 0
                        and inbound == 0 and ext_freq == 0   otherwise
```

The `< 2` matters: 感謝 and 牛李 both have exactly one spelling-level reference
(a single character's derived list), and the only thing separating them is that
우리 is also a native word while 감사 is not. The external corpus is
hangul-keyed, so it is **deliberately not consulted on the contested branch** —
crediting 사랑's 771 subtitle hits to 舍廊 is exactly the mistake the branch
exists to prevent.

**Agglutination.** A Korean noun rarely appears bare in running text: 의중 has
zero occurrences as a token, while 의중을 / 의중에 / 의중대로 all occur. Counts
are therefore folded back onto the stem whenever the tail is in a closed list
of particles and light suffixes (`KO_PARTICLES`). The list is closed on
purpose — open prefix matching would credit 인도 for every occurrence of
인도네시아.

**Calibration.** 13.3% of sense-sets are flagged, down from 22.6% before the
external corpus. The predicate is deliberately conservative: a false positive
(hedging a correct, common match) is worse than a false negative. Two earlier
drafts are worth recording. The first also flagged any minority homograph
lacking its own `alt_inbound` — 30.2%, but it wrongly caught common secondary
readings 監査 "audit", 士氣 "morale", 修道, 史記, all now regression-guarded.
The second, Wiktionary-only, flagged real words that simply never appear in a
Wiktionary example sentence — 意中, 正史, 療養院 — which is what the external
list fixed.

**Known residual:** 翌月 (익월) is still flagged. It has zero attestation in
every accessible corpus — no occurrence in OpenSubtitles under any inflection,
no Korean Wikipedia article title, nothing in the Wiktionary example corpus. It
is a formal Sino-Korean term (contracts, banking) that subtitle and
encyclopedic registers do not cover, so the flag is arguably correct rather
than wrong. Obscure sino-sino homographs such as 靚飾 (정식) and 識度 (식도)
also go unflagged, because `alt_inbound` is too sparse to tell them apart from
監査.

`byHangul` lists all non-rare spellings before rare ones, so a reverse lookup
leads with a confident match; ordering within each group is unchanged.

## Compound ranking

`compounds` per character is a reverse index over `words.json` capped at 8, one
row per hangul reading. Wiktionary carries no frequency data, so ranking uses a
composite proxy:

* **corpus frequency** — every hangul 2–4-gram in all ~9,800 Wiktionary example
  sentences is counted; a word scores on how often its hangul spelling occurs.
  This is the strongest available signal and dominates the ranking.
* **inbound references** — how many entries link to the word.
* **`alt_inbound`** — inbound references keyed by *hanja spelling* rather than
  hangul; this is what separates homographs (國家 vs 國歌, both 국가).
* **entry richness** — senses, examples, synonyms, derived terms, etymology.
* modest bonuses for being on the character's own Wiktionary "derived terms"
  list and for appearing on several such lists; a penalty per character beyond
  two.

See "Known approximations" in the build report for what this does and does not
get right.

## Verification

Every run ends with counts, output sizes, and spot-checks:

* 國 has eumhun 나라/국, a "country" gloss, and 국민/國民 among its compounds.
* 国→國, 学→學, and the shinjitai set 気→氣 実→實 図→圖 戦→戰 続→續 楽→樂 広→廣.
* `rare` anchors: 國民/學校/資本主義/感謝/士氣/史記/監査/修道/意中/正史/療養院
  not rare, 舍廊 and 牛李 rare, and `byHangul` ordering puts non-rare
  spellings first.
* No gloss anywhere ends in `…`, and 韓's eumhun is exactly
  `[한국(韓國) 한, 나라 이름 한]` with no marker left in any hun or eum.
* 医, 県, 缶 keep their own Korean entries and stay **unmapped** (regression
  guard on the never-shadow invariant).
* 國民 → 국민 in `words`, and 國民 in `byHangul[국민]`.
* 20 very common characters are present, including 文/金/小/中/時, which use an
  older template shape (`alt-of` senses pointing at a hangul reading) that a
  naive parser silently drops.

A failed check exits non-zero.
