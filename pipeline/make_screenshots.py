"""Regenerate the Chrome Web Store screenshot set.

    python pipeline/make_screenshots.py

Writes screenshots/1-word-breakdown.png through 8-used-in.png, all 1280x800
24-bit RGB with no alpha channel, which is what the store accepts. The
promotional tiles are a separate script (make_promo.py); this one only touches
the numbered shots.

Every scene runs on real shipped data. The words are real words.json entries,
the counts in the labels are the counts the worker derives at runtime, and the
tier chips are the tiers the frequency ranks give. Nothing in a shot is staged
except the article the selection is made in.

How it works
------------
Chrome 151 headless ignores --load-extension, so there is no way to capture the
real extension running on a real page. Instead two staging pages in
pipeline/screenshots/ load the REAL extension code (lookup.js, saved.js,
content.js, the sidepanel scripts, the shipped CSS, the shipped data files)
behind the __etymikonTestRuntime stub those scripts already accept in place of
chrome.runtime. Everything in the resulting pixels is the product's own
rendering; only the message transport is local. Each staging page documents its
own query parameters in the comment at the top of the file.

This script then:

  1. serves the repo root over http on a free port (the staging pages use ES
     modules and fetch, neither of which works from file://),
  2. drives ONE headless Chrome over CDP -- a small websocket client and a
     synchronous JSON-RPC loop live in cdp.py beside this file, so the whole
     tool is Python 3.12 stdlib plus PIL and there is no Node dependency,
  3. captures each scene in its own tab, with the viewport size set BEFORE
     navigation (content.js hides the popup on resize, so a late resize would
     empty the shot),
  4. composites the side-panel shots beside a narrower page shot, with the 1px
     separator Chrome draws between a page and its side panel,
  5. asserts, per shot, both what the DOM says (the popup is up, the SPEC's
     own label wording rendered, the settings view mounted) and what the pixels
     say (exact size, RGB, no alpha, the corner seal actually visible where it
     is the point of the shot),
  6. and only then moves the files into screenshots/. Any failed assertion
     leaves the committed set untouched.

Flags
-----
    --only 3,8      regenerate just these shots (still writes atomically)
    --keep-temp     leave the working directory in place for inspection
"""

import argparse
import json
import shutil
import sys
import tempfile
import time
import urllib.parse
from pathlib import Path

from PIL import Image

from cdp import Chrome, Tab, serve_root

ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / "screenshots"
STAGE_DIR = "pipeline/screenshots"

SHOT_W, SHOT_H = 1280, 800
# A side panel defaults to 360 wide; Chrome draws a 1px separator, leaving 919
# for the page. 919 + 1 + 360 = 1280. The panel is user-resizable, so a shot
# may override the split with "panel_w". A shot may also set "dark": True to
# capture under prefers-color-scheme: dark (both staging pages and all the
# product surfaces restyle themselves).
PAGE_W, PANEL_W = 919, 360
SEPARATOR = (218, 220, 224)
SEPARATOR_DARK = (60, 64, 67)


# --------------------------------------------------------------------------
# The scenes.
#
# Every shot is either a whole-viewport page capture ("page") or a page capture
# docked beside a side-panel capture ("composite"). `page` and `panel` are query
# strings for the staging pages; `checks` are JS expressions that must all
# evaluate true after the page signals ready, before anything is captured.
# --------------------------------------------------------------------------

# Shorthands for the checks, which all run against the content script's own
# test hook rather than poking at the DOM blind. Every string a check looks for
# is the SPEC's own wording: MADE OF, BUILDS N WORDS, FROM LATIN,
# "Used in N words", "Show 5 more (N)". A shot that no longer says what the
# SPEC says is not a shot worth shipping.
POPUP_UP = ("popup is visible", "globalThis.__etymikon.isVisible()")


def head_is(text):
    return (
        f"card headline is {text}",
        f'globalThis.__etymikon.query(".card .surface").textContent === "{text}"',
    )


def has_text(label, selector, text):
    return (
        label,
        f'[...globalThis.__etymikon.queryAll("{selector}")]'
        f'.some((n) => n.textContent.includes("{text}"))',
    )


def label_is(text):
    """A section label reading exactly `text`. The house label style is one
    element per section, so an exact match is the right test: "MADE OF" must
    not pass on a label that merely contains it."""
    return (
        f"section label {text!r}",
        f'[...globalThis.__etymikon.queryAll(".label")]'
        f'.some((n) => n.textContent === "{text}")',
    )


