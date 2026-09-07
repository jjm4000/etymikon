"""Render the Chrome Web Store promotional tiles.

    python pipeline/make_promo.py

Produces both sizes the store accepts:
  screenshots/promo-440x280.png    small tile
  screenshots/promo-1400x560.png   marquee tile

Both are written as 24-bit RGB with NO alpha channel, which the store requires
of promotional images (unlike the extension icons, which keep their alpha).

Both tiles are the icon's own seal beside the wordmark: the terracotta clay
body, the Aegean ring, the cream Georgia-bold epsilon at em 1.20. Every colour
and every fraction is imported from make_icons.py rather than restated, so the
tile and the toolbar asset cannot drift apart. The ground is a quiet warm
white, so the seal is the only saturated thing in the frame.

The marquee has room for one more thing and carries the size of the corpus,
set large enough to read across a store carousel. The small tile does not and
carries the lockup alone.

Those counts are FLOORS, not measurements, and the floors are checked against
the shipped data before either tile is written. A promo image is uploaded to
the dashboard by hand, so an exact count would be wrong from the next data
rebuild until someone remembered to upload a new tile; a floor stays true
while the corpus grows. It stops being true if the corpus shrinks past it,
which is what the check catches.

The seal is drawn supersampled and downsampled with Lanczos, the icons' method,
because a single smooth bowl suits resampling better than hinting. The text is
drawn at final size instead: at these sizes Segoe UI hints better than it
resamples, and the tile is read at 100%.

Output is deterministic: the same fonts and the same spec give the same bytes.
"""

import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

# The icon IS the brand. Its palette, its font, its glyph and its 128px
# geometry are imported, never copied.
from make_icons import AEGEAN, CLAY, CREAM, FONT as SEAL_FONT, GLYPH, TUNING

ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / "screenshots"
DATA_DIR = ROOT / "extension" / "data"

UI = r"C:\Windows\Fonts\segoeui.ttf"
UI_SEMIBOLD = r"C:\Windows\Fonts\seguisb.ttf"
UI_LIGHT = r"C:\Windows\Fonts\segoeuil.ttf"

SS = 4                      # seal supersampling, as in make_icons.py

# The 128px seal's fractions: glyph em, body margin, body corner, and the ring
# as (outer inset, corner, band). 128 is the sharpest tuning and the one the
# store listing shows beside these tiles.
SEAL_GLYPH, SEAL_MARGIN, SEAL_CORNER, SEAL_RING = TUNING[128][1:]

# A quiet ground: warm enough to belong to the clay, pale enough that the seal
# is the only thing with colour in it.
GROUND = (251, 247, 244)
MUTED = (74, 65, 59)
FAINT = (150, 136, 126)
RULE = (228, 221, 214)

WORDMARK = "Etymikon"
# Shorter than the store name on purpose. The full name is 41 characters
# of tagline and overflows the small tile, and a promo image is artwork
# rather than an indexed field, so it carries the subject and drops the
# format words the store title needs for search.
TAGLINE = "Word Roots and Etymology"

# Floors the shipped data has already cleared, rounded down so the marquee
# stays true across data rebuilds. See the module docstring for why a floor
# and not the count itself. Checked in main(), never printed unchecked.
WORDS_FLOOR = 85_000
ROOTS_FLOOR = 6_000
ROOT_LANGS = ("la", "grc")


def seal(size):
    """The icon's seal at an arbitrary size, alpha intact.

    Drawn at SS x and downsampled, exactly as make_icons.render does, and off
    the same fractions, so this is the toolbar asset enlarged rather than a
    second drawing of it.
    """
    s = size * SS
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    m = round(s * SEAL_MARGIN)
    d.rounded_rectangle([m, m, s - 1 - m, s - 1 - m],
                        radius=round(s * SEAL_CORNER), fill=CLAY)

    outer, corner, band = SEAL_RING
    inset = round(s * outer)
    d.rounded_rectangle([inset, inset, s - 1 - inset, s - 1 - inset],
                        radius=round(s * corner), outline=AEGEAN,
                        width=max(1, round(s * band)))

    # The glyph is centred on its INK, not on its em box: the epsilon's bowl
    # sits low in the em and a box-centred one reads as sunk.
    font = ImageFont.truetype(SEAL_FONT, round(s * SEAL_GLYPH))
    mask = Image.new("L", (s, s), 0)
    md = ImageDraw.Draw(mask)
    box = md.textbbox((0, 0), GLYPH, font=font)
    md.text(((s - (box[2] - box[0])) / 2 - box[0],
             (s - (box[3] - box[1])) / 2 - box[1]), GLYPH, font=font, fill=255)
    img = Image.composite(Image.new("RGBA", (s, s), CREAM), img, mask)

    return img.resize((size, size), Image.LANCZOS)


