"""Render the Etymikon extension icons.

    python pipeline/make_icons.py

Design (chosen 2026-08-25): a lowercase Greek epsilon in Georgia Bold,
cream on a terracotta clay ground, inside an Aegean blue rule with
rounded corners. A seal in the Okpyeon tradition with new ink: the clay
is terra, the app's demonstration root, and the blue ring is the sea it
crossed. The bare epsilon won over the diacritic forms because marks
above the bowl read as noise at toolbar size.

Reference geometry, from the approved 64-unit mockup: body corner 14,
ring inset 6.5 with corner 10.5 and stroke 2.6, glyph at font size 68
with its ink optically centred (the "B" centering pick).

Every size is drawn at SS x and downsampled with Lanczos, which suits a
single smooth bowl far better than hinting at target size. The 16px
asset drops the ring: at that size the rule is under a pixel wide and
reads as edge dirt, so the clay square and the biggest possible epsilon
carry the identity alone.
"""

from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

OUT = Path(__file__).resolve().parent.parent / "extension" / "icons"
FONT = r"C:\Windows\Fonts\georgiab.ttf"
GLYPH = "\u03b5"  # lowercase epsilon

CLAY = (192, 85, 43, 255)      # #C0552B, the seal body
AEGEAN = (159, 195, 232, 255)  # #9FC3E8, the ring
CREAM = (255, 247, 240, 255)   # #FFF7F0, the glyph

# size -> (supersample, glyph fraction, corner fraction,
#          ring: None or (inset fraction, corner fraction, stroke fraction))
#
# Fractions are of the finished size; the reference mockup is 64 units,
# so body corner 14/64 = 0.219, ring inset 6.5/64 = 0.102, ring corner
# 10.5/64 = 0.164, ring stroke 2.6/64 = 0.041, glyph 68/64 = 1.0625.
# 48 thickens the ring a touch so it survives the smaller raster; 16
# has no ring and a slightly larger glyph instead.
TUNING = {
    128: (4, 1.0625, 0.219, (0.102, 0.164, 0.041)),
    48:  (4, 1.0625, 0.219, (0.102, 0.164, 0.050)),
    16:  (4, 1.1500, 0.219, None),
}


def render(size: int) -> Image.Image:
    ss, glyph_frac, corner_frac, ring = TUNING[size]
    S = size * ss

    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    radius = round(S * corner_frac)
    d.rounded_rectangle([0, 0, S - 1, S - 1], radius=radius, fill=CLAY)
    if ring is not None:
        inset_frac, ring_corner_frac, stroke_frac = ring
        inset = round(S * inset_frac)
        d.rounded_rectangle(
            [inset, inset, S - 1 - inset, S - 1 - inset],
            radius=round(S * ring_corner_frac),
            outline=AEGEAN,
            width=max(1, round(S * stroke_frac)),
        )

    # Glyph mask, optically centred on its ink rather than its em box.
    px = round(S * glyph_frac)
    font = ImageFont.truetype(FONT, px)
    mask = Image.new("L", (S, S), 0)
    md = ImageDraw.Draw(mask)
    box = md.textbbox((0, 0), GLYPH, font=font)
    md.text(
        ((S - (box[2] - box[0])) / 2 - box[0], (S - (box[3] - box[1])) / 2 - box[1]),
        GLYPH,
        font=font,
        fill=255,
    )
    img = Image.composite(Image.new("RGBA", (S, S), CREAM), img, mask)

    return img if ss == 1 else img.resize((size, size), Image.LANCZOS)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for size in sorted(TUNING, reverse=True):
        path = OUT / f"icon{size}.png"
        render(size).save(path, "PNG", optimize=True)
        print(f"{path.name:14s} {size}x{size}  {path.stat().st_size:,} B")
    # An 8x sheet of the 16px asset, for eyeballing the small size without squinting.
    preview = Image.new("RGBA", (16 * 8, 16 * 8), (0, 0, 0, 0))
    preview.paste(render(16).resize((16 * 8, 16 * 8), Image.NEAREST), (0, 0))
    preview.save(OUT.parent.parent / "pipeline" / "icon16-preview.png", "PNG")
    print("icon16-preview.png  (8x nearest-neighbour blowup of the 16px asset)")


if __name__ == "__main__":
    main()