def label_matches(label, pattern):
    """A section label whose wording follows a SPEC pattern with a live count
    in it, so a rebuilt bundle changes the number without breaking the shot."""
    return (
        label,
        f'[...globalThis.__etymikon.queryAll(".label")]'
        f'.some((n) => /{pattern}/.test(n.textContent))',
    )


def chip_forms(*forms):
    """The chip row shows exactly these forms, in this order. Chips are the one
    place the product makes a factual claim about a word's assembly."""
    # The two encodings are compared AS STRINGS, so this one has to match what
    # JSON.stringify writes exactly: no space after a comma, and a macron as
    # itself rather than as an escape. Only the outer dump, which builds the JS
    # literal, may escape anything.
    wanted = json.dumps(list(forms), separators=(",", ":"), ensure_ascii=False)
    return (
        "chips read " + " + ".join(forms),
        'JSON.stringify([...globalThis.__etymikon.queryAll(".morph-form")]'
        f'.map((n) => n.textContent)) === {json.dumps(wanted)}',
    )


def rows_are(count):
    return (
        f"{count} ranked rows",
        f'globalThis.__etymikon.queryAll(".fam-row").length === {count}',
    )


# Word cards and family rows render exactly one tier chip (SPEC, "Tier chips").
TIERS_EXCLUSIVE = (
    "every ranked row carries exactly one tier chip",
    '[...globalThis.__etymikon.queryAll(".fam-row")]'
    '.every((r) => r.querySelectorAll(".tier-chip").length === 1)',
)

# A ranked row clamps its DEFINITION to one line. The tier chip is a sibling of
# that clamped text rather than part of it, so it holds its own width at any
# panel size (renderer fix 2026-08-25: inside the clamp, a long definition
# pushed the chip onto the hidden second line and the row silently lost it,
# which is what this check first caught). A shot that advertises the tier
# signal proves the chips reached the PIXELS, not merely the DOM, and on both
# axes: a chip below its row is as invisible as one past its right edge.
CHIPS_IN_VIEW = (
    "every ranked row's tier chip is inside its row box",
    '(() => { const rows = [...globalThis.__etymikon.queryAll(".fam-row")];'
    ' return rows.length > 0 && rows.every((r) => {'
    ' const c = r.querySelector(".tier-chip"); if (!c) return false;'
    ' const b = c.getBoundingClientRect(), rr = r.getBoundingClientRect();'
    ' return b.width > 0 && b.right <= rr.right + 1 && b.bottom <= rr.bottom + 1;'
    ' }); })()',
)

# A pushed list view always shows the full index, scroll-fed by chunks, so it
# builds no pager control at any length (SPEC appendUsedIn, "Show all").
VIEW_NO_PAGER = (
    "the pushed list view carries no pager control",
    'globalThis.__etymikon.queryAll(".fam-more").length === 0',
)

# The other half of that rule: a list too long to render whole offers BOTH
# controls, worded as the SPEC words them, each carrying its own count. They
# are one pair and appear together, so one check asserts both (SPEC
# "Show all").
PAGER = (
    'the list offers "Show 5 more (N)" and "Show all (N)" side by side',
    '(() => { const q = globalThis.__etymikon;'
    ' const more = q.query(".fam-more:not(.fam-all)");'
    ' const all = q.query(".fam-all");'
    ' if (!more || !all) return false;'
    r' if (!/^Show 5 more \(\d+\)$/.test(more.textContent)) return false;'
    r' if (!/^Show all \(\d+\)$/.test(all.textContent)) return false;'
    ' const a = more.getBoundingClientRect(), b = all.getBoundingClientRect();'
    ' return more.nextElementSibling === all && b.left >= a.right'
    ' && Math.abs(a.top - b.top) < 2; })()',
)

IN_FRAME = (
    "the whole popup is in frame",
    f"globalThis.__etymikon.hostRect().bottom < {SHOT_H}",
)


def crumbs_include(*labels):
    """The trail carries these crumbs. Visible crumbs only: the hook filters
    out anything width-based elision has hidden, so this asserts what a reader
    sees rather than what the DOM holds."""
    return (
        "breadcrumb trail carries " + " and ".join(labels),
        "((c) => " + " && ".join(f"c.indexOf({json.dumps(x)}) >= 0" for x in labels)
        + ")(globalThis.__etymikon.crumbLabels())",
    )


