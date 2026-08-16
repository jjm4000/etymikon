"""Render the Okpyeon extension icons.

    python pipeline/make_icons.py

Design: white 玉 (the first character of 玉篇, the app's namesake) in Batang
myeongjo on a jade ground, inside a cinnabar rule with squared corners — a
낙관 seal rather than a rounded app tile. 玉 is used rather than a more
on-the-nose 國 because five strokes survive 16px, where eleven do not.

Every size is drawn at SS× and downsampled, which antialiases the myeongjo
terminals far better than hinting at target size. The 16px asset is NOT a
downscale of the 128: its glyph is a touch smaller, its strokes markedly
heavier, and its rule proportionally thicker — at that size a hairline rule
reads as a rendering artifact rather than a deliberate edge, and the serif
detail is invisible anyway.
"""

from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, ImageFilter

OUT = Path(__file__).resolve().parent.parent / "extension" / "icons"
FONT = r"C:\Windows\Fonts\batang.ttc"
FONT_INDEX = 0            # 0 = Batang (proportional myeongjo)
GLYPH = "\u7389"          # 玉

JADE = (46, 107, 87, 255)
CINNABAR = (184, 64, 47, 255)
WHITE = (255, 255, 255, 255)

# size -> (supersample, glyph fraction, dilate fraction, corner fraction, rule fraction)
#
# Strokes are thickened by DILATING the glyph mask with a square kernel, not by
# PIL's stroke_width. stroke_width uses round caps, which turns Batang's sharp
# triangular serifs into sausage ends — it stops looking like myeongjo at all.
# A square structuring element keeps the flares angular, matching how the
# browser renders -webkit-text-stroke.
#
# 128 and 48 supersample, which smooths the terminals. 16 does NOT: rendered
# natively, FreeType's hinter snaps 玉's three horizontals onto whole pixels,
# and supersampling is precisely what destroys that. 16 also takes no
# dilation — it is counter-limited, so thickening closes the gaps between the
# horizontals into a blob.
TUNING = {
    128: (4, 0.75, 0.025, 0.094, 0.052),
    48:  (4, 0.76, 0.025, 0.104, 0.055),
    16:  (1, 0.80, 0.000, 0.125, 0.085),
}


def render(size: int) -> Image.Image:
    ss, glyph_frac, dilate_frac, corner_frac, rule_frac = TUNING[size]
    S = size * ss

    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    # Jade ground and cinnabar rule, both following the squared-off corner.
    radius = round(S * corner_frac)
    d.rounded_rectangle([0, 0, S - 1, S - 1], radius=radius, fill=JADE)
    d.rounded_rectangle(
        [0, 0, S - 1, S - 1],
        radius=radius,
        outline=CINNABAR,
        width=max(1, round(S * rule_frac)),
    )

    # Glyph mask, optically centred on its ink rather than its em box.
    px = round(S * glyph_frac)
    font = ImageFont.truetype(FONT, px, index=FONT_INDEX)
    mask = Image.new("L", (S, S), 0)
    md = ImageDraw.Draw(mask)
    box = md.textbbox((0, 0), GLYPH, font=font)
    md.text(
        ((S - (box[2] - box[0])) / 2 - box[0], (S - (box[3] - box[1])) / 2 - box[1]),
        GLYPH,
        font=font,
        fill=255,
    )

    k = round(px * dilate_frac)
    if k > 0:
        mask = mask.filter(ImageFilter.MaxFilter(2 * k + 1))

    img = Image.composite(Image.new("RGBA", (S, S), WHITE), img, mask)

    return img if ss == 1 else img.resize((size, size), Image.LANCZOS)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for size in sorted(TUNING, reverse=True):
        path = OUT / f"icon{size}.png"
        render(size).save(path, "PNG", optimize=True)
        print(f"{path.name:14s} {size}x{size}  {path.stat().st_size:,} B")
    # A 4x sheet of the 16px asset, for eyeballing the small size without squinting.
    preview = Image.new("RGBA", (16 * 8, 16 * 8), (0, 0, 0, 0))
    preview.paste(render(16).resize((16 * 8, 16 * 8), Image.NEAREST), (0, 0))
    preview.save(OUT.parent.parent / "pipeline" / "icon16-preview.png", "PNG")
    print("icon16-preview.png  (8x nearest-neighbour blowup of the 16px asset)")


if __name__ == "__main__":
    main()
