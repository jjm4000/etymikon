"""Render the Chrome Web Store promotional tiles.

    python pipeline/make_promo.py

Produces both sizes the store accepts:
  screenshots/promo-440x280.png    small tile
  screenshots/promo-1400x560.png   marquee tile

Both are written as 24-bit RGB with NO alpha channel, which the store requires
of promotional images (unlike the extension icons, which keep their alpha).

The tile is the icon's own seal beside the wordmark: the terracotta clay body,
the Aegean ring, the cream Georgia-bold epsilon at em 1.20. Every colour and
every fraction is imported from make_icons.py rather than restated, so the tile
and the toolbar asset cannot drift apart. The ground is a quiet warm white, so
the seal is the only saturated thing in the frame.

The seal is drawn supersampled and downsampled with Lanczos, the icons' method,
because a single smooth bowl suits resampling better than hinting. The text is
drawn at final size instead: at these sizes Segoe UI hints better than it
resamples, and the tile is read at 100%.

Output is deterministic: the same fonts and the same spec give the same bytes.
"""

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

# The icon IS the brand. Its palette, its font, its glyph and its 128px
# geometry are imported, never copied.
from make_icons import AEGEAN, CLAY, CREAM, FONT as SEAL_FONT, GLYPH, TUNING

ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / "screenshots"

UI = r"C:\Windows\Fonts\segoeui.ttf"
UI_SEMIBOLD = r"C:\Windows\Fonts\seguisb.ttf"

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

WORDMARK = "Etymikon"
TAGLINE = "Word Roots Popup Dictionary"
# The worked example from the manifest description: a real shipped breakdown,
# not a slogan.
EXAMPLE = "subterranean  =  sub-  +  terra  +  -an"


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

    # The marquee has room for a real breakdown under the tagline; the small
    # tile does not, and a squeezed one would only be noise.
    if "example_y" in spec:
        draw_line(d, (x, spec["example_y"]), EXAMPLE,
                  ImageFont.truetype(UI, spec["example"]), FAINT)

    return img


# Both specs centre the seal-and-text group in the frame: the block width is
# the seal plus its gap plus the widest line, and the block height is the text
# stack, which is the taller of the two columns in neither case by accident.
SMALL = dict(seal=104, seal_x=38, seal_y=88, text_x=174,
             name=40, name_y=103, tag=17, tag_y=160)

MARQUEE = dict(seal=272, seal_x=243, seal_y=144, text_x=599,
               name=104, name_y=160, tag=42, tag_y=300,
               example=30, example_y=376)


if __name__ == "__main__":
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    for (wd, ht, spec) in ((440, 280, SMALL), (1400, 560, MARQUEE)):
        path = OUT_DIR / f"promo-{wd}x{ht}.png"
        img = render(wd, ht, spec)
        assert img.mode == "RGB", f"promo images must have no alpha, got {img.mode}"
        assert img.size == (wd, ht), f"{path.name}: rendered {img.size}"
        img.save(path, "PNG", optimize=True)
        print(f"{path.name:22s} {img.size[0]}x{img.size[1]}  {img.mode}  "
              f"{path.stat().st_size:,} B")