def panel_has(label, selector, text=None):
    if text is None:
        return (label, f'!!document.querySelector("{selector}")')
    return (
        label,
        f'[...document.querySelectorAll("{selector}")]'
        f'.some((n) => n.textContent.includes("{text}"))',
    )


def seal_has_room(view):
    """The corner seal is fit-gated: it shows only while it fits under the
    view's content. A shot that is meant to show it must prove the gate is
    open before the pixels are asked about it."""
    return (
        f"the {view} view leaves the seal room",
        f'document.querySelector(".view--{view}").classList'
        '.contains("view--roomy")',
    )


SHOTS = [
    {
        "n": 1,
        "name": "1-word-breakdown.png",
        "kind": "page",
        # subterranean selected in the opening paragraph. It is the SPEC's own
        # worked example and the one word that shows both chip kinds at once:
        # English affixes around a Latin lemma.
        "page": {"scene": "breakdown", "w": 420},
        "checks": [
            POPUP_UP,
            head_is("subterranean"),
            label_is("MADE OF"),
            chip_forms("sub-", "terra", "-an"),
            has_text("chips carry their glosses", ".morph-gloss", "dry land"),
            has_text("tier chip reads Advanced", ".tier-chip", "Advanced"),
            IN_FRAME,
        ],
    },
    {
        "n": 2,
        "name": "2-root-family.png",
        "kind": "page",
        # The -ful chip from beautiful, opened. A root card is where the
        # product pays the reader back: the gloss, and the shipped words built
        # on it, ranked by frequency with their tiers.
        #
        # A COMMON English suffix on purpose. 360 words is far past what a card
        # renders inline, so this is the one shot in the set with a live
        # "Show 5 more (N)" pager, and it shows the Germanic half of the
        # dictionary beside all the Latin elsewhere in the set.
        #
        # Wider than the other popup shots, and the panel is user-resizable, so
        # this is a size a reader can have: a ranked list reads better with room
        # for the definitions beside the words.
        "page": {"scene": "root", "w": 640, "bottom": 40},
        "checks": [
            POPUP_UP,
            head_is("-ful"),
            has_text("label line reads Suffix", ".rootlabel", "Suffix"),
            label_matches("family label reads BUILDS N WORDS",
                          r"^BUILDS \d+ WORDS$"),
            rows_are(8),
            TIERS_EXCLUSIVE,
            CHIPS_IN_VIEW,
            has_text("beautiful among the family", ".fam-word", "beautiful"),
            PAGER,
            crumbs_include("beautiful", "-ful"),
            IN_FRAME,
        ],
    },
    {
        "n": 3,
        "name": "3-latin-origin.png",
        "kind": "page",
        # territory selected: a word with no English split, so the card says
        # where it came from instead. The Latin lemma decomposes, so the origin
        # renders as a chip row under FROM LATIN and both parts are cards.
        "page": {"scene": "origin", "w": 420},
        "checks": [
            POPUP_UP,
            head_is("territory"),
            label_is("FROM LATIN territōrium"),
            chip_forms("terra", "-tōrium"),
            has_text("used-in row reads Used in 2 words", ".usedin-row",
                     "Used in 2 words"),
            has_text("tier chip reads Common", ".tier-chip", "Common"),
            IN_FRAME,
        ],
    },
    {
        "n": 4,
        "name": "4-sidebar-search.png",
        "kind": "composite",
        "panel_w": 560,
        "page": {"scene": "plain", "scroll": 0},
        # The sidebar answering a typed word. The search view renders through
        # content.js, so its nodes live in the embedded panel's shadow root and
        # only its own query hook sees them; the seal is the panel's own DOM.
        "panel": {"view": "search", "q": "beautiful"},
        "checks": [
            head_is("beautiful"),
            label_is("MADE OF"),
            chip_forms("beauty", "-ful"),
            seal_has_room("search"),
        ],
        "pixels": "seal",
    },
    {
        "n": 5,
        "name": "5-saved-words.png",
        "kind": "composite",
        "panel_w": 560,
        "page": {"scene": "plain", "scroll": 430},
        # A library with three folders, two of them collapsed. Collapsing is
        # also what keeps the rendered rows down to what the seal's room rule
        # tolerates, and it is what a reader with three folders actually does.
        "panel": {"view": "saved", "collapse": "Latin roots,Saved"},
        "checks": [
            panel_has("saved view mounted", ".view--saved"),
            panel_has("filter reads All (11)", ".saved-bar", "All (11)"),
            panel_has("Reading list folder header", ".saved-folder", "Reading list"),
            panel_has("subterranean saved row", ".saved-row", "subterranean"),
            panel_has("row secondary text is the definition", ".saved-secondary",
                      "Below ground"),
            panel_has("delete action present", ".saved-actions", "Delete"),
            seal_has_room("saved"),
        ],
        "pixels": "seal",
    },
    {
        "n": 6,
        "name": "6-settings.png",
        "kind": "composite",
        "panel_w": 560,
        "page": {"scene": "plain", "scroll": 200},
        # The Anki fields, rendered from the worker's own token lists: nothing
        # in this view names a field, so the shot proves the schema, not a
        # hand-written form.
        "panel": {"view": "settings"},
        "checks": [
            panel_has("settings view mounted", ".view--settings"),
            panel_has("Anki export group heading", ".settings-heading", "Anki export"),
            panel_has("Word cards: back row", ".settings-row", "Word cards: back"),
            panel_has("Breakdown field checkbox", ".settings-checkbox", "Breakdown"),
            panel_has("Root cards: back row", ".settings-row", "Root cards: back"),
            panel_has("Family field checkbox", ".settings-checkbox", "Family"),
            panel_has("attribution footer", ".settings-footer",
                      "Definitions from Wiktionary, CC BY-SA."),
            seal_has_room("settings"),
        ],
        "pixels": "seal",
    },
    {
        "n": 7,
        "name": "7-dark-mode.png",
        "kind": "page",
        "dark": True,
        # Shot 1 again under prefers-color-scheme: dark. One shot of the set
        # answers "does it do dark mode", and the breakdown card is the one
        # worth answering it with.
        "page": {"scene": "breakdown", "w": 420},
        "checks": [
            POPUP_UP,
            head_is("subterranean"),
            label_is("MADE OF"),
            chip_forms("sub-", "terra", "-an"),
            ("the card took its dark ground",
             'globalThis.__etymikon.panelStyle("--bg").trim() === "#23232a"'),
            IN_FRAME,
        ],
    },
    {
        "n": 8,
        "name": "8-used-in.png",
        "kind": "page",
        # absolute selected, then its "Used in 4 words" row followed. The
        # mirror of the breakdown: not what this word is made of, but what is
        # made of it. A pushed list view shows the whole index and feeds itself
        # by scrolling, so unlike shot 2 there is no control in it.
        # Wide for the same reason shot 2 is: the tier chip rides at the end of
        # a one-line row, and a narrow popup clips it.
        "page": {"scene": "usedin", "w": 640, "bottom": 40},
        "checks": [
            POPUP_UP,
            head_is("absolute"),
            has_text("the head label says Used in", ".rootlabel", "Used in"),
            label_matches("list label reads USED IN N WORDS",
                          r"^USED IN \d+ WORDS$"),
            rows_are(4),
            TIERS_EXCLUSIVE,
            CHIPS_IN_VIEW,
            has_text("absolutely at the head of the list", ".fam-word", "absolutely"),
            VIEW_NO_PAGER,
            crumbs_include("absolute", "Used in"),
            IN_FRAME,
        ],
    },
]


