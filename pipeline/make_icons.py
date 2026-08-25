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

# size -> (supersample, glyph fraction, margin fraction, corner fraction,
#          ring: None or (outer inset fraction, corner fraction, band fraction))
#
# Fractions are of the finished size, taken from the approved 64-unit
# mockup and verified against a browser raster of it: the body is inset
# 2/64 = 0.031 from the canvas (the seal floats, it does not fill),
# body corner 14/64 = 0.219, the ring BAND runs from 5.2/64 = 0.081 to
# 7.8/64 = 0.122 (an SVG stroke straddles its path; PIL draws inward,
# so the outer inset and band width encode the band edges directly),
# ring outer corner 11.8/64 = 0.184. The glyph em was raised from the
# mockup's 1.0625 to 1.20 by owner choice (2026-08-25): the epsilon
# reaches the ring without crossing it. 48 widens the band a touch so
# it survives the smaller raster; 16 has no ring, no margin, and a
# proportionally larger glyph instead.
TUNING = {
    128: (4, 1.20, 0.031, 0.219, (0.081, 0.184, 0.041)),
    48:  (4, 1.20, 0.031, 0.219, (0.081, 0.184, 0.050)),
    16:  (4, 1.30, 0.000, 0.219, None),
}


def render(size: int) -> Image.Image:
    ss, glyph_frac, margin_frac, corner_frac, ring = TUNING[size]
    S = size * ss

    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    m = round(S * margin_frac)
    radius = round(S * corner_frac)
    d.rounded_rectangle([m, m, S - 1 - m, S - 1 - m], radius=radius, fill=CLAY)
    if ring is not None:
        outer_frac, ring_corner_frac, band_frac = ring
        inset = round(S * outer_frac)
        d.rounded_rectangle(
            [inset, inset, S - 1 - inset, S - 1 - inset],
            radius=round(S * ring_corner_frac),
            outline=AEGEAN,
            width=max(1, round(S * band_frac)),
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