def corpus():
    """(English words, Latin and Greek roots) as the extension ships them.

    Read from the data files themselves rather than from a note in this file,
    so the floors below are checked against what a reader actually installs.
    """
    words = json.loads((DATA_DIR / "words.json").read_text(encoding="utf-8"))
    roots = json.loads((DATA_DIR / "roots.json").read_text(encoding="utf-8"))
    ancient = sum(1 for entry in roots["roots"].values()
                  if entry.get("lang") in ROOT_LANGS)
    return len(words["words"]), ancient


def draw_line(d, xy, text, font, fill):
    """Draw one line by its ink top-left, so a spec's y is what the reader sees
    rather than wherever the font's ascent happens to put it."""
    box = d.textbbox((0, 0), text, font=font)
    d.text((xy[0] - box[0], xy[1] - box[1]), text, font=font, fill=fill)


def render(width, height, spec):
    img = Image.new("RGB", (width, height), GROUND)
    d = ImageDraw.Draw(img)

    mark = seal(spec["seal"])
    img.paste(mark, (spec["seal_x"], spec["seal_y"]), mark)

    x = spec["text_x"]
    draw_line(d, (x, spec["name_y"]), WORDMARK,
              ImageFont.truetype(UI_SEMIBOLD, spec["name"]), CLAY)
    draw_line(d, (x, spec["tag_y"]), TAGLINE,
              ImageFont.truetype(UI, spec["tag"]), MUTED)

    # The marquee carries the corpus beside the lockup, divided from it by a
    # hairline. The small tile has no room and takes neither.
    if "stat_x" in spec:
        d.line([(spec["rule_x"], spec["rule_y"][0]),
                (spec["rule_x"], spec["rule_y"][1])], fill=RULE, width=2)
        figures = ((f"{WORDS_FLOOR:,}+", "English words"),
                   (f"{ROOTS_FLOOR:,}+", "Latin and Greek roots"))
        for column, (number, label) in enumerate(figures):
            at = spec["stat_x"] + column * spec["stat_gap"]
            draw_line(d, (at, spec["stat_n_y"]), number,
                      ImageFont.truetype(UI_LIGHT, spec["stat_n"]), CLAY)
            draw_line(d, (at, spec["stat_label_y"]), label,
                      ImageFont.truetype(UI, spec["stat_label"]), MUTED)

    return img


# The small tile centres the seal-and-text group in the frame: the block width
# is the seal plus its gap plus the widest line, and the block height is the
# text stack.
SMALL = dict(seal=104, seal_x=38, seal_y=88, text_x=174,
             name=40, name_y=103, tag=17, tag_y=160)

# The marquee is two columns either side of a hairline at x=700, the frame's
# half. The lockup is smaller than it was when it stood alone, because the
# tile now has a second thing to say and a carousel reads the numbers first.
MARQUEE = dict(seal=190, seal_x=86, seal_y=182, text_x=306,
               name=76, name_y=196, tag=27, tag_y=292,
               rule_x=700, rule_y=(152, 408),
               stat_x=772, stat_gap=296,
               stat_n=68, stat_n_y=202, stat_label=25, stat_label_y=296)


if __name__ == "__main__":
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    # The marquee's claim, checked against the data before it is drawn. A tile
    # that overstates the corpus is worse than one that says nothing, and the
    # store copy cannot be corrected without a manual re-upload.
    n_words, n_roots = corpus()
    for got, floor, what in ((n_words, WORDS_FLOOR, "English words"),
                             (n_roots, ROOTS_FLOOR, "Latin and Greek roots")):
        if got < floor:
            raise SystemExit(
                f"the marquee claims {floor:,}+ {what} and the data ships "
                f"{got:,}. Lower the floor in this file, rerender, and upload "
                f"the new tile to the dashboard.")
    print(f"corpus: {n_words:,} words ({n_words - WORDS_FLOOR:,} over the "
          f"floor), {n_roots:,} Latin and Greek roots "
          f"({n_roots - ROOTS_FLOOR:,} over)")

    for (wd, ht, spec) in ((440, 280, SMALL), (1400, 560, MARQUEE)):
        path = OUT_DIR / f"promo-{wd}x{ht}.png"
        img = render(wd, ht, spec)
        assert img.mode == "RGB", f"promo images must have no alpha, got {img.mode}"
        assert img.size == (wd, ht), f"{path.name}: rendered {img.size}"
        img.save(path, "PNG", optimize=True)
        print(f"{path.name:22s} {img.size[0]}x{img.size[1]}  {img.mode}  "
              f"{path.stat().st_size:,} B")