def stage_url(port, page, params):
    query = urllib.parse.urlencode(params)
    return f"http://127.0.0.1:{port}/{STAGE_DIR}/{page}?{query}"


def run_checks(tab, checks, shot_name):
    for label, expression in checks:
        try:
            ok = tab.evaluate(expression)
        except RuntimeError as exc:
            raise AssertionError(f"{shot_name}: check {label!r} threw: {exc}") from None
        if ok is not True:
            raise AssertionError(f"{shot_name}: check failed -- {label}")


def capture(chrome, port, page, params, width, checks=(), dark=False):
    tab = Tab(chrome, width, SHOT_H, dark)
    try:
        tab.navigate(stage_url(port, page, params))
        tab.wait_ready()
        run_checks(tab, checks, page)
        image = tab.screenshot()
    finally:
        tab.close()
    if image.size != (width, SHOT_H):
        raise AssertionError(f"{page}: captured {image.size}, wanted {(width, SHOT_H)}")
    return image


def compose(page_image, panel_image, dark=False):
    """Dock the panel to the right edge of the page, with the 1px separator
    Chrome draws between them."""
    out = Image.new("RGB", (SHOT_W, SHOT_H),
                    SEPARATOR_DARK if dark else SEPARATOR)
    out.paste(page_image, (0, 0))
    out.paste(panel_image, (page_image.width + 1, 0))
    return out


def assert_image(image, name):
    if image.size != (SHOT_W, SHOT_H):
        raise AssertionError(f"{name}: {image.size}, wanted {(SHOT_W, SHOT_H)}")
    if image.mode != "RGB":
        raise AssertionError(f"{name}: mode {image.mode}, wanted RGB")
    if "transparency" in image.info:
        raise AssertionError(f"{name}: carries a transparency key")


def assert_seal(image, name):
    """The ἐτυμικόν seal sits in the panel's lower-right corner when the view
    leaves room for it. It is stamped in the icon's terracotta, and the panel
    around it is grey text on a near-neutral ground, so a warm cast in that box
    is proof it rendered. The predicate holds in both schemes: the light tint
    lands near (236, 204, 191) and the dark one near (96, 63, 54), and both are
    unmistakably red-over-green-over-blue."""
    box = image.crop((SHOT_W - 300, SHOT_H - 140, SHOT_W - 4, SHOT_H - 4))
    pixels = box.tobytes()
    clay = 0
    for i in range(0, len(pixels), 3):
        r, g, b = pixels[i], pixels[i + 1], pixels[i + 2]
        if r > g + 12 and g > b + 5 and r > b + 25 and r < 250:
            clay += 1
    if clay < 400:
        raise AssertionError(f"{name}: seal not visible ({clay} terracotta pixels)")


def build(shot, chrome, port, work_dir):
    dark = shot.get("dark", False)
    panel_w = shot.get("panel_w", PANEL_W)
    page_width = SHOT_W if shot["kind"] == "page" else SHOT_W - panel_w - 1
    page_checks = shot["checks"] if shot["kind"] == "page" else ()
    page_image = capture(chrome, port, "shots-page.html", shot["page"],
                         page_width, page_checks, dark)
    if shot["kind"] == "page":
        image = page_image
    else:
        panel_image = capture(chrome, port, "shots-panel.html", shot["panel"],
                              panel_w, shot["checks"], dark)
        image = compose(page_image, panel_image, dark)

    assert_image(image, shot["name"])
    if shot.get("pixels") == "seal":
        assert_seal(image, shot["name"])

    out = work_dir / shot["name"]
    image.save(out, "PNG", optimize=True)
    return out


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--only", help="comma-separated shot numbers, e.g. 3,8")
    parser.add_argument("--keep-temp", action="store_true")
    args = parser.parse_args()

    wanted = SHOTS
    if args.only:
        keep = {int(n) for n in args.only.split(",")}
        wanted = [s for s in SHOTS if s["n"] in keep]
        if not wanted:
            raise SystemExit(f"--only {args.only} matched no shots")

    server, port = serve_root()
    work_dir = Path(tempfile.mkdtemp(prefix="etym-screenshots-"))
    chrome = Chrome(window=(SHOT_W, SHOT_H))
    written = []
    try:
        for shot in wanted:
            started = time.time()
            path = build(shot, chrome, port, work_dir)
            written.append((shot, path))
            print(f"  ok  {shot['name']}  ({time.time() - started:.1f}s)")
    except BaseException:
        # A failed run must leave the committed set exactly as it was.
        if not args.keep_temp:
            shutil.rmtree(work_dir, ignore_errors=True)
        raise
    finally:
        chrome.close()
        server.shutdown()

    # Nothing lands until every shot passed every check.
    OUT_DIR.mkdir(exist_ok=True)
    for shot, path in written:
        shutil.move(str(path), str(OUT_DIR / shot["name"]))
    if not args.keep_temp:
        shutil.rmtree(work_dir, ignore_errors=True)
    print(f"wrote {len(written)} screenshot(s) to {OUT_DIR}")


if __name__ == "__main__":
    sys.exit(main())
